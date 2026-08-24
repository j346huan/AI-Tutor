import {
  TUTOR_PROTOCOL_LIMITS as LIMITS,
  TUTOR_PROTOCOL_VERSION,
  type TutorActionCommand,
  type TutorProtocolError,
  type TutorProtocolIssue,
  type TutorProtocolIssueCode,
  type TutorProtocolResult,
  type TutorRequestEnvelope,
  type TutorRequestInput,
  type TutorResponseEnvelope,
} from "./types";
import { isCourseItemReadyToAdvance } from "./course-readiness";
import {
  definitionEmphasizesTerm,
  validateCourseNotePart,
} from "./course-note-latex";
import { requestedCourseNoteSupplementKinds } from "./course-note-supplement";
import {
  getEditableLatexEnvironment,
  replaceExactLatexBlock,
  type EditableLatexEnvironment,
} from "./latex-block-replacement";

const MAX_ISSUES = 12;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

type UnknownRecord = Record<string, unknown>;

class IssueCollector {
  readonly issues: TutorProtocolIssue[] = [];

  add(path: string, code: TutorProtocolIssueCode, message: string) {
    if (this.issues.length >= MAX_ISSUES) return;
    this.issues.push({ path, code, message });
  }
}

function isRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  allowed: readonly string[],
  collector: IssueCollector,
): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    collector.add(path, "type", "Expected an object.");
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    collector.add(path, "type", "Expected a plain object.");
    return false;
  }

  for (const key of required) {
    if (!hasOwn(value, key)) {
      collector.add(`${path}.${key}`, "required", "A required field is missing.");
    }
  }

  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    collector.add(path, "unknown_field", "The object contains an unsupported field.");
  }
  return true;
}

function checkString(
  value: unknown,
  path: string,
  collector: IssueCollector,
  options: { min?: number; max: number; id?: boolean },
): value is string {
  if (typeof value !== "string") {
    collector.add(path, "type", "Expected a string.");
    return false;
  }
  if (value.length < (options.min ?? 0)) {
    collector.add(path, "limit", "The string is shorter than allowed.");
  }
  if (value.length > options.max) {
    collector.add(path, "limit", "The string is longer than allowed.");
  }
  if (options.id && !ID_PATTERN.test(value)) {
    collector.add(path, "format", "Expected a safe protocol identifier.");
  }
  return true;
}

function checkEnum(
  value: unknown,
  path: string,
  allowed: readonly string[],
  collector: IssueCollector,
): value is string {
  if (typeof value !== "string") {
    collector.add(path, "type", "Expected a string enum value.");
    return false;
  }
  if (!allowed.includes(value)) {
    collector.add(path, "enum", "The value is not supported by this protocol version.");
  }
  return true;
}

function checkArray(
  value: unknown,
  path: string,
  collector: IssueCollector,
  maximum: number,
  minimum = 0,
): value is unknown[] {
  if (!Array.isArray(value)) {
    collector.add(path, "type", "Expected an array.");
    return false;
  }
  if (value.length < minimum || value.length > maximum) {
    collector.add(path, "limit", "The array length is outside the allowed range.");
  }
  return true;
}

function checkRevision(value: unknown, path: string, collector: IssueCollector) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 1_000_000_000
  ) {
    collector.add(path, "format", "Expected a non-negative bounded integer.");
  }
}

function checkUniqueIds(
  records: readonly unknown[],
  path: string,
  collector: IssueCollector,
) {
  const seen = new Set<string>();
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    const id = (record as UnknownRecord).id;
    if (typeof id !== "string") continue;
    if (seen.has(id)) {
      collector.add(path, "semantic", "Identifiers in this array must be unique.");
      return;
    }
    seen.add(id);
  }
}

