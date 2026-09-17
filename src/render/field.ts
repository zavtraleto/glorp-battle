import * as THREE from 'three';
import { secondsToTicks, tuning } from '../config/tuning';
import { COLS, ROWS, sideOfRow, type Cell } from '../sim/grid';
import type { World } from '../sim/world';
import { LineBatch, QuadBatch } from './batch';
import { NO_SIGNAL, type GridSignal } from './battleSignals';
import { cellKey, cellStates, type AttackMark, type AttackTone, type CellView, type DebugCellState } from './cellStates';
import { signal } from './palette';
import { makeLabelTexture } from './sprites';

// Battle field (BATTLE_VISUAL.md §3–4): a phosphor grid of cells, each drawn
// from its visual state. All lines are one batch, all fills another.

// World layout: cells are 1 unit wide and CELL_DEPTH deep (a portrait CRT favours a deep field); x grows right, row y maps to +z (toward the camera).
export const CELL_WIDTH = 1;
export const CELL_DEPTH = 1.35;

/** Center of a logical cell in world space (on the panel surface). */
export function cellToWorld(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set((x - (COLS - 1) / 2) * CELL_WIDTH, 0, (y - (ROWS - 1) / 2) * CELL_DEPTH);
}


const LINE_Y = 0.002;
const FILL_Y = 0;
const LINES_CAP = 1200;
const QUADS_CAP = 120;
const SPAWN_RINGS = 3;
const OBJECT_HEIGHT = 0.5;
const DASHES = 12;

const col = {
  phosphor: new THREE.Color(),
  dim: new THREE.Color(),
  red: new THREE.Color(),
  accent: new THREE.Color(),
  tmp: new THREE.Color(),
};

export class FieldView {
  readonly group = new THREE.Group();
  /** Bounds used for camera fitting; includes headroom for character sprites. */
  readonly bounds: THREE.Box3;
  /** Debug cell states (BROKEN / EMPTY / OBJECT), keyed by `cellKey`. */
  readonly overrides = new Map<number, DebugCellState>();
  private readonly lines = new LineBatch(LINES_CAP);
  private readonly fills = new QuadBatch(QUADS_CAP);
  private readonly labels = new THREE.Group();
  private readonly marks = new Map<number, AttackMark>();

