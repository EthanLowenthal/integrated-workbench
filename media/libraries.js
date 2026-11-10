// Libraries view: required by this sketch, installed, search. All text comes from src/text.ts.
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  let state;
  let query = (vscode.getState() || {}).query || '';
  let timer;

  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const icon = (name, cls = '') => `<i class="codicon codicon-${name} ${cls}" aria-hidden="true"></i>`;

  function button(item, T) {
    const busy = state.busy[item.name];
    if (busy)
      return `<span class="muted small">${icon('loading', 'codicon-modifier-spin')} ${esc(busy)}</span>`;
    const n = esc(item.name);
    if (item.state === 'available')
      return `<button class="small primary" data-action="install" data-name="${n}">${esc(T.install)}</button>`;
    const update =
      item.state === 'update'
        ? `<button class="small primary" data-action="install" data-name="${n}">${esc(T.update)}</button>`
        : '';
    return `${update}<button class="small" data-action="uninstall" data-name="${n}">${esc(T.uninstall)}</button>`;
  }

  function itemHtml(item, T, extra = '') {
    const version =
      item.state === 'update'
        ? `${esc(item.installedVersion)} → ${esc(item.latestVersion)}`
        : esc(item.installedVersion || item.latestVersion || '');
    return `<div class="item">
      <div class="icon">${icon('library')}</div>
      <div class="grow">
        <div class="row"><span class="name ellipsis">${esc(item.name)}</span><span class="muted small">${version}</span></div>
        ${item.sentence ? `<div class="muted small">${esc(item.sentence)}</div>` : ''}
        ${item.author ? `<div class="muted small ellipsis">${esc(T.by)} ${esc(item.author)}</div>` : ''}
        ${extra}
      </div>
      <div class="side">${button(item, T)}</div>
    </div>`;
  }

  function render() {
    const s = state;
    if (!s) return;
    const T = s.text;
    if (!s.engineReady) {
      root.innerHTML = `<div class="section"><p class="muted">${esc(T.engineMissing)}</p><button class="small primary" data-action="openTools">${esc(T.openTools)}</button></div>`;
      return;
    }
    const search = `<div class="row" style="margin-top:6px"><input type="search" id="q" placeholder="${esc(T.searchPlaceholder)}" value="${esc(query)}" aria-label="${esc(T.searchPlaceholder)}">
      <button class="small" data-action="refresh" title="${esc(T.refresh)}" aria-label="${esc(T.refresh)}">${icon(s.loading || s.searching ? 'loading' : 'refresh', s.loading || s.searching ? 'codicon-modifier-spin' : '')}</button></div>`;
    const error = s.error
      ? `<div class="banner">${icon('error', 'error')}<span class="grow">${esc(s.error)}</span><button class="link" data-action="showOutput">${esc(T.output)}</button></div>`
      : '';
    const required = s.required.length
      ? `<div class="group"><div class="heading"><span>${esc(T.required)}</span><span>${s.required.length}</span></div>
          <div class="muted small">${esc(T.requiredHint)}</div>
          ${s.required
            .map((r) =>
              r.library
                ? itemHtml(r.library, T, `<div class="why">#include &lt;${esc(r.header)}&gt;</div>`)
                : `<div class="item"><div class="icon">${icon('warning', 'warn')}</div><div class="grow"><div class="name">${esc(r.header)}</div><div class="muted small">${esc(T.noLibraryFor)}</div></div></div>`,
            )
            .join('')}</div>`
      : '';
    const results =
      query.trim().length >= 2
        ? `<div class="group"><div class="heading"><span>${esc(T.results)}</span><span>${s.results.length || ''}</span></div>
          ${s.results.length ? s.results.map((i) => itemHtml(i, T)).join('') : s.searching ? '' : `<div class="muted small">${esc(T.noResults)}</div>`}</div>`
        : `<div class="muted small" style="margin-top:8px">${esc(T.searchHint)}</div>`;
    const installed = `<div class="group"><div class="heading"><span>${esc(T.installed)}</span><span>${s.installed.length || ''}</span></div>
      ${s.installed.length ? s.installed.map((i) => itemHtml(i, T)).join('') : `<div class="muted small">${esc(T.noneInstalled)}</div>`}</div>`;
    root.innerHTML = search + error + required + results + installed;

    const q = document.getElementById('q');
    q.addEventListener('input', () => {
      query = q.value;
      vscode.setState({ query });
      clearTimeout(timer);
      timer = setTimeout(() => vscode.postMessage({ type: 'search', query }), 300);
      const pos = q.selectionStart;
      render();
      const again = document.getElementById('q');
      again.focus();
      again.setSelectionRange(pos, pos);
    });
  }

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (el) vscode.postMessage({ type: el.dataset.action, name: el.dataset.name });
  });
  window.addEventListener('message', (e) => {
    if (e.data.type === 'state') {
      state = e.data.state;
      render();
    }
  });
  vscode.postMessage({ type: 'ready' });
  if (query.trim().length >= 2) vscode.postMessage({ type: 'search', query });
})();
