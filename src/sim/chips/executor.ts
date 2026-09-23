import { secondsToTicks, tuning } from '../../config/tuning';
import { CHIPS, type ChipDef } from '../../data/chips';
import type { ChipInstance } from './chipSystem';

// Chip use timing (GDD §6.5): startup → impact/active → recovery. The chip
// action stays locked for the whole sequence while movement remains live.

export interface ChipTiming {
  startupTicks: number;
  activeTicks: number;
  recoveryTicks: number;
  totalTicks: number;
}

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

export function chipTiming(def: ChipDef): ChipTiming {
  const values = tuning.chips as unknown as Record<string, number>;
  const startupTicks = Math.max(0, secondsToTicks(values[`CHIP_STARTUP_${def.useTime}`] ?? 0));
  const recoveryTicks = Math.max(0, secondsToTicks(values[`CHIP_RECOVERY_${def.useTime}`] ?? 0));
  const hits = Math.max(1, Math.floor(def.hits ?? 1));
  const hitStep = def.hitStep ? Math.max(1, secondsToTicks(tuning.chips[def.hitStep])) : 0;
  const activeTicks = Math.max(0, hits - 1) * hitStep;
  return {
    startupTicks,
    activeTicks,
    recoveryTicks,
    totalTicks: Math.max(1, startupTicks + activeTicks + recoveryTicks),
  };
}

export function useTicks(def: ChipDef): number {
  return chipTiming(def).totalTicks;
}

export function startChip(
  chip: ChipInstance,
  slot: number,
  tick: number,
  originX = 0,
  originY = 0,
): ActiveChip {
  const def = CHIPS[chip.defId];
  const timing = chipTiming(def);
  const hits = Math.max(1, Math.floor(def.hits ?? 1));
  const hitStep = def.hitStep ? Math.max(1, secondsToTicks(tuning.chips[def.hitStep])) : 0;
  const hitTicks = Array.from({ length: hits }, (_, i) => tick + timing.startupTicks + i * hitStep);
  return {
    chip,
    slot,
    def,
    startTick: tick,
    originX,
    originY,
    hitTicks,
    endTick: tick + timing.totalTicks,
    nextHit: 0,
    resolved: false,
  };
}
