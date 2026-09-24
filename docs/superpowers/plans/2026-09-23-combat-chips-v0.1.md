# Combat Field Physics and Ten-Chip Playtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current chip catalogue with ten playtest chips whose combinations emerge from deterministic field physics.

**Architecture:** Extend the current `Field`, `Occupancy`, `FieldObject`, `World`, and data-driven chip executor rather than replacing the combat loop. Put persistent topology/ownership/hazards in `Field`, route voluntary and forced moves through one movement service, route hits through one ordered resolver, then make the ten chip definitions thin adapters over those rules.

**Tech Stack:** TypeScript 7, Vitest 5, Vite 8, Three.js 0.186, fixed-step 60 Hz simulation.

**Spec:** `docs/superpowers/specs/2026-09-23-combat-chips-v0.1-design.md`

## Global Constraints

- Preserve the existing hand, selection, combo, refill, cooldown, startup/recovery, Counter timing and fixed-step loop.
- The playable catalogue contains exactly Cannon, Sword, Area Grab, Mine, Block, Break, AirShot, Spreader, WideSword and Guard.
- Remove old chip content while reusing its generic simulation, rendering and cartridge infrastructure.
- Do not add Colors, a final code system, slow motion, progression, rarity, upgrades, rewards, enemies or final balance.
- All prototype damage, ranges, durations, Block HP and stagger time live in `src/config/tuning.ts`.
- Preserve and integrate the pre-existing uncommitted edits in `src/config/tuning.ts`, `src/data/chips.ts`, `src/data/tutorial.ts`, `src/debug/debugPanel.ts`, `src/i18n/en.ts`, `tests/chips.test.ts` and `tests/core.test.ts`.
- Do not run browser, screenshot or visual QA. Verification is limited to automated tests, typecheck, build and diff checks.
- Do not commit unless the user explicitly asks; task checkpoints are test-backed working-tree states.

## Review Focus

- Two impacts on one tick must both collide with an OCCUPY object that existed at the start of that tick, even if the first destroys it.
- A forced move arriving during an ordinary move must wait for landing, then revalidate the new destination and ARM state.
- CLAIM expiry must neither disconnect a deeper live claim nor strand the player beyond the restored boundary.
- Counter must be checked before Guard, while AirShot PUSH must occur only when its damage was actually applied.
- Mine and Break must use the activation anchor and resolve exactly two cells forward without a target mode.

---

### Task 1: Field topology, hazards and layered CLAIM ownership

**Files:**
- Modify: `src/config/tuning.ts`
- Modify: `src/sim/field.ts`
- Modify: `src/sim/events.ts`
- Modify: `src/sim/world.ts`
- Modify: `src/data/encounters.ts`
- Modify: `tests/field.test.ts`
- Modify: `tests/encounters.test.ts`

**Interfaces:**
- Produces `Panel = 'NORMAL' | 'BROKEN'` and `Hazard = { kind: 'mine'; side: Side; damage: number }`.
- Produces `Field.arm(x, y, hazard): boolean`, `Field.takeHazard(x, y): Hazard | null`, `Field.breakPanel(x, y, tick, durationTicks): boolean` and `Field.claimNextRow(tick, durationTicks): number | null`.
- Changes `Field.update` to accept the current player cell and retry deferred claim rollback.
- Adds `hazardChanged` and `claimChanged` simulation events.

- [ ] **Step 1: Replace cracked-panel tests with temporary BREAK tests**

Add focused assertions in `tests/field.test.ts`:

```ts
it('breaks only an empty normal cell and restores at its own duration', () => {
  const { f } = makeField();
  expect(f.breakPanel(1, 2, 10, T(2))).toBe(true);
  expect(f.panel(1, 2)).toBe('BROKEN');
  f.update(10 + T(2) - 1, { player: { x: 1, y: 4 } });
  expect(f.panel(1, 2)).toBe('BROKEN');
  f.update(10 + T(2), { player: { x: 1, y: 4 } });
  expect(f.panel(1, 2)).toBe('NORMAL');
});
```

Delete expectations for `CRACKED`, `crack()`, and breaking an occupied panel into a crack. Update encounter fixtures so they use only `NORMAL` and `BROKEN`.

- [ ] **Step 2: Write ARM lifecycle and replacement tests**

