import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { tuning } from '../../config/tuning';
import { rectToWorld, type TerminalLayout } from '../layout';
import { PressKey } from './pressKey';

// Physical keys of the terminal (spec §18.1). EXECUTE and CHIP SELECT are gone:
// the trackball is the only battle organ, so the pause key is all that is left.

export type DeckKey = 'pause';

const COLOR = {
  frame: 0x1c1d1f,
  pause: 0x2a2b2e,
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
  private readonly frameMat = new THREE.MeshLambertMaterial({ color: COLOR.frame, flatShading: true });
  private readonly pauseMat = new THREE.MeshLambertMaterial({ color: COLOR.pause });
  private readonly pauseIconMat = new THREE.MeshBasicMaterial({ map: pauseIcon(), transparent: true, depthWrite: false });
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly capGeo = new RoundedBoxGeometry(1, 1, 1, 1, 0.12);
  private readonly unitPlane = new THREE.PlaneGeometry(1, 1);
  private readonly statics = new THREE.Group();

  constructor() {
    this.keys = { pause: new PressKey(tuning.terminal.BUTTON_PRESS_DEPTH / 2) };
    this.group.add(this.statics, this.keys.pause.object);
  }

  build(layout: TerminalLayout): void {
    this.statics.clear();
    this.keys.pause.object.clear();

    // The key sits in the middle of its corner zone on the control panel.
    const pz = rectToWorld(layout, layout.zones.pause);
    const pSize = Math.min(pz.w, pz.h) * 0.5;
    const frame = new THREE.Mesh(this.unitBox, this.frameMat);
    frame.position.set(pz.cx, pz.cy, 0.02);
    frame.scale.set(pSize * 1.2, pSize * 1.2, 0.06);
    this.statics.add(frame);

    const cap = new THREE.Mesh(this.capGeo, this.pauseMat);
    cap.scale.set(pSize, pSize, pSize * 0.3);
    this.keys.pause.object.add(cap);
    this.keys.pause.place(pz.cx, pz.cy, 0.08, 0.05);

    const icon = new THREE.Mesh(this.unitPlane, this.pauseIconMat);
    icon.scale.set(pSize * 0.6, pSize * 0.6, 1);
    icon.position.z = pSize * 0.15 + 0.002;
    this.keys.pause.object.add(icon);
  }

  key(k: DeckKey): PressKey {
    return this.keys[k];
  }

  update(dt: number): void {
    for (const k of Object.values(this.keys)) k.update(dt);
  }
}
