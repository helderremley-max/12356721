import { Rng } from '../../core/math';

/**
 * Deterministic city layout. Cross streets cut the roadside every BLOCK metres
 * at s = STREET_AT + k·BLOCK; everything between is generated per (block, side)
 * from a hash, so rebuilding a road chunk always reproduces the same city.
 */
export const BLOCK = 250;
export const STREET_AT = 25;

export type Side = -1 | 1;
export type District = 'resi' | 'biz' | 'comm' | 'mixed';
export type LotKind =
  | 'slab'
  | 'tower'
  | 'brick'
  | 'modern'
  | 'glassTower'
  | 'office'
  | 'mall'
  | 'shops'
  | 'warehouse'
  | 'petrol'
  | 'park'
  | 'parking';

export interface Lot {
  kind: LotKind;
  /** Centre along the road. */
  s: number;
  /** Signed lateral centre. */
  x: number;
  /** Extent along s and across the road. */
  w: number;
  d: number;
  floors: number;
  row: number;
  seed: number;
}

export interface Band {
  near: number;
  far: number;
}

export interface Block {
  k: number;
  side: Side;
  district: District;
  /** Usable s range between the cross streets. */
  s0: number;
  s1: number;
  lots: Lot[];
  /** Unsigned lateral extents of each building row. */
  bands: Band[];
  /** Unsigned lateral start of the first row. */
  frontNear: number;
}

export const blockStart = (k: number): number => STREET_AT + k * BLOCK;
export const blockIndex = (s: number): number => Math.floor((s - STREET_AT) / BLOCK);

export function seedOf(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) {
    h = Math.imul(h ^ (v | 0), 16777619);
    h ^= h >>> 13;
  }
  return (h ^ (h >>> 15)) >>> 0;
}

const MIX: Record<District, [LotKind, number][]> = {
  resi: [['slab', 0.3], ['tower', 0.16], ['modern', 0.22], ['brick', 0.14], ['shops', 0.1], ['park', 0.08]],
  biz: [['glassTower', 0.34], ['office', 0.24], ['mall', 0.16], ['modern', 0.12], ['shops', 0.08], ['parking', 0.06]],
  comm: [['mall', 0.22], ['shops', 0.24], ['warehouse', 0.22], ['petrol', 0.1], ['office', 0.12], ['parking', 0.1]],
  mixed: [['slab', 0.18], ['modern', 0.16], ['office', 0.14], ['mall', 0.12], ['shops', 0.14], ['brick', 0.1], ['glassTower', 0.1], ['park', 0.06]],
};

const LOW_KINDS = new Set<LotKind>(['shops', 'warehouse', 'park', 'parking', 'mall', 'petrol']);

function pickKind(rng: Rng, district: District, row: number): LotKind {
  let r = rng.next();
  let kind: LotKind = 'slab';
  for (const [k, p] of MIX[district]) {
    kind = k;
    r -= p;
    if (r < 0) break;
  }
  if (row >= 1 && kind === 'petrol') kind = 'office';
  if (row >= 2 && LOW_KINDS.has(kind)) kind = district === 'resi' ? 'tower' : district === 'comm' ? 'office' : 'glassTower';
  return kind;
}

interface Dims {
  w: number;
  d: number;
  floors: number;
}

function dimsFor(kind: LotKind, row: number, rng: Rng): Dims {
  const tall = 1 + row * 0.12;
  switch (kind) {
    case 'slab': {
      const along = rng.chance(0.55);
      const len = rng.range(52, 90);
      const wid = rng.range(12, 14);
      return { w: along ? len : wid, d: along ? wid : len * 0.8, floors: Math.round(rng.range(9, 12) * tall) };
    }
    case 'tower': {
      const s = rng.range(20, 27);
      return { w: s, d: s * rng.range(0.85, 1.1), floors: Math.round(rng.range(14, 22) * tall) };
    }
    case 'brick':
      return rng.chance(0.5)
        ? { w: rng.range(40, 70), d: rng.range(14, 17), floors: rng.int(5, 9) }
        : { w: rng.range(14, 17), d: rng.range(40, 60), floors: rng.int(5, 9) };
    case 'modern':
      return { w: rng.range(32, 60), d: rng.range(24, 38), floors: Math.round(rng.range(14, 26) * tall) };
    case 'glassTower': {
      const s = rng.range(30, 42);
      return { w: s, d: s * rng.range(0.9, 1.1), floors: Math.round((row === 0 ? rng.range(14, 28) : rng.range(24, 46)) * tall) };
    }
    case 'office':
      return { w: rng.range(40, 70), d: rng.range(24, 34), floors: Math.round(rng.range(7, 14) * tall) };
    case 'mall':
      return { w: rng.range(80, 130), d: rng.range(46, 66), floors: 3 };
    case 'shops':
      return { w: rng.range(26, 56), d: rng.range(14, 24), floors: rng.int(1, 2) };
    case 'warehouse':
      return { w: rng.range(40, 80), d: rng.range(30, 46), floors: 1 };
    case 'petrol':
      return { w: 42, d: 32, floors: 1 };
    case 'park':
      return { w: rng.range(40, 90), d: rng.range(30, 50), floors: 0 };
    default:
      return { w: rng.range(40, 70), d: rng.range(26, 40), floors: 0 };
  }
}

