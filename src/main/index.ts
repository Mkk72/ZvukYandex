import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, session, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { toBarViewModel } from '../core/barViewModel';
import type { PlayerCommand } from '../core/commands';
import type { MenuItemModel } from '../core/trayMenuModel';
import { SiteBridge } from './bridge';
import { writeDiagnostics } from './diagnostics';
import { PlayerPresenter, type BarLayout, type IShellActions } from './presenter';
import { loadSettings, saveSettings, settingsFile, type Settings } from './settings';

const APP_DIR = path.resolve(__dirname, '..', '..');
const DATA_DIR = process.env.ZVUKYANDEX_USER_DATA
  ? path.resolve(process.env.ZVUKYANDEX_USER_DATA)
  : path.join(process.env.APPDATA || process.cwd(), 'ZvukYandex');
// В установленной сборке app.asar только для чтения: диагностика идёт в профиль.
const DIAG_DIR = app.isPackaged ? path.join(DATA_DIR, 'diag') : path.join(APP_DIR, '_diag');
// Портативный режим и тесты: можно увести профиль в свою папку, не трогая %APPDATA%.
if (process.env.ZVUKYANDEX_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.ZVUKYANDEX_USER_DATA));
}
const BAR_FILE = path.join(APP_DIR, 'app', 'bar.html');
const PRELOAD_FILE = path.join(__dirname, '..', 'preload', 'bar.js');
const TRAY_ICON = path.join(APP_DIR, 'app', 'tray-32.png');
const APP_ICON = path.join(APP_DIR, 'app', 'icon-256.png');
const SITE_URL = 'https://music.yandex.ru/';
const BAR_HEIGHT = 44;
const WIDE_HEIGHT = 110;

function licenseFile(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'LICENSE.txt') : path.join(APP_DIR, 'LICENSE');
}

