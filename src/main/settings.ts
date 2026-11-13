import * as fs from 'node:fs';
import * as path from 'node:path';

export type BarLayout = 'bar' | 'wide';

export interface Settings {
  /** На этой машине Chromium-песочница Electron не стартует — см. NOTES-spike.md. */
  noSandbox: boolean;
  /** Если системный прокси мешает сайту — по умолчанию идём напрямую. */
  proxyDirect: boolean;
  alwaysOnTop: boolean;
  layout: BarLayout;
  barWidth: number;
  wideWidth: number;
  closeToTray: boolean;
  mediaKeys: boolean;
  startHidden: boolean;
  /** Запускать вместе с Windows (ярлык в автозагрузке). */
  autostart: boolean;
  /** Сразу включать «Мою волну» при запуске приложения. */
  startFlowOnLaunch: boolean;
  /** Какую волну/подборку запускать: название с главной сайта. */
  defaultFlow: string;
}

export const DEFAULT_SETTINGS: Settings = {
  noSandbox: true,
  proxyDirect: true,
  alwaysOnTop: true,
  layout: 'bar',
  barWidth: 520,
  wideWidth: 420,
  closeToTray: false,
  mediaKeys: true,
  startHidden: false,
  autostart: false,
  startFlowOnLaunch: false,
  defaultFlow: 'Моя волна'
};

/** Файл настроек рядом с профилем приложения. Чистый fs — можно читать до app.ready. */
export function settingsFile(): string {
  if (process.env.ZVUKYANDEX_USER_DATA) {
    return path.join(path.resolve(process.env.ZVUKYANDEX_USER_DATA), 'settings.json');
  }
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd();
  return path.join(base, 'ZvukYandex', 'settings.json');
}

export function loadSettings(file = settingsFile()): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings, file = settingsFile()): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    /* настройки не критичны: не смогли — работаем на дефолтах */
  }
}
