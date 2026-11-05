(() => {
'use strict';

/* ---------- basics ---------- */
const KEY = 'pocket-ledger-v1';
const DEFAULT_CATS = ['Food','Transport','Housing','Bills','Shopping','Health','Entertainment','Education','Travel','Other'];
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const curMonth = () => today().slice(0, 7);

const I = {
  home:'<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',
  spend:'<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 15h2"/>',
  budget:'<circle cx="12" cy="12" r="9"/><path d="M12 3v9h9"/>',
  proj:'<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  tasks:'<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  left:'<path d="M15 5l-7 7 7 7"/>',
  right:'<path d="M9 5l7 7-7 7"/>',
  check:'<path d="M5 12l5 5 9-10"/>'
};
const icon = n => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${I[n]}</svg>`;

/* ---------- data ---------- */
const fresh = () => ({ v:1, settings:{ currency:'$', monthlyBudget:0, lastBackup:'' },
  categories:[...DEFAULT_CATS], budgets:{}, tx:[], projects:[], tasks:[] });
function load() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY));
    if (r && r.v === 1) { const f = fresh(); return Object.assign(f, r, { settings:Object.assign(f.settings, r.settings) }); }
  } catch (e) {}
  return fresh();
}
let db = load();
const ui = { tab:'home', month:curMonth(), txFilter:'all', taskFilter:'open', projectId:null };
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('Could not save — storage may be full'); }
}

/* ---------- formatting & math ---------- */
const num = n => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });
const money = n => (n < 0 ? '-' : '') + db.settings.currency + num(Math.abs(n));
const monthLabel = k => { const [y, m] = k.split('-').map(Number); return new Date(y, m-1, 1).toLocaleDateString(undefined, { month:'long', year:'numeric' }); };
const shiftMonth = (k, d) => { const [y, m] = k.split('-').map(Number); const dt = new Date(y, m-1+d, 1); return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}`; };
const shortDate = d => new Date(d + 'T00:00').toLocaleDateString(undefined, { day:'numeric', month:'short' });
const dayLabel = d => d === today() ? 'Today' : d === addDays(-1) ? 'Yesterday'
  : new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'short' });
const dueLabel = d => !d ? '' : d < today() ? 'Overdue · ' + shortDate(d) : d === today() ? 'Today' : d === addDays(1) ? 'Tomorrow' : shortDate(d);

const monthTx = k => db.tx.filter(t => t.date.startsWith(k));
const total = (list, type) => list.filter(t => t.type === type).reduce((s, t) => s + t.amount, 0);
function spentByCat(k) { const o = {}; monthTx(k).forEach(t => { if (t.type === 'expense') o[t.category] = (o[t.category] || 0) + t.amount; }); return o; }
const budgetTotal = () => db.settings.monthlyBudget > 0 ? db.settings.monthlyBudget : Object.values(db.budgets).reduce((a, b) => a + b, 0);
const daysLeft = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth()+1, 0).getDate() - d.getDate() + 1; };
const tone = p => p >= 1 ? 'over' : p >= .8 ? 'warn' : 'ok';
const bar = (p, t, thin) => { p = isFinite(p) ? p : 0; return `<div class="bar${thin?' thin':''}"><i class="${t || tone(p)}" style="width:${Math.max(0, Math.min(100, p*100))}%"></i></div>`; };

const projItems = p => p.costs.reduce((s, c) => s + c.qty * c.unit, 0);
const projPaidItems = p => p.costs.filter(c => c.paid).reduce((s, c) => s + c.qty * c.unit, 0);
const projLinked = p => db.tx.filter(t => t.projectId === p.id && t.type === 'expense').reduce((s, t) => s + t.amount, 0);
const projCost = p => projItems(p) + projLinked(p);
const projPaid = p => projPaidItems(p) + projLinked(p);
const projTasks = p => db.tasks.filter(t => t.projectId === p.id);

