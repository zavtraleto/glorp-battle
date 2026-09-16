// Simulation root. Pure TypeScript: no Three.js, no DOM (GDD §15.1).

import { secondsToTicks, tuning } from '../config/tuning';
import type { Command, Dir } from '../core/input/commands';
import { Rng } from '../core/rng';
import { getBattle } from '../data/battles';
import type { FolderId } from '../data/folders';
import type { Attack, AttackContext } from './attacks/attack';
import { Buster, type ChargeLevel } from './buster';
import { ChipSystem } from './chips/chipSystem';
import type { Enemy, EnemyContext } from './enemies/enemyBase';
import { createEnemy } from './enemies/factory';
import type { SimEvent } from './events';
import { Gauge } from './gauge';
import type { Cell } from './grid';
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
  readonly chips: ChipSystem;
  /** OPEN CUSTOM was pressed while busy; opens as soon as the player is free. */
  private pendingOpenCustom = false;
  /** Duration of the current BATTLE_START phase in ui ticks. */
  private resumeTicks = 0;
  /** True while the current BATTLE_START phase should show the banner. */
  firstStart = false;
  readonly seed: number;
  readonly battleIndex: number;
  readonly rngFolder: Rng;
  readonly rngAi: Rng;
  readonly occupancy = new Occupancy();
  readonly player: Player;
  readonly cheats: Cheats;
  enemies: Enemy[] = [];
  attacks: Attack[] = [];
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
      const enemy = createEnemy(spawn, this.nextEnemyId++, this.tick, () => this.attackIdCounter++);
      if (!enemy) {
        console.warn(`[world] enemy kind "${spawn.kind}" is not implemented yet; skipped`);
        continue;
      }
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
    const p = this.player;
    // Held inputs do not survive the pause: the charge is lost and the button must be pressed again.
    p.buster.cancel();
    p.buster.held = false;
    p.bufferedDir = null;
    this.pendingOpenCustom = false;
    this.chips.openTurn();
    this.setState('CUSTOM');
  }

  customSelect(slot: number): boolean {
    return this.state === 'CUSTOM' && this.chips.select(slot);
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

  /** Hitscan along the player's lane: first living enemy in front takes the hit (GDD §4.1). */
  private fireBuster(level: ChargeLevel): void {
    const p = this.player;
    const damage = Buster.damageFor(level);
    let target: Enemy | null = null;
    for (let y = p.y - 1; y >= 0; y--) {
      const e = this.enemyAt(p.x, y);
      if (e && e.alive) {
        target = e;
        break;
      }
    }
    this.events.push({
      type: 'busterFired',
      x: p.x,
      fromY: p.y,
      toY: target ? target.y : -1,
      level,
      damage,
      hitId: target ? target.id : null,
    });
    if (target) this.damageEnemy(target, damage);
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
      else if (c.type === 'busterDown') p.buster.press(this.tick, p.flinched);
      else if (c.type === 'busterUp') p.buster.release(this.tick);
      else if (c.type === 'openCustom' && this.gauge.full) this.pendingOpenCustom = true;
    }
    p.updateMovement(this.tick, moves, input.held);
    p.buster.update(this.tick, p.flinched, p.actionTicks > 0, (level) => this.fireBuster(level));

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

  /** Charge level for rendering; 0 while the ring should stay hidden. */
  chargeDisplay(): { level: ChargeLevel; visible: boolean; progress: number } {
    const b = this.player.buster;
    const held = b.chargeTicks(this.tick) * this.dtApprox;
    const visible = b.chargeStartTick !== null && held >= tuning.fx.CHARGE_RING_DELAY && tuning.buster.CHARGE_ENABLED;
    const progress = Math.min(1, held / Math.max(1e-6, tuning.buster.CHARGE_T1));
    return { level: b.chargeLevel(this.tick), visible, progress };
  }

  private get dtApprox(): number {
    return 1 / tuning.sim.SIM_HZ;
  }
}
