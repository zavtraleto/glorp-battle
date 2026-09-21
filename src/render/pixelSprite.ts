import * as THREE from 'three';
import type { CreatureBitmap } from './creatureGen';
import { signal, type Role } from './palette';
import type { SpriteArt } from './spriteArt';
import {
  HologramSpriteMaterial,
  paddedSpriteMetrics,
} from './hologramMaterial';
import type { HologramCharacter } from './hologramConfig';

// Camera-facing sprite (BATTLE_VISUAL.md §2, §5), snapped to the CRT pixel
// grid, with a hit flash and a pixel dissolve. Procedural creatures are palette
// signals; hand-drawn art is full colour on its own render layer.

/** Render layer of full-colour art, drawn after the palette pass. */
export const ART_LAYER = 1;

export interface HologramSpriteIdentity {
  character: HologramCharacter;
  instanceId: number;
}

/**
 * Hit ripple (decision 2026-09-19): the texture is sampled with a wavy
 * sideways offset that dies out; `uRipple` 0..1 is its strength.
 */
function addRipple(material: THREE.SpriteMaterial, ripple: { value: number }, clock: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRipple = ripple;
    shader.uniforms.uRippleTime = clock;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uRipple;\nuniform float uRippleTime;\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec2 rippleUv = vMapUv;
  rippleUv.x += sin(vMapUv.y * 26.0 + uRippleTime * 55.0) * 0.045 * uRipple;
  vec4 sampledDiffuseColor = texture2D( map, rippleUv );
  diffuseColor *= sampledDiffuseColor;
#endif`,
      );
  };
}

/** Lifts are counted in steps of this many CRT pixels per 48 px of sprite height. */
const LIFT_STEP_HEIGHT = 48;

/**
 * Size in CRT pixels of a sprite `worldWidth` wide at `pxPerUnit`. It follows
 * the perspective continuously, so the figure grows and shrinks smoothly from
 * row to row instead of jumping by whole texel multiples [decision 2026-09-19]. Pure.
 */
export function spritePixels(worldWidth: number, pxPerUnit: number, texW: number, texH: number): { w: number; h: number } {
  const w = Math.max(1, Math.round(worldWidth * pxPerUnit));
  return { w, h: Math.max(1, Math.round((w * texH) / texW)) };
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
  private readonly hologram: HologramSpriteMaterial | null;
  private readonly texW: number;
  private readonly texH: number;
  private readonly ripple = { value: 0 };
  private readonly rippleClock = { value: 0 };
  /** Art textures are shared by every sprite that uses them. */
  private readonly ownsTextures: boolean;

  /** A procedural creature in `role`'s signal colour, or hand-drawn full-colour art. */
  constructor(source: CreatureBitmap | SpriteArt, role: Role, identity?: HologramSpriteIdentity) {
    if ('normal' in source) {
      if (!identity) throw new Error('PNG sprite art requires a hologram identity');
      this.normal = source.normal;
      this.flashed = source.flashed;
      this.ownsTextures = false;
    } else {
      const accent = signal('accent');
      this.normal = makeTexture(source, signal(role), accent);
      this.flashed = makeTexture(source, accent, accent);
      this.ownsTextures = true;
    }
    this.texW = source.w;
    this.texH = source.h;
    this.hologram = identity
      ? new HologramSpriteMaterial(this.normal, identity.character, identity.instanceId, this.texW, this.texH)
      : null;
    // Procedural palette signals stay opaque. PNG art needs blending only for its local halo/fragments.
    this.material = this.hologram ??
      new THREE.SpriteMaterial({
        map: this.normal,
        alphaTest: 0.5,
        transparent: false,
        depthTest: false,
        depthWrite: false,
      });
    if (!this.hologram) addRipple(this.material, this.ripple, this.rippleClock);
    this.sprite = new THREE.Sprite(this.material);
    // Feet on the anchor point.
    this.sprite.center.set(0.5, this.hologram ? paddedSpriteMetrics(1, 1).centerY : 0);
    if (!this.ownsTextures) this.sprite.layers.set(ART_LAYER);
  }

  setFlash(on: boolean): void {
    const map = on ? this.flashed : this.normal;
    if (this.material.map !== map) this.material.map = map;
  }

  /** Hit ripple strength 0..1; `seconds` drives the wave. */
  setRipple(k: number, seconds: number): void {
    const strength = Math.max(0, Math.min(1, k));
    if (this.hologram) this.hologram.setRipple(strength, seconds);
    else {
      this.ripple.value = strength;
      this.rippleClock.value = seconds;
    }
  }

  setTime(seconds: number): void {
    this.hologram?.setTime(seconds);
  }

  /** 0 = whole, 1 = gone. */
  setDissolve(k: number): void {
    if (this.hologram) this.hologram.setDissolve(k);
    else this.material.alphaTest = 0.5 + 0.5 * Math.max(0, Math.min(1, k));
  }

  /**
   * Places the sprite with its feet at `anchor`, `worldWidth` wide, snapped to
   * the CRT pixel grid and lifted by `liftTexels` steps.
   */
  place(anchor: THREE.Vector3, worldWidth: number, camera: THREE.PerspectiveCamera, w: number, h: number, liftTexels = 0): void {
    const depth = -tmp.copy(anchor).applyMatrix4(camera.matrixWorldInverse).z;
    if (depth <= camera.near) {
      this.sprite.visible = false;
      return;
    }
    this.sprite.visible = true;
    const pxPerUnit = h / (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const size = spritePixels(worldWidth, pxPerUnit, this.texW, this.texH);
    const widthPx = size.w;
    if (this.hologram) {
      const padded = paddedSpriteMetrics(widthPx / pxPerUnit, size.h / pxPerUnit);
      this.sprite.scale.set(padded.width, padded.height, 1);
      this.hologram.setVisualSize(size.w, size.h);
      this.hologram.syncConfig();
    } else {
      this.sprite.scale.set(widthPx / pxPerUnit, size.h / pxPerUnit, 1);
    }
    const liftStep = Math.max(1, Math.round(size.h / LIFT_STEP_HEIGHT));

    tmp.copy(anchor).project(camera);
    const sx = ((tmp.x + 1) / 2) * w;
    const sy = ((1 - tmp.y) / 2) * h;
    const snappedX = Math.round(sx - widthPx / 2) + widthPx / 2;
    const snappedY = Math.round(sy) - liftTexels * liftStep;
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    this.sprite.position
      .copy(anchor)
      .addScaledVector(right, (snappedX - sx) / pxPerUnit)
      .addScaledVector(up, -(snappedY - sy) / pxPerUnit);
  }

  dispose(): void {
    if (this.ownsTextures) {
      this.normal.dispose();
      this.flashed.dispose();
    }
    this.material.dispose();
  }
}
