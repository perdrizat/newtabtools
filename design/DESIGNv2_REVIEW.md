# NTT v2 — Design Review & Implementation Guidance

Net review and build guidance for the v2 new-tab page. Companion mock: **`v2 board design*.png`** (three pictures).

Severity: **P0** = blocks AMO listing · **P1** = fix before listing · **P2** = polish.

---

## 1. Title bar — build "Board A" (P1)

The new-tab page is glanced at for ~2 seconds, dozens of times a day: tiles are the product, chrome is overhead. Keep the bar minimal and put the one utility where users reach for it (top-right). Remove the wordmark and the bare padlock.

**Title bar contents, left → right:**

```
[ Recently-closed page chips — flex to fill ]   [ Search ]   [ Edit ]
```

- **No wordmark** — a new-tab page does not need to announce what it is. Keep branding on the toolbar button, the drawer header, and AMO only.
- **Recently-closed chips** sit left of Search. They **flex in size to fill the available width** — there is no separate flex spacer between them and Search.
- **One primary action, labelled: `Edit`.** It opens the editable drawer (see §2) — a single, unambiguous entry point. No separate "Configure" button (the near-synonym created "which one do I click?" hesitation).
- **No padlock.** `Edit` enters an explicit **Edit / Done mode** (§2).

**Equal padding, equal gaps:** outer padding is identical on all four sides (mock uses 40px), and the gap between the title bar and the grid equals the tile gap (mock uses 16px).

**Why top-right inline (not a corner/gutter or a hamburger):** gutter placement breaks because outer padding is user-configurable (small padding leaves no room) and collides with dense grids; a hamburger buries the one action users seek. Inline top-right shares the bar's margin and rhythm, stays robust against any padding, and matches the convention users already scan for.

---

## 2. Edit / Done mode (P1)

There is no lock toggle and no padlock (ambiguous: private? secure? DRM?). Editing is an explicit mode, entered by the single `Edit` button, which also opens the configuration drawer — so "arrange the board" and "configure the board" are one coherent flow:

- `Edit` → the drawer opens **and** the board unlocks together; the button becomes **`Done`**. Closing (`Done` / `Esc`) re-locks and returns to the clean, glanceable board. The board is **locked by default** (no accidental drags).
- **The drawer and Edit mode are one state — they are never shown apart.** Opening the drawer (Configure) *is* entering Edit mode, so whenever the drawer is open the board behind it must show the edit affordances below and the titlebar button must read `Done`. There is no "drawer open over a normal, locked board" state.
- **AMO screenshot fix (P1):** the current "settings drawer" capture (screenshot 05) shows the drawer open over a *normal locked* board (no edit affordances) and the old padlock+gear titlebar. Re-capture it in the true combined state — board unlocked + reflowed, edit affordances visible, `Done` in the titlebar — matching the "Edit mode" artboard in the companion mock.
- When the drawer opens, the board area shrinks by the drawer width and the grid **reflows to fewer columns** (same behaviour as resizing the window) — see the artboard (5→3 cols shown).
- **Pinned tiles** show the **full action row persistently** (`+` Edit URL · ↻ Reload · 📌 Pin/Unpin · ✕ Remove) in the top-right — the same actions as the normal-mode hover row, made persistent for the mode. Plus a **prominent drag handle centred on the tile**.
  - **No separate top-left ✕.** Remove lives only in the action row, so there is exactly one remove control. The **✕ is highlighted in danger-red** (`#d65a3a`) to mark the single destructive action.
  - **Two colours, two meanings:** copper for the dashed outline + drag handle (= *this tile is selected/movable*); danger-red for the ✕ (= *destructive*). Don't collapse them to one colour — reusing copper for the ✕ would blur "movable" and "delete".
  - Density watch-item: keep action buttons ≥24px in a tidy top-right row and let the drag handle own the centre, so dense grids/small tiles don't crowd.
