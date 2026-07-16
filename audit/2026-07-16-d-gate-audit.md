# D-Gate Audit — 3.0.0 Dual-Store Release (Firefox AMO + Chrome Web Store)

**Date:** 2026-07-16
**Scope:** `v2.5.0..HEAD` (branch `chrome-port`, HEAD `d3f7d74`) — 27 commits, 95 files,
+4,826/−1,531. The Chrome-port program (arcs D1–D6 + D5b) plus issue fixes #9,
#10, #13, #14, #17. Standing security boundaries re-verified full-tree regardless
of the diff (precedent: `audit/2026-05-31-csp-tightening.md` — a boundary regressed
silently inside a feature commit).
**Methodology:** Agentic audit. Orchestrator + five parallel specialist finders
(security boundaries; Chrome threat model; Firefox-unchanged proof; delta code
review; build/supply-chain), each finding independently cross-checked by the
orchestrator; the two highest-severity restore/messaging findings verified by
adversarial dynamic probes against real Chrome for Testing 151. All suites run,
not trusted.
**Gate semantics:** Advisory (maintainer decision 2026-07-16). This report assigns
severities and flags which findings it would consider gate-blocking; it makes no
binding go/no-go.

---

## Executive summary

The Chrome port is functionally sound and the security posture is intact. **No
BLOCKER was found** — no active XSS, no active privacy leak, no data loss, no
Firefox behavior regression, no supply-chain vector into the shipped artifact, and
no widened security boundary. Every dynamic claim on the CHROME.md board
reproduced independently:

| Suite | Board | Reproduced (this audit) |
|---|---|---|
| Firefox E2E | 126/126 | **126/126** (32 files, exit 0) |
| Chrome E2E parity | 126/126 | **126/126** (32 files, exit 0, CfT 151) |
| Chrome smoke | 11/11 | **11/11** (solo; see IND-1) |
| Unit + integration | — | **1417 pass** |
| lint / typecheck / `pnpm audit --high` | — | **all clean** |

The findings that matter for 3.0.0 are a mix of one **re-opened prior finding**, a
**test-integrity gap**, a **Chrome-Web-Store documentation/process risk**, and a
cluster of restore/messaging **robustness defects** at the extension's own trust
boundaries. None blocks the code from shipping; several are cheap and worth doing
first. Full detail below.

### What I would flag as gate-blocking (advisory)

- **B-2 (CWS docs/process)** — `PRIVACY.md` is Firefox-worded; the CWS listing needs
  a consistent privacy policy + per-permission justification for `<all_urls>` +
  `webRequest` + data-use disclosure for locally-stored page screenshots. A CWS
  rejection is a de-facto failure of the "ships to both stores" gate. **Resolve
  before CWS submission (D7).**

### What I would fix before 3.0.0 but would not block on

- **D-1** — the 2026-07-13 blob-URL leak fix is **incomplete** (re-opened finding).
- **B-1 / B-3** — one-line guards each; a latent privacy landmine and a message-wire
  hang.
- **D-2** — two lines; stops the SW-respawn suite from ever passing vacuously.

---

## Domain verdicts

| Domain | Verdict |
|---|---|
| A — Security boundaries (full-tree) | **PASS** — all five boundaries intact/unchanged since v2.5.0; two MINOR restore value-gaps |
| B — Chrome threat model | **PASS** on the potential BLOCKER (incognito auto-capture); one MAJOR-latent + one MAJOR-process + MINORs |
| C — Firefox-unchanged | **PASS** — no regression; invariant is suite-equivalence, six intentional issue-fixes are Firefox-live and covered |
| D — Delta code review | **PASS with two MAJORs** — incomplete leak fix; vacuous-pass test gap |
| E — Build / supply chain | **PASS** — no vector into the shipped artifact; one MINOR, advisories |

---

## Findings (consolidated, most-severe first)

