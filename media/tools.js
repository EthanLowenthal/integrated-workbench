// Boards and tools view: recommended / installed / search-all, install / update / uninstall, registries.
// Renders state posted by the extension; every button posts a message back.
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const saved = vscode.getState() || {};
  let query = saved.query || '';
  let state;
  let focusId;

  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const icon = (name, cls = '') => `<i class="codicon codicon-${name} ${cls}" aria-hidden="true"></i>`;

  function matches(item) {
    if (!query) return true;
    const q = query.toLowerCase();
    return [item.name, item.id, item.detail, ...(item.reasons || [])].some((f) =>
      String(f || '')
        .toLowerCase()
        .includes(q),
    );
  }

  function button(item) {
    const busy = state.busy[item.id];
    if (busy) {
      const pct = busy.fraction !== undefined ? Math.round(busy.fraction * 100) : undefined;
      return `<span class="muted small">${esc(busy.label)}${pct !== undefined ? ` ${pct}%` : ''}</span>`;
    }
    if (item.kind === 'soon') return '';
    if (item.state === 'available')
      return `<button class="small ${item.reasons.length ? 'primary' : ''}" data-action="install" data-id="${esc(item.id)}">Install</button>`;
    if (item.state === 'update')
      return `<button class="small primary" data-action="install" data-id="${esc(item.id)}">Update</button>`;
    if (item.state === 'installed' && item.kind === 'arduino-core')
      return `<button class="small" data-action="uninstall" data-id="${esc(item.id)}" title="Remove this board package">Uninstall</button>`;
    if (item.state === 'installed') return `<span class="muted small">${icon('check')} Installed</span>`;
    return '';
  }

  function version(item) {
    if (item.kind === 'soon') return '';
    if (item.state === 'update') return `${esc(item.installedVersion)} → ${esc(item.latestVersion)}`;
    if (item.installedVersion) return esc(item.installedVersion);
    const parts = [];
    if (item.latestVersion) parts.push(esc(item.latestVersion));
    if (item.sizeMb) parts.push(`${item.sizeMb} MB`);
    return parts.join(' · ');
  }

  function itemHtml(item) {
    const busy = state.busy[item.id];
    const pct = busy && busy.fraction !== undefined ? Math.round(busy.fraction * 100) : undefined;
    const badges = [
      item.source
        ? `<span class="badge" title="From the ${esc(item.source)} registry">${esc(item.source)}</span>`
        : '',
      item.unverified
        ? `<span class="badge" title="Some details haven't been verified against a primary source yet">unverified</span>`
        : '',
    ].join(' ');
    return `<div class="item ${focusId === item.id ? 'focus' : ''}" id="item-${esc(item.id)}">
      <div class="icon">${icon(item.icon)}</div>
      <div class="grow">
        <div class="row"><span class="name ellipsis">${esc(item.name)}</span>${badges}</div>
        <div class="muted small">${version(item)}</div>
        ${item.detail ? `<div class="muted small">${esc(item.detail)}</div>` : ''}
        ${item.reasons.map((r) => `<div class="why">${esc(r)}</div>`).join('')}
        ${item.note && item.state !== 'installed' ? `<div class="muted small">${esc(item.note)}</div>` : ''}
        ${busy ? `<div class="progress ${pct !== undefined ? 'determinate' : ''}" style="--p:${pct ?? 0}%"></div>` : ''}
      </div>
      <div class="side">${button(item)}</div>
    </div>`;
  }

  function group(title, items, empty) {
    const shown = items.filter(matches);
    if (!shown.length && !empty) return '';
    return `<div class="group"><div class="heading"><span>${esc(title)}</span><span>${shown.length || ''}</span></div>
      ${shown.length ? shown.map(itemHtml).join('') : `<div class="muted small">${esc(empty)}</div>`}</div>`;
  }

  function render() {
    const s = state;
    if (!s) return;
    const search = `<div class="row" style="margin-top:6px"><input type="search" id="q" placeholder="Search boards and tools" value="${esc(query)}" aria-label="Search boards and tools">
      <button class="small" data-action="refresh" title="Refresh the board list" aria-label="Refresh">${icon(s.loading ? 'loading' : 'refresh', s.loading ? 'codicon-modifier-spin' : '')}</button></div>`;
    const error = s.error
      ? `<div class="banner">${icon('error', 'error')}<span class="grow">${esc(s.error)}</span><button class="link" data-action="showOutput">Output</button></div>`
      : '';
    const available = query
      ? group('Available', s.available, 'No matches.')
      : `<div class="group"><div class="heading"><span>Available</span><span>${s.available.length || ''}</span></div>
          <div class="muted small">${s.engineReady ? `Search to browse ${s.available.length} more board packages.` : 'Install the build engine to browse every board package.'}</div></div>`;
    const regs = s.registries
      .map(
        (
          r,
        ) => `<div class="row small" title="${esc(r.spec)}">${icon(r.errors.length ? 'warning' : 'database', r.errors.length ? 'warn' : '')}
        <span class="grow ellipsis">${esc(r.name)}${r.builtin ? ' <span class="muted">(built in)</span>' : ''}</span>
        ${r.errors.length ? `<button class="link" data-action="showOutput">${r.errors.length} problem${r.errors.length === 1 ? '' : 's'}</button>` : ''}</div>`,
      )
      .join('');
    root.innerHTML =
      search +
      error +
      group(
        'Recommended for this workspace',
        s.recommended,
        query ? '' : 'Nothing to recommend yet. Open a sketch or plug in a board.',
      ) +
      group('Installed', s.installed) +
      available +
      group('Coming soon', s.soon) +
      `<div class="group"><div class="heading"><span>Registries</span></div>${regs}
        <div class="row" style="margin-top:6px;gap:12px"><button class="link" data-action="addRegistry">${icon('add')} Add registry</button>
        <button class="link" data-action="editRegistries">Edit list</button><button class="link" data-action="registryHelp">How to build one</button></div></div>`;
    const q = document.getElementById('q');
    q.addEventListener('input', () => {
      query = q.value;
      vscode.setState({ query });
      const pos = q.selectionStart;
      render();
      const again = document.getElementById('q');
      again.focus();
      again.setSelectionRange(pos, pos);
    });
    if (focusId) document.getElementById(`item-${focusId}`)?.scrollIntoView({ block: 'nearest' });
  }

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    vscode.postMessage({ type: el.dataset.action, id: el.dataset.id });
  });

  window.addEventListener('message', (e) => {
    if (e.data.type === 'state') state = e.data.state;
    if (e.data.type === 'focus') {
      focusId = e.data.id;
      query = '';
      setTimeout(() => {
        focusId = undefined;
        render();
      }, 2500);
    }
    render();
  });
  vscode.postMessage({ type: 'ready' });
})();
