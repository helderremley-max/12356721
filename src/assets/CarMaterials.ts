import * as THREE from 'three';

export type PartClass = 'paint' | 'glass' | 'head' | 'tail' | 'chrome' | 'trim' | 'plastic' | 'plate' | 'tire' | 'rim' | 'keep';

export interface CarPaintOptions {
  paint: THREE.ColorRepresentation;
  metallic: number;
  rim: THREE.ColorRepresentation;
  tint: number;
}

/** Light materials whose brightness changes at runtime (day/night, braking). */
export class CarLights {
  readonly head: THREE.MeshPhysicalMaterial;
  readonly tail: THREE.MeshPhysicalMaterial;
  private night = false;
  private braking = false;

  constructor() {
    this.head = new THREE.MeshPhysicalMaterial({
      color: 0xf4f6f8,
      emissive: new THREE.Color(1, 0.95, 0.86),
      roughness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
    });
    this.tail = new THREE.MeshPhysicalMaterial({
      color: 0x2a0303,
      emissive: new THREE.Color(1, 0.025, 0.012),
      roughness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
    });
    this.apply();
  }

  setNight(on: boolean): void {
    this.night = on;
    this.apply();
  }

  setBrake(on: boolean): void {
    if (on === this.braking) return;
    this.braking = on;
    this.apply();
  }

  private apply(): void {
    // Values are HDR: anything above the bloom threshold (~1) glows. By day the lamps read as lit
    // DRLs but stay under the threshold, otherwise every car carries a bloom blob in sunlight.
    // Tail lights stay moderate because ACES desaturates very bright reds towards salmon.
    this.head.emissiveIntensity = this.night ? 3.2 : 0.55;
    // Red luminance is ~0.21 × intensity, so braking needs ~15 to clear the daytime bloom threshold.
    this.tail.emissiveIntensity = this.braking ? (this.night ? 7 : 16) : this.night ? 1.1 : 0.35;
  }
}

/** Per-car material set. Paint/lights are unique per car so they can be recoloured. */
export class CarMaterialSet {
  readonly paint: THREE.MeshPhysicalMaterial;
  readonly glass: THREE.MeshPhysicalMaterial;
  readonly chrome: THREE.MeshStandardMaterial;
  readonly trim: THREE.MeshStandardMaterial;
  readonly plastic: THREE.MeshStandardMaterial;
  readonly plate: THREE.MeshStandardMaterial;
  readonly tire: THREE.MeshStandardMaterial;
  readonly rim: THREE.MeshStandardMaterial;
  readonly lights = new CarLights();

  constructor(opts: CarPaintOptions) {
    const m = THREE.MathUtils.clamp(opts.metallic, 0, 1);
    // Metallic paints: tinted metal base under a mirror clear coat; solid paints: dielectric base.
    this.paint = new THREE.MeshPhysicalMaterial({
      color: opts.paint,
      metalness: 0.15 + m * 0.7,
      roughness: 0.42 - m * 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.025,
      envMapIntensity: 1.15,
    });
    this.glass = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x5d6670).lerp(new THREE.Color(0x020304), opts.tint),
      metalness: 0,
      roughness: 0.015,
      ior: 1.52,
      specularIntensity: 1,
      envMapIntensity: 1.5,
    });
    this.chrome = new THREE.MeshStandardMaterial({ color: 0xd9dbe0, metalness: 1, roughness: 0.12 });
    this.trim = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, metalness: 0, roughness: 0.45 });
    this.plastic = new THREE.MeshStandardMaterial({ color: 0x1d1e21, metalness: 0.1, roughness: 0.62 });
    this.plate = new THREE.MeshStandardMaterial({ color: 0xe6e6e2, metalness: 0.2, roughness: 0.45 });
    this.tire = new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0, roughness: 0.86 });
    this.rim = new THREE.MeshStandardMaterial({ color: opts.rim, metalness: 0.92, roughness: 0.26 });
  }

  get(cls: Exclude<PartClass, 'keep'>): THREE.Material {
    switch (cls) {
      case 'paint':
        return this.paint;
      case 'glass':
        return this.glass;
      case 'head':
        return this.lights.head;
      case 'tail':
        return this.lights.tail;
      case 'chrome':
        return this.chrome;
      case 'trim':
        return this.trim;
      case 'plastic':
        return this.plastic;
      case 'plate':
        return this.plate;
      case 'tire':
        return this.tire;
      case 'rim':
        return this.rim;
    }
  }

  setPaint(color: THREE.ColorRepresentation): void {
    this.paint.color.set(color);
  }
}

/** Soft elliptical blob that grounds the car (ambient occlusion under the chassis). */
let contactTexture: THREE.Texture | null = null;
export function createContactShadow(length: number, width: number): THREE.Mesh {
  if (!contactTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.92)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.6)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    contactTexture = new THREE.CanvasTexture(c);
  }
  const geo = new THREE.PlaneGeometry(width * 1.25, length * 1.12);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: contactTexture,
    transparent: true,
    depthWrite: false,
    color: 0x000000,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  // Texture alpha carries the falloff; colour stays black.
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.012;
  mesh.renderOrder = 1;
  mesh.name = 'contact-shadow';
  return mesh;
}
