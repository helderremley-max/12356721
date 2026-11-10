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
