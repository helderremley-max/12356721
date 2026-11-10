import * as THREE from 'three';
import { Rng } from '../../core/math';

/**
 * Canvas-generated textures for the roadside city. Facade tiles are authored
 * in metres (12 m wide) so geometry can repeat them by plain division.
 */

export type FacadeKind = 'panel' | 'brick' | 'modern' | 'glass' | 'commercial' | 'warehouse' | 'shop' | 'lobby';

export interface FacadeSpec {
  /** Tile size in metres. */
  tw: number;
  th: number;
  /** Storey height; th / fh storeys per tile. */
  fh: number;
}

export const FACADE: Record<FacadeKind, FacadeSpec> = {
  panel: { tw: 12, th: 14, fh: 2.8 },
  brick: { tw: 12, th: 12, fh: 3 },
  modern: { tw: 12, th: 12, fh: 3 },
  glass: { tw: 12, th: 14.4, fh: 3.6 },
  commercial: { tw: 12, th: 8, fh: 4 },
  warehouse: { tw: 12, th: 8, fh: 8 },
  shop: { tw: 12, th: 4.2, fh: 4.2 },
  lobby: { tw: 12, th: 4.2, fh: 4.2 },
};

export const GROUND_FLOOR_H = 4.2;

export interface TexPair {
  map: THREE.Texture;
  emissive: THREE.Texture | null;
}

type Ctx = CanvasRenderingContext2D;

function mk(w: number, h: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('2D canvas unavailable');
  return { c, g };
}

function toTex(c: HTMLCanvasElement, aniso: number, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

function grain(g: Ctx, w: number, h: number, amount: number, rng: Rng): void {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

const hsl = (h: number, s: number, l: number, a = 1): string => `hsla(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%, ${a})`;

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng.next() * list.length) % list.length];
}

const CURTAINS = ['#e8dcc6', '#d9c3b0', '#c9d3d8', '#e3e0d8', '#bfae8f', '#d6c0c8', '#c8d6c2', '#9fb0c4'];

function litColor(rng: Rng): string {
  const r = rng.next();
  const b = 0.55 + rng.next() * 0.45;
  if (r < 0.62) return `rgba(255, ${185 + rng.next() * 45}, ${110 + rng.next() * 60}, ${b})`;
  if (r < 0.85) return `rgba(255, 238, ${200 + rng.next() * 40}, ${b})`;
  return `rgba(${170 + rng.next() * 40}, ${205 + rng.next() * 20}, 255, ${b})`;
}

/** One window: frame, glass in a random state, and its night glow. */
function paintWindow(g: Ctx, ge: Ctx, x: number, y: number, w: number, h: number, rng: Rng, litP: number, frame = '#eeeeea', sashes = 2): void {
  const f = Math.max(2, w * 0.05);
  g.fillStyle = frame;
  g.fillRect(x - f, y - f, w + f * 2, h + f * 2);
  const r = rng.next();
  let glass: string | CanvasGradient;
  let glow = '';
  const grad = g.createLinearGradient(x, y, x + w * 0.4, y + h);
  if (r < 0.4) {
    grad.addColorStop(0, '#9fb4c6');
    grad.addColorStop(0.5, '#6d8497');
    grad.addColorStop(1, '#40525f');
    glass = grad;
  } else if (r < 0.62) {
    grad.addColorStop(0, '#3a4650');
    grad.addColorStop(1, '#1d262d');
    glass = grad;
  } else if (r < 0.86) {
    const c = pick(rng, CURTAINS);
    glass = c;
    glow = c;
  } else {
    glass = '#cdc5b0';
    glow = '#cdc5b0';
  }
  g.fillStyle = glass;
  g.fillRect(x, y, w, h);
  if (r >= 0.4 && r < 0.62) {
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(x, y, w, h * 0.35);
  } else if (r >= 0.86) {
    g.fillStyle = 'rgba(80,70,50,0.35)';
    for (let yy = y + 2; yy < y + h; yy += 3) g.fillRect(x, yy, w, 1);
  } else if (r >= 0.62) {
    g.fillStyle = 'rgba(60,50,40,0.12)';
    for (let xx = x + 3; xx < x + w; xx += 6) g.fillRect(xx, y, 2, h);
  }
  if (r < 0.4) {
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.beginPath();
    g.moveTo(x + w * 0.1, y + h);
    g.lineTo(x + w * 0.45, y);
    g.lineTo(x + w * 0.65, y);
    g.lineTo(x + w * 0.3, y + h);
    g.fill();
  }
  g.fillStyle = frame;
  for (let i = 1; i < sashes; i++) g.fillRect(x + (w * i) / sashes - f / 2, y, f, h);
  g.fillRect(x, y + h * 0.28, w, f * 0.8);
  if (rng.next() < litP) {
    const lc = litColor(rng);
    ge.fillStyle = lc;
    ge.fillRect(x, y, w, h);
    if (glow) {
      ge.fillStyle = glow;
      ge.globalAlpha = 0.35;
      ge.fillRect(x, y, w, h);
      ge.globalAlpha = 1;
    }
    ge.fillStyle = '#000';
    for (let i = 1; i < sashes; i++) ge.fillRect(x + (w * i) / sashes - f / 2, y, f, h);
  }
}

function stain(g: Ctx, x: number, y: number, w: number, len: number, a: number): void {
  const gr = g.createLinearGradient(0, y, 0, y + len);
  gr.addColorStop(0, `rgba(40,35,30,${a})`);
  gr.addColorStop(1, 'rgba(40,35,30,0)');
  g.fillStyle = gr;
  g.fillRect(x, y, w, len);
}

