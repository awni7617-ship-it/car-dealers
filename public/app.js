/* ---- the app ---- */

/* ==================================================================
   Forecourt — front end
   Vanilla JS, no build step. Hash routing, one render pass per view.
   ================================================================== */

import { MAKES, modelsFor } from './models.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  user: null,
  vehicles: [],
  loadedStock: false,
  filters: { status: 'live', q: '', sort: 'newest' },
  cache: {},
};

/* ---------------------------------------------------------------- utils */

function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const currency = () => (state.user && state.user.dealership.currency) || 'GBP';
const distanceUnit = () => (state.user && state.user.dealership.distanceUnit) || 'mi';

function money(value, opts = {}) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency(),
    maximumFractionDigits: opts.decimals ?? 0,
    minimumFractionDigits: 0,
  }).format(Number(value));
}

const numberFmt = (value) =>
  value === null || value === undefined || value === '' ? '—' : Number(value).toLocaleString();

const distance = (value) => (value === null || value === undefined || value === '' ? '—' : `${Number(value).toLocaleString()} ${distanceUnit()}`);

function dateShort(value) {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function dateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function timeOnly(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function relative(value) {
  if (!value) return '';
  const diff = Date.now() - Date.parse(value);
  if (!Number.isFinite(diff)) return '';
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return 'just now';
  if (Math.abs(mins) < 60) return `${mins < 0 ? 'in ' : ''}${Math.abs(mins)}m${mins < 0 ? '' : ' ago'}`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours < 0 ? 'in ' : ''}${Math.abs(hours)}h${hours < 0 ? '' : ' ago'}`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `${days < 0 ? 'in ' : ''}${Math.abs(days)}d${days < 0 ? '' : ' ago'}`;
  return dateShort(value);
}

function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s, transform .2s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

/* ---------------------------------------------------------------- api */

async function api(path, { method = 'GET', body } = {}) {
  // The standalone build swaps the server for a local store; the deployed app
  // never sets this and goes straight to the Worker.
  if (globalThis.FORECOURT_LOCAL) return globalThis.FORECOURT_LOCAL(path, { method, body });
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 204) return {};
  let data = {};
  try {
    data = await res.json();
  } catch { /* non-JSON response */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* ---------------------------------------------------------------- shared bits */

const COUNTRY_BADGE = { GB: 'GB', IE: 'IRL', EU: 'EU' };

function plateHtml(plate, size = 'plate-sm') {
  const badge = COUNTRY_BADGE[(state.user && state.user.dealership.country) || 'GB'];
  return `<span class="plate ${size}">${badge ? `<i>${badge}</i>` : ''}${esc(plate)}</span>`;
}

const STATUS_LABEL = {
  in_stock: 'In stock', prep: 'In prep', reserved: 'Reserved', sold: 'Sold', archived: 'Archived',
};

const KIND_LABEL = {
  viewing: 'Viewing', call: 'Phone call', enquiry: 'Enquiry', test_drive: 'Test drive',
  offer: 'Offer', message: 'Message', note: 'Note',
};

const APPT_LABEL = {
  viewing: 'Viewing', test_drive: 'Test drive', collection: 'Collection', delivery: 'Delivery',
  valuation: 'Valuation',
};

const ICONS = {
  viewing: '<svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  call: '<svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.2a2 2 0 012.1-.5c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z"/></svg>',
  enquiry: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  message: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  test_drive: '<svg viewBox="0 0 24 24"><path d="M3 13l2-5a3 3 0 013-2h8a3 3 0 013 2l2 5"/><path d="M3 13h18v5H3z"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/></svg>',
  offer: '<svg viewBox="0 0 24 24"><path d="M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M4 4h16v12l-4 4H4z"/><path d="M14 20v-4h4"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="8" cy="12" r="4"/><path d="M12 12h9l-2 2 2 2"/></svg>',
};

function badge(status) {
  return `<span class="badge ${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

function vehicleTitle(v) {
  const bits = [v.year, v.make, v.model].filter(Boolean).join(' ');
  return bits || v.plate || 'Unidentified vehicle';
}

function specLine(v) {
  return [
    v.variant, v.body, v.fuel, v.transmission,
    v.engine_cc ? `${(v.engine_cc / 1000).toFixed(1)}L` : null,
    v.colour,
  ].filter(Boolean).join(' · ');
}

/* ---------------------------------------------------------------- modal */

let modalStack = [];

function closeModal() {
  const top = modalStack.pop();
  if (top) top.remove();
  if (!modalStack.length) document.body.style.overflow = '';
}

function openModal({ title, body, footer = '', wide = false, onMount }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn" data-close type="button" aria-label="Close">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  back.addEventListener('mousedown', (e) => {
    if (e.target === back) closeModal();
  });
  back.querySelector('[data-close]').addEventListener('click', closeModal);
  $('#modal-root').append(back);
  modalStack.push(back);
  document.body.style.overflow = 'hidden';
  if (onMount) onMount(back);
  const focusTarget = back.querySelector('[autofocus], input, select, textarea, button');
  if (focusTarget) setTimeout(() => focusTarget.focus(), 40);
  return back;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) closeModal();
});

function confirmDialog(title, message, confirmLabel = 'Delete') {
  return new Promise((resolve) => {
    let settled = false;
    const back = openModal({
      title,
      body: `<p style="color:var(--muted)">${esc(message)}</p>`,
      footer: `<button class="btn btn-secondary" data-no type="button">Cancel</button>
               <button class="btn btn-danger" data-yes type="button">${esc(confirmLabel)}</button>`,
      onMount(root) {
        root.querySelector('[data-yes]').addEventListener('click', () => {
          settled = true;
          closeModal();
          resolve(true);
        });
        root.querySelector('[data-no]').addEventListener('click', closeModal);
      },
    });
    new MutationObserver((_, obs) => {
      if (!back.isConnected) {
        obs.disconnect();
        if (!settled) resolve(false);
      }
    }).observe($('#modal-root'), { childList: true });
  });
}

/* ---------------------------------------------------------------- auth screen */

function setupAuth() {
  const form = $('#auth-form');
  const tabs = $('#auth-tabs');
  const errorBox = $('#auth-error');
  let mode = 'login';

  const applyMode = () => {
    $$('[data-only]', form).forEach((el) => {
      el.hidden = !el.dataset.only.split(' ').includes(mode);
      el.querySelectorAll('input, select').forEach((input) => { input.disabled = el.hidden; });
    });
    $('#auth-submit').textContent =
      mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create dealership account' : 'Join the team';
    $('#f-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    errorBox.hidden = true;
  };

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    mode = btn.dataset.mode;
    $$('.seg-btn', tabs).forEach((b) => b.classList.toggle('is-active', b === btn));
    applyMode();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#auth-submit');
    const data = Object.fromEntries(new FormData(form).entries());
    errorBox.hidden = true;
    btn.disabled = true;
    btn.textContent = 'One moment…';
    try {
      const path = mode === 'login' ? '/auth/login' : mode === 'signup' ? '/auth/signup' : '/auth/join';
      const res = await api(path, { method: 'POST', body: data });
      state.user = res.user;
      enterApp(mode === 'signup');
    } catch (err) {
      // applyMode() resets the button label and clears any old error, so it has
      // to run before the new one is shown.
      applyMode();
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      btn.disabled = false;
    }
  });

  applyMode();
}

/* ---------------------------------------------------------------- boot */

async function boot() {
  setupAuth();
  // A theme this viewer picked wins; otherwise leave whatever the page was
  // served with — the stylesheet already follows the system setting.
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem('fc-theme');
  } catch { /* storage can be blocked; the CSS default still applies */ }
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  try {
    const res = await api('/me');
    state.user = res.user;
    enterApp(false);
  } catch {
    $('#boot').hidden = true;
    $('#auth').hidden = false;
  }
}

function enterApp(isNew) {
  $('#boot').hidden = true;
  $('#auth').hidden = true;
  $('#app').hidden = false;
  $('#who').innerHTML = `<b>${esc(state.user.name)}</b><span>${esc(state.user.dealership.name)}</span>`;
  if (!location.hash || location.hash === '#') location.hash = '#/dashboard';
  else router();
  if (isNew) {
    setTimeout(() => offerSampleStock(), 500);
  }
}

async function offerSampleStock() {
  openModal({
    title: 'Fill it with sample stock?',
    body: `<p style="color:var(--muted)">Your account is empty. We can drop in six example cars with viewings,
      calls and a couple of collections booked, so you can see how everything fits together.
      Delete them whenever you like.</p>`,
    footer: `<button class="btn btn-secondary" data-close-2 type="button">Start empty</button>
             <button class="btn btn-primary" data-yes type="button">Add sample stock</button>`,
    onMount(root) {
      root.querySelector('[data-close-2]').addEventListener('click', closeModal);
      root.querySelector('[data-yes]').addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          await api('/demo', { method: 'POST' });
          closeModal();
          state.loadedStock = false;
          toast('Sample stock added', 'good');
          router();
        } catch (err) {
          toast(err.message, 'bad');
          closeModal();
        }
      });
    },
  });
}

/* ---------------------------------------------------------------- router */

const routes = {
  dashboard: renderDashboard,
  stock: renderStock,
  vehicle: renderVehicle,
  diary: renderDiary,
  enquiries: renderEnquiries,
  reports: renderReports,
  team: renderTeam,
  settings: renderSettings,
};

function router() {
  if (!state.user) return;
  const [, name = 'dashboard', param] = location.hash.replace(/^#/, '').split('/');
  const view = routes[name] || renderDashboard;
  $$('[data-nav]').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === name));
  $('#view').scrollTop = 0;
  window.scrollTo(0, 0);
  view(param);
}

window.addEventListener('hashchange', router);

function loading(message = 'Loading…') {
  $('#view').innerHTML = `
    <div class="grid grid-kpi" style="margin-bottom:14px">
      ${'<div class="card"><div class="skeleton" style="height:14px;width:60%"></div><div class="skeleton" style="height:28px;width:45%;margin-top:10px"></div></div>'.repeat(4)}
    </div>
    <div class="card"><div class="skeleton" style="height:200px"></div></div>
    <p class="hint" style="margin-top:10px">${esc(message)}</p>`;
}

