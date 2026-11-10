import type { VehicleSpec } from '../assets/vehicles';
import type { Settings } from '../core/Settings';
import { DROPS, PAINTS, RIMS, TINTS, type CarTuning } from '../gameplay/economy';
import type { MapDef } from '../gameplay/maps';
import { ICONS, driveIcon } from './icons';

export type Screen = 'lobby' | 'maps' | 'settings' | 'tuning' | 'shop';

export interface CarStats {
  topKmh: number;
  hp: number;
  massKg: number;
  /** 0–100 km/h, seconds. */
  accel: number;
}

export interface MenuCallbacks {
  /** Preview a car (garage strip, shop). */
  onCar(index: number): void;
  onBuy(index: number): void;
  onTestDrive(index: number): void;
  onPlay(mapIndex: number): void;
  onScreen(screen: Screen): void;
  onSettings(patch: Partial<Settings>): void;
  /** null resets the car to factory spec. */
  onTuning(patch: CarTuning | null): void;
  onReward(): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onMenu(): void;
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
  earned: number;
  testDrive: boolean;
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Performance class letter from engine power. */
const carClass = (hp: number) => (hp < 140 ? 'D' : hp < 270 ? 'C' : hp < 370 ? 'B' : hp < 460 ? 'A' : 'S');

type Opt = [value: string | number | boolean, label: string];
type Row =
  | { kind: 'seg'; label: string; desc?: string; key: keyof Settings; options: Opt[]; icons?: boolean; hints?: string[] }
  | { kind: 'switch'; label: string; desc?: string; key: keyof Settings }
  | { kind: 'slider'; label: string; desc?: string; key: keyof Settings; min: number; max: number; step: number; lazy?: boolean; unit: (v: number) => string }
  | { kind: 'info'; label: string; html: string };

const PAGES: { id: string; title: string; rows: Row[] }[] = [
  {
    id: 'game',
    title: 'Общие',
    rows: [
      { kind: 'slider', label: 'Громкость', key: 'volume', min: 0, max: 1, step: 0.05, unit: (v) => `${Math.round(v * 100)}%` },
      { kind: 'seg', label: 'Вид камеры', key: 'camera', options: [['chase', 'Близко'], ['far', 'Далеко'], ['bumper', 'С капота']] },
      {
        kind: 'slider',
        label: 'Плавность камеры',
        desc: 'Насколько камера отстаёт при перестроениях',
        key: 'cameraInertia',
        min: 0,
        max: 1,
        step: 0.05,
        unit: (v) => `${Math.round(v * 100)}%`,
      },
      { kind: 'switch', label: 'Счётчик кадров', key: 'showFps' },
      {
        kind: 'info',
        label: 'Клавиши',
        html: '<kbd>W</kbd><kbd>S</kbd> газ и тормоз · <kbd>A</kbd><kbd>D</kbd> руль · <kbd>E</kbd><kbd>Q</kbd> передачи · <kbd>C</kbd> камера · <kbd>Esc</kbd> пауза',
      },
    ],
  },
  {
    id: 'car',
    title: 'Вождение',
    rows: [
      { kind: 'seg', label: 'Трансмиссия', desc: 'В ручном режиме: E — выше, Q — ниже', key: 'gearbox', options: [['auto', 'Автомат'], ['manual', 'Механика']] },
      {
        kind: 'seg',
        label: 'Режим управления',
        key: 'style',
        options: [['arcade', 'Лёгкий'], ['standard', 'Обычный'], ['sim', 'Реализм']],
        hints: [
          'Больше сцепления, машина сама держит полосу, стабилизация всегда включена',
          'Машина выравнивается, когда отпускаешь руль',
          'Чистая физика без подсказок — для опытных',
        ],
      },
      {
        kind: 'seg',
        label: 'Ведущие колёса',
        key: 'drive',
        icons: true,
        options: [['stock', 'Заводской'], ['FWD', 'Передние'], ['RWD', 'Задние'], ['AWD', 'Все']],
      },
      { kind: 'switch', label: 'Антиблокировка (ABS)', desc: 'Колёса не блокируются при резком торможении', key: 'abs' },
      { kind: 'switch', label: 'Стабилизация (ESP)', desc: 'Гасит занос и разворот', key: 'esp' },
      { kind: 'switch', label: 'Антипробуксовка (TCS)', desc: 'Ограничивает газ при пробуксовке', key: 'tcs' },
    ],
  },
  {
    id: 'traffic',
    title: 'Поток',
    rows: [
      { kind: 'seg', label: 'Плотность машин', key: 'trafficDensity', options: [['low', 'Свободно'], ['normal', 'Обычно'], ['high', 'Пробки'], ['extreme', 'Хаос']] },
      { kind: 'seg', label: 'Скорость потока', key: 'trafficPace', options: [['slow', 'Медленно'], ['normal', 'Обычно'], ['fast', 'Быстро']] },
      { kind: 'switch', label: 'Перестроения', desc: 'Машины в потоке меняют полосы с поворотником', key: 'trafficLaneChanges' },
      { kind: 'switch', label: 'Режим призраков', desc: 'Проезд сквозь машины, без очков и выплат', key: 'ghostTraffic' },
    ],
  },
  {
    id: 'graphics',
    title: 'Изображение',
    rows: [
      { kind: 'seg', label: 'Качество', key: 'quality', options: [['low', 'Эконом'], ['medium', 'Баланс'], ['high', 'Высокое'], ['ultra', 'Максимум']] },
      { kind: 'slider', label: 'Чёткость', desc: 'Масштаб рендеринга', key: 'resolution', min: 0.4, max: 1, step: 0.1, lazy: true, unit: (v) => `${Math.round(v * 100)}%` },
      { kind: 'seg', label: 'Ограничение кадров', key: 'fpsLimit', options: [[30, '30'], [60, '60'], [0, 'Нет']] },
      { kind: 'slider', label: 'Обзор дороги', key: 'drawDistance', min: 300, max: 1100, step: 50, unit: (v) => `${v} м` },
    ],
  },
];

const TUNE_CATS = [
  { id: 'paint', label: 'Цвет', icon: ICONS.paint },
  { id: 'rim', label: 'Диски', icon: ICONS.wheel },
  { id: 'tint', label: 'Стёкла', icon: ICONS.window },
  { id: 'drop', label: 'Посадка', icon: ICONS.height },
] as const;
type TuneCat = (typeof TUNE_CATS)[number]['id'];

const NAV: { id: Screen; label: string; icon: string }[] = [
  { id: 'lobby', label: 'Гараж', icon: ICONS.garage },
  { id: 'maps', label: 'Маршруты', icon: ICONS.route },
  { id: 'tuning', label: 'Тюнинг', icon: ICONS.brush },
  { id: 'shop', label: 'Автосалон', icon: ICONS.tag },
  { id: 'settings', label: 'Опции', icon: ICONS.sliders },
];

/**
 * Menus over the showroom: header (brand, bonus, wallet, profile), a side
 * navigation rail, the garage (car card, CTA, garage strip), and panels for
 * routes, settings, tuning and the dealership; plus pause and results cards.
 * Pure DOM; the game drives it through the callbacks.
 */
export class Menu {
  private root: HTMLElement;
  private screens: Record<Screen | 'pause' | 'results', HTMLElement>;
  private carIndex = 0;
  private screen: Screen = 'lobby';
  private settings!: Settings;
  private tuning: CarTuning = {};
  private tuneCat: TuneCat = 'paint';
  private owned = new Set<string>();
  private prices: Record<string, number> = {};
  private stats: CarStats[] = [];
  private money = 0;
  private settingsPage = 'game';

