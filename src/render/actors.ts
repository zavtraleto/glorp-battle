import * as THREE from 'three';
import { secondsToTicks, tuning } from '../config/tuning';
import type { Enemy } from '../sim/enemies/enemyBase';
import type { Player } from '../sim/player';
import { CELL_DEPTH, CELL_WIDTH, cellToWorld } from './field';
import { PixelSprite } from './pixelSprite';
import { playerBitmap } from './playerSprite';
import { enemyArtId, spriteArt } from './spriteArt';
import { enemyPlaceholderBitmap } from './spriteBitmap';

// Player and enemy sprites (BATTLE_VISUAL.md §5): pixel bitmaps standing in
// their cells, animated with whole-pixel lifts, flashes and a dissolve.

/** Nearer rows (larger y) draw on top of farther ones. */
export function rowRenderOrder(y: number): number {
  return 10 + y;
}

/** Feet sit a bit in front of the cell centre so the figure reads as standing in it. */
const FOOT_OFFSET = 0.18;
/** Enemies bob by one texel at this rate. */
const IDLE_BOB_HZ = 1.2;
/** A hit enemy ripples for this long, seconds (decision 2026-09-19). */
const HIT_RIPPLE_TIME = 0.3;

export interface SpriteFrame {
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
}

const from = new THREE.Vector3();
const to = new THREE.Vector3();
const anchor = new THREE.Vector3();

function slideAnchor(
  prevX: number,
  prevY: number,
  x: number,
  y: number,
  lastMoveTick: number,
  tick: number,
  alpha: number,
  dt: number,
  moveTime: number,
): THREE.Vector3 {
  const elapsed = (tick - lastMoveTick + alpha) * dt;
  const t = Math.min(1, Math.max(0, elapsed / Math.max(1e-6, moveTime)));
  // Ease-out keeps the "snap" feel of MMBN while still reading as motion.
  const k = 1 - (1 - t) * (1 - t);
  cellToWorld(prevX, prevY, from);
  cellToWorld(x, y, to);
  anchor.lerpVectors(from, to, k);
  anchor.z += FOOT_OFFSET * CELL_DEPTH;
  return anchor;
}

function flashing(lastHitTick: number, tick: number): boolean {
  return tick - lastHitTick < secondsToTicks(tuning.fx.HIT_FLASH);
}

function deathProgress(deathTick: number, tick: number, alpha: number, dt: number): number {
  return Math.min(1, ((tick - deathTick + alpha) * dt) / Math.max(1e-6, tuning.fx.DELETE_ANIM_TIME));
}

/** Hand-drawn art is wider than the thin procedural figure: share of a cell's width. */
const PLAYER_ART_WIDTH = 0.9;
const ENEMY_ART_WIDTH = 1.0;

export class PlayerView {
  private readonly pixels: PixelSprite;
  readonly sprite: THREE.Sprite;
  private readonly widthShare: number;

  constructor() {
    const art = spriteArt('player');
    this.pixels = new PixelSprite(art ?? playerBitmap(), 'phosphor', art ? { character: 'player', instanceId: 1 } : undefined);
    this.sprite = this.pixels.sprite;
    this.widthShare = art ? PLAYER_ART_WIDTH : tuning.battleVisual.SPRITE_CELL_FRAC * 0.8;
  }

