/**
 * Stable local-alpha wire identifier. The loopback bridge loads the checked-in
 * response schema for every turn, so command refinements remain on v1 while
 * stale in-flight responses fail closed in the current validator.
 */
export const TUTOR_PROTOCOL_VERSION = "ai-mathematician.tutor.v1" as const;

/** Shared bounds used by the schema, runtime validator, and prompt. */
export const TUTOR_PROTOCOL_LIMITS = {
  id: 128,
  name: 120,
  shortText: 1_000,
  reply: 600,
  visibleCopy: 600,
  text: 12_000,
  latex: 100_000,
  json: 1_000_000,
  customInstructions: 12,
  curriculumItems: 32,
  roadmapItems: 32,
  curriculumText: 2_000,
  transcriptEntries: 40,
  pinnedChoices: 5,
  commands: 12,
  proposedChoices: 3,
  proofComments: 20,
  totalTranscriptCharacters: 80_000,
  totalResponseCharacters: 250_000,
} as const;

export type TutorProtocolVersion = typeof TUTOR_PROTOCOL_VERSION;

export type TutorMode = "learning" | "proof" | "reflection" | "completed";

export interface TutorProfileContext {
  name: string;
  personality: string;
  customInstructions: string[];
}

export interface TutorTheoremContext {
  id: string;
  kind: "definition" | "lemma" | "proposition" | "theorem";
  title: string;
  /** Optional for outline-only courses; Codex develops this content in conversation. */
  statement?: string;
  latex?: string;
}

export interface TutorCurriculumItem {
  kind: "definition" | "lemma" | "proposition" | "theorem";
  title: string;
  /** Optional for outline-only courses whose content is written during tutoring. */
  statementLatex?: string;
}

export interface TutorRoadmapItem {
  statementId: string;
  kind: "definition" | "lemma" | "proposition" | "theorem";
  title: string;
}

/** Structured generated content for one roadmap item, including in-progress proofs. */
export interface TutorCourseNoteEntryContext {
  statementId: string;
  /** Definition body or theorem-like statement body, without its environment wrapper. */
  latex: string;
  /** Accumulated proof body for a theorem-like item, without its proof wrapper. */
  proofLatex?: string;
  /** True only after the theorem-like proof (or definition entry) is complete. */
  complete: boolean;
}

export interface TutorLessonPlanContext {
  documentMode: "proof" | "course-notes";
  currentStatementId: string;
  completedStatementIds: string[];
  /** Outline items for which Codex has already written one course-note entry. */
  writtenStatementIds: string[];
  /** Generated entry bodies, including the current theorem-like work in progress. */
  courseNoteEntries?: TutorCourseNoteEntryContext[];
  roadmap: TutorRoadmapItem[];
}

export interface TutorCurrentProofContext {
  latex: string;
  revision: number;
}

export interface TutorTranscriptEntry {
  role: "tutor" | "student" | "system";
  content: string;
}

export interface TutorPinnedChoice {
  id: string;
  kind: "approach" | "next_sentence" | "clarification" | "learning_action";
  label: string;
  explanation?: string;
  action?: TutorLearningAction;
}

/** Structured context captured when the student asks Codex to review an edit. */
export interface TutorProofEditContext {
  /** Complete last rendered/accepted proof, before the student's edit. */
  previousLatex: string;
  /** Compact, line-oriented description of the changed region. */
  changed: string;
  /** Unescaped LaTeX `%` comments found in the proposed source. */
  comments: string[];
}

export interface TutorStudentInput {
  kind:
    | "session_start"
    | "message"
    | "choice"
    | "hint_request"
    | "proof_feedback_request";
  text: string;
  selectedChoiceId?: string;
  proofEdit?: TutorProofEditContext;
}

export interface TutorRequestEnvelope {
  protocolVersion: TutorProtocolVersion;
  requestId: string;
  profile: TutorProfileContext;
  studentBackground: string;
  curriculum: TutorCurriculumItem[];
  theorem: TutorTheoremContext;
  /** Fixed teacher-authored route and the only note fragments Codex may select. */
  lessonPlan: TutorLessonPlanContext;
  mode: TutorMode;
  currentProof: TutorCurrentProofContext;
  recentTranscript: TutorTranscriptEntry[];
  pinnedChoices: TutorPinnedChoice[];
  studentInput: TutorStudentInput;
}

export type TutorRequestInput = Omit<TutorRequestEnvelope, "protocolVersion">;

export type TutorStudentIntent =
  | "session_start"
  | "proof_step"
  | "proposed_approach"
  | "confusion"
  | "mathematical_question"
  | "question_about_choice"
  | "select_choice"
  | "request_hint"
  | "request_proof_feedback"
  | "edit_proof"
  | "off_topic"
  | "unclear";

/** Classification is top-level, but also part of the broader directive union. */
export interface ClassifyStudentIntentDirective {
  type: "classify_student_intent";
  intent: TutorStudentIntent;
  confidence: number;
  rationale: string;
}

export interface ReplyCommand {
  type: "reply";
  markdown: string;
}

