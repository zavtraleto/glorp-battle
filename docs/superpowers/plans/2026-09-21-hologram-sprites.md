# PNG Sprite Hologram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the four PNG-backed actors as configurable holograms inside the existing battle/CRT pipeline.

**Architecture:** Keep `THREE.Sprite` and `ART_LAYER`; add a `SpriteMaterial` shader specialization used only by `SpriteArt`. Drive its time and visual-pixel uniforms from `PixelSprite` and the existing actor update. Store global values in `tuning.hologram`, with small per-art colour overrides.

**Tech Stack:** TypeScript 7, Three.js 0.186, GLSL ES 1.00/WebGL, Vitest 5, lil-gui.

**Spec:** `docs/superpowers/specs/2026-09-21-hologram-sprites-design.md`

## Global Constraints

- No extra canvas, render loop, full-screen postprocess, dependency, or per-frame material/texture allocation.
- Apply only to PNG-backed `SpriteArt`; procedural sprites and the CRT shader remain unchanged.
- Preserve actor placement, source silhouette size, hit flash/ripple, invisibility/death dissolve, and current render order.
- Expose every requested visual control through TypeScript and `Tuning → hologram`.
- Do not commit unless the user asks.

---

### Task 1: Hologram configuration and debug controls

**Files:**
- Modify: `src/config/tuning.ts`
- Modify: `src/debug/debugPanel.ts`
- Create: `src/render/hologramConfig.ts`
- Modify: `tests/debugPanel.test.ts`
- Create: `tests/hologram.test.ts`

**Interfaces:**
- Produces `HologramConfig`, `HologramCharacter`, `HOLOGRAM_CHARACTER_OVERRIDES`, `resolveHologramConfig(character)`, and `hologramSeed(character, instanceId)`.
- Adds `tuning.hologram` with numeric controls and `GLOW_COLOR`.

- [x] Write failing tests proving that the preset resolves to the requested nine values, a character override changes only its specified fields, seeds are stable/distinct, and `GLOW_COLOR` is classified as a colour control.
- [x] Run `npx vitest run tests/hologram.test.ts tests/debugPanel.test.ts`; expect missing exports/group failures.
- [x] Add the `hologram` tuning group and pure resolver. The resolver maps uppercase tuning keys to lower-camel shader configuration and overlays `Partial<HologramConfig>`:

```ts
export function resolveHologramConfig(character: HologramCharacter): HologramConfig {
  const base = hologramConfigFromTuning(tuning.hologram);
  return { ...base, ...HOLOGRAM_CHARACTER_OVERRIDES[character] };
}
```

- [x] Extend debug tuning value handling to `number | boolean | string`; route `#RRGGBB` values through `folder.addColor()` and add explicit slider ranges for every hologram numeric key.
- [x] Re-run the focused tests and keep them green.

### Task 2: Shader material and PNG sprite integration

**Files:**
- Create: `src/render/hologramMaterial.ts`
- Modify: `src/render/pixelSprite.ts`
- Modify: `src/render/actors.ts`
- Modify: `tests/hologram.test.ts`
- Modify: `tests/battleVisual.test.ts`

**Interfaces:**
- Produces `HologramSpriteMaterial`, with `setTime(seconds)`, `setVisualSize(w, h)`, `setRipple(strength, seconds)`, `setDissolve(progress)`, and `syncConfig()`.
- `PixelSprite` accepts optional `{ character, instanceId }` metadata only when the source is `SpriteArt`.

- [x] Add failing tests proving the material keeps native sprite semantics, expands/re-centres only its padded quad, receives stable config/seed, updates time/visual-size/dissolve without allocating a replacement material, and leaves procedural `PixelSprite` on its current material path.
- [x] Run `npx vitest run tests/hologram.test.ts tests/battleVisual.test.ts`; expect missing material/integration failures.
- [x] Implement `HologramSpriteMaterial` as a `THREE.SpriteMaterial` with stable uniforms and `customProgramCacheKey()`. Replace only the fragment shader in `onBeforeCompile`; use source-alpha neighbours, three phased sweeps, deterministic horizontal glitch, edge fragments, and diagonal dropout with `discard`.
- [x] Adapt `PixelSprite.place()` so PNG source dimensions retain their current world size while shader padding enlarges the quad and moves `sprite.center.y` to the padded source-foot position. Update uniforms from existing per-frame calls.
- [x] Pass `player`/art IDs and stable actor instance IDs from `PlayerView` and `EnemyView`; do not opt procedural fallbacks into hologram rendering.
- [x] Re-run focused tests and fix type/runtime contract issues.

### Task 3: Documentation and full technical verification

**Files:**
- Modify: `docs/BATTLE_VISUAL.md`

**Interfaces:**
- Documents the new material owner, render order, defaults location, overrides, and debug folder.

- [x] Update §5 and §10.1–10.2 so the code map and render-order caveats match the implementation.
- [x] Run `npm test`; require 0 failures.
- [x] Run `npm run typecheck`; require exit code 0.
- [x] Run `npm run build`; require exit code 0.
- [x] Launch the app, enter a battle, and inspect browser console/WebGL diagnostics; require no shader compilation or runtime errors.
- [x] Review `git diff --check` and `git diff`; verify no CRT shader, camera, gameplay, hitbox, or procedural-sprite changes slipped in.
