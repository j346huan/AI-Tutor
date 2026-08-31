# Run AI Mathematician on macOS

## Requirements

- Node.js 22.13 or newer
- A current desktop browser
- The [OpenAI Codex CLI](https://developers.openai.com/codex/cli/) installed and signed in

## Setup

```bash
git clone https://github.com/j346huan/AI-Tutor.git
cd AI-Tutor
npm install
npm run dev
```

The site opens at [http://127.0.0.1:3000](http://127.0.0.1:3000). Keep the terminal open while using the tutor and press `Control-C` to stop it.

If `codex` is not available on your `PATH`, set its location before starting:

```bash
export AI_MATHEMATICIAN_CODEX_BIN="/path/to/codex"
npm run dev
```
