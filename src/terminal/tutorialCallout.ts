import * as THREE from 'three';
import { BANNER_CAP, layoutBanner } from './bannerFont';
import { bannerGeometry, faceMaterial, smooth, wallMaterial, type BannerFrame } from './waveBanner';

// Tutorial callout (GDD §10.5, TERMINAL.md §8.2): the whole terminal dims, a
// big 3D word hangs over the CRT and a yellow line runs from it to a dot on the
// control to use. The dim leaves a hole around each target. Drawn over the
// terminal in two passes: a flat pass in render pixels (dim, lines, dots) and
// the banner's perspective pass for the word.

/** A control to point at, in render pixels (y up) with its radius. */
export interface CalloutPoint {
  x: number;
  y: number;
  r: number;
}

/** Yellow is the action colour (TERMINAL.md §4). */
const YELLOW = 0xffd45e;
const FACE = 0xfff1c2;
const WALL = 0xc79a2e;
const WALL_DARK = 0x5e4412;
/** Dim over the terminal, 0..1. */
const DIM = 0.7;
/** The hole around a target is this much wider than the target. */
const HOLE_PAD = 1.25;
/** Line and dot sizes, render pixels. */
const LINE_W = 3;
const DOT_R = 4;
const RING_R = 8;
const RING_W = 2;
/** The dot's ring breathes at this rate. */
const PULSE_HZ = 1.6;
/** Every word is sized as if it were this one, so all callouts share one letter height. */
const REFERENCE = 'SELECT TWO';
/** Share of the terminal body width the reference word spans. */
const WIDTH_SHARE = 0.8;
/** Where the word rests, as a share of the CRT height from its top. */
const REST_FROM_TOP = 0.28;
/** Pop-in time of the word, seconds. */
const POP_TIME = 0.18;
const SWAY_HZ = 0.6;
const SWAY_X = 0.5;
const SWAY_Y = 0.25;
const SWAY_YAW = 0.1;
const MAX_TARGETS = 2;

const DIM_VERT = 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const DIM_FRAG = `
  uniform vec3 uHoles[${MAX_TARGETS}];
  uniform float uDim;
  void main() {
    float a = uDim;
    for (int i = 0; i < ${MAX_TARGETS}; i++) {
      if (uHoles[i].z > 0.0 && distance(gl_FragCoord.xy, uHoles[i].xy) < uHoles[i].z) a = 0.0;
    }
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  }`;

