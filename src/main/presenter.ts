import { canRun, type PlayerCommand } from '../core/commands';
import { nowPlayingText } from '../core/format';
import { toBarViewModel, type BarViewModel } from '../core/barViewModel';
import { stateFromSnapshot } from '../core/playerState';
import { buildTrayMenu, type MenuItemModel } from '../core/trayMenuModel';
import { EMPTY_STATE, type PlayerState } from '../core/types';
import type { DomAction, SiteBridge } from './bridge';

export type BarLayout = 'bar' | 'wide';

/** Что презентер хочет от мини-плеера. Реализация — в main, с Electron. */
export interface IBarView {
  setState(view: BarViewModel): void;
}

/** Что презентер хочет от трея. */
export interface ITrayView {
  setMenu(items: MenuItemModel[]): void;
  setTooltip(text: string): void;
}

/** Возможности оболочки, которые презентер не должен знать по классам. */
export interface IShellActions {
  windowVisible(): boolean;
  layout(): BarLayout;
  alwaysOnTop(): boolean;
  autostart(): boolean;
  startFlowOnLaunch(): boolean;
  /** Текущий адрес страницы: по нему видно антибот-заглушку. */
  currentUrl(): string;
  toggleWindow(): void;
  setLayout(layout: BarLayout): void;
  setAlwaysOnTop(value: boolean): void;
  setAutostart(value: boolean): void;
  setStartFlowOnLaunch(value: boolean): void;
  /** Перейти на главную сайта и дождаться загрузки. */
  goHome(): Promise<void>;
  quit(): void;
}

function signature(state: PlayerState): string {
  return [
    state.track?.title ?? '',
    state.track?.artist ?? '',
    state.status,
    state.canNext,
    state.canPrev,
    state.hasTrack,
    state.liked,
    state.hq,
    Math.round(state.duration)
  ].join('|');
}

/**
 * Презентер: опрашивает мост, превращает снимок в состояние, раздаёт его видам
 * и исполняет команды. Ни одного импорта Electron — тестируется с фейковыми видами.
 */
export class PlayerPresenter {
  private state: PlayerState = EMPTY_STATE;
  private timer: NodeJS.Timeout | null = null;
  private lastSignature = '';
  private lastMenuSignature = '';

  constructor(
    private readonly bridge: SiteBridge,
    private readonly bar: IBarView,
    private readonly tray: ITrayView,
    private readonly shell: IShellActions,
    private readonly pollMs = 500,
    private readonly logger: (message: string) => void = () => {}
  ) {}

