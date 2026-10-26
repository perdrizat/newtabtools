# Firefox Test-Tier Remediation Plan (rev 2 — evidence-based)

**Date:** 2026-09-06
**Status:** root cause proven by probe; fix strategies partly verified, partly open.
**Supersedes rev 1**, whose diagnosis was wrong on both tiers (see "What rev 1 got wrong").

> **Superseded 2026-10-26** by [`tests/compat/NOTEBOOK.md`](../tests/compat/NOTEBOOK.md): the system-access flag does lift the navigation restriction (verified on 153.5.1esr and 154+); the remaining release-only failures are the `input.setFiles` privileged-scope gate.

---

## Root cause (one cause, both tiers)

Firefox's Remote Agent now **refuses driver-initiated navigation to
`moz-extension://` URLs**:

```
Protocol error (browsingContext.navigate): unsupported operation
Navigation to "moz-extension://<uuid>/newTab.html" is not allowed in this context
  UnsupportedOperationError@chrome://remote/content/shared/webdriver/Errors.sys.mjs:961
  navigate@chrome://remote/content/webdriver-bidi/modules/root/browsingContext.sys.mjs:1400
```

Reproduced directly (`.tmp/ff-boot-probe.mjs`). The page stays on `about:blank`
(`hasChrome: false`, `bodyLen: 0`) — which is exactly the blank white failure
screenshot at `tests/e2e/_artifacts-ff/grid-not-ready.png`.

### Upstream cause — identified and dated

**[Firefox bug 1579790](https://bugzilla.mozilla.org/show_bug.cgi?id=1579790) —
"Disallow navigation to privileged pages (certain `about:*` pages, `chrome://`,
`resource://`) from content scope"** — RESOLVED FIXED, landed in **Firefox 153**.

Documented in the
[Firefox 153 release notes for developers](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/153)
under *WebDriver conformance (WebDriver BiDi, Marionette) → General*:

> Restricted navigation to privileged pages (certain `about:*` pages,
> `chrome://`, and `resource://` URLs) when operating in content scope.
> (Firefox bug 1579790).

**Why `moz-extension://` is caught even though the note never names it:** the
implementation is an **allowlist, not a denylist** — only `http`, `https`,
`file` and `about:blank` are permitted for driver-initiated navigation in
content scope. Every other scheme, `moz-extension://` included, is refused. The
release note enumerates the *motivating* schemes, not the effective scope, which
is why a reader checking "does this affect us?" against the note would conclude
(wrongly) that it does not.

**This dates the breakage precisely.** The suite last passed on Firefox 152;
anything ≥ 153 refuses. That is the whole story — no local, profile, or
harness change is implicated.

### The documented opt-in does NOT lift it (tested)

Bug 1579790's stated escape hatch is starting Firefox with
`-remote-allow-system-access`. **Probed, and it does not help.** The flag was
verified as actually reaching the browser (confirmed on the live process line:
`… --remote-debugging-port 9224 -headless -remote-allow-system-access`), and
navigation to `moz-extension://` was still refused with the identical error.
Both `-` and `--` spellings were tried.

