# Roguelite R1–R2: Buster и панели поля — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вернуть авто-Buster и добавить в симуляцию состояния панелей (трещины, дыры, захват, объекты), которые визуал поля читает из `World`.

**Architecture:** `sim/buster.ts` — таймер выстрела, `World` стреляет по первой цели колонки. `sim/field.ts` — класс `Field` (панель, владелец, таймеры) внутри `World`; игрок, враги и волны спрашивают его, можно ли встать/пройти. `sim/fieldObject.ts` — объекты с HP в `Occupancy`. `render/cellStates` получает панели, владельцев и объекты из мира.

**Tech Stack:** TypeScript strict, Vitest, Three.js 0.186, Vite 8.

**Spec:** [docs/superpowers/specs/2026-09-17-roguelite-content-design.md](../specs/2026-09-17-roguelite-content-design.md) — §1, §2, §3.

## Global Constraints

- `src/sim` — без DOM и Three.js; вся случайность — `world.rngAi` / `world.rngFolder`.
- Все длительности — в `tuning.ts` в секундах, в логике через `secondsToTicks()`.
- Таймеры панелей и Buster идут по `world.tick` (замирают вместе с симуляцией).
- Визуал только читает симуляцию; связь sim → view через `SimEvent`.
- Материалы боя пишут сигнал (`render/palette.ts`), не цвет.
- Перед каждым коммитом: `npm test` и `npm run build` проходят. Коммит на задачу, пуш — в конце этапа, по согласию пользователя.
- Сообщения коммитов — английский, с трейлером `Co-Authored-By` из харнеса.
- Не запускать замеры производительности (`?bench=1`, троттлинг CPU).

## Общий план этапов

| Этап | План | Статус |
|---|---|---|
| R1 Buster | этот файл, задача 1 | готово |
| R2 Панели | этот файл, задачи 2–5 | готово |
| R3 Чипы из блоков, 19 новых чипов | `2026-09-17-roguelite-r3-chips.md` | готово |
| R4 Враги, уровни, босс, встречи | `2026-09-17-roguelite-r4-r5-enemies-run.md` | готово |
| R5 Забег, награды, наследие | `2026-09-17-roguelite-r4-r5-enemies-run.md` | готово |

Планы R3–R5 пишутся после завершения предыдущего этапа: их код опирается на API, появляющиеся здесь.

## Карта файлов (R1–R2)

| Файл | Действие | Ответственность |
|---|---|---|
| `src/config/tuning.ts` | изменить | группы `buster`, `field`; `fx.BUSTER_TRACER_TIME` |
| `src/sim/buster.ts` | создать | таймер авто-выстрела |
| `src/sim/field.ts` | создать | панели, владельцы, таймеры восстановления |
| `src/sim/fieldObject.ts` | создать | объект с HP (камень) |
| `src/sim/events.ts` | изменить | `busterShot`, `panelChanged`, `objectPlaced`, `objectBroken` |
| `src/sim/world.ts` | изменить | Buster, `field`, `objects`, цели-объекты |
| `src/sim/player.ts` | изменить | `canStep` через `field`, `onLeave` |
| `src/sim/enemies/enemyBase.ts` | изменить | `EnemyContext.field`, `tryStep`/`warpTo` через `field` |
| `src/sim/enemies/spiker.ts` | изменить | `freeCells` учитывает `field` |
| `src/sim/attacks/attack.ts`, `shockwave.ts` | изменить | волна обрывается на дыре и бьёт объекты |
| `src/render/cellStates.ts` | изменить | панели, владельцы, объекты, флаг трещины |
| `src/render/field.ts` | изменить | раскраска по владельцу, трещина, граница по владельцу |
| `src/render/fx.ts` | изменить | трассер Buster |
| `src/debug/debugPanel.ts`, `src/main.ts` | изменить | чит `buster`, DBG → Field: действия над симуляцией |
| `tests/buster.test.ts`, `tests/field.test.ts` | создать | тесты |
| `tests/battleVisual.test.ts` | изменить | новые входы `cellStates` |
| `docs/GDD.md`, `CLAUDE.md`, `docs/BATTLE_VISUAL.md` | изменить | документация |

---

### Task 1: Авто-Buster (R1)

**Files:**
- Create: `src/sim/buster.ts`, `tests/buster.test.ts`
- Modify: `src/config/tuning.ts`, `src/sim/events.ts`, `src/sim/world.ts`, `src/render/fx.ts`, `src/debug/debugPanel.ts`, `src/main.ts`, `docs/GDD.md`, `CLAUDE.md`, существующие тесты, которые ломает авто-урон

**Interfaces:**
- Produces: `class Buster { tick(blocked: boolean): boolean }`; `World.buster`; событие `{ type: 'busterShot'; x: number; fromY: number; toY: number }` (`toY` = -1 при промахе); `Cheats.buster?: boolean` (по умолчанию включён); `World.firstTargetRow(x, py): number` (в R2 расширяется объектами).

- [ ] **Step 1: Тесты**