  getState(): PlayerState {
    return this.state;
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Один цикл опроса. Публичный, чтобы можно было дёрнуть из теста/диагностики. */
  async poll(): Promise<PlayerState> {
    const url = this.shell.currentUrl();
    // Яндекс может увести на вход или капчу. Не перезагружаем страницу сами:
    // частые запросы как раз и приводят к блокировке. Просто говорим, что делать.
    if (/passport\.yandex\.ru|\/auth\b/.test(url)) {
      const idle = toBarViewModel(EMPTY_STATE);
      this.bar.setState({
        ...idle,
        title: 'Яндекс Музыка',
        artist: 'войдите в аккаунт в окне сайта',
        canToggle: false,
        canNext: false,
        canPrev: false
      });
      return EMPTY_STATE;
    }
    if (/showcaptcha|checkcaptcha|smartcaptcha/i.test(url)) {
      const idle = toBarViewModel(EMPTY_STATE);
      this.bar.setState({
        ...idle,
        title: 'Яндекс Музыка',
        artist: 'Яндекс просит подтвердить вход — откройте окно',
        canToggle: false,
        canNext: false,
        canPrev: false
      });
      return EMPTY_STATE;
    }
    const raw = await this.bridge.snapshot();
    const next = stateFromSnapshot(raw);
    const sig = signature(next);
    // Позицию и прогресс показываем каждый опрос: иначе время в плашке
    // замирает между сменами трека (в signature его нет).
    this.state = next;
    this.bar.setState(toBarViewModel(next));
    if (sig !== this.lastSignature) {
      this.lastSignature = sig;
      this.tray.setTooltip(nowPlayingText(next.track?.title ?? '', next.track?.artist ?? ''));
      this.renderTrayMenu();
    }
    return next;
  }

  /** Пункты меню в текущем состоянии — их используют и трей, и кнопка меню на плашке. */
  menuItems(): MenuItemModel[] {
    return buildTrayMenu(this.state, {
      windowVisible: this.shell.windowVisible(),
      alwaysOnTop: this.shell.alwaysOnTop(),
      layout: this.shell.layout(),
      autostart: this.shell.autostart(),
      startFlowOnLaunch: this.shell.startFlowOnLaunch()
    });
  }

  renderTrayMenu(force = false): void {
    const items = this.menuItems();
    const sig = items.map((i) => `${i.id}:${i.label}:${i.enabled ? 1 : 0}:${i.checked ? 1 : 0}`).join('|') + this.shell.layout();
    if (!force && sig === this.lastMenuSignature) return;
    this.lastMenuSignature = sig;
    this.tray.setMenu(items);
  }

  /** Клик по кнопке сайта с одной повторной попыткой: панель может ещё не смонтироваться. */
  private async clickWithRetry(action: DomAction): Promise<void> {
    const first = await this.bridge.click(action);
    if (first.clicked) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
    await this.bridge.click(action);
  }

  /** Волны: «Моя волна» по умолчанию, дальше то, что нашлось на странице. */
  private flows: string[] = ['Моя волна', 'Незнакомое', 'Для вас и Тренды'];

  async refreshFlows(): Promise<string[]> {
    const discovered = await this.bridge.listFlows();
    if (discovered.length > 0) this.flows = discovered;
    return this.flows;
  }

  flowMenuItems(): MenuItemModel[] {
    const items: MenuItemModel[] = this.flows.map((title) => ({
      id: 'flow:' + title,
      label: title,
      enabled: true,
      type: 'normal'
    }));
    items.push({ id: 'sep-flows', label: '', enabled: false, type: 'separator' });
    items.push({ id: 'menu-back', label: '← Назад', enabled: true, type: 'normal' });
    return items;
  }

  /** Перемотка по доле 0..1 от длительности. */
  async seekRatio(ratio: number): Promise<void> {
    const duration = this.state.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const seconds = Math.max(0, Math.min(1, ratio)) * duration;
    await this.bridge.seek(seconds);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await this.poll();
  }

  async setVolume(value: number): Promise<void> {
    await this.bridge.setVolume(Math.max(0, Math.min(1, value)));
    await this.poll();
  }

  /** Открыть настройки звука сайта (кнопка HQ на плашке). */
  async openQuality(): Promise<void> {
    await this.bridge.click('quality');
    await new Promise((resolve) => setTimeout(resolve, 500));
    await this.poll();
  }

  /**
   * Запустить «Мою волну» или подборку. Без каскада повторных кликов:
   * Яндекс считает частые автоклики подозрительными. Максимум две попытки.
   */
  async startFlow(title: string): Promise<void> {
    const before = this.state.track?.title ?? '';
    await this.shell.goHome();
    const card = await this.bridge.clickFlowCard(title);
    if (!card.ok) {
      this.logger('flow: card not found ' + title);
      return;
    }
    this.logger('flow: card clicked ' + title + ' before=' + before);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    let clicks = 0;
    for (let i = 0; i < 8; i++) {
      const state = await this.poll();
      const current = state.track?.title ?? '';
      this.logger(`flow: wait ${i} status=${state.status} title=${current || '-'}`);
      // Старый трек мог продолжать играть, поэтому «playing» само по себе
      // не признак успеха: ждём, что сменился трек.
      if (state.status === 'playing' && current && current !== before) {
        this.logger('flow: playing');
        return;
      }
      if (clicks < 2 && (i === 0 || i === 4)) {
        const res = await this.bridge.clickStartButton();
        this.logger('flow: start click ' + JSON.stringify(res));
        if (res.ok) clicks++;
      }
      await new Promise((resolve) => setTimeout(resolve, 1300));
    }
    this.logger('flow: no track change for ' + title);
  }

  /** Единая точка исполнения команд из трея, мини-плеера и горячих клавиш. */
  async run(command: PlayerCommand): Promise<void> {
    if (command === 'quit') return this.shell.quit();
    if (command === 'show') return this.shell.toggleWindow();

    if (!canRun(command, this.state)) {
      // На most команды без трека бессмысленны, но play/pause при пустой плашке
      // может понадобиться, чтобы запустить воспроизведение в самом сайте.
      if (command !== 'toggle') return;
    }

    switch (command) {
      case 'toggle': {
        const action = this.state.status === 'playing' ? 'pause' : 'play';
        const res = await this.bridge.call(action);
        if (res === 'nohandler' || res === 'nobridge' || res.startsWith('error')) {
          await this.bridge.click(action);
        }
        break;
      }
      case 'next': {
        const res = await this.bridge.call('nexttrack');
        if (res !== 'ok') await this.clickWithRetry('next');
        break;
      }
      case 'prev': {
        const res = await this.bridge.call('previoustrack');
        if (res !== 'ok') await this.clickWithRetry('prev');
        break;
      }
      case 'like':
        await this.bridge.click('like');
        break;
      case 'dislike':
        await this.bridge.click('dislike');
        break;
      case 'repeat':
        await this.bridge.click('repeat');
        break;
      case 'queue':
        await this.bridge.click('queue');
        break;
      case 'quality':
        await this.bridge.click('quality');
        break;
      case 'wave':
        await this.startFlow('Моя волна');
        break;
      default:
        break;
    }
    await this.poll();
  }

  /** Переключить форму мини-плеера (трей/горячая клавиша). */
  toggleLayout(): void {
    this.shell.setLayout(this.shell.layout() === 'bar' ? 'wide' : 'bar');
    this.renderTrayMenu(true);
  }

  toggleAlwaysOnTop(): void {
    this.shell.setAlwaysOnTop(!this.shell.alwaysOnTop());
    this.renderTrayMenu(true);
  }

  toggleAutostart(): void {
    this.shell.setAutostart(!this.shell.autostart());
    this.renderTrayMenu(true);
  }

  toggleStartFlowOnLaunch(): void {
    this.shell.setStartFlowOnLaunch(!this.shell.startFlowOnLaunch());
    this.renderTrayMenu(true);
  }
}
