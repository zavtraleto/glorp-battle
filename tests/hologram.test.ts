import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { resetTuning } from '../src/config/tuning';
import {
  HOLOGRAM_PADDING,
  HologramSpriteMaterial,
  paddedSpriteMetrics,
} from '../src/render/hologramMaterial';
import {
  HOLOGRAM_CHARACTER_OVERRIDES,
  hologramSeed,
  resolveHologramConfig,
  thinSweepSpeed,
} from '../src/render/hologramConfig';
import { PixelSprite } from '../src/render/pixelSprite';
import { playerBitmap } from '../src/render/playerSprite';
import type { SpriteArt } from '../src/render/spriteArt';

describe('hologram configuration', () => {
  beforeEach(() => resetTuning());

  it('maps the visually tuned preset to the player hologram', () => {
    const config = resolveHologramConfig('player');
    expect(config).toMatchObject({
      originalColorRetention: 0.75,
      baseBrightness: 0.85,
      scanlineSpacing: 1.5,
      scanlineWidth: 0.12,
      scanlineCurvature: 0,
      scanlineStrength: 0.75,
      emissionStrength: 0.07,
      haloStrength: 0.2,
      bloomStrength: 0.1,
      glitchAmount: 0.05,
      edgeParticleAmount: 1,
      brightSweepStrength: 0.15,
      brightSweepSpeed: 0.07,
      brightSweepWidth: 0.03,
      thinSweepStrength: 0.21,
      thinSweepWidth: 0.012,
      thinSweepSpeedMin: 0.14,
      thinSweepSpeedMax: 0.21,
      dropoutAmount: 0.065,
      dropoutSize: 1.7,
      dropoutSpeed: 0.15,
      dropoutAngle: -34,
      glowColor: '#8ACE00',
    });
  });

  it('applies a character override without duplicating or replacing the base preset', () => {
    expect(HOLOGRAM_CHARACTER_OVERRIDES.mettik).toEqual({ glowColor: '#9BE564' });
    const player = resolveHologramConfig('player');
    const mettik = resolveHologramConfig('mettik');
    expect(mettik.glowColor).toBe('#9BE564');
    expect({ ...mettik, glowColor: player.glowColor }).toEqual(player);
  });

  it('derives stable, distinct shader seeds from character and actor identity', () => {
    expect(hologramSeed('player', 1)).toBe(hologramSeed('player', 1));
    expect(hologramSeed('mettik', 7)).not.toBe(hologramSeed('mettik', 8));
    expect(hologramSeed('mettik', 7)).not.toBe(hologramSeed('canodron', 7));
  });

  it('chooses a stable thin-sweep speed inside the configured faster range', () => {
    const config = resolveHologramConfig('player');
    const seed = hologramSeed('player', 1);
    const speed = thinSweepSpeed(config, seed);
    expect(speed).toBe(thinSweepSpeed(config, seed));
    expect(speed).toBeGreaterThanOrEqual(0.14);
    expect(speed).toBeLessThanOrEqual(0.21);
    expect(speed).toBeGreaterThan(config.brightSweepSpeed);
  });
});

function art(): SpriteArt {
  const make = () => {
    const texture = new THREE.DataTexture(new Uint8Array([255, 120, 80, 255]), 1, 1, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
  };
  return { w: 128, h: 160, normal: make(), flashed: make() };
}

describe('hologram sprite material', () => {
  beforeEach(() => resetTuning());

  it('uses a native sprite material with stable uniforms that update in place', () => {
    const texture = art().normal;
    const material = new HologramSpriteMaterial(texture, 'player', 1);
    expect(material).toBeInstanceOf(THREE.SpriteMaterial);
    expect(material.transparent).toBe(true);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);

    const shader = { uniforms: {}, fragmentShader: '' } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    const uniforms = shader.uniforms as Record<string, { value: unknown }>;
    const identity = material;
    material.setTime(4.25);
    material.setVisualSize(84, 105);
    material.setDissolve(0.6);
    expect(material).toBe(identity);
    expect(uniforms.uHoloTime!.value).toBe(4.25);
    expect((uniforms.uHoloVisualSize!.value as THREE.Vector2).toArray()).toEqual([84, 105]);
    expect(uniforms.uHoloDissolve!.value).toBeCloseTo(0.8, 6);
    expect(uniforms.uHoloScanlineStrength!.value).toBe(0.75);
    expect(uniforms.uHoloThinSweepStrength!.value).toBe(0.21);
    expect(uniforms.uHoloThinSweepWidth!.value).toBe(0.012);
    expect(uniforms.uHoloThinSweepSpeed!.value as number).toBeGreaterThan(0.07);
  });

  it('expands the quad while preserving the source image size and foot anchor', () => {
    const metrics = paddedSpriteMetrics(72, 90);
    expect(metrics.width * (1 - HOLOGRAM_PADDING * 2)).toBeCloseTo(72, 6);
    expect(metrics.height * (1 - HOLOGRAM_PADDING * 2)).toBeCloseTo(90, 6);
    expect(metrics.centerY).toBe(HOLOGRAM_PADDING);
  });

  it('opts only PNG art into the hologram material path', () => {
    const png = new PixelSprite(art(), 'phosphor', { character: 'player', instanceId: 1 });
    const procedural = new PixelSprite(playerBitmap(), 'phosphor');
    expect(png.sprite.material).toBeInstanceOf(HologramSpriteMaterial);
    expect(procedural.sprite.material).toBeInstanceOf(THREE.SpriteMaterial);
    expect(procedural.sprite.material).not.toBeInstanceOf(HologramSpriteMaterial);
    png.dispose();
    procedural.dispose();
  });
});
