import * as THREE from 'three';
import type { Session } from '../app/session';
import type { TutorialHint } from '../app/tutorial/director';
import { secondsToTicks, tuning } from '../config/tuning';
import type { Dir } from '../core/input/commands';
import type { PerfProbe } from '../debug/perfProbe';
import type { SceneRenderer } from '../render/scene';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import { acceptsPress, cursorKind, shotAvailability, organForKey, trackballArmed } from './controlRules';
import { BattleTarget } from './crt/battleTarget';
import { CrtCanvas } from './crt/crtCanvas';
import { CrtMaterial } from './crt/crtMaterial';
import { PLAYER_ID } from '../sim/player';
import { FloaterList, floaterFromEvent } from './crt/floaters';
import type { HpTag, HudLabel, HudStatus } from './crt/hudModel';
import { menuFor, menuItemAt, menuLayout, moveCursor, type MenuAction, type MenuSpec } from './crt/menuModel';
import { cursorCss } from './interaction/cursor';
import { attachPointers } from './interaction/pointerEvents';
import { PointerRouter, type GestureStats } from './interaction/pointerRouter';
import {
  computeLayout,
  glassRect,
  railZoneSlots,
  rectContains,
  rectToWorld,
  ZONE_ORDER,
  type TerminalLayout,
  type ZoneId,
} from './layout';
import { DeckControls } from './parts/deckControls';
import { ChipRail } from './parts/chipRail';
import { HitZones } from './parts/hitZones';
import { Housing } from './parts/housing';
import { DarkLighting } from './parts/lighting';
import { Pcb, PCB_PULSE_HZ } from './parts/pcb';
import { SegmentDisplay } from './parts/segmentDisplay';
import { comboDisplayModel, type ChipDisplayEntry } from './chips/segmentFont';
import { cooldownForSlot } from './chips/railPlan';
import { Mount } from './parts/mount';
import { mountCorners, screenBounds } from './interaction/project';
import { Trackball } from './parts/trackball';
import { WaveBanner } from './waveBanner';
import { terminalMode } from './terminalMode';
import { chipName, t } from '../i18n';
import { CHIPS } from '../data/chips';

// NET-01 terminal (TERMINAL.md §13). Owns the terminal scene and camera, draws
// the battle and the HUD into the CRT and the terminal into a low-resolution
// canvas that CSS upscales without smoothing.

const TERMINAL_CLEAR_COLOR = 0x000000;
/** HP at or below this share of the maximum turns the number amber. */
const HP_LOW_SHARE = 0.25;
/** How long the HP number blinks after a hit, seconds. */
const HP_HIT_TIME = 0.5;
/** How far (plan space) the yellow PCB traces run on past the bottom of the glass, hidden under it. */
const UNDER_SCREEN = 1.6;
/** Camera near plane, world units: close enough for an ejected cartridge to fly at the lens. */
const CAMERA_NEAR = 0.5;
/** Damage numbers: start height and rise (world units), flicker after this share of their life. */
const FLOATER_HEIGHT = 0.6;
const FLOATER_RISE = 0.7;
const FLOATER_FLICKER = 0.75;
/** Numbers pop in one size bigger for this share of their life. */
const FLOATER_POP = 0.12;
/** Damage to the player shakes for this share of its life. */
const FLOATER_SHAKE = 0.35;
/** Whole-terminal shake (decision 2026-09-19): world units at full strength, and fade time. */
const CAM_SHAKE_TIME = 0.22;
const SHAKE = { chip: 0.035, sword: 0.06, bomb: 0.07, kill: 0.09, playerHit: 0.16 };
/** Edge glow of the tube: faint warm on a hit, bright warm on a kill, red on a hit taken. */
const EDGE_HIT = 0xffb347;
const EDGE_KILL = 0xffe2a0;
const EDGE_HURT = 0xff2020;
const EDGE = { hit: 0.18, kill: 0.6, hurt: 0.5 };
/** HP segments sit this many CRT pixels above an enemy's head. */
const HP_BAR_GAP = 1;
/** User-tuned size of the framed 14-segment module under the CRT. */
const CHIP_DISPLAY_SCALE = 0.6;
/** "Wave 1" stays up this long after the battle intro, seconds. */
const WAVE1_BANNER_HOLD = 0.5;

