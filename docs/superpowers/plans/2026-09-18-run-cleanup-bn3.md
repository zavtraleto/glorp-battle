# Run cleanup and BN3 content: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** remove the Buster and all run progression (reward, legacy), make the run linear and easier, rebuild the chip set on MMBN3, and give the player three starting folders.

**Architecture:** the sim loses the Buster and gains a reshuffle of spent chips when the draw pile runs out. `Run` becomes a linear list of 10 encounters with a full heal after steps 3, 6 and 9. `Session` drops REWARD and LEGACY and adds GAME_OVER. The chip tray and everything that only served the reward is deleted. Content (chips, folders, encounters, enemy stats) changes as data.

**Tech Stack:** Vite + TypeScript (strict) + Three.js, Vitest.

**Spec:** decisions of the 2026-09-18 discussion (section «Решения» below). They replace parts of `docs/superpowers/specs/2026-09-17-roguelite-content-design.md` (§2, §4.4, §5, §6).

## Global Constraints

- Source of truth: **MMBN6 as the base of combat rules, MMBN3 as the source of content and systemic depth** (chips, codes, virus stats). If BN3 lacks it, use BN6 and mark it. MMBN1 is no longer a reference.
- Docs in Russian; code, comments, identifiers, commit messages in English. Player-facing strings only through `src/i18n/en.ts` / `t()`. Every new character must have a 5×7 glyph in `terminal/crt/pixelFont.ts` (a test checks every string).
- Every gameplay number goes to `src/config/tuning.ts` or to `src/data/*`; GDD §17 stays in sync with `tuning.ts`.
- New decisions in docs are marked `[решение 2026-09-18]`, estimates `[оценка]`, values from sources `[MMBN3]` / `[MMBN6]`.
- Before finishing: `npm test` and `npm run build` pass. **No commits unless the user asks.**
- Tests: `mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)))` in `beforeEach`; tick expectations from tuning via `T(...)`; keep one enemy alive when testing other systems.

---

## Решения (обсуждение 2026-09-18)

| # | Решение |
|---|---|
| 1 | Buster удалён целиком, вместе с мёртвым кодом. Урон наносят только чипы. |
| 2 | Ориентир: MMBN6 — фундамент боя, MMBN3 — контент и системная глубина. MMBN1 больше не ориентир. |
| 3 | Развития в забеге нет: папка за забег не меняется. |
| 4 | Экрана REWARD нет, наследия и поколений нет. Лоток удаляется целиком. |
| 5 | Чипы сверены с MMBN3; чипы, которых нет в BN3, удалены. Новых механик не добавляем (Barrier, Vulcan, Guard отложены). |
| 6 | Три стартовые папки по 30 чипов: BASIC, FIELD (средний уровень, чипы поля), RANDOM (случайная по правилам). Выбор — тремя кнопками на титуле. |
| 7 | Сложность ощутимо ниже: множители уровней, мягкие встречи, босс 400 HP, статы вирусов по BN3. |
| А | Очередь добора пуста → использованные чипы перемешиваются и возвращаются в неё. |
| Г | HP переносится, но полностью восстанавливается после побед на шагах 3, 6 и 9. |
| Д | Путь линейный: 10 боёв подряд, выбора нет. |

### Чипы по MMBN3 (MMKB, «List of Mega Man Battle Network 3 Battle Chips»)

| id | Имя (UI) | Урон | Коды BN3 | Форма / эффект | Редкость | Изменение |
|---|---|---|---|---|---|---|
| `cannon` | Cannon | 40 | A B C D E * | `lane` | common | + код `*` |
| `hicannon` | HiCannon | **60** | H I J K L * | `lane` | uncommon | урон 80→60, коды |
| `mcannon` | M-Cannon | **80** | O P Q R S | `lane` | rare | урон 120→80, коды |
| `airshot` | AirShot | 20 | * | `lane`, отталкивание | common | — |
| `shotgun` | ShotGun | 30 | B F J N T * | `lane` + клетка за целью | common | коды, имя ShotGun |
| `vgun` | V-Gun | 30 | D G L P V * | `lane` + 2 по диагонали за целью | common | коды |
| `sidegun` | SideGun | 30 | C H M S Y * | `lane` + клетки по бокам цели | common | коды |
| `spreader` | Spreader | 30 | M N O P Q * | `lane` + 3×3 | uncommon | + `*` |
| `sword` | Sword | 80 | E H L S Y | `near` 1 | common | коды |
| `widesword` | WideSwrd | 80 | C E L Q Y | `near` ряд из 3 | uncommon | коды, имя |
| `longsword` | LongSwrd | 80 | E I L R Y | `near` 2 | uncommon | коды, имя |
| `minibomb` | MiniBomb | 50 | B G L O S * | `lob` 3 | common | коды |
| `shockwave` | ShockWav | 60 | D H J L R | `wave` | common | коды, имя |
| `zapring` | ZapRing1 | 20 | A M P Q S * | `lane`, паралич | common | коды, имя |
| `recov10` | Recov10 | +10 | A C E G L * | `self` | common | + `*` |
| `recov30` | Recov30 | +30 | B D F H M * | `self` | common | **новый** |
| `recover50` | Recov50 | +50 | C E G I N * | `self` | uncommon | коды, имя |
| `recov80` | Recov80 | +80 | D F H J O * | `self` | rare | коды |
| `invis` | Invis | — | B E F R S * | невидимость | uncommon | коды |
| `geddon1` | Geddon1 | — | D J M O S * | трещины на всех свободных клетках | uncommon | коды |
| `geddon2` | Geddon2 | — | F H N O W | дыры на свободных клетках врага (в BN3 — на всём поле) | rare | коды; отступление сохраняется |
| `areagrab` | AreaGrab | — | E L R S Y * | захват ближнего вражеского ряда | uncommon | **переименован из `steal`** |
| `panlgrab` | PanlGrab | — | A H L S Y * | захват ближней вражеской клетки в своей колонке | common | **новый** (`grabPanel`) |
| `panlout1` | PanlOut1 | — | A B D L S * | дыра на клетке впереди | common | **новый** (`breakAhead`) |
| `panlout3` | PanlOut3 | — | C E N R Y | дыры на ряду из 3 клеток впереди | uncommon | **новый** (`breakRowAhead`) |
| `repair` | Repair | — | A C D F S * | свои клетки → `NORMAL` | common | коды |
| `rockcube` | RockCube | — | A C E H R * | камень впереди | common | коды |

