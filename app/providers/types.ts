import type {
  LessonDefinition,
  LessonMode,
  StatementKind,
} from "../lessons/types";

export type ProviderKind = "local-codex" | "ollama";

export interface ProviderDescriptor {
  id: string;
  name: string;
  kind: ProviderKind;
  available: boolean;
  requiresNetwork: boolean;
  description: string;
  extensionPoint?: string;
}

export type TutorMessageRole = "tutor" | "student" | "system";

export type StudentIntent =
  | "question"
  | "proposed_approach"
  | "proposed_proof_step"
  | "confusion"
  | "request_for_hint"
  | "request_for_feedback"
  | "choice_selection"
  | "off_topic"
  | "unclear";

export type TutorMessageKind =
  | "lesson"
  | "response"
  | "question"
  | "hint"
  | "feedback"
  | "completion"
  | "error";

export interface TutorMessage {
  id: string;
  sequence: number;
  role: TutorMessageRole;
  kind: TutorMessageKind;
  /** Markdown-with-math. It is never pre-rendered or trusted HTML. */
  markdown: string;
}

export interface TutorChoiceOption {
  id: string;
  label: string;
  description?: string;
  learningAction?: "explore_example" | "check_understanding" | "continue";
}

export interface TutorChoiceSet {
  id: string;
  kind: "approach" | "next_sentence" | "clarification" | "learning_action";
  title: string;
  prompt: string;
  choices: TutorChoiceOption[];
}

export interface TutorControlState {
  studentIntent?: StudentIntent;
  pendingChoiceSet?: TutorChoiceSet;
  lastRequestId?: string;
}

export type SessionStatus =
  | "empty"
  | "loading"
  | "active"
  | "completed"
  | "error";

export interface ProofWorkspaceState {
  fragmentIds: string[];
  /** Course outline items with one generated note entry already persisted. */
  courseNoteStatementIds?: string[];
  /** Generated roadmap entries, including theorem-like statements and partial proofs. */
  courseNoteEntries?: Array<{
    statementId: string;
    latex: string;
    proofLatex?: string;
    complete: boolean;
  }>;
  /** Student-requested generated entries that do not alter the fixed roadmap. */
  courseNoteSupplementIds?: string[];
  /** Document assembled from accepted tutor changes. */
  canonicalLatex: string;
  /** Text currently shown in the editable LaTeX field. */
  editorLatex: string;
  /** Last valid draft submitted for rendering. */
  previewLatex: string;
  /** Last proof source authored or explicitly reviewed by the active tutor. */
  reviewedLatex?: string;
  source: "tutor" | "student-edit";
  revision: number;
  feedback: string;
}

/** Preferred neutral name; ProofWorkspaceState remains for compatibility. */
export type DocumentWorkspaceState = ProofWorkspaceState;

export interface ProviderError {
  code: string;
  message: string;
}

/** Entirely JSON-serializable so a UI can persist it in localStorage. */
export interface TutorSessionState {
  schemaVersion: 1;
  lessonId: string;
  /** Defaults to 1 for lessons and saved sessions created before revisions existed. */
  lessonContentVersion?: number;
  providerId: string;
  status: SessionStatus;
  mode: LessonMode;
  activeStepId: string;
  /** Current teacher-authored roadmap item, when this is a course lesson. */
  currentStatementId?: string;
  /** Roadmap items left only by a validated advance command. */
  completedStatementIds?: string[];
  messages: TutorMessage[];
  proof: ProofWorkspaceState;
  hintsUsed: number;
  mistakesSeen: number;
  control?: TutorControlState;
  error?: ProviderError;
}

export type TutorAction =
  | { type: "choose"; choiceId: string }
  | { type: "message"; text: string; selectedChoiceId?: string }
  | { type: "ask-about-choice"; choiceId: string; question?: string }
  | { type: "request-hint" }
  | { type: "render-proof"; latex: string }
  | { type: "request-proof-feedback"; latex: string };

export interface ProviderResult {
  state: TutorSessionState;
  appendedMessages: TutorMessage[];
  accepted: boolean;
}

export interface TutorProviderContext {
  /** Display name supplied by the student; older callers may omit it. */
  studentName?: string;
  profile: {
    name: string;
    personality: string;
    customPrompts: string[];
  };
  studentBackground: string;
  curriculum: Array<{
    kind: StatementKind;
    title: string;
    statementLatex?: string;
  }>;
}

export interface TutorProvider {
  readonly descriptor: ProviderDescriptor;

  createSession(
    lesson: LessonDefinition,
    restoredState?: TutorSessionState | null,
    context?: TutorProviderContext,
  ): Promise<ProviderResult>;

  dispatch(
    lesson: LessonDefinition,
    state: TutorSessionState,
    action: TutorAction,
    context?: TutorProviderContext,
  ): Promise<ProviderResult>;
}
