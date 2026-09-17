# Roguelite R3: чипы из строительных блоков — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Описать каждый чип данными (форма удара + эффект при попадании + действие с полем) и добавить 19 новых чипов MMBN1, в том числе 6 меняющих поле.

**Architecture:** `ChipDef.pattern` заменяется на `shape` / `onHit` / `field` / `heal` / `invis`. `patterns.ts` становится чистым `shapeCells`/`lobTarget`/`lobArea`. `World.resolveChip` — один общий путь: форма → урон → `onHit` → действие с полем → лечение/невидимость. Волна `Shockwave` обобщается на волну игрока; враги получают паралич и отталкивание, игрок — невидимость.

**Tech Stack:** TypeScript strict, Vitest, Three.js 0.186, Vite 8.

**Spec:** [docs/superpowers/specs/2026-09-17-roguelite-content-design.md](../specs/2026-09-17-roguelite-content-design.md) — §4. Опирается на R1–R2 (план `2026-09-17-roguelite-r1-r2-buster-panels.md`): `world.field`, `world.objects`, `placeObject`, `firstTargetRow`, `damageObject`.

## Global Constraints

- `src/sim` — без DOM и Three.js; случайность только через `world.rngAi` / `world.rngFolder`.
- Все длительности — в `tuning.ts` в секундах, в логике через `secondsToTicks()`.
- Визуал только читает симуляцию; связь sim → view через `SimEvent`.
- Материалы боя пишут сигнал (`render/palette.ts`), не цвет.
- Строки игрока — только в `src/i18n/en.ts`; названия чипов ≤ 9 символов; каждый символ должен иметь глиф 5×7 (тест `pixel font coverage`).
- Каждая иконка чипа — 16×16 символов из `ICON_PALETTE` (тест `chip icons`).
- Отладочные папки — ровно 30 чипов, коды — из `codes` своего чипа.
- Перед каждым коммитом: `npm test` и `npm run build`. Коммит на задачу. **Не пушить.**
- Сообщения коммитов — английский, с трейлером `Co-Authored-By` из харнеса.
- Не запускать замеры производительности.

## Решения, уточняющие спеку

- **M-Cannon — 120 урона** (MMBN1: Cannon 40, HiCannon 80, M-Cannon 120). В таблице спеки ошибочно 80 — исправить в задаче 4.
- **Новых чипов 19** (Recov10 и Recov80 — два чипа), всего 27. Исправить счёт в спеке в задаче 4.
- Длительности паралича и невидимости — в tuning (`PARALYZE_TIME`, `INVIS_TIME`), а в данных чипа — флаги `paralyze?: true`, `invis?: true`. Лечение — число `heal` в данных (значение из MMBN1); `RECOVER_AMOUNT` удаляется.
- `onHit.push` и `onHit.paralyze` действуют на поражённых врагов; `onHit.panel` — на все клетки области удара.
- Новая группа времени использования `FIELD` (`CHIP_USE_TIME_FIELD`), цвет рамки кассеты — свой.
- Коды существующих чипов — из GDD §6.2 (MMBN1); коды новых — `[оценка]`.
- Отладочная папка `p2` (30 чипов) — только новые чипы, чтобы их проверять руками.

## Карта файлов

| Файл | Действие | Ответственность |
|---|---|---|
| `src/data/chips.ts` | переписать | типы `Shape`, `OnHit`, `FieldAction`, `Rarity`; 27 чипов |
| `src/data/folders.ts` | изменить | папка `p2` |
| `src/sim/chips/patterns.ts` | переписать | `shapeCells`, `lobTarget`, `lobArea` |
| `src/sim/chips/executor.ts` | изменить | мгновенно срабатывают все не-атакующие |
| `src/sim/attacks/bomb.ts` | изменить | бомба помнит чип |
| `src/sim/attacks/shockwave.ts`, `heatShot.ts`, `attack.ts` | изменить | направление волны, волна игрока, `hitEnemyAt` |
| `src/sim/enemies/enemyBase.ts` | изменить | `paralyzeTicks`, `paralyze`, `pushBack` |
| `src/sim/player.ts` | изменить | `invisTicks` |
| `src/sim/events.ts` | изменить | `chipEffect.shape`, `bombLanded.cells` |
| `src/sim/world.ts` | изменить | общий `resolveChip`, `hitCells`, `applyFieldAction`, паралич |
| `src/config/tuning.ts` | изменить | `CHIP_USE_TIME_FIELD`, `PARALYZE_TIME`, `INVIS_TIME`, `PLAYER_WAVE_STEP`; −`RECOVER_AMOUNT` |
| `src/i18n/en.ts` | изменить | 19 названий и описаний |
| `src/terminal/chips/chipIcons.ts`, `chipFace.ts` | изменить | иконки новых чипов, цвет группы `FIELD` |
| `src/render/fx.ts`, `scene.ts`, `actors.ts` | изменить | волна игрока, область бомбы, паралич, невидимость |
| `src/debug/params.ts`, `debugPanel.ts` | изменить | папка `p2` |
| `tests/chipUse.test.ts`, `tests/chips.test.ts` | изменить | новые тесты |
| `docs/GDD.md`, спека | изменить | документация |

---

### Task 1: Данные чипа из блоков (без новых чипов)

Переводит 8 существующих чипов на новое описание. Поведение не меняется; все старые тесты должны пройти (кроме геометрии, которую переписываем).

**Files:**
- Modify: `src/data/chips.ts`, `src/sim/chips/patterns.ts`, `src/sim/chips/executor.ts`, `src/sim/attacks/bomb.ts`, `src/sim/events.ts`, `src/sim/world.ts`, `src/config/tuning.ts`, `src/render/fx.ts`, `src/terminal/chips/chipFace.ts`, `tests/chipUse.test.ts`, `tests/chips.test.ts`

**Interfaces:**
- Produces:

```ts
// src/data/chips.ts
export type UseTimeGroup = 'CANNON' | 'SWORD' | 'BOMB' | 'RECOVER' | 'FIELD';
export type Rarity = 'common' | 'uncommon' | 'rare';
export interface Offset { x: number; y: number }            // вперёд = −y
export type Shape =
  | { t: 'lane'; around?: readonly Offset[] }
  | { t: 'near'; cells: readonly Offset[] }
  | { t: 'lob'; depth: number; area: readonly Offset[] }
  | { t: 'wave' }
  | { t: 'self' };
export type ShapeKind = Shape['t'];
export interface OnHit { push?: true; paralyze?: true; panel?: 'crack' | 'break' }
export type FieldAction = 'crackRow' | 'crackAll' | 'breakEnemy' | 'steal' | 'repair' | 'rock';
export interface ChipDef {
  id: ChipId; power: number | null; kind: 'attack' | 'support' | 'field';
  useTime: UseTimeGroup; codes: readonly ChipCode[]; rarity: Rarity; shape: Shape;
  onHit?: OnHit; field?: FieldAction; heal?: number; invis?: true;
}
// src/sim/chips/patterns.ts
export type TargetRow = (x: number, py: number) => number;
export function shapeCells(shape: Shape, px: number, py: number, targetRow: TargetRow): Cell[];
export function lobTarget(depth: number, px: number, py: number): Cell | null;
export function lobArea(area: readonly Offset[], x: number, y: number): Cell[];
// src/sim/events.ts
{ type: 'chipEffect'; defId: ChipId; shape: ShapeKind; x: number; fromY: number; cells: Cell[]; toY: number }
{ type: 'bombLanded'; id: number; x: number; y: number; cells: Cell[] }
// src/sim/attacks/bomb.ts
new PlayerBomb(id, fromX, fromY, x, y, damage, throwTick, def: ChipDef)
```

- [ ] **Step 1: Переписать тесты геометрии**

В `tests/chipUse.test.ts` заменить импорт `hitscanCells, lobTarget, meleeCells` на `lobArea, lobTarget, shapeCells` и блок `describe('pattern geometry', ...)` на:

