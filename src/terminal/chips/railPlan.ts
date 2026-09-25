// Chip rail bookkeeping. Pure.

import type { SlotState } from '../../sim/chips/chipSystem';

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

/** Three hard red pulses across a cancellation signal's remaining duration. */
export function cancelFlashLevel(remaining: number, total: number): number {
  if (remaining <= 0 || total <= 0) return 0;
  const phase = Math.floor(((total - remaining) / total) * 6 + Number.EPSILON * 8);
  return phase % 2 === 0 ? 1 : 0;
}

/** Finds the physical cartridge to reuse when the same deal returns mid-eject. */
export function returningCartIndex(carts: readonly { deal: number; phase: string }[], deal: number): number {
  return carts.findIndex((cart) => cart.deal === deal && cart.phase === 'eject');
}

/** Only a cooling slot shows its own cooldown; a locked chip is ready, just held (GDD §5). */
export function cooldownForSlot(state: SlotState, progress: number | null): number | null {
  if (progress === null) return null;
  return state === 'cooling' ? progress : null;
}