Severity: BLOCKER (none) · MAJOR (fix strongly recommended) · MINOR (fix worth
doing) · ADVISORY (hardening/polish). "CONFIRMED" = verified by code trace or
execution; "SUSPECTED" = plausible, needs one manual reproduction.

### MAJOR

**M1 [CONFIRMED] — The 2026-07-13 blob-URL leak fix is incomplete; `Updater._removeLegacySites` orphans Sites without `destroy()`.**
`webextension/updater.js:176-200` fades out and `node.remove()`s each departing
Site but never calls `site.destroy()`. The e294df8 remediation landed only on the
`Grid.refresh()` path (`grid.js:91-99`). `Updater.updateGrid()` — which runs
`_removeLegacySites` — is the path for unpin (`site.js:230`), block/remove
(`site.js:258`, undo-dialog), drag-drop (`drag-drop.js:275`), tile edits
(`newTab.js`), and every cross-page `Page.updateGrid` broadcast. Each tile leaving
the grid via any of these leaks `_thumbnailObjectURL` (a ~600px PNG blob, tens–
hundreds of KB) plus `_faviconObjectURL` until the new-tab document unloads — and
new-tab pages are exactly the long-lived pages here. Same defect class as the
audited finding; the fix was partial. **Fix:** call `site.destroy()` in the
`hideSite` callback before `node.remove()`. (`_moveSiteNodes`'s `removeChild` is
fine — those sites are re-appended.)

**M2 [CONFIRMED logic / SUSPECTED trigger] — SW kill/respawn tests can pass vacuously.**
`tests/e2e/_helpers.ts` (`restartChromeServiceWorker`) and `tests/e2e-chrome/_tools/smoke.mjs:350-353`
both poll for the SW target to disappear after `Target.closeTarget`, but **soft-fail
on timeout**: the "gone" poll falls through silently, then `waitForTarget` matches
the never-killed worker and reports "respawned"; the `storage.session` survival
check then trivially passes. If a CfT update changes `Target.closeTarget` semantics
for SW targets (the code comments already note `ServiceWorker.stopAllWorkers`
"accepts the call but leaves the worker running" — precedent), the suite's most
safety-critical Chrome claim goes green proving nothing — the "sleep that ages
nothing" near-miss class, one level down. **Fix:** treat "SW still present after the
gone-deadline" as a hard failure (throw) in both places.

