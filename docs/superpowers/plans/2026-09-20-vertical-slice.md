# Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the whole combat content set with the MMBN6 vertical slice — seven enemy families, ten chips, a Counter system, hitstop and one phase model for every attack — so the real-time combat can be polished.

**Architecture:** The simulation already runs a fixed 60 Hz tick with enemies as small classes over a shared `IDLE → MOVE → TELEGRAPH → ATTACK → RECOVERY` state machine and chips as data. This plan removes six enemies and twenty chips, moves every attack timing into a uniform per-enemy profile in `tuning`, turns the chip's single hit frame into a startup/hits/recovery window, and adds three new mechanisms: a persistent zone attack, forced player movement and a damage-absorbing barrier. Counter rides on the profile: each attack owns a window, and a chip that damages an enemy inside it cancels the attack.

**Tech Stack:** Vite, TypeScript (strict), Three.js, Vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-09-20-vertical-slice-design.md`

## Global Constraints

- Fixed 60 Hz simulation. Durations live in `src/config/tuning.ts` **in seconds** and convert with `secondsToTicks()`. Never hardcode frame counts in logic or in tests — compute expectations from tuning.
- Two clocks in `World`: `tick` advances only in `ACTION` and end-of-battle animations; `uiTick` always advances. Enemy and attack timers use `tick`.
- No `Math.random()` anywhere in `src/sim`. All randomness goes through `world.rngFolder` / `world.rngAi`.
- Everything the player sees is English and comes from `src/i18n/en.ts` via `t('key')`. Never put player-facing literals in terminal code. A new string needs glyphs in `src/terminal/crt/pixelFont.ts` — a test checks every string.
- Code, comments, identifiers and commit messages are in English. Comments cite GDD sections (`// GDD §8.2`).
- **No Capcom names in code or UI.** Working names only: `mettik`, `canodron`, `bladdy`, `pirak`, `rollik`, `stovik`, `gustbox`.
- Every tuning group for an enemy is named exactly after its `EnemyKind` and contains at least `HP`, `DMG`, `KNOCKBACK`, `TELEGRAPH`, `COUNTER`, `ACTIVE`, `RECOVERY`.
- The simulation talks to the view only through `SimEvent`s. Never let render peek at transient sim state.
- Before **every** commit: `npm test` and `npm run build` must both pass.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Test setup always resets tuning: `beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))))`.
- A world with no living enemies flips to `BATTLE_WON` on the next tick — keep at least one living enemy when testing anything else.

**Task order note:** this plan moves the combat debug overlay (Task 8) ahead of the movement polish (Task 9); spec §17 had them the other way round. Movement polish needs the overlay to read cooldown and buffer state, so the tool must exist first. Gustbox still comes after the movement polish, as spec §3.7 requires.

**Resolved design choices (2026-09-20):** The agreed design spec controls adaptations to this game's portrait grid. Canodron keeps its cursor, lock and instantaneous lane shot after a visible delay; the source gameplay spec's request to tune projectile speed is satisfied by other travelling projectiles, especially Pirak and WideShot. Hitstop is part of this slice (Task 8A). Playtesting covers both desktop and phone, including different aspect ratios. `docs/superpowers/specs/MMBN6_vertical_slice_gameplay_spec.md` is reference material, not implementation instructions.

**Preview:** Task 8B prepares an independent GitHub Pages build from `codex/gameplay` in a separate preview repository. The existing `main` Pages site remains on its current workflow. The preview URL is used for desktop and real-phone checks.

---

### Task 1: Remove the six retired enemies and the boss tier

**Files:**
- Delete: `src/sim/enemies/spiker.ts`, `src/sim/enemies/hopzap.ts`, `src/sim/enemies/rattik.ts`, `src/sim/enemies/helmhead.ts`, `src/sim/enemies/finnik.ts`, `src/sim/enemies/monolith.ts`
- Delete: `src/sim/attacks/heatShot.ts`, `src/sim/attacks/ratMine.ts`, `src/sim/attacks/cannonBall.ts`
- Delete: `src/assets/sprites/monolith.png`
- Delete: `tests/viruses.test.ts`
- Modify: `src/sim/enemies/enemyBase.ts` (the `EnemyKind` union)
- Modify: `src/sim/enemies/factory.ts`
- Modify: `src/data/enemies.ts` (`ENEMY_SEEDS`)
- Modify: `src/data/encounters.ts` (`EncounterTier`, `ENCOUNTERS`)
- Modify: `src/config/tuning.ts` (delete six groups)
- Modify: `src/app/run.ts` (`tierAt`, `complete`, `pick` fallbacks)
- Modify: `src/render/spriteArt.ts`, `src/render/actors.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/terminal/crt/menuModel.ts:65`
- Test: `tests/enemies.test.ts`, `tests/encounters.test.ts`, `tests/run.test.ts`, `tests/session.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `EnemyKind = 'mettik' | 'canodron' | 'bladdy'`; `EncounterTier = 'normal' | 'elite'`; `Run.complete` is true once the tenth step is won.

- [ ] **Step 1: Write the failing test**

Replace the boss cases in `tests/run.test.ts`. Delete the old `it('is ten battles in a fixed order for a seed, boss last, no repeats')`, `it('puts elites on ELITE_STEPS only')` boss assertions and the `jumpTo(RUN_STEPS)` boss assertion, then add:

```ts
it('is ten battles with no boss tier and no repeats', () => {
  const r = new Run(7, 'basic');
  const ids: string[] = [];
  for (let d = 1; d <= RUN_STEPS; d++) {
    ids.push(r.encounter.id);
    expect(r.encounter.tier).toBe(ELITE_STEPS.includes(d) ? 'elite' : 'normal');
    r.finishBattle(true, 100);
  }
  expect(new Set(ids).size).toBe(RUN_STEPS);
});

