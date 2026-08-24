export {
  buildCanonicalDocument,
  buildCanonicalProof,
  futureProviderDescriptors,
  getActiveChoiceSet,
  getActiveStep,
  getCurrentRoadmapItem,
  getCurrentStatement,
  getDocumentMode,
  getLessonRoadmap,
  getNextRoadmapItem,
  getTargetStatement,
  localCodexProviderDescriptor,
  ollamaProviderDescriptor,
  validateProofLatex,
} from "./runtime";

export {
  LocalCodexProvider,
  applyTutorResponse,
  buildInitializationPromptPreview,
  isCurrentCourseItemReady,
  isRestorableLocalCodexSession,
  localCodexProvider,
} from "./local-codex";
export type {
  InitializationPromptPreview,
  LocalCodexTransport,
} from "./local-codex";

export type {
  DocumentWorkspaceState,
  ProofWorkspaceState,
  ProviderDescriptor,
  ProviderError,
  ProviderKind,
  ProviderResult,
  SessionStatus,
  TutorAction,
  TutorChoiceOption,
  TutorChoiceSet,
  TutorControlState,
  TutorProviderContext,
  TutorMessage,
  TutorMessageKind,
  TutorMessageRole,
  TutorProvider,
  TutorSessionState,
  StudentIntent,
} from "./types";
