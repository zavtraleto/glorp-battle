import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import type { ChipCode, ChipId } from '../../data/chips';
import { Spring } from '../anim/spring';
import { Cartridge, cartridgeGlow } from '../chips/cartridge';
import { activeSlot, planRail } from '../chips/railPlan';
import { CHIP_TEXELS_H, CHIP_TEXELS_W, RAIL_LEFT, RAIL_SLOTS, RAIL_SPAN } from '../chips/trayLayout';
import { rectToWorld, type TerminalLayout } from '../layout';

// Chip rail (TERMINAL.md §6.3–6.5): five slots with contacts and chip
// cartridges. In battle it mirrors the chip queue (used chips eject, slots stay
// empty); on the Custom Screen it mirrors the selection, packed from the left.

export { RAIL_SLOTS };

export interface RailChip {
  uid: number;
  defId: ChipId;
  code: ChipCode;
  legacyGen?: number;
}

export interface RailSyncOptions {
  /** `queue`: battle; `select`: Custom Screen selection (packed). */
  mode: 'queue' | 'select';
  /** The Custom Screen is open: chips leaving the queue burn. */
  burning: boolean;
  /** A chip that is (back) in the hand returns to the tray instead of ejecting. */
  inHand(uid: number): boolean;
  /** Where a newly selected chip flies in from (its tray cartridge), if anywhere. */
  spawnFrom(uid: number): THREE.Vector3 | null;
}

type Phase = 'load' | 'fly' | 'idle' | 'drag' | 'eject' | 'burn' | 'return';

interface Cart {
  uid: number;
  cart: Cartridge;
  slot: number;
  phase: Phase;
  t: number;
  delay: number;
  lift: Spring;
  pos: THREE.Vector3;
  origin: THREE.Vector3;
  drift: number;
  spin: number;
}

const COLOR = {
  frame: 0x1c1d1f,
  glow: new THREE.Color(0x55ff66),
  contactOff: new THREE.Color(0x8a7a4a),
  contactOn: new THREE.Color(0xffe9a8),
  faceActive: new THREE.Color(0xffffff),
  faceIdle: new THREE.Color(0x9a9a9a),
  faceBurnt: new THREE.Color(0x2a1a14),
};

const REST_Z = 0.14;
/** Eject: height of the pop, flight toward the camera and drop (world units), tilt (radians). */
const EJECT_POP = 0.25;
const EJECT_TOWARD = 5;
const EJECT_DROP = 2.5;
const EJECT_TILT = 0.8;
/** Burn: launch speed and gravity (world units per s / s²). */
const BURN_UP = 3;
const BURN_GRAVITY = 30;
const LOAD_HEIGHT = 1.2;
const GLOW_PULSE_HZ = 2;
/** Cartridges slide to a new slot at this rate (1/s). */
const SLIDE_RATE = 22;
/** Height of a flying / dragged cartridge above the rail. */
const CARRY_Z = 0.9;
const FLY_TIME = 0.16;
const RETURN_TIME = 0.12;

function contactTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 29;
  canvas.height = 5;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 6; i++) ctx.fillRect(1 + i * 5, 0, 3, 5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

export class ChipRail {
  readonly group = new THREE.Group();
  private readonly statics = new THREE.Group();
  private slots: (number | null)[] = new Array<number | null>(RAIL_SLOTS).fill(null);
  private carts: Cart[] = [];
  private slotPos: THREE.Vector3[] = [];
  private contacts: { mat: THREE.MeshBasicMaterial; left: number }[] = [];
  private mode: RailSyncOptions['mode'] = 'queue';
  private texel = 0.02;
  private maxH = Infinity;
  private time = 0;
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly unitPlane = new THREE.PlaneGeometry(1, 1);
  private readonly frameMat = new THREE.MeshLambertMaterial({ color: COLOR.frame, flatShading: true });
  private readonly contactTex = contactTexture();

  constructor() {
    this.group.add(this.statics);
  }

  build(layout: TerminalLayout, texel: number): void {
    this.statics.clear();
    for (const c of this.contacts) c.mat.dispose();
    this.contacts = [];
    this.texel = texel;
    const rail = rectToWorld(layout, layout.rail);
    const pitch = (rail.w * RAIL_SPAN) / RAIL_SLOTS;
    this.maxH = rail.h * 0.86;
    const w = CHIP_TEXELS_W * texel;
    const h = Math.min(CHIP_TEXELS_H * texel, this.maxH);
    this.slotPos = [];
    for (let i = 0; i < RAIL_SLOTS; i++) {
      const x = rail.cx - rail.w * RAIL_LEFT + pitch * (i + 0.5);
      this.slotPos.push(new THREE.Vector3(x, rail.cy, REST_Z));
      const frame = new THREE.Mesh(this.unitBox, this.frameMat);
      frame.position.set(x, rail.cy, 0.02);
      frame.scale.set(w + 4 * texel, h + 4 * texel, 0.1);
      this.statics.add(frame);
      const mat = new THREE.MeshBasicMaterial({ map: this.contactTex, color: COLOR.contactOff.clone(), transparent: true });
      const pad = new THREE.Mesh(this.unitPlane, mat);
      pad.position.set(x, rail.cy - h * 0.3, 0.075);
      pad.scale.set(w * 0.8, 10 * texel, 1);
      this.statics.add(pad);
      this.contacts.push({ mat, left: 0 });
    }
    for (const c of this.carts) c.cart.shape(texel, this.maxH);
  }

  slotWorld(i: number): THREE.Vector3 {
    return (this.slotPos[i] ?? new THREE.Vector3()).clone();
  }

  cartPosition(uid: number): THREE.Vector3 | null {
    const c = this.carts.find((x) => x.uid === uid && x.slot >= 0);
    return c ? c.cart.object.position.clone() : null;
  }

  /** Brings the rail in line with the queue (battle) or the selection (Custom Screen). */
  sync(list: readonly RailChip[], o: RailSyncOptions): void {
    this.mode = o.mode;
    if (o.mode === 'select') this.syncSelect(list, o);
    else this.syncQueue(list, o);
  }

  /** Makes a rail chip follow the pointer (null releases it back to its slot). */
  setDrag(uid: number | null, at: THREE.Vector3 | null): void {
    for (const c of this.carts) {
      if (c.slot < 0) continue;
      if (c.uid === uid && at) {
        c.phase = 'drag';
        c.pos.set(at.x, at.y, REST_Z + CARRY_Z);
      } else if (c.phase === 'drag') {
        c.phase = 'idle';
      }
    }
  }

  /** Drops every cartridge instantly (a new World started). */
  reset(): void {
    for (const c of this.carts) this.detach(c);
    this.carts = [];
    this.slots = new Array<number | null>(RAIL_SLOTS).fill(null);
  }

  update(dt: number): void {
    const t = tuning.terminal;
    this.time += dt;
    const active = this.mode === 'queue' ? activeSlot(this.slots) : -1;
    const pulse = 0.75 + 0.25 * Math.sin(this.time * Math.PI * 2 * GLOW_PULSE_HZ);
    cartridgeGlow.color.copy(COLOR.glow).multiplyScalar(pulse);
    const slide = 1 - Math.exp(-dt * SLIDE_RATE);

    for (const c of [...this.carts]) {
      c.t += dt;
      const o = c.cart.object;
      const face = c.cart.faceMat.color;
      const rest = this.slotPos[c.slot];
      switch (c.phase) {
        case 'load': {
          if (!rest) break;
          o.visible = c.t >= c.delay;
          const k = t.LOAD_TIME > 0 ? Math.min(1, Math.max(0, (c.t - c.delay) / t.LOAD_TIME)) : 1;
          c.pos.set(rest.x, rest.y, rest.z + (1 - k) * (1 - k) * LOAD_HEIGHT);
          o.position.copy(c.pos);
          o.scale.setScalar(0.7 + 0.3 * k);
          if (k >= 1) this.land(c);
          break;
        }
        case 'fly': {
          if (!rest) break;
          const k = Math.min(1, c.t / FLY_TIME);
          o.position.lerpVectors(c.origin, rest, k);
          o.position.z += Math.sin(k * Math.PI) * CARRY_Z;
          c.pos.copy(o.position);
          if (k >= 1) this.land(c);
          break;
        }
        case 'drag':
          o.position.lerp(c.pos, slide);
          o.rotation.set(0, 0, 0);
          face.copy(COLOR.faceActive);
          c.cart.glow.visible = false;
          break;
        case 'idle': {
          if (!rest) break;
          const isActive = c.slot === active;
          c.lift.target = isActive ? t.CHIP_ACTIVE_LIFT : 0;
          c.lift.step(dt, t.SPRING_STIFFNESS, t.SPRING_DAMPING);
          c.pos.set(rest.x, rest.y + c.lift.value * 0.4, rest.z + c.lift.value);
          o.position.lerp(c.pos, slide);
          o.scale.setScalar(1);
          o.visible = true;
          c.cart.glow.visible = isActive;
          face.copy(isActive || this.mode === 'select' ? COLOR.faceActive : COLOR.faceIdle);
          break;
        }
        case 'eject': {
          const lt = t.EJECT_LIFT_TIME;
          if (c.t < lt) {
            o.position.z = c.origin.z + EJECT_POP * (c.t / lt);
            break;
          }
          const p = t.EJECT_TIME > 0 ? (c.t - lt) / t.EJECT_TIME : 1;
          if (p >= 1) {
            this.drop(c);
            break;
          }
          o.position.set(
            c.origin.x + c.drift * p,
            c.origin.y - EJECT_DROP * p * p,
            c.origin.z + EJECT_POP + EJECT_TOWARD * p * p,
          );
          o.rotation.set(-EJECT_TILT * p, 0, c.spin * p);
          o.scale.setScalar(1 + 0.8 * p);
          face.copy(COLOR.faceActive);
          break;
        }
        case 'burn': {
          const tt = c.t - c.delay;
          if (tt < 0) break;
          if (tt >= t.BURN_TIME) {
            this.drop(c);
            break;
          }
          o.position.set(
            c.origin.x + c.drift * tt,
            c.origin.y + BURN_UP * tt - 0.5 * BURN_GRAVITY * tt * tt,
            c.origin.z + Math.min(1, tt * 5) * 0.4,
          );
          o.rotation.set(0, 0, c.spin * tt * 4);
          face.copy(COLOR.faceIdle).lerp(COLOR.faceBurnt, Math.min(1, tt / t.BURN_TIME));
          break;
        }
        case 'return': {
          const k = Math.min(1, c.t / RETURN_TIME);
          o.scale.setScalar(1 - k);
          if (k >= 1) this.drop(c);
          break;
        }
      }
    }

    const flash = t.CONTACT_FLASH_TIME;
    for (const ct of this.contacts) {
      ct.left = Math.max(0, ct.left - dt);
      ct.mat.color.copy(COLOR.contactOff).lerp(COLOR.contactOn, flash > 0 ? ct.left / flash : 0);
    }
  }

  private syncQueue(list: readonly RailChip[], o: RailSyncOptions): void {
    // Coming from the Custom Screen the selection was packed from slot 0 — same as the queue.
    const plan = planRail(
      this.slots,
      list.map((c) => c.uid),
      o.burning,
    );
    if (plan.remove.length === 0 && plan.add.length === 0) return;
    let burnIndex = 0;
    for (const r of plan.remove) {
      const c = this.carts.find((x) => x.slot === r.slot);
      this.slots[r.slot] = null;
      if (!c) continue;
      if (o.inHand(c.uid)) this.startLeave(c, 'return', 0);
      else this.startLeave(c, r.how, r.how === 'burn' ? burnIndex++ : 0);
    }
    plan.add.forEach((a, i) => {
      const chip = list.find((c) => c.uid === a.uid);
      if (!chip) return;
      this.slots[a.slot] = a.uid;
      this.carts.push(this.makeCart(chip, a.slot, 'load', i * tuning.terminal.LOAD_STAGGER, null));
    });
  }

  private syncSelect(list: readonly RailChip[], o: RailSyncOptions): void {
    const uids = list.map((c) => c.uid);
    const occupied = this.slots.filter((s) => s !== null).length;
    if (uids.length === occupied && uids.every((u, i) => this.slots[i] === u)) return;
    let burnIndex = 0;
    for (const c of this.carts) {
      if (c.slot < 0 || uids.includes(c.uid)) continue;
      if (o.inHand(c.uid)) this.startLeave(c, 'return', 0);
      else this.startLeave(c, o.burning ? 'burn' : 'eject', burnIndex++);
    }
    list.forEach((chip, i) => {
      const c = this.carts.find((x) => x.uid === chip.uid && x.slot >= 0);
      if (c) {
        c.slot = i;
        return;
      }
      const from = o.spawnFrom(chip.uid);
      this.carts.push(this.makeCart(chip, i, from ? 'fly' : 'load', 0, from));
    });
    this.slots = Array.from({ length: RAIL_SLOTS }, (_, i) => uids[i] ?? null);
  }

  private startLeave(c: Cart, how: 'eject' | 'burn' | 'return', index: number): void {
    c.origin.copy(c.cart.object.position);
    const slot = c.slot;
    c.slot = -1;
    c.t = 0;
    c.phase = how;
    c.drift = (slot - 2) * 0.15;
    c.spin = how === 'burn' ? (index % 2 === 0 ? 1 : -1) * (1 + index * 0.3) : 0.4;
    c.delay = how === 'burn' ? index * tuning.terminal.BURN_STAGGER : 0;
    c.cart.glow.visible = false;
    if (how === 'eject') this.flashContacts(slot);
  }

  private land(c: Cart): void {
    c.phase = 'idle';
    c.lift.snap(0);
    c.cart.object.scale.setScalar(1);
    this.flashContacts(c.slot);
  }

  private flashContacts(slot: number): void {
    const c = this.contacts[slot];
    if (c) c.left = tuning.terminal.CONTACT_FLASH_TIME;
  }

  private makeCart(chip: RailChip, slot: number, phase: 'load' | 'fly', delay: number, from: THREE.Vector3 | null): Cart {
    const cart = new Cartridge(chip.defId, chip.code, chip.legacyGen);
    cart.shape(this.texel, this.maxH);
    cart.faceMat.color.copy(COLOR.faceIdle);
    const o = cart.object;
    if (from) o.position.copy(from);
    o.visible = phase === 'fly';
    this.group.add(o);
    return {
      uid: chip.uid,
      cart,
      slot,
      phase,
      t: 0,
      delay,
      lift: new Spring(0),
      pos: o.position.clone(),
      origin: from ? from.clone() : new THREE.Vector3(),
      drift: 0,
      spin: 0,
    };
  }

  private drop(c: Cart): void {
    this.detach(c);
    this.carts = this.carts.filter((x) => x !== c);
  }

  private detach(c: Cart): void {
    this.group.remove(c.cart.object);
    c.cart.dispose();
  }
}
