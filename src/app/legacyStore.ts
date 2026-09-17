import type { ChipCode, ChipId } from '../data/chips';
import { CHIPS } from '../data/chips';

// What the terminal remembers between players (roguelite spec §6.4): the
// generation counter and one chip left by the last player who died. Kept in
// localStorage; a missing or broken store just means "no legacy".

export interface LegacyChip {
  defId: ChipId;
  code: ChipCode;
  /** Generation of the player who left it. */
  gen: number;
}

export interface LegacyState {
  generation: number;
  chip: LegacyChip | null;
}

export const LEGACY_KEY = 'glorp.legacy.v1';

export type LegacyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): LegacyStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const EMPTY: LegacyState = { generation: 1, chip: null };

export function loadLegacy(storage: LegacyStorage | null = defaultStorage()): LegacyState {
  if (!storage) return { ...EMPTY };
  try {
    const raw = storage.getItem(LEGACY_KEY);
    if (!raw) return { ...EMPTY };
    const data = JSON.parse(raw) as Partial<LegacyState>;
    const generation = Number.isInteger(data.generation) && (data.generation as number) >= 1 ? (data.generation as number) : 1;
    const c = data.chip;
    const chip =
      c && typeof c === 'object' && c.defId in CHIPS && CHIPS[c.defId].codes.includes(c.code) && Number.isInteger(c.gen)
        ? { defId: c.defId, code: c.code, gen: c.gen }
        : null;
    return { generation, chip };
  } catch {
    return { ...EMPTY };
  }
}

export function saveLegacy(state: LegacyState, storage: LegacyStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(LEGACY_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the legacy is simply lost.
  }
}

export function clearLegacy(storage: LegacyStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(LEGACY_KEY);
  } catch {
    // Nothing to clear.
  }
}
