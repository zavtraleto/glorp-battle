import { secondsToTicks, tuning } from '../../config/tuning';
import type { Rng } from '../../core/rng';
import { CHIPS, type ChipDef, type ChipId } from '../../data/chips';
import { FOLDERS, type FolderId } from '../../data/folders';
import { canAddToSelection, type ChipKey } from './selection';

// Folder, hand, manually fired charge and per-slot cooldown for one battle.
//
// There is no Custom Screen: the hand of five sits in the rail for the whole
// battle and the player builds a series of chips while dodging. A fired chip
// leaves its slot cooling; the next draw arrives there when it ends (GDD §5).

export type ChipState = 'folder' | 'hand' | 'pending' | 'queued' | 'used';

/** What a hand slot shows right now; derived, never stored. */
export type SlotState = 'empty' | 'cooling' | 'ready' | 'queued' | 'blocked' | 'committed' | 'locked';
export type HandPhase = 'selecting' | 'committed';

export interface ChipInstance {
  readonly uid: number;
  readonly defId: ChipId;
  state: ChipState;
  /** Serial of the draw that put this chip in the hand (0 = never drawn); a re-dealt chip gets a new one. */
  deal: number;
}

/** A chip in a run's folder. */
export interface FolderChip {
  defId: ChipId;
}

interface PendingRefill {
  chip: ChipInstance;
  startedAt: number;
  readyAt: number;
}

/** A folder as a flat chip list. */
export function folderChips(id: FolderId): FolderChip[] {
  return FOLDERS[id].flatMap((e) => Array.from({ length: e.count }, () => ({ defId: e.chip })));
}

export function chipDef(chip: ChipInstance): ChipDef {
  return CHIPS[chip.defId];
}

export class ChipSystem {
  /** Every chip of the folder, in folder order. */
  readonly chips: ChipInstance[] = [];
  /** Draw order: shuffled once per battle, then reshuffled from spent chips when it runs dry. */
  private drawPile: ChipInstance[];
  private drawIndex = 0;
  /** Hand slots; null = spent or the folder ran out. Length is hand.SIZE. */
  hand: (ChipInstance | null)[] = [];
  /** Hand slot indices in firing order — the Attack Queue. */
  attack: number[] = [];
  /**
   * Keys of every chip added to the current series, including the ones already
   * fired: the combination rule belongs to the series, not to what is still unfired.
   */
  private series: ChipKey[] = [];
  /** Selection, or a committed manual charge that locks the rest of the hand. */
  phase: HandPhase = 'selecting';
  /** Slots emptied by a spent chip, distinct from intentionally empty slots. */
  private spentSlots: boolean[] = [];
  /** The real next draw assigned to each cooling slot. */
  private pendingRefills: (PendingRefill | null)[] = [];
  /** Times the spent chips went back into the draw pile (GDD §7.5). */
  reshuffles = 0;
  /** Bumped by `replaceFolder`: the old hand was swapped out, not spent. */
  folderVersion = 0;
  /** Draws so far; each draw stamps its chip with the next serial. */
  private deals = 0;

  constructor(
    folder: FolderId | readonly FolderChip[],
    private readonly rng: Rng,
  ) {
    this.drawPile = [];
    this.fill(typeof folder === 'string' ? folderChips(folder) : folder);
    this.hand = new Array<ChipInstance | null>(tuning.hand.SIZE).fill(null);
    this.pendingRefills = new Array<PendingRefill | null>(tuning.hand.SIZE).fill(null);
    this.spentSlots = new Array<boolean>(tuning.hand.SIZE).fill(false);
  }

  private fill(list: readonly FolderChip[]): void {
    const first = (this.chips[this.chips.length - 1]?.uid ?? 0) + 1;
    this.chips.length = 0;
    list.forEach((c, i) => this.chips.push({ uid: first + i, defId: c.defId, state: 'folder', deal: 0 }));
    this.drawPile = this.rng.shuffle([...this.chips]);
    this.drawIndex = 0;
  }

  /**
   * Tutorial (GDD §10.5): every lesson brings its own folder. The hand, the
   * queue and the cooldowns are cleared; uids keep counting so the rail never
   * mistakes a new cassette for an old one.
   */
  replaceFolder(list: readonly FolderChip[]): void {
    this.folderVersion++;
    this.fill(list);
    this.hand = new Array<ChipInstance | null>(tuning.hand.SIZE).fill(null);
    this.pendingRefills = new Array<PendingRefill | null>(tuning.hand.SIZE).fill(null);
    this.spentSlots = new Array<boolean>(tuning.hand.SIZE).fill(false);
    this.resetCycle();
  }