```ts
it('arms one normal cell and removes the hazard exactly once', () => {
  const { f } = makeField();
  const mine = { kind: 'mine', side: 'player', damage: 6 } as const;
  expect(f.arm(0, 1, mine)).toBe(true);
  expect(f.arm(0, 1, mine)).toBe(false);
  expect(f.takeHazard(0, 1)).toEqual(mine);
  expect(f.takeHazard(0, 1)).toBeNull();
});

it('BREAK removes ARM without changing ownership', () => {
  const { f } = makeField();
  f.arm(0, 2, { kind: 'mine', side: 'player', damage: 6 });
  f.breakPanel(0, 2, 0, T(1));
  expect(f.hazard(0, 2)).toBeNull();
  expect(f.owner(0, 2)).toBe('enemy');
});
```

- [ ] **Step 3: Write independent CLAIM timer and rollback tests**

Cover one claimed row, a second deeper row with an independent timer, outer expiry deferred by the inner layer, and expiry deferred while the player stands beyond the returning boundary:

```ts
const first = f.claimNextRow(0, T(1));
const second = f.claimNextRow(T(0.5), T(2));
expect([first, second]).toEqual([2, 1]);
f.update(T(1), { player: { x: 1, y: 3 } });
expect(f.owner(1, 2)).toBe('player');
f.update(T(2.5), { player: { x: 1, y: 1 } });
expect(f.owner(1, 1)).toBe('player');
expect(f.owner(1, 2)).toBe('player');
f.update(T(2.5) + 1, { player: { x: 1, y: 3 } });
expect([f.owner(1, 1), f.owner(1, 2)]).toEqual(['enemy', 'enemy']);
```

- [ ] **Step 4: Run the field tests and verify RED**

Run: `npx vitest run tests/field.test.ts tests/encounters.test.ts`

Expected: failures for removed cracked APIs and missing hazard/claim interfaces.

- [ ] **Step 5: Implement layered Field state**

Use per-cell topology/hazard state plus ordered claim layers:

```ts
interface PanelCell {
  panel: Panel;
  owner: Side;
  readonly home: Side;
  restoreAt: number;
  hazard: Hazard | null;
}

interface ClaimLayer {
  row: number;
  expiresAt: number;
}
```

`claimNextRow` selects the nearest enemy-owned row adjacent to player territory, claims all three cells regardless of actors/objects/topology, and appends one layer. `update` restores only a suffix whose timers expired and whose removal neither leaves a deeper layer nor puts the player on the enemy side of the new boundary.

- [ ] **Step 6: Remove cracked encounter behavior and run focused tests GREEN**

Run: `npx vitest run tests/field.test.ts tests/encounters.test.ts tests/battleVisual.test.ts`

Expected: pass; battle visual tests now know only normal/broken topology.

---

### Task 2: Shared movement, queued displacement and collision stagger

**Files:**
- Create: `src/sim/movement.ts`
- Modify: `src/sim/player.ts`
- Modify: `src/sim/enemies/enemyBase.ts`
- Modify: `src/sim/enemies/mettik.ts`
- Modify: `src/sim/enemies/canodron.ts`
- Modify: `src/sim/enemies/hopzap.ts`
- Modify: `src/sim/enemies/bladdy.ts`
- Modify: `src/sim/world.ts`
- Modify: `src/config/tuning.ts`
- Modify: `tests/movement.test.ts`
- Modify: `tests/enemies.test.ts`
- Create: `tests/fieldPhysics.test.ts`

**Interfaces:**
- Produces `MovementWorld`, `MoveRequest`, `MoveResult` and `resolveMove(world, request): MoveResult`.
- `MoveRequest` includes `{ actor, to, kind: 'voluntary' | 'forced', source, latchedHazard }`.
- `Enemy.applyCollisionStagger(tick, ticks)` pauses the current phase and refreshes without stacking.
- `World.pushActor(target, source): MoveResult` queues a forced move while `target.moving` and resolves it on landing.

- [ ] **Step 1: Write voluntary and forced boundary tests**

```ts
it('blocks voluntary ownership crossing but permits forced crossing', () => {
  const w = physicsWorld();
  moveEnemyTo(w, target, 1, 2);
  w.field.claimNextRow(w.tick, T(2));
  expect(resolveMove(w, voluntary(target, 1, 3))).toMatchObject({ moved: false, reason: 'ownership' });
  expect(w.pushActor(target, { x: 1, y: 1 })).toMatchObject({ moved: true });
  expect([target.x, target.y]).toEqual([1, 3]);
});
```

Also cover BREAK, OCCUPY, edge and actor collision as blocked forced destinations.

- [ ] **Step 2: Write ARM latching and queued displacement tests**

