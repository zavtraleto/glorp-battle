import * as THREE from 'three';

// A tilted panel of the terminal (spec §3.1). Parts are still built in plan
// coordinates on the z=0 face; the mount leans them toward the player around a
// horizontal pivot line, so nothing inside has to know about the tilt.
//
// The sign convention matches mountCorners() in interaction/project.ts: a
// positive tilt brings the edge below the pivot toward the viewer. Hit rects
// are projected with that same function, so geometry and touch stay in step.

export class Mount extends THREE.Group {
  /** Parts are added here, in plan coordinates. */
  readonly inner = new THREE.Group();

  constructor() {
    super();
    this.add(this.inner);
  }

  /** Leans the contents by `tilt` radians about a horizontal line at `pivotY`. */
  set(tilt: number, pivotY: number): void {
    this.position.y = pivotY;
    this.rotation.x = -tilt;
    this.inner.position.y = -pivotY;
  }
}
