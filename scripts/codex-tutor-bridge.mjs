import { constants as fsConstants } from "node:fs";
import { createServer } from "node:http";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";

const HOST = "127.0.0.1";
const TUTOR_PROTOCOL_VERSION = "ai-mathematician.tutor.v1";
const ALLOWED_SITE_ORIGINS = new Set([
  "http://127.0.0.1:3000",
  "http://localhost:3000",
]);
// The POST intentionally carries both the structured request and a prompt that
// embeds it. Keep both limits bounded while leaving room for that duplication.
const MAX_BODY_BYTES = 800_000;
const MAX_PROMPT_LENGTH = 400_000;
const MAX_CAPTURE_BYTES = 1_000_000;
const TURN_TIMEOUT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 15_000;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const responseSchemaPath = path.join(
  projectRoot,
  "app",
  "protocol",
  "tutor-response.schema.json",
);
const explicitCodexBinary = process.env.AI_MATHEMATICIAN_CODEX_BIN;
const hasExplicitCodexBinary = Boolean(explicitCodexBinary);
const codexBinary = explicitCodexBinary || "codex";
const explicitCodexHome = process.env.CODEX_HOME;
const WINDOWS_FALLBACK_ERRORS = new Set(["EACCES", "ENOENT", "EPERM"]);
const SAFE_BRIDGE_ERRORS = new Set([
  "request_too_large",
  "invalid_json",
  "invalid_request",
  "unsupported_protocol",
  "missing_prompt",
  "prompt_too_large",
  "missing_request",
  "protocol_mismatch",
  "codex_not_found",
  "codex_not_executable",
  "codex_auth_required",
  "codex_runtime_error",
  "codex_timeout",
  "invalid_codex_response",
  "codex_response_too_large",
  "response_schema_missing",
]);

let activeRequest = false;
let activeCodexProcess = null;

function parsePort(value) {
  if (!/^\d+$/.test(value)) {
    throw new Error("AI_MATHEMATICIAN_BRIDGE_PORT must be an integer from 0 to 65535.");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error("AI_MATHEMATICIAN_BRIDGE_PORT must be an integer from 0 to 65535.");
  }
  return port;
}

const PORT = parsePort(process.env.AI_MATHEMATICIAN_BRIDGE_PORT ?? "3210");

function isAllowedOrigin(origin) {
  return ALLOWED_SITE_ORIGINS.has(origin);
}

function corsHeaders(origin) {
  const headers = {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    vary: "Origin",
  };
  if (isAllowedOrigin(origin)) {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
}

function sendJson(response, status, payload, origin) {
  response.writeHead(status, corsHeaders(origin));
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  let length = 0;
  let tooLarge = false;

  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }

  if (tooLarge) throw new Error("request_too_large");
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid_json");
  }
}

function validateBridgeRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_request");
  }
  if (value.protocolVersion !== TUTOR_PROTOCOL_VERSION) {
    throw new Error("unsupported_protocol");
  }
  if (typeof value.prompt !== "string" || !value.prompt.trim()) {
    throw new Error("missing_prompt");
  }
  if (value.prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error("prompt_too_large");
  }
  if (!value.request || typeof value.request !== "object" || Array.isArray(value.request)) {
    throw new Error("missing_request");
  }
  if (value.request.protocolVersion !== value.protocolVersion) {
    throw new Error("protocol_mismatch");
  }
  return value;
}

function capture(stream) {
  const chunks = [];
  let length = 0;
  stream.on("data", (chunk) => {
    if (length >= MAX_CAPTURE_BYTES) return;
    const remaining = MAX_CAPTURE_BYTES - length;
    const bounded = chunk.subarray(0, remaining);
    chunks.push(bounded);
    length += bounded.length;
  });
  return () => Buffer.concat(chunks).toString("utf8");
}

function errorCode(error) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
}

