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
        import {
          applyBuiltInLessonSettings,
          defaultTutorSettings,
          parseTutorSettings,
          serializeTutorSettings,
        } from "./app/lib/settings.ts";

        export function builtInOutlineSettings() {
          return applyBuiltInLessonSettings(defaultTutorSettings, galoisLesson);
        }

        export function parseTitleOnlySettings() {
          return parseTutorSettings(JSON.stringify({
            schemaVersion: 1,
            providerId: "local-codex",
            profile: {
              name: "Outline tutor",
              personality: "Quiet and precise.",
              customPrompts: [],
              imageDataUrl: "",
            },
            learner: { imageDataUrl: "" },
            learningItems: [
              { id: "field-extension", kind: "definition", title: "Field extension" },
            ],
            learnerBackground: "The learner knows groups and linear algebra.",
            selectedLessonId: "outline-only-course",
          }));
        }

        export function migrateLegacySettings() {
          return parseTutorSettings(JSON.stringify({
            schemaVersion: 1,
            providerId: "scripted-demo",
            profile: {
              name: "Legacy tutor",
              personality: "Concise.",
              customPrompts: [],
              imageDataUrl: "",
              expressionImages: {
                neutral: "",
                happy: "data:image/png;base64,AA==",
              },
            },
            learner: {
              imageDataUrl: "data:image/png;base64,AQ==",
            },
            learningItems: [
              { id: "field-extension", kind: "definition", title: "Field extension" },
            ],
            learnerBackground: "The learner knows group theory.",
            selectedLessonId: "outline-only-course",
          }));
        }

        export function exportCurrentSettings() {
          const settings = migrateLegacySettings();
          settings.student.name = "Ada";
          return serializeTutorSettings(settings);
        }
      `,
      loader: "ts",
      resolveDir: projectRoot,
      sourcefile: "outline-settings-harness.ts",
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

test("built-in outline settings do not invent statement LaTeX", async () => {
  const harness = await loadHarness();
  const settings = harness.builtInOutlineSettings();

  assert.equal(settings.learningItems.length, 32);
  assert.ok(
    settings.learningItems.every(
      (item) => !Object.prototype.hasOwnProperty.call(item, "statementLatex"),
    ),
  );
});

test("teacher settings may import a title-only learning item", async () => {
  const harness = await loadHarness();
  const settings = harness.parseTitleOnlySettings();

  assert.deepEqual(settings.learningItems, [
    { id: "field-extension", kind: "definition", title: "Field extension" },
  ]);
});

test("legacy provider, expression portraits, and learner fields migrate without data loss", async () => {
  const harness = await loadHarness();
  const settings = harness.migrateLegacySettings();

  assert.equal(settings.providerId, "local-codex");
  assert.equal(settings.profile.imageDataUrl, "data:image/png;base64,AA==");
  assert.deepEqual(settings.student, {
    name: "Student",
    imageDataUrl: "data:image/png;base64,AQ==",
  });
  assert.equal(settings.studentBackground, "The learner knows group theory.");
  assert.equal(Object.hasOwn(settings.profile, "expressionImages"), false);
  assert.equal(Object.hasOwn(settings, "learner"), false);
});

test("settings exports use the streamlined Personal Codex schema", async () => {
  const harness = await loadHarness();
  const exported = JSON.parse(harness.exportCurrentSettings());

  assert.equal(exported.providerId, "local-codex");
  assert.deepEqual(exported.student, {
    name: "Ada",
    imageDataUrl: "data:image/png;base64,AQ==",
  });
  assert.equal(exported.studentBackground, "The learner knows group theory.");
  assert.equal(Object.hasOwn(exported, "learner"), false);
  assert.equal(Object.hasOwn(exported, "learnerBackground"), false);
  assert.equal(Object.hasOwn(exported.profile, "expressionImages"), false);
});
