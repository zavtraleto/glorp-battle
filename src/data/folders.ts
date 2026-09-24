import { CHIPS, type ChipCode, type ChipDef, type ChipId } from './chips';

export type FolderId = 'basic' | 'field' | 'all';

export interface FolderEntry {
  chip: ChipId;
  code: ChipCode;
  count: number;
}

const THREE_EACH: readonly FolderEntry[] = [
  'cannon', 'sword', 'areagrab', 'mine', 'block',
  'break', 'airshot', 'spreader', 'widesword', 'guard',
].map((chip) => ({ chip: chip as ChipId, code: '*', count: 3 }));

export const FOLDERS: Record<FolderId, readonly FolderEntry[]> = {
  basic: THREE_EACH,
  field: [
    { chip: 'mine', code: '*', count: 4 },
    { chip: 'airshot', code: '*', count: 4 },
    { chip: 'areagrab', code: '*', count: 4 },
    { chip: 'sword', code: '*', count: 3 },
    { chip: 'block', code: '*', count: 3 },
    { chip: 'break', code: '*', count: 3 },
    { chip: 'cannon', code: '*', count: 3 },
    { chip: 'spreader', code: '*', count: 2 },
    { chip: 'widesword', code: '*', count: 2 },
    { chip: 'guard', code: '*', count: 2 },
  ],
  all: (Object.values(CHIPS) as ChipDef[]).map((def) => ({ chip: def.id, code: '*', count: 1 })),
};

export const FOLDER_SIZE = 30;