`tests/buster.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { SimEvent } from '../src/sim/events';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

// Battle 1: one Mettik at (1,1); the player starts at (1,4) in the same column.
function makeWorld(): World {
  const w = new World({ seed: 7, battleIndex: 1, cheats: { god: true, aiEnabled: false }, skipIntro: true });
  w.chips.queue = [];
  return w;
}

function run(w: World, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    w.step(DT);
    out.push(...w.drainEvents());
  }
  return out;
}

const shots = (ev: SimEvent[]) => ev.filter((e) => e.type === 'busterShot');

describe('auto Buster', () => {
  it('fires once per interval at the first enemy in the column', () => {
    const w = makeWorld();
    const met = w.enemies[0]!;
    const I = T(tuning.buster.BUSTER_INTERVAL);
    expect(shots(run(w, I - 1))).toHaveLength(0);
    const ev = run(w, 1);
    expect(shots(ev)).toEqual([{ type: 'busterShot', x: 1, fromY: 4, toY: 1 }]);
    expect(met.hp).toBe(tuning.mettik.MET_HP - tuning.buster.BUSTER_DAMAGE);
    expect(shots(run(w, I))).toHaveLength(1);
  });

  it('misses when the column is empty', () => {
    const w = makeWorld();
    w.step(DT, { commands: [{ type: 'move', dir: 'left' }], held: null });
    const ev = run(w, T(tuning.buster.BUSTER_INTERVAL));
    expect(shots(ev)).toEqual([{ type: 'busterShot', x: 0, fromY: 4, toY: -1 }]);
    expect(w.enemies[0]!.hp).toBe(tuning.mettik.MET_HP);
  });

  it('holds fire during a chip or a flinch and does not stack shots', () => {
    const w = makeWorld();
    const I = T(tuning.buster.BUSTER_INTERVAL);
    w.player.actionTicks = I * 3;
    expect(shots(run(w, I * 3 - 1))).toHaveLength(0);
    expect(shots(run(w, 2))).toHaveLength(1);
    w.player.flinchTicks = I * 2;
    expect(shots(run(w, I * 2 - 1))).toHaveLength(0);
    expect(shots(run(w, I))).toHaveLength(1);
  });

  it('can be switched off by the cheat', () => {
    const w = new World({ seed: 7, battleIndex: 1, cheats: { god: true, aiEnabled: false, buster: false }, skipIntro: true });
    expect(shots(run(w, T(tuning.buster.BUSTER_INTERVAL) * 3))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/buster.test.ts`
Expected: FAIL (нет `tuning.buster`, `busterShot`).

- [ ] **Step 3: Tuning**

В `src/config/tuning.ts` после группы `player` добавить:

```ts
  /** Auto Buster (roguelite spec §2): a weak instant shot down the player's column. */
  buster: {
    BUSTER_INTERVAL: 1.0,
    BUSTER_DAMAGE: 1,
  },
```

В группу `fx` после `CANNON_TRACER_TIME` добавить `BUSTER_TRACER_TIME: 0.08,`.

- [ ] **Step 4: `src/sim/buster.ts`**

```ts
import { secondsToTicks, tuning } from '../config/tuning';

// Auto Buster timer (roguelite spec §2): one shot per BUSTER_INTERVAL while the
// player is free. A blocked shot waits; shots never stack.

export class Buster {
  private wait = Math.max(1, secondsToTicks(tuning.buster.BUSTER_INTERVAL));

  /** Advances one sim tick; returns true when a shot fires now. */
  tick(blocked: boolean): boolean {
    if (this.wait > 0) this.wait--;
    if (blocked || this.wait > 0) return false;
    this.wait = Math.max(1, secondsToTicks(tuning.buster.BUSTER_INTERVAL));
    return true;
  }
}
```

- [ ] **Step 5: Событие и мир**

`src/sim/events.ts`, в объединение добавить:

```ts
  /** Auto Buster shot down lane x; toY = row of the target hit, or -1 on a miss. */
  | { type: 'busterShot'; x: number; fromY: number; toY: number }
```

`src/sim/world.ts`:
- `Cheats`: добавить `/** Auto Buster; on unless false. */ buster?: boolean;`
- импорт `import { Buster } from './buster';`, поле `readonly buster = new Buster();`
- переименовать приватную стрелку `firstEnemyRow` в публичный метод:

```ts
  /** Row of the first target in lane `x` in front of row `py`; -1 if none. */
  firstTargetRow = (x: number, py: number): number => {
    for (let y = py - 1; y >= 0; y--) {
      const e = this.enemyAt(x, y);
      if (e && e.alive) return y;
    }
    return -1;
  };
```

  и заменить `this.firstEnemyRow` на `this.firstTargetRow` в `resolveChip`.
- метод:

```ts
  private fireBuster(): void {
    const p = this.player;
    const y = this.firstTargetRow(p.x, p.y);
    this.events.push({ type: 'busterShot', x: p.x, fromY: p.y, toY: y });
    const e = y >= 0 ? this.enemyAt(p.x, y) : null;
    if (e) this.damageEnemy(e, tuning.buster.BUSTER_DAMAGE);
  }
```

- в `step()` сразу после `this.updateBombs();`:

```ts
    const busy = p.flinched || p.actionTicks > 0 || this.activeChip !== null;
    if (this.buster.tick(busy || this.cheats.buster === false)) this.fireBuster();
```

- [ ] **Step 6: Прогнать новые тесты**

Run: `npx vitest run tests/buster.test.ts`
Expected: PASS.

- [ ] **Step 7: Починить старые тесты, которым мешает авто-урон**

Run: `npm test`
Для каждого упавшего файла (ожидаемо `combat.test.ts`, `chipUse.test.ts`, `enemies.test.ts`, `session.test.ts`), где падение — лишний урон 1 или лишнее событие `damaged`, добавить в его `beforeEach` после сброса tuning:

```ts
  // Isolate chip and enemy damage from the auto Buster.
  tuning.buster.BUSTER_INTERVAL = 1e6;
```

Если тест падает по другой причине — разобраться, а не глушить. Повторять `npm test` до зелёного.

- [ ] **Step 8: Визуал, чит и документы**

`src/render/fx.ts`, в `handleEvent` добавить ветку:

```ts
      case 'busterShot':
        this.push('tracer', tick, fx.BUSTER_TRACER_TIME, e.x, e.fromY, e.toY);
        break;
```

`src/main.ts`: `const cheats: Cheats = { god: params.god, aiEnabled: true, buster: true };`
`src/debug/debugPanel.ts`, после строки `cf.add(a.cheats, 'aiEnabled').name('enemy AI');`:

```ts
    cf.add(a.cheats, 'buster').name('auto buster');
```

`docs/GDD.md`:
- строка таблицы §0.1 `| Mega Buster | — (удалён, §4) | — |` → `| Mega Buster | Buster (авто, §4) | — |`;
- §4 заменить целиком:

```markdown
## 4. Buster — автоматический

**[решение 2026-09-17]** Buster вернулся в упрощённом виде (заменяет решение об удалении): игрок сам стреляет раз в `BUSTER_INTERVAL` = 1 с мгновенным выстрелом по своей колонке, урон `BUSTER_DAMAGE` = 1 (базовый Buster MMBN1) первой цели. Выстрела нет во время анимации чипа, оглушения, паралича и заморозки боя; пропущенные выстрелы не копятся. Смысл — добивать врагов и стоять напротив цели; подробности — [спека roguelite §2](superpowers/specs/2026-09-17-roguelite-content-design.md).
```

