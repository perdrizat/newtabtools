# Bootstrap

This file is **temporary**. It exists because the repository currently has no test infrastructure. Once bootstrap is complete (see "Definition of done" at the bottom), **delete this file**. The steady-state guide is `TESTING.md` (or `TESTING_AB.md` until the consolidation lands).

## Audience

A new maintainer or coding agent setting up the dev environment for the first time. After the bootstrap is finished, every subsequent change follows Mode A (new code) or Mode B (legacy code) as defined in the testing guide.

## Prerequisites (install on host machine)

These must be present before any of the bootstrap tasks below will work.

| Tool | Version | Why | How to verify |
|---|---|---|---|
| **Node.js** | 20 LTS or 22 LTS | Runs Vitest, Playwright, web-ext | `node --version` |
| **npm** | bundled with Node | Package manager | `npm --version` |
| **Git** | any recent | Source control | `git --version` |
| **Firefox ESR** | match `manifest.json` `strict_min_version` | Used by `web-ext run` for manual dev and by Playwright for E2E. Do **not** use Firefox Release or Nightly — the extension targets ESR. | `firefox --version` (path may vary) |
| **`web-ext` CLI** | latest | Mozilla's official extension dev/lint tool. Install globally: `npm install -g web-ext` (or run via `npx web-ext`). | `web-ext --version` |

Notes:
- On Linux, Firefox ESR is shipped by most distros as a separate package (`firefox-esr` on Debian/Ubuntu). Don't symlink to plain Firefox.
- Playwright bundles its own Firefox build by default, but for **extension loading** we want real Firefox ESR. The Playwright config will point at the system ESR binary explicitly (see step 5 below).
- A Node version manager (`nvm`, `fnm`, `volta`) is recommended but optional. Pin the version in a `.nvmrc` (or equivalent) once the project commits to it.

## One-time repo setup

After cloning:

```bash
git clone <repo>
cd newtabtools
# (no install step yet — package.json comes from step 1 below)
```

The codebase you'll see has no `package.json`, no test directory, and an existing `.eslintrc.js`. Everything below adds to that.

## Bootstrap tasks

Do these in order. Commit each step separately so the scaffold is reviewable.

### Step 1 — Initialize `package.json` and rename ESLint config

```bash
npm init -y
```

Edit the generated file: set `"private": true`, and set `"type": "module"` so tests can use ESM cleanly (the production code in `webextension/` is plain script-tag JS without imports, so this only affects Node-side tooling).

**Important:** The repository has an existing `.eslintrc.js` that uses CommonJS (`module.exports = {...}`). Once `"type": "module"` is set, Node will try to parse `.js` files as ESM and ESLint will crash on its own config. Rename the file before continuing:

```bash
git mv .eslintrc.js .eslintrc.cjs
```

The `.cjs` extension forces Node to keep treating it as CommonJS regardless of the package-level setting.

### Step 2 — Install dev dependencies

```bash
npm install --save-dev \
  vitest \
  jsdom \
  jest-webextension-mock \
  @playwright/test \
  eslint \
  eslint-plugin-webextensions
```

Install `web-ext` globally (or skip and use `npx web-ext` everywhere):

```bash
npm install -g web-ext
```

Update `.gitignore` to cover the new artifacts. Add at minimum:

```
node_modules/
test-results/
playwright-report/
.playwright/
```

Do **not** add `package-lock.json` — keep it tracked so installs are reproducible across machines and CI.

### Step 3 — Add Vitest config

Create `vitest.config.js` at the repo root:
- `environment: 'jsdom'`
- `setupFiles: ['./tests/setup.js']`
- `include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js']`

Create `tests/setup.js` containing exactly:

```js
import 'jest-webextension-mock';
```

That single import wires `browser.*` and `chrome.*` globals into every test (despite the package name, it works fine under Vitest). Do not call any of its exports directly — the side effect on import is the whole point.

Create directories:
```bash
mkdir -p tests/unit tests/integration tests/e2e
```

### Step 4 — Add npm scripts

In `package.json`, add at minimum:

```json
{
  "scripts": {
    "dev": "web-ext run --source-dir webextension/",
    "lint": "eslint webextension/",
    "lint:webext": "web-ext lint --source-dir webextension/",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:fast": "vitest run tests/unit tests/integration",
    "test:e2e": "playwright test",
    "test": "npm run test:fast && npm run test:e2e"
  }
}
```

`test:fast` is the inner TDD loop. `test:e2e` runs at feature completion and on prepare-for-commit.

