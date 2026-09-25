import { secondsToTicks, tuning } from '../../config/tuning';
import type { Rng } from '../../core/rng';
import { CHIPS, type ChipDef, type ChipId } from '../../data/chips';
import { FOLDERS, type FolderId } from '../../data/folders';
import { canAddToSelection, type ChipKey } from './selection';

// Folder, hand, manually fired charge and shared hand cooldown for one battle.
//
// There is no Custom Screen: the hand of five sits in the rail for the whole
// battle and the player builds a series of chips while dodging. A fired chip
// leaves its slot empty until that chip's refill cooldown elapses. Every copy
// has charges for the battle; at zero it leaves the folder (GDD §6.1, §7.5).

/** `exhausted`: no charges left, out of the folder until the battle ends. */
export type ChipState = 'folder' | 'hand' | 'pending' | 'queued' | 'used' | 'exhausted';

/** What a hand slot shows right now; derived, never stored. */
export type SlotState = 'empty' | 'cooling' | 'ready' | 'queued' | 'blocked' | 'committed' | 'locked';
export type HandPhase = 'selecting' | 'committed' | 'waiting';

export interface ChipInstance {
  readonly uid: number;
  readonly defId: ChipId;
  state: ChipState;
  /** Serial of the draw that put this chip in the hand (0 = never drawn); a re-dealt chip gets a new one. */
  deal: number;
  /** Uses left in this battle (GDD §6.1). */
  charges: number;
  readonly maxCharges: number;
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
  /** Hand slots; null = spent or the folder ran out. Length is HAND_SIZE. */
  hand: (ChipInstance | null)[] = [];
  /** Hand slot indices in firing order — the Attack Queue. */
  attack: number[] = [];
  /**
   * Keys of every chip added to the current series, including the ones already
   * fired: the combination rule belongs to the series, not to what is still unfired.
   */
  private series: ChipKey[] = [];
  /** Selection, committed manual charge, or cooldown wait before the next selection. */
  phase: HandPhase = 'selecting';
  /** Shared next-hand cooldown; Combo State may delay its start until exit. */
  private refillStartedAt: number | null = null;
  private refillReadyAt: number | null = null;
  /** Slots emptied by this or an earlier charge, distinct from intentionally empty slots. */
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
    this.hand = new Array<ChipInstance | null>(tuning.chips.HAND_SIZE).fill(null);
    this.pendingRefills = new Array<PendingRefill | null>(tuning.chips.HAND_SIZE).fill(null);
    this.spentSlots = new Array<boolean>(tuning.chips.HAND_SIZE).fill(false);
  }

  private fill(list: readonly FolderChip[]): void {
    const first = (this.chips[this.chips.length - 1]?.uid ?? 0) + 1;
    this.chips.length = 0;
    list.forEach((c, i) => {
      const charges = CHIPS[c.defId].charges;
      this.chips.push({ uid: first + i, defId: c.defId, state: 'folder', deal: 0, charges, maxCharges: charges });
    });
    this.drawPile = this.rng.shuffle([...this.chips]);
    this.drawIndex = 0;
  }

  /**
   * Tutorial (GDD §10.5): every lesson brings its own folder. The hand, the
   * queue and the cooldown are cleared; uids keep counting so the rail never
   * mistakes a new cassette for an old one.
   */
  replaceFolder(list: readonly FolderChip[]): void {
    this.folderVersion++;
    this.fill(list);
    this.hand = new Array<ChipInstance | null>(tuning.chips.HAND_SIZE).fill(null);
    this.pendingRefills = new Array<PendingRefill | null>(tuning.chips.HAND_SIZE).fill(null);
    this.spentSlots = new Array<boolean>(tuning.chips.HAND_SIZE).fill(false);
    this.resetCycle();
  }

  get drawRemaining(): number {
    return this.drawPile.length - this.drawIndex;
  }

  /** True after the first shot until the shared cooldown opens the next hand. */
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

  /** Empty pile: every spent chip with charges left is shuffled back in (GDD §7.5). */
  private reshuffleSpent(reservedUid: number | null = null): void {
    let spent = this.chips.filter((c) => c.state === 'used' && c.uid !== reservedUid);
    // TEMP until T3 (empty folder): with nothing left to draw, exhausted copies
    // come back with full charges so the battle never stalls.
    if (spent.length === 0) {
      spent = this.chips.filter((c) => c.state === 'exhausted');
      for (const c of spent) c.charges = c.maxCharges;
    }
    if (spent.length === 0) return;
    for (const c of spent) c.state = 'folder';
    this.drawPile.length = 0;
    this.drawPile.push(...this.rng.shuffle(spent));
    this.drawIndex = 0;
    this.reshuffles++;
  }

  /** Fills the hand at the start of the battle (GDD §7.6). */
  dealHand(): void {
    this.hand = Array.from({ length: tuning.chips.HAND_SIZE }, () => this.draw());
    this.pendingRefills = new Array<PendingRefill | null>(tuning.chips.HAND_SIZE).fill(null);
    this.spentSlots = new Array<boolean>(tuning.chips.HAND_SIZE).fill(false);
    this.resetCycle();
  }

  /** Tutorial (GDD §10.5): the exact hand by slot; null leaves the slot empty. */
  dealHandExact(spec: readonly (FolderChip | null)[]): void {
    this.hand = new Array<ChipInstance | null>(tuning.chips.HAND_SIZE).fill(null);
    this.pendingRefills = new Array<PendingRefill | null>(tuning.chips.HAND_SIZE).fill(null);
    this.spentSlots = new Array<boolean>(tuning.chips.HAND_SIZE).fill(false);
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

  /** Commits the selected series without starting the next-hand cooldown. */
  commitAttack(): boolean {
    if (this.phase === 'waiting' || this.attack.length === 0) return false;
    if (this.phase === 'committed') return true;
    this.phase = 'committed';
    return true;
  }

  /** Starts the shared next-hand cooldown once; delayed combos call this on exit. */
  startCooldown(tick = 0): void {
    if (this.refillStartedAt !== null) return;
    this.refillStartedAt = tick;
    this.refillReadyAt = tick + secondsToTicks(tuning.chips.HAND_REFILL_COOLDOWN);
  }

  /** Existing single-chip entry point: commit and start cooldown immediately. */
  startAttack(tick = 0): boolean {
    if (!this.commitAttack()) return false;
    this.startCooldown(tick);
    return true;
  }

  /** Releases and returns the slots of every selected chip that has not started yet. */
  cancelAttack(): number[] {
    const cancelled = [...this.attack];
    this.attack = [];
    this.series = [];
    if (this.phase === 'committed') this.phase = 'waiting';
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

  /** Unlocks selection after the frozen chain has used every selected chip. */
  finishAttack(): void {
    if (this.attack.length > 0) return;
    this.series = [];
    if (this.phase === 'committed') this.phase = 'waiting';
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

  /**
   * A fired chip reached its hit frame: one charge is gone, and a spent copy
   * at zero leaves the folder. Interrupted and burned chips keep theirs.
   */
  spendCharge(chip: ChipInstance): void {
    chip.charges = Math.max(0, chip.charges - 1);
    if (chip.charges === 0 && chip.state === 'used') chip.state = 'exhausted';
  }

  /** Discards every unstarted chip in the committed tail without spending charges. */
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

  /** Reserves the real next draw once the outgoing chip can no longer return. */
  reserveRefill(slot: number, reservedUid: number | null = null): ChipInstance | null {
    if (slot < 0 || slot >= this.hand.length || this.hand[slot] !== null) return null;
    const readyAt = this.refillReadyAt;
    if (readyAt === null) return null;
    const existing = this.pendingRefills[slot];
    if (existing) return existing.chip;
    const chip = this.draw(reservedUid, 'pending');
    if (!chip) return null;
    const startedAt = this.refillStartedAt ?? readyAt;
    this.pendingRefills[slot] = { chip, startedAt, readyAt };
    return chip;
  }

  /** Assigns replacement chips to every spent slot after delayed cooldown starts. */
  reserveSpentRefills(): void {
    if (this.refillReadyAt === null) return;
    for (let slot = 0; slot < this.hand.length; slot++) {
      if (this.spentSlots[slot] && this.hand[slot] === null) this.reserveRefill(slot);
    }
  }

  pendingChip(slot: number): ChipInstance | null {
    return this.pendingRefills[slot]?.chip ?? null;
  }

  /** Shared hand cooldown progress, including retained chips that are locked. */
  handCooldownProgress(tick: number): number | null {
    if (this.refillStartedAt === null || this.refillReadyAt === null) return null;
    const span = this.refillReadyAt - this.refillStartedAt;
    if (span <= 0) return 1;
    return Math.max(0, Math.min(1, (tick - this.refillStartedAt) / span));
  }

  /** Cooling progress for the reserved chip, or null when no chip is assigned. */
  refillProgress(slot: number, tick: number): number | null {
    const pending = this.pendingRefills[slot];
    if (!pending) return null;
    const span = pending.readyAt - pending.startedAt;
    if (span <= 0) return 1;
    return Math.max(0, Math.min(1, (tick - pending.startedAt) / span));
  }

  /** Activates all spent slots only after both charge completion and cooldown. */
  refillReady(tick: number, reserved: { slot: number; uid: number } | null = null): number {
    if (this.phase !== 'waiting' || this.refillReadyAt === null || tick < this.refillReadyAt) return 0;
    let refilled = 0;
    for (let slot = 0; slot < this.hand.length; slot++) {
      if (slot === reserved?.slot) continue;
      if (!this.spentSlots[slot] || this.hand[slot] !== null) continue;
      const chip = this.pendingRefills[slot]?.chip ?? this.reserveRefill(slot, reserved?.uid ?? null);
      if (!chip) continue;
      chip.state = 'hand';
      this.hand[slot] = chip;
      this.pendingRefills[slot] = null;
      this.spentSlots[slot] = false;
      refilled++;
    }
    this.resetCycle();
    return refilled;
  }

  private resetCycle(): void {
    this.attack = [];
    this.series = [];
    this.phase = 'selecting';
    this.refillStartedAt = null;
    this.refillReadyAt = null;
  }
}