export interface TerminalHandlers {
  move(dir: Dir): void;
  /** A session menu item was chosen. */
  menu(action: MenuAction): void;
  /** Tap on a rail slot: build or unbuild the Attack Queue (GDD §7.2). */
  selectChip(slot: number): void;
  execute(): void;
  pause(): void;
}

export interface TerminalOptions {
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;
  session: Session;
  sceneRenderer: SceneRenderer;
  perf: PerfProbe;
  handlers: TerminalHandlers;
}

export class Terminal {
  layout: TerminalLayout;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(22, 1, 0.1, 200);
  private readonly crt = new CrtMaterial();
  private readonly hud = new CrtCanvas(tuning.terminal.CRT_RES_W, tuning.terminal.CRT_RES_H);
  private readonly housing = new Housing(this.crt);
  private readonly rail = new ChipRail();
  private menu: MenuSpec | null = null;
  private menuCursor = 0;
  private readonly menuPresses = new Map<number, number>();
  private readonly floaters = new FloaterList();
  private readonly hitZones = new HitZones();
  private readonly deck = new DeckControls();
  private readonly trackball = new Trackball();
  private readonly lighting = new DarkLighting();
  private readonly chipDisplay = new SegmentDisplay();
  private readonly pcb = new Pcb();
  private readonly waveBanner = new WaveBanner();
  private readonly crtMount = new Mount();
  /** The control panel: rail, trackball and pause key on one tilted plane. */
  private readonly controlMount = new Mount();
  /** Pivot line of each tilted mount, world y (spec §3.1). */
  private readonly pivots = { crt: 0, control: 0 };
  private readonly corners: THREE.Vector3[] = [];
  private readonly activeChipAt = new THREE.Vector3();
  private hpHitLeft = 0;
  private readonly battle: BattleTarget;
  private readonly router: PointerRouter;

  /** Debug: the player's step count, stamped on trackball gestures for the overlay. */
  movesProbe: (() => number) | null = null;

  /** Latest trackball gestures, newest first (debug overlay). */
  get gestures(): readonly GestureStats[] {
    return this.router.gestures;
  }
  private readonly cleanups: (() => void)[] = [];
  private readonly size = new THREE.Vector2();
  private readonly fineCursor = window.matchMedia?.('(pointer: fine)').matches ?? false;
  private hovered: ZoneId | null = null;
  private cursor = '';
  private time = 0;
  private layoutKey = '';
  /** CRT picture size in pixels: exactly the glass's render pixels, so nothing is resampled. */
  private readonly crtPx = { w: tuning.terminal.CRT_RES_W, h: tuning.terminal.CRT_RES_H };
  /** Camera rest position; a shake offsets from it. */
  private readonly camBase = new THREE.Vector3();
  private camShake = 0;
  private camShakeLeft = 0;

  constructor(private opts: TerminalOptions) {
    const { renderer, container } = opts;
    renderer.domElement.id = 'terminal-canvas';
    container.appendChild(renderer.domElement);
    // Several render passes per frame: counters are reset manually in render().
    renderer.info.autoReset = false;
    this.battle = new BattleTarget(renderer);
    this.crt.setHud(this.hud.texture);

    this.crtMount.inner.add(this.housing.crtGroup);
    this.controlMount.inner.add(
      this.pcb.group,
      this.rail.group,
      this.trackball.group,
      this.deck.group,
    );
    this.scene.add(this.lighting.group, this.housing.group, this.chipDisplay.group, this.crtMount, this.controlMount, this.hitZones.group);

    this.layout = computeLayout(container.clientWidth, container.clientHeight);
    // A shot runs through the PCB and flares the ring.
    this.rail.onEject = (slot) => {
      this.pcb.fire(slot);
      this.trackball.flashTap();
    };
    this.trackball.breatheHz = PCB_PULSE_HZ;
    this.router = new PointerRouter((x, y) => this.zoneAt(x, y), {
      press: (z) => this.press(z, true),
      release: (z) => this.release(z),
      move: (d) => {
        this.trackball.step(d);
        if (this.mode() === 'MENU') this.moveMenu(d);
        else opts.handlers.move(d);
      },
      roll: (dx, dy) => this.trackball.roll(dx, dy),
      action: (z, x, y) => this.act(z, true, x, y),
      accepts: (z) => acceptsPress(this.mode(), z),
      hover: (z) => this.hover(z),
      movesProbe: () => this.movesProbe?.() ?? 0,
    });
    this.cleanups.push(
      this.router.attach(renderer.domElement),
      attachPointers(renderer.domElement, {
        down: (id, x, y) => this.menuDown(id, x, y),
        move: () => {},
        up: (id, x, y) => this.menuUp(id, x, y),
        cancelAll: () => this.menuPresses.clear(),
        isCaptured: (id) => this.menuPresses.has(id),
      }),
      this.attachKeyVisuals(),
    );
    this.resize();
    // A debug jump may start the page straight in a battle intro.
    this.resetWorld();
  }

