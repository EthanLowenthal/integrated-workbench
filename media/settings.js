// Sketch Settings page (editor tab). Renders state from the extension; all text from src/text.ts.
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const icon = (name, cls = '') => `<i class="codicon codicon-${name} ${cls}" aria-hidden="true"></i>`;

  const tip = (t) => (t ? ` <span class="info-tip" title="${esc(t)}">${icon('info')}</span>` : '');
  // Descriptions show on hover (info icon) rather than as text under every setting.
  const setting = (title, description, control, modified) => `
    <div class="setting ${modified ? 'modified' : ''}">
      ${title ? `<div class="setting-title">${esc(title)}${tip(description)}</div>` : ''}
      <div class="setting-control">${control}</div>
    </div>`;
  const select = (attrs, options, value) =>
    `<select ${attrs}>${options.map((o) => `<option value="${esc(o.id)}" ${o.id === value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;

  function render(s) {
    const T = s.text;
    if (!s.project) {
      root.innerHTML = `<div class="page"><h1>${esc(T.noSketch)}</h1></div>`;
      return;
    }
    const banner = !s.engineReady
      ? `<div class="banner">${icon('warning', 'warn')}<span class="grow">${esc(T.engineMissing)}</span><button class="small primary" data-action="showTools">${esc(T.installPackage)}</button></div>`
      : s.board && !s.boardInstalled
        ? `<div class="banner">${icon('warning', 'warn')}<span class="grow">${esc(T.boardPackageMissing)}</span><button class="small primary" data-action="showTools">${esc(T.installPackage)}</button></div>`
        : '';

    const board = setting(
      '',
      '',
      `<div class="row"><span class="value">${s.board ? `${esc(s.board.name)} <span class="muted">${esc(s.board.base)}</span>` : `<span class="muted">${esc(T.noBoard)}</span>`}</span>
        <button class="small" data-action="selectBoard">${esc(s.board ? T.changeBoard : T.selectBoard)}</button></div>`,
    );

    let options = '';
    if (s.board) {
      const changed = s.options.filter((o) => o.changed).length;
      const rows = s.options.length
        ? s.options
            .map((o) =>
              setting(
                o.label,
                '',
                select(
                  `data-action="setOption" data-id="${esc(o.id)}" aria-label="${esc(o.label)}"`,
                  o.values.map((v) => ({
                    id: v.id,
                    label: v.id === o.defaultValue ? `${v.label} (${T.defaultLabel})` : v.label,
                  })),
                  o.value,
                ),
                o.changed,
              ),
            )
            .join('')
        : `<div class="muted">${esc(T.noOptions)}</div>`;
      options = `<h2>${esc(T.options)}${tip(T.optionsDescription)}${changed ? ` <span class="badge">${changed} ${esc(T.modified)}</span>` : ''}</h2>
        ${changed ? `<div style="margin:6px 0 4px"><button class="small" data-action="resetOptions">${esc(T.resetOptions)}</button></div>` : ''}
        ${rows}`;
    }

    const portOptions = s.ports.map((p) => ({ id: p.path, label: p.label }));
    if (s.port && !s.ports.some((p) => p.path === s.port))
      portOptions.unshift({ id: s.port, label: `${s.port} (${T.disconnected})` });
    if (!portOptions.length) portOptions.push({ id: '', label: T.noPorts });
    const port = setting(
      '',
      '',
      `<div class="row">${select('data-action="selectPort" aria-label="Port"', portOptions, s.port || '')}<button class="small" data-action="refreshPorts">${icon('refresh')} ${esc(T.refresh)}</button></div>`,
    );

    const bauds = s.monitor.bauds.includes(s.monitor.baud)
      ? s.monitor.bauds
      : [...s.monitor.bauds, s.monitor.baud];
    const monitor =
      setting(
        T.baud,
        T.baudDescription,
        select(
          'data-action="baud" aria-label="Baud"',
          bauds.map((b) => ({ id: b, label: b })),
          s.monitor.baud,
        ),
      ) +
      setting(
        T.lineEnding,
        T.lineEndingDescription,
        select(
          'data-action="lineEnding" aria-label="Line ending"',
          ['none', 'lf', 'cr', 'crlf'].map((k) => ({ id: k, label: s.endings[k] })),
          s.monitor.lineEnding,
        ),
      );

    const i = s.intellisense;
    const status = T.intellisenseStatus[i.status] || '';
    const intellisense = setting(
      '',
      '',
      `<div class="row">${i.status === 'updating' ? icon('loading', 'codicon-modifier-spin') : i.status === 'ready' ? icon('pass', 'ok') : i.status === 'error' ? icon('warning', 'warn') : icon('info')}
        <span class="grow">${esc(status)}${i.status === 'error' && i.message ? ` <span class="muted">${esc(i.message)}</span>` : ''}</span>
        ${i.status === 'needsExtension' ? `<button class="small primary" data-action="installCpp">${esc(T.installCpp)}</button>` : `<button class="small" data-action="refreshIntellisense">${esc(T.refreshIntellisense)}</button>`}</div>
      <div style="margin-top:8px"><button class="link" data-action="writeCompileCommands" title="${esc(T.clangdHint)}">${esc(T.writeCompileCommands)}</button></div>`,
    );

    root.innerHTML = `<div class="page">
      <h1>${esc(s.project.name)}</h1>
      <div><button class="link" data-action="openYaml" title="${esc(T.storedIn)}">${esc(T.openYaml)}</button></div>
      ${banner}
      <h2>${esc(T.board)}${tip(T.boardDescription)}</h2>${board}
      ${options}
      <h2>${esc(T.port)}${tip(T.portDescription)}</h2>${port}
      <h2>${esc(T.monitor)}</h2>${monitor}
      <h2>${esc(T.intellisense)}${tip(T.intellisenseDescription)}</h2>${intellisense}
    </div>`;
  }

  root.addEventListener('click', (e) => {
    const el = e.target.closest('button[data-action]');
    if (el) vscode.postMessage({ type: el.dataset.action });
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest('select[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'setOption') vscode.postMessage({ type: a, id: el.dataset.id, value: el.value });
    else if (a === 'selectPort' && el.value) vscode.postMessage({ type: a, path: el.value });
    else if (a === 'baud') vscode.postMessage({ type: a, baud: el.value });
    else if (a === 'lineEnding') vscode.postMessage({ type: a, ending: el.value });
  });
  window.addEventListener('message', (e) => {
    if (e.data.type === 'state') render(e.data.state);
  });
  vscode.postMessage({ type: 'ready' });
})();
