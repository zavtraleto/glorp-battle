# Terminal T2 — CRT Menus, CRT Labels, Legacy UI Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen of the session (title, pause, result, defeat, complete) is drawn inside the CRT and driven by the terminal controls; enemy HP and damage numbers are drawn in the CRT HUD; the legacy HTML UI (`src/ui`, `?ui=css`, swipe-anywhere) is deleted. HTML is left only for the DBG button, lil-gui and the stats overlay.

**Out of scope (user decision 2026-09-17):** battle-field visuals and Navi/virus sprites — a separate step later.

**Spec:** `docs/TERMINAL.md` §7, §8, §11 (T2), §13.4.

## Global Constraints

- `src/sim` unchanged; Session actions (`start`, `resume`, `retry`, `restart`, `next`) are called by `main.ts` through terminal handlers.
- Text via `t()`; the pixel font must cover every character used by the strings (add glyphs if needed).
- No performance measurements unless the user asks.
- Commit per task, push at the end.

## Tasks

1. **Menu model (pure)** — `src/terminal/crt/menuModel.ts`: `menuFor(session)` → `MenuSpec | null` (key, tone, title, subtitle, rows, items with actions, hint lines) reproducing `ui/screens.ts`; `formatTime`; `menuLayout(spec, W, H)` → title/subtitle/row/item/hint positions and item rects in CRT pixels; `moveCursor(index, dir, count)`. Font gains `> < , ( ) =`. Tests.
2. **CRT menus + input** — `HudModel.menu: { spec, cursor }`; `CrtCanvas` draws the menu over a full shade (battle HUD hidden); `glassRect(layout, aspect)` shared by housing and hit-testing; controls in MENU: trackball up/down and arrow/WS keys move the cursor, EXECUTE / Enter / Space activate, tap on an item activates it; `TerminalHandlers.menu(action)`. `acceptsPress('MENU', …)` allows trackball, execute, pause.
3. **CRT labels** — `SceneRenderer.projectToTarget()` (normalized coords in the last render target); `FloaterList` (pure: damage/heal numbers with life and rise); `HudModel.labels`; enemy HP under each enemy and floating numbers drawn in the CRT.
4. **Remove legacy UI** — delete `src/ui/*` (keep base CSS as `src/styles.css`), `?ui=css`, `attachSwipe`, SceneRenderer full-screen mode; chip keys (Space/F, Q/E) move to `attachKeyboard`; keyboard on the tray (arrows focus, Space/F pick, Backspace remove last, Enter OK, R ADD); new title hints; docs (TERMINAL.md, GDD §12–13, README, CLAUDE.md). Browser check, commit, push.
