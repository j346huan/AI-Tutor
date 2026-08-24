import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");

async function loadHarness() {
  const source = String.raw`
    import { galoisLesson } from "./app/lessons/galois.ts";
    import {
      buildCanonicalProof,
      isCurrentCourseItemReady,
      LocalCodexProvider,
    } from "./app/providers/index.ts";
    import { TUTOR_PROTOCOL_VERSION } from "./app/protocol/index.ts";

    const currentId = "field-extension";

    function state(written = [], completed = []) {
      const latex = buildCanonicalProof(galoisLesson, []);
      return {
        schemaVersion: 1,
        lessonId: galoisLesson.id,
        lessonContentVersion: galoisLesson.contentVersion,
        providerId: "local-codex",
        status: "active",
        mode: "orientation",
        activeStepId: galoisLesson.initialStepId,
        currentStatementId: currentId,
        completedStatementIds: completed,
        messages: [],
        proof: {
          fragmentIds: [],
          courseNoteStatementIds: written,
          canonicalLatex: latex,
          editorLatex: latex,
          previewLatex: latex,
          source: "tutor",
          revision: 0,
          feedback: "",
        },
        hintsUsed: 0,
        mistakesSeen: 0,
        control: {},
      };
    }

    function reply(request) {
      return {
        protocolVersion: TUTOR_PROTOCOL_VERSION,
        requestId: request.requestId,
        classification: {
          type: "classify_student_intent",
          intent: "mathematical_question",
          confidence: 1,
          rationale: "The student asked about the current item.",
        },
        commands: [{ type: "reply", markdown: "The base field supplies the scalars." }],
      };
    }

    export function readiness() {
      return {
        notReady: isCurrentCourseItemReady(galoisLesson, state()),
        ready: isCurrentCourseItemReady(galoisLesson, state([currentId])),
        completed: isCurrentCourseItemReady(
          galoisLesson,
          state([currentId], [currentId]),
        ),
      };
    }

    export async function preTransportGuard() {
      let transportCalls = 0;
      const provider = new LocalCodexProvider(async () => {
        transportCalls += 1;
        throw new Error("transport_should_not_run");
      });
      const result = await provider.dispatch(galoisLesson, state(), {
        type: "message",
        text: "Continue to the next course item.",
      });
      return {
        transportCalls,
        accepted: result.accepted,
        message: result.appendedMessages.at(-1)?.markdown,
      };
    }

    export async function stripsLegacyLearningActions() {
      let captured;
      const provider = new LocalCodexProvider(async (request) => {
        captured = request;
        return reply(request);
      });
      const restored = state([currentId]);
      restored.control.pendingChoiceSet = {
        id: "legacy-actions",
        kind: "learning_action",
        title: "Continue from here",
        prompt: "Choose an optional next step.",
        choices: [
          { id: "example", label: "Explore an example", learningAction: "explore_example" },
          { id: "check", label: "Check my understanding", learningAction: "check_understanding" },
          { id: "continue", label: "Continue", learningAction: "continue" },
        ],
      };
      const result = await provider.dispatch(galoisLesson, restored, {
        type: "message",
        text: "Which field supplies the scalars?",
      });
      return {
        accepted: result.accepted,
        pinnedChoices: captured?.pinnedChoices,
      };
    }
  `;

  const result = await build({
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: projectRoot,
      sourcefile: "course-item-readiness-harness.ts",
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

test("Continue is derived from course-item readiness", async () => {
  const harness = await loadHarness();
  assert.deepEqual(harness.readiness(), {
    notReady: false,
    ready: true,
    completed: false,
  });

  const guarded = await harness.preTransportGuard();
  assert.equal(guarded.transportCalls, 0);
  assert.equal(guarded.accepted, false);
  assert.match(guarded.message, /after.*written/i);
});

test("restored optional learning actions are not sent to Codex", async () => {
  const harness = await loadHarness();
  const result = await harness.stripsLegacyLearningActions();
  assert.equal(result.accepted, true);
  assert.deepEqual(result.pinnedChoices, []);
});
