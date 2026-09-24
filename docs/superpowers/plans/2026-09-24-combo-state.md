# Combo State Implementation Plan

**Status:** implemented and verified on 2026-09-24 (438 tests, typecheck, production build; visual checks intentionally omitted by user request).

**Playtest amendment:** the Combo Timer, timeout burn, `COMBO_DURATION`, and draining display fraction were removed later on 2026-09-24. Combo State now lasts until the final chip or HP-loss Combo Break; the side banks are a binary active-state indicator. Timeout-specific steps below are retained only as implementation history.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual two-to-five-chip Combo State that slows enemy/world combat while player actions stay at normal speed, with delayed hand cooldown and a symmetric timer on the physical 14-segment display.

**Architecture:** Keep the existing fixed-step loop and reuse `World.time` as the unscaled ACTION timeline. Advance `World.tick` as a scaled world timeline through one fractional accumulator, while `World.playerTick` derives from unscaled ACTION time. Extend the existing hand phases and attack ownership locally rather than creating another combat system.

**Tech Stack:** TypeScript 7, Vitest 5, Three.js 0.186, Vite 8.

**Spec:** `docs/superpowers/specs/2026-09-24-combo-state-design.md`

## Global Constraints

- Preserve the existing selection compatibility rule and fixed queue order.
- One selected chip never enters Combo State.
- Combo duration is 2.5 unscaled ACTION seconds and pauses on the real pause screen.
- Player-owned timing is unscaled; enemy/world-owned timing uses combo world scale.
- No second game loop, combat rewrite, new VFX, new SFX, or visual/browser verification.
- All gameplay values live in `src/config/tuning.ts` and remain editable through the debug panel.
- Update `docs/GDD.md` and `docs/TERMINAL.md` with the final behaviour and tuning table.
- Do not commit unless the user explicitly requests a commit.

## Review Focus

- A use input on the exact timeout boundary must not start a new chip; Task 3 pins this ordering.
- A combo broken before the active chip impact must burn only the queued tail while the active chip follows existing restore rules; Task 3 pins both slot outcomes.
- A zero-damage player hit from god/no-KO protection must neither break the combo nor cancel its action; Task 3 covers both cases.
- Player and enemy projectiles coexisting during Combo State must progress on different timelines without duplicate hits; Task 2 uses simultaneous waves.
- A debug hand size above five must never create a Combo State longer than five chips; Task 3 verifies the selection/activation boundary.

---

### Task 1: Tuning and delayed hand cooldown primitives

**Files:**
- Modify: `src/config/tuning.ts`
- Modify: `src/debug/debugPanel.ts`
- Modify: `src/sim/chips/chipSystem.ts`
- Test: `tests/debugPanel.test.ts`
- Test: `tests/chipHand.test.ts`

**Interfaces:**
- Produces: `tuning.combo` with `COMBO_DURATION`, `WORLD_TIME_SCALE`, `SLOW_MO_ENTER`, `SLOW_MO_EXIT`, `COMBO_BREAK_EXIT`, and `CHIP_INPUT_BUFFER`.
- Produces: `ChipSystem.commitAttack(): boolean`, `ChipSystem.startCooldown(tick: number): void`, `ChipSystem.burnAttackTail(): number[]`, and `ChipSystem.reserveSpentRefills(): void`.
- Preserves: `ChipSystem.startAttack(tick)` as the single-chip compatibility entry point, implemented by commit plus immediate cooldown.

- [ ] **Step 1: Add failing tuning and hand lifecycle tests**

Add assertions that the six combo defaults exist, are exposed as numeric debug controls, committing alone leaves `handCooldownProgress()` null, `startCooldown()` begins progress, and `burnAttackTail()` empties committed slots without returning them to the hand.

```ts
expect(tuning.combo).toMatchObject({
  COMBO_DURATION: 2.5,
  WORLD_TIME_SCALE: 0.7,
  SLOW_MO_ENTER: 0.1,
  SLOW_MO_EXIT: 0.15,
  COMBO_BREAK_EXIT: 0.08,
  CHIP_INPUT_BUFFER: 0.1,
});

s.toggleSelect(0);
s.toggleSelect(1);
expect(s.commitAttack()).toBe(true);
expect(s.handCooldownProgress(0)).toBeNull();
expect(s.burnAttackTail()).toEqual([0, 1]);
expect(s.hand[0]).toBeNull();
expect(s.hand[1]).toBeNull();
s.startCooldown(T(3));
expect(s.handCooldownProgress(T(3))).toBe(0);
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npx vitest run tests/chipHand.test.ts tests/debugPanel.test.ts`

Expected: FAIL because `tuning.combo` and the new lifecycle methods do not exist.

- [ ] **Step 3: Implement the minimal lifecycle split**