  constructor(
    parent: HTMLElement,
    private readonly cars: VehicleSpec[],
    private readonly maps: MapDef[],
    private readonly cb: MenuCallbacks,
  ) {
    parent.insertAdjacentHTML('beforeend', this.template());
    this.root = parent.querySelector('#menu')!;
    const q = (s: string) => this.root.querySelector<HTMLElement>(s)!;
    this.screens = {
      lobby: q('.scr--lobby'),
      maps: q('.scr--maps'),
      settings: q('.scr--settings'),
      tuning: q('.scr--tuning'),
      shop: q('.scr--shop'),
      pause: q('.dlg--pause'),
      results: q('.dlg--results'),
    };
    this.root.addEventListener('click', (e) => this.onClickEvent(e));
    // Sliders: live value while dragging; "lazy" ones (costly to apply) commit on release.
    this.root.addEventListener('input', (e) => this.onRange(e.target as HTMLInputElement, false));
    this.root.addEventListener('change', (e) => this.onRange(e.target as HTMLInputElement, true));
  }

  // ---------------------------------------------------------------- markup

  private template(): string {
    return `<div class="menu" id="menu">
      <header class="hdr">
        <div class="brand"><span class="brand__mark"></span><div class="brand__text"><b>Городской поток</b><small>шашки в трафике</small></div></div>
        <div class="hdr__right">
          <button class="chip chip--bonus" data-act="reward" title="Посмотреть видео и получить кредиты">${ICONS.play}<span>Бонус</span><b class="bonus-sum"></b></button>
          <div class="chip chip--wallet" title="Кредиты">${ICONS.coin}<b class="wallet-sum">0</b></div>
          <div class="chip chip--profile"><span class="avatar">${ICONS.user}</span><b class="profile-name">Игрок</b></div>
        </div>
      </header>

      <nav class="rail">
        ${NAV.map((n) => `<button class="rail__btn" data-go="${n.id}">${n.icon}<span>${n.label}</span></button>`).join('')}
      </nav>

      <section class="scr scr--lobby">
        <article class="car-card">
          <div class="car-card__top"><span class="class-badge"></span><small class="car-card__idx"></small></div>
          <h1 class="car-card__name"></h1>
          <p class="car-card__tag"></p>
          <div class="car-card__stats"></div>
          <p class="car-card__best"></p>
          <p class="car-card__credit"></p>
        </article>
        <div class="cta"></div>
        <div class="strip">
          <button class="strip__nav" data-car="-1" aria-label="Предыдущая машина">${ICONS.left}</button>
          <div class="strip__track"></div>
          <button class="strip__nav" data-car="1" aria-label="Следующая машина">${ICONS.right}</button>
        </div>
      </section>

      <section class="scr scr--maps panel" hidden>
        ${this.panelHead('Маршруты', 'Выберите время суток и характер потока')}
        <div class="routes">
          ${this.maps
            .map(
              (m, i) => `<button class="route" data-map="${i}" style="--art:${m.art}">
                <span class="route__art"></span>
                <span class="route__body"><b>${m.name}</b><small>${m.subtitle}</small></span>
                <span class="route__go">Старт ${ICONS.arrow}</span>
              </button>`,
            )
            .join('')}
        </div>
      </section>

      <section class="scr scr--settings panel panel--wide" hidden>
        ${this.panelHead('Опции')}
        <div class="tabs">${PAGES.map((p) => `<button class="tabs__btn" data-tab="${p.id}">${p.title}</button>`).join('')}</div>
        <div class="pages">
          ${PAGES.map((p) => `<div class="page" data-page="${p.id}">${p.rows.map((r) => this.rowHtml(r)).join('')}</div>`).join('')}
        </div>
      </section>

      <section class="scr scr--tuning side" hidden>
        ${this.panelHead('Тюнинг', 'Изменения бесплатны и сохраняются')}
        <div class="tune-cats">
          ${TUNE_CATS.map((c) => `<button class="tune-cat" data-cat="${c.id}">${c.icon}<span>${c.label}</span></button>`).join('')}
        </div>
        <div class="tune-grid"></div>
        <button class="link-btn" data-act="factory">${ICONS.reset}Вернуть заводское</button>
      </section>

      <section class="scr scr--shop panel panel--wide" hidden>
        ${this.panelHead('Автосалон', 'Нажмите на машину, чтобы посмотреть её в гараже')}
        <div class="dealer"></div>
      </section>

      <section class="dlg dlg--pause" hidden>
        <h2>Пауза</h2>
        <button class="btn btn--primary" data-act="resume">Продолжить</button>
        <button class="btn" data-act="restart">Начать заново</button>
        <button class="btn btn--ghost" data-act="quit">Завершить заезд</button>
      </section>
      <section class="dlg dlg--results" hidden>
        <h2></h2>
        <div class="res-score"></div>
        <dl class="res-grid"></dl>
        <div class="res-cash"></div>
        <button class="btn btn--primary" data-act="restart">Ещё заезд</button>
        <button class="btn btn--ghost" data-act="menu">В гараж</button>
      </section>
    </div>`;
  }

