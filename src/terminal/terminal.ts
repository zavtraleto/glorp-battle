import * as THREE from 'three';
import type { Session } from '../app/session';
import { tuning } from '../config/tuning';
import type { Dir } from '../core/input/commands';
import type { PerfProbe } from '../debug/perfProbe';
import { t } from '../i18n';
import type { SceneRenderer } from '../render/scene';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import { acceptsPress, chipSelectAvailability, cursorKind, executeAvailability, organForKey } from './controlRules';
import { BattleTarget } from './crt/battleTarget';
import { CrtCanvas } from './crt/crtCanvas';
import { CrtMaterial } from './crt/crtMaterial';
import { gaugeLedCount, hpLedCount, hudModel } from './crt/hudModel';
import { trayLayout, trayTargetAt, type TrayLayout, type TrayTarget } from './chips/trayLayout';
import { cursorCss } from './interaction/cursor';
import { attachPointers } from './interaction/pointerEvents';
import { TrayInput } from './interaction/trayInput';
import { PointerRouter } from './interaction/pointerRouter';
import { computeLayout, cssToWorld, type TerminalLayout, type ZoneId } from './layout';
import { DeckControls } from './parts/deckControls';
import { Environment } from './parts/environment';
import { ChipRail, RAIL_SLOTS } from './parts/chipRail';
import { ChipTray, type HandCellState } from './parts/chipTray';
import { HitZones } from './parts/hitZones';
import { Housing } from './parts/housing';
import { Trackball } from './parts/trackball';
import { lampStates, terminalMode } from './terminalMode';

// NET-01 terminal (TERMINAL.md §13). Owns the terminal scene and camera, draws
// the battle and the HUD into the CRT and the terminal into a low-resolution
// canvas that CSS upscales without smoothing.

const TERMINAL_CLEAR_COLOR = 0x07080a;
const GAUGE_LEDS = 12;
const HP_LEDS = 10;
/** Parallax follow rate, 1/s. */
const PARALLAX_RATE = 6;
/** The tray takes input once it is this far open. */
const TRAY_READY = 0.95;

export interface TerminalHandlers {
  move(dir: Dir): void;
  execute(): void;
  chipSelect(): void;
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
  private readonly hitZones = new HitZones();
  private readonly deck = new DeckControls();
  private readonly trackball = new Trackball();
  private readonly environment = new Environment();
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
  private noticeLeft = 0;
  private shown = { gauge: -1, full: false, hp: -1, chips: -1, lamps: '' };
  private layoutKey = '';

  constructor(private opts: TerminalOptions) {
    const { renderer, container } = opts;
    renderer.domElement.id = 'terminal-canvas';
    container.appendChild(renderer.domElement);
    // Several render passes per frame: counters are reset manually in render().
    renderer.info.autoReset = false;
    this.battle = new BattleTarget(renderer);
    this.crt.setHud(this.hud.texture);

    this.scene.add(
      this.environment.group,
      this.housing.group,
      this.housing.controlLabels,
      this.rail.group,
      this.tray.group,
      this.hitZones.group,
      this.deck.group,
      this.trackball.group,
    );
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff1dd, 1.6);
    key.position.set(-4, 6, 10);
    this.scene.add(key);

