import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { tuning } from '../../config/tuning';
import { rectToWorld, type TerminalLayout } from '../layout';
import { PressKey } from './pressKey';

// Physical keys of the terminal (TERMINAL.md §5.2–5.4): EXECUTE, CHIP SELECT
// with the custom gauge LED ring, and the pause key. Chunky PS1 shapes.

export type DeckKey = 'execute' | 'chipSelect' | 'pause';

const GAUGE_LEDS = 12;
const DENY_BLINK_HZ = 8;

const COLOR = {
  frame: 0x1c1d1f,
  execute: new THREE.Color(0xb8322a),
  executeDim: new THREE.Color(0x4a1512),
  select: new THREE.Color(0xc99a2e),
  selectGlow: new THREE.Color(0xffcf4a),
  pause: 0x2a2b2e,
  screw: 0x8a8578,
  ledOn: new THREE.Color(0x55ff66),
  ledOff: new THREE.Color(0x1a241a),
  ledDenied: new THREE.Color(0xff3b30),
  icon: '#2a1d08',
  pauseIcon: '#d8cfae',
};

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Yellow/black hazard stripes. */
function hazardTexture(): THREE.CanvasTexture {
  return canvasTexture(16, (ctx) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        ctx.fillStyle = Math.floor((x + y) / 4) % 2 === 0 ? '#d9a61e' : '#141414';
        ctx.fillRect(x, y, 1, 1);
      }
  });
}

/** Stack-of-chips pictogram for CHIP SELECT. */
function chipsIcon(): THREE.CanvasTexture {
  return canvasTexture(16, (ctx) => {
    ctx.fillStyle = COLOR.icon;
    for (const [x, y] of [[2, 5], [5, 3], [8, 1]] as const) {
      ctx.fillRect(x, y, 6, 10);
      ctx.clearRect(x + 1, y + 1, 4, 8);
      ctx.fillRect(x + 2, y + 2, 2, 2);
    }
  });
}

function pauseIcon(): THREE.CanvasTexture {
  return canvasTexture(8, (ctx) => {
    ctx.fillStyle = COLOR.pauseIcon;
    ctx.fillRect(1, 1, 2, 6);
    ctx.fillRect(5, 1, 2, 6);
  });
}

export class DeckControls {
  readonly group = new THREE.Group();
  private readonly keys: Record<DeckKey, PressKey>;
  private readonly executeMat = new THREE.MeshLambertMaterial({ color: COLOR.execute.clone() });
  private readonly selectMat = new THREE.MeshLambertMaterial({ color: COLOR.select.clone(), emissive: 0x000000 });
  private readonly frameMat = new THREE.MeshLambertMaterial({ color: COLOR.frame, flatShading: true });
  private readonly hazardMat = new THREE.MeshLambertMaterial({ map: hazardTexture() });
  private readonly pauseMat = new THREE.MeshLambertMaterial({ color: COLOR.pause });
  private readonly iconMat = new THREE.MeshBasicMaterial({ map: chipsIcon(), transparent: true, depthWrite: false });
  private readonly pauseIconMat = new THREE.MeshBasicMaterial({ map: pauseIcon(), transparent: true, depthWrite: false });
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly capGeo = new RoundedBoxGeometry(1, 1, 1, 1, 0.12);
  private readonly unitPlane = new THREE.PlaneGeometry(1, 1);
  private readonly ledGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
  private readonly screwGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
  private readonly ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private readonly screwMat = new THREE.MeshLambertMaterial({ color: COLOR.screw, flatShading: true });
  private readonly statics = new THREE.Group();
  private ring: THREE.InstancedMesh | null = null;
  private lit = 0;
  private full = false;
  private denySelect = 0;
  private denyExecute = 0;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly tmpC = new THREE.Color();

  constructor() {
    this.keys = {
      execute: new PressKey(tuning.terminal.BUTTON_PRESS_DEPTH),
      chipSelect: new PressKey(tuning.terminal.BUTTON_PRESS_DEPTH),
      pause: new PressKey(tuning.terminal.BUTTON_PRESS_DEPTH / 2),
    };
    this.group.add(this.statics, this.keys.execute.object, this.keys.chipSelect.object, this.keys.pause.object);
  }

  build(layout: TerminalLayout): void {
    this.statics.clear();
    for (const k of Object.values(this.keys)) k.object.clear();
    const screws: THREE.Vector3[] = [];

    // EXECUTE: hazard frame, dark well, big red cap.
    const ex = rectToWorld(layout, layout.zones.execute);
    const exSize = Math.min(ex.w, ex.h) * 0.6;
    this.addStatic(this.hazardMat, ex.cx, ex.cy, 0.02, exSize * 1.34, exSize * 1.34, 0.08);
    this.addStatic(this.frameMat, ex.cx, ex.cy, 0.04, exSize * 1.1, exSize * 1.1, 0.1);
    this.addCap(this.keys.execute, this.capGeo, this.executeMat, ex.cx, ex.cy, exSize, exSize * 0.35, 0.2);
    const exOff = exSize * 0.6;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) screws.push(new THREE.Vector3(ex.cx + sx * exOff, ex.cy + sy * exOff, 0.07));