  private panelHead(title: string, sub = ''): string {
    return `<header class="panel__head"><div><h2>${title}</h2>${sub ? `<small>${sub}</small>` : ''}</div>
      <button class="icon-btn" data-go="lobby" aria-label="Закрыть">${ICONS.close}</button></header>`;
  }

  private rowHtml(r: Row): string {
    const desc = 'desc' in r && r.desc ? `<small>${r.desc}</small>` : '';
    const hint = r.kind === 'seg' && r.hints ? `<small data-hint="${r.key}"></small>` : '';
    const label = `<div class="row__text"><span>${r.label}</span>${desc}${hint}</div>`;
    let ctl = '';
    switch (r.kind) {
      case 'seg':
        ctl = `<div class="seg${r.icons ? ' seg--icons' : ''}">${r.options
          .map(([v, l]) => `<button class="seg__btn" data-set="${r.key}" data-val="${v}">${r.icons ? driveIcon(v as 'FWD') : ''}<span>${l}</span></button>`)
          .join('')}</div>`;
        break;
      case 'switch':
        ctl = `<button class="switch" data-toggle="${r.key}" role="switch" aria-label="${r.label}"><i></i></button>`;
        break;
      case 'slider':
        ctl = `<div class="range"><input type="range" data-range="${r.key}"${r.lazy ? ' data-lazy="1"' : ''} min="${r.min}" max="${r.max}" step="${r.step}" /><output></output></div>`;
        break;
      case 'info':
        ctl = `<div class="row__info">${r.html}</div>`;
        break;
    }
    return `<div class="row row--${r.kind}">${label}<div class="row__ctl">${ctl}</div></div>`;
  }

