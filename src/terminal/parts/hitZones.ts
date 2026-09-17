import * as THREE from 'three';
import { rectToWorld, type TerminalLayout } from '../layout';

// Debug overlay: magenta outlines of the pointer zones (?hitzones=1).

export class HitZones {
  readonly group = new THREE.Group();
  private readonly mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
  private readonly plane = new THREE.PlaneGeometry(1, 1);

  constructor() {
    this.group.visible = false;
  }

  build(layout: TerminalLayout): void {
    this.group.clear();
    for (const z of Object.values(layout.zones)) {
      const w = rectToWorld(layout, z);
      const m = new THREE.Mesh(this.plane, this.mat);
      m.position.set(w.cx, w.cy, 0.6);
      m.scale.set(w.w, w.h, 1);
      this.group.add(m);
    }
  }
}