function validateRequestValue(value: unknown): TutorProtocolIssue[] {
  const collector = new IssueCollector();
  const rootFields = [
    "protocolVersion",
    "requestId",
    "profile",
    "studentBackground",
    "curriculum",
    "theorem",
    "lessonPlan",
    "mode",
    "currentProof",
    "recentTranscript",
    "pinnedChoices",
    "studentInput",
  ] as const;
  if (!isRecord(value, "$", rootFields, rootFields, collector)) {
    return collector.issues;
  }

  if (value.protocolVersion !== TUTOR_PROTOCOL_VERSION) {
    collector.add(
      "$.protocolVersion",
      "enum",
      "The protocol version is unsupported.",
    );
  }
  checkString(value.requestId, "$.requestId", collector, {
    min: 1,
    max: LIMITS.id,
    id: true,
  });

  const profileFields = ["name", "personality", "customInstructions"] as const;
  if (isRecord(value.profile, "$.profile", profileFields, profileFields, collector)) {
    checkString(value.profile.name, "$.profile.name", collector, {
      min: 1,
      max: LIMITS.name,
    });
    checkString(value.profile.personality, "$.profile.personality", collector, {
      min: 1,
      max: LIMITS.text,
    });
    if (
      checkArray(
        value.profile.customInstructions,
        "$.profile.customInstructions",
        collector,
        LIMITS.customInstructions,
      )
    ) {
      value.profile.customInstructions
        .slice(0, LIMITS.customInstructions)
        .forEach((instruction, index) =>
          checkString(
            instruction,
            `$.profile.customInstructions[${index}]`,
            collector,
            { min: 1, max: LIMITS.text },
          ),
        );
    }
  }

  checkString(value.studentBackground, "$.studentBackground", collector, {
    min: 1,
    max: LIMITS.text,
  });
  if (
    checkArray(
      value.curriculum,
      "$.curriculum",
      collector,
      LIMITS.curriculumItems,
      1,
    )
  ) {
    value.curriculum.slice(0, LIMITS.curriculumItems).forEach((item, index) => {
      const path = `$.curriculum[${index}]`;
      const required = ["kind", "title"] as const;
      const allowed = ["kind", "title", "statementLatex"] as const;
      if (!isRecord(item, path, required, allowed, collector)) return;
      checkEnum(
        item.kind,
        `${path}.kind`,
        ["definition", "lemma", "proposition", "theorem"],
        collector,
      );
      checkString(item.title, `${path}.title`, collector, {
        min: 1,
        max: LIMITS.shortText,
      });
      if (hasOwn(item, "statementLatex")) {
        checkString(item.statementLatex, `${path}.statementLatex`, collector, {
          min: 1,
          max: LIMITS.curriculumText,
        });
      }
    });
  }
  checkEnum(
    value.mode,
    "$.mode",
    ["learning", "proof", "reflection", "completed"],
    collector,
  );

  const requiredTheoremFields = ["id", "kind", "title"] as const;
  const allowedTheoremFields = ["id", "kind", "title", "statement", "latex"] as const;
  if (
    isRecord(
      value.theorem,
      "$.theorem",
      requiredTheoremFields,
      allowedTheoremFields,
      collector,
    )
  ) {
    checkString(value.theorem.id, "$.theorem.id", collector, {
      min: 1,
      max: LIMITS.id,
      id: true,
    });
    checkEnum(
      value.theorem.kind,
      "$.theorem.kind",
      ["definition", "lemma", "proposition", "theorem"],
      collector,
    );
    checkString(value.theorem.title, "$.theorem.title", collector, {
      min: 1,
      max: LIMITS.shortText,
    });
    if (hasOwn(value.theorem, "statement")) {
      checkString(value.theorem.statement, "$.theorem.statement", collector, {
        min: 1,
        max: LIMITS.text,
      });
    }
    if (hasOwn(value.theorem, "latex")) {
      checkString(value.theorem.latex, "$.theorem.latex", collector, {
        max: LIMITS.latex,
      });
    }
  }

  const lessonPlanFields = [
    "documentMode",
    "currentStatementId",
    "completedStatementIds",
    "writtenStatementIds",
    "roadmap",
  ] as const;
  const allowedLessonPlanFields = [...lessonPlanFields, "courseNoteEntries"] as const;
  if (
    isRecord(
      value.lessonPlan,
      "$.lessonPlan",
      lessonPlanFields,
      allowedLessonPlanFields,
      collector,
    )
  ) {
    checkEnum(
      value.lessonPlan.documentMode,
      "$.lessonPlan.documentMode",
      ["proof", "course-notes"],
      collector,
    );
    const currentIdIsValid = checkString(
      value.lessonPlan.currentStatementId,
      "$.lessonPlan.currentStatementId",
      collector,
      { min: 1, max: LIMITS.id, id: true },
    );

    const completedIds = new Set<string>();
    if (
      checkArray(
        value.lessonPlan.completedStatementIds,
        "$.lessonPlan.completedStatementIds",
        collector,
        LIMITS.roadmapItems,
      )
    ) {
      value.lessonPlan.completedStatementIds.forEach((id, index) => {
        if (
          checkString(
            id,
            `$.lessonPlan.completedStatementIds[${index}]`,
            collector,
            { min: 1, max: LIMITS.id, id: true },
          )
        ) {
          if (completedIds.has(id)) {
            collector.add(
              "$.lessonPlan.completedStatementIds",
              "semantic",
              "Completed roadmap statement identifiers must be unique.",
            );
          }
          completedIds.add(id);
        }
      });
    }

    const writtenStatementIds = new Set<string>();
    if (
      checkArray(
        value.lessonPlan.writtenStatementIds,
        "$.lessonPlan.writtenStatementIds",
        collector,
        LIMITS.roadmapItems,
      )
    ) {
      value.lessonPlan.writtenStatementIds.forEach((id, index) => {
        if (
          checkString(
            id,
            `$.lessonPlan.writtenStatementIds[${index}]`,
            collector,
            { min: 1, max: LIMITS.id, id: true },
          )
        ) {
          if (writtenStatementIds.has(id)) {
            collector.add(
              "$.lessonPlan.writtenStatementIds",
              "semantic",
              "Written course-note statement identifiers must be unique.",
            );
          }
          writtenStatementIds.add(id);
        }
      });
    }

    const courseNoteEntries = new Map<
      string,
      { latex?: string; proofLatex?: string; complete?: boolean }
    >();
    if (
      hasOwn(value.lessonPlan, "courseNoteEntries") &&
      checkArray(
        value.lessonPlan.courseNoteEntries,
        "$.lessonPlan.courseNoteEntries",
        collector,
        LIMITS.roadmapItems,
      )
    ) {
      value.lessonPlan.courseNoteEntries.forEach((entry, index) => {
        const path = `$.lessonPlan.courseNoteEntries[${index}]`;
        const required = ["statementId", "latex", "complete"] as const;
        const allowed = [...required, "proofLatex"] as const;
        if (!isRecord(entry, path, required, allowed, collector)) return;
        const idIsValid = checkString(entry.statementId, `${path}.statementId`, collector, {
          min: 1,
          max: LIMITS.id,
          id: true,
        });
        if (
          checkString(entry.latex, `${path}.latex`, collector, {
            min: 1,
            max: LIMITS.latex,
          })
        ) {
          const issue = validateCourseNotePart(entry.latex);
          if (issue) collector.add(`${path}.latex`, "semantic", issue);
        }
        if (
          hasOwn(entry, "proofLatex") &&
          checkString(entry.proofLatex, `${path}.proofLatex`, collector, {
            min: 1,
            max: LIMITS.latex,
          })
        ) {
          const issue = validateCourseNotePart(entry.proofLatex);
          if (issue) collector.add(`${path}.proofLatex`, "semantic", issue);
        }
        if (typeof entry.complete !== "boolean") {
          collector.add(`${path}.complete`, "type", "Expected a boolean completion flag.");
        }
        if (idIsValid && typeof entry.statementId === "string") {
          if (courseNoteEntries.has(entry.statementId)) {
            collector.add(
              "$.lessonPlan.courseNoteEntries",
              "semantic",
              "Course-note entry identifiers must be unique.",
            );
          }
          courseNoteEntries.set(entry.statementId, {
            latex: typeof entry.latex === "string" ? entry.latex : undefined,
            proofLatex:
              typeof entry.proofLatex === "string" ? entry.proofLatex : undefined,
            complete: typeof entry.complete === "boolean" ? entry.complete : undefined,
          });
        }
      });
    }

    const roadmapIds = new Set<string>();
    if (
      checkArray(
        value.lessonPlan.roadmap,
        "$.lessonPlan.roadmap",
        collector,
        LIMITS.roadmapItems,
        1,
      )
    ) {
      value.lessonPlan.roadmap.forEach((item, index) => {
        const path = `$.lessonPlan.roadmap[${index}]`;
        const fields = ["statementId", "kind", "title"] as const;
        if (!isRecord(item, path, fields, fields, collector)) return;
        if (
          checkString(item.statementId, `${path}.statementId`, collector, {
            min: 1,
            max: LIMITS.id,
            id: true,
          })
        ) {
          if (roadmapIds.has(item.statementId)) {
            collector.add(
              "$.lessonPlan.roadmap",
              "semantic",
              "Roadmap statement identifiers must be unique.",
            );
          }
          roadmapIds.add(item.statementId);
        }
        checkEnum(
          item.kind,
          `${path}.kind`,
          ["definition", "lemma", "proposition", "theorem"],
          collector,
        );
        checkString(item.title, `${path}.title`, collector, {
          min: 1,
          max: LIMITS.shortText,
        });
      });
    }

    if (
      currentIdIsValid &&
      typeof value.lessonPlan.currentStatementId === "string" &&
      !roadmapIds.has(value.lessonPlan.currentStatementId)
    ) {
      collector.add(
        "$.lessonPlan.currentStatementId",
        "semantic",
        "The current statement must occur in the fixed roadmap.",
      );
    }
    for (const completedId of completedIds) {
      if (!roadmapIds.has(completedId)) {
        collector.add(
          "$.lessonPlan.completedStatementIds",
          "semantic",
          "Every completed statement must occur in the fixed roadmap.",
        );
        break;
      }
    }
    for (const statementId of writtenStatementIds) {
      if (!roadmapIds.has(statementId)) {
        collector.add(
          "$.lessonPlan.writtenStatementIds",
          "semantic",
          "Every written course-note statement must occur in the fixed roadmap.",
        );
        break;
      }
    }
    for (const [statementId, entry] of courseNoteEntries) {
      if (!roadmapIds.has(statementId)) {
        collector.add(
          "$.lessonPlan.courseNoteEntries",
          "semantic",
          "Every generated course-note entry must occur in the fixed roadmap.",
        );
        break;
      }
      if (entry.complete !== writtenStatementIds.has(statementId)) {
        collector.add(
          "$.lessonPlan.courseNoteEntries",
          "semantic",
          "Only complete course-note entries may be listed as written.",
        );
        break;
      }
      const roadmapItem = Array.isArray(value.lessonPlan.roadmap)
        ? value.lessonPlan.roadmap.find(
            (item) =>
              item &&
              typeof item === "object" &&
              !Array.isArray(item) &&
              (item as UnknownRecord).statementId === statementId,
          )
        : undefined;
      if (
        roadmapItem &&
        typeof roadmapItem === "object" &&
        !Array.isArray(roadmapItem) &&
        (roadmapItem as UnknownRecord).kind === "definition" &&
        entry.proofLatex !== undefined
      ) {
        collector.add(
          "$.lessonPlan.courseNoteEntries",
          "semantic",
          "Definition entries cannot contain a proof body.",
        );
        break;
      }
    }
    if (
      currentIdIsValid &&
      typeof value.lessonPlan.currentStatementId === "string" &&
      Array.isArray(value.lessonPlan.roadmap)
    ) {
      const validatedCurrentStatementId = value.lessonPlan.currentStatementId;
      const currentIndex = value.lessonPlan.roadmap.findIndex(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          (item as UnknownRecord).statementId === validatedCurrentStatementId,
      );
      if (currentIndex >= 0) {
        const includeCurrent = value.mode === "completed" ? 1 : 0;
        const expectedCompleted = value.lessonPlan.roadmap
          .slice(0, currentIndex + includeCurrent)
          .map((item) =>
            item && typeof item === "object" && !Array.isArray(item)
              ? (item as UnknownRecord).statementId
              : undefined,
          );
        const actualCompleted = Array.isArray(value.lessonPlan.completedStatementIds)
          ? value.lessonPlan.completedStatementIds
          : [];
        if (
          expectedCompleted.length !== actualCompleted.length ||
          expectedCompleted.some((id, index) => id !== actualCompleted[index])
        ) {
          collector.add(
            "$.lessonPlan.completedStatementIds",
            "semantic",
            "Completed statements must be exactly the roadmap prefix before the current item.",
          );
        }

        value.lessonPlan.roadmap.forEach((item, index) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return;
          const statementId = (item as UnknownRecord).statementId;
          if (typeof statementId !== "string") return;
          if (index < currentIndex && !writtenStatementIds.has(statementId)) {
            collector.add(
              "$.lessonPlan.writtenStatementIds",
              "semantic",
              "Every completed outline item must have a generated course-note entry.",
            );
          }
          if (index > currentIndex && writtenStatementIds.has(statementId)) {
            collector.add(
              "$.lessonPlan.writtenStatementIds",
              "semantic",
              "Future outline items cannot be written early.",
            );
          }
        });
      }
    }
    if (
      isRecord(value.theorem, "$.theorem", [], ["id", "kind", "title", "statement", "latex"], collector) &&
      typeof value.theorem.id === "string" &&
      value.theorem.id !== value.lessonPlan.currentStatementId
    ) {
      collector.add(
        "$.theorem.id",
        "semantic",
        "The current statement must match the lesson-plan cursor.",
      );
    }
    if (value.lessonPlan.documentMode === "course-notes") {
      if (
        value.theorem &&
        typeof value.theorem === "object" &&
        !Array.isArray(value.theorem) &&
        (hasOwn(value.theorem, "statement") || hasOwn(value.theorem, "latex"))
      ) {
        collector.add(
          "$.theorem",
          "semantic",
          "Outline-only course requests must not include prewritten statement content.",
        );
      }
      if (
        Array.isArray(value.curriculum) &&
        value.curriculum.some(
          (item) =>
            item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            hasOwn(item, "statementLatex"),
        )
      ) {
        collector.add(
          "$.curriculum",
          "semantic",
          "Outline-only course curriculum must contain titles, not prewritten statements.",
        );
      }
    }
  }

  const proofFields = ["latex", "revision"] as const;
  if (
    isRecord(
      value.currentProof,
      "$.currentProof",
      proofFields,
      proofFields,
      collector,
    )
  ) {
    checkString(value.currentProof.latex, "$.currentProof.latex", collector, {
      max: LIMITS.latex,
    });
    checkRevision(value.currentProof.revision, "$.currentProof.revision", collector);
  }

  let transcriptCharacters = 0;
  if (
    checkArray(
      value.recentTranscript,
      "$.recentTranscript",
      collector,
      LIMITS.transcriptEntries,
    )
  ) {
    value.recentTranscript
      .slice(0, LIMITS.transcriptEntries)
      .forEach((entry, index) => {
        const path = `$.recentTranscript[${index}]`;
        const fields = ["role", "content"] as const;
        if (!isRecord(entry, path, fields, fields, collector)) return;
        checkEnum(entry.role, `${path}.role`, ["tutor", "student", "system"], collector);
        if (
          checkString(entry.content, `${path}.content`, collector, {
            min: 1,
            max: LIMITS.text,
          })
        ) {
          transcriptCharacters += entry.content.length;
        }
      });
  }
  if (transcriptCharacters > LIMITS.totalTranscriptCharacters) {
    collector.add(
      "$.recentTranscript",
      "limit",
      "The transcript exceeds the total character budget.",
    );
  }

  const pinnedIds = new Set<string>();
  if (
    checkArray(
      value.pinnedChoices,
      "$.pinnedChoices",
      collector,
      LIMITS.pinnedChoices,
    )
  ) {
    value.pinnedChoices
      .slice(0, LIMITS.pinnedChoices)
      .forEach((choice, index) => {
        const path = `$.pinnedChoices[${index}]`;
        const required = ["id", "kind", "label"] as const;
        const allowed = ["id", "kind", "label", "explanation", "action"] as const;
        if (!isRecord(choice, path, required, allowed, collector)) return;
        if (
          checkString(choice.id, `${path}.id`, collector, {
            min: 1,
            max: LIMITS.id,
            id: true,
          })
        ) {
          if (pinnedIds.has(choice.id)) {
            collector.add(
              "$.pinnedChoices",
              "semantic",
              "Pinned-choice identifiers must be unique.",
            );
          }
          pinnedIds.add(choice.id);
        }
        checkEnum(
          choice.kind,
          `${path}.kind`,
          ["approach", "next_sentence", "clarification", "learning_action"],
          collector,
        );
        checkString(choice.label, `${path}.label`, collector, {
          min: 1,
          max: LIMITS.shortText,
        });
        if (hasOwn(choice, "explanation")) {
          checkString(choice.explanation, `${path}.explanation`, collector, {
            min: 1,
            max: LIMITS.text,
          });
        }
        if (choice.kind === "learning_action") {
          if (!hasOwn(choice, "action")) {
            collector.add(
              `${path}.action`,
              "required",
              "A learning-action choice must identify its action.",
            );
          } else {
            checkEnum(
              choice.action,
              `${path}.action`,
              ["explore_example", "check_understanding", "continue"],
              collector,
            );
          }
        } else if (hasOwn(choice, "action")) {
          collector.add(
            `${path}.action`,
            "semantic",
            "Only learning-action choices may include an action.",
          );
        }
      });
  }

  const studentFields = ["kind", "text", "selectedChoiceId", "proofEdit"] as const;
  if (
    isRecord(
      value.studentInput,
      "$.studentInput",
      ["kind", "text"],
      studentFields,
      collector,
    )
  ) {
    checkEnum(
      value.studentInput.kind,
      "$.studentInput.kind",
      [
        "session_start",
        "message",
        "choice",
        "hint_request",
        "proof_feedback_request",
      ],
      collector,
    );
    checkString(value.studentInput.text, "$.studentInput.text", collector, {
      max: LIMITS.text,
    });
    if (hasOwn(value.studentInput, "selectedChoiceId")) {
      if (
        checkString(
          value.studentInput.selectedChoiceId,
          "$.studentInput.selectedChoiceId",
          collector,
          { min: 1, max: LIMITS.id, id: true },
        ) &&
        !pinnedIds.has(value.studentInput.selectedChoiceId)
      ) {
        collector.add(
          "$.studentInput.selectedChoiceId",
          "semantic",
          "The selected choice is not present in pinned choices.",
        );
      }
    } else if (value.studentInput.kind === "choice") {
      collector.add(
        "$.studentInput.selectedChoiceId",
        "required",
        "Choice input requires a selected choice identifier.",
      );
    }

    if (hasOwn(value.studentInput, "proofEdit")) {
      const path = "$.studentInput.proofEdit";
      const fields = ["previousLatex", "changed", "comments"] as const;
      if (isRecord(value.studentInput.proofEdit, path, fields, fields, collector)) {
        checkString(
          value.studentInput.proofEdit.previousLatex,
          `${path}.previousLatex`,
          collector,
          { max: LIMITS.latex },
        );
        checkString(value.studentInput.proofEdit.changed, `${path}.changed`, collector, {
          min: 1,
          max: LIMITS.text,
        });
        if (
          checkArray(
            value.studentInput.proofEdit.comments,
            `${path}.comments`,
            collector,
            LIMITS.proofComments,
          )
        ) {
          value.studentInput.proofEdit.comments
            .slice(0, LIMITS.proofComments)
            .forEach((comment, index) =>
              checkString(comment, `${path}.comments[${index}]`, collector, {
                min: 1,
                max: LIMITS.shortText,
              }),
            );
        }
      }
      if (value.studentInput.kind !== "proof_feedback_request") {
        collector.add(
          path,
          "semantic",
          "Proof-change context is only valid for a proof-feedback request.",
        );
      }
    } else if (value.studentInput.kind === "proof_feedback_request") {
      collector.add(
        "$.studentInput.proofEdit",
        "required",
        "Proof feedback requires the student's proof-change context.",
      );
    }
  }

  return collector.issues;
}