/* ---------------------------------------------------------------- dashboard */

async function renderDashboard() {
  loading();
  let d;
  try {
    d = await api('/dashboard');
  } catch (err) {
    return renderError(err);
  }

  const kpi = (label, value, foot, tone = '') => `
    <div class="card kpi">
      <span class="label">${esc(label)}</span>
      <span class="value">${value}</span>
      ${foot ? `<span class="foot ${tone}">${foot}</span>` : ''}
    </div>`;

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  })();

  const week = d.week;
  const interest = week.viewings + week.calls + week.enquiries + week.testDrives;

  $('#view').innerHTML = `
    <div class="page-head">
      <div>
        <h1>${esc(greeting)}, ${esc(state.user.name.split(' ')[0])}</h1>
        <p class="sub">${d.stock.live} car${d.stock.live === 1 ? '' : 's'} on the pitch ·
          ${d.appointments.today} appointment${d.appointments.today === 1 ? '' : 's'} today</p>
      </div>
      <div class="detail-actions">
        <button class="btn btn-secondary" data-go="#/diary" type="button">Open diary</button>
        <button class="btn btn-primary" id="dash-add" type="button">Add a vehicle</button>
      </div>
    </div>

    <div class="grid grid-kpi" style="margin-bottom:16px">
      ${kpi('Stock value', money(d.stock.value), `${money(d.stock.invested)} invested`)}
      ${kpi('Live stock', d.stock.live, `${d.stock.avgDays} days average age`, d.stock.avgDays > 60 ? 'bad' : '')}
      ${kpi('Interest this week', interest, `${week.viewings} viewings · ${week.calls} calls`)}
      ${kpi('Sold this month', d.month.sold, `${money(d.month.revenue)} in · ${money(d.month.profit)} margin`,
        d.month.profit > 0 ? 'good' : '')}
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head">
          <h3>Who is coming in</h3>
          <span class="link" data-go="#/diary">Diary →</span>
        </div>
        ${d.appointments.upcoming.length ? `<div class="list">${d.appointments.upcoming.slice(0, 6).map(apptRow).join('')}</div>`
          : emptyBlock('Nothing booked', 'Book a viewing or a collection from any vehicle page.')}
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Latest activity</h3>
          <span class="link" data-go="#/enquiries">All enquiries →</span>
        </div>
        ${d.feed.length ? `<div class="list">${d.feed.slice(0, 7).map(feedRow).join('')}</div>`
          : emptyBlock('No activity yet', 'Log a viewing or a call from a vehicle page and it shows up here.')}
      </div>

      <div class="card">
        <div class="card-head"><h3>Getting the most attention</h3></div>
        ${d.hot.length ? `<div class="list">${d.hot.map((v) => `
          <div class="list-row clickable" data-go="#/vehicle/${esc(v.id)}">
            ${plateHtml(v.plate)}
            <div class="grow">
              <div class="t">${esc(vehicleTitle(v))}</div>
              <div class="s">${money(v.asking_price)}</div>
            </div>
            <div class="when"><b>${v.interest}</b> enquiries · 14d</div>
          </div>`).join('')}</div>`
          : emptyBlock('Nothing logged yet', 'Once you start logging viewings and calls, your busiest cars appear here.')}
      </div>

      <div class="card">
        <div class="card-head"><h3>Oldest stock</h3></div>
        ${d.aging.length ? `<div class="list">${d.aging.map((v) => `
          <div class="list-row clickable" data-go="#/vehicle/${esc(v.id)}">
            ${plateHtml(v.plate)}
            <div class="grow">
              <div class="t">${esc(vehicleTitle(v))}</div>
              <div class="s">${money(v.asking_price)} · ${v.interest} enquiries</div>
            </div>
            <div class="when ${v.days > 60 ? 'tone-bad' : ''}"><b>${v.days}</b> days</div>
          </div>`).join('')}</div>`
          : emptyBlock('No stock yet', 'Add your first car and it will show here.')}
      </div>
    </div>`;

  $('#dash-add').addEventListener('click', openAddVehicle);
  wireGo($('#view'));
}

