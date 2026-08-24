/**
 * Lesson data deliberately contains Markdown-with-math, never authored HTML.
 * The UI is responsible for parsing Markdown and sanitizing the resulting HTML.
 */
export type LessonContentFormat = "markdown-with-math";

export type StatementKind = "definition" | "lemma" | "proposition" | "theorem";

/** What the right-hand document is being assembled into. Defaults to proof. */
export type LessonDocumentMode = "proof" | "course-notes";

export interface TutorProfile {
  id: string;
  name: string;
  personality: string;
  customPrompts: string[];
}

export interface MathematicalStatement {
  id: string;
  kind: StatementKind;
  title: string;
  /** Optional teacher-authored content. Outline-only courses leave this absent. */
  statement?: string;
  /** Optional display mathematics. Outline-only courses leave this absent. */
  latex?: string;
  backgroundNotes?: string[];
}

/**
 * One ordered stop on a course route. Outline-only courses provide only the
 * statement id; older authored courses may also supply fixed guidance.
 */
export interface LessonRoadmapItem {
  statementId: string;
  /** Optional guidance for teacher-authored lessons. */
  teachingPrompt?: string;
  /** Optional fixed criteria for teacher-authored lessons. */
  completionCriteria?: string[];
  /** Optional fixed document fragments for legacy authored lessons. */
  noteFragmentIds?: string[];
}

/** Portable settings shape for future teacher- or peer-authored JSON imports. */
export interface TutorSettingsBundle {
  schemaVersion: 1;
  profile: TutorProfile;
  curriculum: MathematicalStatement[];
  studentBackgroundPrompt: string;
}

export type LessonMode = "orientation" | "proof" | "reflection";

export interface ProofFragment {
  id: string;
  label: string;
  latex: string;
}

/** Neutral alias for proof paragraphs and predetermined course-note sections. */
export type LessonDocumentFragment = ProofFragment;

export interface LessonOutcome {
  tutorMessages: string[];
  addProofFragmentIds?: string[];
  nextStepId?: string;
  complete?: boolean;
  markMistake?: boolean;
}

export interface LessonChoice {
  id: string;
  label: string;
  studentMessage: string;
  /** Used when the student asks about a pinned option without choosing it. */
  explanation: string;
  /** Deterministic phrases that let a typed proof step commit this choice. */
  freeTextMatches?: TextMatchClause[];
  outcome: LessonOutcome;
}

export interface LessonChoiceSet {
  id: string;
  title: string;
  prompt: string;
  choices: LessonChoice[];
}

export interface TextMatchClause {
  /** Every normalized token or phrase in this list must occur. */
  all?: string[];
  /** At least one normalized token or phrase in this list must occur. */
  any?: string[];
  /** None of these normalized tokens or phrases may occur. */
  none?: string[];
}

export interface LessonResponseRule {
  id: string;
  /** A rule matches if any clause matches. */
  anyOf: TextMatchClause[];
  outcome: LessonOutcome;
}

export interface LessonStep {
  id: string;
  mode: LessonMode;
  /** Messages appended when this step first becomes active. */
  entryMessages: string[];
  choiceSet?: LessonChoiceSet;
  responseRules?: LessonResponseRule[];
  fallbackOutcome?: LessonOutcome;
  hint: string;
  /** Statement displayed while this lesson step is active. */
  focusStatementId?: string;
}

export interface LessonDefinition {
  schemaVersion: 1;
  /** Increment when saved progress from earlier lesson content must not restore. */
  contentVersion?: number;
  id: string;
  title: string;
  contentFormat: LessonContentFormat;
  settings: TutorSettingsBundle;
  /** Omitted by legacy proof lessons; omission is equivalent to "proof". */
  documentMode?: LessonDocumentMode;
  /** Ordered, teacher-authored course route. Omitted by single-proof lessons. */
  roadmap?: LessonRoadmapItem[];
  targetStatementId: string;
  initialStepId: string;
  steps: Record<string, LessonStep>;
  proof: {
    documentTitle: string;
    preamble: string;
    opening: string;
    fragments: Record<string, ProofFragment>;
    closing: string;
  };
}
