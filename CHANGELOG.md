# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [2026-05-03]

### Added

- Established a **Fast TDD Loop** using Vitest and `jsdom`, including initial characterization tests for core utility modules.
- Implemented a robust **E2E Validation Suite** for Firefox ESR using Puppeteer over WebDriver BiDi, with reliable extension loading and state persistence.
- Migrated to **ESLint flat config** with specialized support for legacy scripts, new ES modules, and the E2E test environment.
- Configured **GitHub Actions CI** for automated linting and full test suite validation.

### Removed

- Deleted `BOOTSTRAP.md` following the successful establishment of the test infrastructure.

## [2026-05-02]

### Changed

- Updated @README.md: updated with "New Tab PowerTools" branding and features
- Updated @CONTRIBUTING.md: updated with test automation focus
- Deactivated donation button instead of linking to the original maintainer's donation page
- Updated the GitHub link to the new repository fork
- Updated `CONTRIBUTING.md` to explicitly state the intention of the fork and the initial focus on test automation
- Rewrote `README.md` to reflect takeover-prep state and explicitly outline the high-level features parsed from AMO and the extension's codebase

### Added

- Added @TESTING.md: canonical testing guide, including a guide for installing Firefox ESR on Ubuntu/WSL via the official Mozilla APT repository
- Added `BOOTSTRAP.md`: (Temporary) one-time test infrastructure setup guide.
- Added @ROADMAP.md: deferred decisions about Chrome support and MV3 migration
- Added @FEATURE_SCOPE.md: gap analysis vs. native Firefox
