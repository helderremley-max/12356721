import * as THREE from 'three';
import type { LightingPreset } from '../../core/EventBus';
import { cityState } from './CityState';
import { createCityTextures, LAYER, LAYER_COUNT, type CityTextures, type FacadeKind } from './CityTextures';

interface ArrayVariant {
  /** Constant layer for instanced boxes (no per-vertex `layer` attribute). */
  fixedLayer?: number;
  /** Facade tile size in metres: UVs are derived from the instance scale. */
  tile?: [number, number];
}

/**
 * Shared materials of the roadside city. Nearly every surface (facades,
 * pavement, lawn, concrete, signs) samples one texture array, so a road chunk
 * needs only a handful of draw calls.
 */
export class CityMaterials {
  readonly tex: CityTextures;
  /** Opaque city surfaces. */
  readonly solid: THREE.MeshStandardMaterial;
  /** Curtain-wall facades (glossier). */
  readonly glassFacade: THREE.MeshStandardMaterial;
  readonly foliage: THREE.MeshStandardMaterial;
  /** Transparent noise-barrier / footbridge glazing. */
  readonly glass: THREE.MeshStandardMaterial;
  night = false;
  /** Per-layer glow multiplier shared by every array material. */
  private readonly glow = new Array<number>(LAYER_COUNT).fill(0);
  private readonly variants: THREE.MeshStandardMaterial[] = [];

  constructor(anisotropy: number, mobile: boolean, concreteMap: THREE.Texture | null) {
    cityState.detail = mobile ? 1 : 2;
    const tex = (this.tex = createCityTextures(anisotropy, mobile, concreteMap ? (concreteMap.image as CanvasImageSource) : null));
    this.solid = this.arrayMaterial({ roughness: 0.85, metalness: 0.04, envMapIntensity: 0.75 }, {});
    this.glassFacade = this.arrayMaterial({ roughness: 0.22, metalness: 0.5, envMapIntensity: 1.1 }, {});

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

  /** Instanced skyline towers: same array shader, layer and UV tiling taken from the instance. */
  skyline(kind: FacadeKind, tile: [number, number]): THREE.MeshStandardMaterial {
    const glassy = kind === 'glass';
    return this.arrayMaterial(
      { roughness: glassy ? 0.22 : 0.85, metalness: glassy ? 0.5 : 0.04, envMapIntensity: glassy ? 1.1 : 0.75, vertexColors: false },
      { fixedLayer: LAYER[kind], tile },
    );
  }

  private arrayMaterial(params: THREE.MeshStandardMaterialParameters, v: ArrayVariant): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, ...params });
    const { color, emissive } = this.tex;
    const glow = this.glow;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTexArr = { value: color };
      shader.uniforms.uEmiArr = { value: emissive };
      shader.uniforms.uGlow = { value: glow };
      let uvCode = 'vArrUv = vec3(uv, layer);';
      let decl = 'attribute float layer;';
      if (v.fixedLayer !== undefined && v.tile) {
        decl = '';
        uvCode = `
#ifdef USE_INSTANCING
  vec3 iScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  float faceW = abs(normal.x) > 0.5 ? iScale.z : iScale.x;
  vec2 facadeUv = vec2(uv.x * faceW / ${v.tile[0].toFixed(1)}, uv.y * iScale.y / ${v.tile[1].toFixed(1)});
  facadeUv.x += fract(instanceMatrix[3].z * 0.0173 + instanceMatrix[3].x * 0.031);
  vArrUv = vec3(facadeUv, ${v.fixedLayer.toFixed(1)});
#endif`;
      }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${decl}\nvarying vec3 vArrUv;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n${uvCode}`);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vArrUv;
uniform highp sampler2DArray uTexArr;
uniform highp sampler2DArray uEmiArr;
uniform float uGlow[${LAYER_COUNT}];`,
        )
        .replace('#include <map_fragment>', 'diffuseColor *= texture(uTexArr, vArrUv);')
        .replace(
          '#include <emissivemap_fragment>',
          'totalEmissiveRadiance *= texture(uEmiArr, vArrUv).rgb * uGlow[int(vArrUv.z + 0.5)];',
        );
    };
    mat.customProgramCacheKey = () => `city-array-${v.fixedLayer ?? 'attr'}-${v.tile?.join('x') ?? ''}`;
    this.variants.push(mat);
    return mat;
  }

  applyPreset(preset: LightingPreset): void {
    const night = preset === 'night';
    const dusk = preset === 'golden';
    this.night = night;
    const g = this.glow;
    const windows = night ? 2.6 : dusk ? 0.16 : 0.03;
    const shops = night ? 3.2 : dusk ? 0.16 : 0.03;
    for (const k of ['panel', 'brick', 'modern', 'glass', 'commercial', 'warehouse'] as const) g[LAYER[k]] = windows;
    g[LAYER.shop] = g[LAYER.lobby] = shops;
    g[LAYER.ads] = night ? 1.5 : dusk ? 0.22 : 0.02;
    g[LAYER.signs] = night ? 1.7 : dusk ? 0.25 : 0.02;
    g[LAYER.gantry] = night ? 0.55 : 0.1;
    // Night is lit by the IBL only, so unlit ground and concrete need dimming.
    const dim = night ? 0.62 : 1;
    this.solid.color.setScalar(dim);
    this.glassFacade.color.setScalar(1);
    this.foliage.color.setScalar(night ? 0.55 : 1);
    for (const m of this.variants) m.uniformsNeedUpdate = true;
  }
}
