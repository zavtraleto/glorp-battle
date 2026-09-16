import * as THREE from 'three';
import { tuning } from '../config/tuning';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import { EnemyView, PlayerView } from './actors';
import { FieldCamera } from './camera';
import { FieldView, cellToWorld } from './field';
import { FxView } from './fx';

export interface LayoutInsets {
  /** CSS px reserved at the top (HUD bar). */
  top: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

const tmp = new THREE.Vector3();

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly field: FieldView;
  readonly fieldCamera: FieldCamera;
  readonly playerView = new PlayerView();
  readonly fx = new FxView();
  private readonly enemyViews = new Map<number, EnemyView>();
  private readonly target = new THREE.Vector3(0, 0, 0);
  private insets: LayoutInsets = { top: 0 };
  private lastCameraKey = '';

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x0b0e14, 1);
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.field = new FieldView(tuning.render.PANEL_GAP);
    this.scene.add(this.field.group);
    this.fieldCamera = new FieldCamera(this.field.bounds);
    this.scene.add(this.playerView.sprite, this.fx.group);

    this.resize();
  }

  setInsets(insets: LayoutInsets): void {
    this.insets = insets;
    this.resize();
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tuning.render.MAX_PIXEL_RATIO));
    this.renderer.setSize(w, h, false);
    this.updateCamera(true);
  }

  private updateCamera(force: boolean): void {
    const tilt = tuning.render.CAMERA_TILT_DEG;
    const key = `${tilt}|${tuning.render.FIELD_SCREEN_SHARE}`;
    if (!force && key === this.lastCameraKey) return;
    this.lastCameraKey = key;
    this.fieldCamera.setTilt(tilt, this.target);
    const h = this.container.clientHeight;
    const regionHeight = h * tuning.render.FIELD_SCREEN_SHARE - this.insets.top;
    this.fieldCamera.fit({
      width: this.container.clientWidth,
      height: h,
      top: this.insets.top,
      regionHeight,
      fill: 0.94,
    });
  }

  /** Projects a logical cell (plus height above the panel) to CSS pixels. */
  cellToScreen(x: number, y: number, height = 0): ScreenPoint {
    cellToWorld(x, y, tmp);
    tmp.y += height;
    return this.worldToScreen(tmp);
  }

  worldToScreen(v: THREE.Vector3): ScreenPoint {
    tmp.copy(v).project(this.fieldCamera.camera);
    return {
      x: ((tmp.x + 1) / 2) * this.container.clientWidth,
      y: ((1 - tmp.y) / 2) * this.container.clientHeight,
    };
  }

  /** Current on-screen position of an actor's sprite (includes interpolation). */
  actorScreenPos(id: number, height = 0): ScreenPoint | null {
    const sprite = id === 1 ? this.playerView.sprite : this.enemyViews.get(id)?.sprite;
    if (!sprite) return null;
    tmp.copy(sprite.position);
    tmp.y += height;
    return this.worldToScreen(tmp);
  }

  handleEvent(e: SimEvent, world: World): void {
    this.fx.handleEvent(e, world.tick);
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

  render(world: World, alpha: number, dt: number): void {
    this.updateCamera(false);
    this.playerView.update(world.player, world.tick, alpha, dt);
    this.syncEnemies(world, alpha, dt);
    this.fx.update(world, alpha);
    const pulse = 0.5 + 0.5 * Math.sin((world.tick + alpha) * 0.5);
    this.field.setDanger(world.state === 'ACTION' ? world.dangerCells() : [], pulse);
    this.renderer.render(this.scene, this.fieldCamera.camera);
  }
}
