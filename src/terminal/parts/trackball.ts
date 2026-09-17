import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import type { Dir } from '../../core/input/commands';
import { PressKey } from './pressKey';

// NAVIGATION trackball (TERMINAL.md §5.1): a faceted ball in a thick socket with
// four arrows. The ball follows the finger and keeps spinning with inertia;
// the arrow of each step flashes.

const ARROW_ON = new THREE.Color(0x6fd3ff);
const ARROW_OFF = new THREE.Color(0x2a3036);
const ARROW_DIRS: readonly Dir[] = ['up', 'right', 'down', 'left'];
/** Radians of spin velocity per CSS px of drag per second of frame. */
const SPIN_FROM_DRAG = 60;
/** The ball sinks a little when grabbed. */
const GRAB_TRAVEL = 0.04;

export class Trackball {
  readonly group = new THREE.Group();
  private readonly key = new PressKey(GRAB_TRAVEL);
  private readonly ball: THREE.Mesh;
  private readonly socket: THREE.Mesh;
  private readonly arrows: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; left: number }[] = [];
  private readonly spin = new THREE.Vector2();

  constructor() {
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshPhongMaterial({ color: 0x2a2c30, specular: 0x777777, shininess: 40, flatShading: true }),
    );
    this.socket = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.2, 6, 16),
      new THREE.MeshLambertMaterial({ color: 0x1c1d1f, flatShading: true }),
    );
    const tri = new THREE.Shape([new THREE.Vector2(0, 0.5), new THREE.Vector2(-0.45, -0.3), new THREE.Vector2(0.45, -0.3)]);
    const triGeo = new THREE.ShapeGeometry(tri);
    ARROW_DIRS.forEach((_, i) => {
      const mat = new THREE.MeshBasicMaterial({ color: ARROW_OFF.clone() });
      const mesh = new THREE.Mesh(triGeo, mat);
      mesh.rotation.z = -i * (Math.PI / 2);
      this.arrows.push({ mesh, mat, left: 0 });
      this.group.add(mesh);
    });
    this.key.object.add(this.ball);
    this.group.add(this.socket, this.key.object);
  }

  build(cx: number, cy: number, radius: number): void {
    this.key.place(cx, cy, 0.05);
    this.ball.scale.setScalar(radius);
    this.socket.position.set(cx, cy, 0.05);
    this.socket.scale.set(radius, radius, radius);
    const arrowR = radius * 1.62;
    const arrowS = radius * 0.28;
    this.arrows.forEach((a, i) => {
      const angle = Math.PI / 2 - i * (Math.PI / 2);
      a.mesh.position.set(cx + Math.cos(angle) * arrowR, cy + Math.sin(angle) * arrowR, 0.02);
      a.mesh.scale.setScalar(arrowS);
    });
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

  /** Flashes the arrow of a step and gives the ball a nudge that way. */
  step(dir: Dir): void {
    const a = this.arrows[ARROW_DIRS.indexOf(dir)];
    if (a) a.left = tuning.terminal.ARROW_FLASH_TIME;
    const nudge = 12;
    if (dir === 'left' || dir === 'right') this.roll(dir === 'right' ? nudge : -nudge, 0);
    else this.roll(0, dir === 'down' ? nudge : -nudge);
  }

  update(dt: number): void {
    this.key.update(dt);
    this.ball.rotation.x += this.spin.x * dt;
    this.ball.rotation.y += this.spin.y * dt;
    this.spin.multiplyScalar(Math.exp(-dt * tuning.terminal.TRACKBALL_FRICTION));
    const flash = tuning.terminal.ARROW_FLASH_TIME;
    for (const a of this.arrows) {
      a.left = Math.max(0, a.left - dt);
      a.mat.color.copy(ARROW_OFF).lerp(ARROW_ON, flash > 0 ? a.left / flash : 0);
    }
  }
}