Удаляются (нет в BN3): **LilBomb, CrosBomb, Quake1, Crack**. `onHit.panel` остаётся без пользователей и удаляется вместе с ними; field action `crackRow` тоже.

Дыры от PanlOut1/PanlOut3 бьют и по своей клетке (как в BN3): если клетка впереди своя, получится своя дыра. Под персонажем или объектом `breakPanel` даёт только трещину (правило §3.2 спеки).

### Вирусы: уровень 1 по MMBN3

| Враг | Было HP / урон | BN3 | Станет |
|---|---|---|---|
| Mettik (Mettaur) | 40 / 10 | 40 / 10 | 40 / 10 |
| Canodron (Canodumb) | 50 / 10 | 60 / 10 | 60 / 10 |
| Spiker (Spikey) | 90 / 20 | 90 / 30 | 90 / 30 |
| Hopzap (Bunny) | 40 / 20 | 40 / 15 | 40 / 15 |
| Bladdy (Swordy) | 90 / 80 | 90 / 30 | 90 / 30 |
| Rattik (Ratty) | 40 / 20 | 40 / 20 | 40 / 20 |
| Helmhead (HardHead) | 80 / 30 | 80 / 60 | 80 / 60 |
| Finnik (Fishy) | 90 / 30 | 90 / 30 | 90 / 30 |
| Punchy (Champy) | 60 / 30 | нет в BN3 | **удалён** [решение 2026-09-18], позже добавим новый вирус |
| Monolith (StoneMan) | 600 | нет в BN3 | **400** `[решение]` |

Варианты уровня 2 в BN3 (Mettaur2 60/40, Swordy2 140/60, …) рассчитаны на выросший HP игрока; при HP 100 берём свои множители `[решение 2026-09-18]`: уровень 2 — HP ×1.5, урон ×1.5, скорость ×1.1; уровень 3 — ×2 / ×2 / ×1.2.

---

## File structure

| File | Change |
|---|---|
| `src/sim/buster.ts`, `tests/buster.test.ts` | delete |
| `src/sim/world.ts` | no Buster; `Cheats.buster` gone; field actions updated; `onHit.panel` gone |
| `src/sim/events.ts`, `src/render/fx.ts`, `src/config/tuning.ts`, `src/debug/debugPanel.ts`, `src/main.ts` | Buster traces removed |
| `src/sim/chips/chipSystem.ts` | reshuffle spent chips; `legacyGen` gone |
| `src/app/reward.ts`, `src/app/legacyStore.ts` | delete |
| `src/terminal/parts/chipTray.ts`, `src/terminal/interaction/trayInput.ts` | delete |
| `src/terminal/chips/trayLayout.ts` | keep rail geometry only; rename to `railLayout.ts` |
| `src/terminal/terminal.ts`, `terminalMode.ts`, `crt/menuModel.ts`, `crt/hudModel.ts`, `chips/chipFace.ts`, `chips/cartridge.ts`, `parts/chipRail.ts` | tray, reward and legacy removed; title with three starts; GAME_OVER |
| `src/app/run.ts` | linear run, heal after 3/6/9, no reward |
| `src/app/session.ts` | `start(folder)`, GAME_OVER, no REWARD/LEGACY |
| `src/data/chips.ts`, `src/i18n/en.ts`, `src/terminal/chips/chipIcons.ts` | BN3 catalogue |
| `src/data/folders.ts` | `basic`, `field`, `all` (debug); replaces `mvp/p1/p2` and `starterFolder.ts` |
| `src/app/randomFolder.ts` (new) | RANDOM folder generator, pure |
| `src/data/enemies.ts`, `src/data/encounters.ts`, `src/config/tuning.ts` | difficulty |
| `docs/GDD.md`, `docs/TERMINAL.md`, `docs/BATTLE_VISUAL.md`, roguelite spec, `CLAUDE.md`, `README.md` | docs |

---

### Task 1: Remove the Buster

**Files:**
- Delete: `src/sim/buster.ts`, `tests/buster.test.ts`
- Modify: `src/sim/world.ts` (import, `Cheats.buster`, `readonly buster`, `fireBuster()`, the `this.buster.tick(...)` line), `src/sim/events.ts` (`busterShot`), `src/render/fx.ts` (`case 'busterShot'`), `src/config/tuning.ts` (group `buster`, `fx.BUSTER_TRACER_TIME`), `src/debug/debugPanel.ts` (`auto buster` toggle), `src/main.ts` (`buster: true` in cheats)
- Modify tests: `tests/chipUse.test.ts:21-22`, `tests/encounters.test.ts:66`, `tests/enemies.test.ts:248`, `tests/field.test.ts:85,117,156-162`, `tests/session.test.ts:30`, `tests/viruses.test.ts:19` — drop `buster: false` and the `BUSTER_INTERVAL` override

- [ ] **Step 1:** Rewrite the rock test in `tests/field.test.ts:156` so a chip, not the Buster, hits the rock:

```ts
  it('stops chips and enemy shots, and breaks at 0 HP', () => {
    const w = world();
    w.placeObject('rock', 1, 3, 'player');
    const rock = w.objects[0]!;
    w.giveChip('cannon');
    fire(w); // helper already used in this file to select slot 0 and use it
    wait(w, T(tuning.chips.CHIP_HIT_FRAME) + 1);
    expect(rock.hp).toBe(tuning.field.ROCK_HP - CHIPS.cannon.power!);
  });
```

If `field.test.ts` has no `fire` helper, copy `useNow` from `tests/chipUse.test.ts` into it. Adapt the name of `placeObject` to whatever `World` exposes (check `grep -n "placeObject" src/sim/world.ts`).

- [ ] **Step 2:** Delete the Buster code listed above. `grep -rni buster src tests` must return nothing.
- [ ] **Step 3:** Run `npm test` and `npm run typecheck`. Expected: PASS.

### Task 2: Reshuffle spent chips when the draw pile is empty

**Files:**
- Modify: `src/sim/chips/chipSystem.ts`
- Test: `tests/chipHand.test.ts`

**Interfaces:**
- Produces: `ChipSystem.reshuffles: number` (how many times spent chips went back); event `{ type: 'drawReshuffled'; count: number }` in `src/sim/events.ts`, pushed by `World` when `chips.reshuffles` grows (FX/terminal may ignore it for now; the debug log shows it).

- [ ] **Step 1: failing test**

