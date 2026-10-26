# Compat tier: plan

**Status:** steps 1-3 done 2026-10-26 (Firefox ESR + release probes, console
experiment adopted); steps 4-7 open, tracked in Linear ACK-55. Readying E2E
for the release-channel gates before they reach ESR: ACK-54. How to run:
[`README.md`](README.md).
**Goal:** know within days of a new Firefox or Chrome build whether our test
harness still works on it, and have a place to develop workarounds before the
change reaches the binaries E2E and UAT run on.

## Scope

The compat tier tests the **browser and driver**, not the extension's features.
Feature coverage stays in E2E; compat reuses that suite rather than duplicating
it. Three parts:

1. **Capability probes.** One probe per driver capability we depend on (a
   BiDi/CDP command, an event, a launch flag), run against a real extension
   page. Output is a per-channel matrix, compared against a committed expected
   matrix. A known gate that is still gated is a pass; any diff (newly gated
   *or* newly working) is the signal.
2. **E2E on other channels.** The existing suite, unchanged, run against
   beta/nightly binaries through the runners' existing overrides
   (`$FIREFOX_BIN`, `$CHROME_BIN`). Channels are named the same way as in
   `tests/_browsers/registry.mjs`, whose per-tier `channel` fields the
   compat tier reads as its baseline.
3. **Experiments.** Dated, throwaway-by-design scripts that try a workaround
   against a specific version. Each ends in a notebook log entry; an adopted
   workaround moves into `tests/e2e/_helpers.ts`, and the experiment stays as
   the record.

Out of scope: UAT (costs tokens and is non-deterministic, wrong for a diffable
matrix) and extension feature tests.

## Channels

| Browser | Channels | Provisioning |
|---|---|---|
| Firefox | esr (E2E target), release (UAT target), beta, nightly | `@puppeteer/browsers` (already a `puppeteer-core` dependency; `provision:chrome` uses it), cached under a gitignored dir |
| Chrome | branded stable (E2E target), CfT (UAT target), beta, canary | same; branded stable from the system install |

Nightly and canary are noisy: on demand only, not scheduled.

## Layout

```
tests/compat/
  PLAN.md                  this file
  NOTEBOOK.md              moved from tests/BROWSER-COMPAT.md
  README.md                how to run, how to read a diff
  run.mjs                  per target: E2E runner (NTT_CHANNEL, project compat) -> matrix -> diff
  matrix.mjs               targets, error classification, diff (fast-tier tested)
  harness.test.ts          the `compat` Vitest project: runs every probe, writes the matrix
  probes/*.probe.ts        probes grouped by area (navigation, commands, events)
  expected/<browser>-<channel>.json   committed expected matrix
  experiments/YYYY-MM-DD-<slug>/       dated experiments
  _artifacts/              gitignored: actual matrices, logs
```

Probe files use a `.probe.ts` suffix so no tier's test glob picks them up.
Rather than its own launcher, run.mjs drives the E2E runner: the registry's
`$NTT_CHANNEL` picks the binary and `$NTT_VITEST_PROJECT=compat` the harness.

## Probe format

Each probe is `{ id, description, timeoutMs?, run(ctx) }`; `run` resolves or
throws, and the harness classifies the throw as `gated` (known gate string),
`absent` (timeout or event never arrived) or `error`. Every probe gets fresh
extension pages, a timeout and try/catch, so one hanging command cannot stall
the run. Matrix rows: probe id, result, error string; the header carries the
browser version. Only results are diffed.

Initial probes, from the 2026-10-26 hand-run (`.tmp/zz-probe-capabilities.test.ts`):
navigate to `moz-extension://`, `evaluate`, input actions, `setFiles`,
`setViewport`, `activate`, `captureScreenshot`, `addPreloadScript` (registers
**and** runs), `print`, `handleUserPrompt`, console/pageerror/network events,
`reload`, `pages()` listing, plus the system-access flag itself.

## Commands

- `pnpm test:compat` runs probes on every scheduled channel and prints the diff.
- `pnpm test:compat firefox-beta` runs one channel (`<browser>-<channel>`).
- `pnpm test:compat firefox-beta --e2e` also runs the E2E suite on that channel.
- `pnpm test:compat --accept` rewrites `expected/` from the last run (reviewed in the diff like any other change).

## CI

A separate workflow, `compat.yml`: weekly schedule plus `workflow_dispatch`,
Firefox beta and Chrome beta, probes and E2E. It never gates a merge and
uploads the matrix and diff as artifacts. A new Firefox Beta major has a good
chance of being caught about four weeks before release.

## Ownership rule

Every matrix diff gets a notebook log entry and then either an `--accept`
(expected behaviour changed) or a workaround/experiment. A diff that is only
read and dismissed defeats the tier.

## Steps

1. ~~Create `tests/compat/`; move the notebook and update its links.~~ Done 2026-10-26.
2. ~~Probe harness + `run.mjs` for Firefox ESR and release, system binaries;
   expected matrices; retire `tests/e2e/_debug/`.~~ Done 2026-10-26.
3. ~~Experiment: `devtools.console.stdout.content` for extension pages.~~
   Done 2026-10-26: adopted; `loads-cleanly.test.ts` checks for real on Firefox.
4. Channel provisioning via `@puppeteer/browsers` (beta, nightly). Each new
   channel joins the browser's `channels` in the registry and its env module.
5. Chrome probes (stable, CfT, beta, canary), including the
   `--load-extension` / `installExtension` routes.
6. `compat.yml` scheduled workflow.
7. TESTING.md tier table + CONTRIBUTING.md "After finishing" mention.

Each step follows red/green TDD where it ships code (the harness, the diff
logic); probes themselves are the tests.
