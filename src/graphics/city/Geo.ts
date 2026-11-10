import * as THREE from 'three';

export type V3 = readonly [number, number, number];
export type RGB = readonly [number, number, number];

const tmpColor = new THREE.Color();
/** sRGB hex → linear vertex colour. */
export function rgb(hex: number): RGB {
  tmpColor.setHex(hex);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
}

export const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const WHITE: RGB = [1, 1, 1];

/**
 * Static mesh accumulator in chunk-local space (x lateral, y up, z = s0 - s).
 * Faces are added with an interior reference point so winding never has to be
 * worked out by hand.
 */
export class Bucket {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  lay: number[] = [];
  idx: number[] = [];

  /**
   * @param s0 chunk start, used to keep world-projected UVs continuous across chunks
   * @param autoUv metres per texture repeat for box-projected UVs (0 = none)
   */
  /** Texture-array layer written with every vertex. */
  layer = 0;

  constructor(
    readonly s0: number,
    public autoUv = 0,
  ) {}

  /** Select the texture layer and projected-UV scale for the geometry added next. */
  use(layer: number, autoUv = 0): this {
    this.layer = layer;
    this.autoUv = autoUv;
    return this;
  }

  get empty(): boolean {
    return this.idx.length === 0;
  }

  get count(): number {
    return this.pos.length / 3;
  }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: RGB): number {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    this.lay.push(this.layer);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Quad a,b,c,d (counter-clockwise seen from the front). */
  quad(a: V3, b: V3, c: V3, d: V3, color: RGB, uv?: readonly number[], inside?: V3): void {
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    let p = [a, b, c, d];
    let t = uv;
    if (inside) {
      const cx = (a[0] + c[0]) / 2 - inside[0];
      const cy = (a[1] + c[1]) / 2 - inside[1];
      const cz = (a[2] + c[2]) / 2 - inside[2];
      if (nx * cx + ny * cy + nz * cz < 0) {
        p = [a, d, c, b];
        if (uv) t = [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]];
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
    }
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      let u = 0;
      let v = 0;
      if (t) {
        u = t[i * 2];
        v = t[i * 2 + 1];
      } else if (this.autoUv > 0) {
        const q = p[i];
        const sc = this.s0 % 600;
        const ax = Math.abs(nx);
        const ay = Math.abs(ny);
        const az = Math.abs(nz);
        if (ay >= ax && ay >= az) {
          u = q[0] / this.autoUv;
          v = (sc - q[2]) / this.autoUv;
        } else if (ax >= az) {
          u = (sc - q[2]) / this.autoUv;
          v = q[1] / this.autoUv;
        } else {
          u = q[0] / this.autoUv;
          v = q[1] / this.autoUv;
        }
      }
      this.vert(p[i][0], p[i][1], p[i][2], nx, ny, nz, u, v, color);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Wall strip between two plan points; UVs run in tile units. */
  wall(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    y0: number,
    y1: number,
    color: RGB,
    tileW: number,
    tileH: number,
    uOff: number,
    vOff: number,
    inside: V3,
  ): void {
    const len = Math.hypot(bx - ax, bz - az);
    const u1 = uOff + len / tileW;
    const v0 = vOff + y0 / tileH;
    const v1 = vOff + y1 / tileH;
    this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], color, [uOff, v0, u1, v0, u1, v1, uOff, v1], inside);
  }

  /** Four plan corners of a yawed rectangle, ordered around the footprint. */
  static footprint(cx: number, cz: number, w: number, d: number, yaw: number): [number, number][] {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ].map(([lx, lz]) => [cx + lx * c - lz * s, cz + lx * s + lz * c]);
  }

  /** Plain (or auto-UV) box; `top` null skips the roof, `bottom` adds the underside. */
  box(
    cx: number,
    y0: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    color: RGB,
    yaw = 0,
    top: RGB | null = color,
    bottom = false,
  ): void {
    const f = Bucket.footprint(cx, cz, w, d, yaw);
    const inside: V3 = [cx, y0 + h / 2, cz];
    const y1 = y0 + h;
    for (let i = 0; i < 4; i++) {
      const a = f[i];
      const b = f[(i + 1) % 4];
      this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], color, undefined, inside);
    }
    if (top) this.quad([f[0][0], y1, f[0][1]], [f[1][0], y1, f[1][1]], [f[2][0], y1, f[2][1]], [f[3][0], y1, f[3][1]], top, undefined, inside);
    if (bottom) this.quad([f[0][0], y0, f[0][1]], [f[1][0], y0, f[1][1]], [f[2][0], y0, f[2][1]], [f[3][0], y0, f[3][1]], color, undefined, inside);
  }

  /** Box between two opposite corners, axis aligned. */
  span(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: RGB, top: RGB | null = color, bottom = false): void {
    this.box((x0 + x1) / 2, y0, (z0 + z1) / 2, Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0), color, 0, top, bottom);
  }

  /** Arbitrary hexahedron: corners 0-3 bottom ring, 4-7 top ring (same order). */
  hull(c: V3[], color: RGB, bottom = false): void {
    let ix = 0;
    let iy = 0;
    let iz = 0;
    for (const p of c) {
      ix += p[0] / 8;
      iy += p[1] / 8;
      iz += p[2] / 8;
    }
    const inside: V3 = [ix, iy, iz];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(c[i], c[j], c[j + 4], c[i + 4], color, undefined, inside);
    }
    this.quad(c[4], c[5], c[6], c[7], color, undefined, inside);
    if (bottom) this.quad(c[0], c[1], c[2], c[3], color, undefined, inside);
  }

  /** Vertical tapered cylinder with smooth normals. */
  cyl(x: number, y0: number, z: number, r0: number, r1: number, h: number, sides: number, color: RGB, cap = false): void {
    const base = this.pos.length / 3;
    const slope = (r0 - r1) / h;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      const l = Math.hypot(1, slope);
      this.vert(x + cs * r0, y0, z + sn * r0, cs / l, slope / l, sn / l, i / sides, 0, color);
      this.vert(x + cs * r1, y0 + h, z + sn * r1, cs / l, slope / l, sn / l, i / sides, 1, color);
    }
    for (let i = 0; i < sides; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    if (cap) {
      const c = this.vert(x, y0 + h, z, 0, 1, 0, 0.5, 0.5, color);
      const ring = this.pos.length / 3;
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        this.vert(x + Math.cos(a) * r1, y0 + h, z + Math.sin(a) * r1, 0, 1, 0, 0.5, 0.5, color);
      }
      for (let i = 0; i < sides; i++) this.idx.push(c, ring + i + 1, ring + i);
    }
  }

  toGeometry(withUv: boolean, withLayer = true): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (withLayer) g.setAttribute('layer', new THREE.Float32BufferAttribute(this.lay, 1));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}