  get drawRemaining(): number {
    return this.drawPile.length - this.drawIndex;
  }

  /** True from the first shot until the charge's last chip has recovered. */
  get locked(): boolean {
    return this.phase !== 'selecting';
  }

  get coolingCount(): number {
    return this.pendingRefills.filter((refill) => refill !== null).length;
  }

  count(state: ChipState): number {
    return this.chips.filter((c) => c.state === state).length;
  }

  private draw(reservedUid: number | null = null, state: 'hand' | 'pending' = 'hand'): ChipInstance | null {
    if (this.drawIndex >= this.drawPile.length) this.reshuffleSpent(reservedUid);
    const chip = this.drawPile[this.drawIndex];
    if (!chip) return null;
    this.drawIndex++;
    chip.state = state;
    chip.deal = ++this.deals;
    return chip;
  }

  /** Empty pile: every spent chip is shuffled back in (GDD §7.5). */
  private reshuffleSpent(reservedUid: number | null = null): void {
    const spent = this.chips.filter((c) => c.state === 'used' && c.uid !== reservedUid);
    if (spent.length === 0) return;
    for (const c of spent) c.state = 'folder';
    this.drawPile.length = 0;
    this.drawPile.push(...this.rng.shuffle(spent));
    this.drawIndex = 0;
    this.reshuffles++;
  }

  /** Fills the hand at the start of the battle (GDD §7.6). */
  dealHand(): void {
    this.hand = Array.from({ length: tuning.hand.SIZE }, () => this.draw());
    this.pendingRefills = new Array<PendingRefill | null>(tuning.hand.SIZE).fill(null);
    this.spentSlots = new Array<boolean>(tuning.hand.SIZE).fill(false);
    this.resetCycle();
  }

  /** Tutorial (GDD §10.5): the exact hand by slot; null leaves the slot empty. */
  dealHandExact(spec: readonly (FolderChip | null)[]): void {
    this.hand = new Array<ChipInstance | null>(tuning.hand.SIZE).fill(null);
    this.pendingRefills = new Array<PendingRefill | null>(tuning.hand.SIZE).fill(null);
    this.spentSlots = new Array<boolean>(tuning.hand.SIZE).fill(false);
    this.resetCycle();
    for (let i = 0; i < Math.min(spec.length, this.hand.length); i++) {
      const want = spec[i];
      if (want) this.dealSlot(i, want);
    }
  }

  /**
   * Takes the named chip out of the draw pile and puts it in an empty slot,
   * stamped with a new deal serial so the rail flies the cassette in (GDD §7.5).
   * Returns null when the slot is taken or the pile has no such chip.
   */
  dealSlot(slot: number, spec: FolderChip): ChipInstance | null {
    if (slot < 0 || slot >= this.hand.length || this.hand[slot] !== null) return null;
    const at = this.drawPile.findIndex(
      (c, i) => i >= this.drawIndex && c.defId === spec.defId,
    );
    if (at < 0) return null;
    const [chip] = this.drawPile.splice(at, 1) as [ChipInstance];
    chip.state = 'hand';
    chip.deal = ++this.deals;
    this.hand[slot] = chip;
    this.pendingRefills[slot] = null;
    this.spentSlots[slot] = false;
    return chip;
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
    if (!chip) return this.pendingRefills[slot] ? 'cooling' : 'empty';
    if (this.queueIndexOf(slot) >= 0) return this.phase === 'selecting' ? 'queued' : 'committed';
    if (this.phase !== 'selecting') return 'locked';
    return this.fitsSeries(chip) ? 'ready' : 'blocked';
  }

  /** Whether this chip could join the current series (GDD §7.3). */
  private fitsSeries(chip: ChipKey): boolean {
    return canAddToSelection(this.series, chip, tuning.hand.SIZE);
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
    if (this.phase !== 'selecting') return false;
    const at = this.queueIndexOf(slot);
    if (at >= 0) {
      this.attack.splice(at, 1);
      this.rebuildSeries();
      return true;
    }
    if (!this.canSelect(slot)) return false;
    this.attack.push(slot);
    this.series.push(this.hand[slot] as ChipInstance);
    return true;
  }

  /** Commits the selected series: its order is fixed and the rest of the hand locks. */
  commitAttack(): boolean {
    if (this.attack.length === 0) return false;
    this.phase = 'committed';
    return true;
  }

  /** Releases and returns the slots of every selected chip that has not started yet. */
  cancelAttack(): number[] {
    const cancelled = [...this.attack];
    this.attack = [];
    this.series = [];
    this.phase = 'selecting';
    return cancelled;
  }