```ts
describe('shape geometry', () => {
  const none = () => -1;
  const at = (row: number) => () => row;

  it('near cells', () => {
    expect(shapeCells(CHIPS.sword.shape, 1, 3, none)).toEqual([{ x: 1, y: 2 }]);
    expect(shapeCells(CHIPS.widesword.shape, 1, 3, none)).toEqual([
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(shapeCells(CHIPS.widesword.shape, 0, 4, none)).toEqual([
      { x: 0, y: 3 },
      { x: 1, y: 3 },
    ]);
    expect(shapeCells(CHIPS.longsword.shape, 2, 3, none)).toEqual([
      { x: 2, y: 2 },
      { x: 2, y: 1 },
    ]);
  });

  it('lob lands depth rows ahead and clips its area', () => {
    expect(lobTarget(3, 1, 3)).toEqual({ x: 1, y: 0 });
    expect(lobTarget(3, 1, 5)).toEqual({ x: 1, y: 2 });
    expect(lobTarget(3, 1, 2)).toBeNull();
    expect(lobArea([{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }], 0, 0)).toEqual([{ x: 0, y: 0 }]);
  });

  it('lane shapes hit the first target plus cells around it', () => {
    expect(shapeCells(CHIPS.cannon.shape, 1, 4, at(1))).toEqual([{ x: 1, y: 1 }]);
    expect(shapeCells(CHIPS.shotgun.shape, 1, 4, at(1))).toEqual([
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ]);
    expect(shapeCells(CHIPS.shotgun.shape, 1, 4, at(0))).toEqual([{ x: 1, y: 0 }]);
    expect(shapeCells(CHIPS.cannon.shape, 1, 4, none)).toEqual([]);
    expect(shapeCells({ t: 'self' }, 1, 4, at(1))).toEqual([]);
  });
});
```

В `tests/chips.test.ts`, в `describe('folders', ...)` добавить (импорт `import { CHIPS } from '../src/data/chips';`):

```ts
  it('use codes the chip can have', () => {
    for (const folder of Object.values(FOLDERS)) {
      for (const e of folder) expect(CHIPS[e.chip].codes, `${e.chip} ${e.code}`).toContain(e.code);
    }
  });
```

Run: `npx vitest run tests/chipUse.test.ts tests/chips.test.ts` — Expected: FAIL (нет `shapeCells`, `codes`).

- [ ] **Step 2: Tuning**

`src/config/tuning.ts`, группа `chips`: удалить `RECOVER_AMOUNT: 50,`; после `CHIP_USE_TIME_RECOVER: 0.5,` добавить `CHIP_USE_TIME_FIELD: 0.4,`; после `BOMB_FLIGHT_TIME: 0.5,` добавить:

```ts
    /** ZapRing paralysis (roguelite spec §4.3). */
    PARALYZE_TIME: 1.5,
    INVIS_TIME: 3.0,
    /** Player ShockWave: seconds per panel. */
    PLAYER_WAVE_STEP: 0.15,
```

- [ ] **Step 3: `src/data/chips.ts`**

Заменить файл целиком:

```ts
import type { ChipCode as Code } from './chipCodes';

// Battle chip catalogue (GDD §6.2, roguelite spec §4). A chip is data: where it
// hits (shape), what a hit does (onHit), what it does to the field, and support
// effects. Values follow MMBN1; use times and effect durations are tunables.
// Names and descriptions live in i18n (`chip.<id>.name` / `chip.<id>.desc`).

export type ChipCode = Code;

export type ChipId = 'cannon' | 'hicannon' | 'sword' | 'widesword' | 'longsword' | 'shotgun' | 'minibomb' | 'recover50';

/** Which tunable holds the use (animation) time: `CHIP_USE_TIME_<group>`. */
export type UseTimeGroup = 'CANNON' | 'SWORD' | 'BOMB' | 'RECOVER' | 'FIELD';
export type Rarity = 'common' | 'uncommon' | 'rare';

/** Offset from the player or the target; forward (toward the enemy) is −y. */
export interface Offset {
  x: number;
  y: number;
}

export type Shape =
  /** First target in the player's lane, plus cells around it. */
  | { t: 'lane'; around?: readonly Offset[] }
  /** Fixed cells around the player. */
  | { t: 'near'; cells: readonly Offset[] }
  /** Thrown `depth` rows ahead; `area` is around the landing cell. */
  | { t: 'lob'; depth: number; area: readonly Offset[] }
  /** Ground wave up the lane; stops at holes and objects. */
  | { t: 'wave' }
  | { t: 'self' };
export type ShapeKind = Shape['t'];

export interface OnHit {
  /** Hit enemies step one row back if they can. */
  push?: true;
  /** Hit enemies stop for PARALYZE_TIME. */
  paralyze?: true;
  /** Every cell of the hit area cracks or breaks. */
  panel?: 'crack' | 'break';
}

export type FieldAction = 'crackRow' | 'crackAll' | 'breakEnemy' | 'steal' | 'repair' | 'rock';

export interface ChipDef {
  id: ChipId;
  /** Damage, or null for chips that deal none. */
  power: number | null;
  kind: 'attack' | 'support' | 'field';
  useTime: UseTimeGroup;
  /** Codes this chip can come with (rewards pick one). */
  codes: readonly ChipCode[];
  rarity: Rarity;
  shape: Shape;
  onHit?: OnHit;
  field?: FieldAction;
  heal?: number;
  /** Enemy attacks pass through the player for INVIS_TIME. */
  invis?: true;
}

const AHEAD: readonly Offset[] = [{ x: 0, y: -1 }];
const LANE: Shape = { t: 'lane' };

export const CHIPS: Record<ChipId, ChipDef> = {
  cannon: { id: 'cannon', power: 40, kind: 'attack', useTime: 'CANNON', codes: ['A', 'B', 'C', 'D', 'E'], rarity: 'common', shape: LANE },
  hicannon: { id: 'hicannon', power: 80, kind: 'attack', useTime: 'CANNON', codes: ['F', 'G', 'H', 'I', 'J'], rarity: 'uncommon', shape: LANE },
  sword: { id: 'sword', power: 80, kind: 'attack', useTime: 'SWORD', codes: ['B', 'K', 'L', 'P', 'S'], rarity: 'common', shape: { t: 'near', cells: AHEAD } },
  widesword: {
    id: 'widesword',
    power: 80,
    kind: 'attack',
    useTime: 'SWORD',
    codes: ['C', 'K', 'M', 'N', 'S'],
    rarity: 'uncommon',
    shape: { t: 'near', cells: [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }] },
  },
  longsword: {
    id: 'longsword',
    power: 80,
    kind: 'attack',
    useTime: 'SWORD',
    codes: ['D', 'E', 'N', 'O', 'S'],
    rarity: 'uncommon',
    shape: { t: 'near', cells: [{ x: 0, y: -1 }, { x: 0, y: -2 }] },
  },
  shotgun: {
    id: 'shotgun',
    power: 30,
    kind: 'attack',
    useTime: 'CANNON',
    codes: ['K', 'M', 'N', 'Q', 'R'],
    rarity: 'common',
    shape: { t: 'lane', around: [{ x: 0, y: -1 }] },
  },
  minibomb: {
    id: 'minibomb',
    power: 50,
    kind: 'attack',
    useTime: 'BOMB',
    codes: ['C', 'E', 'J', 'L', 'P'],
    rarity: 'common',
    shape: { t: 'lob', depth: 3, area: [{ x: 0, y: 0 }] },
  },
  recover50: {
    id: 'recover50',
    power: null,
    kind: 'support',
    useTime: 'RECOVER',
    codes: ['A', 'C', 'E', 'G', 'L'],
    rarity: 'uncommon',
    shape: { t: 'self' },
    heal: 50,
  },
};
```

`ChipCode` сейчас объявлен в этом же файле; чтобы не плодить модуль, **не** создавать `chipCodes.ts`: вместо первой строки и `export type ChipCode = Code;` оставить прежнее объявление:

```ts
export type ChipCode =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z' | '*';
```

(`PatternId`, `abbr`, `color` удаляются.)

