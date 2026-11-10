import { KMH } from '../config';
import type { VehicleSpec } from '../assets/vehicles';
import type { MapDef } from '../gameplay/maps';

export interface MenuCallbacks {
  onCar(index: number): void;
  onMap(index: number): void;
  onPlay(): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onMenu(): void;
  onVolume(v: number): void;
  onClick(): void;
}

export interface RunResult {
  score: number;
  km: number;
  nearMisses: number;
  maxCombo: number;
  best: number;
  newBest: boolean;
  crashed: boolean;
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

/**
 * Main menu (garage + map choice over the live scene), pause and results
 * screens. Pure DOM; the game drives it through the callbacks.
 */
export class Menu {
  private root: HTMLElement;
  private main: HTMLElement;
  private pause: HTMLElement;
  private results: HTMLElement;
  private carIndex = 0;

  constructor(
    parent: HTMLElement,
    private readonly cars: VehicleSpec[],
    private readonly maps: MapDef[],
    cb: MenuCallbacks,
  ) {
    parent.insertAdjacentHTML(
      'beforeend',
      `<div class="menu" id="menu">
        <section class="menu__main">
          <header class="brand"><b>ГОРОДСКОЙ ПОТОК</b><span>ШАШКИ</span></header>
          <div class="menu__best"></div>
          <div class="garage">
            <div class="panel__title">Гараж</div>
            <div class="garage__row">
              <button class="arrow" data-car="-1" aria-label="Предыдущая машина">‹</button>
              <div class="garage__car">
                <div class="garage__idx"></div>
                <div class="garage__name"></div>
                <div class="garage__tag"></div>
              </div>
              <button class="arrow" data-car="1" aria-label="Следующая машина">›</button>
            </div>
            <div class="stats"></div>
          </div>
          <div class="maps">
            <div class="panel__title">Карта</div>
            <div class="maps__list">
              ${this.maps
                .map(
                  (m, i) => `<button class="map" data-map="${i}" style="--art:${m.art}">
                    <b>${m.name}</b><small>${m.subtitle}</small></button>`,
                )
                .join('')}
            </div>
          </div>
          <button class="play">ПОЕХАЛИ</button>
          <label class="volume">Звук <input type="range" min="0" max="100" value="80" /></label>
          <div class="menu__keys">W/S — газ/тормоз · A/D — руль · C — камера · Esc — пауза</div>
        </section>
        <section class="menu__card menu__pause" hidden>
          <h2>Пауза</h2>
          <button class="btn btn--primary" data-act="resume">Продолжить</button>
          <button class="btn" data-act="restart">Заново</button>
          <button class="btn" data-act="quit">Завершить заезд</button>
        </section>
        <section class="menu__card menu__results" hidden>
          <h2></h2>
          <div class="results__score"></div>
          <dl class="results__grid"></dl>
          <button class="btn btn--primary" data-act="restart">Ещё заезд</button>
          <button class="btn" data-act="menu">В меню</button>
        </section>
      </div>`,
    );
    this.root = parent.querySelector('#menu')!;
    this.main = this.root.querySelector('.menu__main')!;
    this.pause = this.root.querySelector('.menu__pause')!;
    this.results = this.root.querySelector('.menu__results')!;

    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('button');
      if (!el) return;
      cb.onClick();
      if (el.dataset.car) {
        const n = this.cars.length;
        this.carIndex = (this.carIndex + Number(el.dataset.car) + n) % n;
        this.renderCar();
        cb.onCar(this.carIndex);
      } else if (el.dataset.map) {
        this.selectMap(Number(el.dataset.map));
        cb.onMap(Number(el.dataset.map));
      } else if (el.classList.contains('play')) cb.onPlay();
      else if (el.dataset.act === 'resume') cb.onResume();
      else if (el.dataset.act === 'restart') cb.onRestart();
      else if (el.dataset.act === 'quit') cb.onQuit();
      else if (el.dataset.act === 'menu') cb.onMenu();
    });
    const vol = this.root.querySelector<HTMLInputElement>('.volume input')!;
    vol.addEventListener('input', () => cb.onVolume(Number(vol.value) / 100));
  }

  setVolume(v: number): void {
    this.root.querySelector<HTMLInputElement>('.volume input')!.value = String(Math.round(v * 100));
  }

  setCar(index: number): void {
    this.carIndex = index;
    this.renderCar();
  }

  selectMap(index: number): void {
    this.root.querySelectorAll('.map').forEach((el, i) => el.classList.toggle('map--on', i === index));
  }

  setBest(score: number, km: number): void {
    this.root.querySelector('.menu__best')!.textContent = score > 0 ? `Рекорд: ${fmt(score)} очков · ${km.toFixed(1)} км` : '';
  }

  private renderCar(): void {
    const c = this.cars[this.carIndex];
    const h = c.handling;
    const q = (sel: string) => this.root.querySelector(sel)!;
    q('.garage__idx').textContent = `${this.carIndex + 1} / ${this.cars.length}`;
    q('.garage__name').textContent = c.name;
    q('.garage__tag').textContent = c.tagline;
    const bars: [string, number, string][] = [
      ['Мощность', h.powerW / 380_000, `${Math.round(h.powerW / 735.5)} л.с.`],
      ['Макс. скорость', h.topSpeed / (310 * KMH), `${Math.round(h.topSpeed / KMH)} км/ч`],
      ['Сцепление', (h.grip - 8) / 5, `${h.grip.toFixed(1)} м/с²`],
      ['Отзывчивость', 1 - (h.yawLag - 0.05) / 0.16, h.drivetrain],
    ];
    q('.stats').innerHTML = bars
      .map(
        ([label, v, txt]) =>
          `<div class="stat"><span>${label}</span><i><u style="width:${Math.round(Math.min(1, Math.max(0.05, v)) * 100)}%"></u></i><em>${txt}</em></div>`,
      )
      .join('');
  }

  private show(which: HTMLElement | null): void {
    this.root.hidden = which === null;
    for (const el of [this.main, this.pause, this.results]) el.hidden = el !== which;
    this.root.classList.toggle('menu--dim', which !== this.main && which !== null);
  }

  showMain(): void {
    this.show(this.main);
  }

  showPause(): void {
    this.show(this.pause);
  }

  hide(): void {
    this.show(null);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  get onMain(): boolean {
    return !this.root.hidden && !this.main.hidden;
  }

  showResults(r: RunResult): void {
    this.results.querySelector('h2')!.textContent = r.crashed ? 'Авария!' : 'Заезд завершён';
    this.results.querySelector('.results__score')!.innerHTML = `${fmt(r.score)}<small>${r.newBest ? 'новый рекорд!' : 'очков'}</small>`;
    this.results.querySelector('.results__grid')!.innerHTML = `
      <dt>Дистанция</dt><dd>${r.km.toFixed(2)} км</dd>
      <dt>Опасных сближений</dt><dd>${r.nearMisses}</dd>
      <dt>Лучшее комбо</dt><dd>×${r.maxCombo.toFixed(2)}</dd>
      <dt>Рекорд</dt><dd>${fmt(r.best)}</dd>`;
    this.show(this.results);
  }
}
