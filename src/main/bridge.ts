import type { WebContents } from 'electron';
import { MEDIA_BRIDGE_SOURCE } from './injection';
import type { RawSnapshot } from '../core/types';
import type { MediaAction } from '../core/playerState';

export type DomAction =
  | 'play'
  | 'pause'
  | 'like'
  | 'dislike'
  | 'repeat'
  | 'queue'
  | 'quality'
  | 'next'
  | 'prev';

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

const DOM_PATTERNS: Record<DomAction, string> = {
  play: 'воспроизвест|слушать|play',
  pause: 'пауза|pause',
  like: 'нравится|liked|like',
  dislike: 'не нравится|dislike',
  repeat: 'повтор|repeat',
  queue: 'очеред|queue',
  quality: 'качеств|quality|hq',
  next: 'следующ|next',
  prev: 'предыдущ|prev'
};

/**
 * Кнопки Яндекс Музыки подписаны aria-label, а не классами: это устойчивее
 * к редизайну (классы — CSS-модули с хешами). Сначала ищем в нижней панели
 * плеера, чтобы не нажать такую же кнопку на карточке в ленте.
 */
export const __domPatternsForDiag = DOM_PATTERNS;

function domClickScript(action: DomAction): string {
  return `(async () => {
    const action = ${JSON.stringify(action)};
    const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
    const player = document.querySelector('section[aria-label="Плеер"]')
      || document.querySelector('[class*="VibePlayerBar_root"]');
    const scope = player || document;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const buttons = (root) => Array.from(root.querySelectorAll('button,[role="button"]')).filter(visible);
    const byAria = (root, re) => buttons(root).find((b) => re.test(norm(b.getAttribute('aria-label'))));
    const clickButton = (b, how) => {
      if (!b) return null;
      b.click();
      return { clicked: true, how: how, aria: norm(b.getAttribute('aria-label')).slice(0, 40) };
    };
    const openContextMenu = () => {
      const b = byAria(scope, /^Контекстное меню$/i) || byAria(document, /^Контекстное меню$/i);
      if (!b) return false;
      b.click();
      return true;
    };
    const menuItems = () => Array.from(document.querySelectorAll('[role="menuitem"],button')).filter(visible);
    const clickMenuItem = (re, delay) => new Promise((resolve) => {
      setTimeout(() => {
        const item = menuItems().find((el) => re.test(norm(el.textContent || el.innerText)));
        if (!item) return resolve(false);
        item.click();
        resolve(true);
      }, delay);
    });

    if (action === 'play' || action === 'pause') {
      const labels = action === 'play' ? /^(Воспроизведение|Слушать|Играть)$/i : /^Пауза$/i;
      const inBar = byAria(scope, labels);
      if (inBar) return clickButton(inBar, 'player-bar');
      // Ничего не играло: на странице альбома/плейлиста большая кнопка запуска.
      const pageButtons = buttons(document).filter((b) => labels.test(norm(b.getAttribute('aria-label'))));
      pageButtons.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return rb.width * rb.height - ra.width * ra.height;
      });
      return clickButton(pageButtons[0], 'page-play') || { clicked: false, reason: 'no-play-button' };
    }

    const transport = {
      next: /^(Следующая песня|Следующий трек)$/i,
      prev: /^(Предыдущая песня|Предыдущий трек)$/i,
      like: /^Нравится$/i,
      dislike: /^Не нравится$/i
    };
    if (transport[action]) {
      const hit = byAria(scope, transport[action]) || byAria(document, transport[action]);
      if (!hit) return { clicked: false, reason: 'no-target', action: action };
      return clickButton(hit, 'aria');
    }

    if (action === 'queue') {
      if (!openContextMenu()) return { clicked: false, reason: 'no-context-menu' };
      const ok = await clickMenuItem(/^Открыть очередь$/i, 260);
      return ok ? { clicked: true, how: 'context-menu' } : { clicked: false, reason: 'no-queue-item' };
    }

    if (action === 'repeat') {
      if (!openContextMenu()) return { clicked: false, reason: 'no-context-menu' };
      const ok = await clickMenuItem(/^Повторять$/i, 260);
      return ok ? { clicked: true, how: 'context-menu-repeat' } : { clicked: false, reason: 'no-repeat-item' };
    }

    if (action === 'quality') {
      if (!openContextMenu()) return { clicked: false, reason: 'no-context-menu' };
      const ok = await clickMenuItem(/^Настройки звука$/i, 260);
      return ok ? { clicked: true, how: 'context-menu-quality' } : { clicked: false, reason: 'no-quality-item' };
    }

    return { clicked: false, reason: 'unknown-action' };
  })()`;
}

