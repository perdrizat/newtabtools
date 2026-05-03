# Contributing to New Tab Tools

**Note on Project Status & Fork Intention:** This repository is a fork of the original New Tab Tools project, which is currently unmaintained. Our intention is to take over the development and maintenance of this extension. Under the terms of the original Mozilla Public License 2.0 (MPL-2.0), we have established a robust test automation infrastructure and are now moving into active development and refactoring.

---

## ~~Filing Bug Reports~~ (currently disabled)

~~Help us help you! This guide shows you how to create a clear, actionable bug report (or "issue") so we can identify the problem and release a fix as quickly as possible. Please remember that the developers of New Tab Tools are human, with limited time and bills to pay.~~

### ~~What to put in your bug report~~
* ~~Did the problem start happening recently (e.g. after updating to a new version of New Tab Tools/Firefox) or was this always a problem?~~
* ~~Which version of New Tab Tools are you using? You can get the exact version from the Firefox Add-On Manager.~~
* ~~What's the name and version of the operating system you're using? What version of Firefox are you using? You can find this information by visiting `about:support` or clicking on Troubleshooting Information on the Help menu.~~
* ~~Can you reliably reproduce the issue? If not, provide details about how often the problem happens and under which conditions it normally happens.~~
* ~~Do you have another extension or theme installed that might cause the issue? (Because of the way New Tab Tools works, this can happen. *Classic Theme Restorer* and some themes are known to have caused problems.) Try disabling these other add-ons and see if the issue goes away.~~

---

## Developer Guide - test infrastructure established

### Build

Currently, there is no build step for the Firefox-only MV2 extension. You can run the extension locally using Mozilla's `web-ext` tool.

```bash
# Run the extension for local development
npm run dev
```

### Test

Testing is divided into two primary phases: the **Fast TDD Loop** and the **E2E Validation Suite**. See `TESTING.md` for the full canonical testing guide.

```bash
# Run the fast TDD loop (Vitest + JSDOM for unit & integration tests)
npm run test:fast

# Run the E2E Validation suite (Playwright against Firefox ESR)
npm run test:e2e

# Run all code quality checks (ESLint and web-ext lint)
npm run lint && npm run lint:webext
```

### Deploy

The extension is deployed to Mozilla Add-ons (AMO).

```bash
# Build the .xpi artifact for upload
web-ext build --source-dir webextension/
```

### Architecture

- **Target:** Firefox-first, Firefox-only (Manifest V2). Chrome support and MV3 migration are currently deferred (see `ROADMAP.md`).
- **Core:** The New Tab page is an XHTML document (`webextension/newTab.xhtml`) registered via `chrome_url_overrides.newtab`.
- **Background Scripts:** Persistent scripts split across multiple files (`common.js`, `tiles.js`, `prefs.js`, `background.js`) using a mix of `chrome.*` callbacks and `browser.*` promises.

### Patterns & Conventions

- **Red/Green TDD is mandatory:** Write failing tests first. Tests and production code stay in vanilla JavaScript (no TypeScript).
- **Two Flow Modes:**
  - *Mode A (New Code):* Extraction-first. Write pure logic unit tests (`tests/unit/`), then wire it to the UI and WebExtension APIs via integration tests.
  - *Mode B (Legacy Code):* Characterize-first. Write API Contract tests (`tests/integration/`) with `jest-webextension-mock` to characterize existing behavior *before* refactoring legacy files.

### AI Coding Assistants

Contributions generated with the help of AI are welcome but must follow the standard development process. The test harness with unit tests and E2E tests MUST be used extensively to validate AI generated code. These are the important guardrails to ensure agentic compliance with the project's code quality standards.

- **Human Accountability:** The human submitter is responsible for reviewing all AI-generated code, ensuring license compliance, and taking full responsibility for the contribution. AI agents MUST NOT add `Signed-off-by` tags.
- **Attribution:** Mentioning AI assistance in commit messages is optional.

### Key Files

- `webextension/manifest.json`: The core extension manifest (MV2).
- `webextension/newTab.xhtml`: The markup for the new tab page UI.
- `webextension/newTab.js`: The primary controller script for the UI.
- `TESTING.md`: The canonical guide for testing and workflow rules.
- `ROADMAP.md`: A log of deferred architectural decisions.
