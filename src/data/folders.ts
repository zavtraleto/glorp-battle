import { CHIPS, type ChipDef, type ChipId } from './chips';

/** `starter` is the run's folder; `all` holds one of every chip (debug, `?folder=all`). */
export type FolderId = 'starter' | 'all';

export interface FolderEntry {
  chip: ChipId;
  count: number;
}

export const FOLDERS: Record<FolderId, readonly FolderEntry[]> = {
  // GDD §6.3: eight chips for a short, readable rotation.
  starter: [
    { chip: 'cannon', count: 3 },
    { chip: 'sword', count: 2 },
    { chip: 'areagrab', count: 2 },
    { chip: 'guard', count: 1 },
  ],
  all: (Object.values(CHIPS) as ChipDef[]).map((def) => ({ chip: def.id, count: 1 })),
};
