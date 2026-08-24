import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadHarness() {
  const result = await build({
    stdin: {
      contents: String.raw`
        import { galoisLesson } from "./app/lessons/galois.ts";
        import { buildInitializationPromptPreview } from "./app/providers/local-codex.ts";

        export function inspectLesson() {
          return {
            contentVersion: galoisLesson.contentVersion,
            curriculum: galoisLesson.settings.curriculum,
            roadmap: galoisLesson.roadmap,
            fragments: galoisLesson.proof.fragments,
            profile: galoisLesson.settings.profile,
            background: galoisLesson.settings.studentBackgroundPrompt,
          };
        }

        export function compileCoursePrompt() {
          const preview = buildInitializationPromptPreview(galoisLesson);
          return { prompt: preview.prompt, request: preview.request };
        }
      `,
      loader: "ts",
      resolveDir: projectRoot,
      sourcefile: "galois-outline-harness.ts",
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

const expectedIds = [
  "field-extension",
  "algebraic-element",
  "minimal-polynomial",
  "simple-extension-quotient",
  "extension-degree",
  "tower-law",
  "k-embedding",
  "images-of-algebraic-elements",
  "extension-of-embeddings",
  "splitting-field",
  "separable-polynomial",
  "derivative-test",
  "normal-extension",
  "galois-extension",
  "galois-group",
  "fixed-field",
  "normality-and-automorphisms",
  "fundamental-theorem-galois-theory",
  "faithful-action-on-roots",
  "irreducibility-and-transitivity",
  "solvable-group",
  "solvability-inheritance",
  "a5-not-solvable",
  "s5-not-solvable",
  "solvability-by-radicals",
  "radicals-and-roots-of-unity",
  "galois-obstruction-to-radicals",
  "irreducibility-by-reduction",
  "prime-cycle-and-transposition",
  "prime-degree-real-root-criterion",
  "an-unsolvable-quintic",
  "no-general-quintic-radical-formula",
];

test("the Galois course stores only an atomic ordered outline", async () => {
  const harness = await loadHarness();
  const lesson = harness.inspectLesson();

  assert.equal(lesson.contentVersion, 2);
  assert.equal(lesson.profile.name, "AI-Galois");
  assert.match(lesson.profile.personality, /introverted/i);
  assert.match(lesson.background, /third-year pure mathematics student/i);
  assert.equal(lesson.curriculum.length, 32);
  assert.deepEqual(lesson.curriculum.map((item) => item.id), expectedIds);
  assert.deepEqual(
    lesson.roadmap.map((item) => item.statementId),
    expectedIds,
  );

  for (const item of lesson.curriculum) {
    assert.deepEqual(Object.keys(item).sort(), ["id", "kind", "title"]);
    assert.ok(["definition", "lemma", "proposition", "theorem"].includes(item.kind));
    assert.ok(item.title.length > 0);
  }
  for (const item of lesson.roadmap) {
    assert.deepEqual(Object.keys(item), ["statementId"]);
  }
  assert.deepEqual(lesson.fragments, {});
});

test("the Personal Codex prompt receives the outline without authored mathematics", async () => {
  const harness = await loadHarness();
  const result = harness.compileCoursePrompt();

  assert.equal(result.request.profile.name, "AI-Galois");
  assert.equal(result.request.theorem.id, "field-extension");
  assert.equal(result.request.theorem.kind, "definition");
  assert.equal(result.request.lessonPlan.roadmap.length, 32);
  assert.deepEqual(
    result.request.lessonPlan.roadmap.map((item) => item.statementId),
    expectedIds,
  );

  const forbiddenAuthoredDetails = [
    "Every polynomial vanishing at",
    "multiplication of bases",
    "smallest extension in which",
    "commutator subgroup is all",
    "The remainders of",
    "x^5-4x-1",
  ];
  for (const detail of forbiddenAuthoredDetails) {
    assert.ok(!result.prompt.includes(detail), `prompt leaked authored detail: ${detail}`);
  }
  assert.match(result.prompt, /Field extension/);
  assert.match(result.prompt, /No general radical formula for the quintic/);
});
