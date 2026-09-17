import * as THREE from 'three';
import type { CreatureBitmap } from './creatureGen';
import { signal, type Role } from './palette';

// Camera-facing pixel sprite (BATTLE_VISUAL.md §2, §5): whole-pixel texels,
// snapped to the CRT pixel grid, with a hit flash and a pixel dissolve.

/** Texel size in CRT pixels for a sprite that should be `worldWidth` wide. Pure. */
export function texelScale(worldWidth: number, pxPerUnit: number, texels: number): number {
  return Math.max(1, Math.round((worldWidth * pxPerUnit) / texels));
}

/** Stable per-pixel noise in [0, 1) for the dissolve order. */
function noise(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Alpha of drawn texels: all above 0.5, spread so the dissolve eats them in a noisy order. */
function alphaOf(x: number, y: number): number {
  return 130 + Math.floor(noise(x, y) * 125);
}

function makeTexture(b: CreatureBitmap, body: THREE.Color, accent: THREE.Color): THREE.DataTexture {
  const data = new Uint8Array(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const p = b.px[y * b.w + x];
      if (!p) continue;
      const c = p === 2 ? accent : body;
      // DataTexture rows start at the bottom.
      const i = ((b.h - 1 - y) * b.w + x) * 4;
      data[i] = Math.round(c.r * 255);
      data[i + 1] = Math.round(c.g * 255);
      data[i + 2] = Math.round(c.b * 255);
      data[i + 3] = alphaOf(x, y);
    }
  }
  const tex = new THREE.DataTexture(data, b.w, b.h, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const tmp = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();

export class PixelSprite {
  readonly sprite: THREE.Sprite;
  private readonly normal: THREE.DataTexture;
  private readonly flashed: THREE.DataTexture;
  private readonly material: THREE.SpriteMaterial;

  constructor(
    private readonly bitmap: CreatureBitmap,
    role: Role,
  ) {
    const accent = signal('accent');
    this.normal = makeTexture(bitmap, signal(role), accent);
    this.flashed = makeTexture(bitmap, accent, accent);
    // Opaque: alpha only drives the dissolve (alphaTest), never blending.
    this.material = new THREE.SpriteMaterial({
      map: this.normal,
      alphaTest: 0.5,
      transparent: false,
      depthTest: false,
      depthWrite: false,
    });
    this.sprite = new THREE.Sprite(this.material);
    // Feet on the anchor point.
    this.sprite.center.set(0.5, 0);
  }

  setFlash(on: boolean): void {
    const map = on ? this.flashed : this.normal;
    if (this.material.map !== map) this.material.map = map;
  }

  /** 0 = whole, 1 = gone. */
  setDissolve(k: number): void {
    this.material.alphaTest = 0.5 + 0.5 * Math.max(0, Math.min(1, k));
  }

  /**
   * Places the sprite with its feet at `anchor`, `worldWidth` wide, texels as
   * whole CRT pixels, snapped to the pixel grid and lifted by `liftTexels`.
   */
  place(anchor: THREE.Vector3, worldWidth: number, camera: THREE.PerspectiveCamera, w: number, h: number, liftTexels = 0): void {
    const depth = -tmp.copy(anchor).applyMatrix4(camera.matrixWorldInverse).z;
    if (depth <= camera.near) {
      this.sprite.visible = false;
      return;
    }
    this.sprite.visible = true;
    const pxPerUnit = h / (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const n = texelScale(worldWidth, pxPerUnit, this.bitmap.w);
    const widthPx = n * this.bitmap.w;
    this.sprite.scale.set(widthPx / pxPerUnit, (n * this.bitmap.h) / pxPerUnit, 1);

    tmp.copy(anchor).project(camera);
    const sx = ((tmp.x + 1) / 2) * w;
    const sy = ((1 - tmp.y) / 2) * h;
    const snappedX = Math.round(sx - widthPx / 2) + widthPx / 2;
    const snappedY = Math.round(sy) - liftTexels * n;
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    this.sprite.position
      .copy(anchor)
      .addScaledVector(right, (snappedX - sx) / pxPerUnit)
      .addScaledVector(up, -(snappedY - sy) / pxPerUnit);
  }

  dispose(): void {
    this.normal.dispose();
    this.flashed.dispose();
    this.material.dispose();
  }
}