const responseIntents = [
  "session_start",
  "proof_step",
  "proposed_approach",
  "confusion",
  "mathematical_question",
  "question_about_choice",
  "select_choice",
  "request_hint",
  "request_proof_feedback",
  "edit_proof",
  "off_topic",
  "unclear",
] as const;

function validateClassification(
  value: unknown,
  path: string,
  collector: IssueCollector,
) {
  const fields = ["type", "intent", "confidence", "rationale"] as const;
  if (!isRecord(value, path, fields, fields, collector)) return;
  if (value.type !== "classify_student_intent") {
    collector.add(`${path}.type`, "enum", "Expected the classification directive type.");
  }
  checkEnum(value.intent, `${path}.intent`, responseIntents, collector);
  if (
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    collector.add(`${path}.confidence`, "format", "Confidence must be between 0 and 1.");
  }
  checkString(value.rationale, `${path}.rationale`, collector, {
    max: LIMITS.shortText,
  });
}

function validateApproachChoices(
  value: unknown,
  path: string,
  collector: IssueCollector,
) {
  if (!checkArray(value, path, collector, LIMITS.proposedChoices, 2)) return;
  value.slice(0, LIMITS.proposedChoices).forEach((choice, index) => {
    const choicePath = `${path}[${index}]`;
    const fields = ["id", "label", "explanation"] as const;
    if (!isRecord(choice, choicePath, fields, fields, collector)) return;
    checkString(choice.id, `${choicePath}.id`, collector, {
      min: 1,
      max: LIMITS.id,
      id: true,
    });
    checkString(choice.label, `${choicePath}.label`, collector, {
      min: 1,
      max: LIMITS.shortText,
    });
    checkString(choice.explanation, `${choicePath}.explanation`, collector, {
      min: 1,
      max: LIMITS.text,
    });
  });
  checkUniqueIds(value, path, collector);
}

