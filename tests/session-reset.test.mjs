import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function loadPersistence() {
  const result = await build({
    stdin: {
      contents: String.raw`
        export {
          SETTINGS_STORAGE_KEY,
          SESSION_STORAGE_KEY,
          clearSavedSession,
        } from "./app/lib/persistence.ts";
      `,
      resolveDir: projectRoot,
      sourcefile: "session-reset-harness.ts",
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    logLevel: "silent",
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}`);
}

test("clearing a session preserves imported tutor settings", async () => {
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem(key) {
        return values.get(key) ?? null;
      },
      setItem(key, value) {
        values.set(key, value);
      },
      removeItem(key) {
        values.delete(key);
      },
    },
  };

  const persistence = await loadPersistence();
  values.set(persistence.SETTINGS_STORAGE_KEY, "teacher profile");
  values.set(persistence.SESSION_STORAGE_KEY, "old course notes");

  assert.equal(persistence.clearSavedSession(), undefined);
  assert.equal(values.get(persistence.SETTINGS_STORAGE_KEY), "teacher profile");
  assert.equal(values.has(persistence.SESSION_STORAGE_KEY), false);

  delete globalThis.window;
});

test("New session removes the old workspace before initialization and ignores stale turns", async () => {
  const source = await readFile(
    new URL("../app/components/TutorApp.tsx", import.meta.url),
    "utf8",
  );
  const openStart = source.indexOf("const openSession = useCallback(");
  const openEnd = source.indexOf("\n\n  useEffect(() =>", openStart);
  const openSession = source.slice(openStart, openEnd);
  const dispatchStart = source.indexOf("const dispatch = async", openEnd);
  const dispatchEnd = source.indexOf("\n\n  const startFreshSession", dispatchStart);
  const dispatch = source.slice(dispatchStart, dispatchEnd);
  const freshStart = source.indexOf("const startFreshSession", dispatchEnd);
  const freshEnd = source.indexOf("\n\n  const useBuiltInLesson", freshStart);
  const freshSession = source.slice(freshStart, freshEnd);

  assert.ok(openStart >= 0 && openEnd > openStart, "openSession should be present");
  assert.ok(
    openSession.indexOf("setSession(null);") <
      openSession.indexOf("await localCodexProvider.createSession("),
    "the old transcript and document must disappear before a new tutor turn starts",
  );
  assert.match(openSession, /setSelectedChoiceId\(""\)/);
  assert.match(openSession, /setDraft\(""\)/);
  assert.match(openSession, /setAnnouncement\(""\)/);
  assert.match(openSession, /setFatalError\(null\)/);
  assert.match(openSession, /const operationId = \+\+sessionOperationIdRef\.current/);
  assert.match(
    openSession,
    /if \(operationId !== sessionOperationIdRef\.current\) return;[\s\S]*?setSession\(result\.state\)/,
  );
  assert.match(dispatch, /const operationId = sessionOperationIdRef\.current/);
  assert.match(
    dispatch,
    /if \(operationId !== sessionOperationIdRef\.current\) return;[\s\S]*?setSession\(result\.state\)/,
  );
  assert.match(freshSession, /clearSavedSession\(\)/);
  assert.match(freshSession, /openSession\(settings, false\)/);
  assert.match(source, /disabled=\{busy \|\| phase === "loading"\}/);
});
