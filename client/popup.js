/*!
 * FocusBot MV3 popup — dual-direction control bridge.
 * Talks to the FocusBot content script via chrome.runtime messaging
 * (message type: FOCUSBOT_CTRL) so toolbar and in-page FAB stay in sync.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function fmtClock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /** Send a control command to the active tab's FocusBot instance. */
  function send(cmd, extra) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
        resolve({ ok: false, error: 'chrome.tabs unavailable' });
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || tab.id === undefined) {
          resolve({ ok: false, error: 'no_active_tab' });
          return;
        }
        const msg = Object.assign({ type: 'FOCUSBOT_CTRL', cmd }, extra || {});
        const sendFn = chrome.tabs.sendMessage;
        if (typeof sendFn === 'function' && sendFn.constructor.name === 'AsyncFunction') {
          sendFn(tab.id, msg).then(resolve).catch(() => resolve({ ok: false, error: 'no_listener' }));
        } else {
          try {
            sendFn(tab.id, msg, (res) => {
              // Consume any runtime error here (e.g. "message channel closed
              // before a response was received" when the popup is being torn
              // down). Reading lastError inside the callback is what suppresses
              // the unhandled console noise, while keeping the response path.
              try {
                if (chrome.runtime && chrome.runtime.lastError) { void chrome.runtime.lastError; }
              } catch (_) { /* popup context already gone */ }
              resolve(res && res.ok !== undefined ? res : { ok: false, error: 'no_listener' });
            });
          } catch (_) {
            resolve({ ok: false, error: 'no_listener' });
          }
        }
      });
    });
  }

  const els = {
    dot: $('dot'), chip: $('pro-chip'),
    play: $('btn-play'), pause: $('btn-pause'),
    modes: $('modes'), modesSol: $('modes-sol'), amb: $('amb'),
    volTone: $('vol-tone'), volAmb: $('vol-amb'),
    buyPro: $('buy-pro'),
    pomo: $('btn-pomo'), pomoStop: $('btn-pomo-stop'),
    st: { state: $('st-state'), time: $('st-time'), trial: $('st-trial') },
    noWidget: $('no-widget'),
  };

  let lastState = null;

  function fmtTrial(ms) {
    const h = Math.max(1, Math.ceil((ms || 0) / 3600000));
    return h >= 24 ? Math.floor(h / 24) + ' day(s)' : h + ' hour(s)';
  }

  function render(state) {
    if (!state) return;
    lastState = state;
    els.dot.classList.toggle('on', !!state.pro);
    els.chip.style.display = state.pro ? '' : 'none';

    // Mode active highlight (binaural + solfeggio grids)
    const allModes = els.modes.querySelectorAll('button');
    Array.prototype.forEach.call(allModes, (b) => {
      b.classList.toggle('active', b.dataset.mode === state.mode);
    });
    Array.prototype.forEach.call(els.modesSol.querySelectorAll('button'), (b) => {
      b.classList.toggle('active', b.dataset.mode === state.mode);
    });

    // Volume sliders — mirror persisted stages from the content script
    els.volTone.value = String(Math.round((state.volumeBinaural || 0) * 100));
    els.volAmb.value = String(Math.round((state.volumeAmbient || 0) * 100));

    // Ambient layers can be active independently; 'Off' lights only when NO layer
    // is running, each active layer lights its own button (multiple possible).
    const activeAmbs = state.ambients || (state.ambient && state.ambient !== 'off' ? [state.ambient] : []);
    Array.prototype.forEach.call(els.amb.querySelectorAll('button'), (b) => {
      const k = b.dataset.amb;
      b.classList.toggle('active', k === 'off' ? activeAmbs.length === 0 : activeAmbs.indexOf(k) !== -1);
    });

    els.pomo.textContent = state.pomodoro && state.pomodoro.running ? '⏸ ' + (state.pomodoro.state === 'focus' ? 'Focus' : 'Break') : '▶ Start';
    els.st.state.textContent = state.playing ? 'Playing' : 'Paused';
    els.st.time.textContent = state.pomodoro && state.pomodoro.running
      ? fmtClock(state.pomodoro.remainingMs)
      : '—';
    const t = state.trial;
    els.st.trial.textContent = state.pro
      ? 'PRO · Unlimited'
      : (t && t.active ? fmtTrial(t.remainingMs) + ' left' : 'Expired');
  }

  async function refresh() {
    const res = await send('getState');
    if (res && res.ok && res.state) {
      render(res.state);
      els.noWidget.classList.add('hidden');
    } else {
      els.noWidget.classList.remove('hidden');
    }
  }

  function bind() {
    if (els.buyPro) els.buyPro.addEventListener('click', async () => { await send('openUpsell'); });
    els.play.addEventListener('click', async () => { await send('play'); refresh(); });
    els.pause.addEventListener('click', async () => { await send('pause'); refresh(); });
    els.pomo.addEventListener('click', async () => {
      const running = lastState && lastState.pomodoro && lastState.pomodoro.running;
      await send(running ? 'pomodoroStop' : 'pomodoroStart');
      refresh();
    });
    els.pomoStop.addEventListener('click', async () => { await send('pomodoroStop'); refresh(); });

    els.modes.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn) return;
      await send('setMode', { mode: btn.dataset.mode });
      refresh();
    });
    els.modesSol.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn) return;
      await send('setMode', { mode: btn.dataset.mode });
      refresh();
    });
    els.volTone.addEventListener('input', async () => {
      await send('setVolume', { which: 'binaural', value: Number(els.volTone.value) });
    });
    els.volAmb.addEventListener('input', async () => {
      await send('setVolume', { which: 'ambient', value: Number(els.volAmb.value) });
    });
    els.amb.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-amb]');
      if (!btn) return;
      await send('toggleAmbient', { kind: btn.dataset.amb });
      refresh();
    });
  }

  // Poll while popup is open so the displayed state stays live.
  function tick() {
    refresh();
    setTimeout(tick, 500);
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    // Start the poll loop; stop after a couple of minutes of idle.
    let start = Date.now();
    (function poll() {
      refresh();
      if (Date.now() - start < 120000) setTimeout(poll, 500);
    })();
  });
})();