# Chrome-Prep Security & Architecture Audit

**Date:** 2026-07-13
**Scope:** `v2.4.0` (commit `90813d6`) to `HEAD` (branch `chrome-prep`)
**Methodology:** Systematic component analysis via orchestrator and specialized sub-agents. 

## Executive Summary

The `chrome-prep` arc (Stages C1-C6) executed a massive restructuring of the extension, successfully eliminating global bridges, typing the monoliths, extracting feature modules, and setting up the API/manifest capability seams for Chrome. 

The architecture is highly resilient, test coverage fidelity has dramatically increased, and the security boundaries remain airtight. **However, one memory leak was identified in the new module structure.**

---

## 1. Security Boundaries & API Wrappers (Domain 1)
**Status: PASS**

An audit of the new API seams, permissions, and manifest-generation pipeline found no regressions or widened boundaries.

* **Manifest Merging (`scripts/build-manifest.mjs`)**: 
  The script safely constructs the final `manifest.json` using a shallow `{...base, ...overlay}` spread mechanism. There is no deep property assignment, recursive merging, or `eval()` usage, immunizing the build process against prototype pollution attacks.
* **API Capability Wrappers (`webextension/api.js`)**: 
  The namespace normalization utilizes `new Proxy` over `globalThis.browser ?? chrome`. This dynamic lookup during `get` and `has` traps safely preserves the lexical `this` binding without leaking cross-context data.
* **CSP & Permissions**: 
  Permissions are appropriately locked down. The `<all_urls>` permission was correctly isolated inside `host_permissions` for Manifest V3, ensuring it is user-revocable. The `connect-src 'self'` policy is successfully restricting inline fetch calls.

## 2. JavaScript Architecture & Module Extraction (Domain 2)
**Status: CONDITIONAL PASS (1 Finding)**

The extraction of `fx-newTab.js` and `newTab.js` into modular files (`site.js`, `drag-drop.js`, `ui-refs.js`, etc.) strictly followed ES Module best practices. 

* **Cyclic Dependencies**: 
  While legal module cycles exist (e.g., `grid.js` ↔ `site.js`), all cross-references are safely invoked strictly at call-time (inside methods like `handleEvent`). There are no top-level evaluations that would trigger Temporal Dead Zone (TDZ) initialization crashes.
* **State Encapsulation**: 
  The `ui-refs.js` pattern successfully localized global UI state. Internal variables were successfully moved off global `this` contexts to encapsulated module scopes, preventing fragile state sharing.

### ⚠️ Finding: Blob URL Memory Leak in `site.js`
While `object-urls.js` perfectly tracks and revokes its own singletons, a leak was introduced in the newly extracted `site.js`. 
* **Vulnerability:** `Site` instances create distinct `_thumbnailObjectURL` and `_faviconObjectURL` properties. When `Grid.refresh()` is called (e.g., upon preference changes), the grid flushes and orphans the DOM nodes and `Site` instances. Because `Site` lacks an explicit `destroy()` or cleanup method, these blobs are never passed to `URL.revokeObjectURL()`.
* **Impact:** Moderate. Blobs will leak into memory over time until the new tab document unloads (which can be a long time if the tab stays open).
* **Remediation:** Introduce a cleanup method (e.g., `Site.prototype.destroy`) that calls `URL.revokeObjectURL` on its cached blob properties, and ensure `Grid` calls this method on all existing sites before flushing them during a refresh.

## 3. Test Harness & Build Tooling (Domain 3)
**Status: PASS**

* **DOM-Driven Harness**: 
  The migration of E2E tests away from global mocks (e.g., `window.Grid`) to driving actual DOM elements (`DragEvent` dispatch, button clicks) drastically increases the fidelity of the test suite. 
* **Concurrency Lock (`run_esr_tests.sh`)**: 
  The new concurrency lock correctly utilizes the POSIX atomicity guarantee of `mkdir`. It securely prevents multiple test invocations from clobbering the same test profile, gracefully handling stale PID locks.

---

## Next Steps
Before merging this branch and publishing `2.5.0`, implement the `Site` Blob URL cleanup remediation outlined in Section 2.
