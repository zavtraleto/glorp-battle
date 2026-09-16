import * as THREE from 'three';
import { COLS, ROWS, sideOfRow } from '../sim/grid';
import { makeLabelTexture } from './sprites';

// World layout: 1 unit wide cells, CELL_DEPTH deep; x grows right, row y maps to +z (toward camera).
export const CELL_WIDTH = 1;
export const CELL_DEPTH = 0.78;

const COLORS = {
  player: { fill: 0xd8433f, edge: 0x7a1d1b },
  enemy: { fill: 0x3f6fd8, edge: 0x1b2f7a },
  base: 0x1a1f2b,
};

/** Center of a logical cell in world space (on the panel surface). */
export function cellToWorld(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set((x - (COLS - 1) / 2) * CELL_WIDTH, 0, (y - (ROWS - 1) / 2) * CELL_DEPTH);
}

export class FieldView {
  readonly group = new THREE.Group();
  private readonly labels = new THREE.Group();
  /** Telegraph overlays, one per cell, indexed y * COLS + x. */
  private readonly danger: THREE.Mesh[] = [];
  private readonly dangerMat = new THREE.MeshBasicMaterial({
    color: 0xffd23f,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  /** Bounds used for camera fitting; includes headroom for character sprites. */
  readonly bounds: THREE.Box3;

  constructor(gap: number) {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(COLS * CELL_WIDTH + 0.2, 0.2, ROWS * CELL_DEPTH + 0.2),
      new THREE.MeshBasicMaterial({ color: COLORS.base }),
    );
    base.position.y = -0.11;
    this.group.add(base);

    const panelGeo = new THREE.PlaneGeometry(CELL_WIDTH - gap, CELL_DEPTH - gap);
    const innerGeo = new THREE.PlaneGeometry((CELL_WIDTH - gap) * 0.84, (CELL_DEPTH - gap) * 0.78);
    const mats = {
      player: {
        edge: new THREE.MeshBasicMaterial({ color: COLORS.player.edge }),
        fill: new THREE.MeshBasicMaterial({ color: COLORS.player.fill }),
      },
      enemy: {
        edge: new THREE.MeshBasicMaterial({ color: COLORS.enemy.edge }),
        fill: new THREE.MeshBasicMaterial({ color: COLORS.enemy.fill }),
      },
    };

    const p = new THREE.Vector3();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const side = sideOfRow(y);
        cellToWorld(x, y, p);
        const edge = new THREE.Mesh(panelGeo, mats[side].edge);
        edge.rotation.x = -Math.PI / 2;
        edge.position.copy(p);
        const fill = new THREE.Mesh(innerGeo, mats[side].fill);
        fill.rotation.x = -Math.PI / 2;
        fill.position.set(p.x, 0.005, p.z);
        this.group.add(edge, fill);

        const label = new THREE.Mesh(
          new THREE.PlaneGeometry(0.45, 0.45),
          new THREE.MeshBasicMaterial({
            map: makeLabelTexture(`${x},${y}`, { size: 96, font: 'bold 34px monospace' }),
            transparent: true,
            depthWrite: false,
          }),
        );
        label.rotation.x = -Math.PI / 2;
        label.position.set(p.x, 0.01, p.z);
        this.labels.add(label);

        const warn = new THREE.Mesh(innerGeo, this.dangerMat);
        warn.rotation.x = -Math.PI / 2;
        warn.position.set(p.x, 0.008, p.z);
        warn.visible = false;
        this.danger.push(warn);
        this.group.add(warn);
      }
    }
    this.labels.visible = false;
    this.group.add(this.labels);

    const halfW = (COLS * CELL_WIDTH) / 2 + 0.1;
    const halfD = (ROWS * CELL_DEPTH) / 2 + 0.1;
    this.bounds = new THREE.Box3(new THREE.Vector3(-halfW, 0, -halfD), new THREE.Vector3(halfW, 1.1, halfD));
  }

  /** Shows the telegraph overlay on the given cells; `pulse` in [0,1] animates it. */
  setDanger(cells: readonly { x: number; y: number }[], pulse: number): void {
    for (const m of this.danger) m.visible = false;
    for (const c of cells) {
      const m = this.danger[c.y * COLS + c.x];
      if (m) m.visible = true;
    }
    this.dangerMat.opacity = 0.35 + 0.35 * pulse;
  }

  setCoordsVisible(visible: boolean): void {
    this.labels.visible = visible;
  }
}
