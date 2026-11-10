import * as THREE from 'three';
import { Rng } from '../../core/math';
import { SHOULDER_WIDTH } from '../../config';
import type { RoadLayout } from '../../road/RoadLayout';
import { Bucket, mul, rgb, type RGB, type V3, WHITE } from './Geo';
import type { CityMaterials } from './CityMaterials';
import { adUv, AD_SLOTS, FACADE, GANTRY_SLOTS, gantryUv, GROUND_FLOOR_H, stripUv, STRIP_SLOTS, type FacadeKind } from './CityTextures';
import { blockIndex, blockStart, CityPlan, seedOf, type Block, type Lot, type Side } from './CityPlan';
import { cityState, ROWS_BY_DETAIL, TREES_BY_DETAIL } from './CityState';
import { addTree, treeTint, type TreeKind } from './Trees';
import { foliageUv } from './CityTextures';

/** Lateral positions (signed metres) shared with RoadChunkBuilder. */
export const FENCE_R = 16;
export const FENCE_L = -36.2;
/** Outer paved edge (incl. shoulder) of the opposite carriageway. */
export const OPP_OUTER = -27.45;
/** Face of the opposite carriageway's inner barrier towards our road. */
export const OPP_BARRIER = -13.1;

const STEP = 5;
const CURB_OUT = 2;
const SIDEWALK_GAP = 1.2;
const SIDEWALK_W = 3.2;

const C = {
  roof: rgb(0x5a5d60),
  parapet: rgb(0xb8b6b0),
  gear: rgb(0x9a9ca0),
  gearDark: rgb(0x55585c),
  steel: rgb(0x6c7176),
  steelDark: rgb(0x3b3f44),
  white: rgb(0xe8e8e4),
  curb: rgb(0xb4b2ac),
  kerbLine: rgb(0xd8d6cf),
  road: rgb(0x9a9a9a),
  pavement: rgb(0xd0ccc4),
  lawn: rgb(0xffffff),
  concrete: rgb(0xd6d3cc),
  pole: rgb(0x4d5258),
};

const PALETTE: Record<FacadeKind, RGB[]> = {
  panel: [0xffffff, 0xf3e8d0, 0xd7e4ef, 0xf0dbd3, 0xe4ead6, 0xead9a6, 0xcfd8d4].map(rgb),
  brick: [0xffffff, 0xf0cfa8, 0xd9b0a0, 0xc8c0b8, 0xe8c8b0].map(rgb),
  modern: [0xffffff, 0xe8e2d6, 0xd0d6dc, 0xf0e4cc].map(rgb),
  glass: [0xffffff, 0xcfe8e0, 0xe8d8c0, 0xb8c4d4, 0xd6e4f0].map(rgb),
  commercial: [0xffffff, 0xe8f0f8, 0xf4e2c0, 0xd8e8d0, 0xf0d0d0, 0xc8d4e4].map(rgb),
  warehouse: [0xffffff, 0xd8e4f0, 0xe8d8c0, 0xc8d8c8, 0xf0c8c0].map(rgb),
  shop: [WHITE],
  lobby: [WHITE],
};
const CAR_COLORS = [0xe8e8e8, 0xc4c8cc, 0x1c1f23, 0x5a5f66, 0x274a86, 0x8d2323, 0xcbbf9d, 0x2f5b3e].map(rgb);
const ROOF_BOARD = rgb(0xdcdcd8);

type FenceType = 'glass' | 'panel' | 'fence' | 'hedge' | 'wall' | 'none';
const FENCE_TYPES: [FenceType, number][] = [
  ['glass', 0.27],
  ['panel', 0.27],
  ['fence', 0.2],
  ['hedge', 0.14],
  ['wall', 0.08],
  ['none', 0.04],
];

interface SideInfo {
  sign: Side;
  fence: number;
  /** Signed lateral position where the paved road (incl. shoulder) ends. */
  edge(s: number): number;
}

interface Blocked {
  a: number;
  b: number;
}

function pickOf<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng.next() * list.length) % list.length];
}

/** Everything one chunk draws, as one merged mesh per material. */
class Buckets {
  facade = {} as Record<FacadeKind, Bucket>;
  plain: Bucket;
  concrete: Bucket;
  pavement: Bucket;
  lawn: Bucket;
  yard: Bucket;
  foliage: Bucket;
  ads: Bucket;
  signs: Bucket;
  gantry: Bucket;
  glass: Bucket;

  constructor(s0: number) {
    for (const k of Object.keys(FACADE) as FacadeKind[]) this.facade[k] = new Bucket(s0);
    this.plain = new Bucket(s0);
    this.concrete = new Bucket(s0, 3);
    this.pavement = new Bucket(s0, 4);
    this.lawn = new Bucket(s0, 12);
    this.yard = new Bucket(s0, 6);
    this.foliage = new Bucket(s0);
    this.ads = new Bucket(s0);
    this.signs = new Bucket(s0);
    this.gantry = new Bucket(s0);
    this.glass = new Bucket(s0);
  }
}

export class CityChunkBuilder {
  private plan = new CityPlan();
  private lastVersion = -1;
  private right: SideInfo;
  private left: SideInfo;

  private b!: Buckets;
  private s0 = 0;
  private s1 = 0;
  private blocked: Blocked[] = [];
  private rows = 3;
  private treeMul = 1;
  private rich = true;

  constructor(
    private readonly layout: RoadLayout,
    private readonly mats: CityMaterials,
  ) {
    this.right = { sign: 1, fence: FENCE_R, edge: (s) => layout.rightEdge(s) + SHOULDER_WIDTH };
    this.left = { sign: -1, fence: FENCE_L, edge: () => OPP_OUTER };
  }

  /** z in chunk space. */
  private z(s: number): number {
    return this.s0 - s;
  }

  build(index: number, s0: number, s1: number): { meshes: THREE.Mesh[]; geometries: THREE.BufferGeometry[] } {
    if (this.lastVersion !== cityState.version) {
      this.plan = new CityPlan();
      this.lastVersion = cityState.version;
    }
    const detail = cityState.detail;
    this.rows = ROWS_BY_DETAIL[detail];
    this.treeMul = TREES_BY_DETAIL[detail];
    this.rich = detail >= 2;
    this.s0 = s0;
    this.s1 = s1;
    this.b = new Buckets(s0);
    this.plan.prune(blockIndex(s0) - 6);

    this.findBlocked();
    const rng = new Rng(seedOf(index, 4321));
    for (const side of [this.right, this.left]) {
      this.roadside(side);
      this.sidewalk(side);
      this.frontAndCourt(side);
      this.verge(side, rng);
    }
    this.median();
    this.buildings();
    this.crossStreets();
    this.billboards();
    this.gantries();
    this.footbridges();
    return this.finish();
  }

