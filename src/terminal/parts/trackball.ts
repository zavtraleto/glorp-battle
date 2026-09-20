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
/** While armed the ring breathes: brightness range and rate (synced with the PCB pulses). */
export const ARM_BREATHE = 0.35;
/** Tutorial hint level 1: the breathing amplitude is multiplied by this (tutorial spec §5). */
export const HINT_PULSE_GAIN = 2.2;
/** A tap that fires flares the ring toward white for this long, seconds. */
const TAP_FLASH_TIME = 0.18;
const TAP_WHITE = new THREE.Color(0xffd0c8);
/**
 * The ball is sunk into the panel like a real trackball: its centre sits this
 * far below the panel surface (share of its radius), so only a cap stands out
 * of the hole. Seen at a slant the cap still hides the far side of the ring
 * lying on the panel (decision 2026-09-19).
 */
const BALL_SINK = 0.3;
/** The hole in the panel, a little wider than the ball where it meets the surface. */
const HOLE_R = 1.0;
/** The panel plate around the ball: how far it reaches, share of the ring's outer radius. */
const PLATE_REACH = 1.75;
/** The ring lies on the panel, just above the PCB traces. */
const RING_Z = 0.02;
/** Triangle size and its gap from the ring, shares of the ring's outer radius. */
const ARROW_SIZE = 0.16;
const ARROW_GAP = 0.06;
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const turn = new THREE.Quaternion();

/**
 * Ring brightness 0..1 from the armed fraction and the breathing phase
 * (`beat`, 0..1, peaks at 1). A hint pulse gets its own floor along the same
 * phase, so the ring visibly breathes even with an empty Attack Queue
 * (`armed` 0) — the level is never lower than what plain arming would give
 * (tutorial spec §5).
 */
export function ringPulseLevel(armed: number, beat: number, hintPulse: boolean): number {
  const breathe = ARM_BREATHE * (hintPulse ? HINT_PULSE_GAIN : 1);
  const armedLevel = armed * (1 - breathe + breathe * beat);
  if (!hintPulse) return armedLevel;
  const hintFloor = 1 - breathe + breathe * beat;
  return Math.max(armedLevel, hintFloor);
}

export class Trackball {
  readonly group = new THREE.Group();
  private readonly key = new PressKey(GRAB_TRAVEL);
  private readonly ball: THREE.Mesh;
  private readonly socket: THREE.Mesh;
  /** Panel surface around the hole: hides the sunken part of the ball. */
  private readonly plate: THREE.Mesh;
  /** Dark floor of the hole, seen past the ball's edge. */
  private readonly cavity: THREE.Mesh;
  private readonly plateMat = new THREE.MeshLambertMaterial({ color: 0x15161a, flatShading: true });
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: COLOR.idle.clone() });
  private ring: THREE.Mesh | null = null;
  private readonly arrowGeo: THREE.BufferGeometry;
  private readonly arrows = new Map<Dir, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; left: number }>();
  private readonly spin = new THREE.Vector2();
  private armed = 0;
  private tapLeft = 0;
  private time = 0;
  private hintPulse = false;
  /** Breathing rate while armed, Hz (the PCB pulses arrive on the beat). */
  breatheHz = 1.4;
  /** Ring centre and radii in the control panel's plan space. */
  readonly ring3 = { x: 0, y: 0, inner: 0, outer: 0 };

  constructor() {
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshPhongMaterial({ color: 0x4a4c50, specular: 0x3c3c3c, shininess: 22, flatShading: true }),
    );
    this.socket = new THREE.Mesh(
      // The lip of the hole the ball sits in; the red ring lies on the panel outside it.
      new THREE.TorusGeometry(HOLE_R, 0.06, 6, 24),
      new THREE.MeshLambertMaterial({ color: 0x0c0d10, flatShading: true }),
    );
    this.plate = new THREE.Mesh(new THREE.RingGeometry(1, 2, RING_SIDES), this.plateMat);
    this.cavity = new THREE.Mesh(new THREE.CircleGeometry(1, RING_SIDES), new THREE.MeshBasicMaterial({ color: 0x020203 }));
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
    this.group.add(this.plate, this.cavity, this.socket, this.key.object);
  }

  /** `unit` is the terminal body width in world units; sizes are shares of it. */
  build(cx: number, cy: number, unit: number): void {
    const t = tuning.terminal;
    const radius = (unit * t.BALL_W) / 2;
    this.key.place(cx, cy, -radius * BALL_SINK);
    this.ball.scale.setScalar(radius);
    this.socket.position.set(cx, cy, 0.005);
    this.socket.scale.setScalar(radius);
    this.cavity.position.set(cx, cy, -radius * 0.9);
    this.cavity.scale.setScalar(radius * HOLE_R);

    if (this.ring) {
      this.group.remove(this.ring);
      this.ring.geometry.dispose();
    }
    const outer = (unit * t.RING_W) / 2;
    // A band around the ball, flat on the panel; the raised ball hides its far side.
    const inner = Math.min(outer * 0.85, radius * 1.02);
    Object.assign(this.ring3, { x: cx, y: cy, inner, outer });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, RING_SIDES), this.ringMat);
    this.ring.position.set(cx, cy, RING_Z);
    this.group.add(this.ring);
    // The plate: a disc of panel with the hole cut out, under the ring and the PCB.
    this.plate.geometry.dispose();
    this.plate.geometry = new THREE.RingGeometry(radius * HOLE_R, outer * PLATE_REACH, RING_SIDES);
    this.plate.position.set(cx, cy, 0.004);

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

  /** A tap fired a chip: the ring flares. */
  flashTap(): void {
    this.tapLeft = TAP_FLASH_TIME;
  }

  /** Tutorial hint level 1: pulse harder so the eye goes here (tutorial spec §5). */
  setHintPulse(on: boolean): void {
    this.hintPulse = on;
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

    this.time += dt;
    this.tapLeft = Math.max(0, this.tapLeft - dt);
    const k = 1 - Math.exp(-dt * ARM_RATE);
    this.armed += ((armed ? 1 : 0) - this.armed) * k;
    // Armed: breathing between a strong and a full red, peaking with each PCB pulse.
    const beat = 0.5 + 0.5 * Math.cos(this.time * this.breatheHz * Math.PI * 2);
    const level = ringPulseLevel(this.armed, beat, this.hintPulse);
    this.ringMat.color.copy(COLOR.idle).lerp(COLOR.armed, level);
    if (this.tapLeft > 0) this.ringMat.color.lerp(TAP_WHITE, this.tapLeft / TAP_FLASH_TIME);

    const flash = tuning.terminal.ARROW_FLASH_TIME;
    for (const a of this.arrows.values()) {
      a.left = Math.max(0, a.left - dt);
      a.mat.color.copy(COLOR.arrowOff).lerp(COLOR.arrowOn, flash > 0 ? a.left / flash : 0);
    }
  }
}