/** Мост к странице сайта: инъекция mediaSession-перехватчика и вызовы действий. */
export class SiteBridge {
  private attached = false;
  /** Результат последнего DOM-клика — для диагностики, почему кнопка не сработала. */
  lastClick: unknown = null;

  constructor(
    private readonly wc: WebContents,
    private readonly logger: (message: string) => void = () => {}
  ) {}

  /**
   * Ставим CDP-инъекцию ДО скриптов страницы: только так видно setActionHandler.
   * Вызывать до loadURL.
   */
  async attach(): Promise<void> {
    if (this.attached) return;
    const dbg = this.wc.debugger;
    this.logger('cdp: attach start');
    if (!dbg.isAttached()) dbg.attach('1.3');
    this.logger('cdp: attached');
    // Page.enable нужен, чтобы addScriptToEvaluateOnNewDocument реально применялся.
    // До первой навигации renderer может не ответить, поэтому вызывать после загрузки.
    try {
      await withTimeout(dbg.sendCommand('Page.enable'), 8000, 'Page.enable');
      this.logger('cdp: page enabled');
    } catch (e) {
      this.logger('cdp: Page.enable failed: ' + String(e));
    }
    await withTimeout(
      dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: MEDIA_BRIDGE_SOURCE }),
      8000,
      'addScriptToEvaluateOnNewDocument'
    );
    this.logger('cdp: script added');
    this.attached = true;
  }

  async detach(): Promise<void> {
    try {
      if (this.wc.debugger.isAttached()) this.wc.debugger.detach();
    } catch {
      /* webContents уже разрушен */
    }
    this.attached = false;
  }

  async snapshot(): Promise<RawSnapshot | null> {
    try {
      const value = (await this.wc.executeJavaScript('window.__ym && window.__ym.snapshot ? window.__ym.snapshot() : null', true)) as
        | RawSnapshot
        | null;
      return value ?? null;
    } catch {
      return null;
    }
  }

  /** Вызов обработчика самого сайта (play/pause/next/prev). 'ok' | 'nohandler' | 'nobridge'. */
  async call(action: MediaAction): Promise<string> {
    try {
      const res = (await this.wc.executeJavaScript(
        `window.__ym && window.__ym.call ? window.__ym.call(${JSON.stringify(action)}) : 'nobridge'`,
        true
      )) as string;
      return res;
    } catch (e) {
      return 'error: ' + String(e);
    }
  }

  /** Перемотка: через seekto-обработчик сайта, иначе напрямую элементу. */
  async seek(seconds: number): Promise<string> {
    try {
      return (await this.wc.executeJavaScript(
        `window.__ym && window.__ym.seek ? window.__ym.seek(${Number(seconds)}) : 'nobridge'`,
        true
      )) as string;
    } catch (e) {
      return 'error: ' + String(e);
    }
  }

  /** Громкость: пишем в главный элемент воспроизведения (не в служебный data:audio). */
  async setVolume(value: number): Promise<string> {
    try {
      return (await this.wc.executeJavaScript(
        `window.__ym && window.__ym.setVolume ? window.__ym.setVolume(${Number(value)}) : 'nobridge'`,
        true
      )) as string;
    } catch (e) {
      return 'error: ' + String(e);
    }
  }

  /** Текущий адрес страницы (нужен, чтобы дождаться конца антибот-редиректа). */
  async url(): Promise<string> {
    try {
      return (await this.wc.executeJavaScript('location.href', true)) as string;
    } catch {
      return '';
    }
  }

  /** На главную через логотип сайта: SPA-переход, без лишней сетевой загрузки. */
  async goHome(): Promise<void> {
    try {
      const clicked = (await this.wc.executeJavaScript(
        `(() => {
          const link = Array.from(document.querySelectorAll('a')).find(
            (a) => /^Главная$/i.test((a.getAttribute('aria-label') || '').trim())
          );
          if (!link) return false;
          link.click();
          return true;
        })()`,
        true
      )) as boolean;
      if (clicked) {
        this.logger('goHome: logo click');
        // Логотип — SPA-переход; даём интерфейсу перерисоваться до поиска карточки.
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return;
      }
      this.logger('goHome: fallback loadURL');
      await this.wc.loadURL('https://music.yandex.ru/');
    } catch (e) {
      this.logger('goHome failed: ' + String(e));
    }
  }

  /** Список волн и подборок, которые видно на текущей странице. */
  async listFlows(): Promise<string[]> {
    try {
      const titles = (await this.wc.executeJavaScript(
        `(() => {
          const out = [];
          const seen = new Set();
          const add = (value) => {
            const title = String(value || '').replace(/\\s+/g, ' ').trim();
            if (!title || title.length > 42 || seen.has(title)) return;
            seen.add(title);
            out.push(title);
          };
          // То, что есть всегда: волна и её варианты.
          ['Моя волна', 'Незнакомое', 'Для вас и Тренды'].forEach(add);
          const re = /^(Моя волна|Незнакомое|Встряхнуть Мою волну|Назад к привычному|Для вас и Тренды|Волна по настроению)$/i;
          const nodes = document.querySelectorAll('a,[role="button"],button');
          for (const node of nodes) {
            if (out.length >= 10) break;
            const text = String(node.innerText || '').replace(/\\s+/g, ' ').trim();
            if (!text || text.length > 42) continue;
            const aria = String(node.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
            if (re.test(text)) add(text);
            else if (aria && re.test(aria)) add(aria);
          }
          return out.slice(0, 10);
        })()`,
        true
      )) as string[];
      return Array.isArray(titles) ? titles : [];
    } catch {
      return [];
    }
  }

  /** Клик по карточке волны/подборки. */
  async clickFlowCard(title: string): Promise<{ ok: boolean; reason?: string }> {
    try {
      return (await this.wc.executeJavaScript(
        `(() => {
          const title = ${JSON.stringify(title)};
          const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
          const nodes = Array.from(document.querySelectorAll('a,button,[role="button"]')).filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          let hit = nodes.find((el) => norm(el.innerText) === title);
          if (!hit) hit = nodes.find((el) => norm(el.getAttribute('aria-label')) === title);
          if (!hit) hit = nodes.find((el) => {
            const text = norm(el.innerText);
            return text.length <= title.length + 24 && text.toLowerCase().startsWith(title.toLowerCase());
          });
          if (!hit) return { ok: false, reason: 'no-card' };
          hit.click();
          return { ok: true, tag: hit.tagName.toLowerCase(), href: hit.getAttribute('href') || '' };
        })()`,
        true
      )) as { ok: boolean; reason?: string };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  /** Большая кнопка запуска на странице волны/плейлиста. */
  async clickStartButton(): Promise<{ ok: boolean; label?: string }> {
    try {
      const result = (await this.wc.executeJavaScript(
        `(() => {
          const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const candidates = Array.from(document.querySelectorAll('button[aria-label]')).filter(
            (el) => {
              if (!/^(Воспроизведение|Слушать|Играть)$/i.test(norm(el.getAttribute('aria-label'))) || !visible(el)) return false;
              const r = el.getBoundingClientRect();
              // Кнопки на карточках — 24–32 px; большая кнопка волны/плейлиста — от 40 px.
              return r.width * r.height >= 1800;
            }
          );
          candidates.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return rb.width * rb.height - ra.width * ra.height;
          });
          const hit = candidates[0];
          if (hit) { hit.click(); return { ok: true, label: norm(hit.getAttribute('aria-label')) }; }
          const player = document.querySelector('section[aria-label="Плеер"]');
          if (player) {
            const b = Array.from(player.querySelectorAll('button[aria-label]')).find(
              (el) => /^(Воспроизведение|Слушать|Играть)$/i.test(norm(el.getAttribute('aria-label'))) && visible(el)
            );
            if (b) { b.click(); return { ok: true, label: norm(b.getAttribute('aria-label')) }; }
          }
          return { ok: false };
        })()`,
        true
      )) as { ok: boolean; label?: string };
      this.logger('flow: clickStartButton ' + JSON.stringify(result));
      return result;
    } catch (e) {
      this.logger('flow: clickStartButton failed ' + String(e));
      return { ok: false, label: String(e) };
    }
  }

  /** Клик по кнопке сайта, когда mediaSession действия не предусматривает (лайк, очередь…). */
  async click(action: DomAction): Promise<{ clicked: boolean; how?: string; reason?: string; label?: string }> {
    try {
      const result = (await this.wc.executeJavaScript(domClickScript(action), true)) as {
        clicked: boolean;
        how?: string;
        reason?: string;
        label?: string;
      };
      this.lastClick = { action, ...result, at: new Date().toISOString() };
      return result;
    } catch (e) {
      this.lastClick = { action, error: String(e), at: new Date().toISOString() };
      return { clicked: false };
    }
  }
}