  constructor() {
    this.fills.object.renderOrder = 1;
    this.lines.object.renderOrder = 2;
    this.group.add(this.fills.object, this.lines.object);

    const p = new THREE.Vector3();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        cellToWorld(x, y, p);
        const label = new THREE.Mesh(
          new THREE.PlaneGeometry(0.45, 0.45),
          new THREE.MeshBasicMaterial({
            map: makeLabelTexture(`${x},${y}`, { size: 96, font: 'bold 34px monospace' }),
            transparent: true,
            depthTest: false,
          }),
        );
        label.rotation.x = -Math.PI / 2;
        label.position.set(p.x, 0.01, p.z);
        label.renderOrder = 3;
        this.labels.add(label);
      }
    }
    this.labels.visible = false;
    this.group.add(this.labels);

    const halfW = (COLS * CELL_WIDTH) / 2 + 0.05;
    const halfD = (ROWS * CELL_DEPTH) / 2 + 0.05;
    this.bounds = new THREE.Box3(new THREE.Vector3(-halfW, 0, -halfD), new THREE.Vector3(halfW, 0.9, halfD));
  }

  /** Records a hit passing through cells (ATTACK then AFTER). */
  markAttack(cells: readonly Cell[], tick: number, tone: AttackTone): void {
    for (const c of cells) {
      if (c.x < 0 || c.x >= COLS || c.y < 0 || c.y >= ROWS) continue;
      this.marks.set(cellKey(c.x, c.y, COLS), { tick, tone });
    }
  }

  clear(): void {
    this.marks.clear();
  }

  setCoordsVisible(visible: boolean): void {
    this.labels.visible = visible;
  }

  /** Current visual state of every cell (for debug and tests). */
  views(world: World, spawns: ReadonlyMap<number, number>): CellView[] {
    const v = tuning.battleVisual;
    return cellStates({
      cols: COLS,
      rows: ROWS,
      tick: world.tick,
      player: world.player.alive ? { x: world.player.x, y: world.player.y } : null,
      danger: world.state === 'ACTION' ? world.dangerCells() : [],
      attacks: this.marks,
      spawns,
      overrides: this.overrides,
      attackTicks: secondsToTicks(v.ATTACK_CELL_TIME),
      afterTicks: secondsToTicks(v.AFTER_TIME),
      spawnTicks: secondsToTicks(v.SPAWN_TIME),
    });
  }

  update(world: World, alpha: number, spawns: ReadonlyMap<number, number>, fx: GridSignal = NO_SIGNAL): void {
    const v = tuning.battleVisual;
    signal('phosphor', 1, col.phosphor);
    signal('phosphor', v.GRID_DIM, col.dim);
    signal('red', 1, col.red);
    signal('accent', 1, col.accent);
    const views = this.views(world, spawns);
    const time = world.tick + alpha;
    const pulse = 0.5 + 0.5 * Math.sin((time / tuning.sim.SIM_HZ) * Math.PI * 2 * v.DANGER_PULSE_HZ);
    const spawnTicks = Math.max(1, secondsToTicks(v.SPAWN_TIME));
    const attackTicks = Math.max(1, secondsToTicks(v.ATTACK_CELL_TIME));

    this.lines.begin();
    this.fills.begin();
    const c = new THREE.Vector3();
    const hw = (CELL_WIDTH * (1 - v.CELL_GAP)) / 2;
    const hd = (CELL_DEPTH * (1 - v.CELL_GAP)) / 2;

    for (let y = 0; y < ROWS; y++) {
      const reveal = fx.reveal(y);
      if (reveal <= 0) continue;
      for (let x = 0; x < COLS; x++) {
        const view = views[cellKey(x, y, COLS)] as CellView;
        cellToWorld(x, y, c);
        const state = fx.broken(x, y) && view.state !== 'EMPTY' ? 'BROKEN' : view.state;
        const flash = fx.flash(x, y);
        const line = fx.red ? col.red : col.phosphor;
        const base = flash > 0 ? col.tmp.copy(col.accent).multiplyScalar(Math.min(1, flash)) : line;
        const s = reveal < 1 ? reveal : 1;
        const cellHw = hw * s;
        const cellHd = hd * s;

        switch (state) {
          case 'EMPTY':
            this.corners(c, cellHw, cellHd, col.dim, 0.08);
            break;
          case 'BROKEN':
            this.brokenOutline(c, cellHw, cellHd, base, (x * 7 + y * 3 + Math.floor(time / 3)) % 5);
            break;
          case 'ATTACK': {
            const tone = view.tone === 'red' ? col.red : col.accent;
            this.outline(c, cellHw, cellHd, tone);
            const k = 1 - view.age / attackTicks;
            this.fills.flat(c.x, c.z, cellHw, cellHd * 0.22 * (0.5 + k), FILL_Y, tone);
            break;
          }
          case 'DANGER':
            this.outline(c, cellHw, cellHd, col.red);
            this.outline(c, cellHw * 0.9, cellHd * 0.9, col.red);
            this.fills.flat(c.x, c.z, cellHw, cellHd, FILL_Y, col.tmp.copy(col.red).multiplyScalar(0.3 + 0.35 * pulse));
            break;
          case 'SPAWN': {
            this.outline(c, cellHw, cellHd, base);
            const t = view.age / spawnTicks;
            for (let r = 0; r < SPAWN_RINGS; r++) {
              const k = 1 - ((r / SPAWN_RINGS + t * 2) % 1);
              this.outline(c, cellHw * k, cellHd * k, col.red);
            }
            break;
          }
          case 'OBJECT':
            this.outline(c, cellHw, cellHd, base);
            this.box(c, cellHw * 0.55, OBJECT_HEIGHT, cellHd * 0.55, base);
            break;
          case 'ACTIVE':
            this.outline(c, cellHw, cellHd, base);
            this.outline(c, cellHw * 0.92, cellHd * 0.92, base);
            this.fills.flat(c.x, c.z, cellHw, cellHd, FILL_Y, col.tmp.copy(base).multiplyScalar(v.ACTIVE_FILL));
            break;
          case 'AFTER': {
            const on = Math.floor(view.age / 2) % 2 === 0;
            this.outline(c, cellHw, cellHd, on ? (view.tone === 'red' ? col.red : col.accent) : base);
            break;
          }
          case 'NORMAL':
            this.outline(c, cellHw, cellHd, flash > 0 || fx.red ? base : col.dim);
            break;
        }
        if (sideOfRow(y) === 'enemy' && state !== 'EMPTY') this.corners(c, cellHw, cellHd, col.red, 0.06);
      }
    }
    this.divider(fx.reveal(Math.floor(ROWS / 2)));

    this.lines.end();
    this.fills.end();
  }

  private outline(c: THREE.Vector3, hw: number, hd: number, color: THREE.Color): void {
    const x0 = c.x - hw;
    const x1 = c.x + hw;
    const z0 = c.z - hd;
    const z1 = c.z + hd;
    const y = LINE_Y;
    this.lines.line(x0, y, z0, x1, y, z0, color);
    this.lines.line(x1, y, z0, x1, y, z1, color);
    this.lines.line(x1, y, z1, x0, y, z1, color);
    this.lines.line(x0, y, z1, x0, y, z0, color);
  }

  /** Outline with gaps; `phase` shifts which pieces are missing. */
  private brokenOutline(c: THREE.Vector3, hw: number, hd: number, color: THREE.Color, phase: number): void {
    const pts: [number, number][] = [
      [c.x - hw, c.z - hd],
      [c.x + hw, c.z - hd],
      [c.x + hw, c.z + hd],
      [c.x - hw, c.z + hd],
    ];
    for (let e = 0; e < 4; e++) {
      const [ax, az] = pts[e] as [number, number];
      const [bx, bz] = pts[(e + 1) % 4] as [number, number];
      for (let piece = 0; piece < 3; piece++) {
        if ((e + piece + phase) % 3 === 0) continue;
        const t0 = piece / 3 + 0.04;
        const t1 = (piece + 1) / 3 - 0.04;
        this.lines.line(ax + (bx - ax) * t0, LINE_Y, az + (bz - az) * t0, ax + (bx - ax) * t1, LINE_Y, az + (bz - az) * t1, color);
      }
    }
  }

  /** Short corner ticks. */
  private corners(c: THREE.Vector3, hw: number, hd: number, color: THREE.Color, len: number): void {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = c.x + sx * hw;
        const z = c.z + sz * hd;
        this.lines.line(x, LINE_Y, z, x - sx * len, LINE_Y, z, color);
        this.lines.line(x, LINE_Y, z, x, LINE_Y, z - sz * len, color);
      }
    }
  }

  /** Wireframe box standing on the cell. */
  private box(c: THREE.Vector3, hw: number, h: number, hd: number, color: THREE.Color): void {
    const xs = [c.x - hw, c.x + hw];
    const zs = [c.z - hd, c.z + hd];
    for (const yy of [0, h]) {
      this.lines.line(xs[0]!, yy, zs[0]!, xs[1]!, yy, zs[0]!, color);
      this.lines.line(xs[1]!, yy, zs[0]!, xs[1]!, yy, zs[1]!, color);
      this.lines.line(xs[1]!, yy, zs[1]!, xs[0]!, yy, zs[1]!, color);
      this.lines.line(xs[0]!, yy, zs[1]!, xs[0]!, yy, zs[0]!, color);
    }
    for (const x of xs) for (const z of zs) this.lines.line(x, 0, z, x, h, z, color);
  }

  /** Red dashed line between the two territories. */
  private divider(reveal: number): void {
    if (reveal <= 0) return;
    const z = (ROWS / 2 - (ROWS - 1) / 2 - 0.5) * CELL_DEPTH;
    const half = (COLS * CELL_WIDTH) / 2;
    const step = (half * 2) / DASHES;
    for (let i = 0; i < DASHES; i++) {
      const x0 = -half + i * step + step * 0.2;
      this.lines.line(x0, LINE_Y, z, x0 + step * 0.6 * reveal, LINE_Y, z, col.red);
    }
  }
}