- §17: после строки `PLAYER_IFRAMES` добавить `| \`BUSTER_INTERVAL\` / \`BUSTER_DAMAGE\` | 1.0 / 1 | с / HP | [MMBN1] урон, [оценка] интервал |`;
- пункт §20 «~~Задержка Buster 2 с~~ …» дополнить: `Buster вернулся как авто-выстрел (§4).`

`CLAUDE.md`: пункт `The Buster is removed. Only chips deal damage. Do not reintroduce buster code, commands or tuning.` заменить на `The Buster is automatic: one weak shot per BUSTER_INTERVAL down the player's column (GDD §4). There is no Buster button or command.`

- [ ] **Step 9: Проверка и коммит**

Run: `npm test` и `npm run build` — оба зелёные.

```bash
git add src/config/tuning.ts src/sim/buster.ts src/sim/events.ts src/sim/world.ts src/render/fx.ts src/debug/debugPanel.ts src/main.ts tests docs/GDD.md CLAUDE.md
git commit -m "R1: auto Buster

- The player fires a weak instant shot down their column once a second
- No shot during a chip or a flinch; shots never stack
- DBG > Cheats > auto buster

Co-Authored-By: <trailer>"
```

---

### Task 2: Модель панелей `Field`

**Files:**
- Create: `src/sim/field.ts`, `tests/field.test.ts`
- Modify: `src/config/tuning.ts`, `src/sim/events.ts`

**Interfaces:**
- Produces:

```ts
export type Panel = 'NORMAL' | 'CRACKED' | 'BROKEN';
class Field {
  constructor(emit: (e: SimEvent) => void);
  panel(x: number, y: number): Panel;            // 'BROKEN' вне поля
  owner(x: number, y: number): Side | null;       // null вне поля
  canStand(side: Side, x: number, y: number): boolean;
  crack(x: number, y: number): boolean;
  breakPanel(x: number, y: number, tick: number, occupied: boolean): boolean;
  onLeave(x: number, y: number, tick: number): void;
  repair(x: number, y: number): boolean;
  setOwner(x: number, y: number, side: Side, tick: number): boolean;
  update(tick: number, isFree: (x: number, y: number) => boolean): void;
  snapshot(): { panel: Panel; owner: Side }[];    // индекс = y * COLS + x
}
```
- событие `{ type: 'panelChanged'; x: number; y: number; panel: Panel; owner: Side }`.

- [ ] **Step 1: Тесты**

`tests/field.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { SimEvent } from '../src/sim/events';
import { Field } from '../src/sim/field';

const T = (s: number) => secondsToTicks(s);
beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function makeField(): { f: Field; ev: SimEvent[] } {
  const ev: SimEvent[] = [];
  return { f: new Field((e) => ev.push(e)), ev };
}
const free = () => true;

describe('Field', () => {
  it('starts NORMAL with owners by row', () => {
    const { f } = makeField();
    expect(f.panel(0, 0)).toBe('NORMAL');
    expect(f.owner(2, 2)).toBe('enemy');
    expect(f.owner(0, 3)).toBe('player');
    expect(f.owner(3, 0)).toBeNull();
    expect(f.canStand('player', 1, 4)).toBe(true);
    expect(f.canStand('player', 1, 2)).toBe(false);
  });

  it('turns a cracked panel into a hole when its occupant leaves', () => {
    const { f, ev } = makeField();
    expect(f.crack(1, 4)).toBe(true);
    expect(f.panel(1, 4)).toBe('CRACKED');
    expect(f.canStand('player', 1, 4)).toBe(true);
    f.onLeave(1, 4, 10);
    expect(f.panel(1, 4)).toBe('BROKEN');
    expect(f.canStand('player', 1, 4)).toBe(false);
    expect(ev).toEqual([
      { type: 'panelChanged', x: 1, y: 4, panel: 'CRACKED', owner: 'player' },
      { type: 'panelChanged', x: 1, y: 4, panel: 'BROKEN', owner: 'player' },
    ]);
  });

  it('only cracks an occupied panel on a heavy hit', () => {
    const { f } = makeField();
    f.breakPanel(0, 3, 0, true);
    expect(f.panel(0, 3)).toBe('CRACKED');
    f.breakPanel(2, 3, 0, false);
    expect(f.panel(2, 3)).toBe('BROKEN');
  });

  it('restores holes after PANEL_RESTORE_TIME', () => {
    const { f } = makeField();
    f.breakPanel(2, 3, 100, false);
    f.update(100 + T(tuning.field.PANEL_RESTORE_TIME) - 1, free);
    expect(f.panel(2, 3)).toBe('BROKEN');
    f.update(100 + T(tuning.field.PANEL_RESTORE_TIME), free);
    expect(f.panel(2, 3)).toBe('NORMAL');
  });

  it('gives a stolen panel back when its timer ends and the panel is free', () => {
    const { f } = makeField();
    expect(f.setOwner(0, 2, 'player', 0)).toBe(true);
    expect(f.canStand('player', 0, 2)).toBe(true);
    const back = T(tuning.field.STEAL_RESTORE_TIME);
    f.update(back, () => false);
    expect(f.owner(0, 2)).toBe('player');
    f.update(back + 1, free);
    expect(f.owner(0, 2)).toBe('enemy');
  });

  it('repairs any panel', () => {
    const { f } = makeField();
    f.breakPanel(1, 5, 0, false);
    expect(f.repair(1, 5)).toBe(true);
    expect(f.panel(1, 5)).toBe('NORMAL');
    expect(f.repair(1, 5)).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/field.test.ts`
Expected: FAIL (нет модуля).

- [ ] **Step 3: Tuning и событие**

`src/config/tuning.ts`, после группы `buster`:

```ts
  /** Panels (roguelite spec §3). */
  field: {
    PANEL_RESTORE_TIME: 10,
    STEAL_RESTORE_TIME: 15,
    ROCK_HP: 100,
  },
```

