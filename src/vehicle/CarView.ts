import * as THREE from 'three';
import type { VehicleSpec } from '../assets/vehicles';
import type { VehicleLoader, VehicleModel } from '../assets/VehicleLoader';
import type { PlayerCar } from './PlayerCar';

/** Damped spring for one body axis (roll or pitch). */
class BodySpring {
  angle = 0;
  vel = 0;

  step(target: number, hz: number, zeta: number, dt: number): void {
    const w = 2 * Math.PI * hz;
    // Substep: semi-implicit Euler goes unstable for w·dt ≳ 1 (e.g. a 100 ms hitch on a stiff car).
    const n = Math.ceil(dt / (1 / 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.vel += (w * w * (target - this.angle) - 2 * zeta * w * this.vel) * h;
      this.angle += this.vel * h;
    }
  }
}

/**
 * Visual side of the player car: places the loaded model, swings the sprung
 * body on roll/pitch springs, spins and steers the wheels, drives the lights.
 */
export class CarView {
  private roll = new BodySpring();
  private pitch = new BodySpring();
  private beam: THREE.SpotLight;
  private time = 0;

  private constructor(
    readonly model: VehicleModel,
    readonly spec: VehicleSpec,
  ) {
    // One shared beam for both headlamps keeps the forward light count low.
    this.beam = new THREE.SpotLight(0xfff1e0, 0, 95, 0.42, 0.55, 1.3);
    this.beam.position.copy(model.headlightPos);
    this.beam.target.position.set(0, -0.6, model.headlightPos.z - 40);
    model.root.add(this.beam, this.beam.target);
  }

  static async create(loader: VehicleLoader, spec: VehicleSpec): Promise<CarView> {
    const model = await loader.load(spec.sources, spec);
    return new CarView(model, spec);
  }

  setNight(on: boolean): void {
    this.model.materials.lights.setNight(on);
    this.beam.intensity = on ? 240 : 0;
  }

  update(dt: number, car: PlayerCar, origin: number): void {
    this.time += dt;
    const { root, body, wheels } = this.model;
    const h = car.handling;
    root.position.set(car.x, 0, -(car.s - origin));
    root.rotation.y = -car.psi;

    // Roll outward in a turn, squat on throttle, dive under braking.
    this.roll.step(car.latAccel * h.rollGain, h.suspensionHz, h.damping, dt);
    this.pitch.step(car.longAccel * h.pitchGain, h.suspensionHz * 1.1, h.damping, dt);
    const v01 = Math.min(1, car.speed / 70);
    const ripple = Math.sin(this.time * 37) * Math.sin(this.time * 13.1) * 0.0035 * v01;
    body.rotation.set(this.pitch.angle, 0, this.roll.angle);
    body.position.y = 0.45 + ripple - Math.abs(this.roll.angle) * 0.15;

    const spin = (car.speed / this.model.wheelRadius) * dt;
    for (const w of wheels) {
      w.spin.rotation.x -= spin;
      if (w.front) w.steer.rotation.y = -car.steerAngle * 1.6;
    }
    this.model.materials.lights.setBrake(car.braking);
  }

  dispose(): void {
    this.beam.dispose();
    this.model.dispose();
  }
}
