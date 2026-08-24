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
          buildTutorPrompt,
          definitionEmphasizesTerm,
          parseTutorResponse,
          validateCourseNotePart,
        } from "./app/protocol/index.ts";
        import { MathText, parseMathSegments } from "./app/components/MathText.tsx";

        function request(kind, title, written = false) {
          return {
            protocolVersion: TUTOR_PROTOCOL_VERSION,
            requestId: "definition-emphasis-turn",
            profile: {
              name: "Course guide",
              personality: "Precise.",
              customInstructions: [],
            },
            studentBackground: "The student knows abstract algebra.",
            curriculum: [{ kind, title }],
            theorem: { id: "current-item", kind, title },
            lessonPlan: {
              documentMode: "course-notes",
              currentStatementId: "current-item",
              completedStatementIds: [],
              writtenStatementIds: written ? ["current-item"] : [],
              roadmap: [{ statementId: "current-item", kind, title }],
            },
            mode: "learning",
            currentProof: {
              latex: "\\begin{document}\\end{document}",
              revision: 0,
            },
            recentTranscript: [],
            pinnedChoices: [],
            studentInput: {
              kind: "message",
              text: written
                ? "Please revise the current definition."
                : "We have established this item.",
            },
          };
        }

        function response(command) {
          return {
            protocolVersion: TUTOR_PROTOCOL_VERSION,
            requestId: "definition-emphasis-turn",
            classification: {
              type: "classify_student_intent",
              intent: "proof_step",
              confidence: 1,
              rationale: "The item has been established.",
            },
            commands: [command],
          };
        }

        function noteCommand(type, latex, proofLatex) {
          return {
            type,
            statementId: "current-item",
            latex,
            ...(proofLatex ? { proofLatex } : {}),
            reason: "The discussion established the entry.",
          };
        }

        function renderedEmphasis(text) {
          const tree = MathText({ children: text });
          const emphasis = tree.props.children.find(
            (child) => child && child.type === "em",
          );
          return emphasis
            ? {
                type: emphasis.type,
                children: emphasis.props.children.map((child) => ({
                  type:
                    typeof child.type === "function"
                      ? child.type.name
                      : child.type,
                  ...(child.props.source !== undefined
                    ? { source: child.props.source }
                    : {}),
                  ...(child.props.value !== undefined
                    ? { value: child.props.value }
                    : {}),
                })),
              }
            : null;
        }

        export function exercise() {
          const definitionRequest = request("definition", "Field extension");
          const reviseRequest = request("definition", "Field extension", true);
          const propositionRequest = request("proposition", "Kernel calculation");
          const mathTitle = "$K$-embedding";
          const mathDefinition = "A \\emph{$K$-embedding} is a field homomorphism fixing $K$.";
          return {
            validWrite: parseTutorResponse(
              response(noteCommand(
                "write_course_note",
                "A \\emph{field extension} $L/K$ is an inclusion of fields $K\\subseteq L$.",
              )),
              definitionRequest,
            ),
            plainWrite: parseTutorResponse(
              response(noteCommand(
                "write_course_note",
                "A field extension $L/K$ is an inclusion of fields $K\\subseteq L$.",
              )),
              definitionRequest,
            ),
            wrongTerm: parseTutorResponse(
              response(noteCommand(
                "write_course_note",
                "A field \\emph{extension} $L/K$ is an inclusion of fields.",
              )),
              definitionRequest,
            ),
            validRevise: parseTutorResponse(
              response(noteCommand(
                "revise_course_note",
                "A \\emph{field extension} $L/K$ consists of fields with $K\\subseteq L$.",
              )),
              reviseRequest,
            ),
            propositionUnchanged: parseTutorResponse(
              response(noteCommand(
                "write_course_note",
                "The evaluation kernel is principal.",
                "Apply polynomial division.",
              )),
              propositionRequest,
            ),
            malformed: validateCourseNotePart("A \\emph field extension is ..."),
            exactMathTerm: definitionEmphasizesTerm(mathDefinition, mathTitle),
            mathSegments: parseMathSegments(mathDefinition),
            rendered: renderedEmphasis(
              "A \\emph{field extension} is an inclusion.",
            ),
            renderedMathTerm: renderedEmphasis(mathDefinition),
            prompt: buildTutorPrompt(definitionRequest),
          };
        }
      `,
      loader: "tsx",
      resolveDir: projectRoot,
      sourcefile: "definition-emphasis-harness.tsx",
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

test("generated definitions require emphasis around the exact defined term", async () => {
  const result = (await loadHarness()).exercise();

  assert.equal(result.validWrite.ok, true);
  assert.equal(result.validRevise.ok, true);
  assert.equal(result.plainWrite.ok, false);
  assert.equal(result.wrongTerm.ok, false);
  assert.match(
    result.plainWrite.error.issues[0].message,
    /exact term being defined.*\\emph/i,
  );
  assert.equal(result.propositionUnchanged.ok, true);
  assert.match(result.malformed, /\\emph command must wrap/i);
  assert.equal(result.exactMathTerm, true);
});

test("course-note emphasis renders as semantic italics, including around math", async () => {
  const result = (await loadHarness()).exercise();

  assert.equal(result.rendered.type, "em");
  assert.deepEqual(result.rendered.children, [
    { type: "SafeText", value: "field extension" },
  ]);
  assert.equal(result.mathSegments[1].kind, "emphasis");
  assert.deepEqual(
    result.mathSegments[1].children.map((segment) => segment.kind),
    ["math", "text"],
  );
  assert.equal(result.renderedMathTerm.type, "em");
  assert.deepEqual(result.renderedMathTerm.children, [
    { type: "SafeKatex", source: "K" },
    { type: "SafeText", value: "-embedding" },
  ]);
});

test("the Personal Codex prompt requires definition-term emphasis", async () => {
  const result = (await loadHarness()).exercise();

  assert.match(result.prompt, /every definition latex body/i);
  assert.match(result.prompt, /exact roadmap title term in \\emph/i);
  assert.match(result.prompt, /required for both write_course_note and revise_course_note/i);
});
