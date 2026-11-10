// Build panel: output of the last few Verify/Upload runs. Error and warning lines open the file.
// All text comes from the extension (src/text.ts).
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const icon = (name, cls = '') => `<i class="codicon codicon-${name} ${cls}" aria-hidden="true"></i>`;
  const LOC = /^\s*\S.*?:\d+:(\d+:)?\s*(fatal error|error|warning|note):/i;

  let runs = [];
  let selected;
  let ui;
  let partial = ''; // last line, not yet terminated
  let stick = true;

  root.innerHTML = `<div class="build">
    <div class="build-bar">
      <span class="build-status"></span>
      <select id="run" aria-label="Run"></select>
      <button class="icon-btn" id="copy">${icon('copy')}</button>
    </div>
    <pre class="build-out" id="out" tabindex="0"></pre>
  </div>`;
  const $ = (id) => document.getElementById(id);
  const out = $('out');

  function lineHtml(line) {
    const m = LOC.exec(line);
    if (!m) return `<div>${esc(line) || ' '}</div>`;
    const sev = m[2].toLowerCase();
    const cls = sev.includes('error') ? 'error' : sev === 'warning' ? 'warn' : '';
    return `<div class="loc ${cls}" data-line="${esc(line)}" title="${esc(ui.openLine)}">${esc(line)}</div>`;
  }

  function write(textChunk, replace) {
    if (replace) {
      out.innerHTML = '';
      partial = '';
    }
    const lines = (partial + textChunk).split(/\r?\n/);
    partial = lines.pop();
    const last = out.lastElementChild;
    if (last && last.dataset.partial) last.remove();
    out.insertAdjacentHTML(
      'beforeend',
      lines.map(lineHtml).join('') +
        (partial ? lineHtml(partial).replace('<div', '<div data-partial="1"') : ''),
    );
    if (stick) out.scrollTop = out.scrollHeight;
  }

  function seconds(r) {
    const ms = (r.endedAt || Date.now()) - r.startedAt;
    return (ms < 10000 ? (ms / 1000).toFixed(1) : Math.round(ms / 1000)) + ' s';
  }

  function renderBar() {
    const run = runs.find((r) => r.id === selected);
    const status = document.querySelector('.build-status');
    if (!run) {
      status.innerHTML = `<span class="muted">${esc(ui.empty)}</span>`;
    } else if (run.ok === undefined) {
      status.innerHTML = `${icon('loading', 'codicon-modifier-spin')} <span class="ellipsis">${esc(run.title)}</span>`;
    } else {
      status.innerHTML = `${run.ok ? icon('pass', 'ok') : icon('error', 'error')} <span class="ellipsis">${esc(run.summary)}</span> <span class="muted">${seconds(run)}</span>`;
    }
    const sel = $('run');
    sel.style.display = runs.length > 1 ? '' : 'none';
    sel.innerHTML = runs
      .map(
        (r) =>
          `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${esc(new Date(r.startedAt).toLocaleTimeString())} · ${esc(r.summary || r.title)}</option>`,
      )
      .join('');
    $('copy').title = ui.copy;
    $('copy').setAttribute('aria-label', ui.copy);
    $('copy').disabled = !run;
  }

  out.addEventListener('scroll', () => {
    stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 4;
  });
  out.addEventListener('click', (e) => {
    const el = e.target.closest('.loc');
    if (el) vscode.postMessage({ type: 'openLine', line: el.dataset.line });
  });
  $('run').addEventListener('change', (e) =>
    vscode.postMessage({ type: 'select', id: Number(e.target.value) }),
  );
  $('copy').addEventListener('click', () => selected && vscode.postMessage({ type: 'copy', id: selected }));

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'runs') {
      ui = m.ui;
      runs = m.runs;
      selected = m.selected;
      renderBar();
      if (m.text !== undefined) {
        stick = true;
        write(m.text, true);
      }
    } else if (m.type === 'append' && m.id === selected) {
      write(m.text, false);
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
