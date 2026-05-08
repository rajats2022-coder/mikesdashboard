const STORAGE_KEY = 'mikeNiceCommandCenter.production.v1';
const SCHEMA_VERSION = 4;
const REFRESH_INTERVAL_MS = 60 * 1000;
const API_ENDPOINT = '/api/leads';

const stages = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'quoted', label: 'Quoted' },
  { id: 'booked', label: 'Booked' },
  { id: 'done', label: 'Done' },
];

const sectionMeta = {
  catering: {
    label: 'Catering',
    accent: 'Event lead',
    empty: 'No catering leads here yet.',
    playbook: [
      'Reply inside the SLA window and confirm event date, guest count, location, and budget.',
      'Move to Quoted after sending package pricing and requested fillings.',
      'Move to Booked only after date, deposit, pickup/service details, and balance timing are confirmed.',
    ],
  },
  frozen: {
    label: 'Frozen Empanadas',
    accent: 'Frozen order',
    empty: 'No frozen orders here yet.',
    playbook: [
      'Confirm pickup day, dozen count, filling mix, and whether sauces are included.',
      'Batch prep by pickup day so Friday/Saturday orders are grouped together.',
      'Move to Done when payment and pickup/delivery are completed.',
    ],
  },
  merch: {
    label: 'Merch',
    accent: 'Merch request',
    empty: 'No merch requests here yet.',
    playbook: [
      'Confirm product, size, color, quantity, and shipping or pickup preference.',
      'Move to Quoted when price and fulfillment timing are sent.',
      'Move to Done after payment and pickup/shipping handoff.',
    ],
  },
};

const defaultSettings = {
  slaHours: 4,
  minGuests: 25,
  depositPercent: 50,
  pickupDays: 'Friday, Saturday, Sunday',
  phone: '(984) 272-2728',
  email: 'mikeniceempanadas@gmail.com',
};

const connections = [
  {
    id: 'website-catering-form',
    label: 'Website Catering Form',
    status: 'ready',
    description: 'Booking form submissions are routed server-side into Supabase and exposed to this dashboard through /api/leads.',
    next: 'Add production Supabase env vars, run the migration, then submit one real booking test.',
  },
  {
    id: 'email-parser',
    label: 'Lead Email Inbox',
    status: 'ready',
    description: 'Parse lead notification emails and normalize them into the same lead schema.',
    next: 'Use Gmail forwarding, Zapier Email Parser, Make, or a custom webhook worker.',
  },
  {
    id: 'frozen-orders',
    label: 'Frozen Orders',
    status: 'ready',
    description: 'Frozen empanada order forms can create pickup/delivery work in the Frozen board.',
    next: 'Send order payloads with dozen count, filling mix, pickup date, value, and contact details.',
  },
  {
    id: 'merch-orders',
    label: 'Merch Orders',
    status: 'ready',
    description: 'Merch requests and orders can flow into the Merch board with size/color notes.',
    next: 'Connect checkout/order form when merch products are finalized.',
  },
  {
    id: 'database',
    label: 'Database / CRM',
    status: 'ready',
    description: 'The dashboard reads/writes through /api/leads, backed by the existing S4 AI Agency Supabase project when env vars are present.',
    next: 'Run the multi-tenant migration and add dashboard users before handoff.',
  },
  {
    id: 'auth',
    label: 'Authentication',
    status: 'ready',
    description: 'The companion Mike dashboard uses Supabase magic-link auth and RLS. Protect this command center route before public handoff if needed.',
    next: 'Add Mike and S4 admin emails to dashboard_users.',
  },
];

const inboundLeadSchema = {
  section: 'catering | frozen | merch',
  customer: 'Customer or company name',
  phone: 'Optional phone string',
  email: 'Optional email string',
  source: 'Website form | Email | Instagram | Phone call | StreetFoodFinder | Referral | API/Webhook',
  value: 'Estimated number in USD',
  nextAction: 'YYYY-MM-DD optional',
  details: 'Full request text',
  preferredContact: 'Text | Call | Email | Instagram DM',
  customerType: 'New lead | Repeat customer | Corporate buyer | Event planner | Wholesale / partner | Fan / merch buyer',
  marketingConsent: 'yes | no | unknown',
  tags: ['wedding', 'corporate', 'birria', 'VIP'],
  metadata: { eventDate: 'optional', guests: 'optional', pickupDate: 'optional', items: 'optional', formName: 'optional' },
};

