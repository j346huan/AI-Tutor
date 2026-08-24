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
      LocalCodexProvider,
      buildInitializationPromptPreview,
    } from "./app/providers/local-codex.ts";
    import {
      TUTOR_PROTOCOL_VERSION,
      TUTOR_RESPONSE_SCHEMA_JSON,
    } from "./app/protocol/index.ts";

    const definition = "\\begin{definition}[Field extension]\nA field extension $L/K$ is an inclusion of fields $K\\subseteq L$.\n\\end{definition}";
    const lemma = "\\begin{lemma}\nThe minimal polynomial of $\\alpha$ is unique. \n\\end{lemma}";
    const proof = "\\begin{proof}\nSuppose monic irreducible polynomials $p,q\\in K[x]$ both vanish at $\\alpha$. If $p$ and $q$ were coprime, Bézout's identity would give $a,b\\in K[x]$ such that $ap+bq=1$; evaluating at $\\alpha$ would yield $0=1$, a contradiction. Hence $p$ and $q$ have a nonconstant common divisor. Since each is irreducible, they are associates, so $p=cq$ for some $c\\in K^{\\times}$. Their monicity forces $c=1$, and therefore $p=q$.\n\\end{proof}";
    const preciseProof = "\\begin{proof}\nLet $p,q\\in K[x]$ be monic irreducible polynomials satisfying $p(\\alpha)=q(\\alpha)=0$. If $\\gcd(p,q)=1$, Bézout's identity gives $a,b\\in K[x]$ with $ap+bq=1$; evaluation at $\\alpha$ gives $0=1$. Thus $\\gcd(p,q)$ is nonconstant. Irreducibility makes $p$ and $q$ associates, and monicity then gives $p=q$.\n\\end{proof}";

    function response(request, commands, intent = "edit_proof") {
      return {
        protocolVersion: TUTOR_PROTOCOL_VERSION,
        requestId: request.requestId,
        classification: {
          type: "classify_student_intent",
          intent,
          confidence: 1,
          rationale: "Deterministic exact-block edit fixture.",
        },
        commands,
      };
    }

    function blockCommand(target = proof, replacement = preciseProof) {
      return {
        type: "replace_latex_block",
        target,
        replacement,
        reason: "The student explicitly requested a more precise proof.",
      };
    }

    function insertBlocks(source, duplicateProof = false) {
      const blocks = definition + "\n" + lemma + "\n" + proof + (duplicateProof ? "\n" + proof : "");
      return source.replace("\\end{document}", blocks + "\n\\end{document}");
    }

    export function contract() {
      const preview = buildInitializationPromptPreview(galoisLesson);
      return {
        prompt: preview.prompt,
        schema: TUTOR_RESPONSE_SCHEMA_JSON,
      };
    }

    export async function exercise(kind = "valid", feedback = false) {
      const provider = new LocalCodexProvider(async (request) => {
        if (request.studentInput.kind === "session_start") {
          return response(
            request,
            [{ type: "reply", markdown: "We can begin with field extensions." }],
            "session_start",
          );
        }
        if (kind === "wrong-environment") {
          return response(request, [
            blockCommand(lemma, lemma.replace("unique", "uniquely determined")),
            { type: "reply", markdown: "I revised the block." },
          ]);
        }
        if (kind === "wrong-course-note") {
          return response(request, [
            {
              type: "revise_course_note",
              statementId: request.lessonPlan.currentStatementId,
              latex: "A field extension is an inclusion of fields.",
              reason: "Incorrectly targeting the outline definition.",
            },
            { type: "reply", markdown: "I revised the note." },
          ]);
        }
        if (kind === "reply-only") {
          return response(request, [
            { type: "reply", markdown: "The proof could state the hypotheses more precisely." },
          ]);
        }
        if (kind === "malformed") {
          return response(request, [
            blockCommand(
              proof,
              "\\begin{proof}\nAn unmatched expression $\\frac{a}{b$.\n\\end{proof}",
            ),
            { type: "reply", markdown: "I revised the proof." },
          ]);
        }
        if (kind === "unsafe") {
          return response(request, [
            blockCommand(
              proof,
              "\\begin{proof}\n\\write16{unsafe}\n\\end{proof}",
            ),
            { type: "reply", markdown: "I revised the proof." },
          ]);
        }
        return response(request, [
          blockCommand(),
          { type: "reply", markdown: "I made the hypotheses and gcd step explicit." },
        ], feedback ? "request_proof_feedback" : "edit_proof");
      });

      const started = await provider.createSession(galoisLesson);
      const source = insertBlocks(started.state.proof.editorLatex, kind === "duplicate");
      const rendered = await provider.dispatch(galoisLesson, started.state, {
        type: "render-proof",
        latex: source,
      });
      const result = feedback
        ? await provider.dispatch(galoisLesson, rendered.state, {
            type: "request-proof-feedback",
            latex: source,
          })
        : await provider.dispatch(galoisLesson, rendered.state, {
            type: "message",
            text: "modify my proof to make it more precise",
          });
      return {
        accepted: result.accepted,
        before: source,
        after: result.state.proof.editorLatex,
        preview: result.state.proof.previewLatex,
        reviewed: result.state.proof.reviewedLatex,
        revisionBefore: rendered.state.proof.revision,
        revisionAfter: result.state.proof.revision,
        error: result.state.error?.message,
        lastMessage: result.state.messages.at(-1)?.markdown,
        definition,
        lemma,
        proof,
        preciseProof,
      };
    }
  `;

  const result = await build({
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: projectRoot,
      sourcefile: "latex-block-replacement-harness.ts",
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

test("chat can replace exactly one student-authored proof without touching its lemma", async () => {
  const result = await (await loadHarness()).exercise();

  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.ok(result.after.includes(result.definition));
  assert.ok(result.after.includes(result.lemma));
  assert.ok(result.after.includes(result.preciseProof));
  assert.ok(!result.after.includes(result.proof));
  assert.equal(
    result.after,
    result.before.replace(result.proof, result.preciseProof),
  );
  assert.equal(result.preview, result.after);
  assert.equal(result.reviewed, result.after);
  assert.equal(result.revisionAfter, result.revisionBefore + 1);
  assert.equal(result.lastMessage, "I made the hypotheses and gcd step explicit.");
});

test("a named proof request cannot revise a lemma or the current outline definition", async () => {
  const harness = await loadHarness();
  for (const kind of ["wrong-environment", "wrong-course-note", "reply-only"]) {
    const result = await harness.exercise(kind);
    assert.equal(result.accepted, false, `${kind}: ${JSON.stringify(result)}`);
    assert.equal(result.after, result.before);
    assert.match(result.error ?? "", /proof|matching environment/i);
  }
});

test("exact-block edits fail closed for duplicate, malformed, and unsafe replacements", async () => {
  const harness = await loadHarness();
  for (const kind of ["duplicate", "malformed", "unsafe"]) {
    const result = await harness.exercise(kind);
    assert.equal(result.accepted, false, `${kind}: ${JSON.stringify(result)}`);
    assert.equal(result.after, result.before);
  }
});

test("document feedback may apply the same isolated block edit", async () => {
  const result = await (await loadHarness()).exercise("valid", true);

  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.after, result.before.replace(result.proof, result.preciseProof));
});

test("the wire schema and prompt describe safe exact block replacement", async () => {
  const result = (await loadHarness()).contract();

  assert.match(result.schema, /replace_latex_block/);
  assert.match(result.schema, /"target"/);
  assert.match(result.schema, /"replacement"/);
  assert.match(result.prompt, /Copy target exactly from currentProof\.latex/i);
  assert.match(result.prompt, /"my proof" must target a proof environment/i);
  assert.match(result.prompt, /Preserve every character outside target/i);
});