Add the tuning group and slider ranges. In `ChipSystem`, separate phase commitment from cooldown timestamps, make `startCooldown` idempotent, burn queued chips using the same spent-slot bookkeeping as `takeNext`, and reserve all spent empty slots after delayed cooldown starts.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run tests/chipHand.test.ts tests/debugPanel.test.ts`

Expected: PASS.

### Task 2: Explicit player and world time domains

**Files:**
- Modify: `src/sim/world.ts`
- Modify: `src/sim/player.ts`
- Modify: `src/sim/attacks/attack.ts`
- Modify: `src/sim/attacks/laneShot.ts`
- Modify: `src/sim/attacks/shockwave.ts`
- Modify: `src/sim/attacks/bomb.ts`
- Modify: `src/sim/field.ts`
- Modify: `src/sim/fieldObject.ts`
- Modify: `src/render/actors.ts`
- Modify: `src/render/scene.ts`
- Modify: `src/render/fx.ts`
- Test: `tests/timing.test.ts`
- Test: `tests/field.test.ts`
- Test: `tests/fieldPhysics.test.ts`

**Interfaces:**
- Produces: `World.playerTick: number`, derived from unscaled ACTION time.
- Produces: `World.worldTimeScale: number` and `World.setWorldTimeScale(target: number, duration: number): void`.
- Produces: `Attack.timeDomain: 'player' | 'world'` and `Attack.update(ctx, tick)` so mixed attacks use their owner clock.
- Produces: explicit timer domains for field restoration, claims, and expiring objects.

- [ ] **Step 1: Add failing split-timeline tests**

Test that at `worldTimeScale = 0.5`, 60 ACTION steps advance `playerTick` by 60 and `tick` by 30; player movement/action timers advance 60 ticks; an enemy phase and enemy wave advance 30; a player wave and bomb advance 60; player-owned Block/Break/Area Grab durations use player time while a world-owned broken panel uses world time.

```ts
w.setWorldTimeScale(0.5, 0);
run(w, 60);
expect(w.playerTick).toBe(60);
expect(w.tick).toBe(30);
expect(playerWave.y).toBeLessThan(enemyWave.y); // directions normalized in the real test
```

- [ ] **Step 2: Run the focused timing tests and confirm failure**

Run: `npx vitest run tests/timing.test.ts tests/field.test.ts tests/fieldPhysics.test.ts`

Expected: FAIL because all combat timing currently shares `World.tick`.

- [ ] **Step 3: Implement the two domains inside the existing loop**

Advance unscaled ACTION time every ACTION step. Drive a fractional world accumulator with the current interpolated world scale and increment `tick` only when the accumulator crosses a whole tick. Run player input, movement, player timers, active chips, cooldown, bombs, and player attacks every ACTION step using `playerTick`. Run enemy AI/statuses, enemy attacks, and world timers only for emitted world ticks. Tag field/object deadlines with their domain and select the matching current tick.

- [ ] **Step 4: Route rendering to the matching timeline**

Render the player and player-owned moving effects with `playerTick`; render enemies and enemy/world effects with `tick`. Keep UI animation on render/UI time. Do not add browser or screenshot checks.

- [ ] **Step 5: Run the focused timing tests**

Run: `npx vitest run tests/timing.test.ts tests/field.test.ts tests/fieldPhysics.test.ts tests/movement.test.ts`

Expected: PASS.

### Task 3: Combo State lifecycle, timeout, break, and buffer

**Files:**
- Create: `src/sim/chips/comboState.ts`
- Modify: `src/sim/world.ts`
- Modify: `src/sim/chips/chipSystem.ts`
- Modify: `src/sim/chips/executor.ts`
- Modify: `src/sim/events.ts`
- Test: `tests/comboState.test.ts`
- Test: `tests/chipUse.test.ts`
- Test: `tests/combat.test.ts`

**Interfaces:**
- Produces: `ComboState` with `status: 'active' | 'timeout'`, `startedAt`, `deadline`, `duration`, `remaining(now)`, and `fraction(now)`.
- Produces: `World.combo: ComboState | null`, `World.comboDisplayFraction`, and `World.comboBreakingFraction`.
- Produces events: `comboStarted`, `comboEnded`, and `comboBroken` for transient view feedback/debugging.

- [ ] **Step 1: Add failing activation and manual-use tests**

Cover one chip never activating combo, two and five chips activating only after the first successful start, refused inputs not activating it, strict manual order, movement between uses, miss consumption, and a sixth debug-hand chip not extending the combo beyond five.

- [ ] **Step 2: Add failing timeout and early-finish tests**

Cover exact-boundary rejection, tail burn with and without an active action, active recovery completing after timeout, immediate completion after the last recovery, slow-mo exit only after completion, and cooldown beginning on the completion tick rather than first use.

- [ ] **Step 3: Add failing damage tests**

Cover actual HP decrease, unresolved active-chip restoration, resolved action/projectile survival, queued-tail burn, Guard, i-frames, Invis, god mode, and no-KO zero loss.

- [ ] **Step 4: Run the combo tests and confirm failure**

Run: `npx vitest run tests/comboState.test.ts tests/chipUse.test.ts tests/combat.test.ts`

Expected: FAIL because Combo State does not exist and cooldown starts immediately.

- [ ] **Step 5: Implement the Combo State state machine**

Start it in `beginChip` only when the committed original length is 2–5. Use `playerTick` for its deadline. On timeout, burn the tail before processing new use commands and keep the state until `activeChip` ends. On final recovery, start delayed cooldown, reserve spent replacements, clear combo, and begin normal exit transition.

- [ ] **Step 6: Implement HP-loss break and existing interruption integration**

Compare HP before/after `takeHit`. Only a decrease invokes Combo Break. Burn the tail first, start cooldown immediately, trigger the fast scale exit, then run the existing active-chip interruption logic. Prevented/zero damage leaves both combo and action intact.

- [ ] **Step 7: Move the buffer to combo tuning and preserve single-buffer semantics**

Replace `tuning.input.ACTION_BUFFER_TIME` reads with `tuning.combo.CHIP_INPUT_BUFFER`; keep one deadline and no accumulated presses. Clear it on pause, flinch/paralysis interruption, timeout, battle end, and Combo Break.

- [ ] **Step 8: Run combo and regression tests**

Run: `npx vitest run tests/comboState.test.ts tests/chipUse.test.ts tests/chipHand.test.ts tests/combat.test.ts tests/movement.test.ts tests/timing.test.ts`

Expected: PASS.

### Task 4: Full-width 14-segment combo timer

**Files:**
- Modify: `src/terminal/chips/segmentFont.ts`
- Modify: `src/terminal/parts/segmentDisplay.ts`
- Modify: `src/terminal/terminal.ts`
- Test: `tests/segmentDisplay.test.ts`
- Test: `tests/terminal.test.ts`

**Interfaces:**
- Produces: `comboDisplayText(entry, fallback, fraction, active, width)` returning fixed-position label and symmetric timer-cell masks.
- Produces: `SegmentDisplay.set(model)` accepting text plus left/right lit-cell counts.
- Consumes: `World.comboDisplayFraction`, active chip definition, and next committed chip.

- [ ] **Step 1: Add failing pure display-model tests**

Assert that full, half, empty, and inactive fractions produce equal left/right counts; the central `NAME VALUE` substring has the same start index at every fraction; active chip wins over queued next chip; and the existing non-combo text remains unchanged.

- [ ] **Step 2: Run display tests and confirm failure**

Run: `npx vitest run tests/segmentDisplay.test.ts tests/terminal.test.ts`

Expected: FAIL because the display accepts only a 14-character string.

- [ ] **Step 3: Implement additional timer character cells**

Keep a fixed 14-cell centre label and add equal timer banks. Use a dedicated full-block-like 14-segment glyph for lit timer cells. Redraw only when the model changes. Size the module from the display row width with a small physical bezel margin instead of the current 72% width cap.

- [ ] **Step 4: Connect active/next chip selection and break collapse**

During an action, format `world.activeChip`; between actions, format `chips.attackChips()[0]`. Drive timer banks from the Combo State fraction. During break, expose the rapidly collapsing fraction; outside combo and exit feedback, leave banks unlit.

- [ ] **Step 5: Run terminal tests**

Run: `npx vitest run tests/segmentDisplay.test.ts tests/terminal.test.ts tests/terminalHud.test.ts tests/terminalRail.test.ts`

Expected: PASS.

### Task 5: Documentation and complete verification

**Files:**
- Modify: `docs/GDD.md`
- Modify: `docs/TERMINAL.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-24-combo-state.md`

**Interfaces:**
- Consumes: final public behaviour and tuning names from Tasks 1–4.
- Produces: synchronized gameplay, terminal, and player-facing documentation.

- [ ] **Step 1: Update gameplay and terminal documentation**

Replace the old automatic cooldown/chain-cancellation descriptions with the implemented manual Combo State rules. Add the six tuning values to GDD §17 and document the full-width symmetric segment timer without describing it as cooldown UI.

- [ ] **Step 2: Update README controls and combo summary**

State that Attack launches one queued chip per press, two-to-five-chip charges create the timed slow-world window, and receiving actual HP damage burns the remaining tail.

- [ ] **Step 3: Run the complete automated verification**

Run: `npm test`

Expected: all test files and tests pass.

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm run build`

Expected: exit 0 and a production bundle in `dist/`.

- [ ] **Step 4: Inspect the final diff without visual checks**

Run: `git -c core.fsmonitor=false status --short` and `git -c core.fsmonitor=false diff --check`.

Expected: only scoped source, tests, and documentation changes; no whitespace errors, screenshots, generated visual artifacts, or unrelated edits.
