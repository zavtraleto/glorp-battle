import * as THREE from 'three';
import { tuning } from '../config/tuning';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import { EnemyView, PlayerView } from './actors';
import { FieldCamera } from './camera';
import { FieldView, cellToWorld } from './field';
import { FxView } from './fx';

export interface ScreenPoint {
  x: number;
  y: number;
}

const tmp = new THREE.Vector3();

export const BATTLE_CLEAR_COLOR = 0x0b0e14;

export interface SceneRendererOptions {
  renderer: THREE.WebGLRenderer;
}

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly field: FieldView;
  readonly fieldCamera: FieldCamera;
  readonly playerView = new PlayerView();
  readonly fx = new FxView();
  private readonly enemyViews = new Map<number, EnemyView>();
  private readonly target = new THREE.Vector3(0, 0, 0);
  private lastCameraKey = '';

  constructor(opts: SceneRendererOptions) {
    this.renderer = opts.renderer;

    this.field = new FieldView(tuning.render.PANEL_GAP);
    this.scene.add(this.field.group);
    this.fieldCamera = new FieldCamera(this.field.bounds);
    this.scene.add(this.playerView.sprite, this.fx.group);
  }

  private fitCamera(w: number, h: number): void {
    const tilt = tuning.render.CAMERA_TILT_DEG;
    const key = `${tilt}|${w}|${h}`;
    if (key === this.lastCameraKey) return;
    this.lastCameraKey = key;
    this.fieldCamera.setTilt(tilt, this.target);
    this.fieldCamera.fit({ width: w, height: h, top: 0, regionHeight: h, fill: 0.94 });
  }

  /** Normalized point (0..1, top-left origin) in the last render target for a world point. */
  projectToTarget(v: THREE.Vector3): ScreenPoint {
    tmp.copy(v).project(this.fieldCamera.camera);
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

  /** Logical cell (plus height) in the last render target, normalized. */
  cellTargetPos(x: number, y: number, height = 0): ScreenPoint {
    const v = new THREE.Vector3();
    cellToWorld(x, y, v);
    v.y += height;
    return this.projectToTarget(v);
  }

  handleEvent(e: SimEvent, world: World): void {
    this.fx.handleEvent(e, world);
  }

  /** Drops all per-battle views (called when a new World is created). */
  reset(): void {
    for (const v of this.enemyViews.values()) {
      this.scene.remove(v.sprite);
      v.dispose();
    }
    this.enemyViews.clear();
    this.fx.clear();
  }

  private syncEnemies(world: World, alpha: number, dt: number): void {
    const live = new Set<number>();
    for (const e of world.enemies) {
      live.add(e.id);
      let view = this.enemyViews.get(e.id);
      if (!view) {
        view = new EnemyView(e);
        this.enemyViews.set(e.id, view);
        this.scene.add(view.sprite);
      }
      view.update(e, world.tick, alpha, dt);
    }
    for (const [id, view] of this.enemyViews) {
      if (live.has(id)) continue;
      this.scene.remove(view.sprite);
      view.dispose();
      this.enemyViews.delete(id);
    }
  }

  private prepare(world: World, alpha: number, dt: number): void {
    this.playerView.update(world.player, world.tick, alpha, dt, world.activeChip !== null);
    this.syncEnemies(world, alpha, dt);
    this.fx.update(world, alpha);
    const pulse = 0.5 + 0.5 * Math.sin((world.tick + alpha) * 0.5);
    this.field.setDanger(world.state === 'ACTION' ? world.dangerCells() : [], pulse);
  }

  /** Renders the battle into a render target (the CRT), field fitted to the whole target. */
  renderInto(target: THREE.WebGLRenderTarget, world: World, alpha: number, dt: number): void {
    const w = target.width;
    const h = target.height;
    this.fitCamera(w, h);
    this.prepare(world, alpha, dt);
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(BATTLE_CLEAR_COLOR, 1);
    this.renderer.render(this.scene, this.fieldCamera.camera);
    this.renderer.setRenderTarget(null);
  }
}
