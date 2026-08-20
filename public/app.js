(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Icons — единый набор line-icons (в духе Lucide), встроен как SVG,
  // чтобы не тянуть внешнюю библиотеку и не смешивать стили иконок.
  // ---------------------------------------------------------------------

  const ICONS = {
    home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"/>',
    inbox: '<path d="M4 12h4l2 3h4l2-3h4"/><path d="M4 12 5.5 5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1L20 12v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6Z"/>',
    user: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/>',
    shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h13M21 18h-1"/><circle cx="17" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    chevronLeft: '<path d="m14.5 5-7 7 7 7"/>',
    chevronDown: '<path d="m5 8.5 7 7 7-7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 10.5v6M12 7.5v.01"/>',
    paperclip: '<path d="M20 12.5 12.5 20a4.5 4.5 0 0 1-6.4-6.4l8-8a3 3 0 0 1 4.3 4.3l-8 8a1.5 1.5 0 0 1-2.1-2.1l7.4-7.4"/>',
    send: '<path d="m4 12 16-8-6 16-2.5-6L4 12Z"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.3 2.3L16 10"/>',
    alertTriangle: '<path d="M12 4.5 21 19H3L12 4.5Z"/><path d="M12 10v4.2M12 17v.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    refresh: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 16m0 4v-4h4"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/><path d="m4.5 6.5 7.5 6 7.5-6"/>',
    key: '<circle cx="8" cy="15" r="3.3"/><path d="m10.3 12.7 8.2-8.2M16.5 4.5l2 2M14 8l2 2"/>',
  };

  function icon(name, extraClass) {
    const body = ICONS[name] || '';
    return `<svg class="icon${extraClass ? ' ' + extraClass : ''}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  }

  // ---------------------------------------------------------------------
  // Константы
  // ---------------------------------------------------------------------

  const STATUS_LABELS = {
    NEW: 'Новое',
    IN_PROGRESS: 'В работе',
    WAITING_FOR_CLIENT: 'Ожидает клиента',
    RESOLVED: 'Решено',
    CLOSED: 'Закрыто',
  };

  const FILTERS = [
    { key: 'all', label: 'Все' },
    { key: 'new', label: 'Новые' },
    { key: 'mine', label: 'Мои' },
    { key: 'in_progress', label: 'В работе' },
    { key: 'waiting', label: 'Ожидают' },
    { key: 'resolved', label: 'Решённые' },
  ];

  // ---------------------------------------------------------------------
  // Состояние приложения (единственный источник правды для рендера)
  // ---------------------------------------------------------------------

  const state = {
    me: null,
    categories: [],
    screen: 'loading',
    nav: 'home',
    errorMessage: '',

    filter: 'all',
    tickets: [],
    loadingTickets: false,
    ticketsError: null,
    counts: { NEW: 0, IN_PROGRESS: 0, WAITING_FOR_CLIENT: 0, RESOLVED: 0, CLOSED: 0 },
    searchQuery: '',
    extraFilters: { branchId: '', category: '', employeeId: '', sla: '', period: 'all' },
    sheetOpen: null,

    homeMineTickets: [],

    currentTicket: null,
    currentMessages: [],
    chatNearBottom: true,
    pendingScrollIndicator: false,
    pendingPhoto: null,

    adminTab: 'overview',
    adminOverview: null,
    adminSlaSummary: null,
    adminBranches: [],
    adminEmployees: [],
    adminSla: null,
  };

  const app = document.getElementById('app');

  // ---------------------------------------------------------------------
  // Хелперы
  // ---------------------------------------------------------------------

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return '—';
    seconds = Math.round(Number(seconds));
    if (seconds < 60) return `${seconds} сек`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} мин`;
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return `${hours}ч ${restMinutes}м`;
  }

  function formatRelative(dateStr) {
    if (!dateStr) return '';
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'только что';
    if (diffMin < 60) return `${diffMin} мин`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} ч`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay === 1) return 'вчера';
    if (diffDay < 7) return `${diffDay} дн`;
    return new Date(dateStr).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  function formatClock(dateStr) {
    return new Date(dateStr).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function formatFullDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function computeSla(ticket, me) {
    if (!me || !ticket) return null;
    if (ticket.status === 'CLOSED' || ticket.status === 'RESOLVED') return null;
    const createdMs = new Date(ticket.created_at).getTime();
    const elapsedMin = (Date.now() - createdMs) / 60000;
    const thresholdMin = ticket.first_response_at ? me.resolutionSlaMinutes : me.firstResponseSlaMinutes;
    const remainingMin = thresholdMin - elapsedMin;
    if (remainingMin < 0) return { level: 'breach', label: 'SLA нарушен' };
    if (remainingMin <= 5) return { level: 'warn', label: `SLA: ${Math.max(0, Math.round(remainingMin))} мин` };
    return { level: 'ok', label: `SLA ${Math.round(elapsedMin)} мин` };
  }

  async function api(path, options = {}) {
    const tg = window.Telegram && window.Telegram.WebApp;
    const initData = tg ? tg.initData : '';
    const res = await fetch('/api' + path, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': initData || '',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      // тело могло быть пустым
    }
    if (!res.ok) {
      throw new Error(data.error || 'Ошибка запроса к серверу.');
    }
    return data;
  }

  function toast(message, type) {
    const host = document.getElementById('toastHost');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' toast-error' : '');
    el.innerHTML = `${type === 'error' ? icon('alertTriangle', 'icon-sm') : icon('checkCircle', 'icon-sm')}<span>${esc(message)}</span>`;
    host.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .2s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 200);
    }, 2600);
  }

  function applyTheme() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
    } catch (e) {}
    const setScheme = () => {
      document.documentElement.setAttribute('data-theme', tg.colorScheme === 'dark' ? 'dark' : 'light');
    };
    setScheme();
    try {
      tg.onEvent('themeChanged', setScheme);
    } catch (e) {}
  }

  // ---------------------------------------------------------------------
  // Skeleton / empty / error building blocks
  // ---------------------------------------------------------------------

  function skeletonRowsHtml(n) {
    return Array.from({ length: n })
      .map(
        () => `
      <div class="skeleton-row">
        <div class="skeleton-block skeleton-line" style="width:40%"></div>
        <div class="skeleton-block skeleton-line" style="width:75%"></div>
        <div class="skeleton-block skeleton-line" style="width:30%"></div>
      </div>`
      )
      .join('');
  }

  function skeletonKpiHtml() {
    return `<div class="kpi-grid">${Array.from({ length: 6 })
      .map(
        () => `<div class="kpi-card">
        <div class="skeleton-block" style="height:22px;width:55%;margin-bottom:8px;border-radius:4px;"></div>
        <div class="skeleton-block skeleton-line" style="width:80%"></div>
      </div>`
      )
      .join('')}</div>`;
  }

  function emptyBlockHtml(iconName, title, sub, extra) {
    return `
      <div class="state-block">
        ${icon(iconName, 'icon-lg')}
        <div class="state-title">${esc(title)}</div>
        ${sub ? `<div class="state-sub">${esc(sub)}</div>` : ''}
        ${extra || ''}
      </div>`;
  }

  // ---------------------------------------------------------------------
  // Render dispatcher
  // ---------------------------------------------------------------------

  function render() {
    if (state.screen === 'loading') return renderLoading();
    if (state.screen === 'error') return renderError();
    if (state.screen === 'ticket') return renderTicketScreen();
    if (state.screen === 'admin') return renderAdminScreen();
    if (state.screen === 'list') return renderListScreen();
    return renderHomeScreen();
  }

  function renderLoading() {
    app.innerHTML = `<div class="screen">${skeletonRowsHtml(6)}</div>`;
  }

  function renderError() {
    app.innerHTML = `
      <div class="error-screen">
        ${icon('alertTriangle', 'icon-lg')}
        <div class="state-title">Не удалось открыть приложение</div>
        <div class="state-sub">${esc(state.errorMessage)}</div>
      </div>`;
  }

  // ---------------------------------------------------------------------
  // Bottom navigation
  // ---------------------------------------------------------------------

  function bottomNavHtml() {
    const items = [
      { key: 'home', label: 'Главная', iconName: 'home', onClick: 'App.goHome()' },
      { key: 'list', label: 'Обращения', iconName: 'inbox', onClick: "App.goList('all')", badge: state.counts.NEW },
      { key: 'mine', label: 'Мои', iconName: 'user', onClick: "App.goList('mine')" },
    ];
    if (state.me && state.me.role === 'SUPER_ADMIN') {
      items.push({ key: 'admin', label: 'Админ', iconName: 'shield', onClick: 'App.goAdmin()' });
    }
    return `<nav class="bottom-nav">${items
      .map(
        (it) => `
      <button class="bottom-nav-item ${state.nav === it.key ? 'active' : ''}" onclick="${it.onClick}">
        ${it.badge ? `<span class="bottom-nav-badge">${it.badge > 99 ? '99+' : it.badge}</span>` : ''}
        ${icon(it.iconName)}
        <span>${it.label}</span>
      </button>`
      )
      .join('')}</nav>`;
  }

  // ---------------------------------------------------------------------
  // Home screen
  // ---------------------------------------------------------------------

  function greetingText() {
    const h = new Date().getHours();
    const g = h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
    const parts = (state.me.name || '').trim().split(/\s+/);
    const first = parts.length > 1 ? parts[1] : parts[0];
    return `${g}, ${esc(first || '')}`;
  }

  function renderHomeScreen() {
    const branchLabel =
      state.me.role === 'SUPER_ADMIN' ? 'Все филиалы' : state.me.branch ? `${state.me.branch.code} — ${state.me.branch.name}` : '—';

    const mineHtml =
      state.homeMineTickets && state.homeMineTickets.length
        ? state.homeMineTickets.map(ticketRowHtml).join('')
        : emptyBlockHtml('inbox', 'Нет активных обращений', 'Все ваши обращения обработаны.');

    app.innerHTML = `
      <div class="screen">
        <div class="home-greeting">
          <div class="home-greeting-title">${greetingText()}</div>
          <div class="home-greeting-sub">${esc(branchLabel)}</div>
        </div>
        <div class="stat-pills">
          <button class="stat-pill dot-new" onclick="App.goList('new')">
            <div class="stat-pill-value">${state.counts.NEW}</div>
            <div class="stat-pill-label">Новые</div>
          </button>
          <button class="stat-pill dot-progress" onclick="App.goList('in_progress')">
            <div class="stat-pill-value">${state.counts.IN_PROGRESS}</div>
            <div class="stat-pill-label">В работе</div>
          </button>
          <button class="stat-pill dot-waiting" onclick="App.goList('waiting')">
            <div class="stat-pill-value">${state.counts.WAITING_FOR_CLIENT}</div>
            <div class="stat-pill-label">Ожидают</div>
          </button>
        </div>
        <div class="quick-actions">
          <button class="quick-action-btn" onclick="App.goList('all')">${icon('inbox', 'icon-sm')}Все обращения</button>
          <button class="quick-action-btn" onclick="App.goList('mine')">${icon('user', 'icon-sm')}Мои обращения</button>
        </div>
        <div class="section-title">Мои обращения</div>
        <div class="ticket-list">${mineHtml}</div>
      </div>
      ${bottomNavHtml()}`;
  }

  async function goHome() {
    state.sheetOpen = null;
    state.screen = 'home';
    state.nav = 'home';
    render();
    await refreshCounts();
    render();
    try {
      state.homeMineTickets = (await api('/tickets?filter=mine')).slice(0, 5);
    } catch (e) {
      state.homeMineTickets = [];
    }
    render();
  }

  // ---------------------------------------------------------------------
  // Ticket row (переиспользуется на Home и в списке)
  // ---------------------------------------------------------------------

  function ticketRowHtml(t) {
    const branchTag = state.me.role === 'SUPER_ADMIN' && t.branch_code ? `<span class="ticket-row-branch">[${esc(t.branch_code)}]</span> ` : '';
    const sla = computeSla(t, state.me);
    const slaBadge = sla
      ? `<span class="badge badge-sla-${sla.level}">${icon(sla.level === 'breach' ? 'alertTriangle' : 'clock', 'icon-sm')}${esc(sla.label)}</span>`
      : '';
    const assignee = t.assigned_employee_name
      ? `<span class="assignee-chip">${icon('user', 'icon-sm')}${esc(t.assigned_employee_name)}</span>`
      : '';
    return `
      <div class="ticket-row" onclick="App.openTicket(${t.id})">
        <span class="status-dot status-${t.status}"></span>
        <div class="ticket-row-body">
          <div class="ticket-row-top">
            <span class="ticket-row-customer">${branchTag}${esc(t.company_name || 'Клиент #' + t.customer_id)}</span>
            <span class="ticket-row-time">${formatRelative(t.updated_at)}</span>
          </div>
          <div class="ticket-row-subject">#${t.ticket_number} · ${esc(t.subject)}</div>
          ${t.last_message_text ? `<div class="ticket-row-preview">${esc(t.last_message_text)}</div>` : ''}
          <div class="ticket-row-meta">
            <span class="badge badge-${t.status}">${STATUS_LABELS[t.status] || t.status}</span>
            ${slaBadge}
            ${assignee}
          </div>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------------
  // Ticket list screen (Обращения / Мои)
  // ---------------------------------------------------------------------

  function getFilteredTickets() {
    let list = state.tickets.slice();
    const q = state.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          String(t.ticket_number).includes(q) ||
          (t.company_name || '').toLowerCase().includes(q) ||
          (t.subject || '').toLowerCase().includes(q) ||
          (t.last_message_text || '').toLowerCase().includes(q)
      );
    }
    if (state.extraFilters.category) list = list.filter((t) => t.category === state.extraFilters.category);
    if (state.extraFilters.employeeId) list = list.filter((t) => String(t.assigned_employee_id) === state.extraFilters.employeeId);
    if (state.extraFilters.sla) {
      list = list.filter((t) => {
        const s = computeSla(t, state.me);
        return s && s.level === state.extraFilters.sla;
      });
    }
    if (state.extraFilters.period === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      list = list.filter((t) => new Date(t.created_at) >= start);
    } else if (state.extraFilters.period === 'week') {
      const weekAgo = Date.now() - 7 * 86400000;
      list = list.filter((t) => new Date(t.created_at).getTime() >= weekAgo);
    }
    return list;
  }

  function listTitle() {
    return state.nav === 'mine' ? 'Мои обращения' : 'Обращения';
  }

  function renderListScreen() {
    const filtered = getFilteredTickets();
    let body;
    if (state.loadingTickets) {
      body = skeletonRowsHtml(6);
    } else if (state.ticketsError) {
      body = emptyBlockHtml(
        'alertTriangle',
        'Не удалось загрузить обращения.',
        '',
        `<button class="retry-btn" onclick="App.refreshTickets()">${icon('refresh', 'icon-sm')}Повторить</button>`
      );
    } else if (!filtered.length) {
      body = emptyBlockHtml('inbox', 'Обращений не найдено', 'Попробуйте изменить фильтры или поисковый запрос.');
    } else {
      body = filtered.map(ticketRowHtml).join('');
    }

    const extraActive = Object.keys(state.extraFilters).some((k) => k !== 'period' && state.extraFilters[k]) || state.extraFilters.period !== 'all';

    app.innerHTML = `
      <div class="screen">
        <div class="topbar">
          <div class="topbar-row"><div class="topbar-title">${listTitle()}</div></div>
          <div class="search-bar">
            ${icon('search')}
            <input id="searchInput" placeholder="Поиск обращений..." value="${esc(state.searchQuery)}" oninput="App.onSearchInput(this.value)" />
            ${state.searchQuery ? `<button class="search-clear" onclick="App.clearSearch()">${icon('x', 'icon-sm')}</button>` : ''}
          </div>
        </div>
        <div class="filter-row">
          ${FILTERS.map((f) => `<button class="chip ${state.filter === f.key ? 'active' : ''}" onclick="App.goList('${f.key}')">${f.label}</button>`).join('')}
          <button class="chip chip-ghost ${extraActive ? 'active' : ''}" onclick="App.openFilterSheet()">${icon('sliders', 'icon-sm')}Фильтры</button>
        </div>
        <div class="ticket-list">${body}</div>
      </div>
      ${bottomNavHtml()}
      ${state.sheetOpen === 'filters' ? filterSheetHtml() : ''}`;

    const input = document.getElementById('searchInput');
    if (input && document.activeElement !== input && state.searchFocusPending) {
      input.focus();
      state.searchFocusPending = false;
    }
  }

  async function goList(filter) {
    state.sheetOpen = null;
    if (filter) state.filter = filter;
    state.screen = 'list';
    state.nav = state.filter === 'mine' ? 'mine' : 'list';
    render();
    await refreshCounts();
    await refreshTickets();
  }

  async function refreshCounts() {
    try {
      state.counts = await api('/tickets/counts');
    } catch (e) {}
  }

  async function refreshTickets() {
    state.loadingTickets = true;
    state.ticketsError = null;
    render();
    try {
      const qs = new URLSearchParams({ filter: state.filter });
      if (state.me.role === 'SUPER_ADMIN' && state.extraFilters.branchId) qs.set('branch_id', state.extraFilters.branchId);
      state.tickets = await api('/tickets?' + qs.toString());
    } catch (e) {
      state.ticketsError = e.message;
      state.tickets = [];
    } finally {
      state.loadingTickets = false;
    }
    render();
  }

  function onSearchInput(value) {
    state.searchQuery = value;
    state.searchFocusPending = true;
    render();
    const input = document.getElementById('searchInput');
    if (input) {
      input.focus();
      const pos = value.length;
      input.setSelectionRange(pos, pos);
    }
  }

  function clearSearch() {
    state.searchQuery = '';
    render();
  }

  // ---------------------------------------------------------------------
  // Filter bottom sheet
  // ---------------------------------------------------------------------

  async function openFilterSheet() {
    state.sheetOpen = 'filters';
    render();
    if (state.me.role === 'SUPER_ADMIN') {
      try {
        if (!state.adminBranches.length) state.adminBranches = await api('/admin/branches');
        if (!state.adminEmployees.length) state.adminEmployees = await api('/admin/employees');
      } catch (e) {}
      render();
    }
  }

  function closeSheet() {
    state.sheetOpen = null;
    render();
  }

  async function setExtraFilter(key, value) {
    state.extraFilters[key] = value;
    if (key === 'branchId') {
      await refreshTickets();
    } else {
      render();
    }
  }

  async function resetExtraFilters() {
    const hadBranch = !!state.extraFilters.branchId;
    state.extraFilters = { branchId: '', category: '', employeeId: '', sla: '', period: 'all' };
    if (hadBranch) await refreshTickets();
    else render();
  }

  function filterSheetHtml() {
    const isSuperAdmin = state.me.role === 'SUPER_ADMIN';
    return `
      <div class="sheet-backdrop" onclick="App.closeSheet()">
        <div class="sheet" onclick="event.stopPropagation()">
          <div class="sheet-handle"></div>
          <div class="sheet-header">
            <div class="sheet-title">Фильтры</div>
            <button class="icon-btn" onclick="App.closeSheet()">${icon('x')}</button>
          </div>
          ${
            isSuperAdmin
              ? `<div class="sheet-group">
            <div class="sheet-group-label">Филиал</div>
            <div class="sheet-options">
              <button class="chip ${!state.extraFilters.branchId ? 'active' : ''}" onclick="App.setExtraFilter('branchId','')">Все</button>
              ${state.adminBranches.map((b) => `<button class="chip ${state.extraFilters.branchId == String(b.id) ? 'active' : ''}" onclick="App.setExtraFilter('branchId','${b.id}')">${esc(b.code)}</button>`).join('')}
            </div>
          </div>`
              : ''
          }
          <div class="sheet-group">
            <div class="sheet-group-label">Категория</div>
            <div class="sheet-options">
              <button class="chip ${!state.extraFilters.category ? 'active' : ''}" onclick="App.setExtraFilter('category','')">Все</button>
              ${state.categories.map((c) => `<button class="chip ${state.extraFilters.category === c ? 'active' : ''}" onclick="App.setExtraFilter('category','${esc(c)}')">${esc(c)}</button>`).join('')}
            </div>
          </div>
          ${
            isSuperAdmin
              ? `<div class="sheet-group">
            <div class="sheet-group-label">Сотрудник</div>
            <div class="sheet-options">
              <button class="chip ${!state.extraFilters.employeeId ? 'active' : ''}" onclick="App.setExtraFilter('employeeId','')">Все</button>
              ${state.adminEmployees.map((e) => `<button class="chip ${state.extraFilters.employeeId == String(e.id) ? 'active' : ''}" onclick="App.setExtraFilter('employeeId','${e.id}')">${esc(e.name)}</button>`).join('')}
            </div>
          </div>`
              : ''
          }
          <div class="sheet-group">
            <div class="sheet-group-label">SLA</div>
            <div class="sheet-options">
              <button class="chip ${!state.extraFilters.sla ? 'active' : ''}" onclick="App.setExtraFilter('sla','')">Все</button>
              <button class="chip ${state.extraFilters.sla === 'warn' ? 'active' : ''}" onclick="App.setExtraFilter('sla','warn')">Скоро нарушится</button>
              <button class="chip ${state.extraFilters.sla === 'breach' ? 'active' : ''}" onclick="App.setExtraFilter('sla','breach')">Нарушен</button>
            </div>
          </div>
          <div class="sheet-group">
            <div class="sheet-group-label">Период</div>
            <div class="sheet-options">
              <button class="chip ${state.extraFilters.period === 'all' ? 'active' : ''}" onclick="App.setExtraFilter('period','all')">Всё время</button>
              <button class="chip ${state.extraFilters.period === 'today' ? 'active' : ''}" onclick="App.setExtraFilter('period','today')">Сегодня</button>
              <button class="chip ${state.extraFilters.period === 'week' ? 'active' : ''}" onclick="App.setExtraFilter('period','week')">7 дней</button>
            </div>
          </div>
          <div class="sheet-footer">
            <button class="btn btn-outline btn-block" onclick="App.resetExtraFilters()">Сбросить</button>
            <button class="btn btn-primary btn-block" onclick="App.closeSheet()">Показать</button>
          </div>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------------
  // Ticket detail screen (chat)
  // ---------------------------------------------------------------------

  function groupMessagesByDay(messages) {
    const groups = [];
    let currentDay = null;
    let currentList = null;
    for (const m of messages) {
      const dayKey = new Date(m.created_at).toDateString();
      if (dayKey !== currentDay) {
        currentDay = dayKey;
        currentList = [];
        groups.push({ day: m.created_at, items: currentList });
      }
      currentList.push(m);
    }
    return groups;
  }

  function dayLabel(dateStr) {
    const d = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Сегодня';
    if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' });
  }

  function dayGroupHtml(group) {
    return `<div class="chat-day-divider">${dayLabel(group.day)}</div>` + group.items.map(messageBubbleHtml).join('');
  }

  function messageBubbleHtml(m) {
    const from = m.sender_type === 'CUSTOMER' ? 'from-customer' : m.sender_type === 'EMPLOYEE' ? 'from-employee' : 'from-system';
    const cls = m.sender_type === 'CUSTOMER' ? 'bubble-customer' : m.sender_type === 'EMPLOYEE' ? 'bubble-employee' : 'bubble-system';
    const photoHtml = m.attachment_type === 'photo' ? `<img class="bubble-photo" data-message-id="${m.id}" alt="Фото" />` : '';
    const textHtml = m.text ? `<div class="bubble-text">${esc(m.text)}</div>` : '';
    return `
      <div class="bubble-row ${from}">
        <div class="bubble ${cls}">
          ${photoHtml}
          ${textHtml}
          <div class="bubble-time">${formatClock(m.created_at)}</div>
        </div>
      </div>`;
  }

  function loadPhotoImages() {
    const tg = window.Telegram && window.Telegram.WebApp;
    const initData = tg ? tg.initData : '';
    app.querySelectorAll('img[data-message-id]').forEach(async (img) => {
      const id = img.getAttribute('data-message-id');
      try {
        const res = await fetch('/api/files/' + id, { headers: { 'X-Telegram-Init-Data': initData || '' } });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        img.src = url;
        img.onclick = () => window.open(url, '_blank');
      } catch (e) {}
    });
  }

  function photoPreviewHtml() {
    return `<div class="photo-preview"><img src="${state.pendingPhoto.dataUrl}" alt="Предпросмотр" />
      <button class="mini-btn danger" onclick="App.clearPendingPhoto()">Убрать фото</button></div>`;
  }

  function renderSkeletonTicket() {
    app.innerHTML = `<div class="screen">
      <div class="ticket-header"><div class="skeleton-block skeleton-line" style="width:50%"></div></div>
      <div class="messages">${skeletonRowsHtml(4)}</div>
    </div>`;
  }

  function renderTicketScreen() {
    const t = state.currentTicket;
    if (!t) {
      renderSkeletonTicket();
      return;
    }
    const messagesHtml = groupMessagesByDay(state.currentMessages).map(dayGroupHtml).join('');
    const canClaim = !t.assigned_employee_id;
    const isClosed = t.status === 'CLOSED';
    const sla = computeSla(t, state.me);

    app.innerHTML = `
      <div class="screen" style="padding-bottom:0;">
        <div class="ticket-header">
          <div class="ticket-header-top">
            <button class="icon-btn" onclick="App.goBackFromTicket()" aria-label="Назад">${icon('chevronLeft')}</button>
            <div class="ticket-header-id">#${t.ticket_number} · ${esc(t.company_name || 'Клиент')}</div>
            <span class="badge badge-${t.status}">${STATUS_LABELS[t.status] || t.status}</span>
            <button class="icon-btn" onclick="App.openTicketInfo()" aria-label="Информация об обращении">${icon('info')}</button>
          </div>
          <div class="ticket-header-sub">
            <span>${esc(t.category || 'Без категории')}</span>
            ${sla ? `<span class="badge badge-sla-${sla.level}">${icon(sla.level === 'breach' ? 'alertTriangle' : 'clock', 'icon-sm')}${esc(sla.label)}</span>` : ''}
          </div>
        </div>
        <div class="messages" id="messagesEl">${messagesHtml || emptyBlockHtml('mail', 'Сообщений пока нет')}</div>
        ${
          state.pendingScrollIndicator
            ? `<button class="scroll-to-bottom" onclick="App.scrollChatToBottom()">${icon('chevronDown', 'icon-sm')}Новое сообщение</button>`
            : ''
        }
        <div class="ticket-actions">
          ${canClaim ? `<button class="btn btn-primary" onclick="App.claimTicket()">${icon('checkCircle', 'icon-sm')}Взять в работу</button>` : ''}
          ${!isClosed ? `<button class="btn btn-outline" onclick="App.setStatus('WAITING_FOR_CLIENT')">Ожидание клиента</button>` : ''}
          ${!isClosed ? `<button class="btn btn-outline" onclick="App.setStatus('RESOLVED')">Решено</button>` : ''}
          ${!isClosed ? `<button class="btn btn-danger" onclick="App.setStatus('CLOSED')">Закрыть</button>` : ''}
        </div>
        ${
          !isClosed
            ? `${state.pendingPhoto ? photoPreviewHtml() : ''}
              <div class="reply-box">
                <input type="file" id="photoInput" accept="image/png,image/jpeg" style="display:none" onchange="App.onPhotoSelected(this)" />
                <button class="attach-btn" onclick="App.pickPhoto()" aria-label="Прикрепить фото">${icon('paperclip')}</button>
                <textarea id="replyText" placeholder="Введите сообщение..." rows="1"></textarea>
                <button class="send-btn" id="sendBtn" onclick="App.sendMessage()" aria-label="Отправить">${icon('send', 'icon-sm')}</button>
              </div>`
            : `<div class="closed-banner">Обращение закрыто. Отправка сообщений недоступна.</div>`
        }
      </div>
      ${state.sheetOpen === 'ticketInfo' ? ticketInfoSheetHtml() : ''}`;

    setupTicketScreenBehaviors();
  }

  function setupTicketScreenBehaviors() {
    loadPhotoImages();
    const messagesEl = document.getElementById('messagesEl');
    if (messagesEl) {
      if (!state.pendingScrollIndicator) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
      messagesEl.addEventListener('scroll', () => {
        state.chatNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
      });
    }
    const textarea = document.getElementById('replyText');
    if (textarea) {
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
      textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
      });
    }
  }

  function scrollChatToBottom() {
    state.pendingScrollIndicator = false;
    state.chatNearBottom = true;
    render();
  }

  function ticketInfoSheetHtml() {
    const t = state.currentTicket;
    const sla = computeSla(t, state.me);
    return `
      <div class="sheet-backdrop" onclick="App.closeSheet()">
        <div class="sheet" onclick="event.stopPropagation()">
          <div class="sheet-handle"></div>
          <div class="sheet-header">
            <div class="sheet-title">Об обращении</div>
            <button class="icon-btn" onclick="App.closeSheet()">${icon('x')}</button>
          </div>
          <div class="info-list">
            <div class="info-row"><span class="info-row-label">Клиент</span><span class="info-row-value">${esc(t.company_name || '—')}</span></div>
            <div class="info-row"><span class="info-row-label">Филиал</span><span class="info-row-value">${esc(t.branch_code || '—')}</span></div>
            <div class="info-row"><span class="info-row-label">Категория</span><span class="info-row-value">${esc(t.category || '—')}</span></div>
            <div class="info-row"><span class="info-row-label">Создано</span><span class="info-row-value">${formatFullDate(t.created_at)}</span></div>
            <div class="info-row"><span class="info-row-label">Ответственный</span><span class="info-row-value">${esc(t.assigned_employee_name || 'Не назначен')}</span></div>
            <div class="info-row"><span class="info-row-label">Первый ответ</span><span class="info-row-value">${t.first_response_seconds != null ? formatDuration(t.first_response_seconds) : '—'}</span></div>
            <div class="info-row"><span class="info-row-label">Решение</span><span class="info-row-value">${t.resolution_seconds != null ? formatDuration(t.resolution_seconds) : '—'}</span></div>
            ${sla ? `<div class="info-row"><span class="info-row-label">SLA сейчас</span><span class="info-row-value">${esc(sla.label)}</span></div>` : ''}
          </div>
        </div>
      </div>`;
  }

  async function openTicket(id) {
    state.sheetOpen = null;
    state.screen = 'ticket';
    state.currentTicket = null;
    state.currentMessages = [];
    state.pendingScrollIndicator = false;
    state.chatNearBottom = true;
    render();
    try {
      const data = await api('/tickets/' + id);
      state.currentTicket = data.ticket;
      state.currentMessages = data.messages;
    } catch (e) {
      state.screen = 'error';
      state.errorMessage = e.message;
    }
    render();
  }

  function openTicketInfo() {
    state.sheetOpen = 'ticketInfo';
    render();
  }

  function goBackFromTicket() {
    if (state.nav === 'home') goHome();
    else goList(state.filter);
  }

  async function reloadCurrentTicket() {
    if (!state.currentTicket) return;
    const prevCount = state.currentMessages.length;
    const wasNearBottom = state.chatNearBottom;
    const data = await api('/tickets/' + state.currentTicket.id);
    state.currentTicket = data.ticket;
    const hasNew = data.messages.length > prevCount;
    state.currentMessages = data.messages;
    state.pendingScrollIndicator = hasNew && !wasNearBottom;
    render();
  }

  async function claimTicket() {
    try {
      await api('/tickets/' + state.currentTicket.id + '/claim', { method: 'POST' });
      await reloadCurrentTicket();
      toast('Обращение взято в работу');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function setStatus(status) {
    if (status === 'CLOSED' && !confirm('Закрыть обращение? Дальнейшая переписка будет недоступна.')) return;
    try {
      await api('/tickets/' + state.currentTicket.id + '/status', { method: 'POST', body: { status } });
      await reloadCurrentTicket();
      const labels = { WAITING_FOR_CLIENT: 'Клиент уведомлён об ожидании', RESOLVED: 'Обращение решено', CLOSED: 'Обращение закрыто' };
      toast(labels[status] || 'Статус обновлён');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function sendMessage() {
    const textarea = document.getElementById('replyText');
    const text = textarea ? textarea.value.trim() : '';

    if (state.pendingPhoto) {
      try {
        const base64 = state.pendingPhoto.dataUrl.split(',')[1];
        await api('/tickets/' + state.currentTicket.id + '/photo', {
          method: 'POST',
          body: { image: base64, mimeType: state.pendingPhoto.mimeType, caption: text || undefined },
        });
        state.pendingPhoto = null;
        state.chatNearBottom = true;
        await reloadCurrentTicket();
        toast('Фото отправлено');
      } catch (e) {
        toast(e.message, 'error');
      }
      return;
    }

    if (!text) return;
    try {
      await api('/tickets/' + state.currentTicket.id + '/message', { method: 'POST', body: { text } });
      state.chatNearBottom = true;
      await reloadCurrentTicket();
      toast('Ответ отправлен');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function pickPhoto() {
    const input = document.getElementById('photoInput');
    if (input) input.click();
  }

  function onPhotoSelected(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast('Поддерживаются только файлы JPG и PNG.', 'error');
      input.value = '';
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast('Файл слишком большой (максимум 3 МБ).', 'error');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.pendingPhoto = { dataUrl: reader.result, mimeType: file.type };
      render();
    };
    reader.readAsDataURL(file);
  }

  function clearPendingPhoto() {
    state.pendingPhoto = null;
    render();
  }

  // ---------------------------------------------------------------------
  // Админ-панель
  // ---------------------------------------------------------------------

  async function goAdmin() {
    state.sheetOpen = null;
    state.screen = 'admin';
    state.nav = 'admin';
    render();
    await loadAdminTab(state.adminTab);
  }

  async function setAdminTab(tab) {
    state.adminTab = tab;
    render();
    await loadAdminTab(tab);
  }

  async function loadAdminTab(tab) {
    try {
      if (tab === 'overview') {
        const [overview, sla] = await Promise.all([api('/admin/overview'), api('/admin/sla')]);
        state.adminOverview = overview;
        state.adminSlaSummary = sla;
      }
      if (tab === 'branches') state.adminBranches = await api('/admin/branches');
      if (tab === 'employees') state.adminEmployees = await api('/admin/employees');
      if (tab === 'sla') state.adminSla = await api('/admin/sla');
    } catch (e) {
      toast(e.message, 'error');
    }
    render();
  }

  function adminTabsHtml() {
    const tabs = [
      { key: 'overview', label: 'Обзор' },
      { key: 'branches', label: 'Филиалы' },
      { key: 'employees', label: 'Сотрудники' },
      { key: 'sla', label: 'SLA' },
    ];
    return `<div class="filter-row">${tabs
      .map((t) => `<button class="chip ${state.adminTab === t.key ? 'active' : ''}" onclick="App.setAdminTab('${t.key}')">${t.label}</button>`)
      .join('')}</div>`;
  }

  function renderAdminOverview() {
    const o = state.adminOverview;
    if (!o) return skeletonKpiHtml();
    const t = o.totals;
    const breaches = state.adminSlaSummary ? state.adminSlaSummary.byBranch.reduce((sum, b) => sum + b.overdue, 0) : null;
    return `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-value">${t.total}</div><div class="kpi-label">Всего обращений</div></div>
        <div class="kpi-card"><div class="kpi-value">${t.new_count}</div><div class="kpi-label">Новых</div></div>
        <div class="kpi-card"><div class="kpi-value">${t.in_progress_count}</div><div class="kpi-label">В работе</div></div>
        <div class="kpi-card"><div class="kpi-value">${t.resolved_today}</div><div class="kpi-label">Решено сегодня</div></div>
        <div class="kpi-card"><div class="kpi-value">${formatDuration(t.avg_first_response)}</div><div class="kpi-label">Средний первый ответ</div></div>
        <div class="kpi-card"><div class="kpi-value">${formatDuration(t.avg_resolution)}</div><div class="kpi-label">Среднее решение</div></div>
        ${breaches !== null ? `<div class="kpi-card breach"><div class="kpi-value">${breaches}</div><div class="kpi-label">SLA нарушено</div></div>` : ''}
      </div>
      <div class="section-title">Филиалы</div>
      <div class="list-section">
        ${o.byBranch
          .map(
            (b) =>
              `<div class="list-row"><div><div class="list-row-title">${esc(b.code)}</div><div class="list-row-sub">${esc(b.name)}</div></div><div class="list-row-value">${b.ticket_count} обращений</div></div>`
          )
          .join('')}
      </div>
      <div class="section-title">Сотрудники</div>
      <div class="list-section">
        ${o.byEmployee
          .map(
            (e) =>
              `<div class="list-row"><div><div class="list-row-title">${esc(e.name)}</div><div class="list-row-sub">${esc(e.branch_code)}</div></div><div class="list-row-value">${e.ticket_count} · ${formatDuration(e.avg_resolution)}</div></div>`
          )
          .join('')}
      </div>
      <div class="section-title">Обслуживание</div>
      <div class="list-section" style="padding-bottom:24px;">
        <button class="btn btn-danger btn-block" onclick="App.cleanupOldMessages()">Удалить сообщения старше 30 дней</button>
      </div>`;
  }

  function renderAdminBranches() {
    const branches = state.adminBranches;
    if (!branches.length) return skeletonRowsHtml(4);
    return `
      <div class="list-section">
        ${branches
          .map(
            (b) => `
          <div class="list-row">
            <div><div class="list-row-title">${esc(b.code)}</div><div class="list-row-sub">${esc(b.name)} · ${b.status}</div></div>
            <button class="mini-btn" onclick="App.createBranchPassword(${b.id}, '${esc(b.code)}')">${icon('key', 'icon-sm')}Пароль</button>
          </div>`
          )
          .join('')}
      </div>
      <div class="section-title">Новый филиал</div>
      <div class="new-branch-form">
        <input id="newBranchCode" placeholder="Код филиала" />
        <input id="newBranchName" placeholder="Название филиала" />
        <button class="btn btn-primary btn-block" onclick="App.createBranch()">Создать филиал</button>
      </div>`;
  }

  async function createBranch() {
    const code = document.getElementById('newBranchCode').value.trim();
    const name = document.getElementById('newBranchName').value.trim();
    if (!code || !name) return toast('Укажите код и название филиала.', 'error');
    try {
      await api('/admin/branches', { method: 'POST', body: { code, name } });
      toast('Филиал создан');
      await loadAdminTab('branches');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function createBranchPassword(branchId, branchCode) {
    const password = prompt(`Новый пароль для филиала ${branchCode}:`);
    if (!password) return;
    try {
      await api('/admin/branches/' + branchId + '/passwords', { method: 'POST', body: { password, label: 'Создан через Web App' } });
      toast('Пароль создан');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function renderAdminEmployees() {
    const employees = state.adminEmployees;
    if (!employees.length) return skeletonRowsHtml(4);
    return `<div class="list-section">
      ${employees
        .map(
          (e) => `
        <div class="list-row">
          <div>
            <div class="list-row-title">${esc(e.name)}</div>
            <div class="list-row-sub">${esc(e.branch_code)} · ${e.role === 'SUPER_ADMIN' ? 'Супер-админ' : 'Сотрудник'} · ${e.status === 'ACTIVE' ? 'Активен' : 'Заблокирован'} · ${e.ticket_count} обращений</div>
          </div>
          <div class="employee-row-actions">
            ${
              e.status === 'ACTIVE'
                ? `<button class="mini-btn danger" onclick="App.blockEmployee(${e.id})">Заблокировать</button>`
                : `<button class="mini-btn" onclick="App.unblockEmployee(${e.id})">Разблокировать</button>`
            }
            ${
              e.role === 'SUPER_ADMIN'
                ? `<button class="mini-btn" onclick="App.demoteEmployee(${e.id})">Снять админа</button>`
                : `<button class="mini-btn" onclick="App.promoteEmployee(${e.id})">Сделать админом</button>`
            }
          </div>
        </div>`
        )
        .join('')}
    </div>`;
  }

  async function blockEmployee(id) {
    if (!confirm('Заблокировать сотрудника?')) return;
    try {
      await api('/admin/employees/' + id + '/block', { method: 'POST' });
      toast('Сотрудник заблокирован');
      await loadAdminTab('employees');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function unblockEmployee(id) {
    try {
      await api('/admin/employees/' + id + '/unblock', { method: 'POST' });
      toast('Сотрудник разблокирован');
      await loadAdminTab('employees');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function promoteEmployee(id) {
    if (!confirm('Назначить этого сотрудника супер-администратором?')) return;
    try {
      await api('/admin/employees/' + id + '/role', { method: 'POST', body: { role: 'SUPER_ADMIN' } });
      toast('Роль обновлена');
      await loadAdminTab('employees');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function demoteEmployee(id) {
    if (!confirm('Снять права супер-администратора у этого сотрудника?')) return;
    try {
      await api('/admin/employees/' + id + '/role', { method: 'POST', body: { role: 'EMPLOYEE' } });
      toast('Роль обновлена');
      await loadAdminTab('employees');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function renderAdminSla() {
    const s = state.adminSla;
    if (!s) return skeletonRowsHtml(4);
    return `
      <div class="section-title">По филиалам · первый ответ ${s.firstResponseSla} мин · решение ${s.resolutionSla} мин</div>
      <div class="list-section">
        ${s.byBranch
          .map(
            (b) => `
          <div class="list-row">
            <div><div class="list-row-title">${esc(b.code)} — ${esc(b.name)}</div><div class="list-row-sub">Обращений: ${b.total} · Ответ: ${formatDuration(b.avg_first_response)} · Решение: ${formatDuration(b.avg_resolution)}</div></div>
            <div class="list-row-value">${b.overdue > 0 ? `<span class="badge badge-sla-breach">Нарушено: ${b.overdue}</span>` : `<span class="badge badge-sla-ok">Ок</span>`}</div>
          </div>`
          )
          .join('')}
      </div>
      <div class="section-title">По категориям</div>
      <div class="list-section" style="padding-bottom:24px;">
        ${s.byCategory
          .map((c) => `<div class="list-row"><div class="list-row-title">${esc(c.category)}</div><div class="list-row-value">${formatDuration(c.avg_resolution)}</div></div>`)
          .join('')}
      </div>`;
  }

  async function cleanupOldMessages() {
    if (!confirm('Удалить все сообщения старше 30 дней? Обращения и статистика останутся, удалится только текст переписки.')) return;
    try {
      const result = await api('/admin/messages/cleanup', { method: 'POST' });
      toast(`Удалено сообщений: ${result.deleted}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function renderAdminScreen() {
    let body = '';
    if (state.adminTab === 'overview') body = renderAdminOverview();
    else if (state.adminTab === 'branches') body = renderAdminBranches();
    else if (state.adminTab === 'employees') body = renderAdminEmployees();
    else if (state.adminTab === 'sla') body = renderAdminSla();

    app.innerHTML = `
      <div class="screen">
        <div class="topbar"><div class="topbar-row"><div class="topbar-title">Аналитика</div></div></div>
        ${adminTabsHtml()}
        <div>${body}</div>
      </div>
      ${bottomNavHtml()}`;
  }

  // ---------------------------------------------------------------------
  // Инициализация
  // ---------------------------------------------------------------------

  async function init() {
    applyTheme();
    try {
      state.me = await api('/me');
    } catch (e) {
      state.screen = 'error';
      state.errorMessage = e.message || 'Не удалось загрузить данные. Откройте приложение через кнопку в боте.';
      render();
      return;
    }
    try {
      state.categories = await api('/categories');
    } catch (e) {
      state.categories = [];
    }
    await goHome();
  }

  window.App = {
    goHome,
    goList,
    openTicket,
    claimTicket,
    setStatus,
    sendMessage,
    pickPhoto,
    onPhotoSelected,
    clearPendingPhoto,
    goBackFromTicket,
    openTicketInfo,
    scrollChatToBottom,
    openFilterSheet,
    closeSheet,
    setExtraFilter,
    resetExtraFilters,
    onSearchInput,
    clearSearch,
    refreshTickets,
    goAdmin,
    setAdminTab,
    createBranch,
    createBranchPassword,
    blockEmployee,
    unblockEmployee,
    promoteEmployee,
    demoteEmployee,
    cleanupOldMessages,
  };

  init();
})();
