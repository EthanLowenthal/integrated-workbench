// Sketch view: board, port, Verify/Upload/Monitor, last result, diagnostics.
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

  function banner(s, T) {
    const b = (ic, cls, msg, btn, primary, focus) =>
      `<div class="banner">${icon(ic, cls)}<span class="grow">${esc(msg)}</span><button class="small ${primary ? 'primary' : ''}" data-action="showTools" ${focus ? `data-focus="${focus}"` : ''}>${esc(btn)}</button></div>`;
    if (!s.engineReady) return b('warning', 'warn', T.engineMissing, T.install, true, 'engine');
    if (s.board && !s.boardInstalled) return b('warning', 'warn', T.boardPackageMissing, T.install, true);
    if (s.missingRecommended > 0) return b('info', '', T.recommendedMissing, T.view, false);
    return '';
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
    const where = s.board
      ? `<div class="muted small" style="margin:4px 0 0 52px">${esc(T.boardSaved)}</div>`
      : '';
    return `<div class="section">${board}${where}${options(s, W)}${port}</div>`;
  }

  function options(s, W) {
    if (!s.board) return '';
    const n = (s.options || []).length;
    const changed = (s.options || []).filter((o) => o.changed).length;
    const summary = n
      ? `${n} ${esc(n === 1 ? W.optionOne : W.optionMany)}${changed ? `, ${changed} ${esc(W.modified)}` : ''}`
      : '';
    return `<div class="muted small" style="margin:2px 0 0 52px">${summary}${summary ? ' · ' : ''}<button class="link" data-action="openSettings">${esc(W.configure)}</button></div>`;
  }

  function actions(s, T, W) {
    const r = s.run.running;
    if (r) {
      return `<div class="section"><div class="row"><span class="grow ellipsis">${icon('loading', 'codicon-modifier-spin')} ${esc(r.title)}</span>
        ${r.kind === 'fix' ? '' : `<button class="small" data-action="cancel">${esc(T.cancel)}</button>`}</div><div class="progress"></div></div>`;
    }
    const blocked = s.run.blocked
      ? `<div class="warn small" style="margin-top:6px">${esc(s.run.blocked)}</div>`
      : '';
    return `<div class="section"><div class="actions">
      <button data-action="build" title="${esc(W.verifyTip)} (${esc(s.keys.build)})">${icon('check')} ${esc(W.verify)}</button>
      <button class="primary" data-action="upload" title="${esc(W.uploadTip)} (${esc(s.keys.upload)})">${icon('arrow-right')} ${esc(W.upload)}</button>
      <button data-action="monitor" title="${esc(T.openMonitor)} (${esc(s.keys.monitor)})">${icon('terminal')} ${esc(W.monitor)}</button>
    </div>${blocked}${intellisenseHint(s, W)}</div>`;
  }

  function intellisenseHint(s, W) {
    const i = s.intellisense;
    if (!i || !i.message) return '';
    const ic =
      i.status === 'updating'
        ? icon('loading', 'codicon-modifier-spin')
        : icon(i.status === 'error' ? 'warning' : 'info', i.status === 'error' ? 'warn' : '');
    const btn =
      i.status === 'needsExtension'
        ? `<button class="link" data-action="installCpp">${esc(W.install)}</button>`
        : '';
    return `<div class="row muted small" style="margin-top:8px">${ic}<span class="grow">${esc(i.message)}</span>${btn}</div>`;
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
    return `<div class="section">${head}${diags}${more}${hint}${fix}
      <div style="margin:6px 0 0 20px"><button class="link" data-action="showOutput">${esc(T.showOutput)}</button></div></div>`;
  }

  function card(d, i, action) {
    const sev = {
      error: icon('error', 'error'),
      warning: icon('warning', 'warn'),
      info: icon('info'),
      ok: icon('pass', 'ok'),
    };
    return `<div class="card"><div class="row" style="align-items:flex-start">${sev[d.severity] || ''}<span class="grow" style="font-weight:600">${esc(d.title)}</span></div>
      <div class="muted small" style="margin:2px 0 0 20px">${esc(d.detail)}</div>
      <div class="buttons" style="margin-left:20px">${d.actions
        .map(
          (a, ai) =>
            `<button class="small" data-action="${action}" data-d="${i}" data-a="${ai}">${esc(a.label)}</button>`,
        )
        .join('')}</div></div>`;
  }

  function doctor(s, T) {
    const det = s.detect;
    if (det && det.phase === 'waiting') {
      return `<div class="section"><div class="heading">${esc(T.boardCheck)}</div>
        <div class="card"><div class="row">${icon('loading', 'codicon-modifier-spin')}<span class="grow" style="font-weight:600">${esc(T.detectWaiting)}</span>
          <span class="muted small"><span data-ends="${det.endsAt}"></span>${esc(T.detectSecondsLeft)}</span></div>
          <div class="muted small" style="margin:2px 0 0 20px">${esc(T.detectWaitingDetail)}</div>
          <div class="buttons" style="margin-left:20px"><button class="small" data-action="cancelDetect">${esc(T.cancel)}</button></div></div></div>`;
    }
    if (det && det.phase === 'done') {
      return `<div class="section"><div class="heading">${esc(T.detectResult)}</div>${det.result.map((d, i) => card(d, i, 'detectAction')).join('')}
        <div style="margin-left:20px"><button class="small" data-action="clearDetect">${esc(T.detectDone)}</button></div></div>`;
    }
    const cards = s.doctor.map((d, i) => card(d, i, 'doctorAction')).join('');
    const detect = `<div style="margin:4px 0 0 20px"><button class="link" data-action="detectBoard">${icon('debug-disconnect')} ${esc(T.detectBoard)}</button></div>`;
    if (!s.doctor.length && s.ports.length) return '';
    return `<div class="section"><div class="heading">${esc(T.boardCheck)}</div>${cards}${detect}</div>`;
  }

  function render() {
    const s = state;
    if (!s) return;
    const T = s.text;
    const W = s.text.webview;
    root.innerHTML = s.project
      ? `<div class="section" style="padding-top:6px"><div class="row">${icon('folder')}<span style="font-weight:600" class="ellipsis">${esc(s.project.name)}</span><span class="muted small">${esc(T.sketchKind)}</span></div>${banner(s, T)}</div>` +
        pickers(s, T, W) +
        actions(s, T, W) +
        lastRun(s, T, W) +
        doctor(s, T)
      : noProject(s, T) + doctor(s, T);
  }

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'SELECT') return;
    const a = el.dataset.action;
    if (a === 'openFile') {
      const d = state.run.last.diagnostics[Number(el.dataset.i)];
      vscode.postMessage({ type: a, file: d.file, line: d.line, column: d.column });
    } else if (a === 'doctorAction')
      vscode.postMessage({ type: a, d: Number(el.dataset.d), a: Number(el.dataset.a) });
    else if (a === 'openSketch') vscode.postMessage({ type: a, path: el.dataset.path });
    else if (a === 'showTools') vscode.postMessage({ type: a, focus: el.dataset.focus });
    else vscode.postMessage({ type: a });
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest('select[data-action]');
    if (!el) return;
    if (el.dataset.action === 'selectPort' && el.value)
      vscode.postMessage({ type: 'selectPort', path: el.value });
    if (el.dataset.action === 'setOption')
      vscode.postMessage({ type: 'setOption', id: el.dataset.id, value: el.value });
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
