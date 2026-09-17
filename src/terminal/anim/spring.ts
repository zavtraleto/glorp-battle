// Damped spring for tactile motion (TERMINAL.md §9.7). Semi-implicit Euler in
// fixed substeps, so large frame gaps stay stable.

const SUBSTEP = 1 / 240;
const MAX_SUBSTEPS = 60;

export class Spring {
  velocity = 0;
  target: number;

  constructor(public value = 0) {
    this.target = value;
  }

  step(dt: number, stiffness: number, damping: number): void {
    let left = Math.min(dt, SUBSTEP * MAX_SUBSTEPS);
    while (left > 0) {
      const h = Math.min(SUBSTEP, left);
      const accel = -stiffness * (this.value - this.target) - damping * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
      left -= h;
    }
  }

  snap(v: number): void {
    this.value = v;
    this.target = v;
    this.velocity = 0;
  }
}
