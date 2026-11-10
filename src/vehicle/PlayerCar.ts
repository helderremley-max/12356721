import { BASE_HALF_WIDTH, LANE_WIDTH, MEDIAN_SHOULDER_WIDTH, SHOULDER_WIDTH } from '../config';
import { clamp, damp, smootherstep } from '../core/math';
import type { Handling } from '../assets/vehicles';
import type { RoadLayout } from '../road/RoadLayout';

const G = 9.81;

export interface Controls {
  throttle: number;
  brake: number;
  /** -1 full left .. +1 full right. */
  steer: number;
}

/** Inner faces of the median barrier and the guardrail relative to the road edges. */
const MEDIAN_FACE = MEDIAN_SHOULDER_WIDTH + 0.05;
const RAIL_FACE = SHOULDER_WIDTH + 0.37;

/** Centre-of-gravity height, m. */
const CG_HEIGHT = 0.52;
/** Static front axle load share per layout. */
const FRONT_SHARE = { RWD: 0.52, FWD: 0.61, AWD: 0.56 } as const;
/** Drive torque split to the front axle. */
const DRIVE_FRONT = { RWD: 0, FWD: 1, AWD: 0.4 } as const;
const BRAKE_FRONT = 0.66;
/** Arcade assists: heading return (1/s) with the wheel released, and slide damping. */
const ASSIST_RETURN = 9;
/** Extra sideways-speed bleed while straightening (1/s per rad of travel angle). */
const ASSIST_LATERAL = 25;
const SLIDE_DAMP_RELEASED = 3;
const SLIDE_DAMP_HELD = 0.6;
/** Largest body slip angle the assist allows (a controllable drift, never a spin). */
const MAX_BETA = 0.33;
/** Max sideways travel speed per m/s² of grip: keeps a switch from turning into a skid across three lanes. */
const LATERAL_SPEED_PER_GRIP = 0.55;

/**
 * Player chassis in road space (s along the road, x lateral, heading psi > 0 =
 * pointing right). Dynamic bicycle model:
 *  - axle loads move with longitudinal acceleration (dive under braking, squat
 *    under power) and lateral load transfer costs grip;
 *  - each axle has a friction circle: drive or brake force eats into
 *    cornering grip, so RWD power-oversteers, FWD pushes wide, and braking
 *    while turning sharpens turn-in;
 *  - Pacejka-style tyre curve (peak, then a gentler sliding plateau);
 *  - yaw inertia from mass and wheelbase;
 *  - steering rack with speed-dependent rate and grip-limited lock.
 * On top sit arcade assists that straighten the car on release and cap the
 * slide angle, so weaving through traffic stays precise.
 */
export class PlayerCar {
  s = 0;
  x = 0;
  psi = 0;
  /** Body-frame velocity: forward and to the right, m/s. */
  vx = 0;
  vy = 0;
  /** Yaw rate, rad/s (+ turning right). */
  yawRate = 0;
  /** Road-wheel angle, rad (+ right). */
  steerAngle = 0;
  latAccel = 0;
  longAccel = 0;
  /** Front axle share of the total load, 0..1 (≈0.55 static). */
  frontLoad = 0.55;
  /** 0..1: how hard the tyres are working past their peak (screech, smoke). */
  tireSlip = 0;
  /** 0..1: driven wheels spinning. */
  wheelspin = 0;
  braking = false;
  /** Lateral impact speed of the last barrier hit (m/s), cleared by the consumer. */
  impact = 0;
  private steerFrac = 0;
  /** Low-passed longitudinal acceleration: load transfer follows the suspension, not instantly. */
  private axLoad = 0;

  constructor(
    private readonly layout: RoadLayout,
    public handling: Handling,
    public wheelbase: number,
    public width: number,
    public length: number,
  ) {
    this.setVehicle(handling, wheelbase, width, length);
  }