  /** Rebuilds layout, canvas size and meshes when the viewport or layout tunables change. */
  resize(): void {
    const { container, renderer } = this.opts;
    const t = tuning.terminal;
    const vw = Math.max(1, container.clientWidth);
    const vh = Math.max(1, container.clientHeight);
    const key = [
      vw, vh, t.RENDER_SCALE_SHORT, t.CAMERA_FOV, t.LAYOUT_CRT, t.LAYOUT_RAIL, t.LAYOUT_DECK,
      t.CRT_MARGIN_X, t.PAUSE_ZONE_W, t.CRT_RES_W, t.CRT_RES_H,
      t.CONTROL_TILT, t.CRT_TILT, t.BALL_W, t.RING_W, t.LAYOUT_DISPLAY,
      t.TERMINAL_ASPECT_MIN, t.TERMINAL_ASPECT_MAX, t.BUTTON_PRESS_DEPTH,
    ].join('|');
    if (key === this.layoutKey) return;
    this.layoutKey = key;

    this.layout = computeLayout(vw, vh);
    // Render pixels per CSS px: the terminal body's short side gets RENDER_SCALE_SHORT
    // pixels, so pixel size and labels look the same on phones and desktops.
    const scale = t.RENDER_SCALE_SHORT / Math.min(this.layout.body.w, this.layout.body.h);
    renderer.setPixelRatio(1);
    renderer.setSize(Math.max(1, Math.round(vw * scale)), Math.max(1, Math.round(vh * scale)), false);

    // Straight-on camera: the z=0 face maps linearly to CSS px.
    const k = this.layout.worldWidth / this.layout.body.w; // world units per CSS px
    const dist = (vh * k) / 2 / Math.tan(THREE.MathUtils.degToRad(t.CAMERA_FOV) / 2);
    const bodyCx = this.layout.body.x + this.layout.body.w / 2;
    const bodyCy = this.layout.body.y + this.layout.body.h / 2;
    const cx = (vw / 2 - bodyCx) * k;
    const cy = -(vh / 2 - bodyCy) * k;
    this.camBase.set(cx, cy, dist);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(cx, cy, 0);
    this.camera.fov = t.CAMERA_FOV;
    this.camera.aspect = vw / vh;
    // A close near plane: ejected cartridges fly almost into the lens (spec §9.3).
    this.camera.near = CAMERA_NEAR;
    this.camera.far = dist + 10;
    this.camera.updateProjectionMatrix();
    this.rail.setCamera(this.camera.position);

    // The picture is drawn 1:1 with the glass's render pixels; CRT_RES only sets
    // its aspect. A fixed resolution stretched onto the glass by a fraction
    // made lines uneven and soft.
    const glass = glassRect(this.layout, t.CRT_RES_W / t.CRT_RES_H);
    this.crtPx.w = Math.max(16, Math.round(glass.w * scale));
    this.crtPx.h = Math.max(16, Math.round(glass.h * scale));
    this.battle.setSize(this.crtPx.w, this.crtPx.h);
    this.hud.setSize(this.crtPx.w, this.crtPx.h);
    const texel = k / scale; // world size of one render pixel
    this.housing.build(this.layout, texel, this.crtPx.w / this.crtPx.h);
    this.rail.build(this.layout, texel);
    this.placeChipDisplay();
    this.hitZones.build(this.layout);
    this.deck.build(this.layout);
    const tb = rectToWorld(this.layout, this.layout.zones.trackball);
    // Sizes are shares of the body width, so the ball and the ring keep their
    // proportions on any screen (spec §10.1).
    // A little above centre: the tilted panel's lower edge comes toward the camera and grows.
    this.trackball.build(tb.cx, tb.cy + tb.h * 0.1, this.layout.worldWidth);
    const r = this.trackball.ring3;
    // The yellow traces run on up and pass under the screen: the panel leans
    // back, so their far end disappears behind the glass and its frame.
    const glassW = rectToWorld(this.layout, glass);
    this.pcb.build(this.rail.slotEdges(), r.x, r.y, (r.inner + r.outer) / 2, glassW.cy - glassW.h / 2 + UNDER_SCREEN);
    this.placeMounts();
    this.lighting.build(this.layout);
  }