### Step 5 — Add Playwright config

Create `playwright.config.js` at the repo root configured to launch system Firefox ESR (not Playwright's bundled Firefox) with the unpacked extension loaded. The standard pattern is `firefox.launchPersistentContext()` with the addon path, or driving `web-ext run` and attaching via the remote debugger. Pin the executable path to the system ESR binary.

Set `testDir: 'tests/e2e'`.

Note: Playwright's Firefox extension support has historically been less polished than Chromium's. Expect to spend an afternoon getting the first launch right. Once it works, document the exact invocation in `tests/e2e/README.md` so a future agent doesn't re-discover the same footguns.

**Specific footgun:** Firefox refuses to load unsigned extensions in normal profiles. Local unpacked builds *are* unsigned. To make `launchPersistentContext` accept the extension, pass `firefoxUserPrefs` setting at minimum:

- `xpinstall.signatures.required: false` — only honored on Firefox ESR / Developer Edition / Nightly, not Release. (Another reason to pin to ESR.)
- `extensions.autoDisableScopes: 0` — prevents Firefox from auto-disabling the extension on first launch.

Alternatively, drive everything via `web-ext run` (which manages signing/permissions for you) and have Playwright connect to the running instance via the remote debugger. Pick one approach and stick with it.

### Step 6 — Wire ESLint plugin

Edit `.eslintrc.js` to add `eslint-plugin-webextensions` and enable its recommended ruleset. This catches references to non-existent `browser.*` APIs and Chrome-only namespaces.

### Step 7 — Write the first Layer 1 test

Pick a function that's already pure and needs no refactor. Recommended starting points (both in `webextension/newTab.js`):

- `parseColour` (line 540) — pure string → `{r, g, b}` parser. Has multiple branches (rgb, hsl, #rrggbb, #rgb) and a non-trivial helper (`hue2rgb`). Excellent first test target.
- `isValidURL` (line 13) — pure protocol allow-list check.

Extract one to `webextension/lib/colour.js` (or similar) as a plain ES module export. Write `tests/unit/colour.test.js` with a few characterization-style cases per branch. Confirm the test runs and passes.

This is the only Mode B-style "characterize first" test you'll write outside legacy code, because the function is small enough that capturing current behavior including any edge cases is the point.

### Step 8 — Write the first three E2E smokes

In `tests/e2e/`:

1. **Loads cleanly:** install the extension, open `about:newtab`, assert the page renders with **zero console errors**. This is the most valuable single E2E test — most regressions surface as console errors before they surface as broken UI.
2. **Pin persists:** pin a tile, reload the page, assert it's still pinned.
3. **Settings panel opens:** click the settings toggle, assert the panel is visible; press `Escape`, assert it's hidden.

Three tests is enough to prove the toolchain works end-to-end. Don't try to write the full E2E suite during bootstrap.

### Step 9 — Get green in CI (GitHub Actions)

Set up a CI workflow using GitHub Actions to automatically run the test suite on every push and pull request. 

Create `.github/workflows/ci.yml` with the following minimum structure:
- **Environment:** Ubuntu latest, Node 20 or 22 LTS.
- **Setup:** `npm ci`
- **Linters:** `npm run lint` and `npm run lint:webext`
- **Fast Loop:** `npm run test:fast`
- **E2E Suite:** Install Playwright dependencies (`npx playwright install --with-deps firefox`) and run `npm run test:e2e`.

All checks must pass on a clean clone. The CI environment must use the same Firefox ESR version as defined in `manifest.json` `strict_min_version`.

## Definition of done

Bootstrap is complete when **all** of the following are true:

- [ ] `package.json`, `vitest.config.js`, `playwright.config.js`, `tests/setup.js` exist and are committed.
- [ ] `jest-webextension-mock`, Vitest, Playwright, ESLint, and `eslint-plugin-webextensions` are installed and configured.
- [ ] At least one Layer 1 test exists and passes (e.g. `parseColour`).
- [ ] At least one extracted pure module lives in `webextension/lib/`.
- [ ] All three E2E smokes (loads, pin persists, settings panel opens) pass on a clean clone using system Firefox ESR.
- [ ] CI runs all of the above and is green.
- [ ] `tests/e2e/README.md` documents the Playwright-with-extension launch invocation.

When every box is checked: **delete this file** in the same commit that flips the project from "bootstrapping" to "steady state." Update `CHANGELOG.md` to note the transition. Subsequent work follows Mode A or Mode B per the testing guide.
