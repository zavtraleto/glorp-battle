// Chip rail bookkeeping. Pure.

/** The active (next) chip sits in the first occupied slot. */
export function activeSlot(slots: readonly (number | null)[]): number {
  return slots.findIndex((uid) => uid !== null);
}

/** A rail slot whose chip changed: the old cartridge ejects, the new one loads. */
export interface RailSlotChange {
  slot: number;
  eject: boolean;
  load: boolean;
}

/**
 * Slots whose deal serial changed. Keys are deal serials, not chip uids: a
 * spent chip reshuffled and dealt straight back into its slot is a new deal,
 * so its cartridge still ejects and reloads (GDD §7.5).
 */
export function railChanges(prev: readonly (number | null)[], next: readonly (number | null)[]): RailSlotChange[] {
  const out: RailSlotChange[] = [];
  next.forEach((key, slot) => {
    const was = prev[slot] ?? null;
    if (was === key) return;
    out.push({ slot, eject: was !== null, load: key !== null });
  });
  return out;
}