function validateNextSentenceChoices(
  value: unknown,
  path: string,
  collector: IssueCollector,
) {
  if (!checkArray(value, path, collector, LIMITS.proposedChoices, 2)) return;
  value.slice(0, LIMITS.proposedChoices).forEach((choice, index) => {
    const choicePath = `${path}[${index}]`;
    const fields = ["id", "latex", "explanation"] as const;
    if (!isRecord(choice, choicePath, fields, fields, collector)) return;
    checkString(choice.id, `${choicePath}.id`, collector, {
      min: 1,
      max: LIMITS.id,
      id: true,
    });
    checkString(choice.latex, `${choicePath}.latex`, collector, {
      min: 1,
      max: LIMITS.latex,
    });
    checkString(choice.explanation, `${choicePath}.explanation`, collector, {
      min: 1,
      max: LIMITS.text,
    });
  });
  checkUniqueIds(value, path, collector);
}

function visibleMarkdownLength(markdown: string): number {
  return markdown
    .replace(/\]\((?:\\.|[^)\n])*\)/g, "]")
    .replace(/<https?:\/\/[^>\n]*>/gi, "link")
    .length;
}

function commandVisibleCopy(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const command = value as UnknownRecord;
  switch (command.type) {
    case "reply":
      return typeof command.markdown === "string" ? [command.markdown] : [];
    case "identify_mistake":
      return [command.message, command.suggestion].filter(
        (part): part is string => typeof part === "string",
      );
    case "propose_approaches": {
      const choices = Array.isArray(command.choices) ? command.choices : [];
      return [
        command.prompt,
        ...choices.flatMap((choice) =>
          choice && typeof choice === "object" && !Array.isArray(choice)
            ? [(choice as UnknownRecord).label, (choice as UnknownRecord).explanation]
            : [],
        ),
      ].filter((part): part is string => typeof part === "string");
    }
    case "propose_next_sentences": {
      const choices = Array.isArray(command.choices) ? command.choices : [];
      return [
        command.prompt,
        ...choices.flatMap((choice) =>
          choice && typeof choice === "object" && !Array.isArray(choice)
            ? [(choice as UnknownRecord).latex, (choice as UnknownRecord).explanation]
            : [],
        ),
      ].filter((part): part is string => typeof part === "string");
    }
    default:
      return [];
  }
}

