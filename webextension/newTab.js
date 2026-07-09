/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals AwesomeBar, Background, Blocked, compareVersions, Filters, Grid, NeverCapture, NttIcons, Page, Prefs, Tiles, TileStats, Updater */

var newTabTools = {
	getString(name, ...substitutions) {
		return chrome.i18n.getMessage(name, substitutions);
	},
	isValidURL(url) {
		try {
			return ['ftp:', 'http:', 'https:'].includes(new URL(url).protocol);
		} catch (ex) {
			return false;
		}
	},
	normalizePinURL(raw) {
		let v = (raw || '').trim();
		if (!v) {
			return '';
		}
		// Auto-prepend https:// when the user types a bare domain or path.
		return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : 'https://' + v;
	},
	historyTitleFor(url) {
		// Look up the title that Firefox knows for `url` (browsing history).
		// Resolves to a string or null. Never rejects: if the optional
		// `history` permission is not granted, this just returns null.
		return new Promise(resolve => {
			try {
				chrome.history.search({ text: url, startTime: 0 }, results => {
					let entry = (results || []).find(r => r.url === url);
					resolve((entry && entry.title) || null);
				});
			} catch (e) {
				resolve(null);
			}
		});
	},
	autocomplete() {
		let normalized = this.normalizePinURL(this.pinURLInput.value);
		this.pinURLButton.disabled = !this.isValidURL(normalized);
		let value = this.pinURLInput.value;
		if (value.length < 2) {
			this.pinURLAutocomplete.hidden = true;
			while (this.pinURLAutocomplete.lastChild) {
				this.pinURLAutocomplete.lastChild.remove();
			}
			return;
		}
		let valueParts = value.toLowerCase().split(/\s+/);

		let count = 0;
		let options = Array.from(this.pinURLAutocomplete.children);
		let urls = options.filter(u => {
			if (u == this.pinURLBlocked) {
				return false;
			}
			let matches = valueParts.every(vp => u.dataset.url.toLowerCase().includes(vp) || u.dataset.title.toLowerCase().includes(vp));
			if (matches) {
				count++;
			}
			u.hidden = count > 10 || !matches;
			return matches;
		}).map(u => u.dataset.url);

		let exact = options.find(function(u) {
			return u.dataset.url == value;
		});
		if (exact) {
			this.pinURLAutocomplete.insertBefore(exact, this.pinURLAutocomplete.firstChild);
		}

		if (count >= 10) {
			this.pinURLAutocomplete.hidden = false;
			return;
		}

		let template = newTabTools.pinURLAutocomplete.nextElementSibling;
		let maybeAddItem = (item, type) => {
			if (!this.isValidURL(item.url) || urls.includes(item.url)) {
				return;
			}
			if (!valueParts.every(vp => item.url.toLowerCase().includes(vp) || item.title.toLowerCase().includes(vp))) {
				return;
			}

			let option = template.content.firstElementChild.cloneNode(true);
			option.classList.add(type);
			if (Tiles.isPinned(item.url)) {
				option.classList.add('pinned');
			}
			option.dataset.title = option.querySelector('.autocomplete-title').textContent = item.title;
			option.dataset.url = option.querySelector('.autocomplete-url').textContent = item.url;
			if (++count > 10) {
				option.hidden = true;
			}
			if (item.url == value) {
				this.pinURLAutocomplete.insertBefore(option, this.pinURLAutocomplete.firstChild);
			} else {
				this.pinURLAutocomplete.appendChild(option);
			}

			this.getThemedImageURL(type, 'dark').then(url => {
				option.querySelector('.autocomplete-icon').style.backgroundImage = url ? `url(${url})` : null;
			});
			urls.push(item.url);
		};

		chrome.tabs.query({}, tabs => {
			for (let t of tabs) {
				maybeAddItem(t, 'tab');
			}

			if (count >= 10) {
				this.pinURLAutocomplete.hidden = false;
				return;
			}

			if (!this.pinURLBlocked.hidden) {
				this.pinURLAutocomplete.appendChild(this.pinURLBlocked);
				this.pinURLAutocomplete.hidden = false;
				return;
			}

			chrome.bookmarks.getTree(tree => {
				function traverse(children) {
					for (let c of children) {
						if (c.type == 'folder') {
							traverse(c.children);
						} else if (c.type == 'bookmark') {
							maybeAddItem(c, 'bookmark');
						}
					}
				}

				traverse(tree[0].children);

				if (count >= 10) {
					this.pinURLAutocomplete.hidden = false;
					return;
				}

				chrome.history.search({
					text: value,
					startTime: 0
				}, result => {
					for (let r of result) {
						maybeAddItem(r, 'history');
					}
					this.pinURLAutocomplete.hidden = !count;
				});
			});
		});
	},
	setPinURLInputValue(url) {
		this.pinURLInput.value = url;
		this.pinURLInput.focus();
		this.pinURLInput.selectionStart = this.pinURLInput.selectionEnd = url.length;
		this.pinURLButton.disabled = !this.pinURLInput.checkValidity() || !this.isValidURL(url);
		this.pinURLAutocomplete.hidden = true;
	},
	get selectedSite() {
		return Grid.sites[this._selectedSiteIndex];
	},
	optionsOnClick(event) {
		if (event.target.disabled) {
			return;
		}
		let {id, classList} = event.target;
		switch (id) {
		case 'options-pinURL-permissions':
			chrome.permissions.request({permissions: ['bookmarks', 'history']}, (succeeded) => {
				if (succeeded) {
					this.pinURLBlocked.hidden = true;
					this.pinURLInput.focus();
					this.autocomplete();
				}
			});
			return;
		case 'options-pinURL': {
			let pinUrl = this.normalizePinURL(this.pinURLInput.value);
			if (!this.isValidURL(pinUrl)) {
				throw 'URL is invalid';
			}
			Tiles.getTile(pinUrl).then(async tile => {
				if (tile) {
					return tile;
				}
				let historyTitle = await this.historyTitleFor(pinUrl);
				return historyTitle ? { url: pinUrl, title: historyTitle } : { url: pinUrl };
			}).then(tile => {
				if ('position' in tile && tile.position < Prefs.rows * Prefs.columns) {
					return tile.position;
				}
				let cell = Grid.cells.find(c => !c.containsPinnedSite());
				if (!cell) {
					throw 'No free space';
				}
				tile.position = cell.index;
				return Tiles.putTile(tile).then(() => cell.index);
			}).then(pos => new Promise(resolve => {
				Updater.updateGrid(() => resolve(pos));
			})).then(pos => {
				newTabTools.setPinURLInputValue('');
				let site = Grid.sites[pos] || Grid.sites.find(s => s && s.url === pinUrl);
				if (site && site.cell) {
					newTabTools.selectedSiteIndex = site.cell.index;
				}
			}).catch(console.error);
			break;
		}
		case 'options-url-set': {
			let nextUrl = this.normalizePinURL(this.siteURLInput.value);
			if (!this.isValidURL(nextUrl) || !this.selectedSite) {
				return;
			}
			let link = this.selectedSite.link;
			link.url = nextUrl;
			delete link.title;
			link.titleIsUserSet = false;
			// Refresh the title from browsing history if available; the
			// user can always override it via Set Title afterwards.
			this.historyTitleFor(nextUrl).then(historyTitle => {
				if (historyTitle) {
					link.title = historyTitle;
				}
				this.selectedSite.addTitle();
				Tiles.putTile(link);
				if (this.setTitleInput) {
					this.setTitleInput.value = link.title || '';
				}
			});
			break;
		}
		case 'options-url-remove':
			// Per the redesign, the URL row's Remove deletes/unpins the tile —
			// the same effect as the board's ✕ action.
			if (this.selectedSite && typeof this.selectedSite.block === 'function') {
				this.selectedSite.block().catch(e => console.error('remove tile failed:', e));
			}
			this.selectedSiteIndex = null;
			break;
		case 'options-savethumb':
			let link = this.selectedSite.link;
			let siteURL = link.url;
			chrome.runtime.sendMessage({
				name: 'Thumbnails.get',
				urls: [siteURL]
			}, thumbs => {
				let blob = thumbs.get(siteURL);
				if (!blob) {
					return;
				}
				link.image = blob;
				link.imageIsThumbnail = true;
				Tiles.putTile(link);
				this.saveCurrentThumbButton.disabled = true;
				this.removeSavedThumbButton.disabled = false;
			});
			break;
		case 'options-savedthumb-set':
			this.setThumbnail(this.selectedSite, URL.createObjectURL(this.setSavedThumbInput.files[0]));
			this.removeSavedThumbButton.disabled = false;
			break;
		case 'options-savedthumb-remove':
			this.removeThumbnail(this.selectedSite);
			this.removeSavedThumbButton.disabled = true;
			break;
		case 'options-savedimg-clear': {
			// Clear the chosen file in the "Choose image" picker (not the applied
			// image — the Pin-row Remove reverts that).
			this.setSavedThumbInput.value = '';
			let setBtn = document.getElementById('options-savedthumb-set');
			if (setBtn) { setBtn.disabled = true; }
			event.target.disabled = true;
			let row = event.target.closest('.options-row');
			let nameEl = row && row.querySelector('.ntt-file-name');
			if (nameEl) { nameEl.textContent = this.getString('backup_no_file'); }
			break;
		}
		case 'options-bgcolor-display':
		case 'options-bgcolor-displaybutton':
			this.setBgColourInput.click();
			break;
		case 'options-bgcolor-set':
			this.selectedSite.link.backgroundColor = this.setBgColourInput.value;
			Tiles.putTile(this.selectedSite.link);
			this.selectedSite.thumbnail.style.backgroundColor =
				this.siteThumbnail.style.backgroundColor = this.setBgColourInput.value;
			this.resetBgColourButton.disabled = false;
			break;
		case 'options-bgcolor-reset':
			delete this.selectedSite.link.backgroundColor;
			Tiles.putTile(this.selectedSite.link);
			this.selectedSite.thumbnail.style.backgroundColor =
				this.siteThumbnail.style.backgroundColor =
				this.setBgColourInput.value =
				this.setBgColourDisplay.style.backgroundColor = null;
			this.setBgColourButton.disabled =
				this.resetBgColourButton.disabled = true;
			break;
		case 'options-title-set':
			this.selectedSite.link.title = this.setTitleInput.value;
			this.selectedSite.link.titleIsUserSet = true;
			this.selectedSite.addTitle();
			Tiles.putTile(this.selectedSite.link);
			break;
		case 'options-title-remove': {
			// Clear the custom title → revert to the page's history/auto title.
			if (!this.selectedSite) { return; }
			let tlink = this.selectedSite.link;
			delete tlink.title;
			tlink.titleIsUserSet = false;
			this.historyTitleFor(tlink.url).then(historyTitle => {
				if (historyTitle) { tlink.title = historyTitle; }
				this.selectedSite.addTitle();
				Tiles.putTile(tlink);
				if (this.setTitleInput) { this.setTitleInput.value = tlink.title || ''; }
			});
			break;
		}
		case 'options-wallpaper-btn':
			this.openWallpaperPicker();
			break;
		case 'options-bg-remove':
			this.resetWallpaper();
			break;
		case 'historytiles-filter': {
			// Toggle the filter panel (it starts hidden); only (re)populate when
			// opening so a second click cleanly collapses it.
			let opening = this.optionsFilter.hidden;
			this.optionsFilter.hidden = !opening;
			event.target.setAttribute('aria-expanded', String(opening));
			if (opening) {
				this.fillFilterUI();
			}
			return;
		}
		case 'options-filter-set': {
			// Normalize the host so exact matching reliably fires (trims/lowercases,
			// extracts host from a pasted URL, maps `*.x`→`.x`). Re-derive validity
			// here rather than trusting the button's disabled state.
			let host = Filters.normalizeHost(this.optionsFilterHost.value);
			let count = parseInt(this.optionsFilterCount.value, 10);
			if (!host || isNaN(count)) {
				return;
			}
			Filters.setFilter(host, count);
			Updater.updateGrid();
			this.fillFilterUI(host);
			this.optionsFilterHost.value = '';
			this.optionsFilterCount.value = '';
			this.optionsFilterHost.focus();
			this.optionsFilterSet.disabled = true;
			return;
		}
		case 'options-nevercapture-add': {
			// Normalize the host via the same helper as the history filter (trims,
			// lowercases, extracts host from a full URL, maps `*.x`→`.x`).
			let host = Filters.normalizeHost(this.optionsNeverCaptureHost.value);
			if (!host) {
				return;
			}
			NeverCapture.add(host).then(() => {
				chrome.runtime.sendMessage({name: 'Thumbnails.purgeHost', host}, () => {
					Grid.refresh().then(() => this.getThumbnails());
				});
				this.optionsNeverCaptureHost.value = '';
				this.fillNeverCaptureUI();
			});
			return;
		}
		case 'options-backup':
			chrome.permissions.request({permissions: ['downloads']}, function() {
				chrome.runtime.sendMessage({name: 'Export:backup'});
			});
			return;
		case 'options-restore':
			// Restore overwrites the whole setup — require an explicit inline
			// Confirm/Cancel (§7) rather than acting on the first click.
			this._showConfirm('options-restore-confirm-row');
			return;
		case 'options-restore-confirm': {
			let input = document.getElementById('options-restore-file');
			chrome.runtime.sendMessage({name: 'Import:restore', file: input.files[0]});
			this._hideConfirm('options-restore-confirm-row');
			return;
		}
		case 'options-restore-cancel':
			this._hideConfirm('options-restore-confirm-row');
			return;
		case 'options-reset-all':
			// Irreversible — inline Confirm/Cancel (§7).
			this._showConfirm('options-reset-confirm-row');
			return;
		case 'options-reset-confirm':
			this._hideConfirm('options-reset-confirm-row');
			this.resetAllSettings();
			return;
		case 'options-reset-cancel':
			this._hideConfirm('options-reset-confirm-row');
			return;
		}

		if (classList.contains('ntt-filter-remove')) {
			// Explicit removal of a filter entry (distinct from stepping the limit
			// down to "Unlimited", which also deletes it). Only filter rows carry
			// this control — pinned-only rows don't (see fillFilterUI).
			let row = event.target.closest('tr');
			Filters.setFilter(row.cells[0].textContent, -1);
			Updater.updateGrid();
			this.fillFilterUI();
			return;
		}

		if (classList.contains('ntt-nevercapture-remove')) {
			// Remove the entry from the never-capture list (no purge — the user is
			// only un-suppressing auto-capture, not deleting existing screenshots).
			let entry = event.target.dataset.entry || '';
			NeverCapture.remove(entry).then(() => {
				this.fillNeverCaptureUI();
			});
			return;
		}

		if (classList.contains('plus-button') || classList.contains('minus-button')) {
			let row = event.target.parentNode.parentNode;
			let unpinned = row.cells[2].querySelector('span');
			let count = parseInt(unpinned.textContent, 10);

			if (isNaN(count)) {
				if (classList.contains('minus-button')) {
					return;
				}
				count = -1;
			}
			count += classList.contains('plus-button') ? 1 : -1;
			unpinned.textContent = count == -1 ? this.getString('filter_unlimited') : count;
			row.querySelector('.minus-button').disabled = count == -1;

			Filters.setFilter(row.cells[0].textContent, count);
			Updater.updateGrid();
		}
	},
	optionsOnChange(event) {
		if (event.target.disabled) {
			return;
		}

		let {name, value, checked} = event.target;
		switch (name) {
		case 'theme':
		case 'spacing':
		case 'titleSize':
		case 'tileAspect':
			Prefs[name] = value;
			break;
		case 'opacity':
		case 'rows':
		case 'columns':
			Prefs[name] = parseInt(value, 10);
			break;
		case 'margin':
			Prefs.margin = value.split(' ');
			break;
		case 'locked':
		case 'history':
		case 'recent':
			Prefs[name] = checked;
			break;
		}
	},
	contextMenuShowing(info) {
		if (info.contexts.includes('link')) {
			let target = browser.menus.getTargetElement(info.targetElementId);
			let site = target.closest('.newtab-site');
			let pinned = site && site._newtabSite.isPinned;

			browser.menus.update('edit', { visible: !!site });
			browser.menus.update('pin', { visible: !!site && !pinned });
			browser.menus.update('unpin', { visible: !!site && pinned });
			browser.menus.update('block', { visible: !!site });
			browser.menus.refresh();
		}
	},
	contextMenuOnClick(info) {
		let target = browser.menus.getTargetElement(info.targetElementId);
		let site = target.closest('.newtab-site');

		switch (info.menuItemId) {
		case 'edit':
			let index = 0;
			let cell = site.parentNode;
			while (cell.previousElementSibling) {
				cell = cell.previousElementSibling;
				index++;
			}
			cell = cell.parentNode;
			while (cell.previousElementSibling) {
				cell = cell.previousElementSibling;
				index += cell.childElementCount;
			}

			newTabTools.openDrawer();
			newTabTools.switchDrawerTab('tile');
			newTabTools.selectedSiteIndex = index;
			break;

		case 'pin':
			site._newtabSite.pin();
			break;
		case 'unpin':
			site._newtabSite.unpin();
			break;
		case 'block':
			site._newtabSite.block();
			break;
		case 'options':
			newTabTools.toggleDrawer();
			break;
		}
	},
	setThumbnail(site, src) {
		let image = new Image();
		image.onload = function() {
			let thumbnailSize = Prefs.thumbnailSize;
			let scale = Math.min(thumbnailSize / image.width, thumbnailSize / image.height, 1);

			let canvas = document.createElement('canvas');
			canvas.mozOpaque = false;
			if ('imageSmoothingEnabled' in canvas) {
				canvas.imageSmoothingEnabled = true;
			} else {
				canvas.mozImageSmoothingEnabled = true;
			}
			canvas.width = image.width * scale;
			canvas.height = image.height * scale;
			let ctx = canvas.getContext('2d');
			ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
			// The decode-source object URL (file-picker blob) is one-shot —
			// once drawn to the canvas it has no further consumer (§4.3).
			if (src.startsWith('blob:')) {
				URL.revokeObjectURL(src);
			}

			let link = site.link;
			canvas.toBlob(function(blob) {
				link.image = blob;
				delete link.imageIsThumbnail;
				site.refreshThumbnail();

				let thumbnailURL = newTabTools._freshObjectURL('editorThumb', link.image);
				newTabTools.siteThumbnail.style.backgroundImage = 'url("' + thumbnailURL + '")';
				newTabTools.siteThumbnail.classList.add('custom-thumbnail');
				newTabTools.saveCurrentThumbButton.disabled = true;

				Tiles.putTile(link);
			}, 'image/png');
		};
		image.onerror = function(error) {
			console.error(error);
			if (src.startsWith('blob:')) {
				URL.revokeObjectURL(src);
			}
		};
		image.src = src;
	},
	removeThumbnail(site) {
		let link = site.link;
		delete link.image;
		delete link.imageIsThumbnail;
		site.refreshThumbnail();
		this.siteThumbnail.style.backgroundImage = null;
		this.siteThumbnail.classList.remove('custom-thumbnail');
		this.getThumbnails();

		Tiles.putTile(link);
	},
	// Object-URL hygiene (audit 2026-06-10 §4.3): blob URLs are only freed on
	// document unload, so repeated-render sites revoke their prior URL before
	// creating a replacement (the fx-newTab.js refreshThumbnail pattern).
	// Each key names one owner surface (e.g. 'background', 'editorThumb') —
	// never stash a URL another surface still displays.
	_objectURLs: {},
	_freshObjectURL(key, blob) {
		this._dropObjectURL(key);
		let url = URL.createObjectURL(blob);
		this._objectURLs[key] = url;
		return url;
	},
	_dropObjectURL(key) {
		if (this._objectURLs[key]) {
			URL.revokeObjectURL(this._objectURLs[key]);
			delete this._objectURLs[key];
		}
	},
	refreshBackgroundImage() {
		// CDN wallpaper takes priority over IDB blob. Apply the
		// `background_position` Firefox publishes alongside each record so
		// e.g. "top left" wallpapers anchor at the corner the photographer
		// composed for. Solid-colour records fill the page instead.
		document.body.style.backgroundPosition =
			this.backgroundFake.style.backgroundPosition = Prefs.backgroundPosition || 'center center';
		document.body.style.backgroundColor = Prefs.backgroundColor || '';
		if (Prefs.backgroundUrl) {
			document.body.style.backgroundImage =
				this.backgroundFake.style.backgroundImage = 'url("' + Prefs.backgroundUrl + '")';
			this._dropObjectURL('background');
			this.removeBackgroundButton.disabled = false;
			return Promise.resolve();
		}
		if (Prefs.backgroundColor) {
			document.body.style.backgroundImage = this.backgroundFake.style.backgroundImage = '';
			this._dropObjectURL('background');
			this.removeBackgroundButton.disabled = false;
			return Promise.resolve();
		}

		return Background.getBackground().then(background => {
			if (!background) {
				document.body.style.backgroundImage = this.backgroundFake.style.backgroundImage = null;
				this._dropObjectURL('background');
				this.removeBackgroundButton.disabled = true;
				this.removeBackgroundButton.blur();
				return;
			}

			document.body.style.backgroundImage =
				this.backgroundFake.style.backgroundImage = 'url("' + this._freshObjectURL('background', background) + '")';
			this.removeBackgroundButton.disabled = false;
		});
	},
	async fetchFirefoxWallpapers() {
		if (this._wallpaperCache) {
			return this._wallpaperCache;
		}
		let response = await fetch('https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/newtab-wallpapers-v2/records');
		let json = await response.json();
		let cdnBase = 'https://firefox-settings-attachments.cdn.mozilla.net/';
		let wallpapers = json.data
			.filter(function(item) {
				if (item.category === 'firefox') { return false; }
				// Image record (has attachment) OR solid-colour record (has solid_color).
				return (item.attachment && item.attachment.location) || item.solid_color;
			})
			.map(function(item) {
				let record = {
					title: item.title,
					theme: item.theme,
					category: item.category,
					attribution: item.attribution,
					// Firefox publishes `background_position` on ~1/3 of
					// records; the rest fall back to centre.
					backgroundPosition: item.background_position || 'center center',
				};
				if (item.attachment && item.attachment.location) {
					record.imageUrl = cdnBase + item.attachment.location;
				}
				if (item.solid_color) {
					record.solidColor = item.solid_color;
				}
				return record;
			});
		this._wallpaperCache = wallpapers;
		return wallpapers;
	},
	openWallpaperPicker() {
		let picker = document.getElementById('wallpaper-picker');
		picker.hidden = false;
		this.fetchFirefoxWallpapers().then(wallpapers => {
			this.renderWallpaperGrid(wallpapers);
		}).catch(() => {
			let grid = document.getElementById('wallpaper-grid');
			grid.textContent = this.getString('wallpaper_error');
		});
	},
	closeWallpaperPicker() {
		document.getElementById('wallpaper-picker').hidden = true;
	},
	renderWallpaperGrid(wallpapers) {
		let grid = document.getElementById('wallpaper-grid');
		grid.textContent = '';

		let categories = {};
		for (let wp of wallpapers) {
			if (!categories[wp.category]) {
				categories[wp.category] = [];
			}
			categories[wp.category].push(wp);
		}

		for (let [category, items] of Object.entries(categories)) {
			let heading = document.createElement('h3');
			heading.className = 'wallpaper-category';
			heading.textContent = category.replace(/-/g, ' ');
			grid.appendChild(heading);

			let row = document.createElement('div');
			row.className = 'wallpaper-row';
			for (let wp of items) {
				let thumb;
				if (wp.imageUrl) {
					thumb = document.createElement('img');
					thumb.src = wp.imageUrl;
					thumb.dataset.url = wp.imageUrl;
				} else if (wp.solidColor) {
					// Solid-colour record — render a swatch instead of an <img>
					// since there's no image to load.
					thumb = document.createElement('div');
					thumb.style.backgroundColor = wp.solidColor;
					thumb.dataset.solidColor = wp.solidColor;
				} else {
					continue;
				}
				thumb.className = 'wallpaper-thumb';
				thumb.alt = wp.title;
				if ((wp.imageUrl && Prefs.backgroundUrl === wp.imageUrl)
					|| (wp.solidColor && Prefs.backgroundColor === wp.solidColor)) {
					thumb.setAttribute('selected', '');
				}
				thumb.addEventListener('click', () => {
					this.selectWallpaper(wp);
				});
				row.appendChild(thumb);
			}
			grid.appendChild(row);
		}
	},
	selectWallpaper(wallpaperOrUrl) {
		// Accept either a wallpaper record `{imageUrl, backgroundPosition,
		// solidColor}` (current call site) or a bare URL string
		// (back-compat). Solid-colour records take a different rendering
		// path — clear the image URL and write the colour instead.
		let wp = typeof wallpaperOrUrl === 'string'
			? { imageUrl: wallpaperOrUrl, backgroundPosition: 'center center' }
			: wallpaperOrUrl;
		let url = wp.imageUrl || '';
		let position = wp.backgroundPosition || 'center center';
		let solidColor = wp.solidColor || '';

		return Background.setBackground().then(() => {
			Prefs.backgroundUrl = url;
			Prefs.backgroundPosition = position;
			Prefs.backgroundColor = solidColor;
			document.body.style.backgroundPosition =
				this.backgroundFake.style.backgroundPosition = position;
			if (solidColor) {
				document.body.style.backgroundColor = solidColor;
				document.body.style.backgroundImage =
					this.backgroundFake.style.backgroundImage = '';
			} else {
				document.body.style.backgroundColor = '';
				document.body.style.backgroundImage =
					this.backgroundFake.style.backgroundImage = 'url("' + url + '")';
			}
			this.removeBackgroundButton.disabled = false;

			// Update selected state in grid
			let thumbs = document.querySelectorAll('.wallpaper-thumb');
			for (let t of thumbs) {
				if (t.dataset.url === url) {
					t.setAttribute('selected', '');
				} else {
					t.removeAttribute('selected');
				}
			}
		});
	},
	resetWallpaper() {
		Prefs.backgroundUrl = '';
		Prefs.backgroundPosition = 'center center';
		Prefs.backgroundColor = '';
		Background.setBackground().then(() => {
			this.refreshBackgroundImage();
			let thumbs = document.querySelectorAll('.wallpaper-thumb');
			for (let t of thumbs) {
				t.removeAttribute('selected');
			}
		});
	},
	parseColour(str) {
		let parts = /^(hsl|rgb)a?\((\d+),\s*([\d.]+%?),\s*([\d.]+%?)/.exec(str);
		if (parts && parts[1] == 'rgb') {
			return {
				r: parseInt(parts[2], 10),
				g: parseInt(parts[3], 10),
				b: parseInt(parts[4], 10),
			};
		}

		if (parts && parts[1] == 'hsl') {
			let h = parseFloat(parts[2]) / 360;
			let s = parseFloat(parts[3]) / 100;
			let l = parseFloat(parts[4]) / 100;
			let r, g, b;

			if (s == 0){
				r = g = b = l;
			} else {
				function hue2rgb(p, q, t) {
					if (t < 0) {
						t += 1;
					}
					if (t > 1) {
						t -= 1;
					}
					if (t < 1/6) {
						return p + (q - p) * 6 * t;
					}
					if (t < 1/2) {
						return q;
					}
					if (t < 2/3) {
						return p + (q - p) * (2/3 - t) * 6;
					}
					return p;
				}

				let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
				let p = 2 * l - q;
				r = hue2rgb(p, q, h + 1/3);
				g = hue2rgb(p, q, h);
				b = hue2rgb(p, q, h - 1/3);
			}

			return {
				r: Math.round(r * 255),
				g: Math.round(g * 255),
				b: Math.round(b * 255),
			};
		}

		parts = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(str);
		if (parts) {
			return {
				r: parseInt(parts[1], 16),
				g: parseInt(parts[2], 16),
				b: parseInt(parts[3], 16),
			};
		}

		parts = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i.exec(str);
		if (parts) {
			return {
				r: parseInt(parts[1].repeat(2), 16),
				g: parseInt(parts[2].repeat(2), 16),
				b: parseInt(parts[3].repeat(2), 16),
			};
		}

		return null;
	},
	async updateThemeColours(updateInfo) {
		let properties = {
			'--back-opaque': null,
			'--contrast-opaque': null,
			'--contrast-transp': null,
			'--fore-opaque': null,
			'--fore-trans1': null,
			'--fore-transp': null,
			'--page-background': null,
		};

		if (Prefs.theme === 'system') {
			try {
				this._theme = updateInfo ? updateInfo.theme : await browser.theme.getCurrent();
			} catch (ex) {
				console.debug(ex);
				this._theme = null;
			}
			// Firefox's default theme (and wallpaper-only themes) return colors:
			// null or omit the key entirely. Treat both as "no palette to apply"
			// and fall through to the designed NTT palette in tokens.css.
			let colors = this._theme && this._theme.colors;
			if (colors) {
				let back = this.parseColour(colors.ntp_background || colors.toolbar);
				let fore = this.parseColour(colors.ntp_text || colors.toolbar_text);

				if (back && fore) {
					properties['--back-opaque'] = `rgb(${back.r}, ${back.g}, ${back.b})`;
					properties['--fore-opaque'] = `rgb(${fore.r}, ${fore.g}, ${fore.b})`;
					properties['--fore-trans1'] = `rgba(${fore.r}, ${fore.g}, ${fore.b}, 0.1)`;
					properties['--fore-transp'] = `rgba(${fore.r}, ${fore.g}, ${fore.b}, var(--opacity))`;
					properties['--page-background'] = `rgb(${back.r}, ${back.g}, ${back.b})`;

					let brightness = 0.299 * fore.r + 0.587 * fore.g + 0.114 * fore.b;
					if (brightness < 144) {
						properties['--contrast-opaque'] = 'rgb(255, 255, 255)';
						properties['--contrast-transp'] = 'rgba(255, 255, 255, var(--opacity))';
					} else {
						properties['--contrast-opaque'] = 'rgb(0, 0, 0)';
						properties['--contrast-transp'] = 'rgba(0, 0, 0, var(--opacity))';
					}
				}
			}
		} else {
			this._theme = null;
		}

		for (let [key, value] of Object.entries(properties)) {
			document.documentElement.style.setProperty(key, value);
		}

		for (let [selector, name] of Object.entries({
			'.close-button': 'close',
			'button.arrow': 'arrow',
		})) {
			let url = await this.getThemedImageURL(name);
			for (let element of document.querySelectorAll(selector)) {
				element.style.backgroundImage = url ? `url(${url})` : null;
			}
		}
	},
	async getThemedImageURL(name, theme = Prefs.theme) {
		let effectiveTheme = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
		let fore = document.documentElement.style.getPropertyValue('--fore-opaque');
		let back = document.documentElement.style.getPropertyValue('--back-opaque');

		if (!fore) {
			return null;
		}

		try {
			let request = await fetch(browser.runtime.getURL(`images/${name}-${effectiveTheme}.svg`));
			let content = await request.text();
			content = content.replaceAll('#fff', fore);
			content = content.replaceAll('#1f364c', back);
			return 'data:image/svg+xml;base64,' + btoa(content);
		} catch (ex) {
			console.debug(ex);
			return null;
		}
	},
	updateUI(keys) {
		function setMargin(piece, size) {
			for (let pieceElement of document.querySelectorAll(piece)) {
				pieceElement.classList.remove('medium');
				pieceElement.classList.remove('large');
				if (size == 'medium' || size == 'large') {
					pieceElement.classList.add(size);
				}
			}
		}

		if (!keys || keys.includes('rows')) {
			let el = document.querySelector('[name="rows"]');
			if (el) { el.value = Prefs.rows; }
			this._syncDrawerSegmented('rows', Prefs.rows);
		}

		if (!keys || keys.includes('columns')) {
			let el = document.querySelector('[name="columns"]');
			if (el) { el.value = Prefs.columns; }
			this._syncDrawerSegmented('columns', Prefs.columns);
		}

		if (!keys || keys.includes('theme')) {
			let theme = Prefs.theme;
			let effectiveTheme = theme === 'system'
				? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
				: theme;
			let radio = document.querySelector('[name="theme"][value="' + theme + '"]');
			if (radio) { radio.checked = true; }
			document.documentElement.setAttribute('theme', effectiveTheme);
			this.darkIcons.disabled = effectiveTheme == 'light';
			this._syncDrawerSegmented('theme', theme);
			this.updateThemeColours();
			if (theme === 'system') {
				browser.theme.onUpdated.addListener(this.updateThemeColours);
			} else {
				browser.theme.onUpdated.removeListener(this.updateThemeColours);
			}
		}

		if (!keys || keys.includes('locked')) {
			let locked = Prefs.locked;
			let lockedCheckbox = document.querySelector('[name="locked"]');
			if (lockedCheckbox) { lockedCheckbox.checked = locked; }
			if (locked) {
				document.documentElement.setAttribute('locked', 'true');
			} else {
				document.documentElement.removeAttribute('locked');
			}
		}

		if (!keys || keys.includes('titleSize')) {
			let titleSize = Prefs.titleSize;
			let el = document.querySelector('[name="titleSize"]');
			if (el) { el.value = titleSize; }
			document.documentElement.setAttribute('titlesize', titleSize);
			this._syncDrawerToggle('titleSize', titleSize !== 'hidden');
		}

		if (!keys || keys.includes('margin')) {
			let margin = Prefs.margin;
			let el = document.querySelector('[name="margin"]');
			if (el) { el.value = margin.join(' '); }
			setMargin('#newtab-margin-top', margin[0]);
			setMargin('.newtab-margin-right', margin[1]);
			setMargin('#newtab-margin-bottom', margin[2]);
			setMargin('.newtab-margin-left', margin[3]);
			setMargin('#ntt-titlebar', margin[3]);
			this._syncDrawerSlider('margin', margin[0], { small: 10, medium: 18, large: 28 });
		}

		if (!keys || keys.includes('spacing')) {
			let spacing = Prefs.spacing;
			let el = document.querySelector('[name="spacing"]');
			if (el) { el.value = spacing; }
			document.documentElement.setAttribute('spacing', spacing);
			let gapMap = { small: 10, medium: 18, large: 28 };
			document.documentElement.style.setProperty('--ntt-gap', (gapMap[spacing] || 18) + 'px');
			this._syncDrawerSlider('spacing', spacing, gapMap);
		}

		if (!keys || keys.includes('tileRadius')) {
			let radiusMap = { small: 4, medium: 10, large: 18 };
			let tileRadius = Prefs.tileRadius;
			document.documentElement.style.setProperty('--ntt-radius', (radiusMap[tileRadius] || 10) + 'px');
			this._syncDrawerSlider('tileRadius', tileRadius, radiusMap);
		}

		if (!keys || keys.includes('actionIconSize')) {
			let actionMap = { small: [22, 11], medium: [33, 16], large: [44, 22] };
			let size = Prefs.actionIconSize;
			let [btn, icon] = actionMap[size] || actionMap.medium;
			document.documentElement.style.setProperty('--ntt-action-btn-size', btn + 'px');
			document.documentElement.style.setProperty('--ntt-action-icon-size', icon + 'px');
			this._syncDrawerSegmented('actionIconSize', size);
		}

		if (!keys || keys.includes('tileActions')) {
			document.documentElement.setAttribute('tile-actions', Prefs.tileActions ? 'true' : 'false');
			this._syncDrawerToggle('tileActions', Prefs.tileActions);
		}

		if (!keys || keys.includes('statType')) {
			this._syncDrawerSegmented('statType', Prefs.statType);
		}

		if (!keys || keys.includes('tileAspect')) {
			let tileAspect = Prefs.tileAspect;
			let el = document.querySelector('[name="tileAspect"]');
			if (el) { el.value = tileAspect; }
			document.documentElement.setAttribute('tileaspect', tileAspect);
			this._syncDrawerSegmented('tileAspect', tileAspect);
		}

		if (!keys || keys.includes('tileAspect') || keys.includes('rows') || keys.includes('columns') || keys.includes('spacing')) {
			this.applyTileAspect();
		}

		// Background prefs (CDN wallpaper URL, solid colour, position) apply on
		// the same live path as every other pref. Without this, a restore — which
		// writes backgroundUrl to storage and fires prefsChanged → updateUI — left
		// the wallpaper unapplied until a manual page reload.
		if (!keys || keys.includes('backgroundUrl') || keys.includes('backgroundColor')
			|| keys.includes('backgroundPosition')) {
			this.refreshBackgroundImage();
		}

		if (!keys || keys.includes('opacity')) {
			let opacity = Prefs.opacity;
			document.querySelector('[name="opacity"]').value = opacity;
			document.documentElement.style.setProperty('--opacity', opacity / 100);
		}

		if (!keys || keys.includes('history')) {
			let history = Prefs.history;
			this._syncDrawerToggle('history', history);
			let filterBtn = document.getElementById('historytiles-filter');
			if (filterBtn) { filterBtn.disabled = !history; }
		}

		if (!keys || keys.includes('recent')) {
			let recent = Prefs.recent;
			let el = document.querySelector('[name="recent"]');
			if (el) { el.checked = recent; }
			this._syncDrawerToggle('recent', recent);
			this.refreshRecent();
		}

		if (!keys || keys.includes('titleBarSearch')) {
			let el = document.getElementById('ntt-search');
			if (el) { el.hidden = !Prefs.titleBarSearch; }
			this._syncDrawerToggle('titleBarSearch', Prefs.titleBarSearch);
		}

		// Spacing/margin change the titlebar padding, and the search toggle
		// changes which slots are present — both re-flow the recent row.
		if (!keys || keys.includes('spacing') || keys.includes('margin')
			|| keys.includes('titleBarSearch')) {
			this.refreshRecent();
		}

		if (keys && keys.includes('statType') && 'Grid' in window) {
			for (let site of Grid.sites) {
				if (site) {
					site._renderStatChip();
				}
			}
		}

		if ('Grid' in window && 'cacheCellPositions' in Grid) {
			requestAnimationFrame(Grid.cacheCellPositions);
		}

		if (document.documentElement.hasAttribute('drawer-open')
			&& document.documentElement.getAttribute('drawer-tab') === 'tile') {
			this.resizeOptionsThumbnail();
		}

		if (keys && keys.includes('neverCaptureHosts')) {
			// Re-populate the never-capture drawer panel when the stored list changes
			// (e.g. the per-tile toggle on the grid flips an entry).
			if (this.optionsNeverCaptureList) {
				this.fillNeverCaptureUI();
			}
			// Refresh each rendered tile's never-capture button state.
			if ('Grid' in window && Grid.sites) {
				Grid.sites.forEach(site => {
					if (site && site.updateNeverCaptureButton) {
						site.updateNeverCaptureButton(NeverCapture.matches(site.url));
					}
				});
			}
		}
	},
	_initTitlebar() {
		let searchEl = document.getElementById('ntt-search');
		if (searchEl) {
			let icon = NttIcons.create('search', 14);
			searchEl.insertBefore(icon, searchEl.firstChild);
		}
		this._layoutTitlebar();
		// Re-flow the recently-closed row whenever the space available to it
		// actually changes — window resize, spacing / outer-padding changes,
		// the search toggle (hiding the search box widens the row), and the
		// config-drawer push-layout (which animates over ~220ms). The recent
		// container is a greedy flex child, so observing ITS size captures all
		// of those in one signal. A ResizeObserver tracks the settled width
		// continuously, which is far more robust than a one-shot post-transition
		// timer: that timer could fire mid-animation, cap the card count against
		// a transient narrow width, and then never recover once the width
		// settled (the reported "drawer collapses the row and closing it doesn't
		// restore" bug). Re-flowing only changes the cards' width, not the
		// container's, so this never feeds back into itself.
		let recent = document.getElementById('ntt-titlebar-recent');
		if (recent && typeof ResizeObserver !== 'undefined') {
			let scheduled = false;
			this._titlebarResizeObserver = new ResizeObserver(() => {
				if (scheduled) {
					return;
				}
				scheduled = true;
				requestAnimationFrame(() => {
					scheduled = false;
					this.refreshRecent();
				});
			});
			this._titlebarResizeObserver.observe(recent);
		}
		// A web-font swap changes the masthead's width and thus the room left
		// for cards; re-flow once fonts settle so the first paint isn't off by
		// a card.
		if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
			document.fonts.ready.then(() => this.refreshRecent());
		}
	},
	/**
	 * Measure the greedy recently-closed card container and set `--ntt-slot-w`
	 * so the cards shrink to fill it edge-to-edge (see computeTitlebarSlots).
	 * Stashes the recent-card cap on `this._recentCardCount` for refreshRecent.
	 * Returns the slot descriptor so callers can chain.
	 */
	_layoutTitlebar() {
		let titlebar = document.getElementById('ntt-titlebar');
		let recent = document.getElementById('ntt-titlebar-recent');
		if (!titlebar || !recent) {
			this._recentCardCount = 0;
			return { cardCount: 0, slotWidth: 186 };
		}
		// The recent-cards container is a greedy flex child, so the browser has
		// already sized it to exactly the room left after the fixed search box
		// and the content-width masthead — whether the search box is shown,
		// whether the config drawer is open, and at any window width. We just
		// read that settled width. It must be laid out (not display:none) to
		// report a real width AND to keep pinning the masthead right, so the
		// container is always visible — when there are no cards it is simply an
		// empty spacer.
		recent.hidden = false;
		let cs = window.getComputedStyle(titlebar);
		let gap = parseFloat(cs.columnGap || cs.gap) || 10;
		let cardSpace = recent.clientWidth;
		if (!cardSpace || cardSpace < 0) {
			cardSpace = 0;
		}
		let slots = this.computeTitlebarSlots(cardSpace, gap, 186);
		// `recent` pref off → never show cards (the empty greedy container still
		// acts as the spacer that pins the masthead right).
		if (typeof Prefs !== 'undefined' && !Prefs.recent) {
			slots.cardCount = 0;
		}
		titlebar.style.setProperty('--ntt-slot-w', slots.slotWidth + 'px');
		this._recentCardCount = slots.cardCount;
		return slots;
	},
	_formatAge(lastModified) {
		if (!lastModified) {
			return '';
		}
		let seconds = Math.floor(Date.now() / 1000) - lastModified;
		if (seconds < 60) {
			return seconds + 's';
		}
		let minutes = Math.floor(seconds / 60);
		if (minutes < 60) {
			return minutes + 'm';
		}
		let hours = Math.floor(minutes / 60);
		if (hours < 24) {
			return hours + 'h';
		}
		let days = Math.floor(hours / 24);
		return days + 'd';
	},
	refreshRecent() {
		// Re-flow the titlebar slots first so `_recentCardCount` reflects the
		// current width before we decide how many cards to render.
		let slots = this._layoutTitlebar();
		let cap = slots ? slots.cardCount : 0;
		let strip = this.recentList;
		if (!strip) {
			return;
		}

		if (!Prefs.recent || cap <= 0) {
			// No cards to show, but keep the (empty) container laid out: it is
			// the greedy spacer that pins the masthead to the right edge.
			for (let element of strip.querySelectorAll('.ntt-recent-card')) {
				strip.removeChild(element);
			}
			return;
		}

		chrome.sessions.getRecentlyClosed(undoItems => {
			let added = 0;

			for (let element of strip.querySelectorAll('.ntt-recent-card')) {
				strip.removeChild(element);
			}

			// The cards are rebuilt from scratch — revoke the prior render's
			// favicon blob URLs before this render creates new ones (§4.3).
			for (let staleURL of newTabTools._recentFaviconURLs || []) {
				URL.revokeObjectURL(staleURL);
			}
			newTabTools._recentFaviconURLs = [];

			function card_onclick() {
				chrome.sessions.restore(this.dataset.sessionId);
				return false;
			}

			let tileURLs = new Set();
			if (typeof Grid !== 'undefined' && Grid.sites) {
				for (let site of Grid.sites) {
					if (site && site.url) {
						tileURLs.add(site.url);
					}
				}
			}
			let seen = new Set();
			let needFavicon = [];

			for (let item of undoItems) {
				if (added >= cap) {
					break;
				}
				if (!item.tab || item.tab.incognito) {
					continue;
				}
				if (item.tab.url && item.tab.url.startsWith('moz-extension://')) {
					continue;
				}
				// Validate the tab URL's protocol before it becomes `card.href`.
				// Middle-click / Ctrl+click bypass the onclick restore handler and
				// navigate the href directly, so a `javascript:`/`data:` session
				// URL must be filtered at this data boundary (mirrors the
				// favIconUrl validation below).
				if (!newTabTools.isValidURL(item.tab.url)) {
					continue;
				}
				if (tileURLs.has(item.tab.url)) {
					continue;
				}

				let {url, title, sessionId, favIconUrl, lastModified} = item.tab;
				let displayTitle = title || url;
				let domain;
				try {
					// Registrable-ish domain: drop a leading `www.` so the chip
					// reads `theverge.com`, not `www.theverge.com` (§4).
					domain = new URL(url).hostname.replace(/^www\./, '');
				} catch (e) {
					domain = url;
				}

				let dedup = (title || '') + '\n' + domain;
				if (seen.has(dedup)) {
					continue;
				}
				seen.add(dedup);

				let card = document.createElement('a');
				card.href = url;
				card.className = 'ntt-recent-card';
				card.title = (!title || title == url ? title : title + '\n' + url);
				card.dataset.sessionId = sessionId;
				card.onclick = card_onclick;

				let fav = document.createElement('span');
				fav.className = 'ntt-recent-favicon';
				// Letter fallback from the registrable domain (same logic as the
				// tiles), not the page title — `H` for heise.de, not the headline.
				let glyph = (domain.charAt(0) || displayTitle.charAt(0) || '?').toUpperCase();
				let hue = (url.length * 7 + glyph.charCodeAt(0) * 13) % 360;
				fav.style.backgroundColor = 'hsl(' + hue + ', 50%, 40%)';
				if (favIconUrl && newTabTools.isValidURL(favIconUrl)) {
					let img = document.createElement('img');
					img.onerror = function() { this.remove(); };
					img.src = favIconUrl;
					fav.appendChild(img);
				} else {
					fav.appendChild(document.createTextNode(glyph));
					// No favicon in the session record — try the extension's stored
					// favicon once the row is built. Favicons are per-site, but a
					// recently-closed tab is usually a deep article URL that won't
					// exact-match a stored tile/homepage URL, so match by host.
					needFavicon.push({ host: domain, fav });
				}
				card.appendChild(fav);

				let text = document.createElement('span');
				text.className = 'ntt-recent-text';
				let nameEl = document.createElement('span');
				nameEl.className = 'ntt-recent-name';
				nameEl.appendChild(document.createTextNode(displayTitle));
				text.appendChild(nameEl);
				let urlEl = document.createElement('span');
				urlEl.className = 'ntt-recent-url';
				urlEl.appendChild(document.createTextNode(domain));
				text.appendChild(urlEl);
				card.appendChild(text);

				let age = newTabTools._formatAge(lastModified);
				if (age) {
					let ageEl = document.createElement('span');
					ageEl.className = 'ntt-recent-age';
					ageEl.appendChild(document.createTextNode(age));
					card.appendChild(ageEl);
				}

				strip.appendChild(card);
				added++;
			}
			strip.hidden = !added;

			// §3c: cards that fell back to the letter glyph use the extension's
			// stored favicon (collected during tile capture) when one exists —
			// closed-tab session data often carries no favIconUrl. Match by host
			// (favicons are per-site) so a deep article URL reuses the site's
			// stored favicon.
			if (needFavicon.length) {
				let hosts = [...new Set(needFavicon.map(n => n.host).filter(Boolean))];
				chrome.runtime.sendMessage({ name: 'Thumbnails.getFaviconsByHost', hosts }, favicons => {
					if (!favicons || typeof favicons.get !== 'function') {
						return;
					}
					for (let { host, fav } of needFavicon) {
						let favicon = host && favicons.get(host);
						let src = null;
						if (favicon instanceof Blob) {
							src = URL.createObjectURL(favicon);
							newTabTools._recentFaviconURLs.push(src);
						} else if (typeof favicon === 'string' && newTabTools.isValidURL(favicon)) {
							src = favicon;
						}
						if (!src) {
							continue;
						}
						let img = document.createElement('img');
						img.onerror = function() { this.remove(); };
						img.src = src;
						for (let node of [...fav.childNodes]) {
							if (node.nodeType === Node.TEXT_NODE) {
								node.remove();
							}
						}
						fav.appendChild(img);
					}
				});
			}
		});
	},
	trimRecent() {
	},
	_showConfirm(rowId) {
		let row = document.getElementById(rowId);
		if (row) { row.hidden = false; }
	},
	_hideConfirm(rowId) {
		let row = document.getElementById(rowId);
		if (row) { row.hidden = true; }
	},
	async resetAllSettings() {
		// Hard reset: wipe pinned tiles, blocked URLs, history filters and
		// every persisted pref. The inline Confirm/Cancel row (§7) gates this —
		// destructive and irreversible, so there is no window.confirm here.
		// The page-side `Tiles` (tiles-shim.js) is just an IPC façade — no
		// `.clear()` method exists. Route through the background which owns
		// the IDB transaction. Clear the Thumbnails store (captured screenshots
		// + cached favicons of every visited site) and the Background store
		// (uploaded wallpaper) too — a factory reset must not leave a user's
		// browsing imagery on disk.
		await new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.clear' }, () => resolve());
		});
		await new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Thumbnails.clear' }, () => resolve());
		});
		await new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Background.setBackground', file: null }, () => resolve());
		});
		// Blocked + Filters + NeverCapture live inside chrome.storage.local, so
		// clearing it wipes them along with prefs. We zero the in-memory copies
		// too so anything reading them before reload sees the cleared state.
		Blocked._list = [];
		Filters._list = Object.create(null);
		if (typeof NeverCapture !== 'undefined') { NeverCapture.clear(); }
		await new Promise(resolve => chrome.storage.local.clear(resolve));
		// Reload so every component picks up the cleared state from a
		// known-clean start.
		location.reload();
	},
	formatRelativeTime(elapsedMs) {
		// Used by the drawer's auto-save indicator. Returns the localised
		// "just now" / "Nm ago" / "Nh ago" string for the elapsed time.
		if (elapsedMs < 60000) {
			return this.getString('autosaved_relative_now');
		}
		if (elapsedMs < 3600000) {
			let minutes = Math.floor(elapsedMs / 60000);
			return this.getString('autosaved_relative_minutes', String(minutes));
		}
		let hours = Math.floor(elapsedMs / 3600000);
		return this.getString('autosaved_relative_hours', String(hours));
	},
	_renderAutoSavedIndicator() {
		let el = document.getElementById('ntt-drawer-footer-msg');
		if (!el) {
			return;
		}
		if (!this._autoSavedAt) {
			// No real save has happened yet — hide the indicator instead
			// of showing a misleading "just now" on a fresh page.
			el.hidden = true;
			el.textContent = '';
			return;
		}
		el.hidden = false;
		let elapsed = Date.now() - this._autoSavedAt;
		el.textContent = `${this.getString('options_autosaved')} · ${this.formatRelativeTime(elapsed)}`;
	},
	_markAutoSaved() {
		this._autoSavedAt = Date.now();
		this._renderAutoSavedIndicator();
	},
	_initAutoSaveIndicator() {
		// Don't seed `_autoSavedAt` on init — wait for the first real
		// prefs change. The indicator stays hidden until then.
		this._autoSavedAt = null;
		this._renderAutoSavedIndicator();
		if (this._autoSaveTickInterval) {
			clearInterval(this._autoSaveTickInterval);
		}
		// Tick once a minute so the relative timestamp advances without
		// needing further pref activity.
		this._autoSaveTickInterval = setInterval(
			() => this._renderAutoSavedIndicator(),
			60000
		);
	},
	get selectedSiteIndex() {
		return this._selectedSiteIndex;
	},
	set selectedSiteIndex(index) {
		this._selectedSiteIndex = index;
		let site = (index == null) ? null : this.selectedSite;
		let disabled = site == null;

		// Tile tab empty state — hide edit area + show placeholder when
		// nothing is selected (Phase 3-2).
		let emptyState = document.querySelector('[data-tile-empty]');
		let editArea = document.getElementById('options-tile');
		if (emptyState) { emptyState.hidden = !disabled; }
		if (editArea) { editArea.hidden = disabled; }

		// Move `[data-selected]` from any prior selection to the new one
		// so CSS can draw the copper ring on the active tile.
		if ('Grid' in window && Grid.sites) {
			for (let s of Grid.sites) {
				if (s && s.node) { s.node.removeAttribute('data-selected'); }
			}
		}
		if (site && site.node) { site.node.setAttribute('data-selected', 'true'); }

		if (disabled) {
			// The fields below need real DOM stubs — bail out early when no
			// tile is selected (the empty state is doing the talking).
			return;
		}

		this.setSavedThumbInput.value = '';
		this.setSavedThumbInput.disabled =
			this.setTitleInput.disabled =
			this.setTitleButton.disabled =
			this.setBgColourDisplay.parentNode.disabled = disabled;

		if (disabled) {
			this._dropObjectURL('editorThumb');
			this.siteThumbnail.style.backgroundImage =
				this.siteThumbnail.style.backgroundColor =
				this.setBgColourDisplay.style.backgroundColor = null;
			this.setTitleInput.value = '';
			this.saveCurrentThumbButton.disabled =
				this.removeSavedThumbButton.disabled =
				this.setBgColourButton.disabled =
				this.resetBgColourButton.disabled = true;
			return;
		}

		if (site.link.image) {
			let thumbnailURL = this._freshObjectURL('editorThumb', site.link.image);
			this.siteThumbnail.style.backgroundImage = 'url("' + thumbnailURL + '")';
			if (site.link.imageIsThumbnail) {
				this.siteThumbnail.classList.remove('custom-thumbnail');
			} else {
				this.siteThumbnail.classList.add('custom-thumbnail');
			}
			this.saveCurrentThumbButton.disabled = true;
			this.removeSavedThumbButton.disabled = false;
		} else {
			// Borrowed URL: the tile owns it (s._thumbnailObjectURL) — the
			// editor only drops its own stale preview URL here (§4.3).
			this._dropObjectURL('editorThumb');
			this.siteThumbnail.style.backgroundImage = site.thumbnail.style.backgroundImage;
			this.siteThumbnail.classList.remove('custom-thumbnail');
			this.saveCurrentThumbButton.disabled = !this.siteThumbnail.style.backgroundImage;
			this.removeSavedThumbButton.disabled = true;
		}

		// The URL is shown (and edited) in the input; no separate read-only label.
		// The edit row is always available now (editing an auto tile's URL pins it).
		this.siteURLInput.value = site.url;
		let backgroundColor = site.link.backgroundColor;
		this.siteThumbnail.style.backgroundColor =
			this.setBgColourInput.value =
			this.setBgColourDisplay.style.backgroundColor = backgroundColor || null;
		this.setBgColourButton.disabled =
			this.resetBgColourButton.disabled = !backgroundColor;
		this.setTitleInput.value = site.title || site.url;
	},
	drawerOnClick(event) {
		let target = event.target;

		// Segmented button click: <button role="radio" data-value="X"> inside
		// `.ntt-segmented[data-pref]` or `.ntt-theme-cards[data-pref]` (theme
		// cards are visually distinct but behave like a radiogroup of
		// segmented buttons).
		let segmented = target.closest && (
			target.closest('.ntt-segmented') || target.closest('.ntt-theme-cards')
		);
		// Theme card click: target may be a swatch/label child — find the
		// nearest `[data-value]` ancestor inside the group.
		let valueEl = segmented && target.closest('[data-value]');
		if (segmented && valueEl) {
			let pref = segmented.dataset.pref;
			let raw = valueEl.dataset.value;
			if (pref === 'rows' || pref === 'columns') {
				Prefs[pref] = parseInt(raw, 10);
			} else if (raw === 'true' || raw === 'false') {
				Prefs[pref] = raw === 'true';
			} else {
				Prefs[pref] = raw;
			}
			// Stats other than `none` and `rank` need the optional `history`
			// permission. Request it now (we are in a user-gesture handler).
			if (pref === 'statType' && raw !== 'none' && raw !== 'rank') {
				this._ensureHistoryPermission();
			}
			return;
		}

		// Toggle row: a click anywhere inside `.ntt-toggle-row[data-pref]`
		// (button, label, kbd hint) flips the bound pref.
		let toggleRow = target.closest && target.closest('.ntt-toggle-row[data-pref]');
		if (toggleRow) {
			let pref = toggleRow.dataset.pref;
			if (pref === 'titleSize') {
				Prefs.titleSize = Prefs.titleSize === 'hidden' ? 'small' : 'hidden';
			} else {
				Prefs[pref] = !Prefs[pref];
			}
			return;
		}

		// Drawer tab button.
		if (target.dataset && target.dataset.drawerTab) {
			this.switchDrawerTab(target.dataset.drawerTab);
			return;
		}

		// Close button.
		if (target.id === 'ntt-drawer-close' || (target.closest && target.closest('#ntt-drawer-close'))) {
			this.closeDrawer();
			return;
		}
	},
	drawerOnChange(event) {
		let target = event.target;
		// `tagName` is lowercase in XHTML and uppercase in HTML; compare via
		// `target.type` instead since `type === 'range'` is unambiguous.
		if (target.type === 'range' && target.dataset && target.dataset.pref) {
			let pref = target.dataset.pref;
			let idx = parseInt(target.value, 10);
			let value = ['small', 'medium', 'large'][idx];
			if (!value) {
				return;
			}
			// Realtime label feedback — update the px display in the
			// slider head before the chrome.storage round-trip lands.
			let pxMaps = {
				spacing: { small: 10, medium: 18, large: 28 },
				margin: { small: 10, medium: 18, large: 28 },
				tileRadius: { small: 4, medium: 10, large: 18 },
			};
			let wrap = target.closest('.ntt-slider-snap');
			let label = wrap && wrap.querySelector('.ntt-slider-value');
			if (label && pxMaps[pref]) {
				label.textContent = pxMaps[pref][value] + 'px';
			}
			if (pref === 'margin') {
				Prefs.margin = [value, value, value, value];
			} else {
				Prefs[pref] = value;
			}
			return;
		}
		// Fall through to legacy form handling for relocated <select>, <input>
		// (theme radios, opacity range, tileAspect select, checkboxes).
		this.optionsOnChange(event);
	},
	_syncDrawerSegmented(pref, value) {
		// Matches `.ntt-segmented` and `.ntt-theme-cards` — both carry
		// `role="radiogroup"` + `data-pref`.
		let group = document.querySelector(`[role="radiogroup"][data-pref="${pref}"]`);
		if (!group || typeof group.querySelectorAll !== 'function') {
			return;
		}
		let str = String(value);
		for (let btn of group.querySelectorAll('[data-value]')) {
			btn.setAttribute('aria-checked', btn.dataset.value === str ? 'true' : 'false');
		}
	},
	_syncDrawerToggle(pref, value) {
		let toggle = document.querySelector(`.ntt-toggle[data-pref="${pref}"]`);
		if (!toggle || typeof toggle.setAttribute !== 'function') {
			return;
		}
		toggle.setAttribute('aria-checked', value ? 'true' : 'false');
	},
	_syncDrawerSlider(pref, value, pxMap) {
		let wrap = document.querySelector(`.ntt-slider-snap[data-pref="${pref}"]`);
		if (!wrap || typeof wrap.querySelector !== 'function') {
			return;
		}
		let idx = ['small', 'medium', 'large'].indexOf(value);
		if (idx < 0) {
			return;
		}
		let range = wrap.querySelector('input[type="range"]');
		if (range) {
			range.value = String(idx);
		}
		let label = wrap.querySelector('.ntt-slider-value');
		if (label) {
			label.textContent = pxMap[value] + 'px';
		}
	},
	_ensureHistoryPermission() {
		if (typeof chrome === 'undefined' || !chrome.permissions) {
			return;
		}
		// Firefox loses the user-gesture context across async callbacks, so
		// we must call `request` synchronously from the click handler. The
		// request itself short-circuits when the permission is already
		// granted (`accepted` will be true with no prompt shown).
		chrome.permissions.request({ permissions: ['history'] }, accepted => {
			if (!accepted) {
				return;
			}
			if (typeof TileStats !== 'undefined') {
				TileStats._hasHistoryPermission = true;
			}
			if ('Grid' in window) {
				for (let site of Grid.sites) {
					if (site && typeof site._renderStatChip === 'function') {
						site._renderStatChip();
					}
				}
			}
		});
	},
	openDrawer() {
		document.documentElement.setAttribute('drawer-open', '');
		// Drawer-open IS edit mode (§2): unlock the board so tiles can move and
		// the edit affordances show; the titlebar button becomes "Done". Set the
		// attribute directly (immediate, no storage round-trip) and persist via
		// the pref so the drag guard + a reload agree.
		document.documentElement.removeAttribute('locked');
		if (typeof Prefs !== 'undefined') { Prefs.locked = false; }
		if (this._setEditButtonLabel) { this._setEditButtonLabel(true); }
		let drawer = document.getElementById('ntt-drawer');
		if (drawer) {
			drawer.setAttribute('aria-hidden', 'false');
			drawer.focus();
		}
		this._autoSelectFirstTileIfNeeded();
		this._refreshGridPositionsAfterDrawerTransition();
	},
	closeDrawer() {
		document.documentElement.removeAttribute('drawer-open');
		// Closing exits edit mode and re-locks the board (§2).
		document.documentElement.setAttribute('locked', 'true');
		if (typeof Prefs !== 'undefined') { Prefs.locked = true; }
		if (this._setEditButtonLabel) { this._setEditButtonLabel(false); }
		let drawer = document.getElementById('ntt-drawer');
		if (drawer) {
			drawer.setAttribute('aria-hidden', 'true');
		}
		this._refreshGridPositionsAfterDrawerTransition();
	},
	_setEditButtonLabel(editing) {
		let btn = this.optionsToggleButton;
		if (btn) {
			btn.textContent = this.getString(editing ? 'options_done' : 'options_edit');
		}
	},
	_refreshGridPositionsAfterDrawerTransition() {
		// The drawer's flex-basis/width animates over 220ms. The grid and the
		// titlebar reflow during that animation but no resize event fires, so
		// cached cell positions go stale and the titlebar slot width no longer
		// matches the narrower content area. Re-cache + re-flow the recent row
		// once the transition has settled. (Drag.start also re-caches.)
		setTimeout(() => {
			if (typeof Grid !== 'undefined' && typeof Grid.cacheCellPositions === 'function') {
				Grid.cacheCellPositions();
			}
			this.refreshRecent();
		}, 240);
	},
	toggleDrawer() {
		if (document.documentElement.hasAttribute('drawer-open')) {
			this.closeDrawer();
		} else {
			this.openDrawer();
		}
	},
	switchDrawerTab(name) {
		let target = document.querySelector(`[data-drawer-tab="${name}"]`);
		if (!target) {
			return;
		}
		for (let tab of document.querySelectorAll('[data-drawer-tab]')) {
			tab.dataset.active = String(tab.dataset.drawerTab === name);
		}
		for (let panel of document.querySelectorAll('[data-drawer-panel]')) {
			panel.hidden = panel.dataset.drawerPanel !== name;
		}
		document.documentElement.setAttribute('drawer-tab', name);
		if (name === 'tile') {
			this._autoSelectFirstTileIfNeeded();
		}
		if (name === 'advanced' && typeof this.fillNeverCaptureUI === 'function') {
			this.fillNeverCaptureUI();
		}
	},
	_autoSelectFirstTileIfNeeded() {
		// Only on the Tile tab — Page/Advanced don't depend on a selection.
		// Empty state ("Click a tile to edit") still surfaces when the grid
		// is genuinely empty.
		if (document.documentElement.getAttribute('drawer-tab') !== 'tile') {
			return;
		}
		if (this.selectedSiteIndex != null) {
			return;
		}
		if (typeof Grid === 'undefined' || !Grid.sites) {
			return;
		}
		let first = Grid.sites.findIndex(s => s && s.node);
		if (first >= 0) {
			this.selectedSiteIndex = first;
		}
	},
	resizeOptionsThumbnail() {
		let node = Grid.node.querySelector('.newtab-thumbnail');
		if (!node || !node.offsetWidth) {
			return;
		}
		let ratio = node.offsetWidth / node.offsetHeight;
		// Drawer is 360px wide with ~32px of padding — keep the preview well
		// inside that envelope so the edit fields don't get crowded.
		if (ratio > 1.6666) {
			this.siteThumbnail.style.width = '200px';
			this.siteThumbnail.style.height = 200 / ratio + 'px';
		} else {
			this.siteThumbnail.style.width = 120 * ratio + 'px';
			this.siteThumbnail.style.height = '120px';
		}
	},
	computeTitlebarSlots(cardSpace, gap, full = 186) {
		// `cardSpace` is the measured inner width of the recently-closed cards'
		// flex container (a greedy `flex: 1 1 0` child). It already excludes the
		// fixed search box, the content-width masthead and their gaps, so the
		// only job here is: how many cards fit, and how wide is each?
		//
		// Pick the SMALLEST card count whose common width — when the cards are
		// stretched to fill `cardSpace` with their internal gaps — stays at or
		// below `full`, then shrink that width down so the row fills the
		// container edge-to-edge (never grown above `full`). Reading a settled
		// integer `clientWidth` is far more stable than the old approach of
		// hand-subtracting a `getBoundingClientRect()` masthead measurement,
		// which jittered mid drawer-transition and left the row stuck at one
		// card until a reload.
		if (!cardSpace || cardSpace <= 0) {
			return { cardCount: 0, slotWidth: full };
		}
		let cardCount = Math.ceil((cardSpace + gap) / (full + gap));
		if (cardCount < 1) {
			cardCount = 1;
		}
		let slotWidth = Math.floor((cardSpace - (cardCount - 1) * gap) / cardCount);
		if (slotWidth > full) {
			slotWidth = full;
		}
		if (slotWidth < 1) {
			slotWidth = 1;
		}
		return { cardCount, slotWidth };
	},
	computeCellDimensions(gridWidth, gridHeight, rows, cols, gap, aspect) {
		if (aspect == null) {
			return null;
		}
		if (gridWidth <= 0 || gridHeight <= 0 || rows <= 0 || cols <= 0) {
			return null;
		}
		let availW = gridWidth - (cols - 1) * gap;
		let availH = gridHeight - (rows - 1) * gap;
		if (availW <= 0 || availH <= 0) {
			return null;
		}
		let cellWFromWidth = availW / cols;
		let cellHFromWidth = cellWFromWidth / aspect;
		if (cellHFromWidth * rows + (rows - 1) * gap <= gridHeight) {
			return { cellWidth: cellWFromWidth, cellHeight: cellHFromWidth };
		}
		let cellHFromHeight = availH / rows;
		let cellWFromHeight = cellHFromHeight * aspect;
		return { cellWidth: cellWFromHeight, cellHeight: cellHFromHeight };
	},
	applyTileAspect() {
		if (!('Grid' in window) || !Grid.node) {
			return;
		}
		let grid = Grid.node;
		// 'fill' uses the existing flex behavior — clear inline vars and exit.
		let map = { 'fill': null, '16-9': 16 / 9, '4-3': 4 / 3, '1-1': 1, '3-4': 3 / 4 };
		let aspect = map[Prefs.tileAspect];
		if (aspect == null) {
			grid.style.removeProperty('--cell-width');
			grid.style.removeProperty('--cell-height');
			return;
		}
		let gap = parseInt(getComputedStyle(grid).getPropertyValue('--ntt-gap')) || 18;
		let dims = this.computeCellDimensions(
			grid.clientWidth, grid.clientHeight,
			Prefs.rows, Prefs.columns, gap, aspect
		);
		if (!dims) {
			return;
		}
		grid.style.setProperty('--cell-width', dims.cellWidth + 'px');
		grid.style.setProperty('--cell-height', dims.cellHeight + 'px');
	},
	async fillFilterUI(highlightHost) {
		let pinned = Grid.sites.filter(s => s && 'position' in s.link).reduce((carry, s) => {
			let host = new URL(s.url).host;
			if (!(host in carry)) {
				carry[host] = 0;
			}
			carry[host]++;
			return carry;
		}, Object.create(null));
		let filters = Filters.getList();

		let table = newTabTools.optionsFilter.querySelector('table');
		while (table.tBodies[0].rows.length) {
			table.tBodies[0].rows[0].remove();
		}

		let template = table.querySelector('template');
		let last = null;
		for (let k of Object.keys(pinned).concat(Object.keys(filters)).sort()) {
			if (k == last) {
				continue;
			}
			last = k;

			let row = template.content.firstElementChild.cloneNode(true);
			row.cells[0].textContent = k;
			row.cells[1].textContent = pinned[k] || 0;
			row.cells[2].querySelector('span').textContent = k in filters ? filters[k] : this.getString('filter_unlimited');
			// An explicit remove (✕) on real filter rows only — appended into the
			// limit cell so it doesn't add a column that would overflow the drawer.
			// Pinned-only rows (a pinned tile with no limit) have no filter to
			// remove; those are managed by unpinning on the board.
			if (k in filters) {
				row.querySelector('.minus-button').disabled = false;
				let removeBtn = document.createElement('button');
				removeBtn.className = 'ntt-filter-remove';
				removeBtn.textContent = '✕';
				removeBtn.title = this.getString('filter_remove');
				row.cells[2].append(removeBtn);
			}
			table.tBodies[0].append(row);
			if (highlightHost && k == highlightHost) {
				row.animate([
					{'backgroundColor': '#f0ff'},
					{'backgroundColor': '#f0f0'}
				], {duration: 500, fill: 'both'});
			}
		}

		if (this.optionsFilterHostAutocomplete.childElementCount === 0) {
			let {version} = await browser.runtime.getBrowserInfo();
			let options;
			if (compareVersions(version, '63.0a1') >= 0) {
				options = { limit: 100, onePerDomain: false, includeBlocked: true };
			} else {
				options = { providers: ['places'] };
			}
			chrome.topSites.get(options, sites => {
				for (let s of sites.reduce((carry, site) => {
					let {protocol, host} = new URL(site.url);
					if (host && ['http:', 'https:', 'ftp:'].includes(protocol) && !carry.includes(host)) {
						carry.push(host);
					}
					return carry;
				}, []).sort()) {
					let option = document.createElement('option');
					option.textContent = s;
					this.optionsFilterHostAutocomplete.appendChild(option);
				}
			});
		}
	},
	fillNeverCaptureUI() {
		// Render the never-capture host list — mirrors fillFilterUI's style but
		// uses a flat div list instead of a table (no pinned-count column needed).
		let container = this.optionsNeverCaptureList;
		if (!container) {
			return;
		}
		while (container.firstChild) {
			container.firstChild.remove();
		}
		for (let entry of NeverCapture.getList()) {
			let row = document.createElement('div');
			row.className = 'ntt-nevercapture-row';
			let text = document.createElement('span');
			text.textContent = entry;  // textContent only — no innerHTML
			let removeBtn = document.createElement('button');
			removeBtn.className = 'ntt-nevercapture-remove';
			removeBtn.textContent = '✕';
			removeBtn.title = this.getString('nevercapture_remove');
			removeBtn.dataset.entry = entry;
			row.appendChild(text);
			row.appendChild(removeBtn);
			container.appendChild(row);
		}
	},
	startup() {
		if (!window.chrome) {
			// The page couldn't be loaded properly because WebExtensions is too slow. Sad.
			return;
		}

		document.querySelectorAll('[data-message]').forEach(n => {
			n.textContent = newTabTools.getString(n.dataset.message);
		});
		document.querySelectorAll('[data-placeholder]').forEach(n => {
			n.placeholder = newTabTools.getString(n.dataset.placeholder);
		});
		document.querySelectorAll('[data-title]').forEach(n => {
			n.title = newTabTools.getString(n.dataset.title);
		});
		document.querySelectorAll('[data-label]').forEach(n => {
			n.parentNode.insertBefore(document.createTextNode(newTabTools.getString(n.dataset.label)), n.nextSibling);
		});
		document.querySelectorAll('[data-version-slot]').forEach(n => {
			n.textContent = chrome.runtime.getManifest().version;
		});

		Prefs.init().then(() => {
			// Everything is loaded. Initialize the New Tab Page.
			Page.init();
			newTabTools._initTitlebar();
			if (typeof AwesomeBar !== 'undefined') {
				AwesomeBar.init();
			}
			newTabTools._initAutoSaveIndicator();
			newTabTools.updateUI();
			newTabTools.refreshBackgroundImage();

			chrome.sessions.onChanged.addListener(function() {
				newTabTools.refreshRecent();
			});

			window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
				if (Prefs.theme === 'system') {
					newTabTools.updateUI(['theme']);
				}
			});

			// Forget about visiting this page. It shouldn't be in the history.
			// Maybe if bug 1322304 is ever fixed we could remove this.
			chrome.permissions.contains({permissions: ['history']}, contains => {
				if (contains) {
					chrome.history.deleteUrl({ url: location.href });
					this.pinURLBlocked.hidden = true;
				}
			});
		}).catch(console.error);
	},
	getThumbnails() {
		chrome.runtime.sendMessage({
			name: 'Thumbnails.get',
			urls: Grid.sites.filter(s => s && !s.thumbnail.style.backgroundImage).map(s => s.link.url)
		}, function(thumbs) {
			Grid.sites.forEach(s => {
				if (!s) {
					return;
				}
				let link = s.link;
				if (!link.image) {
					let thumb = thumbs.get(link.url);
					if (thumb) {
						// Stash on the site under the same key fx-newTab's
						// refreshThumbnail uses, so whichever path re-renders
						// the tile next revokes the other's URL (§4.3).
						if (s._thumbnailObjectURL) {
							URL.revokeObjectURL(s._thumbnailObjectURL);
						}
						s._thumbnailObjectURL = URL.createObjectURL(thumb);
						let css = 'url(' + s._thumbnailObjectURL + ')';
						s.thumbnail.style.backgroundImage = css;
						let logoFallback = s.thumbnail.querySelector('.ntt-logo-fallback');
						if (logoFallback) {
							logoFallback.remove();
						}

						if (newTabTools.selectedSite == s) {
							newTabTools.siteThumbnail.style.backgroundImage = css;
							newTabTools.saveCurrentThumbButton.disabled = false;
						}
					}
				}
			});
			// After thumbnails settle, pull favicons for any cell that still
			// shows the logo-fallback (i.e. no screenshot found).
			newTabTools.getFavicons();
		});
	},
	getFavicons() {
		// Pull favicons for any tile whose overlay badge (`.ntt-favicon`) is
		// still showing the letter-glyph fallback (no `<img>` yet). This
		// covers both screenshot-covered tiles and fallback-only tiles —
		// the badge in the bottom overlay is visible regardless of whether
		// the centred fallback glyph is showing.
		let urls = Grid.sites
			.filter(s => {
				if (!s || !s._querySelector) { return false; }
				let badge = s._querySelector('.ntt-favicon');
				return badge && !badge.querySelector('img');
			})
			.map(s => s.link.url);
		if (!urls.length) {
			return;
		}
		chrome.runtime.sendMessage({ name: 'Thumbnails.getFavicons', urls }, function(favicons) {
			if (!favicons || typeof favicons.get !== 'function') {
				return;
			}
			Grid.sites.forEach(s => {
				if (!s || !s.applyFavicon) {
					return;
				}
				let favicon = favicons.get(s.link.url);
				// A Blob is a cached data: favicon; a string is a remote favicon
				// URL — validate it (https/http only) before it becomes an <img src>.
				if (favicon instanceof Blob) {
					s.applyFavicon(favicon);
				} else if (typeof favicon === 'string' && newTabTools.isValidURL(favicon)) {
					s.applyFavicon(favicon);
				}
			});
		});
	}
};

