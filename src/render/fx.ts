import * as THREE from 'three';
import { CHIPS } from '../data/chips';
import { secondsToTicks, tuning } from '../config/tuning';
import type { PlayerBomb } from '../sim/attacks/bomb';
import type { LaneMover } from '../sim/attacks/shockwave';
import { ROWS, type Cell } from '../sim/grid';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import { LineBatch, QuadBatch } from './batch';
import { CELL_DEPTH, CELL_WIDTH, cellToWorld } from './field';
import { dimSignal, signal } from './palette';
import { PLAYER_ID } from '../sim/player';

// Attacks and hit effects as plain geometry (BATTLE_VISUAL.md §6): lines,
// strips and dots in palette signals. Floor effects draw under the creatures,
// air effects over them.

type TimedKind = 'tracer' | 'enemyTracer' | 'slash' | 'enemySlash' | 'heal' | 'blast' | 'warp' | 'spark' | 'kill';

interface Timed {
  kind: TimedKind;
  domain: 'player' | 'world';
  startTick: number;
  life: number;
  x: number;
  y: number;
  /** Lane effects: the far end row. */
  toY: number;
}

const AIR_Y = 0.35;
const FLOOR_Y = 0.004;
const BLAST_RINGS = 3;
const HEAL_DOTS = 9;
const CURSOR_LEN = 0.14;
/** Hit sparks on an enemy: rays, their reach and the height they burst at (world units). */
const SPARK_RAYS = 8;
const SPARK_REACH = 0.42;
const SPARK_Y = 0.5;
const SPARK_TIME = 0.22;
/** A kill: a bigger two-colour burst and a ring on the panel. */
const KILL_TIME = 0.5;
const KILL_RAYS = 16;
const KILL_REACH = 0.9;
/** Charge aura of the loaded chip on the player (decision 2026-09-19). */
const AURA_HEAD_Y = 1.2;
const AURA_CHEST_Y = 0.5;

const col = {
  accent: new THREE.Color(),
  red: new THREE.Color(),
  phosphor: new THREE.Color(),
  purple: new THREE.Color(),
  tmp: new THREE.Color(),
};

const p = new THREE.Vector3();
const q = new THREE.Vector3();
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const D = new THREE.Vector3();

export class FxView {
  readonly group = new THREE.Group();
  private readonly floor = new LineBatch(600);
  private readonly floorFill = new QuadBatch(40);
  private readonly air = new LineBatch(900);
  private readonly airFill = new QuadBatch(60);
  private timed: Timed[] = [];

  constructor() {
    this.floorFill.object.renderOrder = 3;
    this.floor.object.renderOrder = 4;
    this.airFill.object.renderOrder = 30;
    this.air.object.renderOrder = 31;
    this.group.add(this.floorFill.object, this.floor.object, this.airFill.object, this.air.object);
  }

  handleEvent(e: SimEvent, world: World): void {
    const playerTick = world.playerTick;
    const worldTick = world.tick;
    const fx = tuning.fx;
    switch (e.type) {
      case 'chipEffect':
        if (e.shape === 'lane') {
          this.push('tracer', 'player', playerTick, fx.CANNON_TRACER_TIME, e.x, e.fromY, e.toY);
        } else if (e.shape === 'near') {
          for (const c of e.cells) this.push('slash', 'player', playerTick, fx.SLASH_TIME, c.x, c.y);
        } else if (CHIPS[e.defId].heal) {
          this.push('heal', 'player', playerTick, fx.HEAL_FX_TIME, e.x, e.fromY);
        }
        break;
      case 'bombLanded':
        for (const c of e.cells) this.push('blast', 'player', playerTick, fx.EXPLOSION_TIME, c.x, c.y);
        break;
      case 'enemySlash':
        for (const c of e.cells) this.push('enemySlash', 'world', worldTick, fx.SLASH_TIME, c.x, c.y);
        break;
      case 'enemyShot':
        this.push('enemyTracer', 'world', worldTick, fx.CANNON_TRACER_TIME, e.x, e.fromY, e.toY);
        break;
      case 'damaged':
        if (e.targetId !== PLAYER_ID && e.amount > 0) this.push('spark', 'player', playerTick, SPARK_TIME, e.x, e.y, playerTick % 7);
        break;
      case 'enemyKilled':
        this.push('kill', 'player', playerTick, KILL_TIME, e.x, e.y, playerTick % 5);
        break;
      case 'enemyWarped':
        this.push('warp', 'world', worldTick, fx.WARP_FX_TIME, e.fromX, e.fromY);
        this.push('warp', 'world', worldTick, fx.WARP_FX_TIME, e.x, e.y);
        break;
    }
  }

