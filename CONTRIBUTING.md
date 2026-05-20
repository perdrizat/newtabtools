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

## Developer Guide

All development on this project is test-driven. Before writing any code, please ensure your environment is set up according to the **[Environment Setup](TESTING.md#environment-setup)** in the testing guide.

### Development Workflow

1.  **Setup:** Follow the guide in [`TESTING.md`](TESTING.md) to install Node.js and Firefox ESR.
2.  **TDD:** We follow a strict red/green TDD workflow. Unit and Integration tests run on every save; E2E tests run at feature completion.
3.  **CLI:** See the **[CLI Reference](TESTING.md#cli-reference)** for the list of available commands (`npm run dev`, `npm run test:fast`, etc.).

### Build

Currently, there is no build step for the Firefox-only MV2 extension. You can run the extension locally using Mozilla's `web-ext` tool.

```bash
# Run the extension locally
npm run dev
```

### Deploy

The extension will eventually be deployed to Mozilla Add-ons (AMO).

```bash
# Build the .xpi artifact for upload
web-ext build --source-dir webextension/
```

### Architecture

- **Target:** Firefox-first, Firefox-only (Manifest V2). Chrome support and MV3 migration are currently deferred (see [`ROADMAP.md`](ROADMAP.md)).
- **Core:** The New Tab page is an XHTML document (`webextension/newTab.xhtml`) registered via `chrome_url_overrides.newtab`.
- **Background Scripts:** Persistent scripts split across multiple files (`common.js`, `tiles.js`, `prefs.js`, `background.js`) using a mix of `chrome.*` callbacks and `browser.*` promises.

### Patterns & Conventions

- **Red/Green TDD is mandatory:** Write failing tests first. See [`TESTING.md`](TESTING.md) for the tier-by-tier strategy.
- **Language:** Production code is JavaScript with JSDoc-based type annotations; tests are TypeScript. See [`MIGRATION.md`](MIGRATION.md) "Language and type safety" for the full rules.

### After Finishing Feature Work

- **Always run E2E tests** with `npm run test:e2e`. This is mandatory after any feature work, bug fix, or refactor that touches the extension's runtime code or UI. The script handles the full Firefox ESR lifecycle (launch, port wait, test run, cleanup) automatically.
- **Never run `npx vitest run --project e2e` directly** — `run_esr_tests.sh` is responsible for launching Firefox ESR with the BiDi debugging port. Without it, all E2E tests will time out. See [`TESTING.md`](TESTING.md) and [`tests/e2e/README.md`](tests/e2e/README.md) for the full lifecycle and architecture.

### Before Committing

- **Run `npm test`** (which runs both `test:fast` and `test:e2e`). Fast tests alone are not sufficient — E2E tests catch rendering bugs that unit/integration tests cannot. If E2E tests were already run as part of finishing the current feature and no files changed since, this step can be skipped. **Do not skip E2E tests because you assume the environment is unavailable — run the command and let it fail or succeed.**
- If your new tests use `fs.readFileSync` on files under `webextension/`, the ESLint rule `ntt/no-source-grep` will flag it — add a disable comment with justification if the check is purely structural.
- Update `CHANGELOG.md` under `[Unreleased]` using [Keep a Changelog](https://keepachangelog.com/) format. **Keep entries to one line each** — concise like git commit messages, not paragraphs.
- After changing `package.json` or `package-lock.json`, run `npm audit` and resolve any vulnerabilities before pushing. GitHub CI runs a dependency audit on every push and will fail the build if issues are found.

### AI Coding Assistants

Contributions generated with the help of AI are welcome but must follow the standard development process. The test harness with unit tests and E2E tests MUST be used extensively to validate AI generated code. These are the important guardrails to ensure agentic compliance with the project's code quality standards.

- **Human Accountability:** The human submitter is responsible for reviewing all AI-generated code, ensuring license compliance, and taking full responsibility for the contribution. AI agents MUST NOT add `Signed-off-by` tags.
- **Attribution:** Mentioning AI assistance in commit messages is optional.
- **Supply-chain guardrails:** When AI-assisted contributions touch `package.json`, `package-lock.json`, or build/test scripts, the human submitter is specifically responsible for: pinned versions on new deps (no `^` / `~`); diffing the lockfile to spot unexpected new transitive deps and source-URL changes on existing ones; reading any `postinstall` scripts before installing; cross-checking new dep names against npm registry stats (download volume, last publish date, listed maintainers) to catch typo-squats. The `min-release-age=7` setting in `.npmrc` is the floor, not a substitute for review.

### Key Files

- [`webextension/manifest.json`](webextension/manifest.json): The core extension manifest (MV2).
- [`webextension/newTab.xhtml`](webextension/newTab.xhtml): The markup for the new tab page UI.
- [`webextension/newTab.js`](webextension/newTab.js): The primary controller script for the UI.
- [`TESTING.md`](TESTING.md): The canonical guide for testing and workflow rules.
- [`ROADMAP.md`](ROADMAP.md): Architectural decisions, both taken and deferred.
- [`MIGRATION.md`](MIGRATION.md): The per-feature migration ledger for the cherry-pick + reference rewrite.
- [`FEATURE_SCOPE.md`](FEATURE_SCOPE.md): Gap analysis vs. native Firefox.