function safeExecutionError(error) {
  if (error instanceof Error && SAFE_BRIDGE_ERRORS.has(error.message)) {
    return error;
  }
  const code = errorCode(error);
  if (code === "ENOENT") return new Error("codex_not_found");
  if (code === "EACCES" || code === "EPERM") {
    return new Error("codex_not_executable");
  }
  return new Error("codex_runtime_error");
}

function failedForAuthentication(stderr) {
  return /(?:not logged in|authentication required|please (?:run|use) .*login|missing credentials?|unauthorized|\b401\b)/i.test(
    stderr,
  );
}

async function executeCodex(binary, args, prompt, temporaryDirectory, environment) {
  const spawnOptions = {
    cwd: temporaryDirectory,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    ...(environment ? { env: environment } : {}),
  };
  const child = spawn(binary, args, spawnOptions);
  activeCodexProcess = child;
  const stdout = capture(child.stdout);
  const stderr = capture(child.stderr);
  let timedOut = false;

  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, TURN_TIMEOUT_MS);

  // A missing or immediately failing executable can close stdin before the
  // prompt is written. Consume that EPIPE rather than crashing the bridge.
  child.stdin.on("error", () => {});

  let result;
  try {
    child.stdin.end(prompt, "utf8");
    result = await exit;
  } finally {
    clearTimeout(timer);
    if (activeCodexProcess === child) activeCodexProcess = null;
  }

  if (timedOut) throw new Error("codex_timeout");
  if (result.code !== 0) {
    const diagnostic = stderr().slice(0, MAX_CAPTURE_BYTES);
    throw new Error(
      failedForAuthentication(diagnostic)
        ? "codex_auth_required"
        : "codex_runtime_error",
    );
  }
  return stdout();
}

async function prepareWindowsFallback(temporaryDirectory) {
  if (process.platform !== "win32" || hasExplicitCodexBinary) return null;
  const userProfile = process.env.USERPROFILE;
  if (!userProfile) return null;

  const binary = path.join(userProfile, ".codex", ".sandbox-bin", "codex.exe");
  try {
    await access(binary, fsConstants.F_OK);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw new Error("codex_not_executable");
  }

  const realCodexHome = explicitCodexHome || path.join(userProfile, ".codex");
  const isolatedCodexHome = path.join(temporaryDirectory, "codex-home");
  const sourceAuthPath = path.join(realCodexHome, "auth.json");
  const isolatedAuthPath = path.join(isolatedCodexHome, "auth.json");
  try {
    await mkdir(isolatedCodexHome, { recursive: false });
    // Copy the credential file opaquely. Never parse, print, or retain it.
    await copyFile(sourceAuthPath, isolatedAuthPath, fsConstants.COPYFILE_EXCL);
  } catch {
    throw new Error("codex_auth_required");
  }

  return {
    binary,
    environment: {
      ...process.env,
      CODEX_HOME: isolatedCodexHome,
    },
  };
}

async function runCodex(prompt) {
  try {
    await access(responseSchemaPath);
  } catch {
    throw new Error("response_schema_missing");
  }

  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "ai-mathematician-codex-"),
  );
  const outputPath = path.join(temporaryDirectory, "response.json");
  const args = [
    "exec",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--output-schema",
    responseSchemaPath,
    "--output-last-message",
    outputPath,
    "-",
  ];

  try {
    let capturedStdout;
    try {
      capturedStdout = await executeCodex(
        codexBinary,
        args,
        prompt,
        temporaryDirectory,
      );
    } catch (error) {
      const mayFallback =
        process.platform === "win32" &&
        !hasExplicitCodexBinary &&
        WINDOWS_FALLBACK_ERRORS.has(errorCode(error));
      if (!mayFallback) throw safeExecutionError(error);

      const fallback = await prepareWindowsFallback(temporaryDirectory);
      if (!fallback) throw safeExecutionError(error);
      try {
        capturedStdout = await executeCodex(
          fallback.binary,
          args,
          prompt,
          temporaryDirectory,
          fallback.environment,
        );
      } catch (fallbackError) {
        throw safeExecutionError(fallbackError);
      }
    }

    let output;
    try {
      const outputStats = await stat(outputPath);
      if (outputStats.size > MAX_CAPTURE_BYTES) {
        throw new Error("codex_response_too_large");
      }
      output = await readFile(outputPath, "utf8");
    } catch (error) {
      if (error instanceof Error && error.message === "codex_response_too_large") {
        throw error;
      }
      output = capturedStdout;
    }

    try {
      const parsed = JSON.parse(output);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid_codex_response");
      }
      return parsed;
    } catch {
      throw new Error("invalid_codex_response");
    }
  } finally {
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    }).catch(() => {});
  }
}