  update(world: World, alpha: number): void {
    signal('accent', 1, col.accent);
    signal('red', 1, col.red);
    signal('phosphor', 1, col.phosphor);
    signal('purple', 1, col.purple);
    const worldTick = world.tick;
    const worldAlpha = world.worldRenderAlpha(alpha);
    const playerTick = world.playerTick;
    this.floor.begin();
    this.floorFill.begin();
    this.air.begin();
    this.airFill.begin();

    for (const a of world.attacks) {
      const playerOwned = a.timeDomain === 'player';
      const tick = playerOwned ? playerTick : worldTick;
      const attackAlpha = playerOwned ? alpha : worldAlpha;
      if (a.kind === 'shockwave' || a.kind === 'playerWave')
        this.wave(a as unknown as LaneMover, tick, attackAlpha, a.kind === 'playerWave' ? col.accent : col.red);
      else if (a.kind === 'zapring') this.ring(a as unknown as LaneMover, tick, attackAlpha);
    }
    for (const b of world.bombs) this.bomb(b, playerTick, alpha);
    if (world.state === 'ACTION') {
      for (const e of world.enemies) {
        const c = e.alive ? e.cursorCell() : null;
        if (c) this.cursor(c, c.locked, worldTick);
      }
    }
    this.trail(world, playerTick, alpha);
    this.aura(world, (playerTick + alpha) / tuning.sim.SIM_HZ);

    this.timed = this.timed.filter((t) => {
      const tick = t.domain === 'player' ? playerTick : worldTick;
      const timedAlpha = t.domain === 'player' ? alpha : worldAlpha;
      const age = tick - t.startTick + timedAlpha;
      if (age >= t.life || age < -1) return false;
      this.drawTimed(t, Math.max(0, age) / t.life, tick);
      return true;
    });

    this.floor.end();
    this.floorFill.end();
    this.air.end();
    this.airFill.end();
  }

  clear(): void {
    this.timed = [];
  }

  private push(kind: TimedKind, domain: 'player' | 'world', tick: number, seconds: number, x: number, y: number, toY = y): void {
    this.timed.push({ kind, domain, startTick: tick, life: Math.max(1, secondsToTicks(seconds)), x, y, toY });
  }

  private drawTimed(t: Timed, k: number, tick: number): void {
    switch (t.kind) {
      case 'tracer':
        this.laneLine(t.x, t.y, t.toY, col.accent, k, -1);
        break;
      case 'enemyTracer':
        this.laneLine(t.x, t.y, t.toY, col.red, k, 1);
        break;
      case 'slash':
        this.slash(t.x, t.y, k, col.accent);
        break;
      case 'enemySlash':
        this.slash(t.x, t.y, k, col.red);
        break;
      case 'heal':
        this.heal(t.x, t.y, k);
        break;
      case 'blast':
        this.rings(this.floor, t.x, t.y, k, col.accent, true);
        break;
      case 'spark':
        this.sparks(t.x, t.y, k, t.toY, SPARK_RAYS, SPARK_REACH, col.accent);
        break;
      case 'kill':
        this.sparks(t.x, t.y, k, t.toY, KILL_RAYS, KILL_REACH, k < 0.5 ? col.accent : col.red);
        this.rings(this.floor, t.x, t.y, k, col.accent, true);
        break;
      case 'warp':
        this.rings(this.floor, t.x, t.y, k, col.red, false);
        // Blink the centre on even ticks.
        if (tick % 4 < 2) this.cross(this.air, t.x, t.y, 0.12, col.red);
        break;
    }
  }

