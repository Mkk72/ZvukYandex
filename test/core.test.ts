import { describe, expect, it } from 'vitest';
import { formatTime, nowPlayingText, progressOf } from '../src/core/format';
import { canRun, toggleLabel } from '../src/core/commands';
import { buildTrayMenu } from '../src/core/trayMenuModel';
import { stateFromSnapshot } from '../src/core/playerState';
import type { PlayerState } from '../src/core/types';

const playingState: PlayerState = stateFromSnapshot({
  handlers: ['play', 'pause', 'nexttrack', 'previoustrack'],
  metadata: { title: 'Larmes', artist: 'L2Haine' },
  mediaCount: 1,
  media: [
    { tag: 'audio', src: '', paused: false, currentTime: 17, duration: 229, readyState: 4, volume: 1 }
  ],
  playbackState: 'playing'
});

describe('format', () => {
  it('время', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(7)).toBe('0:07');
    expect(formatTime(229)).toBe('3:49');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
  });

  it('подпись «трек — артист»', () => {
    expect(nowPlayingText('A', 'B')).toBe('A — B');
    expect(nowPlayingText('A', '')).toBe('A');
    expect(nowPlayingText('', '')).toBe('Яндекс Музыка');
  });

  it('прогресс не выходит за 0..1', () => {
    expect(progressOf(5, 10)).toBe(0.5);
    expect(progressOf(-1, 10)).toBe(0);
    expect(progressOf(20, 10)).toBe(1);
    expect(progressOf(1, 0)).toBe(0);
  });
});

describe('commands', () => {
  it('лайк и HQ приходят из снимка страницы', () => {
    const state = stateFromSnapshot({
      handlers: ['play', 'pause'],
      metadata: { title: 't', artist: 'a' },
      mediaCount: 1,
      media: [
        { tag: 'audio', src: '', paused: false, currentTime: 1, duration: 100, readyState: 4, volume: 1 }
      ],
      playbackState: 'playing',
      liked: true,
      hq: true
    });
    expect(state.liked).toBe(true);
    expect(state.hq).toBe(true);
  });

  it('обложка берётся самая крупная, а не первая', () => {
    const state = stateFromSnapshot({
      handlers: [],
      metadata: { title: 't', artist: 'a', artwork: ['https://x/40x40', 'https://x/400x400'] },
      mediaCount: 0,
      media: [],
      playbackState: 'paused'
    });
    expect(state.track?.artwork).toBe('https://x/400x400');
  });

  it('next разрешён при наличии трека даже без обработчика (пойдёт DOM-клик)', () => {
    const paused = stateFromSnapshot({
      handlers: [],
      metadata: { title: 't', artist: 'a' },
      mediaCount: 1,
      media: [
        { tag: 'audio', src: '', paused: true, currentTime: 0, duration: 100, readyState: 3, volume: 1 }
      ],
      playbackState: 'paused'
    });
    expect(canRun('next', paused)).toBe(true);
    expect(paused.canNext).toBe(false);
    expect(canRun('toggle', paused)).toBe(true);
    expect(canRun('show', paused)).toBe(true);
  });

  it('next запрещён, когда трека нет вовсе', () => {
    const empty = stateFromSnapshot(null);
    expect(canRun('next', empty)).toBe(false);
    expect(canRun('prev', empty)).toBe(false);
  });

  it('подпись кнопки зависит от статуса', () => {
    expect(toggleLabel(playingState)).toBe('Пауза');
  });
});

describe('tray menu', () => {
  it('первая строка — что играет, последняя — выход', () => {
    const menu = buildTrayMenu(playingState, { windowVisible: true });
    expect(menu[0].label).toContain('Larmes — L2Haine');
    expect(menu[0].label).toContain('0:17');
    expect(menu[menu.length - 1].id).toBe('quit');
  });

  it('пункты next/prev активны, когда есть обработчики', () => {
    const menu = buildTrayMenu(playingState, { windowVisible: false });
    const byId = (id: string) => menu.find((m) => m.id === id);
    expect(byId('next')?.enabled).toBe(true);
    expect(byId('prev')?.enabled).toBe(true);
    expect(byId('toggle')?.label).toBe('Пауза');
    expect(byId('show')?.label).toBe('Показать окно');
    expect(byId('wave')?.label).toContain('Мою волну');
    expect(byId('quality')?.enabled).toBe(true);
  });

  it('без трека подписи говорят «ничего не играет» и кнопки выключены', () => {
    const empty = stateFromSnapshot(null);
    const menu = buildTrayMenu(empty, { windowVisible: true });
    expect(menu[0].label).toBe('Ничего не играет');
    expect(menu.find((m) => m.id === 'next')?.enabled).toBe(false);
    expect(menu.find((m) => m.id === 'show')?.label).toBe('Скрыть окно');
  });
});