function emptyBlock(title, message) {
  return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(message)}</p></div>`;
}

function apptRow(a) {
  const soon = Date.parse(a.scheduled_at) - Date.now() < 36e5 * 24;
  return `
    <div class="list-row clickable" data-go="#/vehicle/${esc(a.vehicle_id)}">
      <div class="ev ${a.kind === 'collection' || a.kind === 'delivery' ? 'offer' : 'viewing'}">
        ${a.kind === 'collection' || a.kind === 'delivery' ? ICONS.key : ICONS.calendar}
      </div>
      <div class="grow">
        <div class="t">${esc(a.customer_name)} · ${esc(APPT_LABEL[a.kind] || a.kind)}</div>
        <div class="s">${esc(vehicleTitle(a))} · ${esc(a.plate)}${a.deposit ? ` · ${money(a.deposit)} deposit` : ''}</div>
      </div>
      <div class="when ${soon ? 'tone-warn' : ''}">${esc(dateTime(a.scheduled_at))}</div>
    </div>`;
}

function feedRow(a) {
  return `
    <div class="list-row clickable" data-go="#/vehicle/${esc(a.vehicle_id)}">
      <div class="ev ${esc(a.kind)}">${ICONS[a.kind] || ICONS.note}</div>
      <div class="grow">
        <div class="t">${esc(KIND_LABEL[a.kind] || a.kind)}${a.contact_name ? ` · ${esc(a.contact_name)}` : ''}</div>
        <div class="s">${esc(a.plate)} ${esc([a.make, a.model].filter(Boolean).join(' '))}${a.amount ? ` · ${money(a.amount)}` : ''}</div>
      </div>
      <div class="when">${esc(relative(a.occurred_at))}</div>
    </div>`;
}

function wireGo(root) {
  $$('[data-go]', root).forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button:not([data-go])')) return;
      location.hash = el.dataset.go;
    });
  });
}

function renderError(err) {
  $('#view').innerHTML = `
    <div class="empty">
      <h3>That did not load</h3>
      <p>${esc(err.message)}</p>
      <button class="btn btn-secondary" onclick="location.reload()" type="button">Try again</button>
    </div>`;
}

/* ---------------------------------------------------------------- stock */

async function loadVehicles(force = false) {
  if (state.loadedStock && !force) return state.vehicles;
  const params = new URLSearchParams({
    status: state.filters.status,
    sort: state.filters.sort,
  });
  if (state.filters.q) params.set('q', state.filters.q);
  const res = await api(`/vehicles?${params}`);
  state.vehicles = res.vehicles;
  state.loadedStock = true;
  return state.vehicles;
}

async function renderStock() {
  const filters = state.filters;
  $('#view').innerHTML = `
    <div class="page-head">
      <div>
        <h1>Stock</h1>
        <p class="sub" id="stock-count">Loading…</p>
      </div>
      <div class="detail-actions">
        <select id="stock-sort" style="width:auto">
          <option value="newest">Newest first</option>
          <option value="age">Longest in stock</option>
          <option value="interest">Most interest</option>
          <option value="price_high">Price: high to low</option>
          <option value="price_low">Price: low to high</option>
          <option value="plate">Registration</option>
        </select>
        <button class="btn btn-primary" id="stock-add" type="button">Add vehicle</button>
      </div>
    </div>
    <div class="chips" style="margin-bottom:16px" id="stock-chips">
      ${[['live', 'On the pitch'], ['in_stock', 'In stock'], ['prep', 'In prep'], ['reserved', 'Reserved'],
         ['sold', 'Sold'], ['all', 'Everything']]
        .map(([value, label]) => `<button class="chip ${filters.status === value ? 'is-active' : ''}" data-status="${value}" type="button">${label}</button>`)
        .join('')}
    </div>
    <div id="stock-list"><div class="grid grid-cars">${'<div class="card"><div class="skeleton" style="height:120px"></div></div>'.repeat(6)}</div></div>`;

  $('#stock-sort').value = filters.sort;
  $('#stock-add').addEventListener('click', openAddVehicle);
  $('#stock-sort').addEventListener('change', (e) => {
    filters.sort = e.target.value;
    refreshStock();
  });
  $('#stock-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-status]');
    if (!chip) return;
    filters.status = chip.dataset.status;
    $$('.chip', $('#stock-chips')).forEach((c) => c.classList.toggle('is-active', c === chip));
    refreshStock();
  });

  refreshStock();
}

async function refreshStock() {
  try {
    const vehicles = await loadVehicles(true);
    const total = vehicles.reduce((sum, v) => sum + (v.asking_price || 0), 0);
    const countEl = $('#stock-count');
    if (countEl) {
      countEl.textContent = vehicles.length
        ? `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} · ${money(total)} at asking price`
        : 'Nothing here yet';
    }
    const list = $('#stock-list');
    if (!list) return;
    list.innerHTML = vehicles.length
      ? `<div class="grid grid-cars">${vehicles.map(carCard).join('')}</div>`
      : `<div class="card"><div class="empty">
           <h3>${state.filters.q ? 'No matches' : 'No vehicles yet'}</h3>
           <p>${state.filters.q
             ? 'Nothing matched that search. Try the plate, the make or a stock number.'
             : 'Add your first car by typing its number plate — the rest fills itself in.'}</p>
           <button class="btn btn-primary" id="empty-add" type="button">Add a vehicle</button>
         </div></div>`;
    if ($('#empty-add')) $('#empty-add').addEventListener('click', openAddVehicle);
    wireGo(list);
  } catch (err) {
    renderError(err);
  }
}

function carCard(v) {
  const s = v.stats;
  const guide = v.estimate ? v.estimate.retail : null;
  const priceGap = v.asking_price && guide ? ((v.asking_price / guide) - 1) * 100 : null;
  return `
    <button class="car" data-go="#/vehicle/${esc(v.id)}" type="button">
      <div class="car-top">
        <div>
          ${plateHtml(v.plate)}
          <div class="car-title" style="margin-top:8px">${esc(vehicleTitle(v))}</div>
          <div class="car-sub">${esc(specLine(v) || 'Details not filled in yet')}</div>
        </div>
        ${badge(v.status)}
      </div>
      <div class="car-price">
        <span class="ask">${money(v.asking_price)}</span>
        ${guide ? `<span class="guide">guide ${money(guide)}${
          priceGap !== null && Math.abs(priceGap) >= 6
            ? ` · <span class="${priceGap > 0 ? 'tone-warn' : 'tone-good'}">${priceGap > 0 ? '+' : ''}${priceGap.toFixed(0)}%</span>`
            : ''}</span>` : ''}
      </div>
      ${v.next_at ? `<div class="car-next">${ICONS.calendar}
        ${esc(APPT_LABEL[v.next_kind] || 'Booked')} · ${esc(v.next_customer || '')} · ${esc(dateTime(v.next_at))}</div>` : ''}
      <div class="car-stats">
        <span><b>${s.viewings}</b> viewings</span>
        <span><b>${s.calls}</b> calls</span>
        <span><b>${s.enquiries}</b> enquiries</span>
        <span><b>${s.daysInStock}</b> days</span>
        ${v.mileage ? `<span><b>${numberFmt(v.mileage)}</b> ${distanceUnit()}</span>` : ''}
      </div>
    </button>`;
}

/* ---------------------------------------------------------------- vehicle detail */

async function renderVehicle(id) {
  if (!id) return renderStock();
  loading();
  let data;
  try {
    data = await api(`/vehicles/${id}`);
  } catch (err) {
    return renderError(err);
  }
  state.cache.vehicle = data;
  paintVehicle();
}

function paintVehicle(tab = 'overview') {
  const { vehicle: v, activities, appointments, valuations } = state.cache.vehicle;
  const s = v.stats;
  const advice = v.advice;

  $('#view').innerHTML = `
    <button class="btn btn-ghost btn-sm" id="back-btn" type="button" style="margin-bottom:12px">
      <svg viewBox="0 0 24 24" class="ico"><path d="M15 18l-6-6 6-6"/></svg> Back to stock
    </button>

    <div class="detail-head">
      <div class="detail-title">
        ${plateHtml(v.plate, 'plate-lg')}
        <h1>${esc(vehicleTitle(v))}</h1>
        <p class="detail-spec">${esc(specLine(v) || 'No specification recorded')}${
          v.mileage ? ` · ${esc(distance(v.mileage))}` : ''}</p>
        <div class="chips" style="margin-top:2px">
          ${badge(v.status)}
          <span class="badge ${advice.tone === 'bad' ? 'bad' : advice.tone === 'warn' ? 'warn' : advice.tone === 'good' ? 'good' : ''}">${esc(advice.headline)}</span>
          ${v.stock_number ? `<span class="badge">Stock ${esc(v.stock_number)}</span>` : ''}
          ${v.location ? `<span class="badge">${esc(v.location)}</span>` : ''}
        </div>
      </div>
      <div class="detail-actions">
        <select id="status-select" style="width:auto">
          ${Object.entries(STATUS_LABEL).map(([k, label]) =>
            `<option value="${k}" ${v.status === k ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <button class="btn btn-secondary" id="edit-btn" type="button">Edit details</button>
        <button class="btn btn-danger btn-sm" id="delete-btn" type="button" aria-label="Delete vehicle">
          <svg viewBox="0 0 24 24" class="ico"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>
        </button>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;border-left:3px solid var(--${advice.tone === 'bad' ? 'bad' : advice.tone === 'warn' ? 'warn' : advice.tone === 'good' ? 'good' : 'brand'})">
      <b>${esc(advice.headline)}.</b> <span style="color:var(--muted)">${esc(advice.detail)}</span>
    </div>

    <div class="quick">
      <button data-log="viewing" type="button">${ICONS.viewing}Log viewing</button>
      <button data-log="call" type="button">${ICONS.call}Log call</button>
      <button data-log="enquiry" type="button">${ICONS.enquiry}Log enquiry</button>
      <button data-log="test_drive" type="button">${ICONS.test_drive}Test drive</button>
      <button data-log="offer" type="button">${ICONS.offer}Record offer</button>
      <button id="book-btn" type="button">${ICONS.calendar}Book someone in</button>
    </div>

    <div class="grid grid-kpi" style="margin-bottom:16px">
      <div class="card kpi"><span class="label">Viewings</span><span class="value">${s.viewings}</span><span class="foot">people who came to look</span></div>
      <div class="card kpi"><span class="label">Phone calls</span><span class="value">${s.calls}</span><span class="foot">enquiries by phone</span></div>
      <div class="card kpi"><span class="label">Other enquiries</span><span class="value">${s.enquiries}</span><span class="foot">messages, offers, test drives</span></div>
      <div class="card kpi"><span class="label">Days in stock</span><span class="value">${s.daysInStock}</span><span class="foot">since ${esc(dateShort(v.date_in || v.created_at))}</span></div>
    </div>

    <div class="tabs" id="v-tabs">
      <button data-tab="overview" class="${tab === 'overview' ? 'is-active' : ''}">Overview</button>
      <button data-tab="activity" class="${tab === 'activity' ? 'is-active' : ''}">Activity <span style="opacity:.6">${activities.length}</span></button>
      <button data-tab="diary" class="${tab === 'diary' ? 'is-active' : ''}">Diary <span style="opacity:.6">${appointments.length}</span></button>
      <button data-tab="value" class="${tab === 'value' ? 'is-active' : ''}">What it's worth</button>
    </div>
    <div id="v-panel"></div>`;

  $('#back-btn').addEventListener('click', () => { location.hash = '#/stock'; });
  $('#edit-btn').addEventListener('click', () => openVehicleForm(v));
  $('#delete-btn').addEventListener('click', async () => {
    const ok = await confirmDialog('Delete this vehicle?',
      `${vehicleTitle(v)} (${v.plate}) and all of its logged activity will be removed. This cannot be undone.`);
    if (!ok) return;
    await api(`/vehicles/${v.id}`, { method: 'DELETE' });
    state.loadedStock = false;
    toast('Vehicle deleted');
    location.hash = '#/stock';
  });
  $('#status-select').addEventListener('change', async (e) => {
    try {
      await patchVehicle(v.id, { status: e.target.value });
      toast(`Marked as ${STATUS_LABEL[e.target.value].toLowerCase()}`, 'good');
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
  $$('[data-log]').forEach((btn) => btn.addEventListener('click', () => openLogActivity(v, btn.dataset.log)));
  $('#book-btn').addEventListener('click', () => openBooking(v));
  $('#v-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) paintVehicle(btn.dataset.tab);
  });

  paintPanel(tab);
}

function paintPanel(tab) {
  const { vehicle: v, activities, appointments, valuations } = state.cache.vehicle;
  const panel = $('#v-panel');

  if (tab === 'overview') {
    const spec = [
      ['Registration', v.plate], ['Make', v.make], ['Model', v.model], ['Trim', v.variant],
      ['Year', v.year], ['Colour', v.colour], ['Fuel', v.fuel], ['Gearbox', v.transmission],
      ['Body', v.body], ['Engine', v.engine_cc ? `${v.engine_cc} cc` : null],
      ['Mileage', v.mileage ? distance(v.mileage) : null], ['Doors', v.doors],
      ['Condition', v.condition ? v.condition[0].toUpperCase() + v.condition.slice(1) : null],
      ['Service history', v.service_history], ['Keys', v.keys_count],
      ['MOT expires', v.mot_expiry ? dateShort(v.mot_expiry) : null],
      ['Tax', v.tax_status], ['CO₂', v.co2 ? `${v.co2} g/km` : null],
      ['First registered', v.first_registered ? dateShort(v.first_registered) : null],
      ['Issued in', v.region], ['VIN', v.vin], ['Stock number', v.stock_number],
      ['Location', v.location], ['In stock since', dateShort(v.date_in || v.created_at)],
      ['Sold on', v.date_sold ? dateShort(v.date_sold) : null],
      ['Buyer', v.buyer_name],
    ].filter(([, value]) => value !== null && value !== undefined && value !== '');

    panel.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h3>Specification</h3>${v.lookup_source ? `<span class="badge">${esc(v.lookup_source)}</span>` : ''}</div>
          <dl class="spec">${spec.map(([k, value]) => `<div><dt>${esc(k)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
        </div>
        <div>
          <div class="card" style="margin-bottom:14px">
            <div class="card-head"><h3>The money</h3></div>
            <div class="money-row"><span class="k">Asking price</span><span class="v big">${money(v.asking_price)}</span></div>
            <div class="money-row"><span class="k">Bought for</span><span class="v">${money(v.purchase_price)}</span></div>
            <div class="money-row"><span class="k">Preparation</span><span class="v">${money(v.prep_cost)}</span></div>
            <div class="money-row"><span class="k">Margin at asking</span>
              <span class="v ${v.margin > 0 ? 'tone-good' : v.margin < 0 ? 'tone-bad' : ''}">${money(v.margin)}</span></div>
            ${v.sold_price ? `<div class="money-row"><span class="k">Sold for</span><span class="v">${money(v.sold_price)}</span></div>
              <div class="money-row"><span class="k">Profit</span>
                <span class="v ${v.profit > 0 ? 'tone-good' : 'tone-bad'}">${money(v.profit)}</span></div>` : ''}
          </div>
          ${mileageHistoryCard(v)}
          <div class="card">
            <div class="card-head"><h3>Notes</h3><span class="link" id="notes-edit">Edit</span></div>
            <p style="color:var(--muted);white-space:pre-wrap">${esc(v.notes) || 'Nothing noted yet.'}</p>
          </div>
        </div>
      </div>`;
    $('#notes-edit').addEventListener('click', () => openVehicleForm(v));
    return;
  }

  if (tab === 'activity') {
    panel.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h3>Everyone who has shown interest</h3>
          <span class="link" id="log-more">Log something</span>
        </div>
        ${activities.length ? `<div class="list">${activities.map((a) => `
          <div class="list-row">
            <div class="ev ${esc(a.kind)}">${ICONS[a.kind] || ICONS.note}</div>
            <div class="grow">
              <div class="t">${esc(KIND_LABEL[a.kind] || a.kind)}${a.contact_name ? ` · ${esc(a.contact_name)}` : ''}${
                a.amount ? ` · <span class="tone-good">${money(a.amount)}</span>` : ''}</div>
              <div class="s">${[a.contact_phone, a.contact_email, a.notes].filter(Boolean).map(esc).join(' · ') || `logged by ${esc(a.user_name || 'someone')}`}</div>
            </div>
            <div class="when">${esc(relative(a.occurred_at))}</div>
            <button class="icon-btn" data-del-activity="${esc(a.id)}" type="button" aria-label="Delete entry">
              <svg viewBox="0 0 24 24" class="ico"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>`).join('')}</div>`
          : emptyBlock('Nothing logged yet', 'Use the buttons above every time someone views the car or rings up about it.')}
      </div>`;
    $('#log-more').addEventListener('click', () => openLogActivity(v, 'viewing'));
    $$('[data-del-activity]').forEach((btn) => btn.addEventListener('click', async () => {
      await api(`/activities/${btn.dataset.delActivity}`, { method: 'DELETE' });
      await reloadVehicle(v.id, 'activity');
      toast('Entry removed');
    }));
    return;
  }

  if (tab === 'diary') {
    panel.innerHTML = `
      <div class="card">
        <div class="card-head">
          <h3>Appointments for this car</h3>
          <span class="link" id="book-more">Book someone in</span>
        </div>
        ${appointments.length ? `<div class="list">${appointments.map(apptDetailRow).join('')}</div>`
          : emptyBlock('Nothing booked', 'Book a viewing, a test drive or a collection and it lands in your diary.')}
      </div>`;
    $('#book-more').addEventListener('click', () => openBooking(v));
    wireAppointmentActions(() => reloadVehicle(v.id, 'diary'));
    return;
  }

  // Valuation tab
  const e = v.estimate;
  const gap = v.asking_price ? v.asking_price - e.retail : null;
  panel.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head">
          <h3>Guide value today</h3>
          <span class="badge ${e.confidence === 'high' ? 'good' : e.confidence === 'low' ? 'warn' : ''}">${esc(e.confidence)} confidence</span>
        </div>
        <div class="valuation-grid" style="margin-bottom:14px">
          <div class="val-tile lead"><span class="k">Forecourt retail</span><span class="v">${money(e.retail)}</span></div>
          <div class="val-tile"><span class="k">Private sale</span><span class="v">${money(e.private)}</span></div>
          <div class="val-tile"><span class="k">Trade</span><span class="v">${money(e.trade)}</span></div>
          <div class="val-tile"><span class="k">Part exchange</span><span class="v">${money(e.partExchange)}</span></div>
        </div>
        ${v.asking_price ? `<div class="money-row">
          <span class="k">Your asking price vs guide</span>
          <span class="v ${gap > 0 ? 'tone-warn' : 'tone-good'}">${gap > 0 ? '+' : ''}${money(gap)}</span></div>` : ''}
        <p class="hint" style="margin-top:12px">How this was worked out:</p>
        <ul style="margin:6px 0 0;padding-left:18px;color:var(--muted);font-size:13.5px">
          ${e.basis.map((b) => `<li>${esc(b)}</li>`).join('')}
          ${e.adjustments.map((a) => `<li>${esc(a.label)}: <b>${a.amount !== undefined ? money(a.amount) : `${a.factor}%`}</b></li>`).join('')}
        </ul>
        <p class="hint" style="margin-top:12px">A guide, not gospel — condition, history and local demand move the
          number. Save your own figure if you know better.</p>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="save-val" type="button">Save this valuation</button>
          <button class="btn btn-secondary btn-sm" id="own-val" type="button">Enter my own</button>
          ${v.asking_price ? '' : `<button class="btn btn-secondary btn-sm" id="use-val" type="button">Use as asking price</button>`}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Valuation history</h3></div>
        ${valuations.length ? `<div class="list">${valuations.map((val) => `
          <div class="list-row">
            <div class="grow">
              <div class="t">${money(val.retail_value)} retail · ${money(val.trade_value)} trade</div>
              <div class="s">${esc(val.method || 'Guide')}${val.user_name ? ` · ${esc(val.user_name)}` : ''}${val.notes ? ` · ${esc(val.notes)}` : ''}</div>
            </div>
            <div class="when">${esc(dateShort(val.created_at))}</div>
          </div>`).join('')}</div>`
          : emptyBlock('No saved valuations', 'Save one to keep a record of what the car was worth on a given day.')}
      </div>
    </div>`;

  $('#save-val').addEventListener('click', async () => {
    await api(`/vehicles/${v.id}/valuations`, { method: 'POST', body: {} });
    await reloadVehicle(v.id, 'value');
    toast('Valuation saved', 'good');
  });
  $('#own-val').addEventListener('click', () => openManualValuation(v));
  if ($('#use-val')) {
    $('#use-val').addEventListener('click', async () => {
      await patchVehicle(v.id, { asking_price: e.retail }, 'value');
      toast('Asking price set', 'good');
    });
  }
}

/** Odometer readings from the car's MOT history — the clocking check. */
function mileageHistoryCard(v) {
  const h = v.lookup && v.lookup.history;
  if (!h || !h.readings || !h.readings.length) return '';
  const top = Math.max(...h.readings.map((r) => r.odometer));
  return `
    <div class="card" style="margin-bottom:14px">
      <div class="card-head">
        <h3>Recorded mileage</h3>
        <span class="badge ${h.discrepancy ? 'bad' : 'good'}">${h.discrepancy ? 'check history' : 'consistent'}</span>
      </div>
      ${h.discrepancy ? `<p class="hint tone-bad" style="margin-bottom:10px">${esc(h.discrepancy)}</p>` : ''}
      ${h.readings.map((r) => `
        <div style="margin-bottom:9px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
            <span style="color:var(--muted)">${esc(dateShort(r.date))}</span>
            <b>${numberFmt(r.odometer)} ${esc(r.unit)}</b>
          </div>
          <div class="bar"><span style="width:${Math.round((r.odometer / top) * 100)}%"></span></div>
        </div>`).join('')}
      <p class="hint" style="margin-top:10px">From the car's MOT history${
        h.passRate !== null && h.passRate !== undefined ? ` · ${h.tests} tests, ${h.passRate}% passed first time` : ''}.</p>
    </div>`;
}

function apptDetailRow(a) {
  const done = a.status !== 'scheduled';
  return `
    <div class="list-row">
      <div class="ev ${a.kind === 'collection' || a.kind === 'delivery' ? 'offer' : 'viewing'}">
        ${a.kind === 'collection' || a.kind === 'delivery' ? ICONS.key : ICONS.calendar}
      </div>
      <div class="grow" style="${done ? 'opacity:.6' : ''}">
        <div class="t">${esc(a.customer_name)} · ${esc(APPT_LABEL[a.kind] || a.kind)}
          ${a.status !== 'scheduled' ? `<span class="badge ${a.status === 'completed' ? 'good' : a.status === 'no_show' ? 'bad' : ''}">${esc(a.status.replace('_', ' '))}</span>` : ''}</div>
        <div class="s">${esc(dateTime(a.scheduled_at))}${a.customer_phone ? ` · ${esc(a.customer_phone)}` : ''}${
          a.deposit ? ` · ${money(a.deposit)} deposit` : ''}${a.notes ? ` · ${esc(a.notes)}` : ''}</div>
      </div>
      ${a.status === 'scheduled' ? `
        <button class="btn btn-secondary btn-sm" data-appt-done="${esc(a.id)}" type="button">Done</button>
        <button class="btn btn-ghost btn-sm" data-appt-noshow="${esc(a.id)}" type="button">No show</button>` : ''}
      <button class="icon-btn" data-appt-del="${esc(a.id)}" type="button" aria-label="Delete appointment">
        <svg viewBox="0 0 24 24" class="ico"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>`;
}

function wireAppointmentActions(after) {
  const act = async (id, body, message) => {
    await api(`/appointments/${id}`, { method: 'PATCH', body });
    toast(message, 'good');
    await after();
  };
  $$('[data-appt-done]').forEach((b) => b.addEventListener('click', () => act(b.dataset.apptDone, { status: 'completed' }, 'Marked as done')));
  $$('[data-appt-noshow]').forEach((b) => b.addEventListener('click', () => act(b.dataset.apptNoshow, { status: 'no_show' }, 'Marked as a no show')));
  $$('[data-appt-del]').forEach((b) => b.addEventListener('click', async () => {
    const ok = await confirmDialog('Delete appointment?', 'It will be removed from the diary.', 'Delete');
    if (!ok) return;
    await api(`/appointments/${b.dataset.apptDel}`, { method: 'DELETE' });
    toast('Appointment deleted');
    await after();
  }));
}

async function reloadVehicle(id, tab = 'overview') {
  state.cache.vehicle = await api(`/vehicles/${id}`);
  state.loadedStock = false;
  paintVehicle(tab);
}

async function patchVehicle(id, body, tab = 'overview') {
  await api(`/vehicles/${id}`, { method: 'PATCH', body });
  await reloadVehicle(id, tab);
}

/* ---------------------------------------------------------------- log activity */

function openLogActivity(vehicle, kind) {
  const label = KIND_LABEL[kind] || 'Activity';
  openModal({
    title: `${label} — ${vehicle.plate}`,
    body: `
      <p class="hint">Counting every viewing and call is what makes the numbers on this car mean something.
        Details are optional — you can just count it.</p>
      <div class="field">
        <label for="a-name">Who was it?</label>
        <input id="a-name" placeholder="Name (optional)" autocomplete="off" autofocus />
      </div>
      <div class="row">
        <div class="field"><label for="a-phone">Phone</label><input id="a-phone" type="tel" placeholder="Optional" /></div>
        <div class="field"><label for="a-email">Email</label><input id="a-email" type="email" placeholder="Optional" /></div>
      </div>
      ${kind === 'offer' ? `<div class="field"><label for="a-amount">Offer amount</label>
        <input id="a-amount" type="number" inputmode="decimal" placeholder="0" /></div>` : ''}
      <div class="field">
        <label for="a-when">When</label>
        <input id="a-when" type="datetime-local" value="${toLocalInput()}" />
      </div>
      <div class="field"><label for="a-notes">Notes</label>
        <textarea id="a-notes" placeholder="What did they say? Part exchange? Coming back?"></textarea></div>`,
    footer: `<button class="btn btn-secondary" id="a-quick" type="button">Just count it</button>
             <button class="btn btn-primary" id="a-save" type="button">Save ${esc(label.toLowerCase())}</button>`,
    onMount(root) {
      const submit = async (withDetails) => {
        const btns = $$('button', root);
        btns.forEach((b) => { b.disabled = true; });
        try {
          const body = { kind };
          if (withDetails) {
            body.contactName = $('#a-name', root).value;
            body.contactPhone = $('#a-phone', root).value;
            body.contactEmail = $('#a-email', root).value;
            body.notes = $('#a-notes', root).value;
            body.occurredAt = $('#a-when', root).value ? new Date($('#a-when', root).value).toISOString() : undefined;
            const amount = $('#a-amount', root);
            if (amount) body.amount = amount.value;
          }
          await api(`/vehicles/${vehicle.id}/activities`, { method: 'POST', body });
          closeModal();
          toast(`${label} logged`, 'good');
          await reloadVehicle(vehicle.id, 'activity');
        } catch (err) {
          toast(err.message, 'bad');
          btns.forEach((b) => { b.disabled = false; });
        }
      };
      root.querySelector('#a-save').addEventListener('click', () => submit(true));
      root.querySelector('#a-quick').addEventListener('click', () => submit(false));
    },
  });
}

/* ---------------------------------------------------------------- booking */

function openBooking(vehicle, appointment = null) {
  const a = appointment || {};
  openModal({
    title: appointment ? 'Edit appointment' : `Book someone in — ${vehicle.plate}`,
    body: `
      <div class="field">
        <label for="b-kind">What for?</label>
        <select id="b-kind">
          ${Object.entries(APPT_LABEL).map(([k, label]) =>
            `<option value="${k}" ${a.kind === k ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label for="b-name">Customer name</label>
        <input id="b-name" value="${esc(a.customer_name || '')}" placeholder="Who is coming in?" autofocus /></div>
      <div class="row">
        <div class="field"><label for="b-phone">Phone</label>
          <input id="b-phone" type="tel" value="${esc(a.customer_phone || '')}" placeholder="Mobile" /></div>
        <div class="field"><label for="b-email">Email</label>
          <input id="b-email" type="email" value="${esc(a.customer_email || '')}" placeholder="Optional" /></div>
      </div>
      <div class="row">
        <div class="field"><label for="b-when">When</label>
          <input id="b-when" type="datetime-local" value="${toLocalInput(a.scheduled_at)}" /></div>
        <div class="field"><label for="b-deposit">Deposit taken</label>
          <input id="b-deposit" type="number" inputmode="decimal" value="${a.deposit ?? ''}" placeholder="0" /></div>
      </div>
      <div class="field"><label for="b-notes">Notes</label>
        <textarea id="b-notes" placeholder="Bringing a part exchange? Paying balance on collection?">${esc(a.notes || '')}</textarea></div>
      <p class="hint">Take a deposit on a collection and the car is marked reserved automatically.</p>`,
    footer: `<button class="btn btn-secondary" data-cancel type="button">Cancel</button>
             <button class="btn btn-primary" id="b-save" type="button">${appointment ? 'Save changes' : 'Book it in'}</button>`,
    onMount(root) {
      root.querySelector('[data-cancel]').addEventListener('click', closeModal);
      root.querySelector('#b-save').addEventListener('click', async (e) => {
        const body = {
          kind: $('#b-kind', root).value,
          customerName: $('#b-name', root).value,
          customerPhone: $('#b-phone', root).value,
          customerEmail: $('#b-email', root).value,
          scheduledAt: $('#b-when', root).value ? new Date($('#b-when', root).value).toISOString() : '',
          deposit: $('#b-deposit', root).value,
          notes: $('#b-notes', root).value,
        };
        e.target.disabled = true;
        try {
          if (appointment) await api(`/appointments/${appointment.id}`, { method: 'PATCH', body });
          else await api(`/vehicles/${vehicle.id}/appointments`, { method: 'POST', body });
          closeModal();
          toast(appointment ? 'Appointment updated' : 'Booked in', 'good');
          if (location.hash.startsWith('#/vehicle')) await reloadVehicle(vehicle.id, 'diary');
          else router();
        } catch (err) {
          toast(err.message, 'bad');
          e.target.disabled = false;
        }
      });
    },
  });
}

function openManualValuation(v) {
  openModal({
    title: 'Your own valuation',
    body: `
      <div class="row">
        <div class="field"><label for="mv-retail">Retail</label>
          <input id="mv-retail" type="number" inputmode="decimal" value="${v.estimate.retail}" autofocus /></div>
        <div class="field"><label for="mv-trade">Trade</label>
          <input id="mv-trade" type="number" inputmode="decimal" value="${v.estimate.trade}" /></div>
      </div>
      <div class="field"><label for="mv-notes">Where did this come from?</label>
        <input id="mv-notes" placeholder="Trade book, auction result, a mate who knows" /></div>`,
    footer: `<button class="btn btn-secondary" data-cancel type="button">Cancel</button>
             <button class="btn btn-primary" id="mv-save" type="button">Save valuation</button>`,
    onMount(root) {
      root.querySelector('[data-cancel]').addEventListener('click', closeModal);
      root.querySelector('#mv-save').addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          await api(`/vehicles/${v.id}/valuations`, {
            method: 'POST',
            body: {
              retailValue: $('#mv-retail', root).value,
              tradeValue: $('#mv-trade', root).value,
              method: 'Manual',
              notes: $('#mv-notes', root).value,
            },
          });
          closeModal();
          toast('Valuation saved', 'good');
          await reloadVehicle(v.id, 'value');
        } catch (err) {
          toast(err.message, 'bad');
          e.target.disabled = false;
        }
      });
    },
  });
}

/* ---------------------------------------------------------------- add vehicle */

function openAddVehicle() {
  openModal({
    title: 'Add a vehicle',
    body: `
      <p class="hint">Type the registration. We will read the plate and fill in whatever we can find.</p>
      <div class="plate-input">
        <span class="gb">${esc(COUNTRY_BADGE[state.user.dealership.country] || '')}</span>
        <input id="plate-field" maxlength="10" placeholder="AB12 CDE" autocomplete="off"
               autocapitalize="characters" spellcheck="false" autofocus />
      </div>
      <div id="lookup-out"></div>
      <p class="hint" style="text-align:center">
        <a href="#" id="manual-link" style="color:var(--brand);font-weight:600">or enter the details by hand</a></p>`,
    footer: `<button class="btn btn-secondary" data-cancel type="button">Cancel</button>
             <button class="btn btn-primary" id="find-btn" type="button">Find this car</button>`,
    onMount(root) {
      const field = $('#plate-field', root);
      root.querySelector('[data-cancel]').addEventListener('click', closeModal);
      root.querySelector('#manual-link').addEventListener('click', (e) => {
        e.preventDefault();
        closeModal();
        openVehicleForm({ plate: field.value.toUpperCase() });
      });
      // Format as they type: upper case, and a space where a UK plate has one.
      field.addEventListener('input', () => {
        const raw = field.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        field.value = /^[A-Z]{2}\d{2}[A-Z]{0,3}$/.test(raw) && raw.length > 4
          ? `${raw.slice(0, 4)} ${raw.slice(4)}`
          : raw;
      });
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          root.querySelector('#find-btn').click();
        }
      });
      root.querySelector('#find-btn').addEventListener('click', async () => {
        const plate = field.value.trim();
        if (!plate) {
          field.focus();
          return;
        }
        const out = $('#lookup-out', root);
        const btn = root.querySelector('#find-btn');
        btn.disabled = true;
        btn.textContent = 'Reading the plate…';
        out.innerHTML = `<div class="card"><div class="skeleton" style="height:64px"></div></div>`;
        try {
          const res = await api(`/lookup?plate=${encodeURIComponent(plate)}`);
          if (res.alreadyInStock) {
            out.innerHTML = `<div class="card" style="border-color:var(--warn)">
              <b>Already in your stock.</b>
              <p class="hint" style="margin-top:4px">${esc(vehicleTitle(res.alreadyInStock))} · ${esc(STATUS_LABEL[res.alreadyInStock.status] || '')}</p>
              <button class="btn btn-secondary btn-sm" id="goto-existing" type="button" style="margin-top:10px">Open that vehicle</button>
            </div>`;
            $('#goto-existing', root).addEventListener('click', () => {
              closeModal();
              location.hash = `#/vehicle/${res.alreadyInStock.id}`;
            });
            btn.disabled = false;
            btn.textContent = 'Find this car';
            return;
          }
          const f = res.fields || {};
          const headline = [f.year, f.make, f.model].filter(Boolean).join(' ');
          out.innerHTML = `
            <div class="lookup-result">
              <div class="lookup-found" ${res.identified ? '' : 'style="background:var(--surface-sunk);border-color:var(--line)"'}>
                <span class="big">${esc(headline || res.plate || plate)}</span>
                <span class="meta">${esc([f.colour, f.fuel, f.transmission, f.body,
                  f.engineCc ? `${f.engineCc} cc` : null].filter(Boolean).join(' · ') || res.decoded.note || '')}</span>
                ${res.decoded && res.decoded.registrationPeriod
                  ? `<span class="meta">Registered ${esc(res.decoded.registrationPeriod)}${
                      res.decoded.issuedAt ? ` · issued in ${esc(res.decoded.issuedAt)}` : ''}</span>` : ''}
                ${f.motExpiry ? `<span class="meta">MOT to ${esc(dateShort(f.motExpiry))}${
                  f.taxStatus ? ` · tax ${esc(f.taxStatus)}` : ''}</span>` : ''}
                ${res.history && res.history.lastReading ? `<span class="meta">Last MOT mileage
                  ${numberFmt(res.history.lastReading.odometer)} ${esc(res.history.lastReading.unit)}
                  on ${esc(dateShort(res.history.lastReading.date))} · ${res.history.tests} test${res.history.tests === 1 ? '' : 's'}
                  recorded</span>` : ''}
                ${res.history && res.history.discrepancy
                  ? `<span class="meta tone-bad"><b>Check this:</b> ${esc(res.history.discrepancy)}</span>` : ''}
                <div class="source-tags">${(res.sources || []).map((s) => `<span>${esc(s)}</span>`).join('')}</div>
              </div>
              <p class="hint">${res.identified
                ? 'Check it over on the next screen — you can change anything.'
                : 'We could not match this plate to a live record, so fill in the details on the next screen and they will be saved against it.'}</p>
            </div>`;
          btn.disabled = false;
          btn.textContent = 'Continue';
          btn.onclick = () => {
            closeModal();
            openVehicleForm({
              plate: res.plate || plate,
              make: f.make, model: f.model, variant: f.variant, year: f.year, colour: f.colour,
              fuel: f.fuel, transmission: f.transmission, body: f.body, engine_cc: f.engineCc,
              doors: f.doors, seats: f.seats, co2: f.co2, vin: f.vin, mileage: f.mileage,
              mot_expiry: f.motExpiry, tax_status: f.taxStatus, tax_due: f.taxDue,
              first_registered: f.firstRegistered, region: f.region,
              lookupSource: (res.sources || []).join(', '),
              lookup: { ...f, history: res.history || null },
            });
          };
        } catch (err) {
          out.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
          btn.disabled = false;
          btn.textContent = 'Find this car';
        }
      });
    },
  });
}

