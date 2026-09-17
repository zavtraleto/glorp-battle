import * as THREE from 'three';
import { tuning } from '../config/tuning';
import type { Dir } from '../core/input/commands';
import type { PerfProbe } from '../debug/perfProbe';
import type { SceneRenderer } from '../render/scene';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import { BattleTarget } from './crt/battleTarget';
import { CrtMaterial } from './crt/crtMaterial';
import { PointerRouter } from './interaction/pointerRouter';
import { computeLayout, type TerminalLayout } from './layout';
import { Greybox } from './parts/greybox';

// NET-01 terminal (TERMINAL.md §13). Owns the terminal scene and camera, draws
// the battle into the CRT and the terminal into a low-resolution canvas that
// CSS upscales without smoothing.

const TERMINAL_CLEAR_COLOR = 0x07080a;
const GAUGE_LEDS = 12;
const HP_LEDS = 10;

export interface TerminalHandlers {
  move(dir: Dir): void;
  execute(): void;
  chipSelect(): void;
  pause(): void;
}

export interface TerminalOptions {
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;
  sceneRenderer: SceneRenderer;
  perf: PerfProbe;
  handlers: TerminalHandlers;
}

export class Terminal {
  layout: TerminalLayout;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(22, 1, 0.1, 200);
  private readonly crt = new CrtMaterial();
  private readonly greybox = new Greybox(this.crt);
  private readonly battle: BattleTarget;
  private readonly detach: () => void;
  private readonly size = new THREE.Vector2();
  private lit = { gauge: -1, hp: -1, chips: -1 };
  private layoutKey = '';

  constructor(private opts: TerminalOptions) {
    const { renderer, container } = opts;
    renderer.domElement.id = 'terminal-canvas';
    container.appendChild(renderer.domElement);
    // Several render passes per frame: counters are reset manually in render().
    renderer.info.autoReset = false;
    this.battle = new BattleTarget(renderer);

    this.scene.add(this.greybox.group);
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
    const scale = t.RENDER_SCALE_SHORT / Math.min(vw, vh);
    renderer.setPixelRatio(1);
    renderer.setSize(Math.max(1, Math.round(vw * scale)), Math.max(1, Math.round(vh * scale)), false);

    // Straight-on camera: the z=0 face maps linearly to CSS px.
    const k = this.layout.worldWidth / this.layout.body.w; // world units per CSS px
    const dist = (vh * k) / 2 / Math.tan(THREE.MathUtils.degToRad(t.CAMERA_FOV) / 2);
    const bodyCx = this.layout.body.x + this.layout.body.w / 2;
    const bodyCy = this.layout.body.y + this.layout.body.h / 2;
    this.camera.fov = t.CAMERA_FOV;
    this.camera.aspect = vw / vh;
    this.camera.near = Math.max(0.1, dist - 10);
    this.camera.far = dist + 10;
    this.camera.position.set((vw / 2 - bodyCx) * k, -(vh / 2 - bodyCy) * k, dist);
    this.camera.lookAt(this.camera.position.x, this.camera.position.y, 0);
    this.camera.updateProjectionMatrix();

    this.battle.setSize(t.CRT_RES_W, t.CRT_RES_H);
    this.greybox.build(this.layout);
    this.lit = { gauge: -1, hp: -1, chips: -1 };
  }

  onEvent(e: SimEvent): void {
    if (e.type === 'chipUsed') this.crt.flash();
  }

  setHitZonesVisible(v: boolean): void {
    this.greybox.setHitZonesVisible(v);
  }

  render(world: World, alpha: number, dt: number): void {
    const { renderer, sceneRenderer, perf } = this.opts;
    this.resize();
    renderer.info.reset();

    const screen = this.battle.render(sceneRenderer, world, alpha, dt);
    this.crt.setScreen(screen, this.battle.width, this.battle.height);
    this.crt.update(dt);

    const gauge = world.gauge.full ? GAUGE_LEDS : Math.floor(world.gauge.value * GAUGE_LEDS);
    const hp = Math.ceil((HP_LEDS * world.player.hp) / Math.max(1, world.player.maxHp));
    const chips = world.chips.queue.length;
    if (gauge !== this.lit.gauge) this.greybox.setGaugeLeds((this.lit.gauge = gauge));
    if (hp !== this.lit.hp) this.greybox.setHpLeds((this.lit.hp = hp));
    if (chips !== this.lit.chips) this.greybox.setChips((this.lit.chips = chips));
    this.greybox.update(dt);

    renderer.setRenderTarget(null);
    renderer.setClearColor(TERMINAL_CLEAR_COLOR, 1);
    renderer.render(this.scene, this.camera);

    renderer.getSize(this.size);
    perf.setGpu(renderer.info.render.calls, renderer.info.render.triangles, this.battle.bytes, this.size.x, this.size.y);
  }

  dispose(): void {
    this.detach();
    this.battle.dispose();
  }
}
