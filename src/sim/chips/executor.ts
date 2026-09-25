import { secondsToTicks, tuning } from '../../config/tuning';
import { CHIPS, type ChipDef } from '../../data/chips';
import type { ChipInstance } from './chipSystem';

// Chip use timing (GDD §6.5): startup → impact → recovery. The chip action
// stays locked for the whole sequence while movement remains live.

export interface ChipTiming {
  startupTicks: number;
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
  /** Tick of the chip's single impact. */
  readonly hitTick: number;
  readonly endTick: number;
  /** The effect has resolved, so an interruption cannot return the chip. */
  resolved: boolean;
}

export function chipTiming(def: ChipDef): ChipTiming {
  const t = tuning[def.id];
  const startupTicks = secondsToTicks(t.STARTUP);
  const recoveryTicks = secondsToTicks(t.RECOVERY);
  return {
    startupTicks,
    recoveryTicks,
    totalTicks: Math.max(1, startupTicks + recoveryTicks),
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
  return {
    chip,
    slot,
    def,
    startTick: tick,
    originX,
    originY,
    hitTick: tick + timing.startupTicks,
    endTick: tick + timing.totalTicks,
    resolved: false,
  };
}