export class TutorialCallout {
  /** Flat pass: 1 unit = 1 render pixel, origin bottom-left. */
  private readonly flat = new THREE.Scene();
  private readonly flatCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  /** The word, framed like the wave banner. */
  private readonly words = new THREE.Scene();
  private readonly wordCam = new THREE.PerspectiveCamera(30, 1, 1, 400);
  private readonly holes = Array.from({ length: MAX_TARGETS }, () => new THREE.Vector3());
  private readonly dimMat = new THREE.ShaderMaterial({
    uniforms: { uHoles: { value: this.holes }, uDim: { value: DIM } },
    vertexShader: DIM_VERT,
    fragmentShader: DIM_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private readonly dim = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.dimMat);
  // Transparent like the dim, so both are drawn in renderOrder: the dim first.
  private readonly yellow = new THREE.MeshBasicMaterial({ color: YELLOW, transparent: true, depthTest: false, depthWrite: false });
  private readonly lines: THREE.Mesh[] = [];
  private readonly dots: THREE.Mesh[] = [];
  private readonly rings: THREE.Mesh[] = [];
  private readonly materials = [faceMaterial(FACE, YELLOW), wallMaterial(WALL, WALL_DARK)];
  private readonly word = new THREE.Mesh(new THREE.BufferGeometry(), this.materials);
  private readonly pivot = new THREE.Group();
  private readonly refWidth = layoutBanner(REFERENCE).width;
  private text = '';
  private age = 0;
  private shown = false;

  constructor() {
    this.dim.renderOrder = 0;
    this.flat.add(this.dim);
    const line = new THREE.PlaneGeometry(1, 1);
    const dot = new THREE.CircleGeometry(DOT_R, 8);
    const ring = new THREE.RingGeometry(RING_R - RING_W, RING_R, 12);
    for (let i = 0; i < MAX_TARGETS; i++) {
      const l = new THREE.Mesh(line, this.yellow);
      const d = new THREE.Mesh(dot, this.yellow);
      const r = new THREE.Mesh(ring, this.yellow);
      for (const m of [l, d, r]) m.renderOrder = 1;
      this.lines.push(l);
      this.dots.push(d);
      this.rings.push(r);
      this.flat.add(l, d, r);
    }
    this.pivot.add(this.word);
    this.words.add(this.pivot);
  }

  get visible(): boolean {
    return this.shown;
  }

  /**
   * Places everything for this frame. `text` null hides the callout at once:
   * the battle is already running again.
   */
  update(
    dt: number,
    text: string | null,
    targets: readonly CalloutPoint[],
    arrows: boolean,
    f: BannerFrame,
    w: number,
    h: number,
  ): void {
    if (!text) {
      this.shown = false;
      this.text = '';
      return;
    }
    if (text !== this.text) {
      this.text = text;
      this.age = 0;
      this.word.geometry.dispose();
      this.word.geometry = bannerGeometry(text);
    }
    this.shown = true;
    this.age += dt;

    const cam = this.wordCam;
    const dist = 80;
    cam.aspect = f.aspect;
    const halfW = this.refWidth / 2 / (WIDTH_SHARE * Math.max(0.05, Math.min(1, f.bodyShare)));
    const halfH = halfW / f.aspect;
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfH / dist));
    cam.position.set(0, 0, dist);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    const phase = this.age * Math.PI * 2 * SWAY_HZ;
    const x = f.centerX * halfW;
    const y = (f.crtTop - f.crtHeight * REST_FROM_TOP) * halfH;
    this.pivot.position.set(x + Math.sin(phase) * SWAY_X, y - Math.abs(Math.cos(phase)) * SWAY_Y, 0);
    this.pivot.rotation.set(0, Math.sin(phase) * SWAY_YAW, 0);
    // Pops in a size bigger and settles.
    this.pivot.scale.setScalar(1 + 0.35 * (1 - smooth(this.age / POP_TIME)));

    this.flatCam.right = w;
    this.flatCam.top = h;
    this.flatCam.updateProjectionMatrix();
    this.dim.position.set(w / 2, h / 2, 0);
    this.dim.scale.set(w, h, 1);

    // The line leaves from under the word (its extrusion hangs down-left).
    const sx = ((x / halfW + 1) / 2) * w;
    const sy = (((y - BANNER_CAP * 0.75) / halfH + 1) / 2) * h;
    const pulse = 1 + 0.25 * Math.sin(this.age * Math.PI * 2 * PULSE_HZ);
    for (let i = 0; i < MAX_TARGETS; i++) {
      const t = targets[i];
      const on = !!t && arrows;
      this.lines[i]!.visible = on;
      this.dots[i]!.visible = on;
      this.rings[i]!.visible = on;
      this.holes[i]!.set(t?.x ?? 0, t?.y ?? 0, t ? t.r * HOLE_PAD : 0);
      if (!t) continue;
      const dx = t.x - sx;
      const dy = t.y - sy;
      const len = Math.max(0, Math.hypot(dx, dy) - RING_R);
      const line = this.lines[i]!;
      line.position.set(sx + (dx / (Math.hypot(dx, dy) || 1)) * len / 2, sy + (dy / (Math.hypot(dx, dy) || 1)) * len / 2, 0);
      line.rotation.z = Math.atan2(dy, dx);
      line.scale.set(len, LINE_W, 1);
      this.dots[i]!.position.set(t.x, t.y, 0);
      this.rings[i]!.position.set(t.x, t.y, 0);
      this.rings[i]!.scale.setScalar(pulse);
    }
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.shown) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.flat, this.flatCam);
    renderer.clearDepth();
    renderer.render(this.words, this.wordCam);
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.word.geometry.dispose();
    for (const m of this.materials) m.dispose();
    this.dim.geometry.dispose();
    this.dimMat.dispose();
    this.yellow.dispose();
    this.lines[0]?.geometry.dispose();
    this.dots[0]?.geometry.dispose();
    this.rings[0]?.geometry.dispose();
  }
}