  /** Returns an interrupted, unresolved chip to the slot it just left. */
  restoreInterrupted(chip: ChipInstance, slot: number): boolean {
    if (slot < 0 || slot >= this.hand.length || this.hand[slot] !== null) return false;
    chip.state = 'hand';
    this.hand[slot] = chip;
    this.pendingRefills[slot] = null;
    this.spentSlots[slot] = false;
    return true;
  }

  /** Unlocks selection once the charge has used every selected chip (GDD §5). */
  finishAttack(): void {
    if (this.attack.length > 0) return;
    this.series = [];
    this.phase = 'selecting';
  }

  /** After a removal the series is exactly what is queued (nothing has fired). */
  private rebuildSeries(): void {
    this.series = this.attackChips();
  }

  /** Fires the first chip of the Attack Queue (GDD §7.4). */
  takeNext(_tick = 0): ChipInstance | null {
    const slot = this.attack.shift();
    if (slot === undefined) return null;
    const chip = this.hand[slot];
    if (!chip) return null;
    chip.state = 'used';
    this.hand[slot] = null;
    this.pendingRefills[slot] = null;
    this.spentSlots[slot] = true;
    return chip;
  }

  /** Permanently consumes every unstarted chip in the committed tail. */
  burnAttackTail(): number[] {
    const burned: number[] = [];
    while (this.attack.length > 0) {
      const slot = this.attack.shift();
      if (slot === undefined) break;
      const chip = this.hand[slot];
      if (!chip) continue;
      chip.state = 'used';
      this.hand[slot] = null;
      this.pendingRefills[slot] = null;
      this.spentSlots[slot] = true;
      burned.push(slot);
    }
    return burned;
  }

  /**
   * Reserves the real next draw once the outgoing chip can no longer return;
   * the slot cools for `hand.REFILL_COOLDOWN` from `tick` (GDD §5).
   */
  reserveRefill(slot: number, tick: number, reservedUid: number | null = null): ChipInstance | null {
    if (slot < 0 || slot >= this.hand.length || this.hand[slot] !== null) return null;
    const existing = this.pendingRefills[slot];
    if (existing) return existing.chip;
    const chip = this.draw(reservedUid, 'pending');
    if (!chip) return null;
    this.pendingRefills[slot] = { chip, startedAt: tick, readyAt: tick + secondsToTicks(tuning.hand.REFILL_COOLDOWN) };
    return chip;
  }

  pendingChip(slot: number): ChipInstance | null {
    return this.pendingRefills[slot]?.chip ?? null;
  }

  /** Cooling progress for the reserved chip, or null when no chip is assigned. */
  refillProgress(slot: number, tick: number): number | null {
    const pending = this.pendingRefills[slot];
    if (!pending) return null;
    const span = pending.readyAt - pending.startedAt;
    if (span <= 0) return 1;
    return Math.max(0, Math.min(1, (tick - pending.startedAt) / span));
  }

  /**
   * Combo bonus (GDD §5): brings the named cooling slots `ticks` closer to
   * ready, never before their cooldown began. Returns the slots it cut.
   */
  cutCooldowns(slots: readonly number[], ticks: number): number[] {
    const cut: number[] = [];
    for (const slot of slots) {
      const pending = this.pendingRefills[slot];
      if (!pending || ticks <= 0) continue;
      pending.readyAt = Math.max(pending.startedAt, pending.readyAt - ticks);
      cut.push(slot);
    }
    return cut;
  }

  /**
   * One pass per tick: a spent slot without a reserved chip reserves one (a
   * burned tail, a folder that ran dry), and every slot whose cooldown is over
   * takes its chip. `reserved` is the active chip that may still return to its
   * slot. A chip arriving during a committed charge stays locked until it ends.
   */
  refillReady(tick: number, reserved: { slot: number; uid: number } | null = null): number {
    let refilled = 0;
    for (let slot = 0; slot < this.hand.length; slot++) {
      if (slot === reserved?.slot) continue;
      if (!this.spentSlots[slot] || this.hand[slot] !== null) continue;
      const pending = this.pendingRefills[slot];
      if (!pending) {
        this.reserveRefill(slot, tick, reserved?.uid ?? null);
        continue;
      }
      if (tick < pending.readyAt) continue;
      pending.chip.state = 'hand';
      this.hand[slot] = pending.chip;
      this.pendingRefills[slot] = null;
      this.spentSlots[slot] = false;
      refilled++;
    }
    return refilled;
  }

  private resetCycle(): void {
    this.attack = [];
    this.series = [];
    this.phase = 'selecting';
  }
}