- [ ] **Step 4: `src/sim/chips/patterns.ts`**

Заменить файл целиком:

```ts
import type { Offset, Shape } from '../../data/chips';
import { inField, type Cell } from '../grid';

// Chip shapes (GDD §6.4, roguelite spec §4.2). The player stands at (px, py)
// and faces −y. Lane shapes need the field to find their target, so they take a lookup.

/** Row of the first target in lane `x` in front of row `py`, or -1. */
export type TargetRow = (x: number, py: number) => number;

function around(offsets: readonly Offset[], x: number, y: number): Cell[] {
  return offsets.map((o) => ({ x: x + o.x, y: y + o.y })).filter((c) => inField(c.x, c.y));
}

/** Cells damaged right away by lane and near shapes; other shapes return []. */
export function shapeCells(shape: Shape, px: number, py: number, targetRow: TargetRow): Cell[] {
  switch (shape.t) {
    case 'lane': {
      const ty = targetRow(px, py);
      if (ty < 0) return [];
      return [{ x: px, y: ty }, ...around(shape.around ?? [], px, ty)];
    }
    case 'near':
      return around(shape.cells, px, py);
    default:
      return [];
  }
}

/** Landing cell of a lobbed chip (MMBN1 MiniBomb: "Depth=3"), or null off the field. */
export function lobTarget(depth: number, px: number, py: number): Cell | null {
  const c = { x: px, y: py - depth };
  return inField(c.x, c.y) ? c : null;
}

/** Cells hit around a landing cell. */
export function lobArea(area: readonly Offset[], x: number, y: number): Cell[] {
  return around(area, x, y);
}
```

- [ ] **Step 5: Исполнитель, бомба, события**

`src/sim/chips/executor.ts`: `const hitDelay = def.kind === 'support' ? 0 : ...` → `const hitDelay = def.kind !== 'attack' ? 0 : ...`.

`src/sim/attacks/bomb.ts`: импорт `import type { ChipDef } from '../../data/chips';`; в конструктор последним параметром `readonly def: ChipDef,`; комментарий сверху: `// Player bomb in flight (GDD §6.4 lob): lands after BOMB_FLIGHT_TIME and hits its chip's area around the landing cell.`

`src/sim/events.ts`: `import type { ChipId, PatternId } from '../data/chips';` → `import type { ChipId, ShapeKind } from '../data/chips';`; в `chipEffect` `pattern: PatternId` → `shape: ShapeKind`; `bombLanded` → `{ type: 'bombLanded'; id: number; x: number; y: number; cells: Cell[] }`.

- [ ] **Step 6: Мир**

`src/sim/world.ts`:
- импорт `import { hitscanCells, lobTarget, meleeCells } from './chips/patterns';` → `import { lobArea, lobTarget, shapeCells } from './chips/patterns';`; добавить `import type { ChipDef } from '../data/chips';`
- `damageCells` возвращает поражённых врагов:

```ts
  private damageCells(cells: readonly { x: number; y: number }[], damage: number): Enemy[] {
    const hit = new Set<number>();
    const enemies: Enemy[] = [];
    for (const c of cells) {
      const o = this.objectAt(c.x, c.y);
      if (o) {
        if (!hit.has(o.id)) {
          hit.add(o.id);
          this.damageObject(o, damage);
        }
        continue;
      }
      const e = this.enemyAt(c.x, c.y);
      if (!e || !e.alive || hit.has(e.id)) continue;
      hit.add(e.id);
      this.damageEnemy(e, damage);
      enemies.push(e);
    }
    return enemies;
  }

  /** Damage plus the chip's on-hit effects (roguelite spec §4.2). */
  private hitCells(cells: readonly Cell[], damage: number, def: ChipDef): void {
    this.damageCells(cells, damage);
  }
```

- `resolveChip` заменить:

```ts
  private resolveChip(a: ActiveChip): void {
    const p = this.player;
    const def = a.def;
    const power = def.power ?? 0;
    const shape = def.shape;
    const effect = (cells: Cell[], toY = -1) =>
      this.events.push({ type: 'chipEffect', defId: def.id, shape: shape.t, x: p.x, fromY: p.y, cells, toY });

    switch (shape.t) {
      case 'lane':
      case 'near': {
        const cells = shapeCells(shape, p.x, p.y, this.firstTargetRow);
        effect(cells, shape.t === 'lane' ? (cells[0]?.y ?? -1) : -1);
        this.hitCells(cells, power, def);
        break;
      }
      case 'lob': {
        const land = lobTarget(shape.depth, p.x, p.y);
        if (!land) break;
        const bomb = new PlayerBomb(this.attackIdCounter++, p.x, p.y, land.x, land.y, power, this.tick, def);
        this.bombs.push(bomb);
        effect([land], land.y);
        this.events.push({ type: 'bombThrown', id: bomb.id });
        break;
      }
      case 'wave':
      case 'self':
        effect([]);
        break;
    }
    if (def.heal) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + def.heal);
      this.events.push({ type: 'healed', amount: p.hp - before, x: p.x, y: p.y });
    }
  }
```

- `updateBombs`, тело цикла:

```ts
      if (b.done || this.tick < b.landTick) continue;
      b.done = true;
      const shape = b.def.shape;
      const cells = shape.t === 'lob' ? lobArea(shape.area, b.x, b.y) : [{ x: b.x, y: b.y }];
      this.events.push({ type: 'bombLanded', id: b.id, x: b.x, y: b.y, cells });
      this.hitCells(cells, b.damage, b.def);
```

- [ ] **Step 7: Визуал и кассета**

`src/render/fx.ts`, ветка `chipEffect`:

```ts
      case 'chipEffect':
        if (e.shape === 'lane') {
          this.push('tracer', tick, fx.CANNON_TRACER_TIME, e.x, e.fromY, e.toY);
        } else if (e.shape === 'near') {
          for (const c of e.cells) this.push('slash', tick, fx.SLASH_TIME, c.x, c.y);
        } else if (CHIPS[e.defId].heal) {
          this.push('heal', tick, fx.HEAL_FX_TIME, e.x, e.fromY);
        }
        break;
      case 'bombLanded':
        for (const c of e.cells) this.push('blast', tick, fx.EXPLOSION_TIME, c.x, c.y);
        break;
```

(импорт `import { CHIPS } from '../data/chips';`; старую ветку `bombLanded` удалить.)

`src/render/scene.ts`, в `handleEvent` добавить: `else if (e.type === 'bombLanded') this.field.markAttack(e.cells, tick, 'accent');`

`src/terminal/chips/chipFace.ts`, в `GROUP_COLOR` добавить `FIELD: { frame: '#c9b98a', backdrop: '#3a3326' },`.

Run: `npx tsc --noEmit` — ошибок нет (если где-то остался `pattern`/`abbr`/`color` чипа — `grep -rn "\.pattern\|PatternId\|RECOVER_AMOUNT" src tests` и заменить по смыслу).

- [ ] **Step 8: Тесты и коммит**

Run: `npm test` и `npm run build` — зелёные.

```bash
git add src tests
git commit -m "R3: chips described as shape + effects data"
```

---

### Task 2: Эффекты попадания, волна игрока, невидимость

**Files:**
- Modify: `src/sim/enemies/enemyBase.ts`, `src/sim/player.ts`, `src/sim/attacks/attack.ts`, `src/sim/attacks/shockwave.ts`, `src/sim/attacks/heatShot.ts`, `src/sim/world.ts`, `src/render/fx.ts`, `src/render/actors.ts`
- Test: `tests/chipUse.test.ts`

**Interfaces:**
- Consumes: `hitCells`, `resolveChip` из задачи 1.
- Produces: `Enemy.paralyzeTicks`, `Enemy.paralyze(ticks)`, `Enemy.pushBack(ctx): boolean`; `Player.invisTicks`; `AttackContext.hitEnemyAt(attack, x, y, damage): boolean`; `LaneMover.dir: 1 | -1`; `Shockwave` с `WaveOptions`; kind атаки игрока `'playerWave'`.

