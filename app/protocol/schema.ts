import {
  TUTOR_PROTOCOL_LIMITS as LIMITS,
  TUTOR_PROTOCOL_VERSION,
} from "./types";
import tutorResponseSchema from "./tutor-response.schema.json";

const ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$";

const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: LIMITS.id,
  pattern: ID_PATTERN,
} as const;

const shortTextSchema = {
  type: "string",
  minLength: 1,
  maxLength: LIMITS.shortText,
} as const;

const textSchema = {
  type: "string",
  minLength: 1,
  maxLength: LIMITS.text,
} as const;

const latexSchema = {
  type: "string",
  maxLength: LIMITS.latex,
} as const;

const modeSchema = {
  type: "string",
  enum: ["learning", "proof", "reflection", "completed"],
} as const;

export const TUTOR_REQUEST_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:ai-mathematician:tutor-request:v1",
  title: "AI Mathematician tutor request v1",
  type: "object",
  additionalProperties: false,
  required: [
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
  ],
  properties: {
    protocolVersion: { const: TUTOR_PROTOCOL_VERSION },
    requestId: idSchema,
    profile: {
      type: "object",
      additionalProperties: false,
      required: ["name", "personality", "customInstructions"],
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: LIMITS.name,
        },
        personality: textSchema,
        customInstructions: {
          type: "array",
          maxItems: LIMITS.customInstructions,
          items: textSchema,
        },
      },
    },
    studentBackground: textSchema,
    curriculum: {
      type: "array",
      minItems: 1,
      maxItems: LIMITS.curriculumItems,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "title"],
        properties: {
          kind: {
            type: "string",
            enum: ["definition", "lemma", "proposition", "theorem"],
          },
          title: shortTextSchema,
          statementLatex: {
            type: "string",
            minLength: 1,
            maxLength: LIMITS.curriculumText,
          },
        },
      },
    },
    theorem: {
      type: "object",
      additionalProperties: false,
      required: ["id", "kind", "title"],
      properties: {
        id: idSchema,
        kind: {
          type: "string",
          enum: ["definition", "lemma", "proposition", "theorem"],
        },
        title: shortTextSchema,
        statement: textSchema,
        latex: latexSchema,
      },
    },
    lessonPlan: {
      type: "object",
      additionalProperties: false,
      required: [
        "documentMode",
        "currentStatementId",
        "completedStatementIds",
        "writtenStatementIds",
        "roadmap",
      ],
      properties: {
        documentMode: { type: "string", enum: ["proof", "course-notes"] },
        currentStatementId: idSchema,
        completedStatementIds: {
          type: "array",
          maxItems: LIMITS.roadmapItems,
          items: idSchema,
        },
        writtenStatementIds: {
          type: "array",
          maxItems: LIMITS.roadmapItems,
          items: idSchema,
        },
        courseNoteEntries: {
          type: "array",
          maxItems: LIMITS.roadmapItems,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["statementId", "latex", "complete"],
            properties: {
              statementId: idSchema,
              latex: { type: "string", minLength: 1, maxLength: LIMITS.latex },
              proofLatex: { type: "string", minLength: 1, maxLength: LIMITS.latex },
              complete: { type: "boolean" },
            },
          },
        },
        roadmap: {
          type: "array",
          minItems: 1,
          maxItems: LIMITS.roadmapItems,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["statementId", "kind", "title"],
            properties: {
              statementId: idSchema,
              kind: {
                type: "string",
                enum: ["definition", "lemma", "proposition", "theorem"],
              },
              title: shortTextSchema,
            },
          },
        },
      },
    },
    mode: modeSchema,
    currentProof: {
      type: "object",
      additionalProperties: false,
      required: ["latex", "revision"],
      properties: {
        latex: latexSchema,
        revision: { type: "integer", minimum: 0, maximum: 1_000_000_000 },
      },
    },
    recentTranscript: {
      type: "array",
      maxItems: LIMITS.transcriptEntries,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "content"],
        properties: {
          role: { type: "string", enum: ["tutor", "student", "system"] },
          content: textSchema,
        },
      },
    },
    pinnedChoices: {
      type: "array",
      maxItems: LIMITS.pinnedChoices,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "label"],
        properties: {
          id: idSchema,
          kind: {
            type: "string",
            enum: ["approach", "next_sentence", "clarification", "learning_action"],
          },
          label: shortTextSchema,
          explanation: textSchema,
          action: {
            type: "string",
            enum: ["explore_example", "check_understanding", "continue"],
          },
        },
      },
    },
    studentInput: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "text"],
      properties: {
        kind: {
          type: "string",
          enum: [
            "session_start",
            "message",
            "choice",
            "hint_request",
            "proof_feedback_request",
          ],
        },
        text: { type: "string", maxLength: LIMITS.text },
        selectedChoiceId: idSchema,
        proofEdit: {
          type: "object",
          additionalProperties: false,
          required: ["previousLatex", "changed", "comments"],
          properties: {
            previousLatex: latexSchema,
            changed: { type: "string", minLength: 1, maxLength: LIMITS.text },
            comments: {
              type: "array",
              maxItems: LIMITS.proofComments,
              items: shortTextSchema,
            },
          },
        },
      },
    },
  },
} as const;

/** Imported from the checked-in standalone schema used by provider bridges. */
export const TUTOR_RESPONSE_SCHEMA = tutorResponseSchema;

export const TUTOR_REQUEST_SCHEMA_JSON = JSON.stringify(
  TUTOR_REQUEST_SCHEMA,
  null,
  2,
);

export const TUTOR_RESPONSE_SCHEMA_JSON = JSON.stringify(
  TUTOR_RESPONSE_SCHEMA,
  null,
  2,
);