```ts
  it('reshuffles spent chips into the draw pile when it runs dry', () => {
    const folder = Array.from({ length: 6 }, () => ({ defId: 'cannon' as const, code: 'A' as const }));
    const cs = new ChipSystem(folder, new Rng(1));
    cs.dealHand(); // 5 in hand, 1 in the pile
    for (let i = 0; i < 3; i++) {
      cs.toggleSelect(i);
      cs.takeNext();
    }
    cs.refresh(); // draws the last pile chip, then the 3 spent ones come back
    expect(cs.hand.every((c) => c !== null)).toBe(true);
    expect(cs.reshuffles).toBe(1);
    expect(cs.count('used')).toBe(0);
  });

  it('keeps empty slots when nothing was spent yet', () => {
    const folder = Array.from({ length: 3 }, () => ({ defId: 'cannon' as const, code: 'A' as const }));
    const cs = new ChipSystem(folder, new Rng(1));
    cs.dealHand();
    expect(cs.hand.filter((c) => c === null)).toHaveLength(2);
    expect(cs.reshuffles).toBe(0);
  });
```

- [ ] **Step 2:** `npx vitest run tests/chipHand.test.ts` → FAIL (`reshuffles` undefined).
- [ ] **Step 3: implement.** Keep the `Rng` in the system and refill the pile from `used` chips:

```ts
  /** Times the spent chips went back into the draw pile (GDD §7.5). */
  reshuffles = 0;

  constructor(folder: FolderId | readonly FolderChip[], private readonly rng: Rng) { ... }

  private draw(): ChipInstance | null {
    if (this.drawIndex >= this.drawPile.length) this.reshuffleSpent();
    const chip = this.drawPile[this.drawIndex];
    ...
  }

  /** Empty pile: every spent chip is shuffled back in (decision 2026-09-18). */
  private reshuffleSpent(): void {
    const spent = this.chips.filter((c) => c.state === 'used');
    if (spent.length === 0) return;
    for (const c of spent) c.state = 'folder';
    this.drawPile.length = 0;
    this.drawPile.push(...this.rng.shuffle(spent));
    this.drawIndex = 0;
    this.reshuffles++;
  }
```

`drawPile` must stop being `readonly`-reassigned (it is mutated in place above, which is fine). `drawPreview` keeps reading `drawPile` from `drawIndex`.
- [ ] **Step 4:** In `World`, after `this.chips.refresh()`, push `drawReshuffled` when `reshuffles` grew. Add the event type to `SimEvent`.
- [ ] **Step 5:** `npm test` → PASS.

### Task 3: Delete the reward and the chip tray

**Files:**
- Delete: `src/app/reward.ts`, `src/terminal/parts/chipTray.ts`, `src/terminal/interaction/trayInput.ts`, `tests/terminalTray.test.ts`
- Rename: `src/terminal/chips/trayLayout.ts` → `src/terminal/chips/railLayout.ts`; keep `RAIL_LEFT`, `RAIL_SLOTS`, `RAIL_SPAN`, `CHIP_TEXELS_W/H` and rail helpers; drop `TrayLayout`, `trayLayout`, `trayTargetAt`, `TrayTarget`
- Modify: `src/terminal/terminal.ts` (all `tray*` members, `traySource`, `syncTray`, `trayKey`, `TRAY_READY`, `TRAY_COLUMNS`, `reward.title`), `src/terminal/terminalMode.ts` (mode `CHIP_SELECT` removed), `src/terminal/controlRules.ts` (`trayKeyAction`), `src/terminal/parts/chipRail.ts` (the `select` mode used by the reward tray), `src/terminal/crt/hudModel.ts` (chip description / heading for REWARD), `src/app/run.ts` (`rewardChoices`, `addChip`, `WEIGHTS`), `src/app/session.ts` (`reward`, `takeReward`, `skipReward`, `finishReward`, screen `REWARD`), `src/i18n/en.ts` (`reward.title`, `tray.skip`, `custom.ok`, `custom.add`), `tuning.terminal.TRAY_SLIDE_TIME` if nothing else reads it
- Modify tests that import any of the above: `tests/terminal.test.ts`, `tests/terminalHud.test.ts`, `tests/terminalControls.test.ts`, `tests/terminalRail.test.ts`, `tests/run.test.ts`, `tests/session.test.ts`

- [ ] **Step 1:** Change `Session.update()` so a won battle goes straight back to `PATH` (Task 5 finishes the linear path). Update the session test that expected `REWARD` to expect `PATH`:

```ts
    expect(s.screen).toBe('PATH');
    expect(s.run!.depth).toBe(2);
```

- [ ] **Step 2:** Delete the files and members listed above. Follow the compiler: `npm run typecheck` until clean. Anything that only served the tray goes; anything the rail still uses stays.
- [ ] **Step 3:** `grep -rniE "reward|tray|CHIP_SELECT" src tests` returns only unrelated hits (none expected besides comments you must also fix).
- [ ] **Step 4:** `npm test` → PASS.

### Task 4: Remove legacy and generations; GAME_OVER screen

**Files:**
- Delete: `src/app/legacyStore.ts`
- Modify: `src/app/session.ts`, `src/app/run.ts` (constructor `generation`, `legacy`, `folderSummary`), `src/sim/chips/chipSystem.ts` (`legacyGen`), `src/terminal/chips/chipFace.ts` (legacy mark, colours), `src/terminal/chips/cartridge.ts`, `src/terminal/parts/chipRail.ts` (`legacyGen`), `src/terminal/crt/menuModel.ts`, `src/main.ts` (menu `legacy:`, debug actions, overlay `gen`), `src/debug/debugPanel.ts` (generation, clear legacy), `src/i18n/en.ts` (`title.generation`, `legacy.*`)
- Tests: `tests/run.test.ts`, `tests/session.test.ts`, `tests/terminalMenu.test.ts`, `tests/chipFace.test.ts`

**Interfaces:**
- Produces: `Screen = 'TITLE' | 'PATH' | 'BATTLE' | 'PAUSED' | 'GAME_OVER' | 'COMPLETE'`; `Session.toTitle()` works from `GAME_OVER` and `COMPLETE`; `SessionOptions.storage` is removed.

- [ ] **Step 1: failing tests** in `tests/session.test.ts`:

```ts
  it('death leads to GAME OVER, then back to the title', () => {
    const s = session();
    s.start(); // Task 5/7 change this to s.start('basic'); s.fight();
    s.choosePath(0);
    s.world.player.hp = 0;
    s.world.player.dead = true; // use whatever the existing death tests use to kill the player
    stepUntil(s, () => s.screen === 'GAME_OVER');
    s.toTitle();
    expect(s.screen).toBe('TITLE');
  });
```

and in `tests/terminalMenu.test.ts`:

```ts
  it('GAME OVER shows the step reached and one Title item', () => {
    const spec = menuFor({ ...base, screen: 'GAME_OVER', depth: 4 })!;
    expect(spec.tone).toBe('lose');
    expect(spec.title).toBe(t('banner.gameOver'));
    expect(spec.rows[0]).toEqual([t('result.step'), '04/10']);
    expect(spec.items).toEqual([{ label: t('btn.title'), action: 'title' }]);
  });
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: implement.**
  - `Session`: death and `abandon()` set `screen = 'GAME_OVER'`; `toTitle()` accepts `GAME_OVER` and `COMPLETE`; remove `legacy`, `storage`, `generation`, `legacyChoices`, `chooseLegacy`, `debugClearLegacy`, `debugSetGeneration`.
  - `menuModel`: case `GAME_OVER` — title `banner.gameOver`, rows: step reached (`result.step`, `NN/10`), total time, hits; item `btn.title`. `MenuAction` loses `legacy:`. `MenuSession` loses `generation` and `legacyChoices`. Menu keys drop `generation`.
  - New string `'result.step': 'Step'`.
  - Remove `legacyGen` everywhere (`FolderChip`, `ChipInstance`, cartridge, chip face cache key).
- [ ] **Step 4:** `npm test` → PASS; `grep -rniE "legacy|generation" src tests` → nothing.

### Task 5: Linear run with a heal every three steps

**Files:**
- Modify: `src/app/run.ts`, `src/app/session.ts`, `src/terminal/crt/menuModel.ts`, `src/i18n/en.ts`, `src/main.ts` (menu action `fight`)
- Test: `tests/run.test.ts`, `tests/session.test.ts`, `tests/terminalMenu.test.ts`

**Interfaces:**
- Produces:
  - `Run.encounter: Encounter` — the battle of the current step (replaces `options` / `choose()` / `current`).
  - `Run.healed: boolean` — true right after a heal step, for the PATH screen line.
  - `export const HEAL_EVERY = 3;` in `run.ts`; `export const ELITE_STEPS: readonly number[] = [5, 8];`
  - `Session.fight()` replaces `choosePath(index)`; menu action `'fight'` replaces `path:${n}`.
  - `Session.start(folder: StartFolder)` where `type StartFolder = 'basic' | 'field' | 'random'` (Task 7 fills the folders; here pass the id through to `Run`).

- [ ] **Step 1: failing tests** (`tests/run.test.ts`):

```ts
  it('is ten battles in a fixed order for a seed, boss last, no repeats', () => {
    const a = new Run(5, 'basic');
    const b = new Run(5, 'basic');
    const ids: string[] = [];
    for (let d = 1; d <= RUN_STEPS; d++) {
      expect(a.encounter.id).toBe(b.encounter.id);
      ids.push(a.encounter.id);
      a.finishBattle(true, a.hp);
      b.finishBattle(true, b.hp);
    }
    expect(ids[RUN_STEPS - 1]).toBe('boss');
    expect(new Set(ids).size).toBe(RUN_STEPS);
  });

  it('puts elites on ELITE_STEPS only', () => {
    const r = new Run(9, 'basic');
    for (let d = 1; d < RUN_STEPS; d++) {
      expect(r.encounter.tier).toBe(ELITE_STEPS.includes(d) ? 'elite' : 'normal');
      r.finishBattle(true, r.hp);
    }
  });

  it('carries HP and heals fully after steps 3, 6 and 9', () => {
    const r = new Run(1, 'basic');
    r.finishBattle(true, 40); // step 1
    expect(r.hp).toBe(40);
    r.finishBattle(true, 30); // step 2
    r.finishBattle(true, 20); // step 3 → heal
    expect(r.hp).toBe(r.maxHp);
    expect(r.healed).toBe(true);
    r.finishBattle(true, 70); // step 4
    expect(r.healed).toBe(false);
    expect(r.hp).toBe(70);
  });
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: implement `Run`.**

```ts
export const RUN_STEPS = 10;
/** Full heal after every this many won steps (decision 2026-09-18). */
export const HEAL_EVERY = 3;
/** Steps that are elite battles. [оценка] */
export const ELITE_STEPS: readonly number[] = [5, 8];

export class Run {
  depth = 1;
  hp: number;
  readonly maxHp = tuning.player.PLAYER_MAX_HP;
  readonly folder: FolderChip[];
  encounter: Encounter;
  healed = false;
  readonly history: RunStep[] = [];

  constructor(readonly seed: number, readonly folderId: StartFolder) {
    this.hp = this.maxHp;
    this.folder = startFolder(folderId, new Rng(deriveSeed(seed, 'folder')));
    this.encounter = this.pick();
  }

  private tierAt(depth: number): EncounterTier {
    if (depth >= RUN_STEPS) return 'boss';
    return ELITE_STEPS.includes(depth) ? 'elite' : 'normal';
  }

  /** Seeded pick from the encounters that fit this step; unplayed first. */
  private pick(): Encounter {
    const tier = this.tierAt(this.depth);
    const played = new Set(this.history.map((s) => s.id));
    const fits = ENCOUNTERS.filter((e) => e.tier === tier && e.minDepth <= this.depth && this.depth <= e.maxDepth);
    const fresh = fits.filter((e) => !played.has(e.id));
    const rng = new Rng(deriveSeed(this.seed, `path/${this.depth}`));
    return rng.pick(fresh.length > 0 ? fresh : fits);
  }

  finishBattle(won: boolean, hpLeft: number): void {
    this.history.push({ id: this.encounter.id, kind: this.encounter.tier, won });
    this.hp = Math.max(0, Math.min(this.maxHp, hpLeft));
    this.healed = false;
    if (!won || this.complete) return;
    if (this.depth % HEAL_EVERY === 0) {
      this.hp = this.maxHp;
      this.healed = true;
    }
    this.depth++;
    this.encounter = this.pick();
  }
}
```