const MIN_W: Partial<Record<LotKind, number>> = { mall: 70, warehouse: 36, petrol: 42, slab: 12, glassTower: 28 };

export class CityPlan {
  private cache = new Map<number, Block>();
  private overpassSet = new Set<number>();
  private overpassNext = 2;
  private overpassRng = new Rng(98765);

  /** Spacing of 3–5 blocks keeps overpasses 0.75–1.25 km apart. */
  isOverpass(k: number): boolean {
    if (k < 0) return false;
    while (this.overpassNext <= k) {
      this.overpassSet.add(this.overpassNext);
      this.overpassNext += this.overpassRng.int(3, 5);
    }
    return this.overpassSet.has(k);
  }

  gapHalf(k: number): number {
    return this.isOverpass(k) ? 17 : 9;
  }

  hasFootbridge(k: number): boolean {
    return !this.isOverpass(k) && !this.isOverpass(k + 1) && seedOf(k, 77) % 100 < 34;
  }

  district(k: number, side: Side): District {
    const r = new Rng(seedOf(Math.floor(k / 3), side > 0 ? 1 : 2, 31));
    const shared = new Rng(seedOf(Math.floor(k / 3), 5));
    const v = (r.chance(0.7) ? shared : r).next();
    return v < 0.38 ? 'resi' : v < 0.58 ? 'biz' : v < 0.75 ? 'comm' : 'mixed';
  }

  prune(minK: number): void {
    for (const key of this.cache.keys()) if (key >> 5 < minK) this.cache.delete(key);
  }

  block(k: number, side: Side, rows: number): Block {
    const key = ((k + 64) << 5) | ((side > 0 ? 1 : 0) << 4) | rows;
    let b = this.cache.get(key);
    if (!b) {
      b = this.generate(k, side, rows);
      this.cache.set(key, b);
    }
    return b;
  }

  private generate(k: number, side: Side, rows: number): Block {
    const rng = new Rng(seedOf(k, side, 1234));
    const district = this.district(k, side);
    const s0 = blockStart(k) + this.gapHalf(k);
    const s1 = blockStart(k + 1) - this.gapHalf(k + 1);
    const frontNear = (side > 0 ? 33 : 46) + rng.range(0, 14);
    const lots: Lot[] = [];
    const bands: Band[] = [];
    let near = frontNear;
    for (let row = 0; row < rows; row++) {
      let cursor = s0 + rng.range(2, 10);
      let far = near;
      let guard = 0;
      while (cursor < s1 - 14 && guard++ < 40) {
        let kind = pickKind(rng, district, row);
        let dims = dimsFor(kind, row, rng);
        const room = s1 - cursor;
        if (dims.w > room) {
          const min = MIN_W[kind] ?? 20;
          if (room >= min && room > dims.w * 0.6) dims = { ...dims, w: room };
          else {
            kind = row >= 2 ? 'tower' : 'shops';
            dims = dimsFor(kind, row, rng);
            if (dims.w > room) dims.w = room;
          }
        }
        if (dims.w < 12) break;
        const lotNear = near + (row === 0 ? rng.range(0, 6) : rng.range(0, 10));
        lots.push({
          kind,
          s: cursor + dims.w / 2,
          x: side * (lotNear + dims.d / 2),
          w: dims.w,
          d: dims.d,
          floors: dims.floors,
          row,
          seed: rng.int(0, 1e9),
        });
        far = Math.max(far, lotNear + dims.d);
        cursor += dims.w + rng.range(3, 16);
      }
      bands.push({ near, far });
      near = far + rng.range(14, 30);
    }
    return { k, side, district, s0, s1, lots, bands, frontNear };
  }
}
