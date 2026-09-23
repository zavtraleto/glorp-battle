import { tuning, type Tuning } from '../config/tuning';
import type { ArtId } from './spriteArt';

export type HologramCharacter = ArtId;

export interface HologramConfig {
  originalColorRetention: number;
  baseBrightness: number;
  scanlineSpacing: number;
  scanlineWidth: number;
  scanlineCurvature: number;
  scanlineStrength: number;
  emissionStrength: number;
  haloStrength: number;
  bloomStrength: number;
  glitchAmount: number;
  edgeParticleAmount: number;
  brightSweepStrength: number;
  brightSweepSpeed: number;
  brightSweepWidth: number;
  thinSweepStrength: number;
  thinSweepWidth: number;
  thinSweepSpeedMin: number;
  thinSweepSpeedMax: number;
  dropoutAmount: number;
  dropoutSize: number;
  dropoutSpeed: number;
  dropoutAngle: number;
  glowColor: string;
}

/** Character-specific differences stay small; every omitted value comes from live global tuning. */
export const HOLOGRAM_CHARACTER_OVERRIDES: Partial<Record<HologramCharacter, Partial<HologramConfig>>> = {
  mettik: { glowColor: '#9BE564' },
  canodron: { glowColor: '#FFB45E' },
  hopzap: { glowColor: '#7EE7FF' },
  bladdy: { glowColor: '#FF7A7A' },
};

function configFromTuning(v: Tuning['hologram']): HologramConfig {
  return {
    originalColorRetention: v.ORIGINAL_COLOR_RETENTION,
    baseBrightness: v.BASE_BRIGHTNESS,
    scanlineSpacing: v.SCANLINE_SPACING,
    scanlineWidth: v.SCANLINE_WIDTH,
    scanlineCurvature: v.SCANLINE_CURVATURE,
    scanlineStrength: v.SCANLINE_STRENGTH,
    emissionStrength: v.EMISSION_STRENGTH,
    haloStrength: v.HALO_STRENGTH,
    bloomStrength: v.BLOOM_STRENGTH,
    glitchAmount: v.GLITCH_AMOUNT,
    edgeParticleAmount: v.EDGE_PARTICLE_AMOUNT,
    brightSweepStrength: v.BRIGHT_SWEEP_STRENGTH,
    brightSweepSpeed: v.BRIGHT_SWEEP_SPEED,
    brightSweepWidth: v.BRIGHT_SWEEP_WIDTH,
    thinSweepStrength: v.THIN_SWEEP_STRENGTH,
    thinSweepWidth: v.THIN_SWEEP_WIDTH,
    thinSweepSpeedMin: v.THIN_SWEEP_SPEED_MIN,
    thinSweepSpeedMax: v.THIN_SWEEP_SPEED_MAX,
    dropoutAmount: v.DROPOUT_AMOUNT,
    dropoutSize: v.DROPOUT_SIZE,
    dropoutSpeed: v.DROPOUT_SPEED,
    dropoutAngle: v.DROPOUT_ANGLE,
    glowColor: v.GLOW_COLOR,
  };
}

export function resolveHologramConfig(character: HologramCharacter): HologramConfig {
  return { ...configFromTuning(tuning.hologram), ...HOLOGRAM_CHARACTER_OVERRIDES[character] };
}

const CHARACTER_SEED: Record<HologramCharacter, number> = {
  player: 11,
  mettik: 23,
  canodron: 37,
  hopzap: 53,
  bladdy: 71,
};

/** Small positive float with stable variation between art types and actor instances. */
export function hologramSeed(character: HologramCharacter, instanceId: number): number {
  const mixed = Math.imul(CHARACTER_SEED[character], 0x45d9f3b) ^ Math.imul(instanceId | 0, 0x27d4eb2d);
  return ((mixed >>> 0) % 1_000_003) / 1_000_003 + 0.001;
}

/** Stable per-actor speed for the narrow sweep; debug bounds may be entered in either order. */
export function thinSweepSpeed(config: HologramConfig, seed: number): number {
  const min = Math.min(config.thinSweepSpeedMin, config.thinSweepSpeedMax);
  const max = Math.max(config.thinSweepSpeedMin, config.thinSweepSpeedMax);
  const wave = Math.sin(seed * 12_989.731 + 78.233) * 43_758.5453;
  const random = wave - Math.floor(wave);
  return min + (max - min) * random;
}