- [ ] **Step 1: Тесты**

Дописать в `tests/chipUse.test.ts` (импорт `import type { ChipDef } from '../src/data/chips';`):

```ts
/** Uses a one-off chip definition by swapping it into the catalogue for the call. */
function withChip(def: ChipDef, fn: () => void): void {
  const saved = CHIPS[def.id];
  CHIPS[def.id] = def;
  try {
    fn();
  } finally {
    CHIPS[def.id] = saved;
  }
}

describe('hit effects', () => {
  it('push moves a hit enemy one row back unless blocked', () => {
    withChip({ ...CHIPS.cannon, onHit: { push: true } }, () => {
      const w = makeWorld();
      const e = addEnemy(w, 1, 2);
      give(w, 'cannon');
      use(w);
      run(w, hitFrame());
      expect([e.x, e.y]).toEqual([1, 1]);
      addEnemy(w, 1, 0);
      run(w, useTicks(CHIPS.cannon));
      give(w, 'cannon');
      use(w);
      run(w, hitFrame());
      expect([e.x, e.y]).toEqual([1, 1]);
    });
  });

  it('paralyze stops an enemy for PARALYZE_TIME', () => {
    withChip({ ...CHIPS.cannon, onHit: { paralyze: true } }, () => {
      const w = new World({ seed: 7, battleIndex: 1, cheats: { god: true, aiEnabled: true, buster: false }, skipIntro: true });
      w.chips.queue = [];
      const met = w.enemies[0]!; // (1,1), in the player's lane: would attack within a second
      met.hp = 500;
      give(w, 'cannon');
      use(w);
      run(w, hitFrame());
      expect(met.paralyzeTicks).toBe(T(tuning.chips.PARALYZE_TIME) - 1);
      run(w, T(tuning.chips.PARALYZE_TIME) - 2);
      expect(met.state).toBe('IDLE');
      expect(w.attacks).toHaveLength(0);
      run(w, T(tuning.mettik.MET_MOVE_INTERVAL + tuning.mettik.MET_TELEGRAPH) + 2);
      expect(w.attacks.length + (met.state === 'ATTACK' || met.state === 'RECOVERY' ? 1 : 0)).toBeGreaterThan(0);
    });
  });

  it('panel effects crack or break every cell of the area', () => {
    withChip({ ...CHIPS.widesword, onHit: { panel: 'break' } }, () => {
      const w = makeWorld();
      movePlayer(w, 1, 3);
      const e = addEnemy(w, 1, 2);
      give(w, 'widesword');
      use(w);
      run(w, hitFrame());
      expect(w.field.panel(0, 2)).toBe('BROKEN');
      expect(w.field.panel(2, 2)).toBe('BROKEN');
      expect(w.field.panel(1, 2)).toBe('CRACKED'); // the enemy still stands there
      expect(e.hp).toBe(120);
    });
  });
});

describe('player wave and invis', () => {
  it('a player wave pierces enemies up the lane and stops at a hole', () => {
    const w = makeWorld();
    const a = addEnemy(w, 1, 2);
    const b = addEnemy(w, 1, 0);
    w.field.breakPanel(1, 1, w.tick, false);
    w.spawnAttack(new Shockwave(w.nextAttackId(), 1, 3, w.tick, {
      dir: -1,
      damage: 60,
      stepTicks: T(tuning.chips.PLAYER_WAVE_STEP),
      owner: 'player',
    }));
    run(w, T(tuning.chips.PLAYER_WAVE_STEP) * 6);
    expect(a.hp).toBe(140);
    expect(b.hp).toBe(200);
    expect(w.attacks).toHaveLength(0);
  });

  it('enemy attacks pass through an invisible player', () => {
    const w = makeWorld();
    w.player.invisTicks = T(1);
    w.spawnAttack(new Shockwave(w.nextAttackId(), 1, 3, w.tick));
    expect(w.shootLane(1, 0, 10)).toBe(6);
    run(w, T(0.6));
    expect(w.player.hitsTaken).toBe(0);
  });
});
```

Run: `npx vitest run tests/chipUse.test.ts` — Expected: FAIL.

- [ ] **Step 2: Враг**

`src/sim/enemies/enemyBase.ts`, в классе `Enemy` после `deathTick = -Infinity;`:

```ts
  /** Ticks left of paralysis: no actions, state timers stand still. */
  paralyzeTicks = 0;
```

и методы перед `abstract update`:

```ts
  paralyze(ticks: number): void {
    if (this.alive) this.paralyzeTicks = Math.max(this.paralyzeTicks, ticks);
  }

  /** Knock-back: one row away from the player if the panel allows it. */
  pushBack(ctx: EnemyContext): boolean {
    return this.alive && this.tryStep(ctx, this.x, this.y - 1);
  }
```

- [ ] **Step 3: Игрок**

`src/sim/player.ts`: поле `/** Remaining ticks of Invis: enemy attacks pass through. */ invisTicks = 0;` после `iframeTicks`; в `updateTimers()` строка `if (this.invisTicks > 0) this.invisTicks--;`.

- [ ] **Step 4: Волна**

`src/sim/attacks/attack.ts`, в `AttackContext`:

```ts
  /** Damages a living enemy on (x, y) once per attack; true if it was hit now. */
  hitEnemyAt(attack: Attack, x: number, y: number, damage: number): boolean;
```

`src/sim/attacks/shockwave.ts` заменить класс и интерфейс:

```ts
/** An attack that walks along a lane one panel per `stepTicks` (render interpolation uses this). */
export interface LaneMover extends Attack {
  readonly x: number;
  y: number;
  lastStepTick: number;
  readonly stepTicks: number;
  /** +1 moves toward the player's side, −1 toward the enemy's. */
  readonly dir: 1 | -1;
}

export interface WaveOptions {
  dir: 1 | -1;
  damage: number;
  stepTicks: number;
  owner: 'enemy' | 'player';
}

function mettikWave(): WaveOptions {
  return {
    dir: 1,
    damage: tuning.mettik.MET_DMG,
    stepTicks: Math.max(1, secondsToTicks(tuning.mettik.MET_WAVE_STEP)),
    owner: 'enemy',
  };
}

/**
 * Ground wave (GDD §8.2 Mettik, roguelite spec §4.2 ShockWave): travels one
 * panel per step, pierces its targets, stops at the field edge, a hole or an object.
 */
export class Shockwave implements LaneMover {
  readonly kind: string;
  readonly hitIds = new Set<number>();
  done = false;
  lastStepTick: number;
  readonly stepTicks: number;
  readonly damage: number;
  readonly dir: 1 | -1;
  private readonly owner: 'enemy' | 'player';

  constructor(
    readonly id: number,
    readonly x: number,
    public y: number,
    spawnTick: number,
    opts: WaveOptions = mettikWave(),
  ) {
    this.lastStepTick = spawnTick;
    this.stepTicks = Math.max(1, opts.stepTicks);
    this.damage = opts.damage;
    this.dir = opts.dir;
    this.owner = opts.owner;
    this.kind = opts.owner === 'player' ? 'playerWave' : 'shockwave';
  }

  update(ctx: AttackContext): void {
    if (this.done) return;
    if (ctx.tick - this.lastStepTick >= this.stepTicks) {
      this.y += this.dir;
      this.lastStepTick = ctx.tick;
      if (this.y < 0 || this.y >= ROWS) {
        this.done = true;
        return;
      }
      // Waves need a floor (roguelite spec §3.2).
      if (ctx.field.panel(this.x, this.y) === 'BROKEN') {
        this.done = true;
        return;
      }
    }
    if (ctx.hitObjectAt(this, this.x, this.y, this.damage)) {
      this.done = true;
      return;
    }
    if (this.owner === 'player') ctx.hitEnemyAt(this, this.x, this.y, this.damage);
    else ctx.hitPlayerAt(this, this.x, this.y, this.damage);
  }
}
```

`src/sim/attacks/heatShot.ts`: в классе добавить `readonly dir = 1 as const;`.

