import { Rng } from '../../core/math';
import { Bucket, type RGB, type V3 } from './Geo';
import { foliageUv } from './CityTextures';

export type TreeKind = 'linden' | 'poplar' | 'spruce' | 'bush';

const BROAD = foliageUv('broad');
const CONIFER = foliageUv('conifer');
const BUSH = foliageUv('bush');
const BARK = foliageUv('bark');
const BARK_UV: [number, number] = [(BARK[0] + BARK[2]) / 2, (BARK[1] + BARK[3]) / 2];

const clampC = (c: number): number => Math.max(0, Math.min(2, c));

function shade(base: RGB, k: number): RGB {
  return [clampC(base[0] * k), clampC(base[1] * k), clampC(base[2] * k)];
}

/** Tree tint: mostly healthy greens, a few yellowing crowns. */
export function treeTint(rng: Rng): RGB {
  const k = 0.8 + rng.next() * 0.4;
  if (rng.next() < 0.07) return [1.5 * k, 1.1 * k, 0.45 * k];
  const warm = rng.next() * 0.25;
  return [(0.95 + warm) * k, k * 1.02, 0.9 * k];
}

function trunk(b: Bucket, x: number, y0: number, z: number, r0: number, r1: number, h: number, c: RGB): void {
  const sides = 5;
  const base = b.count;
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    b.vert(x + cs * r0, y0, z + sn * r0, cs, 0, sn, BARK_UV[0], BARK_UV[1], c);
    b.vert(x + cs * r1, y0 + h, z + sn * r1, cs, 0, sn, BARK_UV[0], BARK_UV[1], c);
  }
  for (let i = 0; i < sides; i++) {
    const a = base + i * 2;
    b.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

/** Foliage card: vertex normals point away from `centre` so the crown shades like a volume. */
function card(
  b: Bucket,
  uv: readonly [number, number, number, number],
  cx: number,
  cy: number,
  cz: number,
  hw: number,
  hh: number,
  yaw: number,
  pitch: number,
  centre: V3,
  c: RGB,
): void {
  const rx = Math.cos(yaw);
  const rz = Math.sin(yaw);
  const fx = -Math.sin(yaw) * Math.sin(pitch);
  const fz = Math.cos(yaw) * Math.sin(pitch);
  const uy = Math.cos(pitch);
  const corners: [number, number, number, number, number][] = [
    [-1, -1, uv[0], uv[1], 0],
    [1, -1, uv[2], uv[1], 0],
    [1, 1, uv[2], uv[3], 0],
    [-1, 1, uv[0], uv[3], 0],
  ];
  const base = b.count;
  for (const [sx, sy, u, v] of corners) {
    const px = cx + rx * hw * sx + fx * hh * sy;
    const py = cy + uy * hh * sy;
    const pz = cz + rz * hw * sx + fz * hh * sy;
    let nx = px - centre[0];
    let ny = py - centre[1] + hh * 0.3;
    let nz = pz - centre[2];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const dark = sy < 0 ? 0.88 : 1;
    b.vert(px, py, pz, nx, ny, nz, u, v, [c[0] * dark, c[1] * dark, c[2] * dark]);
  }
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Adds one tree to a foliage bucket; (x, y, z) is the trunk base in chunk space. */
export function addTree(b: Bucket, kind: TreeKind, x: number, y: number, z: number, scale: number, rng: Rng, tint: RGB, rich: boolean): void {
  const bark: RGB = [0.9, 0.9, 0.9];
  if (kind === 'linden') {
    const H = 8 * scale;
    const th = H * 0.5;
    trunk(b, x, y, z, 0.2 * scale, 0.12 * scale, th, bark);
    const cyC = y + H * 0.66;
    const R = H * 0.36;
    const centre: V3 = [x, cyC, z];
    const n = rich ? 9 : 6;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
      const ring = R * Math.sqrt(Math.max(0, 1 - t * t)) * 0.72;
      const a = i * 2.399 + rng.next();
      const px = x + Math.cos(a) * ring;
      const pz = z + Math.sin(a) * ring;
      const py = cyC + t * R * 0.8;
      const size = R * (0.62 + rng.next() * 0.15);
      const c = shade(tint, 0.85 + (t + 1) * 0.1 + rng.next() * 0.08);
      const yaw = rng.next() * Math.PI;
      const pitch = (rng.next() - 0.3) * 0.5;
      card(b, BROAD, px, py, pz, size, size * 0.9, yaw, pitch, centre, c);
      card(b, BROAD, px, py, pz, size, size * 0.9, yaw + Math.PI / 2, pitch, centre, c);
    }
    card(b, BROAD, x, cyC + R * 0.5, z, R * 0.7, R * 0.6, rng.next() * 3, 0.9, centre, shade(tint, 1.1));
  } else if (kind === 'poplar') {
    const H = 14 * scale;
    trunk(b, x, y, z, 0.24 * scale, 0.12 * scale, H * 0.35, bark);
    const n = rich ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const py = y + H * (0.2 + t * 0.72);
      const hw = H * (0.115 - t * 0.05);
      const a = rng.next() * Math.PI * 2;
      const px = x + Math.cos(a) * hw * 0.25;
      const pz = z + Math.sin(a) * hw * 0.25;
      const c = shade(tint, 0.82 + t * 0.2 + rng.next() * 0.06);
      const yaw = rng.next() * Math.PI;
      const centre: V3 = [x, py - hw * 0.3, z];
      card(b, BROAD, px, py, pz, hw, hw * 1.45, yaw, 0, centre, c);
      card(b, BROAD, px, py, pz, hw, hw * 1.45, yaw + Math.PI / 2, 0, centre, c);
    }
  } else if (kind === 'spruce') {
    const H = 9 * scale;
    trunk(b, x, y, z, 0.18 * scale, 0.06 * scale, H * 0.3, bark);
    const centre: V3 = [x, y + H * 0.35, z];
    const planes = rich ? 4 : 3;
    const c = shade(tint, 0.62 + rng.next() * 0.1);
    const yaw0 = rng.next() * Math.PI;
    for (let i = 0; i < planes; i++) {
      card(b, CONIFER, x, y + H * 0.54, z, H * 0.23, H * 0.46, yaw0 + (i * Math.PI) / planes, 0, centre, c);
    }
  } else {
    const H = 1.2 * scale;
    const centre: V3 = [x, y + H * 0.5, z];
    const n = rich ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const a = i * 2.1 + rng.next();
      const px = x + Math.cos(a) * H * 0.4;
      const pz = z + Math.sin(a) * H * 0.4;
      const c = shade(tint, 0.8 + rng.next() * 0.3);
      const yaw = rng.next() * Math.PI;
      card(b, BUSH, px, y + H * 0.55, pz, H * 0.65, H * 0.6, yaw, 0.2, centre, c);
      card(b, BUSH, px, y + H * 0.55, pz, H * 0.65, H * 0.6, yaw + Math.PI / 2, 0.2, centre, c);
    }
  }
}
