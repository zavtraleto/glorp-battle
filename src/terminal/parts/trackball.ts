import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import type { Dir } from '../../core/input/commands';
import { PressKey } from './pressKey';

// NAVIGATION trackball (spec §10.1): the only battle organ. A graphite ball in
// a thick socket, inside a plain red ring. The ring burns bright only while a
// tap would do something (a loaded chip in battle, any menu); four small
// triangles around it flash with each step.

const COLOR = {
  armed: new THREE.Color(0xff403f),
  idle: new THREE.Color(0x3a1110),
  arrowOff: new THREE.Color(0x2a0d0c),
  arrowOn: new THREE.Color(0xff403f),
};
const DIR_ANGLE: Record<Dir, number> = {
  right: 0,
  up: Math.PI / 2,
  left: Math.PI,
  down: -Math.PI / 2,
};
const DIRS: readonly Dir[] = ['up', 'right', 'down', 'left'];
/** Radians of spin velocity per CSS px of drag per second of frame. */
const SPIN_FROM_DRAG = 60;
/** The ball sinks a little when grabbed. */
const GRAB_TRAVEL = 0.04;
/** Ring polygon count: low-poly, but reads as a circle. */
const RING_SIDES = 40;
/** Ring colour follows the armed state at this rate, 1/s. */
const ARM_RATE = 18;
/** Triangle size and its gap from the ring, shares of the ring's outer radius. */
const ARROW_SIZE = 0.16;
const ARROW_GAP = 0.06;
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const turn = new THREE.Quaternion();

export class Trackball {
  readonly group = new THREE.Group();
  private readonly key = new PressKey(GRAB_TRAVEL);
  private readonly ball: THREE.Mesh;
  private readonly socket: THREE.Mesh;
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: COLOR.idle.clone() });
  private ring: THREE.Mesh | null = null;
  private readonly arrowGeo: THREE.BufferGeometry;
  private readonly arrows = new Map<Dir, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; left: number }>();
  private readonly spin = new THREE.Vector2();
  private armed = 0;

  constructor() {
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshPhongMaterial({ color: 0x4a4c50, specular: 0x3c3c3c, shininess: 22, flatShading: true }),
    );
    this.socket = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.2, 6, 16),
      new THREE.MeshLambertMaterial({ color: 0x141518, flatShading: true }),
    );
    this.key.object.add(this.ball);
    // A unit triangle pointing along +x; each arrow is turned toward its direction.
    this.arrowGeo = new THREE.BufferGeometry();
    this.arrowGeo.setAttribute('position', new THREE.Float32BufferAttribute([0.5, 0, 0, -0.5, 0.55, 0, -0.5, -0.55, 0], 3));
    for (const dir of DIRS) {
      const mat = new THREE.MeshBasicMaterial({ color: COLOR.arrowOff.clone() });
      const mesh = new THREE.Mesh(this.arrowGeo, mat);
      mesh.rotation.z = DIR_ANGLE[dir];
      this.arrows.set(dir, { mesh, mat, left: 0 });
      this.group.add(mesh);
    }
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
      this.ring.geometry.dispose();
    }
    const outer = (unit * t.RING_W) / 2;
    const inner = Math.min(outer * 0.9, radius * 1.1);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, RING_SIDES), this.ringMat);
    this.ring.position.set(cx, cy, 0.03);
    this.group.add(this.ring);

    const size = outer * ARROW_SIZE;
    const at = outer * (1 + ARROW_GAP) + size / 2;
    for (const [dir, a] of this.arrows) {
      const angle = DIR_ANGLE[dir];
      a.mesh.position.set(cx + Math.cos(angle) * at, cy + Math.sin(angle) * at, 0.03);
      a.mesh.scale.setScalar(size);
    }
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

  /** Adds spin from a drag delta (CSS px). */
  roll(dx: number, dy: number): void {
    const g = tuning.terminal.TRACKBALL_ROLL_GAIN * SPIN_FROM_DRAG;
    // Screen y grows down: dragging down turns the top of the ball toward the viewer.
    this.spin.x += dy * g;
    this.spin.y += dx * g;
  }

  /** Flashes the triangle of a step and gives the ball a nudge that way. */
  step(dir: Dir): void {
    const a = this.arrows.get(dir);
    if (a) a.left = tuning.terminal.ARROW_FLASH_TIME;
    const nudge = 12;
    if (dir === 'left' || dir === 'right') this.roll(dir === 'right' ? nudge : -nudge, 0);
    else this.roll(0, dir === 'down' ? nudge : -nudge);
  }

  /** `armed`: a tap on the ball would act right now (spec §10.2), so the ring burns. */
  update(dt: number, armed: boolean): void {
    this.key.update(dt);
    // Turn about the socket's fixed axes; accumulating Euler angles would turn
    // the second axis with the first and roll the ball the wrong way.
    this.ball.quaternion.premultiply(turn.setFromAxisAngle(AXIS_X, this.spin.x * dt));
    this.ball.quaternion.premultiply(turn.setFromAxisAngle(AXIS_Y, this.spin.y * dt));
    this.spin.multiplyScalar(Math.exp(-dt * tuning.terminal.TRACKBALL_FRICTION));

    const k = 1 - Math.exp(-dt * ARM_RATE);
    this.armed += ((armed ? 1 : 0) - this.armed) * k;
    this.ringMat.color.copy(COLOR.idle).lerp(COLOR.armed, this.armed);

    const flash = tuning.terminal.ARROW_FLASH_TIME;
    for (const a of this.arrows.values()) {
      a.left = Math.max(0, a.left - dt);
      a.mat.color.copy(COLOR.arrowOff).lerp(COLOR.arrowOn, flash > 0 ? a.left / flash : 0);
    }
  }
}
