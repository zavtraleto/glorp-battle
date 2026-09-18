import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import type { Dir } from '../../core/input/commands';
import { gaugeSegments } from '../crt/hudModel';
import { PressKey } from './pressKey';

// NAVIGATION trackball (spec §10.1): the only battle organ. A faceted ball in a
// thick socket, ringed by a big worn red ring. The ball follows the finger and
// keeps spinning with inertia; the ring carries the custom gauge, flashes the
// segment of each step and blinks when a shot is refused.

const COLOR = {
  lit: new THREE.Color(0xff3324),
  unlit: new THREE.Color(0x35100d),
  flash: new THREE.Color(0xffd2c4),
};
const DIR_ANGLE: Record<Dir, number> = {
  right: 0,
  up: Math.PI / 2,
  left: Math.PI,
  down: -Math.PI / 2,
};
/** Radians of spin velocity per CSS px of drag per second of frame. */
const SPIN_FROM_DRAG = 60;
/** The ball sinks a little when grabbed. */
const GRAB_TRAVEL = 0.04;
/** Segments lit to either side of a step's direction. */
const STEP_SPREAD = 1;
const DENY_BLINK_HZ = 8;
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const turn = new THREE.Quaternion();

/** Deterministic wear so the ring is not a perfect circle. */
function wobble(i: number): number {
  const s = Math.sin(i * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export class Trackball {
  readonly group = new THREE.Group();
  private readonly key = new PressKey(GRAB_TRAVEL);
  private readonly ball: THREE.Mesh;
  private readonly socket: THREE.Mesh;
  private readonly segGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly segMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private ring: THREE.InstancedMesh | null = null;
  private readonly flash: number[] = [];
  private readonly spin = new THREE.Vector2();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpS = new THREE.Vector3();
  private readonly tmpC = new THREE.Color();
  private lit = -1;
  private denyLeft = 0;

  constructor() {
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshPhongMaterial({ color: 0x2a2c30, specular: 0x777777, shininess: 40, flatShading: true }),
    );
    this.socket = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.2, 6, 16),
      new THREE.MeshLambertMaterial({ color: 0x141518, flatShading: true }),
    );
    this.key.object.add(this.ball);
    this.group.add(this.socket, this.key.object);
  }

  /** `unit` is the terminal body width in world units; sizes are shares of it. */
  build(cx: number, cy: number, unit: number): void {
    const t = tuning.terminal;
    const radius = (unit * t.BALL_W) / 2;
    this.key.place(cx, cy, 0.05);
    this.ball.scale.setScalar(radius);
    this.socket.position.set(cx, cy, 0.04);
    this.socket.scale.setScalar(radius);

    if (this.ring) {
      this.group.remove(this.ring);
      this.ring.dispose();
    }
    const count = Math.max(3, Math.round(t.RING_SEGMENTS));
    const outer = (unit * t.RING_W) / 2;
    const band = Math.max(0.02, outer - radius * 1.18);
    const mid = outer - band / 2;
    const arc = ((2 * Math.PI * mid) / count) * 0.74;
    const ring = new THREE.InstancedMesh(this.segGeo, this.segMat, count);
    for (let i = 0; i < count; i++) {
      const a = Math.PI / 2 - (i / count) * Math.PI * 2;
      const worn = 0.78 + wobble(i) * 0.42;
      this.tmpP.set(cx + Math.cos(a) * mid, cy + Math.sin(a) * mid, 0.03);
      this.tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a - Math.PI / 2);
      this.tmpS.set(arc, band * worn, 0.16);
      ring.setMatrixAt(i, this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS));
      ring.setColorAt(i, COLOR.unlit);
    }
    this.group.add(ring);
    this.ring = ring;
    this.flash.length = count;
    this.flash.fill(0);
    this.lit = -1;
  }

  press(): void {
    this.key.press(false);
  }

  release(): void {
    this.key.release();
  }

  hover(on: boolean): void {
    this.key.hover(on);
  }

  /** A refused shot: the ring blinks red (spec §10.2). */
  deny(): void {
    this.denyLeft = tuning.terminal.DENIED_BLINK_TIME;
  }

  /** The hand refilled: the ring flares once, the beat that replaces the pause. */
  pulse(): void {
    this.flash.fill(tuning.terminal.ARROW_FLASH_TIME);
  }

  /** Adds spin from a drag delta (CSS px). */
  roll(dx: number, dy: number): void {
    const g = tuning.terminal.TRACKBALL_ROLL_GAIN * SPIN_FROM_DRAG;
    // Screen y grows down: dragging down turns the top of the ball toward the viewer.
    this.spin.x += dy * g;
    this.spin.y += dx * g;
  }

  /** Flashes the ring toward a step and gives the ball a nudge that way. */
  step(dir: Dir): void {
    const count = this.flash.length;
    if (count > 0) {
      const angle = DIR_ANGLE[dir];
      // Segment 0 sits at the top and they run clockwise.
      const at = Math.round((((Math.PI / 2 - angle) / (2 * Math.PI)) * count + count) % count);
      for (let d = -STEP_SPREAD; d <= STEP_SPREAD; d++) {
        this.flash[(at + d + count) % count] = tuning.terminal.ARROW_FLASH_TIME;
      }
    }
    const nudge = 12;
    if (dir === 'left' || dir === 'right') this.roll(dir === 'right' ? nudge : -nudge, 0);
    else this.roll(0, dir === 'down' ? nudge : -nudge);
  }

  /** `gauge` drives the lit segments; a full gauge pulses the whole ring. */
  update(dt: number, gauge: number, time: number): void {
    this.key.update(dt);
    // Turn about the socket's fixed axes; accumulating Euler angles would turn
    // the second axis with the first and roll the ball the wrong way.
    this.ball.quaternion.premultiply(turn.setFromAxisAngle(AXIS_X, this.spin.x * dt));
    this.ball.quaternion.premultiply(turn.setFromAxisAngle(AXIS_Y, this.spin.y * dt));
    this.spin.multiplyScalar(Math.exp(-dt * tuning.terminal.TRACKBALL_FRICTION));

    const flashTime = tuning.terminal.ARROW_FLASH_TIME;
    let flashing = false;
    for (let i = 0; i < this.flash.length; i++) {
      const left = Math.max(0, (this.flash[i] ?? 0) - dt);
      this.flash[i] = left;
      if (left > 0) flashing = true;
    }
    this.denyLeft = Math.max(0, this.denyLeft - dt);
    const lit = gaugeSegments(gauge, this.flash.length);
    const full = gauge >= 1;
    if (lit !== this.lit || flashing || this.denyLeft > 0 || full) {
      this.lit = lit;
      this.paintRing(lit, full, flashTime, time);
    }
  }

  private paintRing(lit: number, full: boolean, flashTime: number, time: number): void {
    const ring = this.ring;
    if (!ring) return;
    const pulse = full ? 0.72 + 0.28 * Math.sin(time * Math.PI * 2 * tuning.terminal.GLOW_PULSE_HZ) : 1;
    const denied = this.denyLeft > 0 && Math.floor(this.denyLeft * DENY_BLINK_HZ * 2) % 2 === 0;
    for (let i = 0; i < this.flash.length; i++) {
      const on = i < lit;
      this.tmpC.copy(on ? COLOR.lit : COLOR.unlit);
      if (on && full) this.tmpC.multiplyScalar(pulse);
      if (denied) this.tmpC.copy(COLOR.lit);
      const f = flashTime > 0 ? (this.flash[i] ?? 0) / flashTime : 0;
      if (f > 0) this.tmpC.lerp(COLOR.flash, f);
      ring.setColorAt(i, this.tmpC);
    }
    if (ring.instanceColor) ring.instanceColor.needsUpdate = true;
  }
}
