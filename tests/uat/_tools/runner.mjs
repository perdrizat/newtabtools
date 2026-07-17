#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * UAT runner — orchestrates preflight + a long-lived browser daemon + per-
 * scenario Claude headless runs.
 *
 * Flow:
 *   1. Run preflight.mjs; abort if any check fails.
 *   2. Discover scenarios in tests/uat/scenarios/*.md (lex-sorted). Optional
 *      positional args select a subset by slug: `pnpm test:uat 01-restore-dogfood`.
 *   3. Start browser-daemon.mjs (release Firefox + Selenium + environment seed
 *      [history + recently-closed, then extension install]); poll /health.
 *   4. For each scenario:
 *      a. Make tests/uat/artifacts/<slug>/ (mcp-server reads ARTIFACTS_DIR).
 *      b. Spawn `claude -p` with our MCP config + restricted allowedTools.
 *         The MCP server is a thin client to the daemon — the warm browser is
 *         shared across all scenarios; no per-scenario browser launch.
 *      c. Stdin = a runner-injected prologue + the scenario markdown.
 *      d. Capture stdout to <slug>/agent.log; agent writes report.json +
 *         summary.md via Write; screenshots land in <slug>/ via the daemon.
 *      e. After the scenario, POST /reset_extension so the next one starts from
 *         a known NTT state (history is NOT reset — it's the seeded environment).
 *   5. Stop the daemon at run end — in a finally, even if a scenario threw.
 *   6. Write tests/uat/artifacts/report.json aggregating exit codes + timings.
 *   7. Exit 0 if every scenario exited 0; else exit 1.
 *
 * The daemon's lifecycle is per UAT RUN (start at begin, stop at end), so a
 * selective single-scenario run still auto-starts and auto-stops the browser.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newTabURL } from './urls.mjs';
import { parseReport, deriveVerdict, checkName } from './report-verdict.mjs';
import { CHROME_DEV_EXTENSION_ID } from '../../e2e-chrome/_tools/chrome-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const SCENARIOS_DIR = path.join(ROOT, 'tests/uat/scenarios');
const ARTIFACTS_ROOT = path.join(ROOT, 'tests/uat/artifacts');
const FIXTURE = path.join(ROOT, 'tests/uat/newtabtools_knowngood.zip');

// chrome-prep D6: one parameterized runner drives either browser daemon.
// $UAT_BROWSER selects `firefox` (default) or `chrome`; everything below
// (preflight, daemon spawn, scenario loop, MCP env) is shared — only the
// port default, the artifacts-dir suffix, and the newtab origin threaded into
// the scenario prologue differ.
const UAT_BROWSER = process.env.UAT_BROWSER === 'chrome' ? 'chrome' : 'firefox';
const FIREFOX_UUID = process.env.NTT_UAT_UUID || 'e1a2b3c4-d5e6-4789-9abc-def012345678';
const NEWTAB_URL = UAT_BROWSER === 'chrome'
	? newTabURL(CHROME_DEV_EXTENSION_ID, 'chrome')
	: newTabURL(FIREFOX_UUID, 'firefox');

// Each run writes into its own YYYYMMDD-HHMMSS directory so successive runs
// never overwrite each other's screenshots/reports. Screenshots are prefixed
// with the same stamp + scenario label so opening the first and paging through
// browses them in capture order (e.g. 20260603-071342-restore-dogfood-01-grid.png).
// Each run's directory carries an explicit `-ff` / `-cft` browser token
// (matching the E2E `_artifacts-ff` / `_artifacts-cft` dirs) so the two tiers'
// runs are immediately distinguishable when browsing tests/uat/artifacts/.
const RUN_STAMP = runStamp();
const RUN_DIR = path.join(ARTIFACTS_ROOT, `${RUN_STAMP}-${UAT_BROWSER === 'chrome' ? 'cft' : 'ff'}`);
const MCP_CONFIG = path.join(__dirname, 'mcp-config.json');

function runStamp(d = new Date()) {
	const p = n => String(n).padStart(2, '0');
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
const PREFLIGHT = path.join(__dirname, 'preflight.mjs');
const DAEMON = path.join(__dirname, 'browser-daemon.mjs');

const DEFAULT_PORT = UAT_BROWSER === 'chrome' ? 9877 : 9876;
const PORT = parseInt(process.env.UAT_DAEMON_PORT, 10) || DEFAULT_PORT;
const BASE = `http://127.0.0.1:${PORT}`;
// generous: history seed is slow on cold links; Chrome's `--headless=new` does
// fuller rendering (JS/ads/trackers) than Firefox's classic `-headless`, so the
// same seed measurably takes longer per site — verified timing difference, not
// a hang (see daemon-smoke.mjs). Give Chrome double the budget.
const HEALTH_TIMEOUT_MS = UAT_BROWSER === 'chrome' ? 600000 : 300000;

// Scenario agents run on a mid-tier model by default (maintainer decision
// 2026-07-15): visual judgment doesn't need the most expensive model, and a
// full run spawns one `claude -p` per scenario. $UAT_MODEL overrides.
const UAT_MODEL = process.env.UAT_MODEL || 'sonnet';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Restricted allowedTools: only the MCP browser tools + Write (for the agent
// to emit its report + summary to the paths the runner prologue gives it).
const ALLOWED_TOOLS = [
	'mcp__ntt-uat__browser_navigate',
	'mcp__ntt-uat__browser_click',
	'mcp__ntt-uat__browser_hover',
	'mcp__ntt-uat__browser_evaluate',
	'mcp__ntt-uat__browser_capture_tiles',
	'mcp__ntt-uat__browser_file_upload',
	'mcp__ntt-uat__browser_take_screenshot',
	'mcp__ntt-uat__browser_read_screenshot',
	'Write',
].join(',');

async function daemonCall(endpoint, body) {
	const res = await fetch(`${BASE}${endpoint}`, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const json = await res.json();
	if (!res.ok) { throw new Error(json.error || `daemon ${endpoint} -> ${res.status}`); }
	return json;
}

// Read an agent's report.json defensively (it may be missing or malformed if
// the agent crashed). Thin IO wrapper over parseReport (report-verdict.mjs,
// unit-tested): returns whether a usable report exists plus its failed checks,
// observations, and own verdict. `hasReport: false` means the report was
// missing or unparseable — the caller then falls back to the process exit.
function readReport(reportPath) {
	const empty = { hasReport: false, failedAssertions: [], observations: [], reportPassed: null };
	let raw;
	try { raw = fs.readFileSync(reportPath, 'utf8'); } catch { return empty; }
	let report;
	try { report = JSON.parse(raw); } catch { return { ...empty, observations: ['report.json was not valid JSON — see the agent log'] }; }
	return { hasReport: true, ...parseReport(report) };
}

// Render an aggregate human-readable summary.md from the run report (the same
// data report.json carries) — a scenario×verdict table plus a "needs attention"
// section, so a reviewer scans one file instead of N per-scenario reports.
function renderSummaryMd(report) {
	const lines = [];
	lines.push(`# UAT run ${report.runStamp}`, '');
	lines.push(`**${report.passed}/${report.scenarioCount} scenarios passed**${report.failed ? ` — ${report.failed} failed` : ''}.`);
	lines.push(`Started ${report.startedAt}, finished ${report.finishedAt}.`, '');
	lines.push('| Scenario | Verdict | Time | Shots | Failed | Obs |');
	lines.push('|---|---|---|---|---|---|');
	for (const r of report.scenarios) {
		lines.push(`| ${r.slug} | ${r.passed ? '✅ pass' : '❌ FAIL'} | ${r.elapsedSec}s | ${r.screenshots?.length || 0} | ${r.failedAssertions?.length || 0} | ${r.observations?.length || 0} |`);
	}
	lines.push('');
	const attention = report.scenarios.filter(r => !r.passed || r.failedAssertions?.length || r.observations?.length);
	if (!attention.length) {
		lines.push('_All assertions passed; no observations._');
		return lines.join('\n') + '\n';
	}
	lines.push('## Needs attention', '');
	for (const r of attention) {
		lines.push(`### ${r.passed ? '✅' : '❌'} ${r.slug}`);
		for (const a of r.failedAssertions || []) {
			const detail = a.expected !== undefined ? ` — expected \`${a.expected}\`, got \`${a.actual}\`` : '';
			lines.push(`- ❌ **${checkName(a)}**${detail}`);
		}
		for (const o of r.observations || []) {
			lines.push(`- ⚠ ${o}`);
		}
		lines.push('');
	}
	return lines.join('\n') + '\n';
}

// `isDead` returns the daemon's {code, signal} once it has exited, else null.
// Watching it lets us abort the moment the daemon crashes on startup (e.g.
// Firefox/geckodriver can't launch) instead of polling a dead process for the
// full timeout — the difference between a ~1s clear failure and a 300s hang.
async function waitHealthy(timeoutMs, isDead) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const dead = isDead ? isDead() : null;
		if (dead) {
			throw new Error(
				`browser daemon exited before becoming healthy (code ${dead.code}, signal ${dead.signal}).\n` +
				'Its output is above (stdio is inherited). Almost always Firefox/geckodriver could not launch — ' +
				'run `pnpm test:uat:preflight` to diagnose.');
		}
		try {
			const h = await daemonCall('/health');
			if (h.ready) { return h; }
		} catch { /* not up yet */ }
		await sleep(1000);
	}
	// Self-describing timeout: the seed logs its phase per site (`seed p1 11/19
	// …`), so surfacing the last daemon.log line names exactly where startup
	// stalled instead of sending the reader to open the file.
	let lastLine = '';
	try {
		const rows = fs.readFileSync(path.join(RUN_DIR, 'daemon.log'), 'utf8').trimEnd().split('\n');
		lastLine = rows[rows.length - 1] || '';
	} catch { /* log not written yet */ }
	throw new Error(
		`daemon did not become healthy within ${timeoutMs}ms` +
		(lastLine ? ` — last daemon.log line: ${lastLine}` : ' (daemon.log empty/missing)'));
}