/* ---------- shared view bits ---------- */
const head = (title, right = '') => `<header class="top"><h1>${esc(title)}</h1>${right}</header>`;
const mnav = () => `<div class="mnav"><button class="ic" data-act="prevMonth" aria-label="Previous month">${icon('left')}</button><span>${monthLabel(ui.month)}</span><button class="ic" data-act="nextMonth" aria-label="Next month">${icon('right')}</button></div>`;
const fab = act => `<button class="fab" data-act="${act}" aria-label="Add">${icon('plus')}</button>`;

function txRow(t) {
  const p = t.projectId && db.projects.find(x => x.id === t.projectId);
  return `<button class="row" data-act="editTx" data-id="${t.id}"><span class="dot">${esc((t.category || '?')[0].toUpperCase())}</span>
    <span class="grow"><b>${esc(t.note || t.category)}</b><small>${esc(t.category)}${p ? ' · ' + esc(p.name) : ''}</small></span>
    <span class="amt ${t.type}">${t.type === 'income' ? '+' : ''}${money(t.amount)}</span></button>`;
}
function taskRow(t, showProj = true) {
  const p = t.projectId && db.projects.find(x => x.id === t.projectId);
  const late = !t.done && t.due && t.due < today();
  const pri = t.priority === 'high' ? '<span class="pri high">High</span> · ' : t.priority === 'low' ? '<span class="pri low">Low</span> · ' : '';
  const sub = [showProj && p ? esc(p.name) : '', t.due ? `<span class="${late ? 'late' : ''}">${esc(dueLabel(t.due))}</span>` : ''].filter(Boolean).join(' · ');
  return `<div class="row ${t.done ? 'done' : ''}"><button class="chk ${t.done ? 'on' : ''}" data-act="toggleTask" data-id="${t.id}" aria-label="Toggle done">${t.done ? icon('check') : ''}</button>
    <button class="lnk" data-act="editTask" data-id="${t.id}"><span class="grow"><b>${esc(t.title)}</b><small>${pri}${sub || '&nbsp;'}</small></span></button></div>`;
}
const sortTasks = list => [...list].sort((a, b) => (a.done - b.done) || (a.due || '9999').localeCompare(b.due || '9999')
  || ({high:0, med:1, low:2}[a.priority || 'med'] - {high:0, med:1, low:2}[b.priority || 'med']));