  setVehicle(handling: Handling, wheelbase: number, width: number, length: number): void {
    this.handling = handling;
    // Guard against bad rigs: physics divides by the wheelbase.
    this.wheelbase = Number.isFinite(wheelbase) && wheelbase > length * 0.4 ? wheelbase : length * 0.58;
    this.width = width;
    this.length = length;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** Sets a straight-line speed (used at spawn and in tests). */
  set speed(v: number) {
    this.vx = v;
    this.vy = 0;
    this.yawRate = 0;
  }

  get mass(): number {
    return this.handling.massKg;
  }

  /** Body slip angle: between where the car points and where it goes. */
  get beta(): number {
    return this.vx > 0.5 ? Math.atan2(this.vy, this.vx) : 0;
  }

  /** Yaw inertia: sharper cars (low yawLag) carry their mass closer to the centre. */
  get inertia(): number {
    const h = this.handling;
    const f0 = FRONT_SHARE[h.drivetrain];
    const a = this.wheelbase * (1 - f0);
    const b = this.wheelbase * f0;
    return h.massKg * a * b * (0.85 + 2 * h.yawLag);
  }

  update(dt: number, c: Controls): void {
    const h = this.handling;
    const m = h.massKg;
    const L = this.wheelbase;
    const f0 = FRONT_SHARE[h.drivetrain];
    const a = L * (1 - f0);
    const b = L * f0;
    const Iz = this.inertia;
    const v = Math.max(this.vx, 0);
    const mu = h.grip / G;
    const f = clamp(v / h.topSpeed, 0, 1);

    // --- Steering rack: wind-on slows with speed, return-to-centre is quicker.
    const rate = c.steer !== 0 ? h.rackSpeed[0] + (h.rackSpeed[1] - h.rackSpeed[0]) * f : h.rackSpeed[0] * 1.4;
    this.steerFrac += clamp(c.steer - this.steerFrac, -rate * dt, rate * dt);
    // Lock = kinematic angle for the grip limit plus room to reach the tyre's peak slip.
    const lock = clamp((L * h.grip) / Math.max(v * v, 1) + 0.06, 0.04, 0.6);
    const delta = this.steerFrac * lock;
    this.steerAngle = delta;

    // --- Axle loads with longitudinal and lateral transfer.
    const W = m * G;
    const transfer = (m * this.axLoad * CG_HEIGHT) / L;
    const Fzf = Math.max(W * f0 - transfer, 0.15 * W);
    const Fzr = Math.max(W * (1 - f0) + transfer, 0.15 * W);
    this.frontLoad = Fzf / (Fzf + Fzr);
    const track = Math.max(this.width - 0.25, 1.2);
    const latShift = (m * Math.abs(this.latAccel) * CG_HEIGHT) / track;
    // Tyre load sensitivity: unequal left/right loads give less total grip.
    const sens = (Fz: number, share: number) => {
      const q = clamp((latShift * share) / (Fz / 2), 0, 1);
      return 1 - 0.15 * q * q;
    };
    const capF = mu * Fzf * sens(Fzf, 0.55);
    const capR = mu * Fzr * sens(Fzr, 0.45);

    // --- Longitudinal forces per axle.
    const power = h.powerW * 0.62;
    const drive = c.throttle * (power / Math.max(v, 12));
    const brake = c.brake * m * 11 * (v > 0.3 ? 1 : 0);
    const engineBrake = c.throttle < 0.05 && v > 1 ? m * 0.9 : 0;
    const df = DRIVE_FRONT[h.drivetrain];
    let FxF = drive * df - brake * BRAKE_FRONT - engineBrake * df;
    let FxR = drive * (1 - df) - brake * (1 - BRAKE_FRONT) - engineBrake * (1 - df);
    // Friction circle: longitudinal force is capped and leaves the rest for cornering.
    let spin = 0;
    const capLong = (Fx: number, cap: number) => {
      const lim = cap * 0.98;
      if (Math.abs(Fx) > lim) spin = Math.max(spin, Math.min(1, Math.abs(Fx) / cap - 0.98));
      return clamp(Fx, -lim, lim);
    };
    FxF = capLong(FxF, capF);
    FxR = capLong(FxR, capR);
    const capYF = Math.max(Math.sqrt(Math.max(capF * capF - FxF * FxF, 0)), 0.25 * capF);
    const capYR = Math.max(Math.sqrt(Math.max(capR * capR - FxR * FxR, 0)), 0.25 * capR);

    // --- Lateral tyre forces (simplified Pacejka: sin(C·atan(B·α))).
    const B = 18 - 30 * h.yawLag;
    const C = 1.4;
    const tyre = (alpha: number) => Math.sin(C * Math.atan(B * alpha));
    const vxs = Math.max(v, 1);
    const alphaF = Math.atan2(this.vy + a * this.yawRate, vxs) - delta;
    const alphaR = Math.atan2(this.vy - b * this.yawRate, vxs);
    const FyF = -capYF * tyre(alphaF);
    const FyR = -capYR * tyre(alphaR);
    const peak = Math.tan(Math.PI / 2 / C) / B;
    this.tireSlip = clamp(Math.max(Math.abs(alphaF), Math.abs(alphaR)) / peak - 0.85, 0, 1);
    this.wheelspin = spin;

    // --- Body equations.
    const dragK = power / h.topSpeed ** 3;
    const resist = dragK * v * v + 0.012 * W;
    const cosD = Math.cos(delta);
    const sinD = Math.sin(delta);
    const ax = (FxF * cosD - FyF * sinD + FxR - resist) / m;
    const ay = (FxF * sinD + FyF * cosD + FyR) / m;
    const yawAcc = (a * (FxF * sinD + FyF * cosD) - b * FyR) / Iz;

    const vx0 = this.vx;
    this.vx = Math.max(0, this.vx + (ax + this.vy * this.yawRate) * dt);
    this.vy += (ay - vx0 * this.yawRate) * dt;
    this.yawRate += yawAcc * dt;

    // Slip angles are meaningless near standstill: blend to rolling without sliding.
    const w = smootherstep(1.5, 5, this.vx);
    if (w < 1) {
      this.yawRate = this.yawRate * w + ((this.vx * Math.tan(delta)) / L) * (1 - w);
      this.vy *= w;
    }

    // --- Arcade assists.
    const released = Math.abs(c.steer) < 0.05;
    // Slide damping (a counter-steer helper); weaker on throttle for RWD so the tail can step out.
    const powerSlide = h.drivetrain === 'RWD' ? c.throttle : 0;
    this.vy *= Math.exp(-(released ? SLIDE_DAMP_RELEASED : SLIDE_DAMP_HELD * (1 - 0.7 * powerSlide)) * dt);
    // Drift angles are welcome at city speeds, but at 200+ a big slide is a crash.
    const betaMax = MAX_BETA * clamp(1 - (this.vx - 20) / 60, 0.3, 1);
    if (this.vx > 3 && Math.abs(this.vy) > Math.tan(betaMax) * this.vx) this.vy = Math.sign(this.vy) * Math.tan(betaMax) * this.vx;
    // Direction of travel relative to the road.
    const theta = this.psi + Math.atan2(this.vy, Math.max(this.vx, 0.5));
    if (released) {
      // Straighten the direction of travel (not just the nose) so a switch ends in the target lane.
      const rTarget = -theta * ASSIST_RETURN - this.beta * 2;
      this.yawRate += (rTarget - this.yawRate) * damp(14, dt);
      this.vy *= Math.exp(-ASSIST_LATERAL * Math.abs(theta) * dt);
    }
    const thetaMax = Math.min(0.5, Math.asin(Math.min(1, (h.grip * LATERAL_SPEED_PER_GRIP) / Math.max(this.speed, 1))));
    if (Math.abs(theta) > thetaMax) {
      const rTarget = (Math.sign(theta) * thetaMax - theta) * 8;
      this.yawRate += (rTarget - this.yawRate) * damp(10, dt);
    }

    // --- Integrate pose in road space.
    this.psi = clamp(this.psi + this.yawRate * dt, -0.7, 0.7);
    const sinP = Math.sin(this.psi);
    const cosP = Math.cos(this.psi);
    this.x += (this.vx * sinP + this.vy * cosP) * dt;
    this.s += (this.vx * cosP - this.vy * sinP) * dt;

    this.longAccel = ax;
    this.latAccel = ay;
    this.axLoad += (ax - this.axLoad) * damp(7, dt);
    this.braking = c.brake > 0.05;
    this.collideBarriers();
  }

  /** World-frame (x, s) velocity. */
  worldVelocity(): { vxw: number; vsw: number } {
    const sinP = Math.sin(this.psi);
    const cosP = Math.cos(this.psi);
    return { vxw: this.vx * sinP + this.vy * cosP, vsw: this.vx * cosP - this.vy * sinP };
  }

  /** Sets the world-frame velocity, converting back to the body frame (the rotation is its own inverse). */
  setWorldVelocity(vxw: number, vsw: number): void {
    const sinP = Math.sin(this.psi);
    const cosP = Math.cos(this.psi);
    this.vx = Math.max(0, vxw * sinP + vsw * cosP);
    this.vy = vxw * cosP - vsw * sinP;
  }

  /**
   * Impulse (N·s) in world (x, s) axes applied at an offset (px, ps) from the
   * centre of mass — used for traffic contacts.
   */
  applyImpulse(jx: number, js: number, px: number, ps: number): void {
    const { vxw, vsw } = this.worldVelocity();
    const m = this.mass;
    this.setWorldVelocity(vxw + jx / m, vsw + js / m);
    this.yawRate = clamp(this.yawRate + (ps * jx - px * js) / this.inertia, -2.5, 2.5);
  }

  private collideBarriers(): void {
    // Footprint half-width grows when the car is yawed.
    const half = (this.width / 2) * Math.cos(this.psi) + (this.length / 2) * Math.abs(Math.sin(this.psi)) * 0.9;
    const min = this.layout.leftEdge(this.s) - MEDIAN_FACE + half;
    const max = this.layout.rightEdge(this.s) + RAIL_FACE - half;
    const hit = this.x < min ? -1 : this.x > max ? 1 : 0;
    if (!hit) return;
    this.x = hit < 0 ? min : max;
    const { vxw, vsw } = this.worldVelocity();
    // Only a hit if moving into the wall; a closing taper just pushes us along.
    if (Math.sign(vxw) === hit) {
      const impact = Math.abs(vxw);
      this.impact = Math.max(this.impact, impact);
      const keep = 1 - Math.min(0.45, 0.03 + impact * 0.035);
      this.psi = -this.psi * 0.3;
      this.yawRate = 0;
      this.steerFrac *= 0.3;
      this.setWorldVelocity(-vxw * 0.25, vsw * keep);
    } else {
      this.setWorldVelocity(0, vsw * 0.999);
    }
  }

  /** 0..2 main lanes, -1/3 pockets, NaN on the shoulders. */
  get laneIndex(): number {
    const i = Math.floor((this.x + BASE_HALF_WIDTH) / LANE_WIDTH);
    const pocketRight = this.x > BASE_HALF_WIDTH && this.x <= this.layout.rightEdge(this.s);
    const pocketLeft = this.x < -BASE_HALF_WIDTH && this.x >= this.layout.leftEdge(this.s);
    if (i >= 0 && i <= 2) return i;
    if (i === 3 && pocketRight) return 3;
    if (i === -1 && pocketLeft) return -1;
    return NaN;
  }
}
