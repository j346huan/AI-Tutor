# AI Mathematician

AI Mathematician is a local, conversation-driven mathematics tutor. It develops editable proofs and course notes with you rather than presenting a fixed answer key.

The browser interface talks to a loopback bridge on your computer, and the bridge invokes your signed-in OpenAI Codex CLI. No API key is stored in the browser.

## Features

- Socratic tutoring with bounded, validated tutor responses
- Live rendered mathematics with an editable LaTeX source pane
- Progressive proof and course-note construction
- Importable tutor settings and course configurations
- Local browser persistence for settings and progress
- PDF export through the browser print dialog
- Built-in courses:
  - Euclid's theorem on infinitely many primes
  - Galois theory and the unsolvability of the general quintic
  - Blow-ups in algebraic geometry

## Requirements

- Node.js 22.13 or newer
- A current desktop browser
- The [OpenAI Codex CLI](https://developers.openai.com/codex/cli/) installed and signed in

Run `codex` once after installation and choose **Sign in with ChatGPT** or another available sign-in method.

## Quick start

```bash
git clone https://github.com/j346huan/AI-Tutor.git
cd AI-Tutor
npm install
npm run dev
```

The launcher opens [http://127.0.0.1:3000](http://127.0.0.1:3000). Keep the terminal open while using the tutor, and press `Ctrl+C` to stop the site and local bridge.

If Codex is not available on your `PATH`, set `AI_MATHEMATICIAN_CODEX_BIN` to the executable before starting the app.

macOS or Linux:

```bash
export AI_MATHEMATICIAN_CODEX_BIN="/path/to/codex"
npm run dev
```

Windows PowerShell:

```powershell
$env:AI_MATHEMATICIAN_CODEX_BIN = "C:\path\to\codex.exe"
npm run dev
```

## Using the tutor

1. Open **Settings**.
2. Choose a built-in lesson or import a settings file.
3. Adjust the tutor and student instructions if desired.
4. Choose **New session**.
5. Chat with the tutor, edit the LaTeX document, or ask for feedback.

The importable blow-ups course is available at [`courses/blow-ups-course.json`](courses/blow-ups-course.json).

## Project commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the site and local Codex bridge |
| `npm run build` | Create a production build |
| `npm run start` | Start the production build |
| `npm run lint` | Run static checks |
| `npm test` | Build and run the automated test suite |

## How it works

The browser sends bounded tutor turns to `127.0.0.1:3210`. The bridge invokes `codex exec` in an isolated temporary directory with a strict response schema. Responses are validated before they can change the transcript, roadmap, or LaTeX document.

Tutor settings, imported portraits, and lesson progress remain in browser storage. Portrait images are never included in the model prompt. The app does not require an OpenAI API key, but each user must have access to a signed-in Codex CLI.

Important source areas:

- `app/lessons/` — built-in lesson definitions and roadmaps
- `app/protocol/` — tutor request, response, and validation protocol
- `app/providers/local-codex.ts` — local Codex provider
- `scripts/codex-tutor-bridge.mjs` — loopback bridge
- `courses/` — importable course settings

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

This project is available under the [MIT License](LICENSE).
