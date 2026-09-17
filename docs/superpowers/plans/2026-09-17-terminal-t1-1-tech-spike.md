# Terminal T1.1 — Tech Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that the NET-01 terminal pipeline (battle → render target → CRT shader on a 3D greybox terminal, rendered at low resolution, driven by pointer zones) fits the performance budget on a phone and a PC, while the battle stays fully playable.

**Architecture:** One shared `WebGLRenderer` draws into a canvas whose backing size is small (short side `RENDER_SCALE_SHORT` px) and is upscaled by CSS with `image-rendering: pixelated`. Each frame the existing `SceneRenderer` draws the battle into a 240×320 render target; an optional ghosting pass composes it with the previous frame; a CRT `ShaderMaterial` on the glass mesh of a procedural greybox terminal shows the result. Input comes from a `PointerRouter` that hit-tests 2D zones computed by pure layout functions (the terminal face lies on the z=0 plane and the camera looks straight at it, so screen ↔ face mapping is linear). The legacy HTML UI stays available via `?ui=css`; in terminal mode its HUD, controls and world labels are hidden, while title/pause/result screens, the banner and the HTML Custom Screen still overlay the terminal (they are replaced in T1.5/T2).

**Tech Stack:** Vite 8, TypeScript (strict, `noUncheckedIndexedAccess`), Three.js 0.186, lil-gui, Vitest.

**Spec:** `docs/TERMINAL.md` (§9 render, §10 budget, §11 T1.1, §13 architecture, §14 debug). Rules of the battle: `docs/GDD.md`. Project rules: `CLAUDE.md`.

## Global Constraints

- Simulation (`src/sim`, `src/app`) is not modified in this plan.
- The terminal only reads sim/session state; it changes it only through `InputState` commands (`move`, `useChip`, `openCustom`) and `Session` actions (`pause`, `resume`).
- Every number goes into `tuning.terminal` (seconds, px, fractions); no magic numbers in logic.
- No `Math.random()` in `src/sim`; the bench autopilot uses `Rng` from `src/core/rng.ts`.
- Player-facing text only via `t('key')` from `src/i18n/en.ts` (this plan adds none).
- Budget to verify (TERMINAL.md §10): frame ≤ 8 ms on a mid Android, ≤ 4 ms on PC; ≤ 150 draw calls; ≤ 30 000 triangles.
- `WebGLRenderer` with `antialias: false`; one renderer and one WebGL context in terminal mode.
- Control reacts on `pointerdown` in the same frame.
- Before any commit: `npm test` and `npm run build` pass. Commit only if the user has approved committing in this session (CLAUDE.md); end commit messages with the `Co-Authored-By` trailer from the harness.
- Windows/Vite gotcha: apply all edits to a file in one write.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/config/tuning.ts` | modify | new `terminal` tuning group |
| `src/debug/params.ts` | modify | `?ui=`, `?rscale=`, `?crtres=`, `?bench=`, `?hitzones=` |
| `src/terminal/layout.ts` | create | pure: terminal rect in the viewport, zone rects, face↔world mapping |
| `src/render/scene.ts` | modify | shared renderer; `renderInto(target, …)` for the CRT |
| `src/terminal/crt/battleTarget.ts` | create | battle render target + optional ghosting ping-pong |
| `src/terminal/crt/crtMaterial.ts` | create | CRT glass shader material + flash impulse |
| `src/terminal/parts/greybox.ts` | create | procedural greybox terminal meshes + press/roll visuals |
| `src/terminal/interaction/pointerRouter.ts` | create | pointer → zones → callbacks; trackball swipe per pointer |
| `src/terminal/terminal.ts` | create | assembles scene, camera, low-res canvas, per-frame update/render |
| `src/debug/perfProbe.ts` | create | frame-time percentiles, draw calls, triangles |
| `src/debug/bench.ts` | create | `?bench=1` autopilot and result report |
| `src/debug/overlay.ts` | modify | show perf probe lines |
| `src/main.ts` | modify | renderer ownership, ui mode switch, terminal wiring |
| `src/ui/styles.css` | modify | terminal-mode hiding + pixelated canvas + hit-zone debug |
| `tests/terminal.test.ts` | create | layout, router, perf probe, params |
| `docs/TERMINAL.md` | modify | §17 new/renamed tunables, §14 params |

---

### Task 1: Terminal tuning group and URL params

**Files:**
- Modify: `src/config/tuning.ts` (add group after `render`)
- Modify: `src/debug/params.ts`
- Modify: `src/debug/debugPanel.ts` (`RANGES`)
- Test: `tests/terminal.test.ts` (create)

**Interfaces:**
- Produces: `tuning.terminal.{RENDER_SCALE_SHORT, CRT_RES_W, CRT_RES_H, TERMINAL_ASPECT_MIN, TERMINAL_ASPECT_MAX, LAYOUT_TOP, LAYOUT_CRT, LAYOUT_RAIL, LAYOUT_DECK, CRT_MARGIN_X, DECK_SPLIT_LEFT, DECK_SPLIT_RIGHT, PAUSE_ZONE_W, CAMERA_FOV, CRT_SCANLINES, CRT_CURVATURE, CRT_BLEED, CRT_GHOSTING, CRT_FLASH_TIME, BUTTON_PRESS_DEPTH, TRACKBALL_ROLL_GAIN, TRACKBALL_FRICTION}`; `DebugParams.{ui: 'terminal' | 'css', rscale: number | null, crtres: [number, number] | null, bench: boolean, hitzones: boolean}`.

- [ ] **Step 1: Write the failing test**

Create `tests/terminal.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { parseDebugParams } from '../src/debug/params';

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
});

describe('terminal tuning', () => {
  it('has layout shares that sum to 1', () => {
    const t = tuning.terminal;
    expect(t.LAYOUT_TOP + t.LAYOUT_CRT + t.LAYOUT_RAIL + t.LAYOUT_DECK).toBeCloseTo(1, 5);
  });

  it('keeps the CRT render target portrait', () => {
    expect(tuning.terminal.CRT_RES_H).toBeGreaterThan(tuning.terminal.CRT_RES_W);
  });
});