function validateCommand(
  value: unknown,
  path: string,
  collector: IssueCollector,
): value is TutorActionCommand {
  const possibleFields = [
    "type",
    "markdown",
    "label",
    "latex",
    "proofLatex",
    "proofFragmentLatex",
    "complete",
    "noteId",
    "afterStatementId",
    "kind",
    "title",
    "target",
    "replacement",
    "statementId",
    "reason",
    "prompt",
    "choices",
    "severity",
    "message",
    "suggestion",
    "mode",
  ] as const;
  if (!isRecord(value, path, ["type"], possibleFields, collector)) return false;
  if (typeof value.type !== "string") {
    collector.add(`${path}.type`, "type", "Expected a command type string.");
    return false;
  }

  switch (value.type) {
    case "reply": {
      const fields = ["type", "markdown"] as const;
      if (!isRecord(value, path, fields, fields, collector)) return false;
      checkString(
        value.markdown,
        `${path}.markdown`,
        collector,
        {
          min: 1,
          max: LIMITS.reply,
        },
      );
      break;
    }
    case "commit_latex": {
      const fields = ["type", "label", "latex"] as const;
      if (!isRecord(value, path, fields, fields, collector)) return false;
      checkString(value.label, `${path}.label`, collector, {
        min: 1,
        max: LIMITS.shortText,
      });
      checkString(value.latex, `${path}.latex`, collector, {
        min: 1,
        max: LIMITS.latex,
      });
      break;
    }
    case "write_course_note": {
      const required = ["type", "statementId", "latex", "reason"] as const;
      const allowed = [...required, "proofLatex"] as const;
      if (!isRecord(value, path, required, allowed, collector)) return false;
      checkString(value.statementId, `${path}.statementId`, collector, {
        min: 1,
        max: LIMITS.id,
        id: true,
      });
      if (
        checkString(value.latex, `${path}.latex`, collector, {
          min: 1,
          max: LIMITS.latex,
        })
      ) {
        const latexIssue = validateCourseNotePart(value.latex);
        if (latexIssue) collector.add(`${path}.latex`, "semantic", latexIssue);
      }
      if (
        hasOwn(value, "proofLatex") &&
        checkString(value.proofLatex, `${path}.proofLatex`, collector, {
          min: 1,
          max: LIMITS.latex,
        })
      ) {
        const latexIssue = validateCourseNotePart(value.proofLatex);
        if (latexIssue) collector.add(`${path}.proofLatex`, "semantic", latexIssue);
      }
      checkString(value.reason, `${path}.reason`, collector, {
        min: 1,
        max: LIMITS.text,
      });
      break;
    }
    case "revise_course_note": {
      const required = ["type", "statementId", "latex", "reason"] as const;
      const allowed = [...required, "proofLatex"] as const;
      if (!isRecord(value, path, required, allowed, collector)) return false;
      checkString(value.statementId, `${path}.statementId`, collector, {
        min: 1,
        max: LIMITS.id,
        id: true,
      });
      if (
        checkString(value.latex, `${path}.latex`, collector, {
          min: 1,
          max: LIMITS.latex,
        })
      ) {
        const latexIssue = validateCourseNotePart(value.latex);
        if (latexIssue) collector.add(`${path}.latex`, "semantic", latexIssue);
      }
      if (
        hasOwn(value, "proofLatex") &&
        checkString(value.proofLatex, `${path}.proofLatex`, collector, {
          min: 1,
          max: LIMITS.latex,
        })
      ) {
        const latexIssue = validateCourseNotePart(value.proofLatex);
        if (latexIssue) collector.add(`${path}.proofLatex`, "semantic", latexIssue);
      }
      checkString(value.reason, `${path}.reason`, collector, {
        min: 1,
        max: LIMITS.text,
      });
      break;
    }
    case "record_course_note_progress": {
      const required = [
        "type",
        "statementId",
        "latex",
        "complete",
        "reason",
      ] as const;
      const allowed = [...required, "proofFragmentLatex"] as const;
      if (!isRecord(value, path, required, allowed, collector)) return false;
      checkString(value.statementId, `${path}.statementId`, collector, {
        min: 1,
        max: LIMITS.id,
        id: true,
      });
      if (
        checkString(value.latex, `${path}.latex`, collector, {
          min: 1,
          max: LIMITS.latex,
        })
      ) {
        const latexIssue = validateCourseNotePart(value.latex);
        if (latexIssue) collector.add(`${path}.latex`, "semantic", latexIssue);
      }
      if (
        hasOwn(value, "proofFragmentLatex") &&
        checkString(
          value.proofFragmentLatex,
          `${path}.proofFragmentLatex`,
          collector,
          { min: 1, max: LIMITS.latex },
        )
      ) {
        const latexIssue = validateCourseNotePart(value.proofFragmentLatex);
        if (latexIssue) {
          collector.add(`${path}.proofFragmentLatex`, "semantic", latexIssue);
        }
      }
      if (typeof value.complete !== "boolean") {
        collector.add(`${path}.complete`, "type", "Expected a boolean completion flag.");
      }
      checkString(value.reason, `${path}.reason`, collector, {
        min: 1,
        max: LIMITS.text,
      });
      break;
    }
    case "insert_course_note_supplement": {
      const fields = [
        "type",
        "noteId",
        "afterStatementId",
        "kind",
        "title",
        "latex",
        "proofLatex",
        "reason",
      ] as const;
      if (!isRecord(value, path, fields, fields, collector)) return false;
      checkString(value.noteId, `${path}.noteId`, collector, {
        min: 1,
        max: LIMITS.id,
        id: true,
      });
      checkString(value.afterStatementId, `${path}.afterStatementId`, collector, {
        min: 1,
        max: LIMITS.id,
        id: true,
      });
      checkEnum(
        value.kind,
        `${path}.kind`,
        ["lemma", "proposition", "theorem"],
        collector,
      );
      checkString(value.title, `${path}.title`, collector, {
        min: 1,
        max: LIMITS.shortText,
      });
      if (
        checkString(value.latex, `${path}.latex`, collector, {
          min: 1,
          max: LIMITS.latex,
        })
      ) {
        const latexIssue = validateCourseNotePart(value.latex);
        if (latexIssue) collector.add(`${path}.latex`, "semantic", latexIssue);
      }
      if (
        checkString(value.proofLatex, `${path}.proofLatex`, collector, {
          min: 1,
          max: LIMITS.latex,
        })
      ) {
        const latexIssue = validateCourseNotePart(value.proofLatex);
        if (latexIssue) collector.add(`${path}.proofLatex`, "semantic", latexIssue);
      }
      checkString(value.reason, `${path}.reason`, collector, {
        min: 1,
        max: LIMITS.text,
      });
      break;
    }
    case "advance_roadmap": {
      const fields = ["type", "statementId", "reason"] as const;
      if (!isRecord(value, path, fields, fields, collector)) return false;
      checkString(value.statementId, `${path}.statementId`, collector, {
        min: 1,
        max: LIMITS.id,
        id: true,
      });
      checkString(value.reason, `${path}.reason`, collector, {
        min: 1,
        max: LIMITS.text,
      });
      break;
    }
    case "replace_latex": {
      const fields = ["type", "latex", "reason"] as const;
      if (!isRecord(value, path, fields, fields, collector)) return false;
      checkString(value.latex, `${path}.latex`, collector, {
        min: 1,
        max: LIMITS.latex,
      });
      checkString(value.reason, `${path}.reason`, collector, {
        min: 1,
        max: LIMITS.text,
      });
      break;
    }
    case "replace_latex_block": {
      const fields = ["type", "target", "replacement", "reason"] as const;
      if (!isRecord(value, path, fields, fields, collector)) return false;
      const targetIsString = checkString(
        value.target,
        `${path}.target`,
        collector,
        { min: 1, max: LIMITS.latex },
      );
      const replacementIsString = checkString(
        value.replacement,
        `${path}.replacement`,
        collector,
        { min: 1, max: LIMITS.latex },
      );
      if (
        targetIsString &&
        replacementIsString &&
        typeof value.target === "string" &&
        typeof value.replacement === "string"
      ) {
        const targetEnvironment = getEditableLatexEnvironment(value.target);
        const replacementEnvironment = getEditableLatexEnvironment(
          value.replacement,
        );
        if (!targetEnvironment) {
          collector.add(
            `${path}.target`,
            "semantic",
            "The target must be one complete editable LaTeX environment.",
          );
        } else if (replacementEnvironment !== targetEnvironment) {
          collector.add(
            `${path}.replacement`,
            "semantic",
            "The replacement must use the same complete LaTeX environment as the target.",
          );
        }
      }
      checkString(value.reason, `${path}.reason`, collector, {
        min: 1,
        max: LIMITS.text,
      });
      break;
    }
    case "propose_approaches": {
      const fields = ["type", "prompt", "choices"] as const;
      if (!isRecord(value, path, fields, fields, collector)) return false;
      checkString(value.prompt, `${path}.prompt`, collector, {
        min: 1,
        max: LIMITS.text,
      });
      validateApproachChoices(value.choices, `${path}.choices`, collector);
      break;
    }
    case "propose_next_sentences": {
      const fields = ["type", "prompt", "choices"] as const;
      if (!isRecord(value, path, fields, fields, collector)) return false;
      checkString(value.prompt, `${path}.prompt`, collector, {
        min: 1,
        max: LIMITS.text,
      });
      validateNextSentenceChoices(value.choices, `${path}.choices`, collector);
      break;
    }
    case "identify_mistake": {
      const fields = ["type", "severity", "message", "suggestion"] as const;
      if (!isRecord(value, path, fields, fields, collector)) return false;
      checkEnum(
        value.severity,
        `${path}.severity`,
        ["imprecision", "logical_gap", "incorrect"],
        collector,
      );
      checkString(value.message, `${path}.message`, collector, {
        min: 1,
        max: LIMITS.text,
      });
      checkString(value.suggestion, `${path}.suggestion`, collector, {
        min: 1,
        max: LIMITS.text,
      });
      break;
    }
    case "set_mode": {
      const fields = ["type", "mode", "reason"] as const;
      if (!isRecord(value, path, fields, fields, collector)) return false;
      checkEnum(
        value.mode,
        `${path}.mode`,
        ["learning", "proof", "reflection", "completed"],
        collector,
      );
      checkString(value.reason, `${path}.reason`, collector, {
        min: 1,
        max: LIMITS.text,
      });
      break;
    }
    case "no_op": {
      const fields = ["type", "reason"] as const;
      if (!isRecord(value, path, fields, fields, collector)) return false;
      checkString(value.reason, `${path}.reason`, collector, {
        min: 1,
        max: LIMITS.text,
      });
      break;
    }
    default:
      collector.add(`${path}.type`, "enum", "The command type is unsupported.");
      return false;
  }
  return true;
}

function totalKnownStringCharacters(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): number {
  if (depth > 20) return LIMITS.totalResponseCharacters + 1;
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) {
    if (seen.has(value)) return LIMITS.totalResponseCharacters + 1;
    seen.add(value);
    return value.reduce(
      (sum, entry) =>
        sum + totalKnownStringCharacters(entry, seen, depth + 1),
      0,
    );
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return LIMITS.totalResponseCharacters + 1;
    seen.add(value);
    return Object.values(value).reduce<number>(
      (sum, entry) =>
        sum + totalKnownStringCharacters(entry, seen, depth + 1),
      0,
    );
  }
  return 0;
}

