import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import type { ChipId } from '../../data/chips';
import { Spring } from '../anim/spring';
import { Cartridge } from '../chips/cartridge';
import { cooldownBodyLevel } from '../chips/chipFace';
import type { SlotState } from '../../sim/chips/chipSystem';
import {
  chooseEjectProfile,
  ejectAim,
  ejectPose,
  safeEjectDepth,
  type EjectAim,
  type EjectProfile,
} from '../chips/ejectArc';
import { activeSlot, cancelFlashLevel, railChanges, returningCartIndex } from '../chips/railPlan';
import { attractLevel } from '../chips/railAttract';
import { CHIP_TEXELS_H, CHIP_TEXELS_W, RAIL_LEFT, RAIL_SLOTS, RAIL_SPAN } from '../chips/railLayout';
import { rectToWorld, type TerminalLayout } from '../layout';

// Chip rail (TERMINAL.md §6.3–6.5): five slots with contacts and chip
// cartridges. It mirrors the hand slot for slot: used chips eject, new ones
// load in. The rail also owns the three lit states of a cartridge (spec §6.2,
// decision 2026-09-20): a cartridge only carries the light, the rail decides
// how much of it and in which colour.

export { RAIL_SLOTS };

export interface RailChip {
  uid: number;
  /** Draw serial: a chip dealt again gets a new one, so the rail reloads it. */
  deal: number;
  defId: ChipId;
}

/** How a rail slot looks, straight from the simulation (GDD §7.1). */
export interface RailSlotView {
  chip: RailChip | null;
  state: SlotState;
  /** 0..1 while this unavailable slot shows the shared hand cooldown. */
  cooldown?: number | null;
  /** 1-based place in the Attack Queue, 0 when not queued. */
  order: number;
}

type Phase = 'load' | 'idle' | 'eject';

interface Cart {
  cart: Cartridge;
  /** Draw serial identifies this physical cartridge while it moves. */
  deal: number;
  slot: number;
  phase: Phase;
  t: number;
  delay: number;
  lift: Spring;
  pos: THREE.Vector3;
  /** Where the eject started, in world space: the flight ignores the panel tilt. */
  origin: THREE.Vector3;
  profile: EjectProfile | null;
  aim: EjectAim;
  wasCooling: boolean;
  cancelFlashLeft: number;
}

const COLOR = {
  frame: 0x1c1d1f,
  contactOff: new THREE.Color(0x8a7a4a),
  contactOn: new THREE.Color(0xffe9a8),
  /** Queued: warm yellow, the colour of action across the cabinet. */
  glowSelected: new THREE.Color(0xffd45e),
  /** A selected chip was cancelled before its effect resolved. */
  glowCancelled: new THREE.Color(0xff2a3a),
  /** Could join the series being built: cool neutral light, never yellow. */
  glowPossible: new THREE.Color(0xc6d2dc),
  /** The faint "pick me" breathing of an idle rail. */
  glowAttract: new THREE.Color(0xffc98a),
  /** Nothing tints the plastic of a cartridge that is in play. */
  tintPlain: new THREE.Color(0xffffff),
  /** Refused by the combination rule: dark and cold, clearly out of play. */
  tintBlocked: new THREE.Color(0x59636e),
  /**
   * Face brightness is the state's own scale (decision 2026-09-20). The face is
   * unlit, so without this a resting cartridge would burn at full white in a
   * cabinet that is otherwise nearly dark and fall out of the picture. Panel and
   * label are always scaled by the same number, so the ink keeps its contrast
   * and the number, the letter and the icon stay legible at every step.
   */
  faceSelected: new THREE.Color(0xffffff),
  facePossible: new THREE.Color(0xdcd8d0),
  faceNormal: new THREE.Color(0xaaa69e),
  faceBlocked: new THREE.Color(0x6b727b),
  /** Unlit part of a cooling face; the normal texture rises over it bottom-to-top. */
  faceCooling: new THREE.Color(0x292b2e),
};

