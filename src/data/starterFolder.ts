import type { FolderChip } from '../sim/chips/chipSystem';

// Folder every run starts with (roguelite spec §6.1): 18 chips whose codes
// allow MMBN1 multi-selections (A, S, L and the AirShot wildcard).

const n = (count: number, chip: FolderChip): FolderChip[] => Array.from({ length: count }, () => ({ ...chip }));

export const STARTER_FOLDER: readonly FolderChip[] = [
  ...n(3, { defId: 'cannon', code: 'A' }),
  ...n(2, { defId: 'cannon', code: 'B' }),
  ...n(3, { defId: 'sword', code: 'S' }),
  ...n(2, { defId: 'widesword', code: 'S' }),
  ...n(2, { defId: 'airshot', code: '*' }),
  ...n(2, { defId: 'minibomb', code: 'L' }),
  ...n(2, { defId: 'recov10', code: 'A' }),
  ...n(2, { defId: 'recov10', code: 'L' }),
];