const DATALISTS = `
  <datalist id="dl-make">${MAKES.map((m) => `<option>${esc(m)}</option>`).join('')}</datalist>
  <datalist id="dl-model"></datalist>
  <datalist id="dl-fuel"><option>Petrol</option><option>Diesel</option><option>Hybrid</option>
    <option>Plug-in hybrid</option><option>Electric</option><option>LPG</option></datalist>
  <datalist id="dl-trans"><option>Manual</option><option>Automatic</option><option>Semi-automatic</option></datalist>
  <datalist id="dl-body"><option>Hatchback</option><option>Saloon</option><option>Estate</option><option>SUV</option>
    <option>Coupe</option><option>Convertible</option><option>MPV</option><option>Pickup</option><option>Van</option></datalist>
  <datalist id="dl-history"><option>Full service history</option><option>Part service history</option>
    <option>None</option></datalist>`;

function openVehicleForm(v = {}) {
  const isEdit = Boolean(v.id);
  const f = (name, value = '') => esc(v[name] ?? value);

  openModal({
    title: isEdit ? `Edit ${v.plate}` : 'Vehicle details',
    wide: true,
    body: `
      ${DATALISTS}
      ${isEdit ? '' : `<div class="field"><label for="vf-plate">Registration</label>
        <input id="vf-plate" value="${f('plate')}" autocapitalize="characters" spellcheck="false" /></div>`}
      <div class="row-3">
        <div class="field"><label for="vf-make">Make</label>
          <input id="vf-make" list="dl-make" value="${f('make')}" autofocus /></div>
        <div class="field"><label for="vf-model">Model</label>
          <input id="vf-model" list="dl-model" value="${f('model')}" /></div>
        <div class="field"><label for="vf-variant">Trim</label><input id="vf-variant" value="${f('variant')}" placeholder="e.g. Sport Nav" /></div>
      </div>
      <div class="row-3">
        <div class="field"><label for="vf-year">Year</label><input id="vf-year" type="number" inputmode="numeric" value="${f('year')}" /></div>
        <div class="field"><label for="vf-mileage">Mileage (${esc(distanceUnit())})</label>
          <input id="vf-mileage" type="number" inputmode="numeric" value="${f('mileage')}" /></div>
        <div class="field"><label for="vf-colour">Colour</label><input id="vf-colour" value="${f('colour')}" /></div>
      </div>
      <div class="row-3">
        <div class="field"><label for="vf-fuel">Fuel</label><input id="vf-fuel" list="dl-fuel" value="${f('fuel')}" /></div>
        <div class="field"><label for="vf-transmission">Gearbox</label><input id="vf-transmission" list="dl-trans" value="${f('transmission')}" /></div>
        <div class="field"><label for="vf-body">Body</label><input id="vf-body" list="dl-body" value="${f('body')}" /></div>
      </div>
      <div class="row-3">
        <div class="field"><label for="vf-engine_cc">Engine (cc)</label><input id="vf-engine_cc" type="number" inputmode="numeric" value="${f('engine_cc')}" /></div>
        <div class="field"><label for="vf-doors">Doors</label><input id="vf-doors" type="number" inputmode="numeric" value="${f('doors')}" /></div>
        <div class="field"><label for="vf-condition">Condition</label>
          <select id="vf-condition">${['excellent', 'good', 'fair', 'poor'].map((c) =>
            `<option value="${c}" ${(v.condition || 'good') === c ? 'selected' : ''}>${c[0].toUpperCase()}${c.slice(1)}</option>`).join('')}</select></div>
      </div>

      <h3 style="margin-top:6px">Money</h3>
      <div class="row-3">
        <div class="field"><label for="vf-purchase_price">Bought for</label><input id="vf-purchase_price" type="number" inputmode="decimal" value="${f('purchase_price')}" /></div>
        <div class="field"><label for="vf-prep_cost">Prep costs</label><input id="vf-prep_cost" type="number" inputmode="decimal" value="${f('prep_cost')}" /></div>
        <div class="field"><label for="vf-asking_price">Asking price</label><input id="vf-asking_price" type="number" inputmode="decimal" value="${f('asking_price')}" /></div>
      </div>
      <div class="card" id="guide-box" style="background:var(--surface-sunk);border:0;display:flex;
           justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="color:var(--muted);font-size:13.5px">Guide retail for this spec</span>
        <span style="display:flex;gap:10px;align-items:center">
          <b id="guide-value" style="font-size:19px">—</b>
          <button class="btn btn-secondary btn-sm" id="guide-use" type="button">Use it</button>
        </span>
      </div>

      <h3 style="margin-top:6px">On the pitch</h3>
      <div class="row-3">
        <div class="field"><label for="vf-stock_number">Stock number</label><input id="vf-stock_number" value="${f('stock_number')}" /></div>
        <div class="field"><label for="vf-location">Where is it?</label><input id="vf-location" value="${f('location')}" placeholder="Main forecourt" /></div>
        <div class="field"><label for="vf-keys_count">Keys</label><input id="vf-keys_count" type="number" inputmode="numeric" value="${f('keys_count')}" /></div>
      </div>
      <div class="row-3">
        <div class="field"><label for="vf-mot_expiry">MOT expires</label><input id="vf-mot_expiry" type="date" value="${f('mot_expiry')}" /></div>
        <div class="field"><label for="vf-service_history">Service history</label><input id="vf-service_history" list="dl-history" value="${f('service_history')}" /></div>
        <div class="field"><label for="vf-vin">VIN</label><input id="vf-vin" value="${f('vin')}" spellcheck="false" /></div>
      </div>
      <div class="field"><label for="vf-notes">Notes</label><textarea id="vf-notes" placeholder="Anything worth remembering — damage, part exchange history, what it needs.">${f('notes')}</textarea></div>`,
    footer: `<button class="btn btn-secondary" data-cancel type="button">Cancel</button>
             <button class="btn btn-primary" id="vf-save" type="button">${isEdit ? 'Save changes' : 'Add to stock'}</button>`,
    onMount(root) {
      const read = () => {
        const body = {};
        const fields = ['make', 'model', 'variant', 'year', 'mileage', 'colour', 'fuel', 'transmission',
          'body', 'engine_cc', 'doors', 'condition', 'purchase_price', 'prep_cost', 'asking_price',
          'stock_number', 'location', 'keys_count', 'mot_expiry', 'service_history', 'vin', 'notes'];
        for (const name of fields) {
          const el = $(`#vf-${name}`, root);
          if (el) body[name] = el.value;
        }
        if (!isEdit) {
          body.plate = $('#vf-plate', root).value;
          if (v.lookupSource) body.lookupSource = v.lookupSource;
          if (v.lookup) body.lookup = v.lookup;
          for (const extra of ['seats', 'co2', 'tax_status', 'tax_due', 'first_registered', 'region']) {
            if (v[extra] !== undefined && v[extra] !== null) body[extra] = v[extra];
          }
        }
        return body;
      };

      const refreshGuide = debounce(async () => {
        try {
          const { estimate } = await api('/valuation', { method: 'POST', body: read() });
          const el = $('#guide-value', root);
          if (el) {
            el.textContent = money(estimate.retail);
            el.dataset.value = estimate.retail;
          }
        } catch { /* guide is a nicety, never blocks saving */ }
      }, 450);

      // Picking a make narrows the model list to that make's own range, so the
      // second field is a short menu rather than a blank box.
      const makeInput = $('#vf-make', root);
      const modelList = $('#dl-model', root);
      const refreshModels = () => {
        modelList.innerHTML = modelsFor(makeInput.value)
          .map((m) => `<option>${esc(m)}</option>`).join('');
      };
      makeInput.addEventListener('input', refreshModels);
      refreshModels();

      $$('input, select', root).forEach((el) => el.addEventListener('input', refreshGuide));
      refreshGuide();

      root.querySelector('#guide-use').addEventListener('click', () => {
        const value = $('#guide-value', root).dataset.value;
        if (value) $('#vf-asking_price', root).value = value;
      });
      root.querySelector('[data-cancel]').addEventListener('click', closeModal);
      root.querySelector('#vf-save').addEventListener('click', async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Saving…';
        try {
          const body = read();
          if (isEdit) {
            await api(`/vehicles/${v.id}`, { method: 'PATCH', body });
            closeModal();
            state.loadedStock = false;
            toast('Saved', 'good');
            await reloadVehicle(v.id);
          } else {
            const res = await api('/vehicles', { method: 'POST', body });
            closeModal();
            state.loadedStock = false;
            toast('Added to stock', 'good');
            location.hash = `#/vehicle/${res.vehicle.id}`;
          }
        } catch (err) {
          toast(err.message, 'bad');
          e.target.disabled = false;
          e.target.textContent = isEdit ? 'Save changes' : 'Add to stock';
          if (err.data && err.data.vehicleId) location.hash = `#/vehicle/${err.data.vehicleId}`;
        }
      });
    },
  });
}

