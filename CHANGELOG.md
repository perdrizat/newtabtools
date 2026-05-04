# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [2026-05-04]

### Added

- **Security review** landed at `audit/2026-05-04-security-review.md`. Result: cautious go for the takeover. Audit findings absorbed into the roadmap.
- **Codebase strategy decided**: cherry-pick + reference rewrite. Recorded in `ROADMAP.md`.
- Created `MIGRATION.md` — **per-feature migration ledger** with current state, strategy, implementation refs, and test status; plus the phasing from foundation through MV3 unblock.
- **Language policy decided**: JavaScript with JSDoc on production, TypeScript on tests, no build step. Recorded in `ROADMAP.md`.
- **Phase 0 security hardening** — the three cheap-win fixes from `audit/2026-05-04-security-review.md`:
  - **CSP** (§2.3) — added `content_security_policy` to `webextension/manifest.json` with `default-src 'self'; object-src 'none'; base-uri 'none'`, plus the `img-src` and `style-src` allow-listings the existing thumbnail and inline-style code requires. Regression test at `tests/unit/manifest.test.js` asserts the key directives stay in place and that `'unsafe-eval'` / `'unsafe-inline'`-in-script-src don't sneak in.
  - **Sender validation on `runtime.onMessage`** (§2.4) — extracted `isAuthorizedSender` to `webextension/lib/messaging.js` with red/green TDD Unit tests (`tests/unit/lib/messaging.test.js`); inline check added at the top of the `background.js` listener so messages from anything other than the extension's own pages are dropped. Behavioural test of the wiring deferred to Phase 1 slot 1 (`runtime.onMessage` boundary characterization).
  - **`npm audit` in CI** (§2.7) — added a `Dependency audit` step to `.github/workflows/ci.yml` running `npm audit --audit-level=high`. 3 pre-existing moderate-severity advisories in dev-stack transitive deps remain visible but below the gate.
  - All checks pass locally: `npm run lint`, `npm run lint:webext`, `npm run test:fast` (29 tests), `npm run test:e2e` (7 tests against Firefox ESR).

## [2026-05-03]

### Added

- Established the **Unit and Integration test tiers** using Vitest and `jsdom`, including initial characterization tests for core utility modules.
- Implemented the **E2E test tier** for Firefox ESR using Puppeteer over WebDriver BiDi, with reliable extension loading and state persistence.
- Migrated to **ESLint flat config** with specialized support for legacy scripts, new ES modules, and the E2E test environment.
- Configured **GitHub Actions CI** for automated linting and full test suite validation.

### Changed

- Harmonized testing terminology across all docs

### Removed

- Deleted `BOOTSTRAP.md` following the successful establishment of the test infrastructure.

## [2026-05-02]

### Changed

- Updated [`README.md`](README.md): updated with "New Tab PowerTools" branding and features
- Updated [`CONTRIBUTING.md`](CONTRIBUTING.md): updated with test automation focus
- Deactivated donation button instead of linking to the original maintainer's donation page
- Updated the GitHub link to the new repository fork
- Updated [`CONTRIBUTING.md`](CONTRIBUTING.md) to explicitly state the intention of the fork and the initial focus on test automation
- Rewrote [`README.md`](README.md) to reflect takeover-prep state and explicitly outline the high-level features parsed from AMO and the extension's codebase

### Added

- Added [`TESTING.md`](TESTING.md): canonical testing guide, including a guide for installing Firefox ESR on Ubuntu/WSL via the official Mozilla APT repository
- Added `BOOTSTRAP.md`: (Temporary) one-time test infrastructure setup guide.
- Added [`ROADMAP.md`](ROADMAP.md): deferred decisions about Chrome support and MV3 migration
- Added [`FEATURE_SCOPE.md`](FEATURE_SCOPE.md): gap analysis vs. native Firefox