/**
 * Page-side broadcast listener — the page's first and only runtime.onMessage
 * listener (Slice A of the MV3 migration: replaces the background's
 * extension.getViews() access to page globals, see MV3_MIGRATION.md).
 *
 * runtime.sendMessage fans out to every extension context, so this listener
 * also receives page→background messages (Tiles.*, Thumbnails.*, …). It must
 * act only on the broadcast Page.* names below and return a falsy value for
 * everything else — returning true or calling sendResponse here would hijack
 * response routing that belongs to the background dispatcher
 * (lib/messages.js).
 *
 * MV3 review §4.3 (folded into MODERNIZATION.md M5): `Updater`/`Grid` are
 * defined by fx-newTab.js, which loads AFTER this file — an early broadcast
 * (the background can wake and message a page before fx-newTab.js's own
 * top-level execution finishes) used to be silently dropped by the
 * `typeof … !== 'undefined'` guards below. Instead, an early message is now
 * QUEUED (deduped by name — two queued 'Page.updateGrid's collapse to one
 * flush-time refresh) and replayed by `pageMessageHandler.flushQueued()`,
 * which fx-newTab.js calls at the very end of its own top-level execution
 * (the file that defines the globals, so its end IS the ready signal).
 *
 * @param {{name?: string}} message
 * @returns {boolean} always false — never claims the sendResponse channel
 */