/* ---------- views ---------- */
function vHome() {
  const m = ui.month, now = m === curMonth();
  const list = monthTx(m), spent = total(list, 'expense'), inc = total(list, 'income');
  const bt = budgetTotal();
  let budgetCard = '';
  if (bt > 0) {
    const left = bt - spent, p = spent / bt;
    const extra = now ? (left > 0 ? `${money(left / daysLeft())} / day for ${daysLeft()} more day${daysLeft() > 1 ? 's' : ''}` : 'Over budget') : '';
    budgetCard = `<div class="card"><h2>Monthly budget</h2><div class="spread"><b class="big">${money(Math.abs(left))}</b><small>${left >= 0 ? 'left of' : 'over'} ${money(bt)}</small></div>${bar(p)}<small>${extra}</small></div>`;
  } else {
    budgetCard = `<div class="card"><h2>Monthly budget</h2><small>No budget yet.</small><button class="btn" data-act="tab" data-tab="budget">Set a budget</button></div>`;
  }
  const todaySpent = total(db.tx.filter(t => t.date === today()), 'expense');
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = addDays(-i); days.push({ d, v: total(db.tx.filter(t => t.date === d), 'expense') }); }
  const mx = Math.max(1, ...days.map(x => x.v));
  const cats = Object.entries(spentByCat(m)).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const upcoming = sortTasks(db.tasks.filter(t => !t.done)).slice(0, 4);
  const active = db.projects.filter(p => p.status === 'active').slice(0, 3);
  return head('Overview', `<button class="ic" data-act="tab" data-tab="more" aria-label="Settings">${icon('gear')}</button>`) + mnav() + `
    <div class="grid2" style="margin-bottom:12px">
      <div class="card" style="margin:0"><h2>${now ? 'Today' : 'Spent'}</h2><div class="big">${money(now ? todaySpent : spent)}</div></div>
      <div class="card" style="margin:0"><h2>This month</h2><div class="big">${money(spent)}</div><small>${inc ? 'Income ' + money(inc) + ' · Net ' + money(inc - spent) : 'Expenses'}</small></div>
    </div>` + budgetCard + `
    <div class="card"><h2>Last 7 days</h2><div class="mini">${days.map(x => `<div><i style="height:${Math.round(x.v / mx * 100)}%" title="${money(x.v)}"></i><span>${new Date(x.d + 'T00:00').toLocaleDateString(undefined, { weekday:'narrow' })}</span></div>`).join('')}</div></div>
    <div class="card"><h2>Top categories</h2>${cats.length ? cats.map(([c, v]) => `<div class="catbar"><div class="spread"><b>${esc(c)}</b><span class="amt">${money(v)}</span></div>${bar(v / spent, 'ok', true)}</div>`).join('') : '<small>No expenses this month.</small>'}</div>
    <div class="sec"><span>Next tasks</span><button data-act="tab" data-tab="tasks">See all</button></div>
    ${upcoming.length ? `<div class="list">${upcoming.map(t => taskRow(t)).join('')}</div>` : '<div class="card"><small>Nothing pending.</small></div>'}
    ${active.length ? `<div class="sec"><span>Active projects</span><button data-act="tab" data-tab="proj">See all</button></div><div class="list">${active.map(projRow).join('')}</div>` : ''}
    ${fab('addTx')}`;
}

function vSpend() {
  let list = monthTx(ui.month);
  const spent = total(list, 'expense'), inc = total(list, 'income');
  if (ui.txFilter !== 'all') list = list.filter(t => t.type === ui.txFilter);
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const groups = {};
  list.forEach(t => (groups[t.date] = groups[t.date] || []).push(t));
  const seg = ['all', 'expense', 'income'].map(f => `<button class="${ui.txFilter === f ? 'on' : ''}" data-act="txFilter" data-f="${f}">${f === 'all' ? 'All' : f === 'expense' ? 'Expenses' : 'Income'}</button>`).join('');
  return head('Spending') + mnav() + `
    <div class="card"><div class="spread"><div><small>Spent</small><div class="big">${money(spent)}</div></div><div style="text-align:right"><small>Income</small><div class="amt income" style="font-size:20px">${money(inc)}</div></div></div></div>
    <div class="seg">${seg}</div>` +
    (list.length ? Object.keys(groups).map(d => `<div class="day"><span>${dayLabel(d)}</span><span>${money(total(groups[d], 'expense'))}</span></div><div class="list">${groups[d].map(txRow).join('')}</div>`).join('')
      : '<div class="empty">No entries yet this month.<br>Tap + to add one.</div>') + fab('addTx');
}

function vBudget() {
  const spentC = spentByCat(ui.month), spent = Object.values(spentC).reduce((a, b) => a + b, 0);
  const bt = budgetTotal(), p = bt ? spent / bt : 0;
  const rows = db.categories.map(c => {
    const b = db.budgets[c] || 0, s = spentC[c] || 0;
    return `<button class="row" data-act="setBudget" data-cat="${esc(c)}" style="display:block"><div class="spread"><b>${esc(c)}</b><span class="amt">${money(s)}${b ? ` <small>/ ${money(b)}</small>` : ''}</span></div>
      ${b ? bar(s / b, null, true) + `<small>${s <= b ? money(b - s) + ' left' : money(s - b) + ' over'}</small>` : '<small>Tap to set a monthly budget</small>'}</button>`;
  }).join('');
  return head('Budget') + mnav() + `
    <div class="card"><h2>Overall</h2><div class="spread"><b class="big">${money(spent)}</b><small>of ${bt ? money(bt) : 'no budget'}</small></div>${bt ? bar(p) + `<small>${bt >= spent ? money(bt - spent) + ' left' : money(spent - bt) + ' over budget'}</small>` : ''}
    <button class="btn" data-act="editOverall">${db.settings.monthlyBudget > 0 ? 'Change overall budget' : 'Set overall budget'}</button>
    ${db.settings.monthlyBudget > 0 ? '' : '<small style="display:block;margin-top:8px">Without an overall figure, the total is the sum of your category budgets.</small>'}</div>
    <div class="sec"><span>By category</span></div><div class="list">${rows}</div>`;
}