// Диагностический лог: файл, потому что stdout GUI-процесса на Windows теряется.
const DIAG_LOG = path.join(DIAG_DIR, 'boot2.log');
function b(message: string): void {
  try {
    fs.mkdirSync(path.dirname(DIAG_LOG), { recursive: true });
    fs.appendFileSync(DIAG_LOG, `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* ignore */
  }
}
process.on('uncaughtException', (e: Error) => b('uncaughtException: ' + (e?.stack || String(e))));
process.on('unhandledRejection', (e: unknown) => b('unhandledRejection: ' + String(e)));
b(`module loaded argv=${process.argv.slice(1).join(' ')}`);

const settings: Settings = loadSettings();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Яндекс настороженно относится к нестандартным клиентам: представляемся
// обычным Chrome, без «Electron» в UA. Это не обход защиты, а нормальный UA.
app.userAgentFallback = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
app.setAppUserModelId('ru.zvukyandex.desktop');

let siteWin: BrowserWindow | null = null;
let barWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let presenter: PlayerPresenter | null = null;
let siteBridge: SiteBridge | null = null;
let quitting = false;
let currentLayout: BarLayout = settings.layout;
let menuOpen = false;
let menuPage: 'main' | 'flows' = 'main';

const MENU_ROW_HEIGHT = 26;
const MENU_SEP_HEIGHT = 9;

function normalBarHeight(): number {
  return currentLayout === 'bar' ? BAR_HEIGHT : WIDE_HEIGHT;
}

function log(message: string): void {
  b(message);
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'app.log'), `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* лог не критичен */
  }
}

function sizeFor(layout: BarLayout): { width: number; height: number } {
  return layout === 'bar'
    ? { width: settings.barWidth, height: BAR_HEIGHT }
    : { width: settings.wideWidth, height: WIDE_HEIGHT };
}

function placeBottomRight(win: BrowserWindow): void {
  const { workArea, id, scaleFactor } = screen.getPrimaryDisplay();
  const [w, h] = win.getSize();
  const x = workArea.x + workArea.width - w - 16;
  const y = workArea.y + workArea.height - h - 16;
  win.setPosition(x, y);
  b(`placeBottomRight display=${id} scale=${scaleFactor} area=${JSON.stringify(workArea)} size=${w}x${h} -> ${x},${y}`);
}

function createSiteWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 880,
    show: !settings.startHidden,
    title: 'ZvukYandex',
    icon: fs.existsSync(APP_ICON) ? APP_ICON : undefined,
    backgroundColor: '#0f1014',
    webPreferences: {
      partition: 'persist:yandex',
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.removeMenu();
  win.on('close', (event) => {
    if (quitting) return;
    // По умолчанию закрытие окна = выход, иначе в диспетчере задач остаётся висеть Electron.
    if (settings.closeToTray) {
      event.preventDefault();
      win.hide();
      presenter?.renderTrayMenu(true);
      return;
    }
    quitting = true;
    app.quit();
  });
  return win;
}

function createBarWindow(): BrowserWindow {
  const { width, height } = sizeFor(currentLayout);
  const bar = new BrowserWindow({
    width,
    height,
    frame: false,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: settings.alwaysOnTop,
    show: true,
    backgroundColor: '#101114',
    title: 'ZvukYandex',
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  bar.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  placeBottomRight(bar);

  bar.on('resize', () => {
    const [w, h] = bar.getSize();
    if (currentLayout === 'bar') {
      if (!menuOpen && h !== BAR_HEIGHT) bar.setBounds({ ...bar.getBounds(), height: BAR_HEIGHT });
      if (w > 200) settings.barWidth = w;
    } else if (w > 200) {
      settings.wideWidth = w;
    }
    saveSettings(settings);
  });

  bar.on('closed', () => {
    barWin = null;
  });
  bar.on('close', () => {
    if (!quitting) {
      quitting = true;
      app.quit();
    }
  });

  void bar.loadFile(BAR_FILE);
  bar.webContents.on('did-finish-load', () => {
    if (currentLayout === 'wide') bar.webContents.send('bar:layout', 'wide');
    if (presenter) bar.webContents.send('bar:state', toBarViewModel(presenter.getState()));
  });
  return bar;
}

function menuItemToTemplate(item: MenuItemModel): Electron.MenuItemConstructorOptions {
  if (item.type === 'separator') return { type: 'separator' };
  const base: Electron.MenuItemConstructorOptions = {
    id: item.id,
    label: item.label,
    enabled: item.enabled,
    click: () => void onMenuItem(item.id)
  };
  if (item.id === 'always-on-top') {
    base.type = 'checkbox';
    base.checked = item.checked;
  }
  return base;
}

/**
 * Меню рисуем внутри окна полосы, а не нативным Menu: на этой машине нативное меню
 * от frameless-окна не всплывает. Окно временно подрастает вверх, полоса остаётся внизу.
 */
function openBarMenu(): void {
  if (!barWin || !presenter || menuOpen) return;
  const items =
    menuPage === 'flows'
      ? presenter.flowMenuItems()
      : (() => {
          const main = presenter.menuItems();
          const sepIndex = main.findIndex((item) => item.id === 'sep-3');
          const flowItem: MenuItemModel = { id: 'flows', label: 'Волна ▸', enabled: true, type: 'normal' };
          if (sepIndex >= 0) main.splice(sepIndex, 0, flowItem);
          else main.push(flowItem);
          return main;
        })();
  const all: MenuItemModel[] = [
    ...items,
    { id: 'sep-extra', label: '', enabled: false, type: 'separator' },
    { id: 'settings', label: 'Настройки…', enabled: true, type: 'normal' },
    { id: 'profile', label: 'Папка профиля', enabled: true, type: 'normal' }
  ];
  const rows = all.filter((item) => item.type !== 'separator').length;
  const seps = all.length - rows;
  const extraHeight = rows * MENU_ROW_HEIGHT + seps * MENU_SEP_HEIGHT + 8;
  const bounds = barWin.getBounds();
  // Флаг ставим ДО setBounds: обработчик resize иначе вернёт высоту полосы.
  menuOpen = true;
  barWin.setBounds({
    x: bounds.x,
    y: bounds.y - extraHeight,
    width: bounds.width,
    height: bounds.height + extraHeight
  });
  barWin.webContents.send('bar:menu', { open: true, items: all });
  barWin.focus();
}

function closeBarMenu(): void {
  if (!barWin || !menuOpen || barWin.isDestroyed()) return;
  menuOpen = false;
  const base = normalBarHeight();
  const bounds = barWin.getBounds();
  const bottom = bounds.y + bounds.height;
  barWin.setBounds({ x: bounds.x, y: bottom - base, width: bounds.width, height: base });
  barWin.webContents.send('bar:menu', { open: false, items: [] });
  menuPage = 'main';
}

async function onMenuItem(id: string): Promise<void> {
  if (id === 'license') {
    await shell.openPath(licenseFile());
    return;
  }
  if (id === 'settings') {
    await shell.openPath(settingsFile());
    return;
  }
  if (id === 'profile') {
    await shell.openPath(path.join(app.getPath('userData'), 'Partitions', 'yandex'));
    return;
  }
  if (!presenter) return;
  if (id === 'flows') {
    await presenter.refreshFlows();
    menuPage = 'flows';
    openBarMenu();
    return;
  }
  if (id === 'menu-back') {
    menuPage = 'main';
    openBarMenu();
    return;
  }
  if (id.startsWith('flow:')) {
    menuPage = 'main';
    await presenter.startFlow(id.slice('flow:'.length));
    return;
  }
  if (id === 'always-on-top') return presenter.toggleAlwaysOnTop();
  if (id === 'autostart') return presenter.toggleAutostart();
  if (id === 'start-flow') return presenter.toggleStartFlowOnLaunch();
  if (id === 'layout') return presenter.toggleLayout();
  await presenter.run(id as PlayerCommand);
}

const shellActions: IShellActions = {
  windowVisible: () => !!siteWin && siteWin.isVisible(),
  layout: () => currentLayout,
  alwaysOnTop: () => !!barWin && barWin.isAlwaysOnTop(),
  autostart: () => !!settings.autostart,
  startFlowOnLaunch: () => !!settings.startFlowOnLaunch,
  currentUrl: () => siteWin?.webContents.getURL() ?? '',
  toggleWindow: () => {
    if (!siteWin) return;
    if (siteWin.isVisible()) {
      siteWin.hide();
    } else {
      siteWin.show();
      siteWin.focus();
    }
    presenter?.renderTrayMenu(true);
  },
  setLayout: (layout: BarLayout) => {
    closeBarMenu();
    currentLayout = layout;
    settings.layout = layout;
    saveSettings(settings);
    b('layout -> ' + layout);
    if (!barWin) return;
    const { width, height } = sizeFor(layout);
    barWin.setSize(width, height);
    placeBottomRight(barWin);
    barWin.webContents.send('bar:layout', layout);
  },
  setAlwaysOnTop: (value: boolean) => {
    settings.alwaysOnTop = value;
    saveSettings(settings);
    barWin?.setAlwaysOnTop(value, 'floating');
  },
  setAutostart: (value: boolean) => {
    settings.autostart = value;
    saveSettings(settings);
    try {
      app.setLoginItemSettings({ openAtLogin: value, args: [] });
    } catch (e) {
      log('setLoginItemSettings failed: ' + String(e));
    }
  },
  setStartFlowOnLaunch: (value: boolean) => {
    settings.startFlowOnLaunch = value;
    saveSettings(settings);
  },
  goHome: async () => {
    if (siteBridge) {
      await siteBridge.goHome();
      return;
    }
    if (!siteWin) return;
    await siteWin.loadURL(SITE_URL);
  },
  quit: () => {
    quitting = true;
    app.quit();
  }
};

function registerShortcuts(): void {
  if (!settings.mediaKeys) return;
  const bindings: Array<[string, () => void]> = [
    ['MediaPlayPause', () => void presenter?.run('toggle')],
    ['MediaNextTrack', () => void presenter?.run('next')],
    ['MediaPreviousTrack', () => void presenter?.run('prev')],
    ['MediaStop', () => void presenter?.run('toggle')],
    ['Control+Alt+Space', () => void presenter?.run('toggle')],
    ['Control+Alt+Right', () => void presenter?.run('next')],
    ['Control+Alt+Left', () => void presenter?.run('prev')],
    ['Control+Alt+L', () => void presenter?.run('like')],
    ['Control+Alt+M', () => presenter?.toggleLayout()],
    ['Control+Alt+Z', () => shellActions.toggleWindow()]
  ];
  for (const [accelerator, handler] of bindings) {
    try {
      globalShortcut.register(accelerator, handler);
    } catch (e) {
      log(`shortcut ${accelerator} failed: ${String(e)}`);
    }
  }
}

async function probeInjection(win: BrowserWindow): Promise<void> {
  try {
    const probe = await win.webContents.executeJavaScript(
      'window.__ym ? { ok: true, handlers: Object.keys(window.__ym.handlers || {}) } : { ok: false }',
      true
    );
    b('injection probe: ' + JSON.stringify(probe));
  } catch (e) {
    b('injection probe failed: ' + String(e));
  }
}

async function bootstrap(): Promise<void> {
  b('bootstrap start');
  Menu.setApplicationMenu(null);

  // Сайт блокирует прокси (HTTP 418), поэтому по умолчанию идём напрямую.
  try {
    const ses = session.fromPartition('persist:yandex');
    await ses.setProxy(settings.proxyDirect ? { mode: 'direct' } : { mode: 'system' });
  } catch (e) {
    log('setProxy failed: ' + String(e));
  }

  siteWin = createSiteWindow();
  b('site window created');
  const bridge = new SiteBridge(siteWin.webContents, b);
  siteBridge = bridge;
  registerShortcuts();
  b('shortcuts registered');

  // Одна настоящая навигация вместо двух: грузим about:blank, ставим инъекцию,
  // потом сразу сайт. Лишняя перезагрузка раздражала антибот-защиту Яндекса.
  await siteWin.loadURL('about:blank');
  b('blank loaded');
  try {
    await bridge.attach();
    b('bridge attached');
  } catch (e) {
    b('bridge attach failed: ' + String(e));
    log('bridge attach failed: ' + String(e));
  }

  await siteWin.loadURL(SITE_URL);
  b('site loaded');
  await probeInjection(siteWin);

  barWin = createBarWindow();
  b('bar window created');
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
  tray.setToolTip('ZvukYandex');
  tray.on('click', () => shellActions.toggleWindow());
  b('tray created');

  presenter = new PlayerPresenter(
    bridge,
    {
      setState: (view) => {
        if (barWin && !barWin.isDestroyed()) barWin.webContents.send('bar:state', view);
      }
    },
    {
      setMenu: (items) => {
        tray?.setContextMenu(Menu.buildFromTemplate(items.map(menuItemToTemplate)));
      },
      setTooltip: (text) => tray?.setToolTip(text ? 'ZvukYandex — ' + text : 'ZvukYandex')
    },
    shellActions,
    500,
    b
  );
  ipcMain.on('bar:command', (_event, command: string) => {
    if (command.startsWith('seek:')) {
      void presenter?.seekRatio(Number(command.slice(5)));
      return;
    }
    if (command.startsWith('volume:')) {
      void presenter?.setVolume(Number(command.slice(7)) / 100);
      return;
    }
    if (command === 'quality') {
      void presenter?.openQuality();
      return;
    }
    void presenter?.run(command as PlayerCommand);
  });
  ipcMain.on('bar:menu', () => {
    if (menuOpen) closeBarMenu();
    else openBarMenu();
  });
  ipcMain.on('bar:menu-select', (_event, id: string) => {
    closeBarMenu();
    void onMenuItem(id);
  });
  ipcMain.on('bar:menu-close', () => closeBarMenu());
  ipcMain.on('bar:ready', () => {
    if (barWin && presenter) barWin.webContents.send('bar:state', toBarViewModel(presenter.getState()));
  });

  presenter.renderTrayMenu(true);
  presenter.start();
  b('presenter started');

  // Автозапуск «Моей волны»: главная уже загружена, поэтому просто ждём отрисовку карточек.
  if (settings.startFlowOnLaunch) {
    setTimeout(() => {
      b('auto-start flow: ' + settings.defaultFlow);
      void presenter?.startFlow(settings.defaultFlow);
    }, 6000);
  }

  // Диагностика и канал команд для отладки без DevTools:
  // пишем состояние в _diag/state.json, читаем команды из _diag/command.txt.
  const diagFile = path.join(DIAG_DIR, 'state.json');
  const commandFile = path.join(DIAG_DIR, 'command.txt');
  const yandexSession = session.fromPartition('persist:yandex');
  setInterval(() => {
    void writeDiagnostics(diagFile, bridge, () => siteWin?.webContents.getURL() ?? '', yandexSession);
  }, 10000);
  setInterval(() => {
    try {
      if (!fs.existsSync(commandFile)) return;
      const raw = fs.readFileSync(commandFile, 'utf8').trim();
      if (!raw) return;
      fs.writeFileSync(commandFile, '', 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const command = line.trim();
        if (!command) continue;
        if (command.startsWith('nav:')) {
          const url = command.slice(4).trim();
          b('command nav: ' + url);
          if (siteWin) void siteWin.loadURL(url);
          continue;
        }
        if (command.startsWith('eval:')) {
          const code = command.slice(5);
          void siteWin?.webContents
            .executeJavaScript(code, true)
            .then((result: unknown) => {
              fs.writeFileSync(path.join(DIAG_DIR, 'eval.json'), JSON.stringify(result, null, 2), 'utf8');
              b('eval ok');
            })
            .catch((e: unknown) => {
              fs.writeFileSync(path.join(DIAG_DIR, 'eval.json'), JSON.stringify({ error: String(e) }), 'utf8');
              b('eval failed: ' + String(e));
            });
          continue;
        }
        if (command === 'menu') {
          b('command menu');
          if (menuOpen) closeBarMenu();
          else openBarMenu();
          continue;
        }
        if (command === 'shot') {
          b('command shot');
          void Promise.all([
            barWin?.webContents.capturePage().then((img) => fs.writeFileSync(path.join(DIAG_DIR, 'shot-bar.png'), img.toPNG())),
            siteWin?.webContents.capturePage().then((img) => fs.writeFileSync(path.join(DIAG_DIR, 'shot-site.png'), img.toPNG()))
          ]).catch((e: unknown) => b('shot failed: ' + String(e)));
          continue;
        }
        if (command === 'layout') {
          b('command layout');
          presenter?.toggleLayout();
          continue;
        }
        if (command === 'flows') {
          b('command flows');
          menuPage = 'flows';
          void presenter?.refreshFlows().then(() => openBarMenu());
          continue;
        }
        if (command.startsWith('flow:')) {
          const title = command.slice('flow:'.length);
          b('command flow: ' + title);
          void presenter?.startFlow(title);
          continue;
        }
        void presenter?.run(command as PlayerCommand);
      }
    } catch (e) {
      b('command channel error: ' + String(e));
    }
  }, 1000);
}

b('requesting single instance lock');
const gotLock = app.requestSingleInstanceLock();
b('lock=' + gotLock);
if (!gotLock) {
  b('no lock, quitting');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (siteWin) {
      siteWin.show();
      siteWin.focus();
    }
  });

  app
    .whenReady()
    .then(() => {
      b('whenReady resolved');
      return bootstrap();
    })
    .catch((e) => {
      b('bootstrap failed: ' + String(e));
      log('bootstrap failed: ' + String(e));
    });

  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    presenter?.stop();
  });

  app.on('activate', () => {
    if (siteWin) siteWin.show();
  });
}
