// Sketch view: notifications, board, port, Verify/Upload/Monitor, last result.
// Renders state posted by the extension; every button posts a message back. All text comes from
// the extension (src/text.ts), so this file holds no user-facing strings.
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');

  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const icon = (name, cls = '') => `<i class="codicon codicon-${name} ${cls}" aria-hidden="true"></i>`;
  const basename = (p) => String(p).split(/[\\/]/).pop();
  const seconds = (ms) => (ms < 10000 ? (ms / 1000).toFixed(1) : Math.round(ms / 1000)) + ' s';

  let state;

  function noProject(s, T) {
    const list = s.sketches.length
      ? `<div class="heading">${esc(T.sketchesHeading)}</div>` +
        s.sketches
          .map(
            (k) =>
              `<div class="diag" style="padding-left:0" data-action="openSketch" data-path="${esc(k.path)}">${icon('file-code')}<span class="ellipsis">${esc(k.name)}</span></div>`,
          )
          .join('')
      : `<p class="muted">${esc(T.noSketches)}</p>`;
    return `<div class="section"><p>${esc(T.openSketch)}</p>${list}</div>`;
  }

  // The one place for warnings, errors and detection results. Details show on hover.
  function notices(s, T) {
    const sev = { error: icon('error', 'error'), warning: icon('warning', 'warn'), info: icon('info') };
    const rows = s.notices.map(
      (n) => `<div class="notice" title="${esc(n.detail || n.title)}">${sev[n.severity] || ''}
        <span class="grow">${esc(n.title)}</span>
        ${n.actions.map((a, ai) => `<button class="small ${ai === 0 && n.severity !== 'info' ? 'primary' : ''}" data-action="notice" data-id="${esc(n.id)}" data-a="${ai}">${esc(a)}</button>`).join('')}
        ${n.dismissible ? `<button class="icon-btn" data-action="dismiss" data-id="${esc(n.id)}" title="${esc(T.dismiss)}" aria-label="${esc(T.dismiss)}">${icon('close')}</button>` : ''}</div>`,
    );
    const det = s.detect;
    if (det && det.phase === 'waiting') {
      rows.unshift(`<div class="notice" title="${esc(T.detectWaitingDetail)}">${icon('loading', 'codicon-modifier-spin')}
        <span class="grow">${esc(T.detectWaiting)} <span class="muted"><span data-ends="${det.endsAt}"></span>${esc(T.detectSecondsLeft)}</span></span>
        <button class="small" data-action="cancelDetect">${esc(T.cancel)}</button></div>`);
    }
    return rows.length
      ? `<div class="notices" aria-label="${esc(T.notifications)}">${rows.join('')}</div>`
      : '';
  }

  function pickers(s, T, W) {
    const board = `<div class="row"><span class="label">${esc(W.board)}</span>
      <button class="picker" data-action="selectBoard" title="${esc(s.board ? s.board.id : '')}">
        <span class="value ${s.board ? '' : 'muted'}">${esc(s.board ? s.board.name : T.selectBoard)}</span>${icon('chevron-down')}
      </button></div>`;
    const opts = s.ports
      .map(
        (p) =>
          `<option value="${esc(p.path)}" ${p.path === s.port ? 'selected' : ''}>${esc(p.label)}</option>`,
      )
      .join('');
    const missingSaved =
      s.port && !s.ports.some((p) => p.path === s.port)
        ? `<option value="${esc(s.port)}" selected>${esc(s.port)} (${esc(W.disconnected)})</option>`
        : '';
    const port = `<div class="row" style="margin-top:6px"><span class="label">${esc(W.port)}</span>
      <select data-action="selectPort" aria-label="${esc(W.port)}">
        ${s.ports.length || missingSaved ? '' : `<option value="" selected>${esc(T.noBoardsPlugged)}</option>`}
        ${missingSaved}${opts}
      </select>
      <button class="small" data-action="refreshPorts" title="${esc(T.refreshPorts)}" aria-label="${esc(T.refreshPorts)}">${icon('refresh')}</button></div>`;
    // Board not showing up: one quiet link instead of a card.
    const detect =
      s.noBoards && !s.detect
        ? `<div class="small" style="margin:4px 0 0 52px"><button class="link" data-action="detectBoard">${esc(T.detectBoard)}</button></div>`
        : '';
    return `<div class="section">${board}${port}${detect}</div>`;
  }

  function actions(s, T, W) {
    const r = s.run.running;
    if (r) {
      return `<div class="section"><div class="row"><span class="grow ellipsis">${icon('loading', 'codicon-modifier-spin')} ${esc(r.title)}</span>
        <button class="icon-btn" data-action="showOutput" title="${esc(T.showOutput)}" aria-label="${esc(T.showOutput)}">${icon('output')}</button>
        ${r.kind === 'fix' ? '' : `<button class="small" data-action="cancel">${esc(T.cancel)}</button>`}</div><div class="progress"></div></div>`;
    }
    const blocked = s.run.blocked
      ? `<div class="warn small" style="margin-top:6px">${esc(s.run.blocked)}</div>`
      : '';
    return `<div class="section"><div class="actions">
      <button data-action="build" title="${esc(W.verifyTip)} (${esc(s.keys.build)})">${icon('check')} ${esc(W.verify)}</button>
      <button class="primary" data-action="upload" title="${esc(W.uploadTip)} (${esc(s.keys.upload)})">${icon('arrow-right')} ${esc(W.upload)}</button>
      <button data-action="monitor" title="${esc(T.openMonitor)} (${esc(s.keys.monitor)})">${icon('terminal')} ${esc(W.monitor)}</button>
    </div>${blocked}</div>`;
  }

  function lastRun(s, T, W) {
    const l = s.run.last;
    if (!l) return '';
    const head = `<div class="row">${l.ok ? icon('pass', 'ok') : icon('error', 'error')}
      <span class="grow ellipsis" style="font-weight:600">${esc(l.summary)}</span><span class="muted small">${seconds(l.durationMs)}</span></div>`;
    const diags = l.diagnostics
      .slice(0, 30)
      .map(
        (d, i) =>
          `<div class="diag" data-action="openFile" data-i="${i}" title="${esc(d.message)}">
            ${icon(d.severity === 'warning' ? 'warning' : 'error', d.severity === 'warning' ? 'warn' : 'error')}
            <span class="where">${esc(basename(d.file))}:${d.line}</span><span class="muted ellipsis">${esc(d.message)}</span></div>`,
      )
      .join('');
    const more =
      l.diagnostics.length > 30
        ? `<div class="muted small" style="padding-left:20px">${l.diagnostics.length - 30} ${esc(W.moreInProblems)}</div>`
        : '';
    const fix = l.fix
      ? `<div class="card"><div>${esc(l.fix.message)}</div><div class="buttons"><button class="primary small" data-action="applyFix">${esc(l.fix.label)}</button></div></div>`
      : '';
    const hint = l.hint ? `<div class="warn small" style="margin:4px 0 0 20px">${esc(l.hint)}</div>` : '';
    const output = `<div style="margin:6px 0 0 20px"><button class="link" data-action="showOutput">${icon('output')} ${esc(T.showOutput)}</button></div>`;
    return `<div class="section">${head}${memory(l.memory, W)}${diags}${more}${hint}${fix}${output}</div>`;
  }

  const kb = (n) =>
    n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;

  // Flash and RAM use after a compile: a bar when the limit is known, otherwise just the size.
  function memory(m, W) {
    if (!m) return '';
    const row = (label, f, tip) => {
      if (!f) return '';
      if (!f.max) return `<span class="muted">${esc(label)}</span><span></span><span>${kb(f.used)}</span>`;
      const pct = Math.min(100, Math.round((f.used / f.max) * 100));
      const cls = pct >= 95 ? 'full' : pct >= 80 ? 'high' : '';
      return `<span class="muted">${esc(label)}</span>
        <span class="bar ${cls}" title="${esc(tip)}: ${kb(f.used)} / ${kb(f.max)}"><span style="width:${pct}%"></span></span>
        <span title="${kb(f.used)} / ${kb(f.max)}">${pct}%</span>`;
    };
    return `<div class="mem">${row(W.flash, m.flash, W.flashTip)}${row(W.ram, m.ram, W.ramTip)}</div>`;
  }

  function render() {
    const s = state;
    if (!s) return;
    const T = s.text;
    const W = s.text.webview;
    root.innerHTML =
      notices(s, T) +
      (s.project
        ? `<div class="section" style="padding-top:6px"><div class="row">${icon('folder')}<span style="font-weight:600" class="ellipsis">${esc(s.project.name)}</span></div></div>` +
          pickers(s, T, W) +
          actions(s, T, W) +
          lastRun(s, T, W)
        : noProject(s, T));
  }

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'SELECT') return;
    const a = el.dataset.action;
    if (a === 'openFile') {
      const d = state.run.last.diagnostics[Number(el.dataset.i)];
      vscode.postMessage({ type: a, file: d.file, line: d.line, column: d.column });
    } else if (a === 'notice') vscode.postMessage({ type: a, id: el.dataset.id, a: Number(el.dataset.a) });
    else if (a === 'dismiss') vscode.postMessage({ type: a, id: el.dataset.id });
    else if (a === 'openSketch') vscode.postMessage({ type: a, path: el.dataset.path });
    else vscode.postMessage({ type: a });
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest('select[data-action]');
    if (!el) return;
    if (el.dataset.action === 'selectPort' && el.value)
      vscode.postMessage({ type: 'selectPort', path: el.value });
  });

  window.addEventListener('message', (e) => {
    if (e.data.type === 'state') {
      state = e.data.state;
      render();
    }
  });
  // Detect Board countdown.
  setInterval(() => {
    for (const el of document.querySelectorAll('[data-ends]')) {
      el.textContent = String(Math.max(0, Math.ceil((Number(el.dataset.ends) - Date.now()) / 1000)));
    }
  }, 250);
  vscode.postMessage({ type: 'ready' });
})();