```ts
it('triggers the ARM latched when the step begins even if the visible hazard changes', () => {
  const w = physicsWorld();
  w.field.arm(1, 1, mine(6));
  const move = w.beginMove(target, 1, 1, 'voluntary');
  w.field.takeHazard(1, 1);
  w.finishMove(move);
  expect(target.hp).toBe(target.maxHp - 6);
});

it('finishes an ordinary move before revalidating queued PUSH', () => {
  const w = physicsWorld();
  const move = w.beginMove(target, 1, 1, 'voluntary');
  w.pushActor(target, { x: 1, y: 3 });
  w.finishMove(move);
  expect([target.x, target.y]).toEqual([1, 0]);
});
```

- [ ] **Step 3: Write collision stagger phase-freeze tests**

Use an enemy in `LOCK`, push it into an edge/object, then assert `state`, `phaseRemaining`, and the non-stacking refresh boundary after `STAGGER_TIME`.

- [ ] **Step 4: Run focused tests and verify RED**

Run: `npx vitest run tests/movement.test.ts tests/enemies.test.ts tests/fieldPhysics.test.ts`

- [ ] **Step 5: Implement the movement service and adapt actor movement**

Keep `Occupancy.move` as the atomic commit. `resolveMove` validates ownership only for voluntary moves, reads topology/object/actor occupancy for both kinds, and returns a structured collision instead of silently failing:

```ts
export type MoveResult =
  | { moved: true; from: Cell; to: Cell; hazard: Hazard | null }
  | { moved: false; reason: 'edge' | 'ownership' | 'break' | 'object' | 'actor'; blockerId?: number };
```

Player and enemy helpers call this service. Preserve current movement cadence and interpolation fields. Store at most one pending forced request per actor and resolve it when the current movement duration reaches landing.

- [ ] **Step 6: Implement collision stagger and ARM entry reaction**

ARM reaction runs after the move commits and uses the latched hazard. A blocked PUSH applies `STAGGER_TIME`; actor-on-actor collisions stagger both enemies, while player collisions do not invent a player stagger state.

- [ ] **Step 7: Run movement and enemy suites GREEN**

Run: `npx vitest run tests/movement.test.ts tests/enemies.test.ts tests/fieldPhysics.test.ts tests/timing.test.ts`

---

### Task 3: OCCUPY lifetime, projectile snapshots and ordered hit resolution

**Files:**
- Modify: `src/sim/fieldObject.ts`
- Modify: `src/sim/attacks/attack.ts`
- Modify: `src/sim/attacks/laneShot.ts`
- Modify: `src/sim/attacks/shockwave.ts`
- Modify: `src/sim/world.ts`
- Modify: `src/sim/player.ts`
- Modify: `src/sim/enemies/enemyBase.ts`
- Modify: `src/sim/events.ts`
- Modify: `tests/combat.test.ts`
- Modify: `tests/counter.test.ts`
- Modify: `tests/fieldPhysics.test.ts`

**Interfaces:**
- Changes `ObjectKind` to `'block'` and adds `expiresAt` to `FieldObject`.
- Produces `HitSpec`, `HitOutcome`, and `World.resolveHit(spec): HitOutcome`.
- Produces `World.beginImpactTick()` blocker snapshots for attacks updated on the same tick.
- Renames player `barrier` state/events to `guard`/`guardSet`/`guardBroken`.

- [ ] **Step 1: Write Block placement, expiry and replacement tests**

Assert Block may be placed on either territory when the cell is empty, removes ARM, rejects BREAK/actors/objects, expires exactly at `BLOCK_DURATION`, and is destroyed before BREAK is applied to its cell.

- [ ] **Step 2: Write simultaneous projectile snapshot test**

```ts
it('same-tick projectiles both collide with the Block present at tick start', () => {
  const w = physicsWorld();
  const block = w.placeBlock(1, 2)!;
  w.spawnAttack(testShot(1, 3, 2));
  w.spawnAttack(testShot(1, 3, 2));
  step(w);
  expect(block.hp).toBe(0);
  expect(targetBehind.hp).toBe(targetBehind.maxHp);
});
```

- [ ] **Step 3: Write hit-order tests**

Cover Counter-before-Guard, multi-hit Guard consuming only the first hit, utility-only zero damage not consuming Guard, death suppressing PUSH, and guarded AirShot suppressing damage-dependent PUSH.

