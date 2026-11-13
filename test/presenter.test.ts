import { describe, expect, it, vi } from 'vitest';
import { PlayerPresenter } from '../src/main/presenter';
import type { SiteBridge } from '../src/main/bridge';
import type { BarViewModel } from '../src/core/barViewModel';
import type { MenuItemModel } from '../src/core/trayMenuModel';
import type { RawSnapshot } from '../src/core/types';

function snapshot(patch: Partial<RawSnapshot> = {}): RawSnapshot {
  return {
    handlers: ['play', 'pause', 'nexttrack', 'previoustrack'],
    metadata: { title: 'Larmes', artist: 'L2Haine' },
    mediaCount: 1,
    media: [
      { tag: 'audio', src: '', paused: false, currentTime: 17, duration: 229, readyState: 4, volume: 1 }
    ],
    playbackState: 'playing',
    ...patch
  };
}

function makeHarness(raw: RawSnapshot | null = snapshot()) {
  const calls: string[] = [];
  const clicks: string[] = [];
  const bridge = {
    snapshot: vi.fn(async () => raw),
    call: vi.fn(async (action: string) => {
      calls.push('call:' + action);
      // Как настоящий мост: если сайт не зарегистрировал обработчик — 'nohandler'.
      const handlers = raw?.handlers ?? [];
      return handlers.includes(action) ? 'ok' : 'nohandler';
    }),
    click: vi.fn(async (action: string) => {
      clicks.push('click:' + action);
      return { clicked: true };
    })
  } as unknown as SiteBridge;

  const views: BarViewModel[] = [];
  const menus: MenuItemModel[][] = [];
  const tooltips: string[] = [];
  let visible = true;
  let layout: 'bar' | 'wide' = 'bar';
  let alwaysOnTop = true;
  let autostart = false;
  let quit = false;

  const presenter = new PlayerPresenter(
    bridge,
    { setState: (view) => views.push(view) },
    {
      setMenu: (items) => menus.push(items),
      setTooltip: (text) => tooltips.push(text)
    },
    {
      windowVisible: () => visible,
      layout: () => layout,
      alwaysOnTop: () => alwaysOnTop,
      autostart: () => autostart,
      startFlowOnLaunch: () => false,
      currentUrl: () => 'https://music.yandex.ru/',
      toggleWindow: () => {
        visible = !visible;
      },
      setLayout: (value) => {
        layout = value;
      },
      setAlwaysOnTop: (value) => {
        alwaysOnTop = value;
      },
      setAutostart: (value) => {
        autostart = value;
      },
      setStartFlowOnLaunch: () => {
        /* в тесте флаг не нужен */
      },
      goHome: async () => {
        /* в тесте навигация не нужна */
      },
      quit: () => {
        quit = true;
      }
    },
    10
  );

  return {
    presenter,
    bridge,
    views,
    menus,
    tooltips,
    calls,
    clicks,
    state: () => ({ get visible() { return visible; }, get layout() { return layout; }, get quit() { return quit; } })
  };
}

describe('PlayerPresenter', () => {
  it('опрос раздаёт модель в мини-плеер и подсказку в трей', async () => {
    const h = makeHarness();
    await h.presenter.poll();
    expect(h.views).toHaveLength(1);
    expect(h.views[0].title).toBe('Larmes');
    expect(h.views[0].artist).toBe('L2Haine');
    expect(h.views[0].playing).toBe(true);
    expect(h.tooltips.at(-1)).toBe('Larmes — L2Haine');
    expect(h.menus.length).toBeGreaterThan(0);
    expect(h.menus.at(-1)?.[0].label).toContain('Larmes — L2Haine');
  });

  it('позиция обновляется каждый опрос, даже когда трек не менялся', async () => {
    const raw = snapshot();
    const h = makeHarness(raw);
    raw.media[0].currentTime = 4;
    await h.presenter.poll();
    raw.media[0].currentTime = 9;
    await h.presenter.poll();
    expect(h.views).toHaveLength(2);
    expect(h.views[0].posText).toBe('0:04');
    expect(h.views[1].posText).toBe('0:09');
  });

  it('toggle при воспроизведении шлёт pause', async () => {
    const h = makeHarness();
    await h.presenter.poll();
    await h.presenter.run('toggle');
    expect(h.calls).toContain('call:pause');
    expect(h.clicks).toHaveLength(0);
  });

  it('toggle на паузе шлёт play', async () => {
    const h = makeHarness(
      snapshot({
        playbackState: 'paused',
        media: [
          { tag: 'audio', src: '', paused: true, currentTime: 3, duration: 100, readyState: 4, volume: 1 }
        ]
      })
    );
    await h.presenter.poll();
    await h.presenter.run('toggle');
    expect(h.calls).toContain('call:play');
  });

  it('next идёт через обработчик сайта', async () => {
    const h = makeHarness();
    await h.presenter.poll();
    await h.presenter.run('next');
    expect(h.calls).toContain('call:nexttrack');
    expect(h.clicks).toHaveLength(0);
  });

  it('если обработчика нет — падаем на DOM-клик', async () => {
    const h = makeHarness(snapshot({ handlers: [] }));
    await h.presenter.poll();
    await h.presenter.run('next');
    expect(h.calls).toContain('call:nexttrack');
    expect(h.clicks).toContain('click:next');
  });

  it('like всегда DOM-клик: в mediaSession такого действия нет', async () => {
    const h = makeHarness();
    await h.presenter.poll();
    await h.presenter.run('like');
    expect(h.clicks).toContain('click:like');
  });

  it('без трека команды не улетают на сайт, кроме toggle', async () => {
    const h = makeHarness({ handlers: [], metadata: null, mediaCount: 0, media: [], playbackState: 'none' });
    await h.presenter.poll();
    await h.presenter.run('next');
    await h.presenter.run('like');
    expect(h.calls).toHaveLength(0);
    expect(h.clicks).toHaveLength(0);
    await h.presenter.run('toggle');
    expect(h.calls).toContain('call:play');
  });

  it('quit и show уходят в оболочку', async () => {
    const h = makeHarness();
    await h.presenter.run('show');
    expect(h.state().visible).toBe(false);
    await h.presenter.run('quit');
    expect(h.state().quit).toBe(true);
  });

  it('переключение формы зовёт shell и обновляет меню', () => {
    const h = makeHarness();
    h.presenter.toggleLayout();
    expect(h.state().layout).toBe('wide');
    const lastMenu = h.menus.at(-1) ?? [];
    expect(lastMenu.some((item) => item.id === 'layout')).toBe(true);
    expect(lastMenu.find((item) => item.id === 'layout')?.label).toContain('полоса');
  });
});
