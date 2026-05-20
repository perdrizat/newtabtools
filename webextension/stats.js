/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported TileStats */

var TileStats = {
	_hasHistoryPermission: null,

	async _checkHistoryPermission() {
		if (this._hasHistoryPermission === null) {
			try {
				this._hasHistoryPermission = await browser.permissions.contains({ permissions: ['history'] });
			} catch (e) {
				this._hasHistoryPermission = false;
			}
		}
		return this._hasHistoryPermission;
	},

	formatCount(n) {
		if (n >= 1000) {
			let k = n / 1000;
			return k % 1 === 0 ? k + 'k' : k.toFixed(1) + 'k';
		}
		return String(n);
	},

	formatAge(ms) {
		let minutes = Math.floor(ms / 60000);
		if (minutes < 1) {
			return 'now';
		}
		let hours = Math.floor(minutes / 60);
		if (hours < 1) {
			return minutes + 'm';
		}
		let days = Math.floor(hours / 24);
		if (days < 1) {
			return hours + 'h';
		}
		return days + 'd';
	},

	async compute(url, statType, rank) {
		if (statType === 'none') {
			return null;
		}

		if (statType === 'rank' && rank != null) {
			return { type: 'rank', value: String(rank) };
		}

		if (!await this._checkHistoryPermission()) {
			return null;
		}

		let visits;
		try {
			visits = await browser.history.getVisits({ url });
		} catch (e) {
			return null;
		}

		if (!visits || visits.length === 0) {
			return null;
		}

		switch (statType) {
		case 'visits':
			return { type: 'visits', value: this.formatCount(visits.length) };

		case 'last': {
			let latest = Math.max(...visits.map(v => v.visitTime));
			let age = Date.now() - latest;
			return { type: 'last', value: this.formatAge(age) };
		}

		case 'trend': {
			let now = Date.now();
			let weekAgo = now - 7 * 24 * 60 * 60 * 1000;
			let recent = visits.filter(v => v.visitTime >= weekAgo).length;
			let older = visits.filter(v => v.visitTime < weekAgo).length;
			let dir = recent >= older ? 'up' : 'down';
			return { type: 'trend', dir, value: String(recent) };
		}

		case 'fresh': {
			let latest = Math.max(...visits.map(v => v.visitTime));
			let hoursSince = (Date.now() - latest) / (60 * 60 * 1000);
			if (hoursSince <= 24) {
				return { type: 'fresh', value: '' };
			}
			return null;
		}

		default:
			return null;
		}
	},
};
