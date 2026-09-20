import * as THREE from 'three';
import { tuning } from '../config/tuning';
import type { CreatureBitmap } from './creatureGen';
import { CELL_DEPTH } from './field';
import { reflectionFootprint } from './hologramMotion';
import { PALETTE, signal, type Role } from './palette';
import type { SpriteArt } from './spriteArt';

// Camera-facing sprite (BATTLE_VISUAL.md §2, §5), snapped to the CRT pixel
// grid, with a hit flash and a pixel dissolve. Procedural creatures are palette
// signals; hand-drawn art is full colour on its own render layer.

/** Render layer of full-colour art, drawn after the palette pass. */
export const ART_LAYER = 1;

/**
 * Hit ripple (decision 2026-09-19): the texture is sampled with a wavy
 * sideways offset that dies out; `uRipple` 0..1 is its strength.
 */
function addRipple(material: THREE.SpriteMaterial, ripple: { value: number }, clock: { value: number }, move: { value: number }, brightness: { value: number }, lean: { value: THREE.Vector2 }, art: boolean): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRipple = ripple;
    shader.uniforms.uRippleTime = clock;
    shader.uniforms.uHoloMove = move;
    shader.uniforms.uHoloBrightness = brightness;
    shader.uniforms.uHoloLean = lean;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform vec2 uHoloLean;\nvoid main() {')
      .replace('vec2 rotatedPosition;', 'alignedPosition.x += alignedPosition.y * uHoloLean.x;\n  alignedPosition.y *= 1.0 + uHoloLean.y;\n  vec2 rotatedPosition;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uRipple;\nuniform float uRippleTime;\nuniform float uHoloMove;\nuniform float uHoloBrightness;\nuniform vec2 uHoloLean;\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec2 rippleUv = vMapUv;
  rippleUv.x = 0.5 + (rippleUv.x - 0.5) * (1.0 + uHoloLean.y * (vMapUv.y - 0.5) * 1.7);
  rippleUv.x += sin(vMapUv.y * 26.0 + uRippleTime * 55.0) * 0.045 * uRipple;
  float row = floor(vMapUv.y * 62.0);
  float glitch = step(0.83, fract(sin(row * 71.7 + floor(uRippleTime * 40.0) * 13.1) * 43758.5));
  rippleUv.x += sin(row * 9.7 + uRippleTime * 64.0) * 0.075 * uHoloMove * glitch;
  vec4 sampledDiffuseColor = texture2D( map, rippleUv );
  diffuseColor *= sampledDiffuseColor;
  float filament = smoothstep(0.82, 0.98, abs(sin(vMapUv.y * 113.0 + sin(vMapUv.x * 21.0) * 0.55)));
  float bead = 0.72 + 0.28 * step(0.0, sin(vMapUv.x * 205.0 + uRippleTime * 5.0));
  float lineLight = filament * bead;
  ${art ? `vec3 baseColor = sampledDiffuseColor.rgb;
  float grey = dot(baseColor, vec3(0.299, 0.587, 0.114));
  vec3 codedColor = clamp(mix(vec3(grey), baseColor, 1.28), 0.0, 1.0);
  diffuseColor.rgb = clamp(codedColor * (uHoloBrightness * 0.30 + lineLight * (1.65 + 0.25 * uHoloMove)), 0.0, 1.0);
  float split = 0.012 * uHoloMove * glitch;
  diffuseColor.r = mix(diffuseColor.r, texture2D(map, rippleUv + vec2(split, 0.0)).r, 0.65 * uHoloMove);` : `diffuseColor.g = clamp(diffuseColor.g * (uHoloBrightness * 0.30 + lineLight * (1.65 + 0.25 * uHoloMove)), 0.0, 1.0);`}
#endif`,
      )
      .replace('#include <alphatest_fragment>', `diffuseColor.a *= 1.0 - uHoloMove * 0.72 * glitch;
#include <alphatest_fragment>`);
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

function haloColor(source: CreatureBitmap | SpriteArt, role: Role): THREE.Color {
  if (!('normal' in source)) return new THREE.Color(PALETTE[role]);
  const data = source.normal.image.data as Uint8Array;
  let r = 0, g = 0, b = 0, weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    const lo = Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
    const hi = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
    const w = Math.max(0, hi - lo - 20);
    r += data[i]! * w;
    g += data[i + 1]! * w;
    b += data[i + 2]! * w;
    weight += w;
  }
  if (weight === 0) return new THREE.Color(PALETTE[role]);
  const peak = Math.max(r, g, b);
  return new THREE.Color().setRGB(r / peak, g / peak, b / peak, THREE.LinearSRGBColorSpace);
}

