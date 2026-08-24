import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");

test("Continue controls are hidden until the current course item is ready", async () => {
  const source = await readFile(
    path.join(projectRoot, "app", "components", "TutorApp.tsx"),
    "utf8",
  );

  assert.match(
    source,
    /session && isCurrentCourseItemReady\(activeLesson, session\)/,
  );
  assert.match(
    source,
    /\{canContinueCurrentItem \? \([\s\S]*?Continue[\s\S]*?\) : null\}/,
  );
  assert.match(
    source,
    /className="composer-actions"[\s\S]*?>\s*Send\s*<\/[\s\S]*?canContinueCurrentItem/,
  );
  assert.match(source, /text: "Continue to the next course item\."/);
  assert.match(source, /isFinalCourseItem \? "Finish" : "Continue"/);
  assert.doesNotMatch(source, /Explore an example|Check my understanding/);
});