**M3 [CONFIRMED gap; active severity reduced by reachability] — The manual-capture path has no incognito guard, and the popup Capture button is inert.**
`lib/messages.js:221-225` (`Thumbnails.capture`) calls `startCaptureSession(sender.tab…)`;
`startCaptureSession` (`lib/capture.js:246-269`) enforces `<all_urls>` and
`NeverCapture` but **not** `tab.incognito`. The incognito guard exists only on the
automatic path (`lib/background-main.js:131-134`), before its `startCaptureSession`
call. So the privacy invariant is enforced at exactly one of two call sites.
Reachability: the sole `Thumbnails.capture` sender is the toolbar popup
(`action.js:36`), and action-popup messages carry no `sender.tab` on either engine
— so today the handler is a **no-op** (the Capture button does nothing; the tile-
level capture was removed with #13). Net: **not an active leak today**, but a
latent privacy landmine for any future/other caller that passes a real (possibly
incognito) tab, plus a confirmed dead feature. No real-browser test drives this
button (jsdom fakes `sender.tab`). **Fix (one line, unconditional):** add the
`tab.incognito` check inside `startCaptureSession` — closes the class for all
callers; separately, make `action.js` resolve the active tab itself (as its Pin
button already does) so the button works, and add a real-browser test.

**M4 [process] — Chrome Web Store review exposure is not addressed.**
Two concrete items a CWS reviewer will challenge, either of which can bounce the
submission (and thus the dual-store gate):
1. **`PRIVACY.md` is Firefox-worded** — "is a Firefox extension" (line 3), Firefox
   Sync (line 31), the `browser_specific_settings.gecko.data_collection_permissions`
   attestation (line 41). CWS requires a policy consistent with the product, plus
   dashboard data-use disclosures: locally-stored screenshots of visited pages and
   `topSites`/history reads plausibly require declaring "web history" / "website
   content" as *collected (not transmitted)*.
2. **`<all_urls>` + `webRequest` + `tabs`** on a new-tab extension is the classic
   broad-permission challenge. A defensible per-permission mapping exists, but
   `webRequest` over `<all_urls>` purely for a network-idle heuristic is the entry
   most likely to draw a "why not `activeTab`?" — pre-write that justification
   (background-tab pending captures are the answer). Also disclose the Mozilla
   wallpaper-catalog `connect-src` in the CWS listing text.
**Fix:** a dual-browser (or Chrome-variant) `PRIVACY.md` and a written permission
rationale before D7 submission.

### MINOR

**m1 [CONFIRMED — probe] — Crafted backup with `"filters": null` persistently hangs the grid when history tiles are enabled.**
`lib/backup.js:159-173` copies `filters` verbatim (no value validation);
`prefs.js:244` gates with `typeof prefs.filters == 'object'`, and `typeof null ===
'object'`, so `Filters._list = null`; `Filters.getList()` (`prefs.js:337`) then runs
`Object.keys(null)` → throws. Reached from `Tiles.getGridTiles()` (`tiles-store.js:134`)
**only when `Prefs.history` is enabled** (an early return at `:126` skips it
otherwise). Per m-D6 the enclosing promise never rejects, so `Tiles.getAllTiles`
hangs and tiles never populate (the grid *skeleton* still renders from layout
prefs — misleading). **Empirically confirmed on CfT 151:** with `history=on` +
`filters=null`, `Tiles.getAllTiles` times out; the valid-filters control returns
normally. Hostile-file-import only, self-DoS, recoverable via reset. Note the
inconsistency: `Blocked._list` one line up (`prefs.js:241`) uses a proper
`Array.isArray` guard. **Fix:** validate `filters` as a non-null plain object at
restore, and harden `parsePrefs` (`prefs.filters !== null && !Array.isArray`).

**m2 [CONFIRMED — probe] — `Thumbnails.get` / `getFavicons` permanently hang the caller on a malformed `urls` payload.**
`lib/messages.js:200,234` call `message.urls.includes(...)` inside the IDB cursor
`onsuccess`; a payload whose `urls` lacks `.includes` throws there, aborting the
transaction so `sendResponse` never fires and the caller's promise never settles.
`getFaviconsByHost` guards correctly (`new Set(message.hosts || [])`); these two do
not. **Empirically confirmed on CfT 151 (with a thumbnail record present):**
`urls` = `123` / `{}` / *absent* all hang; `urls` = a **string** does **not** (it
has `.includes`) and returns an empty map; a valid array works. Same-trust-domain
(only the extension's own pages send), so exposure is a self-inflicted hang.
**Fix:** `if (!Array.isArray(message.urls)) { sendResponse(map); return true; }` in
both handlers.

**m3 [CONFIRMED — analysis] — Large backups fail silently on Chrome (and are a new failure mode on Firefox).**
D2 routes the whole zip as base64 through `runtime.sendMessage` on both platforms
(`lib/backup.js:49-92` → `backup-download.js`). The encode holds ~6-8× the zip
size in the SW, decode ~4× on the page, and Chrome hard-caps runtime messages at
~64 MB. A thumbnail-heavy backup (wallpaper + many custom tile images) can exceed
that; the export then fails, and `requestBackup` ends in `console.error` with **no
user feedback**. Pre-D2 Firefox created the blob URL locally and nothing crossed
the wire. **Fix:** surface a user-visible error; see A-note below (the base64 leg
is now removable entirely). **Fix (better):** structured-clone (Chrome 148 floor,
Decision 10) means a raw `Blob` response now survives the wire on every config
this build installs on — returning the Blob directly deletes the amplification, the
ceiling, and both encode/decode functions.

**m4 [SUSPECTED — needs manual repro] — Backup download now breaks if the new-tab page is closed during the saveAs dialog.**
`backup-download.js:59` creates the object URL in the page document; pre-2.5.0 it
lived in the background event page (survives tab close). Close the new tab while
the saveAs dialog is open → the URL is revoked with the document → "source file
missing". A real Firefox-live consequence of Decision 2a; not automatable (saveAs
blocks the driver). **Fix:** one manual check before D7, or record as an accepted
cost of Decision 2a.

**m5 [CONFIRMED] — Successful re-capture can clobber a stored favicon.**
`lib/capture.js:469-471` does a whole-record `store.put` on the image path; the
favicon-preserving merge only runs on the image-less path. If a revisit captures an
image but `tab.favIconUrl` isn't set yet, the put erases the previously cached
favicon — regressing exactly the data #9/#17 made load-bearing. **Fix:** merge
`favicon`/`faviconUrl` forward from the existing record on the image path too.

**m6 [CONFIRMED] — `Tiles.getGridTiles()` hangs forever on any rejection inside its async `onsuccess`.**
`lib/tiles-store.js:101-184` — the `new Promise(resolve => …)` has no reject path;
any throw after `_ready = true` (e.g. `topSites.get` rejection, or m1's
`Object.keys(null)`) leaves the promise unsettled and `_cache` frozen, so
`Tiles.getAllTiles` never responds and the grid stalls with no surfaced error. The
D3 fix removed one known trigger; the structural trap remains (m1 is a live one).
**Fix:** wrap the handler body in try/catch, reject and reset `_ready` on failure.

**m7 [CONFIRMED] — `pickAndStore` can write a permanent "ghost" thumbnail record with neither image nor favicon.**
`lib/capture.js:456-492` — the favicon-only path stores `{url, stored, used}` when
`fetchFaviconBlob` returns null and `favIconUrl` isn't `http(s)`. `Thumbnails.get`'s
used-refresh keeps touching it daily while on the grid, so idle cleanup never
expires it. Harmless to render, but accumulating junk. **Fix:** bail before the
store write when nothing keepable remains.

**m8 [CONFIRMED] — `_resizeThumbnailDOM` (Firefox path) has no `img.onerror`.**
`lib/thumbnail-image.js:69-88` — an undecodable dataURL leaves the promise pending
forever on Firefox (the Chrome OffscreenCanvas path rejects). Both are fail-safe
(no bogus image stored), so this is a consistency/robustness nit. **Fix:** add
`img.onerror = () => reject(...)`.

**m9 [CONFIRMED — test-only] — Chrome smoke crashes (rather than fails a check) under CPU contention.**
`tests/e2e-chrome/_tools/smoke.mjs:167` evaluates `await page.title()` as an
argument *outside* the try/catch wrapping the `goto`; a transient "execution
context destroyed" navigation race (observed here when the smoke ran concurrently
with the Firefox E2E suite) throws uncaught and fails the whole run. Solo, the
smoke is GREEN 11/11. Undermines the "11/11" signal under the parallel-run workflow
the repo itself recommends. **Fix:** wrap `page.title()` in try/catch or await a
stable readiness signal.