/* ---------------------------------------------------------------- diary */

async function renderDiary() {
  loading();
  let data;
  try {
    data = await api('/appointments');
  } catch (err) {
    return renderError(err);
  }

  const groups = new Map();
  for (const a of data.appointments) {
    const key = new Date(a.scheduled_at).toDateString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }

  const today = new Date().toDateString();
  const tomorrow = new Date(Date.now() + 86400000).toDateString();
  const dayLabel = (key) => (key === today ? 'Today' : key === tomorrow ? 'Tomorrow'
    : new Date(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }));

  $('#view').innerHTML = `
    <div class="page-head">
      <div>
        <h1>Diary</h1>
        <p class="sub">${data.appointments.length} appointment${data.appointments.length === 1 ? '' : 's'} from yesterday onwards</p>
      </div>
    </div>
    ${groups.size ? [...groups.entries()].map(([key, items]) => `
      <div class="card" style="margin-bottom:14px">
        <div class="card-head">
          <h3>${esc(dayLabel(key))}</h3>
          <span class="hint">${items.length} booked</span>
        </div>
        <div class="list">${items.map((a) => `
          <div class="list-row">
            <div class="when" style="width:56px;font-weight:700;color:var(--ink)">${esc(timeOnly(a.scheduled_at))}</div>
            <div class="ev ${a.kind === 'collection' || a.kind === 'delivery' ? 'offer' : 'viewing'}">
              ${a.kind === 'collection' || a.kind === 'delivery' ? ICONS.key : ICONS.calendar}
            </div>
            <div class="grow" style="${a.status !== 'scheduled' ? 'opacity:.55' : ''}">
              <div class="t">${esc(a.customer_name)} · ${esc(APPT_LABEL[a.kind] || a.kind)}
                ${a.status !== 'scheduled' ? `<span class="badge ${a.status === 'completed' ? 'good' : a.status === 'no_show' ? 'bad' : ''}">${esc(a.status.replace('_', ' '))}</span>` : ''}</div>
              <div class="s">${esc(a.plate)} ${esc(vehicleTitle(a))}${a.customer_phone ? ` · ${esc(a.customer_phone)}` : ''}${
                a.deposit ? ` · ${money(a.deposit)} deposit` : ''}${a.notes ? ` · ${esc(a.notes)}` : ''}</div>
            </div>
            ${a.status === 'scheduled' ? `
              <button class="btn btn-secondary btn-sm" data-appt-done="${esc(a.id)}" type="button">Done</button>
              <button class="btn btn-ghost btn-sm" data-appt-noshow="${esc(a.id)}" type="button">No show</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-go="#/vehicle/${esc(a.vehicle_id)}" type="button">Open car</button>
            <button class="icon-btn" data-appt-del="${esc(a.id)}" type="button" aria-label="Delete">
              <svg viewBox="0 0 24 24" class="ico"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>`).join('')}</div>
      </div>`).join('')
      : `<div class="card">${emptyBlock('Nothing in the diary',
          'Open a vehicle and use “Book someone in” to add a viewing, a test drive or a collection.')}</div>`}`;

  wireAppointmentActions(renderDiary);
  wireGo($('#view'));
}

/* ---------------------------------------------------------------- enquiries */

async function renderEnquiries() {
  loading();
  let d;
  try {
    d = await api('/dashboard');
  } catch (err) {
    return renderError(err);
  }

  const rows = d.feed;
  $('#view').innerHTML = `
    <div class="page-head">
      <div>
        <h1>Enquiries</h1>
        <p class="sub">Everyone who has been in touch, newest first</p>
      </div>
    </div>
    <div class="grid grid-kpi" style="margin-bottom:16px">
      <div class="card kpi"><span class="label">Viewings this week</span><span class="value">${d.week.viewings}</span></div>
      <div class="card kpi"><span class="label">Calls this week</span><span class="value">${d.week.calls}</span></div>
      <div class="card kpi"><span class="label">Test drives</span><span class="value">${d.week.testDrives}</span></div>
      <div class="card kpi"><span class="label">Offers</span><span class="value">${d.week.offers}</span></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Contact log</h3></div>
      ${rows.length ? `<div class="list">${rows.map((a) => `
        <div class="list-row clickable" data-go="#/vehicle/${esc(a.vehicle_id)}">
          <div class="ev ${esc(a.kind)}">${ICONS[a.kind] || ICONS.note}</div>
          <div class="grow">
            <div class="t">${esc(a.contact_name || KIND_LABEL[a.kind] || a.kind)}${
              a.contact_phone ? ` · <span style="font-weight:500">${esc(a.contact_phone)}</span>` : ''}</div>
            <div class="s">${esc(KIND_LABEL[a.kind] || a.kind)} · ${esc(a.plate)} ${esc([a.make, a.model].filter(Boolean).join(' '))}${
              a.amount ? ` · offered ${money(a.amount)}` : ''}${a.notes ? ` · ${esc(a.notes)}` : ''}</div>
          </div>
          <div class="when">${esc(relative(a.occurred_at))}</div>
        </div>`).join('')}</div>`
        : emptyBlock('No enquiries logged', 'Every viewing and call you log against a car shows up here.')}
    </div>`;
  wireGo($('#view'));
}

/* ---------------------------------------------------------------- reports */

async function renderReports() {
  loading();
  let d;
  let vehicles;
  try {
    [d, vehicles] = await Promise.all([api('/dashboard'), api('/vehicles?status=all&sort=newest')]);
  } catch (err) {
    return renderError(err);
  }
  const all = vehicles.vehicles;
  const sold = all.filter((v) => v.status === 'sold');
  const live = all.filter((v) => ['in_stock', 'prep', 'reserved'].includes(v.status));
  const totalProfit = sold.reduce((sum, v) => sum + (v.profit || 0), 0);
  const avgDays = live.length ? Math.round(live.reduce((s, v) => s + v.stats.daysInStock, 0) / live.length) : 0;
  const totalInterest = all.reduce((s, v) => s + v.stats.interest, 0);
  const conversion = totalInterest ? ((sold.length / totalInterest) * 100).toFixed(1) : '0';

  const buckets = [['Under 30 days', 0], ['30–60 days', 0], ['60–90 days', 0], ['Over 90 days', 0]];
  for (const v of live) {
    const d2 = v.stats.daysInStock;
    if (d2 < 30) buckets[0][1]++;
    else if (d2 < 60) buckets[1][1]++;
    else if (d2 < 90) buckets[2][1]++;
    else buckets[3][1]++;
  }
  const maxBucket = Math.max(1, ...buckets.map(([, n]) => n));

  $('#view').innerHTML = `
    <div class="page-head">
      <div>
        <h1>Reports</h1>
        <p class="sub">How the pitch is performing</p>
      </div>
      <a class="btn btn-secondary" href="/api/export/stock.csv" download>Export stock CSV</a>
    </div>

    <div class="grid grid-kpi" style="margin-bottom:16px">
      <div class="card kpi"><span class="label">Sold all time</span><span class="value">${sold.length}</span>
        <span class="foot">${money(sold.reduce((s, v) => s + (v.sold_price || 0), 0))} of sales</span></div>
      <div class="card kpi"><span class="label">Total profit</span><span class="value">${money(totalProfit)}</span>
        <span class="foot ${totalProfit > 0 ? 'good' : ''}">${sold.length ? money(totalProfit / sold.length) : '—'} per car</span></div>
      <div class="card kpi"><span class="label">Average days to sell</span><span class="value">${avgDays}</span>
        <span class="foot">current live stock age</span></div>
      <div class="card kpi"><span class="label">Enquiries logged</span><span class="value">${totalInterest}</span>
        <span class="foot">${conversion}% turn into sales</span></div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h3>How long stock has been standing</h3></div>
        ${buckets.map(([label, n]) => `
          <div style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:5px">
              <span style="color:var(--muted)">${label}</span><b>${n}</b>
            </div>
            <div class="bar"><span style="width:${(n / maxBucket) * 100}%;background:${
              label === 'Over 90 days' ? 'var(--bad)' : label === '60–90 days' ? 'var(--warn)' : 'var(--brand)'}"></span></div>
          </div>`).join('')}
      </div>

      <div class="card">
        <div class="card-head"><h3>Recently sold</h3></div>
        ${sold.length ? `<div class="list">${sold.slice(0, 8).map((v) => `
          <div class="list-row clickable" data-go="#/vehicle/${esc(v.id)}">
            ${plateHtml(v.plate)}
            <div class="grow">
              <div class="t">${esc(vehicleTitle(v))}</div>
              <div class="s">${esc(dateShort(v.date_sold))} · ${esc(v.buyer_name || 'buyer not recorded')}</div>
            </div>
            <div class="when"><b>${money(v.sold_price)}</b>${
              v.profit !== null ? `<div class="${v.profit > 0 ? 'tone-good' : 'tone-bad'}">${money(v.profit)}</div>` : ''}</div>
          </div>`).join('')}</div>`
          : emptyBlock('Nothing sold yet', 'Mark a car as sold and it will appear here with its profit.')}
      </div>
    </div>`;
  wireGo($('#view'));
}

/* ---------------------------------------------------------------- team */

async function renderTeam() {
  loading();
  let data;
  try {
    data = await api('/team');
  } catch (err) {
    return renderError(err);
  }
  const isOwner = state.user.role === 'owner';

  $('#view').innerHTML = `
    <div class="page-head">
      <div>
        <h1>Team</h1>
        <p class="sub">${data.team.length} ${data.team.length === 1 ? 'person' : 'people'} at ${esc(state.user.dealership.name)}</p>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><h3>Invite the rest of the team</h3></div>
      <p class="hint" style="margin-bottom:10px">Share this code. They pick “Join team” on the sign-in screen and
        everything you both log lands in the same place.</p>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <code style="font-family:var(--mono);font-size:22px;font-weight:700;letter-spacing:.14em;
          background:var(--surface-sunk);padding:10px 16px;border-radius:10px">${esc(data.joinCode)}</code>
        <button class="btn btn-secondary btn-sm" id="copy-code" type="button">Copy</button>
        ${isOwner ? `<button class="btn btn-ghost btn-sm" id="new-code" type="button">Generate a new one</button>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>People</h3></div>
      <div class="list">${data.team.map((m) => `
        <div class="list-row">
          <div class="ev">${esc((m.name || '?').slice(0, 1).toUpperCase())}</div>
          <div class="grow">
            <div class="t">${esc(m.name)} ${m.id === state.user.id ? '<span class="badge">you</span>' : ''}
              ${m.role === 'owner' ? '<span class="badge good">owner</span>' : ''}</div>
            <div class="s">${esc(m.email)} · ${m.logged} entries logged · last seen ${esc(relative(m.last_seen_at) || 'never')}</div>
          </div>
          ${isOwner && m.id !== state.user.id ? `
            <button class="btn btn-secondary btn-sm" data-role="${esc(m.id)}" data-next="${m.role === 'owner' ? 'member' : 'owner'}" type="button">
              Make ${m.role === 'owner' ? 'member' : 'owner'}</button>
            <button class="icon-btn" data-remove="${esc(m.id)}" type="button" aria-label="Remove">
              <svg viewBox="0 0 24 24" class="ico"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>` : ''}
        </div>`).join('')}</div>
    </div>`;

  $('#copy-code').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(data.joinCode);
      toast('Team code copied', 'good');
    } catch {
      toast('Copy failed — select it by hand', 'bad');
    }
  });
  if ($('#new-code')) {
    $('#new-code').addEventListener('click', async () => {
      const ok = await confirmDialog('Generate a new team code?',
        'The old code stops working. Anyone already signed in stays signed in.', 'Generate');
      if (!ok) return;
      await api('/team/code', { method: 'POST' });
      toast('New code generated', 'good');
      renderTeam();
    });
  }
  $$('[data-role]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/team/${b.dataset.role}`, { method: 'PATCH', body: { role: b.dataset.next } });
    toast('Role updated', 'good');
    renderTeam();
  }));
  $$('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    const ok = await confirmDialog('Remove this person?', 'They lose access immediately. Anything they logged stays.', 'Remove');
    if (!ok) return;
    await api(`/team/${b.dataset.remove}`, { method: 'DELETE' });
    toast('Removed');
    renderTeam();
  }));
}