// ─── 0. ensure the skill symlink ──────────────────────────────────────────────
// The agent skill is tracked in the UAT directory (tests/uat/uat-scenario.md) so
// it lives with the rest of the tier and is easy to git-track. Claude Code loads
// skills from .claude/skills/, so we keep a symlink there and recreate it if it
// has gone missing (e.g. a fresh clone, or .claude/ was cleaned).
ensureSkillSymlink();

function ensureSkillSymlink() {
	const real = path.join(ROOT, 'tests/uat/uat-scenario.md');
	const linkDir = path.join(ROOT, '.claude/skills');
	const link = path.join(linkDir, 'uat-scenario.md');
	const target = path.relative(linkDir, real); // ../../tests/uat/uat-scenario.md
	try {
		if (fs.existsSync(link) && fs.realpathSync(link) === fs.realpathSync(real)) {
			return; // already points at the tracked skill
		}
	} catch { /* dangling link — fall through and recreate */ }
	fs.mkdirSync(linkDir, { recursive: true });
	fs.rmSync(link, { force: true });
	fs.symlinkSync(target, link);
	console.log(`runner: linked .claude/skills/uat-scenario.md -> ${target}`);
}

console.log(`runner: browser=${UAT_BROWSER}, newtab origin=${NEWTAB_URL}`);

