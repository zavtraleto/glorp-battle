# Terminal T1.3 — Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The battle is fully controlled through real terminal controls with tactile feedback: trackball with arrows and inertia, EXECUTE and CHIP SELECT with spring press/overshoot, dull presses (NO CHIP, gauge not full), glowing CHIP SELECT when the gauge is full, pause key; on desktop hover lift, pixel hand cursor and camera parallax; keyboard keys animate the same controls.

**Architecture:** Pure logic (`spring`, `controlRules`, `keyOrgans`, `cursorKind`) is unit-tested. `PressKey` is a reusable spring-driven pressable part; `Trackball`, `DeckControls` (CHIP SELECT + LED ring + EXECUTE + pause) replace the greybox controls, which keeps only the chip rail until T1.4. The router gains hover events and a gate that ignores presses in `TRANSITION`. `HudModel` gains a transient `notice` (NO CHIP).

**Tech Stack:** Vite 8, TypeScript strict, Three.js 0.186, Vitest.

**Spec:** `docs/TERMINAL.md` §5, §7.1, §9.7, §11 (T1.3), §17. Previous plans: T1.1, T1.2.

## Global Constraints

- `src/sim`, `src/app` unchanged. Commands stay `move` / `useChip` / `openCustom`; keyboard commands keep coming from `attachKeyboard` and `ui/controls.ts` — the terminal only animates for keys, never pushes duplicates.
- Reaction on `pointerdown` in the same frame; availability decides only whether the command is sent and how the press looks.
- New numbers in `tuning.terminal`; text via `t()`.
- Commit per task with tests/build green; push at the end.

## Tunables (add to `tuning.terminal`, document in TERMINAL.md §17)

`SPRING_STIFFNESS` 900 (1/s²), `SPRING_DAMPING` 22 (1/s) — gives a short overshoot on release; `DULL_PRESS_SHARE` 0.35; `HOVER_LIFT` 0.04 (world); `ARROW_FLASH_TIME` 0.15 s; `DENIED_BLINK_TIME` 0.4 s; `NO_CHIP_TIME` 0.5 s; `PARALLAX_DEG` 1.5; `GLOW_PULSE_HZ` 1.5.

## Tasks

### Task 1: Spring (`src/terminal/anim/spring.ts`)
```ts
export class Spring { value: number; velocity: number; target: number;
  constructor(value?: number); step(dt: number, stiffness: number, damping: number): void; // fixed 1/240 substeps
  snap(v: number): void; }
```
Tests: converges to target; overshoots with low damping; no NaN/explosion for dt = 0.25; `snap` zeroes velocity.

### Task 2: Control rules (`src/terminal/controlRules.ts`)
```ts
export interface ControlWorld { state: GameState; activeChip: unknown; gauge: { full: boolean };
  player: { flinched: boolean; actionTicks: number }; chips: { queue: readonly unknown[] } }
export type Availability = 'ok' | 'dull';
export function executeAvailability(w: ControlWorld): { press: Availability; notice: 'noChip' | null };
export function chipSelectAvailability(w: ControlWorld): Availability;
export function acceptsPress(mode: TerminalMode, zone: ZoneId): boolean; // TRANSITION → only pause; MENU/CHIP_SELECT → pause only
export function organForKey(code: string): { zone: ZoneId; dir?: Dir } | null; // WASD/arrows → trackball+dir, Space/KeyF → execute, KeyQ/KeyE → chipSelect, Escape → pause
export function cursorKind(zone: ZoneId | null, pressed: boolean): 'default' | 'point' | 'press';
```
Rules: execute is `ok` only in ACTION with a queued chip and a free player (no active chip, not flinched, no action ticks); an empty queue in ACTION gives notice `noChip`. Chip select is `ok` in ACTION with a full gauge.

### Task 3: HUD notice
`HudModel.notice: string | null`; `hudModel(s, w, notice?)`; `hudKey` includes it; CRT draws it centred at 70% height in amber when there is no banner. i18n `hud.noChip` = `NO CHIP`.

### Task 4: Parts
- `parts/pressKey.ts` — `PressKey { object; press(dull); release(); hover(on); update(dt) }`: z = rest − travel·spring (+ hover lift). Dull press travels `DULL_PRESS_SHARE`. Release: target 0 → spring overshoot.
- `parts/trackball.ts` — ball (12×8 flat), socket ring, 4 arrow triangles; `roll(dx, dy)`, `step(dir)` flashes the arrow for `ARROW_FLASH_TIME`, `press/release/hover` (small travel).
- `parts/deckControls.ts` — CHIP SELECT key (glows and pulses when the gauge is full; ring LEDs; `deny()` blinks unlit LEDs red for `DENIED_BLINK_TIME`), EXECUTE key (`deny()` → red flash dimmer), pause key; `build(layout)`, `setGauge(lit, full)`, `update(dt, time)`.
- `greybox.ts` keeps only the chip rail and hit-zone debug.

### Task 5: Router hover + gate, cursor, parallax, keyboard visuals, wiring
- `PointerRouter`: `RouterHandlers.hover?(zone | null)`; mouse `pointermove` without capture reports the zone; `pointerleave` → null. `accepts?(zone): boolean` — rejected presses do not capture and do nothing.
- `interaction/cursor.ts`: 16×16 pixel hand cursors (point, press) as data-URI CSS cursors, hotspot at the finger tip.
- Terminal: availability → dull press / command; NO CHIP notice timer; CHIP SELECT deny; hover lift; cursor updates; keyboard listener animating organs (`organForKey`), trackball step flash on `move` from any source (keyboard dir or router); parallax on `(pointer: fine)` from pointer position.
- Browser check: phone emulation + desktop, `?bench=1` within budget. Docs (§11 status, §17). Commit, push.
