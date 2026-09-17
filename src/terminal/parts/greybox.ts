import * as THREE from 'three';
import { rectToWorld, type Rect, type TerminalLayout } from '../layout';

// Greybox chip rail (TERMINAL.md §11) and the hit-zone debug overlay.
// The rail is replaced by real chip cartridges in T1.4.

const RAIL_SLOTS = 5;

const mat = {
  dark: new THREE.MeshLambertMaterial({ color: 0x1c1d1f, flatShading: true }),
  chip: new THREE.MeshLambertMaterial({ color: 0x9a8b62, flatShading: true }),
  hit: new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true }),
};

export class Greybox {
  readonly group = new THREE.Group();
  private readonly parts = new THREE.Group();
  private readonly hitGroup = new THREE.Group();
  private chips: THREE.Mesh[] = [];
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly unitPlane = new THREE.PlaneGeometry(1, 1);

  constructor() {
    this.group.add(this.parts, this.hitGroup);
    this.hitGroup.visible = false;
  }

  build(layout: TerminalLayout): void {
    this.parts.clear();
    this.hitGroup.clear();
    this.chips = [];
    const W = (r: Rect) => rectToWorld(layout, r);

    const rail = W(layout.rail);
    const slotW = (rail.w * 0.78) / RAIL_SLOTS;
    for (let i = 0; i < RAIL_SLOTS; i++) {
      const x = rail.cx - rail.w * 0.45 + slotW * (i + 0.5);
      this.box(x, rail.cy, 0.02, slotW * 0.9, rail.h * 0.85, 0.1, mat.dark);
      this.chips.push(this.box(x, rail.cy, 0.2, slotW * 0.78, rail.h * 0.75, 0.25, mat.chip));
    }

    for (const z of Object.values(layout.zones)) {
      const w = W(z);
      const m = new THREE.Mesh(this.unitPlane, mat.hit);
      m.position.set(w.cx, w.cy, 0.6);
      m.scale.set(w.w, w.h, 1);
      this.hitGroup.add(m);
    }
  }

  /** Shows `count` chips in the rail; the first one is raised (active). */
  setChips(count: number): void {
    this.chips.forEach((c, i) => {
      c.visible = i < count;
      c.position.z = i === 0 ? 0.35 : 0.2;
    });
  }

  setHitZonesVisible(v: boolean): void {
    this.hitGroup.visible = v;
  }

  private box(x: number, y: number, z: number, w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(this.unitBox, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    this.parts.add(mesh);
    return mesh;
  }
}