- **Non-pinned (auto) tiles** **fade back** and show a centred **`+ Add tile`** prompt — those positions become add/pin targets. (No separate trailing "+" slot.)
- **Colour:** the dashed outline and drag handle use the **accent (copper)** as the unified "selected/movable" cue; the **✕ uses danger-red** as the single destructive action (see the pinned-tile bullet). *Recommendation, revised:* now that the ✕ sits inside a row of neutral buttons rather than being a lone badge, red reads better than copper — it separates "movable" (copper) from "delete" (red). Flip to copper only if you want a single edit colour.
- **Clicking a tile** while editing focuses it in the drawer's **Tile** tab.

See the "Edit mode" artboard in the companion mock.

---

## 3. Tile (P0 + P1)

### 3a. Bottom title overlay legibility (P0 — AMO blocker)
White titles wash out on light-topped thumbnails (Stack Overflow, Cloudflare "Just a moment", bright orange Datadog, Wikipedia). A pure fade-to-transparent gradient gives the white text nothing to sit on.

- **Fix:** stronger gradient ramping into a near-solid dark floor under the text — `linear-gradient(180deg, transparent 12%, rgba(0,0,0,0.45) 50%, rgba(0,0,0,0.85) 100%)` — plus `text-shadow: 0 1px 3px rgba(0,0,0,0.6)` on the title.
- **Acceptance:** title hits WCAG AA (4.5:1) over a pure-white thumbnail. Verify against Stack Overflow and "Just a moment". Same treatment in dark mode.
- *(Applied in the companion mock — use it as the visual target.)*

### 3b. Single stat per tile (P1, capture note)
One stat chip, top-left (visits / last / trend / rank / fresh — user-chosen). Reserve the slot for a future hover "breakout" of all stats; only the one configured stat shows for now.
- **Default ships OFF** (a fresh install has no history, so it would render empty). **For AMO screenshots only**, set stat = Visits so the differentiator is visible.

### 3c. Quick actions — top-right corner, hover-revealed (P1)
At rest: a single kebab. On hover: a compact row of in-place actions (these work **whether or not Edit mode is on**), in order:

| Action | Icon | Behaviour |
|---|---|---|
| **Edit URL** | `+` | Opens the **drawer's Tile tab** to add/change this tile's URL — *not* a separate in-tile menu. |
| **Reload thumbnail** | ↻ | Re-captures the screenshot. **Keep it.** Confirmed against the source: thumbnails are captured *on visit* and cached (multi-stage: immediate / 500ms / 2s network-idle, with blankness detection) — they are **not** re-captured on every new-tab open. So a manual reload is the only way to force a fresh capture for a stale, blank, or changed tile short of re-visiting or uploading. Worth keeping in the hover row; also expose it in the drawer's Tile tab. |
| **Pin / Unpin** | 📌 | Toggles pinned (reuse v1 SVGs from webextension/images). |
| **Remove** | ✕ | Removes the site from the new-tab page. |

- **Dropped: "Open in new tab."** Clicking the tile already opens it; power users use middle-/⌘-click for a new tab. The arrow was redundant.
- **One remove affordance, not two.** The hover ✕ and the Edit-mode ✕ are the *same* action shown per-mode (hover: top-right corner; Edit mode: top-right, accent-coloured). They never appear simultaneously.

### 3d. Pinned indicator
Thin accent stripe along the tile's top edge (dark mode adds a soft glow). Keeps the corners free for stat + actions.

---

## 4. Recently-closed chips (P1)

These are individual **pages**, so the full page title is right — but give them page-level identity and fix the typography:

- Lead with the **real site favicon** (fallback: the colored letter-block at the same size/radius as real favicons).
- **Title:** UI font, 600, full ink, truncate from the end but protect the first ~18 chars.
- **Domain:** UI font, 500, ~55% opacity — **registrable domain only** (`theverge.com`), not the page-title suffix.
- Hierarchy comes from **weight + colour within one font family** — do **not** set the domain in monospace (see §6).

---

## 5. Configuration drawer consistency (P1)

The **Tile** and **Page** tabs are well-designed; the **Advanced** tab is off-system and is the biggest quality gap. Bring it onto the system:

> **Tab names — keep `Tile / Page / Advanced` (do not rename to Layout / Appearance / Advanced).** "Tile" (settings for one selected tile) vs "Page" (settings for the whole board) is a distinction users grasp instantly — *this thing* vs *everything*. Splitting into Layout / Appearance / Advanced asks users to guess where grid size vs colour vs "advanced" each live, which most can't. Tile / Page / Advanced is the better split; agreed.

- **Kill native form controls.** The OS checkbox ("Tiles from browsing history") → the same copper **toggle** used everywhere else. No native checkboxes anywhere in the product.
- **Button hierarchy (apply product-wide):**
  - **Primary** — copper fill, white text. One per group (`Add`, `Set`, `Apply`).
  - **Secondary / ghost** — transparent, 1px hairline, ink text (`Browse…`, `Filter…`, `Backup…`).
  - **Destructive** — danger-red text + red hairline; fills red on confirm (`Reset everything`, `Restore`, tile `Remove`).
- **Steppers** (`< 2 >`, `< unlimited >`) → restyle to match the segmented control (same height/radius/fill). A stepper and a segmented control are the same kind of control and must look related.
- **Domain table** → reflow to the drawer's standard row height, rhythm, and hairline.
- **Control vocabulary** — one control per job: boolean → toggle; 2–5 exclusive options → segmented control; bounded number → segmented-style stepper; open range → slider.

**Acceptance:** Advanced and Page tabs should look like the same designer made them; no native controls survive.

---

## 6. Typography (P1)

Keep the **system font stacks** (no bundled webfonts — load speed matters on this surface). The win is **role discipline**: one typeface is currently doing ~8 jobs, which pushes the UI toward "techy" instead of "elegant".

**Rule:** differentiate with weight, size, and colour before reaching for a second typeface. Reserve **monospace** for content that is genuinely **tabular-numeric or a keyboard key**. Everything textual is the **UI sans**.

| Use | Now | Change to |
|---|---|---|
| Recently-closed domains / all URLs | mono | UI sans, medium, muted |
| Section captions ("gap & padding") | mono | UI sans, muted |
| Helper / explanatory text | mono **and** italic | UI sans, regular — **never italic** |
| Visit counts, stat numbers | mono | **keep** (tabular numerics) |

Drop italics entirely (italic + small + low-contrast is the least legible combination in the UI); standardize helper text on regular UI sans.

---

## 7. Colour (P1 / P2)

- **Add a danger role (P1):** `--ntt-danger` = `#b14b27` (light) / `#e89279` (dark) — already used for trend-down, so this is reuse. Apply to all destructive actions (§5). Today they render in neutral grey, signalling nothing.
- **Confirm steps — irreversible-only (P1):** inline Confirm/Cancel only for **Reset everything** and **Restore-overwrite**. If tile **Remove already has an undo toast, no confirm** (don't double-gate a reversible, high-frequency action) — it still gets danger styling on hover.
- **Default wallpaper OFF (P2):** ship the neutral page-bg gradient — cohesive, zero-license, and it keeps the warm copper accent in harmony out of the box. (Cool wallpapers fight the warm accent; wallpaper is user-set, so this only concerns the shipped default + the AMO hero.)
- Keep **copper as the single accent** — it's applied consistently (pin stripe, active toggle, selected card, focus ring); don't add a second accent hue.

---

## 8. High-contrast theme (P1)

Light/dark inherit the Firefox theme by default; advanced overrides offer Pure white / Deep black / High-contrast. After the changes above, **validate against High-contrast** (its whole purpose is contrast): (a) the §3a overlay band still hits AAA over light and dark thumbnails; (b) danger red keeps contrast against the HC background — dark-mode `#e89279` may need bumping; (c) the focus ring stays visible. Validation pass, not new design.

---

## Priority order

1. **§3a tile overlay legibility** — AMO blocker, quick.
2. **§3b stats on for the AMO screenshots** — makes the differentiator visible.
3. **§1 + §2 title bar (Board A) + Edit/Done mode** — the structural chrome decision.
4. **§5 Advanced tab onto the system** — biggest single quality jump.
5. **§6 typography role discipline + §7 danger role** — moves the UI from "techy" to "elegant".
6. **§4 recently-closed identity, §8 HC validation** — polish before listing.

