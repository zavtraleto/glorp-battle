import type { ChipCode, ChipId } from './chips';

// Fixed folders (GDD §6.3). Exactly 30 chips each.

export type FolderId = 'mvp' | 'p1' | 'p2';

export interface FolderEntry {
  chip: ChipId;
  code: ChipCode;
  count: number;
}

export const FOLDERS: Record<FolderId, readonly FolderEntry[]> = {
  mvp: [
    { chip: 'cannon', code: 'A', count: 10 },
    { chip: 'hicannon', code: 'F', count: 5 },
    { chip: 'sword', code: 'S', count: 5 },
    { chip: 'widesword', code: 'S', count: 5 },
    { chip: 'recover50', code: 'A', count: 5 },
  ],
  p1: [
    { chip: 'cannon', code: 'A', count: 6 },
    { chip: 'hicannon', code: 'F', count: 3 },
    { chip: 'sword', code: 'S', count: 4 },
    { chip: 'widesword', code: 'S', count: 4 },
    { chip: 'longsword', code: 'S', count: 4 },
    { chip: 'shotgun', code: 'N', count: 3 },
    { chip: 'minibomb', code: 'L', count: 3 },
    { chip: 'recover50', code: 'A', count: 3 },
  ],
  /** Debug: the roguelite chips (roguelite spec §4.4). */
  p2: [
    { chip: 'cannon', code: 'A', count: 2 },
    { chip: 'mcannon', code: 'K', count: 2 },
    { chip: 'airshot', code: '*', count: 2 },
    { chip: 'vgun', code: 'S', count: 2 },
    { chip: 'sidegun', code: 'S', count: 2 },
    { chip: 'spreader', code: 'M', count: 2 },
    { chip: 'lilbomb', code: 'L', count: 2 },
    { chip: 'crosbomb', code: 'L', count: 2 },
    { chip: 'shockwave', code: 'L', count: 2 },
    { chip: 'quake1', code: 'S', count: 2 },
    { chip: 'zapring', code: 'A', count: 2 },
    { chip: 'recov80', code: 'A', count: 1 },
    { chip: 'invis', code: '*', count: 1 },
    { chip: 'crack', code: '*', count: 1 },
    { chip: 'geddon1', code: 'L', count: 1 },
    { chip: 'geddon2', code: 'M', count: 1 },
    { chip: 'steal', code: 'S', count: 1 },
    { chip: 'repair', code: '*', count: 1 },
    { chip: 'rockcube', code: '*', count: 1 },
  ],
};

export const FOLDER_SIZE = 30;
