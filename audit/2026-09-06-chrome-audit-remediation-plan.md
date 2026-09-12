# Audit Remediation Plan (v2.4.0..HEAD) — Revision 2

**Source audit:** `audit/2026-09-06-code-review-v2.4.0-head.md`
**Revised:** 2026-09-06 (rev 2 — corrections + test plan)

## Executive Summary

The audit evaluated the `chrome-port` branch (37 commits ahead of `master`; the
latest code). The codebase is structurally sound and the security boundaries are
intact. It surfaced **10 behavioral findings**, two of which are user-facing
outages on Chrome that must be fixed before 3.0.0.

Rev 2 corrects four defects in rev 1's remediation steps (one of them
net-harmful), restores the audit's original confidence labels, and adds a test
plan for every finding.

### What changed from rev 1

| # | Change | Why |
|---|---|---|
| 9 | **Removed the `pagehide`/`unload` revoke step** | It was backwards — it *causes* the abort it was meant to prevent |
| 10 | **Dropped "move download to the Service Worker"** | Impossible: a Chrome MV3 SW has no `URL.createObjectURL`; that is *why* D2 moved it to the page, and `chrome.offscreen` was explicitly rejected |
| 1 | **Corrected the fallback symbol** | `this._draggedSite` does not exist on `DropTargetShim`; it is `Drag.draggedSite`, set in `Drag.start()`, not `_setDragData` |
| 6 | **Escape unconditionally, and escape `&`** | The `&&`→`||` fix closes the hole but keeps a pointless gate and still never escapes `&` |
| 8, 9, 10 | **Reverted "PLAUSIBLE -> CONFIRMED"** | Rev 1 upgraded these without new evidence; they were deliberately PLAUSIBLE (not constructible from the repo alone) |
| all | **Added a test plan per finding** | The repo mandates red/green TDD, and rev 1 had no test steps at all |

---

## Testing philosophy for this remediation

The audit's central lesson is not that ten bugs exist — it is **why the suites
did not see them**. Two of the three worst findings were masked by harness
fidelity, not missed by coverage:

- **Finding 1** — `tests/e2e/drag-reorder.test.ts` dispatches *synthetic*
  `DragEvent`s. `cell.js:259` reads `if (!event.isTrusted) { Drop.drop(...) }`,
  so a synthetic drop is handled **by a different code path than a real user's
  drop**. `DropTargetShim` — where the bug lives — is unreachable from the test.
- **Finding 2** — `tests/integration/auto-thumbnail.test.ts:812` fabricates
  `sender = { tab: { id: 42, ... } }`. The real popup sender has no `.tab`, which
  is the entire bug. `action-popup.test.ts` asserts only that the message is
  *sent*, never that the handler acts on it.
- **Finding 4** — `tests/e2e/backup-restore.test.ts` covers **restore** only.
  There is no export/download coverage at any tier, which is why a silent
  failure on the whole export path survived.

So a fix without a harness fix leaves the suites green *and still structurally
blind*. Every finding below therefore carries a test plan, with the cheapest
tier that can actually observe the defect named first.

**Cost-benefit rule applied throughout:** prefer an integration test that pins
the exact defect (cheap, deterministic, runs on every save) and add an E2E/UAT
layer only where the integration test cannot see the real failure mode. Do not
buy end-to-end coverage where a unit-level assertion is equally diagnostic.

---

## Keeping the next audit from re-litigating this one

Four items in the source audit were re-raised as new when they were already
known, already decided, or (in one case) simply wrong. The remedy is folded into
each finding's own work below — **there is no separate documentation pass, no
index, and no new comment convention to learn.**

