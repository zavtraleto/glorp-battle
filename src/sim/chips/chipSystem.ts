import { tuning } from '../../config/tuning';
import type { Rng } from '../../core/rng';
import { CHIPS, type ChipCode, type ChipDef, type ChipId } from '../../data/chips';
import { FOLDERS, type FolderId } from '../../data/folders';
import { canAddToSelection, type ChipKey } from './selection';

// Folder, hand, Attack Queue and Refresh for one battle (GDD §5, §7).
//
// There is no Custom Screen: the hand of five sits in the rail for the whole
// battle and the player builds a series of chips while dodging. A fired chip
// leaves its slot empty; every REFRESH_AT fired chips the empty slots refill
// from the draw queue.

export type ChipState = 'folder' | 'hand' | 'queued' | 'used';

/** What a hand slot shows right now; derived, never stored. */
export type SlotState = 'empty' | 'ready' | 'queued' | 'blocked';

export interface ChipInstance {
  readonly uid: number;
  readonly defId: ChipId;
  readonly code: ChipCode;
  state: ChipState;
  /** Generation of the player who left this chip (roguelite spec §6.4). */
  readonly legacyGen?: number;
}

/** A chip in a run's folder (roguelite spec §6.1). */
export interface FolderChip {
  defId: ChipId;
  code: ChipCode;
  legacyGen?: number;
}

/** A debug folder as a flat chip list. */
export function folderChips(id: FolderId): FolderChip[] {
  return FOLDERS[id].flatMap((e) => Array.from({ length: e.count }, () => ({ defId: e.chip, code: e.code })));
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
  /** Hand slots; null = spent or the folder ran out. Length is HAND_SIZE. */
  hand: (ChipInstance | null)[] = [];
  /** Hand slot indices in firing order — the Attack Queue. */
  attack: number[] = [];
  /**
   * Keys of every chip added to the current series, including the ones already
   * fired: the code rule belongs to the series, not to what is still unfired.
   */
  private series: ChipKey[] = [];
  /** A shot has been fired from this series, so chips can no longer be taken back. */
  private fired = false;
  /** Chips spent since the last Refresh. */
  usedSinceRefresh = 0;
  /** Completed Refreshes. */
  refreshes = 0;

  constructor(folder: FolderId | readonly FolderChip[], rng: Rng) {
    const list = typeof folder === 'string' ? folderChips(folder) : folder;
    let uid = 1;
    for (const c of list) {
      this.chips.push({ uid: uid++, defId: c.defId, code: c.code, state: 'folder', legacyGen: c.legacyGen });
    }
    this.drawPile = rng.shuffle([...this.chips]);
    this.hand = new Array<ChipInstance | null>(tuning.chips.HAND_SIZE).fill(null);
  }

  get drawRemaining(): number {
    return this.drawPile.length - this.drawIndex;
  }

  /** True once the first chip of the current series has been fired. */
  get locked(): boolean {
    return this.fired;
  }

  get refreshDue(): boolean {
    return this.usedSinceRefresh >= tuning.chips.REFRESH_AT;
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

  /** Fills the hand at the start of the battle (GDD §7.6). */
  dealHand(): void {
    this.hand = Array.from({ length: tuning.chips.HAND_SIZE }, () => this.draw());
  }

  /** The next chips of the draw queue, for the preview strip (GDD §7.5). */
  drawPreview(n: number): ChipInstance[] {
    return this.drawPile.slice(this.drawIndex, this.drawIndex + Math.max(0, n));
  }

  attackChips(): ChipInstance[] {
    return this.attack.map((i) => this.hand[i] as ChipInstance);
  }

  queueIndexOf(slot: number): number {
    return this.attack.indexOf(slot);
  }

  /** 1-based position in the Attack Queue, or 0 when the slot is not queued. */
  queuePosition(slot: number): number {
    return this.queueIndexOf(slot) + 1;
  }

  slotState(slot: number): SlotState {
    const chip = this.hand[slot];
    if (!chip) return 'empty';
    if (this.queueIndexOf(slot) >= 0) return 'queued';
    return this.fitsSeries(chip) ? 'ready' : 'blocked';
  }

  /** Whether this chip could join the current series (GDD §7.3). */
  private fitsSeries(chip: ChipKey): boolean {
    return canAddToSelection(this.series, chip, tuning.chips.HAND_SIZE);
  }

  /** Whether tapping this slot would add it to the Attack Queue. */
  canSelect(slot: number): boolean {
    return this.slotState(slot) === 'ready';
  }

  /**
   * One tap on a hand slot (GDD §7.2): adds the chip to the Attack Queue, or
   * takes it back out while the series has not fired yet. Returns whether
   * anything changed.
   */
  toggleSelect(slot: number): boolean {
    const at = this.queueIndexOf(slot);
    if (at >= 0) {
      // Taking a chip back is refused once the series has started firing.
      if (this.fired) return false;
      this.attack.splice(at, 1);
      this.rebuildSeries();
      return true;
    }
    if (!this.canSelect(slot)) return false;
    this.attack.push(slot);
    this.series.push(this.hand[slot] as ChipInstance);
    return true;
  }

  /** After a removal the series is exactly what is queued (nothing has fired). */
  private rebuildSeries(): void {
    this.series = this.attackChips();
  }

  /** Fires the first chip of the Attack Queue (GDD §7.4). */
  takeNext(): ChipInstance | null {
    const slot = this.attack.shift();
    if (slot === undefined) return null;
    const chip = this.hand[slot];
    if (!chip) return null;
    chip.state = 'used';
    this.hand[slot] = null;
    this.usedSinceRefresh++;
    if (this.attack.length === 0) {
      // The series is spent: the next one may start with any chip.
      this.series = [];
      this.fired = false;
    } else {
      this.fired = true;
    }
    return chip;
  }

  /** Refills every empty slot from the draw queue and clears the counter (GDD §5). */
  refresh(): void {
    for (let i = 0; i < this.hand.length; i++) {
      if (this.hand[i] === null) this.hand[i] = this.draw();
    }
    this.usedSinceRefresh = 0;
    this.refreshes++;
  }
}
