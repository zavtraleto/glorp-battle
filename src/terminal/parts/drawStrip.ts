import * as THREE from 'three';
import { CHIP_ICONS, ICON_PALETTE } from '../chips/chipIcons';
import { codeColor } from '../chips/codeColor';
import { RAIL_LEFT } from '../chips/railLayout';
import { rectToWorld, type TerminalLayout } from '../layout';
import type { ChipCode, ChipId } from '../../data/chips';

// Draw queue strip (spec §11.3): the next chips of the folder, small, at the
// left end of the row under the rail.
// tile lights up in its code colour for every chip spent since the last one,
// so when all are lit they are about to drop into the hand (GDD §5).

const ICON_PX = 16;
const TEX_PX = 20;
/** Unlit tiles are dim: a hint, quieter than the hand above. */
const TINT_OFF = 0.4;
/** Halo around a lit tile, as a share of the tile size. */
const HALO = 2.1;
const HALO_OPACITY = 0.9;
/** Lit tiles fade in and out at this rate, 1/s. */
const LIGHT_RATE = 14;

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

let glowTex: THREE.CanvasTexture | null = null;

/** Soft round glow, white; the halo material tints it with the code colour. */
function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTex = new THREE.CanvasTexture(canvas);
  return glowTex;
}

export interface DrawChip {
  defId: ChipId;
  code: ChipCode;
}

interface Tile {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  halo: THREE.Mesh;
  haloMat: THREE.MeshBasicMaterial;
  light: number;
}

export class DrawStrip {
  readonly group = new THREE.Group();
  private readonly plane = new THREE.PlaneGeometry(1, 1);
  private readonly tiles: Tile[] = [];
  private shown = '';
  private lit = 0;
  /** Right edge of the last tile, world x: the display to the right starts after it. */
  right = 0;

  /** Places the strip at the left end of the rail row; `count` is how many chips it can show. */
  build(layout: TerminalLayout, count: number): void {
    for (const t of this.tiles) {
      t.mat.dispose();
      t.haloMat.dispose();
      this.group.remove(t.mesh, t.halo);
    }
    this.tiles.length = 0;
    this.shown = '';

    const r = rectToWorld(layout, layout.draw);
    const rail = rectToWorld(layout, layout.rail);
    const size = r.h * 0.78;
    const pitch = size * 1.35;
    const x0 = rail.cx - rail.w * RAIL_LEFT + size / 2;
    for (let i = 0; i < count; i++) {
      const x = x0 + i * pitch;
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: TINT_OFF });
      const mesh = new THREE.Mesh(this.plane, mat);
      mesh.scale.set(size, size, 1);
      mesh.position.set(x, r.cy, 0.04);
      mesh.visible = false;
      const haloMat = new THREE.MeshBasicMaterial({
        map: glowTexture(),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const halo = new THREE.Mesh(this.plane, haloMat);
      halo.scale.set(size * HALO, size * HALO, 1);
      halo.position.set(x, r.cy, 0.03);
      halo.visible = false;
      this.group.add(halo, mesh);
      this.tiles.push({ mesh, mat, halo, haloMat, light: 0 });
    }
    this.right = x0 + (count - 1) * pitch + size / 2;
  }

  /**
   * Shows the next chips of the draw queue; `lit` of them glow, one per chip
   * highlighted by the caller. Fewer chips than the strip holds is fine.
   */
  set(chips: readonly DrawChip[], lit: number): void {
    this.lit = lit;
    const key = chips.map((c) => `${c.defId}${c.code}`).join(',');
    if (key === this.shown) return;
    this.shown = key;
    this.tiles.forEach((t, i) => {
      const chip = chips[i];
      t.mesh.visible = chip !== undefined;
      t.halo.visible = chip !== undefined;
      if (chip) {
        t.mat.map = tile(chip.defId, chip.code);
        t.mat.needsUpdate = true;
        t.haloMat.color.set(codeColor(chip.code));
      }
    });
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * LIGHT_RATE);
    this.tiles.forEach((t, i) => {
      t.light += ((i < this.lit ? 1 : 0) - t.light) * k;
      t.mat.opacity = TINT_OFF + (1 - TINT_OFF) * t.light;
      t.haloMat.opacity = HALO_OPACITY * t.light;
    });
  }
}