// ─── 1. preflight ─────────────────────────────────────────────────────────────

console.log('\n=== UAT runner: preflight ===\n');
const preflight = spawnSync('node', [PREFLIGHT], { stdio: 'inherit' });
if (preflight.status !== 0) {
	console.error('\nrunner: preflight failed, aborting.');
	process.exit(1);
}

// ─── 2. discover scenarios (with optional slug selection) ─────────────────────

if (!fs.existsSync(SCENARIOS_DIR)) {
	console.error(`\nrunner: scenarios directory not found: ${SCENARIOS_DIR}`);
	console.error('       create tests/uat/scenarios/*.md to define UAT scenarios.');
	process.exit(1);
}

const allScenarios = fs.readdirSync(SCENARIOS_DIR).filter(f => f.endsWith('.md')).sort();

// Positional args = slugs to run (with or without the .md extension). No args =
// run every scenario.
const requested = process.argv.slice(2).map(s => s.replace(/\.md$/, ''));
let scenarios = allScenarios;
if (requested.length) {
	const available = new Set(allScenarios.map(f => f.replace(/\.md$/, '')));
	const missing = requested.filter(s => !available.has(s));
	if (missing.length) {
		console.error(`\nrunner: requested scenario(s) not found: ${missing.join(', ')}`);
		console.error(`       available: ${[...available].join(', ') || '(none)'}`);
		process.exit(1);
	}
	scenarios = requested.map(s => `${s}.md`);
	console.log(`runner: selective run — ${scenarios.length} of ${allScenarios.length} scenario(s)`);
}

