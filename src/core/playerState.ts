import { progressOf } from './format';
import type { PlayerState, PlaybackStatus, RawSnapshot, RawMedia } from './types';

/** Действия, которые умеет вызывать mediaSession (стандарт). */
export const MEDIA_ACTIONS = ['play', 'pause', 'nexttrack', 'previoustrack'] as const;
export type MediaAction = (typeof MEDIA_ACTIONS)[number];

/**
 * Выбираем элемент, по которому считаем позицию: сначала тот, что реально играет,
 * иначе самый длинный (на странице бывают служебные/рекламные audio).
 */
export function pickMedia(media: RawMedia[]): RawMedia | null {
  if (!media || media.length === 0) return null;
  const withDuration = media.filter((m) => Number.isFinite(m.duration) && m.duration > 0);
  const pool = withDuration.length > 0 ? withDuration : media;
  const playing = pool.find((m) => !m.paused);
  if (playing) return playing;
  return pool.reduce((best, m) => (m.duration > best.duration ? m : best), pool[0]);
}

function statusOf(raw: RawSnapshot, media: RawMedia | null): PlaybackStatus {
  if (raw.playbackState === 'playing' || raw.playbackState === 'paused') return raw.playbackState;
  if (media) return media.paused ? 'paused' : 'playing';
  return 'none';
}

/**
 * Позиция. Источники по убыванию надёжности: элемент <audio>/<video> с известной
 * длительностью, затем setPositionState (сайт играет через Web Audio и элемента
 * может не быть). В positionState позиция — на момент `at`, её надо досчитать.
 */
function positionOf(
  raw: RawSnapshot,
  media: RawMedia | null,
  status: PlaybackStatus,
  now: number
): { position: number; duration: number } {
  if (media && Number.isFinite(media.duration) && media.duration > 0) {
    return { position: Math.max(0, media.currentTime), duration: media.duration };
  }
  const ps = raw.positionState;
  if (!ps || !Number.isFinite(ps.position) || !Number.isFinite(ps.duration) || ps.duration <= 0) {
    return { position: media ? Math.max(0, media.currentTime) : 0, duration: media?.duration ?? 0 };
  }
  const elapsed = status === 'playing' ? Math.max(0, (now - ps.at) / 1000) : 0;
  const rate = Number.isFinite(ps.rate) && ps.rate ? ps.rate : 1;
  const position = Math.min(ps.duration, Math.max(0, ps.position + elapsed * rate));
  return { position, duration: ps.duration };
}

/**
 * Снимок со страницы → модель состояния. null (страница не загрузилась, мост не готов)
 * даёт пустое состояние, а не падение.
 */
export function stateFromSnapshot(raw: RawSnapshot | null, now: number = Date.now()): PlayerState {
  if (!raw) {
    return {
      track: null,
      status: 'none',
      position: 0,
      duration: 0,
      progress: 0,
      canPlay: false,
      canPause: false,
      canNext: false,
      canPrev: false,
      hasTrack: false,
      volume: 1,
      hq: false,
      liked: false
    };
  }

  const media = pickMedia(raw.media ?? []);
  const meta = raw.metadata;
  const title = (meta?.title ?? '').trim();
  const artist = (meta?.artist ?? '').trim();
  const artwork = [...(meta?.artwork ?? [])].reverse().find((src) => !!src) ?? null;
  const rawStatus = statusOf(raw, media);
  const { position, duration } = positionOf(raw, media, rawStatus, now);
  const handlers = new Set(raw.handlers ?? []);
  // У Яндекс Музыки mediaSession.playbackState = 'paused' ещё до первого трека,
  // поэтому одного playbackState мало: трек есть, только если есть название или длительность.
  const hasTrack = !!title || duration > 0;
  const status = hasTrack ? rawStatus : 'none';

  return {
    track: title || artist ? { title, artist, album: (meta?.album ?? '').trim(), artwork } : null,
    status,
    position,
    duration,
    progress: progressOf(position, duration),
    canPlay: hasTrack && (handlers.has('play') || rawStatus === 'paused'),
    canPause: hasTrack && (handlers.has('pause') || rawStatus === 'playing'),
    canNext: hasTrack && handlers.has('nexttrack'),
    canPrev: hasTrack && handlers.has('previoustrack'),
    hasTrack,
    volume:
      typeof raw.volume === 'number'
        ? Math.max(0, Math.min(1, raw.volume))
        : media && Number.isFinite(media.volume)
          ? media.volume
          : 1,
    hq: !!raw.hq,
    liked: !!raw.liked
  };
}