  // ---------------------------------------------------------------- events

  private onRange(el: HTMLInputElement, commit: boolean): void {
    if (!el.dataset.range) return;
    const key = el.dataset.range as keyof Settings;
    if (el.dataset.lazy && !commit) {
      this.paintRange(el, Number(el.value));
      return;
    }
    if (!commit || el.dataset.lazy) this.cb.onSettings({ [key]: Number(el.value) } as Partial<Settings>);
  }

  private onClickEvent(e: Event): void {
    const el = (e.target as HTMLElement).closest('button');
    if (!el) return;
    this.cb.onClick();
    const d = el.dataset;
    if (d.car) {
      const n = this.cars.length;
      this.pickCar((this.carIndex + Number(d.car) + n) % n);
    } else if (d.pick) this.pickCar(Number(d.pick));
    else if (d.go) this.go(d.go as Screen);
    else if (d.map) this.cb.onPlay(Number(d.map));
    else if (d.tab) this.selectPage(d.tab);
    else if (d.set) {
      const cur = this.settings[d.set as keyof Settings];
      const val = typeof cur === 'number' ? Number(d.val) : d.val;
      this.cb.onSettings({ [d.set]: val } as Partial<Settings>);
    } else if (d.toggle) {
      const key = d.toggle as keyof Settings;
      this.cb.onSettings({ [key]: !this.settings[key] } as Partial<Settings>);
    } else if (d.cat) {
      this.tuneCat = d.cat as TuneCat;
      this.renderTuning();
    } else if (d.tune) {
      this.cb.onTuning({ [d.tune]: Number(d.value) } as CarTuning);
    } else if (d.shop) {
      this.pickCar(Number(d.shop));
      this.go('lobby');
    } else
      switch (d.act) {
        case 'play':
          this.go('maps');
          break;
        case 'buy':
          this.cb.onBuy(this.carIndex);
          break;
        case 'test':
          this.cb.onTestDrive(this.carIndex);
          break;
        case 'reward':
          this.cb.onReward();
          break;
        case 'factory':
          this.cb.onTuning(null);
          break;
        case 'resume':
          this.cb.onResume();
          break;
        case 'restart':
          this.cb.onRestart();
          break;
        case 'quit':
          this.cb.onQuit();
          break;
        case 'menu':
          this.cb.onMenu();
          break;
      }
  }