if (scenarios.length === 0) {
	console.error(`\nrunner: no .md scenarios found in ${SCENARIOS_DIR}`);
	process.exit(1);
}

fs.mkdirSync(RUN_DIR, { recursive: true });
console.log(`runner: artifacts for this run -> ${RUN_DIR}/`);

// ─── 3. start the browser daemon ──────────────────────────────────────────────

console.log(`\n=== UAT runner: starting ${UAT_BROWSER} browser daemon (port ${PORT}) ===\n`);
const daemon = spawn('node', [DAEMON], {
	stdio: ['ignore', 'inherit', 'inherit'],
	env: { ...process.env, UAT_BROWSER, UAT_DAEMON_PORT: String(PORT), ARTIFACTS_DIR: RUN_DIR },
});

// Record an early exit so waitHealthy can fail fast instead of polling a corpse.
let daemonExit = null;
daemon.on('exit', (code, signal) => { daemonExit = { code, signal }; });

let daemonStopped = false;
async function stopDaemon() {
	if (daemonStopped) { return; }
	daemonStopped = true;
	daemon.kill('SIGTERM');
	await sleep(3000);
	if (!daemon.killed) { daemon.kill('SIGKILL'); }
}
// Belt-and-braces: if the runner itself is interrupted, take the browser down.
process.on('SIGINT', () => { void stopDaemon().then(() => process.exit(130)); });
process.on('SIGTERM', () => { void stopDaemon().then(() => process.exit(143)); });

const startedAt = new Date().toISOString();
const results = [];
let anyFailed = false;