    this.layout = computeLayout(container.clientWidth, container.clientHeight);
    this.router = new PointerRouter(() => this.layout, {
      press: (z) => this.press(z, true),
      release: (z) => this.release(z),
      move: (d) => {
        this.trackball.step(d);
        opts.handlers.move(d);
      },
      roll: (dx, dy) => this.trackball.roll(dx, dy),
      action: () => {},
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
      t.CRT_MARGIN_X, t.DECK_SPLIT_LEFT, t.DECK_SPLIT_RIGHT, t.PAUSE_ZONE_W, t.CRT_RES_W, t.CRT_RES_H,
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
    this.tray.build(this.layout, texel);
    this.trayGeomKey = '';
    this.hitZones.build(this.layout);
    this.deck.build(this.layout);
    const tb = this.layout.zones.trackball;
    const tbWorld = { cx: (tb.x + tb.w / 2 - bodyCx) * k, cy: -(tb.y + tb.h / 2 - bodyCy) * k };
    this.trackball.build(tbWorld.cx, tbWorld.cy, Math.min(tb.w, tb.h) * k * 0.28);
    const cx = this.camBase.x;
    const cy = this.camBase.y;
    this.environment.build(this.layout, {
      left: cx - (vw * k) / 2,
      right: cx + (vw * k) / 2,
      top: cy + (vh * k) / 2,
      bottom: cy - (vh * k) / 2,
    });
    this.shown = { gauge: -1, full: false, hp: -1, chips: -1, lamps: '' };
  }

  onEvent(e: SimEvent): void {
    if (e.type === 'chipUsed') this.crt.flash();
  }

  setHitZonesVisible(v: boolean): void {
    this.hitZones.group.visible = v;
  }

  /** A new World started: cartridges of the old one vanish without animation. */
  resetWorld(): void {
    this.rail.reset();
  }

  render(world: World, alpha: number, dt: number): void {
    const { renderer, sceneRenderer, perf, session } = this.opts;
    this.resize();
    this.time += dt;
    this.noticeLeft = Math.max(0, this.noticeLeft - dt);
    renderer.info.reset();

    const screen = this.battle.render(sceneRenderer, world, alpha, dt);
    this.crt.setScreen(screen, this.battle.width, this.battle.height);
    this.crt.update(dt);
    this.syncTray(world);
    const focused = world.state === 'CUSTOM' ? world.chips.hand[this.focusSlot] : null;
    const info = focused ? { defId: focused.defId, code: focused.code } : null;
    this.hud.draw(hudModel(session, world, this.noticeLeft > 0 ? t('hud.noChip') : null, info), this.time);

    this.syncIndicators(world);
    this.rail.update(dt);
    this.tray.update(dt);
    const slide = -this.tray.openness * this.tray.slideDistance;
    this.deck.slide.position.y = slide;
    this.trackball.group.position.y = slide;
    this.housing.controlLabels.position.y = slide;
    this.deck.update(dt, this.time);
    this.trackball.update(dt);
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
    const world = this.opts.session.world;
    const { handlers } = this.opts;
    switch (zone) {
      case 'trackball':
        this.trackball.press();
        break;
      case 'execute': {
        const a = executeAvailability(world);
        this.deck.key('execute').press(a.press === 'dull');
        if (a.press === 'ok') {
          if (send) handlers.execute();
        } else {
          this.deck.deny('execute');
          if (a.notice === 'noChip') this.noticeLeft = tuning.terminal.NO_CHIP_TIME;
        }
        break;
      }
      case 'chipSelect': {
        const ok = chipSelectAvailability(world) === 'ok';
        this.deck.key('chipSelect').press(!ok);
        if (ok) {
          if (send) handlers.chipSelect();
        } else {
          this.deck.deny('chipSelect');
        }
        break;
      }
      case 'pause':
        this.deck.key('pause').press(false);
        if (send) handlers.pause();
        break;
    }
    this.updateCursor();
  }

  private release(zone: ZoneId): void {
    if (zone === 'trackball') this.trackball.release();
    else this.deck.key(zone).release();
    this.updateCursor();
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
    else this.deck.key(zone).hover(on);
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

  /** Custom Screen: tray open state, hand cartridges, and the rail showing the selection. */
  private syncTray(world: World): void {
    const chips = world.chips;
    const custom = world.state === 'CUSTOM';
    this.tray.setOpen(custom);
    if (custom) {
      const geomKey = `${chips.hand.length}|${this.layoutKey}`;
      if (geomKey !== this.trayGeomKey || !this.trayGeom) {
        this.trayGeomKey = geomKey;
        this.trayGeom = trayLayout(this.layout, chips.hand.length);
      }
      if (!chips.hand[this.focusSlot]) this.focusSlot = chips.hand.findIndex((c) => c !== null);
      this.tray.setFocus(this.focusSlot);
      const states: HandCellState[] = chips.hand.map((c, i) =>
        !c ? 'empty' : chips.isSelected(i) ? 'selected' : chips.canSelect(i) ? 'ok' : 'dim',
      );
      const selected = new Set(chips.selectedChips().map((c) => c.uid));
      this.tray.setHand(chips.hand, states, this.trayGeom);
      // Chips pulled out of the rail start their way back from there.
      chips.hand.forEach((c, i) => {
        if (!c || !this.selectedBefore.has(c.uid) || selected.has(c.uid)) return;
        const from = this.rail.cartPosition(c.uid);
        if (from) this.tray.flyFrom(i, from);
      });
      this.selectedBefore = selected;
    } else {
      this.selectedBefore.clear();
    }

    const handIndex = (uid: number) => chips.hand.findIndex((c) => c?.uid === uid);
    this.rail.sync(custom ? chips.selectedChips() : chips.queue, {
      mode: custom ? 'select' : 'queue',
      burning: custom,
      inHand: (uid) => handIndex(uid) >= 0,
      spawnFrom: (uid) => this.tray.cellPosition(handIndex(uid)),
    });
  }

  private trayReady(): boolean {
    const { session } = this.opts;
    return session.screen === 'BATTLE' && session.world.state === 'CUSTOM' && this.tray.openness > TRAY_READY;
  }

  private trayHoverAt(x: number, y: number): void {
    const chips = this.opts.session.world.chips;
    const target =
      this.trayReady() && this.trayGeom && x >= 0
        ? trayTargetAt(this.layout, this.trayGeom, x, y, chips.selection.length)
        : null;
    if (target?.kind === 'hand' && chips.hand[target.slot]) this.focusSlot = target.slot;
    const hover = target !== null;
    if (hover !== this.trayHover) {
      this.trayHover = hover;
      this.updateCursor();
    }
  }

  private makeTrayInput(): TrayInput {
    const world = () => this.opts.session.world;
    const toWorld = (x: number, y: number) => {
      const p = cssToWorld(this.layout, x, y);
      return new THREE.Vector3(p.x, p.y, 0);
    };
    const railUid = (index: number) => world().chips.selectedChips()[index]?.uid ?? null;
    return new TrayInput({
      layout: () => this.layout,
      tray: () => this.trayGeom ?? trayLayout(this.layout, world().chips.hand.length),
      selectedCount: () => world().chips.selection.length,
      canPick: (slot) => world().chips.canSelect(slot),
      enabled: () => this.trayReady(),
      select: (slot, index) => {
        if (!world().customSelectAt(slot, index)) this.tray.refuse(slot);
      },
      unselect: (index) => {
        world().customUnselect(index);
      },
      reorder: (from, to) => {
        const w = world();
        const slot = w.chips.selection[from];
        if (slot === undefined || !w.customUnselect(from)) return;
        w.customSelectAt(slot, to);
      },
      refuse: (slot) => this.tray.refuse(slot),
      focus: (slot) => {
        this.focusSlot = slot;
      },
      keyDown: (k) => this.tray.keys[k].press(false),
      keyUp: (k, fire) => {
        this.tray.keys[k].release();
        if (!fire) return;
        if (k === 'ok') world().customConfirm();
        else world().customAdd();
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

  /** Keyboard keys press the same controls (visual only). */
  private attachKeyVisuals(): () => void {
    const held = new Set<string>();
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || held.has(e.code) || e.target instanceof HTMLInputElement) return;
      const organ = organForKey(e.code);
      if (!organ || !acceptsPress(this.mode(), organ.zone)) return;
      held.add(e.code);
      this.press(organ.zone, false);
      if (organ.dir) this.trackball.step(organ.dir);
    };
    const onUp = (e: KeyboardEvent) => {
      if (!held.delete(e.code)) return;
      const organ = organForKey(e.code);
      if (organ) this.release(organ.zone);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }

  /** Pushes LED, lamp and counter state to the meshes when it changes. */
  private syncIndicators(world: World): void {
    const { session } = this.opts;
    const gauge = gaugeLedCount(world.gauge.value, world.gauge.full, GAUGE_LEDS);
    const hp = hpLedCount(world.player.hp, world.player.maxHp, HP_LEDS);
    // On the Custom Screen the counter shows the chips placed in the rail.
    const chips = world.state === 'CUSTOM' ? world.chips.selection.length : world.chips.queue.length;
    const lamps = lampStates(terminalMode(session.screen, world.state), session.screen, world.gauge.full, this.time);
    const lampKey = `${+lamps.power}${+lamps.sync}${+lamps.link}${+lamps.battle}`;
    const s = this.shown;
    if (gauge !== s.gauge || world.gauge.full !== s.full) {
      s.gauge = gauge;
      s.full = world.gauge.full;
      this.deck.setGauge(gauge, s.full);
    }
    if (hp !== s.hp) this.housing.setHpLeds((s.hp = hp));
    if (chips !== s.chips) {
      s.chips = chips;
      this.housing.setChipCount(chips, RAIL_SLOTS);
    }
    if (lampKey !== s.lamps) {
      s.lamps = lampKey;
      this.housing.setLamps(lamps);
    }
  }
}
