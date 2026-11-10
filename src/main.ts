import * as THREE from 'three';
import { KMH } from './config';
import { PLAYER_CARS, findPlayerCar, type VehicleSpec } from './assets/vehicles';
import { creditFor } from './assets/credits';
import { VehicleLoader } from './assets/VehicleLoader';
import { AudioEngine } from './audio/AudioEngine';
import { clamp } from './core/math';
import { events, type LightingPreset } from './core/EventBus';
import { GameLoop } from './core/GameLoop';
import { Input } from './core/Input';
import { MAPS, findMap, type MapDef } from './gameplay/maps';
import { Scoring, resolveTrafficContacts } from './gameplay/Scoring';
import { CameraRig } from './graphics/CameraRig';
import { Environment } from './graphics/Environment';
import { Materials } from './graphics/Materials';
import { PostFX } from './graphics/PostFX';
import { Scenery } from './graphics/Scenery';
import { StreetLightPool } from './graphics/StreetLightPool';
import { RoadStreamer } from './road/RoadStreamer';
import { initPlatform } from './platform/YandexPlatform';
import { TrafficSystem, type PlayerState } from './traffic/TrafficSystem';
import { TRAFFIC_TYPES, TrafficView } from './traffic/TrafficView';
import { Hud } from './ui/Hud';
import { Menu } from './ui/Menu';
import { CarView } from './vehicle/CarView';
import { PlayerCar } from './vehicle/PlayerCar';

/**
 * Floating origin step. Everything road-related lives under `world`, whose
 * z offset absorbs the travelled distance so GPU-side coordinates stay small.
 * Must be a multiple of the grass tile (12 m) to keep the terrain texture stable.
 */
const ORIGIN_STEP = 1200;
/** Closing speed (m/s) above which a traffic hit ends the run. */
const WRECK_SPEED = 13;
const MENU_CRUISE = 92 * KMH;

const LANE_LABELS: Record<number, string> = { [-1]: 'Карман слева', 0: 'Ряд 1', 1: 'Ряд 2', 2: 'Ряд 3', 3: 'Карман справа' };

type Mode = 'menu' | 'play' | 'paused' | 'wreck' | 'results';

