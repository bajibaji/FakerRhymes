# Repository Guidelines

## Project Structure & Module Organization
This repository is a static web app (no build step) for the FakerRhymes tool.
- `index.html`: main app UI.
- `custom.html`: custom dictionary management page.
- `css/style.css`: shared styling.
- `js/main.js`: core rhyme logic and UI orchestration.
- `js/data.js`, `js/db.js`, `js/worker-db.js`: dictionary loading, IndexedDB/SQL.js access, and worker queries.
- `js/service-worker.js`, `js/sw-init.js`: offline cache setup.
- `dict_part_1.json` to `dict_part_3.json`: large dictionary shards.
- `plans/`: design, debug, and performance notes.
- `.github/workflows/`: GitHub Pages deployment workflows.

## Build, Test, and Development Commands
No compile pipeline is required; run locally with a static server from repo root:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080/index.html`.

Performance and search latency checks are browser-console driven:

```js
window.fakerRhymesPerformanceTests.runCoreTest()
window.fakerRhymesPerformanceTests.runSearchLatencyTest('人工智能', 20)
```

Deployments are handled by GitHub Actions on pushes to `main` (`.github/workflows/static.yml`).

## Coding Style & Naming Conventions
- Preserve existing file-local formatting; this codebase uses mixed indentation and should not be mass-reformatted.
- JavaScript conventions: `camelCase` for functions/variables, `UPPER_SNAKE_CASE` for constants (for example `DB_NAME`).
- Prefer small, focused functions and keep DOM IDs/class names descriptive (`loadDictBtn`, `pingzeFilterContainer`).
- Keep comments brief and explanatory, especially around performance-sensitive query paths.

## Testing Guidelines
- Validate UI flows manually: dictionary load, rhyme generation, looseness mode switching, and AI mode toggle.
- For performance-sensitive changes, run `js/performance-test.js` helpers in browser console and compare against targets in `plans/PERFORMANCE_TEST.md`.
- If service worker or cache logic changes, test first load and repeat load behavior.

## Commit & Pull Request Guidelines
Recent history uses short subjects (for example `v1.9.3`, `Update service-worker.js`). Follow this pattern:
- Release/version commits: `vX.Y.Z` (optionally with short suffix).
- Feature/fix commits: imperative summary with scope (`Update main.js query fallback`).

For pull requests, include:
- What changed and why.
- Manual test steps and results.
- Linked issue (if any).
- Screenshots/GIFs for UI changes.
