/** Форматирование для UI. Чистый TS, тестируется без окна. */

/** Секунды → «м:сс» или «ч:мм:сс». Отрицательные и NaN → «0:00». */
export function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0:00';
  const total = Math.floor(totalSeconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Строка «Трек — Артист» для заголовка окна и подсказки трея. */
export function nowPlayingText(title: string, artist: string): string {
  const t = (title || '').trim();
  const a = (artist || '').trim();
  if (t && a) return `${t} — ${a}`;
  return t || a || 'Яндекс Музыка';
}

/** Прогресс 0..1 с защитой от мусора и деления на ноль. */
export function progressOf(position: number, duration: number): number {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return 0;
  const p = position / duration;
  if (p < 0) return 0;
  if (p > 1) return 1;
  return p;
}