`src/sim/events.ts`: `import type { Panel } from './field';`, `import type { Cell, Side } from './grid';` и в объединение:

```ts
  | { type: 'panelChanged'; x: number; y: number; panel: Panel; owner: Side }
```

- [ ] **Step 4: `src/sim/field.ts`**

```ts
import { secondsToTicks, tuning } from '../config/tuning';
import type { SimEvent } from './events';
import { COLS, ROWS, inField, sideOfRow, type Side } from './grid';

// Battle panels (roguelite spec §3): state, owner and restore timers per cell.
// Cracked panels break when their occupant leaves; holes and stolen panels
// come back after a while. Timers use the sim tick.

export type Panel = 'NORMAL' | 'CRACKED' | 'BROKEN';

interface PanelCell {
  panel: Panel;
  owner: Side;
  readonly home: Side;
  restoreAt: number;
  ownerBackAt: number;
}

export class Field {
  private readonly cells: PanelCell[] = [];

  constructor(private readonly emit: (e: SimEvent) => void) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const side = sideOfRow(y);
        this.cells.push({ panel: 'NORMAL', owner: side, home: side, restoreAt: Infinity, ownerBackAt: Infinity });
      }
    }
  }

  private cell(x: number, y: number): PanelCell | null {
    return inField(x, y) ? (this.cells[y * COLS + x] as PanelCell) : null;
  }

  private changed(x: number, y: number, c: PanelCell): void {
    this.emit({ type: 'panelChanged', x, y, panel: c.panel, owner: c.owner });
  }

  private setPanel(x: number, y: number, c: PanelCell, panel: Panel, tick: number): void {
    c.panel = panel;
    c.restoreAt = panel === 'BROKEN' ? tick + secondsToTicks(tuning.field.PANEL_RESTORE_TIME) : Infinity;
    this.changed(x, y, c);
  }

  panel(x: number, y: number): Panel {
    return this.cell(x, y)?.panel ?? 'BROKEN';
  }

  owner(x: number, y: number): Side | null {
    return this.cell(x, y)?.owner ?? null;
  }

  canStand(side: Side, x: number, y: number): boolean {
    const c = this.cell(x, y);
    return c !== null && c.owner === side && c.panel !== 'BROKEN';
  }

  crack(x: number, y: number): boolean {
    const c = this.cell(x, y);
    if (!c || c.panel !== 'NORMAL') return false;
    this.setPanel(x, y, c, 'CRACKED', 0);
    return true;
  }

  /** Heavy hit: a hole, or only a crack while something stands there. */
  breakPanel(x: number, y: number, tick: number, occupied: boolean): boolean {
    if (occupied) return this.crack(x, y);
    const c = this.cell(x, y);
    if (!c || c.panel === 'BROKEN') return false;
    this.setPanel(x, y, c, 'BROKEN', tick);
    return true;
  }

  /** Something left (x, y): a cracked panel gives way. */
  onLeave(x: number, y: number, tick: number): void {
    const c = this.cell(x, y);
    if (c && c.panel === 'CRACKED') this.setPanel(x, y, c, 'BROKEN', tick);
  }

  repair(x: number, y: number): boolean {
    const c = this.cell(x, y);
    if (!c || c.panel === 'NORMAL') return false;
    this.setPanel(x, y, c, 'NORMAL', 0);
    return true;
  }

  setOwner(x: number, y: number, side: Side, tick: number): boolean {
    const c = this.cell(x, y);
    if (!c || c.owner === side) return false;
    c.owner = side;
    c.ownerBackAt = side === c.home ? Infinity : tick + secondsToTicks(tuning.field.STEAL_RESTORE_TIME);
    this.changed(x, y, c);
    return true;
  }

  update(tick: number, isFree: (x: number, y: number) => boolean): void {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = this.cell(x, y) as PanelCell;
        if (c.panel === 'BROKEN' && tick >= c.restoreAt) this.setPanel(x, y, c, 'NORMAL', tick);
        if (c.owner !== c.home && tick >= c.ownerBackAt && isFree(x, y)) {
          c.owner = c.home;
          c.ownerBackAt = Infinity;
          this.changed(x, y, c);
        }
      }
    }
  }

  snapshot(): { panel: Panel; owner: Side }[] {
    return this.cells.map((c) => ({ panel: c.panel, owner: c.owner }));
  }
}
```

- [ ] **Step 5: Тесты зелёные**

Run: `npx vitest run tests/field.test.ts`
Expected: PASS.

- [ ] **Step 6: Коммит**

Run: `npm test` и `npm run build`.

```bash
git add src/config/tuning.ts src/sim/field.ts src/sim/events.ts tests/field.test.ts
git commit -m "R2: panel model (cracked, broken, stolen)"
```

(с трейлером `Co-Authored-By`)

---

### Task 3: Движение и волны через `Field`

**Files:**
- Modify: `src/sim/world.ts`, `src/sim/player.ts`, `src/sim/enemies/enemyBase.ts`, `src/sim/enemies/spiker.ts`, `src/sim/attacks/attack.ts`, `src/sim/attacks/shockwave.ts`
- Test: `tests/field.test.ts`

**Interfaces:**
- Consumes: `Field` из задачи 2.
- Produces: `World.field: Field`; `EnemyContext.field` и `AttackContext.field` (`readonly field: Field`); `Player` конструктор `(occupancy: Occupancy, field: Field, hp?: number)`.

- [ ] **Step 1: Тесты**

Дописать в `tests/field.test.ts` (импорты: `import { World } from '../src/sim/world';`, `import { Shockwave } from '../src/sim/attacks/shockwave';`):

