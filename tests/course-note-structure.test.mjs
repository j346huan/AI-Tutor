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
          buildCourseNoteEntry,
          replaceCourseNoteEntry,
          validateCourseNotePart,
        } from "./app/protocol/course-note-latex.ts";
        import {
          TUTOR_PROTOCOL_VERSION,
          parseTutorResponse,
        } from "./app/protocol/index.ts";
        import { parseDocumentBlocks } from "./app/components/ProofDocument.tsx";
        export {
          buildCourseNoteEntry,
          replaceCourseNoteEntry,
          validateCourseNotePart,
          parseDocumentBlocks,
        };

        function request(kind) {
          return {
            protocolVersion: TUTOR_PROTOCOL_VERSION,
            requestId: "structured-note-turn",
            profile: {
              name: "Course guide",
              personality: "Precise.",
              customInstructions: [],
            },
            studentBackground: "The student knows abstract algebra.",
            curriculum: [{ kind, title: "Current item" }],
            theorem: { id: "current-item", kind, title: "Current item" },
            lessonPlan: {
              documentMode: "course-notes",
              currentStatementId: "current-item",
              completedStatementIds: [],
              writtenStatementIds: [],
              roadmap: [{ statementId: "current-item", kind, title: "Current item" }],
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
              text: "We have established this result.",
            },
          };
        }

        function response(command) {
          return {
            protocolVersion: TUTOR_PROTOCOL_VERSION,
            requestId: "structured-note-turn",
            classification: {
              type: "classify_student_intent",
              intent: "proposed_approach",
              confidence: 1,
              rationale: "The current result has been established.",
            },
            commands: [command],
          };
        }

        export function validateStructuredCommands() {
          const base = {
            type: "write_course_note",
            statementId: "current-item",
            latex: "The precise statement.",
            reason: "The discussion established it.",
          };
          return {
            proposition: parseTutorResponse(
              response({ ...base, proofLatex: "The proof argument." }),
              request("proposition"),
            ),
            propositionWithoutProof: parseTutorResponse(
              response(base),
              request("proposition"),
            ),
            nestedProof: parseTutorResponse(
              response({
                ...base,
                latex: "The statement.\\n\\begin{proof}The proof.\\end{proof}",
                proofLatex: "The proof argument.",
              }),
              request("proposition"),
            ),
            definition: parseTutorResponse(
              response({
                ...base,
                latex: "A \\emph{Current item} is precisely specified.",
              }),
              request("definition"),
            ),
            definitionWithProof: parseTutorResponse(
              response({
                ...base,
                latex: "A \\emph{Current item} is precisely specified.",
                proofLatex: "Not a definition body.",
              }),
              request("definition"),
            ),
          };
        }
      `,
      loader: "ts",
      resolveDir: projectRoot,
      sourcefile: "course-note-structure-harness.ts",
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

test("theorem-like course notes separate the statement from its proof", async () => {
  const { buildCourseNoteEntry, parseDocumentBlocks } = await loadHarness();
  const item = {
    kind: "proposition",
    title: "Simple extensions as polynomial quotients",
  };
  const statement = String.raw`Evaluation at $\alpha$ induces $K[x]/(m_{\alpha,K})\cong K(\alpha)$.`;
  const proof = String.raw`The evaluation map is surjective, its kernel is $(m_{\alpha,K})$, and the first isomorphism theorem applies.`;
  const source = `\\begin{document}\n${buildCourseNoteEntry(item, statement, proof)}\n\\end{document}`;

  assert.match(
    source,
    /\\end\{proposition\}\n\n\\begin\{proof\}/,
  );
  assert.ok(source.indexOf(statement) < source.indexOf("\\end{proposition}"));
  assert.ok(source.indexOf(proof) > source.indexOf("\\begin{proof}"));

  const blocks = parseDocumentBlocks(source, true);
  assert.deepEqual(
    blocks.map(({ kind, text }) => ({ kind, text })),
    [
      {
        kind: "statement",
        text: "Proposition (Simple extensions as polynomial quotients)",
      },
      { kind: "content", text: statement },
      { kind: "proof", text: "Proof" },
      { kind: "content", text: proof },
      { kind: "qed", text: "\\square" },
    ],
  );
});

test("the tutor protocol requires structured proof fields for theorem-like entries", async () => {
  const { validateStructuredCommands } = await loadHarness();
  const result = validateStructuredCommands();

  assert.equal(result.proposition.ok, true);
  assert.equal(result.propositionWithoutProof.ok, false);
  assert.match(
    result.propositionWithoutProof.error.issues[0].message,
    /separate its statement from its proof/i,
  );
  assert.equal(result.nestedProof.ok, false);
  assert.equal(result.definition.ok, true);
  assert.equal(result.definitionWithProof.ok, false);
  assert.match(
    result.definitionWithProof.error.issues[0].message,
    /definition course-note entry must have one body/i,
  );
});

test("definitions stay single-bodied and legacy wrapped proofs are normalized", async () => {
  const { buildCourseNoteEntry, validateCourseNotePart } = await loadHarness();
  const definition = buildCourseNoteEntry(
    { kind: "definition", title: "Field extension" },
    String.raw`A field extension $L/K$ is an inclusion of fields $K\subseteq L$.`,
  );
  assert.match(definition, /\\begin\{definition\}\[field extension\]/);
  assert.doesNotMatch(definition, /\\begin\{proof\}/);

  const legacy = buildCourseNoteEntry(
    { kind: "lemma", title: "Kernel lemma" },
    String.raw`The kernel is $(m_\alpha)$.\n\n\begin{proof}\nUse minimality.\n\end{proof}`,
  );
  assert.match(legacy, /The kernel is[\s\S]*\\end\{lemma\}\n\n\\begin\{proof\}/);
  assert.equal(validateCourseNotePart(String.raw`The kernel is $(m_\alpha)$.`), null);
  assert.match(
    validateCourseNotePart(String.raw`\begin{proof}Nested.\end{proof}`),
    /cannot contain a proof wrapper/i,
  );
});

test("legacy capitalized definition titles remain revisable", async () => {
  const { replaceCourseNoteEntry } = await loadHarness();
  const item = { kind: "definition", title: "Field extension" };
  const legacyDocument = String.raw`\begin{document}