  /** Leans the tilted panels; pivots are kept for the hit-rect projection. */
  private placeMounts(): void {
    const t = tuning.terminal;
    const crt = rectToWorld(this.layout, this.layout.crt);
    const rail = rectToWorld(this.layout, this.layout.rail);
    const deck = rectToWorld(this.layout, this.layout.deck);
    // The screen leans back about its lower edge. The control panel is one
    // plane: its top edge leans away from the player, like the control panel
    // of an arcade cabinet. It turns about its middle, so the lower edge does
    // not swing out of the frame.
    this.pivots.crt = crt.cy - crt.h / 2;
    this.pivots.control = (rail.cy + rail.h / 2 + deck.cy - deck.h / 2) / 2;
    this.crtMount.set(THREE.MathUtils.degToRad(t.CRT_TILT), this.pivots.crt);
    this.controlMount.set(THREE.MathUtils.degToRad(t.CONTROL_TILT), this.pivots.control);
  }

  /**
   * Which organ is under a screen point. Every zone lies on the tilted control
   * panel, so it is projected through the camera (spec §3.1).
   */
  private zoneAt(x: number, y: number): ZoneId | null {
    const { w: vw, h: vh } = this.layout.viewport;
    this.camera.updateMatrixWorld();
    const tilt = THREE.MathUtils.degToRad(tuning.terminal.CONTROL_TILT);
    for (const id of ZONE_ORDER) {
      const world = rectToWorld(this.layout, this.layout.zones[id]);
      mountCorners(world, tilt, this.pivots.control, this.corners);
      if (rectContains(screenBounds(this.corners, this.camera, vw, vh), x, y)) return id;
    }
    return null;
  }

  /** Shakes the whole cabinet (the camera); a stronger shake wins over a weaker one. */
  private shakeCabinet(strength: number): void {
    const left = this.camShakeLeft / CAM_SHAKE_TIME;
    if (strength < this.camShake * left) return;
    this.camShake = strength;
    this.camShakeLeft = CAM_SHAKE_TIME;
  }

  private updateCabinetShake(dt: number): void {
    this.camShakeLeft = Math.max(0, this.camShakeLeft - dt);
    const k = this.camShakeLeft / CAM_SHAKE_TIME;
    const a = this.camShake * k * k;
    const t = this.time * 60;
    this.camera.position.set(
      this.camBase.x + Math.sin(t * 1.9) * a,
      this.camBase.y + Math.cos(t * 2.3) * a,
      this.camBase.z,
    );
  }

