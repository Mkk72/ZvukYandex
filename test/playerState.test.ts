import { describe, expect, it } from 'vitest';
import { stateFromSnapshot, pickMedia } from '../src/core/playerState';
import type { RawSnapshot } from '../src/core/types';

const raw = (patch: Partial<RawSnapshot> = {}): RawSnapshot => ({
  handlers: [],
  metadata: null,
  mediaCount: 0,
  media: [],
  playbackState: null,
  ...patch
});

describe('stateFromSnapshot', () => {
  it('без снимка даёт пустое состояние, а не падение', () => {
    const s = stateFromSnapshot(null);
    expect(s.hasTrack).toBe(false);
    expect(s.status).toBe('none');
    expect(s.canNext).toBe(false);
  });

  it('берёт трек из mediaSession и считает прогресс', () => {
    const s = stateFromSnapshot(
      raw({
        handlers: ['play', 'pause', 'nexttrack', 'previoustrack'],
        metadata: { title: 'Larmes', artist: 'L2Haine', album: 'X', artwork: ['https://a/b.jpg'] },
        media: [
          {
            tag: 'audio',
            src: 'https://cdn/x.mp3',
            paused: false,
            currentTime: 17,
            duration: 229,
            readyState: 4,
            volume: 1
          }
        ],
        playbackState: 'playing'
      })
    );
    expect(s.track?.title).toBe('Larmes');
    expect(s.track?.artist).toBe('L2Haine');
    expect(s.track?.artwork).toBe('https://a/b.jpg');
    expect(s.status).toBe('playing');
    expect(Math.round(s.position)).toBe(17);
    expect(s.canNext).toBe(true);
    expect(s.canPrev).toBe(true);
    expect(s.progress).toBeCloseTo(17 / 229, 3);
  });

  it('без обработчиков next/prev команды запрещены', () => {
    const s = stateFromSnapshot(
      raw({
        metadata: { title: 't', artist: 'a' },
        media: [
          { tag: 'audio', src: '', paused: true, currentTime: 0, duration: 100, readyState: 2, volume: 1 }
        ],
        playbackState: 'paused'
      })
    );
    expect(s.canNext).toBe(false);
    expect(s.canPrev).toBe(false);
    expect(s.canPlay).toBe(true);
    expect(s.canPause).toBe(false);
  });

  it('длительность 0 не даёт NaN в прогрессе', () => {
    const s = stateFromSnapshot(
      raw({
        media: [
          { tag: 'audio', src: '', paused: true, currentTime: 5, duration: 0, readyState: 1, volume: 1 }
        ]
      })
    );
    expect(s.progress).toBe(0);
    expect(s.duration).toBe(0);
  });

  it('предпочитает играющий элемент самому длинному', () => {
    const picked = pickMedia([
      { tag: 'audio', src: 'a', paused: true, currentTime: 0, duration: 900, readyState: 4, volume: 1 },
      { tag: 'audio', src: 'b', paused: false, currentTime: 3, duration: 120, readyState: 4, volume: 1 }
    ]);
    expect(picked?.src).toBe('b');
  });
});
