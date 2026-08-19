(function () {
  'use strict';

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
    { key: 'waiting', label: 'Ожидают клиента' },
    { key: 'resolved', label: 'Решённые' },
  ];

  const state = {
    me: null,
    screen: 'loading',
    errorMessage: '',
    filter: 'all',
    tickets: [],
    counts: { NEW: 0, IN_PROGRESS: 0, WAITING_FOR_CLIENT: 0, RESOLVED: 0, CLOSED: 0 },
    currentTicket: null,
    currentMessages: [],
    adminTab: 'overview',
    adminOverview: null,
    adminBranches: [],
    adminEmployees: [],
    adminSla: null,
    branchFilter: '',
  };

  const app = document.getElementById('app');

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

  function formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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

  function applyTheme() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
    } catch (e) {}
    const tp = tg.themeParams || {};
    const root = document.documentElement.style;
    const map = {
      bg_color: '--tg-bg',
      text_color: '--tg-text',
      hint_color: '--tg-hint',
      link_color: '--tg-link',
      button_color: '--tg-button',
      button_text_color: '--tg-button-text',
      secondary_bg_color: '--tg-secondary-bg',
    };
    Object.keys(map).forEach((key) => {
      if (tp[key]) root.setProperty(map[key], tp[key]);
    });
  }

  function render() {
    if (state.screen === 'loading') return renderLoading();
    if (state.screen === 'error') return renderError();
    if (state.screen === 'ticket') return renderTicketScreen();
    if (state.screen === 'admin') return renderAdminScreen();
    return renderListScreen();
  }

  function renderLoading() {
    app.innerHTML = '<div class="loading-screen">Загрузка...</div>';
  }

  function renderError() {
    app.innerHTML = `
      <div class="error-screen">
        <div class="error-icon">⚠️</div>
        <div class="error-text">${esc(state.errorMessage)}</div>
      </div>`;
  }

  function headerHtml() {
    const branchLabel = state.me.role === 'SUPER_ADMIN' ? 'Все филиалы' : state.me.branch ? `${state.me.branch.code} — ${state.me.branch.name}` : '—';
    const adminTabBtn =
      state.me.role === 'SUPER_ADMIN'
        ? `<button class="tab-btn ${state.screen === 'admin' ? 'active' : ''}" onclick="App.goAdmin()">Админ</button>`
        : '';
    return `
      <div class="header">
        <div class="header-title">Trustbank Support</div>
        <div class="header-sub">${esc(branchLabel)}</div>
        <div class="header-tabs">
          <button class="tab-btn ${state.screen === 'list' ? 'active' : ''}" onclick="App.goList()">Обращения</button>
          ${adminTabBtn}
        </div>
      </div>`;
  }

  function countsBarHtml() {
    return `
      <div class="counts-bar">
        <div class="count-pill new">🔴 Новые: ${state.counts.NEW}</div>
        <div class="count-pill progress">🟡 В работе: ${state.counts.IN_PROGRESS}</div>
        <div class="count-pill resolved">🟢 Решённые: ${state.counts.RESOLVED + state.counts.CLOSED}</div>
      </div>`;
  }

  function filterTabsHtml() {
    return `
      <div class="filter-tabs">
        ${FILTERS.map(
          (f) => `<button class="filter-btn ${state.filter === f.key ? 'active' : ''}" onclick="App.setFilter('${f.key}')">${f.label}</button>`
        ).join('')}
      </div>`;
  }

  function ticketRowHtml(t) {
    const branchTag = state.me.role === 'SUPER_ADMIN' ? `<span class="ticket-branch">[${esc(t.branch_code)}]</span>` : '';
    const assignee = t.assigned_employee_name ? `<div class="ticket-assignee">В работе: ${esc(t.assigned_employee_name)}</div>` : '';
    return `
      <div class="ticket-row" onclick="App.openTicket(${t.id})">
        <div class="ticket-row-top">
          <span class="status-dot status-${t.status}"></span>
          <span class="ticket-customer">${branchTag} ${esc(t.company_name || 'Клиент #' + t.customer_id)}</span>
          <span class="ticket-time">${formatTime(t.updated_at)}</span>
        </div>
        <div class="ticket-subject">#${t.ticket_number} · ${esc(t.subject)}</div>
        ${assignee}
      </div>`;
  }

  function renderListScreen() {
    const listHtml = state.tickets.length
      ? state.tickets.map(ticketRowHtml).join('')
      : '<div class="empty-state">Обращений не найдено.</div>';
    app.innerHTML = `
      ${headerHtml()}
      ${countsBarHtml()}
      ${filterTabsHtml()}
      <div class="ticket-list">${listHtml}</div>`;
  }

  async function goList() {
    state.screen = 'list';
    render();
    await refreshCounts();
    await refreshTickets();
  }

  async function refreshCounts() {
    try {
      state.counts = await api('/tickets/counts');
    } catch (e) {}
    if (state.screen === 'list') render();
  }

  async function refreshTickets() {
    try {
      const qs = new URLSearchParams({ filter: state.filter });
      state.tickets = await api('/tickets?' + qs.toString());
    } catch (e) {
      state.tickets = [];
    }
    if (state.screen === 'list') render();
  }

  async function setFilter(filter) {
    state.filter = filter;
    await refreshTickets();
  }

  function messageBubbleHtml(m) {
    const cls = m.sender_type === 'CUSTOMER' ? 'bubble-customer' : m.sender_type === 'EMPLOYEE' ? 'bubble-employee' : 'bubble-system';
    const who = m.sender_type === 'CUSTOMER' ? 'Клиент' : m.sender_type === 'EMPLOYEE' ? 'Сотрудник' : 'Система';
    return `
      <div class="bubble ${cls}">
        <div class="bubble-who">${who}</div>
        <div class="bubble-text">${esc(m.text)}</div>
        <div class="bubble-time">${formatTime(m.created_at)}</div>
      </div>`;
  }

  function renderTicketScreen() {
    const t = state.currentTicket;
    if (!t) {
      renderLoading();
      return;
    }
    const messagesHtml = state.currentMessages.map(messageBubbleHtml).join('');
    const canClaim = !t.assigned_employee_id;
    const isClosed = t.status === 'CLOSED';

    app.innerHTML = `
      <div class="ticket-header">
        <button class="back-btn" onclick="App.goList()">← Назад</button>
        <div class="ticket-header-title">${esc(t.company_name || 'Клиент')} · #${t.ticket_number}</div>
        <div class="ticket-header-sub">${esc(t.category || '')} · ${STATUS_LABELS[t.status] || t.status}</div>
      </div>
      <div class="messages">${messagesHtml || '<div class="empty-state">Сообщений пока нет.</div>'}</div>
      <div class="ticket-actions">
        ${canClaim ? '<button class="action-btn primary" onclick="App.claimTicket()">Взять в работу</button>' : ''}
        ${!isClosed ? '<button class="action-btn" onclick="App.setStatus(\'WAITING_FOR_CLIENT\')">Ожидать клиента</button>' : ''}
        ${!isClosed ? '<button class="action-btn" onclick="App.setStatus(\'RESOLVED\')">Решено</button>' : ''}
        ${!isClosed ? '<button class="action-btn danger" onclick="App.setStatus(\'CLOSED\')">Закрыть</button>' : ''}
      </div>
      ${
        !isClosed
          ? `<div class="reply-box">
              <textarea id="replyText" placeholder="Написать сообщение..."></textarea>
              <button class="send-btn" onclick="App.sendMessage()">Отправить</button>
            </div>`
          : '<div class="empty-state">Обращение закрыто.</div>'
      }`;

    const messagesEl = app.querySelector('.messages');
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function openTicket(id) {
    state.screen = 'ticket';
    state.currentTicket = null;
    state.currentMessages = [];
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

  async function reloadCurrentTicket() {
    if (!state.currentTicket) return;
    const data = await api('/tickets/' + state.currentTicket.id);
    state.currentTicket = data.ticket;
    state.currentMessages = data.messages;
    render();
  }

  async function claimTicket() {
    try {
      await api('/tickets/' + state.currentTicket.id + '/claim', { method: 'POST' });
      await reloadCurrentTicket();
    } catch (e) {
      alert(e.message);
    }
  }

  async function setStatus(status) {
    try {
      await api('/tickets/' + state.currentTicket.id + '/status', { method: 'POST', body: { status } });
      await reloadCurrentTicket();
    } catch (e) {
      alert(e.message);
    }
  }

  async function sendMessage() {
    const textarea = document.getElementById('replyText');
    const text = textarea ? textarea.value.trim() : '';
    if (!text) return;
    try {
      await api('/tickets/' + state.currentTicket.id + '/message', { method: 'POST', body: { text } });
      await reloadCurrentTicket();
    } catch (e) {
      alert(e.message);
    }
  }

  // ---------------- Админ-панель ----------------

  async function goAdmin() {
    state.screen = 'admin';
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
      if (tab === 'overview') state.adminOverview = await api('/admin/overview');
      if (tab === 'branches') state.adminBranches = await api('/admin/branches');
      if (tab === 'employees') state.adminEmployees = await api('/admin/employees');
      if (tab === 'sla') state.adminSla = await api('/admin/sla');
    } catch (e) {
      alert(e.message);
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
    return `<div class="admin-tabs">${tabs
      .map((t) => `<button class="filter-btn ${state.adminTab === t.key ? 'active' : ''}" onclick="App.setAdminTab('${t.key}')">${t.label}</button>`)
      .join('')}</div>`;
  }

  function renderAdminOverview() {
    const o = state.adminOverview;
    if (!o) return '<div class="empty-state">Загрузка...</div>';
    const t = o.totals;
    return `
      <div class="admin-stats-grid">
        <div class="stat-card"><div class="stat-value">${t.total}</div><div class="stat-label">Всего обращений</div></div>
        <div class="stat-card"><div class="stat-value">${t.new_count}</div><div class="stat-label">Новых</div></div>
        <div class="stat-card"><div class="stat-value">${t.in_progress_count}</div><div class="stat-label">В работе</div></div>
        <div class="stat-card"><div class="stat-value">${t.resolved_today}</div><div class="stat-label">Решено сегодня</div></div>
        <div class="stat-card"><div class="stat-value">${formatDuration(t.avg_first_response)}</div><div class="stat-label">Среднее время первого ответа</div></div>
        <div class="stat-card"><div class="stat-value">${formatDuration(t.avg_resolution)}</div><div class="stat-label">Среднее время решения</div></div>
      </div>
      <div class="section-title">Филиалы</div>
      <div class="admin-list">
        ${o.byBranch.map((b) => `<div class="admin-list-row"><span>${esc(b.code)} — ${esc(b.name)}</span><span>${b.ticket_count} обращений</span></div>`).join('')}
      </div>
      <div class="section-title">Сотрудники</div>
      <div class="admin-list">
        ${o.byEmployee
          .map(
            (e) =>
              `<div class="admin-list-row"><span>${esc(e.name)} (${esc(e.branch_code)})</span><span>${e.ticket_count} обращений · ${formatDuration(e.avg_resolution)}</span></div>`
          )
          .join('')}
      </div>`;
  }

  function renderAdminBranches() {
    const branches = state.adminBranches;
    return `
      <div class="admin-list">
        ${branches
          .map(
            (b) => `
          <div class="admin-list-row branch-row">
            <span>${esc(b.code)} — ${esc(b.name)} (${b.status})</span>
            <button class="mini-btn" onclick="App.createBranchPassword(${b.id}, '${esc(b.code)}')">Создать пароль</button>
          </div>`
          )
          .join('')}
      </div>
      <div class="section-title">Новый филиал</div>
      <div class="new-branch-form">
        <input id="newBranchCode" placeholder="Код филиала" />
        <input id="newBranchName" placeholder="Название филиала" />
        <button class="action-btn primary" onclick="App.createBranch()">Создать</button>
      </div>`;
  }

  async function createBranch() {
    const code = document.getElementById('newBranchCode').value.trim();
    const name = document.getElementById('newBranchName').value.trim();
    if (!code || !name) return alert('Укажите код и название филиала.');
    try {
      await api('/admin/branches', { method: 'POST', body: { code, name } });
      await loadAdminTab('branches');
    } catch (e) {
      alert(e.message);
    }
  }

  async function createBranchPassword(branchId, branchCode) {
    const password = prompt(`Новый пароль для филиала ${branchCode}:`);
    if (!password) return;
    try {
      await api('/admin/branches/' + branchId + '/passwords', { method: 'POST', body: { password, label: 'Создан через Web App' } });
      alert('Пароль создан.');
    } catch (e) {
      alert(e.message);
    }
  }

  function renderAdminEmployees() {
    const employees = state.adminEmployees;
    return `
      <div class="admin-list">
        ${employees
          .map(
            (e) => `
          <div class="admin-list-row employee-row">
            <div>
              <div>${esc(e.name)}</div>
              <div class="employee-meta">${esc(e.branch_code)} · ${e.role} · ${e.status} · ${e.ticket_count} обращений</div>
            </div>
            <div class="employee-actions">
              ${
                e.status === 'ACTIVE'
                  ? `<button class="mini-btn danger" onclick="App.blockEmployee(${e.id})">Заблокировать</button>`
                  : `<button class="mini-btn" onclick="App.unblockEmployee(${e.id})">Разблокировать</button>`
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
      await loadAdminTab('employees');
    } catch (e) {
      alert(e.message);
    }
  }

  async function unblockEmployee(id) {
    try {
      await api('/admin/employees/' + id + '/unblock', { method: 'POST' });
      await loadAdminTab('employees');
    } catch (e) {
      alert(e.message);
    }
  }

  function renderAdminSla() {
    const s = state.adminSla;
    if (!s) return '<div class="empty-state">Загрузка...</div>';
    return `
      <div class="section-title">SLA по филиалам (первый ответ: ${s.firstResponseSla} мин, решение: ${s.resolutionSla} мин)</div>
      <div class="admin-list">
        ${s.byBranch
          .map(
            (b) => `
          <div class="admin-list-row sla-row">
            <div>${esc(b.code)} — ${esc(b.name)}</div>
            <div class="sla-details">Обращений: ${b.total} · Ответ: ${formatDuration(b.avg_first_response)} · Решение: ${formatDuration(b.avg_resolution)} · ${
              b.overdue > 0 ? `🔴 Просрочено: ${b.overdue}` : 'Просрочек нет'
            }</div>
          </div>`
          )
          .join('')}
      </div>
      <div class="section-title">SLA по категориям</div>
      <div class="admin-list">
        ${s.byCategory
          .map((c) => `<div class="admin-list-row"><span>${esc(c.category)}</span><span>${formatDuration(c.avg_resolution)}</span></div>`)
          .join('')}
      </div>`;
  }

  function renderAdminScreen() {
    let body = '';
    if (state.adminTab === 'overview') body = renderAdminOverview();
    else if (state.adminTab === 'branches') body = renderAdminBranches();
    else if (state.adminTab === 'employees') body = renderAdminEmployees();
    else if (state.adminTab === 'sla') body = renderAdminSla();

    app.innerHTML = `
      ${headerHtml()}
      ${adminTabsHtml()}
      <div class="admin-body">${body}</div>`;
  }

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
    await goList();
  }

  window.App = {
    goList,
    setFilter,
    openTicket,
    claimTicket,
    setStatus,
    sendMessage,
    goAdmin,
    setAdminTab,
    createBranch,
    createBranchPassword,
    blockEmployee,
    unblockEmployee,
  };

  init();
})();