/* ---------------------------------------------------------------- settings */

function renderSettings() {
  const d = state.user.dealership;
  const isOwner = state.user.role === 'owner';

  $('#view').innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><p class="sub">Your account and your dealership</p></div></div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h3>You</h3></div>
        <div class="stack">
          <div class="field"><label for="s-name">Name</label><input id="s-name" value="${esc(state.user.name)}" /></div>
          <div class="field"><label for="s-email">Email</label><input id="s-email" type="email" value="${esc(state.user.email)}" /></div>
          <button class="btn btn-secondary" id="s-save-me" type="button">Save</button>
        </div>
        <hr style="border:0;border-top:1px solid var(--line);margin:18px 0" />
        <div class="stack">
          <div class="field"><label for="s-pass-old">Current password</label><input id="s-pass-old" type="password" autocomplete="current-password" /></div>
          <div class="field"><label for="s-pass-new">New password</label><input id="s-pass-new" type="password" autocomplete="new-password" /></div>
          <button class="btn btn-secondary" id="s-save-pass" type="button">Change password</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Dealership</h3>${isOwner ? '' : '<span class="badge">owner only</span>'}</div>
        <div class="stack">
          <div class="field"><label for="s-dealer">Name</label>
            <input id="s-dealer" value="${esc(d.name)}" ${isOwner ? '' : 'disabled'} /></div>
          <div class="row">
            <div class="field"><label for="s-currency">Currency</label>
              <select id="s-currency" ${isOwner ? '' : 'disabled'}>
                ${['GBP', 'EUR', 'USD', 'AUD', 'NZD', 'CAD', 'ZAR', 'AED', 'INR'].map((c) =>
                  `<option ${d.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select></div>
            <div class="field"><label for="s-distance">Distance</label>
              <select id="s-distance" ${isOwner ? '' : 'disabled'}>
                <option value="mi" ${d.distanceUnit === 'mi' ? 'selected' : ''}>Miles</option>
                <option value="km" ${d.distanceUnit === 'km' ? 'selected' : ''}>Kilometres</option>
              </select></div>
          </div>
          ${isOwner ? '<button class="btn btn-secondary" id="s-save-dealer" type="button">Save dealership</button>' : ''}
        </div>
        <hr style="border:0;border-top:1px solid var(--line);margin:18px 0" />
        <div class="card-head"><h3>Data</h3></div>
        <p class="hint" style="margin-bottom:10px">${globalThis.FORECOURT_SHARED
          ? 'Everything lives in this page. Each change saves a new version, so everyone with the link sees the same stock.'
          : 'Everything lives in your own Cloudflare D1 database.'}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn btn-secondary btn-sm" href="/api/export/stock.csv" download>Export stock CSV</a>
          <button class="btn btn-ghost btn-sm" id="s-theme" type="button">Switch theme</button>
          <button class="btn btn-danger btn-sm" id="s-logout" type="button">Sign out</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Number plate lookups</h3></div>
        <p style="color:var(--muted);font-size:14px">
          Forecourt reads every registration offline — format, age identifier, the date window it was issued in and
          the DVLA office that issued it — and decodes any VIN through the free NHTSA database.
        </p>
        <p style="color:var(--muted);font-size:14px;margin-top:10px">${globalThis.FORECOURT_SHARED
          ? `A shared page cannot call outside services — that sandbox is what makes it safe to hand round — so
             there is no DVLA lookup here and no key to add. Make and model suggest as you type instead. For live
             lookup from the registration, run the Cloudflare version, where a key can be held server-side.`
          : `For live make, colour, fuel, engine size, MOT and tax straight from the plate, add a free DVLA key as a
             Worker secret named <code style="font-family:var(--mono)">DVLA_API_KEY</code>, or point
             <code style="font-family:var(--mono)">LOOKUP_URL</code> at any provider you already pay for. Nothing
             else in the app changes.`}
        </p>
      </div>
    </div>`;

  $('#s-save-me').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const res = await api('/me', { method: 'PATCH', body: { name: $('#s-name').value, email: $('#s-email').value } });
      state.user = res.user;
      $('#who').innerHTML = `<b>${esc(state.user.name)}</b><span>${esc(state.user.dealership.name)}</span>`;
      toast('Saved', 'good');
    } catch (err) {
      toast(err.message, 'bad');
    }
    e.target.disabled = false;
  });

  $('#s-save-pass').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await api('/me/password', {
        method: 'POST',
        body: { currentPassword: $('#s-pass-old').value, newPassword: $('#s-pass-new').value },
      });
      $('#s-pass-old').value = '';
      $('#s-pass-new').value = '';
      toast('Password changed', 'good');
    } catch (err) {
      toast(err.message, 'bad');
    }
    e.target.disabled = false;
  });

  if ($('#s-save-dealer')) {
    $('#s-save-dealer').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const res = await api('/settings', {
          method: 'PATCH',
          body: {
            name: $('#s-dealer').value,
            currency: $('#s-currency').value,
            distanceUnit: $('#s-distance').value,
          },
        });
        state.user = res.user;
        state.loadedStock = false;
        $('#who').innerHTML = `<b>${esc(state.user.name)}</b><span>${esc(state.user.dealership.name)}</span>`;
        toast('Saved', 'good');
      } catch (err) {
        toast(err.message, 'bad');
      }
      e.target.disabled = false;
    });
  }

  $('#s-theme').addEventListener('click', toggleTheme);
  $('#s-logout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    location.hash = '';
    location.reload();
  });
}

/* ---------------------------------------------------------------- chrome */

function toggleTheme() {
  const isDark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const next = isDark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('fc-theme', next);
  } catch { /* the choice just will not stick */ }
}

$('#theme-toggle').addEventListener('click', toggleTheme);
$('#add-vehicle-btn').addEventListener('click', openAddVehicle);
$('#mobile-title-btn').addEventListener('click', () => { location.hash = '#/settings'; });

$('#global-search').addEventListener('input', debounce((e) => {
  state.filters.q = e.target.value.trim();
  if (!location.hash.startsWith('#/stock')) {
    location.hash = '#/stock';
  } else {
    refreshStock();
  }
}, 320));

document.addEventListener('keydown', (e) => {
  if (!state.user || modalStack.length) return;
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if (typing) return;
  if (e.key === '/') {
    e.preventDefault();
    $('#global-search').focus();
  }
  if (e.key.toLowerCase() === 'n') openAddVehicle();
});

boot();


