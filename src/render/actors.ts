import * as THREE from 'three';
import { secondsToTicks, tuning } from '../config/tuning';
import { ENEMY_LOOKS } from '../data/enemies';
import type { Enemy } from '../sim/enemies/enemyBase';
import type { Player } from '../sim/player';
import { cellToWorld } from './field';
import { makeCharacterSprite } from './sprites';

/** Nearer rows (larger y) draw on top of farther ones. */
export function rowRenderOrder(y: number): number {
  return 10 + y;
}

const from = new THREE.Vector3();
const to = new THREE.Vector3();
const FLASH = 3; // color multiplier: >1 pushes the placeholder towards white

function slide(
  sprite: THREE.Sprite,
  prevX: number,
  prevY: number,
  x: number,
  y: number,
  lastMoveTick: number,
  tick: number,
  alpha: number,
  dt: number,
): void {
  const elapsed = (tick - lastMoveTick + alpha) * dt;
  const t = Math.min(1, Math.max(0, elapsed / Math.max(1e-6, tuning.player.MOVE_VISUAL_TIME)));
  // Ease-out keeps the "snap" feel of MMBN while still reading as motion.
  const k = 1 - (1 - t) * (1 - t);
  cellToWorld(prevX, prevY, from);
  cellToWorld(x, y, to);
  sprite.position.lerpVectors(from, to, k);
  sprite.renderOrder = rowRenderOrder(y);
}

function flashing(lastHitTick: number, tick: number): boolean {
  return tick - lastHitTick < secondsToTicks(tuning.fx.HIT_FLASH);
}

/** Player billboard (GDD §3, §14): slides between cells, flashes and blinks after hits. */
export class PlayerView {
  readonly sprite = makeCharacterSprite('G', '#6fd3ff', 0.9);

  update(player: Player, tick: number, alpha: number, dt: number, usingChip = false): void {
    slide(this.sprite, player.prevX, player.prevY, player.x, player.y, player.lastMoveTick, tick, alpha, dt);
    const mat = this.sprite.material;
    if (flashing(player.lastHitTick, tick)) mat.color.setScalar(FLASH);
    else if (usingChip) mat.color.setRGB(1.25, 1.25, 0.9);
    else mat.color.setScalar(1);
    // Blink while invulnerable.
    const blinkTicks = Math.max(1, Math.round(tuning.sim.SIM_HZ / Math.max(1, tuning.fx.IFRAME_BLINK_HZ) / 2));
    this.sprite.visible = !player.invulnerable || Math.floor(tick / blinkTicks) % 2 === 0;
    const deadScale = player.alive ? 1 : 0.6;
    this.sprite.scale.setScalar(0.9 * deadScale * (usingChip ? 1.08 : 1));
    mat.opacity = player.alive ? 1 : 0.4;
  }
}

/** Enemy billboard: telegraph tint, hit flash, deletion shrink. */
export class EnemyView {
  readonly sprite: THREE.Sprite;
  private readonly baseColor = new THREE.Color();

  constructor(enemy: Enemy) {
    const look = ENEMY_LOOKS[enemy.kind];
    this.sprite = makeCharacterSprite(look.letter, look.color, 0.85);
  }

  update(enemy: Enemy, tick: number, alpha: number, dt: number): void {
    slide(this.sprite, enemy.prevX, enemy.prevY, enemy.x, enemy.y, enemy.lastMoveTick, tick, alpha, dt);
    const mat = this.sprite.material;
    let scale = 0.85;

    if (enemy.state === 'TELEGRAPH') {
      // Warm pulsing tint + slight swell reads as "about to attack".
      const pulse = 0.5 + 0.5 * Math.sin((tick + alpha) * 0.6);
      this.baseColor.setRGB(1.4, 0.75 + 0.25 * pulse, 0.5);
      scale *= 1.08 + 0.04 * pulse;
    } else if (enemy.state === 'ATTACK') {
      this.baseColor.setRGB(1.6, 0.6, 0.4);
      scale *= 1.15;
    } else {
      this.baseColor.setRGB(1, 1, 1);
    }

    if (flashing(enemy.lastHitTick, tick)) this.baseColor.setScalar(FLASH);
    mat.color.copy(this.baseColor);

    if (!enemy.alive) {
      const t = Math.min(1, ((tick - enemy.deathTick + alpha) * dt) / Math.max(1e-6, tuning.fx.DELETE_ANIM_TIME));
      scale *= 1 - t;
      mat.opacity = 1 - t * 0.5;
    }
    this.sprite.scale.setScalar(Math.max(0.001, scale));
  }

  dispose(): void {
    this.sprite.material.map?.dispose();
    this.sprite.material.dispose();
  }
}