```ts
const out = w.resolveHit({ source, target, damage: 2, canCounter: true, push: true, pushRequiresDamage: true });
expect(out.order).toEqual(['counter', 'guard', 'damage', 'death', 'secondary', 'world']);
```

- [ ] **Step 4: Run focused tests and verify RED**

Run: `npx vitest run tests/combat.test.ts tests/counter.test.ts tests/fieldPhysics.test.ts`

- [ ] **Step 5: Implement timed Block and same-tick blocker snapshots**

Create snapshots before attack updates in `World.step`; `hitObjectAt` reports collision from the snapshot even after the live object dies. Object expiry clears collision immediately and emits one removal event.

- [ ] **Step 6: Implement and route all damage through `resolveHit`**

`hitPlayerAt`, `hitEnemyAt`, chip cell damage and ARM reaction become adapters around one resolver. Keep player interruption after an unguarded real hit. Preserve enemy Counter timing and enemy friendly-fire defaults.

- [ ] **Step 7: Run combat suites GREEN**

Run: `npx vitest run tests/combat.test.ts tests/counter.test.ts tests/field.test.ts tests/fieldPhysics.test.ts tests/chipUse.test.ts`

This is the automated checkpoint for milestone one: field physics works without a temporary player-facing test harness.

---

### Task 4: Replace the catalogue, folders and tutorial content

**Files:**
- Modify: `src/data/chips.ts`
- Modify: `src/data/folders.ts`
- Modify: `src/data/tutorial.ts`
- Modify: `src/config/tuning.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/terminal/chips/chipIcons.ts`
- Modify: `tests/chips.test.ts`
- Modify: `tests/tutorialScript.test.ts`
- Modify: `tests/tutorialSession.test.ts`
- Modify: `tests/tutorialSim.test.ts`

**Interfaces:**
- `ChipId` becomes exactly `'cannon' | 'sword' | 'areagrab' | 'mine' | 'block' | 'break' | 'airshot' | 'spreader' | 'widesword' | 'guard'`.
- `ChipDef.power` is resolved from a `ChipPowerKey` in tuning rather than a hardcoded playtest number.
- Every prototype chip uses the shared placeholder `'*'` code.

- [ ] **Step 1: Rewrite catalogue tests for the exact ten IDs and relative powers**

```ts
expect(Object.keys(CHIPS)).toEqual([
  'cannon', 'sword', 'areagrab', 'mine', 'block',
  'break', 'airshot', 'spreader', 'widesword', 'guard',
]);
expect(chipPower(CHIPS.sword)).toBeGreaterThan(chipPower(CHIPS.cannon));
expect(chipPower(CHIPS.mine)).toBeGreaterThan(chipPower(CHIPS.cannon));
expect(chipPower(CHIPS.airshot)).toBeLessThan(chipPower(CHIPS.cannon));
expect(chipPower(CHIPS.widesword)).toBeLessThan(chipPower(CHIPS.sword));
```

Keep the existing name-length, description and icon completeness test.

- [ ] **Step 2: Write folder and tutorial replacement tests**

Assert `basic` and `field` remain 30 entries after count expansion, every entry belongs to the ten-chip set, `all` contains exactly those ten, and tutorial fixtures contain no removed IDs.

- [ ] **Step 3: Run catalogue/tutorial tests and verify RED**

Run: `npx vitest run tests/chips.test.ts tests/tutorialScript.test.ts tests/tutorialSession.test.ts tests/tutorialSim.test.ts`

- [ ] **Step 4: Replace chip types/data and add tunables**

Add explicit tuning keys:

```ts
CHIP_DAMAGE_CANNON: 4,
CHIP_DAMAGE_SWORD: 6,
CHIP_DAMAGE_MINE: 6,
CHIP_DAMAGE_AIRSHOT: 2,
CHIP_DAMAGE_SPREADER_MAIN: 3,
CHIP_DAMAGE_SPREADER_SPLASH: 1,
CHIP_DAMAGE_WIDESWORD: 4,
FIELD_TARGET_DISTANCE: 2,
BREAK_DURATION: 5,
AREA_GRAB_DURATION: 8,
BLOCK_HP: 2,
BLOCK_DURATION: 6,
STAGGER_TIME: 0.25,
```

Exact values are prototype defaults; tests constrain only documented relationships and behavior.

- [ ] **Step 5: Rebuild playable folders and adapt tutorials**

Keep existing folder IDs/menu flow to avoid a UI rewrite. Compose both 30-chip folders only from the new ten, with the primary folder containing repeated Mine/AirShot, AreaGrab/Sword and Block/AirShot opportunities. Replace tutorial ShotGun with Cannon/WideSword and PanlGrab with AreaGrab while preserving lesson structure.

