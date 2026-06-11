# Contributing to New Tab Tools

**Note on Project Status & Fork Intention:** This repository is a fork of the original New Tab Tools project, which is currently unmaintained. Our intention is to take over the development and maintenance of this extension. Under the terms of the original Mozilla Public License 2.0 (MPL-2.0), we have established a robust test automation infrastructure and are now moving into active development and refactoring.

---

## Filing Bug Reports

Help us help you! You can report bugs at [https://github.com/perdrizat/newtabtools/issues](https://github.com/perdrizat/newtabtools/issues). This guide shows you how to create a clear, actionable bug report (or "issue") so we can identify the problem and release a fix as quickly as possible. Please remember that the developers of New Tab Tools are human, with limited time and bills to pay.

### What to put in your bug report
* Did the problem start happening recently (e.g. after updating to a new version of New Tab Tools/Firefox) or was this always a problem?
* Which version of New Tab Tools are you using? You can get the exact version from the Firefox Add-On Manager.
* What's the name and version of the operating system you're using? What version of Firefox are you using? You can find this information by visiting `about:support` or clicking on Troubleshooting Information on the Help menu.
* Can you reliably reproduce the issue? If not, provide details about how often the problem happens and under which conditions it normally happens.
* Do you have another extension or theme installed that might cause the issue? (Because of the way New Tab Tools works, this can happen. *Classic Theme Restorer* and some themes are known to have caused problems.) Try disabling these other add-ons and see if the issue goes away.

---

## Translating

If you're comfortable working with Git, you can help translate NewTab PowerTools into your language!

1. **Test Locally:** Clone the repo to your machine. You can install it in Firefox temporarily by visiting `about:debugging` -> "This Firefox" -> "Load Temporary Add-on", and selecting any file inside the `webextension/` directory. This is the easiest way to test your translations live, and you can reload the extension as you go.
2. **Finding the Files:** Locales live in the `webextension/_locales/` directory. To start, copy the `en/messages.json` file into your language's directory (e.g., `de/messages.json` for German).
3. **Locating Strings:** The strings are organized logically. For example, `options_...` strings appear in the Settings drawer, while `tile_...` strings appear on individual grid tiles or in their edit menus.
4. **Simplifying Placeholders (Pro-tip):** When translating strings that contain variables, you don't need to copy the entire verbose `placeholders` object from the English file. You can reduce complicated blocks to just the message string using positional variables (`$1`). 
   For example, this:
   ```json
   "autosaved_relative_minutes": {
       "message": "$MINUTES$m ago",
       "placeholders": { "minutes": { "content": "$1" } }
   }
   ```
   Can be cleanly reduced in your translation file to just:
   ```json
   "autosaved_relative_minutes": {
       "message": "$1m ago"
   }
   ```
5. **Fallback Behavior:** If you want to keep the English version of a string, simply **remove that key from your file entirely**. Firefox will automatically fall back to the English string.

### Translation Utilities

We provide several CLI tools to make maintaining translations easy. You will need [Node.js and pnpm](TESTING.md#environment-setup) installed to run them:

- **Find Missing Keys:** Run `pnpm i18n:check <locale>` (e.g., `pnpm i18n:check de`). This compares your language file against the master English file and prints a list of any keys you haven't translated yet.
- **Find Dead Strings:** Run `pnpm i18n:stale <locale>`. This checks against the master English file to find old, unused translation keys that are no longer referenced.
- **Clean Up:** Run `pnpm i18n:purge <locale>` (e.g., `pnpm i18n:purge de`). This automatically deletes any known dead strings from your language's `messages.json` file, keeping it clean and lightweight.

If you have any questions, feel free to open an issue!

---

## Developer Guide

All development on this project is test-driven. Before writing any code, please ensure your environment is set up according to the **[Environment Setup](TESTING.md#environment-setup)** in the testing guide.

### Development Workflow

1.  **Setup:** Follow the guide in [`TESTING.md`](TESTING.md) to install Node.js and Firefox ESR.
2.  **TDD:** We follow a strict red/green TDD workflow. Unit and Integration tests run on every save; E2E tests run at feature completion.
3.  **CLI:** See the **[CLI Reference](TESTING.md#cli-reference)** for the list of available commands (`pnpm dev`, `pnpm test:fast`, etc.). This project uses **pnpm** as the package manager (enforced by a `preinstall` guard so the `minimum-release-age` supply-chain rule in `.npmrc` actually applies).

### Build

Currently, there is no build step for the Firefox-only MV2 extension. You can run the extension locally using Mozilla's `web-ext` tool.

```bash
# Run the extension locally
pnpm dev
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
- **Language:** Production code is JavaScript with JSDoc-based type annotations; tests are TypeScript. Both are checked by `tsc --noEmit` (`allowJs: true`, `checkJs: true`). The extension has **no build step** — `web-ext run` and the E2E lifecycle consume `webextension/` directly. Full TypeScript would put a compiler between source and runtime that a single maintainer absorbs forever; JSDoc + `checkJs` gets most of the safety benefit at zero build cost, and TS reads JSDoc so a `.ts` test importing a `lib/*.js` module sees its declared signatures.

#### Rules for new code

- **Production files in `webextension/`:** stay `.js`. Add JSDoc types to function signatures, exported objects, and `browser.*` callback parameters. `checkJs: true` checks every `.js` by default — no per-file `// @ts-check` needed.
- **Test files in `tests/`:** all `.ts`. New tests must be TypeScript too.
- **WebExtension API types** come from `@types/firefox-webext-browser`. (`@types/chrome` joins it if/when Chrome support arrives.)
- **Modules:** `webextension/lib/` is reserved for ES modules; eslint enforces module-mode there. Pure-logic extraction into `lib/` is deferred to the MV3 migration (MV2 script-mode files can't import ES modules) — see [`MV3_MIGRATION.md`](MV3_MIGRATION.md).
- **Don't introduce a build step.** If a feature seems to need TS-only ergonomics JSDoc can't express, simplify the design rather than adding a compiler.
- **Don't suppress type errors** with `// @ts-ignore`. Fix the underlying JSDoc, or use `// @ts-expect-error` + a one-line reason (it preserves the signal once the issue is fixed).
- **Don't add `.ts` files under `webextension/`.** The escape hatch (renaming `.js`→`.ts` later) is preserved by not using it now.

For the MV3/Chrome forward-compatibility rules new code should also follow (promise-based `browser.*`, no DOM in background scope where it'll matter, avoid widening `<all_urls>`), see [`MV3_MIGRATION.md`](MV3_MIGRATION.md).

### After Finishing Feature Work

- **Always run E2E tests** with `pnpm test:e2e`. This is mandatory after any feature work, bug fix, or refactor that touches the extension's runtime code or UI. The script handles the full Firefox ESR lifecycle (launch, port wait, test run, cleanup) automatically.
- **Never run `npx vitest run --project e2e` directly** — `run_esr_tests.sh` is responsible for launching Firefox ESR with the BiDi debugging port. Without it, all E2E tests will time out. See [`TESTING.md`](TESTING.md) and [`tests/e2e/README.md`](tests/e2e/README.md) for the full lifecycle and architecture.

### Before Committing

- **Run `pnpm test`** (which runs both `test:fast` and `test:e2e`). Fast tests alone are not sufficient — E2E tests catch rendering bugs that unit/integration tests cannot. If E2E tests were already run as part of finishing the current feature and no files changed since, this step can be skipped. **Do not skip E2E tests because you assume the environment is unavailable — run the command and let it fail or succeed.**
- **For user-visible UI changes, run the UAT tier** with `pnpm test:uat` and review the run's `summary.md` + screenshots before requesting review. UAT is pre-release / local-only (it spends Claude Code subscription tokens and never runs in CI) — it catches the "looks broken to a user" bug class deterministic tests miss. See [`TESTING.md`](TESTING.md#uat-tests-testsuat--see-uat_planmd) and [`tests/uat/README.md`](tests/uat/README.md).
- If your new tests use `fs.readFileSync` on files under `webextension/`, the ESLint rule `ntt/no-source-grep` will flag it — add a disable comment with justification if the check is purely structural. The justification must say *why a behavioral test isn't possible*, and a source-string match may never be the sole coverage for a functional behavior — see [`TESTING.md`](TESTING.md#test-design-principles).
- **Daily patch bump.** The patch version bumps **once per day, on that day's first commit**: run `pnpm version patch`. It bumps `version` in `package.json` and makes a `vX.Y.Z` commit + tag; the next `pnpm build` mirrors the version into `manifest.json` via `scripts/sync-version.mjs` (so you never hand-edit the manifest version). `package.json` is the single source of truth. Run it on a clean tree — commit your in-progress work first, then bump. Later commits the same day reuse that day's version (no further bump until tomorrow).
- Update `CHANGELOG.md` using [Keep a Changelog](https://keepachangelog.com/) format. **Keep entries to one line each** — concise like git commit messages, not paragraphs. Accumulate entries under `[Unreleased]` as you work; when you do the day's first commit + bump, **promote `[Unreleased]` into a version-led, dated section headed `## [X.Y.Z] — YYYY-MM-DD`** — where `X.Y.Z` is the version you just bumped to and the date is today. Same-day commits append to that one section (one heading per date — never add a second heading for a date that already exists, and don't re-add `[Unreleased]` until the next day's work).
- **Run `pnpm audit --audit-level=high` before every commit** — not only when you touch `package.json`/`pnpm-lock.yaml`. It is the *first* gate CI runs on every push (before lint/tests) and fails the build on any high/critical advisory. Crucially, advisories surface against **existing, unchanged** dependencies as they are newly disclosed, so a clean diff is no guarantee your push will pass — a dep that was fine yesterday can fail CI today. When it flags a *transitive* dep, pin a patched version with a `pnpm.overrides` entry in `package.json` (exact version, no `^`/`~`, per the supply-chain guardrails above), then `pnpm install` and re-audit. Mirror CI exactly with the `--audit-level=high` flag.

### Keeping dependencies current

Every dependency is **exact-pinned** (no `^`/`~`) with a tracked `pnpm-lock.yaml`, so nothing updates on its own — `pnpm update` is a no-op and `pnpm install` only ever reproduces the lock. That is deliberate: reproducible installs plus a human review checkpoint on every supply-chain change. The cost is that staying current is a manual, periodic chore. Treat it as **two separate concerns**:

- **Security (automated, reactive).** `pnpm audit --audit-level=high` runs first in CI on every push and is now a pre-commit step (above). It catches *disclosed* high/critical advisories with no effort on your part. Two limits: it only fires once an advisory is published (a latent vuln in a pinned version can sit for years, then fail CI the day it's indexed), and the `high` gate hides medium/low — run bare `pnpm audit` occasionally to see those. The proactive complement is `.npmrc`'s `minimum-release-age=604800` (7-day cooldown), which blocks freshly-published — possibly compromised — versions.
- **Staleness (manual, periodic).** Nothing automates this. Run `pnpm outdated` on a cadence — **monthly or quarterly** is plenty for this dev-only set. To bump one: edit the exact version in `package.json` → `pnpm install` → diff the lockfile and skim the changelog/`postinstall` (per the supply-chain guardrails below) → run the full gate (`pnpm lint && pnpm typecheck && pnpm lint:webext && pnpm test:fast`) → commit.

**Why the stakes are low:** the package has **no runtime dependencies** (no `dependencies` key; the shipped extension vendors its own `zip.js`). Every dep is dev-tooling, so an advisory or a stale version can at worst affect the build/test machine — it cannot reach a user's browser. `pnpm audit` here protects your dev environment and guards against supply-chain tampering, not shipped code.

**Dependabot is configured ([`.github/dependabot.yml`](.github/dependabot.yml)) for security only.** Version-bump PRs are suppressed (`open-pull-requests-limit: 0`) so they don't fight the hard-pin policy; security-fix PRs are grouped. This requires the repo toggle — **Settings → Code security → enable "Dependabot alerts" and "Dependabot security updates"** — which is what actually turns the feature on (a committed file can't). It closes the one gap in `pnpm audit`: advisories disclosed *between* your pushes still notify you. Note Dependabot can only auto-fix a *direct* dep; a transitive advisory (like the `shell-quote` precedent) it can only **alert** on — you still apply the `pnpm.overrides` fix by hand.

### Security-boundary changes require explicit acknowledgement

The following classes of change loosen a security boundary and **must** be called out in either an `audit/` doc or the PR/commit description before merging:

- **CSP changes** in `webextension/manifest.json` — any directive widening, including adding wildcards like `https:` or `*` to `connect-src`, `img-src`, `style-src`, etc.
- **New required permissions** in `webextension/manifest.json` (`permissions` array). Optional permissions are fine; promoting optional → required is a boundary change.
- **Allow-list additions** in `webextension/export.js` (the restore allow-list grows).
- **Removing URL/protocol validation** anywhere (`isValidURL`, the `safeProtocols` allow-list in `export.js`, the `safeHexColor` / `safeBackgroundUrl` regexes, etc.).
- **Adding `style.X = template + userInput + template`** patterns where the template includes CSS that consumes URLs (`url(...)`, `background`, `background-image`, etc.). Always prefer `style.setProperty('--var', validatedValue)` over interpolating into a shorthand.

For each, the commit message or PR description must state: (a) what boundary moved, (b) why the previous boundary was inadequate, (c) the new threat model, (d) what compensating control (if any) replaces the removed defence-in-depth. The test suite cannot detect a *widened* CSP (it permits more, not less), so this is a human-review gate.

Precedent: the 2026-05-04 audit's tightened CSP was silently widened to `connect-src https:` in a Phase 3/4 feature commit and only caught in the 2026-05-31 review (then reverted — see [`audit/2026-05-31-csp-tightening.md`](audit/2026-05-31-csp-tightening.md)). The checklist above would have caught it at commit time.

### AI Coding Assistants

Contributions generated with the help of AI are welcome but must follow the standard development process. The test harness with unit tests and E2E tests MUST be used extensively to validate AI generated code. These are the important guardrails to ensure agentic compliance with the project's code quality standards.

- **Human Accountability:** The human submitter is responsible for reviewing all AI-generated code, ensuring license compliance, and taking full responsibility for the contribution. AI agents MUST NOT add `Signed-off-by` tags.
- **Attribution:** Mentioning AI assistance in commit messages is optional.
- **Supply-chain guardrails:** When AI-assisted contributions touch `package.json`, `pnpm-lock.yaml`, or build/test scripts, the human submitter is specifically responsible for: pinned versions on new deps (no `^` / `~`); diffing the lockfile to spot unexpected new transitive deps and source-URL changes on existing ones; reading any `postinstall` scripts before installing; cross-checking new dep names against npm registry stats (download volume, last publish date, listed maintainers) to catch typo-squats. The `minimum-release-age=604800` (7 days) setting in `.npmrc` — enforced because the project pins pnpm via `packageManager` and rejects npm/yarn in `scripts/check-pnpm.js` — is the floor, not a substitute for review.

### Key Files

- [`webextension/manifest.json`](webextension/manifest.json): The core extension manifest (MV2).
- [`webextension/newTab.xhtml`](webextension/newTab.xhtml): The markup for the new tab page UI.
- [`webextension/newTab.js`](webextension/newTab.js): The primary controller script for the UI.
- [`TESTING.md`](TESTING.md): The canonical guide for testing and workflow rules.
- [`ROADMAP.md`](ROADMAP.md): Direction, scope/non-goals, backlog, and the load-bearing decisions of record.
- [`MV3_MIGRATION.md`](MV3_MIGRATION.md): The Manifest V3 migration plan (next major stage) + forward-compat directives for new code.
