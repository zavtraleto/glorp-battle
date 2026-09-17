import * as THREE from 'three';
import { tuning } from '../../config/tuning';

// CRT glass shader (TERMINAL.md §9.2): barrel curvature, chroma bleed,
// scanlines, vignette and event impulses. Applied only to the glass mesh.

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
varying vec2 vUv;

vec2 curve(vec2 uv) {
  uv = uv * 2.0 - 1.0;
  vec2 off = abs(uv.yx) * uCurv;
  uv += uv * off * off * 4.0;
  return uv * 0.5 + 0.5;
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 uv = curve(vUv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    vec2 px = 1.0 / uRes;
    vec3 c = texture2D(uScreen, uv).rgb;
    vec3 blur = (texture2D(uScreen, uv - vec2(px.x, 0.0)).rgb + c + texture2D(uScreen, uv + vec2(px.x, 0.0)).rgb) / 3.0;
    vec3 bled = luma(c) + (blur - luma(blur));
    c = mix(c, bled, uBleed);
    vec4 hud = texture2D(uHud, uv);
    c = mix(c, hud.rgb, hud.a * uHudOn);
    float scan = 0.5 + 0.5 * cos(uv.y * uRes.y * 6.2831853);
    c *= 1.0 - uScan * (1.0 - scan);
    vec2 v = uv * (1.0 - uv);
    c *= pow(clamp(v.x * v.y * 16.0, 0.0, 1.0), 0.15);
    c = c * 1.15 + uFlash * 0.35;
    gl_FragColor = vec4(c, 1.0);
  }
  #include <colorspace_fragment>
}`;

export class CrtMaterial extends THREE.ShaderMaterial {
  private flashLeft = 0;

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

  /** Copies tuning into uniforms and decays impulses. */
  update(dt: number): void {
    const t = tuning.terminal;
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    this.uniforms.uScan!.value = t.CRT_SCANLINES;
    this.uniforms.uCurv!.value = t.CRT_CURVATURE;
    this.uniforms.uBleed!.value = t.CRT_BLEED;
    this.uniforms.uFlash!.value = t.CRT_FLASH_TIME > 0 ? this.flashLeft / t.CRT_FLASH_TIME : 0;
  }
}
