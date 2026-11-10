// Serial Monitor panel: toolbar, output (text or hex), live plot, send box with history.
// Renders state and data posted by the extension; all text comes from src/text.ts.
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const saved = vscode.getState() || {};
  const ui = {
    timestamps: saved.timestamps ?? false,
    hex: saved.hex ?? false,
    autoscroll: saved.autoscroll ?? true,
    tab: saved.tab ?? 'monitor',
    filter: '',
    history: saved.history ?? [],
    plotPaused: false,
  };
  const persist = () =>
    vscode.setState({
      timestamps: ui.timestamps,
      hex: ui.hex,
      autoscroll: ui.autoscroll,
      tab: ui.tab,
      history: ui.history.slice(-50),
    });

  const MAX_LINES = 10000;
  const MAX_DOM_LINES = 3000;
  const MAX_BYTES = 256 * 1024;
  const MAX_POINTS = 500;
  const decoder = new TextDecoder();
  /** Completed lines: { t, text }. */
  let lines = [];
  /** The line still being received (no newline yet). */
  let partial = { t: 0, text: '' };
  /** Raw byte chunks for hex view: { t, bytes }. */
  let chunks = [];
  let byteCount = 0;
  let trimmed = false;
  /** Plot series: name -> number[] */
  const series = new Map();
  /** Series hidden by clicking their legend entry (excluded from scaling too). */
  const hidden = new Set();
  let state;
  let T;

  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const icon = (name, cls = '') => `<i class="codicon codicon-${name} ${cls}" aria-hidden="true"></i>`;
  const time = (t) => {
    const d = new Date(t);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  };

  // ---------- layout (built once; updated in place so focus and scroll survive) ----------
  root.innerHTML = `
    <div class="mon">
      <div class="mon-bar">
        <div class="mon-tabs" role="tablist">
          <button class="tab" data-tab="monitor" role="tab"></button><button class="tab" data-tab="plot" role="tab"></button>
        </div>
        <span class="mon-status"><span class="dot"></span><span class="status-text"></span></span>
        <button class="small" id="conn"></button>
        <select id="baud" class="mon-select"></select>
        <select id="ending" class="mon-select"></select>
        <span class="grow"></span>
        <input type="search" id="filter" class="mon-filter">
        <button class="small toggle" id="t-ts">${icon('history')}</button>
        <button class="small toggle" id="t-hex">${icon('symbol-number')}</button>
        <button class="small toggle" id="t-scroll">${icon('arrow-down')}</button>
        <button class="small" id="clear">${icon('clear-all')}</button>
        <button class="small" id="save">${icon('save')}</button>
      </div>
      <div class="mon-banner" id="banner"></div>
      <div class="mon-body">
        <div class="mon-out" id="out" tabindex="0"></div>
        <div class="mon-plot" id="plot"><canvas id="canvas"></canvas><div class="plot-legend" id="legend"></div><div class="plot-empty muted" id="plot-empty"></div>
          <button class="small plot-pause" id="plot-pause"></button></div>
      </div>
      <div class="mon-send"><input type="text" id="msg" autocomplete="off" spellcheck="false"><button class="primary small" id="send"></button></div>
    </div>`;
  const $ = (id) => document.getElementById(id);
  const out = $('out');
  const canvas = $('canvas');

  function applyStaticText() {
    document.querySelector('[data-tab="monitor"]').textContent = T.monitorTab;
    document.querySelector('[data-tab="plot"]').textContent = T.plotTab;
    $('baud').title = T.baud;
    $('baud').setAttribute('aria-label', T.baud);
    $('ending').title = T.lineEnding;
    $('ending').setAttribute('aria-label', T.lineEnding);
    $('ending').innerHTML = ['none', 'lf', 'cr', 'crlf']
      .map((k) => `<option value="${k}">${esc(T.endings[k])}</option>`)
      .join('');
    $('filter').placeholder = T.filter;
    $('filter').setAttribute('aria-label', T.filter);
    for (const [id, label] of [
      ['t-ts', T.timestamps],
      ['t-hex', T.hex],
      ['t-scroll', T.autoscroll],
      ['clear', T.clear],
      ['save', T.save],
    ]) {
      $(id).title = label;
      $(id).setAttribute('aria-label', label);
    }
    $('msg').placeholder = T.sendPlaceholder;
    $('send').textContent = T.send;
    $('plot-empty').textContent = T.plotEmpty;
  }

  function renderState() {
    const s = state;
    const status = s.status;
    document.querySelector('.mon-status').className = `mon-status ${status}`;
    // Status line carries pause/reconnect/error messages; the full text is on hover.
    const statusText = document.querySelector('.status-text');
    statusText.textContent = `${s.port || T.noPort} · ${status === 'error' && s.message ? s.message : T.status[status]}`;
    document.querySelector('.mon-status').title = s.message || '';
    const live =
      status === 'connected' || status === 'connecting' || status === 'reconnecting' || status === 'paused';
    $('conn').textContent = live ? T.disconnect : T.connect;
    $('conn').dataset.action = live ? 'disconnect' : 'connect';
    const baud = $('baud');
    const opts = s.bauds.includes(s.baud) ? s.bauds : [...s.bauds, s.baud];
    if (baud.dataset.list !== opts.join(',')) {
      baud.innerHTML = opts.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
      baud.dataset.list = opts.join(',');
    }
    baud.value = s.baud;
    $('ending').value = s.lineEnding;
    const banner = $('banner');
    if (!s.engineReady) {
      banner.innerHTML = `${icon('warning', 'warn')}<span class="grow">${esc(T.engineMissing)}</span><button class="small primary" id="install">${esc(T.install)}</button>`;
      banner.style.display = 'flex';
    } else banner.style.display = 'none';
    $('msg').disabled = status !== 'connected';
    $('send').disabled = status !== 'connected';
  }

  function renderToggles() {
    $('t-ts').classList.toggle('on', ui.timestamps);
    $('t-hex').classList.toggle('on', ui.hex);
    $('t-scroll').classList.toggle('on', ui.autoscroll);
    for (const b of document.querySelectorAll('.tab')) b.classList.toggle('on', b.dataset.tab === ui.tab);
    $('out').style.display = ui.tab === 'monitor' ? '' : 'none';
    $('plot').style.display = ui.tab === 'plot' ? '' : 'none';
    $('plot-pause').textContent = ui.plotPaused ? T.resumePlot : T.pausePlot;
  }

  // ---------- output ----------
  function lineInner(l) {
    return `${ui.timestamps ? `<span class="ts">${time(l.t)}</span>` : ''}${esc(l.text) || '&nbsp;'}`;
  }
  function lineHtml(l) {
    return `<div class="ln">${lineInner(l)}</div>`;
  }

  function hexHtml() {
    // Last bytes only, 16 per row, offset + hex + ASCII.
    const all = new Uint8Array(Math.min(byteCount, 16 * 2000));
    let pos = all.length;
    for (let i = chunks.length - 1; i >= 0 && pos > 0; i--) {
      const b = chunks[i].bytes;
      const take = Math.min(pos, b.length);
      all.set(b.subarray(b.length - take), pos - take);
      pos -= take;
    }
    const rows = [];
    for (let i = 0; i < all.length; i += 16) {
      const row = all.subarray(i, i + 16);
      const hex = Array.from(row, (b) => b.toString(16).padStart(2, '0')).join(' ');
      const ascii = Array.from(row, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
      rows.push(
        `<div class="ln"><span class="ts">${(byteCount - all.length + i).toString(16).padStart(8, '0')}</span>${hex.padEnd(47)}  ${esc(ascii)}</div>`,
      );
    }
    return rows.join('');
  }

  function matches(l) {
    return !ui.filter || l.text.toLowerCase().includes(ui.filter);
  }

  /** Full redraw: on toggle/filter/clear. Appends are incremental (see onLines). */
  function renderOutput() {
    if (ui.hex) {
      out.innerHTML = hexHtml();
    } else {
      const shown = lines.filter(matches).slice(-MAX_DOM_LINES);
      out.innerHTML =
        (trimmed && !ui.filter ? `<div class="ln muted">${esc(T.linesTrimmed)}</div>` : '') +
        shown.map(lineHtml).join('') +
        (partial.text && matches(partial) ? `<div class="ln partial">${lineInner(partial)}</div>` : '');
    }
    if (ui.autoscroll) out.scrollTop = out.scrollHeight;
  }

  let hexQueued = false;
  function onLines(newLines) {
    if (ui.hex) {
      if (!hexQueued) {
        hexQueued = true;
        requestAnimationFrame(() => {
          hexQueued = false;
          renderOutput();
        });
      }
      return;
    }
    const last = out.lastElementChild;
    if (last && last.classList.contains('partial')) last.remove();
    const frag = document.createDocumentFragment();
    const tmp = document.createElement('div');
    tmp.innerHTML = newLines.filter(matches).map(lineHtml).join('');
    while (tmp.firstChild) frag.appendChild(tmp.firstChild);
    if (partial.text && matches(partial)) {
      const p = document.createElement('div');
      p.className = 'ln partial';
      p.innerHTML = lineInner(partial);
      frag.appendChild(p);
    }
    out.appendChild(frag);
    while (out.childElementCount > MAX_DOM_LINES) out.firstElementChild.remove();
    if (ui.autoscroll) out.scrollTop = out.scrollHeight;
  }

  function receive(t, bytes) {
    chunks.push({ t, bytes });
    byteCount += bytes.length;
    let kept = 0;
    for (let i = chunks.length - 1; i >= 0; i--) {
      kept += chunks[i].bytes.length;
      if (kept > MAX_BYTES) {
        chunks = chunks.slice(i + 1);
        break;
      }
    }
    const textIn = decoder.decode(bytes, { stream: true });
    const done = [];
    for (const ch of textIn) {
      if (ch === '\n') {
        done.push({ t: partial.t || t, text: partial.text.replace(/\r$/, '') });
        partial = { t: 0, text: '' };
      } else {
        if (!partial.text) partial.t = t;
        partial.text += ch;
      }
    }
    if (done.length) {
      lines.push(...done);
      if (lines.length > MAX_LINES) {
        lines = lines.slice(-MAX_LINES);
        trimmed = true;
      }
      for (const l of done) plotLine(l.text);
    }
    onLines(done);
  }

  // ---------- plot ----------
  const NUM = '-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?';
  const LABELED = new RegExp(`([A-Za-z_][\\w.-]*)\\s*[:=]\\s*(${NUM})`, 'g');
  const PLAIN = new RegExp(`^\\s*${NUM}(?:\\s*[,;\\t ]\\s*${NUM})*\\s*$`);

  function plotLine(line) {
    if (ui.plotPaused) return;
    const values = [];
    for (const m of line.matchAll(LABELED)) values.push([m[1], Number(m[2])]);
    if (!values.length && PLAIN.test(line))
      line
        .trim()
        .split(/[\s,;\t]+/)
        .forEach((v, i) => values.push([String(i + 1), Number(v)]));
    for (const [name, v] of values) {
      if (!Number.isFinite(v)) continue;
      const s = series.get(name) || [];
      s.push(v);
      if (s.length > MAX_POINTS) s.shift();
      series.set(name, s);
    }
    if (values.length && ui.tab === 'plot') queuePlot();
  }

  let plotQueued = false;
  function queuePlot() {
    if (plotQueued) return;
    plotQueued = true;
    requestAnimationFrame(() => {
      plotQueued = false;
      drawPlot();
    });
  }

  const css = (v, fallback) => getComputedStyle(document.body).getPropertyValue(v).trim() || fallback;
  function drawPlot() {
    const box = $('plot');
    const dpr = window.devicePixelRatio || 1;
    const w = box.clientWidth;
    const h = Math.max(80, box.clientHeight);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    $('plot-empty').style.display = series.size ? 'none' : '';
    if (!series.size) {
      $('legend').innerHTML = '';
      return;
    }
    const colors = [
      '--vscode-charts-blue',
      '--vscode-charts-orange',
      '--vscode-charts-green',
      '--vscode-charts-red',
      '--vscode-charts-purple',
      '--vscode-charts-yellow',
    ].map((v, i) => css(v, ['#3794ff', '#d18616', '#89d185', '#f14c4c', '#b180d7', '#cca700'][i]));
    let min = Infinity;
    let max = -Infinity;
    let longest = 2;
    for (const [name, s] of series) {
      if (hidden.has(name)) continue;
      longest = Math.max(longest, s.length);
      for (const v of s) {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
    const left = 56;
    const right = 8;
    const top = 8;
    const bottom = 8;
    const fg = css('--vscode-descriptionForeground', '#999');
    const grid = css('--vscode-widget-border', '#3334');
    g.font = `11px ${css('--vscode-editor-font-family', 'monospace')}`;
    g.fillStyle = fg;
    g.strokeStyle = grid;
    g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = top + ((h - top - bottom) * i) / 4;
      g.beginPath();
      g.moveTo(left, y + 0.5);
      g.lineTo(w - right, y + 0.5);
      g.stroke();
      const v = max - ((max - min) * i) / 4;
      g.fillText(Math.abs(v) >= 1000 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2), 4, y + 4);
    }
    let ci = 0;
    const legend = [];
    for (const [name, s] of series) {
      const color = colors[ci++ % colors.length];
      const off = hidden.has(name);
      legend.push(
        `<button class="lg ${off ? 'off' : ''}" data-series="${esc(name)}"><span class="sw" style="background:${color}"></span>${esc(name)} <b>${esc(s[s.length - 1])}</b></button>`,
      );
      if (off) continue;
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.beginPath();
      s.forEach((v, i) => {
        // Spread over the samples so far; once the buffer is full this scrolls.
        const x = left + ((w - left - right) * (i + longest - s.length)) / (longest - 1);
        const y = top + ((h - top - bottom) * (max - v)) / (max - min);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.stroke();
    }
    $('legend').innerHTML = legend.join('');
  }
  new ResizeObserver(() => {
    if (ui.tab === 'plot') drawPlot();
  }).observe($('plot'));

  // ---------- input ----------
  let historyIndex = -1;
  function send() {
    const m = $('msg');
    if (m.disabled) return;
    vscode.postMessage({ type: 'send', text: m.value });
    if (m.value && ui.history[ui.history.length - 1] !== m.value) ui.history.push(m.value);
    historyIndex = -1;
    m.value = '';
    persist();
  }
  $('msg').addEventListener('keydown', (e) => {
    const m = $('msg');
    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    } else if (e.key === 'ArrowUp' && ui.history.length) {
      e.preventDefault();
      historyIndex = historyIndex < 0 ? ui.history.length - 1 : Math.max(0, historyIndex - 1);
      m.value = ui.history[historyIndex];
    } else if (e.key === 'ArrowDown' && historyIndex >= 0) {
      e.preventDefault();
      historyIndex++;
      if (historyIndex >= ui.history.length) {
        historyIndex = -1;
        m.value = '';
      } else m.value = ui.history[historyIndex];
    }
  });
  $('send').addEventListener('click', send);
  $('baud').addEventListener('change', (e) => vscode.postMessage({ type: 'baud', baud: e.target.value }));
  $('ending').addEventListener('change', (e) =>
    vscode.postMessage({ type: 'lineEnding', ending: e.target.value }),
  );
  $('filter').addEventListener('input', (e) => {
    ui.filter = e.target.value.toLowerCase();
    renderOutput();
  });
  out.addEventListener('scroll', () => {
    // Scrolling up pauses autoscroll; scrolling back to the bottom resumes it.
    const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 4;
    if (ui.autoscroll !== atBottom) {
      ui.autoscroll = atBottom;
      renderToggles();
      persist();
    }
  });
  function toggle(key) {
    ui[key] = !ui[key];
    renderToggles();
    renderOutput();
    persist();
  }

  root.addEventListener('click', (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    if (el.dataset.tab) {
      ui.tab = el.dataset.tab;
      renderToggles();
      if (ui.tab === 'plot') drawPlot();
      else renderOutput();
      persist();
    } else if (el.id === 'conn') vscode.postMessage({ type: el.dataset.action });
    else if (el.id === 'install') vscode.postMessage({ type: 'installEngine' });
    else if (el.id === 't-ts') toggle('timestamps');
    else if (el.id === 't-hex') toggle('hex');
    else if (el.id === 't-scroll') toggle('autoscroll');
    else if (el.id === 'clear') {
      lines = [];
      partial = { t: 0, text: '' };
      chunks = [];
      byteCount = 0;
      trimmed = false;
      series.clear();
      hidden.clear();
      renderOutput();
      drawPlot();
      vscode.postMessage({ type: 'clear' });
    } else if (el.id === 'save') vscode.postMessage({ type: 'save' });
    else if (el.dataset.series !== undefined) {
      const name = el.dataset.series;
      if (hidden.has(name)) hidden.delete(name);
      else hidden.add(name);
      drawPlot();
    } else if (el.id === 'plot-pause') {
      ui.plotPaused = !ui.plotPaused;
      renderToggles();
    }
  });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'state') {
      const first = !state;
      state = m.state;
      T = state.text;
      if (first) applyStaticText();
      renderState();
      renderToggles();
    } else if (m.type === 'data') {
      const bin = atob(m.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      receive(m.time, bytes);
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