`startFolder` comes from Task 7; until then use `folderChips('basic')` from `data/folders.ts` (Task 7 replaces it). Keep `battleSeed()`, `complete`, `jumpTo()` (it re-picks `encounter`).
- [ ] **Step 4: PATH screen.** `menuModel` case `PATH`: title `STEP NN/10`, subtitle `path.healed` («HP restored») when `healed`, else `path.next` with the kind (`Battle x{n}` / `Elite x{n}` / `Boss`); rows HP and folder size; one item `path.fight` → action `'fight'`; hint `path.hint` = «HP restores every 3 battles.». `MenuSession.path` becomes `next: { kind, enemies }` and `healed: boolean`.
- [ ] **Step 5:** New strings: `'path.fight': 'Fight'`, `'path.healed': 'HP restored'`, `'path.next': 'Next battle'`; remove `path.subtitle`. Check that every character has a glyph (the pixel font test will fail otherwise).
- [ ] **Step 6:** `npm test` → PASS.

### Task 6: BN3 chip catalogue

**Files:**
- Modify: `src/data/chips.ts`, `src/sim/world.ts` (`applyFieldAction`, `hitCells` `onHit.panel` branch), `src/i18n/en.ts`, `src/terminal/chips/chipIcons.ts`, `src/debug/debugPanel.ts` + `src/main.ts` (debug `simPanel` action `'steal'` → `'grab'`)
- Test: `tests/chipUse.test.ts`, `tests/chips.test.ts`

**Interfaces:**
- Produces: `ChipId` = `'cannon' | 'hicannon' | 'mcannon' | 'airshot' | 'shotgun' | 'vgun' | 'sidegun' | 'spreader' | 'sword' | 'widesword' | 'longsword' | 'minibomb' | 'shockwave' | 'zapring' | 'recov10' | 'recov30' | 'recover50' | 'recov80' | 'invis' | 'geddon1' | 'geddon2' | 'areagrab' | 'panlgrab' | 'panlout1' | 'panlout3' | 'repair' | 'rockcube'`
- `FieldAction = 'crackAll' | 'breakEnemy' | 'areaGrab' | 'grabPanel' | 'breakAhead' | 'breakRowAhead' | 'repair' | 'rock'`
- `OnHit = { push?: true; paralyze?: true }`

- [ ] **Step 1: failing tests** (`tests/chipUse.test.ts`; replace the LilBomb, CrosBomb, Quake1, Crack tests; rename the Steal test to AreaGrab):

```ts
  it('PanlGrab takes the nearest free enemy panel in the player lane', () => {
    const w = world(); // player at (1,4), one enemy kept away from x=1
    useNow(w, 'panlgrab');
    expect(w.field.owner(1, 2)).toBe('player');
    expect(w.field.owner(0, 2)).toBe('enemy');
  });

  it('PanlOut1 breaks the panel right in front', () => {
    const w = world();
    w.player.y = 3; // standing on the border row: the panel ahead is the enemy's (1,2)
    useNow(w, 'panlout1');
    expect(w.field.panel(1, 2)).toBe('BROKEN');
  });

  it('PanlOut3 breaks the row of three in front, cracks occupied ones', () => {
    const w = world();
    w.player.y = 3;
    const e = w.enemies[0]!;
    moveEnemyTo(w, e, 0, 2); // helper used by other tests; place the enemy on (0,2)
    useNow(w, 'panlout3');
    expect(w.field.panel(0, 2)).toBe('CRACKED');
    expect(w.field.panel(1, 2)).toBe('BROKEN');
    expect(w.field.panel(2, 2)).toBe('BROKEN');
  });
```

In `tests/chips.test.ts`, add a table check that pins the BN3 values:

```ts
  it.each([
    ['cannon', 40], ['hicannon', 60], ['mcannon', 80], ['longsword', 80], ['minibomb', 50], ['shockwave', 60], ['zapring', 20],
  ] as const)('%s deals %i (MMBN3)', (id, power) => {
    expect(CHIPS[id].power).toBe(power);
  });

  it('every chip has a name, a description and an icon', () => {
    for (const id of Object.keys(CHIPS) as ChipId[]) {
      expect(chipName(id).length).toBeLessThanOrEqual(9);
      expect(chipDesc(id).length).toBeGreaterThan(0);
      expect(CHIP_ICONS[id]).toBeDefined();
    }
  });
```