- [ ] **Step 5: Мир**

`src/sim/world.ts`:
- в `hitPlayerAt` условие `if (p.invulnerable) return false;` → `if (p.invulnerable || p.invisTicks > 0) return false;`
- в `shootLane` условие `if (p.invulnerable) continue;` → `if (p.invulnerable || p.invisTicks > 0) continue;`
- импорт `import { Shockwave } from './attacks/shockwave';`
- метод:

```ts
  hitEnemyAt(attack: Attack, x: number, y: number, damage: number): boolean {
    const e = this.enemyAt(x, y);
    if (!e || !e.alive || attack.hitIds.has(e.id)) return false;
    attack.hitIds.add(e.id);
    this.damageEnemy(e, damage);
    return true;
  }
```

- `hitCells`:

```ts
  private hitCells(cells: readonly Cell[], damage: number, def: ChipDef): void {
    const hit = this.damageCells(cells, damage);
    const on = def.onHit;
    if (!on) return;
    for (const e of hit) {
      if (!e.alive) continue;
      if (on.paralyze) e.paralyze(secondsToTicks(tuning.chips.PARALYZE_TIME));
      if (on.push) e.pushBack(this);
    }
    if (on.panel) {
      for (const c of cells) {
        if (on.panel === 'crack') this.field.crack(c.x, c.y);
        else this.field.breakPanel(c.x, c.y, this.tick, !this.occupancy.isFree(c.x, c.y));
      }
    }
  }
```

- в `resolveChip` ветку `case 'wave': case 'self':` заменить:

```ts
      case 'wave':
        this.spawnAttack(
          new Shockwave(this.attackIdCounter++, p.x, p.y - 1, this.tick, {
            dir: -1,
            damage: power,
            stepTicks: secondsToTicks(tuning.chips.PLAYER_WAVE_STEP),
            owner: 'player',
          }),
        );
        effect([]);
        break;
      case 'self':
        effect([]);
        break;
```

  и после блока `if (def.heal) {...}`:

```ts
    if (def.invis) p.invisTicks = secondsToTicks(tuning.chips.INVIS_TIME);
```

- цикл врагов в `step()`:

```ts
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.paralyzeTicks > 0) {
        // Paralysis freezes the enemy's state timer too.
        e.paralyzeTicks--;
        e.stateTick++;
        continue;
      }
      if (this.cheats.aiEnabled) e.update(this);
    }
```

  (заменяет `if (this.cheats.aiEnabled) { for (...) if (e.alive) e.update(this); }`).

- [ ] **Step 6: Визуал**

`src/render/fx.ts`:
- цикл атак: `if (a.kind === 'shockwave' || a.kind === 'playerWave') this.wave(a as unknown as LaneMover, tick, alpha, a.kind === 'playerWave' ? col.accent : col.red);`
- `wave(m, tick, alpha, color: THREE.Color)`: заменить `col.red` на `color` внутри; `const z = p.z + (progress - 0.5) * CELL_DEPTH * m.dir;`; точки клина: `A.set(p.x - hw, FLOOR_Y, z - tip * 0.3 * m.dir); B.set(p.x + hw, FLOOR_Y, z - tip * 0.3 * m.dir); C.set(p.x, FLOOR_Y, z + tip * m.dir); D.set(p.x, FLOOR_Y, z + tip * m.dir);`; комментарий: `/** Ground wave: a chevron strip sliding through the cell (red from enemies, accent from the player). */`

`src/render/actors.ts`:
- `PlayerView.update`: `this.pixels.setDissolve(player.alive ? 0 : 0.6);` → `this.pixels.setDissolve(!player.alive ? 0.6 : player.invisTicks > 0 ? 0.5 : 0);`
- `EnemyView.update`, перед `this.pixels.setFlash(flash);`:

```ts
    // Paralysis: a steady flicker.
    if (enemy.paralyzeTicks > 0 && Math.floor(tick / 4) % 2 === 0) flash = true;
```

- [ ] **Step 7: Тесты и коммит**

Run: `npm test` и `npm run build` — зелёные.

```bash
git add src tests
git commit -m "R3: push, paralysis, panel hits, player wave and invis"
```

---

### Task 3: 19 новых чипов, иконки, строки, папка p2

**Files:**
- Modify: `src/data/chips.ts`, `src/data/folders.ts`, `src/sim/world.ts`, `src/i18n/en.ts`, `src/terminal/chips/chipIcons.ts`, `src/debug/params.ts`, `src/debug/debugPanel.ts`
- Test: `tests/chipUse.test.ts`

**Interfaces:**
- Consumes: всё из задач 1–2; `world.field`, `world.placeObject` из R2.
- Produces: `ChipId` с 27 значениями; `FolderId = 'mvp' | 'p1' | 'p2'`; `World.applyFieldAction(action: FieldAction): void` (private).

- [ ] **Step 1: Тесты**

Дописать в `tests/chipUse.test.ts`:

