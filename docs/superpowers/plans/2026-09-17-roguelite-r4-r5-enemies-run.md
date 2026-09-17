# Roguelite R4–R5: враги, босс, встречи, забег — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить уровни врагов, 6 новых врагов MMBN1 и босса Monolith, описать бои как встречи-данные (R4); заменить цепочку из 4 боёв на roguelite-забег из 10 шагов с выбором пути, наградой на лотке и наследием между поколениями (R5).

**Architecture:** `Enemy` получает `level` и помощники `ticks()` / `dmg()`; статы — `ENEMY_STATS`. Встречи — `data/encounters.ts`, `World` берёт встречу вместо `getBattle`. `app/run.ts` — чистый забег (путь, папка, HP, награды); `app/legacyStore.ts` — localStorage. `Session` получает экраны `PATH`, `REWARD`, `LEGACY`; терминал показывает PATH/LEGACY меню на CRT, REWARD — на лотке через общий интерфейс источника чипов лотка.

**Tech Stack:** TypeScript strict, Vitest, Three.js 0.186, Vite 8.

**Spec:** [docs/superpowers/specs/2026-09-17-roguelite-content-design.md](../specs/2026-09-17-roguelite-content-design.md) — §5, §6. Опирается на R1–R3.

## Global Constraints

- Всё из планов R1–R3 (sim без DOM, длительности в tuning, случайность через seeded `Rng`, строки через `t()`, глифы 5×7, иконки 16×16).
- Каждое новое значение урона/HP/таймингов — в tuning (группа на врага); множители уровней — в `ENEMY_STATS` (данные).
- Рабочие имена врагов: Hopzap, Bladdy, Rattik, Helmhead, Finnik, Punchy, Monolith.
- Совместимость тестов: `WorldOptions.battleIndex` остаётся и указывает на первые 4 встречи, повторяющие старые бои 1–4.
- Перед каждым коммитом: `npm test` и `npm run build`. Коммит на задачу. Пуш — в конце, после финальной проверки.
- Не запускать замеры производительности.

---

## R4 — враги

### Task 1: Уровни, щит, паралич игрока, отталкивание игрока

**Files:** `src/sim/enemies/enemyBase.ts`, `mettik.ts`, `canodron.ts`, `spiker.ts`, `factory.ts`, `src/sim/attacks/heatShot.ts`, `src/data/enemies.ts`, `src/data/battles.ts`, `src/sim/player.ts`, `src/sim/world.ts`, `src/sim/events.ts`, `src/render/actors.ts`, `tests/enemies.test.ts`

**Interfaces (produces):**

```ts
// data/enemies.ts
export type EnemyLevel = 1 | 2 | 3;
export interface LevelStats { hp: number; damage: number; speed: number }   // множители
export const ENEMY_LEVELS: Record<EnemyLevel, LevelStats> = {
  1: { hp: 1, damage: 1, speed: 1 },
  2: { hp: 2, damage: 2, speed: 1.2 },   // [оценка]
  3: { hp: 3, damage: 3, speed: 1.35 },  // [оценка]
};
// data/battles.ts
export interface EnemySpawn { kind: EnemyKind; x: number; y: number; level?: EnemyLevel }
// enemyBase.ts
abstract class Enemy {
  constructor(id, x, y, baseHp, spawnTick, level: EnemyLevel = 1);
  readonly level: EnemyLevel;
  guarded: boolean;                         // урон не проходит
  protected ticks(seconds: number): number; // secondsToTicks(seconds / speed), ≥ 1
  protected dmg(base: number): number;      // round(base * damage)
}
EnemyContext.pushPlayer(): boolean;         // игрок на ряд назад (+y), если можно
EnemyContext.paralyzePlayer(ticks: number): void;
// player.ts
Player.paralyzeTicks: number;               // нет ходов, чипов и Buster
// events.ts
{ type: 'guarded'; id: EntityId; x: number; y: number }
```

