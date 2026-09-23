# Combat Timing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a first-playtest timing grammar for player actions, enemy attacks, movement, projectiles, input buffering, and debug diagnostics without changing combat content.

**Architecture:** Keep the existing fixed 60 Hz simulation and seconds-to-ticks conversion. Extend the current enemy state machine with explicit timed phases, preserve each enemy's AI and attack entities, and expose all new durations through `tuning` and the existing debug tools.

**Tech Stack:** TypeScript 7, Vitest 5, Vite 8, lil-gui, fixed-step simulation.

**Spec:** User brief in this task plus the approved in-chat design; a separate spec file was intentionally omitted at the user's request.

## Global Constraints

- `1 Combat Timing Unit = 0.1 s` is a design unit, never the simulation timestep.
- Keep the fixed-step loop and all combat behavior independent of render FPS.
- Preserve current enemy mechanics, chip selection/hand behavior, damage, controls, and visual language.
- Preserve and work around the existing uncommitted changes in the working tree.
- No new chips, enemies, economy, cancel system, controls, balance pass, slow motion, or production VFX.
- Update `docs/GDD.md` and its tuning table with `[решение 2026-09-23]` entries.
- Do not commit unless the user asks.
- Do not perform visual or browser checks; use technical tests and a headless functional simulation only.

## Review Focus

- A buffered chip press must execute once when the lock ends, but must expire after the configured window.
- Counter must depend on the enemy's phase at the actual hit tick, including delayed/projectile player attacks.
- Paralysis and pause must freeze phase deadlines without shortening the remaining phase.
- A strike must spawn or apply its threat exactly once even when one update crosses a phase boundary.
- Projectiles and movement must cover the same cell distance at 30, 60, and 120 render FPS through the fixed-step loop.

---

### Task 1: Player timing model and one-action input buffer

**Files:**
- Modify: `src/config/tuning.ts`
- Modify: `src/sim/player.ts`
- Modify: `src/sim/chips/executor.ts`
- Modify: `src/sim/world.ts`
- Modify: `tests/movement.test.ts`
- Modify: `tests/chipUse.test.ts`
- Modify: `tests/debugPanel.test.ts`

**Interfaces:**
- Produces `COMBAT_TIMING_UNIT`, `ChipTiming`, and `chipTiming(def): { startupTicks; recoveryTicks; totalTicks }`.
- Adds `player.CELL_MOVE_TIME`, `input.ACTION_BUFFER_TIME`, and per-chip-profile `*_STARTUP` / `*_RECOVERY` tunables.
- `World` owns at most one buffered `useChip` request and its expiry tick.

- [x] **Step 1: Write failing movement and action-timing tests**

```ts
it('allows the next player step only after CELL_MOVE_TIME', () => {
  const w = freshWorld();
  tick(w, ['left']);
  idle(w, T(tuning.player.CELL_MOVE_TIME) - 1);
  tick(w, ['right']);
  expect(pos(w)).toEqual([0, 4]);
  idle(w, 1);
  expect(pos(w)).toEqual([1, 4]);
});

it('resolves a Cannon after startup and releases its action lock after recovery', () => {
  const w = makeWorld();
  const target = addEnemy(w, 1, 2, 200);
  give(w, 'cannon');
  use(w);
  run(w, T(tuning.chips.CHIP_STARTUP_CANNON) - 1);
  expect(target.hp).toBe(200);
  run(w, 1);
  expect(target.hp).toBe(160);
  run(w, T(tuning.chips.CHIP_RECOVERY_CANNON));
  expect(w.activeChip).toBeNull();
});
```

- [x] **Step 2: Write failing input-buffer boundary tests**

```ts
it('executes one early Attack as soon as the chip lock ends', () => {
  const w = makeWorld();
  give(w, 'cannon', 'cannon');
  use(w);
  run(w, useTicks(CHIPS.cannon) - T(tuning.input.ACTION_BUFFER_TIME));
  use(w);
  run(w, T(tuning.input.ACTION_BUFFER_TIME));
  expect(w.activeChip?.def.id).toBe('cannon');
  expect(w.chips.attackChips()).toHaveLength(0);
});

it('expires an Attack pressed before the buffer window', () => {
  const w = makeWorld();
  give(w, 'cannon', 'cannon');
  use(w);
  use(w);
  run(w, useTicks(CHIPS.cannon) + 1);
  expect(w.activeChip).toBeNull();
  expect(w.chips.attackChips()).toHaveLength(1);
});
```

- [x] **Step 3: Run the focused tests and verify RED**

Run: `npx vitest run tests/movement.test.ts tests/chipUse.test.ts tests/debugPanel.test.ts`

Expected: failures for missing `CELL_MOVE_TIME`, startup/recovery keys, buffer time, and early-action replay.

- [x] **Step 4: Implement the minimal player timing model**

Use 0.2 s for logical/visual cell movement, 0.1 s for the action buffer, and explicit startup/recovery pairs. Replace `CHIP_HIT_FRAME` plus total use-time arithmetic with:

```ts
export interface ChipTiming {
  startupTicks: number;
  recoveryTicks: number;
  totalTicks: number;
}

export function chipTiming(def: ChipDef): ChipTiming {
  const startupTicks = secondsToTicks(tuning.chips[`CHIP_STARTUP_${def.useTime}`]);
  const recoveryTicks = secondsToTicks(tuning.chips[`CHIP_RECOVERY_${def.useTime}`]);
  return { startupTicks, recoveryTicks, totalTicks: startupTicks + recoveryTicks };
}
```

Keep movement independent of `activeChip`. Buffer only `useChip`; selection and movement inputs retain their existing behavior. Clear the buffered action on damage, pause, battle end, or expiry.

- [x] **Step 5: Re-run focused tests and keep them green**

Run: `npx vitest run tests/movement.test.ts tests/chipUse.test.ts tests/debugPanel.test.ts`

---

### Task 2: Shared enemy attack grammar and Counter state

**Files:**
- Modify: `src/config/tuning.ts`
- Modify: `src/sim/enemies/enemyBase.ts`
- Modify: all files in `src/sim/enemies/`
- Modify: `tests/counter.test.ts`
- Modify: `tests/enemies.test.ts`
- Modify: `tests/combat.test.ts`

**Interfaces:**
- `EnemyState` becomes `IDLE | MOVE | INTENTION | LOCK | COUNTER | STRIKE | RECOVERY | STAGGER | DEAD`.
- `Enemy` produces `setTimedState(state, tick, ticks)`, `phaseDone(tick)`, `phaseRemaining(tick)`, and `counterWindowOpen()`.
- Every enemy tuning group exposes `INTENTION_TIME`, `LOCK_TIME`, `COUNTER_TIME`, `STRIKE_TIME`, `RECOVERY_TIME`, and `MOVE_TIME`; initial values come from fast/standard/heavy prototype constants.

- [x] **Step 1: Write failing base-state and Counter tests**

```ts
it.each(attackEnemyKinds)('%s follows the five attack phases in order', (kind) => {
  const { enemy, ctx } = forcedEnemy(kind);
  expect(traceAttackPhases(enemy, ctx)).toEqual([
    'INTENTION', 'LOCK', 'COUNTER', 'STRIKE', 'RECOVERY',
  ]);
});

it('accepts Counter only from a damaging hit during COUNTER', () => {
  const w = counterWorld('mettik');
  advanceEnemyTo(w, 'LOCK');
  hitEnemy(w);
  expect(w.enemies[0]?.state).toBe('LOCK');
  advanceEnemyTo(w, 'COUNTER');
  hitEnemy(w);
  expect(w.enemies[0]?.state).toBe('STAGGER');
});

it('freezes a timed enemy phase while paralyzed', () => {
  const w = counterWorld('mettik');
  advanceEnemyTo(w, 'COUNTER');
  const enemy = w.enemies[0]!;
  const remaining = enemy.phaseRemaining(w.tick);
  enemy.paralyze(3);
  run(w, 3);
  expect(enemy.state).toBe('COUNTER');
  expect(enemy.phaseRemaining(w.tick)).toBe(remaining);
});
```

The existing world-state tests continue to prove pause freezes `world.tick`; the FPS test in Task 3 covers multi-tick render frames and duplicate strikes.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run tests/counter.test.ts tests/enemies.test.ts tests/combat.test.ts`

Expected: failures because the explicit five states and phase deadline API do not exist.

- [x] **Step 3: Implement the shared timed-state primitives**

```ts
setTimedState(state: EnemyState, tick: number, durationTicks: number): void {
  this.state = state;
  this.stateTick = tick;
  this.stateEndTick = tick + Math.max(0, durationTicks);
}

phaseRemaining(tick: number): number {
  return Number.isFinite(this.stateEndTick) ? Math.max(0, this.stateEndTick - tick) : 0;
}

counterWindowOpen(): boolean {
  return this.state === 'COUNTER';
}
```

Initialize `stateEndTick` to `Infinity`; reset it to `Infinity` in untimed `setState`. Shift `stateEndTick` together with `stateTick` while paralyzed. Leave indefinite `IDLE/MOVE/DEAD` states without a deadline. Update `World.damageEnemy()` and `Enemy.counter()` to call the state-based `counterWindowOpen()` without a timestamp.

- [x] **Step 4: Migrate enemies without changing their mechanics**

For every full attack, perform exactly:

```ts
INTENTION -> LOCK -> COUNTER -> STRIKE -> RECOVERY
```

Enter `STRIKE` and spawn/apply the threat once. Preserve these special rules:

- Canodron cursor scan is `INTENTION`; reaching the player begins `LOCK` and fixes the line.
- Helmhead and Monolith reveal the action in `INTENTION` and freeze target cells in `LOCK`.
- Finnik remains in `STRIKE` until its dash entity finishes.
- Existing projectiles survive Counter or enemy death once spawned.
- Mettik turn passing and common `STAGGER` behavior remain unchanged.

- [x] **Step 5: Re-run focused tests and keep them green**

Run: `npx vitest run tests/counter.test.ts tests/enemies.test.ts tests/combat.test.ts`

---

### Task 3: Time-based projectile/movement tuning and debug phase diagnostics

**Files:**
- Modify: `src/config/tuning.ts`
- Modify: `src/sim/attacks/bomb.ts`
- Modify: `src/sim/attacks/cannonBall.ts`
- Modify: enemy projectile construction sites in `src/sim/enemies/`
- Modify: `src/debug/overlay.ts`
- Modify: `src/main.ts`
- Modify: `tests/combat.test.ts`
- Modify: `tests/debugPanel.test.ts`
- Create: `tests/timing.test.ts`
- Modify: `docs/GDD.md`

**Interfaces:**
- Projectile speeds are expressed as seconds per cell; baseline 0.2 s, fast 0.15 s, slow 0.3 s.
- Produces pure `enemyTimingLines(enemies, tick, simHz): string` for the debug overlay.

- [x] **Step 1: Write failing projectile and FPS-independence tests**

```ts
it('moves a standard projectile one cell per configured travel time', () => {
  const shot = standardProjectile(0);
  runAttackTicks(shot, T(tuning.projectile.CELL_TRAVEL_TIME) - 1);
  expect(shot.y).toBe(1);
  runAttackTicks(shot, 1);
  expect(shot.y).toBe(2);
});

