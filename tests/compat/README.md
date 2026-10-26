# Compat tier

Tests the **browser and driver**, not the extension: does each automation
capability the E2E and UAT tiers rely on still work on a given browser
channel? Plan and remaining steps: [`PLAN.md`](PLAN.md). Findings, gates and
the investigation log: [`NOTEBOOK.md`](NOTEBOOK.md).

## Running

```bash
pnpm test:compat                      # every target: firefox-esr, firefox-release
pnpm test:compat firefox-release      # one target (<browser>-<channel>, channels from tests/_browsers/registry.mjs)
pnpm test:compat firefox-release --e2e   # also run the full E2E suite on that channel
pnpm test:compat --accept             # write this run's matrices as the new expectation
```

Each target runs the probe harness ([`harness.test.ts`](harness.test.ts))
through the E2E runner (`tests/e2e/run.sh`, Vitest project `compat`) with
`$NTT_CHANNEL` set, so the same launcher hook starts that channel's binary on
the E2E port. Consequences: it cannot run at the same time as that browser's
E2E suite (the runner lock refuses), and it replaces
`tests/e2e/_artifacts/<browser>/`. `$FIREFOX_BIN`/`$CHROME_BIN` are refused,
because an override would mislabel the matrix.

## Reading the result

Each probe ([`probes/`](probes/), one driver capability each) ends as:

| Result | Meaning |
|---|---|
| `ok` | works |
| `gated` | refused with a known gate error (NOTEBOOK.md sections 1-2) |
| `absent` | never answered, or the event never arrived (NOTEBOOK.md section 3) |
| `error` | anything else |

The run writes `_artifacts/<target>.json` (gitignored) and diffs it against the
committed [`expected/<target>.json`](expected/). Only the result is compared;
the browser version and error wording are context. A known gate that is still
gated passes. Any change fails the run, whether newly gated or newly working.

Every diff gets a dated NOTEBOOK.md log entry, then either `--accept` (the
browser changed and we adapt) or a workaround developed as an experiment.
Don't read a diff and dismiss it.

## Experiments

[`experiments/YYYY-MM-DD-<slug>/`](experiments/) holds dated, throwaway-by-design
scripts that try one workaround against specific versions, each with a
README stating the question, result and decision. An adopted workaround moves
into `tests/e2e/_helpers.ts` or a launcher hook; the experiment stays as the
record.

## Adding a probe

Add an entry to the right `probes/*.probe.ts` file (`{ id, description, run }`,
see [`probes/types.ts`](probes/types.ts)). `run` resolves when the capability
works and throws otherwise; throw `absent: ...` for an event that never
arrived. Then `pnpm test:compat --accept` and commit the updated expectations.
