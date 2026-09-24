import type { EntityId } from './occupancy';

// Who of several same-kind enemies may act (GDD §8.1). Two shapes, both from
// MMBN6 as the Hub-OS mods recreate it:
// - TurnRelay: one enemy holds the whole turn (Mettaur: approach and strike),
//   the rest stand; the turn goes round in a fixed order.
// - AttackLock: movement stays free, but only one may attack at a time (Swordy).

/** Round-robin turn among the ids in `order`; dead ids drop out on the way. */
export class TurnRelay {
  private at = 0;

  constructor(private readonly order: EntityId[] = []) {}

  /** Whether `id` holds the turn; unknown ids join the end of the round. */
  holds(id: EntityId, alive: (id: EntityId) => boolean): boolean {
    if (!this.order.includes(id)) this.order.push(id);
    this.prune(alive);
    return this.order[this.at] === id;
  }

  /** The holder hands the turn to the next one. */
  pass(id: EntityId, alive: (id: EntityId) => boolean): void {
    this.prune(alive);
    if (this.order[this.at] !== id || this.order.length === 0) return;
    this.at = (this.at + 1) % this.order.length;
  }

  private prune(alive: (id: EntityId) => boolean): void {
    for (let i = this.order.length - 1; i >= 0; i--) {
      if (alive(this.order[i] as EntityId)) continue;
      this.order.splice(i, 1);
      // The holder's successor keeps its place; an earlier removal shifts the index.
      if (i < this.at) this.at--;
    }
    if (this.at >= this.order.length) this.at = 0;
  }
}

/** First come holds it until it lets go; a dead holder frees it. */
export class AttackLock {
  private holder: EntityId | null = null;

  claim(id: EntityId, alive: (id: EntityId) => boolean): boolean {
    if (this.holder !== null && this.holder !== id && alive(this.holder)) return false;
    this.holder = id;
    return true;
  }

  release(id: EntityId): void {
    if (this.holder === id) this.holder = null;
  }
}