function projRow(p) {
  const cost = projCost(p), pct = p.budget ? cost / p.budget : 0, ts = projTasks(p), dn = ts.filter(t => t.done).length;
  return `<button class="row" data-act="openProject" data-id="${p.id}" style="display:block"><div class="spread"><b>${esc(p.name)}</b><span class="chip ${p.status === 'active' ? '' : p.status === 'hold' ? 'amber' : 'gray'}">${p.status === 'active' ? 'Active' : p.status === 'hold' ? 'On hold' : 'Done'}</span></div>
    ${p.budget ? bar(pct, null, true) : ''}<small>${money(cost)}${p.budget ? ' of ' + money(p.budget) : ''} · ${dn}/${ts.length} tasks</small></button>`;
}
function vProj() {
  const order = { active:0, hold:1, done:2 };
  const ps = [...db.projects].sort((a, b) => order[a.status] - order[b.status]);
  return head('Projects') + (ps.length ? `<div class="list">${ps.map(projRow).join('')}</div>` : '<div class="empty">No projects yet.<br>Track budget, costs and tasks for anything you are working on.</div>') + fab('addProject');
}
function vProjDetail() {
  const p = db.projects.find(x => x.id === ui.projectId);
  if (!p) { ui.projectId = null; return vProj(); }
  const cost = projCost(p), paid = projPaid(p), left = p.budget - cost;
  const linked = db.tx.filter(t => t.projectId === p.id && t.type === 'expense').sort((a, b) => b.date.localeCompare(a.date));
  const ts = sortTasks(projTasks(p));
  return `<button class="back" data-act="backProject">${icon('left')}Projects</button>` +
    head(p.name, `<button class="link" data-act="editProject" data-id="${p.id}">Edit</button>`) + `
    <div class="card"><div class="grid2">
      <div class="stat"><small>Budget</small><b>${p.budget ? money(p.budget) : '—'}</b></div>
      <div class="stat"><small>Total cost</small><b>${money(cost)}</b></div>
      <div class="stat"><small>Paid so far</small><b>${money(paid)}</b></div>
      <div class="stat"><small>${p.budget ? (left >= 0 ? 'Remaining' : 'Over budget') : 'Still to pay'}</small><b style="${p.budget && left < 0 ? 'color:var(--red)' : ''}">${p.budget ? money(Math.abs(left)) : money(cost - paid)}</b></div></div>
      ${p.budget ? bar(cost / p.budget) : ''}${p.notes ? `<small style="display:block;margin-top:8px;white-space:pre-wrap">${esc(p.notes)}</small>` : ''}</div>
    <div class="sec"><span>Costing</span><button data-act="addCost" data-id="${p.id}">+ Add item</button></div>
    ${p.costs.length ? `<div class="list">${p.costs.map(c => `<button class="row" data-act="editCost" data-id="${c.id}"><span class="grow"><b>${esc(c.desc)}</b><small>${c.qty} × ${money(c.unit)} · ${c.paid ? 'Paid' : 'Planned'}${c.date ? ' · ' + shortDate(c.date) : ''}</small></span><span class="amt">${money(c.qty * c.unit)}</span></button>`).join('')}</div>` : '<div class="card"><small>No cost items. Add materials, services or estimates.</small></div>'}
    ${linked.length ? `<div class="sec"><span>Linked expenses</span></div><div class="list">${linked.map(txRow).join('')}</div>` : ''}
    <div class="sec"><span>Tasks</span><button data-act="addTask" data-id="${p.id}">+ Add task</button></div>
    ${ts.length ? `<div class="list">${ts.map(t => taskRow(t, false)).join('')}</div>` : '<div class="card"><small>No tasks for this project.</small></div>'}`;
}