```ts
const at = (w: World, x: number, y: number) => w.enemyAt(x, y)!;

describe('new attack chips', () => {
  it('M-Cannon deals 120', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 1, 300);
    give(w, 'mcannon');
    use(w);
    run(w, hitFrame());
    expect(e.hp).toBe(180);
  });

  it('AirShot pushes the target back', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 2);
    give(w, 'airshot');
    use(w);
    run(w, hitFrame());
    expect([e.hp, e.y]).toEqual([180, 1]);
  });

  it('V-Gun, SideGun and Spreader hit around the target', () => {
    let w = makeWorld();
    let t = addEnemy(w, 1, 1);
    const diag = addEnemy(w, 0, 0);
    give(w, 'vgun');
    use(w);
    run(w, hitFrame());
    expect([t.hp, diag.hp, at(w, 2, 0).hp]).toEqual([170, 170, 9969]);

    w = makeWorld();
    t = addEnemy(w, 1, 1);
    const side = addEnemy(w, 2, 1);
    give(w, 'sidegun');
    use(w);
    run(w, hitFrame());
    expect([t.hp, side.hp]).toEqual([170, 170]);

    w = makeWorld();
    t = addEnemy(w, 1, 1);
    const near = addEnemy(w, 0, 2);
    give(w, 'spreader');
    use(w);
    run(w, hitFrame());
    expect([t.hp, near.hp, at(w, 2, 0).hp]).toEqual([170, 170, 9969]);
  });

  it('LilBomb hits a row of 3 and CrosBomb a cross', () => {
    let w = makeWorld();
    const row = [addEnemy(w, 0, 1), addEnemy(w, 1, 1), addEnemy(w, 2, 1)];
    const front = addEnemy(w, 1, 2);
    give(w, 'lilbomb');
    use(w);
    run(w, hitFrame() + T(tuning.chips.BOMB_FLIGHT_TIME));
    expect([...row.map((e) => e.hp), front.hp]).toEqual([150, 150, 150, 200]);

    w = makeWorld();
    const cross = [addEnemy(w, 1, 1), addEnemy(w, 0, 1), addEnemy(w, 1, 0), addEnemy(w, 1, 2)];
    const corner = addEnemy(w, 0, 0);
    give(w, 'crosbomb');
    use(w);
    run(w, hitFrame() + T(tuning.chips.BOMB_FLIGHT_TIME));
    expect([...cross.map((e) => e.hp), corner.hp]).toEqual([140, 140, 140, 140, 200]);
  });

  it('ShockWave pierces up the lane', () => {
    const w = makeWorld();
    const a = addEnemy(w, 1, 2);
    const b = addEnemy(w, 1, 0);
    give(w, 'shockwave');
    use(w);
    run(w, hitFrame() + T(tuning.chips.PLAYER_WAVE_STEP) * 6);
    expect([a.hp, b.hp]).toEqual([140, 140]);
  });

  it('Quake1 cracks the landing panel', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 1);
    give(w, 'quake1');
    use(w);
    run(w, hitFrame() + T(tuning.chips.BOMB_FLIGHT_TIME));
    expect(e.hp).toBe(110);
    expect(w.field.panel(1, 1)).toBe('CRACKED');
  });

  it('ZapRing paralyzes', () => {
    const w = makeWorld();
    const e = addEnemy(w, 1, 1);
    give(w, 'zapring');
    use(w);
    run(w, hitFrame());
    expect(e.hp).toBe(180);
    expect(e.paralyzeTicks).toBeGreaterThan(0);
  });

  it('Recov10, Recov80 and Invis', () => {
    const w = makeWorld();
    w.player.hp = 5;
    give(w, 'recov10', 'recov80', 'invis');
    use(w);
    expect(w.player.hp).toBe(15);
    run(w, useTicks(CHIPS.recov10));
    use(w);
    expect(w.player.hp).toBe(95);
    run(w, useTicks(CHIPS.recov80));
    use(w);
    expect(w.player.invisTicks).toBe(T(tuning.chips.INVIS_TIME));
  });
});

describe('field chips', () => {
  const useNow = (w: World, id: ChipId) => {
    give(w, id);
    use(w);
    run(w, useTicks(CHIPS[id]));
  };

  it('Crack cracks the nearest enemy row', () => {
    const w = makeWorld();
    useNow(w, 'crack');
    expect([0, 1, 2].map((x) => w.field.panel(x, 2))).toEqual(['CRACKED', 'CRACKED', 'CRACKED']);
    expect(w.field.panel(1, 1)).toBe('NORMAL');
  });

  it('Geddon1 cracks every empty panel, Geddon2 breaks empty enemy panels', () => {
    let w = makeWorld();
    useNow(w, 'geddon1');
    expect(w.field.panel(0, 5)).toBe('CRACKED');
    expect(w.field.panel(0, 0)).toBe('CRACKED');
    expect(w.field.panel(1, 4)).toBe('NORMAL'); // the player
    expect(w.field.panel(2, 0)).toBe('NORMAL'); // an enemy

    w = makeWorld();
    useNow(w, 'geddon2');
    expect(w.field.panel(0, 0)).toBe('BROKEN');
    expect(w.field.panel(2, 0)).toBe('NORMAL');
    expect(w.field.panel(0, 5)).toBe('NORMAL');
  });

  it('Steal takes the free panels of the nearest enemy row', () => {
    const w = makeWorld();
    addEnemy(w, 0, 2);
    useNow(w, 'steal');
    expect([0, 1, 2].map((x) => w.field.owner(x, 2))).toEqual(['enemy', 'player', 'player']);
  });

  it('Repair fixes only the player panels', () => {
    const w = makeWorld();
    w.field.breakPanel(0, 5, w.tick, false);
    w.field.crack(2, 3);
    w.field.breakPanel(0, 0, w.tick, false);
    useNow(w, 'repair');
    expect([w.field.panel(0, 5), w.field.panel(2, 3), w.field.panel(0, 0)]).toEqual(['NORMAL', 'NORMAL', 'BROKEN']);
  });

  it('RockCube puts a rock on the free own panel in front', () => {
    const w = makeWorld();
    useNow(w, 'rockcube');
    expect(w.objectAt(1, 3)?.kind).toBe('rock');
    useNow(w, 'rockcube');
    expect(w.objects).toHaveLength(1);
    movePlayer(w, 0, 3);
    useNow(w, 'rockcube');
    expect(w.objects).toHaveLength(1); // (0,2) belongs to the enemy
  });

  it('field and support chips resolve at once', () => {
    const w = makeWorld();
    give(w, 'crack');
    use(w);
    expect(w.field.panel(1, 2)).toBe('CRACKED');
  });
});
```

Run: `npx vitest run tests/chipUse.test.ts` — Expected: FAIL (неизвестные чипы).

- [ ] **Step 2: Данные**

`src/data/chips.ts`:
- `ChipId`:

```ts
export type ChipId =
  | 'cannon' | 'hicannon' | 'mcannon' | 'airshot' | 'vgun' | 'sidegun' | 'spreader' | 'shotgun'
  | 'sword' | 'widesword' | 'longsword'
  | 'minibomb' | 'lilbomb' | 'crosbomb' | 'shockwave' | 'quake1' | 'zapring'
  | 'recov10' | 'recover50' | 'recov80' | 'invis'
  | 'crack' | 'geddon1' | 'geddon2' | 'steal' | 'repair' | 'rockcube';
```

- константы перед `CHIPS`:

```ts
const RING: readonly Offset[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];
const SPOT: readonly Offset[] = [{ x: 0, y: 0 }];
const FIELD_CHIP = { power: null, kind: 'field', useTime: 'FIELD', shape: { t: 'self' } } as const;
```

- в `CHIPS` добавить (коды новых чипов — `[оценка]`):

```ts
  mcannon: { id: 'mcannon', power: 120, kind: 'attack', useTime: 'CANNON', codes: ['K', 'L', 'M', 'N', 'O'], rarity: 'rare', shape: LANE },
  airshot: { id: 'airshot', power: 20, kind: 'attack', useTime: 'CANNON', codes: ['*'], rarity: 'common', shape: LANE, onHit: { push: true } },
  vgun: {
    id: 'vgun', power: 30, kind: 'attack', useTime: 'CANNON', codes: ['D', 'E', 'L', 'M', 'S'], rarity: 'common',
    shape: { t: 'lane', around: [{ x: -1, y: -1 }, { x: 1, y: -1 }] },
  },
  sidegun: {
    id: 'sidegun', power: 30, kind: 'attack', useTime: 'CANNON', codes: ['A', 'G', 'H', 'R', 'S'], rarity: 'common',
    shape: { t: 'lane', around: [{ x: -1, y: 0 }, { x: 1, y: 0 }] },
  },
  spreader: { id: 'spreader', power: 30, kind: 'attack', useTime: 'CANNON', codes: ['M', 'N', 'O', 'P', 'Q'], rarity: 'uncommon', shape: { t: 'lane', around: RING } },
  lilbomb: {
    id: 'lilbomb', power: 50, kind: 'attack', useTime: 'BOMB', codes: ['B', 'G', 'L', 'O', 'T'], rarity: 'common',
    shape: { t: 'lob', depth: 3, area: [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }] },
  },
  crosbomb: {
    id: 'crosbomb', power: 60, kind: 'attack', useTime: 'BOMB', codes: ['B', 'G', 'L', 'O', 'V'], rarity: 'uncommon',
    shape: { t: 'lob', depth: 3, area: [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }] },
  },
  shockwave: { id: 'shockwave', power: 60, kind: 'attack', useTime: 'CANNON', codes: ['C', 'D', 'J', 'L', 'M'], rarity: 'common', shape: { t: 'wave' } },
  quake1: {
    id: 'quake1', power: 90, kind: 'attack', useTime: 'BOMB', codes: ['A', 'B', 'Q', 'R', 'S'], rarity: 'uncommon',
    shape: { t: 'lob', depth: 3, area: SPOT }, onHit: { panel: 'crack' },
  },
  zapring: { id: 'zapring', power: 20, kind: 'attack', useTime: 'CANNON', codes: ['A', 'B', 'C', 'D', 'E'], rarity: 'common', shape: LANE, onHit: { paralyze: true } },
  recov10: { id: 'recov10', power: null, kind: 'support', useTime: 'RECOVER', codes: ['A', 'C', 'E', 'G', 'L'], rarity: 'common', shape: { t: 'self' }, heal: 10 },
  recov80: { id: 'recov80', power: null, kind: 'support', useTime: 'RECOVER', codes: ['A', 'C', 'E', 'G', 'L'], rarity: 'rare', shape: { t: 'self' }, heal: 80 },
  invis: { id: 'invis', power: null, kind: 'support', useTime: 'RECOVER', codes: ['*'], rarity: 'uncommon', shape: { t: 'self' }, invis: true },
  crack: { id: 'crack', ...FIELD_CHIP, codes: ['A', 'B', 'C', '*'], rarity: 'common', field: 'crackRow' },
  geddon1: { id: 'geddon1', ...FIELD_CHIP, codes: ['F', 'H', 'J', 'L', 'N'], rarity: 'uncommon', field: 'crackAll' },
  geddon2: { id: 'geddon2', ...FIELD_CHIP, codes: ['E', 'G', 'I', 'K', 'M'], rarity: 'rare', field: 'breakEnemy' },
  steal: { id: 'steal', ...FIELD_CHIP, codes: ['A', 'L', 'S', '*'], rarity: 'uncommon', field: 'steal' },
  repair: { id: 'repair', ...FIELD_CHIP, codes: ['A', 'B', 'C', 'D', '*'], rarity: 'common', field: 'repair' },
  rockcube: { id: 'rockcube', ...FIELD_CHIP, codes: ['*'], rarity: 'common', field: 'rock' },
```

  (`SPOT` использовать и в `minibomb`: `area: SPOT`.) После правки прогнать `npx prettier --write src/data/chips.ts`, если prettier есть в проекте (`npx prettier --version`); иначе оставить как есть.