\begin{definition}[Field extension]
Old definition.
\end{definition}
\end{document}`;
  const revised = replaceCourseNoteEntry(
    legacyDocument,
    item,
    String.raw`A \emph{field extension} is an inclusion of fields.`,
  );

  assert.ok(revised);
  assert.match(revised, /\\begin\{definition\}\[field extension\]/);
  assert.doesNotMatch(revised, /\\begin\{definition\}\[Field extension\]/);
});

test("revising a theorem-like entry replaces its adjacent proof and preserves neighbors", async () => {
  const { buildCourseNoteEntry, replaceCourseNoteEntry } = await loadHarness();
  const item = { kind: "lemma", title: "Kernel lemma" };
  const oldEntry = buildCourseNoteEntry(item, "Old statement.", "Old proof.");
  const document = [
    "\\begin{document}",
    "Before.",
    oldEntry,
    "After.",
    "\\end{document}",
  ].join("\n\n");
  const revised = replaceCourseNoteEntry(
    document,
    item,
    "New statement.",
    "New proof.",
  );

  assert.ok(revised);
  assert.match(revised, /Before\./);
  assert.match(revised, /After\./);
  assert.match(revised, /New statement\./);
  assert.match(revised, /New proof\./);
  assert.doesNotMatch(revised, /Old statement|Old proof/);
  const statementOnly = document.replace(
    /\n\n\\begin\{proof\}[\s\S]*?\\end\{proof\}/,
    "",
  );
  const proofAdded = replaceCourseNoteEntry(
    statementOnly,
    item,
    "New statement.",
    "New proof.",
  );
  assert.match(proofAdded, /\\end\{lemma\}\n\n\\begin\{proof\}/);
  assert.match(proofAdded, /New proof\./);
  assert.equal(
    replaceCourseNoteEntry(
      document,
      { kind: "definition", title: "Kernel lemma" },
      "Definition body.",
      "Definitions do not have proofs.",
    ),
    null,
  );
});

test("a legacy proposition with proof reasoning in its body is normalized on revision", async () => {
  const { replaceCourseNoteEntry, parseDocumentBlocks } = await loadHarness();
  const item = {
    kind: "proposition",
    title: "Simple extensions as polynomial quotients",
  };
  const malformed = String.raw`\begin{document}
\begin{proposition}[Simple extensions as polynomial quotients]
Let $\alpha$ be algebraic over $K$, with minimal polynomial $m_{\alpha,K}$. The evaluation homomorphism is surjective because $K[\alpha]=K(\alpha)$, and its kernel is $(m_{\alpha,K})$. Hence the first isomorphism theorem gives the result.
\end{proposition}
\end{document}`;
  const statement = String.raw`Evaluation at $\alpha$ induces an isomorphism $K[x]/(m_{\alpha,K})\cong K(\alpha)$.`;
  const proof = String.raw`The evaluation homomorphism is surjective because $K[\alpha]=K(\alpha)$, and its kernel is $(m_{\alpha,K})$. The first isomorphism theorem gives the claimed isomorphism.`;
  const normalized = replaceCourseNoteEntry(
    malformed,
    item,
    statement,
    proof,
  );

  assert.ok(normalized);
  assert.match(
    normalized,
    /\\end\{proposition\}\n\n\\begin\{proof\}/,
  );
  const blocks = parseDocumentBlocks(normalized, true);
  assert.deepEqual(
    blocks.map(({ kind }) => kind),
    ["statement", "content", "proof", "content", "qed"],
  );
  assert.equal(blocks[1].text, statement);
  assert.equal(blocks[3].text, proof);
});
