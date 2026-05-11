# MV3 Migration Plan

This document serves as the master blueprint for the Manifest V3 (MV3) migration. 

The strategy is derived from the `2026-05-11-code-review.md` and the subsequent `MV3_MIGRATION_review.md`.

## Strategic Decisions

1. **AMO First, MV3 Second**: AMO publication (MV2) is the next step, pending contact with the original maintainer about a possible handover. MV3 migration follows.
2. **Firefox-Only MV3 First**: We are explicitly deferring Chrome compatibility to a future Phase 3. Firefox MV3 uses **Event Pages** which retain DOM access, bypassing the need for `chrome.offscreen` and polyfills. This halves the immediate migration scope.
3. **No TypeScript / No Build Step**: We are keeping the production codebase as standard JavaScript (`.js`) with JSDoc. The type-safety gains on the legacy monolithic files (`newTab.js`, `fx-newTab.js`) do not justify the cost of introducing a transpilation build step (e.g., `esbuild`). MV3 strictly requires ES modules, but browsers load `.js` modules natively.

## Technical Directives for Contributors

To prevent duplicated effort or incorrect assumptions during the migration, all contributors must adhere to the following directives:

### 1. State Management (DO NOT use `storage.session`)
Do not move `networkIdleWatchers`, `captureSessions`, or `pendingCaptures` into `browser.storage.session`. 
- **Rationale**: `storage.session` is asynchronous, which introduces race conditions on hot paths (like `resetNetworkIdleTimer`). It also has strict quotas and cannot store unserializable data like `setTimeout` handles or callbacks. 
- **Solution**: Keep these in-memory. They complete within the 2-second hard deadline and do not need to survive a background restart.

### 2. DOM Independence
Do not attempt to migrate `resizeThumbnail` or `isBlank` to `OffscreenCanvas`.
- **Rationale**: Firefox MV3 Event Pages retain full DOM access, so `Image` and `<canvas>` will continue to work exactly as they do in MV2. 

### 3. Replacing `chrome.extension.getViews()`
`chrome.extension.getViews()` is removed in MV3. When tackling this task, use the following messaging pattern:

**MV2 (Current)**:
```javascript
for (let view of chrome.extension.getViews()) {
    if (view.location.pathname == '/newTab.xhtml') {
        view.Updater.updateGrid();
    }
}
```

**MV3 (Replacement)**:
```javascript
browser.runtime.sendMessage({ name: 'Grid.refresh' });
// Ensure a corresponding listener is added in newTab.js to call Updater.updateGrid()
```

---

## Migration Phases

### Phase 1: Pre-MV3 Modernization (Under MV2)
All work here is safe to do under MV2. Each bullet point is an independently shippable task that must be verified by the existing test suite.

- [ ] **XHTML -> HTML Conversion**: Rename `newTab.xhtml` to `newTab.html`. **Warning:** This is not a simple rename. You must remove XML namespaces, replace `createElementNS` calls throughout `fx-newTab.js` with standard `createElement`, and update the `contentType: "application/xhtml+xml"` configuration in `jsdom` within the test suite. Treat this as a dedicated, high-risk task.
- [ ] **Replace `chrome.extension.getViews()`**: Implement the messaging replacement pattern detailed in the directives above.
- [ ] **Async Normalization**: Opportunistically convert mixed callback/promise chains in `background.js` to `async/await` under test coverage.
- [ ] **Extract ES Modules**: Extract the 6 concatenated background scripts into standard ES modules (`.js` with JSDoc). The browser will load them natively via `import`/`export`.
- [ ] **IDB Auto-Reconnect**: Update the IndexedDB wrapper to automatically re-open dropped connections, anticipating the ephemeral nature of MV3 event pages.

### Phase 2: Firefox MV3 Flip
This phase requires flipping the manifest version and testing the extension strictly under Firefox MV3.

- [ ] **Full Manifest Conversion**: Update `manifest.json` with the following explicit changes:
  - `manifest_version`: Change to `3`.
  - `browser_action`: Rename to `action`. Remove `browser_style: true` (deprecated).
  - `applications.gecko`: Rename to `browser_specific_settings.gecko`.
  - `permissions`: Move `<all_urls>` into a new `host_permissions` array.
  - `content_security_policy`: Convert from a string to an object: `{ "extension_pages": "..." }`.
  - `background`: Replace the `scripts` array with a single entry point and add `"type": "module"`.
- [ ] **Verify Observational `webRequest`**: Ensure `webRequest` listeners used for network idle detection still function correctly as non-blocking observers in Firefox MV3.
- [ ] **Full E2E Verification**: Run the complete E2E suite against Firefox MV3 to catch regressions.

### Phase 3: Chrome Support (Deferred)
(Tracked separately. Will require `chrome.offscreen` API for DOM usage, `webextension-polyfill`, dual-build setups, and `webRequest` alternatives).