const dataAdapter = {
  load() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return freshState();
    try { return normalizeState(JSON.parse(saved)); }
    catch { return freshState(); }
  },
  save(nextState) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(nextState)));
  },
  async sync() {
    if (!window.fetch) return { mode: 'local', state: this.load() };
    try {
      const response = await fetch(API_ENDPOINT, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const remote = normalizeState(await response.json());
      this.save(remote);
      return { mode: 'api', state: remote };
    } catch (error) {
      return { mode: 'local', state: this.load(), error };
    }
  },
  async postLead(payload) {
    const normalized = normalizeLead(payload);
    try {
      const response = await fetch(API_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(normalized) });
      if (response.ok) {
        const saved = normalizeLead(await response.json());
        state.leads = upsertLead(state.leads, saved);
        this.save(state);
        render();
        return saved;
      }
    } catch {}
    state.leads = upsertLead(state.leads, normalized);
    this.save(state);
    render();
    return normalized;
  },
};

let state = dataAdapter.load();
let activeView = 'dashboard';
let filters = { catering: 'all', frozen: 'all', merch: 'all' };
let crmSearch = '';
let crmSegment = 'all';
let syncTimer = null;
let lastSyncMode = 'local';
let lastSyncAt = null;

const $ = selector => document.querySelector(selector);
const els = {
  sideNav: $('#sideNav'), viewTitle: $('#viewTitle'), metricGrid: $('#metricGrid'), sectionPanels: $('#sectionPanels'),
  notificationList: $('#notificationList'), notificationSummary: $('#notificationSummary'), followUpList: $('#followUpList'),
  todayFocus: $('#todayFocus'), todaySubtext: $('#todaySubtext'), leadModal: $('#leadModal'), leadForm: $('#leadForm'),
  detailDrawer: $('#detailDrawer'), settingsForm: $('#settingsForm'), playbookList: $('#playbookList'), connectionsGrid: $('#connectionsGrid'),
  schemaBlock: $('#schemaBlock'), importFile: $('#importFile'), crmGrid: $('#crmGrid'), crmTable: $('#crmTable'), crmSearch: $('#crmSearch'), crmSegment: $('#crmSegment'),
  refreshNow: $('#refreshNow'), syncStatus: $('#syncStatus'), syncDot: $('#syncDot'),
};

init();

function init() {
  bindNav(); bindModal(); bindSettings(); bindImportExport(); bindConnections(); bindCrm(); bindSync(); renderStatusOptions(); render(); refreshData('startup');
}

function freshState() { return { schemaVersion: SCHEMA_VERSION, leads: [], settings: { ...defaultSettings } }; }
function todayPlus(offset) { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); }
function money(value) { return Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }); }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function stageLabel(status) { return stages.find(stage => stage.id === status)?.label || status; }
function byDate(a, b) { return new Date(a.nextAction || a.createdAt) - new Date(b.nextAction || b.createdAt); }
function upsertLead(leads, nextLead) {
  const normalized = normalizeLead(nextLead);
  const existingIndex = leads.findIndex(lead => lead.id === normalized.id);
  if (existingIndex === -1) return [normalized, ...leads];
  return leads.map((lead, index) => index === existingIndex ? normalized : lead);
}
function formatTime(date) { return date ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'never'; }
function setSyncStatus(message, mode = lastSyncMode) {
  if (els.syncStatus) els.syncStatus.textContent = message;
  if (els.syncDot) {
    els.syncDot.classList.toggle('syncing', mode === 'syncing');
    els.syncDot.classList.toggle('offline', mode === 'local');
  }
}
function tagsFrom(input) {
  if (Array.isArray(input)) return input.map(tag => String(tag).trim()).filter(Boolean);
  return String(input || '').split(',').map(tag => tag.trim()).filter(Boolean);
}
function leadScore(lead) {
  let score = 35;
  if (lead.section === 'catering') score += 20;
  if (Number(lead.value || 0) >= 500) score += 18;
  if (Number(lead.metadata?.guests || 0) >= 50) score += 12;
  if (lead.phone) score += 6;
  if (lead.email) score += 4;
  if (lead.status === 'booked') score += 18;
  if (lead.status === 'done') score += 8;
  if (lead.nextAction && lead.nextAction <= todayPlus(0) && lead.status !== 'done') score += 10;
  return Math.min(100, score);
}

