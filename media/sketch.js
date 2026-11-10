// Sketch view: board, port, Verify/Upload/Monitor, last result, board check.
// Renders state posted by the extension; every button posts a message back. No logic lives here.
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

  function noProject(s) {
    const list = s.sketches.length
      ? `<div class="heading">Sketches in this workspace</div>` +
        s.sketches
          .map(
            (k) =>
              `<div class="diag" style="padding-left:0" data-action="openSketch" data-path="${esc(k.path)}">${icon('file-code')}<span class="ellipsis">${esc(k.name)}</span></div>`,
          )
          .join('')
      : `<p class="muted">No Arduino sketches in this workspace yet. A sketch is a folder with a <code>.ino</code> file of the same name, like <code>Blink/Blink.ino</code>.</p>`;
    return `<div class="section"><p>${esc(s.text.openSketch)}</p>${list}</div>`;
  }

  function banner(s) {
    if (!s.engineReady)
      return `<div class="banner">${icon('warning', 'warn')}<span class="grow">${esc(s.text.engineMissing)}</span><button class="small primary" data-action="showTools" data-focus="engine">${esc(s.text.setUp)}</button></div>`;
    if (s.board && !s.boardInstalled)
      return `<div class="banner">${icon('warning', 'warn')}<span class="grow">${esc(s.text.boardPackageMissing)}</span><button class="small primary" data-action="showTools">${esc(s.text.setUp)}</button></div>`;
    if (s.missingRecommended > 0)
      return `<div class="banner">${icon('lightbulb')}<span class="grow">${esc(s.text.recommendedMissing)}</span><button class="small" data-action="showTools">${esc(s.text.show)}</button></div>`;
    return '';
  }

  function pickers(s) {
    const board = `<div class="row"><span class="label">Board</span>
      <button class="picker" data-action="selectBoard" title="${esc(s.board ? s.board.id : '')}">
        <span class="value ${s.board ? '' : 'muted'}">${esc(s.board ? s.board.name : s.text.selectBoard)}</span>${icon('chevron-down')}
      </button></div>`;
    const opts = s.ports
      .map(
        (p) =>
          `<option value="${esc(p.path)}" ${p.path === s.port ? 'selected' : ''}>${esc(p.label)}</option>`,
      )
      .join('');
    const missingSaved =
      s.port && !s.ports.some((p) => p.path === s.port)
        ? `<option value="${esc(s.port)}" selected>${esc(s.port)} (unplugged)</option>`
        : '';
    const port = `<div class="row" style="margin-top:6px"><span class="label">Port</span>
      <select data-action="selectPort" aria-label="Port">
        ${s.ports.length || missingSaved ? '' : `<option value="" selected>${esc(s.text.noBoardsPlugged)}</option>`}
        ${missingSaved}${opts}
      </select>
      <button class="small" data-action="refreshPorts" title="Look for boards again" aria-label="Refresh ports">${icon('refresh')}</button></div>`;
    const where = s.board
      ? `<div class="muted small" style="margin:4px 0 0 52px">${esc(s.text.boardSaved)}</div>`
      : '';
    return `<div class="section">${board}${where}${port}</div>`;
  }

  function actions(s) {
    const r = s.run.running;
    if (r) {
      return `<div class="section"><div class="row"><span class="grow ellipsis">${icon('loading', 'codicon-modifier-spin')} ${esc(r.title)}</span>
        ${r.kind === 'fix' ? '' : `<button class="small" data-action="cancel">Cancel</button>`}</div><div class="progress"></div></div>`;
    }
    const blocked = s.run.blocked
      ? `<div class="warn small" style="margin-top:6px">${esc(s.run.blocked)}</div>`
      : '';
    return `<div class="section"><div class="actions">
      <button data-action="build" title="Compile (${esc(s.keys.build)})">${icon('check')} Verify</button>
      <button class="primary" data-action="upload" title="Compile and upload (${esc(s.keys.upload)})">${icon('arrow-right')} Upload</button>
      <button class="dim" data-action="monitor" title="${esc(s.text.monitorSoon)}">${icon('terminal')} Monitor</button>
    </div>${blocked}</div>`;
  }

  function lastRun(s) {
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
        ? `<div class="muted small" style="padding-left:20px">${l.diagnostics.length - 30} more in the Problems panel</div>`
        : '';
    const fix = l.fix
      ? `<div class="card"><div>${esc(l.fix.message)}</div><div class="buttons"><button class="primary small" data-action="applyFix">${esc(l.fix.label)}</button></div></div>`
      : '';
    const hint = l.hint ? `<div class="warn small" style="margin:4px 0 0 20px">${esc(l.hint)}</div>` : '';
    return `<div class="section">${head}${diags}${more}${hint}${fix}
      <div style="margin:6px 0 0 20px"><button class="link" data-action="showOutput">Show full output</button></div></div>`;
  }

  function doctor(s) {
    if (!s.doctor.length) return '';
    const sev = {
      error: icon('error', 'error'),
      warning: icon('warning', 'warn'),
      info: icon('info'),
      ok: icon('pass', 'ok'),
    };
    const cards = s.doctor
      .map(
        (
          d,
          di,
        ) => `<div class="card"><div class="row" style="align-items:flex-start">${sev[d.severity] || ''}<span class="grow" style="font-weight:600">${esc(d.title)}</span></div>
        <div class="muted small" style="margin:2px 0 0 20px">${esc(d.detail)}</div>
        <div class="buttons" style="margin-left:20px">${d.actions
          .map(
            (a, ai) =>
              `<button class="small" data-action="doctorAction" data-d="${di}" data-a="${ai}">${esc(a.label)}</button>`,
          )
          .join('')}</div></div>`,
      )
      .join('');
    return `<div class="section"><div class="heading">${esc(s.text.boardCheck)}</div>${cards}</div>`;
  }

  let state;
  function render() {
    const s = state;
    if (!s) return;
    root.innerHTML = s.project
      ? `<div class="section" style="padding-top:6px"><div class="row">${icon('folder')}<span style="font-weight:600" class="ellipsis">${esc(s.project.name)}</span><span class="muted small">Arduino sketch</span></div>${banner(s)}</div>` +
        pickers(s) +
        actions(s) +
        lastRun(s) +
        doctor(s)
      : noProject(s) + doctor(s);
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
    const el = e.target.closest('select[data-action="selectPort"]');
    if (el && el.value) vscode.postMessage({ type: 'selectPort', path: el.value });
  });

  window.addEventListener('message', (e) => {
    if (e.data.type === 'state') {
      state = e.data.state;
      render();
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