function validateResponseValue(value: unknown): TutorProtocolIssue[] {
  const collector = new IssueCollector();
  const fields = ["protocolVersion", "requestId", "classification", "commands"] as const;
  if (!isRecord(value, "$", fields, fields, collector)) return collector.issues;

  if (value.protocolVersion !== TUTOR_PROTOCOL_VERSION) {
    collector.add(
      "$.protocolVersion",
      "enum",
      "The protocol version is unsupported.",
    );
  }
  checkString(value.requestId, "$.requestId", collector, {
    min: 1,
    max: LIMITS.id,
    id: true,
  });
  validateClassification(value.classification, "$.classification", collector);

  if (checkArray(value.commands, "$.commands", collector, LIMITS.commands, 1)) {
    value.commands
      .slice(0, LIMITS.commands)
      .forEach((command, index) =>
        validateCommand(command, `$.commands[${index}]`, collector),
      );

    const noOpCount = value.commands.filter(
      (command) =>
        command &&
        typeof command === "object" &&
        !Array.isArray(command) &&
        (command as UnknownRecord).type === "no_op",
    ).length;
    if (noOpCount > 0 && value.commands.length !== 1) {
      collector.add(
        "$.commands",
        "semantic",
        "A no-op command must be the only command.",
      );
    }

    const proposalCount = value.commands.filter(
      (command) =>
        command &&
        typeof command === "object" &&
        !Array.isArray(command) &&
        [
          "propose_approaches",
          "propose_next_sentences",
        ].includes(
          String((command as UnknownRecord).type),
        ),
    ).length;
    if (proposalCount > 1) {
      collector.add(
        "$.commands",
        "semantic",
        "Only one pinned-choice proposal command is allowed per response.",
      );
    }

    const roadmapAdvanceCount = value.commands.filter(
      (command) =>
        command &&
        typeof command === "object" &&
        !Array.isArray(command) &&
        (command as UnknownRecord).type === "advance_roadmap",
    ).length;
    if (roadmapAdvanceCount > 1) {
      collector.add(
        "$.commands",
        "semantic",
        "Only one roadmap advance is allowed per response.",
      );
    }

    const courseNoteMutationCount = value.commands.filter(
      (command) =>
        command &&
        typeof command === "object" &&
        !Array.isArray(command) &&
        [
          "write_course_note",
          "revise_course_note",
          "record_course_note_progress",
          "insert_course_note_supplement",
        ].includes(
          String((command as UnknownRecord).type),
        ),
    ).length;
    if (courseNoteMutationCount > 1) {
      collector.add(
        "$.commands",
        "semantic",
        "Only one course-note entry may be written, revised, or inserted per response.",
      );
    }

    const documentMutationCount = value.commands.filter(
      (command) =>
        command &&
        typeof command === "object" &&
        !Array.isArray(command) &&
        [
          "write_course_note",
          "revise_course_note",
          "record_course_note_progress",
          "insert_course_note_supplement",
          "replace_latex",
          "replace_latex_block",
        ].includes(String((command as UnknownRecord).type)),
    ).length;
    if (documentMutationCount > 1) {
      collector.add(
        "$.commands",
        "semantic",
        "Only one document mutation command is allowed per response.",
      );
    }

    const replacementMutationCount = value.commands.filter(
      (command) =>
        command &&
        typeof command === "object" &&
        !Array.isArray(command) &&
        ["revise_course_note", "replace_latex", "replace_latex_block"].includes(
          String((command as UnknownRecord).type),
        ),
    ).length;
    if (replacementMutationCount > 1) {
      collector.add(
        "$.commands",
        "semantic",
        "Only one document replacement command is allowed per response.",
      );
    }

    const transcriptCommandCount = value.commands.filter(
      (command) =>
        command &&
        typeof command === "object" &&
        !Array.isArray(command) &&
        ["reply", "identify_mistake"].includes(
          String((command as UnknownRecord).type),
        ),
    ).length;
    if (transcriptCommandCount > 1) {
      collector.add(
        "$.commands",
        "semantic",
        "Only one transcript-producing command is allowed per response.",
      );
    }

    const visibleCopyCharacters = value.commands
      .flatMap(commandVisibleCopy)
      .reduce((total, copy) => total + visibleMarkdownLength(copy), 0);
    if (visibleCopyCharacters > LIMITS.visibleCopy) {
      collector.add(
        "$.commands",
        "limit",
        "The combined student-visible tutor copy exceeds 600 characters.",
      );
    }

  }

  if (totalKnownStringCharacters(value) > LIMITS.totalResponseCharacters) {
    collector.add(
      "$",
      "limit",
      "The response exceeds the total character budget.",
    );
  }
  return collector.issues;
}

function failure(
  code: TutorProtocolError["code"],
  message: string,
  issues?: TutorProtocolIssue[],
): { ok: false; error: TutorProtocolError } {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(issues?.length ? { issues: issues.slice(0, MAX_ISSUES) } : {}),
    },
  };
}

function decodeJson(
  raw: unknown,
): TutorProtocolResult<unknown> {
  if (typeof raw !== "string") return { ok: true, value: raw };
  if (raw.length > LIMITS.json) {
    return failure(
      "payload_too_large",
      "The tutor payload exceeds the protocol size limit.",
    );
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return failure("invalid_json", "The tutor payload is not valid JSON.");
  }
}

export function validateTutorRequest(
  value: unknown,
): TutorProtocolResult<TutorRequestEnvelope> {
  const issues = validateRequestValue(value);
  return issues.length
    ? failure(
        "invalid_request",
        "The tutor request does not match the supported protocol.",
        issues,
      )
    : { ok: true, value: value as TutorRequestEnvelope };
}

export function validateTutorResponse(
  value: unknown,
): TutorProtocolResult<TutorResponseEnvelope> {
  const issues = validateResponseValue(value);
  return issues.length
    ? failure(
        "invalid_response",
        "The tutor response does not match the supported protocol.",
        issues,
      )
    : { ok: true, value: value as TutorResponseEnvelope };
}

function isDirectDefinitionRequest(request: TutorRequestEnvelope): boolean {
  if (
    request.lessonPlan.documentMode !== "course-notes" ||
    request.theorem.kind !== "definition" ||
    request.studentInput.kind !== "message"
  ) {
    return false;
  }
  return /^(?:please\s+)?(?:define\b|state\s+(?:the\s+)?definition\b|give\s+(?:me\s+)?the\s+definition\b|what\s+(?:is|are)\b|just\s+(?:state|tell)\b)/i.test(
    request.studentInput.text.trim(),
  );
}

function requiresDefinitionUnderstandingCheck(
  request: TutorRequestEnvelope,
): boolean {
  if (
    request.lessonPlan.documentMode !== "course-notes" ||
    request.theorem.kind !== "definition" ||
    request.lessonPlan.writtenStatementIds.includes(
      request.lessonPlan.currentStatementId,
    ) ||
    request.studentInput.kind !== "message" ||
    isDirectDefinitionRequest(request)
  ) {
    return false;
  }

  const text = request.studentInput.text.trim();
  const acknowledgement =
    /^(?:ok(?:ay)?|alright|right|sure|yes|yeah|yep|i see|got it|understood|hmm+|mhm+)[.!?\s]*$/i.test(
      text,
    );
  const exampleRequest =
    /\b(?:example|non-example|counterexample|illustrat(?:e|ion))s?\b/i.test(
      text,
    );
  return acknowledgement || exampleRequest;
}