The empirical basis: exactly one place under `webextension/` carries an inline
audit marker (`backup-download.js:88`, *"audit m3: this used to fail
silently"*). The auditor read it and scoped finding 10 correctly, including its
existing mitigation. The two findings whose knowledge lived only in `CHROME.md`'s
manual checklist (F2, F9b) came back as false-new. Marker present → accurate
finding; marker absent → re-raised.

So the rule is simply **extend the style already in the tree** (`(audit <ref>: …)`)
— nothing to define, and `grep -rn "audit " webextension/` enumerates the set.

What carries what:

- **Fixed behaviour → the test is the record.** F1, F3, F4, F5, F6 get no prose.
  A passing test states the contract better than a comment, and cannot rot
  silently.
- **Empirically established platform facts → one comment, with date and
  verdict.** Only F8. A test pins the *behaviour*; it cannot say "we probed
  Chrome 151 and it reports seconds", which is precisely the claim a future
  auditor would otherwise re-derive from recollection — wrongly, as this pass
  did.
- **Accepted and deliberately unfixed → one comment at the site, naming the
  rejected alternative.** F9b and F10. These are the only items a test cannot
  cover (that is *why* they are manual), so the code site is the sole carrier.

Total: three production comments and two test-header notes, each landing in the
commit that does the corresponding work.

**Accepted trade-off:** there is then no single place answering "what has been
accepted and why" — it is a grep. With this few items that is the cheaper side of
the trade; revisit only if the set grows past what a grep comfortably shows.

---

## Findings, fixes, and tests

### 1. Tile drag-and-drop is broken on Chrome — CONFIRMED (release blocker)

**Analysis.** `webextension/drag-drop.js:458`, in `DropTargetShim._dragover`,
dereferences the Firefox-only `dt.mozSourceNode` unguarded. On Chrome this throws
a `TypeError` on every trusted `dragover`, before `event.preventDefault()` at
:467. `Drag.drag()` never runs, `Drag._cellLeft/_cellTop` stay undefined,
`_findDropTarget` builds a NaN rect, and the drop never repositions the tile.

**Fix.**
- Guard the `mozSourceNode` deref and fall back to the site the drag already
  tracks: **`Drag.draggedSite`** (the getter at `drag-drop.js:59`, backed by
  `_draggedSite` set in `Drag.start()` at :86).
  Do **not** use `this._draggedSite` — `this` inside `_dragover` is
  `DropTargetShim`, which has no such field; it would silently resolve to
  `undefined` and leave the bug in place.
- Keep the Firefox path taking `mozSourceNode` when present (it is the source of
  truth there), so Firefox behaviour stays byte-identical.

**Tests.**
| Tier | Test | Cost | Buys |
|---|---|---|---|
| Integration (new `tests/integration/drag-drop-shim.test.ts`) | Call `DropTargetShim._dragover` with a `DataTransfer` **without** `mozSourceNode`; assert it does not throw and calls `Drag.drag` with the tracked site. Second case *with* `mozSourceNode` asserts the Firefox path is unchanged. | Low | Pins the exact defect, deterministic, runs in the TDD loop. **Primary regression guard.** |
| E2E (Chrome only) | A trusted-drag variant of `drag-reorder.test.ts` — see "The drag-and-drop testing calculus" below. | Medium | Proves the real user path end-to-end; the only test that would have caught this. |

**Ships with the fix — test-header note.** `drag-reorder.test.ts` already opens
with a header recording the flakiness/quarantine policy. Add the fidelity limit
it omits, so nobody reads that file as proof the drag path works:

```
 * COVERAGE LIMIT: the synthetic `drop` events below are untrusted, and
 * cell.js:259 routes drops to Drop.drop ONLY when !event.isTrusted — so this
 * file never reaches DropTargetShim, the path real users take. It stayed green
 * through a total Chrome drag outage (audit 2026-09-06 F1). Trusted-drag
 * coverage lives in the Chrome-only case below / drag-drop-shim.test.ts.
```

### 2. Toolbar popup "Capture" is a silent no-op — CONFIRMED (known limitation, not a new outage)

**Status correction (rev 2).** The source audit labelled this a release blocker
on the assumption it was an undiscovered outage. It is not new: `CHROME.md`'s
manual-testing checklist already records it — *"Note its **Capture** button is a
known no-op on both engines (audit M3 — action-popup messages carry no
`sender.tab`); the per-tile flow is the real capture path."* The project had
already diagnosed the same root cause and chose to document it with a workaround.
What this audit adds is confirmation plus a cheap fix, not a discovery. Treat it
as **fix-if-cheap**, not a gate — the per-tile capture flow is unaffected.

**Analysis.** `lib/messages.js:229-233` gates entirely on `if (sender.tab)`. Its
sole production sender is the popup (`action.js:37`), and a browser-action popup
is not a tab context, so `sender.tab` is `undefined` on both platforms and
`startCaptureSession` never runs.

**Fix.**
- `action.js` already has `getTab()` (verified at `action.js:14`). Use it to send
  `{name: 'Thumbnails.capture', tabId, windowId, url}`.
- `lib/messages.js` uses `sender.tab` when present, else the payload fields.
- Keep the existing `sender.id` validation as the trust gate — the handler is now
  acting on caller-supplied ids, so that check is load-bearing, not incidental.

**Tests.**
| Tier | Test | Cost | Buys |
|---|---|---|---|
| Integration (`auto-thumbnail.test.ts`) | **Fix the masking first:** add a case with a realistic popup sender (`{id}` only, **no `.tab`**) plus payload ids, asserting `startCaptureSession` is called with them. Keep a tab-sender case for the content path. | Low | Closes the harness gap that hid this. **Primary.** |
| Integration (`action-popup.test.ts`) | Assert the click sends a payload carrying `tabId`/`windowId`/`url` — not merely that *a* message was sent. | Low | Stops the contract silently regressing on the sender side. |

**Ships with the fix — test-header note.** `auto-thumbnail.test.ts:812` fabricates
`sender = { id, tab: { id: 42, ... } }`, which is what hid this. Note it at the
fixture:

```
 * A fabricated `sender.tab` is the CONTENT-script/tab-page shape. Real popup
 * senders have NO `.tab` — assuming otherwise hid the popup Capture no-op for
 * a full release cycle (audit 2026-09-06 F2). Keep the tab-less case below.
```
| E2E | **Not feasible faithfully — see open question Q2.** Opening `action.html` in a tab *populates* `sender.tab`, reproducing the passing case rather than the bug. | — | — |

### 3. Restoring a corrupt backup gives no feedback — CONFIRMED

**Analysis.** `newTab.js:676` sends `Import:restore` with no callback/`.then`/
`.catch`, while `lib/messages.js:331-342` returns `{ok: false, error}`. The only
success signal (`Page.restoreComplete`) never fires on failure, so the user sees
nothing and assumes the restore worked.

**Fix.** Attach a handler; on `!response.ok` surface a localized alert (use the
existing i18n message pattern, and do not dump the raw `error` string into the
UI — log it). Add a `.catch` so a Chrome message-cap rejection is not an
unhandled rejection.

**Tests.**
| Tier | Test | Cost | Buys |
|---|---|---|---|
| Integration | Stub `sendMessage` to resolve `{ok:false,error}`; assert the error UI/alert fires. Second case: stub a *rejection*; assert it is caught. | Low | **Primary.** Covers both failure shapes. |
| E2E (`backup-restore.test.ts`) | Upload a deliberately corrupt zip through the existing file-input path; assert the error surface appears. | Low-Med | The file-upload harness already exists here, so this is cheap and high-fidelity. **Recommended.** |
| UAT (`21-restore.md`) | Extend with a corrupt-file step. | Low | This is exactly the "looks broken to a user" class UAT exists for. **Recommended.** |

### 4. Denying the downloads permission fails silently — CONFIRMED

**Analysis.** `newTab.js:662` passes a zero-arg callback to
`api.permissions.request` and calls `requestBackup()` unconditionally. On denial
the background still returns a valid payload (so the `!response.data` alert does
not fire), then `api.downloads.download` throws on undefined `api.downloads` into
`.catch(console.error)`.

**Fix.** Accept the `granted` boolean; only proceed when true, otherwise surface a
localized message explaining the permission is required.

**Tests.**
| Tier | Test | Cost | Buys |
|---|---|---|---|
| Integration | Stub `permissions.request` to yield `false`; assert `requestBackup` is **not** called and the user-facing message fires. Stub `true`; assert it proceeds. | Low | **Primary.** |
| E2E | **Likely not feasible — see open question Q4.** The permission prompt is browser chrome, not page DOM. | — | — |
| E2E (export path, new) | Independently of the denial case: add a *granted-path* export test. The export/download path currently has **no** E2E coverage at all — see Q3 on the `saveAs` dialog. | ? | Closes the gap that let this class survive. |

### 5. `unpin()` leaves zombie tile records — CONFIRMED

**Analysis.** `site.js:219`'s check
`Object.keys(this._link).some(k => !['id','title','url','position'].includes(k))`
treats `titleIsUserSet` as meaningful data. `newTab.js` persists it as `false` on
the Set-URL (:499-509) and title-remove (:596-602) paths, so unpinning takes the
`putTile` branch instead of `Tiles.removeTile`. `tiles-store.js:176`'s
`Object.assign(next, mapData)` then merges the stale id/title onto future
top-sites entries.

**Fix (altitude note).** Adding `'titleIsUserSet'` to the exclusion list works,
but it is a denylist that rots: the next metadata flag added to a link record
silently reintroduces the identical bug. Prefer inverting it to an **allowlist of
keys that constitute custom data worth keeping** (e.g. `image`,
`backgroundColor`), so new bookkeeping fields are inert by default.

**Open item:** a forward fix does not clean records already zombied in users'
IndexedDB. Decide whether a one-time migration is warranted (see Q6).

**Tests.**
| Tier | Test | Cost | Buys |
|---|---|---|---|
| Integration | Unpin a link carrying `titleIsUserSet: false`; assert `Tiles.removeTile` ran and the record is gone. Add a case with real custom data (`backgroundColor`) asserting the record is **kept** — the allowlist must not over-delete. | Low | **Primary.** Both directions of the boundary. |
| E2E | Pin a tile, edit its title, unpin, reload; assert it does not resurrect with the stale title. | Low-Med | Catches the user-visible symptom (`pin-persists.test.ts` is the pattern to copy). **Recommended.** |

### 6. Drag HTML-escape condition — CONFIRMED (pre-existing)

**Analysis.** `drag-drop.js:191`: `if (url.includes('"') && url.includes('<'))`.
A URL with only a double-quote is interpolated raw into the `text/html` flavor at
:194, breaking out of the `href` attribute. `&` is never escaped on any path.

**Fix.** Delete the condition entirely and escape unconditionally — there is no
reason to gate escaping on a substring test. Escape `&` **first**, then `<`, `>`,
`"` (order matters, or `&` re-escapes the entities just inserted).

**Tests.**
| Tier | Test | Cost | Buys |
|---|---|---|---|
| Unit/Integration | `_setDragData` with a quote-only URL, an `&`-only URL, and a `<`-only URL; assert the `text/html` payload is fully escaped in each. | Low | **Primary.** Pure function of input, no browser needed — highest value per unit of cost in the whole plan. |

### 7. Wire codec covers only page→background — CONFIRMED (latent)

**Analysis.** `lib/platform.js:71`'s Proxy does a bare `Reflect.get` with no wire
wrap, so `broadcastToPages` (:304) bypasses the codec; on the page,
`wrapRuntimeForWire` intercepts only `sendMessage`, so `onMessage`
(`newTab.js:1810`) receives undecoded messages. Safe today only because
`broadcastToPages` takes a bare `@param {string} name`.

**Fix.** Prefer wrapping both remaining directions (`wrapHandlerForWire` is
already direction-agnostic). If that is deferred, the guard must be a **test**,
not a comment — a comment does not fail a build when someone later adds a payload.

**Tests.**
| Tier | Test | Cost | Buys |
|---|---|---|---|
| Integration | Round-trip a `Map`/`Blob` payload background→page through the codec and assert it reconstructs. If the wrap is deferred: a guard test asserting `broadcastToPages` accepts only a name-shaped argument, so adding a payload turns the suite red. | Low | Converts a latent trap into a build failure. **Primary.** |

### 8. Recently-closed age chips on Chrome — CONFIRMED by probe (2026-09-06)

**Probe result (Chrome 151.0.7922.34, headless, staged dev build).** Ran
`sessions.getRecentlyClosed({maxResults:10})` from the extension's own
`newTab.html` after opening and closing two tabs. Verbatim:

```
sessionKeys : ["lastModified", "tab"]
tabKeys     : [active, autoDiscardable, discarded, favIconUrl, frozen, groupId,
               highlighted, incognito, index, lastAccessed, pinned, selected,
               sessionId, title, url, windowId]        <-- NO lastModified
lastModified: 1788717109   (now = 1788717110828)
               delta-if-seconds = 2s | delta-if-ms = 1786928394s  => SECONDS
```

Two conclusions, one of which **contradicts the assumption this plan was
previously written against**:

1. **Location differs — confirmed.** `lastModified` is on the **Session**, and
   the Chrome Tab object carries **no** `lastModified` at all. So
   `titlebar.js:251`'s `item.tab` destructure yields `undefined`, the
   `if (!lastModified) return ''` guard at :145 fires, and every Chrome
   recently-closed card silently loses its age chip. The user-visible symptom is
   a **missing chip, not a wrong one**.
2. **Units do NOT differ — Chrome reports SECONDS, same as Firefox.** The earlier
   claim that Chrome uses milliseconds is **false**. Had we implemented rev 1's
   "normalize ms to seconds" step, we would have divided an already-seconds value
   by 1000 and dated every Chrome chip to ~20 days ago — a worse bug than the one
   being fixed. The probe paid for itself here.

**Fix — now trivial.** No unit conversion, no magnitude heuristic, no `api`-seam
wrapper needed; this is a one-line read-location fallback:

```js
let lastModified = item.tab?.lastModified ?? item.lastModified;
```

Order matters deliberately: **tab first** keeps the Firefox path reading exactly
the value it reads today (byte-identical, per the "Firefox MUST NOT change"
constraint), and the Session fallback only engages where the tab field is absent
— i.e. Chrome.

**Ships with the fix — the one "verified fact" comment.** Extend the `SessionTab`
typedef block at `titlebar.js:49-53`, which today documents only the Firefox
shape:

```js
 * Chrome puts `lastModified` on the Session, not the tab, and reports it in
 * SECONDS — same units as Firefox, NOT milliseconds (audit 2026-09-06 F8:
 * probed on Chrome 151, `.tmp/q5-sessions-probe.mjs`). Do not "fix" this by
 * dividing by 1000; that dates every Chrome chip ~20 days into the past.
```

This is the single claim the test cannot make. The test proves both shapes yield
a chip; only the comment records *why* no unit conversion is present, which is
exactly what a future auditor would otherwise re-derive from recollection — and
get wrong, as both this audit and rev 1 of this plan did.

**Tests.**
| Tier | Test | Cost | Buys |
|---|---|---|---|
| Unit | `_formatAge` is **unchanged** by this fix (units are seconds on both platforms), so no new `_formatAge` test is needed. Instead test the extraction: a Firefox-shaped session (`{tab:{lastModified}}`) and a Chrome-shaped one (`{lastModified, tab:{}}`) both yield a chip; neither regresses to `''`. | Low | **Primary.** Pins the real divergence (location) rather than an imagined one (units). |
| E2E (Chrome, `recent-tabs.test.ts`) | Assert the age chip is non-empty and plausible on Chrome. | Low-Med | The file already exists; this is an incremental assertion. **Recommended.** |

### 9. Backup blob-URL race and page-scoped lifetime — PLAUSIBLE

**Analysis (a) — race.** `backup-download.js:63-65` registers `onDownloadChanged`
*before* `downloadId` is assigned at :68. A terminal event arriving in that window
fails the `delta.id !== downloadId` filter (:55) and is dropped, so
`URL.revokeObjectURL` never runs and the listener persists for the page lifetime.

**Analysis (b) — lifetime.** D2 moved `URL.createObjectURL` to the page because a
Chrome MV3 SW cannot create blob URLs. The URL is now document-scoped with
`saveAs: true`, so closing the page while the dialog is open or the write is in
flight can kill the source — a lifetime v2.4.0's background-scoped URL had.

**Fix.**
- (a) Capture the `download()` promise and await it inside the (async) listener
  before comparing ids, so no terminal event can arrive "too early".
- (b) **Do not add a `pagehide`/`unload` revoke** — that guarantees the abort it
  appears to prevent, and the browser frees document blob URLs on teardown
  anyway. The genuine options are to keep the page alive until the download
  commits, or to accept and document the constraint. Given MV3's limits,
  documenting it is a legitimate outcome; it should be a recorded decision, not
  an oversight.

**Ships with the fix — accepted-limitation comment.** (b) is untestable by
construction, so the code site is its only carrier. On `downloadBackup` in
`backup-download.js`:

```js
 * ACCEPTED (audit 2026-09-06 F9b): this object URL is document-scoped, so
 * closing the page mid-download can kill the source. Unavoidable under MV3 —
 * a Chrome SW has no URL.createObjectURL (CHROME.md D2, which moved this here);
 * chrome.offscreen was rejected in D0 Decision 2. Verified by the manual
 * Save-As step in CHROME.md's checklist, NOT by an automated tier.
 * Do not "fix" with a pagehide revoke — that causes the abort it looks like it
 * prevents.
```

**Tests.**
| Tier | Test | Cost | Buys |
|---|---|---|---|
| Integration | Fire a synthetic `onChanged` **before** resolving the stubbed `download()`; assert the URL is still revoked and the listener removed. | Low | **Primary** for (a) — the race is trivial to force with a stub, impossible to force reliably in a browser. |
| Manual (already in place) | (b) needs **no new work**: `CHROME.md`'s checklist already specifies it verbatim — *"start the export, then close the new-tab page while the Save-As dialog is open — the object URL is page-scoped, so verify the download still completes (or note if it breaks)."* Record the result of that step; that answers (b) empirically. | None | The project already chose manual coverage here. |

### 10. Export backup exceeds Chrome's message cap — PLAUSIBLE

**Analysis.** `lib/messages.js:326` returns the whole zip as one base64 payload
(~33% amplification), no chunking. `requestBackup`'s own JSDoc names the cap as a
known failure mode, mitigated only by a generic alert.

**What actually triggers it (rev 2, measured from the code).**
- Thumbnails are stored at `prefs.thumbnailSize` = **600 px** wide
  (`prefs.js:86`), height capped at 600, encoded by
  `canvas.toBlob(cb)` with **no type argument** — i.e. **PNG**
  (`thumbnail-image.js:86`).
- Retention is **14 days** on the `used` index (`background-main.js:320-322`),
  so the store holds roughly "every site whose tile was used in the last two
  weeks".
- A 600×340 PNG page screenshot runs ~150-400 KB (image-heavy pages more). Zip
  adds essentially nothing — PNG is already compressed. Base64 then multiplies
  by ~1.33.

So the zip crossing the wire is roughly `N_thumbnails × ~250 KB × 1.33`. Reaching
a 64 MB-class cap needs on the order of **150-300 stored thumbnails** — reachable
for a power user with a large configured grid and heavy recent browsing, but not
typical. That is exactly why the audit graded it PLAUSIBLE rather than CONFIRMED.
**I do not know Chrome's exact message cap** (my recollection is 64 MB-ish for a
single `runtime.sendMessage`, possibly higher on current versions) — that number
should be measured, not trusted.

