import { describe, expect, it } from 'vitest';
import { planShards, shardPose, SHARD_COUNT, type ShardParams } from '../src/terminal/chips/shatter';

// The burst of a cartridge that spent its last charge (TERMINAL.md §6.5).

const PARAMS: ShardParams = { width: 1, inherit: { x: 0, y: 0, z: 0 }, speed: 6, gravity: 30, life: 0.6 };

describe('cartridge shatter', () => {
  it('plans the same shards for the same deal and different ones for another', () => {
    expect(planShards(7)).toEqual(planShards(7));
    expect(planShards(7)).not.toEqual(planShards(8));
    expect(planShards(7)).toHaveLength(SHARD_COUNT);
  });

  it('carries every part of the cartridge: panel, label and plastic', () => {
    const parts = new Set(planShards(3).map((s) => s.part));
    expect([...parts].sort()).toEqual(['body', 'label', 'panel']);
  });

  it('bursts outward, then falls and shrinks away by the end of its life', () => {
    for (const seed of planShards(11)) {
      const start = shardPose(seed, 0, PARAMS);
      const early = shardPose(seed, 0.1, PARAMS);
      const d0 = Math.hypot(start.x, start.y, start.z);
      expect(Math.hypot(early.x, early.y, early.z)).toBeGreaterThan(d0);
      expect(shardPose(seed, 0.6, PARAMS).y).toBeLessThan(early.y);
      expect(shardPose(seed, PARAMS.life, PARAMS).scale).toBe(0);
      expect(start.scale).toBeGreaterThan(0);
    }
  });

  it('keeps the flight of the cartridge it came from', () => {
    const [seed] = planShards(5);
    const still = shardPose(seed!, 0.2, PARAMS);
    const moving = shardPose(seed!, 0.2, { ...PARAMS, inherit: { x: 2, y: 0, z: 0 } });
    expect(moving.x - still.x).toBeCloseTo(0.4);
  });
});
