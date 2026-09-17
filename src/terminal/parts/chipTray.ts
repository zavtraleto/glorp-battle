import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { tuning } from '../../config/tuning';
import { t } from '../../i18n';
import { Spring } from '../anim/spring';
import { Cartridge } from '../chips/cartridge';
import type { TrayLayout } from '../chips/trayLayout';
import { rectToWorld, type Rect, type TerminalLayout } from '../layout';
import { labelTexture } from '../textures/procedural';
import type { RailChip } from './chipRail';
import { PressKey } from './pressKey';

// Chip tray (TERMINAL.md §6.4): slides up in place of the control deck on the
// Custom Screen. Holds the hand as cartridges and the OK / ADD keys.

export type HandCellState = 'ok' | 'dim' | 'selected' | 'empty';

interface Cell {
  uid: number;
  cart: Cartridge;
  home: THREE.Vector3;
  pos: THREE.Vector3;
  lift: Spring;
  shake: number;
  dragging: boolean;
  scale: number;
}

const COLOR = {
  plate: 0x24262a,
  well: 0x131416,
  ok: 0x3a8f4a,
  add: 0x5a5f66,
  label: '#f2ecd8',
  faceOk: new THREE.Color(0xffffff),
  faceDim: new THREE.Color(0x3a3a3a),
};

const PLATE_Z = 0.02;
const CART_Z = 0.16;
const DRAG_Z = 1.0;
const FOCUS_LIFT = 0.12;
const SHAKE_TIME = 0.25;
const SHAKE_AMP = 0.08;
const FOLLOW_RATE = 22;
/** How far below its open position the closed tray sits, as a share of the deck height. */
const SLIDE_SHARE = 1.15;

export class ChipTray {
  readonly group = new THREE.Group();
  readonly keys = { ok: new PressKey(0.1), add: new PressKey(0.1) };
  private readonly statics = new THREE.Group();
  private readonly open = new Spring(0);
  private cells: (Cell | null)[] = [];
  private focus = -1;
  private texel = 0.02;
  private slide = 1;
  private layout: TerminalLayout | null = null;
  private trayKey = '';
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly capGeo = new RoundedBoxGeometry(1, 1, 1, 1, 0.12);
  private readonly plateMat = new THREE.MeshLambertMaterial({ color: COLOR.plate, flatShading: true });
  private readonly wellMat = new THREE.MeshLambertMaterial({ color: COLOR.well, flatShading: true });
  private readonly okMat = new THREE.MeshLambertMaterial({ color: COLOR.ok });
  private readonly addMat = new THREE.MeshLambertMaterial({ color: COLOR.add });
  private readonly owned: { dispose(): void }[] = [];
  private addLabel = '';

  constructor() {
    this.group.add(this.statics, this.keys.ok.object, this.keys.add.object);
  }

  /** 0 = closed (below the screen), 1 = open. */
  get openness(): number {
    return this.open.value;
  }

  /** World distance the deck and the tray travel. */
  get slideDistance(): number {
    return this.slide;
  }

  build(layout: TerminalLayout, texel: number): void {
    this.layout = layout;
    this.texel = texel;
    this.slide = rectToWorld(layout, layout.deck).h * SLIDE_SHARE;
    this.trayKey = '';
    for (const c of this.cells) if (c) this.removeCell(c);
    this.cells = [];
  }

  /** ADD key caption (SKIP on a reward); a change rebuilds the keys. */
  setAddLabel(text: string): void {
    if (text === this.addLabel) return;
    this.addLabel = text;
    this.trayKey = '';
  }

  setOpen(open: boolean): void {
    this.open.target = open ? 1 : 0;
  }

  /** Lays out the plate, keys and cartridges for the current hand. */
  setHand(hand: readonly (RailChip | null)[], states: readonly HandCellState[], tray: TrayLayout): void {
    const layout = this.layout;
    if (!layout) return;
    const key = `${tray.cells.length}|${tray.scale}|${this.addLabel}`;
    if (key !== this.trayKey) {
      this.trayKey = key;
      this.buildStatics(layout, tray);
      for (const c of this.cells) if (c) this.removeCell(c);
      this.cells = [];
    }
    for (let i = 0; i < tray.cells.length; i++) {
      const chip = hand[i] ?? null;
      let cell = this.cells[i] ?? null;
      if (cell && (!chip || cell.uid !== chip.uid)) {
        this.removeCell(cell);
        cell = null;
      }
      if (chip && !cell) cell = this.addCell(chip, rectToWorld(layout, tray.cells[i] as Rect), tray.scale);
      this.cells[i] = cell;
      if (!cell) continue;
      const state = states[i] ?? 'empty';
      cell.cart.object.visible = state !== 'selected' && state !== 'empty';
      cell.cart.faceMat.color.copy(state === 'dim' ? COLOR.faceDim : COLOR.faceOk);
    }
    this.cells.length = tray.cells.length;
  }

