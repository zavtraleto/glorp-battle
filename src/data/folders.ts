import { CHIPS, type ChipDef, type ChipId } from './chips';

export type FolderId = 'basic' | 'field' | 'all';

export interface FolderEntry {
  chip: ChipId;
  count: number;
}

const THREE_EACH: readonly FolderEntry[] = [
  'cannon', 'sword', 'areagrab', 'mine', 'block',
  'break', 'airshot', 'spreader', 'widesword', 'guard',
].map((chip) => ({ chip: chip as ChipId, count: 3 }));

export const FOLDERS: Record<FolderId, readonly FolderEntry[]> = {
  basic: THREE_EACH,
  field: [
    { chip: 'mine', count: 4 },
    { chip: 'airshot', count: 4 },
    { chip: 'areagrab', count: 4 },
    { chip: 'sword', count: 3 },
    { chip: 'block', count: 3 },
    { chip: 'break', count: 3 },
    { chip: 'cannon', count: 3 },
    { chip: 'spreader', count: 2 },
    { chip: 'widesword', count: 2 },
    { chip: 'guard', count: 2 },
  ],
  all: (Object.values(CHIPS) as ChipDef[]).map((def) => ({ chip: def.id, count: 1 })),
};

export const FOLDER_SIZE = 30;
