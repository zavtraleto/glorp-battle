// Simulation root. Pure TypeScript: no Three.js, no DOM (GDD §15.1).

import { secondsToTicks, tuning } from '../config/tuning';
import type { Command, Dir } from '../core/input/commands';
import { Rng } from '../core/rng';
import { debugEncounter, type Encounter, type EncounterWave } from '../data/encounters';
import { CHIPS, type ChipDef, type FieldAction } from '../data/chips';
import type { FolderId } from '../data/folders';
import type { FolderChip } from './chips/chipSystem';
import type { Attack, AttackContext } from './attacks/attack';
import { Field } from './field';
import { FieldObject, type ObjectKind } from './fieldObject';
import { ChipSystem, type ChipInstance } from './chips/chipSystem';
import { ComboState } from './chips/comboState';
import { startChip, type ActiveChip } from './chips/executor';
import { shapeCells } from './chips/patterns';
import { chipAim, fieldTargetDistance, type Aim } from './chips/aim';
import type { Enemy, EnemyContext } from './enemies/enemyBase';
import { createEnemy } from './enemies/factory';
import type { SimEvent } from './events';
import { COLS, ROWS, type Cell, type Side } from './grid';
import { Occupancy, type EntityId } from './occupancy';
import { AttackLock, TurnRelay } from './turns';
import { Player } from './player';
import { resolveMove } from './movement';

export type GameState =
  | 'BOOT'
  | 'TITLE'
  | 'BATTLE_INTRO'
  | 'ACTION'
  | 'PAUSED'
  | 'PLAYER_DEAD'
  | 'DEFEAT'
  | 'BATTLE_WON'
  /** A wave is deleted and more follow: deletions play out (GDD §10.4). */
  | 'WAVE_CLEAR'
  /** Flight to the next field, then the new enemies spawn; frozen like the intro. */
  | 'WAVE_INTRO'
  | 'RESULT'
  | 'SEQUENCE_COMPLETE';

/** Debug switches that survive battle restarts (GDD §15.5). */
export interface Cheats {
  god: boolean;
  aiEnabled: boolean;
  /** Tutorial: damage lands but the player never drops below 1 HP (GDD §10.5). */
  noKo?: boolean;
}

export interface WorldOptions {
  seed: number;
  /** Debug/tests: the old fixed battle 1–4, used when `encounter` is not given. */
  battleIndex: number;
  encounter?: Encounter;
  playerHp?: number;
  cheats?: Cheats;
  folder?: FolderId | readonly FolderChip[];
  /** Debug: 0-based wave to start from (`?wave=`); clamped to the encounter. */
  startWave?: number;
  /** Skip the intro and start in ACTION with the hand dealt (tests). */
  skipIntro?: boolean;
  /** Tutorial: the exact starting hand by slot instead of a dealt one (GDD §10.5). */
  hand?: readonly (FolderChip | null)[];
}

/**
 * Tutorial callout (GDD §10.5): ACTION stands still until the player does the
 * one thing it asks for. Every other command is dropped.
 */
export interface Hold {
  /** A step that can actually be made releases the hold. */
  move?: boolean;
  /** An Attack press releases the hold. */
  attack?: boolean;
  /** Taps on these rail slots go through; the hold stays (the director lifts it). */
  slots?: readonly number[];
}

/** States in which the battle simulation (enemies, attacks, timers) is frozen. */
const FROZEN_STATES: ReadonlySet<GameState> = new Set(['BOOT', 'TITLE', 'BATTLE_INTRO', 'WAVE_INTRO', 'PAUSED']);

/** Input snapshot handed to the simulation each tick. */
export interface TickInput {
  commands: readonly Command[];
  held: Dir | null;
}

export interface HitSpec {
  target: Player | Enemy;
  damage: number;
  canCounter?: boolean;
  push?: boolean;
  pushRequiresDamage?: boolean;
  source?: Cell;
}

export interface HitOutcome {
  order: readonly ['counter', 'guard', 'damage', 'death', 'secondary', 'world'];
  countered: boolean;
  guarded: boolean;
  damageApplied: number;
  died: boolean;
  pushed: boolean;
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
  /** Current enemy/world cadence relative to the unscaled ACTION cadence. */
  worldTimeScale = 1;
  private worldTickAccumulator = 0;
  private worldScaleTransition: {
    from: number;
    to: number;
    startTick: number;
    durationTicks: number;
  } | null = null;
  state: GameState = 'BATTLE_INTRO';
  /** uiTick when the current state was entered. */
  stateTick = 0;
  readonly chips: ChipSystem;

