import type { ChipInstance, FolderChip } from '../sim/chips/chipSystem';

// What the chip tray shows and edits (TERMINAL.md §6, roguelite spec §6.3):
// the Custom Screen hand, or the reward cassettes after a won battle.

export interface TraySource {
  readonly hand: readonly (ChipInstance | null)[];
  readonly selection: readonly number[];
  selectedChips(): ChipInstance[];
  isSelected(slot: number): boolean;
  canSelect(slot: number): boolean;
  selectAt(slot: number, index: number): boolean;
  unselect(index: number): boolean;
  cancelLast(): boolean;
  /** OK key. */
  confirm(): void;
  /** ADD key (SKIP on a reward). */
  add(): void;
}

/** Uids of reward cassettes stay clear of folder chip uids. */
const REWARD_UID = 50_000;

/** Pick one of three chips, or skip. `done` runs once the choice is made. */
export class RewardPick implements TraySource {
  readonly hand: ChipInstance[];
  selection: number[] = [];
  taken: FolderChip | null = null;
  skipped = false;

  constructor(
    readonly chips: readonly FolderChip[],
    private readonly done: () => void,
  ) {
    this.hand = chips.map((c, i) => ({ uid: REWARD_UID + i, defId: c.defId, code: c.code, state: 'hand' }));
  }

  get finished(): boolean {
    return this.taken !== null || this.skipped;
  }

  selectedChips(): ChipInstance[] {
    return this.selection.map((i) => this.hand[i] as ChipInstance);
  }

  isSelected(slot: number): boolean {
    return this.selection.includes(slot);
  }

  canSelect(slot: number): boolean {
    return !this.finished && slot >= 0 && slot < this.hand.length && !this.isSelected(slot);
  }

  /** Only one cassette can be picked: a new pick replaces the old one. */
  selectAt(slot: number, _index: number): boolean {
    if (!this.canSelect(slot)) return false;
    this.selection = [slot];
    return true;
  }

  unselect(index: number): boolean {
    if (this.finished || index !== 0 || this.selection.length === 0) return false;
    this.selection = [];
    return true;
  }

  cancelLast(): boolean {
    return this.unselect(0);
  }

  confirm(): void {
    const slot = this.selection[0];
    if (this.finished || slot === undefined) return;
    this.taken = { ...(this.chips[slot] as FolderChip) };
    this.done();
  }

  add(): void {
    if (this.finished) return;
    this.skipped = true;
    this.done();
  }
}
