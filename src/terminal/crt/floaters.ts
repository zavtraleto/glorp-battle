import type { SimEvent } from '../../sim/events';
import { PLAYER_ID } from '../../sim/player';

// Floating damage numbers shown in the CRT (GDD §14, TERMINAL.md §7.1). Pure.

export type FloaterKind = 'damage' | 'playerDamage';

export interface Floater {
  kind: FloaterKind;
  text: string;
  /** Logical cell the number rises from. */
  x: number;
  y: number;
  startTick: number;
}

export function floaterFromEvent(e: SimEvent): Omit<Floater, 'startTick'> | null {
  if (e.type === 'damaged' && e.amount > 0) {
    return { kind: e.targetId === PLAYER_ID ? 'playerDamage' : 'damage', text: String(e.amount), x: e.x, y: e.y };
  }
  return null;
}

export class FloaterList {
  private items: Floater[] = [];

  add(f: Omit<Floater, 'startTick'>, tick: number): void {
    this.items.push({ ...f, startTick: tick });
  }

  /** Live floaters with their progress k ∈ [0, 1); expired ones are dropped. */
  live(tick: number, alpha: number, lifeTicks: number): { f: Floater; k: number }[] {
    const life = Math.max(1, lifeTicks);
    const out: { f: Floater; k: number }[] = [];
    this.items = this.items.filter((f) => {
      const k = (tick - f.startTick + alpha) / life;
      if (k >= 1) return false;
      out.push({ f, k: Math.max(0, k) });
      return true;
    });
    return out;
  }

  clear(): void {
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }
}
