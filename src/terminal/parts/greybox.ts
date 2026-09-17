import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import { rectToWorld, type Rect, type TerminalLayout, type ZoneId } from '../layout';

// Greybox controls and chip rail (TERMINAL.md §11): low-poly stand-ins with roughly
// final counts. Replaced by real parts in T1.3 (controls) and T1.4 (chip rail).

const GAUGE_LEDS = 12;
const RAIL_SLOTS = 5;
/** Approach rate of pressed controls, 1/s. */
const PRESS_RATE = 40;

const mat = {
  dark: new THREE.MeshLambertMaterial({ color: 0x1c1d1f, flatShading: true }),
  chip: new THREE.MeshLambertMaterial({ color: 0x9a8b62, flatShading: true }),
  execute: new THREE.MeshLambertMaterial({ color: 0xb8322a, flatShading: true }),
  select: new THREE.MeshLambertMaterial({ color: 0xc99a2e, flatShading: true }),
  ball: new THREE.MeshLambertMaterial({ color: 0x2a2c30, flatShading: true }),
  led: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  hit: new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true }),
};

const LED_ON = new THREE.Color(0x55ff66);
const LED_OFF = new THREE.Color(0x1a241a);

interface Pressable {
  mesh: THREE.Object3D;
  restZ: number;
  down: boolean;
  z: number;
}

export class Greybox {
  readonly group = new THREE.Group();
  private readonly parts = new THREE.Group();
  private readonly hitGroup = new THREE.Group();
  private readonly pressables = new Map<ZoneId, Pressable>();
  private ball: THREE.Mesh | null = null;
  private readonly spin = new THREE.Vector2();
  private gaugeLeds: THREE.InstancedMesh | null = null;
  private chips: THREE.Mesh[] = [];
  private readonly ledGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly noRot = new THREE.Quaternion();

  constructor() {
    this.group.add(this.parts, this.hitGroup);
    this.hitGroup.visible = false;
  }

  /** (Re)creates the meshes for a layout. */
  build(layout: TerminalLayout): void {
    this.disposeParts();
    this.pressables.clear();
    this.chips = [];
    const W = (r: Rect) => rectToWorld(layout, r);

    const top = W(layout.top);

    // Pause key.
    const pause = W(layout.zones.pause);
    const pauseSize = Math.min(pause.w, top.h) * 0.6;
    this.pressable('pause', this.box(pause.cx, top.cy, 0.05, pauseSize, top.h * 0.6, 0.12, mat.dark), 0.05);

    // Chip rail: slots and chips.
    const rail = W(layout.rail);
    const slotW = (rail.w * 0.78) / RAIL_SLOTS;
    for (let i = 0; i < RAIL_SLOTS; i++) {
      const x = rail.cx - rail.w * 0.45 + slotW * (i + 0.5);
      this.box(x, rail.cy, 0.02, slotW * 0.9, rail.h * 0.85, 0.1, mat.dark);
      this.chips.push(this.box(x, rail.cy, 0.2, slotW * 0.78, rail.h * 0.75, 0.25, mat.chip));
    }

    // CHIP SELECT with the gauge LED ring.
    const sel = W(layout.zones.chipSelect);
    const selSize = Math.min(sel.w, sel.h) * 0.42;
    this.pressable('chipSelect', this.box(sel.cx, sel.cy, 0.15, selSize, selSize, 0.3, mat.select), 0.15);
    const ring = selSize * 0.95;
    const ledSize = selSize * 0.12;
    this.gaugeLeds = this.leds(GAUGE_LEDS, (i) => {
      const a = Math.PI / 2 - (i / GAUGE_LEDS) * Math.PI * 2;
      this.tmpP.set(sel.cx + Math.cos(a) * ring, sel.cy + Math.sin(a) * ring, 0.05);
      this.tmpS.set(ledSize, ledSize, 0.1);
    });

    // Trackball in its socket.
    const tb = W(layout.zones.trackball);
    const r = Math.min(tb.w, tb.h) * 0.3;
    const socket = new THREE.Mesh(new THREE.TorusGeometry(r * 1.15, r * 0.18, 6, 16), mat.dark);
    socket.position.set(tb.cx, tb.cy, 0.05);
    this.parts.add(socket);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat.ball);
    this.ball.position.set(tb.cx, tb.cy, 0.05);
    this.parts.add(this.ball);
    this.pressable('trackball', this.ball, 0.05);