function panelFacade(P: number, aniso: number, seed: number): TexPair {
  const rng = new Rng(seed);
  const W = 12 * P;
  const H = 14 * P;
  const fl = 2.8 * P;
  const bay = 3 * P;
  const { c, g } = mk(W, H);
  const { c: ce, g: ge } = mk(W, H);
  g.fillStyle = '#d4d1c9';
  g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  for (let f = 0; f < 5; f++) {
    for (let b = 0; b < 4; b++) {
      g.fillStyle = hsl(40, 8, 76 + rng.next() * 9, 0.55);
      g.fillRect(b * bay, H - (f + 1) * fl, bay, fl);
    }
  }
  const balcCols = pick(rng, [[1, 0, 1, 0], [0, 1, 0, 1], [1, 0, 0, 1], [0, 1, 1, 0]]);
  for (let f = 0; f < 5; f++) {
    const y0 = H - (f + 1) * fl;
    for (let b = 0; b < 4; b++) {
      const x0 = b * bay;
      const ww = bay * 0.52;
      const wh = fl * 0.5;
      const wx = x0 + (bay - ww) / 2;
      const wy = y0 + fl * 0.22;
      paintWindow(g, ge, wx, wy, ww, wh, rng, 0.4, '#f0f0ec', 2);
      stain(g, wx - 2, wy + wh + 2, ww + 4, fl * 0.35, 0.09);
      if (balcCols[b]) {
        const bx = x0 + bay * 0.06;
        const bw = bay * 0.88;
        const by = y0 + fl * 0.5;
        if (rng.next() < 0.55) {
          g.fillStyle = 'rgba(112,150,172,0.62)';
          g.fillRect(bx, y0 + fl * 0.08, bw, fl * 0.92);
          g.strokeStyle = '#e6e8e8';
          g.lineWidth = Math.max(1.5, P * 0.06);
          g.strokeRect(bx, y0 + fl * 0.08, bw, fl * 0.92);
          for (let i = 1; i < 4; i++) {
            g.beginPath();
            g.moveTo(bx + (bw * i) / 4, y0 + fl * 0.08);
            g.lineTo(bx + (bw * i) / 4, y0 + fl);
            g.stroke();
          }
        } else {
          g.fillStyle = hsl(35, 6, 62, 1);
          g.fillRect(bx, by, bw, fl * 0.38);
          g.fillStyle = 'rgba(0,0,0,0.12)';
          for (let i = 1; i < 4; i++) g.fillRect(bx, by + (fl * 0.38 * i) / 4, bw, 1);
        }
        g.fillStyle = hsl(40, 6, 88, 1);
        g.fillRect(bx - 2, y0 + fl - fl * 0.07, bw + 4, fl * 0.07);
        if (rng.next() < 0.18) {
          g.fillStyle = pick(rng, ['#c0392b', '#2e6fb0', '#e0c040', '#ffffff']);
          g.fillRect(bx + rng.next() * bw * 0.6, by - fl * 0.12, bw * 0.25, fl * 0.12);
        }
      } else if (rng.next() < 0.12) {
        g.fillStyle = '#f3f3f0';
        g.fillRect(wx + ww + 3, wy + wh * 0.5, P * 0.35, P * 0.25);
      }
    }
  }
  g.strokeStyle = 'rgba(70,66,60,0.45)';
  g.lineWidth = Math.max(1, P * 0.035);
  for (let f = 0; f <= 5; f++) {
    g.beginPath();
    g.moveTo(0, H - f * fl);
    g.lineTo(W, H - f * fl);
    g.stroke();
  }
  for (let b = 0; b <= 4; b++) {
    g.beginPath();
    g.moveTo(b * bay, 0);
    g.lineTo(b * bay, H);
    g.stroke();
  }
  grain(g, W, H, 9, rng);
  return { map: toTex(c, aniso), emissive: toTex(ce, aniso) };
}

function brickFacade(P: number, aniso: number, seed: number): TexPair {
  const rng = new Rng(seed);
  const W = 12 * P;
  const H = 12 * P;
  const fl = 3 * P;
  const bay = 3 * P;
  const { c, g } = mk(W, H);
  const { c: ce, g: ge } = mk(W, H);
  g.fillStyle = '#7d7a76';
  g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  const ch = Math.max(2, Math.round(P * 0.075));
  const bl = ch * 4;
  for (let row = 0, y = 0; y < H; row++, y += ch) {
    const off = row % 2 ? bl / 2 : 0;
    for (let x = -off; x < W; x += bl) {
      g.fillStyle = hsl(14 + rng.next() * 8, 38 + rng.next() * 14, 38 + rng.next() * 14);
      g.fillRect(x, y, bl - 1, ch - 1);
    }
  }
  for (let f = 0; f < 4; f++) {
    const y0 = H - (f + 1) * fl;
    for (let b = 0; b < 4; b++) {
      const ww = bay * 0.42;
      const wh = fl * 0.56;
      const wx = b * bay + (bay - ww) / 2;
      const wy = y0 + fl * 0.2;
      g.fillStyle = '#d8cdb6';
      g.fillRect(wx - P * 0.1, wy - P * 0.2, ww + P * 0.2, P * 0.16);
      g.fillRect(wx - P * 0.1, wy + wh + P * 0.04, ww + P * 0.2, P * 0.1);
      paintWindow(g, ge, wx, wy, ww, wh, rng, 0.38, '#f4f1ea', 2);
      stain(g, wx, wy + wh + P * 0.14, ww, fl * 0.3, 0.14);
    }
  }
  g.fillStyle = '#d8cdb6';
  g.fillRect(0, H - P * 0.25, W, P * 0.25);
  g.fillRect(0, H - fl * 2 - P * 0.1, W, P * 0.1);
  grain(g, W, H, 10, rng);
  return { map: toTex(c, aniso), emissive: toTex(ce, aniso) };
}

