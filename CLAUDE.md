# Glorp Battle

Mobile-first, portrait, real-time grid battle prototype modeled on Mega Man Battle Network: MMBN6 for combat rules, MMBN3 for content.
Vite + TypeScript (strict) + Three.js. The whole interface is a 3D physical terminal (NET-01) with the battle on its CRT. Target: Chrome (Android first), 60–120 FPS.

- Spec: `docs/GDD.md` (Russian). It is the contract: read the relevant section before changing gameplay.
- Interface spec: `docs/TERMINAL.md` (Russian) — the physical terminal NET-01 (stages T1–T3). It wins over the GDD for controls and presentation.
- Battle look: `docs/BATTLE_VISUAL.md` (Russian). **Before changing how anything looks, read its §10.1–10.2 and TERMINAL.md §9.1–9.2**: the code map (which file owns which part of the look) and the pitfalls we already hit.
- Current plan: `docs/superpowers/specs/2026-09-25-core-loop-plan.md` — core-loop tasks T0–T6 after the 2026-09-25 playtest; each task records its status and decisions there.
- Live build: https://zavtraleto.github.io/glorp-battle/ (public repo `zavtraleto/glorp-battle`).

## Language

- Talk to the user in Russian. `docs/GDD.md` and `README.md` are Russian.
- Code, comments, identifiers, commit messages: English.
- Everything the player sees is English and comes from `src/i18n/en.ts` via `t('key')` (`chipName`, `chipDesc`, `enemyName` for data). Never put player-facing literals in terminal code. The CRT uses a 5×7 pixel font (`terminal/crt/pixelFont.ts`): a new character needs a glyph (a test checks every string).

## Commands

```bash
npm run dev        # Vite dev server on :5173 (also exposed on the LAN for phone testing)
npm test           # Vitest, node environment
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
```

Before every commit: `npm test` and `npm run build` must pass. Pushing to `main` runs `.github/workflows/deploy-pages.yml` (test → build → GitHub Pages); a red test blocks the deploy.

## Design rules

- **Source of truth for anything the GDD leaves open: MMBN6 as the combat base, MMBN3 for content and systemic depth** (chips, virus stats, folder content). If BN3 lacks something, use BN6 and say so. MMBN1 is no longer a reference. Labels in docs: `[MMBN3]`, `[MMBN6]`, `[оценка]`, `[решение]`.
- **Deliberate deviations — do not undo them:**
  - There is no Buster (GDD §4): only chips deal damage. Spent chips reshuffle into the draw pile when it runs dry (GDD §5).
  - The run is linear and the folder never changes during it: no path choice, rewards, legacy or saves between runs (GDD §10). Task T6 of the plan will replace this with a new chip after each battle; until then it holds.
  - One trackball micro-swipe = exactly one panel. After each accepted step, the current finger position becomes the next gesture anchor; a stationary finger never repeats movement. No hold-to-repeat on gestures (keyboard keeps it).
  - A `DBG` button (bottom-right) toggles debug tools in every build; the pause key sits bottom-left on the control panel.
  - Working names replace Capcom names: Mettik, Canodron, Hopzap, Bladdy, … (see GDD §0.1).
- When behavior changes, update the GDD in the same change. Mark new decisions `[решение YYYY-MM-DD]`, estimates `[оценка]`, and keep §17 (tuning table) in sync with `src/config/tuning.ts`.

## Architecture

```
src/sim/      pure simulation: no DOM, no Three.js — World, Player, field, enemies, attacks, chips
src/app/      Session + Run: title (Play / Tutorial) → linear run of 6 multi-wave battles (path → battle → …) → complete; death / abandon → game over; pause; tutorial director
src/render/   battle view (BATTLE_VISUAL.md): grid + cell states, procedural sprites, FX, palette pass; reads sim state, never mutates it
src/terminal/ 3D physical terminal: CRT (battle render target + HUD/menu canvas), controls, chip rail
src/core/     fixed-step loop, seeded RNG, input (commands, swipe, keyboard, browser-gesture guards)
src/data/     encounters, chips, folders (starter, debug all), tutorial, enemy looks and levels — content is data, not code
src/config/tuning.ts   every gameplay number (seconds), live-editable in the debug panel
src/debug/    lil-gui panel, stats overlay, URL params
```

Invariants:

- **Fixed 60 Hz step.** Durations live in `tuning` as seconds; convert with `secondsToTicks()`. Never hardcode numbers in logic.
- **Two clocks in `World`:** `tick` advances only in `ACTION` (and end-of-battle animations); `uiTick` always advances and drives state timers (`stateElapsed`). Enemy/attack timers use `tick`, so they freeze during `BATTLE_INTRO` and `PAUSED`. Render with `alpha = 0` while `world.simFrozen`.
- **Input is abstract.** The terminal controls and the keyboard push `Command`s into `InputState`; `World.step()` consumes them once per tick. Only `ACTION` reacts to them, including chip selection (rail taps and keys 1–5 send `selectChip`); menus call `Session` actions through `TerminalHandlers.menu`.
- **Sim → view via events.** The sim pushes `SimEvent`s; `main.ts` drains them each tick into FX, the terminal (CRT flash, damage numbers) and the debug log. Add an event instead of letting render peek at transient sim state.
- **Determinism.** All sim randomness uses `world.rngFolder` / `world.rngAi` (seeded, forked streams). No `Math.random()` in `src/sim`. Session derives a seed per run; the run derives its folder, each step's encounter pick and each step's battle from it.
- **Enemies** extend `Enemy` (`src/sim/enemies/enemyBase.ts`), act only through `EnemyContext`, register in `factory.ts`, get a seed in `data/enemies.ts`, and are placed in `data/encounters.ts`. Scale damage and timings with `this.dmg()` / `this.ticks()` so levels work. Lane attacks implement `LaneMover` so FX can interpolate them.
- **New tunables** go into the right group in `tuning.ts`; the debug panel picks them up automatically (add a slider range in `RANGES` if the auto range is wrong).
- **Battle palette.** Battle materials emit a signal, not a colour: G = phosphor, R = red, B = accent (`render/palette.ts`); the palette pass maps each pixel to its palette colour dimmed by the signal's brightness (no dithering since 2026-09-19). The CRT picture is drawn 1:1 with the glass's render pixels; `CRT_RES_W/H` only set its aspect. No text in battle: HUD shows only HP segments, damage numbers and menus.
- **Panels live in the sim.** `world.field` owns panel state and ownership; movement, warps and waves ask `field.canStand` / `field.panel`, and anything leaving a cell calls `field.onLeave`. Objects (`world.objects`) sit in `Occupancy` and stop shots.
- **New chips** are data: a `shape`, a `color`, optional `onHit` / `field` / `guard` in `data/chips.ts`; a new shape or field action goes into `sim/chips/patterns.ts` / `World.applyFieldAction`. Add strings to `i18n/en.ts`, an icon to `terminal/chips/chipIcons.ts`, and a test in `tests/chipUse.test.ts`.

- **The terminal only reads** sim/session state; it changes them only through `InputState` and `Session` actions. Its mode is derived from `session.screen` + `world.state`, never stored.
- **Terminal feedback is immediate:** a control reacts on `pointerdown` in the same frame; animations tied to game outcomes (chip eject, hits) are driven by `SimEvent`s and never delay the action.
- **Terminal look is PS1 low-poly + big pixels:** procedural geometry and small canvas textures with nearest filtering, low-res render target upscaled without smoothing, CRT shader only on the screen glass. Stay within the performance budget in TERMINAL.md §10.

Comments cite GDD sections (`// GDD §8.2`). Match the surrounding style: short doc comments, no narration.

## Testing

- Tests drive `World`/`Session` directly with `step(dt, { commands, held })`. `Session` takes `{ seed, cheats, folder }` and has no storage.
- Use `skipIntro: true` to start in `ACTION`, `cheats: { god, aiEnabled: false }` to isolate systems, `world.giveChip(...)` to queue chips.
- Reset tuning in `beforeEach`: `mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)))`.
- A world with no living enemies becomes `BATTLE_WON` on the next tick — keep at least one enemy when testing other systems.
- Compute tick expectations from tuning (`T(tuning.x.Y)`), never from literal frame counts.

## Verifying in the browser

- Dev-only handle: `window.__glorp` (`world`, `session`, `input`, `loop`, `sceneRenderer` / `battleView`, `terminal`, `tuning`, `cheats`, `startBattle`).
- URL params: `?debug=1&seed=123&battle=3&encounter=e1&wave=2&tutorial=2&folder=all&god=1&timescale=0.5` (`tutorial=N` opens the tutorial at lesson N; `battle=` / `encounter=` skip the title and use the starter folder, or the `all` folder with `folder=all`; `encounter=s1`…`s5` are the multi-wave run stages, `wave=N` starts from wave N; `all` holds one of every chip); terminal: `?hitzones=1&rscale=400&crtres=240x320&bench=1`.
- Drive the terminal with synthetic `PointerEvent`s on `#terminal-canvas`; zone rects are in `__glorp.terminal.layout.zones` (CSS px).
- Do not run `?bench=1` or CPU-throttled measurements unless the user asks.
- The in-app Browser pane does not run `requestAnimationFrame` while hidden, so the game looks frozen there. Use the Chrome DevTools MCP with phone emulation (`390x844x3,mobile,touch`) for anything time-based.
- Pause the sim for screenshots with `__glorp.loop.clock.paused = true` and `stepOnce(n)`.

## Environment gotchas (Windows)

- **Vite may miss a second write to the same file within a moment** (stale CSS/modules). Apply all edits to a file in one write; if the page looks stale, `touch` the file or restart the dev server.
- `gh` is not on the bash `PATH`: use `"/c/Program Files/GitHub CLI/gh.exe"`.
- The global git email is a work address; this repo sets a local `user.email`. Do not change git config.
- `.gitattributes` enforces LF; CRLF warnings on commit are expected.

## Git

- Commit or push only when asked. Subject line in imperative English (`M7: ...`, `ci: ...`, `docs: ...`), body lists the user-visible changes.
- End commit messages with the `Co-Authored-By` trailer given by the harness.
