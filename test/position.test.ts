import { describe, expect, it } from 'vitest';
import { stateFromSnapshot } from '../src/core/playerState';
import type { RawSnapshot } from '../src/core/types';

function snap(patch: Partial<RawSnapshot> = {}): RawSnapshot {
  return {
    handlers: ['play', 'pause'],
    metadata: { title: 'Nothing Else Matters', artist: 'Metallica' },
    mediaCount: 0,
    media: [],
    playbackState: 'playing',
    ...patch
  };
}

describe('позиция из setPositionState', () => {
  const now = 1_000_000;

  it('досчитывает позицию по времени с момента сообщения', () => {
    const state = stateFromSnapshot(
      snap({
        positionState: { position: 10, duration: 100, rate: 1, at: now - 5000 },
        media: []
      }),
      now
    );
    expect(state.duration).toBe(100);
    expect(Math.round(state.position)).toBe(15);
    expect(state.progress).toBeCloseTo(0.15, 2);
  });

  it('на паузе не досчитывает', () => {
    const state = stateFromSnapshot(
      snap({
        playbackState: 'paused',
        positionState: { position: 10, duration: 100, rate: 1, at: now - 5000 }
      }),
      now
    );
    expect(Math.round(state.position)).toBe(10);
  });

  it('не выходит за длительность', () => {
    const state = stateFromSnapshot(
      snap({ positionState: { position: 99, duration: 100, rate: 2, at: now - 5000 } }),
      now
    );
    expect(state.position).toBe(100);
  });

  it('элемент audio важнее positionState', () => {
    const state = stateFromSnapshot(
      snap({
        positionState: { position: 10, duration: 100, rate: 1, at: now },
        mediaCount: 1,
        media: [
          { tag: 'audio', src: '', paused: false, currentTime: 42, duration: 200, readyState: 4, volume: 1 }
        ]
      }),
      now
    );
    expect(state.position).toBe(42);
    expect(state.duration).toBe(200);
  });

  it('без источников позиция нулевая, а не NaN', () => {
    const state = stateFromSnapshot(snap({ playbackState: 'none' }), now);
    expect(state.position).toBe(0);
    expect(state.duration).toBe(0);
    expect(state.progress).toBe(0);
  });
});