function modernFacade(P: number, aniso: number, seed: number): TexPair {
  const rng = new Rng(seed);
  const W = 12 * P;
  const H = 12 * P;
  const fl = 3 * P;
  const bay = 3 * P;
  const { c, g } = mk(W, H);
  const { c: ce, g: ge } = mk(W, H);
  g.fillStyle = '#ece8df';
  g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  const accents = ['#b5563b', '#4b5058', '#d2a34a', '#5f8a86', '#a9a39a'];
  const a1 = pick(rng, accents);
  const a2 = pick(rng, accents);
  for (let f = 0; f < 4; f++) {
    const y0 = H - (f + 1) * fl;
    for (let b = 0; b < 4; b++) {
      const x0 = b * bay;
      const r = rng.next();
      if (r < 0.28) {
        g.fillStyle = a1;
        g.fillRect(x0, y0, bay, fl);
      } else if (r < 0.4) {
        g.fillStyle = a2;
        g.fillRect(x0, y0 + fl * 0.62, bay, fl * 0.38);
      }
      const ww = bay * 0.72;
      const wh = fl * 0.66;
      const wx = x0 + (bay - ww) / 2;
      const wy = y0 + fl * 0.14;
      paintWindow(g, ge, wx, wy, ww, wh, rng, 0.42, '#454a50', 2);
      if (rng.next() < 0.4) {
        g.fillStyle = 'rgba(170,205,220,0.45)';
        g.fillRect(x0 + bay * 0.04, y0 + fl * 0.5, bay * 0.92, fl * 0.5);
        g.strokeStyle = '#d8dcdc';
        g.lineWidth = 2;
        g.strokeRect(x0 + bay * 0.04, y0 + fl * 0.5, bay * 0.92, fl * 0.5);
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(0, y0 + fl - P * 0.08, W, P * 0.08);
  }
  grain(g, W, H, 7, rng);
  return { map: toTex(c, aniso), emissive: toTex(ce, aniso) };
}

function glassFacade(P: number, aniso: number, seed: number): TexPair {
  const rng = new Rng(seed);
  const W = 12 * P;
  const H = Math.round(14.4 * P);
  const fl = 3.6 * P;
  const pane = 1.5 * P;
  const { c, g } = mk(W, H);
  const { c: ce, g: ge } = mk(W, H);
  g.fillStyle = '#20303b';
  g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  for (let f = 0; f < 4; f++) {
    const y0 = f * fl;
    const rowLit = rng.next() < 0.36;
    for (let p = 0; p < 8; p++) {
      const x0 = p * pane;
      const k = rng.next() * 0.16 - 0.08;
      const gr = g.createLinearGradient(0, y0, 0, y0 + fl);
      gr.addColorStop(0, hsl(205, 38, 62 + k * 100));
      gr.addColorStop(0.55, hsl(208, 40, 40 + k * 100));
      gr.addColorStop(0.78, hsl(210, 38, 26 + k * 60));
      gr.addColorStop(0.8, hsl(210, 20, 16));
      gr.addColorStop(1, hsl(210, 20, 20));
      g.fillStyle = gr;
      g.fillRect(x0, y0, pane, fl);
      if (rng.next() < 0.14) {
        g.fillStyle = 'rgba(235,240,245,0.55)';
        g.fillRect(x0 + 2, y0 + 2, pane - 4, fl * 0.74);
        g.fillStyle = 'rgba(80,90,100,0.35)';
        for (let yy = y0 + 4; yy < y0 + fl * 0.74; yy += 4) g.fillRect(x0 + 2, yy, pane - 4, 1);
      }
      if (rowLit && rng.next() < 0.85) {
        ge.fillStyle = rng.next() < 0.7 ? 'rgba(210,235,255,0.95)' : 'rgba(255,225,170,0.95)';
        ge.fillRect(x0 + 2, y0 + 3, pane - 4, fl * 0.74);
      }
    }
  }
  g.fillStyle = 'rgba(255,255,255,0.09)';
  for (let i = 0; i < 4; i++) {
    const x = rng.next() * W;
    g.beginPath();
    g.moveTo(x, H);
    g.lineTo(x + P * 1.6, 0);
    g.lineTo(x + P * 3.4, 0);
    g.lineTo(x + P * 1.8, H);
    g.fill();
  }
  g.fillStyle = '#10171c';
  for (let p = 0; p <= 8; p++) g.fillRect(p * pane - 1, 0, 2, H);
  for (let f = 0; f <= 4; f++) g.fillRect(0, f * fl - 1.5, W, 3);
  grain(g, W, H, 6, rng);
  return { map: toTex(c, aniso), emissive: toTex(ce, aniso) };
}

function commercialFacade(P: number, aniso: number, seed: number): TexPair {
  const rng = new Rng(seed);
  const W = 12 * P;
  const H = 8 * P;
  const fl = 4 * P;
  const { c, g } = mk(W, H);
  const { c: ce, g: ge } = mk(W, H);
  g.fillStyle = '#d9dad8';
  g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  for (let f = 0; f < 2; f++) {
    const y0 = H - (f + 1) * fl;
    g.fillStyle = '#9aa3a8';
    g.fillRect(0, y0, W, P * 0.35);
    const ry = y0 + fl * 0.3;
    const rh = fl * 0.42;
    const rowLit = rng.next() < 0.4;
    for (let p = 0; p < 6; p++) {
      const x0 = p * 2 * P;
      const gr = g.createLinearGradient(0, ry, 0, ry + rh);
      gr.addColorStop(0, '#8aa2b4');
      gr.addColorStop(1, '#3b4b58');
      g.fillStyle = gr;
      g.fillRect(x0 + 2, ry, 2 * P - 4, rh);
      if (rowLit && rng.next() < 0.8) {
        ge.fillStyle = litColor(rng);
        ge.fillRect(x0 + 2, ry, 2 * P - 4, rh);
      }
    }
    g.fillStyle = '#454b50';
    for (let p = 0; p <= 6; p++) g.fillRect(p * 2 * P - 1.5, ry - 2, 3, rh + 4);
    g.fillRect(0, ry - 2, W, 3);
    g.fillRect(0, ry + rh, W, 3);
  }
  grain(g, W, H, 8, rng);
  return { map: toTex(c, aniso), emissive: toTex(ce, aniso) };
}

function warehouseFacade(P: number, aniso: number, seed: number): TexPair {
  const rng = new Rng(seed);
  const W = 12 * P;
  const H = 8 * P;
  const { c, g } = mk(W, H);
  const { c: ce, g: ge } = mk(W, H);
  const rib = Math.max(3, Math.round(P * 0.2));
  for (let x = 0; x < W; x += rib) {
    g.fillStyle = (x / rib) % 2 ? '#c9ccce' : '#b5b9bc';
    g.fillRect(x, 0, rib, H);
  }
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  g.fillStyle = '#585b5e';
  g.fillRect(0, H - P * 1.1, W, P * 1.1);
  const wy = P * 1.5;
  g.fillStyle = '#e4e6e6';
  g.fillRect(0, wy - 3, W, P * 0.85 + 6);
  for (let p = 0; p < 12; p++) {
    g.fillStyle = '#4c5c68';
    g.fillRect(p * P + 3, wy, P - 6, P * 0.85);
    if (rng.next() < 0.3) {
      ge.fillStyle = 'rgba(210,235,255,0.8)';
      ge.fillRect(p * P + 3, wy, P - 6, P * 0.85);
    }
  }
  stain(g, 0, H - P * 3, W, P * 2, 0.18);
  grain(g, W, H, 10, rng);
  return { map: toTex(c, aniso), emissive: toTex(ce, aniso) };
}

const FASCIA = ['#c8352b', '#1f5fa8', '#e2a31c', '#2b8a4e', '#6a3a8c', '#222a33', '#e07a1f', '#1c8a96'];
const AWNING = ['#c8352b', '#1f5fa8', '#2b8a4e', '#e2a31c', '#f0f0f0'];

function shopFacade(P: number, aniso: number, seed: number): TexPair {
  const rng = new Rng(seed);
  const W = 12 * P;
  const H = Math.round(4.2 * P);
  const { c, g } = mk(W, H);
  const { c: ce, g: ge } = mk(W, H);
  g.fillStyle = '#b8b5ae';
  g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  const units = 3;
  const uw = W / units;
  for (let u = 0; u < units; u++) {
    const x0 = u * uw;
    const glassY = H - P * 3.1;
    const glassH = P * 2.55;
    const fas = pick(rng, FASCIA);
    g.fillStyle = fas;
    g.fillRect(x0 + 2, 0, uw - 4, P * 0.95);
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.fillRect(x0 + 2, 0, uw - 4, P * 0.12);
    ge.fillStyle = fas;
    ge.globalAlpha = 0.55;
    ge.fillRect(x0 + 2, P * 0.1, uw - 4, P * 0.75);
    ge.globalAlpha = 1;
    const gr = g.createLinearGradient(0, glassY, 0, glassY + glassH);
    gr.addColorStop(0, '#6c8396');
    gr.addColorStop(1, '#2c3b47');
    g.fillStyle = gr;
    g.fillRect(x0 + P * 0.2, glassY, uw - P * 0.4, glassH);
    const lit = rng.next() < 0.85;
    if (lit) {
      const warm = rng.next() < 0.6;
      ge.fillStyle = warm ? 'rgba(255,214,160,0.95)' : 'rgba(225,240,255,0.95)';
      ge.fillRect(x0 + P * 0.2, glassY, uw - P * 0.4, glassH);
    }
    const shelves = 2 + Math.floor(rng.next() * 3);
    for (let i = 0; i < shelves; i++) {
      const sx = x0 + P * 0.4 + rng.next() * (uw - P * 1.2);
      const col = pick(rng, ['#c0392b', '#e0c040', '#2e6fb0', '#e8e8e0', '#3a8a4a']);
      g.fillStyle = col;
      g.fillRect(sx, glassY + glassH * 0.45, P * 0.5, glassH * 0.55);
      if (lit) {
        ge.fillStyle = col;
        ge.globalAlpha = 0.5;
        ge.fillRect(sx, glassY + glassH * 0.45, P * 0.5, glassH * 0.55);
        ge.globalAlpha = 1;
      }
    }
    g.fillStyle = '#d4d6d6';
    const dw = P * 1.0;
    const dx = x0 + uw - dw - P * 0.5;
    g.fillRect(dx - 2, glassY, dw + 4, glassH);
    g.fillStyle = '#25323c';
    g.fillRect(dx, glassY + 2, dw, glassH - 2);
    g.fillStyle = '#d4d6d6';
    for (let m = 1; m < 4; m++) g.fillRect(x0 + P * 0.2 + ((dx - x0 - P * 0.2) * m) / 4 - 1, glassY, 2, glassH);
    if (rng.next() < 0.5) {
      const aw = pick(rng, AWNING);
      g.fillStyle = aw;
      g.fillRect(x0 + P * 0.1, P * 0.95, uw - P * 0.2, P * 0.42);
      g.fillStyle = 'rgba(255,255,255,0.6)';
      for (let s = 0; s < uw; s += P * 0.5) g.fillRect(x0 + P * 0.1 + s, P * 0.95, P * 0.25, P * 0.42);
    }
    g.fillStyle = '#4b4a47';
    g.fillRect(x0, H - P * 0.4, uw, P * 0.4);
  }
  g.fillStyle = '#35383b';
  for (let u = 0; u <= units; u++) g.fillRect(u * uw - 2, 0, 4, H);
  grain(g, W, H, 8, rng);
  return { map: toTex(c, aniso), emissive: toTex(ce, aniso) };
}

function lobbyFacade(P: number, aniso: number, seed: number): TexPair {
  const rng = new Rng(seed);
  const W = 12 * P;
  const H = Math.round(4.2 * P);
  const { c, g } = mk(W, H);
  const { c: ce, g: ge } = mk(W, H);
  g.fillStyle = '#6d6b69';
  g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  g.fillStyle = '#85827d';
  for (let y = 0; y < H; y += P * 0.5) g.fillRect(0, y, W, 1);
  for (let b = 0; b < 4; b++) {
    const x0 = b * 3 * P;
    if (b % 2 === 0) {
      const dw = P * 1.5;
      const dx = x0 + (3 * P - dw) / 2;
      g.fillStyle = '#2a2d31';
      g.fillRect(dx - P * 0.25, 0, dw + P * 0.5, P * 0.4);
      g.fillStyle = '#c9c7c2';
      g.fillRect(dx - P * 0.15, P * 0.4, dw + P * 0.3, H - P * 0.4);
      const gr = g.createLinearGradient(0, P * 0.5, 0, H);
      gr.addColorStop(0, '#77909f');
      gr.addColorStop(1, '#2b3945');
      g.fillStyle = gr;
      g.fillRect(dx, P * 0.55, dw, H - P * 0.55);
      g.fillStyle = '#c9c7c2';
      g.fillRect(dx + dw / 2 - 1.5, P * 0.55, 3, H - P * 0.55);
      ge.fillStyle = 'rgba(255,225,175,0.75)';
      ge.fillRect(dx, P * 0.6, dw, H - P * 0.75);
      ge.fillStyle = 'rgba(255,240,210,1)';
      ge.fillRect(dx + dw * 0.2, P * 0.15, dw * 0.6, P * 0.12);
    } else {
      const ww = P * 1.1;
      const wx = x0 + (3 * P - ww) / 2;
      paintWindow(g, ge, wx, H - P * 3, ww, P * 1.2, rng, 0.45, '#e8e8e4', 2);
    }
  }
  grain(g, W, H, 12, rng);
  return { map: toTex(c, aniso), emissive: toTex(ce, aniso) };
}

/* ---------- ground ---------- */

function pavement(aniso: number): THREE.Texture {
  const rng = new Rng(77);
  const S = 256;
  const { c, g } = mk(S, S);
  const n = 10;
  const p = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const l = 52 + rng.next() * 12;
      g.fillStyle = hsl(30, 4, l);
      g.fillRect(x * p, y * p, p, p);
    }
  }
  g.fillStyle = 'rgba(20,20,20,0.55)';
  for (let i = 0; i <= n; i++) {
    g.fillRect(i * p - 1, 0, 2, S);
    g.fillRect(0, i * p - 1, S, 2);
  }
  grain(g, S, S, 14, rng);
  return toTex(c, aniso);
}

