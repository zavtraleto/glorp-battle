import * as THREE from 'three';

// Circuit traces on the control panel (TERMINAL.md §3.1, decision 2026-09-19).
// They teach the wiring of the cabinet: traces run from the bottom edge of
// every chip slot to the trackball ring (a loaded chip lights its trace and
// sends pulses into the ring; a shot runs back ring → chip), and from the top
// edge of the slots into the screen (a shot runs chip → screen). Both carry the
// yellow of action (decision 2026-09-20), so the wiring reads by its geometry
// and by when it pulses. Each trace is a row of short dashes on one instanced
// mesh, so a pulse is only a moving brightness along the dashes.

const COLOR = {
  off: new THREE.Color(0x3d3010),
  on: new THREE.Color(0xffd45e),
};

/** Dash length along a trace and trace width, world units. */
const STEP = 0.035;
const WIDTH = 0.04;
/** Loaded-chip pulses into the ring, per second; the ring breathes at the same rate. */
export const PCB_PULSE_HZ = 1.4;
/** Length of a pulse, as a share of the trace. */
const PULSE_LEN = 0.22;
/** A shot: ring → chip, then chip → screen, seconds. */
const FIRE_DOWN_TIME = 0.12;
const FIRE_UP_TIME = 0.12;
/**
 * Share of full brightness a loaded chip's trace sits at between pulses. Raised
 * 2026-09-20 so the trace carries on from the bar of light under the queued
 * cartridge instead of fading out next to it.
 */
const LIT_BASE = 0.62;

export interface SlotEdge {
  x: number;
  top: number;
  bottom: number;
}

interface Trace {
  /** First dash index and dash count in the instanced mesh. */
  first: number;
  count: number;
}

function polyline(points: readonly THREE.Vector2[]): { p: THREE.Vector2; angle: number }[] {
  const out: { p: THREE.Vector2; angle: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as THREE.Vector2;
    const b = points[i] as THREE.Vector2;
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.round(len / STEP));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    for (let k = 0; k < n; k++) out.push({ p: a.clone().lerp(b, (k + 0.5) / n), angle });
  }
  return out;
}

export class Pcb {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private readonly geo = new THREE.PlaneGeometry(1, 1);
  private readonly mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private down: Trace[] = [];
  private up: Trace[] = [];
  private time = 0;
  /** Seconds since each slot fired (Infinity = not firing). */
  private fired: number[] = [];
  private readonly c = new THREE.Color();

  /**
   * Lays out the traces: `slots` are the chip slots' edges, the ring is the
   * trackball's ring, `screenY` is where the traces go under the screen.
   */
  build(slots: readonly SlotEdge[], ringX: number, ringY: number, ringR: number, screenY: number): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    const dashes: { p: THREE.Vector2; angle: number }[] = [];
    const add = (points: THREE.Vector2[]): Trace => {
      const d = polyline(points);
      const t = { first: dashes.length, count: d.length };
      dashes.push(...d);
      return t;
    };
    const mid = (slots.length - 1) / 2;
    this.down = slots.map((s, i) => {
      const o = i - mid;
      // Drop out of the slot, run along a staggered bus, then down into the
      // ring: outer slots take the lower buses so traces never cross.
      const busY = s.bottom - 0.06 - Math.abs(o) * 0.045;
      const entryX = ringX + o * 0.12;
      const entryY = ringY + Math.sqrt(Math.max(0, ringR * ringR - (entryX - ringX) ** 2));
      const chamfer = Math.min(0.05, Math.abs(s.x - entryX) / 2);
      const dir = Math.sign(entryX - s.x);
      const pts = [new THREE.Vector2(s.x, s.bottom)];
      if (chamfer > 0.001) {
        pts.push(new THREE.Vector2(s.x, busY + chamfer));
        pts.push(new THREE.Vector2(s.x + dir * chamfer, busY));
        pts.push(new THREE.Vector2(entryX - dir * chamfer, busY));
        pts.push(new THREE.Vector2(entryX, busY - chamfer));
      }
      pts.push(new THREE.Vector2(entryX, entryY));
      return add(pts);
    });
    this.up = slots.map((s, i) => {
      // Up from the slot and slightly in toward the middle, under the screen.
      const lean = (mid - i) * 0.05;
      return add([new THREE.Vector2(s.x, s.top), new THREE.Vector2(s.x, s.top + 0.06), new THREE.Vector2(s.x + lean, screenY)]);
    });
    this.fired = slots.map(() => Infinity);

    const mesh = new THREE.InstancedMesh(this.geo, this.mat, Math.max(1, dashes.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3(STEP * 1.05, WIDTH, 1);
    dashes.forEach((d, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), d.angle);
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(d.p.x, d.p.y, 0.012), q, scale));
      mesh.setColorAt(i, COLOR.off);
    });
    this.mesh = mesh;
    this.group.add(mesh);
  }

  /** A chip in `slot` was fired: a pulse runs ring → chip → screen. */
  fire(slot: number): void {
    if (slot >= 0 && slot < this.fired.length) this.fired[slot] = 0;
  }

  /** `loaded[i]`: slot i holds a queued chip. */
  update(dt: number, loaded: readonly boolean[]): void {
    const mesh = this.mesh;
    if (!mesh) return;
    this.time += dt;
    const phase = (this.time * PCB_PULSE_HZ) % 1;
    this.down.forEach((tr, i) => {
      const f = (this.fired[i] ?? Infinity) + dt;
      this.fired[i] = f;
      const firing = f < FIRE_DOWN_TIME ? 1 - f / FIRE_DOWN_TIME : -1;
      const on = loaded[i] === true;
      for (let k = 0; k < tr.count; k++) {
        const s = tr.count > 1 ? k / (tr.count - 1) : 0;
        let b = on ? LIT_BASE + (1 - LIT_BASE) * bump(s, phase) : 0;
        // The shot runs back from the ring (s = 1) to the chip (s = 0).
        if (firing >= 0) b = Math.max(b, bump(s, firing) * 1.2);
        this.c.copy(COLOR.off).lerp(COLOR.on, Math.min(1, b));
        mesh.setColorAt(tr.first + k, this.c);
      }
    });
    this.up.forEach((tr, i) => {
      const f = (this.fired[i] ?? Infinity) - FIRE_DOWN_TIME;
      const p = f >= 0 && f < FIRE_UP_TIME ? f / FIRE_UP_TIME : -1;
      for (let k = 0; k < tr.count; k++) {
        const s = tr.count > 1 ? k / (tr.count - 1) : 0;
        const b = p >= 0 ? bump(s, p) * 1.2 : 0;
        this.c.copy(COLOR.off).lerp(COLOR.on, Math.min(1, b));
        mesh.setColorAt(tr.first + k, this.c);
      }
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

/** Brightness of a pulse centred at `at` along a trace, at position `s` (both 0..1). */
function bump(s: number, at: number): number {
  const d = Math.abs(s - at);
  return d >= PULSE_LEN ? 0 : 0.5 + 0.5 * Math.cos((d / PULSE_LEN) * Math.PI);
}