- `World.damageEnemy`: если `enemy.guarded` — событие `guarded`, урона нет.
- `hitPlayerAt(attack, x, y, damage, opts?)` — без изменений; паралич игрока ставит сама атака через `ctx.paralyzePlayer`.
- `Player.updateMovement` / `tryUseChip` / Buster: `paralyzeTicks > 0` блокирует, как оглушение (но без неуязвимости).
- Существующие враги: все `secondsToTicks(tuning.x.Y)` в их логике → `this.ticks(tuning.x.Y)`; урон → `this.dmg(...)`; `Shockwave` Mettik создаётся с `{ ...mettik opts, damage: this.dmg(MET_DMG), stepTicks: this.ticks(MET_WAVE_STEP) }`; `HeatShot` получает `damage` и `stepTicks` параметрами (по умолчанию — как сейчас).
- `factory.createEnemy(spawn, id, tick)` передаёт `spawn.level ?? 1`.
- Визуал: у врага уровня ≥ 2 — акцентная точка над HP-сегментами (`HpBar.level`, `crtCanvas.drawBars` рисует `level − 1` точек акцентом над полосой).

**Tests (`tests/enemies.test.ts`):**
- Mettik уровня 2: HP 80, урон волны 20, телеграф короче (`ticks` < уровня 1).
- `guarded` враг не теряет HP, событие `guarded`.
- `paralyzeTicks` у игрока блокирует шаг и чип, не даёт неуязвимости.
- `pushPlayer` сдвигает игрока на +1 ряд, не на дыру и не за край.

Commit: `R4: enemy levels, guard, player paralysis and knock-back`.

### Task 2: Шесть новых врагов

**Files:** `src/sim/enemies/hopzap.ts`, `bladdy.ts`, `rattik.ts`, `helmhead.ts`, `finnik.ts`, `punchy.ts`; `src/sim/attacks/zapRing.ts`, `ratMine.ts`, `cannonBall.ts`, `dash.ts`; `enemyBase.ts` (`EnemyKind`), `factory.ts`, `src/config/tuning.ts` (группы `hopzap`, `bladdy`, `rattik`, `helmhead`, `finnik`, `punchy`), `src/data/enemies.ts` (сиды), `src/i18n/en.ts` (`enemy.<kind>`), `src/render/fx.ts` (визуал новых атак), `tests/enemies.test.ts`

**Поведение (спека §5.2), значения tuning:**

| Враг | Tuning | Логика |
|---|---|---|
| Hopzap | `HOP_HP 40, HOP_DMG 20, HOP_MOVE_INTERVAL 0.6, HOP_TELEGRAPH 0.5, HOP_RING_STEP 0.2, HOP_PARALYZE 1.0, HOP_RECOVERY 1.2` | IDLE: раз в интервал прыгает (`warpTo`) на случайную свободную свою клетку колонки игрока, если она есть, иначе — на любую; стоя в колонке игрока → TELEGRAPH (опасность — колонка ниже) → `ZapRing` (LaneMover dir +1, при попадании `paralyzePlayer`) → RECOVERY. |
| Bladdy | `BLD_HP 90, BLD_DMG 80, BLD_MOVE_INTERVAL 0.8, BLD_TELEGRAPH 0.6, BLD_ATTACK_TIME 0.25, BLD_RECOVERY 1.5` | Идёт (`tryStep`) к клетке `(px, 2)`; стоя там → TELEGRAPH (опасность `(x,3)`, `(x,4)`) → в момент атаки `hitPlayerAt` по обеим клеткам (одна атака-запись) → RECOVERY. Событие `chipEffect`-аналог не нужен: `enemySlash { cells }` для FX. |
| Rattik | `RAT_HP 40, RAT_DMG 20, RAT_MOVE_INTERVAL 0.7, RAT_TELEGRAPH 0.4, RAT_STEP 0.18, RAT_RECOVERY 2.0` | Держит ряд, шагает к колонке игрока; при совпадении → TELEGRAPH → `RatMine`: идёт вниз; на ряду игрока один раз поворачивает к его колонке и идёт вбок до края (бьёт игрока, останавливается на объекте, обрывается на дыре). |
| Helmhead | `HELM_HP 80, HELM_DMG 30, HELM_CLOSED 2.0, HELM_TELEGRAPH 0.6, HELM_FLIGHT 0.6, HELM_RECOVERY 1.0` | Стоит; `guarded` пока закрыт (IDLE). Через `HELM_CLOSED` открывается (`guarded=false`) → TELEGRAPH (опасность — клетка игрока, запомненная в начале) → `CannonBall` (задержанная атака): на приземлении `hitPlayerAt` и `field.breakPanel(occupied)` → RECOVERY (открыт) → IDLE (закрывается). |
| Finnik | `FIN_HP 90, FIN_DMG 30, FIN_MOVE_INTERVAL 0.8, FIN_TELEGRAPH 0.6, FIN_DASH_STEP 0.08, FIN_RECOVERY 1.5` | Шагает к колонке игрока; при совпадении → TELEGRAPH (колонка) → убирает себя из `Occupancy` (`field.onLeave`), `guarded=true`, спавнит `Dash` (LaneMover dir +1, бьёт игрока); когда `Dash.done` — возвращается на стартовую клетку или ближайшую свободную свою, `guarded=false`, RECOVERY. Пока рывок идёт, `x/y` врага = клетка рывка (для визуала), но `Occupancy` его не держит. Если свободных клеток нет — ждёт. |
| Punchy | `PUN_HP 60, PUN_DMG 30, PUN_CHECK 0.4, PUN_TELEGRAPH 0.4, PUN_ATTACK_TIME 0.2, PUN_RECOVERY 1.5` | Раз в `PUN_CHECK`: если игрок на ряду 3 и клетка `(px, 2)` своя и свободна — `warpTo(px, 2)` → TELEGRAPH (опасность `(px,3)`) → `hitPlayerAt` по `(x,3)`; при попадании `pushPlayer()` → RECOVERY. |

