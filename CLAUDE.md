# Project Instructions

## Workflow

- Plan non-trivial work before implementation, especially changes with 3 or more steps, architectural decisions, migrations, or broad test impact.
- If implementation or verification uncovers unexpected behavior, pause, inspect the new facts, and update the plan before continuing.
- Keep changes small and focused. Prefer root-cause fixes over temporary workarounds, and avoid unrelated refactors.
- Verify before calling work complete. Run the narrowest meaningful checks first, then broaden when shared behavior or user-facing workflows are affected.
- Keep the user updated during longer work with concise notes about what is being inspected, changed, or verified.

## Project Notes

- Treat `docs/architecture_patterns.md` as the canonical architecture reference for AI agents. Read it before codebase exploration, broad refactors, or architecture-impacting changes, and update it whenever architecture or ownership boundaries change.
- `docs/DeveloperGuide.md` covers setup, local running (`bun run dev:api` + `bun run dev`), testing, deploys and migrations; `docs/security.md` covers personal data. Keep both current when those change.
- Use persistent task notes only when they add value:
  - For substantial work, `tasks/todo.md` may track implementation and verification details.
  - After user corrections, capture repeatable lessons in `tasks/lessons.md` when the lesson should carry into future sessions.
- Subagents may be used when Codex context and user instructions allow delegation, but keep each delegated task focused and concrete.

## Engineering Principles

- Simplicity first: make the smallest change that correctly solves the problem.
- Minimal impact: touch only the files needed for the task.
- Prefer many small helper functions over large functions. When logic is shared or repeated, extract the common logic behind a clear helper instead of duplicating it.
- Use Google-style docstrings for all functions, methods, classes, and public attributes. Document Args, Returns, Raises, and Attributes where applicable.
- Senior-developer standards: inspect failures, logs, and tests until the root cause is clear.
- Challenge non-trivial solutions before presenting them; if something feels hacky, look for the cleaner path.
