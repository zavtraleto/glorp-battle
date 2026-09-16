import type { ChipCode, ChipId } from './chips';

// Fixed folders (GDD §6.3). Exactly 30 chips each.

export type FolderId = 'mvp' | 'p1';

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
};

export const FOLDER_SIZE = 30;
