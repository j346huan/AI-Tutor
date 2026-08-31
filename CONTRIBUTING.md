# Contributing

Thank you for improving AI Mathematician.

## Development setup

1. Install Node.js 22.13 or newer.
2. Install dependencies with `npm install`.
3. Run the site with `npm run dev`.

The automated bridge tests use fake executables and synthetic credentials. They do not invoke a Codex account.

## Before opening a pull request

```bash
npm run lint
npm test
```

Keep changes focused, include tests for behavioral changes, and do not commit credentials, exported settings containing personal portraits, generated build output, or local browser data.

## Adding a course

Add the structured lesson to `app/lessons/`, register it in `app/lessons/index.ts`, and place any matching importable settings file in `courses/`. Course roadmaps should contain stable, unique identifiers and no prewritten mathematical content unless the lesson specifically requires it.
