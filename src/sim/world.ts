// Simulation root. Pure TypeScript: no Three.js, no DOM (GDD §15.1).

import { secondsToTicks, tuning } from '../config/tuning';
import type { Command, Dir } from '../core/input/commands';
import { Rng } from '../core/rng';
import { debugEncounter, type Encounter } from '../data/encounters';
import type { ChipDef, FieldAction } from '../data/chips';
import type { FolderId } from '../data/folders';
import type { FolderChip } from './chips/chipSystem';
import type { Attack, AttackContext } from './attacks/attack';
import { PlayerBomb } from './attacks/bomb';
import { Shockwave } from './attacks/shockwave';
import { Buster } from './buster';
import { Field } from './field';
import { FieldObject, type ObjectKind } from './fieldObject';
import { ChipSystem, type ChipInstance } from './chips/chipSystem';
import { startChip, type ActiveChip } from './chips/executor';
import { lobArea, lobTarget, shapeCells } from './chips/patterns';
import type { Enemy, EnemyContext } from './enemies/enemyBase';
import { createEnemy } from './enemies/factory';
import type { SimEvent } from './events';
import { Gauge } from './gauge';
import { COLS, ROWS, type Cell, type Side } from './grid';
import { Occupancy } from './occupancy';
import { Player } from './player';

export type GameState =
  | 'BOOT'
  | 'TITLE'
  | 'BATTLE_INTRO'
  | 'CUSTOM'
  | 'BATTLE_START'
  | 'ACTION'
  | 'PAUSED'
  | 'PLAYER_DEAD'
  | 'DEFEAT'
  | 'BATTLE_WON'
  | 'RESULT'
  | 'SEQUENCE_COMPLETE';

/** Debug switches that survive battle restarts (GDD §15.5). */
export interface Cheats {
  god: boolean;
  aiEnabled: boolean;
  /** Auto Buster; on unless false. */
  buster?: boolean;
}

export interface WorldOptions {
  seed: number;
  /** Debug/tests: the old fixed battle 1–4, used when `encounter` is not given. */
  battleIndex: number;
  encounter?: Encounter;
  playerHp?: number;
  cheats?: Cheats;
  folder?: FolderId | readonly FolderChip[];
  /** Skip intro and the first Custom Screen (tests). */
  skipIntro?: boolean;
}

/** States in which the battle simulation (enemies, attacks, gauge, timers) is frozen. */
const FROZEN_STATES: ReadonlySet<GameState> = new Set(['BOOT', 'TITLE', 'BATTLE_INTRO', 'CUSTOM', 'BATTLE_START', 'PAUSED']);

/** Input snapshot handed to the simulation each tick. */
export interface TickInput {
  commands: readonly Command[];
  held: Dir | null;
}

const NO_INPUT: TickInput = { commands: [], held: null };

/** Throwaway attack record for instant shots (each shot is a separate hit). */
const ONE_SHOT: Attack = { id: -1, kind: 'instant', hitIds: new Set<number>(), done: true, update: () => undefined };

export class World implements EnemyContext, AttackContext {
  /** Simulation tick: advances only while the battle runs (ACTION and end-of-battle animations). */
  tick = 0;
  /** Presentation tick: always advances; drives state timers and UI animation. */
  uiTick = 0;
  /** Simulated seconds (ACTION only). */
  time = 0;
  state: GameState = 'BATTLE_INTRO';
  /** uiTick when the current state was entered. */
  stateTick = 0;
  readonly gauge = new Gauge();
  readonly buster = new Buster();
  readonly chips: ChipSystem;
  /** OPEN CUSTOM was pressed while busy; opens as soon as the player is free. */
  private pendingOpenCustom = false;
  /** Duration of the current BATTLE_START phase in ui ticks. */
  private resumeTicks = 0;
  /** True while the current BATTLE_START phase should show the banner. */
  firstStart = false;
  /** State to return to when the pause ends. */
  private pausedFrom: GameState | null = null;
  readonly seed: number;
  readonly battleIndex: number;
  readonly encounter: Encounter;
  readonly rngFolder: Rng;
  readonly rngAi: Rng;
  readonly occupancy = new Occupancy();
  readonly field: Field = new Field((e) => this.events.push(e));
  readonly player: Player;
  readonly cheats: Cheats;
  enemies: Enemy[] = [];
  objects: FieldObject[] = [];
  attacks: Attack[] = [];
  /** Player bombs in flight. */
  bombs: PlayerBomb[] = [];
  /** Chip currently being used by the player (GDD §6.5). */
  activeChip: ActiveChip | null = null;
  chipsUsed = 0;
  /** Events emitted since the last drain. */
  events: SimEvent[] = [];
  /** Id of the Mettik allowed to attack; null = first alive Mettik. */
  private mettikTurnId: number | null = null;
  private nextEnemyId = 100;
  private attackIdCounter = 1;