- `Finnik.x/y` во время рывка: добавить в `Enemy` флаг `offField: boolean`; `World.enemyAt` и `removeDeletedEnemies` учитывают его (`occupancy.remove` только если `!offField`).
- FX: `zapring` — акцентное... нет: вражеские атаки красные; кольцо — красный ромб-контур; `ratmine` — красный квадратик; `cannonball` — красная точка по параболе (как бомба игрока); `dash` — красная полоса; `enemySlash` — красные дуги по клеткам.
- i18n: `enemy.hopzap` … `enemy.punchy`, `enemy.monolith`.

**Tests:** по сценарию на каждого врага (AI включён, `god` выключен, Buster выключен): атакует и наносит урон; Hopzap парализует; Helmhead неуязвим закрытым, ядро оставляет дыру; Finnik возвращается на свою клетку (и на ближайшую, если своя занята); Punchy отталкивает игрока; Rattik сворачивает к игроку.

Commit: `R4: six new viruses`.

### Task 3: Босс Monolith и встречи

**Files:** `src/sim/enemies/monolith.ts`, `src/sim/attacks/rockfall.ts`, `factory.ts`, `enemyBase.ts`, `tuning.ts` (группа `monolith`), `src/data/encounters.ts` (новый; `battles.ts` оставляет только тип `EnemySpawn`), `src/sim/world.ts`, `src/render/actors.ts`, `src/render/creatureGen.ts` (размер 48), `tests/enemies.test.ts`, `tests/encounters.test.ts`

**Monolith (спека §5.3):** `MONO_HP 600, MONO_MOVE_INTERVAL 1.2, MONO_ATTACK_INTERVAL 2.5, MONO_TELEGRAPH 0.8, MONO_ROCK_DMG 40, MONO_ROCKS 3, MONO_ROCKS_RAGE 5, MONO_WAVE_DMG 50, MONO_RAGE_SPEED 1.25`.
- Ходит по своей половине (случайная свободная соседняя клетка).
- Каждые `MONO_ATTACK_INTERVAL` (÷ `MONO_RAGE_SPEED` при HP < 50%) выбирает через `rngAi` одну из трёх атак:
  1. камнепад — `Rockfall` на N случайных свободных клетках игрока: опасность на время телеграфа, затем `hitPlayerAt` и `field.crack`;
  2. камень — `ctx.placeObject('rock', …, 'enemy')` на случайную свободную клетку игрока (нужен `EnemyContext.placeObject`);
  3. удар — `Shockwave` (dir +1, `MONO_WAVE_DMG`) по колонке игрока от `(px, y+1)`, клетки на пути трескаются (`WaveOptions.crack?: true`).
