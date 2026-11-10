import * as THREE from 'three';
import { Showroom } from '../graphics/Showroom';
import { VehicleLoader } from '../assets/VehicleLoader';
import { PLAYER_CARS } from '../assets/vehicles';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const sr = new Showroom(renderer, { mobile: q.has('mobile'), base: import.meta.env.BASE_URL, look: q.get('look') ?? undefined } as never);
(window as any).__sr = sr;
(window as any).__THREE = THREE;
sr.setAspect(innerWidth / innerHeight);
sr.setActive(true);

const loader = new VehicleLoader();
const spec = PLAYER_CARS.find((c) => c.id === (q.get('car') ?? 'camry')) ?? PLAYER_CARS[0];
(async () => {
  const [model] = await Promise.all([loader.load(spec.sources, spec), q.has('nohdri') ? Promise.resolve() : sr.load()]);
  (window as any).__model = model;
  if (q.has('az')) sr.homeAzimuth = Number(q.get('az'));
  sr.setCar(model.root, { length: model.length, width: model.width, height: model.height });
  sr.setView((q.get('view') as 'lobby') ?? 'lobby');
  (window as any).__ready = true;
})();

let last = performance.now();
const frame = (now: number) => {
  const dt = (now - last) / 1000;
  last = now;
  sr.update(dt);
  sr.render(renderer);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
(window as any).__analyse = async (url: string) => {
  const tex = await new HDRLoader().loadAsync(url);
  const { data, width: w, height: h } = tex.image as { data: Uint16Array; width: number; height: number };
  const ch = data.length / (w * h);
  const cw = 64, chh = 32;
  const cells = new Float32Array(cw * chh * 3);
  const bw = w / cw, bh = h / chh;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * ch;
    const c = ((Math.floor(y / bh) * cw) + Math.floor(x / bw)) * 3;
    for (let k = 0; k < 3; k++) cells[c + k] += THREE.DataUtils.fromHalfFloat(data[i + k]) / (bw * bh);
  }
  const out: any[] = [];
  for (let cy = 0; cy < chh / 2; cy++) for (let cx = 0; cx < cw; cx++) {
    const c = (cy * cw + cx) * 3;
    const lum = cells[c] * 0.2126 + cells[c + 1] * 0.7152 + cells[c + 2] * 0.0722;
    const u = (cx + 0.5) / cw, v = 1 - (cy + 0.5) / chh;
    const phi = (u - 0.5) * Math.PI * 2, th = (v - 0.5) * Math.PI;
    out.push({ lum: +lum.toFixed(2), rgb: [cells[c], cells[c + 1], cells[c + 2]].map((x) => +x.toFixed(2)), azDeg: +((Math.atan2(Math.cos(th) * Math.sin(phi), Math.cos(th) * Math.cos(phi)) * 180) / Math.PI).toFixed(0), elDeg: +((th * 180) / Math.PI).toFixed(0) });
  }
  out.sort((a, b) => b.lum - a.lum);
  return out.slice(0, 8);
};
