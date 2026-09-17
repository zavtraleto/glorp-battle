// Chip rail bookkeeping (TERMINAL.md §6.3, §6.5). Pure: diffs the slot
// contents against the chip queue and says what the rail must animate.

export interface RailPlan {
  remove: { slot: number; how: 'eject' | 'burn' }[];
  add: { slot: number; uid: number }[];
}

/**
 * `slots` holds chip uids (null = empty). A slot whose chip left the queue is
 * ejected (used) or burned (Custom Screen opened). New queue chips fill empty
 * slots in queue order, starting after the last chip that stays.
 */
export function planRail(slots: readonly (number | null)[], queue: readonly number[], burning: boolean): RailPlan {
  const inQueue = new Set(queue);
  const remove: RailPlan['remove'] = [];
  const kept = new Set<number>();
  let lastKept = -1;
  slots.forEach((uid, slot) => {
    if (uid === null) return;
    if (inQueue.has(uid)) {
      kept.add(uid);
      lastKept = slot;
    } else {
      remove.push({ slot, how: burning ? 'burn' : 'eject' });
    }
  });

  const add: RailPlan['add'] = [];
  let slot = lastKept + 1;
  for (const uid of queue) {
    if (kept.has(uid)) continue;
    while (slot < slots.length && slots[slot] !== null && !remove.some((r) => r.slot === slot)) slot++;
    if (slot >= slots.length) break;
    add.push({ slot, uid });
    slot++;
  }
  return { remove, add };
}

/** The active (next) chip sits in the first occupied slot. */
export function activeSlot(slots: readonly (number | null)[]): number {
  return slots.findIndex((uid) => uid !== null);
}