describe('terminal URL params', () => {
  it('defaults to the terminal UI', () => {
    const p = parseDebugParams('');
    expect(p.ui).toBe('terminal');
    expect(p.rscale).toBeNull();
    expect(p.crtres).toBeNull();
    expect(p.bench).toBe(false);
    expect(p.hitzones).toBe(false);
  });

  it('parses ui, rscale, crtres, bench and hitzones', () => {
    const p = parseDebugParams('?ui=css&rscale=300&crtres=160x240&bench=1&hitzones=1');
    expect(p.ui).toBe('css');
    expect(p.rscale).toBe(300);
    expect(p.crtres).toEqual([160, 240]);
    expect(p.bench).toBe(true);
    expect(p.hitzones).toBe(true);
  });

  it('clamps rscale and rejects malformed crtres', () => {
    expect(parseDebugParams('?rscale=10').rscale).toBe(120);
    expect(parseDebugParams('?rscale=99999').rscale).toBe(2160);
    expect(parseDebugParams('?crtres=abc').crtres).toBeNull();
    expect(parseDebugParams('?crtres=0x10').crtres).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/terminal.test.ts`
Expected: FAIL — `tuning.terminal` is undefined / `p.ui` is undefined (TS errors are not checked by vitest; the assertions fail).

- [ ] **Step 3: Implement**

In `src/config/tuning.ts`, after the `render: { … },` group, add:

```ts
  /** Physical terminal NET-01 (docs/TERMINAL.md §17). */
  terminal: {
    /** Backing-store short side of the terminal canvas, upscaled without smoothing. */
    RENDER_SCALE_SHORT: 400,
    /** Battle render target shown on the CRT. */
    CRT_RES_W: 240,
    CRT_RES_H: 320,
    /** Viewport aspect (w/h) range the terminal body stretches to; outside it the terminal is letterboxed. */
    TERMINAL_ASPECT_MIN: 0.42,
    TERMINAL_ASPECT_MAX: 0.62,
    /** Vertical shares of the terminal, top to bottom (sum = 1). */
    LAYOUT_TOP: 0.06,
    LAYOUT_CRT: 0.5,
    LAYOUT_RAIL: 0.14,
    LAYOUT_DECK: 0.3,
    /** Horizontal bezel around the CRT glass, as a share of terminal width on each side. */
    CRT_MARGIN_X: 0.1,
    /** Deck columns: CHIP SELECT | trackball zone | EXECUTE (shares of terminal width). */
    DECK_SPLIT_LEFT: 0.27,
    DECK_SPLIT_RIGHT: 0.63,
    /** Pause key zone width at the right end of the top bar (share of terminal width). */
    PAUSE_ZONE_W: 0.16,
    /** Vertical field of view, degrees. */
    CAMERA_FOV: 22,
    CRT_SCANLINES: 0.35,
    CRT_CURVATURE: 0.08,
    CRT_BLEED: 0.5,
    /** Previous-frame persistence; 0 disables the ghosting pass entirely. */
    CRT_GHOSTING: 0.25,
    CRT_FLASH_TIME: 0.12,
    /** Button travel when pressed, world units. */
    BUTTON_PRESS_DEPTH: 0.12,
    /** Trackball rotation per CSS px of drag, radians. */
    TRACKBALL_ROLL_GAIN: 0.02,
    /** Trackball spin decay, 1/s. */
    TRACKBALL_FRICTION: 6,
  },
```

In `src/debug/params.ts` replace the whole file with:

```ts
// URL debug parameters (GDD §15.5, TERMINAL.md §14):
// ?debug=1&seed=123&battle=3&folder=p1&god=1&timescale=0.5
// ?ui=css&rscale=300&crtres=160x240&bench=1&hitzones=1

export interface DebugParams {
  debug: boolean;
  seed: number | null;
  battle: number;
  folder: 'mvp' | 'p1';
  god: boolean;
  timescale: number;
  /** `css` = legacy HTML UI (kept until T2). */
  ui: 'terminal' | 'css';
  /** Overrides `tuning.terminal.RENDER_SCALE_SHORT`. */
  rscale: number | null;
  /** Overrides the CRT render target size `[w, h]`. */
  crtres: [number, number] | null;
  /** Autopilot benchmark (debug/bench.ts). */
  bench: boolean;
  /** Draws the pointer hit zones. */
  hitzones: boolean;
}

export function parseDebugParams(search: string): DebugParams {
  const q = new URLSearchParams(search);
  const flag = (k: string) => q.get(k) === '1' || q.get(k) === 'true';
  const num = (k: string) => {
    const raw = q.get(k);
    if (raw === null || raw.trim() === '') return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  };
  const seed = num('seed');
  const battle = num('battle');
  const timescale = num('timescale');
  const rscale = num('rscale');
  const crt = /^(\d+)x(\d+)$/.exec(q.get('crtres') ?? '');
  const crtW = crt ? Number(crt[1]) : 0;
  const crtH = crt ? Number(crt[2]) : 0;
  return {
    debug: flag('debug'),
    seed: seed === null ? null : Math.floor(seed) >>> 0,
    battle: battle === null ? 1 : Math.min(4, Math.max(1, Math.floor(battle))),
    folder: q.get('folder') === 'p1' ? 'p1' : 'mvp',
    god: flag('god'),
    timescale: timescale === null ? 1 : Math.min(4, Math.max(0.05, timescale)),
    ui: q.get('ui') === 'css' ? 'css' : 'terminal',
    rscale: rscale === null ? null : Math.min(2160, Math.max(120, Math.round(rscale))),
    crtres: crtW > 0 && crtH > 0 ? [crtW, crtH] : null,
    bench: flag('bench'),
    hitzones: flag('hitzones'),
  };
}
```

In `src/debug/debugPanel.ts`, extend `RANGES`:

```ts
const RANGES: Record<string, [number, number, number]> = {
  SIM_HZ: [30, 240, 1],
  TIME_SCALE: [0.05, 4, 0.05],
  CAMERA_TILT_DEG: [0, 70, 1],
  FIELD_SCREEN_SHARE: [0.3, 0.9, 0.01],
  PANEL_GAP: [0, 0.3, 0.01],
  MAX_PIXEL_RATIO: [1, 3, 0.25],
  RENDER_SCALE_SHORT: [120, 1440, 10],
  CRT_RES_W: [80, 720, 10],
  CRT_RES_H: [120, 960, 10],
  CAMERA_FOV: [5, 60, 1],
  CRT_SCANLINES: [0, 1, 0.01],
  CRT_CURVATURE: [0, 0.4, 0.01],
  CRT_BLEED: [0, 1, 0.01],
  CRT_GHOSTING: [0, 0.9, 0.01],
};
```

Note: layout shares are live-editable; the layout code normalises them, so the sum test only guards the defaults.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/terminal.test.ts tests/core.test.ts`
Expected: PASS (existing `parseDebugParams` tests in `core.test.ts` still pass because old fields are unchanged).

- [ ] **Step 5: Commit** (if approved)

```bash
git add src/config/tuning.ts src/debug/params.ts src/debug/debugPanel.ts tests/terminal.test.ts
git commit -m "T1.1: terminal tuning group and URL params"
```

---

### Task 2: Pure terminal layout

**Files:**
- Create: `src/terminal/layout.ts`
- Test: `tests/terminal.test.ts` (append)

**Interfaces:**
- Consumes: `tuning.terminal.*` from Task 1.
- Produces:
  ```ts
  export interface Rect { x: number; y: number; w: number; h: number }
  export type ZoneId = 'pause' | 'chipSelect' | 'trackball' | 'execute';
  export interface TerminalLayout {
    viewport: { w: number; h: number };
    body: Rect;              // terminal rect, CSS px
    top: Rect; crt: Rect; rail: Rect; deck: Rect; // CSS px
    zones: Record<ZoneId, Rect>; // CSS px
    worldWidth: number;      // terminal width in world units (constant)
    worldHeight: number;     // worldWidth * body.h / body.w
  }
  export const TERMINAL_WORLD_WIDTH = 9;
  export function computeLayout(viewportW: number, viewportH: number): TerminalLayout;
  export function zoneAt(layout: TerminalLayout, x: number, y: number): ZoneId | null;
  export function rectContains(r: Rect, x: number, y: number): boolean;
  /** CSS px rect → world-space center/size on the z=0 face (y up, origin at body center). */
  export function rectToWorld(layout: TerminalLayout, r: Rect): { cx: number; cy: number; w: number; h: number };
  ```

- [ ] **Step 1: Write the failing test** — append to `tests/terminal.test.ts`:

```ts
import { computeLayout, rectContains, rectToWorld, zoneAt, TERMINAL_WORLD_WIDTH } from '../src/terminal/layout';

describe('terminal layout', () => {
  it('fills a typical phone viewport edge to edge', () => {
    const l = computeLayout(390, 844); // aspect 0.462, inside [0.42, 0.62]
    expect(l.body).toEqual({ x: 0, y: 0, w: 390, h: 844 });
    expect(l.top.y).toBe(0);
    expect(l.deck.y + l.deck.h).toBeCloseTo(844, 5);
    expect(l.top.h + l.crt.h + l.rail.h + l.deck.h).toBeCloseTo(844, 5);
  });

  it('pillarboxes a wide desktop viewport', () => {
    const l = computeLayout(1600, 900);
    expect(l.body.h).toBe(900);
    expect(l.body.w).toBeCloseTo(900 * 0.62, 5);
    expect(l.body.x).toBeCloseTo((1600 - l.body.w) / 2, 5);
  });

  it('letterboxes a very tall viewport', () => {
    const l = computeLayout(300, 900); // aspect 0.333 < 0.42
    expect(l.body.w).toBe(300);
    expect(l.body.h).toBeCloseTo(300 / 0.42, 5);
    expect(l.body.y).toBeCloseTo((900 - l.body.h) / 2, 5);
  });

  it('normalises layout shares that do not sum to 1', () => {
    tuning.terminal.LAYOUT_DECK = 0.6; // sum 1.3
    const l = computeLayout(390, 844);
    expect(l.top.h + l.crt.h + l.rail.h + l.deck.h).toBeCloseTo(844, 5);
  });

  it('splits the deck into three non-overlapping zones that cover it', () => {
    const l = computeLayout(390, 844);
    const { chipSelect, trackball, execute } = l.zones;
    expect(chipSelect.x + chipSelect.w).toBeCloseTo(trackball.x, 5);
    expect(trackball.x + trackball.w).toBeCloseTo(execute.x, 5);
    expect(execute.x + execute.w).toBeCloseTo(l.body.x + l.body.w, 5);
    for (const z of [chipSelect, trackball, execute]) {
      expect(z.y).toBeCloseTo(l.deck.y, 5);
      expect(z.h).toBeCloseTo(l.deck.h, 5);
    }
  });

  it('keeps every zone at least 56 px on its short side on a 360×640 phone', () => {
    const l = computeLayout(360, 640);
    for (const z of Object.values(l.zones)) expect(Math.min(z.w, z.h)).toBeGreaterThanOrEqual(56);
  });

  it('finds zones by point and ignores the CRT', () => {
    const l = computeLayout(390, 844);
    const tb = l.zones.trackball;
    expect(zoneAt(l, tb.x + tb.w / 2, tb.y + tb.h / 2)).toBe('trackball');
    expect(zoneAt(l, l.crt.x + l.crt.w / 2, l.crt.y + l.crt.h / 2)).toBeNull();
    const p = l.zones.pause;
    expect(zoneAt(l, p.x + 1, p.y + 1)).toBe('pause');
    expect(rectContains(p, p.x + p.w, p.y)).toBe(false); // right edge is exclusive
  });

  it('maps the body rect to the full world face', () => {
    const l = computeLayout(390, 844);
    const w = rectToWorld(l, l.body);
    expect(w.cx).toBeCloseTo(0, 5);
    expect(w.cy).toBeCloseTo(0, 5);
    expect(w.w).toBeCloseTo(TERMINAL_WORLD_WIDTH, 5);
    expect(w.h).toBeCloseTo(l.worldHeight, 5);
    const top = rectToWorld(l, l.top);
    expect(top.cy).toBeGreaterThan(0); // y up
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/terminal.test.ts`
Expected: FAIL — cannot resolve `../src/terminal/layout`.

- [ ] **Step 3: Implement** — create `src/terminal/layout.ts`:

```ts
import { tuning } from '../config/tuning';

// Terminal layout (TERMINAL.md §3). Pure functions over CSS pixels.
// The terminal face lies on the z=0 plane and the camera looks straight at it,
// so CSS px on the face map linearly to world units.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ZoneId = 'pause' | 'chipSelect' | 'trackball' | 'execute';

export interface TerminalLayout {
  viewport: { w: number; h: number };
  body: Rect;
  top: Rect;
  crt: Rect;
  rail: Rect;
  deck: Rect;
  zones: Record<ZoneId, Rect>;
  worldWidth: number;
  worldHeight: number;
}

export const TERMINAL_WORLD_WIDTH = 9;

const ZONE_ORDER: readonly ZoneId[] = ['pause', 'chipSelect', 'trackball', 'execute'];

export function computeLayout(viewportW: number, viewportH: number): TerminalLayout {
  const t = tuning.terminal;
  const vw = Math.max(1, viewportW);
  const vh = Math.max(1, viewportH);
  const aspect = vw / vh;

  let body: Rect;
  if (aspect > t.TERMINAL_ASPECT_MAX) {
    const w = vh * t.TERMINAL_ASPECT_MAX;
    body = { x: (vw - w) / 2, y: 0, w, h: vh };
  } else if (aspect < t.TERMINAL_ASPECT_MIN) {
    const h = vw / t.TERMINAL_ASPECT_MIN;
    body = { x: 0, y: (vh - h) / 2, w: vw, h };
  } else {
    body = { x: 0, y: 0, w: vw, h: vh };
  }

  const sum = t.LAYOUT_TOP + t.LAYOUT_CRT + t.LAYOUT_RAIL + t.LAYOUT_DECK;
  const share = (v: number) => (sum > 0 ? v / sum : 0.25) * body.h;
  const row = (y: number, h: number): Rect => ({ x: body.x, y, w: body.w, h });
  const top = row(body.y, share(t.LAYOUT_TOP));
  const crtRow = row(top.y + top.h, share(t.LAYOUT_CRT));
  const rail = row(crtRow.y + crtRow.h, share(t.LAYOUT_RAIL));
  const deck = row(rail.y + rail.h, body.y + body.h - (rail.y + rail.h));

  const margin = body.w * t.CRT_MARGIN_X;
  const crt: Rect = { x: body.x + margin, y: crtRow.y, w: body.w - 2 * margin, h: crtRow.h };

  const xL = body.x + body.w * t.DECK_SPLIT_LEFT;
  const xR = body.x + body.w * t.DECK_SPLIT_RIGHT;
  const pauseW = body.w * t.PAUSE_ZONE_W;
  const zones: Record<ZoneId, Rect> = {
    pause: { x: body.x + body.w - pauseW, y: top.y, w: pauseW, h: Math.max(top.h, 56) },
    chipSelect: { x: body.x, y: deck.y, w: xL - body.x, h: deck.h },
    trackball: { x: xL, y: deck.y, w: xR - xL, h: deck.h },
    execute: { x: xR, y: deck.y, w: body.x + body.w - xR, h: deck.h },
  };

  return {
    viewport: { w: vw, h: vh },
    body,
    top,
    crt,
    rail,
    deck,
    zones,
    worldWidth: TERMINAL_WORLD_WIDTH,
    worldHeight: (TERMINAL_WORLD_WIDTH * body.h) / body.w,
  };
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export function zoneAt(layout: TerminalLayout, x: number, y: number): ZoneId | null {
  for (const id of ZONE_ORDER) if (rectContains(layout.zones[id], x, y)) return id;
  return null;
}

export function rectToWorld(layout: TerminalLayout, r: Rect): { cx: number; cy: number; w: number; h: number } {
  const k = layout.worldWidth / layout.body.w;
  const bodyCx = layout.body.x + layout.body.w / 2;
  const bodyCy = layout.body.y + layout.body.h / 2;
  return {
    cx: (r.x + r.w / 2 - bodyCx) * k,
    cy: -(r.y + r.h / 2 - bodyCy) * k,
    w: r.w * k,
    h: r.h * k,
  };
}
```

Note: the pause zone height is clamped to ≥ 56 px so it stays tappable even when the top bar is thin; it may overlap the top of the CRT glass, which has no zone, so this is harmless.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/terminal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (if approved)

```bash
git add src/terminal/layout.ts tests/terminal.test.ts
git commit -m "T1.1: pure terminal layout and hit zones"
```

---

### Task 3: SceneRenderer on a shared renderer with render-to-target

**Files:**
- Modify: `src/render/scene.ts`
- Modify: `src/main.ts` (constructor call only, keeps legacy behaviour)

**Interfaces:**
- Produces:
  ```ts
  export interface SceneRendererOptions {
    renderer: THREE.WebGLRenderer;
    /** Legacy full-screen mode: the renderer canvas lives in and is sized to this element. */
    container?: HTMLElement;
  }
  new SceneRenderer(opts: SceneRendererOptions)
  sceneRenderer.renderInto(target: THREE.WebGLRenderTarget, world: World, alpha: number, dt: number): void
  export const BATTLE_CLEAR_COLOR = 0x0b0e14;
  ```
  Existing `render(world, alpha, dt)`, `resize()`, `setInsets()`, `cellToScreen()`, `actorScreenPos()` keep working in legacy mode (they require `container`).

- [ ] **Step 1: Implement** — in `src/render/scene.ts` make these changes in one write:

Replace the class header, fields and constructor:

```ts
export const BATTLE_CLEAR_COLOR = 0x0b0e14;

export interface SceneRendererOptions {
  renderer: THREE.WebGLRenderer;
  /** Legacy full-screen mode: the renderer canvas lives in and is sized to this element. */
  container?: HTMLElement;
}

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly field: FieldView;
  readonly fieldCamera: FieldCamera;
  readonly playerView = new PlayerView();
  readonly fx = new FxView();
  private readonly enemyViews = new Map<number, EnemyView>();
  private readonly target = new THREE.Vector3(0, 0, 0);
  private readonly container: HTMLElement | null;
  private insets: LayoutInsets = { top: 0 };
  private lastCameraKey = '';

  constructor(opts: SceneRendererOptions) {
    this.renderer = opts.renderer;
    this.container = opts.container ?? null;
    if (this.container) {
      this.renderer.domElement.id = 'game-canvas';
      this.container.appendChild(this.renderer.domElement);
    }

    this.field = new FieldView(tuning.render.PANEL_GAP);
    this.scene.add(this.field.group);
    this.fieldCamera = new FieldCamera(this.field.bounds);
    this.scene.add(this.playerView.sprite, this.fx.group);

    if (this.container) this.resize();
  }
```

Replace `resize`, `updateCamera`, `worldToScreen`:

```ts
  resize(): void {
    if (!this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tuning.render.MAX_PIXEL_RATIO));
    this.renderer.setSize(w, h, false);
    this.updateCamera(true);
  }

  private viewSize(): { w: number; h: number } {
    return this.container
      ? { w: this.container.clientWidth, h: this.container.clientHeight }
      : { w: 1, h: 1 };
  }

  private updateCamera(force: boolean): void {
    const { w, h } = this.viewSize();
    this.fitCamera(force, w, h, this.insets.top, h * tuning.render.FIELD_SCREEN_SHARE - this.insets.top);
  }

  private fitCamera(force: boolean, w: number, h: number, top: number, regionHeight: number): void {
    const tilt = tuning.render.CAMERA_TILT_DEG;
    const key = `${tilt}|${w}|${h}|${top}|${regionHeight}`;
    if (!force && key === this.lastCameraKey) return;
    this.lastCameraKey = key;
    this.fieldCamera.setTilt(tilt, this.target);
    this.fieldCamera.fit({ width: w, height: h, top, regionHeight, fill: 0.94 });
  }
```

```ts
  worldToScreen(v: THREE.Vector3): ScreenPoint {
    const { w, h } = this.viewSize();
    tmp.copy(v).project(this.fieldCamera.camera);
    return {
      x: ((tmp.x + 1) / 2) * w,
      y: ((1 - tmp.y) / 2) * h,
    };
  }
```

Replace `render` with a shared `prepare` plus two entry points:

```ts
  private prepare(world: World, alpha: number, dt: number): void {
    this.playerView.update(world.player, world.tick, alpha, dt, world.activeChip !== null);
    this.syncEnemies(world, alpha, dt);
    this.fx.update(world, alpha);
    const pulse = 0.5 + 0.5 * Math.sin((world.tick + alpha) * 0.5);
    this.field.setDanger(world.state === 'ACTION' ? world.dangerCells() : [], pulse);
  }

  /** Legacy full-screen render into the canvas. */
  render(world: World, alpha: number, dt: number): void {
    this.updateCamera(false);
    this.prepare(world, alpha, dt);
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(BATTLE_CLEAR_COLOR, 1);
    this.renderer.render(this.scene, this.fieldCamera.camera);
  }

  /** Renders the battle into a render target (the CRT), field fitted to the whole target. */
  renderInto(target: THREE.WebGLRenderTarget, world: World, alpha: number, dt: number): void {
    const w = target.width;
    const h = target.height;
    this.fitCamera(false, w, h, 0, h);
    this.prepare(world, alpha, dt);
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(BATTLE_CLEAR_COLOR, 1);
    this.renderer.render(this.scene, this.fieldCamera.camera);
    this.renderer.setRenderTarget(null);
  }
```

Remove the old `this.renderer = new THREE.WebGLRenderer(...)`, `setClearColor` and `domElement.id` lines from the constructor (already replaced above). Keep `LayoutInsets`, `ScreenPoint`, `cellToScreen`, `actorScreenPos`, `handleEvent`, `reset`, `syncEnemies` unchanged.

In `src/main.ts`, add `import * as THREE from 'three';` and replace `const sceneRenderer = new SceneRenderer(stage);` with:

```ts
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const sceneRenderer = new SceneRenderer({ renderer, container: stage });
```

- [ ] **Step 2: Verify legacy mode still works**

Run: `npm run typecheck && npm test`
Expected: PASS (no test touches `SceneRenderer`).

Then start the dev server (`preview_start` with name `glorp-dev`) and open `http://localhost:5173/?ui=css&battle=1&debug=1` in Chrome DevTools MCP with emulation `390x844x3,mobile,touch`. Expected: the battle looks exactly as before (field fills the upper part, HUD on top).

- [ ] **Step 3: Commit** (if approved)

```bash
git add src/render/scene.ts src/main.ts
git commit -m "T1.1: SceneRenderer on a shared renderer, render into target"
```

---

### Task 4: Battle render target, ghosting pass and CRT material

**Files:**
- Create: `src/terminal/crt/battleTarget.ts`
- Create: `src/terminal/crt/crtMaterial.ts`

**Interfaces:**
- Consumes: `SceneRenderer.renderInto` (Task 3), `tuning.terminal.CRT_*` (Task 1).
- Produces:
  ```ts
  export class BattleTarget {
    constructor(renderer: THREE.WebGLRenderer);
    /** Re-creates targets if the requested size changed. */
    setSize(w: number, h: number): void;
    /** Renders the battle (and ghosting when enabled); returns the texture to show on the CRT. */
    render(scene: SceneRenderer, world: World, alpha: number, dt: number): THREE.Texture;
    readonly width: number; readonly height: number;
    /** Estimated GPU memory of the owned targets, bytes. */
    get bytes(): number;
    dispose(): void;
  }
  export class CrtMaterial extends THREE.ShaderMaterial {
    setScreen(tex: THREE.Texture, w: number, h: number): void;
    flash(): void;             // starts a CRT_FLASH_TIME flash
    update(dt: number): void;  // copies tuning into uniforms, decays impulses
  }
  ```

These are WebGL-bound; they are verified in the browser (Task 8), not in Vitest.

- [ ] **Step 1: Implement `battleTarget.ts`**

```ts
import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import type { SceneRenderer } from '../../render/scene';
import type { World } from '../../sim/world';

// Battle → CRT render target (TERMINAL.md §9.1). With CRT_GHOSTING > 0 a
// ping-pong pass keeps a decaying copy of previous frames (phosphor persistence).

const COMPOSE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const COMPOSE_FRAG = /* glsl */ `
uniform sampler2D uBattle;
uniform sampler2D uPrev;
uniform float uGhost;
varying vec2 vUv;
void main() {
  vec3 a = texture2D(uBattle, vUv).rgb;
  vec3 p = texture2D(uPrev, vUv).rgb * uGhost;
  gl_FragColor = vec4(max(a, p), 1.0);
}`;

function makeTarget(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
  });
}

export class BattleTarget {
  private battle: THREE.WebGLRenderTarget;
  private ghostA: THREE.WebGLRenderTarget;
  private ghostB: THREE.WebGLRenderTarget;
  private readonly composeScene = new THREE.Scene();
  private readonly composeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly composeMat = new THREE.ShaderMaterial({
    vertexShader: COMPOSE_VERT,
    fragmentShader: COMPOSE_FRAG,
    uniforms: {
      uBattle: { value: null },
      uPrev: { value: null },
      uGhost: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });

  constructor(private renderer: THREE.WebGLRenderer) {
    this.battle = makeTarget(1, 1);
    this.ghostA = makeTarget(1, 1);
    this.ghostB = makeTarget(1, 1);
    this.composeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.composeMat));
    this.setSize(tuning.terminal.CRT_RES_W, tuning.terminal.CRT_RES_H);
  }

  get width(): number {
    return this.battle.width;
  }

  get height(): number {
    return this.battle.height;
  }

  get bytes(): number {
    // RGBA8 colour + 24-bit depth on the battle target; colour only on ghost targets.
    const px = this.width * this.height;
    return px * 4 + px * 3 + (tuning.terminal.CRT_GHOSTING > 0 ? 2 * px * 4 : 0);
  }

  setSize(w: number, h: number): void {
    const cw = Math.max(1, Math.round(w));
    const ch = Math.max(1, Math.round(h));
    if (cw === this.battle.width && ch === this.battle.height) return;
    this.battle.setSize(cw, ch);
    this.ghostA.setSize(cw, ch);
    this.ghostB.setSize(cw, ch);
  }

  render(scene: SceneRenderer, world: World, alpha: number, dt: number): THREE.Texture {
    scene.renderInto(this.battle, world, alpha, dt);
    const ghost = tuning.terminal.CRT_GHOSTING;
    if (ghost <= 0) return this.battle.texture;

    this.composeMat.uniforms.uBattle!.value = this.battle.texture;
    this.composeMat.uniforms.uPrev!.value = this.ghostA.texture;
    this.composeMat.uniforms.uGhost!.value = ghost;
    this.renderer.setRenderTarget(this.ghostB);
    this.renderer.render(this.composeScene, this.composeCamera);
    this.renderer.setRenderTarget(null);
    const done = this.ghostB;
    this.ghostB = this.ghostA;
    this.ghostA = done;
    return done.texture;
  }

  dispose(): void {
    this.battle.dispose();
    this.ghostA.dispose();
    this.ghostB.dispose();
    this.composeMat.dispose();
  }
}
```

- [ ] **Step 2: Implement `crtMaterial.ts`**

```ts
import * as THREE from 'three';
import { tuning } from '../../config/tuning';

// CRT glass shader (TERMINAL.md §9.2): barrel curvature, chroma bleed,
// scanlines, vignette and event impulses. Applied only to the glass mesh.

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uScreen;
uniform vec2 uRes;
uniform float uScan;
uniform float uCurv;
uniform float uBleed;
uniform float uFlash;
varying vec2 vUv;

vec2 curve(vec2 uv) {
  uv = uv * 2.0 - 1.0;
  vec2 off = abs(uv.yx) * uCurv;
  uv += uv * off * off * 4.0;
  return uv * 0.5 + 0.5;
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 uv = curve(vUv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    vec2 px = 1.0 / uRes;
    vec3 c = texture2D(uScreen, uv).rgb;
    vec3 blur = (texture2D(uScreen, uv - vec2(px.x, 0.0)).rgb + c + texture2D(uScreen, uv + vec2(px.x, 0.0)).rgb) / 3.0;
    vec3 bled = luma(c) + (blur - luma(blur));
    c = mix(c, bled, uBleed);
    float scan = 0.5 + 0.5 * cos(uv.y * uRes.y * 6.2831853);
    c *= 1.0 - uScan * (1.0 - scan);
    vec2 v = uv * (1.0 - uv);
    c *= pow(clamp(v.x * v.y * 16.0, 0.0, 1.0), 0.15);
    c = c * 1.15 + uFlash * 0.35;
    gl_FragColor = vec4(c, 1.0);
  }
  #include <colorspace_fragment>
}`;

export class CrtMaterial extends THREE.ShaderMaterial {
  private flashLeft = 0;

  constructor() {
    super({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uScreen: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uScan: { value: 0 },
        uCurv: { value: 0 },
        uBleed: { value: 0 },
        uFlash: { value: 0 },
      },
    });
  }

  setScreen(tex: THREE.Texture, w: number, h: number): void {
    this.uniforms.uScreen!.value = tex;
    (this.uniforms.uRes!.value as THREE.Vector2).set(w, h);
  }

  flash(): void {
    this.flashLeft = tuning.terminal.CRT_FLASH_TIME;
  }

  update(dt: number): void {
    const t = tuning.terminal;
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    this.uniforms.uScan!.value = t.CRT_SCANLINES;
    this.uniforms.uCurv!.value = t.CRT_CURVATURE;
    this.uniforms.uBleed!.value = t.CRT_BLEED;
    this.uniforms.uFlash!.value = t.CRT_FLASH_TIME > 0 ? this.flashLeft / t.CRT_FLASH_TIME : 0;
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (Non-null assertions on `uniforms.x!` are needed because of `noUncheckedIndexedAccess`.)

- [ ] **Step 4: Commit** (if approved)

```bash
git add src/terminal/crt
git commit -m "T1.1: battle render target, ghosting pass and CRT shader"
```

---

### Task 5: Pointer router

**Files:**
- Create: `src/terminal/interaction/pointerRouter.ts`
- Test: `tests/terminal.test.ts` (append)

**Interfaces:**
- Consumes: `computeLayout`, `zoneAt`, `TerminalLayout`, `ZoneId` (Task 2); `SwipeRecognizer` (`src/core/input/swipe.ts`); `Dir` (`src/core/input/commands.ts`); `tuning.input.SWIPE_MIN_PX`.
- Produces:
  ```ts
  export interface RouterHandlers {
    /** A control was pressed (visual reaction, same frame). */
    press(zone: ZoneId): void;
    release(zone: ZoneId): void;
    /** One trackball step. */
    move(dir: Dir): void;
    /** Trackball drag delta in CSS px, for the rolling visual. */
    roll(dx: number, dy: number): void;
    /** Action controls fire on press. */
    action(zone: 'execute' | 'chipSelect' | 'pause'): void;
  }
  export class PointerRouter {
    constructor(getLayout: () => TerminalLayout, handlers: RouterHandlers);
    down(id: number, x: number, y: number): boolean; // true if a zone captured the pointer
    move(id: number, x: number, y: number): void;
    up(id: number): void;
    cancelAll(): void;
    attach(el: HTMLElement): () => void; // returns detach
  }
  ```

- [ ] **Step 1: Write the failing test** — append to `tests/terminal.test.ts`:

```ts
import { PointerRouter, type RouterHandlers } from '../src/terminal/interaction/pointerRouter';
import type { Dir } from '../src/core/input/commands';

function makeRouter() {
  const layout = computeLayout(390, 844);
  const log: string[] = [];
  const rolls: [number, number][] = [];
  const handlers: RouterHandlers = {
    press: (z) => log.push(`press:${z}`),
    release: (z) => log.push(`release:${z}`),
    move: (d: Dir) => log.push(`move:${d}`),
    roll: (dx, dy) => rolls.push([dx, dy]),
    action: (z) => log.push(`action:${z}`),
  };
  const router = new PointerRouter(() => layout, handlers);
  const center = (z: keyof typeof layout.zones) => {
    const r = layout.zones[z];
    return [r.x + r.w / 2, r.y + r.h / 2] as const;
  };
  return { layout, log, rolls, router, center };
}

describe('PointerRouter', () => {
  it('fires execute on press and releases on up', () => {
    const { router, log, center } = makeRouter();
    const [x, y] = center('execute');
    expect(router.down(1, x, y)).toBe(true);
    router.up(1);
    expect(log).toEqual(['press:execute', 'action:execute', 'release:execute']);
  });

  it('fires chip select and pause on press', () => {
    const { router, log, center } = makeRouter();
    router.down(1, ...center('chipSelect'));
    router.down(2, ...center('pause'));
    expect(log).toContain('action:chipSelect');
    expect(log).toContain('action:pause');
  });

  it('turns one trackball gesture into exactly one step', () => {
    const { router, log, rolls, center } = makeRouter();
    const [x, y] = center('trackball');
    router.down(1, x, y);
    router.move(1, x + 10, y);
    router.move(1, x + 30, y);
    router.move(1, x + 90, y + 5);
    router.up(1);
    expect(log.filter((l) => l.startsWith('move:'))).toEqual(['move:right']);
    expect(log).not.toContain('action:trackball');
    expect(rolls.reduce((s, r) => s + r[0], 0)).toBe(90);
  });

  it('keeps the gesture alive outside the zone', () => {
    const { router, log, center, layout } = makeRouter();
    const [x, y] = center('trackball');
    router.down(1, x, y);
    router.move(1, x, layout.crt.y + 10); // far up, over the CRT
    expect(log).toContain('move:up');
  });

  it('ignores presses outside any zone', () => {
    const { router, log, layout } = makeRouter();
    expect(router.down(1, layout.crt.x + 5, layout.crt.y + 5)).toBe(false);
    router.move(1, layout.crt.x + 100, layout.crt.y + 5);
    router.up(1);
    expect(log).toEqual([]);
  });

  it('tracks two pointers independently (trackball + execute)', () => {
    const { router, log, center } = makeRouter();
    const [tx, ty] = center('trackball');
    router.down(1, tx, ty);
    router.down(2, ...center('execute'));
    router.move(1, tx - 40, ty);
    router.up(2);
    router.up(1);
    expect(log).toEqual([
      'press:trackball',
      'press:execute',
      'action:execute',
      'move:left',
      'release:execute',
      'release:trackball',
    ]);
  });

  it('releases everything on cancelAll', () => {
    const { router, log, center } = makeRouter();
    router.down(1, ...center('execute'));
    router.cancelAll();
    router.up(1);
    expect(log.filter((l) => l.startsWith('release:'))).toEqual(['release:execute']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/terminal.test.ts`
Expected: FAIL — cannot resolve `pointerRouter`.

- [ ] **Step 3: Implement** — create `src/terminal/interaction/pointerRouter.ts`:

```ts
import { tuning } from '../../config/tuning';
import type { Dir } from '../../core/input/commands';
import { SwipeRecognizer } from '../../core/input/swipe';
import { zoneAt, type TerminalLayout, type ZoneId } from '../layout';

// Pointer Events → terminal controls (TERMINAL.md §5). Each pointer captures
// the zone it went down in until it is lifted; a trackball gesture continues
// outside its zone. Action controls fire on press, in the same frame.

export interface RouterHandlers {
  press(zone: ZoneId): void;
  release(zone: ZoneId): void;
  move(dir: Dir): void;
  roll(dx: number, dy: number): void;
  action(zone: 'execute' | 'chipSelect' | 'pause'): void;
}

interface Capture {
  zone: ZoneId;
  lastX: number;
  lastY: number;
  swipe: SwipeRecognizer | null;
}

export class PointerRouter {
  private readonly captures = new Map<number, Capture>();

  constructor(
    private getLayout: () => TerminalLayout,
    private handlers: RouterHandlers,
  ) {}

  down(id: number, x: number, y: number): boolean {
    if (this.captures.has(id)) return true;
    const zone = zoneAt(this.getLayout(), x, y);
    if (!zone) return false;
    let swipe: SwipeRecognizer | null = null;
    if (zone === 'trackball') {
      swipe = new SwipeRecognizer(tuning.input.SWIPE_MIN_PX);
      swipe.begin(x, y);
    }
    this.captures.set(id, { zone, lastX: x, lastY: y, swipe });
    this.handlers.press(zone);
    if (zone !== 'trackball') this.handlers.action(zone);
    return true;
  }

  move(id: number, x: number, y: number): void {
    const c = this.captures.get(id);
    if (!c?.swipe) return;
    this.handlers.roll(x - c.lastX, y - c.lastY);
    c.lastX = x;
    c.lastY = y;
    c.swipe.threshold = tuning.input.SWIPE_MIN_PX;
    const dir = c.swipe.move(x, y);
    if (dir) this.handlers.move(dir);
  }

  up(id: number): void {
    const c = this.captures.get(id);
    if (!c) return;
    this.captures.delete(id);
    c.swipe?.end();
    this.handlers.release(c.zone);
  }

  cancelAll(): void {
    for (const id of [...this.captures.keys()]) this.up(id);
  }

  attach(el: HTMLElement): () => void {
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const onDown = (e: PointerEvent) => {
      const [x, y] = local(e);
      if (!this.down(e.pointerId, x, y)) return;
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // synthetic pointers cannot be captured; routing still works
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!this.captures.has(e.pointerId)) return;
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ce of events.length > 0 ? events : [e]) {
        const [x, y] = local(ce);
        this.move(e.pointerId, x, y);
      }
    };
    const onUp = (e: PointerEvent) => this.up(e.pointerId);
    const onBlur = () => this.cancelAll();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }
}
```

Check before implementing: `SwipeRecognizer.threshold` is a public constructor field (`constructor(public threshold: number)`), so assigning it is allowed.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/terminal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (if approved)

```bash
git add src/terminal/interaction/pointerRouter.ts tests/terminal.test.ts
git commit -m "T1.1: pointer router with trackball gestures and action zones"
```

---

### Task 6: Perf probe

**Files:**
- Create: `src/debug/perfProbe.ts`
- Modify: `src/debug/overlay.ts`
- Test: `tests/terminal.test.ts` (append)

**Interfaces:**
- Produces:
  ```ts
  export interface PerfSnapshot {
    frames: number;
    intervalP50: number; intervalP95: number; // ms between frames
    cpuP50: number; cpuP95: number;           // ms spent in tick+render
    calls: number; triangles: number;         // last frame
    textureBytes: number;                     // estimated, render targets only
    renderW: number; renderH: number;         // canvas backing size
  }
  export class PerfProbe {
    constructor(capacity?: number); // default 600 samples
    record(intervalMs: number, cpuMs: number): void;
    setGpu(calls: number, triangles: number, textureBytes: number, renderW: number, renderH: number): void;
    snapshot(): PerfSnapshot;
    reset(): void;
  }
  export function percentile(sorted: readonly number[], p: number): number;
  ```
  `OverlayInfo` gains optional `perf?: PerfSnapshot`.

- [ ] **Step 1: Write the failing test** — append:

```ts
import { PerfProbe, percentile } from '../src/debug/perfProbe';

describe('PerfProbe', () => {
  it('computes nearest-rank percentiles', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(s, 50)).toBe(5);
    expect(percentile(s, 95)).toBe(10);
    expect(percentile([], 50)).toBe(0);
  });

  it('keeps a rolling window of samples', () => {
    const p = new PerfProbe(4);
    for (const v of [100, 100, 1, 2, 3, 4]) p.record(v, v / 2);
    const s = p.snapshot();
    expect(s.frames).toBe(4);
    expect(s.intervalP95).toBe(4);
    expect(s.cpuP50).toBe(1);
  });

  it('reports gpu counters and resets', () => {
    const p = new PerfProbe();
    p.record(16, 3);
    p.setGpu(42, 1234, 1_000_000, 400, 866);
    expect(p.snapshot()).toMatchObject({ calls: 42, triangles: 1234, textureBytes: 1_000_000, renderW: 400, renderH: 866 });
    p.reset();
    expect(p.snapshot().frames).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/terminal.test.ts`
Expected: FAIL — cannot resolve `perfProbe`.

- [ ] **Step 3: Implement** — `src/debug/perfProbe.ts`:

```ts
// Frame-time percentiles and GPU counters for the terminal budget (TERMINAL.md §10).

export interface PerfSnapshot {
  frames: number;
  intervalP50: number;
  intervalP95: number;
  cpuP50: number;
  cpuP95: number;
  calls: number;
  triangles: number;
  textureBytes: number;
  renderW: number;
  renderH: number;
}

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;
}

export class PerfProbe {
  private intervals: number[] = [];
  private cpu: number[] = [];
  private gpu = { calls: 0, triangles: 0, textureBytes: 0, renderW: 0, renderH: 0 };

  constructor(private capacity = 600) {}

  record(intervalMs: number, cpuMs: number): void {
    this.intervals.push(intervalMs);
    this.cpu.push(cpuMs);
    if (this.intervals.length > this.capacity) {
      this.intervals.shift();
      this.cpu.shift();
    }
  }

  setGpu(calls: number, triangles: number, textureBytes: number, renderW: number, renderH: number): void {
    this.gpu = { calls, triangles, textureBytes, renderW, renderH };
  }

  snapshot(): PerfSnapshot {
    const iv = [...this.intervals].sort((a, b) => a - b);
    const cpu = [...this.cpu].sort((a, b) => a - b);
    return {
      frames: iv.length,
      intervalP50: percentile(iv, 50),
      intervalP95: percentile(iv, 95),
      cpuP50: percentile(cpu, 50),
      cpuP95: percentile(cpu, 95),
      ...this.gpu,
    };
  }

  reset(): void {
    this.intervals = [];
    this.cpu = [];
  }
}
```

In `src/debug/overlay.ts`: add `import type { PerfSnapshot } from './perfProbe';`, add `perf?: PerfSnapshot;` to `OverlayInfo`, and in `update` insert after the `frame … ticks/f` line:

```ts
      (info.perf
        ? `cpu p50 ${info.perf.cpuP50.toFixed(2)} p95 ${info.perf.cpuP95.toFixed(2)} ms  ` +
          `gap p95 ${info.perf.intervalP95.toFixed(1)} ms\n` +
          `calls ${info.perf.calls}  tris ${info.perf.triangles}  rt ${(info.perf.textureBytes / 1048576).toFixed(1)} MB  ` +
          `canvas ${info.perf.renderW}×${info.perf.renderH}\n`
        : '') +
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/terminal.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** (if approved)

```bash
git add src/debug/perfProbe.ts src/debug/overlay.ts tests/terminal.test.ts
git commit -m "T1.1: perf probe with frame-time percentiles and GPU counters"
```

---

### Task 7: Greybox terminal and Terminal assembly

**Files:**
- Create: `src/terminal/parts/greybox.ts`
- Create: `src/terminal/terminal.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 6; `SceneRenderer`; `World`; `SimEvent`.
- Produces:
  ```ts
  // greybox.ts
  export class Greybox {
    readonly group: THREE.Group;
    readonly glass: THREE.Mesh;          // uses the CrtMaterial passed in
    constructor(crt: CrtMaterial);
    build(layout: TerminalLayout): void; // (re)creates meshes for the layout
    press(zone: ZoneId, down: boolean): void;
    roll(dx: number, dy: number): void;
    setGaugeLeds(lit: number): void;     // 0..12
    setHpLeds(lit: number): void;        // 0..10
    setChips(count: number): void;       // 0..5 chips in the rail, first one raised
    update(dt: number): void;            // springs, trackball spin
    setHitZonesVisible(v: boolean): void;
  }
  // terminal.ts
  export interface TerminalOptions {
    renderer: THREE.WebGLRenderer;
    container: HTMLElement;
    sceneRenderer: SceneRenderer;
    perf: PerfProbe;
    handlers: { move(dir: Dir): void; execute(): void; chipSelect(): void; pause(): void };
  }
  export class Terminal {
    constructor(opts: TerminalOptions);
    readonly layout: TerminalLayout;
    resize(): void;
    onEvent(e: SimEvent): void;
    render(world: World, alpha: number, dt: number): void;
    setHitZonesVisible(v: boolean): void;
    dispose(): void;
  }
  ```

WebGL-bound; verified in the browser in Task 8.

- [ ] **Step 1: Implement `src/terminal/parts/greybox.ts`**

```ts
import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import { rectToWorld, type Rect, type TerminalLayout, type ZoneId } from '../layout';
import type { CrtMaterial } from '../crt/crtMaterial';

// T1.1 greybox (TERMINAL.md §11): low-poly stand-ins with roughly final counts,
// enough to measure the budget and to feel the controls. Replaced part by part in T1.2+.

const GAUGE_LEDS = 12;
const HP_LEDS = 10;
const RAIL_SLOTS = 5;

const mat = {
  body: new THREE.MeshLambertMaterial({ color: 0x5b5a55, flatShading: true }),
  dark: new THREE.MeshLambertMaterial({ color: 0x1c1d1f, flatShading: true }),
  bezel: new THREE.MeshLambertMaterial({ color: 0x0c0c0e, flatShading: true }),
  chip: new THREE.MeshLambertMaterial({ color: 0x9a8b62, flatShading: true }),
  execute: new THREE.MeshLambertMaterial({ color: 0xb8322a, flatShading: true }),
  select: new THREE.MeshLambertMaterial({ color: 0xc99a2e, flatShading: true }),
  ball: new THREE.MeshLambertMaterial({ color: 0x2a2c30, flatShading: true }),
  ledOff: new THREE.MeshLambertMaterial({ color: 0x1f2a1f }),
  ledGreen: new THREE.MeshLambertMaterial({ color: 0x113311, emissive: 0x55ff66 }),
  hit: new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true }),
};

interface Pressable {
  mesh: THREE.Object3D;
  restZ: number;
  down: boolean;
  z: number;
}

export class Greybox {
  readonly group = new THREE.Group();
  readonly glass: THREE.Mesh;
  private readonly dynamic = new THREE.Group();
  private readonly hitGroup = new THREE.Group();
  private pressables = new Map<ZoneId, Pressable>();
  private ball: THREE.Mesh | null = null;
  private spin = new THREE.Vector2();
  private gaugeLeds: THREE.InstancedMesh | null = null;
  private hpLeds: THREE.InstancedMesh | null = null;
  private chips: THREE.Mesh[] = [];
  private readonly ledGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();

  constructor(crt: CrtMaterial) {
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), crt);
    this.group.add(this.dynamic, this.hitGroup);
    this.hitGroup.visible = false;
  }

  build(layout: TerminalLayout): void {
    this.dynamic.clear();
    this.hitGroup.clear();
    this.pressables.clear();
    this.chips = [];
    const W = (r: Rect) => rectToWorld(layout, r);

    const body = W(layout.body);
    this.box(body.cx, body.cy, -0.3, body.w, body.h, 0.6, mat.body);

    // CRT bezel and glass.
    const crt = W(layout.crt);
    this.box(crt.cx, crt.cy, 0.05, crt.w * 1.02, crt.h * 0.98, 0.3, mat.bezel);
    const glassH = crt.h * 0.9;
    const glassW = Math.min(crt.w * 0.94, glassH * (tuning.terminal.CRT_RES_W / tuning.terminal.CRT_RES_H));
    this.glass.scale.set(glassW, glassH, 1);
    this.glass.position.set(crt.cx, crt.cy, 0.21);
    this.dynamic.add(this.glass);

    // HP LEDs on the top bar.
    const top = W(layout.top);
    this.hpLeds = this.leds(HP_LEDS, (i, m) => {
      const step = (top.w * 0.55) / HP_LEDS;
      m.compose(
        new THREE.Vector3(top.cx - top.w * 0.4 + step * (i + 0.5), top.cy - top.h * 0.15, 0.05),
        this.tmpQ.identity(),
        new THREE.Vector3(step * 0.5, top.h * 0.3, 0.1),
      );
    });

    // Pause key.
    const pause = W(layout.zones.pause);
    this.pressable('pause', this.box(pause.cx, top.cy, 0.05, Math.min(pause.w, top.h) * 0.6, top.h * 0.6, 0.12, mat.dark), 0.05);

    // Chip rail: slots and chips.
    const rail = W(layout.rail);
    const slotW = (rail.w * 0.78) / RAIL_SLOTS;
    for (let i = 0; i < RAIL_SLOTS; i++) {
      const x = rail.cx - rail.w * 0.45 + slotW * (i + 0.5);
      this.box(x, rail.cy, 0.02, slotW * 0.9, rail.h * 0.85, 0.1, mat.dark);
      const chip = this.box(x, rail.cy, 0.2, slotW * 0.78, rail.h * 0.75, 0.25, mat.chip);
      this.chips.push(chip);
    }

    // Deck controls.
    const sel = W(layout.zones.chipSelect);
    const selSize = Math.min(sel.w, sel.h) * 0.42;
    this.pressable('chipSelect', this.box(sel.cx, sel.cy, 0.15, selSize, selSize, 0.3, mat.select), 0.15);
    const ring = selSize * 0.95;
    this.gaugeLeds = this.leds(GAUGE_LEDS, (i, m) => {
      const a = Math.PI / 2 - (i / GAUGE_LEDS) * Math.PI * 2;
      const s = selSize * 0.12;
      m.compose(
        new THREE.Vector3(sel.cx + Math.cos(a) * ring, sel.cy + Math.sin(a) * ring, 0.05),
        this.tmpQ.identity(),
        new THREE.Vector3(s, s, 0.1),
      );
    });

    const tb = W(layout.zones.trackball);
    const r = Math.min(tb.w, tb.h) * 0.3;
    const socket = new THREE.Mesh(new THREE.TorusGeometry(r * 1.15, r * 0.18, 6, 16), mat.dark);
    socket.position.set(tb.cx, tb.cy, 0.05);
    this.dynamic.add(socket);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat.ball);
    this.ball.position.set(tb.cx, tb.cy, 0.05);
    this.dynamic.add(this.ball);
    this.pressables.set('trackball', { mesh: this.ball, restZ: 0.05, down: false, z: 0.05 });

    const ex = W(layout.zones.execute);
    const exSize = Math.min(ex.w, ex.h) * 0.62;
    this.box(ex.cx, ex.cy, 0.02, exSize * 1.25, exSize * 1.25, 0.1, mat.dark);
    this.pressable('execute', this.box(ex.cx, ex.cy, 0.2, exSize, exSize, 0.35, mat.execute), 0.2);

    // Hit zone debug outlines.
    for (const z of Object.values(layout.zones)) {
      const w = W(z);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w.w, w.h), mat.hit);
      m.position.set(w.cx, w.cy, 0.6);
      this.hitGroup.add(m);
    }
  }

  press(zone: ZoneId, down: boolean): void {
    const p = this.pressables.get(zone);
    if (p) p.down = down;
  }

  roll(dx: number, dy: number): void {
    const g = tuning.terminal.TRACKBALL_ROLL_GAIN;
    // Screen y grows down; rolling the finger down rotates the top of the ball toward the viewer.
    this.spin.set(this.spin.x + dy * g * 60, this.spin.y + dx * g * 60);
  }

  setGaugeLeds(lit: number): void {
    this.setLeds(this.gaugeLeds, lit, GAUGE_LEDS);
  }

  setHpLeds(lit: number): void {
    this.setLeds(this.hpLeds, lit, HP_LEDS);
  }

  setChips(count: number): void {
    this.chips.forEach((c, i) => {
      c.visible = i < count;
      c.position.z = i === 0 ? 0.35 : 0.2;
    });
  }

  update(dt: number): void {
    const depth = tuning.terminal.BUTTON_PRESS_DEPTH;
    const k = 1 - Math.exp(-dt * 40);
    for (const p of this.pressables.values()) {
      const target = p.restZ - (p.down ? depth : 0);
      p.z += (target - p.z) * k;
      p.mesh.position.z = p.z;
    }
    if (this.ball) {
      this.ball.rotation.x += this.spin.x * dt;
      this.ball.rotation.y += this.spin.y * dt;
      const decay = Math.exp(-dt * tuning.terminal.TRACKBALL_FRICTION);
      this.spin.multiplyScalar(decay);
    }
  }

  setHitZonesVisible(v: boolean): void {
    this.hitGroup.visible = v;
  }

  private box(x: number, y: number, z: number, w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    this.dynamic.add(mesh);
    return mesh;
  }

  private pressable(zone: ZoneId, mesh: THREE.Object3D, restZ: number): void {
    this.pressables.set(zone, { mesh, restZ, down: false, z: restZ });
  }

  private leds(count: number, place: (i: number, m: THREE.Matrix4) => void): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(this.ledGeo, mat.ledOff, count);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    for (let i = 0; i < count; i++) {
      place(i, this.tmpM);
      im.setMatrixAt(i, this.tmpM);
    }
    im.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.dynamic.add(im);
    this.setLeds(im, 0, count);
    return im;
  }

  private readonly on = new THREE.Color(0x55ff66);
  private readonly off = new THREE.Color(0x1a241a);

  private setLeds(im: THREE.InstancedMesh | null, lit: number, count: number): void {
    if (!im) return;
    for (let i = 0; i < count; i++) im.setColorAt(i, i < lit ? this.on : this.off);
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
}
```

Notes for the implementer:
- `mat.ledOff` / `mat.ledGreen` are unused once LEDs use instance colours — delete them if `tsc`/lint complains about unused values (they are object properties, so TS won't).
- `setLeds` is called every frame from `Terminal.render`; to avoid redundant GPU uploads, `Terminal` only calls it when the lit count changes (see below).

- [ ] **Step 2: Implement `src/terminal/terminal.ts`**

```ts
import * as THREE from 'three';
import { tuning } from '../config/tuning';
import type { Dir } from '../core/input/commands';
import type { PerfProbe } from '../debug/perfProbe';
import type { SceneRenderer } from '../render/scene';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import { BattleTarget } from './crt/battleTarget';
import { CrtMaterial } from './crt/crtMaterial';
import { computeLayout, type TerminalLayout } from './layout';
import { Greybox } from './parts/greybox';
import { PointerRouter } from './interaction/pointerRouter';

// NET-01 terminal (TERMINAL.md §13). Owns the terminal scene and camera, draws
// the battle into the CRT and the terminal into a low-resolution canvas that
// CSS upscales without smoothing.

const TERMINAL_CLEAR_COLOR = 0x07080a;

export interface TerminalOptions {
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;
  sceneRenderer: SceneRenderer;
  perf: PerfProbe;
  handlers: { move(dir: Dir): void; execute(): void; chipSelect(): void; pause(): void };
}

export class Terminal {
  layout: TerminalLayout;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(22, 1, 0.1, 200);
  private readonly crt = new CrtMaterial();
  private readonly greybox = new Greybox(this.crt);
  private readonly battle: BattleTarget;
  private readonly detach: () => void;
  private lit = { gauge: -1, hp: -1, chips: -1 };
  private layoutKey = '';

  constructor(private opts: TerminalOptions) {
    const { renderer, container } = opts;
    renderer.domElement.id = 'terminal-canvas';
    container.appendChild(renderer.domElement);
    renderer.info.autoReset = false;
    this.battle = new BattleTarget(renderer);

    this.scene.add(this.greybox.group);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff1dd, 1.6);
    key.position.set(-4, 6, 10);
    this.scene.add(key);

    this.layout = computeLayout(container.clientWidth, container.clientHeight);
    const router = new PointerRouter(() => this.layout, {
      press: (z) => this.greybox.press(z, true),
      release: (z) => this.greybox.press(z, false),
      move: (d) => opts.handlers.move(d),
      roll: (dx, dy) => this.greybox.roll(dx, dy),
      action: (z) => {
        if (z === 'execute') opts.handlers.execute();
        else if (z === 'chipSelect') opts.handlers.chipSelect();
        else opts.handlers.pause();
      },
    });
    this.detach = router.attach(renderer.domElement);
    this.resize();
  }

  resize(): void {
    const { container, renderer } = this.opts;
    const t = tuning.terminal;
    const vw = Math.max(1, container.clientWidth);
    const vh = Math.max(1, container.clientHeight);
    const key = [vw, vh, t.RENDER_SCALE_SHORT, t.CAMERA_FOV, t.LAYOUT_TOP, t.LAYOUT_CRT, t.LAYOUT_RAIL, t.LAYOUT_DECK,
      t.CRT_MARGIN_X, t.DECK_SPLIT_LEFT, t.DECK_SPLIT_RIGHT, t.PAUSE_ZONE_W, t.CRT_RES_W, t.CRT_RES_H,
      t.TERMINAL_ASPECT_MIN, t.TERMINAL_ASPECT_MAX].join('|');
    if (key === this.layoutKey) return;
    this.layoutKey = key;

    this.layout = computeLayout(vw, vh);
    const scale = t.RENDER_SCALE_SHORT / Math.min(vw, vh);
    renderer.setPixelRatio(1);
    renderer.setSize(Math.max(1, Math.round(vw * scale)), Math.max(1, Math.round(vh * scale)), false);

    // Straight-on camera: the z=0 face maps linearly to CSS px.
    const k = this.layout.worldWidth / this.layout.body.w; // world units per CSS px
    const fov = THREE.MathUtils.degToRad(t.CAMERA_FOV);
    const dist = (vh * k) / 2 / Math.tan(fov / 2);
    const bodyCx = this.layout.body.x + this.layout.body.w / 2;
    const bodyCy = this.layout.body.y + this.layout.body.h / 2;
    this.camera.fov = t.CAMERA_FOV;
    this.camera.aspect = vw / vh;
    this.camera.near = Math.max(0.1, dist - 10);
    this.camera.far = dist + 10;
    this.camera.position.set((vw / 2 - bodyCx) * k, -(vh / 2 - bodyCy) * k, dist);
    this.camera.lookAt(this.camera.position.x, this.camera.position.y, 0);
    this.camera.updateProjectionMatrix();

    this.battle.setSize(t.CRT_RES_W, t.CRT_RES_H);
    this.greybox.build(this.layout);
    this.lit = { gauge: -1, hp: -1, chips: -1 };
  }

  onEvent(e: SimEvent): void {
    if (e.type === 'chipUsed') this.crt.flash();
  }

  setHitZonesVisible(v: boolean): void {
    this.greybox.setHitZonesVisible(v);
  }

  render(world: World, alpha: number, dt: number): void {
    const { renderer, sceneRenderer, perf } = this.opts;
    this.resize(); // cheap unless the viewport or layout tunables changed
    renderer.info.reset();

    const screen = this.battle.render(sceneRenderer, world, alpha, dt);
    this.crt.setScreen(screen, this.battle.width, this.battle.height);
    this.crt.update(dt);

    const gauge = world.gauge.full ? 12 : Math.floor(world.gauge.value * 12);
    const hp = Math.ceil((10 * world.player.hp) / Math.max(1, world.player.maxHp));
    const chips = world.chips.queue.length;
    if (gauge !== this.lit.gauge) this.greybox.setGaugeLeds((this.lit.gauge = gauge));
    if (hp !== this.lit.hp) this.greybox.setHpLeds((this.lit.hp = hp));
    if (chips !== this.lit.chips) this.greybox.setChips((this.lit.chips = chips));
    this.greybox.update(dt);

    renderer.setRenderTarget(null);
    renderer.setClearColor(TERMINAL_CLEAR_COLOR, 1);
    renderer.render(this.scene, this.camera);

    const size = renderer.getSize(new THREE.Vector2());
    perf.setGpu(renderer.info.render.calls, renderer.info.render.triangles, this.battle.bytes, size.x, size.y);
  }

  dispose(): void {
    this.detach();
    this.battle.dispose();
  }
}
```

Check while implementing: `world.gauge.value` (0..1) and `world.gauge.full`, `world.player.hp/maxHp`, `world.chips.queue` exist (they are used in `main.ts` today). `renderer.getSize` allocates a `Vector2` per frame — hoist it into a private field.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit** (if approved)

```bash
git add src/terminal
git commit -m "T1.1: greybox terminal with CRT, LEDs, rail and pressable controls"
```

---

### Task 8: Wire the terminal into main, bench mode, verify and measure

**Files:**
- Create: `src/debug/bench.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/styles.css`
- Modify: `docs/TERMINAL.md` (§14, §17)
- Test: `tests/terminal.test.ts` (append, bench autopilot)

**Interfaces:**
- Consumes: everything above.
- Produces:
  ```ts
  // bench.ts
  export interface BenchResult { seconds: number; snapshot: PerfSnapshot }
  export class BenchAutopilot {
    constructor(seed: number, durationSeconds?: number); // default 20
    /** Called once per frame; returns commands to push (may be empty). Done after duration. */
    frame(dt: number): Command[];
    get done(): boolean;
  }
  export function formatBench(r: BenchResult): string;
  ```

- [ ] **Step 1: Write the failing test** — append:

```ts
import { BenchAutopilot, formatBench } from '../src/debug/bench';

describe('BenchAutopilot', () => {
  it('issues moves and chip uses deterministically and stops after the duration', () => {
    const a = new BenchAutopilot(7, 2);
    const b = new BenchAutopilot(7, 2);
    const out: string[] = [];
    for (let i = 0; i < 180; i++) {
      const ca = a.frame(1 / 60);
      const cb = b.frame(1 / 60);
      expect(ca).toEqual(cb);
      for (const c of ca) out.push(c.type);
    }
    expect(out).toContain('move');
    expect(out).toContain('useChip');
    expect(a.done).toBe(true);
    expect(a.frame(1 / 60)).toEqual([]);
  });

  it('formats a readable report', () => {
    const s = formatBench({
      seconds: 20,
      snapshot: { frames: 1200, intervalP50: 16.6, intervalP95: 17.4, cpuP50: 2.1, cpuP95: 3.4,
        calls: 61, triangles: 4210, textureBytes: 1_075_200, renderW: 400, renderH: 866 },
    });
    expect(s).toContain('cpu p95 3.40 ms');
    expect(s).toContain('calls 61');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/terminal.test.ts`
Expected: FAIL — cannot resolve `bench`.

- [ ] **Step 3: Implement `src/debug/bench.ts`**

```ts
import type { Command, Dir } from '../core/input/commands';
import { Rng } from '../core/rng';
import type { PerfSnapshot } from './perfProbe';

// ?bench=1 (TERMINAL.md §14): plays battle 1 with random moves and chip uses
// for a fixed time so the frame budget can be measured on a real phone.

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];
const MOVE_EVERY = 0.35;
const CHIP_EVERY = 1.3;

export interface BenchResult {
  seconds: number;
  snapshot: PerfSnapshot;
}

export class BenchAutopilot {
  private readonly rng: Rng;
  private elapsed = 0;
  private nextMove = MOVE_EVERY;
  private nextChip = CHIP_EVERY;

  constructor(seed: number, private duration = 20) {
    this.rng = new Rng(seed);
  }

  get done(): boolean {
    return this.elapsed >= this.duration;
  }

  frame(dt: number): Command[] {
    if (this.done) return [];
    this.elapsed += dt;
    const out: Command[] = [];
    if (this.elapsed >= this.nextMove) {
      this.nextMove += MOVE_EVERY;
      out.push({ type: 'move', dir: this.rng.pick(DIRS) });
    }
    if (this.elapsed >= this.nextChip) {
      this.nextChip += CHIP_EVERY;
      out.push({ type: 'useChip' });
    }
    return out;
  }
}

export function formatBench(r: BenchResult): string {
  const s = r.snapshot;
  return (
    `BENCH ${r.seconds}s  frames ${s.frames}\n` +
    `cpu p50 ${s.cpuP50.toFixed(2)} ms  cpu p95 ${s.cpuP95.toFixed(2)} ms\n` +
    `gap p50 ${s.intervalP50.toFixed(1)} ms  gap p95 ${s.intervalP95.toFixed(1)} ms\n` +
    `calls ${s.calls}  tris ${s.triangles}  rt ${(s.textureBytes / 1048576).toFixed(1)} MB  canvas ${s.renderW}×${s.renderH}`
  );
}
```

Check: the `Command` union in `src/core/input/commands.ts` is `{ type: 'move'; dir: Dir } | { type: 'useChip' } | { type: 'openCustom' }`; adjust the object literals if the field names differ.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/terminal.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `src/main.ts`** (one write)

1. Imports: add
   ```ts
   import { BenchAutopilot, formatBench } from './debug/bench';
   import { PerfProbe } from './debug/perfProbe';
   import { Terminal } from './terminal/terminal';
   ```
2. After `if (params.timescale !== 1) …` add:
   ```ts
   if (params.rscale !== null) tuning.terminal.RENDER_SCALE_SHORT = params.rscale;
   if (params.crtres) [tuning.terminal.CRT_RES_W, tuning.terminal.CRT_RES_H] = params.crtres;
   const terminalMode = params.ui === 'terminal';
   document.getElementById('app')?.classList.toggle('ui-terminal', terminalMode);
   const perf = new PerfProbe();
   const bench = params.bench ? new BenchAutopilot(params.seed ?? 1) : null;
   if (bench) {
     cheats.god = true;
     session.debugJump(1);
   }
   ```
   (Place the `bench` block after `session` is created.)
3. Replace the renderer/scene block from Task 3 with:
   ```ts
   const renderer = new THREE.WebGLRenderer({ antialias: !terminalMode, powerPreference: 'high-performance' });
   const sceneRenderer = new SceneRenderer(terminalMode ? { renderer } : { renderer, container: stage });
   ```
4. Replace `attachSwipe(input);` with `if (!terminalMode) attachSwipe(input);`.
5. After `togglePause` is declared, create the terminal:
   ```ts
   const terminal = terminalMode
     ? new Terminal({
         renderer,
         container: stage,
         sceneRenderer,
         perf,
         handlers: {
           move: (dir) => input.push({ type: 'move', dir }),
           execute: () => input.push({ type: 'useChip' }),
           chipSelect: () => input.push({ type: 'openCustom' }),
           pause: () => {
             if (session.screen === 'BATTLE' || session.screen === 'PAUSED') togglePause();
           },
         },
       })
     : null;
   terminal?.setHitZonesVisible(params.hitzones);
   ```
6. In the loop `tick`, after `sceneRenderer.handleEvent(e, world);` add `terminal?.onEvent(e);`.
7. In the loop `render` callback: replace `sceneRenderer.render(world, simAlpha, dt);` and `labels.update(world, simAlpha);` with
   ```ts
   const cpuStart = performance.now();
   if (bench) for (const c of bench.frame(frameSeconds)) input.push(c);
   if (terminal) terminal.render(world, simAlpha, dt);
   else {
     sceneRenderer.render(world, simAlpha, dt);
     labels.update(world, simAlpha);
   }
   ```
   and at the end of the callback, before `overlay.update(…)`:
   ```ts
   perf.record(frameSeconds * 1000, loop.stats.frameMs + (performance.now() - cpuStart));
   if (bench?.done && !benchReported) {
     benchReported = true;
     benchReport = formatBench({ seconds: 20, snapshot: perf.snapshot() });
     console.info(benchReport);
     setDebugVisible(true);
   }
   ```
   Pass `perf: perf.snapshot()` into `overlay.update` only when `terminal` exists, and prefix `extra` with `benchReport ? benchReport + '\n' : ''`. Declare `let benchReported = false; let benchReport = '';` next to `perf`.
   Note: `loop.stats.frameMs` is written after the render callback returns, so it holds the previous frame's total (ticks + render). That is a good enough CPU estimate for a one-frame lag; do not double count — use only `loop.stats.frameMs` if that reads cleaner:
   ```ts
   perf.record(frameSeconds * 1000, loop.stats.frameMs);
   ```
   Use this simpler form and drop `cpuStart`.
8. `perf.snapshot()` sorts 600 numbers; the overlay already throttles to 4 Hz, so call `perf.snapshot()` only when `overlay.visible` is true.
9. Layout handler: replace `layout()` body with
   ```ts
   function layout(): void {
     if (terminal) terminal.resize();
     else sceneRenderer.setInsets({ top: hud.occupiedTop });
   }
   ```
10. In `window.__glorp` add `terminal,` and `perf,`.
11. `setCoordsVisible` in the debug panel keeps working (the field is still rendered in the CRT).

- [ ] **Step 6: CSS** — in `src/ui/styles.css` (one write), add after the `#game-canvas` rule:

```css
#terminal-canvas {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  touch-action: none;
}

/* T1.1–T1.5: the terminal replaces the HUD, controls and world labels. */
#app.ui-terminal .hud-top,
#app.ui-terminal .controls,
#app.ui-terminal .world-labels {
  display: none;
}
```

Check `src/ui/hud.ts` for the actual root class of the top HUD (the plan assumes `hud-top`); if the root differs, hide that class instead.

- [ ] **Step 7: Docs** — in `docs/TERMINAL.md`:
  - §17 table: rename `RENDER_SCALE_SHORT` stays; replace `TRACKBALL_ZONE_PAD` row with `DECK_SPLIT_LEFT` / `DECK_SPLIT_RIGHT` (0.27 / 0.63, доли ширины, колонки CHIP SELECT | трекбол | EXECUTE); add rows `TERMINAL_ASPECT_MIN` / `TERMINAL_ASPECT_MAX` (0.42 / 0.62), `CRT_MARGIN_X` (0.1), `PAUSE_ZONE_W` (0.16); change `BUTTON_PRESS_DEPTH` to 0.12 world units; remove `CAMERA_PITCH` from T1.1 (added in T1.2).
  - §14 URL list: add `?bench=1`.
  - §5.1: replace "`TRACKBALL_ZONE_PAD`" with "колонка между `DECK_SPLIT_LEFT` и `DECK_SPLIT_RIGHT`".

- [ ] **Step 8: Full check**

Run: `npm test && npm run build`
Expected: all tests PASS, build succeeds.

- [ ] **Step 9: Browser verification (desktop + phone emulation)**

Start the dev server (`preview_start` name `glorp-dev`). Use Chrome DevTools MCP (the in-app Browser pane does not run rAF while hidden).

1. `http://localhost:5173/?battle=1&debug=1` with emulation `390x844x3,mobile,touch`:
   - Take a screenshot. Expected: greybox terminal fills the screen; battle visible inside the CRT with scanlines and curvature; big chunky pixels on the body; HTML HUD/controls hidden; DBG button visible.
   - Tap the Custom Screen OK (HTML) to start. Then drag on the trackball zone to the right via `evaluate_script` dispatching `pointerdown`/`pointermove`/`pointerup` on `#terminal-canvas` at the zone centre (`__glorp.terminal.layout.zones.trackball`). Expected: `__glorp.world.player.x` increased by exactly 1; ball visibly rotated.
   - Dispatch a pointerdown on the execute zone. Expected: a chip is used (`__glorp.world.chips.queue.length` decreased), CRT flashes, execute block moves in.
   - `?hitzones=1`: magenta wireframes match the three deck columns and the pause key.
2. Desktop 1600×900 (clear emulation): terminal centred and pillarboxed; mouse press on EXECUTE works the same.
3. `?ui=css&battle=1`: legacy UI unchanged.
4. `?bench=1&debug=1` (phone emulation): after 20 s the overlay shows the BENCH block. Record the numbers.
5. Repeat the bench with `?rscale=300`, `?rscale=600` and with `CRT_GHOSTING` set to 0 in the DBG panel to see the cost of each knob.

- [ ] **Step 10: Commit and deploy for the phone measurement** (requires the user's approval to commit and push)

```bash
git add -A
git commit -m "T1.1: terminal tech spike behind the default UI, bench mode"
git push
```

Wait for the Pages deploy, then ask the user to open on their phone:
`https://zavtraleto.github.io/glorp-battle/?bench=1&debug=1` (and with `&rscale=300`), and send the BENCH block (screenshot) plus the phone model; also on PC with the mouse.

- [ ] **Step 11: Gate decision**

Compare with TERMINAL.md §10: cpu p95 ≤ 8 ms (phone) / ≤ 4 ms (PC), gap p95 close to the display refresh interval (16.7 ms at 60 Hz, 8.3 ms at 120 Hz), calls ≤ 150, tris ≤ 30 000.
- Within budget → write the result into TERMINAL.md §18 (закрыть вопрос 3) and move on to the T1.2 plan.
- Over budget → apply §10 fallbacks in order (`RENDER_SCALE_SHORT`, `CRT_GHOSTING = 0`, `CRT_RES_*`), re-measure, and report to the user before continuing.