function normalizeState(input) {
  return { schemaVersion: SCHEMA_VERSION, settings: { ...defaultSettings, ...(input.settings || {}) }, leads: Array.isArray(input.leads) ? input.leads.map(normalizeLead) : [] };
}
function normalizeLead(input) {
  const section = sectionMeta[input.section] ? input.section : 'catering';
  const status = stages.some(stage => stage.id === input.status) ? input.status : 'new';
  return {
    id: input.id || `lead-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    section, status,
    customer: String(input.customer || 'Unknown lead').trim(),
    phone: String(input.phone || '').trim(), email: String(input.email || '').trim(), source: String(input.source || 'API/Webhook'),
    value: Number(input.value || 0), nextAction: input.nextAction || todayPlus(1), createdAt: input.createdAt || todayPlus(0), lastContact: input.lastContact || '',
    details: String(input.details || 'No details entered yet.').trim(), notes: Array.isArray(input.notes) ? input.notes : [], metadata: input.metadata || {},
    preferredContact: String(input.preferredContact || input.preferred_contact || (input.phone ? 'Text' : 'Email')).trim(),
    customerType: String(input.customerType || input.customer_type || 'New lead').trim(), marketingConsent: String(input.marketingConsent || input.marketing_consent || 'unknown').trim(), tags: tagsFrom(input.tags),
  };
}
function persist() { dataAdapter.save(state); }

function bindNav() {
  els.sideNav.addEventListener('click', event => {
    const item = event.target.closest('.nav-item'); if (!item) return;
    activeView = item.dataset.view;
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn === item));
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === `view-${activeView}`));
    els.viewTitle.textContent = $(`#view-${activeView}`).dataset.title;
    render();
  });
  document.querySelectorAll('[data-section-filter]').forEach(row => {
    const section = row.dataset.sectionFilter;
    row.innerHTML = [{ id: 'all', label: 'All' }, ...stages].map(chip => `<button class="filter-chip ${chip.id === 'all' ? 'active' : ''}" data-section="${section}" data-filter="${chip.id}" type="button">${chip.label}</button>`).join('');
  });
  document.body.addEventListener('click', event => {
    const chip = event.target.closest('.filter-chip'); if (!chip) return;
    filters[chip.dataset.section] = chip.dataset.filter;
    chip.parentElement.querySelectorAll('.filter-chip').forEach(btn => btn.classList.toggle('active', btn === chip));
    renderBoards();
  });
}

function bindModal() {
  $('#openLeadModal')?.addEventListener('click', () => { els.leadForm.reset(); renderStatusOptions(); els.leadModal.showModal(); });
  els.leadForm.addEventListener('submit', event => {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(els.leadForm));
    dataAdapter.postLead({ ...payload, notes: ['Manually added in dashboard.'] });
    els.leadModal.close(); toast('Lead saved');
  });
}

