// Simulation root. Pure TypeScript: no Three.js, no DOM (GDD §15.1).

import { secondsToTicks, tuning } from '../config/tuning';
import type { Command, Dir } from '../core/input/commands';
import { Rng } from '../core/rng';
import { debugEncounter, type Encounter } from '../data/encounters';
import { CHIPS, type ChipDef, type FieldAction } from '../data/chips';
import type { FolderId } from '../data/folders';
import type { FolderChip } from './chips/chipSystem';
import type { Attack, AttackContext } from './attacks/attack';
import { PlayerBomb } from './attacks/bomb';
import { Shockwave } from './attacks/shockwave';
import { Field } from './field';
import { FieldObject, type ObjectKind } from './fieldObject';
import { ChipSystem, type ChipInstance } from './chips/chipSystem';
import { startChip, type ActiveChip } from './chips/executor';
import { lobArea, lobTarget, shapeCells } from './chips/patterns';
import { chipAim, type Aim } from './chips/aim';
import type { Enemy, EnemyContext } from './enemies/enemyBase';
import { createEnemy } from './enemies/factory';
import type { SimEvent } from './events';
import { COLS, ROWS, type Cell, type Side } from './grid';
import { Occupancy } from './occupancy';
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
  | 'RESULT'
  | 'SEQUENCE_COMPLETE';

/** Debug switches that survive battle restarts (GDD §15.5). */
export interface Cheats {
  god: boolean;
  aiEnabled: boolean;
  /** Tutorial: damage lands but the player never drops below 1 HP (spec §4.3). */
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
  /** Skip the intro and start in ACTION with the hand dealt (tests). */
  skipIntro?: boolean;
  /** Tutorial: the exact starting hand by slot instead of a dealt one (spec §4.4). */
  hand?: readonly (FolderChip | null)[];
}

