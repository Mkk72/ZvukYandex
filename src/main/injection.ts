/**
 * Скрипт, который внедряется в main world страницы ДО её собственных скриптов
 * (через CDP Page.addScriptToEvaluateOnNewDocument).
 *
 * Задача: перехватить navigator.mediaSession.setActionHandler, чтобы
 *  - знать, какие действия плеер сайта зарегистрировал;
 *  - уметь вызвать обработчик САМОГО САЙТА (а не имитировать клик).
 *
 * Плюс снимок состояния: метаданные, <audio>, playbackState, позиция.
 * У Яндекс Музыки есть и mediaSession, и настоящий <audio>, поэтому позиция
 * берётся из элемента, а setPositionState остаётся запасным источником.
 */
export const MEDIA_BRIDGE_SOURCE = String.raw`(() => {
  try {
    if (window.__ym) { return; }
    var st = {
      v: 2,
      handlers: Object.create(null),
      calls: [],
      errors: [],
      hookedAt: new Date().toISOString()
    };
    window.__ym = st;

    function pushError(message) {
      try {
        if (st.errors.length < 30) st.errors.push(String(message));
      } catch (e) {}
    }

    st.call = function (action) {
      var h = st.handlers[action];
      if (typeof h === 'function') {
        try {
          h({ action: action });
          st.calls.push({ action: action, at: Date.now(), ok: true });
          if (st.calls.length > 50) st.calls.shift();
          return 'ok';
        } catch (e) {
          st.calls.push({ action: action, at: Date.now(), ok: false, err: String(e) });
          return 'throw:' + e;
        }
      }
      return 'nohandler';
    };

    st.position = null;
    st.mediaEls = [];
    try {
      var origPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        try {
          if (st.mediaEls.indexOf(this) === -1) st.mediaEls.push(this);
        } catch (e) {}
        return origPlay.apply(this, arguments);
      };
    } catch (e) {
      pushError('play hook: ' + e);
    }

    try {
      var ms0 = navigator.mediaSession;
      if (ms0 && typeof ms0.setPositionState === 'function') {
        var origPos = ms0.setPositionState;
        var wrappedPos = function (state) {
          if (state) {
            st.position = {
              position: state.position,
              duration: state.duration,
              rate: state.playbackRate,
              at: Date.now()
            };
          }
          try {
            return origPos.call(ms0, state);
          } catch (e) {
            pushError('setPositionState: ' + e);
          }
        };
        try { ms0.setPositionState = wrappedPos; } catch (e) { pushError('pos wrap: ' + e); }
        try {
          var p0 = Object.getPrototypeOf(ms0);
          if (p0 && p0 !== Object.prototype) p0.setPositionState = wrappedPos;
        } catch (e) { pushError('pos proto wrap: ' + e); }
      }
    } catch (e) {
      pushError('position hook: ' + e);
    }

    function mediaPool() {
      var medias = Array.prototype.slice.call(document.querySelectorAll('audio,video'));
      try {
        (st.mediaEls || []).forEach(function (el) {
          if (medias.indexOf(el) === -1) medias.push(el);
        });
      } catch (e) {}
      return medias;
    }

    // Главный элемент — тот, что реально играет; иначе самый длинный.
    // У Яндекса на странице есть служебный data:audio длиной 0.015 с,
    // поэтому «первый попавшийся» брать нельзя.
    function primaryMedia() {
      var medias = mediaPool();
      var withDuration = medias.filter(function (a) {
        return isFinite(a.duration) && a.duration > 0;
      });
      var pool = withDuration.length ? withDuration : medias;
      var playing = pool.filter(function (a) { return !a.paused; })[0];
      if (playing) return playing;
      var best = pool[0] || null;
      for (var i = 1; i < pool.length; i++) {
        if (pool[i].duration > (best.duration || 0)) best = pool[i];
      }
      return best;
    }

    function parseClock(text) {
      if (!text) return null;
      var parts = String(text).trim().split(':').map(function (x) { return Number(x); });
      if (parts.some(function (x) { return !isFinite(x); })) return null;
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      return null;
    }

    // Запасной источник позиции, если setPositionState не вызывается:
    // таймкод в нижней панели Яндекс Музыки («0:09 / 4:04»).
    st.domPosition = function () {
      var node = document.querySelector('[class*="TimecodeWithOverlay_timecode"]')
        || document.querySelector('[class*="VibePlayerbarMeta"] [class*="timecode"]');
      if (!node) return null;
      var text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      var match = text.match(/(\d+:\d+(?::\d+)?)\s*\/\s*(\d+:\d+(?::\d+)?)/);
      if (!match) return null;
      var position = parseClock(match[1]);
      var duration = parseClock(match[2]);
      if (position == null || duration == null || duration <= 0) return null;
      return { position: position, duration: duration, rate: 1, at: Date.now() };
    };

    st.seek = function (seconds) {
      var h = st.handlers['seekto'];
      try {
        if (typeof h === 'function') {
          h({ action: 'seekto', seekTime: seconds });
          return 'ok';
        }
        var el0 = primaryMedia();
        if (el0) {
          el0.currentTime = seconds;
          return 'ok-media';
        }
      } catch (e) {
        return 'throw:' + e;
      }
      return 'nohandler';
    };

    st.setVolume = function (value) {
      var el1 = primaryMedia();
      if (!el1) return 'nomedia';
      try {
        el1.volume = Math.max(0, Math.min(1, value));
        return 'ok';
      } catch (e) {
        return 'throw:' + e;
      }
    };

    function findLikeButton() {
      var player = document.querySelector('section[aria-label="Плеер"]')
        || document.querySelector('[class*="VibePlayerBar_root"]');
      var scope = player || document;
      var buttons = Array.prototype.slice.call(scope.querySelectorAll('button[aria-label]'));
      return buttons.filter(function (b) {
        return /^Нравится$/i.test((b.getAttribute('aria-label') || '').trim());
      })[0] || null;
    }

    function isLiked() {
      var button = findLikeButton();
      if (!button) return false;
      if (button.getAttribute('aria-pressed') === 'true') return true;
      return /(^|\s)(active|liked|pressed)(\s|$)/i.test(String(button.className || ''));
    }

    function isHq() {
      var player = document.querySelector('section[aria-label="Плеер"]')
        || document.querySelector('[class*="VibePlayerBar_root"]');
      if (!player) return false;
      var text = (player.innerText || '') + ' ' + (player.textContent || '');
      return /(^|\s)(HQ|Hi-Res|Lossless)(\s|$)/i.test(text);
    }

    st.snapshot = function () {
      var ms = navigator.mediaSession;
      var m = ms && ms.metadata;
      var medias = mediaPool();
      var primary = primaryMedia();
      var controls = [];
      var re = /(пауза|воспроизвест|слушать|следующ|предыдущ|нравится|повтор|очеред|громкость|качеств|плеер)/i;
      var nodes = document.querySelectorAll('button,[role="button"],[aria-label]');
      for (var i = 0; i < nodes.length && controls.length < 40; i++) {
        var el = nodes[i];
        var label = (el.getAttribute('aria-label') || '').trim();
        if (!label || !re.test(label)) continue;
        controls.push({
          label: label.slice(0, 60),
          pressed: el.getAttribute('aria-pressed'),
          tag: el.tagName.toLowerCase()
        });
      }
      return {
        handlers: Object.keys(st.handlers).filter(function (k) {
          return typeof st.handlers[k] === 'function';
        }),
        metadata: m
          ? {
              title: m.title,
              artist: m.artist,
              album: m.album,
              artwork: (m.artwork || []).slice(0, 8).map(function (x) { return x.src; })
            }
          : null,
        positionState: st.position || st.domPosition(),
        controls: controls,
        mediaCount: medias.length,
        media: medias.map(function (a) {
          return {
            tag: a.tagName.toLowerCase(),
            src: (a.currentSrc || a.src || '').slice(0, 160),
            paused: a.paused,
            currentTime: Math.round(a.currentTime * 10) / 10,
            duration: a.duration,
            readyState: a.readyState,
            volume: a.volume
          };
        }),
        playbackState: ms ? ms.playbackState : null,
        volume: primary && typeof primary.volume === 'number' ? primary.volume : null,
        hq: isHq(),
        liked: isLiked(),
        errors: st.errors
      };
    };

    var ms = navigator.mediaSession;
    if (!ms || typeof ms.setActionHandler !== 'function') {
      pushError('no mediaSession.setActionHandler');
      return;
    }
    var orig = ms.setActionHandler;
    var wrapped = function (action, handler) {
      st.handlers[action] = handler || null;
      try {
        return orig.call(ms, action, handler);
      } catch (e) {
        pushError(action + ': ' + e);
      }
    };
    try { ms.setActionHandler = wrapped; } catch (e) { pushError('instance wrap: ' + e); }
    try {
      var proto = Object.getPrototypeOf(ms);
      if (proto && proto !== Object.prototype) { proto.setActionHandler = wrapped; }
    } catch (e) { pushError('proto wrap: ' + e); }
  } catch (e) {
    window.__ym = { fatal: String(e) };
  }
})();`;
