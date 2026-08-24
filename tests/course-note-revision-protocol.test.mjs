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
    import { buildInitializationPromptPreview } from "./app/providers/local-codex.ts";
    import {
      TUTOR_PROTOCOL_VERSION,
      TUTOR_RESPONSE_SCHEMA_JSON,
      buildCourseNoteEntry,
      parseTutorResponse,
      replaceCourseNoteEntry,
    } from "./app/protocol/index.ts";

    const preview = buildInitializationPromptPreview(galoisLesson);
    const baseRequest = {
      ...preview.request,
      requestId: "revise-course-note-turn",
      studentInput: {
        kind: "message",
        text: "Shorten the current definition.",
      },
    };
    const writtenRequest = {
      ...baseRequest,
      lessonPlan: {
        ...baseRequest.lessonPlan,
        writtenStatementIds: [baseRequest.lessonPlan.currentStatementId],
      },
    };

    function response(commands, intent = "edit_proof") {
      return {
        protocolVersion: TUTOR_PROTOCOL_VERSION,
        requestId: baseRequest.requestId,
        classification: {
          type: "classify_student_intent",
          intent,
          confidence: 1,
          rationale: "The student requested a revision to the current note.",
        },
        commands,
      };
    }

    const revisedBody = "A \\emph{field extension} $L/K$ is an inclusion of fields $K\\subseteq L$.";
    const revise = (statementId = baseRequest.lessonPlan.currentStatementId, latex = revisedBody) => ({
      type: "revise_course_note",
      statementId,
      latex,
      reason: "The student requested a shorter definition.",
    });
    const write = () => ({
      type: "write_course_note",
      statementId: baseRequest.lessonPlan.currentStatementId,
      latex: revisedBody,
      reason: "The conversation established the definition.",
    });

    export function exercise() {
      const feedbackRequest = {
        ...writtenRequest,
        studentInput: {
          kind: "proof_feedback_request",
          text: "Review this edit.",
          proofEdit: {
            previousLatex: "Previous source",
            changed: "The current definition was shortened.",
            comments: [],
          },
        },
      };
      const futureId = writtenRequest.lessonPlan.roadmap[1].statementId;
      const proofRequest = {
        ...baseRequest,
        lessonPlan: {
          ...baseRequest.lessonPlan,
          documentMode: "proof",
          writtenStatementIds: [],
        },
      };
      const sessionRequest = {
        ...writtenRequest,
        studentInput: { kind: "session_start", text: "" },
      };

      const item = { kind: "definition", title: "Field extension" };
      const oldBody = "A field extension is a relationship between two fields.";
      const entry = buildCourseNoteEntry(item, oldBody);
      const before = "\\begin{document}\nA student note stays here.\n\n";
      const after = "\n\nAnother student note stays here.\n\\end{document}";
      const document = before + entry + after;
      const replaced = replaceCourseNoteEntry(document, item, revisedBody);
      const duplicate = document.replace("\\end{document}", entry + "\n\\end{document}");
      const nested = document.replace(
        oldBody,
        "\\begin{definition}[Nested]\nNested body.\n\\end{definition}",
      );

      return {
        validChatRevision: parseTutorResponse(response([revise()]), writtenRequest),
        validFeedbackRevision: parseTutorResponse(
          response([revise()], "request_proof_feedback"),
          feedbackRequest,
        ),
        missingEntry: parseTutorResponse(response([revise()]), baseRequest),
        wrongItem: parseTutorResponse(response([revise(futureId)]), writtenRequest),
        sessionRevision: parseTutorResponse(
          response([revise()], "session_start"),
          sessionRequest,
        ),
        mixedWriteRevision: parseTutorResponse(
          response([write(), revise()]),
          writtenRequest,
        ),
        proofModeRevision: parseTutorResponse(response([revise()]), proofRequest),
        unsafeRevision: parseTutorResponse(
          response([revise(undefined, "\\input{elsewhere}")]),
          writtenRequest,
        ),
        schema: TUTOR_RESPONSE_SCHEMA_JSON,
        prompt: preview.prompt,
        document,
        replaced,
        oldBody,
        revisedBody,
        missingReplacement: replaceCourseNoteEntry(before + after, item, revisedBody),
        ambiguousReplacement: replaceCourseNoteEntry(duplicate, item, revisedBody),
        nestedReplacement: replaceCourseNoteEntry(nested, item, revisedBody),
        unsafeReplacement: replaceCourseNoteEntry(document, item, "\\input{elsewhere}"),
      };
    }
  `;

  const result = await build({
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: projectRoot,
      sourcefile: "course-note-revision-protocol-harness.ts",
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

test("course-note revisions are limited to the current existing entry", async () => {
  const result = (await loadHarness()).exercise();

  assert.equal(result.validChatRevision.ok, true);
  assert.equal(result.validFeedbackRevision.ok, true);
  assert.equal(result.missingEntry.ok, false);
  assert.equal(result.wrongItem.ok, false);
  assert.equal(result.sessionRevision.ok, false);
  assert.equal(result.mixedWriteRevision.ok, false);
  assert.equal(result.proofModeRevision.ok, false);
  assert.equal(result.unsafeRevision.ok, false);
  assert.match(result.schema, /revise_course_note/);
  assert.match(result.prompt, /revision request made in chat or through document feedback/i);
  assert.match(result.prompt, /must not include structural wrappers/i);
});

test("course-note replacement preserves unrelated source and fails closed", async () => {
  const result = (await loadHarness()).exercise();

  assert.ok(result.replaced);
  assert.ok(result.replaced.includes(result.revisedBody));
  assert.ok(!result.replaced.includes(result.oldBody));
  assert.match(result.replaced, /A student note stays here/);
  assert.match(result.replaced, /Another student note stays here/);
  assert.equal(result.missingReplacement, null);
  assert.equal(result.ambiguousReplacement, null);
  assert.equal(result.nestedReplacement, null);
  assert.equal(result.unsafeReplacement, null);
});
