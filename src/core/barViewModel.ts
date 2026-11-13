import { formatTime } from './format';
import type { PlayerState } from './types';

/**
 * Готовые строки для мини-плеера. Рендер ничего не считает и не форматирует:
 * всё, что требует логики, приходит сюда — так UI остаётся глупым.
 */
export interface BarViewModel {
  title: string;
  artist: string;
  artwork: string | null;
  playing: boolean;
  posText: string;
  durText: string;
  /** 0..100, уже округлённый процент. */
  progressPct: number;
  hasTrack: boolean;
  canToggle: boolean;
  canNext: boolean;
  canPrev: boolean;
  liked: boolean;
  /** 0..100 для ползунка громкости. */
  volumePct: number;
  hq: boolean;
}

export function toBarViewModel(state: PlayerState): BarViewModel {
  const title = state.track?.title?.trim() || 'Яндекс Музыка';
  const artist = state.track?.artist?.trim() || (state.hasTrack ? '' : 'ничего не играет');
  return {
    title,
    artist,
    artwork: state.track?.artwork ?? null,
    playing: state.status === 'playing',
    posText: formatTime(state.position),
    durText: formatTime(state.duration),
    progressPct: Math.round(state.progress * 1000) / 10,
    hasTrack: state.hasTrack,
    canToggle: state.canPlay || state.canPause,
    // Кнопки переключения включаем по наличию трека: если обработчика mediaSession
    // нет, презентер кликнет по кнопке сайта.
    canNext: state.hasTrack,
    canPrev: state.hasTrack,
    liked: state.liked,
    volumePct: Math.round((state.volume ?? 1) * 100),
    hq: state.hq
  };
}
