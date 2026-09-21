import { secondsToTicks, tuning } from '../../config/tuning';
import { CHIPS, type ChipDef } from '../../data/chips';
import type { ChipInstance } from './chipSystem';

// Chip use timing (GDD §6.5): selection/Attack stay locked for the chip's use
// time, while movement remains live. Effects resolve at CHIP_HIT_FRAME
// (support chips resolve instantly).

export interface ActiveChip {
  readonly chip: ChipInstance;
  /** Hand slot this chip left when the chain started it. */
  readonly slot: number;
  readonly def: ChipDef;
  readonly startTick: number;
  /** Player cell captured when this link of the series begins. */
  readonly originX: number;
  readonly originY: number;
  readonly hitTicks: readonly number[];
  readonly endTick: number;
  nextHit: number;
  /** At least one effect has resolved, so an interruption cannot return the chip. */
  resolved: boolean;
}

export function useTicks(def: ChipDef): number {
  const key = `CHIP_USE_TIME_${def.useTime}` as const;
  return Math.max(1, secondsToTicks(tuning.chips[key]));
}

export function startChip(
  chip: ChipInstance,
  slot: number,
  tick: number,
  originX = 0,
  originY = 0,
): ActiveChip {
  const def = CHIPS[chip.defId];
  const total = useTicks(def);
  const hitDelay = def.kind !== 'attack' ? 0 : Math.min(total, secondsToTicks(tuning.chips.CHIP_HIT_FRAME));
  const hits = Math.max(1, Math.floor(def.hits ?? 1));
  const hitStep = def.hitStep ? Math.max(1, secondsToTicks(tuning.chips[def.hitStep])) : 0;
  const hitTicks = Array.from({ length: hits }, (_, i) => tick + hitDelay + i * hitStep);
  const lastHit = hitTicks[hitTicks.length - 1] as number;
  return {
    chip,
    slot,
    def,
    startTick: tick,
    originX,
    originY,
    hitTicks,
    endTick: Math.max(tick + total, lastHit),
    nextHit: 0,
    resolved: false,
  };
}
