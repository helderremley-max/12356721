import * as THREE from 'three';
import { Rng } from '../core/math';
import type { Materials } from './Materials';
import { FACADE, type FacadeKind } from './city/CityTextures';
import { OppositeTraffic } from './city/OppositeTraffic';
import { cityState, setCityDetail, type CityDetail } from './city/CityState';
import { seedOf } from './city/CityPlan';

const TERRAIN_SIZE = 4000;
/** Ground texture tile size in metres; terrain snaps to it so texels stay world-anchored. */
export const GRASS_TILE = 12;

const SKY_BIN = 100;
const SKY_BEHIND = 250;
const SKY_AHEAD = 1700;
const SKY_CAPACITY = 150;
/** Nearest lateral distance of skyline towers per detail level (beyond the last building row). */
const SKY_MIN_X = [190, 250, 300, 380] as const;
const SKY_KINDS: FacadeKind[] = ['glass', 'modern', 'panel'];

/**
 * Roadside ground plane, a far skyline of towers and oncoming traffic. The
 * near city (building rows, trees, bridges…) is part of the road chunks.
 */
export class Scenery {
  private terrain: THREE.Mesh;
  private skyline: THREE.InstancedMesh[] = [];
  private traffic: OppositeTraffic;
  private skyBin = Number.NaN;
  private skyDetail = -1;
  private night = false;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private counts: number[] = [];

  constructor(
    scene: THREE.Scene,
    world: THREE.Object3D,
    private readonly mats: Materials,
    mobile: boolean,
  ) {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE);
    geo.rotateX(-Math.PI / 2);
    const ground = mats.city.tex.lawn.clone();
    ground.repeat.set(TERRAIN_SIZE / GRASS_TILE, TERRAIN_SIZE / GRASS_TILE);
    ground.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({
      map: ground,
      roughness: 1,
      color: 0xb9b49a,
      polygonOffset: true,
      polygonOffsetFactor: 4,
      polygonOffsetUnits: 16,
    });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.position.y = -0.04;
    this.terrain.receiveShadow = true;
    scene.add(this.terrain);

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    for (const kind of SKY_KINDS) {
      const material = mats.city.skyline(kind, [FACADE[kind].tw, FACADE[kind].th]);
      const im = new THREE.InstancedMesh(box, material, SKY_CAPACITY);
      im.frustumCulled = false;
      im.count = 0;
      world.add(im);
      this.skyline.push(im);
    }
    this.traffic = new OppositeTraffic(world);
    this.setDetail(mobile ? 1 : 2);
  }

  /** 0 = low … 3 = ultra: building rows, tree density, skyline depth and oncoming traffic. */
  setDetail(level: 0 | 1 | 2 | 3): void {
    setCityDetail(level);
    this.traffic.setLevel(level);
    this.skyDetail = -1;
    this.skyBin = Number.NaN;
  }

  update(cameraWorld: THREE.Vector3, s: number): void {
    this.terrain.position.x = Math.round(cameraWorld.x / GRASS_TILE) * GRASS_TILE;
    this.terrain.position.z = Math.round(cameraWorld.z / GRASS_TILE) * GRASS_TILE;
    const bin = Math.floor((s - SKY_BEHIND) / SKY_BIN);
    if (bin !== this.skyBin || this.skyDetail !== cityState.detail) {
      this.skyBin = bin;
      this.skyDetail = cityState.detail;
      this.fillSkyline(bin);
    }
    if (this.mats.city.night !== this.night) {
      this.night = this.mats.city.night;
      this.traffic.setNight(this.night);
    }
    this.traffic.update(s);
  }

  private fillSkyline(firstBin: number): void {
    const bins = Math.ceil((SKY_AHEAD + SKY_BEHIND) / SKY_BIN);
    const detail = cityState.detail as CityDetail;
    const minX = SKY_MIN_X[detail];
    this.counts.length = this.skyline.length;
    this.counts.fill(0);
    for (let n = firstBin; n < firstBin + bins; n++) {
      // Every ~1.5 km one side gets a cluster of tall glass towers (a business centre).
      const cluster = seedOf(Math.floor(n / 15), 17) % 100 < 45;
      const clusterSide = seedOf(Math.floor(n / 15), 19) % 2 ? 1 : -1;
      for (const side of [1, -1]) {
        const r = new Rng(seedOf(n, side, 2024));
        const count = r.chance(0.45 + detail * 0.12) ? 2 : 1;
        for (let i = 0; i < count; i++) {
          const w = r.range(24, 52);
          const d = r.range(24, 52);
          const inCluster = cluster && side === clusterSide;
          const x = side * (minX + r.next() * (inCluster ? 140 : 420));
          const kind = inCluster ? 0 : r.chance(0.5) ? 1 : r.chance(0.5) ? 2 : 0;
          const h = inCluster ? r.range(110, 270) : r.range(45, 130);
          const sPos = n * SKY_BIN + r.next() * SKY_BIN;
          const im = this.skyline[kind];
          const slot = this.counts[kind];
          if (slot >= SKY_CAPACITY) continue;
          this.counts[kind]++;
          this.p.set(x, 0, -sPos);
          this.sc.set(w, h, d);
          this.m.compose(this.p, this.q, this.sc);
          im.setMatrixAt(slot, this.m);
        }
      }
    }
    this.skyline.forEach((im, i) => {
      im.count = this.counts[i];
      im.instanceMatrix.needsUpdate = true;
    });
  }
}
