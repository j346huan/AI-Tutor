import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");

async function loadParser() {
  const result = await build({
    stdin: {
      contents: String.raw`
        import { parseDocumentBlocks } from "./app/components/ProofDocument.tsx";
        export { parseDocumentBlocks };
      `,
      loader: "ts",
      resolveDir: projectRoot,
      sourcefile: "document-parser-harness.ts",
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

test("parses course-note sections and mathematical environments", async () => {
  const { parseDocumentBlocks } = await loadParser();
  const source = String.raw`
\documentclass{article}
\begin{document}
\section{Field extensions}
\begin{definition}[Degree]
The degree of $L/K$ is $[L:K]=\dim_K L$.
\end{definition}
\subsection{Tower law}
\begin{lemma}
If $K\subseteq L\subseteq M$, then $[M:K]=[M:L][L:K]$.
\end{lemma}
\begin{proof}
Choose compatible bases.
\end{proof}
\end{document}`;

  const blocks = parseDocumentBlocks(source, true);
  assert.deepEqual(
    blocks.map(({ kind, text, environment }) => ({ kind, text, environment })),
    [
      { kind: "section", text: "Field extensions", environment: undefined },
      {
        kind: "statement",
        text: "Definition (degree)",
        environment: "definition",
      },
      {
        kind: "content",
        text: "The degree of $L/K$ is $[L:K]=\\dim_K L$.",
        environment: undefined,
      },
      { kind: "subsection", text: "Tower law", environment: undefined },
      { kind: "statement", text: "Lemma", environment: "lemma" },
      {
        kind: "content",
        text: "If $K\\subseteq L\\subseteq M$, then $[M:K]=[M:L][L:K]$.",
        environment: undefined,
      },
      { kind: "proof", text: "Proof", environment: undefined },
      { kind: "content", text: "Choose compatible bases.", environment: undefined },
      { kind: "qed", text: "\\square", environment: undefined },
    ],
  );
});

test("preserves the unfinished-proof behavior used by the Euclid lesson", async () => {
  const { parseDocumentBlocks } = await loadParser();
  const source = String.raw`\begin{document}
\begin{theorem}
There are infinitely many primes.
\end{theorem}
\begin{proof}
Assume otherwise.
\end{proof}
\end{document}`;

  const blocks = parseDocumentBlocks(source, false);
  assert.equal(blocks.some((block) => block.kind === "qed"), false);
  assert.deepEqual(
    blocks.filter((block) => block.kind === "statement")[0],
    { kind: "statement", text: "Theorem", environment: "theorem" },
  );
});