  /** True while the current BATTLE_START phase should show the banner. */
  /** State to return to when the pause ends. */
  private pausedFrom: GameState | null = null;
  readonly seed: number;
  readonly battleIndex: number;
  readonly encounter: Encounter;
  /** 0-based index of the current wave (GDD §10.4). */
  waveIndex = 0;
  /** WAVE_INTRO progress: the field swap and the spawn happen once each. */
  private wavePhase: 'flight' | 'swapped' | 'spawned' = 'spawned';
  readonly rngFolder: Rng;
  readonly rngAi: Rng;
  readonly occupancy = new Occupancy();
  readonly field: Field = new Field((e) => this.events.push(e));
  readonly player: Player;
  readonly cheats: Cheats;
  enemies: Enemy[] = [];
  objects: FieldObject[] = [];
  attacks: Attack[] = [];
  /** Tutorial callout in progress; ACTION does not advance while it is set. */
  hold: Hold | null = null;
  /** Chip currently being used by the player (GDD §6.5). */
  activeChip: ActiveChip | null = null;
  /** Active multi-chip window, driven exclusively by the unscaled player clock. */
  combo: ComboState | null = null;
  /** Unscaled ticks of selection slow-mo left for this hand (GDD §6.7). */
  selectBudget = secondsToTicks(tuning.combo.SELECT_SLOW_MO_TIME);
  /** The world is in (or entering) the selection slow-mo. */
  private selectSlowMo = false;
  /** One early Attack press retained until this simulation tick. */
  private bufferedChipUntil: number | null = null;
  chipsUsed = 0;
  /** Events emitted since the last drain. */
  events: SimEvent[] = [];
  private nextEnemyId = 100;
  private attackIdCounter = 1;
  private readonly handSpec: readonly (FolderChip | null)[] | null;
  private readonly pendingPushes = new Map<number, Cell>();
  /** Per kind, rebuilt every wave (GDD §8.1). */
  private relays = new Map<Enemy['kind'], TurnRelay>();
  private locks = new Map<Enemy['kind'], AttackLock>();
  private readonly impactObjects = new Map<string, FieldObject>();

  constructor(options: WorldOptions) {
    this.seed = options.seed;
    this.battleIndex = options.battleIndex;
    this.encounter = options.encounter ?? debugEncounter(options.battleIndex);
    this.cheats = options.cheats ?? { god: false, aiEnabled: true };
    const root = new Rng(options.seed);
    this.rngFolder = root.fork('folder');
    this.rngAi = root.fork('ai');
    this.player = new Player(this.occupancy, this.field, options.playerHp);
    this.chips = new ChipSystem(options.folder ?? 'starter', this.rngFolder);
    this.handSpec = options.hand ?? null;
    this.waveIndex = Math.max(0, Math.min(this.waveCount - 1, Math.floor(options.startWave ?? 0)));
    this.spawnWave();
    if (options.skipIntro) {
      this.dealStartingHand();
      this.state = 'ACTION';
    }
  }

  get simFrozen(): boolean {
    return FROZEN_STATES.has(this.state) || (this.state === 'ACTION' && this.hold !== null);
  }

  /** Unscaled ACTION tick used by player movement, chips and player-owned effects. */
  get playerTick(): number {
    return Math.round(this.time * tuning.sim.SIM_HZ);
  }

  /** Fractional progress toward the next scaled world tick for rendering. */
  worldRenderAlpha(actionAlpha: number): number {
    return this.worldTickAccumulator + Math.max(0, Math.min(1, actionAlpha)) * this.worldTimeScale;
  }

  /** The side display banks are a binary Combo State indicator. */
  get comboDisplayActive(): boolean {
    return this.combo !== null;
  }

  /**
   * Selection slow-mo left as a share of the budget (GDD §6.7), or null when the
   * timer has nothing to show: outside selection, or full with an empty queue.
   */
  get selectTimeLeft(): number | null {
    if (tuning.combo.SELECT_TIME_SCALE >= 1 || this.chips.phase !== 'selecting') return null;
    const full = secondsToTicks(tuning.combo.SELECT_SLOW_MO_TIME);
    if (this.chips.attack.length === 0 && this.selectBudget >= full) return null;
    return full > 0 ? Math.max(0, Math.min(1, this.selectBudget / full)) : 0;
  }

  /** Deterministic transition of the enemy/world cadence on the unscaled timeline. */
  setWorldTimeScale(target: number, durationSeconds: number): void {
    const to = Math.max(0, Math.min(1, target));
    const durationTicks = secondsToTicks(durationSeconds);
    if (durationTicks <= 0) {
      this.worldTimeScale = to;
      this.worldScaleTransition = null;
      return;
    }
    this.worldScaleTransition = {
      from: this.worldTimeScale,
      to,
      startTick: this.playerTick,
      durationTicks,
    };
  }

  private updateWorldTimeScale(): void {
    const transition = this.worldScaleTransition;
    if (!transition) return;
    const elapsed = this.playerTick - transition.startTick;
    const k = Math.max(0, Math.min(1, elapsed / transition.durationTicks));
    this.worldTimeScale = transition.from + (transition.to - transition.from) * k;
    if (k >= 1) this.worldScaleTransition = null;
  }

  get waveCount(): number {
    return this.encounter.waves.length;
  }

  get wave(): EncounterWave {
    return this.encounter.waves[this.waveIndex] as EncounterWave;
  }

  /** True while the current wave is the encounter's last one. */
  get finalWave(): boolean {
    return this.waveIndex >= this.waveCount - 1;
  }

