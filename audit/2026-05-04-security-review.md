# Security Review — Pre-Takeover Assessment

**Date:** 2026-05-04
**Scope:** New Tab PowerTools (continuation fork of New Tab Tools), commit on `master`.
**Reviewer artefacts:** `webextension/manifest.json`, background and foreground JS (`background.js`, `newTab.js`, `fx-newTab.js`, `tiles.js`, `tiles-shim.js`, `prefs.js`, `export.js`, `thumbnail.js`, `action.js`, `common.js`), vendored libs under `lib/`, planning docs (`README.md`, `ROADMAP.md`, `MIGRATION.md`, `FEATURE_SCOPE.md`), CI workflow.
**Mode:** High-level orientation review. No exhaustive code-path enumeration; no dynamic testing; no PoC executed.

---

## 1. Verdict: cautious **GO**

The takeover plan is sound as a software-engineering plan — license-compatible (MPL-2.0 → MPL-2.0), strangler-fig migration with red/green TDD, MV3 deferred behind an explicit gate, AMO republish gated behind a working test suite, and a clear "not for general use until step 8" stance.

Where the plan is thin is **security as an explicit workstream**: there is no threat model, no dependency-audit baseline, no permission-scope-reduction plan, and the migration ledger lists `Test status: None` against the security-relevant paths (restore, pin URL handling, the `runtime.onMessage` boundary).

The codebase carries real but tractable risk. Nothing observed is an automatic no-go for continuation, but at least one issue (stored XSS via the zip restore flow, finding §2.1) should block AMO republish until fixed.

## 2. Findings to fix before AMO republish

### 2.1 Stored XSS via tile URL → `javascript:` href (high)

`webextension/fx-newTab.js:831` does `link.setAttribute('href', url)` with whatever URL is stored in IndexedDB. The pin-URL input is validated (`newTab.js:13`, `isValidURL`), but the **restore-from-zip path is not**: `export.js:114` calls `Tiles.putTile(t)` with arbitrary records parsed from `tiles.json` inside a user-supplied zip.

- Pre-condition: user imports a malicious backup zip via Options → Restore.
- Impact: clicking the tile executes JS in the privileged `moz-extension://` new-tab origin — full `browser.*` API access, full IndexedDB access, persistence across reload.
- Aggravator: `isValidURL` also allows `data:` and `moz-extension:` schemes (`newTab.js:15`), broader than necessary for a "site shortcut."

**Fix sketch:** validate every URL at the boundary it enters the system, not just at the input form. Apply an `http(s)`/`ftp`-only allow-list at restore time and at render time.

### 2.2 Vendored `lib/zip.js` is from 2013 (high)

`webextension/lib/zip.js`, `deflate.js`, `inflate.js`, `z-worker.js` are the 2013 Gildas-Lormeau release with no version pin, no upgrade story, and **they are the parser for an untrusted user-supplied archive** (the restore flow). 13 years of zip-parser CVEs are not represented.

**Fix sketch:** replace with maintained `@zip.js/zip.js` or `fflate`. Establish an SBOM for `lib/` (provenance, version, refresh cadence).

### 2.3 No Content Security Policy in the manifest (medium)

`manifest.json` declares no `content_security_policy`. The MV2 default in Firefox is acceptable, but a tightened `extension_pages` policy (e.g. `default-src 'self'; object-src 'none'; base-uri 'none'`) is cheap and would cap the blast radius of §2.1.

### 2.4 No sender validation in `runtime.onMessage` (medium)

`background.js:102` accepts every message regardless of `sender.id` / `sender.url`. With `<all_urls>` content-script injection (`thumbnail.js`) there's a non-zero attack surface for a hostile page to message the background. Add `sender.id === browser.runtime.id` (and where applicable `sender.envType === 'addon_child'`) at the top of the handler.

### 2.5 Restore writes `prefs.json` verbatim (medium)

`export.js:94` does `chrome.storage.local.set(prefs)` with the parsed JSON. `parsePrefs()` validates known keys at *read* time, but unknown keys land in storage and can be read raw elsewhere (e.g. `export.js:28-32` only deletes a small denylist). Apply schema validation at the restore boundary.

### 2.6 `<all_urls>` host permission + dynamic content-script injection (medium, AMO-relevant)

`background.js:216` calls `chrome.tabs.executeScript({file: 'thumbnail.js'})` on every navigation completing for a URL in the tile cache, under the `<all_urls>` permission. Two concerns:

