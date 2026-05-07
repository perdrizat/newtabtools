/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported makeZip, readZip */
/* globals Background, Tiles, zip */

zip.configure({ useWebWorkers: false });

async function makeZip() {
	let writer = new zip.ZipWriter(new zip.BlobWriter());

	let background = await Background.getBackground();
	if (background) {
		await writer.add('background', new zip.BlobReader(background));
	}

	let prefs = await new Promise(function(resolve) {
		chrome.storage.local.get(resolve);
	});
	for (let k of ['thumbnailSize', 'version', 'versionLastUpdate', 'versionLastAck']) {
		delete prefs[k];
	}
	await writer.add('prefs.json', new zip.TextReader(JSON.stringify(prefs, null, '\t')));

	let tiles = await Tiles.getAll();
	for (let t of tiles) {
		if ('image' in t && t.image instanceof Blob) {
			await writer.add('tileImages/' + t.id + '.png', new zip.BlobReader(t.image));
			delete t.image;
		}
	}
	await writer.add('tiles.json', new zip.TextReader(JSON.stringify(tiles, null, '\t')));

	let blob = await writer.close();
	return new Promise(function(resolve) {
		chrome.downloads.download({
			url: URL.createObjectURL(blob),
			filename: 'newtabtools.zip',
			saveAs: true
		}, resolve);
	});
}

async function readZip(file) {
	let views = chrome.extension.getViews().filter(v => v.location.pathname == '/newTab.xhtml');

	let reader = new zip.ZipReader(new zip.BlobReader(file));
	let entries = await reader.getEntries();

	async function getAsJSON(filename) {
		let entry = entries.find(e => e.filename == filename);
		if (!entry) {
			return null;
		}

		let data = await entry.getData(new zip.TextWriter());
		return JSON.parse(data);
	}

	async function getAsBlob(entry) {
		return entry.getData(new zip.BlobWriter());
	}

	let backgroundFile = entries.find(e => e.filename == 'background');
	if (backgroundFile) {
		Background.setBackground(await getAsBlob(backgroundFile));
		for (let v of views) {
			await v.newTabTools.refreshBackgroundImage();
		}
	}

	let prefs = await getAsJSON('prefs.json');
	if (prefs) {
		let allowedKeys = ['theme', 'themeAuto', 'opacity', 'rows', 'columns',
			'margin', 'spacing', 'titleSize', 'locked', 'history', 'recent',
			'blocked', 'filters'];
		let filtered = {};
		for (let k of allowedKeys) {
			if (k in prefs) {
				filtered[k] = prefs[k];
			}
		}
		await chrome.storage.local.set(filtered);
	}

	let tiles = await getAsJSON('tiles.json');
	if (!tiles) {
		return;
	}

	let tilesMap = new Map();
	for (let t of tiles) {
		tilesMap.set(t.id, t);
	}
	for (let e of entries) {
		if (e.filename.startsWith('tileImages/')) {
			let id = parseInt(e.filename.substring(11), 10);
			let image = await getAsBlob(e);
			tilesMap.get(id).image = image;
		}
	}

	await Tiles.clear();
	let safeProtocols = ['http:', 'https:', 'ftp:'];
	for (let t of tilesMap.values()) {
		try {
			if (!safeProtocols.includes(new URL(t.url).protocol)) {
				continue;
			}
		} catch (ex) {
			continue;
		}
		await Tiles.putTile(t);
	}

	for (let v of views) {
		await new Promise(function(resolve) {
			v.Updater.updateGrid(resolve);
		});
	}
}