- Спрайт 48×48: `generateCreature(seed, 48)`; `EnemyView` берёт размер из `kind === 'monolith'`; ширина спрайта ×1.4.

**Встречи (спека §5.4):**

```ts
export interface Encounter {
  id: string;
  tier: 'normal' | 'elite' | 'boss';
  minDepth: number;
  maxDepth: number;
  enemies: EnemySpawn[];
  panels?: { x: number; y: number; panel: 'CRACKED' | 'BROKEN' }[];
}
export const ENCOUNTERS: readonly Encounter[];   // первые 4 — старые бои 1–4 (id 'n1'…'n4')
export function encounterById(id: string): Encounter | undefined;
export function debugEncounter(index: number): Encounter;  // 1-based, первые 4, clamp
```

- 14 обычных (`n1`…`n14`, глубины 1–9, уровни растут с глубиной), 5 элитных (`e1`…`e5`, уровень 2–3, минимум глубина 3, у части — стартовые трещины), 1 босс (`boss`, глубина 10: Monolith в (1,1) + Mettik ур. 2).
- `WorldOptions`: `encounter?: Encounter`; иначе `debugEncounter(battleIndex)`. `spawnBattle` ставит врагов и панели встречи.
- `?battle=N` остаётся, добавляется `?encounter=<id>`.

**Tests:** все встречи валидны (враги на вражеских клетках, без пересечений, стартовые панели не под врагами, у каждого `kind` есть фабрика и сид); у каждого тира есть встречи на каждую глубину его диапазона; Monolith: HP, три атаки за достаточное время, фаза гнева ускоряет.

Commit: `R4: Monolith boss and encounters as data`.

---

## R5 — забег

### Task 4: `Run` и `legacyStore`

**Files:** `src/app/run.ts`, `src/app/legacyStore.ts`, `src/data/starterFolder.ts`, `src/sim/chips/chipSystem.ts`, `src/sim/world.ts`, `tests/run.test.ts`

**Interfaces:**

```ts
// sim/chips/chipSystem.ts
export interface FolderChip { defId: ChipId; code: ChipCode; legacyGen?: number }
ChipSystem.constructor(folder: FolderId | readonly FolderChip[], rng: Rng)
ChipInstance.legacyGen?: number
// app/run.ts
export type NodeKind = 'normal' | 'elite' | 'boss';
export interface PathOption { kind: NodeKind; encounter: Encounter }
export const RUN_STEPS = 10;
export class Run {
  constructor(seed: number, legacy: LegacyChip | null, generation: number);
  readonly seed: number; readonly generation: number;
  depth: number;                 // 1..RUN_STEPS, шаг, который сейчас выбирается/идёт
  hp: number; maxHp: number;
  folder: FolderChip[];
  options: PathOption[];         // варианты текущего шага
  current: PathOption | null;    // выбранный бой
  history: { id: string; kind: NodeKind; won: boolean }[];
  choose(index: number): PathOption;
  battleSeed(): number;
  rewardChoices(): FolderChip[];  // 3 чипа, детерминированно от seed и depth
  addChip(chip: FolderChip): void;
  finishBattle(hpLeft: number): void; // история, hp, depth++ и новые options
  get complete(): boolean;           // босс побеждён
}
// app/legacyStore.ts
export interface LegacyChip { defId: ChipId; code: ChipCode; gen: number }
export interface LegacyState { generation: number; chip: LegacyChip | null }
export function loadLegacy(storage?: Storage | null): LegacyState;   // try/catch; по умолчанию { generation: 1, chip: null }
export function saveLegacy(state: LegacyState, storage?: Storage | null): void;
```

