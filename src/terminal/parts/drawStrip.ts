import * as THREE from 'three';
import { CHIP_ICONS, ICON_PALETTE } from '../chips/chipIcons';
import { codeColor } from '../chips/codeColor';
import { rectToWorld, type TerminalLayout } from '../layout';
import type { ChipCode, ChipId } from '../../data/chips';

// Draw queue strip (spec §11.3): the next chips of the folder, shown small and
// dim under the rail. It is a hint for planning, not an organ — it takes no
// taps and is deliberately quieter than the hand above it.

const ICON_PX = 16;
const TEX_PX = 20;
/** Everything here is dimmer than the hand, on purpose. */
const TINT = 0.55;

const cache = new Map<string, THREE.CanvasTexture>();

/** Small icon tile for one chip: the pixel icon over its code colour. */
function tile(defId: ChipId, code: ChipCode): THREE.CanvasTexture {
  const key = `${defId}:${code}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = TEX_PX;
  canvas.height = TEX_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = '#0c1014';
  ctx.fillRect(0, 0, TEX_PX, TEX_PX);
  ctx.fillStyle = codeColor(code);
  ctx.fillRect(0, TEX_PX - 2, TEX_PX, 2);
  const off = (TEX_PX - ICON_PX) / 2;
  CHIP_ICONS[defId].forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = ICON_PALETTE[row[x] as string];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(off + x, off + y - 1, 1, 1);
    }
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  cache.set(key, tex);
  return tex;
}

export interface DrawChip {
  defId: ChipId;
  code: ChipCode;
}

export class DrawStrip {
  readonly group = new THREE.Group();
  private readonly plane = new THREE.PlaneGeometry(1, 1);
  private readonly tiles: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  private shown = '';
  private size = 0;
  private x0 = 0;
  private pitch = 0;
  private y = 0;

  /** Places the strip; `count` is how many chips it can show. */
  build(layout: TerminalLayout, count: number): void {
    for (const t of this.tiles) {
      t.mat.dispose();
      this.group.remove(t.mesh);
    }
    this.tiles.length = 0;
    this.shown = '';

    const r = rectToWorld(layout, layout.draw);
    this.size = r.h * 0.78;
    this.pitch = this.size * 1.35;
    this.x0 = r.cx - (this.pitch * (count - 1)) / 2;
    this.y = r.cy;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: TINT });
      const mesh = new THREE.Mesh(this.plane, mat);
      mesh.scale.set(this.size, this.size, 1);
      mesh.position.set(this.x0 + i * this.pitch, this.y, 0.04);
      mesh.visible = false;
      this.group.add(mesh);
      this.tiles.push({ mesh, mat });
    }
  }

  /** Shows the next chips of the draw queue; fewer than the strip holds is fine. */
  set(chips: readonly DrawChip[]): void {
    const key = chips.map((c) => `${c.defId}${c.code}`).join(',');
    if (key === this.shown) return;
    this.shown = key;
    this.tiles.forEach((t, i) => {
      const chip = chips[i];
      t.mesh.visible = chip !== undefined;
      if (chip) t.mat.map = tile(chip.defId, chip.code);
    });
  }
}