  /** A burst of short rays flying out of a hit enemy; `seed` turns the burst. */
  private sparks(x: number, y: number, k: number, seed: number, rays: number, reach: number, base: THREE.Color): void {
    cellToWorld(x, y, p);
    const inner = reach * (0.2 + 0.8 * k);
    const outer = inner + reach * 0.35 * (1 - k);
    const color = dimSignal(base, 1 - k * 0.6, col.tmp);
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + seed * 0.7;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      // Rays spread in the upright plane facing the camera, with a little depth.
      this.air.line(p.x + cx * inner, SPARK_Y + cy * inner, p.z, p.x + cx * outer, SPARK_Y + cy * outer, p.z + 0.05, color);
    }
  }

  /**
   * The loaded chip shows on the player: sparks ahead for guns, a blade arc for
   * swords, a bomb over the head, ripples at the feet for waves, rising dots
   * for support chips and a turning ring on the panel for field chips.
   */
  private aura(world: World, seconds: number): void {
    const chip = world.chips.attackChips()[0];
    const pl = world.player;
    if (!chip || world.state !== 'ACTION' || !pl.alive) return;
    const def = CHIPS[chip.defId];
    cellToWorld(pl.x, pl.y, p);
    const t = seconds;
    switch (def.shape.t) {
      case 'lane': {
        // Crackling charge in front of the chest.
        const z = p.z - CELL_DEPTH * 0.3;
        for (let i = 0; i < 4; i++) {
          const a = t * 9 + i * 1.7;
          const r = 0.1 + 0.06 * Math.sin(t * 23 + i * 3);
          this.air.line(p.x, AURA_CHEST_Y, z, p.x + Math.cos(a) * r, AURA_CHEST_Y + Math.sin(a) * r, z, col.accent);
        }
        break;
      }
      case 'near': {
        // A blade arc over the head, flickering like a charged edge.
        if (Math.floor(t * 14) % 5 === 0) break;
        const segs = 7;
        for (let i = 0; i < segs; i++) {
          const a0 = Math.PI * (0.15 + (0.7 * i) / segs);
          const a1 = Math.PI * (0.15 + (0.7 * (i + 1)) / segs);
          const r = 0.42;
          this.air.line(p.x + Math.cos(a0) * r, AURA_HEAD_Y - 0.35 + Math.sin(a0) * r, p.z, p.x + Math.cos(a1) * r, AURA_HEAD_Y - 0.35 + Math.sin(a1) * r, p.z, col.accent);
        }
        break;
      }
      case 'lob': {
        // A small bomb bobbing over the head, its fuse sparking.
        const y = AURA_HEAD_Y + 0.04 * Math.sin(t * 5);
        const sides = 8;
        const r = 0.1;
        for (let i = 0; i < sides; i++) {
          const a0 = (i / sides) * Math.PI * 2;
          const a1 = ((i + 1) / sides) * Math.PI * 2;
          this.air.line(p.x + Math.cos(a0) * r, y + Math.sin(a0) * r, p.z, p.x + Math.cos(a1) * r, y + Math.sin(a1) * r, p.z, col.accent);
        }
        if (Math.floor(t * 16) % 2 === 0) this.cross(this.air, pl.x, pl.y, 0.05, col.red, y + r + 0.05);
        break;
      }
      case 'wave': {
        // Ripples running out from the feet.
        for (let i = 0; i < 2; i++) {
          const k = ((t * 1.2 + i * 0.5) % 1);
          const hw = CELL_WIDTH * 0.45 * k;
          const hd = CELL_DEPTH * 0.45 * k;
          const c = dimSignal(col.accent, 1 - k, col.tmp);
          this.floor.line(p.x - hw, FLOOR_Y, p.z - hd, p.x + hw, FLOOR_Y, p.z - hd, c);
          this.floor.line(p.x - hw, FLOOR_Y, p.z + hd, p.x + hw, FLOOR_Y, p.z + hd, c);
        }
        break;
      }
      case 'self': {
        if (def.field) {
          // A dashed ring turning on the panel.
          const segs = 10;
          for (let i = 0; i < segs; i += 2) {
            const a0 = t * 2 + (i / segs) * Math.PI * 2;
            const a1 = t * 2 + ((i + 1) / segs) * Math.PI * 2;
            const rx = CELL_WIDTH * 0.42;
            const rz = CELL_DEPTH * 0.42;
            this.floor.line(p.x + Math.cos(a0) * rx, FLOOR_Y, p.z + Math.sin(a0) * rz, p.x + Math.cos(a1) * rx, FLOOR_Y, p.z + Math.sin(a1) * rz, col.purple);
          }
        } else {
          // Support: dots rising around the figure.
          for (let i = 0; i < 6; i++) {
            const k = (t * 0.8 + i / 6) % 1;
            const a = i * 2.4;
            const x = p.x + Math.cos(a) * 0.3;
            const z = p.z + Math.sin(a) * 0.2;
            const y = 0.1 + k * AURA_HEAD_Y;
            this.air.line(x, y, z, x, y + 0.06, z, dimSignal(col.phosphor, 1 - k, col.tmp));
          }
        }
        break;
      }
    }
  }

  /** Beam along a lane: `dir` -1 goes away from the player, +1 toward the player. */
  private laneLine(x: number, fromY: number, toY: number, color: THREE.Color, k: number, dir: number): void {
    cellToWorld(x, fromY, p);
    const zFrom = p.z + dir * CELL_DEPTH * 0.3;
    const end = dir < 0 ? Math.max(toY, -1) : Math.min(toY, ROWS);
    cellToWorld(x, end, q);
    const zTo = q.z;
    // Thins out: two lines, then one, then flickers.
    const spread = 0.06 * (1 - k);
    if (k > 0.66 && Math.floor(k * 12) % 2 === 1) return;
    this.air.line(p.x - spread, AIR_Y, zFrom, p.x - spread, AIR_Y, zTo, color);
    if (spread > 0.01) this.air.line(p.x + spread, AIR_Y, zFrom, p.x + spread, AIR_Y, zTo, color);
  }

  /** Three arcs sweeping across the cell, upright. */
  private slash(x: number, y: number, k: number, color: THREE.Color): void {
    cellToWorld(x, y, p);
    const segments = 8;
    for (let arc = 0; arc < 3; arc++) {
      const r = 0.28 + arc * 0.08;
      const start = -1.3 + 2.2 * k - arc * 0.15;
      const span = 1.4 - k;
      for (let i = 0; i < segments; i++) {
        const a0 = start + (span * i) / segments;
        const a1 = start + (span * (i + 1)) / segments;
        this.air.line(
          p.x + Math.cos(a0) * r,
          0.35 + Math.sin(a0) * r,
          p.z + 0.05,
          p.x + Math.cos(a1) * r,
          0.35 + Math.sin(a1) * r,
          p.z + 0.05,
          color,
        );
      }
    }
  }

  /** Phosphor dots rising around the player. */
  private heal(x: number, y: number, k: number): void {
    cellToWorld(x, y, p);
    for (let i = 0; i < HEAL_DOTS; i++) {
      const a = (i / HEAL_DOTS) * Math.PI * 2;
      const r = 0.3 + 0.05 * Math.sin(i * 2.3);
      const h = 0.1 + ((k + i * 0.13) % 1) * 0.9;
      const dx = Math.cos(a) * r;
      const dz = Math.sin(a) * r * 0.6;
      this.air.line(p.x + dx, h, p.z + dz, p.x + dx, h + 0.05, p.z + dz, col.phosphor);
    }
  }

  /** Expanding (or, for warps, shrinking) square outlines on the floor. */
  private rings(batch: LineBatch, x: number, y: number, k: number, color: THREE.Color, grow: boolean): void {
    cellToWorld(x, y, p);
    for (let r = 0; r < BLAST_RINGS; r++) {
      const t = (k + r / BLAST_RINGS) % 1;
      const s = grow ? 0.15 + 0.4 * t : 0.55 - 0.4 * t;
      this.square(batch, p.x, p.z, s * CELL_WIDTH, s * CELL_DEPTH, FLOOR_Y, color);
    }
  }

  private square(batch: LineBatch, cx: number, cz: number, hw: number, hd: number, y: number, color: THREE.Color): void {
    batch.line(cx - hw, y, cz - hd, cx + hw, y, cz - hd, color);
    batch.line(cx + hw, y, cz - hd, cx + hw, y, cz + hd, color);
    batch.line(cx + hw, y, cz + hd, cx - hw, y, cz + hd, color);
    batch.line(cx - hw, y, cz + hd, cx - hw, y, cz - hd, color);
  }

  private cross(batch: LineBatch, x: number, y: number, s: number, color: THREE.Color, height = AIR_Y): void {
    cellToWorld(x, y, p);
    batch.line(p.x - s, height - s, p.z, p.x + s, height + s, p.z, color);
    batch.line(p.x - s, height + s, p.z, p.x + s, height - s, p.z, color);
  }

  /** Ground wave: a chevron strip sliding through the cell (red from enemies, accent from the player). */
  private wave(m: LaneMover, tick: number, alpha: number, color: THREE.Color): void {
    const progress = Math.min(1, Math.max(0, (tick - m.lastStepTick + alpha) / m.stepTicks));
    cellToWorld(m.x, m.y, p);
    const z = p.z + (progress - 0.5) * CELL_DEPTH * m.dir;
    const hw = CELL_WIDTH * 0.4;
    const tip = CELL_DEPTH * 0.3;
    const h = 0.18 + 0.06 * Math.sin((tick + alpha) * 0.9);
    // Filled wedge on the floor.
    A.set(p.x - hw, FLOOR_Y, z - tip * 0.3 * m.dir);
    B.set(p.x + hw, FLOOR_Y, z - tip * 0.3 * m.dir);
    C.set(p.x, FLOOR_Y, z + tip * m.dir);
    D.set(p.x, FLOOR_Y, z + tip * m.dir);
    this.floorFill.quad(A, B, C, D, color);
    // Upright crest.
    for (let i = 0; i <= 4; i++) {
      const x = p.x - hw + (hw * 2 * i) / 4;
      this.air.line(x, 0, z, x, h * (1 - Math.abs(i - 2) * 0.2), z, color);
    }
    this.air.line(p.x - hw, h * 0.6, z, p.x, h, z, color);
    this.air.line(p.x, h, z, p.x + hw, h * 0.6, z, color);
  }

  /** Hopzap ring: a red diamond outline rolling down the lane. */
  private ring(m: LaneMover, tick: number, alpha: number): void {
    const progress = Math.min(1, Math.max(0, (tick - m.lastStepTick + alpha) / m.stepTicks));
    cellToWorld(m.x, m.y, p);
    const z = p.z + (progress - 0.5) * CELL_DEPTH;
    const s = 0.2 + 0.04 * Math.sin((tick + alpha) * 0.8);
    this.air.line(p.x, AIR_Y + s, z, p.x + s, AIR_Y, z, col.red);
    this.air.line(p.x + s, AIR_Y, z, p.x, AIR_Y - s, z, col.red);
    this.air.line(p.x, AIR_Y - s, z, p.x - s, AIR_Y, z, col.red);
    this.air.line(p.x - s, AIR_Y, z, p.x, AIR_Y + s, z, col.red);
  }

  /** Player bomb: an accent dot on a parabola with a floor shadow mark. */
  private bomb(b: PlayerBomb, tick: number, alpha: number): void {
    const k = b.progress(tick, alpha);
    cellToWorld(b.fromX, b.fromY, p);
    cellToWorld(b.x, b.y, q);
    const x = p.x + (q.x - p.x) * k;
    const z = p.z + (q.z - p.z) * k;
    const y = 0.3 + 1.6 * k * (1 - k);
    const s = 0.06;
    A.set(x - s, y - s, z);
    B.set(x + s, y - s, z);
    C.set(x + s, y + s, z);
    D.set(x - s, y + s, z);
    this.airFill.quad(A, B, C, D, col.accent);
    this.square(this.floor, x, z, s, s, FLOOR_Y, col.accent);
  }

  /** Canodron reticle: red corner brackets; locked ones shrink and blink. */
  private cursor(c: Cell, locked: boolean, tick: number): void {
    if (locked && tick % 6 < 2) return;
    cellToWorld(c.x, c.y, p);
    const s = locked ? 0.32 : 0.42;
    const hw = s * CELL_WIDTH;
    const hd = s * CELL_DEPTH;
    const len = CURSOR_LEN;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = p.x + sx * hw;
        const z = p.z + sz * hd;
        this.floor.line(x, FLOOR_Y, z, x - sx * len, FLOOR_Y, z, col.red);
        this.floor.line(x, FLOOR_Y, z, x, FLOOR_Y, z - sz * len * CELL_DEPTH, col.red);
      }
    }
  }

  /** Short phosphor streaks behind the player while it slides to a new cell. */
  private trail(world: World, tick: number, alpha: number): void {
    const pl = world.player;
    if (pl.prevX === pl.x && pl.prevY === pl.y) return;
    const elapsed = (tick - pl.lastMoveTick + alpha) / tuning.sim.SIM_HZ;
    const t = elapsed / Math.max(1e-6, tuning.player.CELL_MOVE_TIME);
    if (t >= 1 || t < 0) return;
    cellToWorld(pl.prevX, pl.prevY, p);
    cellToWorld(pl.x, pl.y, q);
    const k = 1 - (1 - t) * (1 - t);
    const hx = p.x + (q.x - p.x) * k;
    const hz = p.z + (q.z - p.z) * k;
    const tx = p.x + (q.x - p.x) * Math.max(0, k - 0.5);
    const tz = p.z + (q.z - p.z) * Math.max(0, k - 0.5);
    for (const h of [0.2, 0.45]) this.air.line(tx, h, tz, hx, h, hz, col.phosphor);
  }
}
