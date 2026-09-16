import type { ChipCode, ChipId } from '../../data/chips';

// Chip compatibility (GDD §7.3, MMBN1): a selection is valid when every chip
// has the same id, OR there is one code K such that every chip's code is K or '*'.

export interface ChipKey {
  defId: ChipId;
  code: ChipCode;
}

export function isValidSelection(chips: readonly ChipKey[]): boolean {
  if (chips.length <= 1) return true;
  const first = chips[0] as ChipKey;
  if (chips.every((c) => c.defId === first.defId)) return true;
  const fixed = chips.find((c) => c.code !== '*');
  if (!fixed) return true; // all wildcards
  return chips.every((c) => c.code === '*' || c.code === fixed.code);
}

export function canAddToSelection(selected: readonly ChipKey[], candidate: ChipKey, max: number): boolean {
  if (selected.length >= max) return false;
  return isValidSelection([...selected, candidate]);
}