**m10 [CONFIRMED — build] — `scripts/build-uat.mjs:38` uses `npx web-ext`, a latent registry-fetch-and-execute path.**
Runs on every `pnpm build`. In a healthy tree `npx` resolves the pinned local
binary; in a tree with a missing/partial `node_modules` it falls back to fetching
`web-ext@latest` (unpinned, no cooldown) and executing it. Other build scripts call
`web-ext` bare. **Fix:** bare `web-ext` (or `npx --no-install web-ext`).

### Test-coverage gaps

**g1 [CONFIRMED] — No Firefox E2E coverage of the backup *export* half.** Restore is
E2E-covered on Firefox; the only live export round-trip is Chrome smoke. Export is
covered thoroughly at the integration tier. If D2's "full Firefox E2E backup/restore
coverage" call-out is read literally, export doesn't meet it.

### Advisory (hardening / polish — non-blocking)

- **A-note (architecture):** Decision 10's structured-clone + Chrome-148 floor makes
  D2's base64 leg unnecessary — a `Blob` response now survives the wire; returning
  it directly removes m3 entirely. (Fallback existed for pre-148; no longer shipped.)
- **Restore hardening:** `tiles.json = [null]` yields a half-applied restore
  (wallpaper+prefs written before the tiles loop throws at `t.id`) — violates the
  2026-07-09 atomicity contract; pre-validate each element as a non-null object with
  a string `url`. `readZip` has no per-entry size cap (zip-bomb → OOM; pre-existing).
  `backgroundUrl` breakout-prevention is single-layer per writer — add the
  `safeBackgroundUrl` regex inside `parsePrefs`. A crafted tile with an own
  `__proto__` key hits `Object.assign` (`tiles-store.js:172`) — bounded to that one
  object, no global pollution, but a `hasOwnProperty` filter would close it.
