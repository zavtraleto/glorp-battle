import * as THREE from 'three';
import { secondsToTicks, tuning } from '../config/tuning';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import { EnemyView, PlayerView, type SpriteFrame } from './actors';
import { ART_LAYER } from './pixelSprite';
import { FieldView, cellToWorld } from './field';
import { FxView } from './fx';
import { cellKey } from './cellStates';
import { fitView } from './viewCamera';
import { battleSignal } from './battleSignals';
import { COLS } from '../sim/grid';

export interface ScreenPoint {
  x: number;
  y: number;
}

const tmp = new THREE.Vector3();

/** Signal black: the palette pass turns it into the background colour. */
export const BATTLE_CLEAR_COLOR = 0x000000;

export interface SceneRendererOptions {
  renderer: THREE.WebGLRenderer;
}

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly field: FieldView;
  readonly camera = new THREE.PerspectiveCamera();
  playerView = new PlayerView();
  readonly fx = new FxView();
  private readonly enemyViews = new Map<number, EnemyView>();
  private readonly corners: THREE.Vector3[] = [];
  private readonly spawns = new Map<number, number>();
  private lastCameraKey = '';

  constructor(opts: SceneRendererOptions) {
    this.renderer = opts.renderer;

    this.field = new FieldView();
    this.scene.add(this.field.group);
    // Fit the floor of the field plus headroom above the far edge for enemy sprites;
    // raised near corners would only widen the frame.
    const { min, max } = this.field.bounds;
    for (const x of [min.x, max.x]) {
      this.corners.push(new THREE.Vector3(x, 0, min.z), new THREE.Vector3(x, 0, max.z), new THREE.Vector3(x, max.y, min.z));
    }
    this.scene.add(this.playerView.sprite, this.fx.group);
  }

  private fitCamera(w: number, h: number): void {
    const v = tuning.battleVisual;
    const key = `${v.VIEW_PITCH}|${v.VIEW_FOV}|${v.VIEW_FILL}|${v.HUD_BAND}|${w}|${h}`;
    if (key === this.lastCameraKey) return;
    this.lastCameraKey = key;
    fitView(this.camera, this.corners, {
      pitchDeg: v.VIEW_PITCH,
      fovDeg: v.VIEW_FOV,
      aspect: w / h,
      fill: v.VIEW_FILL,
      // The status band owns the top of the picture, so the field sits below it.
      offsetY: -v.HUD_BAND,
    });
  }

  /** Normalized point (0..1, top-left origin) in the last render target for a world point. */
  projectToTarget(v: THREE.Vector3): ScreenPoint {
    tmp.copy(v).project(this.camera);
    return { x: (tmp.x + 1) / 2, y: (1 - tmp.y) / 2 };
  }

  /** Actor sprite position (with interpolation) in the last render target, normalized. */
  actorTargetPos(id: number, height = 0): ScreenPoint | null {
    const sprite = id === 1 ? this.playerView.sprite : this.enemyViews.get(id)?.sprite;
    if (!sprite) return null;
    const v = new THREE.Vector3().copy(sprite.position);
    v.y += height;
    return this.projectToTarget(v);
  }

  /** Top centre of an actor sprite in the last render target, normalized. */
  actorTopTargetPos(id: number): ScreenPoint | null {
    const sprite = id === 1 ? this.playerView.sprite : this.enemyViews.get(id)?.sprite;
    if (!sprite || !sprite.visible) return null;
    const v = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    v.multiplyScalar(sprite.scale.y).add(sprite.position);
    return this.projectToTarget(v);
  }

  /** Logical cell (plus height) in the last render target, normalized. */
  cellTargetPos(x: number, y: number, height = 0): ScreenPoint {
    const v = new THREE.Vector3();
    cellToWorld(x, y, v);
    v.y += height;
    return this.projectToTarget(v);
  }

  handleEvent(e: SimEvent, world: World): void {
    this.fx.handleEvent(e, world);
    const tick = world.tick;
    if (e.type === 'chipEffect') this.field.markAttack(e.cells, tick, 'accent');
    else if (e.type === 'explosion') this.field.markAttack(e.cells, tick, 'red');
    else if (e.type === 'enemyShot') this.field.markAttack([{ x: e.x, y: e.toY }], tick, 'red');
    else if (e.type === 'bombLanded') this.field.markAttack(e.cells, tick, 'accent');
    else if (e.type === 'enemySlash') this.field.markAttack(e.cells, tick, 'red');
    else if (e.type === 'guarded') this.field.markAttack([{ x: e.x, y: e.y }], tick, 'accent');
    else if (e.type === 'objectBroken') this.field.markAttack([{ x: e.x, y: e.y }], tick, 'red');
  }

  /** Sprite art arrived: rebuild the views so they pick it up. */
  refreshArt(): void {
    this.scene.remove(this.playerView.sprite);
    this.playerView = new PlayerView();
    this.scene.add(this.playerView.sprite);
    this.reset();
  }

  /** Drops all per-battle views (called when a new World is created). */
  reset(): void {
    for (const v of this.enemyViews.values()) {
      this.scene.remove(v.sprite);
      v.dispose();
    }
    this.enemyViews.clear();
    this.fx.clear();
    this.field.clear();
  }

  private syncEnemies(world: World, alpha: number, dt: number, frame: SpriteFrame): void {
    const live = new Set<number>();
    for (const e of world.enemies) {
      live.add(e.id);
      let view = this.enemyViews.get(e.id);
      if (!view) {
        view = new EnemyView(e);
        this.enemyViews.set(e.id, view);
        this.scene.add(view.sprite);
      }
      view.update(e, world.tick, alpha, dt, frame);
    }
    for (const [id, view] of this.enemyViews) {
      if (live.has(id)) continue;
      this.scene.remove(view.sprite);
      view.dispose();
      this.enemyViews.delete(id);
    }
  }

  private prepare(world: World, alpha: number, dt: number, w: number, h: number): void {
    const frame: SpriteFrame = { camera: this.camera, width: w, height: h };
    this.playerView.update(world.player, world.tick, alpha, dt, world.activeChip !== null, frame);
    this.syncEnemies(world, alpha, dt, frame);
    this.fx.update(world, alpha);
    // Moving enemy attacks light up the cell they are in.
    for (const a of world.attacks) {
      if (a.kind === 'shockwave' || a.kind === 'heatshot') {
        const m = a as unknown as { x: number; y: number };
        this.field.markAttack([{ x: m.x, y: m.y }], world.tick, 'red');
      }
    }
    // Spawn markers under enemies during the battle intro (clock: ui ticks).
    this.spawns.clear();
    if (world.state === 'BATTLE_INTRO') {
      for (const e of world.enemies) this.spawns.set(cellKey(e.x, e.y, COLS), world.stateElapsed);
    }
    const fx = tuning.fx;
    const signal = battleSignal({
      state: world.state,
      elapsed: world.stateElapsed,
      player: { x: world.player.x, y: world.player.y },
      introTicks: secondsToTicks(fx.INTRO_TIME),
      wonTicks: secondsToTicks(fx.RESULT_DELAY_WIN),
      deadTicks: secondsToTicks(fx.RESULT_DELAY_LOSE),
    });
    this.field.update(world, alpha, this.spawns, signal);
  }

  /** Renders the battle into a render target (the CRT), field fitted to the whole target. */
  renderInto(target: THREE.WebGLRenderTarget, world: World, alpha: number, dt: number): void {
    const w = target.width;
    const h = target.height;
    this.fitCamera(w, h);
    this.prepare(world, alpha, dt, w, h);
    this.camera.layers.set(0);
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(BATTLE_CLEAR_COLOR, 1);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  /**
   * Draws the full-colour art layer over an already paletted target, without
   * clearing it. Call after renderInto() for the same frame.
   */
  renderArtInto(target: THREE.WebGLRenderTarget): void {
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.camera.layers.set(ART_LAYER);
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.camera.layers.set(0);
    this.renderer.autoClear = autoClear;
  }
}
