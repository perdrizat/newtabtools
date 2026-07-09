/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Integration tests for the never-capture host-list editor in the Advanced drawer panel.
 *
 * The UI mirrors the history-filter form group: a heading, helptext, a list
 * container, an input, and an add button. The group lives between the filter
 * panel and #options-export.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.resolve(__dirname, '../../webextension/newTab.html');
const JS_PATH = path.resolve(__dirname, '../../webextension/newTab.js');
const MESSAGES_PATH = path.resolve(__dirname, '../../webextension/_locales/en/messages.json');
const CSS_PATH = path.resolve(__dirname, '../../webextension/newTab.css');

// ---------------------------------------------------------------------------
// Markup assertions (static — no runtime needed)
// ---------------------------------------------------------------------------

describe('Never-capture UI — markup', () => {
	let html: string;
	// eslint-disable-next-line ntt/no-source-grep -- wiring check: markup structure
	beforeAll(() => { html = fs.readFileSync(HTML_PATH, 'utf8'); });

	it('advanced panel contains a form group with id="options-nevercapture"', () => {
		const advanced = html.slice(
			html.indexOf('data-drawer-panel="advanced"'),
			html.indexOf('data-drawer-panel="advanced"') + 4000,
		);
		expect(advanced).toMatch(/id="options-nevercapture"/);
	});

	it('the heading is wired to data-message="nevercapture_title"', () => {
		expect(html).toMatch(/data-message="nevercapture_title"/);
	});

	it('the helptext is wired to data-message="nevercapture_helptext"', () => {
		expect(html).toMatch(/data-message="nevercapture_helptext"/);
	});

	it('there is an input with id="options-nevercapture-host" and data-placeholder="nevercapture_placeholder_host"', () => {
		expect(html).toMatch(/id="options-nevercapture-host"/);
		expect(html).toMatch(/data-placeholder="nevercapture_placeholder_host"/);
	});

	it('there is an add button with id="options-nevercapture-add" wired to nevercapture_add', () => {
		expect(html).toMatch(/id="options-nevercapture-add"/);
		expect(html).toMatch(/data-message="nevercapture_add"/);
	});

	it('options-nevercapture sits before #options-export in document order', () => {
		const ncPos = html.indexOf('id="options-nevercapture"');
		const exportPos = html.indexOf('id="options-export"');
		expect(ncPos).toBeGreaterThan(0);
		expect(exportPos).toBeGreaterThan(0);
		expect(ncPos).toBeLessThan(exportPos);
	});
});

// ---------------------------------------------------------------------------
// i18n keys
// ---------------------------------------------------------------------------