```ts
const DT = 1 / 60;
function battle(): World {
  return new World({ seed: 7, battleIndex: 1, cheats: { god: true, aiEnabled: false, buster: false }, skipIntro: true });
}
const stepMove = (w: World, dir: 'up' | 'down' | 'left' | 'right') =>
  w.step(DT, { commands: [{ type: 'move', dir }], held: null });
const wait = (w: World, n: number) => {
  for (let i = 0; i < n; i++) w.step(DT);
};

describe('panels in battle', () => {
  it('blocks steps onto holes and breaks cracked panels behind the player', () => {
    const w = battle();
    w.field.breakPanel(0, 4, w.tick, false);
    stepMove(w, 'left');
    expect(w.player.x).toBe(1);
    w.field.crack(1, 4);
    stepMove(w, 'right');
    expect(w.player.x).toBe(2);
    expect(w.field.panel(1, 4)).toBe('BROKEN');
  });

  it('lets the player walk on a stolen panel', () => {
    const w = battle();
    w.field.setOwner(1, 2, 'player', w.tick);
    stepMove(w, 'up');
    wait(w, T(tuning.player.MOVE_COOLDOWN));
    stepMove(w, 'up');
    expect(w.player.y).toBe(2);
  });

  it('keeps enemies off holes', () => {
    const w = new World({ seed: 7, battleIndex: 1, cheats: { god: true, aiEnabled: true, buster: false }, skipIntro: true });
    const met = w.enemies[0]!; // (1,1), steps toward the player's column
    w.occupancy.move(met.id, met.x, met.y, 2, 1);
    met.x = 2;
    w.field.breakPanel(1, 1, w.tick, false);
    wait(w, T(tuning.mettik.MET_MOVE_INTERVAL) + 1);
    expect(met.x).toBe(2);
  });

  it('restores holes during the battle', () => {
    const w = battle();
    w.field.breakPanel(0, 5, w.tick, false);
    wait(w, T(tuning.field.PANEL_RESTORE_TIME) + 1);
    expect(w.field.panel(0, 5)).toBe('NORMAL');
  });

  it('stops a wave at a hole', () => {
    const w = battle();
    w.player.iframeTicks = 0;
    w.field.breakPanel(1, 3, w.tick, false);
    const wave = new Shockwave(w.nextAttackId(), 1, 2, w.tick);
    w.spawnAttack(wave);
    wait(w, T(tuning.mettik.MET_WAVE_STEP) * 4);
    expect(wave.done).toBe(true);
    expect(w.player.hitsTaken).toBe(0);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/field.test.ts`
Expected: FAIL (`w.field` отсутствует).

- [ ] **Step 3: Мир**

`src/sim/world.ts`:
- `import { Field } from './field';`
- поле (объявить до `player`): `readonly field: Field = new Field((e) => this.events.push(e));`
- в конструкторе: `this.player = new Player(this.occupancy, this.field, options.playerHp);`
- в `step()` после `this.gauge.tick();`: `this.field.update(this.tick, (x, y) => this.occupancy.isFree(x, y));`
- в `removeDeletedEnemies()` после `this.occupancy.remove(...)`: `this.field.onLeave(e.x, e.y, this.tick);`

- [ ] **Step 4: Игрок**

`src/sim/player.ts`:
- заменить импорт `inTerritory` на `import type { Field } from './field';`
- конструктор: `constructor(private occupancy: Occupancy, private field: Field, hp?: number)`
- `canStep`: `return this.field.canStand('player', nx, ny) && this.occupancy.isFree(nx, ny);`
- в `step()` после `this.y += v.dy;`: `this.field.onLeave(this.prevX, this.prevY, tick);`

Найти другие вызовы: `grep -rn "new Player(" src tests` — обновить все (передать `field`).

- [ ] **Step 5: Враги**

`src/sim/enemies/enemyBase.ts`:
- `import type { Field } from '../field';`, в `EnemyContext`: `readonly field: Field;`
- `warpTo`: условие `if (!ctx.field.canStand('enemy', nx, ny) || !ctx.occupancy.isFree(nx, ny)) return false;`, после `ctx.occupancy.move(...)`: `ctx.field.onLeave(fromX, fromY, ctx.tick);`
- `tryStep`: условие то же; после `ctx.occupancy.move(...)`: `ctx.field.onLeave(this.x, this.y, ctx.tick);` (до присвоения новых координат).

`src/sim/enemies/spiker.ts`, в `freeCells`: `if (ctx.occupancy.isFree(x, y) && ctx.field.canStand('enemy', x, y)) cells.push({ x, y });`

- [ ] **Step 6: Волны**

`src/sim/attacks/attack.ts`: `import type { Field } from '../field';`, в `AttackContext`: `readonly field: Field;`

`src/sim/attacks/shockwave.ts`, в `update` после `if (this.y >= ROWS) {...}`:

```ts
      // Waves need a floor (roguelite spec §3.2).
      if (ctx.field.panel(this.x, this.y) === 'BROKEN') {
        this.done = true;
        return;
      }
```

- [ ] **Step 7: Тесты и коммит**

Run: `npm test` и `npm run build` — зелёные.

```bash
git add src/sim tests/field.test.ts
git commit -m "R2: movement, enemies and waves respect panels"
```

---

### Task 4: Объекты на поле

**Files:**
- Create: `src/sim/fieldObject.ts`
- Modify: `src/sim/world.ts`, `src/sim/events.ts`, `src/sim/attacks/attack.ts`, `src/sim/attacks/shockwave.ts`
- Test: `tests/field.test.ts`

**Interfaces:**
- Produces:

```ts
export type ObjectKind = 'rock';
export class FieldObject { readonly id: number; readonly kind: ObjectKind; readonly x: number; readonly y: number; readonly side: Side; hp: number; get alive(): boolean }
World.objects: FieldObject[];
World.placeObject(kind: ObjectKind, x: number, y: number, side: Side): FieldObject | null;
World.objectAt(x: number, y: number): FieldObject | null;
World.damageObject(o: FieldObject, amount: number): void;
AttackContext.hitObjectAt(attack: Attack, x: number, y: number, damage: number): boolean;
```
- события `{ type: 'objectPlaced'; id: number; kind: ObjectKind; x: number; y: number }`, `{ type: 'objectBroken'; id: number; x: number; y: number }`.
- `World.firstTargetRow` учитывает объекты; `shootLane` и Buster останавливаются на объекте.

- [ ] **Step 1: Тесты**

Дописать в `tests/field.test.ts`:

```ts
describe('field objects', () => {
  it('places a rock only on a free standable cell', () => {
    const w = battle();
    expect(w.placeObject('rock', 1, 4, 'player')).toBeNull(); // the player stands there
    const rock = w.placeObject('rock', 1, 3, 'player')!;
    expect(rock.hp).toBe(tuning.field.ROCK_HP);
    expect(w.occupancy.isFree(1, 3)).toBe(false);
    w.field.breakPanel(0, 3, w.tick, false);
    expect(w.placeObject('rock', 0, 3, 'player')).toBeNull();
  });

  it('stops the Buster and enemy shots, and breaks at 0 HP', () => {
    const w = new World({ seed: 7, battleIndex: 1, cheats: { god: true, aiEnabled: false }, skipIntro: true });
    const rock = w.placeObject('rock', 1, 3, 'player')!;
    const met = w.enemies[0]!;
    wait(w, T(tuning.buster.BUSTER_INTERVAL));
    expect(met.hp).toBe(tuning.mettik.MET_HP);
    expect(rock.hp).toBe(tuning.field.ROCK_HP - tuning.buster.BUSTER_DAMAGE);
    expect(w.shootLane(1, 2, 500)).toBe(3);
    expect(rock.alive).toBe(false);
    expect(w.objects).toHaveLength(0);
    expect(w.occupancy.isFree(1, 3)).toBe(true);
    expect(w.drainEvents().some((e) => e.type === 'objectBroken')).toBe(true);
  });

  it('stops a wave on a rock', () => {
    const w = battle();
    const rock = w.placeObject('rock', 1, 3, 'player')!;
    const wave = new Shockwave(w.nextAttackId(), 1, 2, w.tick);
    w.spawnAttack(wave);
    wait(w, T(tuning.mettik.MET_WAVE_STEP) * 4);
    expect(wave.done).toBe(true);
    expect(rock.hp).toBe(tuning.field.ROCK_HP - tuning.mettik.MET_DMG);
    expect(w.player.hitsTaken).toBe(0);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/field.test.ts`
Expected: FAIL (`placeObject` отсутствует).

- [ ] **Step 3: `src/sim/fieldObject.ts`**

```ts
import type { Side } from './grid';

// Objects on the field (roguelite spec §3.4): take a cell, stop shots and
// waves, break at 0 HP. No AI.

export type ObjectKind = 'rock';

export class FieldObject {
  constructor(
    readonly id: number,
    readonly kind: ObjectKind,
    readonly x: number,
    readonly y: number,
    readonly side: Side,
    public hp: number,
  ) {}

  get alive(): boolean {
    return this.hp > 0;
  }
}
```

- [ ] **Step 4: События и контекст атак**

`src/sim/events.ts`: `import type { ObjectKind } from './fieldObject';` и

```ts
  | { type: 'objectPlaced'; id: EntityId; kind: ObjectKind; x: number; y: number }
  | { type: 'objectBroken'; id: EntityId; x: number; y: number }
```

`src/sim/attacks/attack.ts`, в `AttackContext`:

```ts
  /** Damages an object on (x, y) once per attack; true if there was one. */
  hitObjectAt(attack: Attack, x: number, y: number, damage: number): boolean;
```

`src/sim/attacks/shockwave.ts`, в `update` перед `ctx.hitPlayerAt(...)`:

```ts
    if (ctx.hitObjectAt(this, this.x, this.y, this.damage)) {
      this.done = true;
      return;
    }
```

- [ ] **Step 5: Мир**

`src/sim/world.ts`:

```ts
import { FieldObject, type ObjectKind } from './fieldObject';
import type { Side } from './grid';

  objects: FieldObject[] = [];

  objectAt(x: number, y: number): FieldObject | null {
    const id = this.occupancy.get(x, y);
    if (id === null) return null;
    return this.objects.find((o) => o.id === id) ?? null;
  }

  placeObject(kind: ObjectKind, x: number, y: number, side: Side): FieldObject | null {
    if (!this.occupancy.isFree(x, y) || this.field.panel(x, y) === 'BROKEN') return null;
    const o = new FieldObject(this.nextEnemyId++, kind, x, y, side, tuning.field.ROCK_HP);
    this.occupancy.place(o.id, x, y);
    this.objects.push(o);
    this.events.push({ type: 'objectPlaced', id: o.id, kind, x, y });
    return o;
  }

  damageObject(o: FieldObject, amount: number): void {
    if (!o.alive) return;
    o.hp = Math.max(0, o.hp - amount);
    this.events.push({ type: 'damaged', targetId: o.id, amount, x: o.x, y: o.y, hpLeft: o.hp });
    if (o.alive) return;
    this.occupancy.remove(o.id, o.x, o.y);
    this.objects = this.objects.filter((b) => b !== o);
    this.events.push({ type: 'objectBroken', id: o.id, x: o.x, y: o.y });
    this.field.onLeave(o.x, o.y, this.tick);
  }

  hitObjectAt(attack: Attack, x: number, y: number, damage: number): boolean {
    const o = this.objectAt(x, y);
    if (!o) return false;
    if (!attack.hitIds.has(o.id)) {
      attack.hitIds.add(o.id);
      this.damageObject(o, damage);
    }
    return true;
  }
```

- `firstTargetRow`: условие `if ((e && e.alive) || this.objectAt(x, y)) return y;`
- `fireBuster`: после урона врагу — `else if (y >= 0) { const o = this.objectAt(p.x, y); if (o) this.damageObject(o, tuning.buster.BUSTER_DAMAGE); }`
- `damageCells`: в цикле перед поиском врага:

```ts
      const o = this.objectAt(c.x, c.y);
      if (o) {
        if (!hit.has(o.id)) {
          hit.add(o.id);
          this.damageObject(o, damage);
        }
        continue;
      }
```

- `shootLane`: в цикле первой строкой:

```ts
      if (this.objectAt(x, y)) {
        this.hitObjectAt(ONE_SHOT, x, y, damage);
        ONE_SHOT.hitIds.clear();
        this.events.push({ type: 'enemyShot', x, fromY, toY: y });
        return y;
      }
```

- [ ] **Step 6: Тесты и коммит**

Run: `npm test` и `npm run build` — зелёные.