function lawn(aniso: number): THREE.Texture {
  const rng = new Rng(88);
  const S = 256;
  const { c, g } = mk(S, S);
  g.fillStyle = hsl(95, 38, 27);
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const r = 30 + rng.next() * 60;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        const col = rng.next() < 0.5 ? '70,110,35' : '120,130,45';
        gr.addColorStop(0, `rgba(${col},0.22)`);
        gr.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = gr;
        g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = hsl(80 + rng.next() * 35, 40 + rng.next() * 20, 20 + rng.next() * 22, 0.7);
    g.fillRect(rng.next() * S, rng.next() * S, 1, 2 + rng.next() * 2);
  }
  return toTex(c, aniso);
}

function yardAsphalt(aniso: number): THREE.Texture {
  const rng = new Rng(99);
  const S = 256;
  const { c, g } = mk(S, S);
  g.fillStyle = hsl(220, 4, 24);
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 14; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const r = 25 + rng.next() * 50;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${rng.next() < 0.5 ? '0,0,0' : '90,90,90'},0.12)`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  grain(g, S, S, 40, rng);
  g.strokeStyle = 'rgba(15,15,15,0.5)';
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    let x = rng.next() * S;
    let y = rng.next() * S;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rng.next() - 0.5) * 36;
      y += (rng.next() - 0.5) * 36;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return toTex(c, aniso);
}

/* ---------- foliage atlas: 3×2 cells of 256 px ---------- */

export const FOLIAGE_CELL = { broad: [0, 0], conifer: [1, 0], bush: [2, 0], bark: [0, 1], bars: [1, 1], hedge: [2, 1] } as const;
export type FoliageCell = keyof typeof FOLIAGE_CELL;

/** UV rectangle [u0, v0, u1, v1] of an atlas cell, inset to keep mip bleeding out. */
export function foliageUv(cell: FoliageCell): [number, number, number, number] {
  const [cx, cy] = FOLIAGE_CELL[cell];
  const inset = 0.006;
  const u0 = cx / 3;
  const v0 = 1 - (cy + 1) / 2;
  return [u0 + inset / 3, v0 + inset / 2, u0 + 1 / 3 - inset / 3, v0 + 0.5 - inset / 2];
}

function leafBlob(g: Ctx, ox: number, oy: number, rng: Rng, hue: number, leaves: number, size: number, flat: number): void {
  const S = 256;
  const cx = ox + S / 2;
  const cy = oy + S / 2;
  const R = S * 0.46;
  g.save();
  g.beginPath();
  g.rect(ox, oy, S, S);
  g.clip();
  g.fillStyle = hsl(hue, 40, 13);
  g.beginPath();
  g.ellipse(cx, cy, R * 0.8, R * 0.8 * flat, 0, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < leaves; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = Math.sqrt(rng.next()) * R;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * flat;
    const up = 1 - (y - oy) / S;
    const l = 14 + up * 26 + rng.next() * 9;
    g.fillStyle = hsl(hue + (rng.next() - 0.5) * 26, 36 + rng.next() * 22, l);
    g.save();
    g.translate(x, y);
    g.rotate(rng.next() * Math.PI);
    g.beginPath();
    g.ellipse(0, 0, size, size * 0.55, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = 25 + rng.next() * R * 0.6;
    g.beginPath();
    g.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r * flat, 5 + rng.next() * 8, 4 + rng.next() * 7, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function foliageAtlas(aniso: number): THREE.Texture {
  const rng = new Rng(1234);
  const S = 256;
  const { c, g } = mk(S * 3, S * 2);
  leafBlob(g, 0, 0, rng, 98, 900, 11, 1);
  leafBlob(g, S * 2, 0, rng, 92, 700, 7, 0.78);

  // conifer spray: triangular silhouette of drooping needle bunches
  const ox = S;
  g.fillStyle = hsl(140, 36, 11);
  g.beginPath();
  g.moveTo(ox + S / 2, 6);
  g.lineTo(ox + S * 0.9, S - 8);
  g.lineTo(ox + S * 0.1, S - 8);
  g.fill();
  g.lineCap = 'round';
  for (let i = 0; i < 420; i++) {
    const y = 8 + Math.pow(rng.next(), 0.8) * (S - 20);
    const half = (y / S) * S * 0.44;
    const side = rng.next() < 0.5 ? -1 : 1;
    const x = ox + S / 2 + side * rng.next() * half;
    g.strokeStyle = hsl(135 + rng.next() * 20, 34 + rng.next() * 12, 12 + (1 - y / S) * 8 + rng.next() * 10);
    g.lineWidth = 3 + rng.next() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + side * (6 + rng.next() * 10), y + 7 + rng.next() * 9);
    g.stroke();
  }

  // bark
  g.fillStyle = '#4d4338';
  g.fillRect(0, S, S, S);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = hsl(28 + rng.next() * 8, 14 + rng.next() * 8, 14 + rng.next() * 18, 0.8);
    g.fillRect(rng.next() * S, S + rng.next() * S, 2 + rng.next() * 3, 10 + rng.next() * 40);
  }

  // fence bars (transparent between)
  g.fillStyle = '#243b2c';
  for (let i = 0; i < 16; i++) g.fillRect(S + i * 16 + 5, S, 6, S);
  g.fillRect(S, S + 8, S, 10);
  g.fillRect(S, S + S - 18, S, 10);

  // clipped hedge
  g.fillStyle = hsl(105, 34, 16);
  g.fillRect(S * 2, S, S, S);
  for (let i = 0; i < 1400; i++) {
    const y = S + rng.next() * S;
    g.fillStyle = hsl(95 + rng.next() * 25, 34 + rng.next() * 20, 14 + (1 - (y - S) / S) * 14 + rng.next() * 9);
    g.beginPath();
    g.ellipse(S * 2 + rng.next() * S, y, 6 + rng.next() * 4, 3.5 + rng.next() * 2, rng.next() * 3, 0, Math.PI * 2);
    g.fill();
  }

  const t = toTex(c, aniso, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/* ---------- ads, signs, gantry panels ---------- */

const FONT = "'Oswald', 'Arial Narrow', Impact, 'Arial Black', sans-serif";

function fitText(g: Ctx, text: string, maxW: number, size: number, weight = 'bold'): number {
  g.font = `${weight} ${size}px ${FONT}`;
  const w = g.measureText(text).width;
  const s = w > maxW ? (size * maxW) / w : size;
  g.font = `${weight} ${s}px ${FONT}`;
  return s;
}

interface AdDef {
  a: string;
  b: string;
  title: string;
  sub: string;
  fg: string;
  accent: string;
}

const ADS: AdDef[] = [
  { a: '#0d3b78', b: '#2f86d6', title: 'НОВЫЙ БЕРЕГ', sub: 'Квартиры от 6,4 млн ₽', fg: '#ffffff', accent: '#ffb020' },
  { a: '#3a2216', b: '#8a5a38', title: 'КОФЕЙНЯ «ЗЕРНО»', sub: 'Первый кофе — в подарок', fg: '#fff3e0', accent: '#f2c46d' },
  { a: '#5b0f14', b: '#c8242c', title: 'АВТОСАЛОН ГОРИЗОНТ', sub: 'Выгода до 400 000 ₽', fg: '#ffffff', accent: '#ffd23f' },
  { a: '#0b5d55', b: '#18b8a4', title: 'СВЯЗЬ «ВЕТЕР»', sub: 'Безлимит без границ', fg: '#ffffff', accent: '#e6ff4d' },
  { a: '#2f7d2a', b: '#a6cf3a', title: 'ПРОДУКТЫ У ДОМА', sub: 'Свежее каждый день', fg: '#ffffff', accent: '#ffe14d' },
  { a: '#101a3a', b: '#27407a', title: 'БАНК «РУБЕЖ»', sub: 'Вклад 18% годовых', fg: '#ffffff', accent: '#e2b94a' },
  { a: '#0d0d0d', b: '#2b2b2b', title: 'ФИТНЕС АТЛАНТ', sub: 'Первый месяц — 1 ₽', fg: '#ffffff', accent: '#b6ff2a' },
  { a: '#a3131c', b: '#f0a020', title: 'ПИЦЦА «ВЕЛИКАН»', sub: 'Две по цене одной', fg: '#ffffff', accent: '#fff2a0' },
  { a: '#1a1a1a', b: '#3a3a3a', title: 'СТРОЙДВОР', sub: 'Всё для ремонта', fg: '#ffd400', accent: '#ffffff' },
  { a: '#0f5a73', b: '#4ab3cf', title: 'АПТЕКА РЯДОМ', sub: 'Скидки каждый день', fg: '#ffffff', accent: '#ffffff' },
];

export const AD_SLOTS = ADS.length;
const AD_W = 512;
const AD_H = 204;

function adAtlas(aniso: number): THREE.Texture {
  const rng = new Rng(555);
  const { c, g } = mk(1024, 1024);
  g.fillStyle = '#222';
  g.fillRect(0, 0, 1024, 1024);
  ADS.forEach((ad, i) => {
    const x = (i % 2) * AD_W;
    const y = Math.floor(i / 2) * AD_H;
    const gr = g.createLinearGradient(x, y, x + AD_W, y + AD_H);
    gr.addColorStop(0, ad.a);
    gr.addColorStop(1, ad.b);
    g.fillStyle = gr;
    g.fillRect(x, y, AD_W, AD_H);
    g.save();
    g.beginPath();
    g.rect(x, y, AD_W, AD_H);
    g.clip();
    g.globalAlpha = 0.18;
    g.fillStyle = ad.accent;
    const deco = i % 3;
    if (deco === 0) {
      for (let k = 0; k < 6; k++) g.fillRect(x + AD_W - 30 - k * 46, y + AD_H - 30 - (k % 3) * 40 - k * 6, 30, 200);
    } else if (deco === 1) {
      g.beginPath();
      g.arc(x + AD_W * 0.86, y + AD_H * 0.35, AD_H * 0.62, 0, Math.PI * 2);
      g.fill();
    } else {
      g.beginPath();
      g.moveTo(x + AD_W * 0.6, y);
      g.lineTo(x + AD_W, y);
      g.lineTo(x + AD_W, y + AD_H);
      g.lineTo(x + AD_W * 0.35, y + AD_H);
      g.fill();
    }
    g.restore();
    g.fillStyle = ad.accent;
    g.fillRect(x, y + AD_H - 12, AD_W, 12);
    g.textBaseline = 'middle';
    g.fillStyle = ad.fg;
    const s = fitText(g, ad.title, AD_W - 50, 62);
    g.fillText(ad.title, x + 26, y + AD_H * 0.34, AD_W - 50);
    g.fillStyle = ad.accent;
    fitText(g, ad.sub, AD_W - 50, 36, '600');
    g.fillText(ad.sub, x + 26, y + AD_H * 0.34 + s * 0.85 + 8, AD_W - 50);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let k = 0; k < 30; k++) g.fillRect(x + rng.next() * AD_W, y + rng.next() * AD_H, 2, 2);
  });
  return toTex(c, aniso, false);
}

/** UV rect of an ad slot. */
export function adUv(slot: number): [number, number, number, number] {
  const x = (slot % 2) * AD_W;
  const y = Math.floor(slot / 2) * AD_H;
  return [x / 1024 + 0.002, 1 - (y + AD_H) / 1024 + 0.002, (x + AD_W) / 1024 - 0.002, 1 - y / 1024 - 0.002];
}

interface StripDef {
  text: string;
  bg: string;
  fg: string;
  accent: string;
}

const STRIPS: StripDef[] = [
  { text: 'ТРЦ «ПАРУС»', bg: '#f3f3f0', fg: '#d02a2a', accent: '#d02a2a' },
  { text: 'ТРЦ «МЕРИДИАН»', bg: '#14233f', fg: '#ffffff', accent: '#f2b632' },
  { text: 'ГИПЕРМАРКЕТ ЭКОНОМ', bg: '#e8c21c', fg: '#1b1b1b', accent: '#c12a2a' },
  { text: 'АВТОМОЙКА 24 ЧАСА', bg: '#1d6fc2', fg: '#ffffff', accent: '#ffffff' },
  { text: 'АЗС «МАГИСТРАЛЬ»', bg: '#1e7a3c', fg: '#ffffff', accent: '#ffd100' },
  { text: 'СТРОЙДВОР ГИПЕРМАРКЕТ', bg: '#222222', fg: '#ffd400', accent: '#ffd400' },
  { text: 'БИЗНЕС-ЦЕНТР «ВЕКТОР»', bg: '#cfd8e0', fg: '#12304e', accent: '#12304e' },
  { text: 'МЕБЕЛЬ ДОМ · КУХНИ', bg: '#7a2d1e', fg: '#fff1dc', accent: '#f2b632' },
];
export const STRIP_SLOTS = STRIPS.length;

function signAtlas(aniso: number): THREE.Texture {
  const { c, g } = mk(1024, 1024);
  g.textBaseline = 'middle';
  STRIPS.forEach((st, i) => {
    const y = i * 128;
    g.fillStyle = st.bg;
    g.fillRect(0, y, 1024, 128);
    g.fillStyle = st.accent;
    g.fillRect(0, y, 1024, 8);
    g.fillRect(0, y + 120, 1024, 8);
    g.fillStyle = st.fg;
    fitText(g, st.text, 940, 84);
    g.textAlign = 'center';
    g.fillText(st.text, 512, y + 66, 940);
    g.textAlign = 'start';
  });
  return toTex(c, aniso, false);
}

export function stripUv(slot: number): [number, number, number, number] {
  return [0.002, 1 - (slot + 1) / 8 + 0.002, 0.998, 1 - slot / 8 - 0.002];
}

function arrowShape(g: Ctx, x: number, y: number, size: number, dir: 'up' | 'right' | 'upleft' | 'upright'): void {
  g.save();
  g.translate(x, y);
  g.rotate({ up: 0, right: Math.PI / 2, upleft: -Math.PI / 4, upright: Math.PI / 4 }[dir]);
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(0, -size);
  g.lineTo(size * 0.55, -size * 0.25);
  g.lineTo(size * 0.2, -size * 0.25);
  g.lineTo(size * 0.2, size);
  g.lineTo(-size * 0.2, size);
  g.lineTo(-size * 0.2, -size * 0.25);
  g.lineTo(-size * 0.55, -size * 0.25);
  g.fill();
  g.restore();
}

interface GantryRow {
  text: string;
  km: string;
  dir: 'up' | 'right' | 'upleft' | 'upright';
}

const GANTRY_PANELS: { rows: GantryRow[]; route: string }[] = [
  { route: 'А-104', rows: [{ text: 'Центр', km: '12 км', dir: 'up' }, { text: 'Новосельск', km: '28 км', dir: 'upright' }] },
  { route: 'А-104', rows: [{ text: 'Аэропорт', km: '34 км', dir: 'up' }, { text: 'Заречье', km: '9 км', dir: 'upleft' }] },
  { route: 'М-9', rows: [{ text: 'Речной вокзал', km: '6 км', dir: 'right' }, { text: 'Северный мост', km: '14 км', dir: 'up' }] },
  { route: 'А-104', rows: [{ text: 'Ленточный пр-т', km: '3 км', dir: 'upright' }, { text: 'Южный порт', km: '41 км', dir: 'up' }] },
];

function gantryAtlas(aniso: number): THREE.Texture {
  const { c, g } = mk(1024, 512);
  g.textBaseline = 'middle';
  GANTRY_PANELS.forEach((p, i) => {
    const x = (i % 2) * 512;
    const y = Math.floor(i / 2) * 256;
    g.fillStyle = '#0a4fa6';
    g.fillRect(x, y, 512, 256);
    g.strokeStyle = '#fff';
    g.lineWidth = 6;
    g.strokeRect(x + 7, y + 7, 498, 242);
    g.fillStyle = '#fff';
    g.fillRect(x + 20, y + 20, 92, 40);
    g.fillStyle = '#0a4fa6';
    g.font = `bold 28px ${FONT}`;
    g.fillText(p.route, x + 28, y + 41);
    p.rows.forEach((r, k) => {
      const ry = y + 100 + k * 76;
      arrowShape(g, x + 58, ry, 24, r.dir);
      g.fillStyle = '#fff';
      fitText(g, r.text, 280, 52);
      g.fillText(r.text, x + 110, ry, 280);
      g.font = `600 40px ${FONT}`;
      g.fillText(r.km, x + 405, ry, 90);
    });
  });
  return toTex(c, aniso, false);
}

export function gantryUv(slot: number): [number, number, number, number] {
  const x = (slot % 2) * 0.5;
  const y = Math.floor(slot / 2) * 0.5;
  return [x + 0.004, 1 - y - 0.5 + 0.004, x + 0.5 - 0.004, 1 - y - 0.004];
}
export const GANTRY_SLOTS = GANTRY_PANELS.length;

export interface CityTextures {
  facade: Record<FacadeKind, TexPair>;
  pavement: THREE.Texture;
  lawn: THREE.Texture;
  yard: THREE.Texture;
  foliage: THREE.Texture;
  ads: THREE.Texture;
  signs: THREE.Texture;
  gantry: THREE.Texture;
}

export function createCityTextures(aniso: number, mobile: boolean): CityTextures {
  const P = mobile ? 28 : 40;
  return {
    facade: {
      panel: panelFacade(P, aniso, 11),
      brick: brickFacade(P, aniso, 23),
      modern: modernFacade(P, aniso, 37),
      glass: glassFacade(P, aniso, 41),
      commercial: commercialFacade(P, aniso, 53),
      warehouse: warehouseFacade(P, aniso, 61),
      shop: shopFacade(P, aniso, 71),
      lobby: lobbyFacade(P, aniso, 83),
    },
    pavement: pavement(aniso),
    lawn: lawn(aniso),
    yard: yardAsphalt(aniso),
    foliage: foliageAtlas(aniso),
    ads: adAtlas(aniso),
    signs: signAtlas(aniso),
    gantry: gantryAtlas(aniso),
  };
}
