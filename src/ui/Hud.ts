import type { ScoreEvent } from '../gameplay/Scoring';

export interface HudState {
  speedKmh: number;
  fps: number;
  laneLabel: string;
  pocketInfo: string;
  score: number;
  multiplier: number;
  /** 0..1 of the combo timer left. */
  comboLeft: number;
  km: number;
}

export type TouchAction = 'throttle' | 'brake' | 'left' | 'right';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

const POPUP: Record<string, string> = {
  near: 'NEAR MISS',
  crazy: 'CRAZY CLOSE',
  squeeze: 'DOUBLE SQUEEZE',
  crash: 'КОМБО ПОТЕРЯНО',
};

/** DOM overlay: loading screen, speed, score/combo, event popups, touch pedals. */
export class Hud {
  private root: HTMLElement;
  private loader: HTMLElement;
  private loaderBar: HTMLElement;
  private loaderLabel: HTMLElement;
  private speed: HTMLElement;
  private info: HTMLElement;
  private car: HTMLElement;
  private score: HTMLElement;
  private mult: HTMLElement;
  private comboBar: HTMLElement;
  private km: HTMLElement;
  private popups: HTMLElement;
  private visible = true;
  private platform = '';
  onPause: () => void = () => {};
  onTouch: (action: TouchAction, down: boolean) => void = () => {};

  constructor(parent: HTMLElement) {
    parent.insertAdjacentHTML(
      'beforeend',
      `<div class="loader" id="loader">
         <div class="loader__title">ГОРОДСКОЙ ПОТОК<span>ШАШКИ</span></div>
         <div class="loader__track"><div class="loader__bar"></div></div>
         <div class="loader__label">Загрузка…</div>
       </div>
       <div class="hud hud--hidden" id="hud">
         <div class="hud__car"><b></b><small></small><em></em></div>
         <div class="hud__score"><b>0</b><span class="hud__mult">×1.00</span><i><u></u></i><small class="hud__km">0.00 км</small></div>
         <div class="hud__popups"></div>
         <div class="hud__speed"><b>0</b><small>км/ч</small></div>
         <div class="hud__info"></div>
         <button class="hud__pause" aria-label="Пауза">❚❚</button>
         <div class="touch">
           <button class="touch__btn touch__left" data-t="left" aria-label="Влево">◀</button>
           <button class="touch__btn touch__right" data-t="right" aria-label="Вправо">▶</button>
           <button class="touch__btn touch__brake" data-t="brake" aria-label="Тормоз">ТОРМОЗ</button>
           <button class="touch__btn touch__gas" data-t="throttle" aria-label="Газ">ГАЗ</button>
         </div>
       </div>`,
    );
    this.loader = parent.querySelector('#loader')!;
    this.loaderBar = this.loader.querySelector('.loader__bar')!;
    this.loaderLabel = this.loader.querySelector('.loader__label')!;
    this.root = parent.querySelector('#hud')!;
    this.speed = this.root.querySelector('.hud__speed b')!;
    this.info = this.root.querySelector('.hud__info')!;
    this.car = this.root.querySelector('.hud__car')!;
    this.score = this.root.querySelector('.hud__score b')!;
    this.mult = this.root.querySelector('.hud__mult')!;
    this.comboBar = this.root.querySelector('.hud__score i u')!;
    this.km = this.root.querySelector('.hud__km')!;
    this.popups = this.root.querySelector('.hud__popups')!;
    this.root.querySelector('.hud__pause')!.addEventListener('click', () => this.onPause());

    // Pedals: pointer events cover touch and mouse; multi-touch works since each button tracks its own pointer.
    for (const btn of this.root.querySelectorAll<HTMLElement>('.touch__btn')) {
      const action = btn.dataset.t as TouchAction;
      const set = (down: boolean) => {
        btn.classList.toggle('touch__btn--on', down);
        this.onTouch(action, down);
      };
      btn.addEventListener('pointerdown', (e) => {
        btn.setPointerCapture(e.pointerId);
        set(true);
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => set(false));
    }
    if (matchMedia('(pointer: coarse)').matches) this.root.classList.add('hud--touch');
  }

  progress(label: string, value: number): void {
    this.loaderLabel.textContent = label;
    this.loaderBar.style.width = `${Math.round(value * 100)}%`;
  }

  hideLoader(): void {
    this.loader.classList.add('loader--done');
    setTimeout(() => this.loader.remove(), 900);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? '' : 'none';
  }

  /** In-run HUD vs. menu (only the car badge stays visible under the menu). */
  setPlaying(on: boolean): void {
    this.root.classList.toggle('hud--hidden', !on);
  }

  setPlatform(label: string): void {
    this.platform = label;
  }

  setCar(name: string, tagline: string, credit = ''): void {
    this.car.querySelector('b')!.textContent = name;
    this.car.querySelector('small')!.textContent = tagline;
    this.car.querySelector('em')!.textContent = credit;
    // Restart the slide-in animation.
    this.car.classList.remove('hud__car--in');
    void this.car.offsetWidth;
    this.car.classList.add('hud__car--in');
  }

  event(e: ScoreEvent): void {
    const label = POPUP[e.kind];
    if (!label) return;
    const el = document.createElement('div');
    el.className = `popup popup--${e.kind}`;
    el.innerHTML =
      e.kind === 'crash'
        ? `<b>${label}</b>`
        : `<b>${label}</b><span>+${fmt(e.points)}</span><small>${e.kind === 'squeeze' ? '' : `${Math.round(e.gap * 100)} см · `}×${e.multiplier.toFixed(2)}</small>`;
    this.popups.prepend(el);
    while (this.popups.children.length > 3) this.popups.lastElementChild!.remove();
    setTimeout(() => el.remove(), 1600);
  }

  update(s: HudState): void {
    if (!this.visible) return;
    this.speed.textContent = String(Math.round(s.speedKmh));
    this.score.textContent = fmt(s.score);
    this.mult.textContent = `×${s.multiplier.toFixed(2)}`;
    this.mult.classList.toggle('hud__mult--hot', s.multiplier >= 3);
    this.comboBar.style.width = `${Math.round(s.comboLeft * 100)}%`;
    this.km.textContent = `${s.km.toFixed(2)} км`;
    this.info.textContent = `${s.laneLabel}${s.pocketInfo ? ' · ' + s.pocketInfo : ''} · ${Math.round(s.fps)} FPS${
      this.platform ? ` · SDK: ${this.platform}` : ''
    }`;
  }
}
