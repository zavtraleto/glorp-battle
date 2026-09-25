import * as THREE from 'three';
import {
  hologramSeed,
  resolveHologramConfig,
  thinSweepSpeed,
  type HologramCharacter,
} from './hologramConfig';

/** Transparent room around the source image for halo and edge fragments. */
export const HOLOGRAM_PADDING = 0.14;
const CONTENT_SHARE = 1 - HOLOGRAM_PADDING * 2;

export interface PaddedSpriteMetrics {
  width: number;
  height: number;
  centerY: number;
}

export function paddedSpriteMetrics(width: number, height: number): PaddedSpriteMetrics {
  return {
    width: width / CONTENT_SHARE,
    height: height / CONTENT_SHARE,
    centerY: HOLOGRAM_PADDING,
  };
}

/**
 * Wave materialize (GDD §10.4): the sprite builds line by line from the
 * bottom. A line starts after `y * BUILD_ROW_SPAN + jitter * BUILD_JITTER`
 * of the build and takes `BUILD_ROW_TIME` to slide in; the numbers are chosen
 * so every line is whole at build = 1. The shader uses the same curve.
 */
const BUILD_ROW_SPAN = 0.7;
const BUILD_JITTER = 0.12;
const BUILD_ROW_TIME = 0.18;

/** 0..1 progress of the line at height `rowY` (0 = bottom) with `jitter` in 0..1. */
export function buildRowProgress(build: number, rowY: number, jitter: number): number {
  const k = (build - (rowY * BUILD_ROW_SPAN + jitter * BUILD_JITTER)) / BUILD_ROW_TIME;
  return Math.max(0, Math.min(1, k));
}

type HologramUniforms = {
  uHoloTime: { value: number };
  uHoloVisualSize: { value: THREE.Vector2 };
  uHoloTexel: { value: THREE.Vector2 };
  uHoloGlowColor: { value: THREE.Color };
  uHoloSeed: { value: number };
  uHoloDissolve: { value: number };
  uHoloBuild: { value: number };
  uHoloRipple: { value: number };
  uHoloRippleTime: { value: number };
  uHoloColorRetention: { value: number };
  uHoloBaseBrightness: { value: number };
  uHoloScanlineSpacing: { value: number };
  uHoloScanlineWidth: { value: number };
  uHoloScanlineCurvature: { value: number };
  uHoloScanlineStrength: { value: number };
  uHoloEmission: { value: number };
  uHoloHalo: { value: number };
  uHoloBloom: { value: number };
  uHoloGlitch: { value: number };
  uHoloParticles: { value: number };
  uHoloSweepStrength: { value: number };
  uHoloSweepSpeed: { value: number };
  uHoloSweepWidth: { value: number };
  uHoloThinSweepStrength: { value: number };
  uHoloThinSweepWidth: { value: number };
  uHoloThinSweepSpeed: { value: number };
  uHoloDropoutAmount: { value: number };
  uHoloDropoutSize: { value: number };
  uHoloDropoutSpeed: { value: number };
  uHoloDropoutAngle: { value: number };
  uHoloTint: { value: THREE.Color };
  uHoloTintAmount: { value: number };
  uHoloBrightness: { value: number };
};

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D map;
uniform float uHoloTime;
uniform vec2 uHoloVisualSize;
uniform vec2 uHoloTexel;
uniform vec3 uHoloGlowColor;
uniform float uHoloSeed;
uniform float uHoloDissolve;
uniform float uHoloBuild;
uniform float uHoloRipple;
uniform float uHoloRippleTime;
uniform float uHoloColorRetention;
uniform float uHoloBaseBrightness;
uniform float uHoloScanlineSpacing;
uniform float uHoloScanlineWidth;
uniform float uHoloScanlineCurvature;
uniform float uHoloScanlineStrength;
uniform float uHoloEmission;
uniform float uHoloHalo;
uniform float uHoloBloom;
uniform float uHoloGlitch;
uniform float uHoloParticles;
uniform float uHoloSweepStrength;
uniform float uHoloSweepSpeed;
uniform float uHoloSweepWidth;
uniform float uHoloThinSweepStrength;
uniform float uHoloThinSweepWidth;
uniform float uHoloThinSweepSpeed;
uniform float uHoloDropoutAmount;
uniform float uHoloDropoutSize;
uniform float uHoloDropoutSpeed;
uniform float uHoloDropoutAngle;
uniform vec3 uHoloTint;
uniform float uHoloTintAmount;
uniform float uHoloBrightness;
varying vec2 vMapUv;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float holoLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec4 spriteAt(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(map, uv);
}

float shapeAt(vec2 uv) {
  return step(uHoloDissolve, spriteAt(uv).a);
}