  update(player: Player, tick: number, alpha: number, dt: number, usingChip: boolean, frame: SpriteFrame): void {
    this.pixels.setTime((tick + alpha) / tuning.sim.SIM_HZ);
    const time = (tick + alpha) / tuning.sim.SIM_HZ;
    const a = slideAnchor(
      player.prevX,
      player.prevY,
      player.x,
      player.y,
      player.lastMoveTick,
      tick,
      alpha,
      dt,
      tuning.player.CELL_MOVE_TIME,
    );
    this.pixels.place(a, CELL_WIDTH * this.widthShare, frame.camera, frame.width, frame.height, usingChip ? 1 : 0);
    this.sprite.renderOrder = rowRenderOrder(player.y);
    // Paralysis flickers like a hit.
    this.pixels.setFlash(flashing(player.lastHitTick, tick) || (player.paralyzeTicks > 0 && Math.floor(tick / 4) % 2 === 0));
    // Blink while invulnerable.
    const blinkTicks = Math.max(1, Math.round(tuning.sim.SIM_HZ / Math.max(1, tuning.fx.IFRAME_BLINK_HZ) / 2));
    this.sprite.visible = !player.invulnerable || Math.floor(tick / blinkTicks) % 2 === 0;
    this.pixels.setDissolve(!player.alive ? 0.6 : 0);
    this.pixels.setRipple(player.guard ? 0.2 : 0, time);
  }
}

export class EnemyView {
  private readonly pixels: PixelSprite;
  readonly sprite: THREE.Sprite;
  private readonly phase: number;
  private readonly widthShare: number;

  constructor(enemy: Enemy) {
    const spriteId = enemyArtId(enemy.kind);
    const artId = spriteId === 'placeholder' ? null : spriteId;
    const art = artId ? spriteArt(artId) : null;
    this.pixels = new PixelSprite(
      art ?? enemyPlaceholderBitmap(),
      'red',
      artId && art ? { character: artId, instanceId: enemy.id } : undefined,
    );
    this.sprite = this.pixels.sprite;
    this.widthShare = art ? ENEMY_ART_WIDTH : tuning.battleVisual.SPRITE_CELL_FRAC;
    this.phase = enemy.id * 1.7;
  }

  /** `spawn` runs 0 → 1 while a wave materializes (GDD §10.4); 1 otherwise. */
  update(enemy: Enemy, tick: number, alpha: number, dt: number, frame: SpriteFrame, spawn = 1): void {
    const a = slideAnchor(
      enemy.prevX,
      enemy.prevY,
      enemy.x,
      enemy.y,
      enemy.lastMoveTick,
      tick,
      alpha,
      dt,
      enemy.moveDurationSeconds(),
    );
    const time = (tick + alpha) / tuning.sim.SIM_HZ;
    this.pixels.setTime(time);
    let lift = Math.sin(time * Math.PI * 2 * IDLE_BOB_HZ + this.phase) > 0.3 ? 1 : 0;
    let flash = flashing(enemy.lastHitTick, tick);

    if (enemy.state === 'INTENTION' || enemy.state === 'LOCK') {
      // Early warning and committed target share a readable lifted pose.
      lift = 2;
      flash ||= Math.sin(time * Math.PI * 2 * tuning.battleVisual.DANGER_PULSE_HZ) > 0.2;
    } else if (enemy.state === 'COUNTER') {
      lift = 2;
      flash ||= Math.sin(time * Math.PI * 4 * tuning.battleVisual.DANGER_PULSE_HZ) > 0;
    } else if (enemy.state === 'STRIKE') {
      lift = 1;
      flash = true;
    }

    this.pixels.place(a, CELL_WIDTH * this.widthShare, frame.camera, frame.width, frame.height, lift);
    this.sprite.renderOrder = rowRenderOrder(enemy.y);
    const sinceHit = (tick - enemy.lastHitTick + alpha) / tuning.sim.SIM_HZ;
    const hitRipple = sinceHit >= 0 && sinceHit < HIT_RIPPLE_TIME ? 1 - sinceHit / HIT_RIPPLE_TIME : 0;
    this.pixels.setRipple(hitRipple, time);
    if (enemy.alive) {
      this.pixels.setDissolve(0);
      this.pixels.setBuild(spawn);
    } else {
      this.pixels.setBuild(1);
      this.pixels.setDissolve(deathProgress(enemy.deathTick, tick, alpha, dt));
    }
    this.pixels.setFlash(flash);
  }

  dispose(): void {
    this.pixels.dispose();
  }
}