Interpretation: `-remote-allow-system-access`
([bug 1944565](https://bugzilla.mozilla.org/show_bug.cgi?id=1944565)) governs
*parent-process / chrome-context* access, which is a different gate from the
content-scope navigation allowlist. Do not spend more time on this flag.

### Confirmed by bisection against Firefox 152 (2026-09-06)

Downloaded Firefox **152.0.6** (Mozilla release archive; not available in either
apt repo here) and ran the identical probe against the identical working tree:

| Binary | `goto` outcome | Resulting page state |
|---|---|---|
| **152.0.6** | `Navigation timeout of 15000 ms exceeded` | `href: moz-extension://…/newTab.html`, `title: "New Tab"`, `hasRuntime: true`, `bodyLen: 26409`, `hasGrid: true`, **`cells: 9`** |
| 153.2.0esr | `unsupported operation … not allowed in this context` | `href: about:blank`, `hasRuntime: false`, `bodyLen: 0`, `cells: 0` |
| 155.0.1 | `unsupported operation … not allowed in this context` | `href: about:blank`, `hasRuntime: false`, `bodyLen: 0`, `cells: 0` |

Three things this settles:

1. **The version boundary is exactly 152 → 153**, matching bug 1579790's landing
   milestone. Nothing local is implicated.
2. **The 152 failure is a *different* failure** — a load-event timeout, not a
   refusal. Navigation still *happens*; only the `load` event never fires (the
   secondary issue in
   [bug 1959376](https://bugzilla.mozilla.org/show_bug.cgi?id=1959376)). This is
   precisely the quirk `openNewTab`'s 3s-timeout-and-catch was written for, and
   why the harness worked for years.
3. **The bugfixes are conclusively cleared.** The same working tree renders a
   full 3×3 grid (9 cells, 26 KB of DOM) on 152. Nothing in the audit
   remediation affects boot.

### Affects both channels — not the ESR flip

| Binary | `browsingContext.navigate` → `moz-extension://` |
|---|---|
| `firefox-esr` 153.2.0esr (current E2E default) | **REFUSED** |
| `firefox` 155.0.1 (release, UAT target) | **REFUSED** |

The recent `run_esr_tests.sh` change (`firefox` → `firefox-esr`) is a legitimate
enactment of TESTING.md's documented "Firefox ESR trigger" — a ≥152 ESR now
exists (153.2.0esr), so flipping was correct. **Reverting it will not help**;
release 155 fails identically.

### Not caused by the bugfixes

- `pnpm test:fast`: **98 files / 1497 tests, all passing.**
- The refusal happens at the WebDriver protocol layer, before a single line of
  extension code runs — the extension installs fine and its UUID resolves fine.
- Reviewed the production diff (57 insertions across 9 files): every change sits
  inside an event handler or function body, none at module top level, so none
  can prevent boot.

The bugfixes are **cleared** as root cause.

### Why the E2E symptom looked like something else

`_helpers.ts`'s `openNewTab` navigates with `timeout: 3_000` and swallows the
result:

```ts
}).catch(e => { verbose(`[Navigation] Initial goto warning (ignoring): …`); });
```

The comment says this "always times out on moz-extension:// (BiDi issue)" — a
historically true workaround that now **hides a hard protocol refusal**. The
failure therefore surfaces downstream as `Extension runtime not available` or
`Grid not ready`, with the real error visible only at `verbose` level. Every one
of the 32 E2E files fails this way (126/126 tests skipped).

---

## What rev 1 got wrong

| Claim | Reality |
|---|---|
| E2E fails with `Maximum number of active sessions` from accumulated BiDi sessions | Not observed at all. Failure is navigation refusal on the **first** file. No session error appears anywhere in a full run. |
| Fix = singleton browser connection in `_helpers.ts` | Would not help. Also unsound as designed: `vitest.config.js` sets `fileParallelism: false` but **not** `isolate: false`, so each test file gets a fresh module registry — a module-level singleton cannot persist across files. |
| UAT fix = `driver.executeScript('window.location.href = …')` | **Probe-disproven.** That exact approach is denied: `Location.href setter: Access to 'moz-extension://…/newTab.html' from script denied.` Unprivileged script cannot navigate to a non-web-accessible extension URL. |

Rev 1's UAT *symptom* (`UnsupportedOperationError: Navigation to moz-extension://
… is not allowed in this context`) is correct, and is the same Remote Agent code
path — geckodriver/Selenium and BiDi share it. Its proposed *fix* does not work.

---

## Verified strategy results

| # | Strategy | Result |
|---|---|---|
| A | JS `location.href` assignment from `about:blank` | **FAILS** — "Access … from script denied" (cross-origin to a non-web-accessible extension URL) |
| B | `web-ext --start-url about:newtab`, attach to the natively-opened tab | **Inconclusive** — landed on plain `about:newtab` with no override applied (`hasGrid: false`). Almost certainly a *timing* artifact: web-ext opens the start URL before the temporary add-on finishes installing. Worth one more attempt with a post-install trigger before discarding. |
| C | `window.open()` from an already-extension-origin page (same-origin) | **Untested** — blocked by B not yielding an extension page. Same-origin navigation is not subject to the denial that killed A, so this remains the most promising building block. |

---

## Proposed fix — deterministic UUID + native navigation

The insight: **the restriction only applies to driver-initiated navigation.**
Firefox navigating itself (a start URL at launch, a same-origin `window.open`,
the newtab override) is unaffected. So stop asking the driver to navigate.

### Step 1 — pin the extension UUID (independently valuable)

Firefox reads `extensions.webextensions.uuids` as a normal pref. Pre-seed it at
launch in `run_esr_tests.sh`:

```
--pref=extensions.webextensions.uuids={"newtabtools@symlink.ch":"<fixed-uuid>"}
```

Two wins: the origin becomes **deterministic before launch** (so a start URL can
name it), and it **retires the prefs.js scrape entirely** — the harness's most
documented-brittle component (`getExtensionUUID`'s own comment lists three ways a
Firefox upgrade breaks it). Chrome already has this via its committed dev key;
this brings Firefox to parity.

### Step 2 — land on the extension page without driver navigation

In preference order, to be settled by the spike below:

1. **`--start-url moz-extension://<fixed-uuid>/newTab.html`** — Firefox navigates
   itself at startup; no driver involvement. Gives the suite one live extension
   page.
2. **Subsequent pages via same-origin `window.open`** from that page (strategy C)
   — `openNewTab` becomes "ask the existing extension page to open another",
   returning a handle to the new context.
3. **Fallback: real input.** `Ctrl+T` via BiDi `input.performActions` opens a
   genuine new tab, which the `chrome_url_overrides.newtab` override sends to the
   extension page. Input is not navigation, so the restriction does not apply.

### Step 3 — stop swallowing navigation errors

Whatever route wins, `openNewTab`'s blanket `.catch()` must re-throw anything
that is not the known benign load-event timeout. This failure cost a full
misdiagnosis cycle; a hard protocol error must never again present as "grid not
ready".

### Step 4 — apply the same fix to UAT

The daemon's `/navigate` (`browser-daemon.mjs:718`, bare `driver.get(body.url)`)
has the identical problem. Same remedy: pin the UUID, launch Selenium with the
extension page as the start URL, and for in-run navigation use the already-open
extension tab rather than `driver.get`. **Do not** ship rev 1's `executeScript`
workaround — it is probe-disproven.

---

## Open questions / spike list

1. **Does `--start-url` with a pre-seeded UUID actually load?** The single
   highest-value experiment; settles Steps 1–2 together. ~30 minutes.
2. **Does same-origin `window.open` yield a driver-attachable context?** Puppeteer
   must see the new browsing context. Needs verification.
3. ~~**Is there a pref/capability that re-permits driver navigation?**~~
   **CLOSED — no.** `-remote-allow-system-access` is the only documented opt-in
   and it does not lift this restriction (tested; see above). If another pref
   exists it is undocumented; treat as a dead end.
4. ~~**Is this intended or a regression?**~~ **CLOSED — intended.** Bug 1579790
   is RESOLVED FIXED and shipped deliberately as a security hardening (it stops
   a malicious WebDriver client reaching chrome-level pages). It will not be
   reverted, so a permanent harness change is required — waiting it out is not
   an option. **Short-term unblock:** Firefox 152 is the last version that
   permits it; pinning a 152 binary via `$FIREFOX_ESR_BIN` restores the tier
   while the real fix is built, at the cost of testing on an EOL build.
5. **Does classic WebDriver (geckodriver, UAT) refuse identically?** Inferred from
   shared code + rev 1's error text, but not directly reproduced. A daemon-level
   probe (no scenarios, no tokens) would confirm cheaply.

---

## Full-suite proof on Firefox 152 (2026-09-06)

The whole E2E tier was run against the downloaded 152.0.6 binary
(`FIREFOX_ESR_BIN=<path> pnpm test:e2e`) on the current working tree:

- **31/32 files, 125/126 tests passed** (851s).
- The single failure was `favicon-real-sites.test.ts`, which its own header
  declares **NETWORK-GATED** — the only E2E test depending on the public
  internet, skipped on GitHub Actions for that reason, with a documented
  "re-run solo before treating it as a regression" policy (the same file has
  this exact history on Chrome, per its CHROME.md D5b triage note).
- **Solo re-run: PASSED** (37s). So the tier is effectively **126/126 on 152**.

This is the end-to-end confirmation: same tree, same harness, same 126 tests —
green on 152, unable to reach the page at all on 153+. It also gives the audit
remediation bugfixes a real E2E gate, which the blocked tier could not otherwise
provide.

## Immediate status

- **Firefox E2E: blocked on 153+, green on 152.** On ESR 153 / release 155:
  32/32 files fail, 126/126 skipped. On 152.0.6: 126/126 pass.
- **Firefox UAT: blocked** (preflight itself is green — Node/pnpm/Firefox
  155.0.1/geckodriver launch/xpi/fixture/claude CLI/port all OK — so this is a
  navigation problem, not an environment problem).
- **Chrome tiers: unaffected** — `chrome-extension://` navigation via CDP is a
  different code path. Chrome E2E/smoke remain the working validation route while
  Firefox is down.
- **Fast tier: green** (1497 tests), so unit/integration TDD continues normally.

**Recommendation:** treat this as infrastructure, not product. The audit
remediation work is unblocked at the fast tier and on Chrome; do not let a
blocked Firefox tier hold up the bugfix commits, but do not claim the Firefox
E2E gate has been met until this is resolved.

---

## Documentation gap this exposed

`tests/e2e/README.md` "Footguns" and `getExtensionUUID`'s doc comment both
anticipate Firefox-upgrade breakage — but only of the *UUID scrape* format. No
doc anticipated the *navigation* route being withdrawn, and the README's
troubleshooting table maps only version-floor and geckodriver-binary failures.
Once fixed, add the literal string `Navigation to "moz-extension://…" is not
allowed in this context` to the README troubleshooting table with the cause and
the fix, so the next recurrence is a lookup rather than an investigation.
