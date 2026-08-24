import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const url = "http://127.0.0.1:3000";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const isWindows = process.platform === "win32";
const vinextCli = path.join(
  projectRoot,
  "node_modules",
  "vinext",
  "dist",
  "cli.js",
);
const bridgeScript = path.join(projectRoot, "scripts", "codex-tutor-bridge.mjs");

try {
  await Promise.all([access(vinextCli), access(bridgeScript)]);
} catch {
  console.error("The local demo is not installed. Run npm install, then try npm run dev again.");
  process.exitCode = 1;
  process.exit();
}

const server = spawn(
  process.execPath,
  [vinextCli, "dev", "--hostname", "127.0.0.1", "--port", "3000"],
  { cwd: projectRoot, stdio: "inherit" },
);
const bridge = spawn(process.execPath, [bridgeScript], {
  cwd: projectRoot,
  stdio: "inherit",
});

let browserOpened = false;
let shuttingDown = false;

function stopChild(child, signal = "SIGTERM") {
  if (!child.killed && child.exitCode === null) {
    child.kill(signal);
  }
}

function stopDemo(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  stopChild(server, signal);
  stopChild(bridge, signal);
  const forceExit = setTimeout(() => {
    stopChild(server, "SIGKILL");
    stopChild(bridge, "SIGKILL");
  }, 3_000);
  forceExit.unref();
}

async function openWhenReady() {
  for (let attempt = 0; attempt < 240 && !browserOpened && !shuttingDown; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        await response.body?.cancel();
        browserOpened = true;
        console.log(`\nAI Mathematician is available at ${url}\n`);
        if (process.env.NO_OPEN !== "1" && process.env.CI !== "true") {
          const command = isWindows
            ? "cmd.exe"
            : process.platform === "darwin"
              ? "open"
              : "xdg-open";
          const args = isWindows ? ["/d", "/s", "/c", "start", "", url] : [url];
          const opener = spawn(command, args, {
            detached: true,
            shell: false,
            stdio: "ignore",
            windowsHide: true,
          });
          opener.once("error", () => {
            console.error("The browser could not be opened automatically. Visit " + url + ".");
          });
          opener.unref();
        }
        return;
      }
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (!browserOpened && !shuttingDown) {
    console.error("The local site did not become ready within 60 seconds.");
  }
}

void openWhenReady();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stopDemo(signal));
}

server.once("error", (error) => {
  console.error("The local site could not be started: " + error.message);
  process.exitCode = 1;
  stopDemo();
});

server.once("exit", (code, signal) => {
  stopChild(bridge);
  if (!shuttingDown && code !== 0) {
    console.error("The local site stopped with code " + code + ".");
  }
  if (!shuttingDown && signal) {
    console.error("The local site stopped after receiving " + signal + ".");
  }
  process.exitCode = code ?? 0;
});

bridge.once("error", (error) => {
  console.error("The local Codex tutor bridge could not be started: " + error.message);
});

bridge.once("exit", (code) => {
  if (code && code !== 0) {
    console.error("The local Codex tutor bridge stopped with code " + code + ".");
  }
});
