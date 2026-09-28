import * as THREE from 'three';
import { tuning } from '../../config/tuning';

// CRT glass shader (spec §5.3): barrel curvature, chroma bleed, aberration,
// phosphor mask, glow, scanlines, noise, vignette and event impulses. Applied
// only to the glass mesh, never to the cabinet.

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uScreen;
uniform sampler2D uHud;
uniform float uHudOn;
uniform vec2 uRes;
uniform float uScan;
uniform float uCurv;
uniform float uBleed;
uniform float uFlash;
uniform float uPhosphor;
uniform float uGlow;
uniform float uNoise;
uniform float uAberr;
uniform float uShake;
uniform float uTime;
uniform vec3 uEdge;
varying vec2 vUv;

vec2 curve(vec2 uv) {
  uv = uv * 2.0 - 1.0;
  vec2 off = abs(uv.yx) * uCurv;
  uv += uv * off * off * 4.0;
  return uv * 0.5 + 0.5;
}

const float HUD_SCAN = 0.3;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 px = 1.0 / uRes;
  // The picture shakes on a hit; the cabinet does not.
  vec2 uv = curve(vUv + vec2(sin(uTime * 90.0), cos(uTime * 71.0)) * uShake * px * 3.0);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    // Radial R/B separation, strongest at the edges of the tube.
    vec2 radial = (uv - 0.5) * uAberr;
    vec3 c = vec3(
      texture2D(uScreen, uv + radial * px).r,
      texture2D(uScreen, uv).g,
      texture2D(uScreen, uv - radial * px).b
    );

    vec3 blur = (texture2D(uScreen, uv - vec2(px.x, 0.0)).rgb + c + texture2D(uScreen, uv + vec2(px.x, 0.0)).rgb) / 3.0;
    vec3 bled = luma(c) + (blur - luma(blur));
    c = mix(c, bled, uBleed);

    // Phosphor bloom: a halo that never darkens what is already lit.
    vec2 g = px * 1.5;
    vec3 bloom = (
      texture2D(uScreen, uv + vec2(g.x, g.y)).rgb +
      texture2D(uScreen, uv + vec2(-g.x, g.y)).rgb +
      texture2D(uScreen, uv + vec2(g.x, -g.y)).rgb +
      texture2D(uScreen, uv + vec2(-g.x, -g.y)).rgb
    ) * 0.25;
    c = max(c, bloom * uGlow);

    float scan = 0.5 + 0.5 * cos(uv.y * uRes.y * 6.2831853);
    c *= 1.0 - uScan * (1.0 - scan);

    // RGB triads across the texel columns.
    float col3 = mod(floor(uv.x * uRes.x), 3.0);
    vec3 triad = vec3(col3 == 0.0 ? 1.0 : 0.55, col3 == 1.0 ? 1.0 : 0.55, col3 == 2.0 ? 1.0 : 0.55);
    c *= mix(vec3(1.0), triad, uPhosphor);

    // The HUD gets a lighter scanline and a lighter mask so thin pixel-font
    // strokes stay solid (BATTLE_VISUAL.md §10.2).
    vec4 hud = texture2D(uHud, uv);
    vec3 hudC = hud.rgb * (1.0 - HUD_SCAN * uScan * (1.0 - scan)) * mix(vec3(1.0), triad, uPhosphor * HUD_SCAN);
    c = mix(c, hudC, hud.a * uHudOn);

    // Weighted by what is lit: unweighted noise turns the black field into snow.
    c += (hash(uv * uRes + fract(uTime)) - 0.5) * uNoise * (0.3 + luma(c));

    vec2 v = uv * (1.0 - uv);
    c *= pow(clamp(v.x * v.y * 16.0, 0.0, 1.0), 0.15);
    // Hit glow along the edges of the tube, following its rectangle
    // (decision 2026-09-19): distance to the nearest edge, not to the centre.
    vec2 toEdge = min(uv, 1.0 - uv) * vec2(uRes.x / uRes.y, 1.0);
    float d = min(toEdge.x, toEdge.y);
    float rim = 1.0 - smoothstep(0.0, 0.07, d);
    c += uEdge * rim * rim;
    // Mostly multiplicative: a flat add would lift the black field to grey and
    // wash out the whole picture on every chip use.
    c = c * (1.15 + uFlash * 0.55) + uFlash * 0.06;
    gl_FragColor = vec4(c, 1.0);
  }
  #include <colorspace_fragment>
}`;

export class CrtMaterial extends THREE.ShaderMaterial {
  private flashLeft = 0;
  private shakeLeft = 0;
  private edgeLeft = 0;
  private readonly edgeColor = new THREE.Color(0, 0, 0);
  private time = 0;

  constructor() {
    super({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uScreen: { value: null },
        uHud: { value: null },
        uHudOn: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uScan: { value: 0 },
        uCurv: { value: 0 },
        uBleed: { value: 0 },
        uFlash: { value: 0 },
        uPhosphor: { value: 0 },
        uGlow: { value: 0 },
        uNoise: { value: 0 },
        uAberr: { value: 0 },
        uShake: { value: 0 },
        uTime: { value: 0 },
        uEdge: { value: new THREE.Vector3() },
      },
    });
  }

  setScreen(tex: THREE.Texture, w: number, h: number): void {
    this.uniforms.uScreen!.value = tex;
    (this.uniforms.uRes!.value as THREE.Vector2).set(w, h);
  }

  /** HUD layer drawn over the battle (before scanlines). */
  setHud(tex: THREE.Texture): void {
    this.uniforms.uHud!.value = tex;
    this.uniforms.uHudOn!.value = 1;
  }

  /** Starts a CRT_FLASH_TIME brightness flash. */
  flash(): void {
    this.flashLeft = tuning.terminal.CRT_FLASH_TIME;
  }

  /** Flashes the edges of the tube in `color` (hits); `strength` 0..1. */
  edgeFlash(color: number, strength: number): void {
    const c = new THREE.Color(color).multiplyScalar(strength);
    if (c.r + c.g + c.b < this.edgeColor.r * this.edgeLeftShare() * 3) return;
    this.edgeColor.copy(c);
    this.edgeLeft = EDGE_TIME;
  }

  private edgeLeftShare(): number {
    return this.edgeLeft / EDGE_TIME;
  }

  /** Starts the picture shake shown when the player is hit. */
  shake(): void {
    this.shakeLeft = SHAKE_TIME;
  }

  /** Copies tuning into uniforms and decays impulses. */
  update(dt: number): void {
    const t = tuning.terminal;
    this.time += dt;
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    this.shakeLeft = Math.max(0, this.shakeLeft - dt);
    this.edgeLeft = Math.max(0, this.edgeLeft - dt);
    const u = this.uniforms;
    const edge = this.edgeLeftShare() * this.edgeLeftShare();
    (u.uEdge!.value as THREE.Vector3).set(this.edgeColor.r * edge, this.edgeColor.g * edge, this.edgeColor.b * edge);
    u.uScan!.value = t.CRT_SCANLINES;
    u.uCurv!.value = t.CRT_CURVATURE;
    u.uBleed!.value = t.CRT_BLEED;
    u.uPhosphor!.value = t.CRT_PHOSPHOR;
    u.uGlow!.value = t.CRT_GLOW;
    u.uNoise!.value = t.CRT_NOISE;
    u.uAberr!.value = t.CRT_ABERRATION;
    u.uTime!.value = this.time;
    u.uFlash!.value = t.CRT_FLASH_TIME > 0 ? this.flashLeft / t.CRT_FLASH_TIME : 0;
    u.uShake!.value = t.CRT_SHAKE * (this.shakeLeft / SHAKE_TIME);
  }
}

/** How long a hit shakes the picture, seconds (spec §5.3). */
const SHAKE_TIME = 0.15;
/** How long an edge flash takes to fade, seconds. */
const EDGE_TIME = 0.3;