function statusForError(code) {
  if (code === "request_too_large" || code === "prompt_too_large") return 413;
  if (code === "unsupported_media_type") return 415;
  if (
    [
      "invalid_json",
      "invalid_request",
      "unsupported_protocol",
      "missing_prompt",
      "missing_request",
      "protocol_mismatch",
    ].includes(code)
  ) {
    return 400;
  }
  if (code === "codex_not_found" || code === "codex_not_executable") return 503;
  if (code === "codex_auth_required") return 401;
  if (code === "codex_timeout") return 504;
  if (code === "response_schema_missing") return 500;
  return 502;
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin ?? "";

  if (request.method === "OPTIONS") {
    if (request.url !== "/v1/respond") {
      sendJson(response, 404, { ok: false, error: "not_found" }, origin);
      return;
    }
    if (!isAllowedOrigin(origin)) {
      sendJson(response, 403, { ok: false, error: "origin_not_allowed" }, origin);
      return;
    }
    sendJson(response, 204, {}, origin);
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(
      response,
      200,
      {
        ok: true,
        protocolVersion: TUTOR_PROTOCOL_VERSION,
        transport: "codex-exec",
        busy: activeRequest,
      },
      origin,
    );
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/respond") {
    sendJson(response, 404, { ok: false, error: "not_found" }, origin);
    return;
  }

  if (!isAllowedOrigin(origin)) {
    sendJson(response, 403, { ok: false, error: "origin_not_allowed" }, origin);
    return;
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) {
    sendJson(response, 415, { ok: false, error: "unsupported_media_type" }, origin);
    return;
  }
  if (activeRequest) {
    sendJson(response, 429, { ok: false, error: "bridge_busy" }, origin);
    return;
  }

  activeRequest = true;
  try {
    const body = validateBridgeRequest(await readJsonBody(request));
    const output = await runCodex(body.prompt);
    sendJson(
      response,
      200,
      {
        ok: true,
        protocolVersion: TUTOR_PROTOCOL_VERSION,
        output,
      },
      origin,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "bridge_error";
    const safeCode = SAFE_BRIDGE_ERRORS.has(code)
      ? code
      : safeExecutionError(error).message;
    console.error("[codex bridge]", safeCode);
    sendJson(response, statusForError(safeCode), { ok: false, error: safeCode }, origin);
  } finally {
    activeRequest = false;
  }
});

server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = Math.min(REQUEST_TIMEOUT_MS, 10_000);
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;

server.listen(PORT, HOST, () => {
  const address = server.address();
  const listeningPort = address && typeof address === "object" ? address.port : PORT;
  console.log("Local Codex tutor bridge listening at http://" + HOST + ":" + listeningPort);
});

server.on("error", (error) => {
  const code = error && typeof error === "object" && "code" in error ? error.code : "unknown";
  console.error("Local Codex tutor bridge failed to start (" + code + ").");
  process.exitCode = 1;
});

let shuttingDown = false;
function shutDown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (activeCodexProcess && !activeCodexProcess.killed) {
    activeCodexProcess.kill("SIGKILL");
  }
  server.close();
  const forceExit = setTimeout(() => {
    process.exitCode = 1;
    process.exit();
  }, 5_000);
  forceExit.unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, shutDown);
}