it.each([30, 60, 120])('produces the same combat state at %i render FPS', (fps) => {
  expect(runThroughFixedClock(fps, 1.5)).toEqual(runThroughFixedClock(60, 1.5));
});

function runThroughFixedClock(fps: number, seconds: number) {
  const clock = new FixedStepClock({ hz: 60, maxFrameTime: 0.25 });
  const w = timingWorld();
  const strikes: SimEvent[] = [];
  for (let frame = 0; frame < Math.round(fps * seconds); frame++) {
    for (let n = clock.advance(1 / fps); n > 0; n--) {
      w.step(clock.dt);
      strikes.push(...w.drainEvents().filter((event) => event.type === 'attackSpawned' || event.type === 'enemySlash'));
    }
  }
  return {
    tick: w.tick,
    enemy: w.enemies.map((e) => [e.kind, e.state, e.x, e.y]),
    attacks: w.attacks.map((a) => a.kind),
    strikes: strikes.length,
  };
}
```

```ts
it('derives lob flight from cells travelled', () => {
  const throwTick = 10;
  const bomb = new PlayerBomb(1, 1, 4, 1, 1, 50, throwTick, CHIPS.minibomb);
  expect(bomb.landTick - throwTick).toBe(T(3 * tuning.projectile.CELL_TRAVEL_TIME));
});
```

- [x] **Step 2: Write failing debug diagnostics test**

```ts
it('formats enemy phase and remaining milliseconds', () => {
  const enemy = fakeEnemy({ id: 101, kind: 'mettik', state: 'COUNTER', remainingTicks: 6 });
  expect(enemyTimingLines([enemy], 10, 60)).toBe('mettik#101 COUNTER 100ms');
});
```

- [x] **Step 3: Run focused tests and verify RED**

Run: `npx vitest run tests/timing.test.ts tests/combat.test.ts tests/debugPanel.test.ts`

Expected: failures for missing projectile cell-time config and phase formatter.

- [x] **Step 4: Implement projectile timing and diagnostics**

Keep tick-based stepping for lane movers. Derive lob/cannonball duration from travelled cells and the configured seconds-per-cell. Append `enemyTimingLines(...)` to the existing overlay `extra` text only while debug overlay is visible; do not add battle-scene text or production VFX.

- [x] **Step 5: Update the GDD and tuning table**

Document the timing unit, player startup/recovery and input buffer, the five enemy phases, hit-time Counter rule, prototype profiles, seconds-per-cell projectiles, and fixed-step/FPS independence. Remove obsolete `TELEGRAPH/ATTACK`, `CHIP_HIT_FRAME`, and total-use-time descriptions that no longer match code.

- [x] **Step 6: Re-run focused tests and keep them green**

Run: `npx vitest run tests/timing.test.ts tests/combat.test.ts tests/debugPanel.test.ts`

---

### Task 4: Full technical and functional verification

**Files:**
- Review all modified source, tests, and documentation; no new production behavior.

**Interfaces:**
- Produces verification evidence only.

- [x] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all tests pass with no unreported failures.

- [x] **Step 2: Run static and production-build checks**

Run: `npm run typecheck`

Run: `npm run build`

Expected: both commands exit 0.

- [x] **Step 3: Run the headless functional timing scenario**

Run: `npx vitest run tests/timing.test.ts -t "runs the playtest timing flow"`

The named test created in `tests/timing.test.ts` uses the real `World`: it advances one player move, buffers the second of two Cannons, hits once in `LOCK` and once in `COUNTER`, forces one enemy projectile, and advances through recovery. Its literal assertions are one `enemyCountered` event, one spawned projectile, no duplicate strike event, the expected final player cell, and finite deadlines for every timed state.

- [x] **Step 4: Review scope and working-tree safety**

Run: `git diff --check`

Review `git diff` and verify that pre-existing hand/cooldown, terminal, sprite, and asset changes remain intact; no damage/control/economy changes or visual verification were added.
