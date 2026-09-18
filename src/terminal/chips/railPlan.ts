// Chip rail bookkeeping. Pure.

/** The active (next) chip sits in the first occupied slot. */
export function activeSlot(slots: readonly (number | null)[]): number {
  return slots.findIndex((uid) => uid !== null);
}
