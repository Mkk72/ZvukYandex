import { canRun, type PlayerCommand } from './commands';
import { formatTime, nowPlayingText } from './format';
import type { PlayerState } from './types';

export interface MenuItemModel {
  id: string;
  label: string;
  enabled: boolean;
  type: 'normal' | 'separator';
  checked?: boolean;
}

export interface TrayMenuOptions {
  windowVisible: boolean;
  alwaysOnTop?: boolean;
  layout?: 'bar' | 'wide';
  autostart?: boolean;
  startFlowOnLaunch?: boolean;
}

/**
 * Модель меню трея. Строится без Electron — тестируется как массив.
 * Первая строка — «что играет», дальше команды, последним «Выход».
 */
export function buildTrayMenu(state: PlayerState, options: TrayMenuOptions): MenuItemModel[] {
  const items: MenuItemModel[] = [];
  const title = state.track ? nowPlayingText(state.track.title, state.track.artist) : 'Ничего не играет';
  const time =
    state.duration > 0 ? ` (${formatTime(state.position)} / ${formatTime(state.duration)})` : '';

  items.push({ id: 'now-playing', label: title + time, enabled: false, type: 'normal' });
  items.push({ id: 'sep-1', label: '', enabled: false, type: 'separator' });

  const add = (id: PlayerCommand, label: string): void => {
    items.push({ id, label, enabled: canRun(id, state), type: 'normal' });
  };

  add('wave', 'Включить Мою волну');
  add('toggle', state.status === 'playing' ? 'Пауза' : 'Воспроизвести');
  add('prev', 'Предыдущий трек');
  add('next', 'Следующий трек');
  add('like', 'Нравится');
  add('dislike', 'Не нравится');
  items.push({ id: 'sep-2', label: '', enabled: false, type: 'separator' });
  add('repeat', 'Повтор');
  add('queue', 'Очередь воспроизведения');
  add('quality', 'Настройки звука');

  items.push({ id: 'sep-3', label: '', enabled: false, type: 'separator' });
  items.push({
    id: 'show',
    label: options.windowVisible ? 'Скрыть окно' : 'Показать окно',
    enabled: true,
    type: 'normal'
  });
  items.push({
    id: 'always-on-top',
    label: 'Поверх всех окон',
    enabled: true,
    type: 'normal',
    checked: !!options.alwaysOnTop
  });
  items.push({
    id: 'layout',
    label: options.layout === 'wide' ? 'Вид: компактная полоса' : 'Вид: широкая плашка',
    enabled: true,
    type: 'normal'
  });
  items.push({
    id: 'autostart',
    label: 'Запускать с Windows',
    enabled: true,
    type: 'normal',
    checked: !!options.autostart
  });
  items.push({
    id: 'start-flow',
    label: 'Запускать «Мою волну» при старте',
    enabled: true,
    type: 'normal',
    checked: !!options.startFlowOnLaunch
  });
  items.push({ id: 'sep-4', label: '', enabled: false, type: 'separator' });
  items.push({ id: 'license', label: 'Лицензия…', enabled: true, type: 'normal' });
  add('quit', 'Выход');
  return items;
}
