import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Session } from 'electron';
import type { SiteBridge } from './bridge';

/**
 * Диагностика «что видит приложение»: URL, имена cookie (для ответа «вошли ли»),
 * снимок mediaSession. Пишется в файл, чтобы видеть состояние без DevTools —
 * и потом это же станет страницей диагностики в приложении.
 */
export async function writeDiagnostics(
  file: string,
  bridge: SiteBridge,
  getUrl: () => string,
  ses: Session
): Promise<void> {
  try {
    const cookies = await ses.cookies.get({});
    const snapshot = await bridge.snapshot();
    const payload = {
      at: new Date().toISOString(),
      url: getUrl(),
      cookieCount: cookies.length,
      cookies: cookies.map((c) => `${c.domain}:${c.name}`).sort(),
      injection: !!snapshot,
      lastClick: (bridge as unknown as { lastClick?: unknown }).lastClick ?? null,
      snapshot
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    /* диагностика не должна ронять приложение */
  }
}
