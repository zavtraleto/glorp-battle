import * as THREE from 'three';
import { rectToWorld, type TerminalLayout } from '../layout';
import { plasticTexture } from '../textures/procedural';

// The room around the terminal (TERMINAL.md §3): a dark wall filling the view
// and, where the screen is wider than the terminal, pipes and a cable per side.

export interface ViewRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const WALL_Z = -1;
const PIPE_Z = -0.6;
/** Side width needed per pipe, world units. */
const PIPE_SPACING = 1.4;
const MAX_PIPES = 4;
const MIN_SIDE = 0.4;
const TEXTURE_TILE = 4;

export class Environment {
  readonly group = new THREE.Group();
  private readonly wallTexture = plasticTexture(7, 0x1a1b1d);
  private readonly wallMat = new THREE.MeshLambertMaterial({ map: this.wallTexture });
  private readonly pipeMat = new THREE.MeshLambertMaterial({ color: 0x2b2d30, flatShading: true });
  private readonly cableMat = new THREE.MeshLambertMaterial({ color: 0x5a2a1a, flatShading: true });
  private readonly geometries: THREE.BufferGeometry[] = [];

  build(layout: TerminalLayout, view: ViewRect): void {
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    this.group.clear();

    const w = view.right - view.left;
    const h = view.top - view.bottom;
    this.wallTexture.repeat.set(w / TEXTURE_TILE, h / TEXTURE_TILE);
    const wall = new THREE.Mesh(this.geometry(new THREE.PlaneGeometry(w * 1.2, h * 1.2)), this.wallMat);
    wall.position.set((view.left + view.right) / 2, (view.top + view.bottom) / 2, WALL_Z);
    this.group.add(wall);

    const body = rectToWorld(layout, layout.body);
    const sides = [
      { from: view.left, to: body.cx - body.w / 2 },
      { from: body.cx + body.w / 2, to: view.right },
    ];
    for (const side of sides) {
      const sw = side.to - side.from;
      if (sw < MIN_SIDE) continue;
      const pipes = Math.max(1, Math.min(MAX_PIPES, Math.floor(sw / PIPE_SPACING)));
      for (let i = 0; i < pipes; i++) {
        const x = side.from + (sw * (i + 0.5)) / pipes;
        const r = 0.18 + 0.08 * (i % 2);
        const pipe = new THREE.Mesh(this.geometry(new THREE.CylinderGeometry(r, r, h * 1.2, 6)), this.pipeMat);
        pipe.position.set(x, (view.top + view.bottom) / 2, PIPE_Z);
        this.group.add(pipe);
      }
      const cable = new THREE.Mesh(this.geometry(new THREE.CylinderGeometry(0.06, 0.06, h * 1.2, 5)), this.cableMat);
      cable.position.set(side.from + sw * 0.35, (view.top + view.bottom) / 2, PIPE_Z + 0.25);
      cable.rotation.z = Math.atan2(sw * 0.3, h);
      this.group.add(cable);
    }
  }

  private geometry<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }
}