**Consequence when it does trigger:** the export fails with a visible localized
alert (audit m3 already fixed the silent-failure half). No data loss, no
corruption — the user simply cannot export until the profile shrinks.

**Fix — decision (maintainer, 2026-09-06): no chunking.** The rev 1 option "move
download initiation to the Service Worker" is **withdrawn — it cannot work**
(a Chrome MV3 SW has no `URL.createObjectURL`; that is why D2 moved it to the
page, and `chrome.offscreen` was rejected in D0 Decision 2). Chunking is declined
as disproportionate: a new wire contract for an atypical profile size, against a
failure that is already graceful.

**Adopted instead — cheap, no wire change:** measure the encoded payload size in
the background before responding and, above a documented threshold, return a
*specific* error so the alert can name the cause ("backup too large for Chrome —
N MB") instead of a generic failure. A few lines, no contract change, and it
converts an opaque dead end into an actionable message.

**Noted, not adopted:** encoding thumbnails as JPEG instead of PNG would shrink
IndexedDB, the wire, and the backup by roughly 5-10× for photographic pages and
would retire this finding outright — but it changes stored-image quality on
**both** platforms, so it is a product decision, not a bug fix. Flagged for a
separate conversation rather than folded in here.

**Ships with the fix — extend the existing marker.** `backup-download.js:88`
already carries the `audit m3` note about the cap; the missing half is the
rejected alternative, which is what produced rev 1's impossible "move it to the
Service Worker" step. Append:

```js
 * Chunking was declined (audit 2026-09-06 F10): a new wire contract for an
 * atypical profile size, against a failure that is already graceful. And the
 * SW cannot own this — no URL.createObjectURL there (CHROME.md D2); offscreen
 * rejected (D0 Decision 2). Trigger is ~150-300 stored 600px PNG thumbnails.
```

This is the one comment aimed at a *fix proposal* rather than a finding —
it sits exactly where someone writes the wrong plan.

**Tests.**
| Tier | Test | Cost | Buys |
|---|---|---|---|
| Spike (not a test) | Seed a large profile, measure the real ceiling on stable Chrome. See Q7 on whether seeding at that scale is practical. | Med | Turns a guess into a documented limit. Do this **before** deciding on chunking. |
| Integration | Assert the oversize path surfaces the alert rather than failing silently (guards the existing mitigation). | Low | Cheap; keeps m3's fix from regressing. |

---

## The drag-and-drop testing calculus

You previously accepted synthetic-event drag coverage and a quarantine policy,
on the reasoning (recorded in `drag-reorder.test.ts`'s header) that synthesized
DnD in headless Firefox is a known-flaky class and not worth fighting.

**The finding changes that trade-off, and not by degree.** The prior assumption
was that synthetic dispatch gives *weaker but real* coverage of the drag path. It
does not. `cell.js:259` routes drops to `Drop.drop` **only when
`!event.isTrusted`** — so the synthetic test exercises a branch that exists *for
the test*, while `DropTargetShim` (the real user path, and where the Chrome bug
lives) has **zero** coverage. The current test does not merely under-cover the
feature; it produces a false signal of coverage, and it stayed green through a
total Chrome outage.

That justifies spending on trusted-drag coverage now — but only where it is
actually attainable:

- **Chrome (Puppeteer/CDP): feasible.** `puppeteer-core` 25.1.0 supports
  `page.setDragInterception(true)` plus `mouse.dragEnter/dragOver/drop`, which
  dispatch through the browser input pipeline and therefore produce
  `isTrusted: true` events reaching `DropTargetShim`. This is the one test that
  would have caught finding 1. Recommend adding it as an `IS_CHROME`-gated case.
- **Firefox (BiDi): probably not — see Q1.** WebDriver BiDi has no drag
  primitive, and Gecko does not start native HTML5 drags from synthesized pointer
  input. I would not spend more than a short spike here.
- **UAT (either browser): not recommended.** The daemon exposes
  `/click`, `/hover`, `/evaluate` and friends but no drag primitive; adding one
  means Selenium Actions, whose HTML5-DnD support is unreliable in both browsers.
  Cost is high, flakiness likely, and the LLM-judgment tier is a poor fit for a
  precise pointer gesture. Cover Firefox DnD by manual checklist instead.

**Net recommendation:** integration test as the regression guard on both
platforms (cheap, deterministic, catches exactly this bug class), one Chrome E2E
trusted-drag test as the end-to-end proof, no Firefox E2E drag work beyond a
time-boxed spike, and no UAT drag work.

---

## Open questions — resolved 2026-09-06

- **Q1 — Firefox trusted drag under BiDi. RESOLVED: accept Chrome-only.**
  No Firefox drag E2E; the integration test is the cross-platform guard. No spike.
- **Q2 — Popup sender in E2E. RESOLVED: infeasible, integration only.**
  Loading `action.html` in a tab populates `sender.tab`, reproducing the passing
  case rather than the bug. `CHROME.md`'s manual checklist already covers the
  popup.
- **Q3 — Export/download E2E. RESOLVED: no new E2E; already settled policy.**
  Both tiers run **headless** (verified: `run_esr_tests.sh:118` `-headless`;
  `launch-chrome.mjs:111` `headless: true`), and `saveAs: true` requests a
  **native OS dialog** that no driver — CDP, BiDi, or Selenium — can operate;
  headless simply prevents it from appearing rather than making it testable.
  `CHROME.md` already classifies the Save-As download as a manual-pass item for
  exactly this reason. Findings 4, 9 and 10 are covered at integration (where
  they are fully observable — none of them need a file to reach disk) plus that
  existing manual step. **No production UX is changed for testability.**
- **Q4 — Permission denial in E2E. RESOLVED: integration only.** The prompt is
  browser chrome, unreachable from the page context.
- **Q5 — Chrome `sessions` probe (finding 8). RESOLVED 2026-09-06 by probe.**
  Chrome 151: `lastModified` lives on the **Session** (the Tab has no such
  field), and is in **seconds** — same units as Firefox. The suspected
  milliseconds divergence **does not exist**; acting on it would have introduced
  a worse bug. Fix reduced to a one-line read-location fallback. Full result and
  reasoning in finding 8 above. Probe script: `.tmp/q5-sessions-probe.mjs`
  (scratch, gitignored).
- **Q6 — Migration for zombie tiles (finding 5). RESOLVED: forward-only.**
  No cleanup pass; pre-existing zombie records are accepted fallout.
- **Q7 — Finding 10 measurement. RESOLVED by the code analysis above** — the
  trigger is now characterised (~150-300 stored thumbnails) without needing a
  seeded mega-profile. The in-background size check replaces the guess with a
  runtime-reported number.

---

## Sequencing

1. **Harness gaps first** (they are why 1 and 2 escaped): the popup-sender
   integration case, and the `DropTargetShim` integration test. Watch both fail.
   Land the two test-header coverage-limit notes in the same commit.
2. **Release blocker:** finding 1 (the only true gate — finding 2 is a
   pre-documented known limitation, see its status correction).
3. **Silent failures and state bugs:** 3, 4, 5 (5 forward-only, no migration).
4. **Escaping:** 6 (cheapest fix and cheapest test in the plan).
5. **Latent trap:** 7 — wrap both directions, or land the guard test.
6. **Chrome divergences:** 8 (unblocked — one-line fallback, see probe), 9(a).
7. **Fix-if-cheap:** finding 2, plus finding 10's size-check-and-name-the-cause
   mitigation.
8. **Accepted, documented, not fixed:** 9(b) page-scoped blob lifetime (already a
   manual checklist step), 10's underlying cap (no chunking).

**Out of scope for this plan — do not lose it.** The source audit also verified
**8 cleanup findings** (duplicate Chrome stagers with already-drifting docstrings,
the `api` Proxy duplicated across `api.js`/`platform.js`, four copies of host
normalization with four different failure fallbacks, duplicated base64 decode,
UAT env constants re-derived in four files, `newTabURL` in three places,
duplicated Chrome-binary resolution, and the dead Map-fallback branches with
stale comments). They are listed in
[`2026-09-06-code-review-v2.4.0-head.md`](2026-09-06-code-review-v2.4.0-head.md)
"Secondary findings" and are **not** scheduled here — file them as issues. None
block release. The one with a behavioural edge is the dead Map fallbacks: their
comments still assert superseded behaviour ("a Map response degrades to a plain
object"), which actively generates future findings, so it is the best candidate
to fold into finding 7's work.

**Verification gate.** Findings 1, 2, and 8 are Chrome-behaviour claims. The D8
arc exists precisely because Chrome for Testing honoured something branded stable
rejects, so these fixes are not done until they pass on **branded stable Chrome**,
not only CfT. Per the repo rules the full Firefox E2E suite must also prove
Firefox behaviour unchanged, since findings 1, 5, 6, and 9 all touch shared paths.
