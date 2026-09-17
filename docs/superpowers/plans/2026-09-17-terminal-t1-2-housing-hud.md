# Terminal T1.2 — Housing, CRT HUD, Lamps, Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The battle is fully readable through the terminal alone: HP, custom gauge, next chip and banners are drawn inside the CRT with a pixel font; the housing gets worn procedural textures, engineering labels, status lamps and a chip counter; wide screens get a dark wall with pipes around the terminal. The HTML HUD and banner are no longer used in terminal mode.

**Architecture:** Pure modules (`pixelFont`, `hudModel`, `terminalMode`, `plasticPattern`) hold all decisions and are unit-tested. Thin WebGL/canvas wrappers (`CrtCanvas`, `procedural` textures, `Housing`, `Environment`) draw them. The CRT shader gains a `uHud` sampler composited over the battle before scanlines. `Greybox` keeps only the controls and the chip rail (they are replaced in T1.3/T1.4); `Housing` owns body, bezel, glass, lamps and labels.

**Tech Stack:** Vite 8, TypeScript strict, Three.js 0.186, Vitest.

**Spec:** `docs/TERMINAL.md` §3, §4, §7, §9, §11 (T1.2). Previous plan: `2026-09-17-terminal-t1-1-tech-spike.md`.

## Global Constraints

- `src/sim` and `src/app` are not modified.
- Player-facing text only through `t()`; new keys go to `src/i18n/en.ts`.
- All numbers in `tuning.terminal` or named constants; colours as named constants.
- Canvas textures: `NearestFilter`, no mipmaps, redraw only when the drawn content changes.
- No `Math.random()`; decorative randomness uses `Rng` with a fixed seed.
- Budget (TERMINAL.md §10) must still hold: check `?bench=1` at the end (calls ≤ 150, tris ≤ 30 000).
- Commit after each task (`npm test` + `npm run build` green), trailer from the harness. Push at the end.
- Windows/Vite: one write per file; heredocs with backticks break in bash — use the Write/Edit tools for TypeScript.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/terminal/crt/pixelFont.ts` | create | 5×7 bitmap font: glyphs, measure, draw onto any `fillRect` sink |
| `src/terminal/crt/hudModel.ts` | create | pure HUD state from session/world: HP, gauge, next chip, banner; LED counts; redraw key |
| `src/terminal/terminalMode.ts` | create | pure mode (§4) and lamp states (§7.3) |
| `src/terminal/crt/crtCanvas.ts` | create | draws `HudModel` onto a 240×320 canvas texture |
| `src/terminal/crt/crtMaterial.ts` | modify | `uHud` composite |
| `src/terminal/textures/procedural.ts` | create | `plasticPattern` (pure) + plastic/label/counter textures |
| `src/terminal/parts/housing.ts` | create | body, top bar, bezel, glass, lamps, labels, chip counter |
| `src/terminal/parts/environment.ts` | create | wall and pipes filling the viewport outside the body |
| `src/terminal/parts/greybox.ts` | modify | drop body/bezel/glass/HP LEDs (moved to Housing) |
| `src/terminal/terminal.ts` | modify | wire the above; takes `session` |
| `src/main.ts` | modify | pass `session`; legacy banner uses `bannerFor` |
| `src/ui/styles.css` | modify | hide `.banner` in terminal mode |
| `src/i18n/en.ts` | modify | terminal labels |
| `tests/terminalHud.test.ts` | create | font, hud model, mode, lamps, pattern |

---

### Task 1: Pixel font

**Files:** Create `src/terminal/crt/pixelFont.ts`; Test `tests/terminalHud.test.ts`.

**Interfaces — Produces:**
```ts
export const GLYPH_W = 5; export const GLYPH_H = 7; export const GLYPH_GAP = 1;
export interface PixelSink { fillStyle: unknown; fillRect(x: number, y: number, w: number, h: number): void }
export function glyphRows(ch: string): readonly string[];        // 7 rows of '#'/'.'; lowercase → uppercase; unknown → '?'
export function measureText(text: string, scale?: number): number; // (len*6 - 1) * scale, 0 for ''
export function drawText(sink: PixelSink, text: string, x: number, y: number, scale: number, color: string): void;
```

- [ ] **Step 1: Failing tests** (`tests/terminalHud.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { drawText, glyphRows, measureText, GLYPH_H } from '../src/terminal/crt/pixelFont';

