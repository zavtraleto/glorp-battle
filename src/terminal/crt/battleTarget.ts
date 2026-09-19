import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import type { SceneRenderer } from '../../render/scene';
import type { World } from '../../sim/world';
import { PALETTE_COLORS } from '../../render/palette';

// Battle → CRT render target (TERMINAL.md §9.1). With CRT_GHOSTING > 0 a
// ping-pong pass keeps a decaying copy of previous frames (phosphor persistence).

const COMPOSE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Index + brightness → palette colour, dimmed toward the background by the
// brightness (spec §6.1). No dithering [decision 2026-09-19]: a faint line is a
// dimmer solid line. Mirrors paletteColor() in render/palette.ts (tested).
const PALETTE_COUNT = PALETTE_COLORS.length;
const PALETTE_FRAG = /* glsl */ `
uniform sampler2D uScene;
uniform vec3 uColors[${PALETTE_COUNT}];
varying vec2 vUv;
void main() {
  vec2 s = texture2D(uScene, vUv).rg;
  int index = int(floor(s.r * 255.0 + 0.5));
  vec3 c = uColors[0];
  for (int i = 1; i < ${PALETTE_COUNT}; i++) {
    if (i == index) c = mix(uColors[0], uColors[i], clamp(s.g, 0.0, 1.0));
  }
  gl_FragColor = vec4(c, 1.0);
}`;

const COMPOSE_FRAG = /* glsl */ `
uniform sampler2D uBattle;
uniform sampler2D uPrev;
uniform float uGhost;
varying vec2 vUv;
void main() {
  vec3 a = texture2D(uBattle, vUv).rgb;
  vec3 p = texture2D(uPrev, vUv).rgb * uGhost;
  gl_FragColor = vec4(max(a, p), 1.0);
}`;

function makeTarget(w: number, h: number, depth: boolean): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: depth,
  });
}

export class BattleTarget {
  private readonly battle = makeTarget(1, 1, true);
  private readonly paletted = makeTarget(1, 1, false);
  private readonly paletteMat = new THREE.ShaderMaterial({
    vertexShader: COMPOSE_VERT,
    fragmentShader: PALETTE_FRAG,
    uniforms: {
      uScene: { value: null },
      uColors: { value: PALETTE_COLORS.map((c) => new THREE.Color(c)) },
    },
    depthTest: false,
    depthWrite: false,
  });
  private readonly paletteScene = new THREE.Scene();
  private ghostA = makeTarget(1, 1, false);
  private ghostB = makeTarget(1, 1, false);
  private readonly composeScene = new THREE.Scene();
  private readonly composeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly composeMat = new THREE.ShaderMaterial({
    vertexShader: COMPOSE_VERT,
    fragmentShader: COMPOSE_FRAG,
    uniforms: {
      uBattle: { value: null },
      uPrev: { value: null },
      uGhost: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });

  constructor(private renderer: THREE.WebGLRenderer) {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composeMat);
    quad.frustumCulled = false;
    this.composeScene.add(quad);
    const pquad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.paletteMat);
    pquad.frustumCulled = false;
    this.paletteScene.add(pquad);
    this.setSize(tuning.terminal.CRT_RES_W, tuning.terminal.CRT_RES_H);
  }

  get width(): number {
    return this.battle.width;
  }

  get height(): number {
    return this.battle.height;
  }

  /** Estimated GPU memory of the owned targets, bytes. */
  get bytes(): number {
    // RGBA8 colour + 24-bit depth on the battle target; colour only on ghost targets.
    const px = this.width * this.height;
    return px * 4 + px * 3 + px * 4 + (tuning.terminal.CRT_GHOSTING > 0 ? 2 * px * 4 : 0);
  }

  /** Re-creates the targets' storage if the requested size changed. */
  setSize(w: number, h: number): void {
    const cw = Math.max(1, Math.round(w));
    const ch = Math.max(1, Math.round(h));
    if (cw === this.battle.width && ch === this.battle.height) return;
    this.battle.setSize(cw, ch);
    this.paletted.setSize(cw, ch);
    this.ghostA.setSize(cw, ch);
    this.ghostB.setSize(cw, ch);
  }

  /** Renders the battle (and ghosting when enabled); returns the texture to show on the CRT. */
  render(scene: SceneRenderer, world: World, alpha: number, dt: number): THREE.Texture {
    scene.renderInto(this.battle, world, alpha, dt);
    this.paletteMat.uniforms.uScene!.value = this.battle.texture;
    this.renderer.setRenderTarget(this.paletted);
    this.renderer.render(this.paletteScene, this.composeCamera);
    this.renderer.setRenderTarget(null);
    // Hand-drawn sprites keep their colours: they skip the palette pass.
    scene.renderArtInto(this.paletted);
    const ghost = tuning.terminal.CRT_GHOSTING;
    if (ghost <= 0) return this.paletted.texture;

    this.composeMat.uniforms.uBattle!.value = this.paletted.texture;
    this.composeMat.uniforms.uPrev!.value = this.ghostA.texture;
    this.composeMat.uniforms.uGhost!.value = ghost;
    this.renderer.setRenderTarget(this.ghostB);
    this.renderer.render(this.composeScene, this.composeCamera);
    this.renderer.setRenderTarget(null);
    const done = this.ghostB;
    this.ghostB = this.ghostA;
    this.ghostA = done;
    return done.texture;
  }

  dispose(): void {
    this.battle.dispose();
    this.paletted.dispose();
    this.paletteMat.dispose();
    this.ghostA.dispose();
    this.ghostB.dispose();
    this.composeMat.dispose();
  }
}