function vTasks() {
  let list = db.tasks;
  if (ui.taskFilter === 'open') list = list.filter(t => !t.done); else if (ui.taskFilter === 'done') list = list.filter(t => t.done);
  list = sortTasks(list);
  const seg = [['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([f, l]) => `<button class="${ui.taskFilter === f ? 'on' : ''}" data-act="taskFilter" data-f="${f}">${l}</button>`).join('');
  return head('Tasks') + `<div class="seg">${seg}</div>` + (list.length ? `<div class="list">${list.map(t => taskRow(t)).join('')}</div>` : '<div class="empty">Nothing here.</div>') + fab('addTask');
}

function vMore() {
  const lb = db.settings.lastBackup;
  return `<button class="back" data-act="tab" data-tab="home">${icon('left')}Overview</button>` + head('Settings') + `
    <div class="list"><button class="row" data-act="editCurrency"><span class="grow"><b>Currency symbol</b></span><span class="amt">${esc(db.settings.currency)}</span></button></div>
    <div class="sec"><span>Categories</span><button data-act="addCat">+ Add</button></div>
    <div class="list">${db.categories.map(c => `<div class="row"><span class="grow"><b>${esc(c)}</b></span><button class="link" style="color:var(--red);font-size:15px" data-act="delCat" data-cat="${esc(c)}">Remove</button></div>`).join('')}</div>
    <div class="sec"><span>Backup</span></div>
    <div class="card"><small>All data lives only on this phone. Export a backup now and then — if you delete the app or clear Safari data, it is gone.${lb ? '<br>Last backup: ' + esc(lb) : ''}</small>
      <button class="btn" data-act="exportJSON">Export backup (JSON)</button>
      <button class="btn" data-act="importJSON">Restore from backup…</button>
      <button class="btn" data-act="exportCSV">Export expenses (CSV)</button></div>
    <div class="sec"><span>Danger zone</span></div>
    <div class="card"><button class="btn danger" style="margin:0" data-act="reset">Erase all data</button></div>`;
}

/* ---------- render ---------- */
const TABS = [['home','Home','home'], ['spend','Spend','spend'], ['budget','Budget','budget'], ['proj','Projects','proj'], ['tasks','Tasks','tasks']];
function render(keep = true) {
  const v = $('#view'), st = v.scrollTop;
  const fn = { home:vHome, spend:vSpend, budget:vBudget, proj:ui.projectId ? vProjDetail : vProj, tasks:vTasks, more:vMore }[ui.tab];
  v.innerHTML = fn();
  v.scrollTop = keep ? st : 0;
  $('#tabs').innerHTML = TABS.map(([k, l, ic]) => `<button class="${ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${icon(ic)}<span>${l}</span></button>`).join('');
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400); }

/* ---------- generic form sheet ---------- */
function fieldHTML(f, vals) {
  const v = vals[f.name] ?? (f.type === 'check' ? false : '');
  if (f.type === 'seg') return `<div class="seg">${f.options.map(o => `<label><input type="radio" name="${f.name}" value="${esc(o.v)}" ${String(v) === String(o.v) ? 'checked' : ''}><span>${esc(o.l)}</span></label>`).join('')}</div>`;
  if (f.type === 'select') return `<label class="fld"><span>${esc(f.label)}</span><select name="${f.name}">${f.options.map(o => `<option value="${esc(o.v)}" ${String(v) === String(o.v) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select></label>`;
  if (f.type === 'textarea') return `<label class="fld"><span>${esc(f.label)}</span><textarea name="${f.name}" rows="3">${esc(v)}</textarea></label>`;
  if (f.type === 'check') return `<label class="fld chkrow"><span>${esc(f.label)}</span><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}></label>`;
  if (f.type === 'number') return `<label class="fld"><span>${esc(f.label)}</span><input type="number" name="${f.name}" inputmode="decimal" step="any" min="0" value="${v === '' ? '' : esc(v)}" placeholder="0"></label>`;
  return `<label class="fld"><span>${esc(f.label)}</span><input type="${f.type || 'text'}" name="${f.name}" value="${esc(v)}" ${f.type === 'text' || !f.type ? 'autocapitalize="sentences"' : ''}></label>`;
}
function closeSheet() { const r = $('#sheet-root'); r.classList.remove('open'); setTimeout(() => { if (!r.classList.contains('open')) r.innerHTML = ''; }, 260); }
function openForm({ title, fields, values = {}, onSave, onDelete }) {
  const r = $('#sheet-root');
  r.innerHTML = `<div class="backdrop" data-act="closeSheet"></div><form class="sheet" id="sheetForm" autocomplete="off" novalidate>
    <div class="sheet-head"><button type="button" class="link" data-act="closeSheet">Cancel</button><h3>${esc(title)}</h3><button type="submit" class="link strong">Save</button></div>
    <div class="sheet-body">${fields.map(f => fieldHTML(f, values)).join('')}${onDelete ? '<button type="button" class="btn danger" id="sheetDel">Delete</button>' : ''}</div></form>`;
  requestAnimationFrame(() => r.classList.add('open'));
  const form = $('#sheetForm');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form), out = {};
    for (const f of fields) {
      if (f.type === 'check') out[f.name] = form.elements[f.name].checked;
      else if (f.type === 'number') { const raw = String(fd.get(f.name) ?? '').trim().replace(',', '.'); out[f.name] = raw === '' ? 0 : parseFloat(raw); if (isNaN(out[f.name])) out[f.name] = 0; }
      else out[f.name] = String(fd.get(f.name) ?? '').trim();
    }
    if (onSave(out) !== false) closeSheet();
  });
  if (onDelete) $('#sheetDel').addEventListener('click', () => { if (confirm('Delete this item?')) { onDelete(); closeSheet(); } });
}

/* ---------- form definitions ---------- */
const projOptions = () => [{ v:'', l:'None' }, ...db.projects.map(p => ({ v:p.id, l:p.name }))];

function txForm(id) {
  const t = id && db.tx.find(x => x.id === id);
  const cats = [...db.categories, 'Income']; if (t && !cats.includes(t.category)) cats.push(t.category);
  openForm({ title: t ? 'Edit entry' : 'New entry',
    fields: [
      { name:'type', type:'seg', options:[{ v:'expense', l:'Expense' }, { v:'income', l:'Income' }] },
      { name:'amount', label:'Amount', type:'number' },
      { name:'category', label:'Category', type:'select', options:cats.map(c => ({ v:c, l:c })) },
      { name:'date', label:'Date', type:'date' },
      { name:'note', label:'Note', type:'text' },
      { name:'projectId', label:'Project (optional)', type:'select', options:projOptions() }],
    values: t || { type:'expense', date:today(), category:db.categories[0], projectId:ui.projectId || '' },
    onSave: v => {
      if (!(v.amount > 0)) { toast('Enter an amount'); return false; }
      if (!v.date) v.date = today();
      if (t) Object.assign(t, v); else db.tx.push({ id:uid(), ...v });
      save(); render();
    },
    onDelete: t ? () => { db.tx = db.tx.filter(x => x.id !== id); save(); render(); } : null });
}
function budgetForm(cat) {
  openForm({ title: cat + ' budget', fields:[{ name:'amount', label:'Monthly budget', type:'number' }], values:{ amount: db.budgets[cat] || '' },
    onSave: v => { if (v.amount > 0) db.budgets[cat] = v.amount; else delete db.budgets[cat]; save(); render(); } });
}
function overallForm() {
  openForm({ title:'Overall budget', fields:[{ name:'amount', label:'Monthly budget (0 = use category sum)', type:'number' }], values:{ amount: db.settings.monthlyBudget || '' },
    onSave: v => { db.settings.monthlyBudget = v.amount; save(); render(); } });
}
function projectForm(id) {
  const p = id && db.projects.find(x => x.id === id);
  openForm({ title: p ? 'Edit project' : 'New project',
    fields: [
      { name:'name', label:'Name', type:'text' },
      { name:'budget', label:'Budget', type:'number' },
      { name:'status', label:'Status', type:'select', options:[{ v:'active', l:'Active' }, { v:'hold', l:'On hold' }, { v:'done', l:'Done' }] },
      { name:'notes', label:'Notes', type:'textarea' }],
    values: p || { status:'active' },
    onSave: v => {
      if (!v.name) { toast('Give it a name'); return false; }
      if (p) Object.assign(p, v); else { const np = { id:uid(), ...v, costs:[] }; db.projects.push(np); ui.projectId = np.id; ui.tab = 'proj'; }
      save(); render(false);
    },
    onDelete: p ? () => {
      db.projects = db.projects.filter(x => x.id !== id);
      db.tasks = db.tasks.filter(t => t.projectId !== id);
      db.tx.forEach(t => { if (t.projectId === id) t.projectId = ''; });
      ui.projectId = null; save(); render(false);
    } : null });
}
function costForm(projId, costId) {
  const p = db.projects.find(x => x.id === projId); if (!p) return;
  const c = costId && p.costs.find(x => x.id === costId);
  openForm({ title: c ? 'Edit cost item' : 'New cost item',
    fields: [
      { name:'desc', label:'Description', type:'text' },
      { name:'qty', label:'Quantity', type:'number' },
      { name:'unit', label:'Unit cost', type:'number' },
      { name:'date', label:'Date (optional)', type:'date' },
      { name:'paid', label:'Already paid', type:'check' }],
    values: c || { qty:1, paid:false },
    onSave: v => {
      if (!v.desc) { toast('Add a description'); return false; }
      if (!(v.qty > 0)) v.qty = 1;
      if (c) Object.assign(c, v); else p.costs.push({ id:uid(), ...v });
      save(); render();
    },
    onDelete: c ? () => { p.costs = p.costs.filter(x => x.id !== costId); save(); render(); } : null });
}
function taskForm(id, projId) {
  const t = id && db.tasks.find(x => x.id === id);
  openForm({ title: t ? 'Edit task' : 'New task',
    fields: [
      { name:'title', label:'Task', type:'text' },
      { name:'projectId', label:'Project', type:'select', options:projOptions() },
      { name:'due', label:'Due date', type:'date' },
      { name:'priority', label:'Priority', type:'select', options:[{ v:'high', l:'High' }, { v:'med', l:'Medium' }, { v:'low', l:'Low' }] },
      { name:'notes', label:'Notes', type:'textarea' }],
    values: t || { priority:'med', projectId: projId || '' },
    onSave: v => {
      if (!v.title) { toast('Name the task'); return false; }
      if (t) Object.assign(t, v); else db.tasks.push({ id:uid(), done:false, ...v });
      save(); render();
    },
    onDelete: t ? () => { db.tasks = db.tasks.filter(x => x.id !== id); save(); render(); } : null });
}

/* ---------- backup / export ---------- */
async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files:[file] })) {
    try { await navigator.share({ files:[file], title:name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  return true;
}
async function exportJSON() {
  const ok = await shareOrDownload(new Blob([JSON.stringify(db, null, 2)], { type:'application/json' }), `pocket-ledger-${today()}.json`);
  if (ok) { db.settings.lastBackup = new Date().toLocaleString(); save(); render(); toast('Backup exported'); }
}
async function exportCSV() {
  const q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
  const rows = [['Date', 'Type', 'Amount', 'Category', 'Note', 'Project'].join(',')];
  [...db.tx].sort((a, b) => a.date.localeCompare(b.date)).forEach(t => {
    const p = db.projects.find(x => x.id === t.projectId);
    rows.push([t.date, t.type, t.amount, q(t.category), q(t.note), q(p ? p.name : '')].join(','));
  });
  await shareOrDownload(new Blob([rows.join('\n')], { type:'text/csv' }), `expenses-${today()}.csv`);
}
function importData(text) {
  try {
    const r = JSON.parse(text);
    if (!r || r.v !== 1 || !Array.isArray(r.tx) || !Array.isArray(r.projects) || !Array.isArray(r.tasks)) throw new Error('bad');
    if (!confirm('Replace everything on this phone with the backup?')) return;
    const f = fresh(); db = Object.assign(f, r, { settings:Object.assign(f.settings, r.settings) });
    save(); ui.projectId = null; render(false); toast('Backup restored');
  } catch (e) { toast('That file is not a valid backup'); }
}

/* ---------- actions ---------- */
const actions = {
  tab: d => { ui.tab = d.tab; if (d.tab !== 'proj') ui.projectId = null; render(false); },
  prevMonth: () => { ui.month = shiftMonth(ui.month, -1); render(false); },
  nextMonth: () => { ui.month = shiftMonth(ui.month, 1); render(false); },
  addTx: () => txForm(), editTx: d => txForm(d.id),
  txFilter: d => { ui.txFilter = d.f; render(); },
  setBudget: d => budgetForm(d.cat), editOverall: overallForm,
  addProject: () => projectForm(), editProject: d => projectForm(d.id),
  openProject: d => { ui.projectId = d.id; render(false); },
  backProject: () => { ui.projectId = null; render(false); },
  addCost: d => costForm(d.id), editCost: d => costForm(ui.projectId, d.id),
  addTask: d => taskForm(null, d.id || (ui.tab === 'proj' ? ui.projectId : '')), editTask: d => taskForm(d.id),
  toggleTask: d => { const t = db.tasks.find(x => x.id === d.id); if (t) { t.done = !t.done; save(); render(); } },
  taskFilter: d => { ui.taskFilter = d.f; render(); },
  editCurrency: () => openForm({ title:'Currency', fields:[{ name:'currency', label:'Symbol (e.g. $, €, ฿, Rs)', type:'text' }], values:{ currency:db.settings.currency },
    onSave: v => { db.settings.currency = v.currency || '$'; save(); render(); } }),
  addCat: () => openForm({ title:'New category', fields:[{ name:'name', label:'Name', type:'text' }],
    onSave: v => { if (!v.name) return false; if (db.categories.some(c => c.toLowerCase() === v.name.toLowerCase())) { toast('Already exists'); return false; } db.categories.push(v.name); save(); render(); } }),
  delCat: d => { if (db.categories.length <= 1) return toast('Keep at least one category'); if (confirm(`Remove "${d.cat}"? Existing entries keep their label.`)) { db.categories = db.categories.filter(c => c !== d.cat); delete db.budgets[d.cat]; save(); render(); } },
  exportJSON, exportCSV,
  importJSON: () => $('#impFile').click(),
  reset: () => { if (confirm('Erase ALL data on this phone? This cannot be undone.') && confirm('Really erase everything?')) { db = fresh(); save(); ui.projectId = null; ui.tab = 'home'; render(false); toast('All data erased'); } },
  closeSheet
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el.dataset, el);
});
$('#impFile').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader(); rd.onload = () => importData(String(rd.result)); rd.readAsText(f); e.target.value = '';
});

/* ---------- go ---------- */
render(false);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