- **Unobserved IDB writes:** get-then-put chains issued inside `request.onsuccess`
  (`messages.js:268-279`, `capture.js:476-492`) escape the outer `.catch` on a quota
  failure (unhandled tx abort). Consistent with existing fire-and-forget style.
- **`theme.js:200-207`** `_initThemeColorSchemeRelay` sends without `.catch` →
  unhandled-rejection console noise on reload. Add `.catch(() => {})`.
- **Dead fallback branches:** the "Map degrades to plain object" reads
  (`newTab.js:535,1685,1741`, `titlebar.js:335`) are dead on both shipping configs
  and would not actually work if hit (a Map serializes to `{}`, Blobs don't survive)
  — the comments assert the degrade as current fact; correct the doc.
- **`incognito: "spanning"`** is an acceptable choice, but `manifest/README.md:62`
  should name `background-main.js:132`'s `tab.incognito` check as the actual
  invariant carrier, so a future refactor doesn't drop it as "redundant".
- **Build/CI polish (all non-blocking, no secrets at risk):** GitHub Actions are
  tag-pinned not SHA-pinned; Chrome for Testing is provisioned unpinned ("stable");
  the UAT build promotes `optional_permissions` → `permissions` into `dist/` next to
  the store artifact (manual-mixup risk — consider `dist/uat/`); "DORMANT"/unvalidated
  doc drift in `scripts/build.mjs` and `tests/unit/manifest-authoring.test.ts`;
  `chrome-env.mjs:19-20` cites a test assertion that doesn't literally exist (the
  real guard — `mergeManifest` throwing on any key outside `CANONICAL_KEY_ORDER` — is
  strong; consider a literal `expect(mergeManifest('chrome').key).toBeUndefined()`).
- **`run_chrome_tests.sh`** `eval "$LAUNCH_ENV"` breaks on a repo path with spaces;
  the port wait depends on `nc`. Neither bites the current environment.

---

## Boundary re-verification (PASS detail)

- **CSP / permissions (A):** `webextension/manifest.json` is **byte-identical to
  v2.5.0 except `version`**. CSP is the post-2026-05-31 tight policy — no
  `connect-src` wildcard regression, no `unsafe-inline`/`unsafe-eval`. Permission
  arrays unchanged; `<all_urls>` is in `host_permissions` (user-revocable). No
  `externally_connectable` in any fragment. `chrome.json` omits `menus` per the
  decision of record; otherwise an expected subset (PNG icons,
  `minimum_chrome_version: 148`, `message_serialization: structured_clone`, service
  worker, `incognito: spanning`).