- Ключ хранилища `glorp.legacy.v1`; `storage` по умолчанию — `globalThis.localStorage`, если доступен.
- Стартовая папка (`STARTER_FOLDER`, 18): Cannon A×3, Cannon B×2, Sword S×3, WideSword S×2, AirShot *×2, MiniBomb L×2, Recov10 A×2, Recov10 L×2.
- Варианты шага: шаги 1–9 — 2 или 3 варианта (`rng.int(2,3)`), тип `elite` с шансом `[оценка 35%]` при `depth ≥ 3`, иначе `normal`; встреча — случайная из пула тира и глубины, не из `history` и не повтор внутри одного набора, если пул позволяет. Шаг 10 — один вариант `boss`.
- Награда: 3 разных чипа; веса редкости normal `70/25/5`, elite — `0/75/25` для первой кассеты и `70/25/5` для остальных; код — `rng.pick(def.codes)`. Пул — все чипы.
- Все случайности — `new Rng(deriveSeed(seed, 'path/<depth>'))`, `…'reward/<depth>'`.

**Tests (`tests/run.test.ts`):** детерминизм путей и наград для одного сида; 10 шагов, последний — босс; элитных нет до шага 3; встречи не повторяются по истории; папка стартует с 18 (+1 с наследием, с меткой поколения); награда — 3 разных чипа, коды из `codes`, элитная первая — не common; `legacyStore` сохраняет/читает, битый JSON и отсутствующее хранилище дают значения по умолчанию.

Commit: `R5: run model and legacy store`.

### Task 5: Сессия забега

**Files:** `src/app/session.ts`, `src/terminal/crt/menuModel.ts`, `src/i18n/en.ts`, `src/main.ts`, `src/debug/params.ts`, `src/debug/debugPanel.ts`, `tests/session.test.ts`, `tests/terminalMenu.test.ts`

**Экраны:** `'TITLE' | 'PATH' | 'BATTLE' | 'PAUSED' | 'REWARD' | 'LEGACY' | 'COMPLETE'` (`RESULT` и `DEFEAT` удаляются).

```ts
class Session {
  run: Run | null; legacy: LegacyState;
  reward: RewardPick | null;           // задача 6
  start(): void;                       // TITLE → PATH (новый Run: legacy чип забирается из store)
  choosePath(index: number): void;     // PATH → BATTLE
  update(): void;                      // победа: босс → COMPLETE, иначе → REWARD; смерть → LEGACY
  takeReward(): void; skipReward(): void;  // REWARD → PATH
  chooseLegacy(index: number): void;   // LEGACY → TITLE; сохраняет чип и generation+1
  abandon(): void;                     // PAUSED → LEGACY
  toTitle(): void;                     // COMPLETE → TITLE (generation не меняется)
  debugJump(index: number, seed?: number): void;          // как раньше: бой по индексу, без забега
  debugEncounter(id: string, seed?: number): void;
  debugDepth(depth: number): void;
}
```

- `SessionOptions.storage?: Storage | null` (тесты передают `null` или фейк).
- `world` во время PATH/REWARD/LEGACY — последний бой (для TITLE — пустой бой, как сейчас).
- Меню (`MenuAction` → строка с параметром: `'start' | 'resume' | 'abandon' | 'title' | \`path:${n}\` | \`legacy:${n}\``):
  - TITLE: `GENERATION 07`, пункт START, подсказки;
  - PATH: заголовок `STEP 04/10`, строки HP, FOLDER; пункты `BATTLE ×2` / `ELITE ×3` / `BOSS`;
  - PAUSED: RESUME, ABANDON;
  - LEGACY: заголовок GAME OVER, подзаголовок `LEAVE A CHIP`; пункты — чипы папки (`NAME CODE`, метка `GEN n` у наследия); прокрутка;
  - COMPLETE: статистика и пункт TITLE.
- `menuLayout(spec, W, H, cursor)` — показывает не больше `MENU_VISIBLE` пунктов (`[оценка 6]`), окно следует за курсором; `menuItemAt` возвращает индекс исходного пункта.
- `main.ts` `handlers.menu` разбирает действия; `?encounter=`; `?battle=` → `debugJump`.
- DBG Session: `depth` (переход на шаг), `clear legacy`, `generation`.