interface SaveData {
  car?: string;
  map?: string;
  bestKm?: number;
  bestScore?: number;
  volume?: number;
}

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  // ?map=night|rush|sunset, ?car=<id>, ?play=1 (skip the menu), ?intro=0, ?s=<meters>, ?cam=bumper
  const params = new URLSearchParams(location.search);
  const hud = new Hud(document.body);
  events.on('loading:progress', ({ label, progress }) => hud.progress(label, progress));
  const step = (label: string, progress: number) => {
    events.emit('loading:progress', { label, progress });
    // Yield so the loading bar repaints between heavy synchronous steps.
    return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  };

  const mobile = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 600;
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
    // No logarithmic depth: gl_FragDepth disables early-Z (costly on mobile) and broke
    // the road's depth under heavy light counts. Coplanar layers use polygonOffset instead.
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const world = new THREE.Group();
  world.name = 'world';
  scene.add(world);
  let origin = 0;

  await step('Генерация асфальта и материалов…', 0.1);
  const mats = new Materials(renderer.capabilities.getMaxAnisotropy(), mobile);

  await step('Загрузка HDRI и автомобилей…', 0.25);
  const env = new Environment(renderer, scene, mobile);
  const envReady = env.preloadAll();
  const loader = new VehicleLoader();
  // The SDK must be up before anything is saved or reported; locally this falls back instantly.
  const platform = await initPlatform();
  const save: SaveData = await platform.loadData<SaveData>();
  let spec: VehicleSpec = findPlayerCar(params.get('car') ?? save.car ?? null);
  let map: MapDef = findMap(params.get('map') ?? save.map);
  const viewReady = CarView.create(loader, spec);
  const trafficView = new TrafficView(scene, loader);
  const trafficReady = trafficView.preload(mobile ? 1 : 2);

  await step('Процедурная трасса…', 0.5);
  const road = new RoadStreamer(world, mats);
  road.prime(0);
  const scenery = new Scenery(scene, world, mats, mobile);
  // 4 street lamps + the player's beam: more makes the clear-coat road shader too heavy
  // (it stopped rasterising under SwiftShader at 8 spot lights).
  const lights = new StreetLightPool(scene, road, 4);

  const rig = new CameraRig(innerWidth / innerHeight, params.get('intro') === '0');
  if (params.get('cam') === 'bumper') rig.toggleMode();
  const post = new PostFX(renderer, scene, rig.camera, mobile);
  post.setSize(innerWidth, innerHeight);
  const input = new Input();
  const audio = new AudioEngine();
  audio.setVolume(save.volume ?? 0.8);
  audio.setCar(spec.id);

  let view = await viewReady;
  scene.add(view.model.root);
  const showCar = async () => {
    await creditFor(view.model.source);
    hud.setCar(spec.name, spec.tagline);
  };
  const car = new PlayerCar(road.layout, spec.handling, view.model.wheelbase, view.model.width, view.model.length);
  car.speed = MENU_CRUISE;
  void showCar();

  await step('Трафик…', 0.7);
  await trafficReady;
  await envReady;
  await step('Свет и тени…', 0.85);
  const applyPreset = async (preset: LightingPreset) => {
    await env.apply(preset);
    mats.applyPreset(preset);
    post.applyPreset(preset);
    const night = preset === 'night';
    lights.setEnabled(night);
    view.setNight(night);
    trafficView.setNight(night);
    events.emit('preset:changed', preset);
  };
  await applyPreset(map.preset);
  input.onKey('KeyN', () => void applyPreset(env.preset === 'golden' ? 'day' : env.preset === 'day' ? 'night' : 'golden'));
  input.onKey('KeyH', () => hud.toggle());
  input.onKey('KeyC', () => rig.toggleMode());

  // ------------------------------------------------------------------ traffic
  const pstate: PlayerState = { s: 0, x: 0, speed: 0, psi: 0, length: car.length, width: car.width };
  const syncPlayerState = () => {
    pstate.s = car.s;
    pstate.x = car.x;
    pstate.speed = car.speed;
    pstate.psi = car.psi;
    pstate.length = car.length;
    pstate.width = car.width;
  };
  let trafficSeed = 11;
  let traffic!: TrafficSystem;
  const resetTraffic = () => {
    trafficView.clear();
    traffic = new TrafficSystem(road.layout, TRAFFIC_TYPES, { maxCars: mobile ? 22 : 30, density: map.density, seed: trafficSeed++ });
    traffic.onSpawn = (c) => trafficView.add(c);
    traffic.onDespawn = (c) => trafficView.remove(c);
    syncPlayerState();
    traffic.populate(pstate);
  };

  let switching = false;
  const switchCar = async (next: VehicleSpec) => {
    if (switching || next.id === spec.id) return;
    switching = true;
    try {
      const nextView = await CarView.create(loader, next);
      // Compile off the critical path so the swap doesn't stall a frame.
      nextView.setNight(env.preset === 'night');
      await renderer.compileAsync(nextView.model.root, rig.camera, scene);
      view.dispose();
      view = nextView;
      spec = next;
      scene.add(view.model.root);
      view.setNight(env.preset === 'night');
      car.setVehicle(spec.handling, view.model.wheelbase, view.model.width, view.model.length);
      audio.setCar(spec.id);
      void showCar();
      save.car = spec.id;
      void platform.saveData(save);
    } finally {
      switching = false;
    }
  };
  const switchMap = async (next: MapDef) => {
    if (next.id === map.id) return;
    map = next;
    save.map = map.id;
    void platform.saveData(save);
    await applyPreset(map.preset);
    resetTraffic();
  };

  // Optional start offset (?s=meters) is handy for jumping straight to a pocket.
  const startS = Number(params.get('s') ?? 0);
  if (startS > 0) {
    car.s = startS;
    origin = Math.floor(startS / ORIGIN_STEP) * ORIGIN_STEP;
    world.position.z = origin;
    road.prime(startS);
  }
  resetTraffic();

  const cameraTarget = () => ({
    x: car.x,
    s: car.s,
    psi: car.psi,
    speed: car.speed,
    latAccel: car.latAccel,
    longAccel: car.longAccel,
    length: view.model.length,
    height: view.model.height,
  });

  // Compile every program up front (traffic pool included) so the first frames don't hitch.
  view.update(0.016, car, origin);
  trafficView.update(0.016, traffic.cars, origin);
  rig.update(0.016, cameraTarget(), origin);
  const warm = trafficView.warm();
  scene.add(warm);
  await renderer.compileAsync(scene, rig.camera);
  scene.remove(warm);
  trafficView.unwarm(warm);
  await step('Готово', 1);
  hud.hideLoader();
  platform.loadingReady();
  // (platform label removed from HUD)

  // -------------------------------------------------------------- game state
  let mode: Mode = 'menu';
  let adPaused = false;
  const scoring = new Scoring();
  scoring.best = save.bestScore ?? 0;
  let runStart = car.s;
  let maxCombo = 1;
  let wreckT = 0;
  let crashed = false;

  scoring.onEvent = (e) => {
    if (mode !== 'play') return;
    hud.event(e);
    if (e.kind === 'near' || e.kind === 'crazy') audio.nearMiss(e.kind === 'crazy', 0);
    else if (e.kind === 'squeeze') audio.squeeze();
    else if (e.kind === 'combo-lost' || e.kind === 'crash') audio.comboLost();
    maxCombo = Math.max(maxCombo, scoring.multiplier);
  };

  const menu = new Menu(document.body, PLAYER_CARS, MAPS, {
    onCar: (i) => void switchCar(PLAYER_CARS[i]),
    onBuy: () => {},
    onTestDrive: () => {},
    onScreen: () => {},
    onSettings: () => {},
    onTuning: () => {},
    onReward: () => {},
    onPlay: (i) => void switchMap(MAPS[i]).then(() => startRun()),
    onRestart: () => {
      void platform.showInterstitial();
      startRun();
    },
    onResume: () => setPaused(false),
    onQuit: () => endRun(false),
    onMenu: () => {
      void platform.showInterstitial();
      toMenu();
    },
    onClick: () => {
      audio.unlock();
      audio.click();
    },
  });
  menu.setCar(Math.max(0, PLAYER_CARS.indexOf(spec)));
  menu.setBest(save.bestScore ?? 0, save.bestKm ?? 0);

  const toMenu = () => {
    mode = 'menu';
    rig.showcase = true;
    hud.setPlaying(false);
    menu.go('lobby');
    menu.setBest(save.bestScore ?? 0, save.bestKm ?? 0);
    audio.setMuted(adPaused);
    platform.gameplayStop();
  };

  function startRun(): void {
    audio.unlock();
    // A fresh, straight start in the middle lane with the traffic re-seeded around us.
    car.x = road.layout.laneCenter(1, car.s);
    car.psi = 0;
    car.speed = Math.max(car.speed, 80 * KMH);
    resetTraffic();
    scoring.reset();
    runStart = car.s;
    maxCombo = 1;
    crashed = false;
    mode = 'play';
    rig.showcase = false;
    if (params.get('intro') !== '0') rig.restartIntro();
    menu.hide();
    hud.setPlaying(true);
    audio.setMuted(adPaused);
  }

  function setPaused(p: boolean): void {
    if (p && mode === 'play') {
      mode = 'paused';
      menu.showPause();
      audio.setMuted(true);
      platform.gameplayStop();
    } else if (!p && mode === 'paused') {
      mode = 'play';
      menu.hide();
      audio.setMuted(adPaused);
    }
  }

  function endRun(wrecked: boolean): void {
    if (mode !== 'play' && mode !== 'paused' && mode !== 'wreck') return;
    mode = 'results';
    platform.gameplayStop();
    hud.setPlaying(false);
    const km = (car.s - runStart) / 1000;
    const prevBest = save.bestScore ?? 0;
    const newBest = scoring.score > prevBest;
    save.bestScore = Math.max(prevBest, Math.round(scoring.score));
    save.bestKm = Math.max(save.bestKm ?? 0, Math.round(km * 100) / 100);
    void platform.saveData(save);
    void platform.submitScore('distance', Math.round(km * 1000));
    menu.showResults({
      score: scoring.score,
      km,
      nearMisses: scoring.nearMisses,
      maxCombo,
      earned: 0,
      testDrive: false,
      best: save.bestScore,
      newBest,
      crashed: wrecked,
    });
    audio.setMuted(true);
  }

  hud.onPause = () => setPaused(true);
  hud.onTouch = (a, down) => {
    audio.unlock();
    input.setTouch(a, down);
  };
  const togglePause = () => (mode === 'play' ? setPaused(true) : mode === 'paused' ? setPaused(false) : undefined);
  input.onKey('Escape', togglePause);
  input.onKey('KeyP', togglePause);
  input.onKey('Enter', () => (menu.current === 'lobby' ? startRun() : undefined));
  input.onKey('Space', () => (menu.current === 'lobby' ? startRun() : undefined));
  // Keys 1–9, then 0 for the tenth car (menu only: no mid-run swaps).
  PLAYER_CARS.forEach((c, i) =>
    input.onKey(`Digit${(i + 1) % 10}`, () => {
      if (mode !== 'menu') return;
      menu.setCar(i);
      void switchCar(c);
    }),
  );
  platform.onPauseChange((p) => {
    adPaused = p;
    audio.setMuted(p || mode !== 'play');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setPaused(true);
  });

  const onResize = () => {
    renderer.setSize(innerWidth, innerHeight);
    rig.setAspect(innerWidth / innerHeight);
    post.setSize(innerWidth, innerHeight);
  };
  addEventListener('resize', onResize);

  if (params.get('play') === '1') startRun();
  else toMenu();

  /** Gentle lane-keeping cruise for the car behind the menu. */
  const autopilot = (controls: { throttle: number; brake: number; steer: number }) => {
    let gap = Infinity;
    let leadV = 0;
    for (const c of traffic.cars) {
      if (c.s > car.s && Math.abs(c.x - car.x) < 2.3 && c.s - car.s < gap) {
        gap = c.s - car.s;
        leadV = c.v;
      }
    }
    let vT = MENU_CRUISE;
    if (gap < 70) vT = Math.min(vT, leadV + (gap - 22) * 0.25);
    controls.throttle = car.speed < vT - 0.5 ? 0.55 : 0;
    controls.brake = car.speed > vT + 1.5 ? clamp((car.speed - vT) / 6, 0.2, 1) : 0;
    const target = road.layout.laneCenter(1, car.s);
    controls.steer = clamp((target - car.x) * 0.22 - car.psi * 2.2 - car.yawRate * 0.3, -1, 1);
  };

  const focus = new THREE.Vector3();
  let time = 0;
  let hudTimer = 0;
  const controls = { throttle: 0, brake: 0, steer: 0 };

  const loop = new GameLoop({
    fixedUpdate: (dt) => {
      // Ads, hidden tabs and the pause menu freeze the simulation.
      if (adPaused || mode === 'paused' || mode === 'results') return;
      if (mode === 'menu') autopilot(controls);
      else if (mode === 'wreck') {
        controls.throttle = 0;
        controls.brake = 0.6;
        controls.steer = 0;
      } else {
        // Controls stay locked until the intro crane shot lands.
        const live = rig.introDone;
        if (live) platform.gameplayStart();
        controls.throttle = live && input.isDown('throttle') ? 1 : 0;
        controls.brake = live && input.isDown('brake') ? 1 : 0;
        controls.steer = live ? input.steer : 0;
      }
      car.update(dt, controls);
      syncPlayerState();
      traffic.update(dt, pstate);
      const hit = resolveTrafficContacts(car, traffic);
      if (hit > 0.4) {
        rig.bump(hit);
        audio.impact(hit);
        if (mode === 'play') {
          scoring.crash();
          if (hit > WRECK_SPEED) {
            mode = 'wreck';
            crashed = true;
            wreckT = 1.6;
          }
        }
      }
      if (mode === 'play') scoring.update(dt, car, traffic.cars);
    },
    update: (dt) => {
      time += dt;
      if (mode === 'wreck') {
        wreckT -= dt;
        if (wreckT <= 0) endRun(crashed);
      }
      if (car.s - origin > ORIGIN_STEP) {
        origin += ORIGIN_STEP;
        world.position.z = origin;
      }
      if (car.impact > 0) {
        rig.bump(car.impact);
        if (car.impact > 1) {
          audio.scrape(car.impact, Math.sign(car.x));
          if (mode === 'play') scoring.crash();
        }
        car.impact = 0;
      }
      road.update(car.s);
      view.update(dt, car, origin);
      trafficView.update(dt, traffic.cars, origin);
      rig.update(dt, cameraTarget(), origin);
      focus.set(car.x, 0, -(car.s - origin) - 18);
      env.follow(focus);
      lights.update(car.s, origin);
      scenery.update(rig.camera.position, car.s);
      post.update(mode === 'play' && rig.introDone ? car.speed / (300 * KMH) : 0, time);

      // Closest traffic car for the pass-by whoosh.
      let near: { dx: number; ds: number; v: number } | null = null;
      let best = 30;
      for (const c of traffic.cars) {
        const d = Math.hypot(c.x - car.x, c.s - car.s);
        if (d < best) {
          best = d;
          near = { dx: c.x - car.x, ds: c.s - car.s, v: c.v };
        }
      }
      audio.update(dt, {
        speed: car.speed,
        topSpeed: spec.handling.topSpeed,
        throttle: controls.throttle,
        brake: controls.brake,
        slip: Math.max(car.tireSlip * 1.4, car.wheelspin),
        traffic: near,
      });

      hudTimer -= dt;
      if (hudTimer <= 0 && mode === 'play') {
        hudTimer = 0.1;
        const zone = road.layout.zoneAt(car.s + 200) ?? road.layout.zoneAt(car.s);
        let pocketInfo = '';
        if (zone) {
          const side = zone.side === 1 ? 'справа' : 'слева';
          if (car.s < zone.start) pocketInfo = `карман ${side} через ${Math.round(zone.start - car.s)} м`;
          else if (car.s < zone.fullEnd) pocketInfo = `карман ${side}, сужение через ${Math.round(zone.fullEnd - car.s)} м`;
          else pocketInfo = 'сужение';
        }
        hud.update({
          speedKmh: car.speed / KMH,
          fps: loop.fps,
          laneLabel: LANE_LABELS[car.laneIndex] ?? 'Обочина',
          pocketInfo,
          score: scoring.score,
          multiplier: scoring.multiplier,
          comboLeft: scoring.multiplier > 1 ? scoring.comboTimer / 3.5 : 0,
          km: (car.s - runStart) / 1000,
          showFps: false,
          rpm01: car.rpm / car.handling.redline,
          gear: String(car.gear),
          abs: car.absActive,
          esp: car.espActive,
          tcs: car.tcsActive,
        });
      }
    },
    render: () => post.render(1 / 60),
  });
  loop.start();

  // Debug handle for console tinkering and automated screenshots.
  Object.assign(window, {
    __game: {
      renderer, scene, car, road, env, rig, applyPreset, switchCar, switchMap, platform, scoring, audio, startRun, endRun, setPaused,
      get traffic() { return traffic; },
      get view() { return view; },
      get mode() { return mode; },
    },
  });
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="fatal">Не удалось запустить WebGL: ${String(err?.message ?? err)}</div>`,
  );
});