(Use the real export names of the icon table and the i18n helpers; check with `grep -n "export" src/terminal/chips/chipIcons.ts src/i18n/index.ts`.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: data.** Rewrite `CHIPS` from the table in «Чипы по MMBN3». New entries:

```ts
  recov30: { id: 'recov30', power: null, kind: 'support', useTime: 'RECOVER', codes: ['B', 'D', 'F', 'H', 'M', '*'], rarity: 'common', shape: { t: 'self' }, heal: 30 },
  areagrab: { id: 'areagrab', ...FIELD_CHIP, codes: ['E', 'L', 'R', 'S', 'Y', '*'], rarity: 'uncommon', field: 'areaGrab' },
  panlgrab: { id: 'panlgrab', ...FIELD_CHIP, codes: ['A', 'H', 'L', 'S', 'Y', '*'], rarity: 'common', field: 'grabPanel' },
  panlout1: { id: 'panlout1', ...FIELD_CHIP, codes: ['A', 'B', 'D', 'L', 'S', '*'], rarity: 'common', field: 'breakAhead' },
  panlout3: { id: 'panlout3', ...FIELD_CHIP, codes: ['C', 'E', 'N', 'R', 'Y'], rarity: 'uncommon', field: 'breakRowAhead' },
```

Header comment: «Values and codes follow MMBN3 (MMKB chip list)».
- [ ] **Step 4: field actions** in `World.applyFieldAction`:

```ts
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
      case 'breakAhead':
        if (p.y - 1 >= 0) f.breakPanel(p.x, p.y - 1, this.tick, !free(p.x, p.y - 1));
        return;
      case 'breakRowAhead':
        if (p.y - 1 < 0) return;
        for (let x = 0; x < COLS; x++) f.breakPanel(x, p.y - 1, this.tick, !free(x, p.y - 1));
        return;
```

Check the fourth argument of `field.breakPanel` (`grep -n "breakPanel(" src/sim/field.ts`) and pass what makes an occupied panel only crack, as the spec §3.2 requires. Remove `crackRow` and the `onHit.panel` branch in `hitCells`.
- [ ] **Step 5: strings and icons.** `en.ts`: remove lilbomb, crosbomb, quake1, crack, steal; add:

```ts
  'chip.recov30.name': 'Recov30',
  'chip.recov30.desc': 'Restores 30 HP.',
  'chip.areagrab.name': 'AreaGrab',
  'chip.areagrab.desc': 'Takes the nearest enemy row for a while.',
  'chip.panlgrab.name': 'PanlGrab',
  'chip.panlgrab.desc': 'Takes the nearest enemy panel in your lane.',
  'chip.panlout1.name': 'PanlOut1',
  'chip.panlout1.desc': 'Breaks the panel in front of you.',
  'chip.panlout3.name': 'PanlOut3',
  'chip.panlout3.desc': 'Breaks the row of 3 panels in front of you.',
```

Rename displayed names to BN3 spellings: `ShotGun`, `WideSwrd`, `LongSwrd`, `ShockWav`, `ZapRing1`, `Recov50`. Icons: `recov30` reuses the recover icon, `areagrab` takes the old `steal` icon, `panlgrab` reuses it, `panlout1`/`panlout3` reuse the old `crack` icon; remove the deleted chips.
- [ ] **Step 6:** `npm test` → PASS.

### Task 7: Three starting folders and the title

**Files:**
- Modify: `src/data/folders.ts` (ids `basic`, `field`, `all`), `src/sim/world.ts` (default folder `'basic'`), `src/debug/params.ts` + `src/debug/debugPanel.ts` (folder ids), `tests/core.test.ts`, `tests/session.test.ts`
- Delete: `src/data/starterFolder.ts`
- Create: `src/app/randomFolder.ts`, `tests/randomFolder.test.ts`
- Modify: `src/app/run.ts` (`startFolder`), `src/app/session.ts` (`start(folder)`), `src/terminal/crt/menuModel.ts` (title items), `src/main.ts` (menu actions `start:basic|field|random`), `src/i18n/en.ts`

**Interfaces:**
- Produces:
  - `export type FolderId = 'basic' | 'field' | 'all';` (`all` = debug, one of every chip; replaces `p2`)
  - `export type StartFolder = 'basic' | 'field' | 'random';` in `src/app/run.ts`
  - `export function randomFolder(rng: Rng): FolderChip[]` in `src/app/randomFolder.ts`
  - `export function startFolder(id: StartFolder, rng: Rng): FolderChip[]` in `src/app/run.ts`
  - `MenuAction` gets `` `start:${StartFolder}` `` in place of `'start'`

- [ ] **Step 1: folders data** (`src/data/folders.ts`), all codes from the BN3 table:

```ts
export const FOLDERS: Record<FolderId, readonly FolderEntry[]> = {
  /** Starting folder: guns, swords and bombs on codes B / L / S, two field chips. */
  basic: [
    { chip: 'cannon', code: 'A', count: 2 },
    { chip: 'cannon', code: 'B', count: 2 },
    { chip: 'airshot', code: '*', count: 2 },
    { chip: 'shotgun', code: 'B', count: 2 },
    { chip: 'vgun', code: 'L', count: 2 },
    { chip: 'sidegun', code: 'S', count: 2 },
    { chip: 'sword', code: 'S', count: 2 },
    { chip: 'sword', code: 'L', count: 1 },
    { chip: 'widesword', code: 'L', count: 2 },
    { chip: 'longsword', code: 'L', count: 1 },
    { chip: 'minibomb', code: 'B', count: 2 },
    { chip: 'minibomb', code: 'L', count: 1 },
    { chip: 'shockwave', code: 'L', count: 2 },
    { chip: 'zapring', code: 'S', count: 1 },
    { chip: 'panlout1', code: 'L', count: 1 },
    { chip: 'areagrab', code: 'S', count: 1 },
    { chip: 'recov10', code: 'L', count: 2 },
    { chip: 'recov30', code: 'B', count: 2 },
  ],
  /** Mid-level folder built around panels: grab, break, crack, rocks. */
  field: [
    { chip: 'hicannon', code: 'L', count: 2 },
    { chip: 'cannon', code: 'B', count: 2 },
    { chip: 'airshot', code: '*', count: 2 },
    { chip: 'spreader', code: 'M', count: 2 },
    { chip: 'sword', code: 'S', count: 2 },
    { chip: 'widesword', code: 'L', count: 2 },
    { chip: 'longsword', code: 'L', count: 2 },
    { chip: 'minibomb', code: 'L', count: 2 },
    { chip: 'shockwave', code: 'L', count: 2 },
    { chip: 'zapring', code: 'S', count: 1 },
    { chip: 'areagrab', code: 'L', count: 2 },
    { chip: 'panlgrab', code: 'L', count: 1 },
    { chip: 'panlout3', code: 'E', count: 1 },
    { chip: 'panlout1', code: 'L', count: 1 },
    { chip: 'geddon1', code: 'S', count: 1 },
    { chip: 'rockcube', code: '*', count: 1 },
    { chip: 'repair', code: '*', count: 1 },
    { chip: 'recov30', code: 'M', count: 2 },
    { chip: 'invis', code: 'S', count: 1 },
  ],
  /** Debug: one of every chip with its first code. */
  all: (Object.values(CHIPS) as ChipDef[]).map((d) => ({ chip: d.id, code: d.codes[0] as ChipCode, count: 1 })),
};
```

`FOLDER_SIZE` = 30 stays; the size check in `tests/chips.test.ts` applies to `basic` and `field` only.
- [ ] **Step 2: failing tests** (`tests/randomFolder.test.ts`):

```ts
describe('randomFolder', () => {
  it.each([1, 2, 3, 42, 999])('seed %i follows the rules', (seed) => {
    const f = randomFolder(new Rng(seed));
    expect(f).toHaveLength(FOLDER_SIZE);
    const counts = new Map<string, number>();
    for (const c of f) counts.set(c.defId, (counts.get(c.defId) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(RANDOM_MAX_COPIES);
    expect(f.filter((c) => CHIPS[c.defId].heal).length).toBeGreaterThanOrEqual(RANDOM_MIN_HEALS);
    expect(f.filter((c) => CHIPS[c.defId].kind === 'field').length).toBeLessThanOrEqual(RANDOM_MAX_FIELD);
    for (const c of f) expect(CHIPS[c.defId].codes).toContain(c.code);
  });

  it('is deterministic', () => {
    expect(randomFolder(new Rng(7))).toEqual(randomFolder(new Rng(7)));
  });
});
```

- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4: implement** `src/app/randomFolder.ts`:

```ts
import type { Rng } from '../core/rng';
import { CHIPS, type ChipCode, type ChipDef, type Rarity } from '../data/chips';
import { FOLDER_SIZE } from '../data/folders';
import type { FolderChip } from '../sim/chips/chipSystem';

// RANDOM starting folder (decision 2026-09-18): weighted by rarity, capped
// copies, a few heals, few field chips, codes leaning on three "core" codes so
// multi-selections sometimes line up. Pure and seeded.

export const RANDOM_MAX_COPIES = 4;
export const RANDOM_MIN_HEALS = 3;
export const RANDOM_MAX_FIELD = 4;
/** Chance a chip takes a core code when it has one. [оценка] */
const CORE_CODE_CHANCE = 0.7;
const CORE_CODES = 3;
const WEIGHT: Record<Rarity, number> = { common: 6, uncommon: 3, rare: 1 };

function weightedPick(rng: Rng, pool: readonly ChipDef[]): ChipDef {
  const total = pool.reduce((s, d) => s + WEIGHT[d.rarity], 0);
  let roll = rng.next() * total;
  for (const d of pool) {
    roll -= WEIGHT[d.rarity];
    if (roll < 0) return d;
  }
  return pool[pool.length - 1] as ChipDef;
}

export function randomFolder(rng: Rng): FolderChip[] {
  const all = Object.values(CHIPS);
  const letters = [...new Set(all.flatMap((d) => d.codes).filter((c) => c !== '*'))];
  const core = rng.shuffle(letters).slice(0, CORE_CODES);
  const counts = new Map<string, number>();
  const picked: ChipDef[] = [];
  const take = (pool: readonly ChipDef[]) => {
    const open = pool.filter((d) => (counts.get(d.id) ?? 0) < RANDOM_MAX_COPIES);
    if (open.length === 0) return;
    const d = weightedPick(rng, open);
    counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
    picked.push(d);
  };
  const heals = all.filter((d) => d.heal);
  for (let i = 0; i < RANDOM_MIN_HEALS; i++) take(heals);
  while (picked.length < FOLDER_SIZE) {
    const field = picked.filter((d) => d.kind === 'field').length;
    take(field >= RANDOM_MAX_FIELD ? all.filter((d) => d.kind !== 'field') : all);
  }
  return picked.map((d) => {
    const coreCodes = d.codes.filter((c) => core.includes(c) || c === '*');
    const code: ChipCode = coreCodes.length > 0 && rng.next() < CORE_CODE_CHANCE ? rng.pick(coreCodes) : rng.pick(d.codes);
    return { defId: d.id, code };
  });
}
```

`startFolder` in `run.ts`:

```ts
export function startFolder(id: StartFolder, rng: Rng): FolderChip[] {
  return id === 'random' ? randomFolder(rng) : folderChips(id);
}
```

- [ ] **Step 5: title.** `menuModel` TITLE items:

```ts
        items: [
          { label: t('title.basic'), action: 'start:basic' },
          { label: t('title.field'), action: 'start:field' },
          { label: t('title.random'), action: 'start:random' },
        ],
```

Strings: `'title.basic': 'Basic folder'`, `'title.field': 'Field folder'`, `'title.random': 'Random folder'`; remove `title.start`. `main.ts` menu handler: `if (kind === 'start') session.start(arg as StartFolder)`. Test in `tests/terminalMenu.test.ts`: the title has three items with those actions.
- [ ] **Step 6:** Replace `'mvp'`/`'p1'`/`'p2'` in `world.ts`, `params.ts`, `debugPanel.ts`, `tests/core.test.ts`, `tests/session.test.ts` with `'basic'`/`'field'`/`'all'`. `?folder=` accepts `basic|field|all`.
- [ ] **Step 7:** `npm test` → PASS.

### Task 8: Difficulty and removing Punchy

Punchy (Champy) is not in MMBN3 and is removed entirely [решение 2026-09-18]; a new virus comes later.

**Files:**
- Delete: `src/sim/enemies/punchy.ts`; Punchy traces in `src/sim/enemies/enemyBase.ts` (`EnemyKind`), `src/sim/enemies/factory.ts`, `src/sim/events.ts` (Punchy-only events, e.g. player push, only if nothing else emits them — check with grep), `src/config/tuning.ts` (group `punchy`, `PUN_*`), `src/data/enemies.ts` (seed), `src/i18n/en.ts` (`enemy.punchy`), `tests/viruses.test.ts` (Punchy cases); `grep -rni "punchy\|PUN_" src tests` must return nothing. Player push-back used by Punchy stays only if another enemy uses it; otherwise remove it and its test.
- Modify: `src/data/enemies.ts` (`ENEMY_LEVELS`), `src/config/tuning.ts` (BN3 base stats, `MONO_HP`), `src/data/encounters.ts`
- Test: `tests/encounters.test.ts`, `tests/viruses.test.ts` / `tests/enemies.test.ts` wherever a literal stat is asserted

- [ ] **Step 1: failing test** in `tests/encounters.test.ts`:

```ts
  it('stays gentle early: level 1 only and at most two enemies before step 7', () => {
    for (const e of ENCOUNTERS.filter((x) => x.tier !== 'boss' && x.minDepth < 7)) {
      expect(e.enemies.every((s) => (s.level ?? 1) === 1) || e.tier === 'elite').toBe(true);
      expect(e.enemies.length).toBeLessThanOrEqual(2);
    }
  });

  it('has an encounter for every step and tier the run asks for', () => {
    for (let d = 1; d < RUN_STEPS; d++) {
      const tier = ELITE_STEPS.includes(d) ? 'elite' : 'normal';
      expect(ENCOUNTERS.some((e) => e.tier === tier && e.minDepth <= d && d <= e.maxDepth)).toBe(true);
    }
  });
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: numbers.**
  - `ENEMY_LEVELS`: `2: { hp: 1.5, damage: 1.5, speed: 1.1 }`, `3: { hp: 2, damage: 2, speed: 1.2 }`.
  - `tuning`: `CANO_HP 60`, `SPK_DMG 30`, `HOP_DMG 15`, `BLD_DMG 30`, `HELM_DMG 60`, `MONO_HP 400`.
- [ ] **Step 4: encounters** (ids `n*` normal, `e*` elite; the first four stay the debug battles 1–4):

```ts
export const ENCOUNTERS: readonly Encounter[] = [
  { id: 'n1', tier: 'normal', minDepth: 1, maxDepth: 3, enemies: [e('mettik', 1, 1)] },
  { id: 'n2', tier: 'normal', minDepth: 1, maxDepth: 3, enemies: [e('canodron', 1, 1)] },
  { id: 'n3', tier: 'normal', minDepth: 2, maxDepth: 4, enemies: [e('mettik', 0, 2), e('canodron', 2, 0)] },
  { id: 'n4', tier: 'normal', minDepth: 4, maxDepth: 6, enemies: [e('spiker', 1, 1)] },
  { id: 'n5', tier: 'normal', minDepth: 1, maxDepth: 3, enemies: [e('hopzap', 1, 1)] },
  { id: 'n6', tier: 'normal', minDepth: 2, maxDepth: 4, enemies: [e('rattik', 1, 1)] },
  { id: 'n7', tier: 'normal', minDepth: 3, maxDepth: 6, enemies: [e('bladdy', 1, 0)] },
  { id: 'n8', tier: 'normal', minDepth: 4, maxDepth: 6, enemies: [e('helmhead', 1, 0)] },
  { id: 'n9', tier: 'normal', minDepth: 4, maxDepth: 7, enemies: [e('finnik', 2, 1), e('mettik', 0, 2)] },
  { id: 'n10', tier: 'normal', minDepth: 4, maxDepth: 7, enemies: [e('hopzap', 0, 0), e('canodron', 2, 1)] },
  { id: 'n11', tier: 'normal', minDepth: 6, maxDepth: 9, enemies: [e('rattik', 0, 1), e('hopzap', 2, 0)] },
  { id: 'n12', tier: 'normal', minDepth: 7, maxDepth: 9, enemies: [e('helmhead', 1, 1), e('canodron', 0, 0)] },
  { id: 'n13', tier: 'normal', minDepth: 7, maxDepth: 9, enemies: [e('bladdy', 0, 0), e('spiker', 2, 1)] },
  { id: 'n14', tier: 'normal', minDepth: 7, maxDepth: 9, enemies: [e('mettik', 1, 1, 2), e('rattik', 2, 0)] },
  { id: 'e1', tier: 'elite', minDepth: 5, maxDepth: 5, enemies: [e('bladdy', 1, 0, 2), e('mettik', 0, 2)] },
  { id: 'e2', tier: 'elite', minDepth: 5, maxDepth: 5, enemies: [e('spiker', 1, 1, 2), e('canodron', 2, 0)] },
  { id: 'e3', tier: 'elite', minDepth: 8, maxDepth: 8, enemies: [e('finnik', 1, 0, 2), e('hopzap', 2, 2, 2)] },
  {
    id: 'e4', tier: 'elite', minDepth: 8, maxDepth: 8,
    enemies: [e('helmhead', 0, 0, 2), e('rattik', 2, 1, 2)],
    panels: [{ x: 1, y: 5, panel: 'CRACKED' }],
  },
  { id: 'boss', tier: 'boss', minDepth: 10, maxDepth: 10, enemies: [e('monolith', 1, 0)] },
];
```

Level 3 stays in `ENEMY_LEVELS` for debug, no encounter uses it.
- [ ] **Step 5:** Fix tests that assert old literal stats (compute from tuning instead). `npm test` → PASS.

### Task 9: Docs

**Files:** `docs/GDD.md`, `docs/superpowers/specs/2026-09-17-roguelite-content-design.md`, `docs/TERMINAL.md`, `docs/BATTLE_VISUAL.md`, `CLAUDE.md`, `README.md`

- [ ] **GDD**
  - §0: source of truth — MMBN6 for combat rules, MMBN3 for content (chips, codes, viruses) `[решение 2026-09-18]`; labels `[MMBN3]`, `[MMBN6]`, `[MMBN1]` only as history. Go through all MMBN mentions: a value that matches BN3/BN6 gets that label; one that does not either changes or becomes `[решение]` / `[оценка]`.
  - §0.1: drop the Buster and Punchy rows.
  - §1: the game unit is the linear 10-step run.
  - §4: «Buster удалён [решение 2026-09-18]» — one line, no mechanics.
  - §5, §7.5: reshuffle of spent chips when the pile is empty `[решение 2026-09-18]`.
  - §6.2: BN3 chip table; §6.3: folders BASIC, FIELD, RANDOM (rules), debug `all`; §6.4: remove the `onHit.panel` line, describe new field actions.
  - §8: BN3 stats, level multipliers, Punchy removed (§8.6 table, §8.8, §17 `PUN_*`); §8.5: no mention of the Buster; §8.7: Monolith 400.
  - §10: linear run, elites on steps 5 and 8, heal after 3/6/9, no reward, no legacy; GAME OVER → title; three starts on the title.
  - §11: screens `TITLE → PATH → BATTLE → PATH … → COMPLETE`, death/abandon → `GAME_OVER`.
  - §17: Buster rows removed; changed stats; §18–§20 updated (no reward/legacy/retry, Buster question closed).
- [ ] **Roguelite spec:** status line «частично заменено 2026-09-18, см. план run-cleanup-bn3»; §2 (Buster), §4.4 (chip list), §5.1 (levels), §6.1–6.4 (folder growth, path choice, reward, legacy) marked as replaced with a pointer to GDD §6, §8, §10.
- [ ] **TERMINAL.md:** the tray and mode `CHIP_SELECT` removed (code map §9, the tray row, `TRAY_SLIDE_TIME` if deleted); title with three starts; PATH with one item; GAME_OVER instead of LEGACY.
- [ ] **BATTLE_VISUAL.md:** drop the Buster tracer row and Punchy mentions.
- [ ] **CLAUDE.md:** «MMBN6 as the combat base, MMBN3 for content»; remove the Buster deviation; `folder=basic|field|all`; architecture line for `src/app/` (title → run of 10 → complete / game over).
- [ ] **README.md:** remove the Buster sentence, describe the linear run and the three folders.

### Task 10: Verify

- [ ] `npm test` and `npm run build` → PASS.
- [ ] Browser (Chrome DevTools MCP, phone emulation `390x844x3,mobile,touch`): title shows three starts; each starts a run; PATH shows `STEP 01/10` and Fight; a battle plays with no Buster tracer; after the pile runs dry, cassettes still arrive (DBG: `?folder=all` has 27 chips, fastest to exhaust); step 3 win shows «HP restored»; death shows GAME OVER → Title. No console errors.
- [ ] Report to the user; commit only when asked.
