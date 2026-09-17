import * as THREE from 'three';
import { Rng } from '../../core/rng';
import { drawText, measureText, GLYPH_H, type PixelSink } from '../crt/pixelFont';

// Small procedural canvas textures (TERMINAL.md §9.4): worn plastic, labels,
// counters. Chunky pixels, nearest filtering, deterministic seeds.

const SHADE_MID = 128;
const BLOCK4 = 12;
const BLOCK2 = 6;
const SCRATCH = 40;

/** Shade per texel (0..255, 128 = base colour): blotches in 4×4 and 2×2 blocks plus short scratches. */
export function plasticPattern(seed: number, w: number, h: number): Uint8Array {
  const rng = new Rng(seed);
  const v = new Float32Array(w * h).fill(SHADE_MID);
  const blocks = (size: number, amp: number) => {
    for (let by = 0; by < h; by += size)
      for (let bx = 0; bx < w; bx += size) {
        const d = (rng.next() * 2 - 1) * amp;
        for (let y = by; y < Math.min(h, by + size); y++)
          for (let x = bx; x < Math.min(w, bx + size); x++) v[y * w + x] = (v[y * w + x] as number) + d;
      }
  };
  blocks(4, BLOCK4);
  blocks(2, BLOCK2);
  const scratches = Math.floor((w * h) / 64);
  for (let i = 0; i < scratches; i++) {
    const x = rng.int(0, w - 2);
    const y = rng.int(0, h - 1);
    v[y * w + x] = (v[y * w + x] as number) - SCRATCH;
    v[y * w + x + 1] = (v[y * w + x + 1] as number) - SCRATCH;
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(v[i] as number)));
  return out;
}

function pixelTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return ctx;
}

/** Worn plastic / painted metal, tileable. */
export function plasticTexture(seed: number, base: THREE.ColorRepresentation, size = 64): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = context(canvas);
  const img = ctx.createImageData(size, size);
  const shades = plasticPattern(seed, size, size);
  // Canvas pixels are sRGB; Color stores linear components.
  const c = new THREE.Color(base).getRGB(new THREE.Color(), THREE.SRGBColorSpace);
  const r = c.r * 255;
  const g = c.g * 255;
  const b = c.b * 255;
  for (let i = 0; i < shades.length; i++) {
    const k = (shades[i] as number) / SHADE_MID;
    img.data[i * 4] = Math.min(255, r * k);
    img.data[i * 4 + 1] = Math.min(255, g * k);
    img.data[i * 4 + 2] = Math.min(255, b * k);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = pixelTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export interface LabelTexture {
  texture: THREE.CanvasTexture;
  /** Size in texels. */
  width: number;
  height: number;
}

/** Pixel-font text on a transparent background, 1 texel of padding. */
export function labelTexture(text: string, color: string, scale = 1): LabelTexture {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, measureText(text, scale) + 2);
  canvas.height = GLYPH_H * scale + 2;
  drawText(context(canvas) as unknown as PixelSink, text, 1, 1, scale, color);
  return { texture: pixelTexture(canvas), width: canvas.width, height: canvas.height };
}

/** Creates a canvas texture for a small segment-style counter; redraw with `drawCounter`. */
export function counterTexture(width: number, height: number): { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, texture: pixelTexture(canvas) };
}

export function drawCounter(canvas: HTMLCanvasElement, text: string, color: string, background: string): void {
  const ctx = context(canvas);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const x = Math.round((canvas.width - measureText(text)) / 2);
  const y = Math.round((canvas.height - GLYPH_H) / 2);
  drawText(ctx as unknown as PixelSink, text, x, y, 1, color);
}