function makeHalo(color: THREE.Color): { points: THREE.Points; material: THREE.ShaderMaterial } {
  const count = 28;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const h = ((i * 0.61803398875) % 1);
    positions[i * 3] = side * (0.48 + ((i * 0.37) % 1) * 0.14);
    positions[i * 3 + 1] = 0.04 + h * 0.97;
    seeds[i] = i * 1.731;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMotion: { value: 0 }, uColor: { value: color } },
    vertexShader: `attribute float aSeed;
uniform float uTime;
uniform float uMotion;
varying float vActive;
void main() {
  float beat = floor(uTime * 5.0 + aSeed * 2.0);
  float noise = fract(sin(beat * 17.13 + aSeed * 71.7) * 43758.5);
  vActive = step(0.87 - 0.08 * uMotion, noise) * step(0.02, uMotion);
  gl_PointSize = 1.5 + 1.5 * uMotion;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `uniform vec3 uColor;
varying float vActive;
void main() {
  if (vActive < 0.5) discard;
  gl_FragColor = vec4(uColor, 0.75);
}`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, material);
  points.layers.set(ART_LAYER);
  points.frustumCulled = false;
  return { points, material };
}

export class PixelSprite {
  readonly sprite: THREE.Sprite;
  readonly reflection: THREE.Mesh;
  readonly echo: THREE.Sprite;
  readonly halo: THREE.Points;
  private readonly normal: THREE.DataTexture;
  private readonly flashed: THREE.DataTexture;
  private readonly material: THREE.SpriteMaterial;
  private readonly texW: number;
  private readonly texH: number;
  private readonly ripple = { value: 0 };
  private readonly rippleClock = { value: 0 };
  private readonly holoMove = { value: 0 };
  private readonly holoBrightness = { value: 1 };
  private readonly holoLean = { value: new THREE.Vector2() };
  private readonly reflectionMaterial: THREE.MeshBasicMaterial;
  private readonly echoMaterial: THREE.SpriteMaterial;
  private readonly haloMaterial: THREE.ShaderMaterial;
  private readonly reflectionBounds = { start: 0, end: 0, center: 0, depth: 0 };
  /** Art textures are shared by every sprite that uses them. */
  private readonly ownsTextures: boolean;

  /** A procedural creature in `role`'s signal colour, or hand-drawn full-colour art. */
  constructor(source: CreatureBitmap | SpriteArt, role: Role) {
    if ('normal' in source) {
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
    // Opaque: alpha only drives the dissolve (alphaTest), never blending.
    this.material = new THREE.SpriteMaterial({
      map: this.normal,
      alphaTest: 0.5,
      transparent: false,
      depthTest: false,
      depthWrite: false,
    });
    addRipple(this.material, this.ripple, this.rippleClock, this.holoMove, this.holoBrightness, this.holoLean, !this.ownsTextures);
    this.sprite = new THREE.Sprite(this.material);
    // Feet on the anchor point.
    this.sprite.center.set(0.5, 0);
    if (!this.ownsTextures) this.sprite.layers.set(ART_LAYER);

    const reflectionGeometry = new THREE.PlaneGeometry(1, 1);
    const uv = reflectionGeometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.reflectionMaterial = new THREE.MeshBasicMaterial({
      map: this.ownsTextures ? null : this.normal,
      alphaMap: this.ownsTextures ? this.normal : null,
      color: this.ownsTextures ? PALETTE[role] : 0xffffff,
      transparent: true,
      opacity: tuning.battleVisual.HOLO_REFLECTION_OPACITY,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.reflectionMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec2 vReflectionUv;\nvoid main() {\n  vReflectionUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'varying vec2 vReflectionUv;\nvoid main() {')
        .replace('#include <alphatest_fragment>', `float scan = 0.20 + 0.80 * step(0.0, sin(gl_FragCoord.y * 3.1));
