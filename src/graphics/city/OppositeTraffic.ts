import * as THREE from 'three';
import { Rng } from '../../core/math';
import { LANE_WIDTH } from '../../config';
import { Bucket, rgb } from './Geo';
import { OPP_OUTER } from './CityChunk';

const LANES = 3;
const FIRST_LANE_X = OPP_OUTER + 1.6 + LANE_WIDTH / 2;
const BEHIND = 140;
const AHEAD = 950;
const COUNTS = [18, 30, 44, 60] as const;
const PALETTE = [0xe8e8e8, 0xc4c8cc, 0x1c1f23, 0x5a5f66, 0x274a86, 0x8d2323, 0xcbbf9d, 0x2f5b3e, 0xf0f0f0].map((h) => new THREE.Color(h));

interface Car {
  s: number;
  lane: number;
  v: number;
}

/** Cheap oncoming traffic on the far carriageway: one instanced mesh, recycled around the player. */
export class OppositeTraffic {
  private body: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh;
  private cars: Car[] = [];
  private active = 0;
  private rng = new Rng(7001);
  private m = new THREE.Matrix4();
  private last = 0;
  private lastS = 0;
  private lampMat: THREE.MeshBasicMaterial;

  constructor(world: THREE.Object3D, maxCars = COUNTS[3]) {
    const b = new Bucket(0);
    const body = rgb(0xffffff);
    const dark = rgb(0x14181c);
    const tyre = rgb(0x060606);
    b.box(0, 0.32, 0, 1.82, 0.74, 4.5, body, 0, body);
    b.box(0, 1.06, -0.2, 1.55, 0.58, 2.5, dark, 0, body);
    for (const x of [-0.86, 0.86]) for (const z of [-1.4, 1.45]) b.box(x, 0.02, z, 0.24, 0.62, 0.64, tyre);
    const bodyGeo = b.toGeometry(false, false);
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.45 });
    this.body = new THREE.InstancedMesh(bodyGeo, bodyMat, maxCars);
    this.body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxCars * 3), 3);

    const l = new Bucket(0);
    const white = rgb(0xffffff);
    for (const x of [-0.62, 0.62]) l.box(x, 0.62, 2.27, 0.38, 0.14, 0.06, white);
    for (const x of [-0.62, 0.62]) l.box(x, 0.62, -2.27, 0.34, 0.12, 0.05, white);
    this.lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 0.95, 0.8), fog: true });
    this.lamps = new THREE.InstancedMesh(l.toGeometry(false, false), this.lampMat, maxCars);

    for (const im of [this.body, this.lamps]) {
      im.frustumCulled = false;
      im.count = 0;
      world.add(im);
    }
    for (let i = 0; i < maxCars; i++) {
      this.cars.push({ s: 0, lane: 0, v: 0 });
      this.body.setColorAt(i, PALETTE[i % PALETTE.length]);
    }
    this.setLevel(2);
  }

  setLevel(level: 0 | 1 | 2 | 3): void {
    this.active = Math.min(COUNTS[level], this.cars.length);
    this.body.count = this.lamps.count = this.active;
    this.spawnAll(this.lastS);
  }

  private spawnAll(s: number): void {
    for (let i = 0; i < this.active; i++) this.respawn(i, s, true);
  }

  private respawn(i: number, s: number, anywhere: boolean): void {
    const r = this.rng;
    const c = this.cars[i];
    c.lane = r.int(0, LANES - 1);
    c.v = r.range(20, 32);
    c.s = anywhere ? s - BEHIND + r.next() * (AHEAD + BEHIND) : s + AHEAD * (0.75 + r.next() * 0.25);
    this.body.setColorAt(i, PALETTE[r.int(0, PALETTE.length - 1)]);
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }

  setNight(night: boolean): void {
    this.lampMat.color.setScalar(night ? 5 : 0.9);
  }

  update(s: number): void {
    const now = performance.now() / 1000;
    const dt = this.last ? Math.min(0.1, now - this.last) : 0;
    this.last = now;
    this.lastS = s;
    const m = this.m;
    for (let i = 0; i < this.active; i++) {
      const c = this.cars[i];
      c.s -= c.v * dt;
      if (c.s < s - BEHIND) this.respawn(i, s, false);
      m.makeTranslation(FIRST_LANE_X + c.lane * LANE_WIDTH, 0, -c.s);
      this.body.setMatrixAt(i, m);
      this.lamps.setMatrixAt(i, m);
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
  }
}
