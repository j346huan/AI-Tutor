# AI Mathematician

AI Mathematician is a local mathematics tutor that develops editable proofs and personalized course notes through conversation. It includes guided lessons for Euclid’s theorem and a Galois theory course leading to the nonsolvability of the general quintic by radicals.

The tutor uses Personal Codex through a loopback bridge on this computer. No external AI provider is configured in the browser.

## Run locally

Requirements:

- Node.js 22.13 or newer
- A current desktop browser
- The Codex CLI installed, available on `PATH`, and signed in

Install once:

```bash
npm install
```

Start the site and bridge:

```bash
npm run dev
```

The launcher opens [http://127.0.0.1:3000](http://127.0.0.1:3000). Stop both local processes with `Ctrl+C`.

If Codex is installed elsewhere, set its path before starting:

```powershell
$env:AI_MATHEMATICIAN_CODEX_BIN = "C:\path\to\codex.exe"
npm run dev
```

## Use the tutor

1. Open **Settings** to choose a lesson and edit the mathematician, student, and teaching instructions.
2. Review the compiled prompt if desired.
3. Choose **New session**.
4. Chat normally, select an offered approach, edit LaTeX, or ask for feedback.

The browser sends bounded tutor turns to `127.0.0.1:3210`. The bridge invokes `codex exec` in an isolated temporary directory with a strict response schema. Portrait images are never included in the prompt. Imported settings and progress stay in browser storage.

## Lessons

The Euclid lesson guides a contradiction proof that there are infinitely many primes.

The Galois lesson uses a fixed, ordered outline from field extensions to a concrete quintic with Galois group $S_5$. The outline contains only the item kind and title. Personal Codex develops definitions, statements, proofs, examples, and supplementary results from the conversation. Definitions emphasize the defined term with `\emph{...}`.

The middle pane is the rendered proof or course note. The right pane is its editable LaTeX source. **Render** updates the preview; **Ask for feedback** sends the changes and comments to Personal Codex. Use **Export proof to PDF** or **Export course notes to PDF** and select **Save as PDF** in the print dialog.

## Settings format

Settings can be downloaded or imported as JSON:

```json
{
  "schemaVersion": 1,
  "providerId": "local-codex",
  "profile": {
    "name": "The Mathematician",
    "personality": "Patient, precise, and Socratic.",
    "customPrompts": ["Prefer a small hint to a complete solution."],
    "imageDataUrl": ""
  },
  "student": {
    "name": "Student",
    "imageDataUrl": ""
  },
  "learningItems": [
    {
      "id": "euclid-primes",
      "kind": "theorem",
      "title": "Euclid's theorem on prime numbers",
      "statementLatex": "\\text{There are infinitely many prime numbers.}",
      "lessonId": "euclid-infinitely-many-primes"
    }
  ],
  "studentBackground": "The student knows divisibility and proof by contradiction.",
  "selectedLessonId": "euclid-infinitely-many-primes"
}
```

PNG, JPEG, and WebP portraits are supported for one mathematician image and one student image. Older settings files are migrated when imported.

## Tutor protocol

Every turn uses the bundled `ai-mathematician.tutor.v1` request and response schema. The request includes the tutor profile, student context, current outline item, recent conversation, choices, and current LaTeX document. Codex returns only validated commands for replying, editing LaTeX, writing or revising course-note entries, inserting a requested supplementary result, offering choices, advancing the outline, or changing lesson mode.

Unknown fields, stale request IDs, oversized content, malformed LaTeX, unsafe TeX commands, and unauthorized document changes are rejected before they reach the interface. Model text is rendered as a small safe Markdown subset plus locally bundled KaTeX; authored HTML is not trusted.

The protocol lives in `app/protocol/`, the Personal Codex adapter in `app/providers/local-codex.ts`, and the loopback bridge in `scripts/codex-tutor-bridge.mjs`.

## Checks

```bash
npm run lint
npm test
```

Automated bridge tests use fake executables and synthetic credentials; they do not invoke a Codex account.