try {
	await waitHealthy(HEALTH_TIMEOUT_MS, () => daemonExit);
	console.log('runner: daemon healthy.\n');

	// ─── 4. run each scenario ─────────────────────────────────────────────────

	for (let i = 0; i < scenarios.length; i++) {
		const file = scenarios[i];
		const slug = file.replace(/\.md$/, '');

		// All scenarios of a run share ONE flat directory (RUN_DIR) so the whole
		// run browses together. Every file leads with the time it was CREATED, so
		// a strict filename sort equals the order things happened:
		//   - screenshots: stamped at capture by the MCP server
		//     (<YYYYMMDD-HHMMSS>-<seq>-<slug>-<shot>.png)
		//   - report / summary / agent.log: stamped here, at scenario end.
		// The agent writes its report/summary to a stable interim path; we rename
		// them to their end-stamped names once the scenario finishes (the agent
		// can't know the end time up front).
		const interimReport = path.join(RUN_DIR, `${slug}-report.json`);
		const interimSummary = path.join(RUN_DIR, `${slug}-summary.md`);

		const scenarioContent = fs.readFileSync(path.join(SCENARIOS_DIR, file), 'utf8');

		const prologue = [
			'# Runner context (injected — not part of the scenario source)',
			'',
			`- Scenario slug: \`${slug}\``,
			`- Browser under test: \`${UAT_BROWSER}\``,
			`- New-tab origin for this run (navigate here, not \`about:newtab\`): \`${NEWTAB_URL}\``,
			`- Fixture zip (absolute path): \`${FIXTURE}\``,
			'- Use the `uat-scenario` skill (if available) to interpret what follows.',
			`- Write your report (JSON) to exactly this path: \`${interimReport}\``,
			`- Write your summary (markdown) to exactly this path: \`${interimSummary}\``,
			'- Screenshots taken via `mcp__ntt-uat__browser_take_screenshot` are named and placed automatically — just pass a short name like `01-grid`.',
			'',
			'---',
			'',
		].join('\n');

		const prompt = prologue + scenarioContent;

		console.log(`\n=== scenario: ${slug} ===\n`);
		const start = Date.now();
		const result = spawnSync(
			'claude',
			['-p', '--model', UAT_MODEL, '--mcp-config', MCP_CONFIG, '--allowedTools', ALLOWED_TOOLS, '--max-turns', '60'],
			{
				input: prompt,
				stdio: ['pipe', 'pipe', 'inherit'],
				env: {
					...process.env,
					UAT_BROWSER,
					UAT_DAEMON_PORT: String(PORT),
					ARTIFACTS_DIR: RUN_DIR,
					UAT_SCENARIO_LABEL: slug,
				},
				encoding: 'utf8',
			},
		);
		const elapsedSec = (Date.now() - start) / 1000;

		// End-stamp the scenario's own files so they sort after that scenario's
		// screenshots and before the next scenario's.
		const endStamp = runStamp();
		const reportPath = path.join(RUN_DIR, `${endStamp}-${slug}-report.json`);
		const summaryPath = path.join(RUN_DIR, `${endStamp}-${slug}-summary.md`);
		if (fs.existsSync(interimReport)) { fs.renameSync(interimReport, reportPath); }
		if (fs.existsSync(interimSummary)) { fs.renameSync(interimSummary, summaryPath); }
		fs.writeFileSync(path.join(RUN_DIR, `${endStamp}-${slug}-agent.log`), result.stdout || '');

		const screenshots = fs.readdirSync(RUN_DIR)
			.filter(f => f.endsWith('.png') && f.includes(`-${slug}-`))
			.sort();

		// Read the agent's report back so the runner can surface what mattered to
		// the terminal — failed checks, and "observations" (passed, but worth a
		// human's eyes) — and gate on the report's own verdict. The report is
		// authoritative when present: the agent can finish the assessment, write
		// a PASS report, THEN have the `claude -p` process die on an API 529 or
		// the --max-turns cap during wind-down — that must not flip a real PASS
		// to a fail. Only when no usable report exists do we fall back to the
		// process exit code (deriveVerdict, report-verdict.mjs).
		const { hasReport, failedAssertions, observations, reportPassed } = readReport(reportPath);
		const processOk = result.status === 0;
		const passed = deriveVerdict({ hasReport, reportPassed, failedAssertions, processOk });
		if (!passed) { anyFailed = true; }

		results.push({
			slug,
			passed,
			exitCode: result.status,
			reportPassed,
			elapsedSec: Number(elapsedSec.toFixed(2)),
			report: path.basename(reportPath),
			screenshots,
			failedAssertions,
			observations,
		});

		console.log(`  ${passed ? '✓' : '✗'} ${slug} (${elapsedSec.toFixed(1)}s, exit ${result.status})`);
		// Distinguish an infra death (process exited non-zero AFTER a passing
		// report — API 529 / turn cap) from a genuine crash (no usable report),
		// so a green scenario isn't misread as broken and a real crash isn't
		// silently swallowed.
		if (!processOk && passed) {
			console.log(`     ~ agent process exited ${result.status} after a passing report — infra (API 529 / --max-turns), not a scenario failure`);
		} else if (!hasReport) {
			console.log(`     ! agent wrote no usable report (exit ${result.status}) — ${passed ? 'passing on exit code' : 'likely crashed before reporting'}; check the agent log`);
		}
		for (const a of failedAssertions) {
			console.log(`     ✗ ${checkName(a)}`);
			if (a.expected !== undefined) { console.log(`         expected: ${a.expected}`); }
			if (a.actual !== undefined) { console.log(`         actual:   ${a.actual}`); }
		}
		for (const o of observations) {
			console.log(`     ⚠ observation: ${o}`);
		}
		// Screenshots are kept indefinitely (gitignored under tests/uat/artifacts/).
		// Print what landed so they're easy to scroll through after the run.
		if (screenshots.length) {
			console.log(`     screenshots (${screenshots.length}) in ${RUN_DIR}/`);
			for (const s of screenshots) { console.log(`       - ${s}`); }
		} else {
			console.log(`     (no screenshots) — artifacts in ${RUN_DIR}/`);
		}

		// Reset NTT to a known state before the next scenario (history kept).
		// Skip after the final scenario — nothing follows it.
		if (i < scenarios.length - 1) {
			try {
				const r = await daemonCall('/reset_extension', {});
				console.log(`  reset_extension ok (default grid: ${r.resetCells} cells)`);
			} catch (e) {
				console.error(`  runner: reset_extension failed: ${e.message}`);
			}
		}
	}
} finally {
	// ─── 5. stop the daemon (always) ──────────────────────────────────────────
	console.log('\nrunner: stopping browser daemon.');
	await stopDaemon();
}