- **Sender gate (A):** `messages.js:109-111` (`sender.id !== api.runtime.id → drop`)
  sits before the dispatch switch, covering all 20 wire handlers before any side
  effect; serialization-independent.
- **Injection sinks (A):** the only `innerHTML` in first-party code is `grid.js:135`
  (`= ''`); no `insertAdjacentHTML`/`outerHTML`/`document.write`/`cssText`. Every
  `style.background*` URL template traces to a validated URL, a page-owned blob URL,
  or the extension's own packaged SVGs. The restore→render defense-in-depth is
  intact: a stored `javascript:`/`data:` tile URL is re-gated to `#` at render
  (`site.js:378-386`).
- **Boundary-acknowledgement compliance (A):** none of the 27 commits touches an
  acknowledgement-mandatory class (no CSP change, no new/widened permission, no
  restore-allowlist change, no removed URL/protocol validation, no new style-URL
  template). The boundary-adjacent changes (D2 base64 wire, structured_clone,
  spanning, static-import reversal) are each documented where they live.
- **Incognito auto-capture (B) — the potential BLOCKER:** verified sound on Chrome
  spanning. `background-main.js:131-134` checks `tab.incognito` before both
  `startCaptureSession` and `addPendingCapture`; incognito tabs never enter
  `pendingCaptures`, so the `onActivated` resume path can't resurrect one. Guard is
  platform-neutral, not reliant on a Firefox-only mechanism. (The gap is only the
  manual path — M3.)
- **Structured-clone integrity (B):** no new boundary. A compromised extension page
  is already same-origin with the SW's IndexedDB; malformed clones grant no new
  capability. No SW-crash vector (a thrown handler logs and closes the channel).
- **Respawn hygiene (B/D):** all listener registrations are synchronous at module
  top level; `pendingCaptures` round-trips `storage.session`; in-memory capture
  state is ≤~2.5 s and self-healing; `lib/db.js` reconnects after connection loss
  (the `onupgradeneeded` early-assignment race is fixed, with a genuine race test).
- **OffscreenCanvas parity (B/D):** identical blankness threshold (tol 5, ratio
  0.97), resize math, and PNG output across the DOM and OffscreenCanvas paths;
  `bitmap.close()` in `finally` on both.