```bash
git add src/sim tests/field.test.ts
git commit -m "R2: field objects (rocks) that stop shots and waves"
```

---

### Task 5: Визуал и отладка панелей, документация

**Files:**
- Modify: `src/render/cellStates.ts`, `src/render/field.ts`, `src/render/fx.ts`, `src/debug/debugPanel.ts`, `src/main.ts`, `tests/battleVisual.test.ts`, `docs/BATTLE_VISUAL.md`, `docs/GDD.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `World.field.snapshot()`, `World.objects`.
- Produces: `CellInputs.panels: readonly { panel: Panel; owner: Side }[]`, `CellInputs.objects: readonly Cell[]`; `CellView.owner: Side`, `CellView.cracked: boolean`; `DebugActions.simPanel(x, y, action: 'crack' | 'break' | 'repair' | 'steal' | 'rock')`.

- [ ] **Step 1: Тесты `cellStates`**

`tests/battleVisual.test.ts`:
- в фабрике `inputs()` добавить (импорт `import type { Panel } from '../src/sim/field';`, `import { sideOfRow, type Side } from '../src/sim/grid';`):

```ts
    panels: Array.from({ length: 18 }, (_, i) => ({ panel: 'NORMAL' as Panel, owner: sideOfRow(Math.floor(i / 3)) as Side })),
    objects: [],
```

- в ожиданиях `toEqual` для ATTACK/AFTER добавить поля `owner` и `cracked`: `{ state: 'ATTACK', tone: 'accent', age: 5, owner: 'enemy', cracked: false }`, `{ state: 'AFTER', tone: 'red', age: 6, owner: 'enemy', cracked: false }`.
- новый тест:

```ts
  it('reads panels, owners and objects from the simulation', () => {
    const base = inputs();
    const panels = base.panels.map((p) => ({ ...p }));
    panels[k(0, 3)] = { panel: 'BROKEN', owner: 'player' };
    panels[k(2, 3)] = { panel: 'CRACKED', owner: 'player' };
    panels[k(1, 2)] = { panel: 'NORMAL', owner: 'player' };
    const s = cellStates({ ...base, panels, objects: [{ x: 2, y: 5 }] });
    expect(s[k(0, 3)]!.state).toBe('BROKEN');
    expect(s[k(2, 3)]).toMatchObject({ state: 'NORMAL', cracked: true });
    expect(s[k(1, 2)]!.owner).toBe('player');
    expect(s[k(1, 1)]!.owner).toBe('enemy');
    expect(s[k(2, 5)]!.state).toBe('OBJECT');
  });
```

Run: `npx vitest run tests/battleVisual.test.ts` — Expected: FAIL.

- [ ] **Step 2: `cellStates`**

`src/render/cellStates.ts`:
- импорты `import type { Panel } from '../sim/field';`, `import type { Cell, Side } from '../sim/grid';`
- `CellView` добавить `owner: Side;` и `/** Panel is cracked (drawn over any state but BROKEN / EMPTY). */ cracked: boolean;`
- `CellInputs` добавить `panels: readonly { panel: Panel; owner: Side }[];` и `objects: readonly Cell[];`
- удалить константу `NORMAL`; тело функции:

```ts
export function cellStates(i: CellInputs): CellView[] {
  const out: CellView[] = [];
  const danger = new Set(i.danger.map((c) => cellKey(c.x, c.y, i.cols)));
  const objects = new Set(i.objects.map((c) => cellKey(c.x, c.y, i.cols)));
  const playerKey = i.player ? cellKey(i.player.x, i.player.y, i.cols) : -1;
  for (let key = 0; key < i.cols * i.rows; key++) {
    const p = i.panels[key] as { panel: Panel; owner: Side };
    const view = (state: CellVisual, tone: AttackTone | null = null, age = 0): CellView => ({
      state,
      tone,
      age,
      owner: p.owner,
      cracked: p.panel === 'CRACKED',
    });
    const override = i.overrides.get(key);
    const attack = i.attacks.get(key);
    const attackAge = attack ? i.tick - attack.tick : Infinity;
    const spawnAge = i.spawns.get(key) ?? Infinity;
    if (override === 'EMPTY' || override === 'BROKEN') out.push(view(override));
    else if (p.panel === 'BROKEN') out.push(view('BROKEN'));
    else if (attack && attackAge < i.attackTicks) out.push(view('ATTACK', attack.tone, attackAge));
    else if (danger.has(key)) out.push(view('DANGER'));
    else if (spawnAge >= 0 && spawnAge < i.spawnTicks) out.push(view('SPAWN', null, spawnAge));
    else if (override === 'OBJECT' || objects.has(key)) out.push(view('OBJECT'));
    else if (key === playerKey) out.push(view('ACTIVE'));
    else if (attack && attackAge < i.attackTicks + i.afterTicks) out.push(view('AFTER', attack.tone, attackAge - i.attackTicks));
    else out.push(view('NORMAL'));
  }
  return out;
}
```

Run: `npx vitest run tests/battleVisual.test.ts` — Expected: PASS.

- [ ] **Step 3: Рисование поля**

`src/render/field.ts`:
- в `views()` добавить входы `panels: world.field.snapshot(),` и `objects: world.objects.filter((o) => o.alive),`
- заменить строку `const enemySide = sideOfRow(y) === 'enemy';` на `const enemySide = view.owner === 'enemy';` (импорт `sideOfRow` убрать, если больше не нужен)
- после `switch (state) {...}` добавить:

```ts
        if (view.cracked && state !== 'BROKEN' && state !== 'EMPTY') this.crackMark(c, cellHw, cellHd, line);
```

- метод:

```ts
  /** Zigzag across a cracked panel. */
  private crackMark(c: THREE.Vector3, hw: number, hd: number, color: THREE.Color): void {
    const pts: [number, number][] = [
      [-0.8, -0.7],
      [-0.2, -0.1],
      [0.15, -0.35],
      [0.4, 0.3],
      [0.85, 0.75],
    ];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i] as [number, number];
      const [bx, bz] = pts[i + 1] as [number, number];
      this.lines.line(c.x + ax * hw, LINE_Y, c.z + az * hd, c.x + bx * hw, LINE_Y, c.z + bz * hd, color);
    }
  }