// ─── 6. aggregate report ──────────────────────────────────────────────────────

const finishedAt = new Date().toISOString();
const report = {
	startedAt,
	finishedAt,
	runStamp: RUN_STAMP,
	scenarioCount: results.length,
	passed: results.filter(r => r.passed).length,
	failed: results.filter(r => !r.passed).length,
	scenarios: results,
};
const reportPath = path.join(RUN_DIR, 'report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const summaryPath = path.join(RUN_DIR, 'summary.md');
fs.writeFileSync(summaryPath, renderSummaryMd(report));

const totalShots = results.reduce((n, r) => n + (r.screenshots?.length || 0), 0);
const totalObs = results.reduce((n, r) => n + (r.observations?.length || 0), 0);
const obsSuffix = totalObs ? `, ${totalObs} observation${totalObs === 1 ? '' : 's'}` : '';
console.log(`\n=== runner: ${report.passed}/${report.scenarioCount} scenarios passed${obsSuffix} ===`);

// Re-surface anything that needs eyes, so the run's tail is self-sufficient: a
// reviewer reads this block and only opens a screenshot/report when pointed to.
const needsAttention = results.filter(r => !r.passed || r.failedAssertions?.length || r.observations?.length);
if (needsAttention.length) {
	console.log('Needs attention:');
	for (const r of needsAttention) {
		console.log(`  ${r.passed ? '✓' : '✗'} ${r.slug}`);
		for (const a of r.failedAssertions || []) { console.log(`     ✗ ${a.name}`); }
		for (const o of r.observations || []) { console.log(`     ⚠ ${o}`); }
	}
} else {
	console.log('Needs attention: none — all assertions passed, no observations.');
}

console.log(`Run dir:     ${RUN_DIR}/  (timestamped; this run's artifacts, kept indefinitely)`);
console.log(`Report:      ${reportPath}`);
console.log(`Summary:     ${summaryPath}`);
console.log(`Screenshots: ${totalShots} total in ${RUN_DIR}/ (named <capture-time>-<scenario>-<shot>.png, sort in capture order)`);
console.log(`Daemon log:  ${path.join(RUN_DIR, 'daemon.log')}`);

process.exit(anyFailed ? 1 : 0);
