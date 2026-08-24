import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");

async function loadHarness() {
  const result = await build({
    stdin: {
      contents: String.raw`
        import {
          TUTOR_PROTOCOL_VERSION,
          TUTOR_RESPONSE_SCHEMA_JSON,
          buildTutorPrompt,
          parseTutorResponse,
          requestedCourseNoteSupplementKinds,
        } from "./app/protocol/index.ts";

        function request(text = "Let's put this into a lemma and a proof.", written = true) {
          return {
            protocolVersion: TUTOR_PROTOCOL_VERSION,
            requestId: "supplement-turn",
            profile: {
              name: "Course guide",
              personality: "Precise.",
              customInstructions: [],
            },
            studentBackground: "The student knows abstract algebra.",
            curriculum: [
              { kind: "definition", title: "Minimal polynomial" },
              { kind: "proposition", title: "Simple extensions" },
            ],
            theorem: {
              id: "minimal-polynomial",
              kind: "definition",
              title: "Minimal polynomial",
            },
            lessonPlan: {
              documentMode: "course-notes",
              currentStatementId: "minimal-polynomial",
              completedStatementIds: [],
              writtenStatementIds: written ? ["minimal-polynomial"] : [],
              roadmap: [
                {
                  statementId: "minimal-polynomial",
                  kind: "definition",
                  title: "Minimal polynomial",
                },
                {
                  statementId: "simple-extensions",
                  kind: "proposition",
                  title: "Simple extensions",
                },
              ],
            },
            mode: "learning",
            currentProof: {
              latex: "\\begin{document}Current notes.\\end{document}",
              revision: 2,
            },
            recentTranscript: [],
            pinnedChoices: [],
            studentInput: { kind: "message", text },
          };
        }

        function command(overrides = {}) {
          return {
            type: "insert_course_note_supplement",
            noteId: "supplement-minimal-polynomial-uniqueness",
            afterStatementId: "minimal-polynomial",
            kind: "lemma",
            title: "Uniqueness of the minimal polynomial",
            latex: "The monic irreducible polynomial that annihilates the element is unique.",
            proofLatex: "Two such polynomials are associates, and monicity makes them equal.",
            reason: "The student explicitly requested this established result as a lemma.",
            ...overrides,
          };
        }

        function response(commands) {
          return {
            protocolVersion: TUTOR_PROTOCOL_VERSION,
            requestId: "supplement-turn",
            classification: {
              type: "classify_student_intent",
              intent: "proposed_approach",
              confidence: 1,
              rationale: "The student requested a supplementary lemma.",
            },
            commands,
          };
        }

        export function exercise() {
          const validRequest = request();
          const missingProofCommand = command();
          delete missingProofCommand.proofLatex;
          const proofModeRequest = {
            ...validRequest,
            lessonPlan: {
              ...validRequest.lessonPlan,
              documentMode: "proof",
            },
          };
          return {
            valid: parseTutorResponse(response([command()]), validRequest),
            exactKinds: requestedCourseNoteSupplementKinds(validRequest.studentInput.text),
            makeKinds: requestedCourseNoteSupplementKinds("Make this proof into a lemma."),
            editProofIntoLemma: parseTutorResponse(
              response([command()]),
              request("Make this proof into a lemma."),
            ),
            mereMention: parseTutorResponse(
              response([command()]),
              request("Why is this lemma true?"),
            ),
            unwrittenCurrent: parseTutorResponse(
              response([command()]),
              request(undefined, false),
            ),
            wrongKind: parseTutorResponse(
              response([command({ kind: "proposition" })]),
              validRequest,
            ),
            wrongAnchor: parseTutorResponse(
              response([command({ afterStatementId: "simple-extensions" })]),
              validRequest,
            ),
            roadmapIdCollision: parseTutorResponse(
              response([command({ noteId: "minimal-polynomial" })]),
              validRequest,
            ),
            proofMode: parseTutorResponse(response([command()]), proofModeRequest),
            wrappedStatement: parseTutorResponse(
              response([command({ latex: "\\begin{lemma}Nested.\\end{lemma}" })]),
              validRequest,
            ),
            missingProof: parseTutorResponse(
              response([missingProofCommand]),
              validRequest,
            ),
            pairedAdvance: parseTutorResponse(
              response([
                command(),
                {
                  type: "advance_roadmap",
                  statementId: "simple-extensions",
                  reason: "Advance.",
                },
              ]),
              validRequest,
            ),
            pairedReplacement: parseTutorResponse(
              response([
                command(),
                {
                  type: "replace_latex_block",
                  target: "\\begin{lemma}Old.\\end{lemma}",
                  replacement: "\\begin{lemma}New.\\end{lemma}",
                  reason: "Replace it.",
                },
              ]),
              validRequest,
            ),
            oversizedTitle: parseTutorResponse(
              response([command({ title: "x".repeat(1001) })]),
              validRequest,
            ),
            schema: TUTOR_RESPONSE_SCHEMA_JSON,
            prompt: buildTutorPrompt(validRequest),
          };
        }
      `,
      loader: "ts",
      resolveDir: projectRoot,
      sourcefile: "course-note-supplement-protocol-harness.ts",
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

test("an explicit request can insert one supplementary result after the written topic", async () => {
  const result = (await loadHarness()).exercise();

  assert.equal(result.valid.ok, true);
  assert.deepEqual(result.exactKinds, ["lemma"]);
  assert.deepEqual(result.makeKinds, ["lemma"]);
  assert.equal(result.editProofIntoLemma.ok, true);
  assert.match(result.schema, /insert_course_note_supplement/);
  assert.match(result.prompt, /TURN SUPPLEMENT GUIDANCE/);
  assert.match(result.prompt, /do not alter or advance the roadmap/i);
});

test("supplement insertion fails closed outside its explicit current-topic scope", async () => {
  const result = (await loadHarness()).exercise();

  for (const invalid of [
    result.mereMention,
    result.unwrittenCurrent,
    result.wrongKind,
    result.wrongAnchor,
    result.roadmapIdCollision,
    result.proofMode,
    result.wrappedStatement,
    result.missingProof,
    result.pairedAdvance,
    result.pairedReplacement,
    result.oversizedTitle,
  ]) {
    assert.equal(invalid.ok, false);
  }
  assert.match(
    result.unwrittenCurrent.error.issues[0].message,
    /must already have a generated entry/i,
  );
  assert.match(result.wrongKind.error.issues[0].message, /kind must match/i);
  assert.match(result.wrongAnchor.error.issues[0].message, /current course topic/i);
});