it('completes once the last step is won', () => {
  const r = new Run(7, 'basic');
  for (let d = 1; d < RUN_STEPS; d++) r.finishBattle(true, 100);
  expect(r.complete).toBe(false);
  r.finishBattle(true, 100);
  expect(r.complete).toBe(true);
});
```

In `tests/encounters.test.ts` delete `it('the boss encounter is exactly one Monolith')` and drop every `tier !== 'boss'` filter (the union no longer has it). Add:

```ts
it('uses only the three surviving enemy kinds', () => {
  const allowed = new Set(['mettik', 'canodron', 'bladdy']);
  for (const e of ENCOUNTERS) {
    for (const s of e.enemies) expect(allowed.has(s.kind), `${e.id}: ${s.kind}`).toBe(true);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/run.test.ts tests/encounters.test.ts`
Expected: FAIL — `run.test.ts` still finds `tier: 'boss'` at depth 10, `encounters.test.ts` finds `monolith` in the encounter list.

- [ ] **Step 3: Delete the enemy and attack files**

```bash
git rm src/sim/enemies/spiker.ts src/sim/enemies/hopzap.ts src/sim/enemies/rattik.ts \
       src/sim/enemies/helmhead.ts src/sim/enemies/finnik.ts src/sim/enemies/monolith.ts
git rm src/sim/attacks/heatShot.ts src/sim/attacks/ratMine.ts src/sim/attacks/cannonBall.ts
git rm src/assets/sprites/monolith.png tests/viruses.test.ts
```

- [ ] **Step 4: Narrow the enemy union and the factory**

In `src/sim/enemies/enemyBase.ts`:

```ts
export type EnemyKind = 'mettik' | 'canodron' | 'bladdy';
```

Replace `src/sim/enemies/factory.ts` entirely:

```ts
import type { EnemySpawn } from '../../data/battles';
import { Bladdy } from './bladdy';
import { Canodron } from './canodron';
import type { Enemy } from './enemyBase';
import { Mettik } from './mettik';

export function createEnemy(spawn: EnemySpawn, id: number, tick: number): Enemy {
  const level = spawn.level ?? 1;
  const args = [id, spawn.x, spawn.y, tick, level] as const;
  switch (spawn.kind) {
    case 'mettik':
      return new Mettik(...args);
    case 'canodron':
      return new Canodron(...args);
    case 'bladdy':
      return new Bladdy(...args);
  }
}
```

In `src/data/enemies.ts` cut `ENEMY_SEEDS` to the three survivors (`mettik: 11`, `canodron: 23`, `bladdy: 64`).

In `src/config/tuning.ts` delete the `spiker`, `hopzap`, `rattik`, `helmhead`, `finnik` and `monolith` groups.

- [ ] **Step 5: Drop the boss tier from the run**

In `src/data/encounters.ts`:

```ts
export type EncounterTier = 'normal' | 'elite';
```

Replace `ENCOUNTERS` with a provisional list built only from the survivors (Task 14 rewrites it into the real ladder):

```ts
export const ENCOUNTERS: readonly Encounter[] = [
  { id: 'n1', tier: 'normal', minDepth: 1, maxDepth: 10, enemies: [e('mettik', 1, 1)] },
  { id: 'n2', tier: 'normal', minDepth: 1, maxDepth: 10, enemies: [e('canodron', 1, 1)] },
  { id: 'n3', tier: 'normal', minDepth: 1, maxDepth: 10, enemies: [e('mettik', 0, 2), e('canodron', 2, 0)] },
  { id: 'n4', tier: 'normal', minDepth: 1, maxDepth: 10, enemies: [e('bladdy', 1, 0)] },
  { id: 'n5', tier: 'normal', minDepth: 1, maxDepth: 10, enemies: [e('bladdy', 0, 0), e('mettik', 2, 1)] },
  { id: 'n6', tier: 'normal', minDepth: 1, maxDepth: 10, enemies: [e('canodron', 0, 0), e('canodron', 2, 0)] },
  { id: 'n7', tier: 'normal', minDepth: 1, maxDepth: 10, enemies: [e('mettik', 0, 1), e('mettik', 2, 1)] },
  { id: 'n8', tier: 'normal', minDepth: 1, maxDepth: 10, enemies: [e('bladdy', 1, 0), e('canodron', 0, 0)] },
  { id: 'e1', tier: 'elite', minDepth: 5, maxDepth: 5, enemies: [e('bladdy', 1, 0), e('mettik', 0, 2), e('canodron', 2, 0)] },
  { id: 'e2', tier: 'elite', minDepth: 8, maxDepth: 8, enemies: [e('bladdy', 0, 0), e('bladdy', 2, 0), e('canodron', 1, 0)] },
];
```

The eight normal encounters span every depth on purpose: the run has eight normal steps and picks unplayed encounters first, so a wide range is what keeps `tests/run.test.ts`'s "no repeats" assertion true. Task 14 narrows them into the real ladder.

In `src/app/run.ts`:

```ts
get complete(): boolean {
  return this.history.length >= RUN_STEPS && (this.history[RUN_STEPS - 1] as RunStep).won;
}

private tierAt(depth: number): EncounterTier {
  return ELITE_STEPS.includes(depth) ? 'elite' : 'normal';
}
```

and in `pick()` drop both boss guards — the fallback becomes:

```ts
let fits = fitsTier(tier);
if (fits.length === 0) fits = fitsTier(tier === 'elite' ? 'normal' : 'elite');
if (fits.length === 0) fits = ENCOUNTERS.filter((x) => x.minDepth <= this.depth && this.depth <= x.maxDepth);
```

Update the header comment of `run.ts` (it says "a boss at the end") and of `session.ts` line 13.

- [ ] **Step 6: Clean the view and the strings**

In `src/render/spriteArt.ts` remove the `monolith` import, its `ArtId` member, its `URLS` entry and its `ENEMY_ART` entry.

In `src/render/actors.ts` delete `BOSS_SIZE`, `BOSS_WIDTH` and the `boss` branch in `EnemyView`'s constructor:

```ts
constructor(enemy: Enemy) {
  const artId = ENEMY_ART[enemy.kind];
  const art = artId ? spriteArt(artId) : null;
  this.pixels = new PixelSprite(art ?? creature(ENEMY_SEEDS[enemy.kind], CREATURE_SIZE), 'red');
  this.sprite = this.pixels.sprite;
  this.widthShare = art ? ENEMY_ART_WIDTH : tuning.battleVisual.SPRITE_CELL_FRAC;
  this.phase = enemy.id * 1.7;
}
```

In `src/i18n/en.ts` delete `enemy.spiker`, `enemy.hopzap`, `enemy.rattik`, `enemy.helmhead`, `enemy.finnik`, `enemy.monolith` and `path.boss`.

In `src/terminal/crt/menuModel.ts` delete line 65 (`if (next.kind === 'boss') return t('path.boss');`).

- [ ] **Step 7: Fix the remaining tests**

`tests/enemies.test.ts` imports `HeatShot` and `Spiker` — delete those imports and every `describe` block that uses them. `tests/session.test.ts` and `tests/encounters.test.ts` may reference `'boss'` or `'e3'`/`'e4'`/`'n9'`+ ids; point them at ids that still exist.

- [ ] **Step 8: Run the whole suite and the build**

Run: `npm test`
Expected: PASS
Run: `npm run build`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
VS1: remove the six retired enemies and the boss tier

- delete Spiker, Hopzap, Rattik, Helmhead, Finnik and Monolith with
  their attack entities and the Monolith sprite
- EnemyKind is down to mettik, canodron and bladdy
- EncounterTier loses 'boss'; the run completes on the tenth won step
- provisional encounter list built from the survivors

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Cut the chip set to six survivors and rename FIELD → CONTROL

**Files:**
- Modify: `src/data/chips.ts`, `src/data/folders.ts`, `src/data/tutorial.ts`
- Modify: `src/sim/world.ts` (`applyFieldAction`, `resolveChip`, the `wave` case)
- Modify: `src/sim/chips/patterns.ts`, `src/sim/chips/aim.ts`
- Modify: `src/sim/player.ts` (drop `invisTicks`), `src/render/actors.ts`
- Modify: `src/config/tuning.ts` (drop `INVIS_TIME`, `PLAYER_WAVE_STEP`)
- Modify: `src/i18n/en.ts`, `src/terminal/chips/chipIcons.ts`
- Modify: `src/app/run.ts` (`StartFolder`), `src/debug/params.ts`, `src/terminal/crt/menuModel.ts`
- Test: `tests/chipUse.test.ts`, `tests/chips.test.ts`, `tests/chipAim.test.ts`, `tests/chipHand.test.ts`, `tests/randomFolder.test.ts`, `tests/tutorialScript.test.ts`

**Interfaces:**
- Consumes: Task 1's narrowed `EnemyKind`.
- Produces: `ChipId = 'cannon' | 'sword' | 'widesword' | 'minibomb' | 'areagrab' | 'panlgrab'`; `FolderId = 'basic' | 'control' | 'all'`; `StartFolder = 'basic' | 'control' | 'random'`; `Shape` without `'wave'`; `FieldAction = 'areaGrab' | 'grabPanel'`.

- [ ] **Step 1: Write the failing test**

Add to `tests/chips.test.ts`:

```ts
import { CHIPS } from '../src/data/chips';
import { FOLDERS, FOLDER_SIZE } from '../src/data/folders';

it('holds exactly the six surviving chips', () => {
  expect(Object.keys(CHIPS).sort()).toEqual(
    ['areagrab', 'cannon', 'minibomb', 'panlgrab', 'sword', 'widesword'],
  );
});

it('keeps both playable folders at the folder size', () => {
  for (const id of ['basic', 'control'] as const) {
    const total = FOLDERS[id].reduce((n, entry) => n + entry.count, 0);
    expect(total, id).toBe(FOLDER_SIZE);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/chips.test.ts`
Expected: FAIL — twenty-seven chip ids, and `FOLDERS.control` does not exist.

- [ ] **Step 3: Cut the chip catalogue**

Replace the `ChipId` union and the `CHIPS` record in `src/data/chips.ts`:

```ts
export type ChipId = 'cannon' | 'sword' | 'widesword' | 'minibomb' | 'areagrab' | 'panlgrab';

export type FieldAction = 'areaGrab' | 'grabPanel';

export type Shape =
  | { t: 'lane'; around?: readonly Offset[] }
  | { t: 'near'; cells: readonly Offset[] }
  | { t: 'lob'; depth: number; area: readonly Offset[] }
  | { t: 'self' };

export const CHIPS: Record<ChipId, ChipDef> = {
  cannon: { id: 'cannon', power: 40, kind: 'attack', useTime: 'CANNON', codes: ['A', 'B', 'C', 'D', 'E', '*'], rarity: 'common', shape: LANE },
  sword: { id: 'sword', power: 80, kind: 'attack', useTime: 'SWORD', codes: ['E', 'H', 'L', 'S', 'Y'], rarity: 'common', shape: { t: 'near', cells: AHEAD } },
  widesword: {
    id: 'widesword', power: 80, kind: 'attack', useTime: 'SWORD', codes: ['C', 'E', 'L', 'Q', 'Y'], rarity: 'uncommon',
    shape: { t: 'near', cells: [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }] },
  },
  minibomb: {
    id: 'minibomb', power: 50, kind: 'attack', useTime: 'BOMB', codes: ['B', 'G', 'L', 'O', 'S', '*'], rarity: 'common',
    shape: { t: 'lob', depth: 3, area: SPOT },
  },
  areagrab: { id: 'areagrab', ...FIELD_CHIP, codes: ['E', 'L', 'R', 'S', 'Y', '*'], rarity: 'uncommon', field: 'areaGrab' },
  panlgrab: { id: 'panlgrab', ...FIELD_CHIP, codes: ['A', 'H', 'L', 'S', 'Y', '*'], rarity: 'common', field: 'grabPanel' },
};
```

Delete the now-unused `RING` constant and the `invis?: true` member of `ChipDef`. `heal?: number` stays — Task 7 puts Recover back on it.

- [ ] **Step 4: Cut the code that served the deleted chips**

In `src/sim/chips/patterns.ts` nothing changes (it never handled `wave`).

In `src/sim/world.ts`:
- delete the `case 'wave':` branch of `resolveChip`, the `Shockwave` import used by it stays (Mettik needs it) but the `PLAYER_WAVE_STEP` reference goes;
- delete `if (def.invis) p.invisTicks = ...`;
- cut `applyFieldAction` to the two survivors:

```ts
/** Field chips (GDD §6.4). */
private applyFieldAction(action: FieldAction): void {
  const f = this.field;
  const free = (x: number, y: number) => this.occupancy.isFree(x, y);
  const p = this.player;
  switch (action) {
    case 'areaGrab': {
      const y = this.nearestEnemyRow();
      if (y < 0) return;
      for (let x = 0; x < COLS; x++) {
        if (f.owner(x, y) === 'enemy' && free(x, y)) f.setOwner(x, y, 'player', this.tick);
      }
      return;
    }
    case 'grabPanel':
      for (let y = p.y - 1; y >= 0; y--) {
        if (f.owner(p.x, y) !== 'enemy') continue;
        if (free(p.x, y)) f.setOwner(p.x, y, 'player', this.tick);
        return;
      }
      return;
  }
}
```

In `src/sim/chips/aim.ts` delete the `case 'wave'` branch and cut `fieldCells` to `areaGrab` / `grabPanel` / `undefined`. Delete the now-unused `hole` and `object` members of `AimLookup` and their two call sites in `World.aimPreview`.

In `src/sim/player.ts` delete `invisTicks` and its line in `updateTimers`. In `src/render/actors.ts` `PlayerView.update`, replace the dissolve line with:

```ts
this.pixels.setDissolve(player.alive ? 0 : 0.6);
```

In `src/config/tuning.ts` delete `INVIS_TIME` and `PLAYER_WAVE_STEP` from the `chips` group.

- [ ] **Step 5: Rebuild the folders**

Replace `src/data/folders.ts`'s `FolderId` and `FOLDERS`:

```ts
export type FolderId = 'basic' | 'control' | 'all';

export const FOLDERS: Record<FolderId, readonly FolderEntry[]> = {
  /** Pure action: guns, swords and bombs (spec §15). */
  basic: [
    { chip: 'cannon', code: 'A', count: 4 },
    { chip: 'cannon', code: 'B', count: 3 },
    { chip: 'sword', code: 'S', count: 4 },
    { chip: 'sword', code: 'L', count: 3 },
    { chip: 'widesword', code: 'L', count: 4 },
    { chip: 'widesword', code: 'C', count: 3 },
    { chip: 'minibomb', code: 'B', count: 5 },
    { chip: 'minibomb', code: 'L', count: 4 },
  ],
  /** Positioning and field manipulation (spec §15). */
  control: [
    { chip: 'cannon', code: 'A', count: 4 },
    { chip: 'cannon', code: 'B', count: 3 },
    { chip: 'sword', code: 'S', count: 3 },
    { chip: 'sword', code: 'L', count: 3 },
    { chip: 'widesword', code: 'L', count: 4 },
    { chip: 'minibomb', code: 'B', count: 4 },
    { chip: 'minibomb', code: 'L', count: 3 },
    { chip: 'areagrab', code: 'L', count: 3 },
    { chip: 'panlgrab', code: 'L', count: 3 },
  ],
  all: (Object.values(CHIPS) as ChipDef[]).map((d) => ({ chip: d.id, code: d.codes[0] as ChipCode, count: 1 })),
};
```

Both playable folders total 30. Task 5 and Task 7 rebalance them as Vulcan, WideShot, Barrier and Recover arrive.

In `src/app/run.ts`: `export type StartFolder = 'basic' | 'control' | 'random';`
In `src/debug/params.ts` line 47: `(['basic', 'control', 'all'] as const)`, and update the comment on line 2.
In `src/terminal/crt/menuModel.ts` line 81: `{ label: t('title.control'), action: 'start:control' },`
In `src/i18n/en.ts`: rename `title.field` to `title.control` with the value `'Control folder'`; delete the chip strings of the twenty removed chips.

In `src/app/randomFolder.ts` raise the copy cap so six chips can fill thirty cards:

```ts
export const RANDOM_MAX_COPIES = 6;
```

- [ ] **Step 6: Cut the chip icons and fix the tutorial**

In `src/terminal/chips/chipIcons.ts` delete every entry of `BASE_ICONS` whose chip is gone, keeping `cannon`, `sword`, `widesword`, `minibomb`, `areagrab`, `panlgrab`.

In `src/data/tutorial.ts` replace every `chip('shotgun', 'B')` with `chip('widesword', 'L')` — in step 2's `folder` and `hand`, and in step 4's `folder` and `hand`. Update `tests/tutorialScript.test.ts` accordingly.

- [ ] **Step 7: Fix the remaining chip tests**

`tests/chipUse.test.ts`, `tests/chipAim.test.ts` and `tests/chipHand.test.ts` exercise removed chips. Delete the blocks that use them and keep the ones that use the six survivors. `tests/randomFolder.test.ts` asserts the copy cap — update it to `RANDOM_MAX_COPIES`.

- [ ] **Step 8: Run the suite and the build**

Run: `npm test`
Expected: PASS
Run: `npm run build`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
VS2: cut the chip set to six and rename FIELD to CONTROL

- CHIPS holds only Cannon, Sword, WideSwrd, MiniBomb, AreaGrab, PanlGrab
- drop the wave shape, Invis and the field actions nothing uses any more
- BASIC and CONTROL folders, both 30 cards; title offers Control
- tutorial swaps ShotGun for WideSwrd

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Enemy phase profiles

**Files:**
- Create: `src/sim/enemies/profile.ts`
- Modify: `src/config/tuning.ts` (`mettik`, `canodron`, `bladdy` groups)
- Modify: `src/sim/enemies/enemyBase.ts`, `mettik.ts`, `canodron.ts`, `bladdy.ts`
- Modify: `src/debug/debugPanel.ts` (`RANGES`)
- Test: `tests/enemies.test.ts`, new `tests/enemyProfile.test.ts`

**Interfaces:**
- Consumes: Task 1's `EnemyKind`.
- Produces:
  - `EnemyProfile` with required `HP, DMG, KNOCKBACK, TELEGRAPH, COUNTER, ACTIVE, RECOVERY` and optional `MOVE_INTERVAL` plus free extra numeric keys;
  - `Enemy.p: EnemyProfile` (protected getter over `tuning[this.kind]`);
  - `Enemy.rawTicks(seconds: number): number` — like `ticks()` but without the minimum of 1;
  - `Enemy.counterPhase: CounterPhase` (protected, default `'telegraph'`);
  - `Enemy.counterOpen(tick: number): boolean` (public).

- [ ] **Step 1: Write the failing test**

Create `tests/enemyProfile.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { REQUIRED_PROFILE_KEYS } from '../src/sim/enemies/profile';
import { ENEMY_SEEDS } from '../src/data/enemies';

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

describe('enemy profiles', () => {
  it('gives every enemy kind a tuning group with the required phase keys', () => {
    for (const kind of Object.keys(ENEMY_SEEDS)) {
      const group = (tuning as unknown as Record<string, Record<string, number>>)[kind];
      expect(group, kind).toBeDefined();
      for (const key of REQUIRED_PROFILE_KEYS) {
        expect(typeof group[key], `${kind}.${key}`).toBe('number');
      }
    }
  });

  it('never leaves a recovery at zero (spec §14.3)', () => {
    for (const kind of Object.keys(ENEMY_SEEDS)) {
      const group = (tuning as unknown as Record<string, Record<string, number>>)[kind];
      expect(group.RECOVERY, kind).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/enemyProfile.test.ts`
Expected: FAIL — `src/sim/enemies/profile.ts` does not exist.

- [ ] **Step 3: Create the profile module**

Create `src/sim/enemies/profile.ts`:

```ts
// Uniform attack phases for every enemy (vertical slice spec §5.1).
// Each enemy owns a tuning group named exactly after its EnemyKind; these
// keys are the same in every group, so the debug panel and RANGES work for
// all enemies at once. `commit` is the end of TELEGRAPH and is not stored.

export const REQUIRED_PROFILE_KEYS = ['HP', 'DMG', 'KNOCKBACK', 'TELEGRAPH', 'COUNTER', 'ACTIVE', 'RECOVERY'] as const;

export type CounterPhase = 'telegraph' | 'active';

export interface EnemyProfile {
  HP: number;
  DMG: number;
  /** Rows the hit target is pushed; 0 = no knockback. */
  KNOCKBACK: number;
  /** Seconds from the start of the wind-up to commit. */
  TELEGRAPH: number;
  /** Tail of the counter window, in seconds; 0 disables Counter. */
  COUNTER: number;
  /** Seconds the hitbox lives. */
  ACTIVE: number;
  RECOVERY: number;
  MOVE_INTERVAL?: number;
  [key: string]: number | undefined;
}
```

- [ ] **Step 4: Rewrite the three tuning groups**

In `src/config/tuning.ts` replace the `mettik`, `canodron` and `bladdy` groups. Values carry over from the old keys one-to-one; `COUNTER` and `KNOCKBACK` are new and `[оценка]`.

```ts
mettik: {
  HP: 40,
  DMG: 10,
  KNOCKBACK: 0,
  MOVE_INTERVAL: 0.5,
  TELEGRAPH: 0.5,
  COUNTER: 0.25,
  ACTIVE: 0.2,
  RECOVERY: 1.5,
  WAVE_STEP: 0.25,
},
canodron: {
  HP: 60,
  DMG: 10,
  KNOCKBACK: 0,
  /** Seconds per panel of the aiming cursor. */
  CURSOR_STEP: 0.15,
  /** After the lock; this is the enemy's telegraph. */
  TELEGRAPH: 0.3,
  COUNTER: 0.15,
  ACTIVE: 0.2,
  RECOVERY: 2.0,
},
bladdy: {
  HP: 90,
  DMG: 30,
  KNOCKBACK: 0,
  MOVE_INTERVAL: 0.8,
  TELEGRAPH: 0.6,
  COUNTER: 0.3,
  ACTIVE: 0.25,
  RECOVERY: 1.5,
},
```

- [ ] **Step 5: Teach the base class the profile**

In `src/sim/enemies/enemyBase.ts` add the imports and the members:

```ts
import { tuning } from '../../config/tuning';
import type { CounterPhase, EnemyProfile } from './profile';
```

```ts
/** Phase timings of this enemy (vertical slice spec §5.1). */
protected get p(): EnemyProfile {
  // Every EnemyKind owns a tuning group of the same name (global constraints).
  return (tuning as unknown as Record<string, EnemyProfile>)[this.kind] as EnemyProfile;
}

/** Which phase holds the Counter window; Stovik opens its window in ATTACK. */
protected counterPhase: CounterPhase = 'telegraph';

/** Like `ticks()`, but a zero stays zero. */
protected rawTicks(seconds: number): number {
  return secondsToTicks(seconds / ENEMY_LEVELS[this.level].speed);
}

/** True while a chip hit would count as a Counter (spec §6). */
counterOpen(tick: number): boolean {
  const window = this.rawTicks(this.p.COUNTER);
  if (window <= 0 || !this.alive) return false;
  if (this.counterPhase === 'telegraph') {
    return this.state === 'TELEGRAPH' && this.elapsed(tick) >= this.ticks(this.p.TELEGRAPH) - window;
  }
  return this.state === 'ATTACK' && this.elapsed(tick) < window;
}
```

- [ ] **Step 6: Point the three enemies at the profile**

In `mettik.ts` replace every `m.MET_*` with `this.p.*`: `MOVE_INTERVAL`, `TELEGRAPH`, `DMG`, `WAVE_STEP`, `ACTIVE` (was `MET_ATTACK_TIME`), `RECOVERY`, and drop the `const m = tuning.mettik;` line and the `tuning` import if it becomes unused. Same shape for `canodron.ts` (`CURSOR_STEP`, `TELEGRAPH` for the old `CANO_FIRE_DELAY`, `ACTIVE`, `RECOVERY` for the old `CANO_COOLDOWN`) and `bladdy.ts` (`MOVE_INTERVAL`, `TELEGRAPH`, `DMG`, `ACTIVE`, `RECOVERY`).

The constructors take HP from the profile too:

```ts
constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
  super(id, x, y, tuning.mettik.HP, spawnTick, level);
}
```

- [ ] **Step 7: Give the profile keys debug ranges**

In `src/debug/debugPanel.ts` add to `RANGES`:

```ts
HP: [1, 600, 5],
DMG: [0, 100, 1],
KNOCKBACK: [0, 3, 1],
MOVE_INTERVAL: [0.05, 3, 0.05],
TELEGRAPH: [0.05, 3, 0.05],
COUNTER: [0, 1.5, 0.05],
ACTIVE: [0.05, 4, 0.05],
RECOVERY: [0, 4, 0.05],
```

- [ ] **Step 8: Fix `tests/enemies.test.ts`**

Every `tuning.mettik.MET_TELEGRAPH`-style reference becomes `tuning.mettik.TELEGRAPH`, and the same for `canodron` and `bladdy`.

- [ ] **Step 9: Run the suite and the build**

Run: `npm test`
Expected: PASS
Run: `npm run build`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
VS3: uniform attack phase profiles for enemies

- every enemy tuning group is named after its kind and carries the same
  phase keys: HP, DMG, KNOCKBACK, TELEGRAPH, COUNTER, ACTIVE, RECOVERY
- Enemy gains p, rawTicks, counterPhase and counterOpen
- Mettik, Canodron and Bladdy read their timings from the profile
- one debug range per phase key now covers every enemy

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Counter system

**Files:**
- Modify: `src/config/tuning.ts` (new `counter` group)
- Modify: `src/sim/player.ts` (`syncTicks`)
- Modify: `src/sim/enemies/enemyBase.ts` (`onCountered`)
- Modify: `src/sim/enemies/canodron.ts` (cursor reset on counter)
- Modify: `src/sim/events.ts`, `src/sim/world.ts`
- Modify: `src/render/scene.ts` (the `countered` event)
- Modify: `docs/superpowers/specs/2026-09-20-vertical-slice-design.md` (§6 wording)
- Test: new `tests/counter.test.ts`

**Interfaces:**
- Consumes: `Enemy.counterOpen(tick)` from Task 3.
- Produces:
  - `type DamageSource = 'chip' | 'other'`;
  - `World.damageEnemy(enemy: Enemy, amount: number, source?: DamageSource): void`;
  - `Player.syncTicks: number`;
  - `Enemy.onCountered(ctx: EnemyContext): void`;
  - `SimEvent` variant `{ type: 'countered'; id: EntityId; x: number; y: number }`.

- [ ] **Step 1: Write the failing test**

Create `tests/counter.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { createEnemy } from '../src/sim/enemies/factory';
import type { Enemy } from '../src/sim/enemies/enemyBase';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

let nextId = 700;

/** A world holding exactly one enemy of `kind` at (x, y). */
function arena(kind: 'mettik' | 'canodron' | 'bladdy', x: number, y: number): { w: World; e: Enemy } {
  const w = new World({ seed: 5, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: true } });
  for (const old of w.enemies) w.occupancy.remove(old.id, old.x, old.y);
  w.enemies = [];
  w.chips.attack = [];
  const e = createEnemy({ kind, x, y }, nextId++, w.tick);
  w.occupancy.place(e.id, x, y);
  w.enemies.push(e);
  return { w, e };
}

const step = (w: World) => w.step(DT, { commands: [], held: null });

/** Runs until the enemy is inside its counter window; fails if it never opens. */
function untilCounterOpen(w: World, e: Enemy): void {
  for (let i = 0; i < T(10); i++) {
    if (e.counterOpen(w.tick)) return;
    step(w);
  }
  expect(e.counterOpen(w.tick), 'counter window never opened').toBe(true);
}

describe('Counter', () => {
  it('cancels the attack, paralyzes the enemy and grants full synchro', () => {
    const { w, e } = arena('mettik', 1, 1);
    untilCounterOpen(w, e);
    w.drainEvents();
    w.damageEnemy(e, 10, 'chip');
    const kinds = w.drainEvents().map((ev) => ev.type);
    expect(kinds).toContain('countered');
    expect(e.state).toBe('RECOVERY');
    expect(e.paralyzeTicks).toBe(T(tuning.counter.PARALYZE));
    expect(w.player.syncTicks).toBe(T(tuning.counter.SYNC_TIME));
    expect(w.attacks.length).toBe(0);
  });

  it('does not trigger outside the window', () => {
    const { w, e } = arena('mettik', 1, 1);
    expect(e.counterOpen(w.tick)).toBe(false);
    w.drainEvents();
    w.damageEnemy(e, 10, 'chip');
    expect(w.drainEvents().map((ev) => ev.type)).not.toContain('countered');
    expect(w.player.syncTicks).toBe(0);
  });

  it('ignores damage that did not come from a chip', () => {
    const { w, e } = arena('mettik', 1, 1);
    untilCounterOpen(w, e);
    w.drainEvents();
    w.damageEnemy(e, 10, 'other');
    expect(w.drainEvents().map((ev) => ev.type)).not.toContain('countered');
  });

  it('does not count against a guarded enemy', () => {
    const { w, e } = arena('mettik', 1, 1);
    untilCounterOpen(w, e);
    e.guarded = true;
    w.drainEvents();
    w.damageEnemy(e, 10, 'chip');
    expect(w.drainEvents().map((ev) => ev.type)).not.toContain('countered');
    expect(w.player.syncTicks).toBe(0);
  });

  it('burns synchro when the player is hit', () => {
    const { w, e } = arena('mettik', 1, 1);
    untilCounterOpen(w, e);
    w.damageEnemy(e, 10, 'chip');
    expect(w.player.syncTicks).toBeGreaterThan(0);
    w.player.takeHit(10, w.tick);
    expect(w.player.syncTicks).toBe(0);
  });

  it('runs synchro down on its own', () => {
    const { w, e } = arena('mettik', 1, 1);
    untilCounterOpen(w, e);
    w.damageEnemy(e, 10, 'chip');
    for (let i = 0; i < T(tuning.counter.SYNC_TIME) + 1; i++) step(w);
    expect(w.player.syncTicks).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/counter.test.ts`
Expected: FAIL — `tuning.counter` is undefined and `damageEnemy` takes two arguments.

- [ ] **Step 3: Add the tuning group and the player state**

In `src/config/tuning.ts`, after the `chips` group:

```ts
/** Counter (vertical slice spec §6). */
counter: {
  /** How long a countered enemy stands still, seconds. */
  PARALYZE: 1.5,
  /** How long full synchro waits for the next attack chip, seconds. */
  SYNC_TIME: 5.0,
  /** Damage multiplier of that chip. */
  DAMAGE_MULT: 2,
},
```

and in `RANGES` (`src/debug/debugPanel.ts`):

```ts
PARALYZE: [0, 4, 0.05],
SYNC_TIME: [0, 15, 0.5],
DAMAGE_MULT: [1, 5, 0.5],
```

In `src/sim/player.ts` add the field, its countdown and its burn on a hit:

```ts
/** Remaining ticks of full synchro: the next attack chip deals extra damage (spec §6). */
syncTicks = 0;
```

in `updateTimers`: `if (this.syncTicks > 0) this.syncTicks--;`
in `takeHit`, alongside the other resets: `this.syncTicks = 0;`

- [ ] **Step 4: Add the event and the enemy hook**

In `src/sim/events.ts`:

```ts
/** A chip landed inside an enemy's counter window (spec §6). */
| { type: 'countered'; id: EntityId; x: number; y: number }
```

In `src/sim/enemies/enemyBase.ts`:

```ts
/**
 * A Counter landed (spec §6): the attack is cancelled and the enemy is
 * stunned. Enemies holding extra attack state override this and clear it.
 */
onCountered(ctx: EnemyContext): void {
  this.setState('RECOVERY', ctx.tick);
}
```

In `src/sim/enemies/canodron.ts` override it so the aiming cursor does not survive the counter:

```ts
override onCountered(ctx: EnemyContext): void {
  this.cursorY = -1;
  this.locked = false;
  super.onCountered(ctx);
}
```

- [ ] **Step 5: Wire it into the world**

In `src/sim/world.ts` add the source type and rewrite `damageEnemy`:

```ts
/** Where damage to an enemy came from; only chips can Counter (spec §6). */
export type DamageSource = 'chip' | 'other';
```

```ts
damageEnemy(enemy: Enemy, amount: number, source: DamageSource = 'other'): void {
  if (!enemy.alive) return;
  if (enemy.guarded) {
    this.events.push({ type: 'guarded', id: enemy.id, x: enemy.x, y: enemy.y });
    return;
  }
  const countered = source === 'chip' && enemy.counterOpen(this.tick);
  const died = enemy.applyDamage(amount, this.tick);
  this.events.push({ type: 'damaged', targetId: enemy.id, amount, x: enemy.x, y: enemy.y, hpLeft: enemy.hp });
  if (countered && !died) {
    enemy.onCountered(this);
    enemy.paralyze(secondsToTicks(tuning.counter.PARALYZE));
    this.player.syncTicks = secondsToTicks(tuning.counter.SYNC_TIME);
    this.events.push({ type: 'countered', id: enemy.id, x: enemy.x, y: enemy.y });
  }
  if (died) {
    this.events.push({ type: 'enemyKilled', id: enemy.id, x: enemy.x, y: enemy.y });
    if (this.mettikTurnId === enemy.id) this.passTurn(enemy);
  }
}
```

Pass `'chip'` from every player path: `hitEnemyAt` gains the same optional parameter and forwards it, and `damageCells` / `hitCells` call `this.damageEnemy(e, damage, 'chip')`.

Spend the synchro in `beginChip`, so multi-hit chips get one consistent multiplier:

```ts
private beginChip(chip: ChipInstance): void {
  const p = this.player;
  const active = startChip(chip, this.tick);
  if (active.def.kind === 'attack' && p.syncTicks > 0) {
    active.mult = tuning.counter.DAMAGE_MULT;
    p.syncTicks = 0;
  }
  this.activeChip = active;
  p.actionTicks = active.endTick - active.startTick;
  this.chipsUsed++;
  this.events.push({ type: 'chipUsed', defId: chip.defId, x: p.x, y: p.y });
}
```

`ActiveChip` gains `mult: number` (default 1) in `src/sim/chips/executor.ts`, and `resolveChip` uses `const power = (def.power ?? 0) * a.mult;`.

- [ ] **Step 6: Show it on the CRT**

In `src/render/scene.ts`, next to the existing `guarded` handling:

```ts
else if (e.type === 'countered') this.field.markAttack([{ x: e.x, y: e.y }], tick, 'accent');
```

- [ ] **Step 7: Clarify the spec**

In `docs/superpowers/specs/2026-09-20-vertical-slice-design.md` §6, replace "Синхро сгорает при использовании чипа, по истечении таймера или при попадании по игроку." with:

> Синхро сгорает при использовании **атакующего** чипа, по истечении таймера или при попадании по игроку. Чипы поддержки и поля его не тратят.

- [ ] **Step 8: Run the suite and the build**

Run: `npm test`
Expected: PASS
Run: `npm run build`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
VS4: Counter

- a chip that damages an enemy inside its counter window cancels the
  attack, paralyzes the enemy and grants full synchro
- full synchro doubles the next attack chip and burns on use, on a hit
  or on its timer
- new countered event, flashed on the CRT
- damageEnemy and hitEnemyAt carry a damage source

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Chip timing classes, multi-hit and Vulcan

**Files:**
- Modify: `src/data/chips.ts` (`TimingClass`, `hits`, drop `UseTimeGroup`)
- Modify: `src/config/tuning.ts` (`chipTiming` group, drop `CHIP_USE_TIME_*` and `CHIP_HIT_FRAME`)
- Modify: `src/sim/chips/executor.ts`, `src/sim/world.ts`
- Modify: `src/data/folders.ts`, `src/i18n/en.ts`, `src/terminal/chips/chipIcons.ts`
- Modify: `src/debug/debugPanel.ts`
- Test: new `tests/chipTiming.test.ts`, modify `tests/chipUse.test.ts`

**Interfaces:**
- Consumes: `ActiveChip.mult` from Task 4.
- Produces:
  - `type TimingClass = 'FAST' | 'MEDIUM' | 'SLOW'`;
  - `ChipDef.timing: TimingClass`, `ChipDef.hits?: number` (default 1);
  - `chipTicks(def: ChipDef): { hitTicks: number[]; total: number }`;
  - `ActiveChip { chip, def, startTick, hitTicks: number[], hitsDone: number, endTick, mult }`;
  - chip id `'vulcan'`.

- [ ] **Step 1: Write the failing test**

Create `tests/chipTiming.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { CHIPS } from '../src/data/chips';
import { chipTicks } from '../src/sim/chips/executor';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

describe('chip timing classes', () => {
  it('keeps the hierarchy Vulcan < Sword < Cannon by startup (spec §7)', () => {
    const startup = (id: 'vulcan' | 'sword' | 'cannon') => chipTicks(CHIPS[id]).hitTicks[0] as number;
    expect(startup('vulcan')).toBeLessThan(startup('sword'));
    expect(startup('sword')).toBeLessThan(startup('cannon'));
  });

  it('gives Vulcan three hit frames and the others one', () => {
    expect(chipTicks(CHIPS.vulcan).hitTicks.length).toBe(3);
    expect(chipTicks(CHIPS.cannon).hitTicks.length).toBe(1);
  });

  it('locks the player for the whole chip', () => {
    const w = new World({ seed: 1, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: false } });
    w.chips.attack = [];
    w.giveChip({ uid: 9001, defId: 'cannon', code: '*', state: 'hand', deal: 1 });
    w.step(DT, { commands: [{ type: 'useChip' }], held: null });
    expect(w.player.actionTicks).toBe(chipTicks(CHIPS.cannon).total - 1);
  });
});

describe('Vulcan', () => {
  it('hits the same enemy three times', () => {
    const w = new World({ seed: 1, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: false } });
    w.chips.attack = [];
    const enemy = w.enemies[0]!;
    const before = enemy.hp;
    while (w.player.x !== enemy.x) {
      w.step(DT, { commands: [{ type: 'move', dir: enemy.x < w.player.x ? 'left' : 'right' }], held: null });
      for (let i = 0; i < T(tuning.player.MOVE_COOLDOWN); i++) w.step(DT, { commands: [], held: null });
    }
    w.giveChip({ uid: 9002, defId: 'vulcan', code: '*', state: 'hand', deal: 1 });
    w.step(DT, { commands: [{ type: 'useChip' }], held: null });
    for (let i = 0; i < chipTicks(CHIPS.vulcan).total + 2; i++) w.step(DT, { commands: [], held: null });
    expect(before - enemy.hp).toBe((CHIPS.vulcan.power as number) * 3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/chipTiming.test.ts`
Expected: FAIL — `chipTicks` is not exported and `CHIPS.vulcan` does not exist.

- [ ] **Step 3: Replace the tuning keys**

In `src/config/tuning.ts`, inside the `chips` group delete `CHIP_USE_TIME_CANNON`, `CHIP_USE_TIME_SWORD`, `CHIP_USE_TIME_BOMB`, `CHIP_USE_TIME_RECOVER`, `CHIP_USE_TIME_FIELD` and `CHIP_HIT_FRAME`. Add a new top-level group:

```ts
/** Chip timing classes (vertical slice spec §5.2); all values [оценка]. */
chipTiming: {
  FAST_STARTUP: 0.06,
  /** Seconds between the hits of a multi-hit FAST chip. */
  FAST_HIT_STEP: 0.05,
  FAST_RECOVERY: 0.18,
  MEDIUM_STARTUP: 0.15,
  MEDIUM_RECOVERY: 0.3,
  SLOW_STARTUP: 0.3,
  SLOW_RECOVERY: 0.45,
},
```

In `RANGES` add: `FAST_STARTUP: [0.01, 1, 0.01]`, `FAST_HIT_STEP: [0.01, 0.5, 0.01]`, `FAST_RECOVERY: [0.01, 1.5, 0.01]`, `MEDIUM_STARTUP: [0.01, 1, 0.01]`, `MEDIUM_RECOVERY: [0.01, 1.5, 0.01]`, `SLOW_STARTUP: [0.01, 1.5, 0.01]`, `SLOW_RECOVERY: [0.01, 2, 0.01]`.

- [ ] **Step 4: Put the class on the chip**

In `src/data/chips.ts` replace `UseTimeGroup` with:

```ts
/** Timing class (vertical slice spec §5.2, §7). */
export type TimingClass = 'FAST' | 'MEDIUM' | 'SLOW';
```

In `ChipDef` replace `useTime: UseTimeGroup` with `timing: TimingClass` and add `/** Hit frames; 1 when omitted. */ hits?: number;`.

Update `FIELD_CHIP` to `{ power: null, kind: 'field', timing: 'MEDIUM', shape: { t: 'self' } } as const`, then set: `cannon` and `minibomb` to `timing: 'SLOW'`, `sword` and `widesword` to `timing: 'MEDIUM'`. Add Vulcan:

```ts
vulcan: {
  id: 'vulcan', power: 10, kind: 'attack', timing: 'FAST', hits: 3,
  codes: ['A', 'C', 'D', 'V', '*'], rarity: 'common', shape: LANE,
},
```

and add `'vulcan'` to the `ChipId` union.

- [ ] **Step 5: Rewrite the executor**

Replace `src/sim/chips/executor.ts`:

```ts
import { secondsToTicks, tuning } from '../../config/tuning';
import { CHIPS, type ChipDef } from '../../data/chips';
import type { ChipInstance } from './chipSystem';

// Chip use timing (vertical slice spec §5.2): the player is locked from the
// first frame to the end; the effect resolves once per hit frame.
//
//   startTick ─ startup ─→ hit[0] ─ hitStep ─→ hit[n] ─ recovery ─→ endTick

export interface ActiveChip {
  readonly chip: ChipInstance;
  readonly def: ChipDef;
  readonly startTick: number;
  readonly hitTicks: number[];
  readonly endTick: number;
  /** Hit frames already resolved. */
  hitsDone: number;
  /** Damage multiplier from full synchro (spec §6). */
  mult: number;
}

/** Hit frames and total length of a chip, relative to its first tick. */
export function chipTicks(def: ChipDef): { hitTicks: number[]; total: number } {
  // Only FAST declares a HIT_STEP, so the group is read through an index type.
  const t = tuning.chipTiming as unknown as Record<string, number>;
  const startup = secondsToTicks(t[`${def.timing}_STARTUP`] as number);
  const recovery = secondsToTicks(t[`${def.timing}_RECOVERY`] as number);
  const hits = Math.max(1, def.hits ?? 1);
  const step = hits > 1 ? Math.max(1, secondsToTicks(t[`${def.timing}_HIT_STEP`] as number)) : 0;
  const hitTicks = Array.from({ length: hits }, (_, i) => startup + i * step);
  const last = hitTicks[hits - 1] as number;
  return { hitTicks, total: Math.max(1, last + recovery) };
}

export function startChip(chip: ChipInstance, tick: number): ActiveChip {
  const def = CHIPS[chip.defId];
  const { hitTicks, total } = chipTicks(def);
  return {
    chip,
    def,
    startTick: tick,
    hitTicks: hitTicks.map((h) => tick + h),
    endTick: tick + total,
    hitsDone: 0,
    mult: 1,
  };
}
```

A chip whose class has no `HIT_STEP` key must declare `hits: 1` (or omit `hits`), or the lookup yields `undefined`. Only Vulcan is multi-hit, and it is FAST.

- [ ] **Step 6: Drive the hit frames from the world**

In `src/sim/world.ts` replace `updateActiveChip`:

```ts
private updateActiveChip(): void {
  const a = this.activeChip;
  if (!a) return;
  while (a.hitsDone < a.hitTicks.length && this.tick >= (a.hitTicks[a.hitsDone] as number)) {
    a.hitsDone++;
    this.resolveChip(a);
  }
  if (this.tick >= a.endTick) this.activeChip = null;
}
```

In `hitPlayerAt`, the interruption check used `a.resolved`; it becomes "nothing has landed yet":

```ts
if (this.activeChip) {
  if (this.activeChip.hitsDone === 0) this.events.push({ type: 'chipInterrupted', defId: this.activeChip.def.id });
  this.activeChip = null;
}
```

- [ ] **Step 7: Put Vulcan in the folders and the UI**

In `src/data/folders.ts` make room for Vulcan in both folders — drop two `cannon` copies and two `minibomb` copies from `basic`, and two `cannon` copies and two `minibomb` copies from `control`, then add `{ chip: 'vulcan', code: 'A', count: 4 }` to each. Re-check that both still total 30.

In `src/i18n/en.ts`:

```ts
'chip.vulcan.name': 'Vulcan',
'chip.vulcan.desc': 'Three fast shots at the first enemy in your lane.',
```

In `src/terminal/chips/chipIcons.ts` add a 16×16 `vulcan` icon. Use the `cannon` icon as the base and give it a triple muzzle so it reads as a different weapon at rail size:

```ts
vulcan: [
  '................',
  '....kkk..kkk....',
  '....kck..kck....',
  '....kbk..kbk....',
  '....kbk..kbk....',
  '....kbkkkkbk....',
  '....kbbbbbbk....',
  '...kkbbbbbbkk...',
  '...kggbbbbggk...',
  '..kggggggggggk..',
  '..kgddggggddgk..',
  '..kgddggggddgk..',
  '..kggggggggggk..',
  '...kkkkkkkkkk...',
  '...kdk....kdk...',
  '...kkk....kkk...',
],
```

- [ ] **Step 8: Fix `tests/chipUse.test.ts`**

Replace every `tuning.chips.CHIP_USE_TIME_*` and `CHIP_HIT_FRAME` expectation with `chipTicks(CHIPS[id])`.

- [ ] **Step 9: Run the suite and the build**

Run: `npm test`
Expected: PASS
Run: `npm run build`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
VS5: chip timing classes, multi-hit and Vulcan

- chips declare a timing class (FAST/MEDIUM/SLOW) instead of a use-time
  group; three knobs per class replace the per-group times and the
  global hit frame
- ActiveChip carries a list of hit frames, so a chip can hit repeatedly
- Vulcan: three fast shots down the lane

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: WideShot and the travelling player shot

**Files:**
- Create: `src/sim/attacks/playerShot.ts`
- Modify: `src/data/chips.ts` (the `shot` shape, WideShot), `src/config/tuning.ts`
- Modify: `src/sim/world.ts` (`resolveChip`), `src/sim/chips/aim.ts`
- Modify: `src/data/folders.ts`, `src/i18n/en.ts`, `src/terminal/chips/chipIcons.ts`
- Test: new `tests/playerShot.test.ts`

**Interfaces:**
- Consumes: `ActiveChip.mult` (Task 4), `chipTicks` (Task 5).
- Produces:
  - `Shape` variant `{ t: 'shot'; width: number }`;
  - `class PlayerShot implements LaneMover` with `new PlayerShot(id, x, y, spawnTick, { damage, stepTicks, width })`;
  - chip id `'wideshot'`.

- [ ] **Step 1: Write the failing test**

Create `tests/playerShot.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { CHIPS } from '../src/data/chips';
import { chipTicks } from '../src/sim/chips/executor';
import { createEnemy } from '../src/sim/enemies/factory';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

/** A world with one Mettik in lane `x`, the player left where it starts. */
function arena(x: number): World {
  const w = new World({ seed: 4, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: false } });
  for (const old of w.enemies) w.occupancy.remove(old.id, old.x, old.y);
  w.enemies = [];
  w.chips.attack = [];
  const e = createEnemy({ kind: 'mettik', x, y: 1 }, 800 + x, w.tick);
  w.occupancy.place(e.id, x, 1);
  w.enemies.push(e);
  return w;
}

const idle = (w: World, n: number) => {
  for (let i = 0; i < n; i++) w.step(DT, { commands: [], held: null });
};

describe('WideShot', () => {
  it('hits an enemy one lane to the side of the player', () => {
    const w = arena(2); // player starts at x = 1
    const enemy = w.enemies[0]!;
    const before = enemy.hp;
    w.giveChip({ uid: 9101, defId: 'wideshot', code: '*', state: 'hand', deal: 1 });
    w.step(DT, { commands: [{ type: 'useChip' }], held: null });
    idle(w, chipTicks(CHIPS.wideshot).total + T(1));
    expect(before - enemy.hp).toBe(CHIPS.wideshot.power as number);
  });

  it('hits each enemy once as it travels', () => {
    const w = arena(1);
    const enemy = w.enemies[0]!;
    const before = enemy.hp;
    w.giveChip({ uid: 9102, defId: 'wideshot', code: '*', state: 'hand', deal: 1 });
    w.step(DT, { commands: [{ type: 'useChip' }], held: null });
    idle(w, chipTicks(CHIPS.wideshot).total + T(2));
    expect(before - enemy.hp).toBe(CHIPS.wideshot.power as number);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/playerShot.test.ts`
Expected: FAIL — `CHIPS.wideshot` does not exist.

- [ ] **Step 3: Create the attack entity**

Create `src/sim/attacks/playerShot.ts`:

```ts
import { COLS, ROWS } from '../grid';
import type { AttackContext } from './attack';
import type { LaneMover } from './shockwave';

// Player projectile (vertical slice spec §9): travels up the player's lane one
// panel per step, covers `width` panels across, damages each target once and
// keeps going. Flies over holes and dies at the far edge.

export interface PlayerShotOptions {
  damage: number;
  stepTicks: number;
  /** Panels across, centred on the lane; 3 = one to each side. */
  width: number;
}

export class PlayerShot implements LaneMover {
  readonly kind = 'playerShot';
  readonly hitIds = new Set<number>();
  done = false;
  lastStepTick: number;
  readonly stepTicks: number;
  readonly dir = -1 as const;
  readonly width: number;
  private readonly damage: number;

  constructor(
    readonly id: number,
    readonly x: number,
    public y: number,
    spawnTick: number,
    opts: PlayerShotOptions,
  ) {
    this.lastStepTick = spawnTick;
    this.stepTicks = Math.max(1, opts.stepTicks);
    this.damage = opts.damage;
    this.width = Math.max(1, opts.width);
  }

  /** Lanes the shot covers on its current row. */
  lanes(): number[] {
    const half = Math.floor(this.width / 2);
    const out: number[] = [];
    for (let x = this.x - half; x <= this.x + half; x++) if (x >= 0 && x < COLS) out.push(x);
    return out;
  }

  update(ctx: AttackContext): void {
    if (this.done) return;
    if (ctx.tick - this.lastStepTick >= this.stepTicks) {
      this.y += this.dir;
      this.lastStepTick = ctx.tick;
      if (this.y < 0) {
        this.done = true;
        return;
      }
    }
    for (const x of this.lanes()) {
      ctx.hitObjectAt(this, x, this.y, this.damage);
      ctx.hitEnemyAt(this, x, this.y, this.damage, 'chip');
    }
  }
}
```

- [ ] **Step 4: Add the shape, the chip and the tunable**

In `src/data/chips.ts` add to `Shape`:

```ts
/** Travelling shot up the lane, `width` panels across. */
| { t: 'shot'; width: number }
```

and the chip (add `'wideshot'` to `ChipId`):

```ts
wideshot: {
  id: 'wideshot', power: 60, kind: 'attack', timing: 'MEDIUM',
  codes: ['B', 'C', 'L', 'S', '*'], rarity: 'common', shape: { t: 'shot', width: 3 },
},
```

In `src/config/tuning.ts`, in the `chips` group: `/** Player shot: seconds per panel. */ SHOT_STEP: 0.08,` and in `RANGES`: `SHOT_STEP: [0.02, 0.5, 0.01]`.

- [ ] **Step 5: Resolve it in the world**

In `src/sim/world.ts` `resolveChip`, add the case:

```ts
case 'shot': {
  this.spawnAttack(
    new PlayerShot(this.attackIdCounter++, p.x, p.y, this.tick, {
      damage: power,
      stepTicks: secondsToTicks(tuning.chips.SHOT_STEP),
      width: shape.width,
    }),
  );
  effect([]);
  break;
}
```

`hitEnemyAt` gains the source parameter it already needs from Task 4:

```ts
hitEnemyAt(attack: Attack, x: number, y: number, damage: number, source: DamageSource = 'other'): boolean {
```

and the `AttackContext` interface in `src/sim/attacks/attack.ts` mirrors that signature.

- [ ] **Step 6: Preview it in the aim**

In `src/sim/chips/aim.ts` add:

```ts
case 'shot': {
  const half = Math.floor(shape.width / 2);
  const cells: Cell[] = [];
  for (let y = l.py - 1; y >= 0; y--) {
    for (let x = l.px - half; x <= l.px + half; x++) if (x >= 0 && x < COLS) cells.push({ x, y });
  }
  return { cells, beam: null };
}
```

- [ ] **Step 7: Put it in the folders and the UI**

Give WideShot three copies in each folder, taking them from MiniBomb, and keep both at 30.

In `src/i18n/en.ts`:

```ts
'chip.wideshot.name': 'WideShot',
'chip.wideshot.desc': 'A wide shot that sweeps three lanes ahead of you.',
```

In `src/terminal/chips/chipIcons.ts` add a `wideshot` icon — a broad wave front, distinct from the cannon barrel:

```ts
wideshot: [
  '................',
  '................',
  '..c..........c..',
  '.ccc........ccc.',
  'ccccc......ccccc',
  '.ccc..cccc..ccc.',
  '..c..cccccc..c..',
  '....cccccccc....',
  '....cccccccc....',
  '..c..cccccc..c..',
  '.ccc..cccc..ccc.',
  'ccccc......ccccc',
  '.ccc........ccc.',
  '..c..........c..',
  '................',
  '................',
],
```

- [ ] **Step 8: Run the suite and the build**

Run: `npm test`
Expected: PASS
Run: `npm run build`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
VS6: WideShot and the travelling player shot

- new shot shape and PlayerShot attack entity: flies up the lane, covers
  three lanes across and damages every target once
- WideShot chip, its icon, strings and folder slots
- hitEnemyAt carries the damage source so a travelling shot can Counter

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Barrier and Recover

**Files:**
- Modify: `src/sim/player.ts` (`barrierHp`), `src/sim/world.ts` (`hitPlayerAt`, `resolveChip`)
- Modify: `src/data/chips.ts`, `src/config/tuning.ts`, `src/sim/events.ts`
- Modify: `src/data/folders.ts`, `src/i18n/en.ts`, `src/terminal/chips/chipIcons.ts`
- Modify: `src/terminal/crt/hudModel.ts` (barrier readout)
- Test: new `tests/barrier.test.ts`

**Interfaces:**
- Consumes: the chip pipeline from Tasks 5–6.
- Produces:
  - `Player.barrierHp: number`;
  - `ChipDef.barrier?: number`;
  - chip ids `'barrier'` and `'recover'`;
  - `SimEvent` variant `{ type: 'barrierHit'; absorbed: number; left: number; x: number; y: number }`.

- [ ] **Step 1: Write the failing test**

Create `tests/barrier.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { CHIPS } from '../src/data/chips';
import { chipTicks } from '../src/sim/chips/executor';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(): World {
  const w = new World({ seed: 2, battleIndex: 1, skipIntro: true, cheats: { god: false, aiEnabled: false } });
  w.chips.attack = [];
  return w;
}

const idle = (w: World, n: number) => {
  for (let i = 0; i < n; i++) w.step(DT, { commands: [], held: null });
};

describe('Barrier', () => {
  it('absorbs damage without flinch or i-frames', () => {
    const w = world();
    w.player.barrierHp = 40;
    const attack = { id: -9, kind: 'test', hitIds: new Set<number>(), done: true, update: () => undefined };
    w.hitPlayerAt(attack, w.player.x, w.player.y, 30);
    expect(w.player.hp).toBe(100);
    expect(w.player.barrierHp).toBe(10);
    expect(w.player.flinched).toBe(false);
    expect(w.player.invulnerable).toBe(false);
  });

  it('lets the overflow through', () => {
    const w = world();
    w.player.barrierHp = 10;
    const attack = { id: -8, kind: 'test', hitIds: new Set<number>(), done: true, update: () => undefined };
    w.hitPlayerAt(attack, w.player.x, w.player.y, 30);
    expect(w.player.barrierHp).toBe(0);
    expect(w.player.hp).toBe(80);
    expect(w.player.flinched).toBe(true);
  });

  it('is raised by the Barrier chip', () => {
    const w = world();
    w.giveChip({ uid: 9201, defId: 'barrier', code: '*', state: 'hand', deal: 1 });
    w.step(DT, { commands: [{ type: 'useChip' }], held: null });
    idle(w, chipTicks(CHIPS.barrier).total + 1);
    expect(w.player.barrierHp).toBe(tuning.chips.BARRIER_HP);
  });
});

describe('Recover', () => {
  it('heals by the chip amount and never past max', () => {
    const w = world();
    w.player.hp = 70;
    w.giveChip({ uid: 9202, defId: 'recover', code: '*', state: 'hand', deal: 1 });
    w.step(DT, { commands: [{ type: 'useChip' }], held: null });
    idle(w, chipTicks(CHIPS.recover).total + 1);
    expect(w.player.hp).toBe(Math.min(w.player.maxHp, 70 + (CHIPS.recover.heal as number)));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/barrier.test.ts`
Expected: FAIL — `barrierHp` and the two chips do not exist.

- [ ] **Step 3: Add the player state and the absorb rule**

In `src/sim/player.ts`:

```ts
/** Damage the Barrier chip still absorbs (spec §7.3). */
barrierHp = 0;
```

In `src/sim/world.ts` replace the whole body of `hitPlayerAt` with:

```ts
hitPlayerAt(attack: Attack, x: number, y: number, damage: number): boolean {
  const p = this.player;
  if (p.x !== x || p.y !== y || !p.alive) return false;
  if (attack.hitIds.has(p.id)) return false;
  // Hits on an invulnerable player are ignored entirely (GDD §9).
  if (p.invulnerable) return false;
  attack.hitIds.add(p.id);
  let amount = this.cheats.god ? 0 : damage;
  // Tutorial: the hit lands and shows, but never kills (tutorial spec §4.3).
  if (this.cheats.noKo) amount = Math.min(amount, Math.max(0, p.hp - 1));
  // Barrier eats the hit without flinch or i-frames (vertical slice spec §7.3).
  if (p.barrierHp > 0 && amount > 0) {
    const absorbed = Math.min(p.barrierHp, amount);
    p.barrierHp -= absorbed;
    amount -= absorbed;
    this.events.push({ type: 'barrierHit', absorbed, left: p.barrierHp, x, y });
    if (amount === 0) return true;
  }
  p.takeHit(amount, this.tick);
  this.events.push({ type: 'damaged', targetId: p.id, amount, x, y, hpLeft: p.hp });
  // A hit interrupts the chip; if nothing had landed yet, it is lost (GDD §6.5).
  if (this.activeChip) {
    if (this.activeChip.hitsDone === 0) this.events.push({ type: 'chipInterrupted', defId: this.activeChip.def.id });
    this.activeChip = null;
  }
  return true;
}
```

The `p.invisTicks` check is gone with Invis (Task 2) and the `hitsDone` check arrived with multi-hit (Task 5).

In `src/sim/events.ts`:

```ts
/** Barrier ate part of a hit (spec §7.3). */
| { type: 'barrierHit'; absorbed: number; left: number; x: number; y: number }
```

- [ ] **Step 4: Add the two chips**

In `src/data/chips.ts` add `'barrier'` and `'recover'` to `ChipId`, add `/** Damage the barrier absorbs. */ barrier?: number;` to `ChipDef`, and:

```ts
barrier: {
  id: 'barrier', power: null, kind: 'support', timing: 'MEDIUM',
  codes: ['B', 'E', 'L', 'S', '*'], rarity: 'common', shape: { t: 'self' }, barrier: 1,
},
recover: {
  id: 'recover', power: null, kind: 'support', timing: 'MEDIUM',
  codes: ['C', 'E', 'L', 'S', '*'], rarity: 'common', shape: { t: 'self' }, heal: 50,
},
```

`barrier: 1` is a flag: the amount itself is the tunable. In `src/config/tuning.ts`, `chips` group: `/** Damage one Barrier chip absorbs. */ BARRIER_HP: 40,` and in `RANGES`: `BARRIER_HP: [0, 200, 5]`.

In `resolveChip`, next to the heal branch:

```ts
if (def.barrier) p.barrierHp = tuning.chips.BARRIER_HP;
```

- [ ] **Step 5: Show it on the CRT and in the folders**

Read `src/terminal/crt/hudModel.ts` first, then mirror the way it builds the HP segment row for a second, shorter row drawn directly under it. Exact requirements:

- it appears only while `world.player.barrierHp > 0`;
- its filled-segment count is `Math.ceil(player.barrierHp / tuning.chips.BARRIER_HP * BARRIER_SEGMENTS)` with `BARRIER_SEGMENTS = 4`;
- it draws in the accent signal, not the phosphor one, so it never reads as HP;
- **no text** — the CRT carries none in battle (BATTLE_VISUAL §8).

Extend `tests/terminalHud.test.ts` with a case asserting the row is absent at `barrierHp === 0` and full at `barrierHp === tuning.chips.BARRIER_HP`.

Give each folder three Barrier and three Recover copies, taken from Cannon and MiniBomb, and keep both totals at 30.

In `src/i18n/en.ts`:

```ts
'chip.barrier.name': 'Barrier',
'chip.barrier.desc': 'Absorbs damage until it breaks.',
'chip.recover.name': 'Recover',
'chip.recover.desc': 'Restores 50 HP.',
```

In `src/terminal/chips/chipIcons.ts` add both icons:

```ts
barrier: [
  '................',
  '.....cccccc.....',
  '...cc......cc...',
  '..c..........c..',
  '.c............c.',
  '.c...kkkkkk...c.',
  'c...kk....kk...c',
  'c...k......k...c',
  'c...k......k...c',
  'c...kk....kk...c',
  '.c...kkkkkk...c.',
  '.c............c.',
  '..c..........c..',
  '...cc......cc...',
  '.....cccccc.....',
  '................',
],
recover: [
  '................',
  '......GGGG......',
  '....GGllllGG....',
  '...GllllllllG...',
  '..GlllGGGGlllG..',
  '..GllGwwwwGllG..',
  '.GlllGwwwwGlllG.',
  '.GGGGwwwwwwGGGG.',
  '.GGGGwwwwwwGGGG.',
  '.GlllGwwwwGlllG.',
  '..GllGwwwwGllG..',
  '..GlllGGGGlllG..',
  '...GllllllllG...',
  '....GGllllGG....',
  '......GGGG......',
  '................',
],
```

- [ ] **Step 6: Run the suite and the build**

Run: `npm test`
Expected: PASS
Run: `npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
VS7: Barrier and Recover

- Barrier absorbs damage without flinch or i-frames; the overflow goes
  through as a normal hit
- the CRT shows what is left of the barrier next to the HP segments
- Recover replaces the four Recov chips with a single 50 HP heal

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Combat debug overlay

**Files:**
- Create: `src/debug/combatOverlay.ts`
- Modify: `src/main.ts` (build it, feed it events)
- Modify: `src/sim/world.ts` (`hazardCells` and hit provenance), `src/sim/events.ts`, `src/sim/attacks/attack.ts`, `src/sim/enemies/enemyBase.ts`
- Modify: `src/render/field.ts` (debug marks)
- Modify: `index.html` / the stylesheet holding `.debug-overlay` (add `.combat-overlay`)
- Test: new `tests/combatOverlay.test.ts`

**Interfaces:**
- Consumes: `Enemy.counterOpen`, `Enemy.state`, `World.events`.
- Produces:
  - `World.hazardCells(): Cell[]` — every panel a live attack currently occupies;
  - `combatLines(world: World): string[]` — pure, one line per living enemy;
  - `playerHit` `SimEvent` — immutable source, attack, hitbox, hurtbox and phase snapshot made when damage lands;
  - `damageLine(event: SimEvent): string | null` — pure, the explanation of one hit on the player;
  - `class CombatOverlay { constructor(parent: HTMLElement); visible: boolean; update(world: World, events: readonly SimEvent[]): void }`.

**Correctness constraint:** Never infer the source of a hit from whichever enemy is attacking when the overlay renders. Two enemies can attack on the same tick, and the source enemy can die or change state before the event is displayed. `World.hitPlayerAt` and instant attacks must emit an exact snapshot at the moment of damage. The snapshot includes `sourceEnemyId`, `enemyKind`, `attackId`, `attackKind`, `attackState`, `attackFrame`, `counterOpen`, the occupied hitbox cells, the player's hurtbox cell, amount and HP left. Persistent attacks carry their owner id; instant shots such as Canodron pass it explicitly. Keep the existing `damaged` event for HUD/FX consumers.

- [ ] **Step 1: Write the failing test**

Create `tests/combatOverlay.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { combatLines, damageLine } from '../src/debug/combatOverlay';
import { World } from '../src/sim/world';

const DT = 1 / 60;

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(): World {
  return new World({ seed: 8, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: true } });
}

describe('combat overlay', () => {
  it('prints a line per living enemy with kind, state and phase progress', () => {
    const w = world();
    const lines = combatLines(w);
    expect(lines.length).toBe(w.enemies.filter((e) => e.alive).length);
    expect(lines[0]).toMatch(/^mettik\s+\w+\s+\d+\/\d+/);
  });

  it('marks the counter window in the line', () => {
    const w = world();
    const enemy = w.enemies[0]!;
    for (let i = 0; i < 60 * 10 && !enemy.counterOpen(w.tick); i++) w.step(DT, { commands: [], held: null });
    expect(enemy.counterOpen(w.tick)).toBe(true);
    expect(combatLines(w)[0]).toContain('COUNTER');
  });

  it('explains a hit using the event snapshot', () => {
    const event = {
      type: 'playerHit', sourceEnemyId: 101, enemyKind: 'canodron', attackId: 7,
      attackKind: 'laneShot', attackState: 'ATTACK', attackFrame: 2, counterOpen: false,
      hitbox: [{ x: 1, y: 4 }], hurtbox: { x: 1, y: 4 }, amount: 10, hpLeft: 90,
    } as const;
    const line = damageLine(event);
    expect(line).toContain('canodron');
    expect(line).toContain('laneShot');
    expect(line).toContain('1,4');
  });

  it('ignores damage that did not land on the player', () => {
    const w = world();
    const enemy = w.enemies[0]!;
    const event = { type: 'damaged', targetId: enemy.id, amount: 10, x: enemy.x, y: enemy.y, hpLeft: 30 } as const;
    expect(damageLine(event)).toBeNull();
  });

  // Also simulate two enemies attacking on the same tick: each playerHit
  // must name the actual attacker, even if another enemy is still ATTACKING.
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/combatOverlay.test.ts`
Expected: FAIL — `src/debug/combatOverlay.ts` does not exist.

- [ ] **Step 3: Add `hazardCells` to the world**

Attacks expose either a `(x, y)` position or a cell list. Add to `src/sim/world.ts`:

```ts
/** Panels every live attack currently occupies (debug, spec §13). */
hazardCells(): Cell[] {
  const cells: Cell[] = [];
  for (const a of this.attacks) {
    const any = a as unknown as { x?: number; y?: number; cells?: readonly Cell[]; lanes?: () => number[] };
    if (any.cells) cells.push(...any.cells);
    else if (any.lanes && any.y !== undefined) for (const x of any.lanes()) cells.push({ x, y: any.y });
    else if (any.x !== undefined && any.y !== undefined) cells.push({ x: any.x, y: any.y });
  }
  return cells.filter((c) => inField(c.x, c.y));
}
```

Add provenance to `Attack`/`EnemyContext` and emit `playerHit` from the confirmed hit paths in `World`. For Canodron's instant `shootLane`, pass its enemy id and kind explicitly. Include the source's state and elapsed attack frame **at the time of impact**. Add an integration test with two enemies, rather than relying only on the synthetic event above.

- [ ] **Step 4: Write the overlay**

Create `src/debug/combatOverlay.ts`:

```ts
import { tuning } from '../config/tuning';
import type { SimEvent } from '../sim/events';
import type { Enemy } from '../sim/enemies/enemyBase';
import type { World } from '../sim/world';

// "Why did that hit me" (vertical slice spec §13). Text lives here, in the
// DOM, never on the CRT: the battle picture carries no text (BATTLE_VISUAL §8).

const LOG_LINES = 4;

/** Ticks the enemy's current phase lasts; 0 when the phase has no timer. */
function phaseTicks(enemy: Enemy): number {
  const p = tuning[enemy.kind] as unknown as Record<string, number>;
  switch (enemy.state) {
    case 'TELEGRAPH':
      return Math.round(p.TELEGRAPH * tuning.sim.SIM_HZ);
    case 'ATTACK':
      return Math.round(p.ACTIVE * tuning.sim.SIM_HZ);
    case 'RECOVERY':
      return Math.round(p.RECOVERY * tuning.sim.SIM_HZ);
    default:
      return Math.round((p.MOVE_INTERVAL ?? 0) * tuning.sim.SIM_HZ);
  }
}

/** One line per living enemy: kind, state, phase progress, counter window. */
export function combatLines(world: World): string[] {
  return world.enemies
    .filter((e) => e.alive)
    .map((e) => {
      const total = phaseTicks(e);
      const flags = [e.counterOpen(world.tick) ? 'COUNTER' : '', e.guarded ? 'GUARD' : '', e.paralyzeTicks > 0 ? 'PARA' : '']
        .filter(Boolean)
        .join(' ');
      return `${e.kind} ${e.state} ${e.elapsed(world.tick)}/${total} (${e.x},${e.y}) ${flags}`.trimEnd();
    });
}

/** Explanation of one confirmed player hit, or null for another event. */
export function damageLine(event: SimEvent): string | null {
  if (event.type !== 'playerHit') return null;
  const cells = event.hitbox.map((c) => `(${c.x},${c.y})`).join(' ');
  return `-${event.amount} from ${event.enemyKind}#${event.sourceEnemyId} ` +
    `${event.attackKind}#${event.attackId} ${event.attackState} frame ${event.attackFrame} ` +
    `hitbox ${cells} hurtbox (${event.hurtbox.x},${event.hurtbox.y}) ` +
    `counter ${event.counterOpen ? 'open' : 'closed'} hp ${event.hpLeft}`;
}

export class CombatOverlay {
  private readonly el: HTMLElement;
  private readonly log: string[] = [];

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'combat-overlay';
    parent.appendChild(this.el);
  }

  set visible(v: boolean) {
    this.el.style.display = v ? '' : 'none';
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  update(world: World, events: readonly SimEvent[]): void {
    if (!this.visible) return;
    for (const e of events) {
      const line = damageLine(e);
      if (line) this.log.unshift(line);
    }
    this.log.length = Math.min(this.log.length, LOG_LINES);
    this.el.textContent = [...combatLines(world), '', ...this.log].join('\n');
  }
}
```

- [ ] **Step 5: Wire it up and mark the cells**

In `src/main.ts` create the overlay next to `DebugOverlay`, toggle it with the same DBG switch, and call `combat.update(session.world, drainedEvents)` in the frame loop where the events are already drained.

Add a `.combat-overlay` rule next to `.debug-overlay` in the stylesheet: same monospace font, anchored bottom-left, `white-space: pre`, `pointer-events: none`.

This task touches no render code — `hazardCells` is added here because the overlay needs it, and Task 12 is what starts drawing it.

- [ ] **Step 6: Run the suite and the build**

Run: `npm test`
Expected: PASS
Run: `npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
VS8: combat debug overlay

- a DOM panel lists every living enemy with its state, phase progress
  and counter window, plus the last hits on the player and where they
  came from
- World.hazardCells reports the panels live attacks occupy; the field
  marks them while debug is on
- the CRT still carries no text

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8A: Hitstop on confirmed impacts

**Files:**
- Modify: `src/config/tuning.ts` (new `hitstop` group)
- Modify: `src/sim/world.ts` (freeze counter and impact triggers)
- Modify: `src/sim/events.ts` (debug event)
- Modify: `src/main.ts` (preserve queued input during the freeze)
- Modify: `src/debug/combatOverlay.ts` (show remaining freeze)
- Modify: `docs/GDD.md` §9 and §17, `docs/superpowers/specs/2026-09-20-vertical-slice-design.md` §7
- Test: new `tests/hitstop.test.ts`

**Interfaces:**
- Consumes: Counter (Task 4), timed chip hits (Task 5), Barrier (Task 7), combat overlay (Task 8).
- Produces: `World.hitstopTicks`, `World.simFrozen` during hitstop and a `hitstopStarted` event for the debug log.

Hitstop is an impact freeze measured in **fixed UI ticks**. The tick that resolves a hit finishes normally; the next `hitstopTicks` calls to `World.step` advance `uiTick` but hold `tick`, movement, chip and enemy timers, field updates, projectiles and attack hitboxes. Rendering holds the impact frame with interpolation alpha zero. Pausing suspends the remaining freeze; end-of-battle animations resume after it. This makes the gameplay cost of a hit deterministic without changing the 60 Hz simulation step.

Starting values in `tuning.hitstop` are estimates to tune during desktop and phone playtests: `CHIP_HIT: 0.05`, `PLAYER_HIT: 0.08`, `BARRIER_HIT: 0.05`, `COUNTER: 0.10` seconds. A confirmed chip hit on a vulnerable enemy, HP damage to the player, barrier absorption or a Counter starts the corresponding freeze. Guarded hits, misses, invulnerable hits, support chips and debug damage do not. When several impacts occur on one tick, use the **maximum** duration, never a sum. A Counter uses `COUNTER` instead of stacking a regular chip hit. Multi-hit Vulcan can trigger a fresh freeze on each actual hit.

- [ ] **Step 1: Write failing tests**

In `tests/hitstop.test.ts`, reset tuning in `beforeEach`. Assert that a confirmed chip hit starts hitstop; a miss and a guarded hit do not; player HP damage and barrier absorption use their own durations; Counter uses `COUNTER`; simultaneous impacts take the maximum. Step through the freeze and assert that `uiTick` advances while `tick`, enemy phase, chip hit schedule, player cooldown and projectile position do not. Assert that pause preserves the remaining duration and a killing blow still holds the impact frame before deletion animation. Compute all expectations with `secondsToTicks(tuning.hitstop.*)`.

- [ ] **Step 2: Add tuning and the freeze**

Add the `hitstop` tuning group and debug slider ranges. Add a helper on `World` that converts seconds to ticks, keeps the maximum remaining duration and emits `hitstopStarted` with the impact kind and duration. At the start of `World.step`, after advancing `uiTick`, consume one hitstop tick only in active or end-of-battle animation states; return before advancing `tick` or any gameplay timer. Include active hitstop in `simFrozen`. Do not consume hitstop while `PAUSED`.

- [ ] **Step 3: Trigger only on confirmed impacts**

Call the helper from the actual damage paths in `World.damageEnemy`, `World.hitPlayerAt` and the barrier absorption path, after hit validation. Use the Counter duration when Counter succeeds. Avoid starting hitstop from debug `killAllEnemies` or zero-damage effects. Reuse `SimEvent` for presentation and logging; the renderer must not mutate the freeze state.

- [ ] **Step 4: Preserve input and make the freeze visible in debug**

In `main.ts`, while `world.hitstopTicks > 0`, pass no new commands to `World.step` and do not drain `InputState`; the first live tick consumes the queued press. Held keyboard direction remains available. Show the remaining hitstop ticks in the combat overlay. Force render interpolation to zero through `world.simFrozen` so a partial movement slide cannot continue during the freeze.

- [ ] **Step 5: Verify feel and documentation**

Play Mettik timing, Vulcan multi-hit, Counter, Barrier and player damage on desktop. The project owner checks the same build on a real phone over the local dev server, then through the Task 8B preview after it is published. Compare wide desktop and narrow portrait layouts. Tune the four durations from these observations, record the final values in `DEFAULT_TUNING` and GDD §17, and explain the freeze in GDD §9 and the vertical-slice design spec §7.

- [ ] **Step 6: Run `npm test` and `npm run build`**

- [ ] **Step 7: Commit when implementation commits are requested**

Use a `VS8A: add deterministic hitstop` commit after both gates pass.

---

### Task 8B: Independent GitHub Pages preview

**Files:**
- Create: a separate preview repository and its Pages workflow during implementation
- Check: `vite.config.ts` (`base: './'` already supports a project Pages path)
- Document: the preview URL and refresh steps in `README.md` or a short `docs/` note

**Interfaces:**
- Consumes: the current working branch (`codex/gameplay` at planning time).
- Produces: an independent Pages URL for desktop and phone playtests without replacing the existing `main` site.

GitHub Pages publishes one site per repository. A second Pages environment in this repository would still target its one site, so use a separate public preview repository under the same account. Keep its Pages workflow on its default branch and push a verified snapshot of the working branch to a `source` branch there. Dispatch the preview workflow from its default branch; it checks out `source`, runs `npm ci`, `npm test`, `npm run build` and deploys `dist`. The source repository's `main` workflow and URL stay untouched. Refresh the preview from the working branch at playtest milestones, then record the source commit SHA alongside the preview URL so feedback can be tied to an exact build.

- [ ] **Step 1: Prepare the preview repository and workflow**

Create the preview repository, add the Pages workflow to its default branch and configure Pages to publish from GitHub Actions. The workflow accepts manual dispatch and checks out the preview repository's `source` branch. Do not add deployment credentials to the game's source tree. Confirm that the game's relative Vite base resolves assets, manifest and icons under the preview repository path.

- [ ] **Step 2: Publish a verified branch snapshot**

After `npm test` and `npm run build` pass, push the working branch commit to the preview repository's `source` branch and dispatch the workflow on its default branch. Wait for deployment, then open the preview URL on desktop and phone. Keep the source branch and preview build commit SHA visible to testers.

- [ ] **Step 3: Verify layout and input**

Check a narrow portrait phone viewport, a wider or landscape phone viewport, and desktop window sizes. The project owner verifies touch and trackball input on a real phone; desktop checks cover keyboard and pointer input. Check that the terminal, CRT, HUD, debug overlay and all controls fit without clipping. A desktop viewport emulator is useful for extra sizes but does not replace the owner's real phone pass.

---

### Task 9: Movement polish

**Files:**
- Modify: `src/sim/player.ts` (`cooldownLeft`)
- Modify: `src/debug/combatOverlay.ts` (player line)
- Modify: `src/config/tuning.ts` (final values)
- Modify: `docs/GDD.md` §17
- Test: new `tests/movementFeel.test.ts`

**Interfaces:**
- Consumes: `CombatOverlay` from Task 8.
- Produces: `Player.cooldownLeft(tick: number): number`; `playerLine(world: World): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/movementFeel.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(): World {
  const w = new World({ seed: 6, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: false } });
  w.chips.attack = [];
  return w;
}

describe('movement feel', () => {
  it('reports the remaining cooldown after a step', () => {
    const w = world();
    w.step(DT, { commands: [{ type: 'move', dir: 'left' }], held: null });
    expect(w.player.cooldownLeft(w.tick)).toBe(T(tuning.player.MOVE_COOLDOWN));
    for (let i = 0; i < T(tuning.player.MOVE_COOLDOWN); i++) w.step(DT, { commands: [], held: null });
    expect(w.player.cooldownLeft(w.tick)).toBe(0);
  });

  it('keeps exactly one buffered direction during the cooldown', () => {
    const w = world();
    w.step(DT, { commands: [{ type: 'move', dir: 'left' }], held: null });
    w.step(DT, { commands: [{ type: 'move', dir: 'up' }, { type: 'move', dir: 'right' }], held: null });
    expect(w.player.bufferedDir).toBe('right');
  });

  it('never moves twice within the cooldown', () => {
    const w = world();
    const startX = w.player.x;
    w.step(DT, { commands: [{ type: 'move', dir: 'left' }], held: null });
    w.step(DT, { commands: [{ type: 'move', dir: 'left' }], held: null });
    expect(w.player.x).toBe(startX - 1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/movementFeel.test.ts`
Expected: FAIL — `cooldownLeft` is not a method.

- [ ] **Step 3: Expose the cooldown**

In `src/sim/player.ts`:

```ts
/** Ticks left before the next step is allowed (GDD §3.1). */
cooldownLeft(tick: number): number {
  const wait = secondsToTicks(tuning.player.MOVE_COOLDOWN);
  return Math.max(0, wait - (tick - this.lastMoveTick));
}
```

and let `cooldownReady` use it: `return this.cooldownLeft(tick) === 0;`

- [ ] **Step 4: Put the player on the overlay**

In `src/debug/combatOverlay.ts`:

```ts
/** Movement state of the player (spec §12). */
export function playerLine(world: World): string {
  const p = world.player;
  const flags = [
    p.flinched ? 'FLINCH' : '',
    p.invulnerable ? 'IFRAME' : '',
    p.paralyzeTicks > 0 ? 'PARA' : '',
    p.actionTicks > 0 ? 'CHIP' : '',
    p.syncTicks > 0 ? 'SYNC' : '',
    p.barrierHp > 0 ? `BAR ${p.barrierHp}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `player (${p.x},${p.y}) cd ${p.cooldownLeft(world.tick)} buf ${p.bufferedDir ?? '-'} ${flags}`.trimEnd();
}
```

and prepend it in `update`: `[playerLine(world), ...combatLines(world), '', ...this.log]`.

- [ ] **Step 5: Polish on desktop and phone**

Start the dev server (`npm run dev`) for desktop checks, then have the project owner open the Task 8B preview URL on a real phone with `?debug=1`. Check both keyboard and pointer/trackball input. Use a narrow portrait phone, a wider phone or landscape viewport, and a desktop viewport; verify the grid, HUD and controls remain readable without clipping. Walk the four knobs until a step reads as immediate and a held direction repeats without running away:

- `player.MOVE_COOLDOWN`
- `input.HOLD_REPEAT_DELAY`
- `input.HOLD_REPEAT`
- `input.SWIPE_REARM_TIME`

Write the values you settle on into `DEFAULT_TUNING` and into the GDD §17 table. If nothing needs changing, say so in the commit body rather than inventing a change. Record any desktop/phone differences and check that hitstop from Task 8A does not swallow an input or make movement feel delayed after the freeze.

- [ ] **Step 6: Run the suite and the build**

Run: `npm test`
Expected: PASS
Run: `npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
VS9: movement polish and its debug readout

- Player.cooldownLeft exposes the step cooldown
- the debug overlay shows the player's position, cooldown, buffered
  direction, flinch, i-frames, synchro and barrier
- movement tunables checked on desktop and phone and written into GDD §17

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Pirak

**Files:**
- Create: `src/sim/enemies/pirak.ts`
- Modify: `src/sim/enemies/enemyBase.ts` (`EnemyKind`, `alliesOfKind` in `EnemyContext`)
- Modify: `src/sim/enemies/factory.ts`, `src/sim/world.ts`, `src/config/tuning.ts`
- Modify: `src/data/enemies.ts`, `src/i18n/en.ts`
- Test: new `tests/pirak.test.ts`

**Interfaces:**
- Consumes: the profile from Task 3, `LaneShot` from `src/sim/attacks/laneShot.ts`.
- Produces: `EnemyKind` gains `'pirak'`; `EnemyContext.alliesOfKind(kind: EnemyKind): Enemy[]`; `Pirak.joinVolley(tick: number): void`.

- [ ] **Step 1: Write the failing test**

Create `tests/pirak.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { createEnemy } from '../src/sim/enemies/factory';
import type { Enemy } from '../src/sim/enemies/enemyBase';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

let nextId = 900;

function arena(spawns: { x: number; y: number }[]): { w: World; es: Enemy[] } {
  const w = new World({ seed: 9, battleIndex: 1, skipIntro: true, cheats: { god: false, aiEnabled: true } });
  for (const old of w.enemies) w.occupancy.remove(old.id, old.x, old.y);
  w.enemies = [];
  w.chips.attack = [];
  const es = spawns.map((s) => {
    const e = createEnemy({ kind: 'pirak', x: s.x, y: s.y }, nextId++, w.tick);
    w.occupancy.place(e.id, s.x, s.y);
    w.enemies.push(e);
    return e;
  });
  return { w, es };
}

const step = (w: World) => w.step(DT, { commands: [], held: null });

function until(w: World, done: () => boolean, limit = 15): void {
  for (let i = 0; i < T(limit); i++) {
    if (done()) return;
    step(w);
  }
  expect(done(), 'condition not reached').toBe(true);
}

describe('Pirak', () => {
  it('walks into the player lane, locks and fires down it', () => {
    const { w, es } = arena([{ x: 0, y: 1 }]);
    until(w, () => es[0]!.state === 'TELEGRAPH');
    expect(es[0]!.x).toBe(w.player.x);
    until(w, () => w.attacks.length > 0);
    expect(w.attacks[0]!.kind).toBe('zapring');
  });

  it('fires even after the player has left the lane', () => {
    const { w, es } = arena([{ x: 1, y: 1 }]);
    until(w, () => es[0]!.state === 'TELEGRAPH');
    const lane = es[0]!.x;
    w.step(DT, { commands: [{ type: 'move', dir: 'left' }], held: null });
    until(w, () => w.attacks.length > 0);
    expect((w.attacks[0] as unknown as { x: number }).x).toBe(lane);
  });

  it('pulls the other Piraks into the volley', () => {
    const { w, es } = arena([{ x: 1, y: 1 }, { x: 0, y: 0 }]);
    until(w, () => es[0]!.state === 'TELEGRAPH' || es[1]!.state === 'TELEGRAPH');
    step(w);
    expect(es[0]!.state === 'TELEGRAPH' && es[1]!.state === 'TELEGRAPH').toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/pirak.test.ts`
Expected: FAIL — `'pirak'` is not an `EnemyKind`.

- [ ] **Step 3: Add the context method**

In `src/sim/enemies/enemyBase.ts` extend `EnemyKind` with `'pirak'` and `EnemyContext` with:

```ts
/** Living enemies of one kind, for family-wide behaviour (GDD §8.2). */
alliesOfKind(kind: EnemyKind): Enemy[];
```

In `src/sim/world.ts`:

```ts
alliesOfKind(kind: EnemyKind): Enemy[] {
  return this.enemies.filter((e) => e.kind === kind && e.alive);
}
```

- [ ] **Step 4: Add the tuning group and the seed**

In `src/config/tuning.ts`:

```ts
pirak: {
  HP: 60,
  DMG: 20,
  KNOCKBACK: 0,
  MOVE_INTERVAL: 0.45,
  /** Seconds the cursor sits on the player before the column is fixed. */
  LOCK_TIME: 0.5,
  TELEGRAPH: 0.35,
  COUNTER: 0.2,
  ACTIVE: 0.2,
  RECOVERY: 1.6,
  /** Seconds per panel of the arrow. */
  SHOT_STEP: 0.1,
},
```

In `src/data/enemies.ts` add `pirak: 118` to `ENEMY_SEEDS`. In `src/i18n/en.ts` add `'enemy.pirak': 'Pirak',`.

- [ ] **Step 5: Write the enemy**

Create `src/sim/enemies/pirak.ts`:

```ts
import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { LaneShot } from '../attacks/laneShot';
import { laneCellsBelow, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Pirak (vertical slice spec §8.4) — target lock and prediction.
// Walks along its own row toward the player's lane. On arrival it puts a
// cursor on the player and locks: from that moment the lane is fixed and the
// shot happens whether or not the player is still standing there. That is the
// whole difference from Canodron, which simply drops its cursor.

export class Pirak extends Enemy {
  readonly kind = 'pirak';
  private lockTick = 0;
  private locked = false;

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.pirak.HP, spawnTick, level);
  }

  override cursorCell(): { x: number; y: number; locked: boolean } | null {
    if (this.state !== 'MOVE' && this.state !== 'IDLE' && !this.locked) return null;
    return this.locked ? { x: this.x, y: this.y + 1, locked: true } : null;
  }

  override dangerCells(): Cell[] {
    return this.state === 'TELEGRAPH' ? laneCellsBelow(this.x, this.y + 1) : [];
  }

  override forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) this.beginLock(tick);
  }

  /** Another Pirak locked: this one commits to its current lane too (§8.4). */
  joinVolley(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) this.beginLock(tick);
  }

  private beginLock(tick: number): void {
    this.locked = true;
    this.lockTick = tick;
    this.setState('TELEGRAPH', tick);
  }

  update(ctx: EnemyContext): void {
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE': {
        if (this.elapsed(t) < this.ticks(this.p.MOVE_INTERVAL as number)) return;
        this.stateTick = t;
        const px = ctx.player.x;
        if (this.x === px) {
          this.beginLock(t);
          for (const ally of ctx.alliesOfKind('pirak')) {
            if (ally !== this) (ally as Pirak).joinVolley(t);
          }
          return;
        }
        this.state = this.tryStep(ctx, this.x + Math.sign(px - this.x), this.y) ? 'MOVE' : 'IDLE';
        return;
      }
      case 'TELEGRAPH': {
        const wait = this.ticks(this.p.LOCK_TIME as number) + this.ticks(this.p.TELEGRAPH);
        if (t - this.lockTick < wait) return;
        ctx.spawnAttack(
          new LaneShot(ctx.nextAttackId(), 'zapring', this.x, this.y + 1, t, {
            damage: this.dmg(this.p.DMG),
            stepTicks: this.ticks(this.p.SHOT_STEP as number),
          }),
        );
        this.locked = false;
        this.setState('ATTACK', t);
        return;
      }
      case 'ATTACK':
        if (this.elapsed(t) >= this.ticks(this.p.ACTIVE)) this.setState('RECOVERY', t);
        return;
      case 'RECOVERY':
        if (this.elapsed(t) >= this.ticks(this.p.RECOVERY)) this.setState('IDLE', t);
        return;
      case 'DEAD':
        return;
    }
  }
}
```

The counter window sits in the tail of `TELEGRAPH`, so `counterOpen` must measure the whole wait, not just `TELEGRAPH`. Override it:

```ts
override counterOpen(tick: number): boolean {
  if (this.state !== 'TELEGRAPH') return false;
  const window = this.rawTicks(this.p.COUNTER);
  if (window <= 0) return false;
  const wait = this.ticks(this.p.LOCK_TIME as number) + this.ticks(this.p.TELEGRAPH);
  return tick - this.lockTick >= wait - window;
}
```

Register it in `src/sim/enemies/factory.ts` (`case 'pirak': return new Pirak(...args);`).

- [ ] **Step 6: Run the suite and the build**

Run: `npm test`
Expected: PASS
Run: `npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
VS10: Pirak

- walks along its row into the player's lane, locks the lane and fires
  whether or not the player is still there
- a lock pulls every other living Pirak into the same volley through the
  new EnemyContext.alliesOfKind
- counter window sits in the tail of the lock-plus-telegraph wait

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Rollik

**Files:**
- Create: `src/sim/enemies/rollik.ts`
- Modify: `src/sim/enemies/enemyBase.ts` (`EnemyKind`, `tryStep` options)
- Modify: `src/sim/enemies/factory.ts`, `src/config/tuning.ts`, `src/data/enemies.ts`, `src/i18n/en.ts`
- Test: new `tests/rollik.test.ts`

**Interfaces:**
- Consumes: the profile from Task 3.
- Produces: `EnemyKind` gains `'rollik'`; `Enemy.tryStep(ctx, nx, ny, opts?: { anySide?: boolean }): boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/rollik.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { createEnemy } from '../src/sim/enemies/factory';
import type { Enemy } from '../src/sim/enemies/enemyBase';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function arena(x: number, y: number): { w: World; e: Enemy } {
  const w = new World({ seed: 11, battleIndex: 1, skipIntro: true, cheats: { god: false, aiEnabled: true } });
  for (const old of w.enemies) w.occupancy.remove(old.id, old.x, old.y);
  w.enemies = [];
  w.chips.attack = [];
  const e = createEnemy({ kind: 'rollik', x, y }, 950, w.tick);
  w.occupancy.place(e.id, x, y);
  w.enemies.push(e);
  return { w, e };
}

const step = (w: World) => w.step(DT, { commands: [], held: null });

function until(w: World, done: () => boolean, limit = 15): void {
  for (let i = 0; i < T(limit); i++) {
    if (done()) return;
    step(w);
  }
  expect(done(), 'condition not reached').toBe(true);
}

describe('Rollik', () => {
  it('is vulnerable while curling up and armored while rolling', () => {
    const { w, e } = arena(0, 1);
    until(w, () => e.state === 'TELEGRAPH');
    expect(e.guarded).toBe(false);
    expect(e.counterOpen(w.tick) || e.elapsed(w.tick) < T(tuning.rollik.TELEGRAPH)).toBe(true);
    until(w, () => e.state === 'ATTACK');
    expect(e.guarded).toBe(true);
  });

  it('bounces chip damage while armored', () => {
    const { w, e } = arena(1, 1);
    until(w, () => e.state === 'ATTACK');
    const before = e.hp;
    w.drainEvents();
    w.damageEnemy(e, 40, 'chip');
    expect(e.hp).toBe(before);
    expect(w.drainEvents().map((ev) => ev.type)).toContain('guarded');
  });

  it('rolls down the player lane and onto player panels', () => {
    const { w, e } = arena(1, 0);
    const startY = e.y;
    until(w, () => e.state === 'ATTACK');
    until(w, () => e.y > startY + 1);
    expect(e.x).toBe(1);
  });

  it('drops its guard again in recovery', () => {
    const { w, e } = arena(1, 0);
    until(w, () => e.state === 'RECOVERY', 20);
    expect(e.guarded).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/rollik.test.ts`
Expected: FAIL — `'rollik'` is not an `EnemyKind`.

- [ ] **Step 3: Let a step cross the border**

In `src/sim/enemies/enemyBase.ts` replace `tryStep`:

```ts
/**
 * One step. `anySide` lets the enemy leave its own territory (Rollik's
 * charge, vertical slice spec §8.5); everyone else stays home.
 */
protected tryStep(ctx: EnemyContext, nx: number, ny: number, opts: { anySide?: boolean } = {}): boolean {
  const standable = opts.anySide
    ? inField(nx, ny) && ctx.field.panel(nx, ny) !== 'BROKEN'
    : ctx.field.canStand('enemy', nx, ny);
  if (!standable || !ctx.occupancy.isFree(nx, ny)) return false;
  ctx.occupancy.move(this.id, this.x, this.y, nx, ny);
  ctx.field.onLeave(this.x, this.y, ctx.tick);
  this.prevX = this.x;
  this.prevY = this.y;
  this.x = nx;
  this.y = ny;
  this.lastMoveTick = ctx.tick;
  return true;
}
```

and add `inField` to the imports from `../grid`. Extend `EnemyKind` with `'rollik'`.

- [ ] **Step 4: Add the tuning group, the seed and the string**

```ts
rollik: {
  HP: 90,
  DMG: 30,
  KNOCKBACK: 0,
  MOVE_INTERVAL: 0.55,
  /** Curling up: the one moment it can be hit properly. */
  TELEGRAPH: 0.7,
  COUNTER: 0.35,
  /** Seconds per panel of the charge. */
  ROLL_STEP: 0.12,
  ACTIVE: 0.2,
  RECOVERY: 1.8,
},
```

`enemies.ts`: `rollik: 144`. `i18n/en.ts`: `'enemy.rollik': 'Rollik',`.

- [ ] **Step 5: Write the enemy**

Create `src/sim/enemies/rollik.ts`:

```ts
import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import type { Attack } from '../attacks/attack';
import { ROWS, laneCellsBelow, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Rollik (vertical slice spec §8.5) — readable enemy states.
// FOLLOW: walks its row toward the player's lane. ALIGN/TELEGRAPH: curls up
// and is open to a Counter. ARMORED: guarded, rolls down the lane across the
// border. RECOVERY: unrolls and drops the guard.

/** Throwaway record so the charge damages the player once per panel. */
function contact(id: number): Attack {
  return { id, kind: 'roll', hitIds: new Set<number>(), done: true, update: () => undefined };
}

export class Rollik extends Enemy {
  readonly kind = 'rollik';
  private rollTick = 0;

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.rollik.HP, spawnTick, level);
  }

  override dangerCells(): Cell[] {
    return this.state === 'TELEGRAPH' ? laneCellsBelow(this.x, this.y + 1) : [];
  }

  override forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) this.setState('TELEGRAPH', tick);
  }

  override onCountered(ctx: EnemyContext): void {
    this.guarded = false;
    super.onCountered(ctx);
  }

  update(ctx: EnemyContext): void {
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE': {
        this.guarded = false;
        if (this.elapsed(t) < this.ticks(this.p.MOVE_INTERVAL as number)) return;
        this.stateTick = t;
        const px = ctx.player.x;
        if (this.x === px) {
          this.setState('TELEGRAPH', t);
          return;
        }
        this.state = this.tryStep(ctx, this.x + Math.sign(px - this.x), this.y) ? 'MOVE' : 'IDLE';
        return;
      }
      case 'TELEGRAPH':
        if (this.elapsed(t) < this.ticks(this.p.TELEGRAPH)) return;
        this.guarded = true;
        this.rollTick = t;
        this.setState('ATTACK', t);
        return;
      case 'ATTACK': {
        if (t - this.rollTick < this.ticks(this.p.ROLL_STEP as number)) return;
        this.rollTick = t;
        const ny = this.y + 1;
        const p = ctx.player;
        if (ny >= ROWS) {
          this.setState('RECOVERY', t);
          return;
        }
        // Running into the player costs them a hit and stops the charge.
        if (p.alive && p.x === this.x && p.y === ny) {
          ctx.hitPlayerAt(contact(ctx.nextAttackId()), this.x, ny, this.dmg(this.p.DMG));
          this.setState('RECOVERY', t);
          return;
        }
        if (!this.tryStep(ctx, this.x, ny, { anySide: true })) this.setState('RECOVERY', t);
        return;
      }
      case 'RECOVERY':
        this.guarded = false;
        if (this.elapsed(t) >= this.ticks(this.p.RECOVERY)) this.setState('IDLE', t);
        return;
      case 'DEAD':
        return;
    }
  }
}
```

Register it in `factory.ts`.

**Note on returning home:** after `RECOVERY` the enemy is back in `IDLE` and its `MOVE` branch walks its row; it may now stand on a player panel. That is intended — it walks back out through the normal step rules, which allow only its own territory, so its first sideways step that fails simply keeps it where it is until the player's lane changes. No extra code.

- [ ] **Step 6: Run the suite and the build**

Run: `npm test`
Expected: PASS
Run: `npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
VS11: Rollik

- follows the player's lane, curls up (open to a Counter) and charges
  down the lane behind its shell
- guarded while armored: chips bounce off with the guarded event
- tryStep gains anySide so the charge can cross into player territory

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Zone attacks, Stovik, and Bladdy on a zone

**Files:**
- Create: `src/sim/attacks/zone.ts`, `src/sim/enemies/stovik.ts`
- Modify: `src/sim/enemies/bladdy.ts`, `src/sim/enemies/enemyBase.ts`, `src/sim/enemies/factory.ts`
- Modify: `src/config/tuning.ts`, `src/data/enemies.ts`, `src/i18n/en.ts`
- Modify: `src/render/scene.ts` (mark zone cells every tick)
- Test: new `tests/zone.test.ts`, `tests/stovik.test.ts`

**Interfaces:**
- Consumes: `World.hazardCells` (Task 8), the profile (Task 3).
- Produces: `class ZoneAttack implements Attack` with `new ZoneAttack(id, kind: 'fire' | 'slash', cells, spawnTick, { damage, ticks, reHitTicks })` and a public `readonly cells: readonly Cell[]`; `EnemyKind` gains `'stovik'`.

- [ ] **Step 1: Write the failing test**

Create `tests/zone.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { ZoneAttack } from '../src/sim/attacks/zone';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(): World {
  const w = new World({ seed: 12, battleIndex: 1, skipIntro: true, cheats: { god: false, aiEnabled: false } });
  w.chips.attack = [];
  return w;
}

const idle = (w: World, n: number) => {
  for (let i = 0; i < n; i++) w.step(DT, { commands: [], held: null });
};

describe('ZoneAttack', () => {
  it('damages the player standing in it and expires on time', () => {
    const w = world();
    const cells = [{ x: w.player.x, y: w.player.y }];
    w.spawnAttack(new ZoneAttack(1, 'fire', cells, w.tick, { damage: 10, ticks: T(1), reHitTicks: T(0.5) }));
    idle(w, 2);
    expect(w.player.hp).toBe(90);
    idle(w, T(1) + 2);
    expect(w.attacks.length).toBe(0);
  });

  it('hits once per re-hit interval, not every tick', () => {
    const w = world();
    tuning.player.PLAYER_IFRAMES = 0;
    const cells = [{ x: w.player.x, y: w.player.y }];
    w.spawnAttack(new ZoneAttack(2, 'fire', cells, w.tick, { damage: 10, ticks: T(1), reHitTicks: T(0.5) }));
    idle(w, T(0.9));
    expect(w.player.hitsTaken).toBe(2);
  });

  it('does not touch a player who is not in it', () => {
    const w = world();
    const cells = [{ x: (w.player.x + 1) % 3, y: w.player.y }];
    w.spawnAttack(new ZoneAttack(3, 'fire', cells, w.tick, { damage: 10, ticks: T(1), reHitTicks: T(0.5) }));
    idle(w, T(1));
    expect(w.player.hp).toBe(100);
  });
});
```

Create `tests/stovik.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { createEnemy } from '../src/sim/enemies/factory';
import type { Enemy } from '../src/sim/enemies/enemyBase';
import { COLS } from '../src/sim/grid';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function arena(): { w: World; e: Enemy } {
  const w = new World({ seed: 13, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: true } });
  for (const old of w.enemies) w.occupancy.remove(old.id, old.x, old.y);
  w.enemies = [];
  w.chips.attack = [];
  const e = createEnemy({ kind: 'stovik', x: 1, y: 1 }, 970, w.tick);
  w.occupancy.place(e.id, 1, 1);
  w.enemies.push(e);
  return { w, e };
}

const step = (w: World) => w.step(DT, { commands: [], held: null });

function until(w: World, done: () => boolean, limit = 20): void {
  for (let i = 0; i < T(limit); i++) {
    if (done()) return;
    step(w);
  }
  expect(done(), 'condition not reached').toBe(true);
}

describe('Stovik', () => {
  it('telegraphs the exact panels it will burn', () => {
    const { w, e } = arena();
    until(w, () => e.state === 'TELEGRAPH');
    const danger = e.dangerCells();
    expect(danger.length).toBeGreaterThan(0);
    until(w, () => w.attacks.length > 0);
    const zone = w.attacks[0] as unknown as { cells: { x: number; y: number }[] };
    expect(zone.cells.map((c) => `${c.x},${c.y}`).sort()).toEqual(danger.map((c) => `${c.x},${c.y}`).sort());
  });

  it('burns either one lane or one row, never both', () => {
    const { w, e } = arena();
    until(w, () => e.state === 'TELEGRAPH');
    const cells = e.dangerCells();
    const oneLane = cells.every((c) => c.x === cells[0]!.x);
    const oneRow = cells.every((c) => c.y === cells[0]!.y) && cells.length === COLS;
    expect(oneLane || oneRow).toBe(true);
  });

  it('opens its counter window only after the attack starts', () => {
    const { w, e } = arena();
    until(w, () => e.state === 'TELEGRAPH');
    expect(e.counterOpen(w.tick)).toBe(false);
    until(w, () => e.state === 'ATTACK');
    expect(e.counterOpen(w.tick)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/zone.test.ts tests/stovik.test.ts`
Expected: FAIL — neither `ZoneAttack` nor `'stovik'` exists.

- [ ] **Step 3: Write the zone entity**

Create `src/sim/attacks/zone.ts`:

```ts
import type { Cell } from '../grid';
import type { Attack, AttackContext } from './attack';

// Persistent damage zone (vertical slice spec §7.1): sits on a fixed set of
// panels for `ticks` and clears its hit registry every `reHitTicks`, so a
// player standing in it takes a hit at that interval rather than every frame.
// It blocks nothing and stops no projectile.

export interface ZoneOptions {
  damage: number;
  /** Total life of the zone, in ticks. */
  ticks: number;
  /** Ticks between re-hits on the same target. */
  reHitTicks: number;
}

export class ZoneAttack implements Attack {
  readonly hitIds = new Set<number>();
  done = false;
  private readonly endTick: number;
  private readonly reHitTicks: number;
  private readonly damage: number;
  private nextClearTick: number;

  constructor(
    readonly id: number,
    readonly kind: 'fire' | 'slash',
    readonly cells: readonly Cell[],
    spawnTick: number,
    opts: ZoneOptions,
  ) {
    this.endTick = spawnTick + Math.max(1, opts.ticks);
    this.reHitTicks = Math.max(1, opts.reHitTicks);
    this.nextClearTick = spawnTick + this.reHitTicks;
    this.damage = opts.damage;
  }

  update(ctx: AttackContext): void {
    if (this.done) return;
    if (ctx.tick >= this.endTick) {
      this.done = true;
      return;
    }
    if (ctx.tick >= this.nextClearTick) {
      this.hitIds.clear();
      this.nextClearTick = ctx.tick + this.reHitTicks;
    }
    for (const c of this.cells) {
      ctx.hitObjectAt(this, c.x, c.y, this.damage);
      ctx.hitPlayerAt(this, c.x, c.y, this.damage);
    }
  }
}
```

- [ ] **Step 4: Move Bladdy onto the zone**

In `src/sim/enemies/bladdy.ts` replace the `TELEGRAPH` case's instant swing:

```ts
case 'TELEGRAPH': {
  if (this.elapsed(t) < this.ticks(this.p.TELEGRAPH)) return;
  const cells = this.reach();
  ctx.spawnAttack(
    new ZoneAttack(ctx.nextAttackId(), 'slash', cells, t, {
      damage: this.dmg(this.p.DMG),
      ticks: this.ticks(this.p.ACTIVE),
      reHitTicks: this.ticks(this.p.ACTIVE),
    }),
  );
  ctx.emit({ type: 'enemySlash', cells });
  this.setState('ATTACK', t);
  return;
}
```

`reHitTicks` equal to the whole life means one hit per swing — the hitbox now lives exactly as long as the animation, which is what spec §14.1–14.2 demands.

- [ ] **Step 5: Add Stovik's tuning, seed and string**

```ts
stovik: {
  HP: 120,
  DMG: 20,
  KNOCKBACK: 0,
  /** Seconds between nozzle turns. */
  ROTATE_INTERVAL: 1.4,
  TELEGRAPH: 0.8,
  /** Window at the start of the burn (counterPhase = 'active'). */
  COUNTER: 0.35,
  /** How long the flame stays up. */
  ACTIVE: 1.6,
  /** Seconds between re-hits inside the flame. */
  RE_HIT: 0.8,
  RECOVERY: 1.5,
},
```

`enemies.ts`: `stovik: 167`. `i18n/en.ts`: `'enemy.stovik': 'Stovik',`.

- [ ] **Step 6: Write Stovik**

Create `src/sim/enemies/stovik.ts`:

```ts
import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { ZoneAttack } from '../attacks/zone';
import { COLS, inField, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Stovik (vertical slice spec §8.6) — area denial.
// The nozzle turns between two orientations and the flame stays up for a
// while, so the player reads the direction and picks a safe panel.
//   ALONG  — three panels down its own lane: one lane is closed, step aside
//   ACROSS — the whole row in front of it: one row is closed, step back
// No elements: the flame's colour is presentation only.

type Facing = 'ALONG' | 'ACROSS';
const ALONG_DEPTH = 3;

export class Stovik extends Enemy {
  readonly kind = 'stovik';
  protected override counterPhase = 'active' as const;
  private facing: Facing = 'ALONG';
  private zone: ZoneAttack | null = null;

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.stovik.HP, spawnTick, level);
  }

  /** Panels the flame will cover from the current facing. */
  private burnCells(): Cell[] {
    const cells: Cell[] = [];
    if (this.facing === 'ALONG') {
      for (let i = 1; i <= ALONG_DEPTH; i++) cells.push({ x: this.x, y: this.y + i });
    } else {
      for (let x = 0; x < COLS; x++) cells.push({ x, y: this.y + 1 });
    }
    return cells.filter((c) => inField(c.x, c.y));
  }

  override dangerCells(): Cell[] {
    return this.state === 'TELEGRAPH' ? this.burnCells() : [];
  }

  override forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) this.setState('TELEGRAPH', tick);
  }

  override onCountered(ctx: EnemyContext): void {
    if (this.zone) this.zone.done = true;
    this.zone = null;
    super.onCountered(ctx);
  }

  update(ctx: EnemyContext): void {
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE': {
        if (this.elapsed(t) < this.ticks(this.p.ROTATE_INTERVAL as number)) return;
        this.stateTick = t;
        // Face the shape that covers the player, so the turn reads as aiming.
        this.facing = ctx.player.x === this.x ? 'ALONG' : 'ACROSS';
        this.setState('TELEGRAPH', t);
        return;
      }
      case 'TELEGRAPH':
        if (this.elapsed(t) < this.ticks(this.p.TELEGRAPH)) return;
        this.zone = new ZoneAttack(ctx.nextAttackId(), 'fire', this.burnCells(), t, {
          damage: this.dmg(this.p.DMG),
          ticks: this.ticks(this.p.ACTIVE),
          reHitTicks: this.ticks(this.p.RE_HIT as number),
        });
        ctx.spawnAttack(this.zone);
        this.setState('ATTACK', t);
        return;
      case 'ATTACK':
        if (this.elapsed(t) < this.ticks(this.p.ACTIVE)) return;
        this.zone = null;
        this.setState('RECOVERY', t);
        return;
      case 'RECOVERY':
        if (this.elapsed(t) >= this.ticks(this.p.RECOVERY)) this.setState('IDLE', t);
        return;
      case 'DEAD':
        return;
    }
  }
}
```

Extend `EnemyKind` with `'stovik'` and register it in `factory.ts`.

- [ ] **Step 7: Draw the zone**

In `src/render/scene.ts`, in the per-frame update that already runs the field, keep the zone lit for its whole life by refreshing its mark each tick:

```ts
this.field.markAttack(world.hazardCells(), tick, 'red');
```

Call it unconditionally (not only under debug) — `hazardCells` is what the player must see.

Remove the debug-only call added in Task 8 Step 5 so the marks are not applied twice.

- [ ] **Step 8: Run the suite and the build**

Run: `npm test`
Expected: PASS
Run: `npm run build`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
VS12: zone attacks, Stovik, and Bladdy on a zone

- ZoneAttack: a persistent damage area with its own re-hit interval
- Stovik turns its nozzle between a lane and a row, telegraphs the exact
  panels and keeps the flame up; its counter window opens with the burn
- Bladdy's swing becomes a zone, so its hitbox lives exactly as long as
  the animation
- live attack panels are drawn from World.hazardCells

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Gustbox and forced movement

**Files:**
- Create: `src/sim/enemies/gustbox.ts`
- Modify: `src/sim/player.ts` (`forcedStep`), `src/sim/enemies/enemyBase.ts` (`EnemyKind`, context)
- Modify: `src/sim/world.ts` (`pushPlayer`), `src/sim/enemies/factory.ts`
- Modify: `src/config/tuning.ts`, `src/data/enemies.ts`, `src/i18n/en.ts`, `src/sim/events.ts`
- Test: new `tests/gustbox.test.ts`

**Interfaces:**
- Consumes: `Player.barrierHp` (Task 7), the profile (Task 3).
- Produces:
  - `Player.forcedStep(dir: Dir): boolean`;
  - `EnemyContext.pushPlayer(dir: Dir): boolean`;
  - `EnemyKind` gains `'gustbox'`;
  - `SimEvent` variant `{ type: 'playerPushed'; dir: Dir; x: number; y: number }`.

- [ ] **Step 1: Write the failing test**

Create `tests/gustbox.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { createEnemy } from '../src/sim/enemies/factory';
import type { Enemy } from '../src/sim/enemies/enemyBase';
import { PLAYER_ROWS } from '../src/sim/grid';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function arena(): { w: World; e: Enemy } {
  const w = new World({ seed: 14, battleIndex: 1, skipIntro: true, cheats: { god: false, aiEnabled: true } });
  for (const old of w.enemies) w.occupancy.remove(old.id, old.x, old.y);
  w.enemies = [];
  w.chips.attack = [];
  const e = createEnemy({ kind: 'gustbox', x: 1, y: 0 }, 990, w.tick);
  w.occupancy.place(e.id, 1, 0);
  w.enemies.push(e);
  return { w, e };
}

const step = (w: World) => w.step(DT, { commands: [], held: null });

function until(w: World, done: () => boolean, limit = 20): void {
  for (let i = 0; i < T(limit); i++) {
    if (done()) return;
    step(w);
  }
  expect(done(), 'condition not reached').toBe(true);
}

describe('forcedStep', () => {
  it('moves without spending the player cooldown', () => {
    const w = arena().w;
    const before = w.player.lastMoveTick;
    w.player.forcedStep('down');
    expect(w.player.y).toBe(PLAYER_ROWS.max);
    expect(w.player.cooldownLeft(w.tick)).toBe(w.player.cooldownLeft(w.tick));
    expect(w.player.lastMoveTick).not.toBe(before);
    // The player can still step at once.
    w.step(DT, { commands: [{ type: 'move', dir: 'left' }], held: null });
    expect(w.player.x).toBe(0);
  });

  it('refuses to leave the field', () => {
    const w = arena().w;
    w.player.forcedStep('down');
    expect(w.player.forcedStep('down')).toBe(false);
    expect(w.player.y).toBe(PLAYER_ROWS.max);
  });
});

describe('Gustbox', () => {
  it('pushes the player toward the back row and never damages', () => {
    const { w } = arena();
    const startHp = w.player.hp;
    until(w, () => w.player.y === PLAYER_ROWS.max);
    expect(w.player.hp).toBe(startHp);
  });

  it('blows the barrier away on the first push', () => {
    const { w } = arena();
    w.player.barrierHp = 40;
    until(w, () => w.player.barrierHp === 0);
    expect(w.player.hp).toBe(100);
  });

  it('is not a counter enemy', () => {
    const { w, e } = arena();
    for (let i = 0; i < T(10); i++) {
      expect(e.counterOpen(w.tick)).toBe(false);
      step(w);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/gustbox.test.ts`
Expected: FAIL — `forcedStep` and `'gustbox'` do not exist.

- [ ] **Step 3: Add forced movement to the player**

In `src/sim/player.ts`:

```ts
/**
 * A push from outside (Gustbox, vertical slice spec §7.2): ignores the move
 * cooldown and the buffer but still respects panels and occupancy, and does
 * not reset the player's own cooldown — the wind never steals a turn.
 */
forcedStep(dir: Dir): boolean {
  if (!this.alive || !this.canStep(dir)) return false;
  const v = DIR_VECTORS[dir];
  this.prevX = this.x;
  this.prevY = this.y;
  this.occupancy.move(this.id, this.x, this.y, this.x + v.dx, this.y + v.dy);
  this.x += v.dx;
  this.y += v.dy;
  return true;
}
```

The render slide needs a move tick, so set `this.lastMoveTick` **only when the cooldown has already expired**; otherwise the animation would cancel a step the player is still owed:

```ts
if (this.cooldownLeft(0) === 0) this.lastMoveTick = this.lastMoveTick;
```

Drop that line — instead keep `prevX/prevY` and add a dedicated field the view reads:

```ts
/** Tick of the last forced step, for the slide animation. */
lastPushTick = -Infinity;
```

set it in `forcedStep` from a `tick` parameter: `forcedStep(dir: Dir, tick: number): boolean`. In `src/render/actors.ts` `PlayerView.update`, take the later of the two ticks:

```ts
const moveTick = Math.max(player.lastMoveTick, player.lastPushTick);
const a = slideAnchor(player.prevX, player.prevY, player.x, player.y, moveTick, tick, alpha, dt);
```

Update the test above to call `w.player.forcedStep('down', w.tick)`.

- [ ] **Step 4: Expose the push on the context**

In `src/sim/enemies/enemyBase.ts` add to `EnemyContext`:

```ts
/** Forced player movement (Gustbox, spec §7.2); false when the push failed. */
pushPlayer(dir: Dir): boolean;
```

with `import type { Dir } from '../../core/input/commands';`.

In `src/sim/world.ts`:

```ts
pushPlayer(dir: Dir): boolean {
  const p = this.player;
  // The wind blows the barrier away whether or not the step lands (spec §8.7).
  if (p.barrierHp > 0) {
    p.barrierHp = 0;
    this.events.push({ type: 'barrierHit', absorbed: 0, left: 0, x: p.x, y: p.y });
  }
  if (!p.forcedStep(dir, this.tick)) return false;
  this.field.onLeave(p.prevX, p.prevY, this.tick);
  this.events.push({ type: 'playerPushed', dir, x: p.x, y: p.y });
  return true;
}
```

and the event in `src/sim/events.ts`:

```ts
/** The wind moved the player (spec §8.7). */
| { type: 'playerPushed'; dir: Dir; x: number; y: number }
```

- [ ] **Step 5: Add Gustbox**

Tuning:

```ts
gustbox: {
  HP: 140,
  /** Gustbox never damages (spec §8.7); the key exists for the profile. */
  DMG: 0,
  KNOCKBACK: 1,
  /** Spin-up before the wind starts, so it is never a surprise. */
  TELEGRAPH: 0.9,
  /** Not a counter enemy. */
  COUNTER: 0,
  /** How long the wind blows. */
  ACTIVE: 2.5,
  /** Seconds between pushes while the wind is on. */
  PUSH_INTERVAL: 0.7,
  RECOVERY: 2.0,
},
```

`enemies.ts`: `gustbox: 189`. `i18n/en.ts`: `'enemy.gustbox': 'Gustbox',`.

Create `src/sim/enemies/gustbox.ts`:

```ts
import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { COLS, ROWS, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Gustbox (vertical slice spec §8.7) — forced movement.
// Deals no damage. It spins up, then blows across the whole field, sliding
// the player one panel toward the back row every PUSH_INTERVAL. The first
// push takes the barrier with it.

export class Gustbox extends Enemy {
  readonly kind = 'gustbox';
  private lastPushTick = 0;

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.gustbox.HP, spawnTick, level);
  }

  override dangerCells(): Cell[] {
    if (this.state !== 'TELEGRAPH') return [];
    const cells: Cell[] = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) cells.push({ x, y });
    return cells;
  }

  override forceAttack(tick: number): void {
    if (this.alive && this.state === 'IDLE') this.setState('TELEGRAPH', tick);
  }

  update(ctx: EnemyContext): void {
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE':
        if (this.elapsed(t) < this.ticks(this.p.RECOVERY)) return;
        this.setState('TELEGRAPH', t);
        return;
      case 'TELEGRAPH':
        if (this.elapsed(t) < this.ticks(this.p.TELEGRAPH)) return;
        this.lastPushTick = t;
        this.setState('ATTACK', t);
        return;
      case 'ATTACK':
        if (this.elapsed(t) >= this.ticks(this.p.ACTIVE)) {
          this.setState('RECOVERY', t);
          return;
        }
        if (t - this.lastPushTick < this.ticks(this.p.PUSH_INTERVAL as number)) return;
        this.lastPushTick = t;
        ctx.pushPlayer('down');
        return;
      case 'RECOVERY':
        if (this.elapsed(t) >= this.ticks(this.p.RECOVERY)) this.setState('IDLE', t);
        return;
      case 'DEAD':
        return;
    }
  }
}
```

`'down'` is `+y` in `DIR_VECTORS` — verify against `src/core/input/commands.ts` and use whichever name moves the player toward row 5.

Extend `EnemyKind` with `'gustbox'` and register it in `factory.ts`.

- [ ] **Step 6: Run the suite and the build**

Run: `npm test`
Expected: PASS
Run: `npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
VS13: Gustbox and forced movement

- Player.forcedStep moves the player without spending the step cooldown
  and without a buffer, respecting panels and occupancy
- Gustbox spins up, blows across the field and slides the player one
  panel back per interval; the first push takes the barrier away
- Gustbox deals no damage and has no counter window

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: The encounter ladder, the test scenarios and the docs

**Files:**
- Modify: `src/data/encounters.ts`, `src/app/run.ts` (comment), `src/debug/params.ts` (comment)
- Modify: `docs/GDD.md`, `docs/BATTLE_VISUAL.md`, `docs/TERMINAL.md`
- Test: `tests/encounters.test.ts`, new `tests/fairness.test.ts`

**Interfaces:**
- Consumes: all seven enemy kinds and all ten chips.
- Produces: encounter ids `n1`…`n10`, `e1`, `e2` and `testA`…`testH`.

- [ ] **Step 1: Write the failing test**

Create `tests/fairness.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { ENEMY_SEEDS } from '../src/data/enemies';
import type { EnemyKind } from '../src/sim/enemies/enemyBase';
import { createEnemy } from '../src/sim/enemies/factory';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);
const KINDS = Object.keys(ENEMY_SEEDS) as EnemyKind[];

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

let nextId = 1200;

function arena(kind: EnemyKind) {
  const w = new World({ seed: 21, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: true } });
  for (const old of w.enemies) w.occupancy.remove(old.id, old.x, old.y);
  w.enemies = [];
  w.chips.attack = [];
  const e = createEnemy({ kind, x: 1, y: 1 }, nextId++, w.tick);
  w.occupancy.place(e.id, 1, 1);
  w.enemies.push(e);
  return { w, e };
}

describe('fairness (spec §14)', () => {
  it('gives every enemy a non-zero recovery', () => {
    for (const kind of KINDS) {
      const p = (tuning as unknown as Record<string, Record<string, number>>)[kind] as Record<string, number>;
      expect(p.RECOVERY, kind).toBeGreaterThan(0);
    }
  });

  it('telegraphs before every attack', () => {
    for (const kind of KINDS) {
      const { w, e } = arena(kind);
      let sawTelegraph = false;
      let sawAttack = false;
      for (let i = 0; i < T(25) && !sawAttack; i++) {
        if (e.state === 'TELEGRAPH') sawTelegraph = true;
        if (e.state === 'ATTACK') sawAttack = true;
        w.step(DT, { commands: [], held: null });
      }
      expect(sawAttack, `${kind} never attacked`).toBe(true);
      expect(sawTelegraph, `${kind} attacked without a telegraph`).toBe(true);
    }
  });

  it('highlights danger cells while telegraphing', () => {
    for (const kind of KINDS) {
      const { w, e } = arena(kind);
      for (let i = 0; i < T(25); i++) {
        if (e.state === 'TELEGRAPH' && e.elapsed(w.tick) > 0) break;
        w.step(DT, { commands: [], held: null });
      }
      expect(e.state, `${kind} never telegraphed`).toBe('TELEGRAPH');
      expect(e.dangerCells().length, `${kind} telegraphs nothing`).toBeGreaterThan(0);
    }
  });
});
```

In `tests/encounters.test.ts` add:

```ts
it('introduces one new enemy family per step (spec §4)', () => {
  const ladder: Record<number, string> = {
    1: 'mettik', 2: 'canodron', 3: 'bladdy', 4: 'pirak', 5: 'rollik', 6: 'stovik', 7: 'gustbox',
  };
  for (const [depth, kind] of Object.entries(ladder)) {
    const d = Number(depth);
    const fits = ENCOUNTERS.filter((e) => e.minDepth <= d && d <= e.maxDepth);
    expect(fits.some((e) => e.enemies.some((s) => s.kind === kind)), `step ${d}`).toBe(true);
    const tooEarly = ENCOUNTERS.filter((e) => e.maxDepth < d).flatMap((e) => e.enemies.map((s) => s.kind));
    expect(tooEarly).not.toContain(kind);
  }
});

it('has a scenario for each test from spec §13', () => {
  for (const id of ['testA', 'testB', 'testC', 'testD', 'testE', 'testF', 'testG', 'testH']) {
    expect(ENCOUNTERS.some((e) => e.id === id), id).toBe(true);
  }
});

it('never uses a level above 1 (spec §3)', () => {
  for (const e of ENCOUNTERS) for (const s of e.enemies) expect(s.level ?? 1).toBe(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/fairness.test.ts tests/encounters.test.ts`
Expected: FAIL — the ladder and the `test*` encounters do not exist yet.

- [ ] **Step 3: Write the ladder**

Replace `ENCOUNTERS` in `src/data/encounters.ts`. Each step adds one family; the `test*` entries are the §13 scenarios, reachable with `?encounter=testC` and kept out of the run by a depth range no step matches.

```ts
export const ENCOUNTERS: readonly Encounter[] = [
  // Ladder (vertical slice spec §4): one new family per step.
  { id: 'n1', tier: 'normal', minDepth: 1, maxDepth: 1, enemies: [e('mettik', 1, 1)] },
  { id: 'n2', tier: 'normal', minDepth: 2, maxDepth: 2, enemies: [e('mettik', 0, 2), e('canodron', 2, 0)] },
  { id: 'n3', tier: 'normal', minDepth: 3, maxDepth: 3, enemies: [e('bladdy', 1, 0), e('canodron', 0, 0)] },
  { id: 'n4', tier: 'normal', minDepth: 4, maxDepth: 4, enemies: [e('pirak', 1, 1), e('mettik', 0, 2)] },
  { id: 'e1', tier: 'elite', minDepth: 5, maxDepth: 5, enemies: [e('rollik', 1, 0), e('canodron', 0, 0), e('mettik', 2, 2)] },
  { id: 'n6', tier: 'normal', minDepth: 6, maxDepth: 6, enemies: [e('stovik', 1, 1), e('bladdy', 0, 0)] },
  { id: 'n7', tier: 'normal', minDepth: 7, maxDepth: 7, enemies: [e('gustbox', 1, 0), e('canodron', 0, 1)] },
  { id: 'e2', tier: 'elite', minDepth: 8, maxDepth: 8, enemies: [e('stovik', 1, 0), e('bladdy', 0, 1), e('pirak', 2, 2)] },
  { id: 'n9', tier: 'normal', minDepth: 9, maxDepth: 9, enemies: [e('gustbox', 0, 0), e('canodron', 2, 0), e('rollik', 1, 1)] },
  { id: 'n10', tier: 'normal', minDepth: 10, maxDepth: 10, enemies: [e('rollik', 0, 0), e('stovik', 2, 0), e('pirak', 1, 2)] },

  // Test scenarios (vertical slice spec §13); out of the run's depth range.
  { id: 'testA', tier: 'normal', minDepth: 99, maxDepth: 99, enemies: [e('mettik', 1, 1)] },
  { id: 'testB', tier: 'normal', minDepth: 99, maxDepth: 99, enemies: [e('mettik', 0, 1), e('canodron', 2, 0)] },
  { id: 'testC', tier: 'normal', minDepth: 99, maxDepth: 99, enemies: [e('bladdy', 1, 0)] },
  { id: 'testD', tier: 'normal', minDepth: 99, maxDepth: 99, enemies: [e('pirak', 1, 1)] },
  { id: 'testE', tier: 'normal', minDepth: 99, maxDepth: 99, enemies: [e('rollik', 1, 1)] },
  { id: 'testF', tier: 'normal', minDepth: 99, maxDepth: 99, enemies: [e('stovik', 1, 0), e('bladdy', 0, 1)] },
  { id: 'testG', tier: 'normal', minDepth: 99, maxDepth: 99, enemies: [e('gustbox', 1, 0), e('canodron', 0, 1)] },
  {
    id: 'testH', tier: 'normal', minDepth: 99, maxDepth: 99,
    enemies: [e('mettik', 0, 2), e('canodron', 2, 2), e('bladdy', 1, 1), e('pirak', 0, 1), e('rollik', 2, 1), e('stovik', 1, 0), e('gustbox', 0, 0)],
  },
];
```

`testH` places seven enemies on nine panels — check against `COLS × 3` and against `Occupancy` that no two share a cell.

`Run.pick()` falls back when a tier finds nothing; with one encounter per depth the elite steps 5 and 8 resolve directly. Re-read `tests/run.test.ts` — with exactly one encounter per depth, the "no repeats" assertion still holds.

- [ ] **Step 4: Play through the eight scenarios on desktop and phone**

Start `npm run dev` on desktop, then have the project owner use the Task 8B preview URL on a real phone. Open each of `?debug=1&encounter=testA&folder=basic` through `testH` (use `folder=control` for `testF`) and check the §18 Definition of Done list by hand at both desktop and narrow portrait aspect ratios. Also sample a wider/landscape viewport to catch clipped controls, CRT marks and HUD elements:

- every telegraph is visible before the hit lands;
- no damage arrives without a readable cause (use the combat overlay);
- Rollik's armor, Pirak's lock, Canodron's warning and Stovik's flame all read at a glance;
- Gustbox never makes the controls feel broken;
- no single chip dominates.

Write down anything that fails and fix it before the commit; tuning changes go into `DEFAULT_TUNING` and GDD §17.

- [ ] **Step 5: Update the documents**

`docs/GDD.md`:
- §0.1 — remove the six retired virus rows, add Pirak, Rollik, Stovik, Gustbox;
- §6.2 — the chip table becomes the ten of the slice;
- §6.4 — drop `wave`, add `shot`; cut the field-action table to `areaGrab` and `grabPanel`;
- §6.5 — replace the use-time text with the timing classes and the hit-frame list;
- §8 — rewrite the enemy sections for the seven families, each with its phases and counter window;
- §9 — add Counter and Barrier;
- §10 — the run is ten steps with no boss, elites are composition, viruses stay at level 1;
- §17 — rebuild the tunable table from the current `DEFAULT_TUNING`, including `chipTiming`, `counter` and the seven enemy groups. Mark new numbers `[оценка]` and anything you settled on a device `[решение 2026-09-20]`.

`docs/BATTLE_VISUAL.md`:
- §5.1 — the four new creatures and the removal of the Monolith art;
- §10.1 — the code map gains `sim/attacks/zone.ts`, `sim/attacks/playerShot.ts`, `debug/combatOverlay.ts`.

`docs/TERMINAL.md`:
- §6.1 — the chip icon list becomes the ten of the slice.

- [ ] **Step 6: Run the suite and the build**

Run: `npm test`
Expected: PASS
Run: `npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
VS14: the encounter ladder, the test scenarios and the docs

- the run introduces one enemy family per step, elites differ by
  composition and every virus stays at level 1
- testA..testH reproduce the eight scenarios of the slice spec and are
  reachable with ?encounter=
- fairness test: every enemy telegraphs, highlights its danger cells and
  has a real recovery
- GDD, BATTLE_VISUAL and TERMINAL follow the new content

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Definition of Done

The plan is finished when, on top of a green `npm test` and `npm run build`:

- all seven enemy families work and each one tests a different part of the combat language;
- all ten chips work;
- BASIC and CONTROL are playable end to end; RANDOM builds from the same ten chips;
- every enemy attack telegraphs, has a real active window and a real recovery;
- each counter-capable enemy has its own window, and a Counter cancels the attack and grants full synchro;
- the combat overlay explains every hit on the player;
- confirmed hits produce short, deterministic hitstop without consuming queued input or advancing combat timers;
- Gustbox does not break the controls, Stovik does not create unreadable situations, Rollik's armor and Pirak's lock read without the overlay;
- test scenarios A–H are checked on desktop and a real phone, including portrait and wider aspect ratios;
- an independent Pages preview can be opened without replacing the `main` site;
- GDD §17 matches `DEFAULT_TUNING` exactly.
