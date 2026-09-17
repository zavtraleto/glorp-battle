import type { SimEvent } from '../events';
import type { Field } from '../field';
import type { Player } from '../player';

/** What an attack entity may read or do during its update. */
export interface AttackContext {
  readonly tick: number;
  readonly player: Player;
  readonly field: Field;
  /** Damages the player if standing on (x, y), not invulnerable and not yet hit by this attack. */
  hitPlayerAt(attack: Attack, x: number, y: number, damage: number): boolean;
  /** Damages an object on (x, y) once per attack; true if there was one. */
  hitObjectAt(attack: Attack, x: number, y: number, damage: number): boolean;
  /** Damages a living enemy on (x, y) once per attack; true if it was hit now. */
  hitEnemyAt(attack: Attack, x: number, y: number, damage: number): boolean;
  emit(event: SimEvent): void;
}

/** An enemy attack that lives on the field: visible, dodgeable, hits each target once (GDD §8.5, §9). */
export interface Attack {
  readonly id: number;
  readonly kind: string;
  /** Targets already damaged by this attack. */
  readonly hitIds: Set<number>;
  done: boolean;
  update(ctx: AttackContext): void;
}