function isExplicitLatexEditRequest(request: TutorRequestEnvelope): boolean {
  if (request.studentInput.kind === "proof_feedback_request") return true;
  if (request.studentInput.kind !== "message") return false;
  const text = request.studentInput.text;
  const requestsSupplement =
    request.lessonPlan.documentMode === "course-notes" &&
    requestedCourseNoteSupplementKinds(text).length > 0;
  if (
    requestsSupplement &&
    !/\b(?:edit|modify|revise|rewrite|correct|fix|tighten|shorten|expand|clarify|improve|polish)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  return (
    /\b(?:edit|modify|revise|rewrite|correct|fix|tighten|shorten|expand|clarify|improve|polish)\b/i.test(
      text,
    ) ||
    /\bmake\s+(?:(?:my|the|this|current)\s+)?(?:definition|lemma|proposition|theorem|proof|it)\b/i.test(
      text,
    )
  );
}

function namedEditEnvironments(
  request: TutorRequestEnvelope,
): EditableLatexEnvironment[] {
  if (!isExplicitLatexEditRequest(request)) return [];
  const found = new Set<EditableLatexEnvironment>();
  for (const match of request.studentInput.text.matchAll(
    /\b(definition|lemma|proposition|theorem|proof)s?\b/gi,
  )) {
    found.add(match[1].toLowerCase() as EditableLatexEnvironment);
  }
  return [...found];
}

/**
 * Applies request-aware turn policy after the standalone response contract.
 * In particular, choosing a pinned proof sentence must immediately update the
 * proof unless the tutor identifies a gap or offers a corrected formulation.
 */
export function validateTutorTurnResponse(
  request: TutorRequestEnvelope,
  value: unknown,
): TutorProtocolResult<TutorResponseEnvelope> {
  const validated = validateTutorResponse(value);
  if (!validated.ok) return validated;

  const semanticFailure = (message: string) =>
    failure(
      "invalid_response",
      "The tutor response does not match the supported protocol.",
      [{ path: "$.commands", code: "semantic", message }],
    );

  const commandTypes = validated.value.commands.map((command) => command.type);
  const selectedChoice = request.studentInput.selectedChoiceId
    ? request.pinnedChoices.find(
        (choice) => choice.id === request.studentInput.selectedChoiceId,
      )
    : undefined;
  const fallbackLearningAction =
    request.lessonPlan.documentMode === "course-notes" &&
    request.studentInput.kind === "message"
      ? request.studentInput.text === "Continue to the next course item."
        ? "continue"
        : undefined
      : undefined;
  const selectedLearningAction =
    request.studentInput.kind === "choice" &&
    selectedChoice?.kind === "learning_action"
      ? selectedChoice.action
      : fallbackLearningAction;
  const currentCourseItemIsReady = isCourseItemReadyToAdvance(
    request.lessonPlan,
  );
  if (
    request.studentInput.kind === "session_start" &&
    commandTypes.some((type) =>
      [
        "commit_latex",
        "write_course_note",
        "revise_course_note",
        "record_course_note_progress",
        "insert_course_note_supplement",
        "replace_latex",
        "replace_latex_block",
        "advance_roadmap",
      ].includes(type),
    )
  ) {
    return semanticFailure(
      "A session-start response must leave the working document and roadmap unchanged.",
    );
  }
  if (
    validated.value.classification.intent === "proof_step" &&
    request.lessonPlan.documentMode === "proof"
  ) {
    const commitsStep = commandTypes.includes("commit_latex");
    const explainsNonCommit = commandTypes.some((type) =>
      ["identify_mistake", "propose_next_sentences"].includes(type),
    );
    if (!commitsStep && !explainsNonCommit) {
      return semanticFailure(
        "A proof-step response must commit the accepted step or identify why it cannot yet be committed.",
      );
    }
  }
  if (
    validated.value.classification.intent === "proof_step" &&
    request.lessonPlan.documentMode === "course-notes" &&
    request.theorem.kind !== "definition"
  ) {
    const progressCommand = validated.value.commands.find(
      (command) => command.type === "record_course_note_progress",
    );
    const recordsStep =
      progressCommand?.type === "record_course_note_progress" &&
      Boolean(progressCommand.proofFragmentLatex?.trim());
    const explainsNonCommit = commandTypes.some((type) =>
      ["identify_mistake", "propose_next_sentences"].includes(type),
    );
    if (!recordsStep && !explainsNonCommit) {
      return semanticFailure(
        "An accepted theorem proof step must be recorded in the course notes in the same turn.",
      );
    }
  }
  if (
    commandTypes.includes("replace_latex") &&
    request.studentInput.kind !== "proof_feedback_request"
  ) {
    return semanticFailure(
      "A complete document replacement is allowed only during an explicit document-feedback review.",
    );
  }

  const blockReplacement = validated.value.commands.find(
    (command) => command.type === "replace_latex_block",
  );
  if (blockReplacement?.type === "replace_latex_block") {
    if (!isExplicitLatexEditRequest(request)) {
      return semanticFailure(
        "A LaTeX block may be replaced only when the student explicitly requests an edit or document feedback.",
      );
    }
    const replacement = replaceExactLatexBlock(
      request.currentProof.latex,
      blockReplacement.target,
      blockReplacement.replacement,
    );
    if (!replacement.ok) return semanticFailure(replacement.error);

    const namedEnvironments = namedEditEnvironments(request);
    if (
      namedEnvironments.length > 0 &&
      !namedEnvironments.includes(replacement.environment)
    ) {
      return semanticFailure(
        `The student requested an edit to a ${namedEnvironments.join(" or ")} environment, but the proposed target is a ${replacement.environment} environment.`,
      );
    }
  }

  const namedEnvironments = namedEditEnvironments(request);
  if (namedEnvironments.length > 0) {
    const matchingNamedMutation = validated.value.commands.some((command) => {
      if (command.type === "replace_latex_block") {
        const environment = getEditableLatexEnvironment(command.target);
        return Boolean(environment && namedEnvironments.includes(environment));
      }
      if (command.type === "revise_course_note") {
        return namedEnvironments.includes(request.theorem.kind);
      }
      return false;
    });
    if (!matchingNamedMutation) {
      return semanticFailure(
        `An explicit request to edit the student's ${namedEnvironments.join(" or ")} must change that matching environment, not another course-note entry.`,
      );
    }
  }

  if (request.lessonPlan.documentMode === "course-notes") {
    const directDefinitionTurn = isDirectDefinitionRequest(request);
    const definitionUnderstandingCheckRequired =
      requiresDefinitionUnderstandingCheck(request);
    const requestedSupplementKinds =
      request.studentInput.kind === "message"
        ? requestedCourseNoteSupplementKinds(request.studentInput.text)
        : [];
    const currentDefinitionIsWritten = request.lessonPlan.writtenStatementIds.includes(
      request.lessonPlan.currentStatementId,
    );
    if (definitionUnderstandingCheckRequired) {
      if (
        commandTypes.some((type) =>
          [
            "write_course_note",
            "revise_course_note",
            "advance_roadmap",
            "set_mode",
          ].includes(type),
        )
      ) {
        return semanticFailure(
          "An example or brief acknowledgement must lead to a key-concept check before the current definition is shown or written.",
        );
      }
      const reply = validated.value.commands.find(
        (command) => command.type === "reply",
      );
      if (reply?.type !== "reply" || !reply.markdown.includes("?")) {
        return semanticFailure(
          "Before writing the current definition, ask one focused question that checks the example's key concept.",
        );
      }
    }
    if (directDefinitionTurn && commandTypes.includes("advance_roadmap")) {
      return semanticFailure(
        "A direct definition answer must leave the student on the current item rather than advancing the roadmap.",
      );
    }
    if (
      directDefinitionTurn &&
      !currentDefinitionIsWritten &&
      !commandTypes.includes("write_course_note")
    ) {
      return semanticFailure(
        "A direct definition answer must write the current definition into the course notes.",
      );
    }
    if (directDefinitionTurn && !commandTypes.includes("reply")) {
      return semanticFailure(
        "A direct definition request must be answered in the conversation.",
      );
    }
    if (
      selectedLearningAction === "continue" &&
      !currentCourseItemIsReady
    ) {
      return semanticFailure(
        "Continue is available only after the current course-note entry has been written.",
      );
    }
    if (
      selectedLearningAction === "continue" &&
      !commandTypes.includes("advance_roadmap") &&
      !validated.value.commands.some(
        (command) => command.type === "set_mode" && command.mode === "completed",
      )
    ) {
      return semanticFailure(
        "Selecting continue must advance to the next course item or complete the final item.",
      );
    }
    let currentStatementId = request.lessonPlan.currentStatementId;
    const written = new Set(request.lessonPlan.writtenStatementIds);
    const entries = new Map(
      (request.lessonPlan.courseNoteEntries ?? []).map((entry) => [
        entry.statementId,
        entry,
      ]),
    );
    for (const command of validated.value.commands) {
      if (command.type === "commit_latex") {
        return semanticFailure(
          "Course-note lessons may write generated entries only with write_course_note.",
        );
      }
      if (command.type === "write_course_note") {
        if (command.statementId !== currentStatementId) {
          return semanticFailure(
            "A course-note entry may be written only for the current outline item.",
          );
        }
        if (written.has(command.statementId)) {
          return semanticFailure(
            "Each outline item may have only one generated course-note entry.",
          );
        }
        if (entries.has(command.statementId)) {
          return semanticFailure(
            "An in-progress course-note entry must be completed progressively, not written again.",
          );
        }
        const item = request.lessonPlan.roadmap.find(
          (candidate) => candidate.statementId === command.statementId,
        );
        if (item?.kind === "definition" && command.proofLatex !== undefined) {
          return semanticFailure(
            "A definition course-note entry must have one body and no proof field.",
          );
        }
        if (
          item?.kind === "definition" &&
          !definitionEmphasizesTerm(command.latex, item.title)
        ) {
          return semanticFailure(
            "A definition course-note entry must wrap the exact term being defined in \\emph{...}.",
          );
        }
        if (item && item.kind !== "definition" && !command.proofLatex) {
          return semanticFailure(
            "A lemma, proposition, or theorem course-note entry must separate its statement from its proof.",
          );
        }
        written.add(command.statementId);
        entries.set(command.statementId, {
          statementId: command.statementId,
          latex: command.latex,
          ...(command.proofLatex ? { proofLatex: command.proofLatex } : {}),
          complete: true,
        });
      }
      if (command.type === "revise_course_note") {
        if (command.statementId !== currentStatementId) {
          return semanticFailure(
            "A course-note entry may be revised only for the current outline item.",
          );
        }
        if (!written.has(command.statementId)) {
          return semanticFailure(
            "A course-note entry must already exist before it can be revised.",
          );
        }
        const item = request.lessonPlan.roadmap.find(
          (candidate) => candidate.statementId === command.statementId,
        );
        if (item?.kind === "definition" && command.proofLatex !== undefined) {
          return semanticFailure(
            "A definition course-note entry must have one body and no proof field.",
          );
        }
        if (
          item?.kind === "definition" &&
          !definitionEmphasizesTerm(command.latex, item.title)
        ) {
          return semanticFailure(
            "A definition course-note entry must wrap the exact term being defined in \\emph{...}.",
          );
        }
        if (item && item.kind !== "definition" && !command.proofLatex) {
          return semanticFailure(
            "A lemma, proposition, or theorem course-note entry must separate its statement from its proof.",
          );
        }
      }
      if (command.type === "record_course_note_progress") {
        if (command.statementId !== currentStatementId) {
          return semanticFailure(
            "Theorem progress may be recorded only for the current outline item.",
          );
        }
        const item = request.lessonPlan.roadmap.find(
          (candidate) => candidate.statementId === command.statementId,
        );
        if (!item || item.kind === "definition") {
          return semanticFailure(
            "Progress recording is available only for the current lemma, proposition, or theorem.",
          );
        }
        const existing = entries.get(command.statementId);
        if (existing?.complete || written.has(command.statementId)) {
          return semanticFailure(
            "A completed course-note entry cannot receive another proof fragment.",
          );
        }
        if (existing && command.latex !== existing.latex) {
          return semanticFailure(
            "Progress commands must preserve the established statement exactly; revise it explicitly instead.",
          );
        }
        const accumulatedProof = [
          existing?.proofLatex?.trim(),
          command.proofFragmentLatex?.trim(),
        ]
          .filter(Boolean)
          .join("\n\n");
        if (command.complete && !accumulatedProof) {
          return semanticFailure(
            "A completed lemma, proposition, or theorem must contain a proof.",
          );
        }
        entries.set(command.statementId, {
          statementId: command.statementId,
          latex: command.latex,
          ...(accumulatedProof ? { proofLatex: accumulatedProof } : {}),
          complete: command.complete,
        });
        if (command.complete) written.add(command.statementId);
      }
      if (command.type === "insert_course_note_supplement") {
        if (
          request.studentInput.kind !== "message" ||
          requestedSupplementKinds.length !== 1
        ) {
          return semanticFailure(
            "A supplementary result may be inserted only after an explicit student request to add one named lemma, proposition, or theorem.",
          );
        }
        if (command.kind !== requestedSupplementKinds[0]) {
          return semanticFailure(
            "The supplementary result kind must match the lemma, proposition, or theorem named by the student.",
          );
        }
        if (command.afterStatementId !== currentStatementId) {
          return semanticFailure(
            "A supplementary result may be inserted only after the current course topic.",
          );
        }
        if (!written.has(currentStatementId)) {
          return semanticFailure(
            "The current course topic must already have a generated entry before a supplementary result can be inserted.",
          );
        }
        if (
          request.lessonPlan.roadmap.some(
            (item) => item.statementId === command.noteId,
          )
        ) {
          return semanticFailure(
            "A supplementary note identifier must be distinct from fixed roadmap identifiers.",
          );
        }
      }
      if (command.type === "advance_roadmap") {
        const currentIndex = request.lessonPlan.roadmap.findIndex(
          (item) => item.statementId === currentStatementId,
        );
        const current = request.lessonPlan.roadmap[currentIndex];
        const next = request.lessonPlan.roadmap[currentIndex + 1];
        if (!current || !next || next.statementId !== command.statementId) {
          return semanticFailure(
            "The tutor may advance only to the immediate next item in the fixed roadmap.",
          );
        }
        if (!written.has(current.statementId)) {
          return semanticFailure(
            "The current outline item needs a generated course-note entry before advancing.",
          );
        }
        currentStatementId = next.statementId;
      }
      if (command.type === "set_mode" && command.mode === "completed") {
        const currentIndex = request.lessonPlan.roadmap.findIndex(
          (item) => item.statementId === currentStatementId,
        );
        const current = request.lessonPlan.roadmap[currentIndex];
        if (
          !current ||
          currentIndex !== request.lessonPlan.roadmap.length - 1 ||
          !written.has(current.statementId)
        ) {
          return semanticFailure(
            "A course can be completed only after the final outline item has a generated entry.",
          );
        }
      }
      if (
        command.type === "set_mode" &&
        (command.mode === "proof" || command.mode === "reflection")
      ) {
        return semanticFailure(
          "Course-note lessons remain in learning mode until the fixed roadmap is completed.",
        );
      }
    }
    if (
      commandTypes.includes("insert_course_note_supplement") &&
      (commandTypes.includes("advance_roadmap") ||
        commandTypes.includes("set_mode"))
    ) {
      return semanticFailure(
        "Inserting a supplementary result must leave the current roadmap item and course mode unchanged.",
      );
    }
  } else if (
    commandTypes.includes("write_course_note") ||
    commandTypes.includes("revise_course_note") ||
    commandTypes.includes("record_course_note_progress") ||
    commandTypes.includes("insert_course_note_supplement") ||
    commandTypes.includes("advance_roadmap")
  ) {
    return semanticFailure(
      "Roadmap note commands are available only in course-note lessons.",
    );
  }

  if (
    request.lessonPlan.documentMode === "proof" &&
    request.studentInput.kind === "choice" &&
    selectedChoice?.kind === "next_sentence"
  ) {
    const commitsStep = commandTypes.includes("commit_latex");
    const explainsNonCommit = commandTypes.some((type) =>
      ["identify_mistake", "propose_next_sentences"].includes(type),
    );
    if (!commitsStep && !explainsNonCommit) {
      return failure(
        "invalid_response",
        "The tutor response does not match the supported protocol.",
        [
          {
            path: "$.commands",
            code: "semantic",
            message:
              "Selecting a proposed proof sentence must commit it or explain why it cannot be committed.",
          },
        ],
      );
    }
  }

  if (request.studentInput.kind === "proof_feedback_request") {
    const addressesEdit = commandTypes.some((type) =>
      [
        "reply",
        "identify_mistake",
        "replace_latex",
        "replace_latex_block",
        "revise_course_note",
      ].includes(type),
    );
    if (!addressesEdit) {
      return failure(
        "invalid_response",
        "The tutor response does not match the supported protocol.",
        [
          {
            path: "$.commands",
            code: "semantic",
            message:
              "Proof feedback must address the edit in chat or replace the proof with a reviewed revision.",
          },
        ],
      );
    }
  }

  return validated;
}

export function parseTutorRequest(
  raw: unknown,
): TutorProtocolResult<TutorRequestEnvelope> {
  const decoded = decodeJson(raw);
  return decoded.ok ? validateTutorRequest(decoded.value) : decoded;
}

export function parseTutorResponse(
  raw: unknown,
  request?: TutorRequestEnvelope,
): TutorProtocolResult<TutorResponseEnvelope> {
  const decoded = decodeJson(raw);
  if (!decoded.ok) return decoded;
  return request
    ? validateTutorTurnResponse(request, decoded.value)
    : validateTutorResponse(decoded.value);
}

export class TutorProtocolValidationError extends Error {
  readonly protocolError: TutorProtocolError;

  constructor(protocolError: TutorProtocolError) {
    super(protocolError.message);
    this.name = "TutorProtocolValidationError";
    this.protocolError = protocolError;
  }
}

export function buildTutorRequest(input: TutorRequestInput): TutorRequestEnvelope {
  const candidate: TutorRequestEnvelope = {
    ...input,
    protocolVersion: TUTOR_PROTOCOL_VERSION,
  };
  const validated = validateTutorRequest(candidate);
  if (!validated.ok) throw new TutorProtocolValidationError(validated.error);
  return validated.value;
}