    // EXECUTE.
    const ex = W(layout.zones.execute);
    const exSize = Math.min(ex.w, ex.h) * 0.62;
    this.box(ex.cx, ex.cy, 0.02, exSize * 1.25, exSize * 1.25, 0.1, mat.dark);
    this.pressable('execute', this.box(ex.cx, ex.cy, 0.2, exSize, exSize, 0.35, mat.execute), 0.2);

    // Hit zone outlines (debug).
    for (const z of Object.values(layout.zones)) {
      const w = W(z);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w.w, w.h), mat.hit);
      m.position.set(w.cx, w.cy, 0.6);
      this.hitGroup.add(m);
    }
  }

  press(zone: ZoneId, down: boolean): void {
    const p = this.pressables.get(zone);
    if (p) p.down = down;
  }

  /** Adds spin from a drag delta (CSS px). */
  roll(dx: number, dy: number): void {
    const g = tuning.terminal.TRACKBALL_ROLL_GAIN * 60;
    // Screen y grows down: dragging down turns the top of the ball toward the viewer.
    this.spin.x += dy * g;
    this.spin.y += dx * g;
  }

  setGaugeLeds(lit: number): void {
    this.setLeds(this.gaugeLeds, lit, GAUGE_LEDS);
  }

  /** Shows `count` chips in the rail; the first one is raised (active). */
  setChips(count: number): void {
    this.chips.forEach((c, i) => {
      c.visible = i < count;
      c.position.z = i === 0 ? 0.35 : 0.2;
    });
  }

  update(dt: number): void {
    const depth = tuning.terminal.BUTTON_PRESS_DEPTH;
    const k = 1 - Math.exp(-dt * PRESS_RATE);
    for (const p of this.pressables.values()) {
      const target = p.restZ - (p.down ? depth : 0);
      p.z += (target - p.z) * k;
      p.mesh.position.z = p.z;
    }
    if (this.ball) {
      this.ball.rotation.x += this.spin.x * dt;
      this.ball.rotation.y += this.spin.y * dt;
      this.spin.multiplyScalar(Math.exp(-dt * tuning.terminal.TRACKBALL_FRICTION));
    }
  }

  setHitZonesVisible(v: boolean): void {
    this.hitGroup.visible = v;
  }

  private box(x: number, y: number, z: number, w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    this.parts.add(mesh);
    return mesh;
  }

  private pressable(zone: ZoneId, mesh: THREE.Object3D, restZ: number): void {
    this.pressables.set(zone, { mesh, restZ, down: false, z: restZ });
  }

  /** Instanced LEDs; `place(i)` fills tmpP/tmpS for LED i. */
  private leds(count: number, place: (i: number) => void): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(this.ledGeo, mat.led, count);
    for (let i = 0; i < count; i++) {
      place(i);
      im.setMatrixAt(i, this.tmpM.compose(this.tmpP, this.noRot, this.tmpS));
      im.setColorAt(i, LED_OFF);
    }
    this.parts.add(im);
    return im;
  }

  private setLeds(im: THREE.InstancedMesh | null, lit: number, count: number): void {
    if (!im) return;
    for (let i = 0; i < count; i++) im.setColorAt(i, i < lit ? LED_ON : LED_OFF);
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  private disposeParts(): void {
    for (const o of [...this.parts.children, ...this.hitGroup.children]) {
      if (o instanceof THREE.Mesh && o.geometry !== this.ledGeo) o.geometry.dispose();
    }
    this.parts.clear();
    this.hitGroup.clear();
  }
}
