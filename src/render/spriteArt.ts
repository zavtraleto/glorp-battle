import * as THREE from 'three';
import playerUrl from '../assets/sprites/player.png';
import mettikUrl from '../assets/sprites/mettik.png';
import canodronUrl from '../assets/sprites/canodron.png';
import hopzapUrl from '../assets/sprites/hopzap.png';
import bladdyUrl from '../assets/sprites/bladdy.png';
import punchyUrl from '../assets/sprites/punchy.png';

// Hand-drawn sprites (BATTLE_VISUAL.md §5): full-colour art drawn on its own
// render layer after the palette pass, toned down to sit on the dark CRT.
// Sources live in /assets at full size; src/assets/sprites holds area-averaged,
// hard-alpha cut-downs (player: 128×128; enemies: within 128×160) that ship
// with the game. Kinds without art use one static placeholder bitmap.

export type ArtId = 'player' | 'mettik' | 'canodron' | 'hopzap' | 'bladdy' | 'punchy';
export type EnemySpriteId = Exclude<ArtId, 'player'> | 'placeholder';

const URLS: Record<ArtId, string> = {
  player: playerUrl,
  mettik: mettikUrl,
  canodron: canodronUrl,
  hopzap: hopzapUrl,
  bladdy: bladdyUrl,
  punchy: punchyUrl,
};

/** Enemy kinds drawn with hand-made art. */
export const ENEMY_ART: Readonly<Record<string, EnemySpriteId>> = {
  mettik: 'mettik',
  canodron: 'canodron',
  hopzap: 'hopzap',
  bladdy: 'bladdy',
  punchy: 'punchy',
};

/** Shipped art id, or the one placeholder used by future enemy kinds. */
export function enemyArtId(kind: string): EnemySpriteId {
  return ENEMY_ART[kind] ?? 'placeholder';
}

/** Tone-down toward the CRT: keep this much saturation and brightness. */
const SATURATION = 0.78;
const BRIGHTNESS = 0.9;
/** A hit flash pushes the art this far toward white. */
const FLASH_WHITE = 0.6;

export interface SpriteArt {
  w: number;
  h: number;
  normal: THREE.DataTexture;
  flashed: THREE.DataTexture;
}

const loaded = new Map<ArtId, SpriteArt>();

/** Stable per-pixel noise in [0, 1): the order the dissolve eats pixels in. */
function noise(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Tones one RGB pixel (0..255) down for the CRT; pure, exported for tests. */
export function toneForCrt(r: number, g: number, b: number): [number, number, number] {
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  const c = (v: number) => Math.max(0, Math.min(255, Math.round((l + (v - l) * SATURATION) * BRIGHTNESS)));
  return [c(r), c(g), c(b)];
}

function texture(src: Uint8ClampedArray, w: number, h: number, flash: number): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3]! < 128) continue;
      const [r, g, b] = toneForCrt(src[i]!, src[i + 1]!, src[i + 2]!);
      // DataTexture rows start at the bottom.
      const o = ((h - 1 - y) * w + x) * 4;
      data[o] = Math.round(r + (255 - r) * flash);
      data[o + 1] = Math.round(g + (255 - g) * flash);
      data[o + 2] = Math.round(b + (255 - b) * flash);
      // Opaque pixels get alpha 130..255 so alphaTest can dissolve them in a noisy order.
      data[o + 3] = 130 + Math.floor(noise(x, y) * 125);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Continuous perspective scaling: mipmaps for a clean shrink, nearest when enlarged.
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`sprite art failed to load: ${url}`));
    img.src = url;
  });
}

/** Loads every sprite; kinds whose art fails keep the procedural look. */
export async function loadSpriteArt(): Promise<void> {
  if (typeof document === 'undefined') return;
  await Promise.all(
    (Object.keys(URLS) as ArtId[]).map(async (id) => {
      try {
        const img = await loadImage(URLS[id]);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, img.width, img.height).data;
        loaded.set(id, {
          w: img.width,
          h: img.height,
          normal: texture(px, img.width, img.height, 0),
          flashed: texture(px, img.width, img.height, FLASH_WHITE),
        });
      } catch (err) {
        console.warn(err);
      }
    }),
  );
}

/** The loaded art, or null (not loaded yet, failed, or no DOM). */
export function spriteArt(id: ArtId): SpriteArt | null {
  return loaded.get(id) ?? null;
}
