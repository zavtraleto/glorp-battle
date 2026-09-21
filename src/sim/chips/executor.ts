import { secondsToTicks, tuning } from '../../config/tuning';
import { CHIPS, type ChipDef } from '../../data/chips';
import type { ChipInstance } from './chipSystem';

// Chip use timing (GDD §6.5): the player is locked for the chip's use time;
// the effect resolves at CHIP_HIT_FRAME (support chips resolve instantly).

export interface ActiveChip {
  readonly chip: ChipInstance;
  /** Hand slot this chip left when the chain started it. */
  readonly slot: number;
  readonly def: ChipDef;
  readonly startTick: number;
  readonly hitTick: number;
  readonly endTick: number;
  resolved: boolean;
}

export function useTicks(def: ChipDef): number {
  const key = `CHIP_USE_TIME_${def.useTime}` as const;
  return Math.max(1, secondsToTicks(tuning.chips[key]));
}

export function startChip(chip: ChipInstance, slot: number, tick: number): ActiveChip {
  const def = CHIPS[chip.defId];
  const total = useTicks(def);
  const hitDelay = def.kind !== 'attack' ? 0 : Math.min(total, secondsToTicks(tuning.chips.CHIP_HIT_FRAME));
  return { chip, slot, def, startTick: tick, hitTick: tick + hitDelay, endTick: tick + total, resolved: false };
}
