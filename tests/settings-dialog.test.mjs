import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("settings fields do not read React events inside queued state updates", async () => {
  const source = await readFile(
    new URL("../app/components/SettingsDialog.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const updateInstructionField = \(field: TutorInstructionField, value: string\) => \{[\s\S]*?\[field\]: value,/,
  );

  const queuedUpdates = source.matchAll(
    /setInstructionDraft\(\(current\) => \(\{([\s\S]*?)\}\)\);/g,
  );
  for (const [, updateBody] of queuedUpdates) {
    assert.doesNotMatch(updateBody, /event\.(?:currentTarget|target)/);
  }

  for (const field of [
    "name",
    "studentName",
    "personality",
    "customPrompts",
    "studentBackground",
  ]) {
    assert.match(
      source,
      new RegExp(`updateInstructionField\\("${field}", event\\.currentTarget\\.value\\)`),
    );
  }
});

test("settings expose one tutor picture, one student picture, and no provider selector", async () => {
  const source = await readFile(
    new URL("../app/components/SettingsDialog.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /Download current settings/);
  assert.match(source, /Import mathematician profile picture/);
  assert.match(source, /Import student profile picture/);
  assert.match(source, /Student name/);
  assert.doesNotMatch(source, /MATHEMATICIAN_EXPRESSIONS|expressionImages/);
  assert.doesNotMatch(source, /Scripted demo|tutor-provider|Learner background|Learner picture/);
  assert.doesNotMatch(source, /className="field-help"|className="privacy-note"/);
});
