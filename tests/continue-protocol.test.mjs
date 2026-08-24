import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");

async function loadHarness() {
  const source = String.raw`
    import {
      TUTOR_PROTOCOL_VERSION,
      TUTOR_RESPONSE_SCHEMA_JSON,
      buildTutorPrompt,
      validateTutorTurnResponse,
    } from "./app/protocol/index.ts";

    function request({ written = [], text = "What is a field extension?" } = {}) {
      return {
        protocolVersion: TUTOR_PROTOCOL_VERSION,
        requestId: "continue-protocol",
        profile: {
          name: "AI-Galois",
          personality: "Concise and careful.",
          customInstructions: [],
        },
        studentBackground: "Group theory and linear algebra.",
        curriculum: [
          { kind: "definition", title: "Field extension" },
          { kind: "definition", title: "Algebraic element" },
        ],
        theorem: {
          id: "field-extension",
          kind: "definition",
          title: "Field extension",
        },
        lessonPlan: {
          documentMode: "course-notes",
          currentStatementId: "field-extension",
          completedStatementIds: [],
          writtenStatementIds: written,
          roadmap: [
            { statementId: "field-extension", kind: "definition", title: "Field extension" },
            { statementId: "algebraic-element", kind: "definition", title: "Algebraic element" },
          ],
        },
        mode: "learning",
        currentProof: { latex: "", revision: 0 },
        recentTranscript: [],
        pinnedChoices: [],
        studentInput: { kind: "message", text },
      };
    }

    function response(commands) {
      return {
        protocolVersion: TUTOR_PROTOCOL_VERSION,
        requestId: "continue-protocol",
        classification: {
          type: "classify_student_intent",
          intent: "mathematical_question",
          confidence: 1,
          rationale: "Deterministic fixture.",
        },
        commands,
      };
    }

    const writeDefinition = {
      type: "write_course_note",
      statementId: "field-extension",
      latex: "A \\emph{field extension} $L/K$ is an inclusion of fields $K\\subseteq L$.",
      reason: "The requested definition is established.",
    };
    const reply = {
      type: "reply",
      markdown: "A field extension $L/K$ is an inclusion of fields $K\\subseteq L$.",
    };
    const advance = {
      type: "advance_roadmap",
      statementId: "algebraic-element",
      reason: "The student chose to continue.",
    };

    export function exercise() {
      const direct = request();
      const readyContinue = request({
        written: ["field-extension"],
        text: "Continue to the next course item.",
      });
      const prematureContinue = request({
        text: "Continue to the next course item.",
      });
      const legacyActions = {
        type: "propose_learning_actions",
        prompt: "Choose an optional next step.",
        choices: [
          { id: "example", action: "explore_example", label: "Explore an example" },
          { id: "check", action: "check_understanding", label: "Check my understanding" },
          { id: "continue", action: "continue", label: "Continue" },
        ],
      };

      return {
        directDefinition: validateTutorTurnResponse(
          direct,
          response([writeDefinition, reply]),
        ),
        legacyActions: validateTutorTurnResponse(
          direct,
          response([legacyActions]),
        ),
        readyContinue: validateTutorTurnResponse(
          readyContinue,
          response([advance, { type: "reply", markdown: "Now consider polynomial relations over $K$." }]),
        ),
        continueWithoutAdvance: validateTutorTurnResponse(
          readyContinue,
          response([{ type: "reply", markdown: "Let us continue." }]),
        ),
        prematureContinue: validateTutorTurnResponse(
          prematureContinue,
          response([advance]),
        ),
        prompt: buildTutorPrompt(readyContinue),
        schema: TUTOR_RESPONSE_SCHEMA_JSON,
      };
    }
  `;

  const result = await build({
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: projectRoot,
      sourcefile: "continue-protocol-harness.ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    write: false,
    logLevel: "silent",
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}`);
}

test("only readiness-gated Continue remains in the tutor protocol", async () => {
  const { exercise } = await loadHarness();
  const result = exercise();

  assert.equal(result.directDefinition.ok, true);
  assert.equal(result.legacyActions.ok, false);
  assert.equal(result.readyContinue.ok, true);
  assert.equal(result.continueWithoutAdvance.ok, false);
  assert.match(result.continueWithoutAdvance.error.issues[0].message, /must advance/i);
  assert.equal(result.prematureContinue.ok, false);
  assert.match(result.prematureContinue.error.issues[0].message, /only after.*written/i);
  assert.match(result.prompt, /explicitly chose to continue/i);
  assert.doesNotMatch(
    result.prompt,
    /propose_learning_actions|explore_example|check_understanding|Choose an optional next step/,
  );
  assert.doesNotMatch(result.schema, /propose_learning_actions/);
});