- [ ] **Step 3: Действия с полем**

`src/sim/world.ts`: импорт `COLS` из `./grid`, тип `FieldAction` из `../data/chips`; в `resolveChip` перед `if (def.heal)`: `if (def.field) this.applyFieldAction(def.field);`; методы:

```ts
  /** Nearest row in front of the player with an enemy panel; -1 if none. */
  private nearestEnemyRow(): number {
    for (let y = this.player.y - 1; y >= 0; y--) {
      for (let x = 0; x < COLS; x++) if (this.field.owner(x, y) === 'enemy') return y;
    }
    return -1;
  }

  /** Field chips (roguelite spec §4.4). */
  private applyFieldAction(action: FieldAction): void {
    const f = this.field;
    const free = (x: number, y: number) => this.occupancy.isFree(x, y);
    const p = this.player;
    switch (action) {
      case 'crackRow':
      case 'steal': {
        const y = this.nearestEnemyRow();
        if (y < 0) return;
        for (let x = 0; x < COLS; x++) {
          if (f.owner(x, y) !== 'enemy') continue;
          if (action === 'crackRow') f.crack(x, y);
          else if (free(x, y)) f.setOwner(x, y, 'player', this.tick);
        }
        return;
      }
      case 'crackAll':
      case 'breakEnemy':
      case 'repair':
        for (let y = 0; y < ROWS; y++) {
          for (let x = 0; x < COLS; x++) {
            if (action === 'repair') {
              if (f.owner(x, y) === 'player') f.repair(x, y);
            } else if (free(x, y)) {
              if (action === 'crackAll') f.crack(x, y);
              else if (f.owner(x, y) === 'enemy') f.breakPanel(x, y, this.tick, false);
            }
          }
        }
        return;
      case 'rock':
        if (f.owner(p.x, p.y - 1) === 'player') this.placeObject('rock', p.x, p.y - 1, 'player');
        return;
    }
  }
```

- [ ] **Step 4: Строки**

`src/i18n/en.ts`, после строк `recover50`:

```ts
  'chip.mcannon.name': 'M-Cannon',
  'chip.mcannon.desc': 'The biggest cannon. Hits the first enemy in your lane.',
  'chip.airshot.name': 'AirShot',
  'chip.airshot.desc': 'Hits the first enemy in your lane and pushes it back.',
  'chip.vgun.name': 'V-Gun',
  'chip.vgun.desc': 'Hits an enemy and the two panels diagonally behind it.',
  'chip.sidegun.name': 'SideGun',
  'chip.sidegun.desc': 'Hits an enemy and the panels on both sides of it.',
  'chip.spreader.name': 'Spreader',
  'chip.spreader.desc': 'Hits an enemy and every panel around it.',
  'chip.lilbomb.name': 'LilBomb',
  'chip.lilbomb.desc': 'Throws a bomb 3 panels ahead. Hits a row of 3.',
  'chip.crosbomb.name': 'CrosBomb',
  'chip.crosbomb.desc': 'Throws a bomb 3 panels ahead. Hits a cross.',
  'chip.shockwave.name': 'ShockWave',
  'chip.shockwave.desc': 'Sends a wave up your lane. Stops at holes.',
  'chip.quake1.name': 'Quake1',
  'chip.quake1.desc': 'Drops a rock 3 panels ahead and cracks the panel.',
  'chip.zapring.name': 'ZapRing',
  'chip.zapring.desc': 'Hits the first enemy in your lane and paralyzes it.',
  'chip.recov10.name': 'Recov10',
  'chip.recov10.desc': 'Restores 10 HP.',
  'chip.recov80.name': 'Recov80',
  'chip.recov80.desc': 'Restores 80 HP.',
  'chip.invis.name': 'Invis',
  'chip.invis.desc': 'Enemy attacks pass through you for a while.',
  'chip.crack.name': 'Crack',
  'chip.crack.desc': 'Cracks the nearest enemy row.',
  'chip.geddon1.name': 'Geddon1',
  'chip.geddon1.desc': 'Cracks every empty panel. Yours too.',
  'chip.geddon2.name': 'Geddon2',
  'chip.geddon2.desc': 'Breaks every empty enemy panel.',
  'chip.steal.name': 'Steal',
  'chip.steal.desc': 'Takes the nearest enemy row for a while.',
  'chip.repair.name': 'Repair',
  'chip.repair.desc': 'Fixes all of your panels.',
  'chip.rockcube.name': 'RockCube',
  'chip.rockcube.desc': 'Puts a rock on the panel in front of you.',
```

- [ ] **Step 5: Иконки**

`src/terminal/chips/chipIcons.ts`:
- `export const CHIP_ICONS: Record<ChipId, readonly string[]> = {` → `const BASE_ICONS = {`; закрывающее `};` этого объекта → `} satisfies Record<string, readonly string[]>;`
- после него:

```ts
const NEW_ICONS = {
  wave: [
    '................',
    '................',
    '................',
    '.......cc.......',
    '......cbbc......',
    '.....cb..bc.....',
    '....cb....bc....',
    '...cb.cc...bc...',
    '..cb.cbbc...bc..',
    '.cb.cb..bc...bc.',
    'cb.cb....bc...bc',
    'b.cb......bc...b',
    '.cb........bc...',
    'kkkkkkkkkkkkkkkk',
    'dddddddddddddddd',
    '................',
  ],
  zap: [
    '..........yyyy..',
    '.........yyyk...',
    '........yyyk....',
    '.......yyyk.....',
    '......yyyk......',
    '.....yyyk.......',
    '....yyyyyyyyy...',
    '.....kkkyyyk....',
    '.......yyyk.....',
    '......yyyk......',
    '.....yyk........',
    '....yyk.........',
    '...yk...........',
    '..yk............',
    '.y..............',
    '................',
  ],
  invis: [
    '................',
    '.......c........',
    '......c.c.......',
    '.....c...c......',
    '......c.c.......',
    '................',
    '....c.c.c.c.....',
    '...c.......c....',
    '..c..c...c..c...',
    '.....c...c......',
    '....c.....c.....',
    '.....c...c......',
    '....c.....c.....',
    '...c.......c....',
    '..cc.......cc...',
    '................',
  ],
  crack: [
    'kkkkkkkkkkkkkkkk',
    'kbbbbbbwbbbbbbbk',
    'kbbbbbbwbbbbbbbk',
    'kbbbbbwwbbbbbbbk',
    'kbbbbbwbbbbbbbbk',
    'kbbbbbbwwbbbbbbk',
    'kbbbbbbbwbbbbbbk',
    'kbbbbbbwwbbbbbbk',
    'kbbbbbwwbbbbbbbk',
    'kbbbbwwbbbwbbbbk',
    'kbbbbwbbbwwbbbbk',
    'kbbbbwwwwwbbbbbk',
    'kbbbbbbbbbbbbbbk',
    'kbbbbbbbbbbbbbbk',
    'kkkkkkkkkkkkkkkk',
    '.dddddddddddddd.',
  ],
  rock: [
    '................',
    '................',
    '.....kkkkkk.....',
    '....kggggggk....',
    '...kgwggggdgk...',
    '..kgwgggggddgk..',
    '..kggggggggdgk..',
    '..kgggdggggggk..',
    '..kggddgggggdk..',
    '..kgggggggddgk..',
    '..kdgggggdddgk..',
    '...kddddddddk...',
    '....kkkkkkkk....',
    '................',
    '................',
    '................',
  ],
  steal: [
    '................',
    '..rrrrrrrrrrrr..',
    '..rkkkkkkkkkkr..',
    '..rrrrrrrrrrrr..',
    '.......cc.......',
    '......cccc......',
    '.....cccccc.....',
    '....cccccccc....',
    '.......cc.......',
    '.......cc.......',
    '.......cc.......',
    '..bbbbbbbbbbbb..',
    '..bkkkkkkkkkkb..',
    '..bbbbbbbbbbbb..',
    '................',
    '................',
  ],
  repair: [
    '................',
    '..........GGG...',
    '.........G...G..',
    '.........G..GG..',
    '..........G..GG.',
    '.........G....G.',
    '........G..GGG..',
    '.......G..G.....',
    '......G..G......',
    '.....G..G.......',
    '....G..G........',
    '...G..G.........',
    '..G..G..........',
    '..G.G...........',
    '...G............',
    '................',
  ],
} satisfies Record<string, readonly string[]>;

const B = BASE_ICONS;
const N = NEW_ICONS;

/** Every chip's icon; new chips reuse the closest family icon where one fits. */
export const CHIP_ICONS: Record<ChipId, readonly string[]> = {
  ...B,
  mcannon: B.hicannon,
  airshot: B.cannon,
  vgun: B.shotgun,
  sidegun: B.shotgun,
  spreader: B.shotgun,
  lilbomb: B.minibomb,
  crosbomb: B.minibomb,
  shockwave: N.wave,
  quake1: N.rock,
  zapring: N.zap,
  recov10: B.recover50,
  recov80: B.recover50,
  invis: N.invis,
  crack: N.crack,
  geddon1: N.crack,
  geddon2: N.crack,
  steal: N.steal,
  repair: N.repair,
  rockcube: N.rock,
};
```

