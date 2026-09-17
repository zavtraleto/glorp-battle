# Battle Visual (CRT Occult Vector) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder battle rendering with the "CRT Occult Vector" look: perspective phosphor grid with per-cell states, procedural red occult enemies, a cyan player, geometric attacks, enemy HP segments and big damage numbers, no text during battle.

**Architecture:** Keep `SceneRenderer`'s public surface (`renderInto`, `actorTargetPos`, `cellTargetPos`, `reset`, `handleEvent`, `field.setCoordsVisible`) so the terminal barely changes. Inside: a perspective `ViewCamera` fitted by a pure function; `GridView` draws each cell from pure `cellStates()`; unlit "signal" materials write role channels (G phosphor, R red, B accent) which a palette pass (`PalettePass`, Bayer 4×4) turns into the 4-colour palette; creatures are pixel bitmaps from a pure generator on pixel-snapped sprites. The CRT HUD drops battle text and draws HP segments and damage numbers.

**Spec:** `docs/BATTLE_VISUAL.md`.

## Global Constraints

- `src/sim` unchanged (read-only access to state, `dangerCells()`, `cursorCell()`, attacks, events, `uiTick`/`stateTick`).
- Pure logic in testable modules without WebGL: `cellStates`, `creatureGen`, `fitView`, `paletteIndex`, `hpSegments`, `battleSignals`.
- Numbers in `tuning.battleVisual`; palette in `src/render/palette.ts`.
- No `Math.random()`: creatures use `Rng` with fixed seeds.
- No performance measurements unless asked. Commit per stage, push at the end.

## Tasks

1. **V1 — camera, grid, palette, cell states:** `palette.ts` (+ `paletteIndex` JS mirror, tests), `PalettePass` in `BattleTarget`, `viewCamera.ts` (`fitView` pure + tests), `cellStates.ts` (pure + tests), `GridView` replacing `FieldView` (outline segments, fill with dither intensity, enemy-territory markers, state visuals), CRT glass effects default to 0.
2. **V2 — creatures:** `creatureGen.ts` (pure bitmap generator + tests), `playerSprite.ts` (hand bitmap), `PixelSprite` (signal texture, integer texel scale, pixel snap, flash / dissolve), new `PlayerView` / `EnemyView`.
3. **V3 — attacks:** rewrite `FxView` with line/strip geometry in signal colours; ATTACK/AFTER cell timers fed from events.
4. **V4 — HP, damage, no battle text, signals:** `hpSegments` (pure + tests); HUD labels: segments and ×3 numbers; remove HP box / CUSTOM / chip name / NO CHIP / banners from the CRT; `battleSignals` (pure: intro reveal, start sweep, win pulse, lose cascade + tests) applied to the grid.
5. **V5 — debug and docs:** DBG `field` folder (cell override, demo states, reroll seeds), `__glorp.battleView`, GDD/TERMINAL/CLAUDE/README updates.
