import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("uses restrained typography and link-style actions", async () => {
  const css = await readFile(new URL("app/globals.css", root), "utf8");

  assert.doesNotMatch(css, /--serif|--sans|--mono/);
  assert.match(css, /\.math-text,\s*\.rendered-proof\s*\{[^}]*font-family:\s*KaTeX_Main, serif;/s);
  assert.match(
    css,
    /a,\s*button,\s*input\[type="file"\]::file-selector-button\s*\{[^}]*color:\s*var\(--link\);[^}]*text-decoration:\s*underline;/s,
  );
  assert.match(
    css,
    /\.primary-button\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*color:\s*var\(--link\);[^}]*text-decoration:\s*underline;/s,
  );
  assert.match(
    css,
    /\.settings-section input\[type="file"\]\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*color:\s*var\(--link\);/s,
  );
});

test("keeps the lesson picker as an unstyled native select", async () => {
  const [css, settings] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SettingsDialog.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(settings, /<select\s+[\s\S]*?id="built-in-lesson"/);
  assert.doesNotMatch(css, /\.settings-section\s+select\s*\{/);
  assert.doesNotMatch(css, /appearance\s*:/);
});

test("keeps compact context and hides instructional labels only visually", async () => {
  const [css, tutor] = await Promise.all([
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/components/TutorApp.tsx", root), "utf8"),
  ]);

  assert.match(css, /\.sticky-context\s*\{[^}]*max-height:\s*67%;/s);
  assert.match(
    css,
    /\.transcript-message--student\s*\{[^}]*margin-left:\s*0;[^}]*padding-left:\s*0;[^}]*border-left:\s*0;/s,
  );
  assert.match(tutor, /<legend ref=\{choiceHeadingRef\} tabIndex=\{-1\}>/);
  assert.match(tutor, /<label className="sr-only" htmlFor="student-draft">/);
});