- **Firefox-unchanged (C):** no regression. Six Firefox-visible changes ship
  deliberately (#9, #10, #13, #14, the blob-URL fix, the db upgrade-race fix) plus
  the D2 rearchitecture — all intentional and covered. Chrome-gated hunks resolve to
  the v2.5.0 code on Firefox; the E2E suite was not weakened (only the removed
  #13-feature test is gone).
- **Supply chain (E):** manifest merge is a shallow spread that **throws** on any key
  outside `CANONICAL_KEY_ORDER` (prototype-pollution-safe; dev `key` cannot merge).
  The dev key is public-only and provably excluded from store builds (injected only
  by `stageDevBuild`). Vendored `@zip.js/zip.js` is byte-identical to upstream
  2.8.26 (`HttpReader`/Worker paths are dead code; `useWebWorkers: false`). Zero
  runtime dependencies; **zero dependency changes since v2.5.0** (`pnpm-lock.yaml`
  diff empty). CI holds no secrets and never builds the shipped artifact.

### Needs maintainer input (out of repo-visible scope)

1. Confirm the Dependabot repo toggle (Settings → Code security) is enabled — the
   committed `dependabot.yml` is inert without it.
2. Release-build machine hygiene: the store artifact is built locally (CI never
   packages it), so the maintainer's checkout + `pnpm install --frozen-lockfile`
   state is the trust anchor. Consider a clean-tree pre-upload ritual.
3. AMO/CWS account, signing, and upload credentials — entirely out of repo scope.

---

## D-gate assessment (advisory)

No BLOCKER; no code finding prevents the branch from shipping. The **Firefox**
half of the gate is met on the evidence: suite 126/126 reproduced, boundaries
intact, no regression. The **Chrome** half is functionally met (parity, smoke, and
threat-model all pass) with one process precondition — **M4 (CWS docs/permissions)
should be resolved before the CWS submission**, since a rejection there fails the
"both stores" gate. Recommended before tagging 3.0.0: **M1** (re-opened leak),
**B-1/m2** (two one-line guards), **D-2** (respawn-test integrity). Everything else
is MINOR/advisory and can follow.

---

## Suggested CHANGELOG adjudication block

```
### Fixed
- Blob-URL leak on grid updates: Updater._removeLegacySites now calls Site.destroy()
  before removing departing tiles, completing the e294df8 fix (audit 2026-07-16 M1).
- Thumbnails.get/getFavicons no longer hang the caller on a non-array `urls` payload
  (audit 2026-07-16 m2).
- Backup restore rejects a non-object `filters` value; parsePrefs hardened against
  filters:null (audit 2026-07-16 m1).
- startCaptureSession now skips incognito tabs for all callers, not only the
  automatic path (audit 2026-07-16 M3).

### Changed
- SW kill/respawn harness fails hard when the CDP kill leaves the worker running,
  instead of passing vacuously (audit 2026-07-16 M2).
- PRIVACY.md revised for the dual-store (Chrome + Firefox) release; per-permission
  rationale recorded for CWS review (audit 2026-07-16 M4).
```

---

## Addendum — `/code-review` pass (medium effort, diff-scoped)

A separate medium-effort correctness code-review was run over the same
`v2.5.0..HEAD` diff (8 finder angles: 3 correctness, 3 cleanup, altitude,
conventions; dedup, no verify). It **confirmed** the audit's code findings with no
new correctness bug beyond them, and cleared the conventions angle (no `@ts-ignore`,
no `globalThis` bridges introduced in the delta). Diff scope correctly excluded the
audit's `updater.js`/`tiles-store.js`-anchored items — those files are untouched by
this branch; M1 stays in scope as an *incomplete fix* the branch introduced (it
added `Site.destroy()` but wired it into only one of the two Site-removal paths).

Eight findings, ranked, with confirmed line anchors:

| # | Sev | Finding | Anchor | Maps to |
|---|---|---|---|---|
| 1 | correctness | `Site.destroy()` wired only into `Grid.refresh()`; `Updater._removeLegacySites` still leaks | `grid.js:97` / `site.js:573` (missed caller `updater.js:189`) | M1 |
| 2 | correctness | image-path `store.put(record)` clobbers a prior favicon when the session saw none | `capture.js:470` | m5 |
| 3 | correctness | non-array `urls` (`123`/`{}`/absent — not a string) throws in the cursor callback → caller hangs | `messages.js:234`, `:200` | m2 |
| 4 | test-coverage | SW-respawn "gone" poll soft-fails → kill/respawn tests can pass vacuously | `_helpers.ts:628`, `smoke.mjs:350` | M2 |
| 5 | correctness | favicon-only path can persist an image-less/favicon-less ghost record that never expires | `capture.js:490` | m7 |
| 6 | correctness | large-backup export fails silently (no user feedback) over Chrome's ~64 MB message cap | `backup-download.js:103` | m3 |
| 7 | simplification | base64 backup leg now unnecessary — structured_clone (Chrome-148 floor) lets a `Blob` response cross the wire | `backup.js:83` | A-note |
| 8 | correctness | `Theme.colorScheme` relay sent with no `.catch` → unhandled rejections on reload/startup | `theme.js:203` | advisory |

The code-review's line anchors are the authoritative ones for remediation. The
simplification finding (#7) is the one item the security-focused audit had only
noted in passing; the rest reinforce the audit's severities.

---

*Deliverable of the 2026-07-16 D-gate agentic audit (code-review addendum
2026-07-17). Findings adjudicated by the maintainer into `CHANGELOG.md`; see
`git log v2.5.0..HEAD` for the reviewed range.*