  private spawnWave(): void {
    for (const spawn of this.wave.enemies) {
      const enemy = createEnemy(spawn, this.nextEnemyId++, this.tick);
      this.occupancy.place(enemy.id, enemy.x, enemy.y);
      this.enemies.push(enemy);
    }
    // Turn order: the row nearest the player first, then left to right.
    const order = [...this.enemies].sort((a, b) => b.y - a.y || a.x - b.x);
    this.relays = new Map();
    this.locks = new Map();
    for (const e of order) {
      const relay = this.relays.get(e.kind) ?? new TurnRelay();
      relay.holds(e.id, () => true);
      this.relays.set(e.kind, relay);
    }
    for (const p of this.wave.panels ?? []) {
      if (p.panel === 'CRACKED') this.field.crack(p.x, p.y);
      else this.field.breakPanel(p.x, p.y, this.tick, !this.occupancy.isFree(p.x, p.y));
    }
  }

  /**
   * Mid-flight swap to a fresh field (GDD §10.4): panels, mines, objects and
   * leftovers of the old wave go; the player returns to the start cell with HP kept.
   */
  private resetFieldForWave(): void {
    for (const e of this.enemies) this.occupancy.remove(e.id, e.x, e.y);
    for (const o of this.objects) this.occupancy.remove(o.id, o.x, o.y);
    this.enemies = [];
    this.objects = [];
    this.attacks = [];
    this.pendingPushes.clear();
    this.impactObjects.clear();
    this.field.reset();
    this.player.resetForWave();
    this.events.push({ type: 'waveField', wave: this.waveIndex + 1 });
  }

  /** WAVE_INTRO: flight, field swap halfway, then the spawn (GDD §10.4). */
  private updateWaveIntro(): void {
    const flight = secondsToTicks(tuning.flow.WAVE_FLIGHT_TIME);
    const elapsed = this.stateElapsed;
    if (this.wavePhase === 'flight' && elapsed >= Math.floor(flight / 2)) {
      this.resetFieldForWave();
      this.wavePhase = 'swapped';
    }
    if (this.wavePhase === 'swapped' && elapsed >= flight) {
      this.spawnWave();
      this.wavePhase = 'spawned';
      this.events.push({ type: 'waveSpawned', wave: this.waveIndex + 1, count: this.enemies.length });
    }
    if (this.wavePhase === 'spawned' && elapsed >= flight + secondsToTicks(tuning.flow.WAVE_SPAWN_TIME)) {
      this.setState('ACTION');
    }
  }