const REST_Z = 0.14;
/** Eject: height of the pop, flight toward the camera and drop (world units), tilt (radians). */
const EJECT_POP = 0.25;
/** World-space plane in front of the CRT glass and its 0.3-unit bezel. */
const EJECT_FRONT_Z = 0.42;
/** How lit the active slot's contacts sit between flashes. */
const ACTIVE_CONTACT = 0.55;
const LOAD_HEIGHT = 1.2;
/**
 * The breath of a queued cartridge: slow and shallow on purpose (decision
 * 2026-09-20) — the plastic should feel like a physical shell with a lamp
 * inside whose brightness drifts, never like a blinking indicator.
 */
const GLOW_PULSE_HZ = 0.28;
/** Internal light of a queued cartridge: floor and how much the breath adds. */
const GLOW_SELECTED_BASE = 0.58;
const GLOW_SELECTED_PULSE = 0.14;
/** A committed charge is brighter and steadier than an editable selection. */
const GLOW_COMMITTED = 1.0;
/** Internal light of a cartridge that could join the series. */
const GLOW_POSSIBLE = 0.3;
/** NORMAL: barely lit, breathing between these while the rail calls for a pick. */
const GLOW_IDLE = 0.03;
const GLOW_ATTRACT = 0.16;
/** In flight the cartridge leaves the lit rail, so it carries its own light. */
const GLOW_FLIGHT = 0.45;
/** Cartridges slide to a new slot at this rate (1/s). */
const SLIDE_RATE = 22;
/** Cartridge width as a share of its slot pitch. */
const CART_FILL = 0.92;
/** Tutorial callout target: the "pick me" attract amplitude is multiplied by this (GDD §10.5). */
const HINT_PULSE_GAIN = 2.2;

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
  /** Deal serial per slot (null = empty). */
  private slots: (number | null)[] = new Array<number | null>(RAIL_SLOTS).fill(null);
  private carts: Cart[] = [];
  private slotPos: THREE.Vector3[] = [];
  private contacts: { mat: THREE.MeshBasicMaterial; left: number }[] = [];
  private slotViews: readonly RailSlotView[] | null = null;
  private readonly activeAt = new THREE.Vector3();
  private hasActive = false;
  private texel = 0.02;
  private maxH = Infinity;
  /** Cartridge height, world units: the tilt pivots on its bottom edge. */
  private cartH = 1;
  private readonly coolingBody = new THREE.Color();
  /** Called when a cartridge leaves its slot (a shot): the slot index. */
  onEject: ((slot: number) => void) | null = null;
  /** Camera position used to derive left, right and bottom exit corridors. */
  private readonly cameraAt = new THREE.Vector3(0, 0, 30);
  private readonly flight = new THREE.Vector3();
  private time = 0;
  /** How long the Attack Queue has been empty while the rail may call for a pick. */
  private idleFor = 0;
  private attractAllowed = false;
  private hintPulse = false;
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
    const rail = rectToWorld(layout, layout.rail);
    const pitch = (rail.w * RAIL_SPAN) / RAIL_SLOTS;
    this.maxH = rail.h * 0.86;
    // Cartridges fill their slot: scale the texel until the width or the height runs out.
    const grow = Math.min((pitch * CART_FILL) / (CHIP_TEXELS_W * texel), this.maxH / (CHIP_TEXELS_H * texel));
    this.texel = texel * grow;
    texel = this.texel;
    const w = CHIP_TEXELS_W * texel;
    const h = Math.min(CHIP_TEXELS_H * texel, this.maxH);
    this.cartH = h;
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

  /** Top and bottom edges of each slot's cartridge, in the rail's plan space (the PCB meets them). */
  slotEdges(): { x: number; top: number; bottom: number }[] {
    const half = this.cartH / 2;
    return this.slotPos.map((p) => ({ x: p.x, top: p.y + half, bottom: p.y - half }));
  }

  /** Ejected cartridges leave through corridors around `camera`. */
  setCamera(camera: THREE.Vector3): void {
    this.cameraAt.copy(camera);
  }

  /** Position of the active cartridge in the rail's space, for the light that follows it. */
  activePosition(out: THREE.Vector3): boolean {
    if (!this.hasActive) return false;
    out.copy(this.activeAt);
    return true;
  }

  /**
   * Battle: the rail mirrors the hand slot for slot (GDD §7.1). A slot whose
   * chip is gone ejects it; a slot that gained one loads it in.
   */
  syncHand(slots: readonly RailSlotView[]): void {
    this.slotViews = slots;
    const next = slots.map((view) => (view.chip ? view.chip.deal : null));
    let loaded = 0;
    for (const change of railChanges(this.slots, next)) {
      const { slot } = change;
      const old = this.carts.find((c) => c.slot === slot);
      if (old) {
        this.startLeave(old);
        this.flashContacts(slot);
      }
      this.slots[slot] = next[slot] ?? null;
      const chip = slots[slot]?.chip;
      if (change.load && chip) {
        const delay = loaded++ * tuning.terminal.LOAD_STAGGER;
        const returningAt = returningCartIndex(this.carts, chip.deal);
        if (returningAt >= 0) this.returnCart(this.carts[returningAt]!, slot, delay);
        else this.carts.push(this.makeCart(chip, slot, delay));
        this.flashContacts(slot);
      }
    }
  }

  /** Drops every cartridge instantly (a new World started). */
  reset(): void {
    for (const c of this.carts) this.detach(c);
    this.carts = [];
    this.slots = new Array<number | null>(RAIL_SLOTS).fill(null);
  }

  /** Blinks the bodies of chips that were returned from a cancelled chain. */
  flashCancelled(chips: readonly { deal: number }[]): void {
    for (const chip of chips) {
      const cart = this.carts.find((candidate) => candidate.deal === chip.deal);
      if (cart) cart.cancelFlashLeft = tuning.terminal.CHIP_CANCEL_FLASH_TIME;
    }
  }

  /** Battle only: with nothing queued for a while, the faces flash to call for a pick. */
  setAttract(allowed: boolean): void {
    this.attractAllowed = allowed;
  }

  /** A tutorial callout points here: pulse harder (GDD §10.5). */
  setHintPulse(on: boolean): void {
    this.hintPulse = on;
  }

  update(dt: number): void {
    const t = tuning.terminal;
    this.time += dt;
    const active = activeSlot(this.slots);
    const building = this.slotViews?.some((v) => v.state === 'queued') ?? false;
    this.idleFor = this.attractAllowed && !building ? this.idleFor + dt : 0;
    const attractT = this.idleFor - t.RAIL_ATTRACT_DELAY;
    this.hasActive = false;
    const pulse = 0.75 + 0.25 * Math.sin(this.time * Math.PI * 2 * GLOW_PULSE_HZ);
    const slide = 1 - Math.exp(-dt * SLIDE_RATE);

    for (const c of [...this.carts]) {
      c.t += dt;
      c.cancelFlashLeft = Math.max(0, c.cancelFlashLeft - dt);
      const o = c.cart.object;
      const rest = this.slotPos[c.slot];
      const cancelLeft = c.cancelFlashLeft;
      const cancelled = cancelLeft > 0;
      const cancelGlow = cancelFlashLevel(cancelLeft, t.CHIP_CANCEL_FLASH_TIME);
      switch (c.phase) {
        case 'load': {
          if (!rest) break;
          o.visible = c.t >= c.delay;
          const k = t.LOAD_TIME > 0 ? Math.min(1, Math.max(0, (c.t - c.delay) / t.LOAD_TIME)) : 1;
          const cooling = this.slotViews?.[c.slot]?.cooldown != null;
          const loadOffset = cooling
            ? -t.CHIP_COOLDOWN_SINK - (1 - k) * (1 - k) * t.CHIP_PENDING_LOAD_DEPTH
            : (1 - k) * (1 - k) * LOAD_HEIGHT;
          c.pos.set(rest.x, rest.y, rest.z + loadOffset);
          o.position.copy(c.pos);
          o.scale.setScalar((cooling ? 0.88 : 0.7) + (cooling ? 0.12 : 0.3) * k);
          if (cooling) {
            const progress = this.slotViews?.[c.slot]?.cooldown ?? 0;
            c.cart.setTint(this.coolingBody.setScalar(cooldownBodyLevel(progress)), COLOR.faceCooling);
            c.cart.setGlow(COLOR.glowPossible, 0);
            c.cart.setCooldown(progress);
            c.wasCooling = true;
          }
          if (cancelled) c.cart.setGlow(COLOR.glowCancelled, cancelGlow);
          if (k >= 1) this.land(c);
          break;
        }
        case 'idle': {
          if (!rest) break;
          const view = this.slotViews?.[c.slot];
          const selected = view?.state === 'queued';
          const committed = view?.state === 'committed';
          const isActive = selected || committed;
          const blocked = view?.state === 'blocked' || view?.state === 'locked';
          const cooling = view?.cooldown != null;
          if (c.wasCooling && !cooling) this.flashContacts(c.slot);
          c.wasCooling = cooling;
          // While a series is built, chips that could join it tilt level with it.
          const candidate = building && view?.state === 'ready';
          c.cart.setLitContacts(isActive ? (view?.order ?? 0) : 0);
          // Tilt toward the player about the bottom edge: the far (top) edge
          // comes up out of the panel (decision 2026-09-19).
          c.lift.target = isActive ? 1 : candidate ? 0.5 : 0;
          c.lift.step(dt, t.SPRING_STIFFNESS, t.SPRING_DAMPING);
          const k = c.lift.value;
          const tilt = THREE.MathUtils.degToRad(t.CHIP_TILT_DEG) * k;
          const half = this.cartH / 2;
          // A refused chip sits a little deeper in its socket than the rest.
          const sink = cooling ? t.CHIP_COOLDOWN_SINK : blocked ? t.CHIP_BLOCKED_SINK : 0;
          c.pos.set(rest.x, rest.y - half + half * Math.cos(tilt), rest.z + half * Math.sin(tilt) + k * t.CHIP_ACTIVE_PUSH - sink);
          o.position.lerp(c.pos, slide);
          o.rotation.set(tilt, 0, 0);
          o.scale.setScalar(1);
          o.visible = true;
          if (isActive) {
            this.activeAt.copy(o.position);
            this.hasActive = true;
          }
          c.cart.setCooldown(cooling ? (view?.cooldown ?? 0) : null);
          if (cancelled) {
            c.cart.setTint(COLOR.tintPlain, COLOR.faceNormal);
            c.cart.setGlow(COLOR.glowCancelled, cancelGlow);
          } else if (cooling) {
            c.cart.setTint(this.coolingBody.setScalar(cooldownBodyLevel(view?.cooldown ?? 0)), COLOR.faceCooling);
            c.cart.setGlow(COLOR.glowPossible, 0);
          } else if (blocked) {
            c.cart.setTint(COLOR.tintBlocked, COLOR.faceBlocked);
            c.cart.setGlow(COLOR.glowPossible, 0);
          } else if (isActive) {
            c.cart.setTint(COLOR.tintPlain, COLOR.faceSelected);
            const level = committed ? GLOW_COMMITTED : GLOW_SELECTED_BASE + GLOW_SELECTED_PULSE * pulse;
            c.cart.setGlow(COLOR.glowSelected, level);
          } else if (candidate) {
            c.cart.setTint(COLOR.tintPlain, COLOR.facePossible);
            c.cart.setGlow(COLOR.glowPossible, GLOW_POSSIBLE);
          } else {
            c.cart.setTint(COLOR.tintPlain, COLOR.faceNormal);
            // NORMAL: almost dark, breathing only while the rail calls for a pick.
            const raw = attractT >= 0 && view?.state === 'ready' ? attractLevel(c.slot, RAIL_SLOTS, attractT, t.RAIL_ATTRACT_STEP) : 0;
            const a = Math.min(1, raw * (this.hintPulse ? HINT_PULSE_GAIN : 1));
            c.cart.setGlow(COLOR.glowAttract, GLOW_IDLE + (GLOW_ATTRACT - GLOW_IDLE) * a);
          }
          break;
        }
        case 'eject': {
          if (cancelled) c.cart.setGlow(COLOR.glowCancelled, cancelGlow);
          const profile = c.profile;
          if (!profile) {
            this.drop(c);
            break;
          }
          const duration = t.EJECT_LIFT_TIME + t.EJECT_TIME * profile.durationScale;
          const p = duration > 0 ? c.t / duration : 1;
          if (p >= 1) {
            this.drop(c);
            break;
          }
          const pose = ejectPose(p, c.aim, profile);
          this.flight.set(c.origin.x + pose.x, c.origin.y + pose.y, c.origin.z + pose.z);
          o.position.copy(this.group.worldToLocal(this.flight));
          o.rotation.set(pose.rotX, pose.rotY, pose.rotZ);
          o.scale.setScalar(pose.scale);
          break;
        }
      }
    }

    const flash = t.CONTACT_FLASH_TIME;
    this.contacts.forEach((ct, i) => {
      ct.left = Math.max(0, ct.left - dt);
      // The active slot's contacts stay live; the rest only flash on eject.
      const base = i === active ? ACTIVE_CONTACT : 0;
      const k = Math.max(base, flash > 0 ? ct.left / flash : 0);
      ct.mat.color.copy(COLOR.contactOff).lerp(COLOR.contactOn, k);
    });
  }

  private startLeave(c: Cart): void {
    // The control panel leans back 45 degrees, so a chip can be locally above
    // its socket and still sit behind the CRT in world depth. Snap the launch
    // point in front of the bezel before the free flight begins.
    c.origin.copy(c.cart.object.position);
    this.group.localToWorld(c.origin);
    const slot = c.slot;
    // Clear the plane with the whole rotating cartridge, not only its centre.
    c.origin.z = safeEjectDepth(c.origin.z + EJECT_POP, EJECT_FRONT_Z + this.cartH * 0.6);
    const occupied = this.carts
      .filter((candidate) => candidate.phase === 'eject' && candidate.profile)
      .map((candidate) => candidate.profile!.corridor);
    c.profile = chooseEjectProfile(c.deal, slot, occupied);
    c.aim = ejectAim(c.profile, c.origin, this.cameraAt);
    this.flight.copy(c.origin);
    c.cart.object.position.copy(this.group.worldToLocal(this.flight));
    c.cart.object.rotation.set(0, 0, 0);
    c.slot = -1;
    c.t = 0;
    c.phase = 'eject';
    c.delay = 0;
    c.cart.setTint(COLOR.tintPlain, COLOR.faceSelected);
    c.cart.setGlow(COLOR.glowSelected, GLOW_FLIGHT);
    c.cart.setLitContacts(0);
    c.cart.setFlying(true);
    c.cart.setCooldown(null);
    this.flashContacts(slot);
    this.onEject?.(slot);
  }

  /** Reverses a cancelled ejection without creating a duplicate cartridge. */
  private returnCart(c: Cart, slot: number, delay: number): void {
    c.slot = slot;
    c.phase = 'load';
    c.t = 0;
    c.delay = delay;
    c.lift.snap(0);
    c.cart.object.rotation.set(0, 0, 0);
    c.cart.setFlying(false);
    c.wasCooling = false;
    c.cart.setCooldown(null);
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

  private makeCart(chip: RailChip, slot: number, delay: number): Cart {
    const cart = new Cartridge(chip.defId);
    cart.shape(this.texel, this.maxH);
    cart.setTint(COLOR.tintPlain, COLOR.faceNormal);
    cart.setGlow(COLOR.glowAttract, GLOW_IDLE);
    const o = cart.object;
    o.visible = false;
    this.group.add(o);
    return {
      cart,
      deal: chip.deal,
      slot,
      phase: 'load',
      t: 0,
      delay,
      lift: new Spring(0),
      pos: o.position.clone(),
      origin: new THREE.Vector3(),
      profile: null,
      aim: { x: 0, y: 0, z: 0 },
      wasCooling: this.slotViews?.[slot]?.state === 'cooling',
      cancelFlashLeft: 0,
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