- [ ] **Step 6: Remove obsolete strings/icons and run focused tests GREEN**

Run: `npx vitest run tests/chips.test.ts tests/tutorialScript.test.ts tests/tutorialSession.test.ts tests/tutorialSim.test.ts tests/chipFace.test.ts`

---

### Task 5: Fixed-distance Mine/Break placement

**Files:**
- Modify: `src/sim/chips/aim.ts`
- Modify: `src/sim/world.ts`
- Modify: `tests/chipAim.test.ts`
- Create: `tests/chipPlacement.test.ts`

**Interfaces:**
- Mine and Break derive one target from the captured activation cell: `(x, y−FIELD_TARGET_DISTANCE)`.
- No new input command or target-mode state is introduced.

- [ ] **Step 1: Write fixed-distance placement tests**

Assert both chips act exactly two cells ahead, keep the activation cell as anchor during startup movement, and never touch the adjacent or third cell.

- [ ] **Step 2: Implement automatic placement and aim preview**

At the impact tick, derive the destination from the stored chip origin. Mine applies ARM if the fixed cell is legal; Break destroys ARM/OCCUPY there and applies temporary topology. The ordinary chip lifecycle handles invalid destinations as no-ops.

- [ ] **Step 3: Run placement suites GREEN**

Run: `npx vitest run tests/chipAim.test.ts tests/chipPlacement.test.ts`

---

### Task 6: Connect all ten chips to shared rules

**Files:**
- Modify: `src/data/chips.ts`
- Modify: `src/sim/chips/patterns.ts`
- Modify: `src/sim/chips/executor.ts`
- Modify: `src/sim/world.ts`
- Modify: `tests/chipUse.test.ts`
- Modify: `tests/fieldPhysics.test.ts`
- Create: `tests/chipInteractions.test.ts`

**Interfaces:**
- `ChipDef` describes only generic `shape`, `field`, `guard`, `onHit` and tuning keys.
- Adds field actions `'claim' | 'arm' | 'occupy' | 'break'`.
- Spreader carries distinct main/splash tuning keys and splash offsets.

- [ ] **Step 1: Write one behavior test per chip**

Cover Cannon baseline, adjacent Sword, timed Area Grab, fixed-distance Mine, adjacent Block, fixed-distance Break, damage-dependent AirShot push, Spreader living-target side splash, multi-target WideSword and one-hit Guard.

- [ ] **Step 2: Write emergent interaction tests**

```ts
it('Mine -> AirShot triggers through PUSH entry, not a chip-pair rule', () => {
  placeMine(w, 1, 1);
  const e = enemyAt(w, 1, 2);
  fire(w, 'airshot');
  expect([e.x, e.y, e.hp]).toEqual([1, 1, startHp - airshotDamage - mineDamage]);
});

it('Block -> AirShot produces collision stagger', () => {
  placeBlock(w, 1, 1);
  const e = enemyAt(w, 1, 2);
  fire(w, 'airshot');
  expect([e.x, e.y, e.state]).toEqual([1, 2, 'STAGGER']);
});

it('Area Grab -> Sword makes the adjacent payoff reachable', () => {
  fire(w, 'areagrab');
  movePlayer(w, 1, 2);
  const e = enemyAt(w, 1, 1);
  fire(w, 'sword');
  expect(e.hp).toBe(e.maxHp - swordDamage);
});

it('Break constrains movement but not Cannon travel', () => {
  breakCell(w, 1, 2);
  expect(w.player.canStep('up')).toBe(false);
  const e = enemyAt(w, 1, 1);
  fire(w, 'cannon');
  expect(e.hp).toBe(e.maxHp - cannonDamage);
});
```

Search production code to ensure no conditional names a two-chip pair.

- [ ] **Step 3: Run chip suites and verify RED**

Run: `npx vitest run tests/chipUse.test.ts tests/chipInteractions.test.ts tests/fieldPhysics.test.ts`

- [ ] **Step 4: Implement thin chip adapters**

Reuse `shapeCells` for Cannon/Sword/WideSword, the current lane effect for AirShot, the AreaGrab entry point for CLAIM, Barrier's self-support path for Guard, and RockCube's object path for Block. Special-case only Spreader's generic “splash after living target” geometry; do not inspect previous/next chip IDs.

- [ ] **Step 5: Implement Break replacement and Mine reaction through world APIs**

