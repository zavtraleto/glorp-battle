import * as THREE from 'three';
import type { Session } from '../app/session';
import { secondsToTicks, tuning } from '../config/tuning';
import type { Dir } from '../core/input/commands';
import type { PerfProbe } from '../debug/perfProbe';
import type { SceneRenderer } from '../render/scene';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import {
  acceptsPress,
  cursorKind,
  shotAvailability,
  organForKey,
  stepFocus,
  trayKeyAction,
} from './controlRules';
import { BattleTarget } from './crt/battleTarget';
import { CrtCanvas } from './crt/crtCanvas';
import { CrtMaterial } from './crt/crtMaterial';
import { PLAYER_ID } from '../sim/player';
import { FloaterList, floaterFromEvent } from './crt/floaters';
import { EMPTY_HUD, type HpBar, type HudLabel, type HudStatus } from './crt/hudModel';
import { hpSegments } from '../render/battleSignals';
import { menuFor, menuItemAt, menuLayout, moveCursor, type MenuAction, type MenuSpec } from './crt/menuModel';
import { trayLayout, trayTargetAt, type TrayLayout, type TrayTarget } from './chips/trayLayout';
import { cursorCss } from './interaction/cursor';
import { attachPointers } from './interaction/pointerEvents';
import { TrayInput } from './interaction/trayInput';
import { PointerRouter } from './interaction/pointerRouter';
import {
  computeLayout,
  cssToWorld,
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
import { ChipTray, type HandCellState } from './parts/chipTray';
import { HitZones } from './parts/hitZones';
import { Housing } from './parts/housing';
import { DarkLighting } from './parts/lighting';
import { DrawStrip } from './parts/drawStrip';
import { Mount } from './parts/mount';
import { mountCorners, screenBounds } from './interaction/project';
import { Trackball } from './parts/trackball';
import { terminalMode } from './terminalMode';
import type { TraySource } from '../app/reward';
import { chipName, t as tr } from '../i18n';

// NET-01 terminal (TERMINAL.md §13). Owns the terminal scene and camera, draws
// the battle and the HUD into the CRT and the terminal into a low-resolution
// canvas that CSS upscales without smoothing.

const TERMINAL_CLEAR_COLOR = 0x000000;
/** HP at or below this share of the maximum turns the number amber. */
const HP_LOW_SHARE = 0.25;
/** How long the HP number blinks after a hit, seconds. */
const HP_HIT_TIME = 0.5;
/** Parallax follow rate, 1/s. */
const PARALLAX_RATE = 6;
/** The tray takes input once it is this far open. */
const TRAY_READY = 0.95;
/** Hand cartridges per tray row (keyboard up/down step). */
const TRAY_COLUMNS = 5;
/** Damage numbers: start height and rise (world units), flicker after this share of their life. */
const FLOATER_HEIGHT = 0.5;
const FLOATER_RISE = 0.5;
const FLOATER_FLICKER = 0.7;
/** HP segments sit this many CRT pixels above an enemy's head. */
const HP_BAR_GAP = 3;

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
  private readonly tray = new ChipTray();
  private readonly trayInput: TrayInput;
  private trayGeom: TrayLayout | null = null;
  private trayGeomKey = '';
  private focusSlot = -1;
  private trayHover = false;
  private trayDragging = false;
  private selectedBefore = new Set<number>();
  private menu: MenuSpec | null = null;
  private menuCursor = 0;
  private readonly menuPresses = new Map<number, number>();
  private readonly floaters = new FloaterList();
  private readonly hitZones = new HitZones();
  private readonly deck = new DeckControls();
  private readonly trackball = new Trackball();
  private readonly lighting = new DarkLighting();
  private readonly drawStrip = new DrawStrip();
  private readonly crtMount = new Mount();
  private readonly railMount = new Mount();
  private readonly deckMount = new Mount();
  /** Pivot line of each tilted mount, world y (spec §3.1). */
  private readonly pivots = { crt: 0, rail: 0, deck: 0 };
  private readonly corners: THREE.Vector3[] = [];
  private readonly activeChipAt = new THREE.Vector3();
  private hpHitLeft = 0;
  private readonly battle: BattleTarget;
  private readonly router: PointerRouter;
  private readonly cleanups: (() => void)[] = [];
  private readonly size = new THREE.Vector2();
  private readonly fineCursor = window.matchMedia?.('(pointer: fine)').matches ?? false;
  private readonly camBase = new THREE.Vector3();
  private readonly parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  private hovered: ZoneId | null = null;
  private cursor = '';
  private time = 0;
  private layoutKey = '';

  constructor(private opts: TerminalOptions) {
    const { renderer, container } = opts;
    renderer.domElement.id = 'terminal-canvas';
    container.appendChild(renderer.domElement);
    // Several render passes per frame: counters are reset manually in render().
    renderer.info.autoReset = false;
    this.battle = new BattleTarget(renderer);
    this.crt.setHud(this.hud.texture);

    this.crtMount.inner.add(this.housing.crtGroup);
    this.railMount.inner.add(this.rail.group, this.drawStrip.group);
    this.deckMount.inner.add(this.trackball.group);
    this.scene.add(
      this.lighting.group,
      this.housing.group,
      this.crtMount,
      this.railMount,
      this.deckMount,
      this.tray.group,
      this.hitZones.group,
      this.deck.group,
    );

    this.layout = computeLayout(container.clientWidth, container.clientHeight);
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
      hover: (z, x, y) => this.hover(z, x, y),
    });
    this.trayInput = this.makeTrayInput();
    const tray = this.trayInput;
    this.cleanups.push(
      this.router.attach(renderer.domElement),
      attachPointers(renderer.domElement, {
        down: (id, x, y) => {
          const hit = tray.down(id, x, y);
          if (hit) this.updateCursor();
          return hit;
        },
        move: (id, x, y) => tray.move(id, x, y),
        up: (id, x, y) => {
          tray.up(id, x, y);
          this.updateCursor();
        },
        cancelAll: () => tray.cancelAll(),
        isCaptured: (id) => tray.isCaptured(id),
        hover: (x, y) => this.trayHoverAt(x, y),
      }),
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
  }

  /** Rebuilds layout, canvas size and meshes when the viewport or layout tunables change. */
  resize(): void {
    const { container, renderer } = this.opts;
    const t = tuning.terminal;
    const vw = Math.max(1, container.clientWidth);
    const vh = Math.max(1, container.clientHeight);
    const key = [
      vw, vh, t.RENDER_SCALE_SHORT, t.CAMERA_FOV, t.LAYOUT_TOP, t.LAYOUT_CRT, t.LAYOUT_RAIL, t.LAYOUT_DECK,
      t.CRT_MARGIN_X, t.PAUSE_ZONE_W, t.CRT_RES_W, t.CRT_RES_H,
      t.DECK_TILT, t.RAIL_TILT, t.CRT_TILT, t.BALL_W, t.RING_W, t.RING_SEGMENTS, t.LAYOUT_DRAW,
      tuning.chips.DRAW_PREVIEW,
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
    this.camBase.set((vw / 2 - bodyCx) * k, -(vh / 2 - bodyCy) * k, dist);
    this.camera.fov = t.CAMERA_FOV;
    this.camera.aspect = vw / vh;
    this.camera.near = Math.max(0.1, dist - 10);
    this.camera.far = dist + 10;
    this.placeCamera();
    this.camera.updateProjectionMatrix();

    this.battle.setSize(t.CRT_RES_W, t.CRT_RES_H);
    this.hud.setSize(t.CRT_RES_W, t.CRT_RES_H);
    const texel = k / scale; // world size of one render pixel
    this.housing.build(this.layout, texel, t.CRT_RES_W / t.CRT_RES_H);
    this.rail.build(this.layout, texel);
    this.drawStrip.build(this.layout, tuning.chips.DRAW_PREVIEW);
    this.tray.build(this.layout, texel);
    this.trayGeomKey = '';
    this.hitZones.build(this.layout);
    this.deck.build(this.layout);
    const tb = rectToWorld(this.layout, this.layout.zones.trackball);
    // Sizes are shares of the body width, so the ball and the ring keep their
    // proportions on any screen (spec §10.1).
    this.trackball.build(tb.cx, tb.cy - tb.h * 0.06, this.layout.worldWidth);
    this.placeMounts();
    this.lighting.build(this.layout);
  }

  /** Leans the tilted panels; pivots are kept for the hit-rect projection. */
  private placeMounts(): void {
    const t = tuning.terminal;
    const crt = rectToWorld(this.layout, this.layout.crt);
    const rail = rectToWorld(this.layout, this.layout.rail);
    const deck = rectToWorld(this.layout, this.layout.deck);
    // The screen leans back about its lower edge; the rail and the deck lean
    // their lower edge toward the player, like an arcade control panel.
    this.pivots.crt = crt.cy - crt.h / 2;
    this.pivots.rail = rail.cy + rail.h / 2;
    this.pivots.deck = deck.cy + deck.h / 2;
    this.crtMount.set(THREE.MathUtils.degToRad(t.CRT_TILT), this.pivots.crt);
    this.railMount.set(THREE.MathUtils.degToRad(t.RAIL_TILT), this.pivots.rail);
    this.deckMount.set(THREE.MathUtils.degToRad(t.DECK_TILT), this.pivots.deck);
  }

  /**
   * Which organ is under a screen point. Zones are projected through the live
   * camera because the deck is tilted and the camera moves (spec §3.1).
   */
  private zoneAt(x: number, y: number): ZoneId | null {
    const { w: vw, h: vh } = this.layout.viewport;
    this.camera.updateMatrixWorld();
    for (const id of ZONE_ORDER) {
      const world = rectToWorld(this.layout, this.layout.zones[id]);
      const tilt = id === 'trackball' ? THREE.MathUtils.degToRad(tuning.terminal.DECK_TILT) : 0;
      const pivot = id === 'trackball' ? this.pivots.deck : 0;
      mountCorners(world, tilt, pivot, this.corners);
      if (rectContains(screenBounds(this.corners, this.camera, vw, vh), x, y)) return id;
    }
    return null;
  }

  onEvent(e: SimEvent, world: World): void {
    if (e.type === 'chipUsed') this.crt.flash();
    // Refresh is the beat that replaces the old Custom Screen pause (spec §11.4).
    if (e.type === 'handRefreshed') {
      this.crt.flash();
      this.trackball.pulse();
    }
    // A hit shakes the picture, not the cabinet (spec §5.3).
    if (e.type === 'damaged' && e.targetId === PLAYER_ID) {
      this.crt.shake();
      this.hpHitLeft = HP_HIT_TIME;
    }
    const f = floaterFromEvent(e);
    if (f) this.floaters.add(f, world.tick);
  }

  setHitZonesVisible(v: boolean): void {
    this.hitZones.group.visible = v;
  }

  /** A new World started: cartridges of the old one vanish without animation. */
  resetWorld(): void {
    this.rail.reset();
    this.floaters.clear();
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
    const source = this.traySource();
    this.syncTray(world, source);
    const focused = source ? source.hand[this.focusSlot] : null;
    const info = focused ? { defId: focused.defId, code: focused.code } : null;
    this.syncMenu();
    const menu = this.menu ? { spec: this.menu, cursor: this.menuCursor } : null;
    const marks = source ? EMPTY_HUD : this.fieldMarks(world, alpha);
    const title = this.opts.session.screen === 'REWARD' ? tr('reward.title') : null;
    const status = menu || source ? null : this.battleStatus(world);
    this.hud.draw({ labels: marks.labels, bars: marks.bars, status, info, menu, title }, this.time);

    this.rail.update(dt);
    this.syncIndicators(world);
    this.tray.update(dt);
    const slide = -this.tray.openness * this.tray.slideDistance;
    this.trackball.group.position.y = slide;
    this.deck.update(dt);
    // The ring shows how close the next Refresh is (spec §11.4).
    const chips = this.opts.session.world.chips;
    this.trackball.update(dt, chips.usedSinceRefresh / Math.max(1, tuning.chips.REFRESH_AT), this.time);
    this.updateParallax(dt);

    renderer.setRenderTarget(null);
    renderer.setClearColor(TERMINAL_CLEAR_COLOR, 1);
    renderer.render(this.scene, this.camera);

    renderer.getSize(this.size);
    perf.setGpu(renderer.info.render.calls, renderer.info.render.triangles, this.battle.bytes, this.size.x, this.size.y);
  }

  dispose(): void {
    for (const c of this.cleanups) c();
    this.battle.dispose();
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
    // A refused shot blinks the ring red instead of sending anything.
    if (shotAvailability(world) !== 'ok') this.trackball.deny();
    else if (send) handlers.execute();
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
    const tilt = THREE.MathUtils.degToRad(tuning.terminal.RAIL_TILT);
    return railZoneSlots(this.layout).findIndex((r) => {
      mountCorners(rectToWorld(this.layout, r), tilt, this.pivots.rail, this.corners);
      return rectContains(screenBounds(this.corners, this.camera, vw, vh), x, y);
    });
  }

  private hover(zone: ZoneId | null, x: number, y: number): void {
    if (zone !== this.hovered) {
      if (this.hovered) this.hoverVisual(this.hovered, false);
      this.hovered = zone;
      if (zone && acceptsPress(this.mode(), zone)) this.hoverVisual(zone, true);
      this.updateCursor();
    }
    if (this.fineCursor && x >= 0) {
      const { w, h } = this.layout.viewport;
      this.parallax.tx = (x / w - 0.5) * 2;
      this.parallax.ty = (y / h - 0.5) * 2;
    } else {
      this.parallax.tx = 0;
      this.parallax.ty = 0;
    }
  }

  private hoverVisual(zone: ZoneId, on: boolean): void {
    if (zone === 'trackball') this.trackball.hover(on);
    else if (zone === 'pause') this.deck.key(zone).hover(on);
  }

  private updateCursor(): void {
    if (!this.fineCursor) return;
    const zone = this.hovered && acceptsPress(this.mode(), this.hovered) ? this.hovered : null;
    const pointing = zone !== null || this.trayHover;
    const css = cursorCss(cursorKind(pointing, this.router.anyCaptured || this.trayDragging));
    if (css !== this.cursor) {
      this.cursor = css;
      this.opts.renderer.domElement.style.cursor = css;
    }
  }

  private updateParallax(dt: number): void {
    const p = this.parallax;
    const k = 1 - Math.exp(-dt * PARALLAX_RATE);
    p.x += (p.tx - p.x) * k;
    p.y += (p.ty - p.y) * k;
    this.placeCamera();
  }

  /** Base straight-on camera, tilted toward the mouse by up to PARALLAX_DEG. */
  private placeCamera(): void {
    const b = this.camBase;
    const deg = this.fineCursor ? tuning.terminal.PARALLAX_DEG : 0;
    const off = b.z * Math.tan(THREE.MathUtils.degToRad(deg));
    this.camera.position.set(b.x + this.parallax.x * off, b.y - this.parallax.y * off, b.z);
    this.camera.lookAt(b.x, b.y, 0);
  }

  /** The tray only serves the reward pick now (roguelite spec §6.3). */
  private traySource(): TraySource | null {
    return this.opts.session.screen === 'REWARD' ? this.opts.session.reward : null;
  }

  /** Tray open state, hand cartridges, and the rail showing the selection (or the battle queue). */
  private syncTray(world: World, source: TraySource | null): void {
    const { session } = this.opts;
    this.tray.setOpen(source !== null);
    this.tray.setAddLabel(session.screen === 'REWARD' ? tr('tray.skip') : tr('custom.add'));
    if (source) {
      const hand = source.hand;
      const geomKey = `${hand.length}|${this.layoutKey}`;
      if (geomKey !== this.trayGeomKey || !this.trayGeom) {
        this.trayGeomKey = geomKey;
        this.trayGeom = trayLayout(this.layout, hand.length);
      }
      if (!hand[this.focusSlot]) this.focusSlot = hand.findIndex((c) => c !== null);
      this.tray.setFocus(this.focusSlot);
      const states: HandCellState[] = hand.map((c, i) =>
        !c ? 'empty' : source.isSelected(i) ? 'selected' : source.canSelect(i) ? 'ok' : 'dim',
      );
      const selected = new Set(source.selectedChips().map((c) => c.uid));
      this.tray.setHand(hand, states, this.trayGeom);
      // Chips pulled out of the rail start their way back from there.
      hand.forEach((c, i) => {
        if (!c || !this.selectedBefore.has(c.uid) || selected.has(c.uid)) return;
        const from = this.rail.cartPosition(c.uid);
        if (from) this.tray.flyFrom(i, from);
      });
      this.selectedBefore = selected;
    } else {
      this.selectedBefore.clear();
    }

    if (source) {
      const handIndex = (uid: number) => source.hand.findIndex((c) => c?.uid === uid);
      this.rail.sync(source.selectedChips(), {
        mode: 'select',
        burning: true,
        inHand: (uid) => handIndex(uid) >= 0,
        spawnFrom: (uid) => this.tray.cellPosition(handIndex(uid)),
      });
      return;
    }
    // In battle the rail is the hand: one slot per chip, states from the sim.
    const chips = world.chips;
    this.rail.syncHand(
      chips.hand.map((chip, i) => ({ chip, state: chips.slotState(i), order: chips.queuePosition(i) })),
    );
    this.drawStrip.set(chips.drawPreview(tuning.chips.DRAW_PREVIEW));
  }

  private trayReady(): boolean {
    return this.traySource() !== null && this.tray.openness > TRAY_READY;
  }

  private trayHoverAt(x: number, y: number): void {
    const source = this.traySource();
    const target =
      source && this.trayReady() && this.trayGeom && x >= 0
        ? trayTargetAt(this.layout, this.trayGeom, x, y, source.selection.length)
        : null;
    if (target?.kind === 'hand' && source?.hand[target.slot]) this.focusSlot = target.slot;
    const hover = target !== null;
    if (hover !== this.trayHover) {
      this.trayHover = hover;
      this.updateCursor();
    }
  }

  private makeTrayInput(): TrayInput {
    const src = () => this.traySource();
    const toWorld = (x: number, y: number) => {
      const p = cssToWorld(this.layout, x, y);
      return new THREE.Vector3(p.x, p.y, 0);
    };
    const railUid = (index: number) => src()?.selectedChips()[index]?.uid ?? null;
    return new TrayInput({
      layout: () => this.layout,
      tray: () => this.trayGeom ?? trayLayout(this.layout, src()?.hand.length ?? 0),
      selectedCount: () => src()?.selection.length ?? 0,
      canPick: (slot) => src()?.canSelect(slot) ?? false,
      enabled: () => this.trayReady(),
      select: (slot, index) => {
        if (!src()?.selectAt(slot, index)) this.tray.refuse(slot);
      },
      unselect: (index) => {
        src()?.unselect(index);
      },
      reorder: (from, to) => {
        const s = src();
        const slot = s?.selection[from];
        if (!s || slot === undefined || !s.unselect(from)) return;
        s.selectAt(slot, to);
      },
      refuse: (slot) => this.tray.refuse(slot),
      focus: (slot) => {
        this.focusSlot = slot;
      },
      keyDown: (k) => this.tray.keys[k].press(false),
      keyUp: (k, fire) => {
        this.tray.keys[k].release();
        if (!fire) return;
        if (k === 'ok') src()?.confirm();
        else src()?.add();
      },
      drag: (source: TrayTarget, x, y) => {
        this.trayDragging = true;
        if (source.kind === 'hand') this.tray.setDrag(source.slot, toWorld(x, y));
        else if (source.kind === 'rail') this.rail.setDrag(railUid(source.index), toWorld(x, y));
      },
      dragEnd: (source: TrayTarget) => {
        this.trayDragging = false;
        if (source.kind === 'hand') this.tray.setDrag(source.slot, null);
        else if (source.kind === 'rail') this.rail.setDrag(null, null);
      },
    });
  }

  /** HP segments above each enemy and rising damage numbers, in CRT pixels. */
  private fieldMarks(world: World, alpha: number): { labels: HudLabel[]; bars: HpBar[] } {
    const { sceneRenderer } = this.opts;
    const W = this.battle.width;
    const H = this.battle.height;
    const labels: HudLabel[] = [];
    const bars: HpBar[] = [];
    for (const e of world.enemies) {
      if (!e.alive) continue;
      const p = sceneRenderer.actorTopTargetPos(e.id);
      if (!p) continue;
      const seg = hpSegments(e.hp, e.maxHp, tuning.battleVisual.HP_SEGMENTS);
      bars.push({ x: p.x * W, y: p.y * H - HP_BAR_GAP, ...seg, level: e.level });
    }
    const life = secondsToTicks(tuning.fx.DAMAGE_NUMBER_TIME);
    for (const { f, k } of this.floaters.live(world.tick, world.simFrozen ? 0 : alpha, life)) {
      // The number flickers out at the end instead of fading (flat colours only).
      if (k > FLOATER_FLICKER && Math.floor(world.tick / 3) % 2 === 1) continue;
      const p = sceneRenderer.cellTargetPos(f.x, f.y, FLOATER_HEIGHT + FLOATER_RISE * k);
      labels.push({ text: f.text, x: p.x * W, y: p.y * H, tone: f.kind });
    }
    return { labels, bars };
  }

  /** Keyboard on the chip tray; returns true if the key was used. */
  private trayKey(code: string): boolean {
    const action = trayKeyAction(code, TRAY_COLUMNS);
    const source = this.traySource();
    if (!action || !source || !this.trayReady()) return false;
    const hand = source.hand;
    switch (action.kind) {
      case 'focus':
        this.focusSlot = stepFocus(Math.max(0, this.focusSlot), action.delta, hand.map((c) => c !== null));
        break;
      case 'pick':
        if (!source.selectAt(this.focusSlot, source.selection.length)) this.tray.refuse(this.focusSlot);
        break;
      case 'removeLast':
        source.cancelLast();
        break;
      case 'ok':
        this.tray.keys.ok.press(false);
        source.confirm();
        break;
      case 'add':
        this.tray.keys.add.press(false);
        source.add();
        break;
    }
    return true;
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
    const t = tuning.terminal;
    const g = glassRect(this.layout, t.CRT_RES_W / t.CRT_RES_H);
    if (!rectContains(g, x, y)) return -1;
    const layout = menuLayout(this.menu, t.CRT_RES_W, t.CRT_RES_H, this.menuCursor);
    return menuItemAt(layout, ((x - g.x) / g.w) * t.CRT_RES_W, ((y - g.y) / g.h) * t.CRT_RES_H);
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
      if (this.mode() === 'CHIP_SELECT') {
        if (this.trayKey(e.code)) e.preventDefault();
        return;
      }
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
      if (e.code === 'Enter') this.tray.keys.ok.release();
      if (e.code === 'KeyR') this.tray.keys.add.release();
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

  /** HP, the Refresh counter and the first queued chip, across the top of the picture. */
  private battleStatus(world: World): HudStatus {
    const next = world.chips.attackChips()[0];
    const total = Math.max(1, tuning.chips.REFRESH_AT);
    return {
      hp: world.player.hp,
      hpLow: world.player.maxHp > 0 && world.player.hp <= world.player.maxHp * HP_LOW_SHARE,
      hpHit: this.hpHitLeft > 0,
      gaugeLit: Math.min(total, world.chips.usedSinceRefresh),
      gaugeTotal: total,
      gaugeFull: world.chips.refreshDue,
      chip: next ? { name: chipName(next.defId).toUpperCase(), code: next.code } : null,
    };
  }

  /** Drives the lights that stand in for the cabinet's old indicators (spec §4). */
  private syncIndicators(world: World): void {
    const active = this.rail.activePosition(this.activeChipAt);
    this.lighting.setChipAt(active ? this.activeChipAt : null);
    this.lighting.update(world.chips.usedSinceRefresh / Math.max(1, tuning.chips.REFRESH_AT), active);
  }
}