function pageMessageHandler(message) {
	switch (message && message.name) {
	case 'Page.updateGrid':
		if (typeof Updater !== 'undefined') {
			Updater.updateGrid();
		} else {
			pageMessageHandler._enqueue('Page.updateGrid');
		}
		break;
	case 'Page.restoreComplete':
		// A restore just rewrote prefs/tiles/background (lib/backup.js's readZip).
		// Refresh the wallpaper, then rebuild the grid from scratch —
		// `Updater.updateGrid` reuses existing Site instances whose in-memory
		// `_link` still points at pre-restore data, so only `Grid.refresh()`
		// picks up the newly-restored links — and finally pull thumbnails for
		// the rebuilt tiles (`Grid.refresh()` doesn't read the Thumbnails IDB
		// store on its own). `Grid` is defined by fx-newTab.js (loads later).
		if (typeof Grid !== 'undefined') {
			newTabTools.refreshBackgroundImage();
			Grid.refresh().then(() => newTabTools.getThumbnails());
		} else {
			pageMessageHandler._enqueue('Page.restoreComplete');
		}
		break;
	}
	return false;
}

/** @type {string[]} Broadcast names that arrived before fx-newTab.js's globals existed. */
pageMessageHandler._queue = [];

/**
 * Queue a Page.* broadcast name for replay once fx-newTab.js's globals exist.
 * Deduped: queuing the same name twice only replays it once at flush time.
 * @param {string} name
 * @returns {void}
 */
