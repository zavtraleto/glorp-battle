import * as THREE from 'three';
import type { Session } from '../app/session';
import { tuning } from '../config/tuning';
import type { Dir } from '../core/input/commands';
import type { PerfProbe } from '../debug/perfProbe';
import type { SceneRenderer } from '../render/scene';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import { BattleTarget } from './crt/battleTarget';
import { CrtCanvas } from './crt/crtCanvas';
import { CrtMaterial } from './crt/crtMaterial';
import { gaugeLedCount, hpLedCount, hudModel } from './crt/hudModel';
import { PointerRouter } from './interaction/pointerRouter';
import { computeLayout, type TerminalLayout } from './layout';
import { Environment } from './parts/environment';
import { Greybox } from './parts/greybox';
import { Housing } from './parts/housing';
import { lampStates, terminalMode } from './terminalMode';

// NET-01 terminal (TERMINAL.md §13). Owns the terminal scene and camera, draws
// the battle and the HUD into the CRT and the terminal into a low-resolution
// canvas that CSS upscales without smoothing.

const TERMINAL_CLEAR_COLOR = 0x07080a;
const GAUGE_LEDS = 12;
const HP_LEDS = 10;
const RAIL_SLOTS = 5;

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
  private readonly greybox = new Greybox();
  private readonly environment = new Environment();
  private readonly battle: BattleTarget;
  private readonly detach: () => void;
  private readonly size = new THREE.Vector2();
  private time = 0;
  private shown = { gauge: -1, hp: -1, chips: -1, lamps: '' };
  private layoutKey = '';

  constructor(private opts: TerminalOptions) {
    const { renderer, container } = opts;
    renderer.domElement.id = 'terminal-canvas';
    container.appendChild(renderer.domElement);
    // Several render passes per frame: counters are reset manually in render().
    renderer.info.autoReset = false;
    this.battle = new BattleTarget(renderer);
    this.crt.setHud(this.hud.texture);

    this.scene.add(this.environment.group, this.housing.group, this.greybox.group);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff1dd, 1.6);
    key.position.set(-4, 6, 10);
    this.scene.add(key);

    this.layout = computeLayout(container.clientWidth, container.clientHeight);
    const router = new PointerRouter(() => this.layout, {
      press: (z) => this.greybox.press(z, true),
      release: (z) => this.greybox.press(z, false),
      move: (d) => opts.handlers.move(d),
      roll: (dx, dy) => this.greybox.roll(dx, dy),
      action: (z) => {
        if (z === 'execute') opts.handlers.execute();
        else if (z === 'chipSelect') opts.handlers.chipSelect();
        else opts.handlers.pause();
      },
    });
    this.detach = router.attach(renderer.domElement);
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
      t.TERMINAL_ASPECT_MIN, t.TERMINAL_ASPECT_MAX,
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
    const camX = (vw / 2 - bodyCx) * k;
    const camY = -(vh / 2 - bodyCy) * k;
    this.camera.fov = t.CAMERA_FOV;
    this.camera.aspect = vw / vh;
    this.camera.near = Math.max(0.1, dist - 10);
    this.camera.far = dist + 10;
    this.camera.position.set(camX, camY, dist);
    this.camera.lookAt(camX, camY, 0);
    this.camera.updateProjectionMatrix();

    this.battle.setSize(t.CRT_RES_W, t.CRT_RES_H);
    this.hud.setSize(t.CRT_RES_W, t.CRT_RES_H);
    const texel = k / scale; // world size of one render pixel
    this.housing.build(this.layout, texel, t.CRT_RES_W / t.CRT_RES_H);
    this.greybox.build(this.layout);
    this.environment.build(this.layout, {
      left: camX - (vw * k) / 2,
      right: camX + (vw * k) / 2,
      top: camY + (vh * k) / 2,
      bottom: camY - (vh * k) / 2,
    });
    this.shown = { gauge: -1, hp: -1, chips: -1, lamps: '' };
  }

  onEvent(e: SimEvent): void {
    if (e.type === 'chipUsed') this.crt.flash();
  }

  setHitZonesVisible(v: boolean): void {
    this.greybox.setHitZonesVisible(v);
  }

  render(world: World, alpha: number, dt: number): void {
    const { renderer, sceneRenderer, perf, session } = this.opts;
    this.resize();
    this.time += dt;
    renderer.info.reset();

    const screen = this.battle.render(sceneRenderer, world, alpha, dt);
    this.crt.setScreen(screen, this.battle.width, this.battle.height);
    this.crt.update(dt);
    this.hud.draw(hudModel(session, world), this.time);

    this.syncIndicators(world);
    this.greybox.update(dt);

    renderer.setRenderTarget(null);
    renderer.setClearColor(TERMINAL_CLEAR_COLOR, 1);
    renderer.render(this.scene, this.camera);

    renderer.getSize(this.size);
    perf.setGpu(renderer.info.render.calls, renderer.info.render.triangles, this.battle.bytes, this.size.x, this.size.y);
  }

  /** Pushes LED, lamp and counter state to the meshes when it changes. */
  private syncIndicators(world: World): void {
    const { session } = this.opts;
    const gauge = gaugeLedCount(world.gauge.value, world.gauge.full, GAUGE_LEDS);
    const hp = hpLedCount(world.player.hp, world.player.maxHp, HP_LEDS);
    const chips = world.chips.queue.length;
    const lamps = lampStates(terminalMode(session.screen, world.state), session.screen, world.gauge.full, this.time);
    const lampKey = `${+lamps.power}${+lamps.sync}${+lamps.link}${+lamps.battle}`;
    const s = this.shown;
    if (gauge !== s.gauge) this.greybox.setGaugeLeds((s.gauge = gauge));
    if (hp !== s.hp) this.housing.setHpLeds((s.hp = hp));
    if (chips !== s.chips) {
      s.chips = chips;
      this.greybox.setChips(chips);
      this.housing.setChipCount(chips, RAIL_SLOTS);
    }
    if (lampKey !== s.lamps) {
      s.lamps = lampKey;
      this.housing.setLamps(lamps);
    }
  }

  dispose(): void {
    this.detach();
    this.battle.dispose();
  }
}