  private pickCar(i: number): void {
    if (i === this.carIndex) return;
    this.setCar(i);
    this.cb.onCar(i);
  }

  // ---------------------------------------------------------------- state

  go(screen: Screen): void {
    const car = this.cars[this.carIndex];
    if ((screen === 'tuning' || screen === 'maps') && !this.owned.has(car.id) && !this.testDriveArmed) {
      this.toast(screen === 'tuning' ? 'Тюнинг доступен после покупки машины' : 'Сначала купите машину или возьмите тест-драйв');
      return;
    }
    this.screen = screen;
    this.root.hidden = false;
    this.root.classList.remove('menu--dim');
    for (const [k, el] of Object.entries(this.screens)) el.hidden = k !== screen;
    this.root.dataset.screen = screen;
    for (const b of this.root.querySelectorAll<HTMLElement>('.rail__btn')) b.classList.toggle('rail__btn--on', b.dataset.go === screen);
    if (screen === 'settings') this.selectPage(this.settingsPage);
    if (screen === 'shop') this.renderShop();
    if (screen === 'tuning') this.renderTuning();
    if (screen === 'lobby') this.renderCar();
    this.cb.onScreen(screen);
  }

  /** Set by the game while a paid test drive is pending, so the route screen opens for a car we don't own. */
  testDriveArmed = false;

  /** Esc / close: panels return to the garage. Returns false on the garage itself. */
  back(): boolean {
    if (this.root.hidden || this.screen === 'lobby' || this.screens[this.screen].hidden) return false;
    this.go('lobby');
    return true;
  }

  get current(): Screen | null {
    return this.root.hidden || this.screens[this.screen].hidden ? null : this.screen;
  }

  setPlayerName(name: string): void {
    this.root.querySelector('.profile-name')!.textContent = name;
  }

  setMoney(money: number): void {
    this.money = money;
    this.root.querySelector('.wallet-sum')!.textContent = fmt(money);
    this.renderActions();
    this.renderStrip();
    if (this.screen === 'shop' && !this.screens.shop.hidden) this.renderShop();
  }

  setRewardAmount(sum: number): void {
    this.root.querySelector('.bonus-sum')!.textContent = `+${fmt(sum)}`;
  }

  setGarage(owned: Set<string>, prices: Record<string, number>, stats: CarStats[]): void {
    this.owned = owned;
    this.prices = prices;
    this.stats = stats;
    this.renderCar();
  }

  setCar(index: number): void {
    this.carIndex = index;
    this.renderCar();
    if (this.screen === 'tuning') this.renderTuning();
  }

