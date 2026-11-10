import * as THREE from 'three';
import type { LightingPreset } from '../../core/EventBus';
import { cityState } from './CityState';
import { createCityTextures, type CityTextures, type FacadeKind } from './CityTextures';

const FACADE_KINDS: FacadeKind[] = ['panel', 'brick', 'modern', 'glass', 'commercial', 'warehouse', 'shop', 'lobby'];

/** Shared materials of the roadside city; geometry is rebuilt per road chunk, materials never. */
export class CityMaterials {
  readonly tex: CityTextures;
  readonly facade = {} as Record<FacadeKind, THREE.MeshStandardMaterial>;
  readonly plain: THREE.MeshStandardMaterial;
  readonly concrete: THREE.MeshStandardMaterial;
  readonly pavement: THREE.MeshStandardMaterial;
  readonly lawn: THREE.MeshStandardMaterial;
  readonly yard: THREE.MeshStandardMaterial;
  readonly foliage: THREE.MeshStandardMaterial;
  readonly ads: THREE.MeshStandardMaterial;
  readonly signs: THREE.MeshStandardMaterial;
  readonly gantry: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshStandardMaterial;
  night = false;

  constructor(anisotropy: number, mobile: boolean, concreteMap: THREE.Texture | null) {
    cityState.detail = mobile ? 1 : 2;
    const tex = (this.tex = createCityTextures(anisotropy, mobile));
    for (const kind of FACADE_KINDS) {
      const t = tex.facade[kind];
      const glassy = kind === 'glass';
      this.facade[kind] = new THREE.MeshStandardMaterial({
        map: t.map,
        emissiveMap: t.emissive,
        emissive: 0xffffff,
        emissiveIntensity: 0.05,
        vertexColors: true,
        roughness: glassy ? 0.22 : kind === 'shop' ? 0.35 : 0.82,
        metalness: glassy ? 0.5 : 0.05,
        envMapIntensity: glassy ? 1.1 : 0.7,
      });
    }
    this.plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
    this.concrete = new THREE.MeshStandardMaterial({ map: concreteMap, vertexColors: true, roughness: 0.9 });
    this.pavement = new THREE.MeshStandardMaterial({ map: tex.pavement, vertexColors: true, roughness: 0.92 });
    this.lawn = new THREE.MeshStandardMaterial({ map: tex.lawn, vertexColors: true, roughness: 1 });
    this.yard = new THREE.MeshStandardMaterial({ map: tex.yard, vertexColors: true, roughness: 0.88 });

    this.foliage = new THREE.MeshStandardMaterial({
      map: tex.foliage,
      vertexColors: true,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.92,
      envMapIntensity: 0.8,
    });
    // Normals are authored radially from the crown, so back faces must not flip them.
    this.foliage.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'),
      );
    };
    this.foliage.customProgramCacheKey = () => 'city-foliage-v1';

    const lit = (map: THREE.Texture, roughness: number) =>
      new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness });
    this.ads = lit(tex.ads, 0.55);
    this.signs = lit(tex.signs, 0.5);
    this.gantry = lit(tex.gantry, 0.4);

    this.glass = new THREE.MeshStandardMaterial({
      color: 0xa9cadb,
      transparent: true,
      opacity: 0.3,
      roughness: 0.08,
      metalness: 0,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  applyPreset(preset: LightingPreset): void {
    const night = preset === 'night';
    this.night = night;
    const dusk = preset === 'golden';
    for (const kind of FACADE_KINDS) this.facade[kind].emissiveIntensity = night ? (kind === 'shop' || kind === 'lobby' ? 3.2 : 2.6) : dusk ? 0.16 : 0.03;
    this.ads.emissiveIntensity = night ? 1.5 : dusk ? 0.22 : 0.02;
    this.signs.emissiveIntensity = night ? 1.7 : dusk ? 0.25 : 0.02;
    this.gantry.emissiveIntensity = night ? 0.55 : 0.1;
    const dim = night ? 0.6 : 1;
    for (const m of [this.lawn, this.pavement, this.yard, this.concrete]) m.color.setScalar(dim);
    this.foliage.color.setScalar(night ? 0.55 : 1);
  }
}