float scanline(float coordinate) {
  float period = max(1.0, uHoloScanlineSpacing);
  float p = coordinate / period;
  float d = abs(fract(p) - 0.5);
  float aa = max(fwidth(p) * 0.65, 0.012);
  float halfWidth = clamp(uHoloScanlineWidth, 0.01, 0.98) * 0.5;
  return 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, d);
}

float sweepBand(float y, float phase, float speed, float bandWidth) {
  float centre = fract(uHoloTime * speed + phase);
  float width = max(0.002, bandWidth);
  float d = abs(y - centre) / width;
  return exp(-d * d * 2.0);
}

void main() {
  vec2 sourceUv = (vMapUv - vec2(${HOLOGRAM_PADDING.toFixed(4)})) / ${CONTENT_SHARE.toFixed(4)};
  vec2 q = sourceUv;

  // Wave materialize: 2-px lines rise from the bottom, sliding in from
  // alternate sides, each with a bright leading glow until it settles.
  float buildGlow = 0.0;
  if (uHoloBuild < 1.0) {
    float buildLines = max(8.0, uHoloVisualSize.y * 0.5);
    float row = floor(q.y * buildLines);
    float jitter = hash21(vec2(row, uHoloSeed * 13.0));
    float rowK = clamp((uHoloBuild - (row / buildLines * ${BUILD_ROW_SPAN.toFixed(4)} + jitter * ${BUILD_JITTER.toFixed(4)})) / ${BUILD_ROW_TIME.toFixed(4)}, 0.0, 1.0);
    if (rowK <= 0.0) discard;
    float side = mod(row, 2.0) < 1.0 ? -1.0 : 1.0;
    q.x += side * (1.0 - rowK) * (1.0 - rowK) * 0.9;
    buildGlow = 1.0 - rowK;
  }

  q.x += sin(q.y * 26.0 + uHoloRippleTime * 55.0) * 0.045 * uHoloRipple;
  float glitchTick = floor(uHoloTime * 2.0);
  float glitchBand = floor(q.y * 32.0);
  float glitchNoise = hash21(vec2(glitchBand + uHoloSeed * 31.0, glitchTick));
  float glitchOn = step(0.997 - uHoloGlitch * 0.16, glitchNoise);
  q.x += (glitchNoise - 0.5) * glitchOn * uHoloGlitch * 0.8;

  vec4 source = spriteAt(q);
  float shape = step(uHoloDissolve, source.a);
  vec2 nearStep = uHoloTexel * 1.5;
  vec2 wideStep = uHoloTexel * 4.0;
  float left = shapeAt(q - vec2(nearStep.x, 0.0));
  float right = shapeAt(q + vec2(nearStep.x, 0.0));
  float down = shapeAt(q - vec2(0.0, nearStep.y));
  float up = shapeAt(q + vec2(0.0, nearStep.y));
  float nearest = max(max(left, right), max(down, up));
  float innerEdge = shape * (1.0 - min(min(left, right), min(down, up)));
  float nearHalo = max(0.0, nearest - shape);
  float wide = max(
    max(shapeAt(q - vec2(wideStep.x, 0.0)), shapeAt(q + vec2(wideStep.x, 0.0))),
    max(shapeAt(q - vec2(0.0, wideStep.y)), shapeAt(q + vec2(0.0, wideStep.y)))
  );
  float wideHalo = max(0.0, wide - max(shape, nearHalo));

  vec2 visualPx = q * max(uHoloVisualSize, vec2(1.0));
  float angle = radians(uHoloDropoutAngle);
  vec2 direction = vec2(cos(angle), sin(angle));
  vec2 dropoutPx = visualPx - direction * uHoloTime * uHoloDropoutSpeed * max(uHoloVisualSize.y, 1.0);
  float clusterSize = clamp(uHoloDropoutSize, 1.0, 4.0);
  vec2 dropoutCell = floor(dropoutPx / clusterSize);
  vec2 dropoutLocal = fract(dropoutPx / clusterSize);
  float dropoutRandom = hash21(dropoutCell + uHoloSeed * 79.0);
  float dropoutShape = step(dropoutLocal.x, 0.32 + 0.48 * hash21(dropoutCell + 4.1));
  dropoutShape *= step(dropoutLocal.y, 0.30 + 0.52 * hash21(dropoutCell + 9.7));
  float dropout = step(1.0 - clamp(uHoloDropoutAmount, 0.0, 0.3), dropoutRandom) * dropoutShape;
  if (shape > 0.0 && dropout > 0.5) discard;

  float lum = holoLuma(source.rgb);
  float detail = abs(holoLuma(spriteAt(q + vec2(uHoloTexel.x, 0.0)).rgb) -
                     holoLuma(spriteAt(q - vec2(uHoloTexel.x, 0.0)).rgb));
  detail += abs(holoLuma(spriteAt(q + vec2(0.0, uHoloTexel.y)).rgb) -
                holoLuma(spriteAt(q - vec2(0.0, uHoloTexel.y)).rgb));
  float curvedY = q.y * max(uHoloVisualSize.y, 1.0) + (lum + detail * 1.5) * uHoloScanlineCurvature * 8.0;
  float lines = scanline(curvedY - uHoloTime * 0.8);

  float sweeps = sweepBand(q.y, 0.03, uHoloSweepSpeed, uHoloSweepWidth);
  sweeps += sweepBand(q.y, 0.39, uHoloSweepSpeed, uHoloSweepWidth) * 0.82;
  sweeps += sweepBand(q.y, 0.72, uHoloSweepSpeed, uHoloSweepWidth) * 0.68;
  sweeps *= uHoloSweepStrength;
  float thinPhase = hash21(vec2(uHoloSeed * 97.0, 14.7));
  float thinSweep = sweepBand(q.y, thinPhase, uHoloThinSweepSpeed, uHoloThinSweepWidth);
  thinSweep *= uHoloThinSweepStrength;

  vec2 particlePx = visualPx - vec2(0.0, uHoloTime * 3.0);
  vec2 particleCell = floor(particlePx / vec2(2.4, 2.0));
  vec2 particleLocal = fract(particlePx / vec2(2.4, 2.0));
  float particleRandom = hash21(particleCell + uHoloSeed * 47.0);
  float particleChance = step(0.992 - clamp(uHoloParticles, 0.0, 1.0) * 0.075, particleRandom);
  float particleDot = (1.0 - step(0.48, particleLocal.x)) * (1.0 - step(0.52, particleLocal.y));
  float particle = particleChance * particleDot * clamp(innerEdge + nearHalo + wideHalo, 0.0, 1.0);

  vec3 mutedSource = mix(vec3(lum), source.rgb, clamp(uHoloColorRetention, 0.0, 1.0));
  float scanStrength = clamp(uHoloScanlineStrength, 0.0, 1.0);
  float scanModulation = mix(1.0 - scanStrength * 0.55, 1.0 + scanStrength * 0.35, lines);
  vec3 colour = mutedSource * uHoloBaseBrightness * scanModulation;
  vec3 lineTint = mix(source.rgb, uHoloGlowColor, 0.68);
  colour += lineTint * lines * (uHoloEmission + scanStrength * 0.12) * (0.72 + lum * 0.45 + detail * 0.8);
  colour += uHoloGlowColor * innerEdge * (uHoloEmission * 0.8 + uHoloHalo * 0.28);
  colour += (source.rgb * 0.22 + uHoloGlowColor * 0.78) * sweeps;
  colour += (source.rgb * 0.12 + uHoloGlowColor * 0.88) * thinSweep;
  colour += uHoloGlowColor * buildGlow * 1.4;

  vec3 outsideLight = uHoloGlowColor * (nearHalo * uHoloHalo * 0.34 + wideHalo * uHoloBloom);
  outsideLight += mix(uHoloGlowColor, source.rgb, 0.2) * particle * (0.45 + uHoloEmission);
  vec3 finalColour = colour * shape + outsideLight;
  float finalAlpha = shape * opacity + nearHalo * uHoloHalo * 0.16 + wideHalo * uHoloBloom * 0.3 + particle * 0.72;
  if (finalAlpha <= 0.001) discard;

  // Telegraph wash (GDD §8.1): keeps the figure's shading, recolours it.
  vec3 washed = uHoloTint * (0.45 + 1.1 * holoLuma(finalColour));
  finalColour = mix(finalColour, washed, clamp(uHoloTintAmount, 0.0, 1.0)) * uHoloBrightness;

  gl_FragColor = vec4(finalColour * diffuse, clamp(finalAlpha, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function makeUniforms(textureWidth: number, textureHeight: number, seed: number): HologramUniforms {
  return {
    uHoloTime: { value: 0 },
    uHoloVisualSize: { value: new THREE.Vector2(1, 1) },
    uHoloTexel: { value: new THREE.Vector2(1 / Math.max(1, textureWidth), 1 / Math.max(1, textureHeight)) },
    uHoloGlowColor: { value: new THREE.Color() },
    uHoloSeed: { value: seed },
    uHoloDissolve: { value: 0.5 },
    uHoloBuild: { value: 1 },
    uHoloRipple: { value: 0 },
    uHoloRippleTime: { value: 0 },
    uHoloColorRetention: { value: 0 },
    uHoloBaseBrightness: { value: 0 },
    uHoloScanlineSpacing: { value: 0 },
    uHoloScanlineWidth: { value: 0 },
    uHoloScanlineCurvature: { value: 0 },
    uHoloScanlineStrength: { value: 0 },
    uHoloEmission: { value: 0 },
    uHoloHalo: { value: 0 },
    uHoloBloom: { value: 0 },
    uHoloGlitch: { value: 0 },
    uHoloParticles: { value: 0 },
    uHoloSweepStrength: { value: 0 },
    uHoloSweepSpeed: { value: 0 },
    uHoloSweepWidth: { value: 0 },
    uHoloThinSweepStrength: { value: 0 },
    uHoloThinSweepWidth: { value: 0 },
    uHoloThinSweepSpeed: { value: 0 },
    uHoloDropoutAmount: { value: 0 },
    uHoloDropoutSize: { value: 0 },
    uHoloDropoutSpeed: { value: 0 },
    uHoloDropoutAngle: { value: 0 },
    uHoloTint: { value: new THREE.Color() },
    uHoloTintAmount: { value: 0 },
    uHoloBrightness: { value: 1 },
  };
}

/** Sprite material used only by PNG art on ART_LAYER. */
export class HologramSpriteMaterial extends THREE.SpriteMaterial {
  private readonly holoUniforms: HologramUniforms;
  private readonly seed: number;

  constructor(
    map: THREE.Texture,
    private readonly character: HologramCharacter,
    instanceId: number,
    textureWidth = 1,
    textureHeight = 1,
  ) {
    super({
      map,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });
    this.seed = hologramSeed(character, instanceId);
    this.holoUniforms = makeUniforms(textureWidth, textureHeight, this.seed);
    this.syncConfig();
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.holoUniforms);
      shader.fragmentShader = FRAGMENT_SHADER;
    };
  }

  override customProgramCacheKey(): string {
    return 'glorp-png-hologram-v2';
  }

  setTime(seconds: number): void {
    this.holoUniforms.uHoloTime.value = seconds;
  }

  setVisualSize(width: number, height: number): void {
    this.holoUniforms.uHoloVisualSize.value.set(width, height);
  }

  setRipple(strength: number, seconds: number): void {
    this.holoUniforms.uHoloRipple.value = Math.max(0, Math.min(1, strength));
    this.holoUniforms.uHoloRippleTime.value = seconds;
  }

  /** Wave materialize 0..1 (GDD §10.4); 1 = whole. */
  setBuild(progress: number): void {
    this.holoUniforms.uHoloBuild.value = Math.max(0, Math.min(1, progress));
  }

  /** Colour wash 0..1 and brightness multiplier (enemy phases, GDD §8.1). */
  setLook(tint: THREE.Color | null, amount: number, brightness: number): void {
    const u = this.holoUniforms;
    if (tint) u.uHoloTint.value.copy(tint);
    u.uHoloTintAmount.value = tint ? Math.max(0, Math.min(1, amount)) : 0;
    u.uHoloBrightness.value = Math.max(0, brightness);
  }

  setDissolve(progress: number): void {
    this.holoUniforms.uHoloDissolve.value = 0.5 + 0.5 * Math.max(0, Math.min(1, progress));
  }

  /** Copies live debug tuning and the small per-character override into stable uniforms. */
  syncConfig(): void {
    const c = resolveHologramConfig(this.character);
    const u = this.holoUniforms;
    u.uHoloGlowColor.value.set(c.glowColor);
    u.uHoloColorRetention.value = c.originalColorRetention;
    u.uHoloBaseBrightness.value = c.baseBrightness;
    u.uHoloScanlineSpacing.value = c.scanlineSpacing;
    u.uHoloScanlineWidth.value = c.scanlineWidth;
    u.uHoloScanlineCurvature.value = c.scanlineCurvature;
    u.uHoloScanlineStrength.value = c.scanlineStrength;
    u.uHoloEmission.value = c.emissionStrength;
    u.uHoloHalo.value = c.haloStrength;
    u.uHoloBloom.value = c.bloomStrength;
    u.uHoloGlitch.value = c.glitchAmount;
    u.uHoloParticles.value = c.edgeParticleAmount;
    u.uHoloSweepStrength.value = c.brightSweepStrength;
    u.uHoloSweepSpeed.value = c.brightSweepSpeed;
    u.uHoloSweepWidth.value = c.brightSweepWidth;
    u.uHoloThinSweepStrength.value = c.thinSweepStrength;
    u.uHoloThinSweepWidth.value = c.thinSweepWidth;
    u.uHoloThinSweepSpeed.value = thinSweepSpeed(c, this.seed);
    u.uHoloDropoutAmount.value = c.dropoutAmount;
    u.uHoloDropoutSize.value = c.dropoutSize;
    u.uHoloDropoutSpeed.value = c.dropoutSpeed;
    u.uHoloDropoutAngle.value = c.dropoutAngle;
  }
}