  setSettings(s: Settings): void {
    this.settings = s;
    for (const btn of this.root.querySelectorAll<HTMLElement>('[data-set]')) {
      btn.classList.toggle('seg__btn--on', String(s[btn.dataset.set as keyof Settings]) === btn.dataset.val);
    }
    for (const btn of this.root.querySelectorAll<HTMLElement>('[data-toggle]')) {
      const on = Boolean(s[btn.dataset.toggle as keyof Settings]);
      btn.classList.toggle('switch--on', on);
      btn.setAttribute('aria-checked', String(on));
    }
    for (const row of PAGES.flatMap((p) => p.rows)) {
      if (row.kind !== 'seg' || !row.hints) continue;
      const i = Math.max(0, row.options.findIndex(([v]) => v === s[row.key]));
      const hint = this.root.querySelector(`[data-hint="${row.key}"]`);
      if (hint) hint.textContent = row.hints[i];
    }
    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-range]')) {
      const v = Number(s[input.dataset.range as keyof Settings]);
      if (document.activeElement !== input) input.value = String(v);
      this.paintRange(input, v);
    }
  }

  private paintRange(input: HTMLInputElement, v: number): void {
    const key = input.dataset.range as keyof Settings;
    const row = PAGES.flatMap((p) => p.rows).find((r) => r.kind === 'slider' && r.key === key) as Extract<Row, { kind: 'slider' }>;
    input.style.setProperty('--p', `${((v - row.min) / (row.max - row.min)) * 100}%`);
    (input.nextElementSibling as HTMLElement).textContent = row.unit(v);
  }

  setTuning(t: CarTuning): void {
    this.tuning = t;
    if (this.screen === 'tuning') this.renderTuning();
  }

  setBest(score: number, km: number): void {
    this.root.querySelector('.car-card__best')!.textContent = score > 0 ? `Рекорд: ${fmt(score)} очков · ${km.toFixed(1)} км` : '';
  }

  /** Model attribution (CC BY requires it to be visible). */
  setCredit(text: string): void {
    this.root.querySelector('.car-card__credit')!.textContent = text;
  }

  /** Short message near the bottom of the screen. */
  toast(text: string): void {
    this.root.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.root.append(el);
    setTimeout(() => el.remove(), 2600);
  }

  private selectPage(id: string): void {
    this.settingsPage = id;
    for (const t of this.root.querySelectorAll<HTMLElement>('.tabs__btn')) t.classList.toggle('tabs__btn--on', t.dataset.tab === id);
    for (const p of this.root.querySelectorAll<HTMLElement>('.page')) p.hidden = p.dataset.page !== id;
  }

  private renderCar(): void {
    const c = this.cars[this.carIndex];
    const st = this.stats[this.carIndex];
    const q = (sel: string) => this.root.querySelector<HTMLElement>(sel)!;
    q('.car-card__idx').textContent = `${this.carIndex + 1} из ${this.cars.length}`;
    q('.car-card__name').textContent = c.name;
    q('.car-card__tag').textContent = c.tagline;
    if (st) {
      const cls = carClass(st.hp);
      const badge = q('.class-badge');
      badge.textContent = `Класс ${cls}`;
      badge.dataset.cls = cls;
      const rows: [string, string, number][] = [
        ['Скорость', `${fmt(st.topKmh)} км/ч`, (st.topKmh - 120) / 200],
        ['Разгон 0–100', `${st.accel.toFixed(1).replace('.', ',')} с`, 1 - (st.accel - 3) / 14],
        ['Мощность', `${fmt(st.hp)} л.с.`, st.hp / 520],
        ['Сцепление', `${c.handling.drivetrain} · ${fmt(st.massKg)} кг`, (c.handling.grip - 7.5) / 5.5],
      ];
      q('.car-card__stats').innerHTML = rows
        .map(([label, value, f]) => {
          const on = Math.max(1, Math.round(clamp01(f) * 10));
          return `<div class="stat"><div class="stat__line"><span>${label}</span><b>${value}</b></div>
            <div class="stat__cells">${'<i class="on"></i>'.repeat(on)}${'<i></i>'.repeat(10 - on)}</div></div>`;
        })
        .join('');
    }
    this.renderActions();
    this.renderStrip();
  }

  private renderActions(): void {
    const c = this.cars[this.carIndex];
    const owned = this.owned.has(c.id);
    const price = this.prices[c.id] ?? 0;
    this.root.querySelector<HTMLElement>('.cta')!.innerHTML = owned
      ? `<button class="btn btn--ghost" data-go="tuning">${ICONS.brush}Тюнинг</button>
         <button class="btn btn--primary btn--big" data-act="play">В путь ${ICONS.arrow}</button>`
      : `<button class="btn btn--ghost" data-act="test">${ICONS.play}Тест-драйв</button>
         <button class="btn btn--primary btn--big${this.money >= price ? '' : ' btn--short'}" data-act="buy">
           Купить<b>${ICONS.coin}${fmt(price)}</b></button>`;
  }

  private renderStrip(): void {
    const track = this.root.querySelector<HTMLElement>('.strip__track');
    if (!track) return;
    track.innerHTML = this.cars
      .map((c, i) => {
        const st = this.stats[i];
        const owned = this.owned.has(c.id);
        const price = this.prices[c.id] ?? 0;
        return `<button class="tile${i === this.carIndex ? ' tile--on' : ''}${owned ? '' : ' tile--locked'}" data-pick="${i}">
          <span class="tile__cls" data-cls="${st ? carClass(st.hp) : ''}">${st ? carClass(st.hp) : ''}</span>
          <b>${c.name}</b>
          <small>${owned ? 'В гараже' : `${ICONS.lock}${fmt(price)}`}</small>
        </button>`;
      })
      .join('');
    const on = track.children[this.carIndex] as HTMLElement | undefined;
    if (on) track.scrollTo({ left: on.offsetLeft - (track.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
  }

  private renderShop(): void {
    this.root.querySelector('.dealer')!.innerHTML = this.cars
      .map((c, i) => {
        const st = this.stats[i];
        const owned = this.owned.has(c.id);
        const price = this.prices[c.id] ?? 0;
        const status = owned ? (i === this.carIndex ? 'Выбрана' : 'В гараже') : `${ICONS.coin}${fmt(price)}`;
        return `<button class="deal${owned ? ' deal--owned' : ''}${i === this.carIndex ? ' deal--on' : ''}" data-shop="${i}">
          <span class="deal__cls" data-cls="${st ? carClass(st.hp) : ''}">${st ? carClass(st.hp) : ''}</span>
          <b>${c.name}</b>
          <small>${st ? `${fmt(st.hp)} л.с. · ${fmt(st.topKmh)} км/ч · ${c.handling.drivetrain}` : ''}</small>
          <em class="${!owned && this.money < price ? 'short' : ''}">${status}</em>
        </button>`;
      })
      .join('');
  }

  private renderTuning(): void {
    for (const b of this.root.querySelectorAll<HTMLElement>('.tune-cat')) b.classList.toggle('tune-cat--on', b.dataset.cat === this.tuneCat);
    const t = this.tuning;
    const swatch = (key: string, value: number, label: string, on: boolean) =>
      `<button class="swatch${on ? ' swatch--on' : ''}" data-tune="${key}" data-value="${value}" title="${label}">
        <span style="--c:${hex(value)}"></span><small>${label}</small></button>`;
    const option = (key: string, value: number, label: string, on: boolean) =>
      `<button class="opt${on ? ' opt--on' : ''}" data-tune="${key}" data-value="${value}">${label}${on ? ICONS.check : ''}</button>`;
    let html = '';
    if (this.tuneCat === 'paint') html = PAINTS.map((p) => swatch('paint', p.color, p.name, t.paint === p.color)).join('');
    else if (this.tuneCat === 'rim') html = RIMS.map((p) => swatch('rim', p.color, p.name, t.rim === p.color)).join('');
    else if (this.tuneCat === 'tint') html = TINTS.map((p) => option('tint', p.value, p.name, (t.tint ?? -1) === p.value)).join('');
    else html = DROPS.map((p) => option('drop', p.value, p.name, (t.drop ?? 0) === p.value)).join('');
    const grid = this.root.querySelector<HTMLElement>('.tune-grid')!;
    grid.classList.toggle('tune-grid--list', this.tuneCat === 'tint' || this.tuneCat === 'drop');
    grid.innerHTML = html;
  }

  // ---------------------------------------------------------------- overlays

  private showDialog(which: 'pause' | 'results' | null): void {
    this.root.hidden = which === null;
    for (const [k, el] of Object.entries(this.screens)) el.hidden = k !== which;
    this.root.classList.toggle('menu--dim', which !== null);
    this.root.dataset.screen = which ?? '';
  }

  showPause(): void {
    this.showDialog('pause');
  }

  hide(): void {
    this.showDialog(null);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  showResults(r: RunResult): void {
    const el = this.screens.results;
    el.querySelector('h2')!.textContent = r.crashed ? 'Авария' : 'Заезд завершён';
    el.querySelector('.res-score')!.innerHTML = `${fmt(r.score)}<small>${r.newBest ? 'новый рекорд!' : 'очков'}</small>`;
    el.querySelector('.res-grid')!.innerHTML = `
      <dt>Дистанция</dt><dd>${r.km.toFixed(2)} км</dd>
      <dt>Опасных обгонов</dt><dd>${r.nearMisses}</dd>
      <dt>Лучшее комбо</dt><dd>×${r.maxCombo.toFixed(2)}</dd>
      <dt>Рекорд</dt><dd>${fmt(r.best)}</dd>`;
    el.querySelector('.res-cash')!.innerHTML = r.testDrive
      ? 'Тест-драйв: кредиты не начисляются'
      : `${ICONS.coin}<b>+${fmt(r.earned)}</b>`;
    this.showDialog('results');
  }
}