describe('pixelFont', () => {
  it('has 5×7 glyphs for letters, digits and punctuation', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!.:/-+%?\'* ') {
      const rows = glyphRows(ch);
      expect(rows).toHaveLength(GLYPH_H);
      for (const r of rows) expect(r).toMatch(/^[#.]{5}$/);
    }
  });

  it('upper-cases and falls back to ?', () => {
    expect(glyphRows('a')).toEqual(glyphRows('A'));
    expect(glyphRows('ж')).toEqual(glyphRows('?'));
  });

  it('measures text with a 1px gap', () => {
    expect(measureText('')).toBe(0);
    expect(measureText('A')).toBe(5);
    expect(measureText('AB', 2)).toBe(22);
  });

  it('draws one rect per lit pixel, scaled and offset', () => {
    const rects: number[][] = [];
    const sink = { fillStyle: '', fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]) };
    drawText(sink, 'I', 10, 20, 2, '#fff');
    const lit = glyphRows('I').join('').split('').filter((c) => c === '#').length;
    expect(rects).toHaveLength(lit);
    expect(sink.fillStyle).toBe('#fff');
    expect(rects[0]).toEqual([10 + 1 * 2, 20, 2, 2]); // first row ".###."
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/terminalHud.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** — `src/terminal/crt/pixelFont.ts`: a `GLYPHS: Record<string, string>` where each value is 7 rows of 5 chars joined with `/`, covering A–Z, 0–9 and `! . : / - + % ? ' *` and space (designs as in the T1.2 execution; any legible 5×7 design is fine). `glyphRows` splits on `/`. `drawText` walks characters, `x += (GLYPH_W + GLYPH_GAP) * scale`, and for each `#` calls `fillRect(x + col*scale, y + row*scale, scale, scale)`.
- [ ] **Step 4:** tests PASS.
- [ ] **Step 5:** commit `T1.2: 5x7 pixel font`.

### Task 2: HUD model, terminal mode, lamps

**Files:** Create `src/terminal/crt/hudModel.ts`, `src/terminal/terminalMode.ts`; Modify `src/main.ts` (legacy banner uses `bannerFor`), `src/terminal/terminal.ts` (LED counts via helpers); Test `tests/terminalHud.test.ts`.

**Interfaces — Produces:**
```ts
// hudModel.ts
export interface HudSession { screen: Screen; battleIndex: number; battleCount: number }
export interface HudWorld {
  state: GameState; firstStart: boolean;
  player: { hp: number; maxHp: number };
  gauge: { value: number; full: boolean };
  chips: { queue: readonly { defId: ChipId; code: ChipCode }[] };
}
export type BannerTone = 'info' | 'win' | 'lose';
export interface BannerInfo { key: string; text: string; tone: BannerTone }
export interface HudModel { hp: number; hpLow: boolean; gauge: number; gaugeFull: boolean; chip: string | null; banner: BannerInfo | null }
export const HP_LOW_SHARE = 0.25;
export function bannerFor(s: HudSession, w: Pick<HudWorld, 'state' | 'firstStart'>): BannerInfo | null;
export function hudModel(s: HudSession, w: HudWorld): HudModel;
export function hudKey(m: HudModel, blinkOn: boolean): string;
export function hpLedCount(hp: number, maxHp: number, leds: number): number;   // ceil, clamped 0..leds
export function gaugeLedCount(value: number, full: boolean, leds: number): number; // floor; full → leds
// terminalMode.ts
export type TerminalMode = 'BATTLE' | 'CHIP_SELECT' | 'MENU' | 'TRANSITION';
export function terminalMode(screen: Screen, state: GameState): TerminalMode;
export interface LampStates { power: boolean; sync: boolean; link: boolean; battle: boolean }
export function lampStates(mode: TerminalMode, screen: Screen, gaugeFull: boolean, timeSec: number): LampStates;
export const LAMP_BLINK_HZ = 2;
```

Rules: `bannerFor` reproduces `main.ts#updateBanner` exactly (BATTLE_INTRO → `BATTLE n/total` info; BATTLE_START && firstStart → `BATTLE START!` info; BATTLE_WON → `ENEMY DELETED!` win; PLAYER_DEAD → `GAME OVER` lose; screen ≠ BATTLE or anything else → null). `chip` = `` `${chipName(defId).toUpperCase()} ${code}` `` of `queue[0]`, or null. `hudKey` includes the blink phase only when `gaugeFull`. Mode: screen ≠ BATTLE → MENU; ACTION → BATTLE; CUSTOM → CHIP_SELECT; else TRANSITION. Lamps: power always; sync blinks in TRANSITION; link when screen is BATTLE or PAUSED; battle on in BATTLE mode, blinking when the gauge is full. Blink phase: `Math.floor(timeSec * LAMP_BLINK_HZ * 2) % 2 === 0`.

- [ ] Tests (append): banner cases for every state; chip label `CANNON A`; `hpLow` at 25/100 true, 26/100 false; `hpLedCount(1,100,10)=1`, `(0,100,10)=0`, `(100,100,10)=10`; `gaugeLedCount(0.99,false,12)=11`, `(0.5,true,12)=12`; `hudKey` changes with hp and blink only when full; mode table; lamps (sync blinking over time in TRANSITION, battle steady in BATTLE with gauge not full).
- [ ] Implement; replace `main.ts#updateBanner` body with a `bannerFor` call (`banner.show(b.key, b.text, b.tone)` / `banner.hide()`); `Terminal.render` uses `hpLedCount`/`gaugeLedCount`.
- [ ] Tests PASS; commit `T1.2: HUD model, terminal mode and lamp states`.

### Task 3: CRT HUD canvas and shader composite

**Files:** Create `src/terminal/crt/crtCanvas.ts`; Modify `src/terminal/crt/crtMaterial.ts`, `src/i18n/en.ts`.

**Interfaces — Produces:**
```ts
export class CrtCanvas {
  readonly texture: THREE.CanvasTexture;          // sRGB, nearest, flipY default
  constructor(width: number, height: number);
  setSize(width: number, height: number): void;    // resizes and forces a redraw
  draw(m: HudModel, timeSec: number): void;        // redraws only when hudKey changes
}
// CrtMaterial
setHud(tex: THREE.Texture): void;
```

Drawing at W×H (default 240×320), `s = max(1, floor(W / 120))`, margin `M = 3*s`:
- HP box top-left: 1-px (×s) frame, number at scale `s`, green `#7dff9a`, amber `#ffb347` when `hpLow`.
- Gauge top-right: `CUSTOM` label at scale 1·s over a framed bar of width `W*0.38`; fill cyan `#6fd3ff`; when full the fill blinks white/cyan (`blinkOn`).
- Next chip bottom-left at scale `s`, yellow `#ffe066`.
- Banner: dark band `rgba(0,0,0,0.6)` across the width at 45% height, text centred, scale `s+1` if it fits else `s`; tones info `#6fd3ff`, win `#7dff9a`, lose `#ff5a5a`.
- Canvas cleared to transparent each redraw.

Shader: `uniform sampler2D uHud; uniform float uHudOn;` — after sampling the (bled) battle colour and before scanlines: `vec4 h = texture2D(uHud, uv); c = mix(c, h.rgb, h.a * uHudOn);`.

- [ ] Implement; typecheck; commit `T1.2: HUD drawn inside the CRT`.

### Task 4: Procedural textures

**Files:** Create `src/terminal/textures/procedural.ts`; Test append.

**Interfaces — Produces:**
```ts
export function plasticPattern(seed: number, w: number, h: number): Uint8Array; // shade per texel, 0..255, deterministic
export function plasticTexture(seed: number, base: THREE.ColorRepresentation, size?: number): THREE.CanvasTexture; // repeat wrapping
export interface LabelTexture { texture: THREE.CanvasTexture; width: number; height: number } // texels
export function labelTexture(text: string, color: string, scale?: number): LabelTexture;
export function drawCounter(canvas: HTMLCanvasElement, text: string, color: string): void;
```
`plasticPattern`: start at 128; add ±12 per 4×4 block and ±6 per 2×2 block from `Rng(seed)`; sprinkle `w*h/64` dark 2×1 scratches (−40). Clamp 0..255. `plasticTexture` multiplies the base colour by `shade/128`.

- [ ] Tests: same seed → identical arrays; different seed → different; length `w*h`; values within 0..255; mean within 100..156.
- [ ] Implement; commit `T1.2: procedural plastic, label and counter textures`.

### Task 5: Housing, lamps, labels, counter, environment

**Files:** Create `src/terminal/parts/housing.ts`, `src/terminal/parts/environment.ts`; Modify `greybox.ts`, `terminal.ts`, `main.ts`, `styles.css`, `en.ts`.

**Interfaces — Produces:**
```ts
export class Housing {
  readonly group: THREE.Group;
  constructor(crt: CrtMaterial);
  build(layout: TerminalLayout): void;
  setHpLeds(lit: number): void;
  setLamps(l: LampStates): void;
  setChipCount(n: number, total: number): void;
}
export class Environment {
  readonly group: THREE.Group;
  build(layout: TerminalLayout, viewWorld: { left: number; right: number; top: number; bottom: number }): void;
}
// Terminal
TerminalOptions.session: Session
```
Housing layout (world units from `rectToWorld`):
- Body: box with `plasticTexture(1, 0x6a675f)`, repeat ≈ size/3.
- Top bar: `NET-01` label at scale 2 left, `PERSONAL NET TERMINAL` at scale 1 after it; HP LEDs below (instanced, as in the greybox).
- Bezel + glass (moved from Greybox).
- Lamps: four small boxes in the left CRT margin, stacked from the top of the CRT, each with its label (scale 1) under it; colours POWER amber `#ffb347`, SYNC cyan, LINK green, BATTLE red `#ff5a5a`; off = dark.
- Labels under controls: `CHIP SELECT`, `NAVIGATION`, `EXECUTE` near the bottom of their deck columns.
- Chip counter right of the rail: `CHIP SLOT` label + a 32×12 counter canvas `n/5`.
- Texel → world: a label `LabelTexture` of `w×h` texels is shown at `w * texelWorld`, `texelWorld = worldWidth / RENDER_SCALE_SHORT * (body.w / min(vw, vh))` (≈ one texel per render pixel).

Environment: back wall plane (dark `plasticTexture(7, 0x1a1b1d)`) covering the whole visible world rect at z = −1; when the body is narrower than the view, 2–4 vertical pipes (6-sided cylinders, `0x2b2d30`) and a cable (`0x5a2a1a`) per side, spaced by the side width; nothing when there is no side space.

Terminal: `resize()` computes `viewWorld` from the camera (centre ± half viewport × k) and builds Housing/Environment; `render()` builds the `HudModel` from `opts.session` and `world`, draws the canvas, sets lamps/LEDs/counter only when values change.

main.ts: pass `session`; `styles.css`: `#app.ui-terminal .banner { display: none; }`.

i18n keys: `term.model` `NET-01`, `term.subtitle` `PERSONAL NET TERMINAL`, `term.chipSelect` `CHIP SELECT`, `term.navigation` `NAVIGATION`, `term.execute` `EXECUTE`, `term.chipSlot` `CHIP SLOT`, `term.power` `POWER`, `term.sync` `SYNC`, `term.link` `LINK`, `term.battle` `BATTLE`, `hud.custom` `CUSTOM`.

- [ ] Implement; `npm test && npm run build`.
- [ ] Browser check (Chrome DevTools MCP, `390x844x3,mobile,touch` and 1600×900): HUD readable in CRT (HP, CUSTOM bar filling and blinking when full, next chip name), banners BATTLE 1/4 → BATTLE START! → ENEMY DELETED! inside the CRT, no HTML HUD/banner; lamps change with state; labels legible; counter follows chip use; wall and pipes on desktop; `?bench=1` still within budget.
- [ ] Update `docs/TERMINAL.md` §11 (T1.1 done, T1.2 done) and §18 if a question got answered; commit `T1.2: housing, lamps, labels, counter and environment`; push.