  constructor(options: WorldOptions) {
    this.seed = options.seed;
    this.battleIndex = options.battleIndex;
    this.encounter = options.encounter ?? debugEncounter(options.battleIndex);
    this.cheats = options.cheats ?? { god: false, aiEnabled: true };
    const root = new Rng(options.seed);
    this.rngFolder = root.fork('folder');
    this.rngAi = root.fork('ai');
    this.player = new Player(this.occupancy, this.field, options.playerHp);
    this.chips = new ChipSystem(options.folder ?? 'mvp', this.rngFolder);
    this.spawnBattle();
    if (options.skipIntro) {
      this.chips.openTurn();
      this.chips.confirm();
      this.state = 'ACTION';
    }
  }

  get simFrozen(): boolean {
    return FROZEN_STATES.has(this.state);
  }

  private spawnBattle(): void {
    for (const spawn of this.encounter.enemies) {
      const enemy = createEnemy(spawn, this.nextEnemyId++, this.tick);
      this.occupancy.place(enemy.id, enemy.x, enemy.y);
      this.enemies.push(enemy);
    }
    for (const p of this.encounter.panels ?? []) {
      if (p.panel === 'CRACKED') this.field.crack(p.x, p.y);
      else this.field.breakPanel(p.x, p.y, this.tick, !this.occupancy.isFree(p.x, p.y));
    }
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  setState(state: GameState): void {
    if (state === this.state) return;
    this.events.push({ type: 'stateChanged', from: this.state, to: state });
    this.state = state;
    this.stateTick = this.uiTick;
  }

  /** Ui ticks spent in the current state. */
  get stateElapsed(): number {
    return this.uiTick - this.stateTick;
  }

  // ---------- Custom Screen (GDD §7) ----------

  /** Whether the Custom Screen can be opened manually right now. */
  get canOpenCustom(): boolean {
    const p = this.player;
    return this.state === 'ACTION' && this.gauge.full && !p.flinched && p.actionTicks === 0;
  }

  private openCustom(): void {
    // A queued step must not fire after the Custom Screen closes.
    this.player.bufferedDir = null;
    this.pendingOpenCustom = false;
    this.chips.openTurn();
    this.setState('CUSTOM');
  }

  customSelect(slot: number): boolean {
    return this.state === 'CUSTOM' && this.chips.select(slot);
  }

  /** Inserts a hand chip at a selection position (physical chip rail, TERMINAL.md §6.4). */
  customSelectAt(slot: number, index: number): boolean {
    return this.state === 'CUSTOM' && this.chips.selectAt(slot, index);
  }

  customUnselect(index: number): boolean {
    return this.state === 'CUSTOM' && this.chips.unselect(index);
  }

  customCancel(): boolean {
    return this.state === 'CUSTOM' && this.chips.cancelLast();
  }

  customConfirm(): void {
    if (this.state !== 'CUSTOM') return;
    this.chips.confirm();
    this.closeCustom();
  }

  customAdd(): void {
    if (this.state !== 'CUSTOM') return;
    this.chips.add();
    this.closeCustom();
  }

  private closeCustom(): void {
    const first = this.chips.turns === 1;
    this.gauge.reset();
    // "BATTLE START!" only after the first Custom Screen of a battle (GDD §11).
    this.resumeTicks = secondsToTicks(first ? tuning.fx.BANNER_BATTLE_START : tuning.fx.RESUME_DELAY);
    this.firstStart = first;
    this.setState('BATTLE_START');
  }

  /**
   * Pauses the battle (GDD §11). Only the running battle can be paused; the
   * Custom Screen and the intro are already frozen. A buffered step is dropped.
   */
  pause(): boolean {
    if (this.state !== 'ACTION' && this.state !== 'BATTLE_START') return false;
    this.player.bufferedDir = null;
    this.pausedFrom = this.state;
    this.setState('PAUSED');
    return true;
  }

  resume(): void {
    if (this.state !== 'PAUSED' || !this.pausedFrom) return;
    // BATTLE_START restarts its (short) timer; ACTION simply continues.
    this.setState(this.pausedFrom);
    this.pausedFrom = null;
  }

  /** Debug: fill the gauge instantly. */
  fillGauge(): void {
    this.gauge.fill();
  }

  enemyAt(x: number, y: number): Enemy | null {
    const id = this.occupancy.get(x, y);
    if (id === null) return null;
    return this.enemies.find((e) => e.id === id) ?? null;
  }

  /** All cells currently telegraphed by enemies. */
  dangerCells(): Cell[] {
    const cells: Cell[] = [];
    for (const e of this.enemies) cells.push(...e.dangerCells());
    return cells;
  }

  // ---------- EnemyContext ----------

  nextAttackId(): number {
    return this.attackIdCounter++;
  }

  emit(event: SimEvent): void {
    this.events.push(event);
  }

  shootLane(x: number, fromY: number, damage: number): number {
    const p = this.player;
    for (let y = Math.max(0, fromY); y < ROWS; y++) {
      if (this.objectAt(x, y)) {
        this.hitObjectAt(ONE_SHOT, x, y, damage);
        ONE_SHOT.hitIds.clear();
        this.events.push({ type: 'enemyShot', x, fromY, toY: y });
        return y;
      }
      if (p.x === x && p.y === y && p.alive) {
        // An invulnerable player lets the shot pass (GDD §9).
        if (p.invulnerable || p.invisTicks > 0) continue;
        this.hitPlayerAt(ONE_SHOT, x, y, damage);
        ONE_SHOT.hitIds.clear();
        this.events.push({ type: 'enemyShot', x, fromY, toY: y });
        return y;
      }
    }
    this.events.push({ type: 'enemyShot', x, fromY, toY: ROWS });
    return ROWS;
  }

  pushPlayer(): boolean {
    return this.player.alive && this.player.pushBack(this.tick);
  }

  paralyzePlayer(ticks: number): void {
    const p = this.player;
    if (p.alive && !this.cheats.god) p.paralyzeTicks = Math.max(p.paralyzeTicks, ticks);
  }

  spawnAttack(attack: Attack): void {
    this.attacks.push(attack);
    const pos = attack as unknown as { x?: number; y?: number };
    this.events.push({ type: 'attackSpawned', id: attack.id, kind: attack.kind, x: pos.x ?? -1, y: pos.y ?? -1 });
  }

  private aliveMettiks(): Enemy[] {
    return this.enemies.filter((e) => e.kind === 'mettik' && e.alive);
  }

  hasTurn(enemy: Enemy): boolean {
    const mets = this.aliveMettiks();
    if (!mets.some((m) => m.id === this.mettikTurnId)) this.mettikTurnId = mets[0]?.id ?? null;
    return this.mettikTurnId === enemy.id;
  }

  passTurn(enemy: Enemy): void {
    const mets = this.aliveMettiks();
    if (mets.length === 0) {
      this.mettikTurnId = null;
      return;
    }
    const i = mets.findIndex((m) => m.id === enemy.id);
    this.mettikTurnId = (mets[(i + 1) % mets.length] as Enemy).id;
  }

  // ---------- AttackContext ----------

  hitPlayerAt(attack: Attack, x: number, y: number, damage: number): boolean {
    const p = this.player;
    if (p.x !== x || p.y !== y || !p.alive) return false;
    if (attack.hitIds.has(p.id)) return false;
    // Hits on an invulnerable player are ignored entirely (GDD §9).
    if (p.invulnerable || p.invisTicks > 0) return false;
    attack.hitIds.add(p.id);
    const amount = this.cheats.god ? 0 : damage;
    p.takeHit(amount, this.tick);
    this.events.push({ type: 'damaged', targetId: p.id, amount, x, y, hpLeft: p.hp });
    // A hit interrupts the chip; if it had not resolved yet, it is lost (GDD §6.5).
    if (this.activeChip) {
      if (!this.activeChip.resolved) this.events.push({ type: 'chipInterrupted', defId: this.activeChip.def.id });
      this.activeChip = null;
    }
    return true;
  }

  // ---------- Objects ----------

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

  // ---------- Combat ----------

  hitEnemyAt(attack: Attack, x: number, y: number, damage: number): boolean {
    const e = this.enemyAt(x, y);
    if (!e || !e.alive || attack.hitIds.has(e.id)) return false;
    attack.hitIds.add(e.id);
    this.damageEnemy(e, damage);
    return true;
  }


  damageEnemy(enemy: Enemy, amount: number): void {
    if (!enemy.alive) return;
    if (enemy.guarded) {
      this.events.push({ type: 'guarded', id: enemy.id, x: enemy.x, y: enemy.y });
      return;
    }
    const died = enemy.applyDamage(amount, this.tick);
    this.events.push({ type: 'damaged', targetId: enemy.id, amount, x: enemy.x, y: enemy.y, hpLeft: enemy.hp });
    if (died) {
      this.events.push({ type: 'enemyKilled', id: enemy.id, x: enemy.x, y: enemy.y });
      if (this.mettikTurnId === enemy.id) this.passTurn(enemy);
    }
  }

  /** Row of the first target in lane `x` in front of row `py`; -1 if none. */
  firstTargetRow = (x: number, py: number): number => {
    for (let y = py - 1; y >= 0; y--) {
      const e = this.enemyAt(x, y);
      if ((e && e.alive) || this.objectAt(x, y)) return y;
    }
    return -1;
  };

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

  /** Starts the next queued chip if the player is free (no buffering, GDD §6.5). */
  private tryUseChip(): void {
    const p = this.player;
    if (p.flinched || p.actionTicks > 0 || p.paralyzeTicks > 0 || this.activeChip) return;
    const chip = this.chips.takeNext();
    if (!chip) return;
    this.beginChip(chip);
  }

  private beginChip(chip: ChipInstance): void {
    const p = this.player;
    const active = startChip(chip, this.tick);
    this.activeChip = active;
    p.actionTicks = active.endTick - active.startTick;
    this.chipsUsed++;
    this.events.push({ type: 'chipUsed', defId: chip.defId, x: p.x, y: p.y });
  }

  private updateActiveChip(): void {
    const a = this.activeChip;
    if (!a) return;
    if (!a.resolved && this.tick >= a.hitTick) {
      a.resolved = true;
      this.resolveChip(a);
    }
    if (this.tick >= a.endTick) this.activeChip = null;
  }

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
    }
    if (def.field) this.applyFieldAction(def.field);
    if (def.heal) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + def.heal);
      this.events.push({ type: 'healed', amount: p.hp - before, x: p.x, y: p.y });
    }
    if (def.invis) p.invisTicks = secondsToTicks(tuning.chips.INVIS_TIME);
  }

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

  private fireBuster(): void {
    const p = this.player;
    const y = this.firstTargetRow(p.x, p.y);
    this.events.push({ type: 'busterShot', x: p.x, fromY: p.y, toY: y });
    const e = y >= 0 ? this.enemyAt(p.x, y) : null;
    if (e) this.damageEnemy(e, tuning.buster.BUSTER_DAMAGE);
    else if (y >= 0) {
      const o = this.objectAt(p.x, y);
      if (o) this.damageObject(o, tuning.buster.BUSTER_DAMAGE);
    }
  }

  private updateBombs(): void {
    if (this.bombs.length === 0) return;
    for (const b of this.bombs) {
      if (b.done || this.tick < b.landTick) continue;
      b.done = true;
      const shape = b.def.shape;
      const cells = shape.t === 'lob' ? lobArea(shape.area, b.x, b.y) : [{ x: b.x, y: b.y }];
      this.events.push({ type: 'bombLanded', id: b.id, x: b.x, y: b.y, cells });
      this.hitCells(cells, b.damage, b.def);
    }
    this.bombs = this.bombs.filter((b) => !b.done);
  }

  /** Debug: append a chip to the queue. */
  giveChip(chip: ChipInstance): void {
    chip.state = 'queued';
    this.chips.queue.push(chip);
  }

  killAllEnemies(): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      // The debug kill ignores guards.
      e.guarded = false;
      this.damageEnemy(e, e.hp);
    }
  }

  // ---------- Tick ----------

  step(dt: number, input: TickInput = NO_INPUT): void {
    this.uiTick++;

    switch (this.state) {
      case 'BATTLE_INTRO':
        if (this.stateElapsed >= secondsToTicks(tuning.fx.INTRO_TIME)) this.openCustom();
        return;
      case 'BATTLE_START':
        if (this.stateElapsed >= this.resumeTicks) this.setState('ACTION');
        return;
      case 'BATTLE_WON':
      case 'PLAYER_DEAD':
        // Deletion animations keep playing after the battle ends.
        this.tick++;
        this.removeDeletedEnemies();
        return;
      case 'ACTION':
        break;
      default:
        return;
    }

    this.tick++;
    this.time += dt;
    this.removeDeletedEnemies();
    this.gauge.tick();
    this.field.update(this.tick, (x, y) => this.occupancy.isFree(x, y));

    const p = this.player;
    p.updateTimers();

    const moves: Dir[] = [];
    for (const c of input.commands) {
      if (c.type === 'move') moves.push(c.dir);
      else if (c.type === 'openCustom' && this.gauge.full) this.pendingOpenCustom = true;
      else if (c.type === 'useChip') this.tryUseChip();
    }
    p.updateMovement(this.tick, moves, input.held);
    this.updateActiveChip();
    this.updateBombs();
    const busy = p.flinched || p.actionTicks > 0 || p.paralyzeTicks > 0 || this.activeChip !== null;
    if (this.buster.tick(busy || this.cheats.buster === false)) this.fireBuster();

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

    for (const a of this.attacks) a.update(this);
    if (this.attacks.some((a) => a.done)) this.attacks = this.attacks.filter((a) => !a.done);

    // A simultaneous kill-trade counts as a loss (GDD §10.3).
    if (!p.alive) {
      this.setState('PLAYER_DEAD');
    } else if (this.enemies.every((e) => !e.alive)) {
      this.attacks = [];
      this.bombs = [];
      this.activeChip = null;
      this.setState('BATTLE_WON');
    } else if (this.pendingOpenCustom && this.canOpenCustom) {
      this.openCustom();
    }
  }

  private removeDeletedEnemies(): void {
    if (!this.enemies.some((e) => e.isRemovable(this.tick))) return;
    this.enemies = this.enemies.filter((e) => {
      if (!e.isRemovable(this.tick)) return true;
      this.occupancy.remove(e.id, e.x, e.y);
      this.field.onLeave(e.x, e.y, this.tick);
      this.events.push({ type: 'enemyRemoved', id: e.id });
      return false;
    });
  }
}
