export { euclidLesson } from "./euclid";
export { galoisLesson } from "./galois";
export { blowupsLesson } from "./blowups";
export type {
  LessonChoice,
  LessonChoiceSet,
  LessonContentFormat,
  LessonDefinition,
  LessonDocumentMode,
  LessonDocumentFragment,
  LessonMode,
  LessonRoadmapItem,
  LessonStep,
  MathematicalStatement,
  ProofFragment,
  LessonOutcome,
  LessonResponseRule,
  StatementKind,
  TextMatchClause,
  TutorProfile,
  TutorSettingsBundle,
} from "./types";

import { euclidLesson } from "./euclid";
import { galoisLesson } from "./galois";
import { blowupsLesson } from "./blowups";

/** Add future structured lessons here; UI code need not change. */
export const lessonCatalog = [euclidLesson, galoisLesson, blowupsLesson] as const;
