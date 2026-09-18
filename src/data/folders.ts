import { CHIPS, type ChipCode, type ChipDef, type ChipId } from './chips';

// Fixed folders (GDD §6.3, roguelite spec §4.4). `basic` and `field` are
// exactly 30 chips; `all` is a debug folder with one of every chip.

export type FolderId = 'basic' | 'field' | 'all';

export interface FolderEntry {
  chip: ChipId;
  code: ChipCode;
  count: number;
}

export const FOLDERS: Record<FolderId, readonly FolderEntry[]> = {
  /** Starting folder: guns, swords and bombs on codes B / L / S, two field chips. */
  basic: [
    { chip: 'cannon', code: 'A', count: 2 },
    { chip: 'cannon', code: 'B', count: 2 },
    { chip: 'airshot', code: '*', count: 2 },
    { chip: 'shotgun', code: 'B', count: 2 },
    { chip: 'vgun', code: 'L', count: 2 },
    { chip: 'sidegun', code: 'S', count: 2 },
    { chip: 'sword', code: 'S', count: 2 },
    { chip: 'sword', code: 'L', count: 1 },
    { chip: 'widesword', code: 'L', count: 2 },
    { chip: 'longsword', code: 'L', count: 1 },
    { chip: 'minibomb', code: 'B', count: 2 },
    { chip: 'minibomb', code: 'L', count: 1 },
    { chip: 'shockwave', code: 'L', count: 2 },
    { chip: 'zapring', code: 'S', count: 1 },
    { chip: 'panlout1', code: 'L', count: 1 },
    { chip: 'areagrab', code: 'S', count: 1 },
    { chip: 'recov10', code: 'L', count: 2 },
    { chip: 'recov30', code: 'B', count: 2 },
  ],
  /** Mid-level folder built around panels: grab, break, crack, rocks. */
  field: [
    { chip: 'hicannon', code: 'L', count: 2 },
    { chip: 'cannon', code: 'B', count: 2 },
    { chip: 'airshot', code: '*', count: 2 },
    { chip: 'spreader', code: 'M', count: 2 },
    { chip: 'sword', code: 'S', count: 2 },
    { chip: 'widesword', code: 'L', count: 2 },
    { chip: 'longsword', code: 'L', count: 2 },
    { chip: 'minibomb', code: 'L', count: 2 },
    { chip: 'shockwave', code: 'L', count: 2 },
    { chip: 'zapring', code: 'S', count: 1 },
    { chip: 'areagrab', code: 'L', count: 2 },
    { chip: 'panlgrab', code: 'L', count: 1 },
    { chip: 'panlout3', code: 'E', count: 1 },
    { chip: 'panlout1', code: 'L', count: 1 },
    { chip: 'geddon1', code: 'S', count: 1 },
    { chip: 'rockcube', code: '*', count: 1 },
    { chip: 'repair', code: '*', count: 1 },
    { chip: 'recov30', code: 'M', count: 2 },
    { chip: 'invis', code: 'S', count: 1 },
  ],
  /** Debug: one of every chip with its first code. */
  all: (Object.values(CHIPS) as ChipDef[]).map((d) => ({ chip: d.id, code: d.codes[0] as ChipCode, count: 1 })),
};

export const FOLDER_SIZE = 30;
