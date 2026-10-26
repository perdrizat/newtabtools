# 2026-10-26: console output via Firefox stdout

**Question.** BiDi never delivers `console` or `pageerror` events for
`moz-extension://` pages (NOTEBOOK.md section 3), so `loads-cleanly.test.ts`'s
"zero console errors" check passed vacuously on Firefox. Can Firefox's
console-to-stdout prefs replace the events?

**Method.** `run.mjs` launches web-ext (`--verbose`, which relays Firefox's
stdout/stderr) with the prefs set, opens the new-tab page, emits markers via
`console.error`, `console.log`, an uncaught exception and an unhandled
rejection, and checks which reach the output.

**Result.**

| Prefs set | console.error / .log | uncaught exception / rejection |
|---|---|---|
| `devtools.console.stdout.content` | delivered | delivered |
| `devtools.console.stdout.chrome` | missing | delivered |
| both (ESR 153.5.1 and release 158.0.1) | delivered | delivered |

Line shapes in web-ext's verbose output:

```
[...web-ext/lib/firefox/index.js][debug] Firefox stdout: console.error: "ntt-exp-console-error"
[...web-ext/lib/firefox/index.js][debug] Firefox stderr: JavaScript error: moz-extension://<uuid>/newTab.html, line 4: Error: ntt-exp-uncaught
JavaScript error: moz-extension://<uuid>/newTab.html, line 5: Error: ntt-exp-rejection
```

A chunk can carry several lines, so only the first has the web-ext prefix;
match on `console.error:` / `JavaScript error:` anywhere in a line.

**Decision: adopted.** The Firefox E2E hook sets
`devtools.console.stdout.content=true`, runs web-ext with `--verbose` and
writes its output to `tests/e2e/_artifacts/firefox/browser.log`.
`loads-cleanly.test.ts` reads the lines written while it opens the page
(`firefoxConsoleErrorsSince` in `tests/e2e/_helpers.ts`). The check now covers
background-page errors as well, since they land in the same log.