  /** Current world position of a hand cartridge (for flights to the rail). */
  cellPosition(slot: number): THREE.Vector3 | null {
    const c = this.cells[slot];
    return c ? c.cart.object.getWorldPosition(new THREE.Vector3()) : null;
  }

  /** A chip came back from the rail: its cartridge starts from there. */
  flyFrom(slot: number, world: THREE.Vector3): void {
    const c = this.cells[slot];
    if (!c) return;
    c.cart.object.position.copy(this.group.worldToLocal(world.clone()));
  }

  setFocus(slot: number): void {
    this.focus = slot;
  }

  refuse(slot: number): void {
    const c = this.cells[slot];
    if (c) c.shake = SHAKE_TIME;
  }

  /** Drags a hand cartridge (world point on the face), or releases it. */
  setDrag(slot: number, world: THREE.Vector3 | null): void {
    const c = this.cells[slot];
    if (!c) return;
    c.dragging = world !== null;
    if (world) {
      const local = this.group.worldToLocal(world.clone());
      c.pos.set(local.x, local.y, DRAG_Z);
    }
  }

  update(dt: number): void {
    const tt = tuning.terminal;
    this.open.step(dt, tt.SPRING_STIFFNESS / 3, tt.SPRING_DAMPING);
    this.group.position.y = -(1 - this.open.value) * this.slide;
    this.group.visible = this.open.value > 0.01;
    this.keys.ok.update(dt);
    this.keys.add.update(dt);
    const follow = 1 - Math.exp(-dt * FOLLOW_RATE);
    this.cells.forEach((c, i) => {
      if (!c) return;
      c.lift.target = i === this.focus ? FOCUS_LIFT : 0;
      c.lift.step(dt, tt.SPRING_STIFFNESS, tt.SPRING_DAMPING);
      c.shake = Math.max(0, c.shake - dt);
      if (!c.dragging) {
        const wobble = c.shake > 0 ? Math.sin(c.shake * 60) * SHAKE_AMP * (c.shake / SHAKE_TIME) : 0;
        c.pos.set(c.home.x + wobble, c.home.y, c.home.z + c.lift.value);
      }
      const o = c.cart.object;
      o.position.lerp(c.pos, follow);
      o.scale.setScalar(c.dragging ? 1 : c.scale);
    });
  }

  private buildStatics(layout: TerminalLayout, tray: TrayLayout): void {
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    this.statics.clear();
    this.keys.ok.object.clear();
    this.keys.add.object.clear();

    const deck = rectToWorld(layout, layout.deck);
    this.addBox(this.plateMat, deck.cx, deck.cy, PLATE_Z, deck.w * 0.98, deck.h * 0.98, 0.12);
    for (const r of tray.cells) {
      const w = rectToWorld(layout, r);
      this.addBox(this.wellMat, w.cx, w.cy, PLATE_Z + 0.04, w.w * 0.9, w.h * 0.9, 0.06);
    }
    this.buildKey(this.keys.ok, this.okMat, rectToWorld(layout, tray.ok), t('custom.ok'));
    this.buildKey(this.keys.add, this.addMat, rectToWorld(layout, tray.add), this.addLabel || t('custom.add'));
  }

  private buildKey(key: PressKey, mat: THREE.Material, r: { cx: number; cy: number; w: number; h: number }, text: string): void {
    this.addBox(this.wellMat, r.cx, r.cy, PLATE_Z + 0.04, r.w * 0.96, r.h * 0.9, 0.06);
    const cap = new THREE.Mesh(this.capGeo, mat);
    const depth = 0.24;
    cap.scale.set(r.w * 0.88, r.h * 0.72, depth);
    key.object.add(cap);
    const label = labelTexture(text, COLOR.label, 2);
    const lm = new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, depthWrite: false });
    const lg = new THREE.PlaneGeometry(label.width * this.texel, label.height * this.texel);
    this.owned.push(label.texture, lm, lg);
    const lmesh = new THREE.Mesh(lg, lm);
    lmesh.position.z = depth / 2 + 0.002;
    key.object.add(lmesh);
    key.place(r.cx, r.cy, 0.2);
  }

  private addBox(m: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number): void {
    const mesh = new THREE.Mesh(this.box, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    this.statics.add(mesh);
  }

  private addCell(chip: RailChip, r: { cx: number; cy: number }, scale: number): Cell {
    const cart = new Cartridge(chip.defId, chip.code, chip.legacyGen);
    cart.shape(this.texel);
    const home = new THREE.Vector3(r.cx, r.cy, CART_Z);
    cart.object.position.copy(home);
    cart.object.scale.setScalar(scale);
    this.group.add(cart.object);
    return { uid: chip.uid, cart, home, pos: home.clone(), lift: new Spring(0), shake: 0, dragging: false, scale };
  }

  private removeCell(c: Cell): void {
    this.group.remove(c.cart.object);
    c.cart.dispose();
  }
}
