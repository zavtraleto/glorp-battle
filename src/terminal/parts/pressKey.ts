import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import { Spring } from '../anim/spring';

// A spring-driven physical key (TERMINAL.md §5): press → compression, release →
// rebound with a short overshoot, a dull press travels less, hover lifts it.

/** Share of the travel applied instantly on press, so the reaction lands in the same frame. */
const INSTANT_SHARE = 0.6;

export class PressKey {
  readonly object = new THREE.Group();
  private readonly spring = new Spring(0);
  private readonly lift = new Spring(0);
  private restZ = 0;

  constructor(private travel: number) {}

  place(x: number, y: number, restZ: number, travel = this.travel): void {
    this.restZ = restZ;
    this.travel = travel;
    this.object.position.set(x, y, restZ);
  }

  get pressed(): boolean {
    return this.spring.target > 0;
  }

  press(dull: boolean): void {
    const target = dull ? tuning.terminal.DULL_PRESS_SHARE : 1;
    this.spring.target = target;
    this.spring.value = Math.max(this.spring.value, target * INSTANT_SHARE);
  }

  release(): void {
    this.spring.target = 0;
  }

  hover(on: boolean): void {
    this.lift.target = on ? 1 : 0;
  }

  update(dt: number): void {
    const t = tuning.terminal;
    this.spring.step(dt, t.SPRING_STIFFNESS, t.SPRING_DAMPING);
    this.lift.step(dt, t.SPRING_STIFFNESS / 4, t.SPRING_DAMPING);
    const hover = this.pressed ? 0 : this.lift.value * t.HOVER_LIFT;
    this.object.position.z = this.restZ - this.travel * this.spring.value + hover;
  }
}