/** States in which the battle simulation (enemies, attacks, timers) is frozen. */
const FROZEN_STATES: ReadonlySet<GameState> = new Set(['BOOT', 'TITLE', 'BATTLE_INTRO', 'PAUSED']);

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
  /** One early Attack press retained until this simulation tick. */
  private bufferedChipUntil: number | null = null;
  chipsUsed = 0;
  /** Events emitted since the last drain. */
  events: SimEvent[] = [];
  /** Id of the Mettik allowed to attack; null = first alive Mettik. */
  private mettikTurnId: number | null = null;
  private nextEnemyId = 100;
  private attackIdCounter = 1;
  private readonly handSpec: readonly (FolderChip | null)[] | null;
  private readonly pendingPushes = new Map<number, Cell>();
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
    this.chips = new ChipSystem(options.folder ?? 'basic', this.rngFolder);
    this.handSpec = options.hand ?? null;
    this.spawnBattle();
    if (options.skipIntro) {
      this.dealStartingHand();
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

  /** One tap on a hand slot: build or unbuild the Attack Queue (GDD §7.2). */
  selectChip(slot: number): boolean {
    if (this.state !== 'ACTION' || this.chips.locked) return false;
    return this.chips.toggleSelect(slot);
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
      this.nextEnemyId++, 'block', x, y, 'player', tuning.field.BLOCK_HP,
      this.tick + secondsToTicks(tuning.field.BLOCK_DURATION),
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
    return this.field.breakPanel(x, y, this.tick, durationTicks);
  }

  private updateObjects(): void {
    for (const object of [...this.objects]) {
      if (this.tick < object.expiresAt) continue;
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

  hitEnemyAt(attack: Attack, x: number, y: number, damage: number): boolean {
    const e = this.enemyAt(x, y);
    if (!e || !e.alive || attack.hitIds.has(e.id)) return false;
    attack.hitIds.add(e.id);
    this.damageEnemy(e, damage, true);
    return true;
  }


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
        this.player.takeHit(amount, this.tick);
        damageApplied = amount;
        died = !this.player.alive;
        this.events.push({ type: 'damaged', targetId: target.id, amount, x: target.x, y: target.y, hpLeft: target.hp });
        this.interruptPlayerChip();
      } else if (enemy?.alive) {
        damageApplied = spec.damage;
        died = enemy.applyDamage(spec.damage, this.tick);
        this.events.push({ type: 'damaged', targetId: enemy.id, amount: spec.damage, x: enemy.x, y: enemy.y, hpLeft: enemy.hp });
        if (!died && countered && enemy.counter(this.tick)) {
          this.events.push({ type: 'enemyCountered', id: enemy.id, x: enemy.x, y: enemy.y });
        }
        if (died) {
          this.events.push({ type: 'enemyKilled', id: enemy.id, x: enemy.x, y: enemy.y });
          if (this.mettikTurnId === enemy.id) this.passTurn(enemy);
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
      hole: (x, y) => this.field.panel(x, y) === 'BROKEN',
      object: (x, y) => this.objectAt(x, y) !== null,
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
      if (def.onHit?.paralyze && enemy.alive) enemy.paralyze(secondsToTicks(tuning.chips.PARALYZE_TIME));
    }
  }

  /** Starts one charged chip if the player is free; every chip needs a press. */
  private tryUseChip(): boolean {
    const p = this.player;
    if (p.flinched || p.actionTicks > 0 || p.paralyzeTicks > 0 || this.activeChip || !this.chips.startAttack(this.tick)) return false;
    const slot = this.chips.attack[0];
    const chip = this.chips.takeNext(this.tick);
    if (!chip) return false;
    this.beginChip(chip, slot ?? -1);
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
    this.bufferedChipUntil = this.tick + secondsToTicks(tuning.input.ACTION_BUFFER_TIME);
  }

  private useBufferedChip(): void {
    const until = this.bufferedChipUntil;
    if (until === null) return;
    if (this.tick > until) {
      this.bufferedChipUntil = null;
      return;
    }
    if (this.tryUseChip()) this.bufferedChipUntil = null;
  }

  private beginChip(chip: ChipInstance, slot: number): void {
    const p = this.player;
    const active = startChip(chip, slot, this.tick, p.x, p.y);
    this.activeChip = active;
    p.actionTicks = active.endTick - active.startTick;
    this.chipsUsed++;
    this.events.push({ type: 'chipUsed', defId: chip.defId, x: p.x, y: p.y });
    this.resolveDueChipHits(active);
  }

  private resolveDueChipHits(active: ActiveChip): void {
    while (active.nextHit < active.hitTicks.length && this.tick >= active.hitTicks[active.nextHit]!) {
      active.nextHit++;
      this.commitChipResolution(active);
      this.resolveChip(active);
    }
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
      if (this.tick < a.endTick) return;
      this.activeChip = null;
      if (this.chips.attack.length === 0) {
        this.chips.finishAttack();
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
      case 'lob': {
        const land = lobTarget(shape.depth, px, py);
        if (!land) break;
        const bomb = new PlayerBomb(this.attackIdCounter++, px, py, land.x, land.y, power, this.tick, def);
        this.bombs.push(bomb);
        effect([land], land.y);
        this.events.push({ type: 'bombThrown', id: bomb.id });
        break;
      }
      case 'wave':
        this.spawnAttack(
          new Shockwave(this.attackIdCounter++, px, py - 1, this.tick, {
            dir: -1,
            damage: power,
            stepTicks: secondsToTicks(tuning.projectile.FAST_CELL_TRAVEL_TIME),
            owner: 'player',
          }),
        );
        effect([]);
        break;
      case 'self':
        if (def.field === 'arm' || def.field === 'break') {
          const target = { x: px, y: py - tuning.chips.FIELD_TARGET_DISTANCE };
          effect(target.y >= 0 ? [target] : []);
        } else effect([]);
        break;
    }
    if (def.field) this.applyFieldAction(def.field, px, py);
    if (def.heal) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + def.heal);
      this.events.push({ type: 'healed', amount: p.hp - before, x: px, y: py });
    }
    if (def.invis) p.invisTicks = secondsToTicks(tuning.chips.INVIS_TIME);
    if (def.guard) {
      p.guard = true;
      this.events.push({ type: 'barrierSet', x: px, y: py });
    }
  }

  /** Field chips (roguelite spec §4.4). */
  private applyFieldAction(action: FieldAction, px: number, py: number): void {
    const f = this.field;
    switch (action) {
      case 'claim':
        f.claimNextRow(this.tick, secondsToTicks(tuning.chips.AREA_GRAB_DURATION));
        return;
      case 'occupy':
        this.placeBlock(px, py - 1);
        return;
      case 'arm':
        if (this.occupancy.isFree(px, py - tuning.chips.FIELD_TARGET_DISTANCE)) {
          f.arm(px, py - tuning.chips.FIELD_TARGET_DISTANCE, {
            kind: 'mine', side: 'player', damage: CHIPS.mine.power ?? 0,
          });
        }
        return;
      case 'break':
        this.breakCell(px, py - tuning.chips.FIELD_TARGET_DISTANCE, secondsToTicks(tuning.chips.BREAK_DURATION));
        return;
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
      this.hitCells(cells, b.damage, b.def, { x: b.fromX, y: b.fromY });
    }
    this.bombs = this.bombs.filter((b) => !b.done);
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
  }

  /** Tutorial: a cassette arrives in this slot mid-battle (spec §4.4). */
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
        if (this.stateElapsed >= secondsToTicks(tuning.fx.INTRO_TIME)) {
          // The hand is dealt into the rail and the battle starts; there is no
          // Custom Screen to stop for (GDD §7.6).
          this.dealStartingHand();
          this.setState('ACTION');
        }
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
    const reshufflesBeforeRefill = this.chips.reshuffles;
    // Until its hit frame, the active chip may still be interrupted and must
    // be able to return to the exact slot it came from.
    const reservedChip = this.activeChip && !this.activeChip.resolved
      ? { slot: this.activeChip.slot, uid: this.activeChip.chip.uid }
      : null;
    this.chips.refillReady(this.tick, reservedChip);
    if (this.chips.reshuffles > reshufflesBeforeRefill) {
      this.events.push({ type: 'drawReshuffled', count: this.chips.reshuffles });
    }
    this.removeDeletedEnemies();
    this.field.update(this.tick, {
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
    const playerBefore = { x: p.x, y: p.y };
    p.updateMovement(this.tick, moves, input.held);
    if (p.x !== playerBefore.x || p.y !== playerBefore.y) this.triggerCellEntry(p);
    this.updatePendingPushes();
    this.updateActiveChip();
    this.useBufferedChip();
    this.updateBombs();

    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.state === 'STAGGER') {
        e.updateStagger(this);
        continue;
      }
      if (e.paralyzeTicks > 0) {
        // Paralysis freezes the enemy's state timer too.
        e.paralyzeTicks--;
        e.freezePhase();
        continue;
      }
      if (this.cheats.aiEnabled) {
        const before = { x: e.x, y: e.y };
        e.update(this);
        if (e.x !== before.x || e.y !== before.y) this.triggerCellEntry(e);
      }
    }

    this.captureImpactObjects();
    for (const a of this.attacks) a.update(this);
    if (this.attacks.some((a) => a.done)) this.attacks = this.attacks.filter((a) => !a.done);

    // A simultaneous kill-trade counts as a loss (GDD §10.3).
    if (!p.alive) {
      this.setState('PLAYER_DEAD');
    } else if (this.enemies.every((e) => !e.alive)) {
      this.attacks = [];
      this.bombs = [];
      this.activeChip = null;
      this.bufferedChipUntil = null;
      this.chips.cancelAttack();
      this.setState('BATTLE_WON');
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