describe('Never-capture UI — i18n keys', () => {
	let messages: Record<string, { message: string; description?: string }>;
	// eslint-disable-next-line ntt/no-source-grep -- wiring check: locale keys
	beforeAll(() => { messages = JSON.parse(fs.readFileSync(MESSAGES_PATH, 'utf8')); });

	it('nevercapture_title exists', () => {
		expect(messages.nevercapture_title).toBeTruthy();
		expect(messages.nevercapture_title.message).toBeTruthy();
	});

	it('nevercapture_helptext exists', () => {
		expect(messages.nevercapture_helptext).toBeTruthy();
		expect(messages.nevercapture_helptext.message).toBeTruthy();
	});

	it('nevercapture_placeholder_host exists', () => {
		expect(messages.nevercapture_placeholder_host).toBeTruthy();
		expect(messages.nevercapture_placeholder_host.message).toBeTruthy();
	});

	it('nevercapture_add exists', () => {
		expect(messages.nevercapture_add).toBeTruthy();
		expect(messages.nevercapture_add.message).toBeTruthy();
	});

	it('nevercapture_remove exists', () => {
		expect(messages.nevercapture_remove).toBeTruthy();
		expect(messages.nevercapture_remove.message).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// CSS assertions (static — no runtime needed)
// ---------------------------------------------------------------------------

describe('Never-capture UI — CSS (newTab.css)', () => {
	let css: string;
	// eslint-disable-next-line ntt/no-source-grep -- wiring check: CSS rules
	beforeAll(() => { css = fs.readFileSync(CSS_PATH, 'utf8'); });

	it('#options-nevercapture-host grows to fill the row (UAT scenario 22 — placeholder clipped at the input edge)', () => {
		// The row's Add button previously left the input at its intrinsic
		// (UA default) width, too narrow for the placeholder string. It now
		// shares the flex-grow treatment already used by the other row inputs
		// (#options-pinURL-input etc.) so it fills the available row width
		// without changing the row's left-aligned layout.
		expect(css).toMatch(/#options-nevercapture-host[^{]*\{[^}]*flex:\s*1/);
	});
});

// ---------------------------------------------------------------------------
// JS wiring assertions (static — source grep)
// ---------------------------------------------------------------------------

describe('Never-capture UI — JS wiring', () => {
	let js: string;
	// eslint-disable-next-line ntt/no-source-grep -- wiring check: handler wiring
	beforeAll(() => { js = fs.readFileSync(JS_PATH, 'utf8'); });

	it('fillNeverCaptureUI is defined', () => {
		expect(js).toMatch(/fillNeverCaptureUI\s*\(/);
	});

	it('the add handler normalizes via Filters.normalizeHost', () => {
		expect(js).toMatch(/case 'options-nevercapture-add':[\s\S]{0,400}Filters\.normalizeHost/);
	});

	it('the add handler calls NeverCapture.add', () => {
		expect(js).toMatch(/case 'options-nevercapture-add':[\s\S]{0,600}NeverCapture\.add/);
	});

	it('the add handler sends Thumbnails.purgeHost message', () => {
		expect(js).toMatch(/case 'options-nevercapture-add':[\s\S]{0,800}Thumbnails\.purgeHost/);
	});

	it('the remove handler uses ntt-nevercapture-remove class', () => {
		expect(js).toMatch(/ntt-nevercapture-remove/);
	});

	it('the remove handler calls NeverCapture.remove', () => {
		expect(js).toMatch(/classList\.contains\('ntt-nevercapture-remove'\)[\s\S]{0,400}NeverCapture\.remove/);
	});

	it('updateUI handles the neverCaptureHosts storage key', () => {
		expect(js).toMatch(/neverCaptureHosts/);
		expect(js).toMatch(/fillNeverCaptureUI\(\)/);
	});

	it('resetAllSettings calls NeverCapture.clear', () => {
		const body = js.slice(js.indexOf('async resetAllSettings()'), js.indexOf('async resetAllSettings()') + 2000);
		expect(body).toMatch(/NeverCapture\.clear/);
	});
});

// ---------------------------------------------------------------------------
// Runtime behavioural tests — JSDOM + minimal stubs
// ---------------------------------------------------------------------------

/**
 * Builds a minimal JSDOM-backed environment with a stubbed NeverCapture global
 * and a minimal newTabTools harness implementing fillNeverCaptureUI and optionsOnClick.
 */
function buildEnv(ncList: string[] = []): {
	NeverCapture: {
		_list: string[];
		matches: (_url: string) => boolean;
		matchingEntry: (_host: string) => string | undefined;
		add: ReturnType<typeof vi.fn>;
		remove: ReturnType<typeof vi.fn>;
		clear: ReturnType<typeof vi.fn>;
		getList: ReturnType<typeof vi.fn>;
	};
	newTabTools: any;
	sendMessage: ReturnType<typeof vi.fn>;
	input: HTMLInputElement;
	addBtn: HTMLButtonElement;
	chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } };
	Grid: { sites: any[]; refresh: ReturnType<typeof vi.fn> };
	Filters: { normalizeHost: (raw: string) => string; getList: () => object; setFilter: ReturnType<typeof vi.fn>; _list: object };
} {
	const mockAdd = vi.fn().mockResolvedValue(undefined);
	const mockRemove = vi.fn().mockResolvedValue(undefined);
	const mockClear = vi.fn().mockResolvedValue(undefined);
	const mockGetList = vi.fn(() => [...ncList]);

	const NeverCapture = {
		_list: [...ncList],
		matches: (_url: string) => false,
		matchingEntry: (_host: string) => undefined as string | undefined,
		add: mockAdd,
		remove: mockRemove,
		clear: mockClear,
		getList: mockGetList,
	};

	const sendMessage = vi.fn((msg: unknown, cb?: Function) => { if (cb) { cb(undefined); } });

	// Build the minimal DOM that the UI assumes exists
	document.body.innerHTML = '';
	const panel = document.createElement('section');
	panel.setAttribute('data-drawer-panel', 'advanced');

	const ncGroup = document.createElement('div');
	ncGroup.className = 'ntt-form-group';
	ncGroup.id = 'options-nevercapture';

	const head = document.createElement('div');
	head.className = 'ntt-form-group-head';
	const label = document.createElement('span');
	label.className = 'ntt-form-group-label';
	label.setAttribute('data-message', 'nevercapture_title');
	head.appendChild(label);
	ncGroup.appendChild(head);

	const help = document.createElement('div');
	help.className = 'ntt-form-group-help';
	help.setAttribute('data-message', 'nevercapture_helptext');
	ncGroup.appendChild(help);

	const list = document.createElement('div');
	list.id = 'options-nevercapture-list';
	ncGroup.appendChild(list);

	const rowEl = document.createElement('div');
	rowEl.className = 'options-row';
	const input = document.createElement('input') as HTMLInputElement;
	input.id = 'options-nevercapture-host';
	input.type = 'text';
	input.setAttribute('data-placeholder', 'nevercapture_placeholder_host');
	const addBtn = document.createElement('button') as HTMLButtonElement;
	addBtn.id = 'options-nevercapture-add';
	addBtn.setAttribute('data-message', 'nevercapture_add');
	rowEl.appendChild(input);
	rowEl.appendChild(addBtn);
	ncGroup.appendChild(rowEl);
	panel.appendChild(ncGroup);
	document.body.appendChild(panel);

	const Filters = {
		normalizeHost(raw: string): string {
			if (!raw || !raw.trim()) { return ''; }
			let val = raw.trim();
			if (val.startsWith('*.')) { val = val.slice(1); }
			try {
				if (val.includes('://')) {
					val = new URL(val).host.toLowerCase();
				} else {
					val = val.toLowerCase();
				}
			} catch {
				val = val.toLowerCase();
			}
			return val;
		},
		getList: () => ({}),
		setFilter: vi.fn(),
		_list: Object.create(null),
	};

	const Grid = {
		sites: [] as any[],
		refresh: vi.fn().mockResolvedValue(undefined),
	};

	const chrome = { runtime: { sendMessage } };

	const newTabTools: any = {
		optionsNeverCapture: document.getElementById('options-nevercapture'),
		optionsNeverCaptureHost: document.getElementById('options-nevercapture-host'),
		optionsNeverCaptureAdd: document.getElementById('options-nevercapture-add'),
		optionsNeverCaptureList: document.getElementById('options-nevercapture-list'),
		getString(key: string) { return key; },

		fillNeverCaptureUI() {
			const container = this.optionsNeverCaptureList;
			if (!container) { return; }
			while (container.firstChild) {
				container.firstChild.remove();
			}
			for (const entry of NeverCapture.getList()) {
				const entryRow = document.createElement('div');
				entryRow.className = 'ntt-nevercapture-row';
				const text = document.createElement('span');
				text.textContent = entry;
				const removeBtn = document.createElement('button');
				removeBtn.className = 'ntt-nevercapture-remove';
				removeBtn.textContent = '✕';
				removeBtn.title = this.getString('nevercapture_remove');
				removeBtn.dataset.entry = entry;
				entryRow.appendChild(text);
				entryRow.appendChild(removeBtn);
				container.appendChild(entryRow);
			}
		},

		optionsOnClick(event: { target: HTMLElement }) {
			const target = event.target;
			const id = target.id;
			const classList = target.classList;

			switch (id) {
			case 'options-nevercapture-add': {
				const raw = (this.optionsNeverCaptureHost as HTMLInputElement).value;
				const host = Filters.normalizeHost(raw);
				if (!host) { return; }
				NeverCapture.add(host).then(() => {
					chrome.runtime.sendMessage({ name: 'Thumbnails.purgeHost', host }, () => {
						Grid.refresh().then(() => {});
					});
					(this.optionsNeverCaptureHost as HTMLInputElement).value = '';
					this.fillNeverCaptureUI();
				});
				return;
			}
			}

			if (classList.contains('ntt-nevercapture-remove')) {
				const entry = target.dataset.entry || '';
				NeverCapture.remove(entry).then(() => {
					this.fillNeverCaptureUI();
				});
				return;
			}
		},
	};

	return { NeverCapture, newTabTools, sendMessage, input, addBtn, chrome, Grid, Filters };
}

describe('fillNeverCaptureUI — renders list', () => {
	it('renders one row per entry with textContent (no innerHTML injection)', () => {
		const { NeverCapture, newTabTools } = buildEnv(['bank.com', '.corp.example']);
		NeverCapture.getList.mockReturnValue(['bank.com', '.corp.example']);
		newTabTools.fillNeverCaptureUI();

		const rows = document.querySelectorAll('.ntt-nevercapture-row');
		expect(rows).toHaveLength(2);
		const texts = Array.from(rows).map(r => r.querySelector('span')!.textContent);
		expect(texts).toContain('bank.com');
		expect(texts).toContain('.corp.example');
	});

	it('uses textContent only — an entry like "<img src=x>" appears as literal text, not an element', () => {
		const { NeverCapture, newTabTools } = buildEnv([]);
		NeverCapture.getList.mockReturnValue(['<img src=x>']);
		newTabTools.fillNeverCaptureUI();

		const rows = document.querySelectorAll('.ntt-nevercapture-row');
		expect(rows).toHaveLength(1);
		const span = rows[0].querySelector('span')!;
		expect(span.textContent).toBe('<img src=x>');
		// must NOT create an img element
		expect(rows[0].querySelector('img')).toBeNull();
	});

	it('each row has a ntt-nevercapture-remove button', () => {
		const { NeverCapture, newTabTools } = buildEnv([]);
		NeverCapture.getList.mockReturnValue(['a.com', 'b.com']);
		newTabTools.fillNeverCaptureUI();

		const removeBtns = document.querySelectorAll('.ntt-nevercapture-remove');
		expect(removeBtns).toHaveLength(2);
	});

	it('empty list renders no rows', () => {
		const { NeverCapture, newTabTools } = buildEnv([]);
		NeverCapture.getList.mockReturnValue([]);
		newTabTools.fillNeverCaptureUI();

		const rows = document.querySelectorAll('.ntt-nevercapture-row');
		expect(rows).toHaveLength(0);
	});
});

describe('Add path', () => {
	it('clicking add with a valid URL normalizes and calls NeverCapture.add', async () => {
		const { NeverCapture, newTabTools, input, addBtn } = buildEnv([]);
		NeverCapture.getList.mockReturnValue([]);
		input.value = 'HTTPS://Sub.Bank.COM/x';
		await newTabTools.optionsOnClick({ target: addBtn });
		await Promise.resolve();
		expect(NeverCapture.add).toHaveBeenCalledWith('sub.bank.com');
	});

	it('clicking add sends Thumbnails.purgeHost with the normalized host', async () => {
		const { NeverCapture, newTabTools, sendMessage, input, addBtn } = buildEnv([]);
		NeverCapture.getList.mockReturnValue([]);
		input.value = 'HTTPS://Sub.Bank.COM/x';
		await newTabTools.optionsOnClick({ target: addBtn });
		await Promise.resolve();
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Thumbnails.purgeHost', host: 'sub.bank.com' }),
			expect.any(Function),
		);
	});

	it('clicking add clears the input', async () => {
		const { NeverCapture, newTabTools, input, addBtn } = buildEnv([]);
		NeverCapture.getList.mockReturnValue([]);
		input.value = 'bank.com';
		await newTabTools.optionsOnClick({ target: addBtn });
		await Promise.resolve();
		expect(input.value).toBe('');
	});

	it('clicking add re-renders the list', async () => {
		const { NeverCapture, newTabTools, input, addBtn } = buildEnv([]);
		NeverCapture.getList.mockReturnValue(['bank.com']);
		input.value = 'bank.com';
		await newTabTools.optionsOnClick({ target: addBtn });
		// flush the microtask queue for the resolved NeverCapture.add promise
		await Promise.resolve();
		await Promise.resolve();
		const rows = document.querySelectorAll('.ntt-nevercapture-row');
		expect(rows.length).toBeGreaterThan(0);
	});

	it('empty input does not call NeverCapture.add', async () => {
		const { NeverCapture, newTabTools, input, addBtn } = buildEnv([]);
		input.value = '';
		await newTabTools.optionsOnClick({ target: addBtn });
		await Promise.resolve();
		expect(NeverCapture.add).not.toHaveBeenCalled();
	});

	it('whitespace-only input does not call NeverCapture.add', async () => {
		const { NeverCapture, newTabTools, input, addBtn } = buildEnv([]);
		input.value = '   ';
		await newTabTools.optionsOnClick({ target: addBtn });
		await Promise.resolve();
		expect(NeverCapture.add).not.toHaveBeenCalled();
	});

	it('empty input sends no purgeHost message', async () => {
		const { newTabTools, sendMessage, input, addBtn } = buildEnv([]);
		input.value = '';
		await newTabTools.optionsOnClick({ target: addBtn });
		await Promise.resolve();
		expect(sendMessage).not.toHaveBeenCalled();
	});
});

describe('Remove path', () => {
	it('clicking a ntt-nevercapture-remove button calls NeverCapture.remove with the entry', async () => {
		const { NeverCapture, newTabTools } = buildEnv([]);
		NeverCapture.getList.mockReturnValue(['bank.com', '.corp.example']);
		newTabTools.fillNeverCaptureUI();

		const btn = document.querySelector('.ntt-nevercapture-remove') as HTMLElement;
		const entry = btn.dataset.entry!;

		await newTabTools.optionsOnClick({ target: btn });
		await Promise.resolve();
		expect(NeverCapture.remove).toHaveBeenCalledWith(entry);
	});

	it('remove does NOT send a Thumbnails.purgeHost message', async () => {
		const { NeverCapture, newTabTools, sendMessage } = buildEnv([]);
		NeverCapture.getList.mockReturnValue(['bank.com']);
		newTabTools.fillNeverCaptureUI();

		const btn = document.querySelector('.ntt-nevercapture-remove') as HTMLElement;
		await newTabTools.optionsOnClick({ target: btn });
		await Promise.resolve();
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it('list re-renders after remove', async () => {
		const { NeverCapture, newTabTools } = buildEnv([]);
		NeverCapture.getList.mockReturnValueOnce(['bank.com']).mockReturnValue([]);
		newTabTools.fillNeverCaptureUI();

		const btn = document.querySelector('.ntt-nevercapture-remove') as HTMLElement;
		await newTabTools.optionsOnClick({ target: btn });
		await Promise.resolve();
		const rows = document.querySelectorAll('.ntt-nevercapture-row');
		expect(rows).toHaveLength(0);
	});
});