/** Append one newly justified fragment to the current proof. */
export interface CommitLatexCommand {
  type: "commit_latex";
  label: string;
  latex: string;
}

/** Write one conversation-grounded entry for the current course outline item. */
export interface WriteCourseNoteCommand {
  type: "write_course_note";
  statementId: string;
  /** Definition body or theorem-like statement only. The site supplies its wrapper. */
  latex: string;
  /** Proof body only, required for lemma/proposition/theorem entries. */
  proofLatex?: string;
  reason: string;
}

/** Replace the generated body of the current, already-written course-note entry. */
export interface ReviseCourseNoteCommand {
  type: "revise_course_note";
  statementId: string;
  /** Replacement definition body or theorem-like statement only. */
  latex: string;
  /** Replacement proof body, required for lemma/proposition/theorem entries. */
  proofLatex?: string;
  reason: string;
}

/** Establish a theorem-like statement and record one newly accepted proof step. */
export interface RecordCourseNoteProgressCommand {
  type: "record_course_note_progress";
  statementId: string;
  /** Complete current statement body. The site replaces the earlier statement with it. */
  latex: string;
  /** Only the newly accepted proof fragment; the site appends it to prior proof work. */
  proofFragmentLatex?: string;
  /** True only when the accumulated proof is complete and ready to continue. */
  complete: boolean;
  reason: string;
}

/** Insert one student-requested theorem-like result after the current topic. */
export interface InsertCourseNoteSupplementCommand {
  type: "insert_course_note_supplement";
  /** Stable identity for this supplementary note, distinct from roadmap IDs. */
  noteId: string;
  /** The written roadmap entry after which the supplement is placed. */
  afterStatementId: string;
  kind: "lemma" | "proposition" | "theorem";
  title: string;
  /** Statement body only; the site supplies the theorem wrapper. */
  latex: string;
  /** Proof body only; the site supplies a separate proof wrapper. */
  proofLatex: string;
  reason: string;
}

/** Advance only to the immediate next statement in the supplied roadmap. */
export interface AdvanceRoadmapCommand {
  type: "advance_roadmap";
  statementId: string;
  reason: string;
}

/** Replace the complete working proof source. Use only for an intentional rewrite. */
export interface ReplaceLatexCommand {
  type: "replace_latex";
  latex: string;
  reason: string;
}

/** Replace one exact student-authored mathematical environment in place. */
export interface ReplaceLatexBlockCommand {
  type: "replace_latex_block";
  /** Exact complete environment copied from currentProof.latex. */
  target: string;
  /** Complete replacement using the same outer environment. */
  replacement: string;
  reason: string;
}

export interface TutorApproachOption {
  id: string;
  label: string;
  explanation: string;
}

export interface ProposeApproachesCommand {
  type: "propose_approaches";
  prompt: string;
  choices: TutorApproachOption[];
}

export type TutorLearningAction =
  | "explore_example"
  | "check_understanding"
  | "continue";

export interface TutorNextSentenceOption {
  id: string;
  latex: string;
  explanation: string;
}

export interface ProposeNextSentencesCommand {
  type: "propose_next_sentences";
  prompt: string;
  choices: TutorNextSentenceOption[];
}

export interface IdentifyMistakeCommand {
  type: "identify_mistake";
  severity: "imprecision" | "logical_gap" | "incorrect";
  message: string;
  suggestion: string;
}

export interface SetModeCommand {
  type: "set_mode";
  mode: TutorMode;
  reason: string;
}

export interface NoOpCommand {
  type: "no_op";
  reason: string;
}

export type TutorActionCommand =
  | ReplyCommand
  | CommitLatexCommand
  | WriteCourseNoteCommand
  | ReviseCourseNoteCommand
  | RecordCourseNoteProgressCommand
  | InsertCourseNoteSupplementCommand
  | AdvanceRoadmapCommand
  | ReplaceLatexCommand
  | ReplaceLatexBlockCommand
  | ProposeApproachesCommand
  | ProposeNextSentencesCommand
  | IdentifyMistakeCommand
  | SetModeCommand
  | NoOpCommand;

export type TutorResponseDirective =
  | ClassifyStudentIntentDirective
  | TutorActionCommand;

export interface TutorResponseEnvelope {
  protocolVersion: TutorProtocolVersion;
  requestId: string;
  classification: ClassifyStudentIntentDirective;
  /** Apply in array order. */
  commands: TutorActionCommand[];
}

export type TutorProtocolIssueCode =
  | "required"
  | "type"
  | "enum"
  | "format"
  | "limit"
  | "unknown_field"
  | "semantic";

export interface TutorProtocolIssue {
  path: string;
  code: TutorProtocolIssueCode;
  /** Safe summary; never includes submitted content. */
  message: string;
}

export interface TutorProtocolError {
  code:
    | "invalid_json"
    | "payload_too_large"
    | "invalid_request"
    | "invalid_response";
  message: string;
  issues?: TutorProtocolIssue[];
}

export type TutorProtocolResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TutorProtocolError };