  onEvent(e: SimEvent, world: World): void {
    if (e.type === 'chipUsed') {
      this.crt.flash();
      const shape = CHIPS[e.defId].shape.t;
      this.shakeCabinet(shape === 'near' ? SHAKE.sword : SHAKE.chip);
    }
    if (e.type === 'chipChainCancelled') this.rail.flashCancelled(e.chips);
    if (e.type === 'bombLanded') this.shakeCabinet(SHAKE.bomb);
    if (e.type === 'damaged' && e.targetId !== PLAYER_ID && e.amount > 0) this.crt.edgeFlash(EDGE_HIT, EDGE.hit);
    // A kill is the big beat: bright edges, a flash and a jolt of the cabinet.
    if (e.type === 'enemyKilled') {
      this.crt.edgeFlash(EDGE_KILL, EDGE.kill);
      this.crt.flash();
      this.shakeCabinet(SHAKE.kill);
    }
    // A hit shakes the picture, not the cabinet (spec §5.3).
    if (e.type === 'damaged' && e.targetId === PLAYER_ID) {
      this.crt.shake();
      this.hpHitLeft = HP_HIT_TIME;
      // The hit reaches out of the screen: red light floods the cabinet.
      this.crt.edgeFlash(EDGE_HURT, EDGE.hurt);
      this.lighting.flashAlarm();
      this.shakeCabinet(SHAKE.playerHit);
    }
    // Waves (GDD §10.4): the banner rides the flight, the landing jolts the cabinet.
    if (e.type === 'stateChanged' && e.to === 'WAVE_INTRO') {
      this.showWaveBanner(world, tuning.wave.FLIGHT_TIME + tuning.wave.SPAWN_TIME);
    }
    if (e.type === 'waveSpawned') {
      this.crt.flash();
      this.shakeCabinet(SHAKE.chip);
    }
    const f = floaterFromEvent(e);
    if (f) this.floaters.add(f, world.uiTick);
  }

  setHitZonesVisible(v: boolean): void {
    this.hitZones.group.visible = v;
  }

  /** A new World started: cartridges of the old one vanish without animation. */
  resetWorld(): void {
    this.rail.reset();
    this.floaters.clear();
    const world = this.opts.session.world;
    if (world.state === 'BATTLE_INTRO') this.showWaveBanner(world, tuning.fx.INTRO_TIME + WAVE1_BANNER_HOLD);
    else this.waveBanner.hide();
  }

  /** "Wave N" over the whole terminal; single-wave battles (tutorial, debug) show none. */
  private showWaveBanner(world: World, seconds: number): void {
    if (world.waveCount < 2) {
      this.waveBanner.hide();
      return;
    }
    this.waveBanner.show(t('banner.wave', { n: world.waveIndex + 1 }), seconds);
  }

  render(world: World, alpha: number, dt: number): void {
    const { renderer, sceneRenderer, perf } = this.opts;
    this.resize();
    this.time += dt;
    this.hpHitLeft = Math.max(0, this.hpHitLeft - dt);
    renderer.info.reset();

    const screen = this.battle.render(sceneRenderer, world, alpha, dt);
    this.crt.setScreen(screen, this.battle.width, this.battle.height);
    this.crt.update(dt);
    const hint = this.opts.session.tutorialHint();
    this.syncRail(world, hint);
    this.syncMenu();
    const menu = this.menu ? { spec: this.menu, cursor: this.menuCursor } : null;
    const marks = this.fieldMarks(world, alpha);
    const status = menu ? null : this.battleStatus(world);
    this.hud.draw({ labels: marks.labels, hp: marks.hp, status, menu, hint: hint?.line ?? null }, this.time);

    this.rail.update(dt);
    this.syncIndicators(dt);
    this.deck.update(dt);
    this.pcb.update(dt, world.chips.hand.map((_, i) => {
      const state = world.chips.slotState(i);
      return this.opts.session.screen === 'BATTLE' && world.state === 'ACTION' && (state === 'queued' || state === 'committed');
    }));
    this.trackball.update(dt, this.trackballArmed(world));
    this.updateCabinetShake(dt);

    renderer.setRenderTarget(null);
    renderer.setClearColor(TERMINAL_CLEAR_COLOR, 1);
    renderer.render(this.scene, this.camera);
    this.renderWaveBanner(dt);

    renderer.getSize(this.size);
    perf.setGpu(renderer.info.render.calls, renderer.info.render.triangles, this.battle.bytes, this.size.x, this.size.y);
  }

