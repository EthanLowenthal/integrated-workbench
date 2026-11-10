// Boards and Tools view: recommended / installed / search, install / update / uninstall, settings.
// Renders state posted by the extension; every button posts a message back. All text comes from
// the extension (src/text.ts), so this file holds no user-facing strings.
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const saved = vscode.getState() || {};
  let query = saved.query || '';
  let settingsOpen = !!saved.settingsOpen;
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

  function button(item, W) {
    const busy = state.busy[item.id];
    if (busy) {
      const pct = busy.fraction !== undefined ? Math.round(busy.fraction * 100) : undefined;
      return `<span class="muted small">${esc(busy.label)}${pct !== undefined ? ` ${pct}%` : ''}</span>`;
    }
    const id = esc(item.id);
    if (item.state === 'available')
      return `<button class="small ${item.reasons.length ? 'primary' : ''}" data-action="install" data-id="${id}">${esc(W.install)}</button>`;
    if (item.state === 'update')
      return `<button class="small primary" data-action="install" data-id="${id}">${esc(W.update)}</button>`;
    if (item.state === 'installed' && item.kind === 'arduino-core')
      return `<button class="small" data-action="uninstall" data-id="${id}" title="${esc(W.uninstallTip)}">${esc(W.uninstall)}</button>`;
    if (item.state === 'installed')
      return `<span class="muted small">${icon('check')} ${esc(W.installed)}</span>`;
    return '';
  }

  function version(item) {
    if (item.state === 'update') return `${esc(item.installedVersion)} → ${esc(item.latestVersion)}`;
    if (item.installedVersion) return esc(item.installedVersion);
    const parts = [];
    if (item.latestVersion) parts.push(esc(item.latestVersion));
    if (item.sizeMb) parts.push(`${item.sizeMb} MB`);
    return parts.join(' · ');
  }

  function itemHtml(item, W) {
    const busy = state.busy[item.id];
    const pct = busy && busy.fraction !== undefined ? Math.round(busy.fraction * 100) : undefined;
    const badge = item.source
      ? `<span class="badge" title="${esc(W.sourceTip)}: ${esc(item.source)}">${esc(item.source)}</span>`
      : '';
    // Descriptions, reasons and notes show on hover instead of as extra lines.
    const tip = [...item.reasons, item.detail, item.state !== 'installed' ? item.note : '']
      .filter(Boolean)
      .join('\n');
    return `<div class="item ${focusId === item.id ? 'focus' : ''}" id="item-${esc(item.id)}" title="${esc(tip)}">
      <div class="icon">${icon(item.icon)}</div>
      <div class="grow">
        <div class="row"><span class="name ellipsis">${esc(item.name)}</span>${badge}${tip ? `<span class="info-tip">${icon('info')}</span>` : ''}</div>
        <div class="muted small">${version(item)}</div>
        ${busy ? `<div class="progress ${pct !== undefined ? 'determinate' : ''}" style="--p:${pct ?? 0}%"></div>` : ''}
      </div>
      <div class="side">${button(item, W)}</div>
    </div>`;
  }

  function group(title, items, W, empty) {
    const shown = items.filter(matches);
    if (!shown.length && !empty) return '';
    return `<div class="group"><div class="heading"><span>${esc(title)}</span><span>${shown.length || ''}</span></div>
      ${shown.length ? shown.map((i) => itemHtml(i, W)).join('') : `<div class="muted small">${esc(empty)}</div>`}</div>`;
  }

  function render() {
    const s = state;
    if (!s) return;
    const W = s.text;
    const search = `<div class="row" style="margin-top:6px"><input type="search" id="q" placeholder="${esc(W.searchPlaceholder)}" value="${esc(query)}" aria-label="${esc(W.searchPlaceholder)}">
      <button class="small" data-action="refresh" title="${esc(W.refreshList)}" aria-label="${esc(W.refreshList)}">${icon(s.loading ? 'loading' : 'refresh', s.loading ? 'codicon-modifier-spin' : '')}</button></div>`;
    const available = query ? group(W.available, s.available, W, W.noMatches) : '';
    const regs = s.registries
      .map(
        (
          r,
        ) => `<div class="row small" title="${esc(r.spec)}">${icon(r.errors.length ? 'warning' : 'database', r.errors.length ? 'warn' : '')}
        <span class="grow ellipsis">${esc(r.name)}${r.builtin ? ` <span class="muted">(${esc(W.builtIn)})</span>` : ''}</span>
        ${r.errors.length ? `<button class="link" data-action="showOutput">${r.errors.length} ${esc(r.errors.length === 1 ? W.errorSingular : W.errorPlural)}</button>` : ''}</div>`,
      )
      .join('');
    // Settings sit collapsed at the bottom; problems with registries show in Notifications.
    const settings = `<details class="group settings" ${settingsOpen ? 'open' : ''}>
      <summary class="heading">${icon('chevron-right')} ${esc(W.settings)}</summary>
      <div class="settings-body">
        <button class="link" data-action="openSketchSettings">${icon('settings-gear')} ${esc(W.sketchSettings)}</button>
        <button class="link" data-action="openExtensionSettings">${icon('settings')} ${esc(W.extensionSettings)}</button>
        <div class="heading" style="margin-top:8px">${esc(W.registries)}</div>${regs}
        <div class="row" style="margin-top:4px;gap:4px 12px;flex-wrap:wrap">
          <button class="link" data-action="addRegistry">${icon('add')} ${esc(W.addRegistry)}</button>
          <button class="link" data-action="editRegistries">${esc(W.configure)}</button>
          <button class="link" data-action="registryHelp">${esc(W.documentation)}</button>
        </div>
      </div></details>`;
    root.innerHTML =
      search +
      group(W.recommended, s.recommended, W) +
      group(W.installedGroup, s.installed, W) +
      available +
      (query ? '' : `<div class="muted small" style="margin-top:8px">${esc(W.searchToBrowse)}</div>`) +
      settings;
    root.querySelector('details.settings').addEventListener('toggle', (e) => {
      settingsOpen = e.target.open;
      vscode.setState({ query, settingsOpen });
    });
    const q = document.getElementById('q');
    q.addEventListener('input', () => {
      query = q.value;
      vscode.setState({ query, settingsOpen });
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
