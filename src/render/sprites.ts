import * as THREE from 'three';

// Text textures for debug overlays (cell coordinates).

export function makeLabelTexture(
  text: string,
  opts: { size?: number; color?: string; background?: string; font?: string } = {},
): THREE.CanvasTexture {
  const size = opts.size ?? 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = opts.color ?? '#ffffff';
  ctx.font = opts.font ?? `bold ${Math.round(size * 0.42)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2 + size * 0.02);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