  /* ---------- assembling ---------- */

  private finish(): { meshes: THREE.Mesh[]; geometries: THREE.BufferGeometry[] } {
    const m = this.mats;
    const b = this.b;
    const meshes: THREE.Mesh[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const add = (bucket: Bucket, mat: THREE.Material, cast: boolean, receive: boolean, name: string) => {
      if (bucket.empty) return;
      const geo = bucket.toGeometry(true);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.name = name;
      meshes.push(mesh);
      geometries.push(geo);
    };
    for (const kind of Object.keys(FACADE) as FacadeKind[]) add(b.facade[kind], m.facade[kind], false, false, `city-${kind}`);
    add(b.plain, m.plain, false, false, 'city-plain');
    add(b.concrete, m.concrete, true, true, 'city-concrete');
    add(b.pavement, m.pavement, false, true, 'city-pavement');
    add(b.lawn, m.lawn, false, true, 'city-lawn');
    add(b.yard, m.yard, false, true, 'city-yard');
    add(b.foliage, m.foliage, true, true, 'city-foliage');
    add(b.ads, m.ads, false, false, 'city-ads');
    add(b.signs, m.signs, false, false, 'city-signs');
    add(b.gantry, m.gantry, false, false, 'city-gantry');
    add(b.glass, m.glass, false, false, 'city-glass');
    return { meshes, geometries };
  }

  /* ---------- blocked ranges (overpass footprints) ---------- */

  private findBlocked(): void {
    this.blocked.length = 0;
    const k0 = blockIndex(this.s0 - 30);
    const k1 = blockIndex(this.s1 + 30) + 1;
    for (let k = k0; k <= k1; k++) {
      if (this.plan.isOverpass(k)) {
        const sc = blockStart(k);
        this.blocked.push({ a: sc - 9, b: sc + 9 });
      }
    }
  }

  private isBlocked(s: number): boolean {
    for (const r of this.blocked) if (s >= r.a && s <= r.b) return true;
    return false;
  }

  /** Free sub-intervals of [a, b] outside the blocked ranges. */
  private free(a: number, b: number, fn: (a: number, b: number) => void): void {
    let cur = a;
    for (const r of this.blocked) {
      if (r.b <= cur || r.a >= b) continue;
      if (r.a > cur) fn(cur, r.a);
      cur = Math.max(cur, r.b);
    }
    if (cur < b) fn(cur, b);
  }

  /* ---------- flat strips ---------- */

  /** Horizontal ribbon between two lateral paths. */
  private strip(bucket: Bucket, xa: (s: number) => number, xb: (s: number) => number, sa: number, sb: number, y: number, color: RGB, step = STEP): void {
    const n = Math.max(1, Math.ceil((sb - sa) / step));
    for (let i = 0; i < n; i++) {
      const p = sa + ((sb - sa) * i) / n;
      const q = sa + ((sb - sa) * (i + 1)) / n;
      const zp = this.z(p);
      const zq = this.z(q);
      bucket.quad([xa(p), y, zp], [xb(p), y, zp], [xb(q), y, zq], [xa(q), y, zq], color, undefined, [xa(p), y - 1, zp]);
    }
  }

  private fenceTypeAt(s: number, side: Side): FenceType {
    const k = blockIndex(s);
    let r = new Rng(seedOf(k, side, 999)).next();
    for (const [t, p] of FENCE_TYPES) {
      r -= p;
      if (r < 0) return t;
    }
    return 'glass';
  }

  private roadside(sd: SideInfo): void {
    const sg = sd.sign;
    this.free(this.s0, this.s1, (fa, fb) => {
      const a0 = Math.ceil((fa - this.s0) / STEP - 1e-6);
      const a1 = Math.floor((fb - this.s0) / STEP + 1e-6);
      // verge asphalt (shoulder extension) and kerb
      this.strip(this.b.yard, (s) => sd.edge(s), (s) => sd.edge(s) + sg * CURB_OUT, fa, fb, 0.012, C.road);
      this.kerb(sd, fa, fb);
      this.strip(this.b.lawn, (s) => sd.edge(s) + sg * (CURB_OUT + 0.25), () => sd.fence - sg * 0.5, fa, fb, 0.1, C.lawn);
      for (let i = a0; i < a1; i++) this.fenceSegment(sd, this.s0 + i * STEP, this.s0 + (i + 1) * STEP);
    });
  }

  private kerb(sd: SideInfo, sa: number, sb: number): void {
    const sg = sd.sign;
    const n = Math.max(1, Math.ceil((sb - sa) / STEP));
    for (let i = 0; i < n; i++) {
      const p = sa + ((sb - sa) * i) / n;
      const q = sa + ((sb - sa) * (i + 1)) / n;
      const xp = sd.edge(p) + sg * CURB_OUT;
      const xq = sd.edge(q) + sg * CURB_OUT;
      const zp = this.z(p);
      const zq = this.z(q);
      const c = this.b.concrete;
      const inside: V3 = [xp + sg, 0.05, zp];
      c.quad([xp, 0, zp], [xq, 0, zq], [xq, 0.16, zq], [xp, 0.16, zp], C.curb, undefined, [xp + sg, 0.05, (zp + zq) / 2]);
      c.quad([xp, 0.16, zp], [xq, 0.16, zq], [xq + sg * 0.25, 0.16, zq], [xp + sg * 0.25, 0.16, zp], C.curb, undefined, [inside[0], -1, inside[2]]);
    }
  }

  /** Noise barrier / fence / hedge / retaining wall along the fence line. */
  private fenceSegment(sd: SideInfo, sa: number, sb: number): void {
    const type = this.fenceTypeAt((sa + sb) / 2, sd.sign);
    const x = sd.fence;
    const za = this.z(sa);
    const zb = this.z(sb);
    const zm = (za + zb) / 2;
    const len = sb - sa;
    const b = this.b;
    switch (type) {
      case 'glass': {
        b.plain.box(x, 0, zm, 0.3, 0.5, len, C.curb);
        b.plain.box(x, 0, za, 0.24, 3.9, 0.24, C.steel);
        b.glass.quad([x, 0.5, za], [x, 0.5, zb], [x, 3.8, zb], [x, 3.8, za], WHITE, [0, 0, 1, 0, 1, 1, 0, 1]);
        b.plain.box(x, 3.8, zm, 0.3, 0.12, len, C.steel);
        break;
      }
      case 'panel': {
        const tint = PALETTE.commercial[Math.floor(seedOf(blockIndex(sa), sd.sign, 8) % PALETTE.commercial.length)];
        b.concrete.box(x, 0, zm, 0.35, 3.5, len - 0.1, tint);
        b.concrete.box(x, 0, za, 0.55, 3.7, 0.5, mul(tint, 0.8));
        break;
      }
      case 'fence': {
        const [u0, v0, u1, v1] = foliageUv('bars');
        for (let h = 0; h < 2; h++) {
          const p = za + (zb - za) * (h / 2);
          const q = za + (zb - za) * ((h + 1) / 2);
          b.foliage.quad([x, 0.1, p], [x, 0.1, q], [x, 2.1, q], [x, 2.1, p], WHITE, [u0, v0, u1, v0, u1, v1, u0, v1]);
        }
        b.plain.box(x, 0, za, 0.12, 2.2, 0.12, C.pole);
        b.plain.box(x, 2.05, zm, 0.08, 0.08, len, C.pole);
        break;
      }
      case 'hedge': {
        const [u0, v0, u1, v1] = foliageUv('hedge');
        const hh = 1.6;
        for (const dx of [-0.55, 0.55]) {
          b.foliage.quad([x + dx, 0.05, za], [x + dx, 0.05, zb], [x + dx, hh, zb], [x + dx, hh, za], WHITE, [u0, v0, u1 * 1, v0, u1, v1, u0, v1], [x, hh / 2, zm]);
        }
        b.foliage.quad([x - 0.55, hh, za], [x - 0.55, hh, zb], [x + 0.55, hh, zb], [x + 0.55, hh, za], WHITE, [u0, v0, u1, v0, u1, v1, u0, v1], [x, 0, zm]);
        break;
      }
      case 'wall': {
        b.concrete.box(x, 0, zm, 0.5, 1.15, len, C.concrete);
        b.plain.box(x, 1.15, zm, 0.06, 0.06, len, C.steel);
        b.plain.box(x, 1.15, za, 0.07, 0.9, 0.07, C.steel);
        b.plain.box(x, 2.0, zm, 0.06, 0.06, len, C.steel);
        break;
      }
      default:
        break;
    }
  }

  private sidewalk(sd: SideInfo): void {
    const sg = sd.sign;
    const x0 = sd.fence + sg * SIDEWALK_GAP;
    const x1 = x0 + sg * SIDEWALK_W;
    this.free(this.s0, this.s1, (a, b) => {
      this.strip(this.b.pavement, () => x0, () => x1, a, b, 0.14, C.pavement, b - a);
      // kerb faces
      for (const x of [x0, x1]) {
        const za = this.z(a);
        const zb = this.z(b);
        this.b.concrete.quad([x, 0, za], [x, 0, zb], [x, 0.14, zb], [x, 0.14, za], C.curb, undefined, [x - sg * (x === x0 ? -1 : 1), 0.07, (za + zb) / 2]);
      }
      // ground between fence and sidewalk
      this.strip(this.b.lawn, () => sd.fence - sg * 0.2, () => x0, a, b, 0.1, C.lawn, b - a);
    });
  }

  /** Yards between the sidewalk and the first row, and courtyards between rows. */
  private frontAndCourt(sd: SideInfo): void {
    const sg = sd.sign;
    const k0 = blockIndex(this.s0);
    const k1 = blockIndex(this.s1 - 0.01);
    for (let k = k0; k <= k1; k++) {
      const blk = this.plan.block(k, sd.sign, this.rows);
      const a = Math.max(this.s0, blk.s0);
      const b = Math.min(this.s1, blk.s1);
      if (b <= a) continue;
      const inner = Math.abs(sd.fence) + SIDEWALK_GAP + SIDEWALK_W + 0.1;
      const plaza = blk.district === 'biz' || blk.district === 'comm';
      this.strip(plaza ? this.b.pavement : this.b.lawn, () => sg * inner, () => sg * (blk.frontNear - 1), a, b, 0.05, plaza ? C.pavement : C.lawn, b - a);
      for (let r = 0; r + 1 < blk.bands.length; r++) {
        const n = blk.bands[r].far;
        const f = blk.bands[r + 1].near;
        const asphalt = blk.district === 'comm' || (blk.district === 'mixed' && r === 0);
        this.strip(asphalt ? this.b.yard : this.b.lawn, () => sg * n, () => sg * f, a, b, 0.04, asphalt ? C.road : C.lawn, b - a);
      }
    }
  }

  /** Cross streets between blocks (ground level) with their pavements. */
  private crossStreets(): void {
    const k0 = blockIndex(this.s0 - 20);
    const k1 = blockIndex(this.s1 + 20) + 1;
    for (let k = k0; k <= k1; k++) {
      const sc = blockStart(k);
      if (sc < this.s0 || sc >= this.s1) continue;
      const over = this.plan.isOverpass(k);
      const zc = this.z(sc);
      const reach = 120 + cityState.detail * 40;
      for (const sg of [1, -1] as Side[]) {
        const fence = sg > 0 ? FENCE_R : FENCE_L;
        const near = Math.abs(fence) + SIDEWALK_GAP + SIDEWALK_W;
        const x0 = over ? (sg > 0 ? 84.8 : 100.5) : near;
        const hw = over ? 7.5 : 6;
        const sw = over ? 0 : 3;
        const b = this.b;
        b.yard.quad([sg * x0, 0.03, zc - hw], [sg * (reach + 40), 0.03, zc - hw], [sg * (reach + 40), 0.03, zc + hw], [sg * x0, 0.03, zc + hw], C.road, undefined, [0, -1, zc]);
        if (sw) {
          for (const dz of [-1, 1]) {
            b.pavement.quad([sg * x0, 0.12, zc + dz * hw], [sg * (reach + 40), 0.12, zc + dz * hw], [sg * (reach + 40), 0.12, zc + dz * (hw + sw)], [sg * x0, 0.12, zc + dz * (hw + sw)], C.pavement, undefined, [0, -1, zc]);
          }
        }
        for (let x = x0 + 4; x < reach + 30; x += 10) {
          b.plain.quad([sg * x, 0.045, zc - 0.08], [sg * (x + 4), 0.045, zc - 0.08], [sg * (x + 4), 0.045, zc + 0.08], [sg * x, 0.045, zc + 0.08], rgb(0xcfcfc8), undefined, [0, -1, zc]);
        }
      }
      if (over) this.overpass(sc);
    }
  }

  /* ---------- median ---------- */

  private median(): void {
    this.free(this.s0, this.s1, (a, b) => {
      this.strip(this.b.lawn, (s) => this.layout.leftEdge(s) - 1.7, () => OPP_BARRIER, a, b, 0.1, C.lawn);
      const t = new Rng(seedOf(Math.floor(a), 551));
      const tint = treeTint(t);
      for (let s = Math.ceil(a / 7) * 7; s < b; s += 7) {
        const xa = this.layout.leftEdge(s) - 1.7;
        if (s < this.s0 || s >= this.s1 || xa - OPP_BARRIER < 3.2) continue;
        const x = (xa + OPP_BARRIER) / 2;
        addTree(this.b.foliage, 'bush', x, 0.1, this.z(s), 0.9 + t.next() * 0.4, t, tint, this.rich);
      }
    });
  }

  /* ---------- trees ---------- */

  private verge(sd: SideInfo, rng: Rng): void {
    const sg = sd.sign;
    const mul = this.treeMul;
    this.free(this.s0, this.s1, (a, b) => {
      for (let s = Math.ceil(a / 4) * 4; s < b; s += 4) {
        if (s < this.s0 || s >= this.s1) continue;
        const k = blockIndex(s);
        const style = seedOf(k, sd.sign, 7) % 10; // 0 bare, 1-3 sparse, 4-9 dense
        const p = style === 0 ? 0.04 : style < 4 ? 0.14 : 0.36;
        if (rng.next() > p * mul) continue;
        const e = sd.edge(s) + sg * (CURB_OUT + 0.25);
        const room = Math.abs(sd.fence - e) - 1.6;
        const off = Math.max(0.8, Math.min(room, 1.5 + rng.next() * 3.2));
        const x = e + sg * off;
        const r = rng.next();
        const kind: TreeKind = r < 0.5 ? 'linden' : r < 0.72 ? 'poplar' : r < 0.9 ? 'spruce' : 'bush';
        addTree(this.b.foliage, kind, x, 0.1, this.z(s), 0.8 + rng.next() * 0.5, rng, treeTint(rng), this.rich);
      }
    });
    // beyond the sidewalk: young street trees
    const xs = sd.fence + sg * (SIDEWALK_GAP + SIDEWALK_W + 1.2);
    this.free(this.s0, this.s1, (a, b) => {
      for (let s = Math.ceil(a / 10) * 10 + 3; s < b; s += 10) {
        if (s < this.s0 || s >= this.s1 || this.gap(s)) continue;
        if (rng.next() > 0.7 * mul) continue;
        addTree(this.b.foliage, rng.chance(0.7) ? 'linden' : 'spruce', xs + sg * rng.next() * 2, 0.1, this.z(s), 0.75 + rng.next() * 0.4, rng, treeTint(rng), this.rich);
      }
    });
    // yards and courtyards
    const k0 = blockIndex(this.s0);
    const k1 = blockIndex(this.s1 - 0.01);
    for (let k = k0; k <= k1; k++) {
      const blk = this.plan.block(k, sd.sign, this.rows);
      const a = Math.max(this.s0, blk.s0);
      const b = Math.min(this.s1, blk.s1);
      if (b <= a) continue;
      const r = new Rng(seedOf(k, sd.sign, Math.floor(this.s0), 31));
      const inner = Math.abs(sd.fence) + SIDEWALK_GAP + SIDEWALK_W + 2.5;
      const dens = (blk.district === 'resi' ? 1 : 0.5) * mul;
      this.scatter(sg, inner, blk.frontNear - 3, a, b, 0.012 * dens, r, 'yard');
      for (let i = 0; i + 1 < blk.bands.length; i++) {
        const asphalt = blk.district === 'comm' || (blk.district === 'mixed' && i === 0);
        this.scatter(sg, blk.bands[i].far + 2, blk.bands[i + 1].near - 2, a, b, (asphalt ? 0.0015 : 0.012) * dens, r, 'court');
      }
      for (const lot of blk.lots) {
        if (lot.kind !== 'park' || lot.s < this.s0 || lot.s >= this.s1) continue;
        const n = Math.round((lot.w * lot.d) / 70 * mul);
        const lr = new Rng(lot.seed);
        for (let i = 0; i < n; i++) {
          const s = lot.s + (lr.next() - 0.5) * lot.w * 0.9;
          const x = lot.x + (lr.next() - 0.5) * lot.d * 0.9;
          addTree(this.b.foliage, pickOf(lr, ['linden', 'linden', 'poplar', 'spruce', 'bush'] as TreeKind[]), x, 0.05, this.z(s), 0.8 + lr.next() * 0.6, lr, treeTint(lr), this.rich);
        }
      }
    }
  }

  private gap(s: number): boolean {
    const k = blockIndex(s);
    const d = Math.abs(s - blockStart(k));
    return d < 11 || Math.abs(s - blockStart(k + 1)) < 11;
  }

  private scatter(sg: number, x0: number, x1: number, a: number, b: number, density: number, rng: Rng, mode: 'yard' | 'court'): void {
    if (x1 - x0 < 4 || density <= 0) return;
    const count = Math.round((x1 - x0) * (b - a) * density);
    for (let i = 0; i < count; i++) {
      const s = a + rng.next() * (b - a);
      const x = sg * (x0 + rng.next() * (x1 - x0));
      if (this.gap(s) || this.isBlocked(s)) continue;
      const r = rng.next();
      const kind: TreeKind = mode === 'yard' ? (r < 0.5 ? 'linden' : r < 0.7 ? 'bush' : r < 0.85 ? 'spruce' : 'poplar') : r < 0.55 ? 'linden' : r < 0.75 ? 'poplar' : r < 0.92 ? 'spruce' : 'bush';
      addTree(this.b.foliage, kind, x, 0.05, this.z(s), 0.8 + rng.next() * 0.7, rng, treeTint(rng), this.rich);
    }
  }

  /* ---------- buildings ---------- */

  private buildings(): void {
    const k0 = blockIndex(this.s0 - 140);
    const k1 = blockIndex(this.s1 + 140);
    for (let k = k0; k <= k1; k++) {
      for (const side of [1, -1] as Side[]) {
        const blk = this.plan.block(k, side, this.rows);
        for (const lot of blk.lots) {
          if (lot.s < this.s0 || lot.s >= this.s1) continue;
          this.building(lot, blk);
        }
      }
    }
  }

  /** Axis-aligned massing with textured walls, a roof and parapet. */
  private mass(
    cx: number,
    cz: number,
    sx: number,
    sz: number,
    floors: number,
    upper: FacadeKind,
    ground: FacadeKind | null,
    tint: RGB,
    rng: Rng,
    y0 = 0,
    parapet = 0.7,
  ): number {
    const spec = FACADE[upper];
    const gf = ground ? GROUND_FLOOR_H : 0;
    const base = y0 + gf;
    const top = base + floors * spec.fh;
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const inside: V3 = [cx, (y0 + top) / 2, cz];
    const edges: [number, number, number, number][] = [
      [x0, z0, x1, z0],
      [x1, z0, x1, z1],
      [x1, z1, x0, z1],
      [x0, z1, x0, z0],
    ];
    const perTile = Math.max(1, Math.round(spec.th / spec.fh));
    const vOff = (Math.floor(rng.next() * perTile) * spec.fh) / spec.th;
    for (const [ax, az, bx, bz] of edges) {
      const uOff = Math.floor(rng.next() * 4) * 0.25;
      if (ground) {
        const gs = FACADE[ground];
        this.b.facade[ground].wall(ax, az, bx, bz, y0, y0 + GROUND_FLOOR_H, WHITE, gs.tw, gs.th, uOff, 0, inside);
      }
      this.b.facade[upper].wall(ax, az, bx, bz, base, top, tint, spec.tw, spec.th, uOff, vOff - base / spec.th, inside);
    }
    this.roof(x0, z0, x1, z1, top, parapet, rng);
    return top;
  }

  private roof(x0: number, z0: number, x1: number, z1: number, y: number, parapet: number, rng: Rng): void {
    const p = this.b.plain;
    const inside: V3 = [(x0 + x1) / 2, y - 1, (z0 + z1) / 2];
    p.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], C.roof, undefined, inside);
    if (parapet > 0) {
      const t = 0.35;
      p.span(x0, y, z0, x1, y + parapet, z0 + t, C.parapet);
      p.span(x0, y, z1 - t, x1, y + parapet, z1, C.parapet);
      p.span(x0, y, z0 + t, x0 + t, y + parapet, z1 - t, C.parapet);
      p.span(x1 - t, y, z0 + t, x1, y + parapet, z1 - t, C.parapet);
    }
    const w = x1 - x0;
    const d = z1 - z0;
    const n = w * d > 500 ? 3 + Math.floor(rng.next() * 3) : 1 + Math.floor(rng.next() * 2);
    for (let i = 0; i < n; i++) {
      const gw = 2 + rng.next() * 4;
      const gd = 2 + rng.next() * 4;
      if (w < gw + 2 || d < gd + 2) continue;
      const gx = x0 + 1 + gw / 2 + rng.next() * (w - gw - 2);
      const gz = z0 + 1 + gd / 2 + rng.next() * (d - gd - 2);
      const gh = 1 + rng.next() * 2.2;
      p.box(gx, y, gz, gw, gh, gd, rng.chance(0.5) ? C.gear : C.gearDark);
    }
  }

  private building(lot: Lot, blk: Block): void {
    const rng = new Rng(lot.seed);
    const cx = lot.x;
    const cz = this.z(lot.s);
    const sx = lot.d;
    const sz = lot.w;
    const withGround = lot.row <= 1;
    const sign = blk.side;
    switch (lot.kind) {
      case 'slab': {
        const tint = pickOf(rng, PALETTE.panel);
        const longX = sx > sz;
        const len = longX ? sx : sz;
        const l1 = len * rng.range(0.4, 0.65);
        const f2 = Math.max(5, lot.floors - rng.int(0, 3));
        const ground: FacadeKind | null = withGround ? (rng.chance(0.3) ? 'shop' : 'lobby') : null;
        if (longX) {
          const xa = cx - sx / 2;
          this.mass(xa + l1 / 2, cz, l1, sz, lot.floors, 'panel', ground, tint, rng);
          this.mass(xa + l1 + (sx - l1) / 2, cz, sx - l1, sz, f2, 'panel', ground, tint, rng);
        } else {
          const za = cz - sz / 2;
          this.mass(cx, za + l1 / 2, sx, l1, lot.floors, 'panel', ground, tint, rng);
          this.mass(cx, za + l1 + (sz - l1) / 2, sx, sz - l1, f2, 'panel', ground, tint, rng);
        }
        break;
      }
      case 'tower': {
        const upper: FacadeKind = rng.chance(0.55) ? 'panel' : 'modern';
        this.mass(cx, cz, sx, sz, lot.floors, upper, withGround ? 'lobby' : null, pickOf(rng, PALETTE[upper]), rng);
        break;
      }
      case 'brick':
        this.mass(cx, cz, sx, sz, lot.floors, 'brick', withGround ? (rng.chance(0.5) ? 'shop' : 'lobby') : null, pickOf(rng, PALETTE.brick), rng, 0, 1);
        break;
      case 'modern': {
        const tint = pickOf(rng, PALETTE.modern);
        const wingX = sx * rng.range(0.45, 0.6);
        const sgx = rng.chance(0.5) ? 1 : -1;
        const sgz = rng.chance(0.5) ? 1 : -1;
        const ground: FacadeKind | null = withGround ? 'lobby' : null;
        this.mass(cx, cz - sgz * sz * 0.225, sx, sz * 0.55, lot.floors, 'modern', ground, tint, rng, 0, 0.9);
        this.mass(cx + (sgx * (sx - wingX)) / 2, cz + sgz * sz * 0.275, wingX, sz * 0.45, Math.max(4, Math.round(lot.floors * 0.5)), 'modern', withGround ? 'shop' : null, tint, rng, 0, 0.9);
        break;
      }
      case 'glassTower': {
        const podF = 2;
        const podium = this.mass(cx, cz, sx, sz, podF, 'commercial', withGround ? 'shop' : null, pickOf(rng, PALETTE.commercial), rng, 0, 0.6);
        const tx = sx * 0.66;
        const tz = sz * 0.66;
        const tcx = cx + sign * (sx - tx) * 0.2;
        const tint = pickOf(rng, PALETTE.glass);
        const top = this.mass(tcx, cz, tx, tz, lot.floors, 'glass', null, tint, rng, podium, 0.4);
        this.b.plain.box(tcx, top, cz, tx * 0.45, 3.5, tz * 0.45, C.gearDark);
        if (lot.floors > 26) this.b.plain.cyl(tcx, top + 3.5, cz, 0.18, 0.06, 14, 5, C.steel);
        break;
      }
      case 'office': {
        const glass = rng.chance(0.7);
        this.mass(cx, cz, sx, sz, lot.floors, glass ? 'glass' : 'modern', withGround ? 'shop' : null, pickOf(rng, glass ? PALETTE.glass : PALETTE.modern), rng, 0, 0.5);
        break;
      }
      case 'mall':
        this.mall(cx, cz, sx, sz, sign, rng);
        break;
      case 'shops': {
        const tint = pickOf(rng, PALETTE.commercial);
        this.mass(cx, cz, sx, sz, lot.floors, 'commercial', 'shop', tint, rng, 0, 0.8);
        this.signStrip(cx - sign * sx / 2 - sign * 0.06, 3.2, cz, Math.min(sz * 0.7, 18), rng, -sign);
        break;
      }
      case 'warehouse':
        this.warehouse(cx, cz, sx, sz, sign, rng);
        break;
      case 'petrol':
        this.petrol(cx, cz, sx, sz, sign, rng);
        break;
      case 'parking':
        this.parking(cx, cz, sx, sz, rng, true);
        break;
      default: {
        // park: lawn and a path
        const inside: V3 = [cx, -1, cz];
        this.b.lawn.quad([cx - sx / 2, 0.06, cz - sz / 2], [cx + sx / 2, 0.06, cz - sz / 2], [cx + sx / 2, 0.06, cz + sz / 2], [cx - sx / 2, 0.06, cz + sz / 2], C.lawn, undefined, inside);
        this.b.pavement.quad([cx - 1.2, 0.08, cz - sz / 2], [cx + 1.2, 0.08, cz - sz / 2], [cx + 1.2, 0.08, cz + sz / 2], [cx - 1.2, 0.08, cz + sz / 2], C.pavement, undefined, inside);
      }
    }
  }

  /** Large road-facing sign strip (uses the signs atlas); `face` is the outward x direction. */
  private signStrip(x: number, y: number, z: number, width: number, rng: Rng, face: number): void {
    const slot = Math.floor(rng.next() * STRIP_SLOTS);
    const [u0, v0, u1, v1] = stripUv(slot);
    const h = width / 8;
    const hz = width / 2;
    this.b.signs.quad([x, y, z - hz], [x, y, z + hz], [x, y + h, z + hz], [x, y + h, z - hz], WHITE, [u0, v0, u1, v0, u1, v1, u0, v1], [x - face, y, z]);
  }

  private mall(cx: number, cz: number, sx: number, sz: number, sign: number, rng: Rng): void {
    const tint = pickOf(rng, PALETTE.commercial);
    const top = this.mass(cx, cz, sx, sz, 3, 'commercial', null, tint, rng, 0, 1.3);
    const faceX = cx - sign * sx / 2;
    const slot = Math.floor(rng.next() * STRIP_SLOTS);
    const [u0, v0, u1, v1] = stripUv(slot);
    const w = Math.min(sz * 0.8, 36);
    const h = w / 8;
    const x = faceX - sign * 0.08;
    this.b.signs.quad([x, top - h - 1.2, cz - w / 2], [x, top - h - 1.2, cz + w / 2], [x, top - 1.2, cz + w / 2], [x, top - 1.2, cz - w / 2], WHITE, [u0, v0, u1, v0, u1, v1, u0, v1], [faceX + sign, top - 3, cz]);
    // end face towards the oncoming driver
    const ez = cz - sz / 2 - 0.08;
    const w2 = Math.min(sx * 0.7, 24);
    this.b.signs.quad([cx - w2 / 2, top - w2 / 8 - 1.2, ez], [cx + w2 / 2, top - w2 / 8 - 1.2, ez], [cx + w2 / 2, top - 1.2, ez], [cx - w2 / 2, top - 1.2, ez], WHITE, [u0, v0, u1, v0, u1, v1, u0, v1], [cx, top - 3, ez + 5]);
    // glazed entrance atrium
    const aw = Math.min(sz * 0.3, 26);
    this.mass(faceX - sign * 1.75, cz, 3.5, aw, 3, 'glass', null, [0.8, 0.9, 0.95], rng, 0, 0.3);
    // car park
    const px = faceX - sign * (4 + 22);
    this.parking(px, cz, 40, Math.min(sz, 80), rng, false);
  }

  private warehouse(cx: number, cz: number, sx: number, sz: number, sign: number, rng: Rng): void {
    const top = this.mass(cx, cz, sx, sz, 1, 'warehouse', null, pickOf(rng, PALETTE.warehouse), rng, 0, 0.5);
    void top;
    const faceX = cx - sign * sx / 2;
    const doors = 1 + Math.floor(rng.next() * 3);
    for (let i = 0; i < doors; i++) {
      const dz = cz + (rng.next() - 0.5) * (sz - 12);
      const x = faceX - sign * 0.06;
      this.b.plain.quad([x, 0.1, dz - 2.2], [x, 0.1, dz + 2.2], [x, 4.2, dz + 2.2], [x, 4.2, dz - 2.2], rgb(0x4a5058), undefined, [faceX + sign, 2, dz]);
    }
    this.parking(faceX - sign * 14, cz, 20, sz * 0.8, rng, false);
  }

  private parking(cx: number, cz: number, sx: number, sz: number, rng: Rng, fill: boolean): void {
    const y = 0.045;
    this.b.yard.quad([cx - sx / 2, y, cz - sz / 2], [cx + sx / 2, y, cz - sz / 2], [cx + sx / 2, y, cz + sz / 2], [cx - sx / 2, y, cz + sz / 2], C.road, undefined, [cx, -1, cz]);
    const line = rgb(0xdedbd2);
    const stall = 2.8;
    const cars = (fill ? 0.7 : 0.5) * Math.min(1, this.treeMul + 0.3);
    for (let r = 0; r < 2; r++) {
      const x = cx + (r === 0 ? -1 : 1) * Math.min(sx / 2 - 2.8, 5.2);
      for (let z = cz - sz / 2 + 2; z < cz + sz / 2 - 2.8; z += stall) {
        this.b.plain.quad([x - 2.6, y + 0.01, z], [x + 2.6, y + 0.01, z], [x + 2.6, y + 0.01, z + 0.1], [x - 2.6, y + 0.01, z + 0.1], line, undefined, [x, -1, z]);
        if (rng.next() < cars) this.car(x, z + stall / 2, true, rng);
      }
    }
  }

  private car(x: number, z: number, alongX: boolean, rng: Rng): void {
    const col = pickOf(rng, CAR_COLORS);
    const p = this.b.plain;
    const l = 4.4;
    const w = 1.8;
    if (alongX) {
      p.box(x, 0.22, z, l, 0.72, w, col);
      p.box(x - 0.2, 0.94, z, 2.3, 0.6, w * 0.88, rgb(0x20262c), 0, col);
    } else {
      p.box(x, 0.22, z, w, 0.72, l, col);
      p.box(x, 0.94, z - 0.2, w * 0.88, 0.6, 2.3, rgb(0x20262c), 0, col);
    }
  }

  private petrol(cx: number, cz: number, sx: number, sz: number, sign: number, rng: Rng): void {
    this.parking(cx, cz, sx, sz, rng, false);
    const p = this.b.plain;
    const fx = cx - sign * sx * 0.12;
    const red = rgb(0xd62828);
    const white = rgb(0xf2f2ee);
    const cw = Math.min(sz * 0.7, 20);
    const cd = 11;
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) p.box(fx + dx * (cd / 2 - 0.8), 0, cz + dz * (cw / 2 - 1), 0.5, 5.2, 0.5, white);
    p.box(fx, 5.2, cz, cd, 0.55, cw, white);
    p.box(fx, 5.55, cz, cd + 0.1, 0.18, cw + 0.1, red);
    for (const dz of [-1, 1]) p.box(fx, 0.05, cz + dz * cw * 0.2, 1, 1.1, 3.2, rgb(0xd0d0cc));
    // kiosk
    const kx = cx + sign * sx * 0.3;
    this.mass(kx, cz, 6, 9, 1, 'commercial', 'shop', WHITE, rng, 0, 0.3);
    // price pylon
    const px = cx - sign * (sx / 2 - 2);
    const pz = cz - sz / 2 + 2;
    p.box(px, 0, pz, 0.35, 8.5, 0.35, C.steel);
    p.box(px, 7.2, pz, 4.4, 1.7, 0.3, C.steelDark);
    const [u0, v0, u1, v1] = stripUv(4);
    for (const f of [1, -1]) {
      const zz = pz + f * 0.17;
      this.b.signs.quad([px - 2.2, 7.2, zz], [px + 2.2, 7.2, zz], [px + 2.2, 8.9, zz], [px - 2.2, 8.9, zz], WHITE, [u0, v0, u1, v0, u1, v1, u0, v1], [px, 8, zz - f]);
    }
  }

  /* ---------- billboards ---------- */

  private billboards(): void {
    const k0 = blockIndex(this.s0 - 10);
    const k1 = blockIndex(this.s1 + 10);
    for (let k = k0; k <= k1; k++) {
      for (const side of [1, -1] as Side[]) {
        const blk = this.plan.block(k, side, this.rows);
        const rng = new Rng(seedOf(k, side, 555));
        const p = blk.district === 'comm' || blk.district === 'biz' ? 0.6 : 0.3;
        const n = rng.chance(p) ? (rng.chance(0.4) ? 2 : 1) : 0;
        for (let i = 0; i < n; i++) {
          const s = Math.round(rng.range(blk.s0 + 30, blk.s1 - 30) / 50) * 50 + 25 + (side > 0 ? 8 : -8);
          const slot = rng.int(0, AD_SLOTS - 1);
          if (s < this.s0 || s >= this.s1) continue;
          this.billboard(side, s, slot);
        }
      }
    }
  }

  private billboard(side: Side, s: number, slot: number): void {
    const x = side > 0 ? FENCE_R + 7.5 : FENCE_L - 6;
    const z = this.z(s);
    const ang = 0.5;
    const nx = -side * Math.sin(ang);
    const nz = Math.cos(ang);
    const tx = nz;
    const tz = -nx;
    const W = 12;
    const H = 4.8;
    const yc = 11.5;
    const p = this.b.plain;
    for (const o of [-3.6, 3.6]) p.cyl(x + tx * o, 0, z + tz * o, 0.32, 0.26, 9, 8, C.steel);
    // frame (yawed box behind the face)
    const yaw = side * ang;
    p.box(x - nx * 0.15, yc - H / 2 - 0.25, z - nz * 0.15, W + 0.5, H + 0.5, 0.3, C.steelDark, yaw);
    const [u0, v0, u1, v1] = adUv(slot);
    const fx = x + nx * 0.02;
    const fz = z + nz * 0.02;
    this.b.ads.quad(
      [fx - tx * W / 2, yc - H / 2, fz - tz * W / 2],
      [fx + tx * W / 2, yc - H / 2, fz + tz * W / 2],
      [fx + tx * W / 2, yc + H / 2, fz + tz * W / 2],
      [fx - tx * W / 2, yc + H / 2, fz - tz * W / 2],
      WHITE,
      [u0, v0, u1, v0, u1, v1, u0, v1],
      [fx - nx, yc, fz - nz],
    );
    // catwalk lamps
    for (const o of [-4, 0, 4]) p.box(x + nx * 0.7 + tx * o, yc + H / 2 + 0.3, z + nz * 0.7 + tz * o, 0.25, 0.25, 0.9, C.steel, yaw);
  }

  /* ---------- gantries, bridges ---------- */

  private gantries(): void {
    const k0 = blockIndex(this.s0 - 200);
    const k1 = blockIndex(this.s1 + 200);
    for (let k = k0; k <= k1; k++) {
      if (!this.plan.isOverpass(k)) continue;
      const s = blockStart(k) - 150;
      if (s >= this.s0 && s < this.s1) this.gantry(s, seedOf(k, 3));
    }
  }

  private gantry(s: number, seed: number): void {
    const rng = new Rng(seed);
    const z = this.z(s);
    const xl = -12;
    const xr = 12.7;
    const p = this.b.plain;
    p.box(xr, 0, z, 0.5, 8.3, 0.5, C.steel);
    p.box(xl, 0, z, 0.55, 8.3, 0.55, C.steel);
    p.box((xl + xr) / 2, 5.55, z, xr - xl, 0.18, 0.5, C.steel);
    p.box((xl + xr) / 2, 8.15, z, xr - xl, 0.18, 0.5, C.steel);
    for (let x = xl + 1; x < xr; x += 1.8) p.box(x, 5.7, z, 0.1, 2.5, 0.1, C.steelDark);
    const panels = 3;
    const w = 4.8;
    const start = (xl + xr) / 2 - (panels * w + (panels - 1) * 0.5) / 2;
    const zf = z + 0.3;
    for (let i = 0; i < panels; i++) {
      const x0 = start + i * (w + 0.5);
      const [u0, v0, u1, v1] = gantryUv(rng.int(0, GANTRY_SLOTS - 1));
      this.b.gantry.quad([x0, 5.7, zf], [x0 + w, 5.7, zf], [x0 + w, 8.1, zf], [x0, 8.1, zf], WHITE, [u0, v0, u1, v0, u1, v1, u0, v1], [x0 + w / 2, 7, zf - 1]);
      p.box(x0 + w / 2, 5.7, z + 0.08, w, 2.4, 0.1, C.steelDark);
    }
  }

  private footbridges(): void {
    const k0 = blockIndex(this.s0 - 20);
    const k1 = blockIndex(this.s1 + 20);
    for (let k = k0; k <= k1; k++) {
      if (!this.plan.hasFootbridge(k)) continue;
      const s = blockStart(k) + 100;
      if (s >= this.s0 && s < this.s1) this.footbridge(s);
    }
  }

  private footbridge(s: number): void {
    const z = this.z(s);
    const xl = FENCE_L - SIDEWALK_GAP - 1.6;
    const xr = FENCE_R + SIDEWALK_GAP + 1.6;
    const c = this.b.concrete;
    const hw = 1.5;
    c.span(xl, 6.1, z - hw, xr, 6.75, z + hw, C.concrete, C.concrete, true);
    this.b.plain.span(xl, 8.0, z - hw - 0.2, xr, 8.22, z + hw + 0.2, C.white);
    for (const dz of [-hw, hw]) {
      this.b.glass.quad([xl, 6.75, z + dz], [xr, 6.75, z + dz], [xr, 8.0, z + dz], [xl, 8.0, z + dz], WHITE, [0, 0, 1, 0, 1, 1, 0, 1]);
      this.b.plain.span(xl, 6.75, z + dz - 0.06, xr, 6.95, z + dz + 0.06, C.steel);
    }
    c.span(-12.5, 0, z - 0.5, -11.5, 6.1, z + 0.5, C.concrete);
    for (const [tx0, tx1] of [
      [xl - 1.8, xl + 1.6],
      [xr - 1.6, xr + 1.8],
    ]) {
      const tz = 1.8;
      for (const cxp of [tx0, tx1]) for (const czp of [z - tz, z + tz]) c.span(cxp - 0.15, 0, czp - 0.15, cxp + 0.15, 8.2, czp + 0.15, C.concrete);
      c.span(tx0, 8.0, z - tz - 0.1, tx1, 8.3, z + tz + 0.1, C.concrete);
      for (const [ax, az, bx, bz] of [
        [tx0, z - tz, tx1, z - tz],
        [tx1, z - tz, tx1, z + tz],
        [tx1, z + tz, tx0, z + tz],
        [tx0, z + tz, tx0, z - tz],
      ]) {
        this.b.glass.quad([ax, 0.3, az], [bx, 0.3, bz], [bx, 8, bz], [ax, 8, az], WHITE, [0, 0, 1, 0, 1, 1, 0, 1]);
      }
    }
  }

  private overpass(sc: number): void {
    const z = this.z(sc);
    const xl = -30.5;
    const xr = 14.8;
    const c = this.b.concrete;
    const hw = 7.5;
    const yTop = 7.3;
    c.span(xl, 6.0, z - hw, xr, yTop, z + hw, C.concrete, C.concrete, true);
    this.b.yard.quad([xl, yTop + 0.03, z - 6.4], [xr, yTop + 0.03, z - 6.4], [xr, yTop + 0.03, z + 6.4], [xl, yTop + 0.03, z + 6.4], C.road, undefined, [0, 0, z]);
    for (const dz of [-1, 1]) {
      const a = z + dz * 6.4;
      const b2 = z + dz * hw;
      c.span(xl, yTop, Math.min(a, b2), xr, yTop + 1.05, Math.max(a, b2), C.concrete);
    }
    for (const dz of [-4.5, 4.5]) {
      c.span(-12.6, 0, z + dz - 0.7, -11.4, 6.0, z + dz + 0.7, C.concrete);
      c.span(-14.2, 5.45, z + dz - 1, -9.8, 6.0, z + dz + 1, C.concrete);
    }
    for (const gz of [-5, 0, 5]) this.b.plain.span(xl, 5.62, z + gz - 0.35, xr, 6.0, z + gz + 0.35, mul(C.concrete, 0.7));
    for (const sg of [1, -1]) {
      const X0 = sg > 0 ? xr : xl;
      const X1 = sg > 0 ? 84.8 : -100.5;
      const yEnd = 0.12;
      const corners = (zA: number, zB: number, lift: number, base: number): V3[] => [
        [X0, base, zA],
        [X1, base, zA],
        [X1, base, zB],
        [X0, base, zB],
        [X0, yTop + lift, zA],
        [X1, yEnd + lift, zA],
        [X1, yEnd + lift, zB],
        [X0, yTop + lift, zB],
      ];
      c.hull(corners(z - hw, z + hw, 0, 0), C.concrete);
      for (const dz of [-1, 1]) {
        const a = z + dz * 6.4;
        const b2 = z + dz * hw;
        const lo = Math.min(a, b2);
        const hi = Math.max(a, b2);
        const par: V3[] = [
          [X0, yTop, lo],
          [X1, yEnd, lo],
          [X1, yEnd, hi],
          [X0, yTop, hi],
          [X0, yTop + 1.05, lo],
          [X1, yEnd + 1.05, lo],
          [X1, yEnd + 1.05, hi],
          [X0, yTop + 1.05, hi],
        ];
        c.hull(par, C.concrete);
      }
      this.b.yard.quad([X0, yTop + 0.03, z - 6.4], [X1, yEnd + 0.03, z - 6.4], [X1, yEnd + 0.03, z + 6.4], [X0, yTop + 0.03, z + 6.4], C.road, undefined, [0, 0, z]);
    }
  }
}