- **AMO review.** `<all_urls>` is the broadest possible host permission; reviewers will require strong justification for a "new tab page" extension.
- **Privacy.** Thumbnails of authenticated states (banking, webmail, intranet) get persisted in IndexedDB for up to 14 days (`background.js:271`, `cleanupThumbnails`) and **are included in user-exported backup zips** (`export.js:35-42`). A backup the user shares for support, or that ends up in cloud sync, leaks them.

The roadmap already plans to switch from `drawWindow` to `tabs.captureTab` (MIGRATION.md, "Auto-thumbnail"). That change is also the right moment to scope down the permission and add an explicit "what we will not capture" rule.

### 2.7 No SCA in CI (low, easy)

`package.json` uses `^`-ranges; no `npm audit` step in `.github/workflows/ci.yml`, no Dependabot config, no fail-on-high gate. Establish a dependency-audit baseline now, before more deps land in Phase 1.

## 3. Areas to dig deeper if the engagement continues

- **PoC the §2.1 chain end-to-end.** Confirm `javascript:` / `data:text/html` href fires in the new-tab context, what `browser.*` it can reach, and whether persistence survives uninstall/reinstall.
- **Threat model & data-classification doc.** What is *never* captured as a thumbnail (auth flows, HTTP-auth realms, OAuth redirects, strict-CSP origins, post-login states detected heuristically)? Incognito is already excluded (`background.js:210`) — that's the only carve-out today.
- **Schema validation at every trust boundary.** IndexedDB read, zip restore, `storage.local.get`, message payloads. A thin hand-rolled validator (or zod) and characterization tests *before* the strangler-fig rewrite touches these paths.
- **Permission-scope reduction plan.** Concrete path from `<all_urls>` + `tabs` to `activeTab` + tab-scoped capture once `tabs.captureTab` replaces `drawWindow`. Same scrutiny for `optional_permissions` (`bookmarks`, `history`, `downloads`) — the `downloads` request flow is fire-and-forget on success/fail (`newTab.js:359`).
- **CSP + `web_accessible_resources` audit.** Define them as a deliberate decision rather than relying on defaults.
- **AMO publication path security dimension.** ID-transfer vs new-ID is framed in the plan as a user-base preservation question; it's also a security question. ID-transfer inherits every existing user's IndexedDB and prefs (potentially long-stale, possibly tampered). New ID is a clean state.
- **MV2 sunset risk.** Firefox has signalled a multi-year MV2 wind-down. Indefinite deferral is a strategic risk; time-box the gate in `ROADMAP.md`.
- **AI-contribution supply-chain policy.** `CONTRIBUTING.md` invites AI-assisted PRs; add explicit guardrails against typo-squatted deps and prompt-injected build/test scripts.
- **Vendored-lib SBOM.** Beyond `zip.js`: every file under `lib/`, with upstream URL, version/commit, license, refresh cadence.
- **Test backfill for security paths.** Restore, message boundary, tile-URL render, optional-permission flows. These should be the first integration tests written, not the last — they're also good characterization-test candidates because the current behaviour is exactly what we want to pin down before refactoring.

## 4. Suggested integration into the roadmap

The client has indicated they will continue the takeover, focus on characterization tests first, and fold the security priorities into `ROADMAP.md`. A pragmatic ordering:

1. **Phase 1 (now):** characterization integration tests for the four security boundaries (`runtime.onMessage`, zip restore, tile-URL render, optional-permission flows). These are required for §2.1, §2.4, §2.5 fixes and double as the migration safety net the roadmap already calls for.
2. **Phase 1.5 (cheap wins, parallel):** §2.3 CSP, §2.4 sender check, §2.7 `npm audit` in CI. Each is a single-PR change and lowers blast radius for everything that follows.
3. **Pre-republish gate (block step 8 in `README.md`):** §2.1 fixed, §2.2 dependency replaced, threat-model doc landed.
4. **During the auto-thumbnail rewrite:** §2.6 permission scope-down, "what we never capture" rule.
5. **Ongoing:** SBOM, dependency cadence, AI-contribution policy.

## 5. Out of scope for this review

- Dynamic testing / PoC exploitation.
- Exhaustive line-by-line code review of `fx-newTab.js` (1941 lines) and `newTab.js` (1270 lines).
- Review of the test infrastructure itself for security implications.
- Review of `_locales/` content for injection vectors via translated strings.
- Build-pipeline / release-signing review (no build pipeline exists yet; relevant once AMO publishing is wired).
- MV3 migration security implications (deferred per `ROADMAP.md`).
