import assert from "node:assert/strict";
import { build } from "esbuild";
import katex from "katex";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");

async function loadParser() {
  const result = await build({
    stdin: {
      contents: String.raw`
        import {
          hasDisplayMath,
          normalizeMathSource,
          parseMathSegments,
        } from "./app/components/MathText.tsx";
        export { hasDisplayMath, normalizeMathSource, parseMathSegments };
      `,
      loader: "ts",
      resolveDir: projectRoot,
      sourcefile: "math-text-parser-harness.ts",
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

test("parses Codex inline parenthesis delimiters without exposing delimiters", async () => {
  const { parseMathSegments } = await loadParser();
  const sentence = String.raw`Let \(N=p_1p_2\cdots p_n+1.\)`;

  const segments = parseMathSegments(sentence);
  assert.deepEqual(segments, [
    { kind: "text", value: "Let " },
    {
      kind: "math",
      value: String.raw`N=p_1p_2\cdots p_n+1.`,
      display: false,
    },
  ]);
  assert.doesNotThrow(() =>
    katex.renderToString(segments[1].value, {
      displayMode: false,
      output: "htmlAndMathml",
      throwOnError: true,
      trust: false,
    }),
  );
});

test("continues to parse dollar and bracket delimiters", async () => {
  const { parseMathSegments } = await loadParser();
  const sentence = String.raw`Inline $p_i\nmid N$ and display \[N>1.\]`;

  assert.deepEqual(parseMathSegments(sentence), [
    { kind: "text", value: "Inline " },
    { kind: "math", value: String.raw`p_i\nmid N`, display: false },
    { kind: "text", value: " and display " },
    { kind: "math", value: "N>1.", display: true },
  ]);
});

test("shows the composer preview only for complete display-math delimiters", async () => {
  const { hasDisplayMath } = await loadParser();

  assert.equal(hasDisplayMath("An ordinary message."), false);
  assert.equal(hasDisplayMath(String.raw`Inline $x^2+1$ only.`), false);
  assert.equal(hasDisplayMath(String.raw`Inline \(x^2+1\) only.`), false);
  assert.equal(hasDisplayMath(String.raw`Unfinished $$x^2+1`), false);
  assert.equal(hasDisplayMath(String.raw`Unfinished \[x^2+1`), false);
  assert.equal(hasDisplayMath(String.raw`Display $$x^2+1$$.`), true);
  assert.equal(hasDisplayMath(String.raw`Display \[x^2+1\].`), true);
});

test("leaves malformed or escaped slash delimiters as safe text", async () => {
  const { parseMathSegments } = await loadParser();
  const malformed = [
    String.raw`Unclosed \(N+1.`,
    String.raw`Unclosed \[N+1.`,
    String.raw`Mismatched \(N+1\].`,
    String.raw`A stray \) remains text.`,
    String.raw`Escaped \\(not math\\).`,
  ];

  for (const value of malformed) {
    assert.deepEqual(parseMathSegments(value), [{ kind: "text", value }]);
  }
});

test("repairs a control-character-corrupted alpha command inside math", async () => {
  const { parseMathSegments } = await loadParser();
  const sentence = `The element $\u0007lpha$ lies in the extension.`;

  const segments = parseMathSegments(sentence);
  assert.deepEqual(segments, [
    { kind: "text", value: "The element " },
    { kind: "math", value: String.raw`\alpha`, display: false },
    { kind: "text", value: " lies in the extension." },
  ]);
  assert.doesNotThrow(() =>
    katex.renderToString(segments[1].value, {
      displayMode: false,
      throwOnError: true,
      trust: false,
    }),
  );
});

test("normalizes only allowlisted control-character LaTeX prefixes", async () => {
  const { normalizeMathSource, parseMathSegments } = await loadParser();
  const corrupted = [
    "\u0008eta",
    "\u000crac{1}{2}",
    "\neq",
    "\r" + "ho",
    "\t" + "heta",
  ].join("+");

  assert.equal(
    normalizeMathSource(corrupted),
    String.raw`\beta+\frac{1}{2}+\neq+\rho+\theta`,
  );
  assert.equal(normalizeMathSource("x\n+y"), "x\n+y");
  assert.deepEqual(parseMathSegments(`Outside \u0007lpha; inside $x\n+y$.`), [
    { kind: "text", value: "Outside \u0007lpha; inside " },
    { kind: "math", value: "x\n+y", display: false },
    { kind: "text", value: "." },
  ]);
});
