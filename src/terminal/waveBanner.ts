import * as THREE from 'three';
import { BANNER_CAP, layoutBanner } from './bannerFont';

// "Wave N" banner (GDD §10.4, TERMINAL.md §8.1): a heavy block face cast into
// solid letters with an oblique extrusion down-left, a hatched light front and
// dark sides. Drawn over the whole terminal; drops in from the top, sways like
// a Quake III weapon and flies back up.

/** Extrusion depth and its 45° oblique slant (per unit of depth, down-left). */
const DEPTH = 1.5;
const SLANT = 0.75;
/** Share of the terminal body width the text spans. */
const WIDTH_SHARE = 0.66;
/** Where the text rests, as a share of the CRT height from its top. */
const REST_FROM_TOP = 0.3;
/** Share of the life spent dropping in and flying out. */
const ENTER = 0.3;
const EXIT = 0.22;
/** Sway: figure-eight bob (font units) and pitch/yaw (radians) at this rate. */
const SWAY_HZ = 0.7;
const SWAY_X = 0.9;
const SWAY_Y = 0.45;
const SWAY_YAW = 0.14;
const SWAY_PITCH = 0.08;
/** Colours: hatched light front, darker left walls, darkest bottom walls. */
const FACE = 0xe8fff9;
const HATCH = 0x3cffd2;
const WALL = 0x1f9c80;
const WALL_DARK = 0x0b4a3d;
/** Hatch period in render pixels: one line every HATCH_PX rows. */
const HATCH_PX = 3;

/** Extruded, slanted geometry of `text`, centred on the origin (x right, y up, front face at z = 0). */
export function bannerGeometry(text: string): THREE.BufferGeometry {
  const { width, glyphs } = layoutBanner(text);
  const shapes: THREE.Shape[] = [];
  for (const { glyph, x } of glyphs) {
    for (const part of glyph.shapes) {
      const shape = new THREE.Shape(part.outline.map(([px, py]) => new THREE.Vector2(px + x, py)));
      for (const hole of part.holes ?? []) {
        shape.holes.push(new THREE.Path(hole.map(([px, py]) => new THREE.Vector2(px + x, py))));
      }
      shapes.push(shape);
    }
  }
  const geometry = new THREE.ExtrudeGeometry(shapes, { depth: DEPTH, bevelEnabled: false, curveSegments: 1 });
  // Front cap at z = 0, back at -DEPTH; the back slides down-left (oblique projection).
  geometry.translate(-width / 2, -BANNER_CAP / 2, -DEPTH);
  const shear = new THREE.Matrix4().set(
    1, 0, SLANT, 0,
    0, 1, SLANT, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
  geometry.applyMatrix4(shear);
  return geometry;
}

function faceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uFace: { value: new THREE.Color(FACE) }, uHatch: { value: new THREE.Color(HATCH) } },
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 uFace;
      uniform vec3 uHatch;
      void main() {
        float line = mod(floor(gl_FragCoord.y), ${HATCH_PX.toFixed(1)});
        gl_FragColor = vec4(line < 1.0 ? uHatch : uFace, 1.0);
      }`,
  });
}

function wallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uWall: { value: new THREE.Color(WALL) }, uDark: { value: new THREE.Color(WALL_DARK) } },
    vertexShader: `
      varying float vDown;
      void main() {
        vDown = step(0.5, -normalize(normal).y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uWall;
      uniform vec3 uDark;
      varying float vDown;
      void main() { gl_FragColor = vec4(mix(uWall, uDark, vDown), 1.0); }`,
  });
}

function smooth(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}

/** Where the banner sits on the canvas (NDC) and the terminal body's share of the canvas width. */
export interface BannerFrame {
  aspect: number;
  centerX: number;
  /** Top edge of the CRT and its height, NDC. */
  crtTop: number;
  crtHeight: number;
  bodyShare: number;
}

export class WaveBanner {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 1, 400);
  // ExtrudeGeometry groups: 0 = caps, 1 = side walls.
  private readonly materials = [faceMaterial(), wallMaterial()];
  private readonly mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.materials);
  private readonly pivot = new THREE.Group();
  private text = '';
  private textWidth = 1;
  private age = 0;
  private life = 0;

  constructor() {
    this.pivot.add(this.mesh);
    this.scene.add(this.pivot);
    this.pivot.visible = false;
  }

  get visible(): boolean {
    return this.pivot.visible;
  }

  /** Starts the banner; it lives `seconds` of real time. */
  show(text: string, seconds: number): void {
    if (text !== this.text) {
      this.text = text;
      this.mesh.geometry.dispose();
      this.mesh.geometry = bannerGeometry(text);
      this.textWidth = Math.max(1, layoutBanner(text).width);
    }
    this.age = 0;
    this.life = Math.max(0.1, seconds);
    this.pivot.visible = true;
  }

  hide(): void {
    this.pivot.visible = false;
  }

  update(dt: number, f: BannerFrame): void {
    if (!this.pivot.visible) return;
    this.age += dt;
    const t = this.age / this.life;
    if (t >= 1) {
      this.pivot.visible = false;
      return;
    }
    // Frame the text: it spans WIDTH_SHARE of the body width at z = 0.
    const dist = 80;
    const cam = this.camera;
    cam.aspect = f.aspect;
    const halfW = this.textWidth / 2 / (WIDTH_SHARE * Math.max(0.05, Math.min(1, f.bodyShare)));
    const halfH = halfW / f.aspect;
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfH / dist));
    cam.position.set(0, 0, dist);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();

    const enter = smooth(t / ENTER);
    const exit = smooth((t - (1 - EXIT)) / EXIT);
    const phase = this.age * Math.PI * 2 * SWAY_HZ;
    // Rest in the upper part of the CRT; drop in from above the canvas, fly back out.
    const restY = (f.crtTop - f.crtHeight * REST_FROM_TOP) * halfH;
    const offY = halfH + BANNER_CAP * 1.5;
    const y = restY + (1 - enter) * (offY - restY) + exit * (offY - restY);
    // Weapon sway: sideways swing with a double-rate dip, turning into the swing.
    this.pivot.position.set(
      f.centerX * halfW + Math.sin(phase) * SWAY_X,
      y - Math.abs(Math.cos(phase)) * SWAY_Y,
      0,
    );
    this.pivot.rotation.set(
      Math.cos(phase * 2) * SWAY_PITCH - (1 - enter) * 0.35 + exit * 0.35,
      Math.sin(phase) * SWAY_YAW,
      -Math.sin(phase) * SWAY_YAW * 0.3,
    );
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
