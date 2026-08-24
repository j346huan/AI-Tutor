import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const PROTOCOL_VERSION = "ai-mathematician.tutor.v1";
const SITE_ORIGIN = "http://127.0.0.1:3000";
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");
const bridgeScript = path.join(projectRoot, "scripts", "codex-tutor-bridge.mjs");
const missingCodexBinary = path.join(projectRoot, "tests", "definitely-not-codex");

let bridge;
let bridgeUrl;
let bridgeOutput = "";

before(async () => {
  bridge = spawn(process.execPath, [bridgeScript], {
    cwd: projectRoot,
    env: {
      ...process.env,
      AI_MATHEMATICIAN_BRIDGE_PORT: "0",
      AI_MATHEMATICIAN_CODEX_BIN: missingCodexBinary,
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  bridge.stdout.setEncoding("utf8");
  bridge.stderr.setEncoding("utf8");

  bridgeUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for the bridge to start.\n" + bridgeOutput));
    }, 8_000);

    const inspectOutput = (chunk) => {
      bridgeOutput += chunk;
      const match = bridgeOutput.match(
        /Local Codex tutor bridge listening at (http:\/\/127\.0\.0\.1:\d+)/,
      );
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    };

    bridge.stdout.on("data", inspectOutput);
    bridge.stderr.on("data", inspectOutput);
    bridge.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    bridge.once("exit", (code) => {
      if (!bridgeUrl) {
        clearTimeout(timeout);
        reject(new Error(`Bridge exited before startup with code ${code}.\n${bridgeOutput}`));
      }
    });
  });
});

after(async () => {
  if (!bridge || bridge.exitCode !== null) return;
  bridge.kill("SIGTERM");
  await Promise.race([
    once(bridge, "exit"),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (bridge.exitCode === null) bridge.kill("SIGKILL");
});

async function post(body, options = {}) {
  return fetch(bridgeUrl + "/v1/respond", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: SITE_ORIGIN,
      ...options.headers,
    },
    body,
  });
}

async function startTestBridge(environment) {
  const child = spawn(process.execPath, [bridgeScript], {
    cwd: projectRoot,
    env: environment,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let output = "";
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for an isolated bridge.\n" + output));
    }, 8_000);
    const inspect = (chunk) => {
      output += chunk;
      const match = output.match(
        /Local Codex tutor bridge listening at (http:\/\/127\.0\.0\.1:\d+)/,
      );
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      if (!output.includes("Local Codex tutor bridge listening")) {
        clearTimeout(timeout);
        reject(new Error(`Isolated bridge exited with ${code}.\n${output}`));
      }
    });
  });
  return { child, url, output: () => output };
}

async function stopTestBridge(instance) {
  if (!instance || instance.child.exitCode !== null) return;
  instance.child.kill("SIGTERM");
  await Promise.race([
    once(instance.child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (instance.child.exitCode === null) instance.child.kill("SIGKILL");
}

function cleanEnvironment(...removedNames) {
  const removed = new Set(removedNames.map((name) => name.toUpperCase()));
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !removed.has(name.toUpperCase())),
  );
}

function validBridgeBody(prompt) {
  return JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    prompt,
    request: { protocolVersion: PROTOCOL_VERSION },
  });
}

test("bridge health and safe error responses do not require a Codex account", async (t) => {
  await t.test("reports the current protocol and CORS origin", async () => {
    const response = await fetch(bridgeUrl + "/health", {
      headers: { origin: SITE_ORIGIN },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), SITE_ORIGIN);
    assert.match(response.headers.get("vary") ?? "", /origin/i);
    assert.deepEqual(await response.json(), {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      transport: "codex-exec",
      busy: false,
    });
  });

  await t.test("rejects untrusted browser origins", async () => {
    const response = await post("{}", {
      headers: { origin: "https://example.invalid" },
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "origin_not_allowed",
    });
  });

  await t.test("rejects non-JSON request media types", async () => {
    const response = await post("plain text", {
      headers: { "content-type": "text/plain" },
    });
    assert.equal(response.status, 415);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "unsupported_media_type",
    });
  });

  await t.test("returns a client error for malformed JSON", async () => {
    const response = await post("{");
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: "invalid_json" });
  });

  await t.test("rejects the obsolete protocol version", async () => {
    const response = await post(
      JSON.stringify({
        protocolVersion: "1.0",
        prompt: "Tutor this proof.",
        request: { protocolVersion: "1.0" },
      }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "unsupported_protocol",
    });
  });

  await t.test("keeps oversized request bodies bounded", async () => {
    const response = await post("x".repeat(800_001));
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "request_too_large",
    });
  });

  await t.test("reports a missing local Codex executable without invoking an account", async () => {
    const duplicatedLessonContext = "proof-context ".repeat(13_000);
    const response = await post(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        prompt: duplicatedLessonContext,
        request: {
          protocolVersion: PROTOCOL_VERSION,
          lessonContext: duplicatedLessonContext,
        },
      }),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "codex_not_found",
    });
  });
});