  /** The banner sits over everything, in the upper part of the CRT. */
  private renderWaveBanner(dt: number): void {
    const { w: vw, h: vh } = this.layout.viewport;
    const crt = this.layout.crt;
    this.waveBanner.update(dt, {
      aspect: vw / vh,
      centerX: (2 * (crt.x + crt.w / 2)) / vw - 1,
      crtTop: 1 - (2 * crt.y) / vh,
      crtHeight: (2 * crt.h) / vh,
      bodyShare: this.layout.body.w / vw,
    });
    if (!this.waveBanner.visible) return;
    const { renderer } = this.opts;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.waveBanner.scene, this.waveBanner.camera);
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    for (const c of this.cleanups) c();
    this.battle.dispose();
    this.waveBanner.dispose();
  }

  private mode() {
    return terminalMode(this.opts.session.screen, this.opts.session.world.state);
  }

  /**
   * A control goes down. `send` is false for keyboard presses: the keyboard
   * device already sends the command, the terminal only shows it.
   */
  private press(zone: ZoneId, send: boolean): void {
    void send; // A press is only the visual reaction; commands come from act().
    if (zone === 'trackball') this.trackball.press();
    else if (zone === 'pause') this.deck.key(zone).press(false);
    this.updateCursor();
  }

  /**
   * A control acts: the pause key on press, the trackball on release, when the
   * gesture turned out to be a tap rather than a step (spec §10.2).
   */
  private act(zone: ZoneId, send: boolean, x = -1, y = -1): void {
    const world = this.opts.session.world;
    const { handlers } = this.opts;
    if (zone === 'pause') {
      if (send) handlers.pause();
      this.updateCursor();
      return;
    }
    if (zone === 'rail') {
      // The rail acts on press: unlike a trackball gesture there is nothing to
      // tell it apart from, so waiting for the release would only add lag.
      const slot = this.railSlotAt(x, y);
      if (slot >= 0 && send) handlers.selectChip(slot);
      this.updateCursor();
      return;
    }
    if (this.mode() === 'MENU') {
      // Menus are driven only by the terminal, so keyboard taps act too.
      this.activateMenu();
      this.updateCursor();
      return;
    }
    // A refused shot sends nothing; the dark ring already said so.
    if (send && shotAvailability(world) === 'ok') handlers.execute();
    this.updateCursor();
  }

  private release(zone: ZoneId): void {
    if (zone === 'trackball') this.trackball.release();
    else if (zone === 'pause') this.deck.key(zone).release();
    this.updateCursor();
  }

  /** Which rail slot a screen point hits, or -1 (spec §11.2). */
  private railSlotAt(x: number, y: number): number {
    if (x < 0) return -1;
    const { w: vw, h: vh } = this.layout.viewport;
    this.camera.updateMatrixWorld();
    const tilt = THREE.MathUtils.degToRad(tuning.terminal.CONTROL_TILT);
    return railZoneSlots(this.layout).findIndex((r) => {
      mountCorners(rectToWorld(this.layout, r), tilt, this.pivots.control, this.corners);
      return rectContains(screenBounds(this.corners, this.camera, vw, vh), x, y);
    });
  }

  private hover(zone: ZoneId | null): void {
    if (zone === this.hovered) return;
    if (this.hovered) this.hoverVisual(this.hovered, false);
    this.hovered = zone;
    if (zone && acceptsPress(this.mode(), zone)) this.hoverVisual(zone, true);
    this.updateCursor();
  }

  private hoverVisual(zone: ZoneId, on: boolean): void {
    if (zone === 'trackball') this.trackball.hover(on);
    else if (zone === 'pause') this.deck.key(zone).hover(on);
  }

  private updateCursor(): void {
    if (!this.fineCursor) return;
    const zone = this.hovered && acceptsPress(this.mode(), this.hovered) ? this.hovered : null;
    const css = cursorCss(cursorKind(zone !== null, this.router.anyCaptured));
    if (css !== this.cursor) {
      this.cursor = css;
      this.opts.renderer.domElement.style.cursor = css;
    }
  }

  /** In battle the rail is the hand: one slot per chip, states from the sim. */
  private syncRail(world: World, hint: TutorialHint | null): void {
    const chips = world.chips;
    // Chips live only inside a battle: when it is won or lost every cartridge
    // flies out at once, and between battles the rail stays empty (2026-09-19).
    const screen = this.opts.session.screen;
    const inBattle = (screen === 'BATTLE' || screen === 'PAUSED') && world.state !== 'BATTLE_WON' && world.state !== 'PLAYER_DEAD';
    const cooldown = inBattle ? chips.handCooldownProgress(world.playerTick) : null;
    this.rail.setAttract(this.mode() === 'BATTLE');
    this.rail.syncHand(chips.hand.map((chip, i) => {
      const state = inBattle ? chips.slotState(i) : 'empty';
      return {
        chip: inBattle ? (chip ?? chips.pendingChip(i)) : null,
        state,
        cooldown: cooldownForSlot(state, cooldown),
        order: inBattle ? chips.queuePosition(i) : 0,
      };
    }));
    const toEntry = (def: (typeof CHIPS)[keyof typeof CHIPS]): ChipDisplayEntry => ({
      name: chipName(def.id),
      power: def.power,
      heal: def.heal,
      hits: def.hits,
    });
    const queued = !inBattle || this.mode() === 'MENU' ? null : chips.attackChips()[0] ?? null;
    const shown = world.activeChip?.def ?? (queued ? CHIPS[queued.defId] : null);
    // The segment display prefers a tutorial hint over the usual "select a chip" fallback.
    const hintSeg = hint?.seg ?? null;
    const fallback = hintSeg ?? (inBattle ? t('hud.selectChip') : '');
    this.chipDisplay.set(comboDisplayModel(shown ? toEntry(shown) : null, fallback, world.comboDisplayActive));

    const focus = hint?.focus ?? null;
    this.rail.setHintPulse(focus === 'chip');
    this.trackball.setHintPulse(focus === 'move' || focus === 'fire');
  }

  /** HP numbers above each enemy and rising damage numbers, in CRT pixels. */
  private fieldMarks(world: World, alpha: number): { labels: HudLabel[]; hp: HpTag[] } {
    const { sceneRenderer } = this.opts;
    const W = this.battle.width;
    const H = this.battle.height;
    const labels: HudLabel[] = [];
    const hp: HpTag[] = [];
    for (const e of world.enemies) {
      if (!e.alive) continue;
      const p = sceneRenderer.actorTopTargetPos(e.id);
      if (!p) continue;
      hp.push({ x: p.x * W, y: p.y * H - HP_BAR_GAP, hp: Math.max(0, Math.ceil(e.hp)), level: e.level });
    }
    const life = secondsToTicks(tuning.fx.DAMAGE_NUMBER_TIME);
    for (const { f, k } of this.floaters.live(world.uiTick, alpha, life)) {
      // The number flickers out at the end instead of fading (flat colours only).
      if (k > FLOATER_FLICKER && Math.floor(world.uiTick / 3) % 2 === 1) continue;
      // Ease-out rise with a small hop at the start: the number is thrown out of the hit.
      const rise = 1 - (1 - k) * (1 - k);
      const hop = Math.sin(Math.min(1, k / 0.3) * Math.PI) * 0.15;
      const p = sceneRenderer.cellTargetPos(f.x, f.y, FLOATER_HEIGHT + FLOATER_RISE * rise + hop);
      const base = tuning.battleVisual.DAMAGE_SCALE + (f.kind === 'playerDamage' ? 1 : 0);
      const scale = base + (k < FLOATER_POP ? 1 : 0);
      // Damage to the player trembles for a moment.
      const shake = f.kind === 'playerDamage' && k < FLOATER_SHAKE ? (Math.floor(world.uiTick / 2) % 2 === 0 ? 2 : -2) : 0;
      labels.push({ text: f.text, x: p.x * W + shake, y: p.y * H, tone: f.kind, scale });
    }
    return { labels, hp };
  }

  /** Session menu for the current screen; a new menu starts at its first item. */
  private syncMenu(): void {
    const spec = menuFor(this.opts.session);
    if (spec?.key !== this.menu?.key) {
      this.menuCursor = 0;
      this.menuPresses.clear();
    }
    this.menu = spec;
  }

  private moveMenu(dir: Dir): void {
    if (!this.menu || (dir !== 'up' && dir !== 'down')) return;
    this.menuCursor = moveCursor(this.menuCursor, dir, this.menu.items.length);
  }

  private activateMenu(): void {
    const item = this.menu?.items[this.menuCursor];
    if (item) this.opts.handlers.menu(item.action);
  }

  /** Menu item under a CSS point on the CRT glass, or -1. */
  private menuItemAtCss(x: number, y: number): number {
    if (!this.menu) return -1;
    const g = glassRect(this.layout, this.crtPx.w / this.crtPx.h);
    if (!rectContains(g, x, y)) return -1;
    const { w, h } = this.crtPx;
    const layout = menuLayout(this.menu, w, h, this.menuCursor);
    return menuItemAt(layout, ((x - g.x) / g.w) * w, ((y - g.y) / g.h) * h);
  }

  private menuDown(id: number, x: number, y: number): boolean {
    if (this.mode() !== 'MENU') return false;
    const item = this.menuItemAtCss(x, y);
    if (item < 0) return false;
    this.menuCursor = item;
    this.menuPresses.set(id, item);
    return true;
  }

  private menuUp(id: number, x: number, y: number): void {
    const item = this.menuPresses.get(id);
    this.menuPresses.delete(id);
    if (item !== undefined && item === this.menuItemAtCss(x, y) && this.mode() === 'MENU') this.activateMenu();
  }

  /** Keyboard keys press the same controls; in menus they also navigate. */
  private attachKeyVisuals(): () => void {
    const held = new Set<string>();
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || held.has(e.code) || e.target instanceof HTMLInputElement) return;
      const code = e.code === 'Enter' && this.mode() === 'MENU' ? 'Space' : e.code;
      const organ = organForKey(code);
      if (!organ || !acceptsPress(this.mode(), organ.zone)) return;
      held.add(e.code);
      if (organ.dir && this.mode() === 'MENU') this.moveMenu(organ.dir);
      this.press(organ.zone, false);
      // The keyboard device sends the command itself; the terminal animates the
      // ball and, in menus, still has to pick the item.
      if (organ.fire) this.act(organ.zone, false);
      if (organ.dir) this.trackball.step(organ.dir);
      if (code === 'Space') e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => {
      if (!held.delete(e.code)) return;
      const organ = organForKey(e.code === 'Enter' ? 'Space' : e.code);
      if (organ) this.release(organ.zone);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }

  /** The player's HP for the bottom-left corner of the picture. */
  private battleStatus(world: World): HudStatus {
    return {
      hp: world.player.hp,
      hpLow: world.player.maxHp > 0 && world.player.hp <= world.player.maxHp * HP_LOW_SHARE,
      hpHit: this.hpHitLeft > 0,
    };
  }

  /** The ring burns while a tap on the ball would act (spec §10.2). */
  private trackballArmed(world: World): boolean {
    return trackballArmed(this.mode(), shotAvailability(world));
  }

  /** The segment display is centred in the frontal lower frame of the CRT. */
  private placeChipDisplay(): void {
    const row = rectToWorld(this.layout, this.layout.display);
    const h = Math.min(row.h * 0.92, (row.w * 0.96) / this.chipDisplay.aspect) * CHIP_DISPLAY_SCALE;
    this.chipDisplay.place(row.cx + (h * this.chipDisplay.aspect) / 2, row.cy + row.h * 0.025, h);
    this.chipDisplay.group.position.z = 0.23;
  }

  /** Drives the lights that stand in for the cabinet's old indicators (spec §4). */
  private syncIndicators(dt: number): void {
    const active = this.rail.activePosition(this.activeChipAt);
    // The rail lies on the tilted panel: the light needs the cartridge in world space.
    if (active) this.rail.group.localToWorld(this.activeChipAt);
    this.lighting.setChipAt(active ? this.activeChipAt : null);
    this.lighting.update(0, active, dt);
  }
}
