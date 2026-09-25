import type { ChipId } from '../../data/chips';

// Chip compatibility (GDD §7.3). Letter codes were removed [2026-09-25]; until
// chip colours get rules of their own, any chips combine up to the cap.

export interface ChipKey {
  defId: ChipId;
}

export function canAddToSelection(selected: readonly ChipKey[], _candidate: ChipKey, max: number): boolean {
  return selected.length < max;
}
