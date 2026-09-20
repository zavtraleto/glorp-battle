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
  chipsUsed = 0;
  /** Events emitted since the last drain. */
  events: SimEvent[] = [];
  /** Id of the Mettik allowed to attack; null = first alive Mettik. */
  private mettikTurnId: number | null = null;
  private nextEnemyId = 100;
  private attackIdCounter = 1;
  private readonly handSpec: readonly (FolderChip | null)[] | null;

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
    if (this.state !== 'ACTION') return false;
    return this.chips.toggleSelect(slot);
  }

  /**
   * Pauses the battle (GDD §11). Only the running battle can be paused; the
   * intro is already frozen. A buffered step is dropped.
   */
  pause(): boolean {
    if (this.state !== 'ACTION') return false;
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
  /** Debug: brings the next Refresh one chip closer. */
  advanceRefresh(): void {
    this.chips.usedSinceRefresh = Math.min(tuning.chips.REFRESH_AT, this.chips.usedSinceRefresh + 1);
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
    let amount = this.cheats.god ? 0 : damage;
    // Tutorial: the hit lands and shows, but never kills (spec §4.3).
    if (this.cheats.noKo) amount = Math.min(amount, Math.max(0, p.hp - 1));
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
      e.guarded = false;
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
    this.removeDeletedEnemies();
    this.field.update(this.tick, (x, y) => this.occupancy.isFree(x, y));

    const p = this.player;
    p.updateTimers();

    const moves: Dir[] = [];
    for (const c of input.commands) {
      if (c.type === 'move') moves.push(c.dir);
      else if (c.type === 'useChip') this.tryUseChip();
      else if (c.type === 'selectChip') this.selectChip(c.slot);
    }
    p.updateMovement(this.tick, moves, input.held);
    this.updateActiveChip();
    this.updateBombs();

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
    } else if (this.chips.refreshDue) {
      // Refresh is an event, not a pause: the battle does not stop for it (GDD §5).
      const reshufflesBefore = this.chips.reshuffles;
      this.chips.refresh();
      this.events.push({ type: 'handRefreshed', refreshes: this.chips.refreshes });
      if (this.chips.reshuffles > reshufflesBefore) {
        this.events.push({ type: 'drawReshuffled', count: this.chips.reshuffles });
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
