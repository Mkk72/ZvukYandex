/* Мини-плеер. Никакой логики: только показать присланную модель и отправить команду. */
(function () {
  var api = window.ymBar;
  var el = function (id) {
    return document.getElementById(id);
  };

  var nodes = {
    bar: el('bar'),
    cover: el('cover'),
    coverImg: el('cover-img'),
    title: el('title'),
    artist: el('artist'),
    toggle: el('toggle'),
    pos: el('pos'),
    dur: el('dur'),
    fill: el('fill'),
    menu: el('menu'),
    menuList: el('menu-list')
  };

  function render(view) {
    if (!view) return;
    nodes.title.textContent = view.title || 'Яндекс Музыка';
    nodes.title.title = view.artist ? view.title + ' — ' + view.artist : view.title || '';
    nodes.artist.textContent = view.artist || '';

    if (view.artwork) {
      nodes.cover.classList.add('has-art');
      nodes.coverImg.src = view.artwork;
    } else {
      nodes.cover.classList.remove('has-art');
      nodes.coverImg.removeAttribute('src');
    }

    nodes.toggle.textContent = view.playing ? '\u23F8' : '\u23F5';
    nodes.toggle.title = view.playing ? 'Пауза (Ctrl+Alt+Space)' : 'Воспроизвести (Ctrl+Alt+Space)';
    nodes.toggle.setAttribute('aria-label', view.playing ? 'Пауза' : 'Воспроизвести');
    nodes.toggle.disabled = !view.canToggle;

    document.querySelector('[data-cmd="next"]').disabled = !view.canNext;
    document.querySelector('[data-cmd="prev"]').disabled = !view.canPrev;
    document.querySelector('[data-cmd="like"]').classList.toggle('active', !!view.liked);

    nodes.pos.textContent = view.posText || '0:00';
    nodes.dur.textContent = view.durText || '0:00';
    nodes.fill.style.width = (view.progressPct || 0) + '%';

    var volume = el('volume');
    if (volume && !volume.matches(':active')) volume.value = String(view.volumePct == null ? 100 : view.volumePct);
    var quality = el('quality');
    if (quality) quality.classList.toggle('active', !!view.hq);
  }

  function renderMenu(items) {
    nodes.menuList.innerHTML = '';
    (items || []).forEach(function (item) {
      if (item.type === 'separator') {
        var sep = document.createElement('div');
        sep.className = 'menu-sep';
        nodes.menuList.appendChild(sep);
        return;
      }
      var row = document.createElement('div');
      row.className = 'menu-item' + (item.enabled === false ? ' disabled' : '');
      var check = document.createElement('span');
      check.className = 'check';
      check.textContent = item.checked ? '\u2713' : '';
      var label = document.createElement('span');
      label.textContent = item.label;
      row.appendChild(check);
      row.appendChild(label);
      if (item.enabled !== false) {
        row.addEventListener('click', function () {
          api.menuSelect(item.id);
        });
      }
      nodes.menuList.appendChild(row);
    });
  }

  function setMenuOpen(open) {
    nodes.menu.hidden = !open;
    var button = document.querySelector('[data-menu]');
    if (button) button.classList.toggle('active', open);
  }

  document.querySelectorAll('[data-cmd]').forEach(function (button) {
    button.addEventListener('click', function () {
      api.command(button.getAttribute('data-cmd'));
    });
  });

  var menuButton = document.querySelector('[data-menu]');
  if (menuButton) {
    menuButton.addEventListener('click', function () {
      api.menu();
    });
  }

  // Перемотка: клик и протяжка по линии прогресса.
  var progress = el('progress');
  var scrubbing = false;
  function seekTo(event) {
    var rect = progress.getBoundingClientRect();
    if (!rect.width) return;
    var ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    api.command('seek:' + ratio.toFixed(4));
  }
  progress.addEventListener('mousedown', function (event) {
    scrubbing = true;
    seekTo(event);
  });
  window.addEventListener('mousemove', function (event) {
    if (!scrubbing) return;
    var rect = progress.getBoundingClientRect();
    var ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    nodes.fill.style.width = (ratio * 100).toFixed(1) + '%';
  });
  window.addEventListener('mouseup', function (event) {
    if (!scrubbing) return;
    scrubbing = false;
    seekTo(event);
  });

  var volume = el('volume');
  if (volume) {
    volume.addEventListener('input', function () {
      api.command('volume:' + volume.value);
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !nodes.menu.hidden) api.menuClose();
  });

  api.onState(render);
  api.onLayout(function (layout) {
    document.body.classList.toggle('wide', layout === 'wide');
  });
  api.onMenu(function (payload) {
    renderMenu(payload && payload.items);
    setMenuOpen(!!payload && !!payload.open);
  });
  api.ready();
})();