test(
  "Windows fallback uses an isolated Codex home and safe error categories",
  { skip: process.platform !== "win32" },
  async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "ai-mathematician-bridge-test-"),
    );
    const userProfile = path.join(temporaryRoot, "profile");
    const fallbackDirectory = path.join(
      userProfile,
      ".codex",
      ".sandbox-bin",
    );
    const fallbackBinary = path.join(fallbackDirectory, "codex.exe");
    const realCodexHome = path.join(temporaryRoot, "real-codex-home");
    const emptyPath = path.join(temporaryRoot, "empty-path");
    const hookPath = path.join(temporaryRoot, "fake-codex-hook.cjs");
    const auditPath = path.join(temporaryRoot, "audit.json");
    const fakeAuth = "fake-test-credential-not-a-real-account";
    let isolatedBridge;

    try {
      await Promise.all([
        mkdir(fallbackDirectory, { recursive: true }),
        mkdir(realCodexHome, { recursive: true }),
        mkdir(emptyPath, { recursive: true }),
      ]);
      await copyFile(process.execPath, fallbackBinary);
      await writeFile(path.join(realCodexHome, "auth.json"), fakeAuth, "utf8");
      await writeFile(
        path.join(realCodexHome, "config.toml"),
        "must_not_be_copied = true",
        "utf8",
      );
      await writeFile(
        hookPath,
        String.raw`
const fs = require("node:fs");
const path = require("node:path");

if (path.basename(process.execPath).toLowerCase() === "codex.exe") {
  const prompt = fs.readFileSync(0, "utf8");
  const codexHome = process.env.CODEX_HOME;
  const audit = {
    codexHome,
    auth: fs.readFileSync(path.join(codexHome, "auth.json"), "utf8"),
    entries: fs.readdirSync(codexHome).sort(),
  };
  fs.writeFileSync(process.env.FAKE_CODEX_AUDIT_PATH, JSON.stringify(audit));
  if (prompt.includes("simulate-runtime")) {
    process.stderr.write("simulated non-auth runtime failure\n");
    process.exit(2);
  }
  const outputFlag = process.argv.indexOf("--output-last-message");
  fs.writeFileSync(process.argv[outputFlag + 1], JSON.stringify({ fake: true }));
  process.exit(0);
}
`,
        "utf8",
      );

      const hookForNodeOptions = hookPath.replaceAll("\\", "/");
      const environment = {
        ...cleanEnvironment(
          "AI_MATHEMATICIAN_CODEX_BIN",
          "CODEX_HOME",
          "PATH",
          "USERPROFILE",
          "NODE_OPTIONS",
        ),
        AI_MATHEMATICIAN_BRIDGE_PORT: "0",
        CODEX_HOME: realCodexHome,
        FAKE_CODEX_AUDIT_PATH: auditPath,
        NODE_OPTIONS: `--require="${hookForNodeOptions}"`,
        PATH: emptyPath,
        USERPROFILE: userProfile,
      };
      isolatedBridge = await startTestBridge(environment);

      const success = await fetch(isolatedBridge.url + "/v1/respond", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: SITE_ORIGIN,
        },
        body: validBridgeBody("normal fake run"),
      });
      assert.equal(success.status, 200, isolatedBridge.output());
      assert.deepEqual(await success.json(), {
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        output: { fake: true },
      });

      const audit = JSON.parse(await readFile(auditPath, "utf8"));
      assert.equal(audit.auth, fakeAuth);
      assert.deepEqual(audit.entries, ["auth.json"]);
      assert.notEqual(path.resolve(audit.codexHome), path.resolve(realCodexHome));
      await assert.rejects(stat(audit.codexHome), { code: "ENOENT" });

      const runtimeFailure = await fetch(isolatedBridge.url + "/v1/respond", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: SITE_ORIGIN,
        },
        body: validBridgeBody("simulate-runtime"),
      });
      assert.equal(runtimeFailure.status, 502);
      assert.deepEqual(await runtimeFailure.json(), {
        ok: false,
        error: "codex_runtime_error",
      });

      await rm(path.join(realCodexHome, "auth.json"));
      const authFailure = await fetch(isolatedBridge.url + "/v1/respond", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: SITE_ORIGIN,
        },
        body: validBridgeBody("auth is intentionally absent"),
      });
      assert.equal(authFailure.status, 401);
      assert.deepEqual(await authFailure.json(), {
        ok: false,
        error: "codex_auth_required",
      });
    } finally {
      await stopTestBridge(isolatedBridge);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  },
);
