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
    import { LocalCodexProvider } from "./app/providers/local-codex.ts";
    import { TUTOR_PROTOCOL_VERSION } from "./app/protocol/index.ts";

    const longBody =
      "A \\emph{field extension} $L/K$ consists of fields $K$ and $L$ such that $K$ is a subfield of $L$. Equivalently, $L$ contains $K$.";
    const shortBody = "A \\emph{field extension} $L/K$ is an inclusion of fields $K\\subseteq L$.";
    const studentLine = "A student-authored observation remains outside the generated entry.";

    function response(request, commands, intent = "edit_proof") {
      return {
        protocolVersion: TUTOR_PROTOCOL_VERSION,
        requestId: request.requestId,
        classification: {
          type: "classify_student_intent",
          intent,
          confidence: 1,
          rationale: "Deterministic revision fixture.",
        },
        commands,
      };
    }

    const write = (request) => response(request, [{
      type: "write_course_note",
      statementId: "field-extension",
      latex: longBody,
      reason: "The discussion established the definition.",
    }], "proof_step");

    const revise = (request, statementId = "field-extension") => response(request, [
      {
        type: "revise_course_note",
        statementId,
        latex: shortBody,
        reason: "The student asked for a one-sentence definition.",
      },
      { type: "reply", markdown: "The definition is now one sentence." },
    ]);

    export async function exerciseRevision(statementId = "field-extension") {
      let ordinaryTurn = 0;
      const provider = new LocalCodexProvider(async (request) => {
        if (request.studentInput.kind === "session_start") {
          return response(request, [
            { type: "reply", markdown: "How should a field extension be expressed as an inclusion?" },
          ], "session_start");
        }
        ordinaryTurn += 1;
        return ordinaryTurn === 1 ? write(request) : revise(request, statementId);
      });

      const started = await provider.createSession(galoisLesson);
      const written = await provider.dispatch(galoisLesson, started.state, {
        type: "message",
        text: "The smaller field is contained in the larger field.",
      });
      const studentSource = written.state.proof.editorLatex.replace(
        "\\end{document}",
        studentLine + "\n\n\\end{document}",
      );
      const rendered = await provider.dispatch(galoisLesson, written.state, {
        type: "render-proof",
        latex: studentSource,
      });
      const revised = await provider.dispatch(galoisLesson, rendered.state, {
        type: "message",
        text: "Shorten the field-extension definition to one precise sentence.",
      });

      return {
        accepted: revised.accepted,
        source: revised.state.proof.editorLatex,
        preview: revised.state.proof.previewLatex,
        reviewed: revised.state.proof.reviewedLatex,
        message: revised.state.messages.at(-1)?.markdown,
        error: revised.state.error,
        revisionBefore: rendered.state.proof.revision,
        revisionAfter: revised.state.proof.revision,
        writtenIds: revised.state.proof.courseNoteStatementIds,
        currentStatementId: revised.state.currentStatementId,
        longBody,
        shortBody,
        studentLine,
      };
    }

    export async function exercisePolicyMessage() {
      const rawBody = "RAW_MODEL_BODY_MUST_NOT_BE_SHOWN";
      const provider = new LocalCodexProvider(async (request) => response(request, [{
        type: "write_course_note",
        statementId: "field-extension",
        latex: rawBody,
        reason: "Invalid session-start mutation fixture.",
      }], "session_start"));
      return provider.createSession(galoisLesson);
    }

    export async function exerciseCourseNoteReplacement(kind) {
      let phase = 0;
      let replacement = "";
      const provider = new LocalCodexProvider(async (request) => {
        if (request.studentInput.kind === "session_start") {
          return response(request, [
            { type: "reply", markdown: "How should a field extension be expressed as an inclusion?" },
          ], "session_start");
        }
        phase += 1;
        if (phase === 1) return write(request);

        const current = request.currentProof.latex;
        if (kind === "complete") {
          replacement = current.replace(longBody, shortBody);
        } else if (kind === "body-only") {
          replacement = shortBody;
        } else if (kind === "dangerous") {
          replacement = current.replace("\\end{document}", "\\write16{unsafe}\\n\\end{document}");
        } else {
          replacement = current.replace("\\documentclass[11pt]{article}", "\\documentclass{book}");
        }
        return response(request, [
          {
            type: "replace_latex",
            latex: replacement,
            reason: "Review the submitted edit.",
          },
          { type: "reply", markdown: "The requested revision has been checked." },
        ], "request_proof_feedback");
      });

      const started = await provider.createSession(galoisLesson);
      const written = await provider.dispatch(galoisLesson, started.state, {
        type: "message",
        text: "The smaller field is contained in the larger field.",
      });
      const reviewed = await provider.dispatch(galoisLesson, written.state, {
        type: "request-proof-feedback",
        latex: written.state.proof.editorLatex,
      });
      return {
        accepted: reviewed.accepted,
        before: written.state.proof.editorLatex,
        source: reviewed.state.proof.editorLatex,
        replacement,
        error: reviewed.state.error,
        lastMessage: reviewed.state.messages.at(-1)?.markdown,
        rejectionMessage: reviewed.state.messages.findLast(
          (message) => message.kind === "error",
        )?.markdown,
      };
    }
  `;

  const result = await build({
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: projectRoot,
      sourcefile: "course-note-revision-provider-harness.ts",
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

test("ordinary chat revises only the current written course-note entry", async () => {
  const result = await (await loadHarness()).exerciseRevision();

  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.ok(result.source.includes(result.shortBody));
  assert.ok(!result.source.includes(result.longBody));
  assert.ok(result.source.includes(result.studentLine));
  assert.equal(result.source, result.preview);
  assert.equal(result.source, result.reviewed);
  assert.equal(result.revisionAfter, result.revisionBefore + 1);
  assert.deepEqual(result.writtenIds, ["field-extension"]);
  assert.equal(result.currentStatementId, "field-extension");
  assert.equal(result.message, "The definition is now one sentence.");
  assert.equal(result.error, undefined);
});

test("course-note revisions reject a wrong or unwritten topic", async () => {
  const result = await (await loadHarness()).exerciseRevision("algebraic-element");

  assert.equal(result.accepted, false);
  assert.ok(result.source.includes(result.longBody));
  assert.ok(!result.source.includes(result.shortBody));
  assert.match(result.error?.message ?? "", /current outline item/i);
});

test("response-policy failures expose the fixed validator reason without raw output", async () => {
  const result = await (await loadHarness()).exercisePolicyMessage();

  assert.equal(result.accepted, false);
  assert.equal(result.state.error?.code, "invalid_response");
  assert.match(result.state.error?.message ?? "", /session-start response/i);
  assert.doesNotMatch(result.state.error?.message ?? "", /RAW_MODEL_BODY_MUST_NOT_BE_SHOWN/);
  assert.doesNotMatch(result.state.error?.message ?? "", /safe tutor format/i);
});

test("course-note feedback accepts only a complete replacement with the trusted shell", async () => {
  const harness = await loadHarness();
  const complete = await harness.exerciseCourseNoteReplacement("complete");
  const bodyOnly = await harness.exerciseCourseNoteReplacement("body-only");
  const dangerous = await harness.exerciseCourseNoteReplacement("dangerous");
  const changedShell = await harness.exerciseCourseNoteReplacement("changed-shell");

  assert.equal(complete.accepted, true);
  assert.equal(complete.source, complete.replacement);
  for (const rejected of [bodyOnly, dangerous, changedShell]) {
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.source, rejected.before);
  }
  assert.match(bodyOnly.rejectionMessage ?? "", /complete document/i);
  assert.match(dangerous.rejectionMessage ?? "", /unsafe LaTeX command/i);
  assert.match(changedShell.rejectionMessage ?? "", /document shell/i);
});