Break first destroys an object or removes ARM, then applies topology. Mine stores owner/damage on the field and resolves through movement entry. Neither chip calls AirShot or any other chip-specific function.

- [ ] **Step 6: Run interaction suites GREEN**

Run: `npx vitest run tests/chipUse.test.ts tests/chipInteractions.test.ts tests/fieldPhysics.test.ts tests/combat.test.ts`

---

### Task 7: Code-native icons, persistent state marks and FX wiring

**Files:**
- Modify: `src/terminal/chips/chipIcons.ts`
- Modify: `src/terminal/chips/chipFace.ts`
- Modify: `src/render/cellStates.ts`
- Modify: `src/render/field.ts`
- Modify: `src/render/fx.ts`
- Modify: `src/render/scene.ts`
- Modify: `src/sim/events.ts`
- Modify: `tests/chipFace.test.ts`
- Modify: `tests/battleVisual.test.ts`

**Interfaces:**
- Adds only code-native 16x16 icons needed by the ten-chip set.
- Adds persistent ARM and Block inputs to cell-state/render snapshots.
- Adds transient event handling for collision stagger and Guard using existing batches/palette signals.

- [ ] **Step 1: Write structural icon and render-state tests**

Assert every remaining icon is exactly 16 rows of 16 palette characters; removed IDs are absent. Add pure `cellStates` tests for ARM, Block and BREAK priority.

- [ ] **Step 2: Run visual-code tests and verify RED**

Run: `npx vitest run tests/chipFace.test.ts tests/battleVisual.test.ts`

- [ ] **Step 3: Reuse and complete cartridge icons**

Keep current Cannon, Sword, WideSword, AirShot, Spreader and AreaGrab-compatible art where it communicates the action. Rename Barrier art for Guard. Draw Mine, Block and Break in the existing 16x16 character palette. Increment `FACE_GEN` once because the cached catalogue changes.

- [ ] **Step 4: Add code-native persistent and transient rendering**

Reuse broken-panel, object, rings, cross, tracer, slash, hit and Barrier primitives. ARM is a small pulsing hazard glyph using the red/action signals; the fixed destination uses the existing aim accent; collision stagger uses a short existing ring/cross pulse. Do not add battle text, arbitrary colors, textures or a new renderer.

- [ ] **Step 5: Run structural render tests GREEN**

Run: `npx vitest run tests/chipFace.test.ts tests/battleVisual.test.ts tests/terminalHud.test.ts`

No browser, screenshot, animation, readability or aesthetic check is performed; those remain the user's manual review.

---

### Task 8: Documentation cleanup and full technical verification

**Files:**
- Modify: `docs/GDD.md`
- Modify: `README.md` only if it enumerates removed chips or obsolete folder content
- Review: all modified source and test files

**Interfaces:**
- Produces verification evidence only; no new gameplay behavior.

- [ ] **Step 1: Update the GDD contract**

Replace the old 27-chip table, cracked-panel rules, Barrier name, old AreaGrab semantics and old tuning entries. Add `[решение 2026-09-23]` for the ten-chip playtest, shared world verbs, fixed field target, resolution order and the two-milestone implementation. Keep §17 exactly synchronized with `DEFAULT_TUNING`.

- [ ] **Step 2: Prove the old catalogue is gone**

Run:

```powershell
rg -n "vulcan|hicannon|mcannon|shotgun|vgun|sidegun|longsword|minibomb|shockwave|zapring|recov10|recov30|recover50|recov80|invis|barrier|geddon1|geddon2|panlgrab|panlout1|panlout3|repair|rockcube" src tests docs/GDD.md
```

Expected: no chip-content references; generic enemy shockwave class/name may remain and must be reviewed rather than deleted.

- [ ] **Step 3: Run the complete automated suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 4: Run static and production checks**

Run: `npm run typecheck`

Run: `npm run build`

Expected: both exit 0.

- [ ] **Step 5: Run focused technical smoke suites**

Run: `npx vitest run tests/fieldPhysics.test.ts tests/chipPlacement.test.ts tests/chipInteractions.test.ts tests/session.test.ts tests/run.test.ts`

Expected: world interactions, controls, folders and the complete run lifecycle pass without runtime errors.

- [ ] **Step 6: Check working-tree integrity**

Run: `git diff --check`

Review `git diff --stat` and the overlapping pre-existing files. Confirm no unrelated uncommitted work was discarded and no browser/visual verification artifacts were created.