  /** Stops everything the player and the enemies had going when a wave or the battle ends. */
  private endCombat(): void {
    this.attacks = [];
    // A chip still before its hit frame goes back to its slot (GDD §6.5).
    const active = this.activeChip;
    if (active && !active.resolved) this.chips.restoreInterrupted(active.chip, active.slot);
    this.activeChip = null;
    this.combo = null;
    this.bufferedChipUntil = null;
    this.chips.cancelAttack();
    // A combo delays the hand cooldown to its exit; ended here, it must still
    // start, or the hand stays locked through the next wave.
    if (this.chips.locked) {
      this.chips.startCooldown(this.playerTick);
      this.chips.reserveSpentRefills();
    }
    this.worldTimeScale = 1;
    this.worldScaleTransition = null;
    this.selectSlowMo = false;
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

  /** One tap on a hand slot: build or unbuild the Attack Queue (GDD §7.2). */
  selectChip(slot: number): boolean {
    if (this.state !== 'ACTION' || this.chips.locked) return false;
    if (!this.chips.toggleSelect(slot)) return false;
    this.updateSelectSlowMo();
    return true;
  }

  /** Decision slow-mo while the Attack Queue is being built and budget is left (GDD §6.7). */
  private updateSelectSlowMo(): void {
    const on = this.chips.attack.length > 0 && this.selectBudget > 0;
    if (on === this.selectSlowMo) return;
    this.selectSlowMo = on;
    if (on) this.setWorldTimeScale(tuning.combo.SELECT_TIME_SCALE, tuning.combo.SELECT_SLOW_MO_ENTER);
    else this.setWorldTimeScale(1, tuning.combo.SLOW_MO_EXIT);
  }

  /**
   * One budget per hand (GDD §6.7): it drains while chips are queued, refills
   * gradually while the queue is empty and is full again with every new hand.
   */
  private updateSelectBudget(newHand: boolean): void {
    const full = secondsToTicks(tuning.combo.SELECT_SLOW_MO_TIME);
    if (newHand) this.selectBudget = full;
    else if (this.chips.phase === 'selecting' && this.chips.attack.length > 0) {
      this.selectBudget = Math.max(0, this.selectBudget - 1);
    } else {
      const recharge = secondsToTicks(tuning.combo.SELECT_SLOW_MO_RECHARGE);
      this.selectBudget = recharge > 0 ? Math.min(full, this.selectBudget + full / recharge) : full;
    }
    if (this.selectSlowMo && this.selectBudget <= 0) this.updateSelectSlowMo();
  }

  /**
   * Pauses the battle (GDD §11). Only the running battle can be paused; the
   * intro is already frozen. A buffered step is dropped.
   */
  pause(): boolean {
    if (this.state !== 'ACTION') return false;
    this.player.bufferedDir = null;
    this.bufferedChipUntil = null;
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

  enemyAt(x: number, y: number): Enemy | null {
    const id = this.occupancy.get(x, y);
    if (id === null) return null;
    return this.enemies.find((e) => e.id === id) ?? null;
  }

  /** All cells currently telegraphed by enemies. */
  dangerCells(): Cell[] {
    const cells: Cell[] = [];
    for (const e of this.enemies) cells.push(...e.dangerCells(this.field));
    return cells;
  }

  // ---------- EnemyContext ----------

  private readonly enemyAlive = (id: EntityId): boolean => this.enemies.some((e) => e.id === id && e.alive);

  hasTurn(enemy: Enemy): boolean {
    let relay = this.relays.get(enemy.kind);
    if (!relay) this.relays.set(enemy.kind, (relay = new TurnRelay()));
    return relay.holds(enemy.id, this.enemyAlive);
  }

  passTurn(enemy: Enemy): void {
    this.relays.get(enemy.kind)?.pass(enemy.id, this.enemyAlive);
  }

  claimAttack(enemy: Enemy): boolean {
    let lock = this.locks.get(enemy.kind);
    if (!lock) this.locks.set(enemy.kind, (lock = new AttackLock()));
    return lock.claim(enemy.id, this.enemyAlive);
  }

  releaseAttack(enemy: Enemy): void {
    this.locks.get(enemy.kind)?.release(enemy.id);
  }

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

  paralyzePlayer(ticks: number): void {
    const p = this.player;
    if (p.alive && !this.cheats.god) p.paralyzeTicks = Math.max(p.paralyzeTicks, ticks);
  }

  spawnAttack(attack: Attack): void {
    this.attacks.push(attack);
    const pos = attack as unknown as { x?: number; y?: number };
    this.events.push({ type: 'attackSpawned', id: attack.id, kind: attack.kind, x: pos.x ?? -1, y: pos.y ?? -1 });
  }

  // ---------- AttackContext ----------

  hitPlayerAt(attack: Attack, x: number, y: number, damage: number): boolean {
    const p = this.player;
    if (p.x !== x || p.y !== y || !p.alive) return false;
    if (attack.hitIds.has(p.id)) return false;
    // Hits on an invulnerable player are ignored entirely (GDD §9).
    if (p.invulnerable) return false;
    attack.hitIds.add(p.id);
    this.resolveHit({ target: p, damage });
    return true;
  }

  private interruptPlayerChip(): void {
    // A hit interrupts the chain. An unresolved active chip returns to its slot (GDD §6.5).
    const cancelledChips: { slot: number; deal: number }[] = [];
    if (this.activeChip) {
      if (!this.activeChip.resolved) {
        this.events.push({ type: 'chipInterrupted', defId: this.activeChip.def.id });
        if (this.chips.restoreInterrupted(this.activeChip.chip, this.activeChip.slot)) {
          cancelledChips.push({ slot: this.activeChip.slot, deal: this.activeChip.chip.deal });
        }
      }
      this.activeChip = null;
    }
    this.bufferedChipUntil = null;
    if (this.chips.locked) {
      const cancelledSlots = this.chips.cancelAttack();
      for (const slot of cancelledSlots) {
        const chip = this.chips.hand[slot];
        if (chip) cancelledChips.push({ slot, deal: chip.deal });
      }
    }
    if (cancelledChips.length > 0) this.events.push({ type: 'chipChainCancelled', chips: cancelledChips });
  }

  private startCombo(size: number): void {
    this.combo = new ComboState(this.playerTick);
    this.setWorldTimeScale(tuning.combo.WORLD_TIME_SCALE, tuning.combo.SLOW_MO_ENTER);
    this.events.push({ type: 'comboStarted', size });
  }

  private finishCombo(): void {
    if (!this.combo) return;
    this.combo = null;
    this.bufferedChipUntil = null;
    this.chips.finishAttack();
    this.chips.startCooldown(this.playerTick);
    this.chips.reserveSpentRefills();
    this.setWorldTimeScale(1, tuning.combo.SLOW_MO_EXIT);
    this.events.push({ type: 'comboEnded', reason: 'complete' });
  }

  private breakCombo(): void {
    if (!this.combo) return;
    this.chips.burnAttackTail();
    this.combo = null;
    this.bufferedChipUntil = null;
    this.events.push({ type: 'comboBroken' });
    this.setWorldTimeScale(1, tuning.combo.COMBO_BREAK_EXIT);
    this.interruptPlayerChip();
    this.chips.startCooldown(this.playerTick);
    this.chips.reserveSpentRefills();
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

  placeBlock(x: number, y: number): FieldObject | null {
    if (!this.occupancy.isFree(x, y) || this.field.panel(x, y) === 'BROKEN') return null;
    this.field.takeHazard(x, y);
    const block = new FieldObject(
      this.nextEnemyId++, 'block', x, y, 'player', tuning.block.HP,
      this.playerTick + secondsToTicks(tuning.block.DURATION), 'player',
    );
    this.occupancy.place(block.id, x, y);
    this.objects.push(block);
    this.events.push({ type: 'objectPlaced', id: block.id, kind: block.kind, x, y });
    return block;
  }

  breakCell(x: number, y: number, durationTicks: number): boolean {
    if (this.enemyAt(x, y) || (this.player.x === x && this.player.y === y)) return false;
    const object = this.objectAt(x, y);
    if (object) this.damageObject(object, object.hp);
    this.field.takeHazard(x, y);
    return this.field.breakPanel(x, y, this.playerTick, durationTicks, 'player');
  }

  private updateObjects(): void {
    for (const object of [...this.objects]) {
      const tick = object.timeDomain === 'player' ? this.playerTick : this.tick;
      if (tick < object.expiresAt) continue;
      this.occupancy.remove(object.id, object.x, object.y);
      this.objects = this.objects.filter((candidate) => candidate !== object);
      this.events.push({ type: 'objectBroken', id: object.id, x: object.x, y: object.y });
    }
  }

  private captureImpactObjects(): void {
    this.impactObjects.clear();
    for (const object of this.objects) this.impactObjects.set(`${object.x},${object.y}`, object);
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
    const o = this.objectAt(x, y) ?? this.impactObjects.get(`${x},${y}`) ?? null;
    if (!o) return false;
    if (!attack.hitIds.has(o.id)) {
      attack.hitIds.add(o.id);
      this.damageObject(o, damage);
    }
    return true;
  }

  // ---------- Combat ----------

  damageEnemy(enemy: Enemy, amount: number, canCounter = false): void {
    this.resolveHit({ target: enemy, damage: amount, canCounter });
  }

  resolveHit(spec: HitSpec): HitOutcome {
    const order = ['counter', 'guard', 'damage', 'death', 'secondary', 'world'] as const;
    const target = spec.target;
    const isPlayer = target.id === this.player.id;
    const enemy = isPlayer ? null : target as Enemy;
    const countered = !!enemy && !!spec.canCounter && spec.damage > 0 && enemy.counterWindowOpen();
    let guarded = false;
    let damageApplied = 0;
    let died = false;
    let pushed = false;

    if (isPlayer && this.player.guard && spec.damage > 0) {
      guarded = true;
      this.player.guard = false;
      this.events.push({ type: 'barrierBroken', x: target.x, y: target.y });
    }

    if (!guarded && spec.damage > 0) {
      if (isPlayer) {
        let amount = this.cheats.god ? 0 : spec.damage;
        if (this.cheats.noKo) amount = Math.min(amount, Math.max(0, this.player.hp - 1));
        if (amount > 0) this.player.takeHit(amount, this.playerTick);
        damageApplied = amount;
        died = !this.player.alive;
        this.events.push({ type: 'damaged', targetId: target.id, amount, x: target.x, y: target.y, hpLeft: target.hp });
        if (amount > 0) {
          if (this.combo) this.breakCombo();
          else this.interruptPlayerChip();
        }
      } else if (enemy?.alive) {
        damageApplied = spec.damage;
        died = enemy.applyDamage(spec.damage, this.tick);
        this.events.push({ type: 'damaged', targetId: enemy.id, amount: spec.damage, x: enemy.x, y: enemy.y, hpLeft: enemy.hp });
        if (!died && countered && enemy.counter(this.tick)) {
          this.events.push({ type: 'enemyCountered', id: enemy.id, x: enemy.x, y: enemy.y });
        }
        if (died) {
          this.events.push({ type: 'enemyKilled', id: enemy.id, x: enemy.x, y: enemy.y });
        }
      }
    }

    const mayPush = !!spec.push && !died && (!spec.pushRequiresDamage || damageApplied > 0);
    if (mayPush && enemy && spec.source) pushed = this.pushEnemy(enemy, spec.source) === 'moved';
    return { order, countered, guarded, damageApplied, died, pushed };
  }

  pushEnemy(enemy: Enemy, source: Cell): 'moved' | 'blocked' | 'queued' {
    if (!enemy.alive) return 'blocked';
    const moveTicks = secondsToTicks(enemy.moveDurationSeconds());
    if (this.tick - enemy.lastMoveTick < moveTicks) {
      this.pendingPushes.set(enemy.id, source);
      return 'queued';
    }
    return this.applyEnemyPush(enemy, source);
  }

  private applyEnemyPush(enemy: Enemy, source: Cell): 'moved' | 'blocked' {
    const dx = Math.sign(enemy.x - source.x);
    const dy = Math.sign(enemy.y - source.y);
    const result = resolveMove(this, enemy, 'enemy', { x: enemy.x + dx, y: enemy.y + dy }, 'forced');
    if (!result.moved) {
      enemy.applyCollisionStagger(this.tick, secondsToTicks(tuning.field.STAGGER_TIME));
      if (result.reason === 'actor' && result.blockerId !== undefined) {
        const blocker = this.enemies.find((candidate) => candidate.id === result.blockerId);
        blocker?.applyCollisionStagger(this.tick, secondsToTicks(tuning.field.STAGGER_TIME));
      }
      return 'blocked';
    }
    const hazard = this.field.takeHazard(result.to.x, result.to.y) ?? result.hazard;
    if (hazard) this.damageEnemy(enemy, hazard.damage, false);
    return 'moved';
  }

  /** Consumes a latched cell hazard exactly once when any actor enters it. */
  private triggerCellEntry(target: Player | Enemy): void {
    const hazard = this.field.takeHazard(target.x, target.y);
    if (hazard) this.resolveHit({ target, damage: hazard.damage });
  }

  private updatePendingPushes(): void {
    for (const [id, source] of this.pendingPushes) {
      const enemy = this.enemies.find((candidate) => candidate.id === id);
      if (!enemy?.alive) {
        this.pendingPushes.delete(id);
        continue;
      }
      if (this.tick - enemy.lastMoveTick < secondsToTicks(enemy.moveDurationSeconds())) continue;
      this.pendingPushes.delete(id);
      this.applyEnemyPush(enemy, source);
    }
  }

  /**
   * Aim preview of the first chip in the Attack Queue: where it would land if
   * fired now (decision 2026-09-19). Read-only; null when nothing is loaded.
   */
  aimPreview(): Aim | null {
    const chip = this.chips.attackChips()[0];
    if (!chip || this.state !== 'ACTION' || !this.player.alive) return null;
    const p = this.player;
    return chipAim(CHIPS[chip.defId], {
      px: p.x,
      py: p.y,
      firstTargetRow: this.firstTargetRow,
      owner: (x, y) => this.field.owner(x, y),
      occupied: (x, y) => !this.occupancy.isFree(x, y),
    });
  }

  /** Row of the first target in lane `x` in front of row `py`; -1 if none. */
  firstTargetRow = (x: number, py: number): number => {
    for (let y = py - 1; y >= 0; y--) {
      const e = this.enemyAt(x, y);
      if ((e && e.alive) || this.objectAt(x, y)) return y;
    }
    return -1;
  };

  /** Damage plus the chip's on-hit effects (roguelite spec §4.2). */
  private hitCells(cells: readonly Cell[], damage: number, def: ChipDef, source: Cell): void {
    const hit = new Set<number>();
    for (const cell of cells) {
      const object = this.objectAt(cell.x, cell.y);
      if (object) {
        if (!hit.has(object.id)) {
          hit.add(object.id);
          this.damageObject(object, damage);
        }
        continue;
      }
      const enemy = this.enemyAt(cell.x, cell.y);
      if (!enemy?.alive || hit.has(enemy.id)) continue;
      hit.add(enemy.id);
      this.resolveHit({
        target: enemy,
        damage,
        canCounter: true,
        push: def.onHit?.push,
        pushRequiresDamage: def.onHit?.pushRequiresDamage,
        source,
      });
    }
  }

  /** Starts one charged chip if the player is free; every chip needs a press. */
  private tryUseChip(): boolean {
    const p = this.player;
    if (p.flinched || p.actionTicks > 0 || p.paralyzeTicks > 0 || this.activeChip) return false;
    const first = this.chips.phase === 'selecting';
    const size = this.chips.attack.length;
    const startsCombo = first && size >= 2 && size <= 5;
    const committed = first
      ? (startsCombo ? this.chips.commitAttack() : this.chips.startAttack(this.playerTick))
      : this.chips.commitAttack();
    if (!committed) return false;
    const slot = this.chips.attack[0];
    const chip = this.chips.takeNext(this.playerTick);
    if (!chip) return false;
    this.beginChip(chip, slot ?? -1);
    if (first) this.selectSlowMo = false;
    if (startsCombo) this.startCombo(size);
    // A single chip leaves the decision slow-mo straight to normal speed (GDD §6.7).
    else if (first) this.setWorldTimeScale(1, tuning.combo.SLOW_MO_EXIT);
    return true;
  }

  private requestUseChip(): void {
    if (this.tryUseChip()) {
      this.bufferedChipUntil = null;
      return;
    }
    const p = this.player;
    const actionLocked = this.activeChip !== null || p.actionTicks > 0;
    if (!actionLocked || p.flinched || p.paralyzeTicks > 0 || this.chips.attack.length === 0) return;
    this.bufferedChipUntil = this.playerTick + secondsToTicks(tuning.combo.CHIP_INPUT_BUFFER);
  }

  private useBufferedChip(): void {
    const until = this.bufferedChipUntil;
    if (until === null) return;
    if (this.playerTick > until) {
      this.bufferedChipUntil = null;
      return;
    }
    if (this.tryUseChip()) this.bufferedChipUntil = null;
  }

  private beginChip(chip: ChipInstance, slot: number): void {
    const p = this.player;
    const active = startChip(chip, slot, this.playerTick, p.x, p.y);
    this.activeChip = active;
    p.actionTicks = active.endTick - active.startTick;
    this.chipsUsed++;
    this.events.push({ type: 'chipUsed', defId: chip.defId, x: p.x, y: p.y });
    this.resolveDueChipHits(active);
  }

  private resolveDueChipHits(active: ActiveChip): void {
    if (active.resolved || this.playerTick < active.hitTick) return;
    this.commitChipResolution(active);
    this.resolveChip(active);
  }

  private commitChipResolution(active: ActiveChip): void {
    if (active.resolved) return;
    active.resolved = true;
    const reshuffles = this.chips.reshuffles;
    this.chips.reserveRefill(active.slot);
    if (this.chips.reshuffles > reshuffles) {
      this.events.push({ type: 'drawReshuffled', count: this.chips.reshuffles });
    }
  }

  private updateActiveChip(): void {
    const a = this.activeChip;
    if (a) {
      this.resolveDueChipHits(a);
      if (this.playerTick < a.endTick) return;
      this.activeChip = null;
      if (this.chips.attack.length === 0) {
        if (this.combo) this.finishCombo();
        else this.chips.finishAttack();
      }
    }
  }

  private resolveChip(a: ActiveChip): void {
    const p = this.player;
    const px = a.originX;
    const py = a.originY;
    const def = a.def;
    const power = def.power ?? 0;
    const shape = def.shape;
    const effect = (cells: Cell[], toY = -1) =>
      this.events.push({ type: 'chipEffect', defId: def.id, shape: shape.t, x: px, fromY: py, cells, toY });

    switch (shape.t) {
      case 'lane':
      case 'near': {
        if (def.id === 'spreader') {
          const row = this.firstTargetRow(px, py);
          if (row < 0) {
            effect([], -1);
            break;
          }
          const main = { x: px, y: row };
          const target = this.enemyAt(main.x, main.y);
          const sides = [{ x: px - 1, y: row }, { x: px + 1, y: row }]
            .filter((cell) => cell.x >= 0 && cell.x < COLS);
          effect([main, ...sides], row);
          this.hitCells([main], power, def, { x: px, y: py });
          if (target) this.hitCells(sides, def.splashPower ?? 0, def, { x: px, y: py });
          break;
        }
        const cells = shapeCells(shape, px, py, this.firstTargetRow);
        effect(cells, shape.t === 'lane' ? (cells[0]?.y ?? -1) : -1);
        this.hitCells(cells, power, def, { x: px, y: py });
        break;
      }
      case 'self':
        if (def.field === 'arm' || def.field === 'break') {
          const target = { x: px, y: py - fieldTargetDistance(def.field) };
          effect(target.y >= 0 ? [target] : []);
        } else effect([]);
        break;
    }
    if (def.field) this.applyFieldAction(def.field, px, py);
    if (def.guard) {
      p.guard = true;
      this.events.push({ type: 'barrierSet', x: px, y: py });
    }
  }

  /** Field chips (roguelite spec §4.4). */
  private applyFieldAction(action: FieldAction, px: number, py: number): void {
    const f = this.field;
    switch (action) {
      case 'claim': {
        const free = (x: number, y: number) => this.occupancy.isFree(x, y);
        const claim = f.claimNextRow(this.playerTick, secondsToTicks(tuning.areagrab.DURATION), 'player', free);
        // Enemies keep the panel they stand on and take a small hit (GDD §6).
        for (const c of claim?.held ?? []) {
          const enemy = this.enemyAt(c.x, c.y);
          if (enemy?.alive) this.resolveHit({ target: enemy, damage: tuning.areagrab.OCCUPANT_DMG });
        }
        return;
      }
      case 'occupy':
        this.placeBlock(px, py - 1);
        return;
      case 'arm':
        if (this.occupancy.isFree(px, py - fieldTargetDistance('arm'))) {
          f.arm(px, py - fieldTargetDistance('arm'), {
            kind: 'mine', side: 'player', damage: CHIPS.mine.power ?? 0,
          });
        }
        return;
      case 'break':
        this.breakCell(px, py - fieldTargetDistance('break'), secondsToTicks(tuning.break.DURATION));
        return;
    }
  }

  /**
   * Debug: put a chip into the hand and queue it. Prefers a free slot; with a
   * full hand it takes over a slot that is not already queued.
   */
  giveChip(chip: ChipInstance): void {
    const hand = this.chips.hand;
    let slot = hand.indexOf(null);
    if (slot < 0) slot = hand.findIndex((_, i) => this.chips.queueIndexOf(i) < 0);
    if (slot < 0) return;
    chip.state = 'hand';
    hand[slot] = chip;
    this.chips.toggleSelect(slot);
  }

  private dealStartingHand(): void {
    if (this.handSpec) this.chips.dealHandExact(this.handSpec);
    else this.chips.dealHand();
    this.selectBudget = secondsToTicks(tuning.combo.SELECT_SLOW_MO_TIME);
  }

  /** Tutorial: a new folder and hand for the next lesson (GDD §10.5). */
  setFolder(folder: readonly FolderChip[], hand: readonly (FolderChip | null)[]): void {
    this.chips.replaceFolder(folder);
    this.chips.dealHandExact(hand);
  }

  /**
   * Tutorial hold (GDD §10.5): lets the allowed commands through and says
   * whether the hold is gone, so this tick runs as usual.
   */
  private releaseHold(input: TickInput): boolean {
    const hold = this.hold;
    if (!hold) return true;
    for (const c of input.commands) {
      if (c.type === 'selectChip' && hold.slots?.includes(c.slot)) this.selectChip(c.slot);
      else if (c.type === 'move' && hold.move && this.player.canStep(c.dir)) this.hold = null;
      else if (c.type === 'useChip' && hold.attack) this.hold = null;
      if (!this.hold) return true;
    }
    return false;
  }

  /** Tutorial: a cassette arrives in this slot mid-battle (GDD §10.5). */
  dealChip(slot: number, spec: FolderChip): boolean {
    return this.chips.dealSlot(slot, spec) !== null;
  }

  killAllEnemies(): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      // The debug kill ignores guards.
      this.damageEnemy(e, e.hp);
    }
  }

  // ---------- Tick ----------

  step(dt: number, input: TickInput = NO_INPUT): void {
    this.uiTick++;

    switch (this.state) {
      case 'BATTLE_INTRO':
        if (this.stateElapsed >= secondsToTicks(tuning.flow.INTRO_TIME)) {
          // The hand is dealt into the rail and the battle starts; there is no
          // Custom Screen to stop for (GDD §7.6).
          this.dealStartingHand();
          this.setState('ACTION');
        }
        return;
      case 'WAVE_CLEAR':
        // Deletions play out on both clocks, then the flight starts.
        this.tick++;
        this.time += dt;
        this.removeDeletedEnemies();
        if (this.stateElapsed >= secondsToTicks(tuning.flow.WAVE_CLEAR_TIME)) {
          this.waveIndex++;
          this.wavePhase = 'flight';
          this.setState('WAVE_INTRO');
        }
        return;
      case 'WAVE_INTRO':
        this.updateWaveIntro();
        return;
      case 'BATTLE_WON':
      case 'PLAYER_DEAD':
        // Both clocks keep running after the battle ends so every animation on
        // them (deletions, player-clock hit and kill FX) plays out.
        this.tick++;
        this.time += dt;
        this.removeDeletedEnemies();
        return;
      case 'ACTION':
        if (!this.releaseHold(input)) return;
        break;
      default:
        return;
    }

    this.time += dt;
    this.updateWorldTimeScale();
    this.worldTickAccumulator += this.worldTimeScale;
    let worldSteps = 0;
    while (this.worldTickAccumulator >= 1) {
      this.worldTickAccumulator -= 1;
      this.tick++;
      worldSteps++;
    }
    const reshufflesBeforeRefill = this.chips.reshuffles;
    const phaseBeforeRefill = this.chips.phase;
    // Until its hit frame, the active chip may still be interrupted and must
    // be able to return to the exact slot it came from.
    const reservedChip = this.activeChip && !this.activeChip.resolved
      ? { slot: this.activeChip.slot, uid: this.activeChip.chip.uid }
      : null;
    this.chips.refillReady(this.playerTick, reservedChip);
    if (this.chips.reshuffles > reshufflesBeforeRefill) {
      this.events.push({ type: 'drawReshuffled', count: this.chips.reshuffles });
    }
    if (worldSteps > 0) this.removeDeletedEnemies();
    this.field.update({ playerTick: this.playerTick, worldTick: this.tick }, {
      player: { x: this.player.x, y: this.player.y },
      isFree: (x, y) => this.occupancy.isFree(x, y),
    });
    this.updateObjects();

    const p = this.player;
    p.updateTimers();

    const moves: Dir[] = [];
    for (const c of input.commands) {
      if (c.type === 'move') {
        moves.push(c.dir);
      }
      else if (c.type === 'useChip') this.requestUseChip();
      else if (c.type === 'selectChip') this.selectChip(c.slot);
    }
    this.updateSelectBudget(phaseBeforeRefill !== 'selecting' && this.chips.phase === 'selecting');
    const playerBefore = { x: p.x, y: p.y };
    p.updateMovement(this.playerTick, moves, input.held);
    if (p.x !== playerBefore.x || p.y !== playerBefore.y) this.triggerCellEntry(p);
    if (worldSteps > 0) this.updatePendingPushes();
    this.updateActiveChip();
    this.useBufferedChip();

    if (worldSteps > 0) for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.state === 'STAGGER') {
        e.updateStagger(this);
        continue;
      }
      if (this.cheats.aiEnabled) {
        const before = { x: e.x, y: e.y };
        e.update(this);
        if (e.x !== before.x || e.y !== before.y) this.triggerCellEntry(e);
      }
    }

    this.captureImpactObjects();
    if (worldSteps > 0) for (const a of this.attacks) a.update(this, this.tick);
    if (this.attacks.some((a) => a.done)) this.attacks = this.attacks.filter((a) => !a.done);

    // A simultaneous kill-trade counts as a loss (GDD §10.4).
    if (!p.alive) {
      this.worldTimeScale = 1;
      this.worldScaleTransition = null;
      this.setState('PLAYER_DEAD');
    } else if (this.enemies.every((e) => !e.alive)) {
      this.endCombat();
      if (this.finalWave) {
        this.setState('BATTLE_WON');
      } else {
        this.events.push({ type: 'waveCleared', wave: this.waveIndex + 1 });
        this.setState('WAVE_CLEAR');
      }
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