    // CHIP SELECT: frame, yellow cap with pictogram, LED ring around.
    const sel = rectToWorld(layout, layout.zones.chipSelect);
    const selSize = Math.min(sel.w, sel.h) * 0.4;
    this.addStatic(this.frameMat, sel.cx, sel.cy, 0.03, selSize * 1.3, selSize * 1.3, 0.1);
    this.addCap(this.keys.chipSelect, this.capGeo, this.selectMat, sel.cx, sel.cy, selSize, selSize * 0.4, 0.18);
    const icon = new THREE.Mesh(this.unitPlane, this.iconMat);
    icon.scale.set(selSize * 0.7, selSize * 0.7, 1);
    icon.position.z = selSize * 0.2 + 0.002;
    this.keys.chipSelect.object.add(icon);
    const ringR = selSize * 1.05;
    const ledSize = selSize * 0.13;
    const ring = new THREE.InstancedMesh(this.ledGeo, this.ledMat, GAUGE_LEDS);
    for (let i = 0; i < GAUGE_LEDS; i++) {
      const a = Math.PI / 2 - (i / GAUGE_LEDS) * Math.PI * 2;
      this.tmpP.set(sel.cx + Math.cos(a) * ringR, sel.cy + Math.sin(a) * ringR, 0.05);
      this.tmpS.set(ledSize, 0.08, ledSize);
      ring.setMatrixAt(i, this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS));
      ring.setColorAt(i, COLOR.ledOff);
    }
    this.statics.add(ring);
    this.ring = ring;

    // Pause key on the top bar.
    const top = rectToWorld(layout, layout.top);
    const pz = rectToWorld(layout, layout.zones.pause);
    const pSize = Math.min(pz.w * 0.5, top.h * 0.62);
    this.addStatic(this.frameMat, pz.cx, top.cy, 0.02, pSize * 1.2, pSize * 1.2, 0.06);
    this.addCap(this.keys.pause, this.capGeo, this.pauseMat, pz.cx, top.cy, pSize, pSize * 0.3, 0.08, 0.05);
    const pIcon = new THREE.Mesh(this.unitPlane, this.pauseIconMat);
    pIcon.scale.set(pSize * 0.6, pSize * 0.6, 1);
    pIcon.position.z = pSize * 0.15 + 0.002;
    this.keys.pause.object.add(pIcon);

    const sm = new THREE.InstancedMesh(this.screwGeo, this.screwMat, screws.length);
    const screwSize = exSize * 0.07;
    screws.forEach((p, i) => {
      this.tmpS.set(screwSize, 0.04, screwSize);
      sm.setMatrixAt(i, this.tmpM.compose(p, this.tmpQ, this.tmpS));
    });
    this.statics.add(sm);
    this.lit = -1;
    this.setGauge(0, false);
  }

  key(k: DeckKey): PressKey {
    return this.keys[k];
  }

  /** Refused press: the ring blinks red (CHIP SELECT) or the cap darkens (EXECUTE). */
  deny(k: DeckKey): void {
    if (k === 'chipSelect') this.denySelect = tuning.terminal.DENIED_BLINK_TIME;
    if (k === 'execute') this.denyExecute = tuning.terminal.DENIED_BLINK_TIME;
  }

  setGauge(lit: number, full: boolean): void {
    this.full = full;
    if (lit === this.lit && this.denySelect <= 0) return;
    this.lit = lit;
    this.paintRing(false);
  }

  update(dt: number, time: number): void {
    for (const k of Object.values(this.keys)) k.update(dt);
    const t = tuning.terminal;

    if (this.denySelect > 0) {
      this.denySelect = Math.max(0, this.denySelect - dt);
      this.paintRing(this.denySelect > 0 && Math.floor(this.denySelect * DENY_BLINK_HZ * 2) % 2 === 0);
    }
    const glow = this.full ? 0.55 + 0.35 * Math.sin(time * Math.PI * 2 * t.GLOW_PULSE_HZ) : 0;
    this.selectMat.emissive.copy(COLOR.selectGlow).multiplyScalar(glow);

    this.denyExecute = Math.max(0, this.denyExecute - dt);
    const dim = t.DENIED_BLINK_TIME > 0 ? this.denyExecute / t.DENIED_BLINK_TIME : 0;
    this.executeMat.color.copy(COLOR.execute).lerp(COLOR.executeDim, dim);
  }

  private paintRing(denied: boolean): void {
    const ring = this.ring;
    if (!ring) return;
    for (let i = 0; i < GAUGE_LEDS; i++) {
      const on = i < this.lit;
      ring.setColorAt(i, on ? COLOR.ledOn : denied ? COLOR.ledDenied : this.tmpC.copy(COLOR.ledOff));
    }
    if (ring.instanceColor) ring.instanceColor.needsUpdate = true;
  }

  private addStatic(m: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number): void {
    const mesh = new THREE.Mesh(this.unitBox, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    this.statics.add(mesh);
  }

  private addCap(
    key: PressKey,
    geo: THREE.BufferGeometry,
    m: THREE.Material,
    x: number,
    y: number,
    size: number,
    depth: number,
    restZ: number,
    travel?: number,
  ): void {
    const cap = new THREE.Mesh(geo, m);
    cap.scale.set(size, size, depth);
    key.object.add(cap);
    key.place(x, y, restZ, travel ?? tuning.terminal.BUTTON_PRESS_DEPTH);
  }
}