```

- заменить `divider(reveal)` на границу по владельцам. Вызов `this.divider(fx.reveal(Math.floor(ROWS / 2)));` → `this.borders(views, fx);`, метод:

```ts
  /** Red dashes where ownership changes between a cell and the one in front of it. */
  private borders(views: readonly CellView[], fx: GridSignal): void {
    const dashes = DASHES / COLS;
    for (let y = 1; y < ROWS; y++) {
      const reveal = Math.min(fx.reveal(y), fx.reveal(y - 1));
      if (reveal <= 0) continue;
      const z = (y - ROWS / 2) * CELL_DEPTH;
      for (let x = 0; x < COLS; x++) {
        const a = views[cellKey(x, y, COLS)] as CellView;
        const b = views[cellKey(x, y - 1, COLS)] as CellView;
        if (a.owner === b.owner) continue;
        const left = (x - COLS / 2) * CELL_WIDTH;
        const step = CELL_WIDTH / dashes;
        for (let i = 0; i < dashes; i++) {
          const x0 = left + i * step + step * 0.2;
          this.lines.line(x0, LINE_Y, z, x0 + step * 0.6 * reveal, LINE_Y, z, col.red);
        }
      }
    }
  }
```

  (Граница между рядами y−1 и y лежит на z = (y − ROWS/2)·CELL_DEPTH — совпадает со старым `divider` при y = 3.)

- `scene.ts`: в `handleEvent` добавить `else if (e.type === 'objectBroken') this.field.markAttack([{ x: e.x, y: e.y }], tick, 'red');`

- [ ] **Step 4: Отладка**

`src/debug/debugPanel.ts`:
- в `DebugActions`: `simPanel(x: number, y: number, action: 'crack' | 'break' | 'repair' | 'steal' | 'rock'): void;`
- в папке Field после `apply to cell`:

```ts
    const sim = { action: 'crack' as 'crack' | 'break' | 'repair' | 'steal' | 'rock' };
    ff.add(sim, 'action', ['crack', 'break', 'repair', 'steal', 'rock']).name('sim action');
    ff.add({ run: () => a.simPanel(cell.x, cell.y, sim.action) }, 'run').name('apply to sim');
```

`src/main.ts`, в объекте действий:

```ts
  simPanel: (x, y, action) => {
    const w = session.world;
    const occupied = !w.occupancy.isFree(x, y);
    if (action === 'crack') w.field.crack(x, y);
    else if (action === 'break') w.field.breakPanel(x, y, w.tick, occupied);
    else if (action === 'repair') w.field.repair(x, y);
    else if (action === 'steal') w.field.setOwner(x, y, w.field.owner(x, y) === 'enemy' ? 'player' : 'enemy', w.tick);
    else w.placeObject('rock', x, y, w.field.owner(x, y) ?? 'player');
  },
```

- [ ] **Step 5: Проверка в браузере**

Dev-сервер уже запущен (`npm run dev`, :5173). Chrome DevTools MCP, эмуляция `390x844x3,mobile,touch`, `http://localhost:5173/?battle=1&god=1&seed=7`. В консоли:

```js
const w = __glorp.world; w.customConfirm?.();
w.field.crack(0, 4); w.field.breakPanel(2, 5, w.tick, false); w.field.setOwner(1, 2, 'player', w.tick); w.placeObject('rock', 0, 3, 'player');
__glorp.loop.clock.paused = true;
```

Скриншот: (0,4) с изломом, (2,5) — дыра, (1,2) голубая, граница-пунктир обходит её, на (0,3) каркасный куб; каждую секунду из игрока идёт короткий трассер Buster. Если что-то не так — исправить до коммита.

- [ ] **Step 6: Документация**

`docs/BATTLE_VISUAL.md`:
- §3 (строка про сетку): `половина игрока — фосфор, территория врага — красная` → `клетки игрока — фосфор, клетки врага — красные (по фактическому владельцу, захват перекрашивает клетку) [решение 2026-09-17]; граница — красный пунктир по смене владельца.`
- в таблицу состояний §4 после BROKEN добавить строку: `| CRACKED | панель треснула (сим.) | излом поверх любого состояния, кроме BROKEN/EMPTY |`
- в §4 абзац: `BROKEN и OBJECT берутся из симуляции (world.field, world.objects); debug-переопределения рисуются поверх.`
- в таблицу атак §6: `| Buster | короткий акцентный трассер по колонке |`

`docs/GDD.md`:
- после §2.1 (поле) добавить подраздел:

```markdown
### 2.2 Панели [решение 2026-09-17]

У каждой клетки есть состояние (`NORMAL`, `CRACKED`, `BROKEN`) и владелец. Треснувшая панель становится дырой, когда с неё уходят; на дыру нельзя встать, волны на ней обрываются; дыра восстанавливается через `PANEL_RESTORE_TIME`. Захваченная клетка возвращается владельцу через `STEAL_RESTORE_TIME`, когда освободится. Объекты (камень) занимают клетку и останавливают выстрелы и волны. Подробно — [спека roguelite §3](superpowers/specs/2026-09-17-roguelite-content-design.md).
```

- §17: строки `| \`PANEL_RESTORE_TIME\` / \`STEAL_RESTORE_TIME\` | 10 / 15 | с | [оценка] |` и `| \`ROCK_HP\` | 100 | HP | [оценка] |`.

`CLAUDE.md`, в Invariants после пункта про Battle palette:

```markdown
- **Panels live in the sim.** `world.field` owns panel state and ownership; movement, warps and waves ask `field.canStand` / `field.panel`, and anything leaving a cell calls `field.onLeave`. Objects (`world.objects`) sit in `Occupancy` and stop shots.
```

- [ ] **Step 7: Проверка и коммит**

Run: `npm test` и `npm run build` — зелёные.

```bash
git add src tests docs CLAUDE.md
git commit -m "R2: panels and objects on screen, DBG sim actions, docs"
```

- [ ] **Step 8: Итог этапа**

Сообщить пользователю по-русски, что сделано в R1–R2; спросить разрешения на пуш. После — написать план R3.
