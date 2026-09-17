// Simulation root. Pure TypeScript: no Three.js, no DOM (GDD §15.1).

import { secondsToTicks, tuning } from '../config/tuning';
import type { Command, Dir } from '../core/input/commands';
import { Rng } from '../core/rng';
import { getBattle } from '../data/battles';
import type { FolderId } from '../data/folders';
import type { Attack, AttackContext } from './attacks/attack';
import { PlayerBomb } from './attacks/bomb';
import { Buster } from './buster';
import { ChipSystem, type ChipInstance } from './chips/chipSystem';
import { startChip, type ActiveChip } from './chips/executor';
import { hitscanCells, lobTarget, meleeCells } from './chips/patterns';
import type { Enemy, EnemyContext } from './enemies/enemyBase';
import { createEnemy } from './enemies/factory';
import type { SimEvent } from './events';
import { Gauge } from './gauge';
import { ROWS, type Cell } from './grid';
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
  battleIndex: number;
  playerHp?: number;
  cheats?: Cheats;
  folder?: FolderId;
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
  readonly rngFolder: Rng;
  readonly rngAi: Rng;
  readonly occupancy = new Occupancy();
  readonly player: Player;
  readonly cheats: Cheats;
  enemies: Enemy[] = [];
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
    this.cheats = options.cheats ?? { god: false, aiEnabled: true };
    const root = new Rng(options.seed);
    this.rngFolder = root.fork('folder');
    this.rngAi = root.fork('ai');
    this.player = new Player(this.occupancy, options.playerHp);
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
    for (const spawn of getBattle(this.battleIndex).enemies) {
      const enemy = createEnemy(spawn, this.nextEnemyId++, this.tick);
      this.occupancy.place(enemy.id, enemy.x, enemy.y);
      this.enemies.push(enemy);
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
      if (p.x === x && p.y === y && p.alive) {
        // An invulnerable player lets the shot pass (GDD §9).
        if (p.invulnerable) continue;
        this.hitPlayerAt(ONE_SHOT, x, y, damage);
        ONE_SHOT.hitIds.clear();
        this.events.push({ type: 'enemyShot', x, fromY, toY: y });
        return y;
      }
    }
    this.events.push({ type: 'enemyShot', x, fromY, toY: ROWS });
    return ROWS;
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
    if (p.invulnerable) return false;
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

  // ---------- Combat ----------

  damageEnemy(enemy: Enemy, amount: number): void {
    if (!enemy.alive) return;
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
      if (e && e.alive) return y;
    }
    return -1;
  };

  private damageCells(cells: readonly { x: number; y: number }[], damage: number): void {
    const hit = new Set<number>();
    for (const c of cells) {
      const e = this.enemyAt(c.x, c.y);
      if (!e || !e.alive || hit.has(e.id)) continue;
      hit.add(e.id);
      this.damageEnemy(e, damage);
    }
  }

  /** Starts the next queued chip if the player is free (no buffering, GDD §6.5). */
  private tryUseChip(): void {
    const p = this.player;
    if (p.flinched || p.actionTicks > 0 || this.activeChip) return;
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
    const effect = (cells: { x: number; y: number }[], toY = -1) =>
      this.events.push({ type: 'chipEffect', defId: def.id, pattern: def.pattern, x: p.x, fromY: p.y, cells, toY });

    switch (def.pattern) {
      case 'lane_hitscan':
      case 'lane_hitscan_pierce1': {
        const cells = hitscanCells(def.pattern, p.x, p.y, this.firstTargetRow);
        effect(cells, cells[0]?.y ?? -1);
        this.damageCells(cells, power);
        return;
      }
      case 'melee_1':
      case 'melee_wide':
      case 'melee_long': {
        const cells = meleeCells(def.pattern, p.x, p.y);
        effect(cells);
        this.damageCells(cells, power);
        return;
      }
      case 'lob_3': {
        const target = lobTarget(p.x, p.y);
        if (!target) return;
        const bomb = new PlayerBomb(this.attackIdCounter++, p.x, p.y, target.x, target.y, power, this.tick);
        this.bombs.push(bomb);
        effect([target], target.y);
        this.events.push({ type: 'bombThrown', id: bomb.id });
        return;
      }
      case 'self_heal': {
        const before = p.hp;
        p.hp = Math.min(p.maxHp, p.hp + tuning.chips.RECOVER_AMOUNT);
        effect([]);
        this.events.push({ type: 'healed', amount: p.hp - before, x: p.x, y: p.y });
        return;
      }
    }
  }

  private fireBuster(): void {
    const p = this.player;
    const y = this.firstTargetRow(p.x, p.y);
    this.events.push({ type: 'busterShot', x: p.x, fromY: p.y, toY: y });
    const e = y >= 0 ? this.enemyAt(p.x, y) : null;
    if (e) this.damageEnemy(e, tuning.buster.BUSTER_DAMAGE);
  }

  private updateBombs(): void {
    if (this.bombs.length === 0) return;
    for (const b of this.bombs) {
      if (b.done || this.tick < b.landTick) continue;
      b.done = true;
      this.events.push({ type: 'bombLanded', id: b.id, x: b.x, y: b.y });
      this.damageCells([{ x: b.x, y: b.y }], b.damage);
    }
    this.bombs = this.bombs.filter((b) => !b.done);
  }

  /** Debug: append a chip to the queue. */
  giveChip(chip: ChipInstance): void {
    chip.state = 'queued';
    this.chips.queue.push(chip);
  }

  killAllEnemies(): void {
    for (const e of this.enemies) if (e.alive) this.damageEnemy(e, e.hp);
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
    const busy = p.flinched || p.actionTicks > 0 || this.activeChip !== null;
    if (this.buster.tick(busy || this.cheats.buster === false)) this.fireBuster();

    if (this.cheats.aiEnabled) {
      for (const e of this.enemies) if (e.alive) e.update(this);
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
      this.events.push({ type: 'enemyRemoved', id: e.id });
      return false;
    });
  }
}
