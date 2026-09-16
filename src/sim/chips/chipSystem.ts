import { tuning } from '../../config/tuning';
import type { Rng } from '../../core/rng';
import { CHIPS, type ChipCode, type ChipDef, type ChipId } from '../../data/chips';
import { FOLDERS, type FolderId } from '../../data/folders';
import { canAddToSelection } from './selection';

// Folder, hand, selection and queue for one battle (GDD §6, §7).

export type ChipState = 'folder' | 'hand' | 'queued' | 'used';

export interface ChipInstance {
  readonly uid: number;
  readonly defId: ChipId;
  readonly code: ChipCode;
  state: ChipState;
}

export function chipDef(chip: ChipInstance): ChipDef {
  return CHIPS[chip.defId];
}

export class ChipSystem {
  /** Every chip of the folder, in folder order. */
  readonly chips: ChipInstance[] = [];
  /** Shuffled draw order (shuffled once per battle). */
  private readonly drawPile: ChipInstance[];
  private drawIndex = 0;
  /** Hand slots; null = empty slot (chip taken or folder exhausted). */
  hand: (ChipInstance | null)[] = [];
  /** Hand slot indices in selection order. */
  selection: number[] = [];
  /** Chips waiting to be used in the action phase, first = next. */
  queue: ChipInstance[] = [];
  /** Consecutive ADD presses (GDD §7.5). */
  addStreak = 0;
  /** Number of completed Custom Screen turns. */
  turns = 0;

  constructor(folder: FolderId, rng: Rng) {
    let uid = 1;
    for (const entry of FOLDERS[folder]) {
      for (let i = 0; i < entry.count; i++) {
        this.chips.push({ uid: uid++, defId: entry.chip, code: entry.code, state: 'folder' });
      }
    }
    this.drawPile = rng.shuffle([...this.chips]);
  }

  get handSize(): number {
    const c = tuning.chips;
    return Math.min(c.HAND_MAX, c.HAND_BASE + c.HAND_ADD_STEP * Math.min(this.addStreak, 2));
  }

  get folderRemaining(): number {
    return this.drawPile.length - this.drawIndex;
  }

  count(state: ChipState): number {
    return this.chips.filter((c) => c.state === state).length;
  }

  private draw(): ChipInstance | null {
    const chip = this.drawPile[this.drawIndex];
    if (!chip) return null;
    this.drawIndex++;
    chip.state = 'hand';
    return chip;
  }

  /**
   * Called when the Custom Screen opens (GDD §7.2):
   * 1) unused queued chips burn, 2) kept hand chips stay in their slots,
   * 3) empty/new slots are refilled from the draw pile.
   */
  openTurn(): void {
    for (const c of this.queue) c.state = 'used';
    this.queue = [];
    this.selection = [];

    const kept = this.hand.filter((c): c is ChipInstance => c !== null).length;
    // The hand never discards chips: if more are kept than the current size allows, show them all.
    const target = Math.max(this.handSize, kept);
    const slots = [...this.hand];
    // Shrink by dropping empty slots, trailing ones first.
    for (let i = slots.length - 1; slots.length > target && i >= 0; i--) {
      if (slots[i] === null) slots.splice(i, 1);
    }
    while (slots.length < target) slots.push(null);
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] === null) slots[i] = this.draw();
    }
    this.hand = slots;
  }

  selectedChips(): ChipInstance[] {
    return this.selection.map((i) => this.hand[i] as ChipInstance);
  }

  isSelected(slot: number): boolean {
    return this.selection.includes(slot);
  }

  /** Whether tapping this slot would add it to the selection. */
  canSelect(slot: number): boolean {
    const chip = this.hand[slot];
    if (!chip || this.isSelected(slot)) return false;
    return canAddToSelection(this.selectedChips(), chip, tuning.chips.SELECT_MAX);
  }

  select(slot: number): boolean {
    if (!this.canSelect(slot)) return false;
    this.selection.push(slot);
    return true;
  }

  /** Removes the last selected chip (MMBN1: B cancels the last choice). */
  cancelLast(): boolean {
    return this.selection.pop() !== undefined;
  }

  /** OK: selected chips become the queue, in selection order (GDD §7.4). */
  confirm(): void {
    const picked = this.selectedChips();
    for (const c of picked) c.state = 'queued';
    for (const i of this.selection) this.hand[i] = null;
    this.queue = picked;
    if (picked.length > 0) this.addStreak = 0;
    this.selection = [];
    this.turns++;
  }

  /** ADD: drop the selection, grow the next hand, leave with an empty queue (GDD §7.5). */
  add(): void {
    this.selection = [];
    this.queue = [];
    this.addStreak = Math.min(this.addStreak + 1, 2);
    this.turns++;
  }

  /** Removes and returns the next queued chip (used by chip execution, M4). */
  takeNext(): ChipInstance | null {
    const chip = this.queue.shift() ?? null;
    if (chip) chip.state = 'used';
    return chip;
  }
}