**Tests (`tests/session.test.ts`, переписать под забег):** старт → PATH с 2–3 вариантами; выбор → BATTLE с врагами встречи; победа → REWARD; `takeReward` добавляет чип и → PATH со следующим шагом; HP переносится; смерть → LEGACY; `chooseLegacy` сохраняет чип и поколение, TITLE; следующий `start` кладёт чип в папку; победа над боссом → COMPLETE; ABANDON → LEGACY. Меню: окно прокрутки держит курсор видимым.

Commit: `R5: run flow in the session and CRT menus`.

### Task 6: Награда на лотке

**Files:** `src/app/reward.ts`, `src/app/session.ts`, `src/terminal/terminalMode.ts`, `src/terminal/terminal.ts`, `src/terminal/interaction/trayInput.ts` (если нужно), `src/terminal/parts/housing.ts` (подпись ADD/SKIP), `src/i18n/en.ts`, `tests/terminalTray.test.ts`, `tests/session.test.ts`

**Interfaces:**

```ts
/** What the chip tray shows and edits: the Custom Screen hand or a reward pick. */
export interface TraySource {
  readonly hand: readonly (ChipInstance | null)[];
  readonly selection: readonly number[];
  selectedChips(): ChipInstance[];
  isSelected(slot: number): boolean;
  canSelect(slot: number): boolean;
  selectAt(slot: number, index: number): boolean;
  unselect(index: number): boolean;
  cancelLast(): boolean;
  confirm(): void;   // OK
  add(): void;       // ADD / SKIP
}
export class RewardPick implements TraySource { constructor(chips: FolderChip[]); taken: FolderChip | null; skipped: boolean }
```

- `RewardPick`: не больше 1 выбранной кассеты; `confirm()` без выбора ничего не делает; `add()` → `skipped`.
- `terminalMode`: `REWARD` → `CHIP_SELECT`. В терминале все обращения лотка к `world.chips` / `world.custom*` идут через `traySource()`: в REWARD — `session.reward` с действиями `session.takeReward()` / `session.skipReward()`, в CUSTOM — адаптер над `world` (как сейчас).
- CRT в REWARD: описание кассеты под фокусом (как в CUSTOM); поверх поля — заголовок `REWARD` (i18n) тем же шрифтом, что меню, без пунктов.
- Подпись клавиши ADD на лотке в REWARD — `SKIP` (i18n `tray.skip`).
- Счётчик CHIP SLOT и рельс в REWARD показывают выбранную кассету.

**Tests:** `RewardPick` (один выбор, замена, confirm/skip); `terminalMode('REWARD', …) === 'CHIP_SELECT'`; сессия: `reward.selectAt(i,0)` + `takeReward()` добавляет именно этот чип.

Commit: `R5: reward pick on the chip tray`.

### Task 7: Метка поколения, документация, проверка, пуш

**Files:** `src/terminal/chips/chipFace.ts` (метка `GEN nn` на кассете наследия: кэш по `defId:code:gen`), `src/terminal/parts/chipRail.ts`, `chipTray.ts` (передают `legacyGen`), `docs/GDD.md`, `docs/TERMINAL.md`, `docs/BATTLE_VISUAL.md`, `CLAUDE.md`, `README.md`, спека, планы.

- GDD: новый раздел «Забег» (путь, награды, наследие, экраны), §10 переписан, §8 — новые враги и уровни, §0.1 — рабочие имена, §17 — все новые tuning-ключи.
- TERMINAL.md: режимы PATH, REWARD, LEGACY; статус R1–R5.
- CLAUDE.md: `src/app/` описывает `Run`; «placed in `data/battles.ts`» → `data/encounters.ts`; URL-параметры `?encounter=`.
- README: забег, наследие, новые параметры.
- Проверка в браузере (эмуляция телефона): полный цикл TITLE → PATH → бой → REWARD (выбор на лотке) → PATH …; смерть → LEGACY → TITLE с новым поколением → чип-наследие в папке с меткой; `?encounter=boss` — босс и его атаки; `?encounter=e1` — элитный бой.
- `npm test`, `npm run build`; коммит документации вместе со спекой и планами; `git push origin main`; проверить, что деплой запустился (`gh run list --limit 1`).

Commit: `R5: legacy marks and docs`, затем `docs: roguelite spec and plans`.
