import type { PlayerState } from './types';

/** Команды, которые приходят из трея, мини-плеера и горячих клавиш. */
export type PlayerCommand =
  | 'toggle'
  | 'next'
  | 'prev'
  | 'like'
  | 'dislike'
  | 'repeat'
  | 'queue'
  | 'quality'
  | 'wave'
  | 'show'
  | 'quit';

/**
 * Разрешена ли команда в текущем состоянии. Единственное место, где это решается:
 * и трей, и мини-плеер, и горячие клавиши спрашивают здесь, а не у себя.
 */
export function canRun(command: PlayerCommand, state: PlayerState): boolean {
  switch (command) {
    case 'toggle':
      return state.canPlay || state.canPause;
    // Next/prev разрешены, пока есть трек: если обработчика mediaSession нет,
    // презентер пробует DOM-клик по кнопке сайта. Запрещать заранее — терять
    // рабочий сценарий на сайтах, где обработчики не регистрируются.
    case 'next':
    case 'prev':
      return state.hasTrack || state.canNext || state.canPrev;
    case 'like':
    case 'dislike':
      return state.hasTrack;
    case 'repeat':
    case 'queue':
    case 'quality':
      return state.hasTrack;
    case 'wave':
      return true;
    case 'show':
    case 'quit':
      return true;
    default:
      return false;
  }
}

/** Заголовок кнопки play/pause для UI: что произойдёт по нажатию. */
export function toggleLabel(state: PlayerState): string {
  return state.status === 'playing' ? 'Пауза' : 'Воспроизвести';
}
