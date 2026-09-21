# PNG Sprite Hologram Design

## Goal

Add a permanent, configurable holographic projection effect to hand-drawn PNG character sprites while preserving their original palette and the existing battle, camera, CRT, and simulation architecture. Procedural character sprites remain unchanged.

## Existing rendering architecture

- `SceneRenderer` owns the Three.js battle scene and updates actor views from simulation state.
- Actors are camera-facing `THREE.Sprite` objects managed by `PixelSprite`; placement includes perspective sizing, CRT-pixel snapping, hit flash, hit ripple, invisibility, and death dissolve.
- Procedural actors render palette-encoded signals into the battle target. `BattleTarget` applies the palette pass.
- PNG actors use `ART_LAYER` and are drawn into the same paletted target afterward so their full colour survives.
- Ghosting is composed next, and `CrtMaterial` finally applies the screen-wide CRT treatment on the physical glass.
- The single application loop calls `Terminal.render()`, which drives this whole pipeline. No additional canvas or animation loop is needed.

## Integration

Create `src/render/hologramMaterial.ts`. PNG-backed `PixelSprite` instances use a dedicated `HologramSpriteMaterial`; procedural sprites continue using the current `SpriteMaterial` path.

The hologram material extends `THREE.SpriteMaterial` and customizes its fragment shader through `onBeforeCompile`. This preserves Three.js 0.186's native sprite billboard vertex path and the existing placement API. The shader receives elapsed render time from the existing actor update and allocates no per-frame materials, textures, or temporary render objects.

The material remains on `ART_LAYER`, so the order is:

1. palette-encoded battle scene;
2. palette pass;
3. hologram PNG sprites;
4. existing ghosting;
5. unchanged final CRT glass shader.

## Visual composition

The shader combines:

- muted source RGB, retaining recognisable original colours;
- thin object-space horizontal scanlines whose vertical coordinate is displaced by source luminance/detail;
- coloured emission and a silhouette/detail edge glow;
- local soft halo and very weak bloom derived from neighbouring source-alpha samples inside padded sprite UVs;
- deterministic edge fragments in the padded area around the silhouette;
- rare deterministic horizontal displacement bands;
- three broad, soft upward-moving sweeps with different phases, plus one faster narrow sweep whose stable speed is selected per actor from configurable bounds;
- sparse deterministic 1–4 visual-pixel dropout clusters moving diagonally from lower-left to upper-right; dropout uses `discard`, producing real transparency.

All patterns use shader hashes derived from texel coordinates and a stable per-character seed. There is no frame-by-frame `Math.random()`.

The hologram shader adds no RGB split, chromatic aberration, screen-space grain, vignette, full-screen flicker, or fine uniform CRT scanline layer.

## Configuration

Add a `hologram` group to `DEFAULT_TUNING`. It automatically appears as `Tuning → hologram` in lil-gui and persists through the existing tuning override system. The debug panel gains explicit ranges and colour-control support.

The group exposes these GLSL-independent controls:

- `ORIGINAL_COLOR_RETENTION` = `0.75`
- `BASE_BRIGHTNESS` = `0.85`
- `SCANLINE_SPACING` = `1.50`
- `SCANLINE_WIDTH` = `0.12` of one scanline period
- `SCANLINE_CURVATURE` = `0.00`
- `SCANLINE_STRENGTH` = `0.75`
- `EMISSION_STRENGTH` = `0.07`
- `HALO_STRENGTH` = `0.20`
- `BLOOM_STRENGTH` = `0.10`
- `GLITCH_AMOUNT` = `0.05`
- `EDGE_PARTICLE_AMOUNT` = `1.00`
- `BRIGHT_SWEEP_STRENGTH` = `0.15`
- `BRIGHT_SWEEP_SPEED` = `0.07` sprite heights per second
- `BRIGHT_SWEEP_WIDTH` = `0.03` of sprite height
- `THIN_SWEEP_STRENGTH` = `0.21`
- `THIN_SWEEP_WIDTH` = `0.012` of sprite height
- `THIN_SWEEP_SPEED_MIN` / `THIN_SWEEP_SPEED_MAX` = `0.14` / `0.21` sprite heights per second
- `DROPOUT_AMOUNT` = `0.065`
- `DROPOUT_SIZE` = `1.70` source texels
- `DROPOUT_SPEED` = `0.15` sprite heights per second
- `DROPOUT_ANGLE` = `-34.00` degrees
- `GLOW_COLOR` = `#8ACE00`

`HologramConfig` mirrors those values with idiomatic lower-camel-case fields. `resolveHologramConfig()` merges live global tuning with a partial entry from `HOLOGRAM_CHARACTER_OVERRIDES`; no character duplicates the whole preset. The global colour is the player's `#8ACE00`. Enemy PNG types may override only `glowColor`, demonstrating green, amber, and violet projections.

## Existing effects and lifecycle

- `setFlash()` continues switching between the normal and flashed shared PNG textures.
- `setRipple()` remains a short UV displacement layered before hologram sampling.
- `setDissolve()` combines the existing dissolve threshold with hologram dropout; invisibility and death behaviour stay intact.
- Sprite scale and anchor calculations continue to describe the visible source image. Shader padding expands only the render quad and compensates its UV/anchor mapping so feet and silhouette size do not move.
- Material disposal remains owned by `PixelSprite`; shared PNG textures remain owned by the sprite-art cache.

## Testing and technical verification

- Unit-test exact defaults, partial override merging, stable per-character seeds, and preservation of untouched fields.
- Unit-test the shader/config contract so every required control is represented by a uniform.
- Extend debug-panel tests for the `hologram` group ordering and colour-compatible tuning values.
- Run the focused tests first, then `npm test`, `npm run typecheck`, and `npm run build`.
- Start the built/dev scene and check WebGL console output for shader compilation/runtime errors. Final visual judgement and parameter tuning are performed by the user.

## Non-goals

No gameplay animations, event API, timelines, spawn/death/hit state machine, extra canvas, extra render loop, standalone postprocessing architecture, camera changes, hitbox changes, procedural-sprite hologram, or CRT visual changes.