pageMessageHandler._enqueue = function(name) {
	if (!pageMessageHandler._queue.includes(name)) {
		pageMessageHandler._queue.push(name);
	}
};

/**
 * Replay every queued broadcast, in the order it was first queued, then
 * clear the queue. Called once by fx-newTab.js at the end of its own
 * top-level execution — by that point `Updater`/`Grid` exist, so each replay
 * takes the direct (non-queuing) branch above.
 *
 * Each replay is wrapped in its own try/catch (audit finding #4, 2026-07-09
 * review): the direct branch's `Grid.refresh()`/`Updater.updateGrid()` runs
 * against a grid that `newTabTools.startup()` is still building
 * asynchronously at this point, so a mis-behaving replay throwing must not
 * abort the rest of the queue (or escape flushQueued() itself) — a later
 * queued name, or a caller relying on flushQueued() itself not throwing,
 * must not be collateral damage from one bad replay.
 * @returns {void}
 */
pageMessageHandler.flushQueued = function() {
	let queued = pageMessageHandler._queue;
	pageMessageHandler._queue = [];
	for (let name of queued) {
		try {
			pageMessageHandler({ name });
		} catch (ex) {
			console.error(ex);
		}
	}
};

browser.runtime.onMessage.addListener(pageMessageHandler);

