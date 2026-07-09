/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

function getString(name) {
	return chrome.i18n.getMessage(name);
}

/**
 * @returns {Promise<browser.tabs.Tab>} The active tab in the current window.
 */
async function getTab() {
	let tabs = await browser.tabs.query({active: true, currentWindow: true});
	return tabs[0];
}

document.querySelectorAll('[data-message]').forEach(n => {
	n.textContent = getString(n.dataset.message);
});

getTab().then(async tab => {
	let isPinned = await browser.runtime.sendMessage({name: 'Tiles.isPinned', url: tab.url});
	document.getElementById('pinned').hidden = !isPinned;
	document.getElementById('pin').hidden = isPinned;
});

document.getElementById('pin').onclick = function() {
	getTab().then(function(tab) {
		browser.runtime.sendMessage({name: 'Tiles.pinTile', title: tab.title, url: tab.url});
		window.close();
	});
};

document.getElementById('capture').onclick = async function() {
	await browser.runtime.sendMessage({name: 'Thumbnails.capture'});
	window.close();
};