- [ ] **Step 6: Папка p2**

`src/data/folders.ts`: `export type FolderId = 'mvp' | 'p1' | 'p2';`, в `FOLDERS`:

```ts
  /** Debug: the roguelite chips (roguelite spec §4.4). */
  p2: [
    { chip: 'cannon', code: 'A', count: 2 },
    { chip: 'mcannon', code: 'K', count: 2 },
    { chip: 'airshot', code: '*', count: 2 },
    { chip: 'vgun', code: 'S', count: 2 },
    { chip: 'sidegun', code: 'S', count: 2 },
    { chip: 'spreader', code: 'M', count: 2 },
    { chip: 'lilbomb', code: 'L', count: 2 },
    { chip: 'crosbomb', code: 'L', count: 2 },
    { chip: 'shockwave', code: 'L', count: 2 },
    { chip: 'quake1', code: 'S', count: 2 },
    { chip: 'zapring', code: 'A', count: 2 },
    { chip: 'recov80', code: 'A', count: 1 },
    { chip: 'invis', code: '*', count: 1 },
    { chip: 'crack', code: '*', count: 1 },
    { chip: 'geddon1', code: 'L', count: 1 },
    { chip: 'geddon2', code: 'M', count: 1 },
    { chip: 'steal', code: 'S', count: 1 },
    { chip: 'repair', code: '*', count: 1 },
    { chip: 'rockcube', code: '*', count: 1 },
  ],
```

`src/debug/params.ts`: `folder: 'mvp' | 'p1';` → `folder: FolderId;` (импорт `import type { FolderId } from '../data/folders';`), разбор: `folder: (['p1', 'p2'] as const).find((f) => f === q.get('folder')) ?? 'mvp',`; в комментарии сверху `folder=p1` → `folder=p1|p2`.
`src/debug/debugPanel.ts`: список `['mvp', 'p1']` → `Object.keys(FOLDERS)` (импорт `FOLDERS` из `../data/folders`).

- [ ] **Step 7: Тесты и коммит**

Run: `npm test` и `npm run build` — зелёные. Упавший `pixel font coverage` — значит, в строке символ без глифа: переформулировать строку.

```bash
git add src tests
git commit -m "R3: 19 new chips including field chips, icons, strings, debug folder p2"
```

---

### Task 4: Проверка в браузере и документация

**Files:**
- Modify: `docs/GDD.md`, `docs/superpowers/specs/2026-09-17-roguelite-content-design.md`, `docs/TERMINAL.md` (если упоминает список чипов)

- [ ] **Step 1: Браузер**

Dev-сервер на :5173. Chrome DevTools MCP, эмуляция `390x844x3,mobile,touch`, `http://localhost:5173/?battle=3&god=1&seed=7&folder=p2`. Выбрать чипы на лотке, пострелять. Проверить в консоли по очереди, выдавая чипы через `__glorp.world.giveChip({ uid: 90000 + n, defId: '<id>', code: '*', state: 'queued' })` и нажимая Space:
- ShockWave — акцентный клин идёт вверх по колонке;
- CrosBomb — вспышки крестом;
- ZapRing — враг мерцает и стоит;
- Invis — спрайт игрока в редком дизеринге;
- Crack / Geddon1 / Geddon2 / Steal / Repair / RockCube — клетки меняются как в тестах;
- кассеты новых чипов на лотке: название влезает, иконка на месте, у полевых — своя рамка.

Скриншот после каждого визуального пункта; если что-то не так — исправить до коммита.

- [ ] **Step 2: GDD**

`docs/GDD.md`:
- §6.1: описать новую модель данных (форма, эффект при попадании, действие с полем, лечение, невидимость, коды, редкость) и сослаться на спеку §4.
- §6.2: заголовок `### 6.2. Набор чипов [MMBN1]`; в таблицу добавить 19 строк (имя, оригинал MMBN1, урон, коды `[оценка]` для новых, форма, редкость) по данным `src/data/chips.ts`; столбец «Шаблон атаки» → «Форма»; пункт «AreaGrab удалён из MVP» → «Steal (аналог AreaGrab) добавлен [решение 2026-09-17]».
- §6.3: упомянуть отладочную папку `p2`.
- §6.4: заголовок `### 6.4. Формы атак`; таблицу переписать на `lane` (с `around`), `near`, `lob` (с `depth`, `area`), `wave`, `self` и эффекты `push` / `paralyze` / `panel`; строку про `lob_3` сохранить по смыслу (бомба летит `BOMB_FLIGHT_TIME`, урон — при приземлении, по области).
- §17: строку `RECOVER_AMOUNT` удалить (лечение — в данных чипа); `CHIP_USE_TIME.*` → `0.4–0.5`, группы CANNON/SWORD/BOMB/RECOVER/FIELD; добавить `| \`PARALYZE_TIME\` | 1.5 | с | [оценка] |`, `| \`INVIS_TIME\` | 3.0 | с | [оценка] |`, `| \`PLAYER_WAVE_STEP\` | 0.15 | с | [оценка] |`.

Спека §4.4: `M-Cannon | 80` → `M-Cannon | 120`; «Новые — 18; всего 26» → «Новые — 19; всего 27»; в §0/§1 «18 новых чипов» → «19 новых чипов»; §4.1 — `paralyze?: true`, `invis?: true` вместо чисел, длительности в tuning.

`grep -n "Recover50\|8 чип\|восемь" docs/TERMINAL.md` — если терминальная спека перечисляет чипы, дополнить.

- [ ] **Step 3: Проверка и коммит**

Run: `npm test` и `npm run build` — зелёные.

```bash
git add docs/GDD.md docs/TERMINAL.md
git commit -m "R3: docs for the chip model and the new chips"
```

(Спеку и планы не коммитить — пользователь просил держать их вне коммитов.)

- [ ] **Step 4: Итог этапа**

Сообщить пользователю по-русски, что сделано в R3. Не пушить. Предложить написать план R4.