(function() {
	newTabTools.updateThemeColours = newTabTools.updateThemeColours.bind(newTabTools);
	let uiElements = {
		'darkIcons': 'dark-icons',
		'backgroundFake': 'background-fake',
		'page': 'newtab-scrollbox', // used in fx-newTab.js
		'optionsToggleButton': 'options-toggle',
		'pinURLBlocked': 'options-pinURL-blocked',
		'pinURLInput': 'options-pinURL-input',
		'pinURLButton': 'options-pinURL',
		'pinURLAutocomplete': 'autocomplete',
		'siteThumbnail': 'options-thumbnail',
		'siteURLInput': 'options-url-input',
		'setURLButton': 'options-url-set',
		'saveCurrentThumbButton': 'options-savethumb',
		'setSavedThumbInput': 'options-savedthumb-input',
		'removeSavedThumbButton': 'options-savedthumb-remove',
		'setBgColourInput': 'options-bgcolor-input',
		'setBgColourDisplay': 'options-bgcolor-display',
		'setBgColourButton': 'options-bgcolor-set',
		'resetBgColourButton': 'options-bgcolor-reset',
		'editSiteTitleRow': 'options-edit-title',
		'setTitleInput': 'options-title-input',
		'setTitleButton': 'options-title-set',
		'removeBackgroundButton': 'options-bg-remove',
		'recentList': 'ntt-titlebar-recent',
		'drawerEl': 'ntt-drawer',
		'optionsFilter': 'options-filter',
		'optionsFilterHost': 'options-filter-host',
		'optionsFilterHostAutocomplete': 'host-autocomplete',
		'optionsFilterCount': 'options-filter-count',
		'optionsFilterSet': 'options-filter-set',
		'optionsNeverCapture': 'options-nevercapture',
		'optionsNeverCaptureHost': 'options-nevercapture-host',
		'optionsNeverCaptureAdd': 'options-nevercapture-add',
		'optionsNeverCaptureList': 'options-nevercapture-list',
		'databaseError': 'database-error',
		'contextMenu': 'context-menu',
		'contextMenuPin': 'newtabtools-pintile',
		'contextMenuUnpin': 'newtabtools-unpintile'
	};
	for (let key in uiElements) {
		let value = uiElements[key];
		newTabTools[key] = document.getElementById(value);
	}

	function keyUpHandler(event) {
		if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(event.key) > -1) {
			newTabTools.drawerOnChange(event);
		} else if (event.key == 'Escape') {
			newTabTools.closeDrawer();
		}
	}

	newTabTools.optionsToggleButton.addEventListener('click', newTabTools.toggleDrawer.bind(newTabTools));
	newTabTools.pinURLInput.addEventListener('input', newTabTools.autocomplete.bind(newTabTools));
	newTabTools.drawerEl.addEventListener('click', function(event) {
		// Per-tile editing controls (arrows, set-url, set-title, etc.) live
		// inside the Tile panel and are handled by `optionsOnClick`. Form
		// atoms (segmented buttons, toggles, tab buttons) are handled by
		// `drawerOnClick`. They check disjoint sets of targets so order is
		// safe.
		newTabTools.drawerOnClick(event);
		newTabTools.optionsOnClick(event);
	});
	newTabTools.drawerEl.addEventListener('change', newTabTools.drawerOnChange.bind(newTabTools));
	// Range inputs fire `input` continuously during drag; `change` only on
	// release. Realtime drawer feedback (gap / padding / radius sliders)
	// needs the `input` events too.
	newTabTools.drawerEl.addEventListener('input', function(event) {
		if (event.target.type === 'range' && event.target.dataset && event.target.dataset.pref) {
			newTabTools.drawerOnChange(event);
		}
	});
	for (let c of newTabTools.drawerEl.querySelectorAll('select, input[type="range"]')) {
		c.addEventListener('keyup', keyUpHandler);
	}
	for (let c of newTabTools.drawerEl.querySelectorAll('input[type="file"]')) {
		c.addEventListener('change', function() {
			c.nextElementSibling.disabled = !c.files.length;
			let row = c.parentNode;
			// Themed file controls (e.g. Restore): reflect the chosen filename in the
			// `.ntt-file-name` span beside the styled <label>, since the native input
			// (and its "No file selected." text) is visually hidden.
			let nameEl = row && row.querySelector('.ntt-file-name');
			if (nameEl) {
				nameEl.textContent = c.files.length
					? c.files[0].name
					: newTabTools.getString('backup_no_file');
			}
			// The "Choose image" row's Clear button is enabled only with a pending file.
			let clear = row && row.querySelector('#options-savedimg-clear');
			if (clear) { clear.disabled = !c.files.length; }
		});
	}
	newTabTools.setBgColourInput.addEventListener('change', function() {
		newTabTools.setBgColourDisplay.style.backgroundColor = this.value;
		newTabTools.setBgColourButton.disabled = false;
	});
	newTabTools.optionsFilterCount.addEventListener('keydown', function(event) {
		if (event.key.length == 1 && (event.key < '0' || event.key > '9')) {
			event.preventDefault();
		}
	});
	newTabTools.optionsFilterHost.oninput = newTabTools.optionsFilterCount.oninput = function() {
		newTabTools.optionsFilterSet.disabled = !newTabTools.optionsFilterHost.checkValidity() || !newTabTools.optionsFilterCount.checkValidity();
	};

	document.getElementById('wallpaper-close').addEventListener('click', function() {
		newTabTools.closeWallpaperPicker();
	});
	document.getElementById('wallpaper-reset').addEventListener('click', function() {
		newTabTools.resetWallpaper();
	});
	document.getElementById('wallpaper-upload').addEventListener('change', function() {
		if (this.files.length) {
			let file = this.files[0];
			Prefs.backgroundUrl = '';
			Background.setBackground(file).then(() => {
				newTabTools.refreshBackgroundImage();
				newTabTools.closeWallpaperPicker();
			});
		}
	});

	browser.menus.onShown.addListener(newTabTools.contextMenuShowing);
	browser.menus.onClicked.addListener(newTabTools.contextMenuOnClick);

	window.addEventListener('keydown', function(event) {
		if (event.key == 'Escape') {
			if (!document.getElementById('wallpaper-picker').hidden) {
				newTabTools.closeWallpaperPicker();
			} else if (!newTabTools.pinURLAutocomplete.hidden) {
				newTabTools.pinURLAutocomplete.hidden = true;
			} else if (document.documentElement.hasAttribute('drawer-open')) {
				newTabTools.closeDrawer();
			}
		} else if (document.activeElement == newTabTools.pinURLInput) {
			let current = newTabTools.pinURLAutocomplete.querySelector('li.current');
			switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp':
				let items = [...newTabTools.pinURLAutocomplete.querySelectorAll('li:not([hidden]):not(#options-pinURL-blocked)')];
				if (!items.length) {
					return;
				}

				let index = event.key == 'ArrowDown' ? 0 : items.length - 1;
				if (current) {
					current.classList.remove('current');
					let newIndex = items.indexOf(current) + (event.key == 'ArrowDown' ? 1 : -1);
					if (items[newIndex]) {
						index = newIndex;
					}
				}
				items[index].classList.add('current');
				break;
			case 'Enter':
			case 'Tab':
				if (current) {
					newTabTools.setPinURLInputValue(current.dataset.url);
				}
				newTabTools.pinURLAutocomplete.hidden = true;
				break;
			}
		}
	});
	window.addEventListener('click', function(event) {
		if (event.button != 0) {
			return;
		}
		if (newTabTools.pinURLInput == event.target) {
			if (newTabTools.pinURLAutocomplete.hidden) {
				newTabTools.autocomplete();
			}
			return;
		}
		if (newTabTools.pinURLAutocomplete.hidden) {
			return;
		}
		if (newTabTools.pinURLAutocomplete.compareDocumentPosition(event.target) & Node.DOCUMENT_POSITION_CONTAINED_BY) {
			let target = event.target;
			while (target.nodeName.toLowerCase() != 'li') {
				target = target.parentNode;
			}
			if (target != newTabTools.pinURLBlocked) {
				newTabTools.setPinURLInputValue(target.dataset.url);
			}
			return;
		}
		newTabTools.pinURLAutocomplete.hidden = true;
		event.stopPropagation();
	}, true);
	window.addEventListener('resize', function() {
		newTabTools.refreshRecent();
		newTabTools.applyTileAspect();
	});
})();