function bindSettings() {
  $('#saveSettings')?.addEventListener('click', () => {
    state.settings = { ...state.settings, ...Object.fromEntries(new FormData(els.settingsForm)) };
    persist(); renderSettings(); toast('Settings saved');
  });
}
function bindImportExport() {
  $('#exportData')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `mike-nice-dashboard-${todayPlus(0)}.json`; link.click(); URL.revokeObjectURL(link.href);
  });
  $('#importData')?.addEventListener('click', () => els.importFile.click());
  els.importFile?.addEventListener('change', async () => {
    const file = els.importFile.files[0]; if (!file) return;
    try { state = normalizeState(JSON.parse(await file.text())); persist(); render(); toast('Import complete'); }
    catch { toast('Import failed: invalid JSON'); }
    els.importFile.value = '';
  });
}
function bindConnections() {
  $('#copySchema')?.addEventListener('click', async () => { await navigator.clipboard?.writeText(JSON.stringify(inboundLeadSchema, null, 2)); toast('Schema copied'); });
}
function bindCrm() {
  els.crmSearch?.addEventListener('input', event => { crmSearch = event.target.value.toLowerCase().trim(); renderCrm(); });
  els.crmSegment?.addEventListener('change', event => { crmSegment = event.target.value; renderCrm(); });
  $('#copyMarketingList')?.addEventListener('click', async () => {
    const rows = state.leads.filter(lead => lead.marketingConsent === 'yes' && (lead.email || lead.phone)).map(lead => `${lead.customer},${lead.email},${lead.phone},${lead.section},${lead.tags.join('|')}`);
    await navigator.clipboard?.writeText(['name,email,phone,interest,tags', ...rows].join('\n'));
    toast(`${rows.length} marketing contacts copied`);
  });
}
function bindSync() {
  els.refreshNow?.addEventListener('click', () => refreshData('manual'));
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { state = normalizeState(JSON.parse(event.newValue)); render(); setSyncStatus(`Updated from another tab at ${formatTime(new Date())}`, 'api'); }
    catch {}
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshData('visible'); });
  syncTimer = window.setInterval(() => refreshData('timer'), REFRESH_INTERVAL_MS);
}
async function refreshData(reason = 'timer') {
  setSyncStatus('Checking for new orders...', 'syncing');
  const result = await dataAdapter.sync();
  state = result.state;
  lastSyncMode = result.mode;
  lastSyncAt = new Date();
  render();
  const source = result.mode === 'api' ? 'live API' : 'local storage';
  setSyncStatus(`Last checked ${formatTime(lastSyncAt)} via ${source}. Auto-refresh every 60 seconds.`, result.mode);
  if (reason === 'manual') toast(`Refreshed from ${source}`);
}