diffuseColor.a *= scan * smoothstep(0.0, 0.90, 1.0 - vReflectionUv.y);
#include <alphatest_fragment>`);
    };
    this.reflection = new THREE.Mesh(reflectionGeometry, this.reflectionMaterial);
    this.reflection.rotation.x = -Math.PI / 2;
    this.reflection.layers.set(ART_LAYER);
    this.reflection.renderOrder = 4;
    this.reflection.frustumCulled = false;
    this.echoMaterial = new THREE.SpriteMaterial({
      map: this.ownsTextures ? null : this.normal,
      alphaMap: this.ownsTextures ? this.normal : null,
      color: this.ownsTextures ? PALETTE[role] : 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    this.echo = new THREE.Sprite(this.echoMaterial);
    this.echo.center.set(0.5, 0);
    this.echo.layers.set(ART_LAYER);
    this.echo.visible = false;
    const halo = makeHalo(haloColor(source, role));
    this.halo = halo.points;
    this.haloMaterial = halo.material;
  }

  setFlash(on: boolean): void {
    const map = on ? this.flashed : this.normal;
    if (this.material.map !== map) this.material.map = map;
  }

  /** Hit ripple strength 0..1; `seconds` drives the wave. */
  setRipple(k: number, seconds: number): void {
    this.ripple.value = Math.max(0, Math.min(1, k));
    this.rippleClock.value = seconds;
  }

  /** Distortion and partial scan dropout while a hologram changes cells. */
  setHologram(move: number, seconds: number, leanX = 0, pitch = 0): void {
    this.holoMove.value = Math.max(0, Math.min(1, move));
    this.holoBrightness.value = tuning.battleVisual.HOLO_BRIGHTNESS;
    this.holoLean.value.set(leanX, pitch);
    this.rippleClock.value = seconds;
    this.reflectionMaterial.opacity = tuning.battleVisual.HOLO_REFLECTION_OPACITY * (1 - 0.35 * this.holoMove.value);
    this.haloMaterial.uniforms.uTime!.value = seconds;
    this.haloMaterial.uniforms.uMotion!.value = this.holoMove.value;
  }

  /** A faint copy remains behind the moving projection and vanishes on arrival. */
  setEcho(previous: THREE.Vector3, progress: number): void {
    const active = progress < 1 && this.sprite.visible;
    this.echo.visible = active;
    if (!active) return;
    this.echo.position.copy(this.sprite.position).lerp(previous, 0.45);
    this.echo.scale.copy(this.sprite.scale);
    this.echo.renderOrder = this.sprite.renderOrder - 0.1;
    this.echoMaterial.opacity = tuning.battleVisual.HOLO_ECHO_OPACITY * (1 - progress);
  }

  /** 0 = whole, 1 = gone. */
  setDissolve(k: number): void {
    this.material.alphaTest = 0.5 + 0.5 * Math.max(0, Math.min(1, k));
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
    this.sprite.scale.set(widthPx / pxPerUnit, size.h / pxPerUnit, 1);
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
    const footprint = reflectionFootprint(anchor.z, CELL_DEPTH, this.reflectionBounds);
    this.reflection.position.set(anchor.x, 0.012, footprint.center);
    this.reflection.scale.set(worldWidth * 0.80, footprint.depth, 1);
    this.reflection.visible = true;
    this.halo.position.copy(this.sprite.position);
    this.halo.quaternion.copy(camera.quaternion);
    this.halo.scale.set(this.sprite.scale.x, this.sprite.scale.y, 1);
    this.halo.visible = true;
  }

  dispose(): void {
    if (this.ownsTextures) {
      this.normal.dispose();
      this.flashed.dispose();
    }
    this.material.dispose();
    this.reflection.geometry.dispose();
    this.reflectionMaterial.dispose();
    this.echoMaterial.dispose();
    this.halo.geometry.dispose();
    this.haloMaterial.dispose();
  }
}