function renderStatusOptions() { els.leadForm.querySelector('[name="status"]').innerHTML = stages.map(stage => `<option value="${stage.id}">${stage.label}</option>`).join(''); }
function render() { renderSummary(); renderDashboard(); renderBoards(); renderCrm(); renderSettings(); renderConnections(); }
function renderSummary() {
  const newCount = state.leads.filter(lead => lead.status === 'new').length;
  const dueToday = state.leads.filter(lead => lead.nextAction <= todayPlus(0) && lead.status !== 'done').length;
  const cateringNew = state.leads.filter(lead => lead.section === 'catering' && lead.status === 'new').length;
  if (!state.leads.length) {
    els.notificationSummary.textContent = 'No real submissions yet. New booking, frozen, and merch requests will appear here after Supabase is connected.';
    els.todayFocus.textContent = 'No leads yet';
    els.todaySubtext.textContent = 'Ready for the first real customer submission.';
    return;
  }
  els.notificationSummary.textContent = `${newCount} new opportunities, ${dueToday} follow-ups due, ${cateringNew} catering notifications need first action.`;
  els.todayFocus.textContent = `${dueToday} follow-ups`; els.todaySubtext.textContent = `${newCount} new items across catering, frozen, and merch.`;
}
function renderDashboard() {
  const totalValue = state.leads.reduce((sum, lead) => sum + Number(lead.value || 0), 0);
  const bookedValue = state.leads.filter(lead => ['booked', 'done'].includes(lead.status)).reduce((sum, lead) => sum + Number(lead.value || 0), 0);
  const due = state.leads.filter(lead => lead.nextAction <= todayPlus(0) && lead.status !== 'done').length;
  const newLeads = state.leads.filter(lead => lead.status === 'new').length;
  els.metricGrid.innerHTML = [metric('Pipeline', money(totalValue), 'Estimated value across all sections'), metric('Booked', money(bookedValue), 'Confirmed or completed revenue'), metric('Due Today', due, 'Needs call, text, quote, or payment link'), metric('New Leads', newLeads, 'Fresh notifications to organize')].join('');
  els.sectionPanels.innerHTML = Object.keys(sectionMeta).map(sectionPanel).join('');
  els.notificationList.innerHTML = state.leads.length ? state.leads.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 7).map(notificationItem).join('') : '<div class="notification-item"><strong>No real submissions yet</strong><p>Once the website form or order APIs receive real data, the newest items will show here.</p></div>'; 
  const followUps = state.leads.filter(lead => lead.status !== 'done').slice().sort(byDate).slice(0, 7);
  els.followUpList.innerHTML = followUps.map(lead => `<button class="task-item" type="button" onclick="openLead('${lead.id}')"><strong>${escapeHtml(lead.customer)}</strong><p>${sectionMeta[lead.section].label} - ${stageLabel(lead.status)} - next action ${lead.nextAction || 'not set'}</p></button>`).join('') || '<div class="task-item"><strong>Nothing due</strong><p>All visible work is either completed or waiting on the customer.</p></div>';
}
function metric(label, value, helper) { return `<section class="metric-card"><p class="eyebrow">${label}</p><strong>${value}</strong><span>${helper}</span></section>`; }
function sectionPanel(section) {
  const leads = state.leads.filter(lead => lead.section === section); const value = leads.reduce((sum, lead) => sum + Number(lead.value || 0), 0); const urgent = leads.filter(lead => lead.nextAction <= todayPlus(0) && lead.status !== 'done').length; const latest = leads.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 3);
  return `<section class="section-card"><header><div><p class="eyebrow">${sectionMeta[section].accent}</p><h2>${sectionMeta[section].label}</h2></div><span class="big-number">${leads.length}</span></header><ul><li><span>Pipeline value</span><strong>${money(value)}</strong></li><li><span>Needs action today</span><strong>${urgent}</strong></li><li><span>Booked / done</span><strong>${leads.filter(lead => ['booked', 'done'].includes(lead.status)).length}</strong></li></ul><div class="notification-list">${latest.map(lead => `<button class="notification-item" type="button" onclick="openLead('${lead.id}')"><strong>${escapeHtml(lead.customer)}</strong><span class="tag red">${stageLabel(lead.status)}</span></button>`).join('')}</div><footer><button class="ghost-btn compact" type="button" onclick="showView('${section}')">Open ${sectionMeta[section].label}</button></footer></section>`;
}
function notificationItem(lead) { return `<button class="notification-item" type="button" onclick="openLead('${lead.id}')"><div><strong>${escapeHtml(lead.customer)}</strong><p>${sectionMeta[lead.section].label} via ${escapeHtml(lead.source)}. ${escapeHtml(lead.details)}</p></div><span class="tag ${lead.status === 'new' ? 'red' : 'dark'}">${stageLabel(lead.status)}</span></button>`; }
function renderBoards() { ['catering', 'frozen', 'merch'].forEach(section => { const board = $(`#${section}Board`); if (board) board.innerHTML = stages.map(stage => renderColumn(section, stage)).join(''); }); }
function renderColumn(section, stage) { const sectionFilter = filters[section]; const leads = state.leads.filter(lead => lead.section === section && lead.status === stage.id && (sectionFilter === 'all' || lead.status === sectionFilter)); return `<section class="lead-column"><div class="column-head"><h3>${stage.label}</h3><span class="count-pill">${leads.length}</span></div><div class="card-stack">${leads.map(leadCard).join('') || `<div class="lead-card"><p>${sectionMeta[section].empty}</p></div>`}</div></section>`; }
function leadCard(lead) { return `<article class="lead-card"><header><strong>${escapeHtml(lead.customer)}</strong><span class="tag red">${money(lead.value)}</span></header><p>${escapeHtml(lead.details)}</p><div class="meta-row"><span class="tag">${escapeHtml(lead.source)}</span><span class="tag dark">Next: ${lead.nextAction || 'unset'}</span><span class="tag green">CRM ${leadScore(lead)}</span></div><div class="card-actions"><button type="button" onclick="openLead('${lead.id}')">Open</button><button type="button" onclick="moveLead('${lead.id}', 1)">Next Stage</button></div></article>`; }
function moveLead(id, direction) { const lead = state.leads.find(item => item.id === id); if (!lead) return; const index = stages.findIndex(stage => stage.id === lead.status); const next = stages[Math.max(0, Math.min(stages.length - 1, index + direction))]; lead.status = next.id; lead.notes.unshift(`Moved to ${next.label} on ${todayPlus(0)}.`); persist(); render(); openLead(id); }
function openLead(id) { const lead = state.leads.find(item => item.id === id); if (!lead) return; els.detailDrawer.innerHTML = `<div class="drawer-head"><div><p class="eyebrow">${sectionMeta[lead.section].label} CRM ${leadScore(lead)}</p><h2>${escapeHtml(lead.customer)}</h2></div><button class="icon-btn" type="button" onclick="closeLead()">x</button></div><div class="meta-row"><span class="tag red">${stageLabel(lead.status)}</span><span class="tag">${money(lead.value)}</span><span class="tag dark">${escapeHtml(lead.source)}</span><span class="tag green">${escapeHtml(lead.marketingConsent === 'yes' ? 'Marketing ok' : 'Consent ' + lead.marketingConsent)}</span></div><section class="detail-section"><h3>Request</h3><p>${escapeHtml(lead.details)}</p></section><section class="detail-section"><h3>Contact</h3><p>${escapeHtml(lead.phone || 'No phone')}<br>${escapeHtml(lead.email || 'No email')}<br>Prefers: ${escapeHtml(lead.preferredContact || 'Not set')}</p></section><section class="detail-section"><h3>CRM Profile</h3><p>Type: ${escapeHtml(lead.customerType)}<br>Tags: ${escapeHtml(lead.tags.join(', ') || 'None yet')}<br>Created: ${escapeHtml(lead.createdAt || 'Unknown')}<br>Last contact: ${escapeHtml(lead.lastContact || 'Not logged')}</p></section><section class="detail-section"><h3>Next Action</h3><p>${lead.nextAction || 'No date set'}</p></section><section class="detail-section"><h3>Notes</h3><p>${(lead.notes || []).map(escapeHtml).join('<br>') || 'No notes yet.'}</p></section><div class="drawer-actions"><button type="button" onclick="moveLead('${lead.id}', -1)">Move Back</button><button class="primary" type="button" onclick="moveLead('${lead.id}', 1)">Move Forward</button><button type="button" onclick="setNextAction('${lead.id}', 1)">Follow Up Tomorrow</button><button type="button" onclick="setNextAction('${lead.id}', 3)">Follow Up in 3 Days</button><button type="button" onclick="addNote('${lead.id}')">Add Note</button><button class="danger" type="button" onclick="archiveLead('${lead.id}')">Mark Done</button></div>`; els.detailDrawer.classList.add('open'); }
function closeLead() { els.detailDrawer.classList.remove('open'); }
function addNote(id) { const lead = state.leads.find(item => item.id === id); if (!lead) return; const note = prompt('Add a CRM note for this contact'); if (!note) return; lead.notes.unshift(`${todayPlus(0)}: ${note}`); lead.lastContact = todayPlus(0); persist(); render(); openLead(id); }
function setNextAction(id, days) { const lead = state.leads.find(item => item.id === id); if (!lead) return; lead.nextAction = todayPlus(days); lead.notes.unshift(`Next follow-up set for ${lead.nextAction}.`); persist(); render(); openLead(id); }
function archiveLead(id) { const lead = state.leads.find(item => item.id === id); if (!lead) return; lead.status = 'done'; lead.notes.unshift(`Marked done on ${todayPlus(0)}.`); persist(); render(); openLead(id); }
function showView(view) { const button = document.querySelector(`.nav-item[data-view="${view}"]`); if (button) button.click(); }
function renderCrm() {
  if (!els.crmGrid || !els.crmTable) return;
  const leads = filteredCrmLeads();
  const marketing = state.leads.filter(lead => lead.marketingConsent === 'yes' && (lead.email || lead.phone)).length;
  const hot = state.leads.filter(lead => leadScore(lead) >= 70).length;
  const due = state.leads.filter(lead => lead.nextAction <= todayPlus(0) && lead.status !== 'done').length;
  els.crmGrid.innerHTML = [crmStat('Total Contacts', state.leads.length, 'Every captured form, call, DM, frozen order, and merch request.'), crmStat('Hot Leads', hot, 'High-value catering, booked customers, or urgent follow-ups.'), crmStat('Marketing Ready', marketing, 'Contacts with explicit or imported marketing consent.'), crmStat('Due Now', due, 'People Mike should text, call, quote, or close today.'), crmStat('Catering Buyers', state.leads.filter(lead => lead.section === 'catering').length, 'Best segment for future event promotions.'), crmStat('Repeat Potential', state.leads.filter(lead => ['booked', 'done'].includes(lead.status)).length, 'Customers worth reactivating later.')].join('');
  els.crmTable.innerHTML = '<div class="crm-row header"><span>Contact</span><span>Details</span><span>Interest</span><span>Score</span><span>Next</span></div>' + (leads.map(crmRow).join('') || '<div class="crm-empty">No contacts match this CRM filter.</div>');
}
function crmStat(label, value, helper) { return `<article class="crm-stat"><p class="eyebrow">${label}</p><strong>${value}</strong><p>${helper}</p></article>`; }
function filteredCrmLeads() {
  return state.leads.filter(lead => {
    const haystack = [lead.customer, lead.phone, lead.email, lead.source, lead.details, lead.customerType, lead.tags.join(' '), ...(lead.notes || [])].join(' ').toLowerCase();
    if (crmSearch && !haystack.includes(crmSearch)) return false;
    if (crmSegment === 'hot') return leadScore(lead) >= 70;
    if (crmSegment === 'marketing') return lead.marketingConsent === 'yes';
    if (crmSegment === 'due') return lead.nextAction <= todayPlus(0) && lead.status !== 'done';
    if (['catering', 'frozen', 'merch'].includes(crmSegment)) return lead.section === crmSegment;
    return true;
  }).slice().sort((a, b) => leadScore(b) - leadScore(a) || new Date(b.createdAt) - new Date(a.createdAt));
}
function crmRow(lead) {
  return `<div class="crm-row"><button type="button" onclick="openLead('${lead.id}')">${escapeHtml(lead.customer)}<small>${escapeHtml(lead.phone || lead.email || 'No contact saved')}</small></button><span>${escapeHtml(lead.email || 'No email')}<small>${escapeHtml(lead.preferredContact || 'No preference')} - ${escapeHtml(lead.marketingConsent === 'yes' ? 'Marketing ok' : 'Consent ' + lead.marketingConsent)}</small></span><span>${sectionMeta[lead.section].label}<small>${escapeHtml(lead.tags.join(', ') || lead.customerType)}</small></span><span><span class="tag green">${leadScore(lead)}</span></span><span>${escapeHtml(lead.nextAction || 'Unset')}<small>${stageLabel(lead.status)}</small></span></div>`;
}
function renderSettings() { Object.entries(state.settings).forEach(([key, value]) => { const input = els.settingsForm.querySelector(`[name="${key}"]`); if (input) input.value = value; }); els.playbookList.innerHTML = Object.entries(sectionMeta).map(([, meta]) => `<article class="playbook-item"><strong>${meta.label}</strong><p>${meta.playbook.join(' ')}</p></article>`).join(''); }
function renderConnections() { els.connectionsGrid.innerHTML = connections.map(item => `<article class="connection-card"><header><div><p class="eyebrow">${escapeHtml(item.id)}</p><h2>${escapeHtml(item.label)}</h2></div><span class="status-dot ${item.status === 'ready' ? 'ready' : item.status === 'blocked' ? 'blocked' : ''}"></span></header><p>${escapeHtml(item.description)}</p><span class="tag ${item.status === 'ready' ? 'green' : 'dark'}">${item.status}</span><p><strong>Next:</strong> ${escapeHtml(item.next)}</p></article>`).join(''); els.schemaBlock.textContent = JSON.stringify({ ...inboundLeadSchema, sync: { listEndpoint: 'GET /api/leads', createEndpoint: 'POST /api/leads', polling: 'Dashboard checks every 60 seconds and whenever the app becomes visible.' } }, null, 2); }
function toast(message) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = message; document.body.appendChild(el); setTimeout(() => el.remove(), 2200); }

window.openLead = openLead; window.closeLead = closeLead; window.moveLead = moveLead; window.setNextAction = setNextAction; window.archiveLead = archiveLead; window.addNote = addNote; window.showView = showView; window.MikeNiceDashboard = { dataAdapter, normalizeLead, inboundLeadSchema, refreshData, getState: () => state };
