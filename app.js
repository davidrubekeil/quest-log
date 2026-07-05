/* Quest-Log — App-Logik
   3 Ebenen: Quest → Schritt → Unterschritt (Unterschritte rekursiv, aber simpel).
   - Quest: Priorität, Typ (Frist/Laufend), Bereich, Deadline/Start, Fortschritt,
     Kontext (Fokus, nächster Schritt, Milestones, Notizen).
   - Schritt: Typ (Frist/Laufend) bzw. Termin, Kontext (nächster-Schritt-Toggle, Notizen). Keine Priorität.
   - Unterschritt: nur Text + Häkchen; kann rekursiv weiter unterteilt werden.
   Kalender (Monat/Tag) als eigener Reiter. Persistenz: localStorage (questlog-state-v3). */

(() => {
  'use strict';

  const KEYS = ['questlog-state-v3', 'questlog-state-v2', 'questlog-state-v1'];
  const KEY_SAVE = KEYS[0];

  const QUEST_TABS = [
    { key: 'main', label: 'Main' },
    { key: 'side', label: 'Side' },
    { key: 'events', label: 'Events' },
    { key: 'erledigt', label: 'Erledigt' },
  ];
  const EVENT_COLOR = '#7A6E8A';

  const PRIOS = [
    { key: 'hoch',    label: 'Hoch',    color: 'var(--red)' },
    { key: 'mittel',  label: 'Mittel',  color: '#C9A24B' },
    { key: 'niedrig', label: 'Niedrig', color: 'var(--muted)' },
  ];
  const prioOf = k => PRIOS.find(p => p.key === k) || PRIOS[1];

  const SECTIONS = [
    { key: 'studium',   label: 'Studium und Arbeit' },
    { key: 'kreatives', label: 'Kreatives und Sport' },
    { key: 'buero',     label: 'Büro' },
  ];

  const TYPES = [
    { key: 'frist',   label: 'Mit Frist' },
    { key: 'laufend', label: 'Laufend' },
  ];

  /* ---------- Helfer ---------- */

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = s => String(s).replace(/[&<>"']/g,
    m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const pad2 = n => String(n).padStart(2, '0');
  const nowISO = () => new Date().toISOString();
  const dateStr = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayStr = () => dateStr(new Date());
  const yesterdayStr = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dateStr(d); };
  const timeHM = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

  const isDateStr = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const parseDate = ds => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayDiff = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
  const daysUntil = ds => dayDiff(todayStr(), ds);
  const fmtShort = ds => { const [, m, d] = ds.split('-'); return `${d}.${m}.`; };
  const fmtRest = n => n < 0 ? 'überfällig' : n === 0 ? 'heute' : n === 1 ? 'morgen' : `in ${n} Tagen`;

  const addDays = (ds, n) => { const d = parseDate(ds); d.setDate(d.getDate() + n); return dateStr(d); };
  const addMonths = (ds, n) => { const d = parseDate(ds); d.setDate(1); d.setMonth(d.getMonth() + n); return dateStr(d); };
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const WD_FULL = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const wdIndexMon = d => (d.getDay() + 6) % 7;

  /* ---------- Streak (intern) ---------- */

  const freshStreak = () => ({ currentStreak: 0, longestStreak: 0, lastActiveDate: null });
  const sanitizeStreak = s => (!s || typeof s !== 'object') ? freshStreak() : {
    currentStreak: Number.isFinite(s.currentStreak) ? s.currentStreak : 0,
    longestStreak: Number.isFinite(s.longestStreak) ? s.longestStreak : 0,
    lastActiveDate: typeof s.lastActiveDate === 'string' ? s.lastActiveDate : null,
  };
  function touchStreak(s) {
    const today = todayStr();
    if (s.lastActiveDate !== today) {
      s.currentStreak = (s.lastActiveDate === yesterdayStr()) ? s.currentStreak + 1 : 1;
      s.lastActiveDate = today;
    }
    s.longestStreak = Math.max(s.longestStreak, s.currentStreak);
  }
  function auditStreak(s) {
    if (s.currentStreak !== 0 && s.lastActiveDate !== todayStr() && s.lastActiveDate !== yesterdayStr()) { s.currentStreak = 0; return true; }
    return false;
  }
  function auditAllStreaks() { let ch = false; for (const q of state.quests) ch = auditStreak(q.streak) || ch; return ch; }

  /* ---------- Unterschritt (rekursiv, simpel) ---------- */

  const newSub = text => ({ id: uid(), text, done: false, doneAt: null, subs: [], open: false });
  const subDone = s => s.subs.length ? s.subs.every(subDone) : !!s.done;
  const subLeaves = s => s.subs.length
    ? s.subs.reduce((a, c) => { const r = subLeaves(c); return { done: a.done + r.done, total: a.total + r.total }; }, { done: 0, total: 0 })
    : { done: s.done ? 1 : 0, total: 1 };
  function findSubRec(subs, id) { for (const s of subs) { if (s.id === id) return s; const f = findSubRec(s.subs, id); if (f) return f; } return null; }
  function removeSubRec(subs, id) { const i = subs.findIndex(s => s.id === id); if (i >= 0) { subs.splice(i, 1); return true; } for (const s of subs) if (removeSubRec(s.subs, id)) return true; return false; }

  /* ---------- Schritt ---------- */

  const newStep = text => ({ id: uid(), text, type: 'frist', deadline: null, notes: '', done: false, doneAt: null, subs: [], open: false });
  const stepHasSubs = s => s.subs.length > 0;
  const stepDone = s => stepHasSubs(s) ? s.subs.every(subDone) : !!s.done;
  const stepLeaves = s => stepHasSubs(s)
    ? s.subs.reduce((a, c) => { const r = subLeaves(c); return { done: a.done + r.done, total: a.total + r.total }; }, { done: 0, total: 0 })
    : { done: s.done ? 1 : 0, total: 1 };

  function questLeaves(q) { return q.steps.reduce((a, s) => { const r = stepLeaves(s); return { done: a.done + r.done, total: a.total + r.total }; }, { done: 0, total: 0 }); }
  function questPct(q) { const { done, total } = questLeaves(q); return total ? Math.round(done / total * 100) : (q.done ? 100 : 0); }

  const stepEffDeadline = s => (stepDone(s) || s.type === 'laufend') ? null : s.deadline;
  function questEffDeadline(q) {
    if (q.done || q.type === 'laufend') return null;
    let best = q.deadline || null;
    for (const s of q.steps) { const e = stepEffDeadline(s); if (e && (!best || e < best)) best = e; }
    return best;
  }

  const byStepUrgency = (a, b) => { const ae = stepEffDeadline(a), be = stepEffDeadline(b); if (ae && be) return ae < be ? -1 : ae > be ? 1 : 0; if (ae) return -1; if (be) return 1; return 0; };
  const byQuestUrgency = (x, y) => { const xe = questEffDeadline(x), ye = questEffDeadline(y); if (xe && ye) return xe < ye ? -1 : xe > ye ? 1 : 0; if (xe) return -1; if (ye) return 1; return 0; };
  const byDoneAt = (a, b) => (b.doneAt || '').localeCompare(a.doneAt || '');

  const findStep = (q, id) => q.steps.find(s => s.id === id);
  const findNodeAny = (q, id) => { for (const s of q.steps) { if (s.id === id) return s; const sub = findSubRec(s.subs, id); if (sub) return sub; } return null; };
  /* nächster Schritt (kann Schritt oder Unterschritt sein): Anzeige-Label + Eltern-Schritt. */
  function nextInfo(q) {
    if (!q.nextStepId) return null;
    for (const s of q.steps) {
      if (s.id === q.nextStepId) return { label: s.text, stepId: s.id };
      const sub = findSubRec(s.subs, q.nextStepId);
      if (sub) return { label: `${s.text} › ${sub.text}`, stepId: s.id };
    }
    return null;
  }

  function syncQuestDone(q) {
    const { done, total } = questLeaves(q);
    if (total === 0) return;
    if (done === total) { if (!q.done) { q.done = true; q.doneAt = nowISO(); } }
    else { q.done = false; q.doneAt = null; }
  }

  /* erstes erledigtes Blatt wieder öffnen (Reaktivieren aus dem Archiv) */
  function reopenFirstLeaf(q) {
    const inSub = subs => { for (const s of subs) { if (s.subs.length) { if (inSub(s.subs)) return true; } else if (s.done) { s.done = false; s.doneAt = null; return true; } } return false; };
    for (const st of q.steps) {
      if (st.subs.length) { if (inSub(st.subs)) return true; }
      else if (st.done) { st.done = false; st.doneAt = null; return true; }
    }
    return false;
  }

  /* ---------- State, Migration ---------- */

  const emptyState = () => ({ version: 3, lists: [], quests: [], agenda: [], events: [], focusQuestId: null });

  function normalizeItem(raw) {
    if (typeof raw === 'string') return { id: uid(), text: raw, done: false };
    if (!raw || typeof raw !== 'object') return null;
    return { id: raw.id || uid(), text: String(raw.text ?? raw.name ?? ''), done: !!raw.done };
  }

  const kidsOf = n => Array.isArray(n.subs) ? n.subs : (Array.isArray(n.steps) ? n.steps : (Array.isArray(n.items) ? n.items : []));

  function normalizeSub(raw) {
    if (typeof raw === 'string') return newSub(raw);
    if (!raw || typeof raw !== 'object') return null;
    return { id: raw.id || uid(), text: String(raw.text ?? raw.name ?? ''), done: !!raw.done, doneAt: raw.doneAt || null, subs: kidsOf(raw).map(normalizeSub).filter(Boolean), open: !!raw.open };
  }
  function normalizeStep(raw) {
    if (typeof raw === 'string') return newStep(raw);
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: raw.id || uid(), text: String(raw.text ?? raw.name ?? ''),
      type: raw.type === 'laufend' ? 'laufend' : 'frist',
      deadline: isDateStr(raw.deadline) ? raw.deadline : null,
      notes: typeof raw.notes === 'string' ? raw.notes : '',
      done: !!raw.done, doneAt: raw.doneAt || null,
      subs: kidsOf(raw).map(normalizeSub).filter(Boolean),
      open: !!raw.open,
    };
  }
  function normalizeMilestone(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return { id: raw.id || uid(), text: String(raw.text ?? ''), deadline: isDateStr(raw.deadline) ? raw.deadline : null };
  }
  function normalizeAgenda(raw) {
    if (!raw || typeof raw !== 'object' || !isDateStr(raw.date)) return null;
    return { id: raw.id || uid(), text: String(raw.text ?? ''), date: raw.date, done: !!raw.done, doneAt: raw.doneAt || null };
  }
  function normalizeEvent(raw) {
    if (!raw || typeof raw !== 'object' || !isDateStr(raw.start)) return null;
    return { id: raw.id || uid(), name: String(raw.name ?? raw.title ?? ''), start: raw.start, end: isDateStr(raw.end) ? raw.end : null, notes: typeof raw.notes === 'string' ? raw.notes : '' };
  }

  function sanitizeState(raw) {
    const s = emptyState();
    if (!raw || typeof raw !== 'object') return s;

    if (Array.isArray(raw.lists)) {
      s.lists = raw.lists.filter(l => l && typeof l === 'object').map(l => ({
        id: l.id || uid(), name: String(l.name ?? ''), open: !!l.open,
        items: (Array.isArray(l.items) ? l.items : []).map(normalizeItem).filter(Boolean),
      }));
    }

    if (Array.isArray(raw.quests)) {
      s.quests = raw.quests.filter(q => q && typeof q === 'object').map(q => ({
        id: q.id || uid(), title: String(q.title ?? ''),
        category: q.category === 'side' ? 'side' : 'main',
        section: SECTIONS.some(x => x.key === q.section) ? q.section : 'studium',
        type: q.type === 'laufend' ? 'laufend' : 'frist',
        notes: typeof q.notes === 'string' ? q.notes : '',
        done: !!q.done, doneAt: q.doneAt || null,
        priority: PRIOS.some(p => p.key === q.priority) ? q.priority : 'mittel',
        createdAt: isDateStr(q.createdAt) ? q.createdAt : todayStr(),
        start: isDateStr(q.start) ? q.start : null,
        deadline: isDateStr(q.deadline) ? q.deadline : null,
        milestones: (Array.isArray(q.milestones) ? q.milestones : []).map(normalizeMilestone).filter(Boolean),
        nextStepId: typeof q.nextStepId === 'string' ? q.nextStepId : null,
        steps: (Array.isArray(q.steps) ? q.steps : []).map(normalizeStep).filter(Boolean),
        streak: sanitizeStreak(q.streak),
      }));
      for (const q of s.quests) { syncQuestDone(q); if (q.nextStepId && !findNodeAny(q, q.nextStepId)) q.nextStepId = null; }
    }

    if (Array.isArray(raw.agenda)) s.agenda = raw.agenda.map(normalizeAgenda).filter(Boolean);
    if (Array.isArray(raw.events)) s.events = raw.events.map(normalizeEvent).filter(Boolean);
    if (typeof raw.focusQuestId === 'string') s.focusQuestId = raw.focusQuestId;
    return s;
  }

  function loadState() {
    for (const key of KEYS) {
      try { const raw = localStorage.getItem(key); if (raw) return sanitizeState(JSON.parse(raw)); }
      catch (e) { console.warn(`Quest-Log: ${key} unlesbar`, e); }
    }
    return emptyState();
  }
  function save() { try { localStorage.setItem(KEY_SAVE, JSON.stringify(state)); } catch (e) { console.warn('Quest-Log: Speichern fehlgeschlagen', e); } }

  /* ---------- Kalender-Aggregation ---------- */

  function collectEntries() {
    const out = [];
    for (const q of state.quests) {
      if (q.deadline) out.push({ date: q.deadline, kind: 'quest', questId: q.id, text: q.title, done: q.done, checkable: false });
      for (const s of q.steps) {
        if (s.deadline && s.type !== 'laufend') {
          const hasSubs = stepHasSubs(s);
          out.push({ date: s.deadline, kind: hasSubs ? 'branch' : 'step', questId: q.id, stepId: s.id, text: s.text, questTitle: q.title, done: stepDone(s), checkable: !hasSubs });
        }
      }
      for (const m of q.milestones) if (m.deadline) out.push({ date: m.deadline, kind: 'milestone', questId: q.id, text: m.text, questTitle: q.title, done: false, checkable: false });
    }
    for (const a of state.agenda) out.push({ date: a.date, kind: 'agenda', id: a.id, text: a.text, done: a.done, checkable: true });
    return out;
  }
  function entriesByDate() { const map = {}; for (const e of collectEntries()) (map[e.date] || (map[e.date] = [])).push(e); return map; }

  const eventEnd = e => e.end || e.start;
  const eventSpanLabel = e => (e.end && e.end !== e.start) ? `${fmtShort(e.start)}–${fmtShort(e.end)}` : fmtShort(e.start);
  const eventsCovering = ds => state.events.filter(e => e.start <= ds && ds <= eventEnd(e));
  /* Gantt-Lane-Packung: überlappende Events bekommen verschiedene Zeilen, damit ein
     mehrtägiger Balken über die Tage in derselben Zeile durchläuft. */
  function assignLanes(events) {
    const sorted = events.slice().sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
    const laneEnd = [], laneOf = {};
    for (const e of sorted) {
      let placed = false;
      for (let i = 0; i < laneEnd.length; i++) { if (laneEnd[i] < e.start) { laneEnd[i] = eventEnd(e); laneOf[e.id] = i; placed = true; break; } }
      if (!placed) { laneOf[e.id] = laneEnd.length; laneEnd.push(eventEnd(e)); }
    }
    return { laneOf, laneCount: laneEnd.length };
  }

  /* ---------- Rendering ---------- */

  const view = document.getElementById('view');
  const tabbar = document.getElementById('tabbar');

  let state = loadState();
  let activeTab = 'quests';
  let questCat = 'main';
  let activeQuestId = null;
  let activeStepId = null;
  let activeEventId = null;
  let stepTab = 'aktuell';
  let calView = 'monat';
  let calCursor = todayStr();
  let dayStamp = todayStr();
  let refocusSel = null;

  const dotHtml = p => `<span class="prio-dot" style="background:${p.color}" title="Priorität: ${p.label}"></span>`;
  const sectionOptions = sel => SECTIONS.map(s => `<option value="${s.key}"${s.key === sel ? ' selected' : ''}>${esc(s.label)}</option>`).join('');
  const typeOptions = sel => TYPES.map(t => `<option value="${t.key}"${t.key === sel ? ' selected' : ''}>${t.label}</option>`).join('');
  const addMini = (action, ph, extra = '') =>
    `<form class="addmini" data-action="${action}"${extra}><button class="plus" type="submit" aria-label="Hinzufügen">${ICONS.plus}</button><input type="text" placeholder="${ph}" autocomplete="off" enterkeyhint="done"></form>`;

  /* --- Quest-Liste (Spalte 1) --- */

  function timeRow(q) {
    if (!q.deadline) return '';
    const start = q.start || q.createdAt;
    const total = dayDiff(start, q.deadline), gone = dayDiff(start, todayStr());
    const pct = total <= 0 ? 100 : Math.max(0, Math.min(100, Math.round(gone / total * 100)));
    const over = daysUntil(q.deadline) < 0;
    return `<div class="time-row"><span>${fmtShort(start)}</span><div class="track${over ? ' over' : ''}"><div class="fill time-fill" style="width:${pct}%"></div><div class="mark" style="left:${pct}%"></div></div><span>${fmtShort(q.deadline)}</span></div>`;
  }

  function renderQuestMeta(q) {
    const laufend = q.type === 'laufend';
    const p = prioOf(q.priority);
    const { done, total } = questLeaves(q);
    const pct = questPct(q);
    return `<div class="qmeta">
      <div class="meta-row">
        <label class="sel-field">Bereich<select data-sel="section" data-id="${q.id}">${sectionOptions(q.section)}</select></label>
        <label class="sel-field">Typ<select data-sel="type" data-id="${q.id}">${typeOptions(q.type)}</select></label>
        ${laufend ? '' : `<button class="chip prio-btn" data-action="cycle-prio" data-id="${q.id}">${dotHtml(p)}${p.label}</button>`}
      </div>
      ${laufend ? '' : `<div class="meta-row">
        <label class="date-field">Start<input type="date" data-field="start" data-id="${q.id}" value="${q.start || q.createdAt}"></label>
        <label class="date-field">Ende<input type="date" data-field="deadline" data-id="${q.id}" value="${q.deadline || ''}"></label>
      </div>`}
      ${total ? `<div class="progress-row"><span>${done}/${total}</span><div class="track"><div class="fill" style="width:${pct}%"></div></div><span class="pct">${pct}%</span></div>` : ''}
      ${laufend ? '' : timeRow(q)}
    </div>`;
  }

  function renderQuestRow(q, active) {
    const isActive = active && q.id === active.id;
    const isFocus = q.id === state.focusQuestId;
    const laufend = q.type === 'laufend';
    const p = prioOf(q.priority);
    const pct = questPct(q);
    const eff = questEffDeadline(q);
    const du = eff ? daysUntil(eff) : null;
    const hasSteps = questLeaves(q).total > 0;
    const dot = laufend ? 'var(--flow)' : p.color;
    const tail = laufend ? '<span class="flow-badge">laufend</span>' : (du !== null && !q.done ? `<span class="rest${du < 0 ? ' over' : ''}">${fmtRest(du)}</span>` : '');
    return `<div class="qwrap">
      <div class="qrow${isActive ? ' active' : ''}${isFocus ? ' focus' : ''}${q.done ? ' done' : ''}" data-action="open-quest" data-id="${q.id}">
        ${!hasSteps && !laufend
          ? `<button class="checkbox" data-action="toggle-quest" data-id="${q.id}" aria-label="Quest abhaken">${ICONS.check}</button>`
          : `<span class="qdot" style="background:${dot}"></span>`}
        <span class="qname${isActive ? ' editable' : ''}"${isActive ? ` data-edit="quest-title" data-id="${q.id}"` : ''}>${esc(q.title)}</span>
        ${isFocus ? '<span class="focus-tag">Fokus</span>' : ''}
        <span class="qpct">${pct}%</span>
        ${tail}
        <button class="del" data-action="del-quest" data-id="${q.id}" aria-label="Quest löschen">${ICONS.x}</button>
      </div>
      ${isActive ? renderQuestMeta(q) : ''}
    </div>`;
  }

  function renderSection(sec, quests, active) {
    const isActiveHere = active && quests.some(q => q.id === active.id);
    const frist = quests.filter(q => q.type !== 'laufend').sort(byQuestUrgency);
    const laufend = quests.filter(q => q.type === 'laufend');
    let body;
    if (frist.length && laufend.length) {
      body = `<div class="group-label">Mit Deadline</div>${frist.map(q => renderQuestRow(q, active)).join('')}<div class="group-label">Laufend</div>${laufend.map(q => renderQuestRow(q, active)).join('')}`;
    } else {
      const all = frist.concat(laufend);
      body = all.length ? all.map(q => renderQuestRow(q, active)).join('') : '';
    }
    return `<section class="board-section${isActiveHere ? ' has-active' : ''}">
      <div class="section-title">${esc(sec.label)}</div>
      ${body}
      ${addMini('add-quest', 'Neue Quest', ` data-section="${sec.key}"`)}
    </section>`;
  }

  /* --- Schritte (Spalte 2) --- */

  function nextBtn(questId, id, isNext) {
    return `<button class="next-btn${isNext ? ' on' : ''}" data-action="toggle-next" data-quest="${questId}" data-id="${id}" aria-label="Als nächsten Schritt" title="Als nächsten Schritt">→</button>`;
  }

  function renderSub(sub, questId, stepId, nextId) {
    const hasKids = sub.subs.length > 0;
    const done = subDone(sub);
    const isNext = sub.id === nextId;
    const hasNextInside = nextId && !isNext && !!findSubRec(sub.subs, nextId);
    const { done: sd, total: st } = subLeaves(sub);
    const control = hasKids
      ? `<span class="branch-mark${done ? ' full' : ''}">${sd}/${st}</span>`
      : `<button class="checkbox" data-action="toggle-sub" data-quest="${questId}" data-step="${stepId}" data-id="${sub.id}" aria-label="Abhaken">${ICONS.check}</button>`;
    return `<li class="node sub${done ? ' done' : ''}${isNext ? ' next' : ''}${hasNextInside ? ' has-next' : ''}${sub.open ? ' open' : ''}">
      <div class="node-row">
        <button class="chev" data-action="toggle-sub-open" data-quest="${questId}" data-step="${stepId}" data-id="${sub.id}" aria-label="Auf-/Zuklappen">${ICONS.chevron}</button>
        ${control}
        <span class="row-text editable" data-edit="sub-text" data-quest="${questId}" data-step="${stepId}" data-id="${sub.id}">${esc(sub.text)}</span>
        ${nextBtn(questId, sub.id, isNext)}
        <button class="del" data-action="del-sub" data-quest="${questId}" data-step="${stepId}" data-id="${sub.id}" aria-label="Löschen">${ICONS.x}</button>
      </div>
      ${sub.open ? `<ul class="subtree">
        ${sub.subs.map(k => renderSub(k, questId, stepId, nextId)).join('')}
        <li class="add-sub">${addMini('add-sub', 'Unterschritt', ` data-quest="${questId}" data-step="${stepId}" data-parent="${sub.id}"`)}</li>
      </ul>` : ''}
    </li>`;
  }

  function renderStep(s, questId, nextId) {
    const hasSubs = stepHasSubs(s);
    const done = stepDone(s);
    const sel = s.id === activeStepId;
    const isNext = s.id === nextId;
    const hasNextInside = nextId && !isNext && !!findSubRec(s.subs, nextId);
    const { done: sd, total: st } = stepLeaves(s);
    const eff = stepEffDeadline(s);
    const du = eff ? daysUntil(eff) : null;
    const control = hasSubs
      ? `<span class="branch-mark${done ? ' full' : ''}">${sd}/${st}</span>`
      : `<button class="checkbox" data-action="toggle-step" data-quest="${questId}" data-id="${s.id}" aria-label="Abhaken">${ICONS.check}</button>`;
    const tail = s.type === 'laufend' ? '<span class="flow-badge">laufend</span>' : (du !== null ? `<span class="rest${du < 0 ? ' over' : ''}">${fmtRest(du)}</span>` : '');
    return `<li class="node step${done ? ' done' : ''}${sel ? ' sel' : ''}${isNext ? ' next' : ''}${hasNextInside ? ' has-next' : ''}${s.open ? ' open' : ''}">
      <div class="node-row" data-action="select-step" data-quest="${questId}" data-id="${s.id}">
        <button class="chev" data-action="toggle-step-open" data-quest="${questId}" data-id="${s.id}" aria-label="Auf-/Zuklappen">${ICONS.chevron}</button>
        ${control}
        <span class="row-text${sel ? ' editable' : ''}"${sel ? ` data-edit="step-text" data-quest="${questId}" data-id="${s.id}"` : ''}>${esc(s.text)}</span>
        ${tail}
        ${nextBtn(questId, s.id, isNext)}
        <button class="del" data-action="del-step" data-quest="${questId}" data-id="${s.id}" aria-label="Löschen">${ICONS.x}</button>
      </div>
      ${s.open ? `<ul class="subtree">
        ${s.subs.map(sub => renderSub(sub, questId, s.id, nextId)).join('')}
        <li class="add-sub">${addMini('add-sub', 'Unterschritt', ` data-quest="${questId}" data-step="${s.id}"`)}</li>
      </ul>` : ''}
    </li>`;
  }

  function renderStepsCol(q) {
    const active = q.steps.filter(s => !stepDone(s));
    const done = q.steps.filter(s => stepDone(s));
    const list = stepTab === 'erledigt' ? done.slice().sort(byDoneAt) : active.slice().sort(byStepUrgency);
    const body = list.length ? list.map(s => renderStep(s, q.id, q.nextStepId)).join('')
      : `<div class="empty">${stepTab === 'erledigt' ? '— nichts erledigt —' : '— keine Schritte —'}</div>`;
    return `<div class="col-steps">
      <div class="step-tabs">
        <button data-action="step-tab" data-tab="aktuell" class="${stepTab === 'aktuell' ? 'active' : ''}">Schritte<span class="seg-count">${active.length}</span></button>
        <button data-action="step-tab" data-tab="erledigt" class="${stepTab === 'erledigt' ? 'active' : ''}">Erledigt<span class="seg-count">${done.length}</span></button>
      </div>
      <ul class="tree">${body}</ul>
      ${stepTab === 'aktuell' ? addMini('add-step', 'Neuer Schritt', ` data-quest="${q.id}"`) : ''}
    </div>`;
  }

  /* --- Kontext (Spalte 3) --- */

  function renderMs(m, questId) {
    return `<li class="ms-row">
      <span class="cdot" style="background:#C9A24B"></span>
      <span class="row-text editable" data-edit="ms-text" data-quest="${questId}" data-id="${m.id}">${esc(m.text)}</span>
      <input type="date" class="ms-date" data-field="ms-deadline" data-quest="${questId}" data-id="${m.id}" value="${m.deadline || ''}" aria-label="Deadline">
      <button class="del" data-action="del-ms" data-quest="${questId}" data-id="${m.id}" aria-label="Löschen">${ICONS.x}</button>
    </li>`;
  }

  function renderContextCol(q) {
    const step = activeStepId ? findStep(q, activeStepId) : null;
    if (step) {
      const laufend = step.type === 'laufend';
      const isNext = q.nextStepId === step.id;
      return `<div class="col-notes">
        <div class="col-head">Kontext · Schritt<button class="ctx-up" data-action="deselect-step">↑ Quest</button></div>
        <div class="ctx-title">${esc(step.text)}</div>
        <div class="meta-row">
          <label class="sel-field">Typ<select data-sel="step-type" data-quest="${q.id}" data-id="${step.id}">${typeOptions(step.type)}</select></label>
          ${laufend ? '' : `<label class="date-field">Termin<input type="date" data-field="step-deadline" data-quest="${q.id}" data-id="${step.id}" value="${step.deadline || ''}"></label>`}
        </div>
        <button class="ctx-toggle${isNext ? ' on' : ''}" data-action="toggle-next" data-quest="${q.id}" data-id="${step.id}">${isNext ? '✓ Nächster Schritt' : 'Als nächsten Schritt'}</button>
        <div class="ctx-label">Notizen</div>
        <textarea class="notes" data-step-notes data-quest="${q.id}" data-id="${step.id}" placeholder="Notizen zum Schritt …">${esc(step.notes)}</textarea>
      </div>`;
    }
    const isFocus = q.id === state.focusQuestId;
    const ni = nextInfo(q);
    return `<div class="col-notes">
      <div class="col-head">Kontext · Quest</div>
      <button class="ctx-toggle${isFocus ? ' on' : ''}" data-action="toggle-focus" data-id="${q.id}">${isFocus ? '✓ Fokus aktiv' : 'Als Fokus setzen'}</button>
      <div class="ctx-block">
        <div class="ctx-label">Nächster Schritt</div>
        ${ni ? `<button class="next-link" data-action="select-step" data-quest="${q.id}" data-id="${ni.stepId}">→ ${esc(ni.label)}</button>` : '<span class="ctx-empty">— in der Schritte-Spalte mit → wählen —</span>'}
      </div>
      <div class="ctx-block">
        <div class="ctx-label">Milestones</div>
        <ul class="ms-list">${q.milestones.map(m => renderMs(m, q.id)).join('')}</ul>
        ${addMini('add-ms', 'Milestone', ` data-quest="${q.id}"`)}
      </div>
      <div class="ctx-block">
        <div class="ctx-label">Notizen</div>
        <textarea class="notes" data-notes data-id="${q.id}" placeholder="Notizen zur Quest …">${esc(q.notes)}</textarea>
      </div>
    </div>`;
  }

  /* --- Archiv (Erledigt-Reiter) --- */

  function renderArchSub(sub) {
    return `<li class="arch-sub${subDone(sub) ? ' done' : ''}">${esc(sub.text)}${sub.subs.length ? `<ul>${sub.subs.map(renderArchSub).join('')}</ul>` : ''}</li>`;
  }
  function renderArchQuest(q) {
    const info = q.deadline ? `Deadline ${fmtShort(q.deadline)}` : (q.type === 'laufend' ? 'laufend' : '');
    return `<div class="arch-quest">
      <div class="arch-head"><span class="arch-title">${esc(q.title)}</span><span class="arch-info">${info} · 100%</span>
        <button class="arch-reopen" data-action="reactivate-quest" data-id="${q.id}">reaktivieren</button></div>
      ${q.steps.length ? `<ul class="arch-steps">${q.steps.map(s => `<li>${esc(s.text)}${s.subs.length ? `<ul>${s.subs.map(renderArchSub).join('')}</ul>` : ''}</li>`).join('')}</ul>` : ''}
    </div>`;
  }
  function renderArchive() {
    const done = state.quests.filter(q => q.done);
    let html = '';
    for (const cat of [{ key: 'main', label: 'Main' }, { key: 'side', label: 'Side' }]) {
      const catQs = done.filter(q => q.category === cat.key);
      if (!catQs.length) continue;
      html += `<div class="arch-cat">${cat.label}</div>`;
      for (const sec of SECTIONS) {
        const qs = catQs.filter(q => q.section === sec.key);
        if (!qs.length) continue;
        html += `<div class="arch-sec">${esc(sec.label)}</div>${qs.map(renderArchQuest).join('')}`;
      }
    }
    return `<div class="archive">${html || '<div class="empty">— noch nichts erledigt —</div>'}</div>`;
  }

  /* --- Events (zweispaltig: Liste + Kontext) --- */

  function renderEventRow(e, active) {
    const isActive = active && e.id === active.id;
    return `<div class="evrow${isActive ? ' active' : ''}" data-action="open-event" data-id="${e.id}">
      <span class="ev-dot" style="background:${EVENT_COLOR}"></span>
      <span class="ev-date">${eventSpanLabel(e)}</span>
      <span class="ev-name${isActive ? ' editable' : ''}"${isActive ? ` data-edit="ev-name" data-id="${e.id}"` : ''}>${esc(e.name)}</span>
      <button class="del" data-action="del-event" data-id="${e.id}" aria-label="Event löschen">${ICONS.x}</button>
    </div>`;
  }

  function renderEventContext(e) {
    return `<div class="col-notes">
      <div class="col-head">Event</div>
      <div class="ctx-title">${esc(e.name)}</div>
      <div class="meta-row">
        <label class="date-field">Von<input type="date" data-field="ev-start" data-id="${e.id}" value="${e.start}"></label>
        <label class="date-field">Bis<input type="date" data-field="ev-end" data-id="${e.id}" value="${e.end || ''}"></label>
      </div>
      <div class="ctx-label">Notizen</div>
      <textarea class="notes" data-ev-notes data-id="${e.id}" placeholder="Notizen zum Event …">${esc(e.notes)}</textarea>
    </div>`;
  }

  function renderEvents() {
    const events = state.events.slice().sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
    const active = activeEventId ? events.find(e => e.id === activeEventId) : null;
    const list = events.length ? events.map(e => renderEventRow(e, active)).join('') : '<div class="empty">— keine Events —</div>';
    return `<div class="ev-board${active ? ' detail has-active' : ''}">
      <div class="ev-list">${active ? '<button class="back" data-action="close-event">← Übersicht</button>' : ''}${list}${addMini('add-event', 'Neues Event')}</div>
      ${active ? renderEventContext(active) : ''}
    </div>`;
  }

  function renderQuests() {
    const counts = {
      main: state.quests.filter(q => q.category === 'main' && !q.done).length,
      side: state.quests.filter(q => q.category === 'side' && !q.done).length,
      events: state.events.length,
      erledigt: state.quests.filter(q => q.done).length,
    };
    const tabs = QUEST_TABS.map(c => `<button data-action="quest-cat" data-cat="${c.key}" class="${questCat === c.key ? 'active' : ''}">${c.label}<span class="seg-count">${counts[c.key]}</span></button>`).join('');
    const head = `<div class="board-title">Questlog</div><div class="seg">${tabs}</div>`;

    if (questCat === 'events') return head + renderEvents();
    if (questCat === 'erledigt') return head + renderArchive();

    const inTab = state.quests.filter(q => q.category === questCat && !q.done);
    const active = activeQuestId ? inTab.find(q => q.id === activeQuestId) : null;
    const sections = SECTIONS.map(sec => renderSection(sec, inTab.filter(q => q.section === sec.key), active)).join('');
    return head + `<div class="board${active ? ' detail has-active' : ''}">
      <div class="col-list">${active ? '<button class="back" data-action="close-quest">← Übersicht</button>' : ''}${sections}</div>
      ${active ? renderStepsCol(active) + renderContextCol(active) : ''}
    </div>`;
  }

  /* --- Kalender --- */

  const DOT = { quest: 'var(--red)', branch: 'var(--muted)', step: 'var(--blue)', agenda: 'var(--flow)', milestone: '#C9A24B' };

  function renderMonth(byDate) {
    const c = parseDate(calCursor);
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    const gridStart = addDays(dateStr(first), -wdIndexMon(first));
    const gridEnd = addDays(gridStart, 41);
    const weekdays = WD_SHORT.map(w => `<div class="cal-weekday">${w}</div>`).join('');

    const monthEvents = state.events.filter(e => eventEnd(e) >= gridStart && e.start <= gridEnd);
    const { laneOf, laneCount } = assignLanes(monthEvents);
    const lanesShown = Math.min(3, laneCount);

    let cells = '';
    for (let i = 0; i < 42; i++) {
      const ds = addDays(gridStart, i);
      const d = parseDate(ds);
      const cover = eventsCovering(ds);
      let bars = '';
      for (let lane = 0; lane < lanesShown; lane++) {
        const e = cover.find(x => laneOf[x.id] === lane);
        if (e) {
          const showName = ds === e.start || wdIndexMon(d) === 0;
          bars += `<div class="cal-bar${ds === e.start ? ' bar-start' : ''}${ds === eventEnd(e) ? ' bar-end' : ''}" data-action="open-event-cal" data-id="${e.id}" title="${esc(e.name)}">${showName ? esc(e.name) : ''}</div>`;
        } else bars += '<div class="cal-bar empty"></div>';
      }
      const items = byDate[ds] || [];
      const chips = items.slice(0, 2).map(e => `<div class="cal-chip${e.done ? ' done' : ''}"><span class="cdot" style="background:${DOT[e.kind]}"></span>${esc(e.text)}</div>`).join('');
      const more = items.length > 2 ? `<div class="cal-more">+${items.length - 2} mehr</div>` : '';
      cells += `<div class="cal-cell${d.getMonth() === c.getMonth() ? '' : ' other'}${ds === todayStr() ? ' today' : ''}" data-action="cal-day" data-date="${ds}"><span class="cal-daynum">${d.getDate()}</span>${bars}${chips}${more}</div>`;
    }
    return `<div class="cal-grid">${weekdays}${cells}</div>`;
  }

  function calEntryRow(e) {
    if (e.kind === 'step') return `<li class="row${e.done ? ' done' : ''}"><button class="checkbox" data-action="toggle-step" data-quest="${e.questId}" data-id="${e.stepId}" aria-label="Abhaken">${ICONS.check}</button><span class="row-text">${esc(e.text)}</span><button class="cal-ctx" data-action="open-quest-from-cal" data-id="${e.questId}">${esc(e.questTitle)}</button></li>`;
    if (e.kind === 'agenda') return `<li class="row${e.done ? ' done' : ''}"><button class="checkbox" data-action="toggle-agenda" data-id="${e.id}" aria-label="Abhaken">${ICONS.check}</button><span class="row-text">${esc(e.text)}</span><button class="del" data-action="del-agenda" data-id="${e.id}" aria-label="Löschen">${ICONS.x}</button></li>`;
    const tag = e.kind === 'quest' ? 'Quest-Frist' : e.kind === 'milestone' ? 'Milestone' : 'Frist';
    return `<li class="row marker"><span class="cdot" style="background:${DOT[e.kind]}"></span><button class="marker-link" data-action="open-quest-from-cal" data-id="${e.questId}">${esc(e.text)}${e.kind !== 'quest' ? ` · ${esc(e.questTitle)}` : ''}</button><span class="marker-tag">${tag}</span></li>`;
  }

  function renderDay(byDate) {
    const items = byDate[calCursor] || [];
    const markers = items.filter(e => !e.checkable);
    const steps = items.filter(e => e.kind === 'step');
    const tasks = items.filter(e => e.kind === 'agenda');
    const d = parseDate(calCursor);
    const evCover = eventsCovering(calCursor);
    const group = (label, arr) => arr.length ? `<div class="day-group"><div class="day-group-label">${label}</div><ul class="items">${arr.map(calEntryRow).join('')}</ul></div>` : '';
    const evGroup = evCover.length ? `<div class="day-group"><div class="day-group-label">Events</div><ul class="items">${evCover.map(e => `<li class="row marker"><span class="cdot" style="background:${EVENT_COLOR}"></span><button class="marker-link" data-action="open-event-cal" data-id="${e.id}">${esc(e.name)}</button><span class="marker-tag">${eventSpanLabel(e)}</span></li>`).join('')}</ul></div>` : '';
    const body = (evCover.length || markers.length || steps.length || tasks.length) ? evGroup + group('Fristen', markers) + group('Schritte', steps) + group('Aufgaben', tasks) : '<div class="empty">— nichts an diesem Tag —</div>';
    return `<div class="day-view"><div class="day-head"><span class="day-title">${WD_FULL[wdIndexMon(d)]}, ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}</span></div>${body}
      <form class="add-row add-agenda" data-action="add-agenda" data-date="${calCursor}"><input type="text" placeholder="Aufgabe für diesen Tag …" autocomplete="off" enterkeyhint="done"><button type="submit" aria-label="Hinzufügen">${ICONS.plus}</button></form></div>`;
  }

  function renderCalendar() {
    const byDate = entriesByDate();
    const cd = parseDate(calCursor);
    const views = [['monat', 'Monat'], ['tag', 'Tag']].map(([k, l]) => `<button data-action="cal-view" data-view="${k}" class="${calView === k ? 'active' : ''}">${l}</button>`).join('');
    return `<div class="cal-toolbar"><div class="cal-views">${views}</div><span class="cal-period">${MONTHS[cd.getMonth()]} ${cd.getFullYear()}</span>
      <div class="cal-nav"><button data-action="cal-prev" aria-label="Zurück">‹</button><button class="cal-today" data-action="cal-today">Heute</button><button data-action="cal-next" aria-label="Vor">›</button></div></div>
      ${calView === 'monat' ? renderMonth(byDate) : renderDay(byDate)}`;
  }

  /* --- Listen --- */

  function renderLists() {
    const blocks = state.lists.map(l => {
      const doneCount = l.items.filter(i => i.done).length;
      return `<section class="block${l.open ? ' open' : ''}">
        <header class="block-head list-head" data-action="toggle-list" data-id="${l.id}"><span class="chev">${ICONS.chevron}</span><h2 class="editable" data-edit="list-name" data-id="${l.id}">${esc(l.name)}</h2><span class="count">${doneCount}/${l.items.length}</span><button class="del" data-action="del-list" data-id="${l.id}" aria-label="Liste löschen">${ICONS.x}</button></header>
        ${l.open ? `${l.items.length ? `<ul class="items">${l.items.map(i => `<li class="row${i.done ? ' done' : ''}"><button class="checkbox" data-action="toggle-item" data-list="${l.id}" data-id="${i.id}" aria-label="Abhaken">${ICONS.check}</button><span class="row-text editable" data-edit="item-text" data-list="${l.id}" data-id="${i.id}">${esc(i.text)}</span><button class="del" data-action="del-item" data-list="${l.id}" data-id="${i.id}" aria-label="Löschen">${ICONS.x}</button></li>`).join('')}</ul>` : '<div class="empty">— leer —</div>'}
          <form class="add-row" data-action="add-item" data-list="${l.id}"><input type="text" placeholder="Neuer Eintrag …" autocomplete="off" enterkeyhint="done"><button type="submit" aria-label="Hinzufügen">${ICONS.plus}</button></form>` : ''}
      </section>`;
    }).join('');
    return `${blocks}<form class="add-row add-block" data-action="add-list"><input type="text" placeholder="Neue Liste …" autocomplete="off" enterkeyhint="done"><button type="submit" aria-label="Liste anlegen">${ICONS.plus}</button></form>`;
  }

  function render() {
    if (editing) return;
    for (const btn of tabbar.querySelectorAll('.tab')) btn.classList.toggle('active', btn.dataset.tab === activeTab);
    view.innerHTML = activeTab === 'calendar' ? renderCalendar() : activeTab === 'quests' ? renderQuests() : renderLists();
    if (refocusSel) { const el = view.querySelector(refocusSel); if (el) el.focus(); refocusSel = null; }
  }

  /* ---------- Inline-Umbenennen ---------- */

  let editing = null;
  function startEdit(el) {
    if (editing) return;
    editing = el;
    el.setAttribute('contenteditable', 'plaintext-only'); el.classList.add('editing'); el.focus();
    const r = document.createRange(); r.selectNodeContents(el);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }
  function applyEdit(ds, val) {
    switch (ds.edit) {
      case 'quest-title': { const q = state.quests.find(q => q.id === ds.id); if (q) q.title = val; break; }
      case 'step-text': { const q = state.quests.find(q => q.id === ds.quest); const s = q && findStep(q, ds.id); if (s) s.text = val; break; }
      case 'sub-text': { const q = state.quests.find(q => q.id === ds.quest); const s = q && findStep(q, ds.step); const sub = s && findSubRec(s.subs, ds.id); if (sub) sub.text = val; break; }
      case 'ms-text': { const q = state.quests.find(q => q.id === ds.quest); const m = q && q.milestones.find(m => m.id === ds.id); if (m) m.text = val; break; }
      case 'ev-name': { const ev = state.events.find(x => x.id === ds.id); if (ev) ev.name = val; break; }
      case 'list-name': { const l = state.lists.find(l => l.id === ds.id); if (l) l.name = val; break; }
      case 'item-text': { const l = state.lists.find(l => l.id === ds.list); const i = l && l.items.find(i => i.id === ds.id); if (i) i.text = val; break; }
    }
  }
  function commitEdit(cancel) {
    if (!editing) return;
    const el = editing; editing = null;
    el.removeAttribute('contenteditable'); el.classList.remove('editing');
    const val = el.textContent.trim();
    if (!cancel && val) applyEdit({ ...el.dataset }, val);
    save(); render();
  }
  view.addEventListener('dblclick', e => { const el = e.target.closest('.editable'); if (el) startEdit(el); });
  view.addEventListener('keydown', e => { if (!editing) return; if (e.key === 'Enter') { e.preventDefault(); commitEdit(false); } else if (e.key === 'Escape') { e.preventDefault(); commitEdit(true); } });
  view.addEventListener('focusout', e => { if (editing && e.target === editing) commitEdit(false); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !editing) { if (activeStepId) { activeStepId = null; render(); } else if (activeQuestId) { activeQuestId = null; render(); } else if (activeEventId) { activeEventId = null; render(); } }
  });

  /* ---------- Notizen (ohne Re-Render) ---------- */

  view.addEventListener('input', e => {
    const ta = e.target.closest('textarea[data-notes], textarea[data-step-notes], textarea[data-ev-notes]');
    if (!ta) return;
    if (ta.hasAttribute('data-ev-notes')) { const ev = state.events.find(x => x.id === ta.dataset.id); if (ev) { ev.notes = ta.value; save(); } }
    else if (ta.hasAttribute('data-step-notes')) { const q = state.quests.find(q => q.id === ta.dataset.quest); const s = q && findStep(q, ta.dataset.id); if (s) { s.notes = ta.value; save(); } }
    else { const q = state.quests.find(q => q.id === ta.dataset.id); if (q) { q.notes = ta.value; save(); } }
  });

  /* ---------- Klick-Aktionen ---------- */

  view.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || !view.contains(el) || el.tagName === 'FORM') return;
    if (el.closest('.editable')) return;
    const { action, id, list: listId, quest: questId, step: stepId } = el.dataset;

    switch (action) {
      case 'quest-cat': questCat = el.dataset.cat; activeQuestId = null; activeStepId = null; if (questCat !== 'events') activeEventId = null; break;

      case 'open-event': if (id !== activeEventId) activeEventId = id; else return; break;
      case 'close-event': activeEventId = null; break;
      case 'del-event': { const ev = state.events.find(x => x.id === id); if (!ev || !confirm(`Event „${ev.name}" löschen?`)) return; state.events = state.events.filter(x => x.id !== id); if (id === activeEventId) activeEventId = null; break; }
      case 'open-event-cal': activeTab = 'quests'; questCat = 'events'; activeEventId = id; activeQuestId = null; activeStepId = null; break;

      case 'open-quest': if (id !== activeQuestId) { activeQuestId = id; activeStepId = null; stepTab = 'aktuell'; } else return; break;
      case 'close-quest': activeQuestId = null; activeStepId = null; break;

      case 'toggle-quest': { const q = state.quests.find(q => q.id === id); if (!q || q.steps.length) return; q.done = !q.done; q.doneAt = q.done ? nowISO() : null; if (q.done) { touchStreak(q.streak); if (id === activeQuestId) activeQuestId = null; } break; }
      case 'del-quest': { const q = state.quests.find(q => q.id === id); if (!q || !confirm(`Quest „${q.title}" löschen?`)) return; state.quests = state.quests.filter(x => x.id !== id); if (id === state.focusQuestId) state.focusQuestId = null; if (id === activeQuestId) { activeQuestId = null; activeStepId = null; } break; }
      case 'reactivate-quest': { const q = state.quests.find(q => q.id === id); if (!q) return; if (q.steps.length) reopenFirstLeaf(q); else { q.done = false; q.doneAt = null; } syncQuestDone(q); break; }
      case 'cycle-prio': { const q = state.quests.find(q => q.id === id); if (!q) return; const i = PRIOS.findIndex(p => p.key === q.priority); q.priority = PRIOS[(i + 1) % PRIOS.length].key; break; }
      case 'toggle-focus': state.focusQuestId = state.focusQuestId === id ? null : id; break;

      case 'step-tab': stepTab = el.dataset.tab === 'erledigt' ? 'erledigt' : 'aktuell'; break;
      case 'select-step': { if (id === activeStepId) return; activeStepId = id; const q = state.quests.find(q => q.id === questId); const s = q && findStep(q, id); if (s) s.open = true; break; }
      case 'deselect-step': activeStepId = null; break;
      case 'toggle-step-open': { const q = state.quests.find(q => q.id === questId); const s = q && findStep(q, id); if (s) s.open = !s.open; break; }
      case 'toggle-next': { const q = state.quests.find(q => q.id === questId); if (!q) return; q.nextStepId = q.nextStepId === id ? null : id; break; }

      case 'toggle-step': { const q = state.quests.find(q => q.id === questId); const s = q && findStep(q, id); if (!s || stepHasSubs(s)) return; s.done = !s.done; s.doneAt = s.done ? nowISO() : null; if (s.done) touchStreak(q.streak); syncQuestDone(q); if (q.done && q.id === activeQuestId) { activeQuestId = null; activeStepId = null; } break; }
      case 'del-step': { const q = state.quests.find(q => q.id === questId); if (!q) return; q.steps = q.steps.filter(s => s.id !== id); if (id === activeStepId) activeStepId = null; if (id === q.nextStepId) q.nextStepId = null; syncQuestDone(q); break; }
      case 'toggle-sub-open': { const q = state.quests.find(q => q.id === questId); const s = q && findStep(q, stepId); const sub = s && findSubRec(s.subs, id); if (sub) sub.open = !sub.open; break; }
      case 'toggle-sub': { const q = state.quests.find(q => q.id === questId); const s = q && findStep(q, stepId); const sub = s && findSubRec(s.subs, id); if (!sub || sub.subs.length) return; sub.done = !sub.done; sub.doneAt = sub.done ? nowISO() : null; if (sub.done) touchStreak(q.streak); syncQuestDone(q); if (q.done && q.id === activeQuestId) { activeQuestId = null; activeStepId = null; } break; }
      case 'del-sub': { const q = state.quests.find(q => q.id === questId); const s = q && findStep(q, stepId); if (!s) return; removeSubRec(s.subs, id); syncQuestDone(q); break; }

      case 'del-ms': { const q = state.quests.find(q => q.id === questId); if (q) q.milestones = q.milestones.filter(m => m.id !== id); break; }

      case 'cal-view': calView = el.dataset.view === 'tag' ? 'tag' : 'monat'; break;
      case 'cal-prev': calCursor = calView === 'monat' ? addMonths(calCursor, -1) : addDays(calCursor, -1); break;
      case 'cal-next': calCursor = calView === 'monat' ? addMonths(calCursor, 1) : addDays(calCursor, 1); break;
      case 'cal-today': calCursor = todayStr(); break;
      case 'cal-day': calCursor = el.dataset.date; calView = 'tag'; break;
      case 'open-quest-from-cal': { const q = state.quests.find(q => q.id === id); if (!q) return; activeTab = 'quests'; questCat = q.done ? 'erledigt' : q.category; activeQuestId = q.done ? null : q.id; activeStepId = null; stepTab = 'aktuell'; break; }
      case 'toggle-agenda': { const a = state.agenda.find(a => a.id === id); if (!a) return; a.done = !a.done; a.doneAt = a.done ? nowISO() : null; break; }
      case 'del-agenda': state.agenda = state.agenda.filter(a => a.id !== id); break;

      case 'toggle-list': { const l = state.lists.find(l => l.id === id); if (l) l.open = !l.open; break; }
      case 'del-list': { const l = state.lists.find(l => l.id === id); if (!l || !confirm(`Liste „${l.name}" löschen?`)) return; state.lists = state.lists.filter(x => x.id !== id); break; }
      case 'toggle-item': { const l = state.lists.find(l => l.id === listId); const i = l && l.items.find(i => i.id === id); if (i) i.done = !i.done; break; }
      case 'del-item': { const l = state.lists.find(l => l.id === listId); if (l) l.items = l.items.filter(i => i.id !== id); break; }

      default: return;
    }
    save(); render();
  });

  /* ---------- Feldänderungen ---------- */

  view.addEventListener('change', e => {
    const sel = e.target.closest('select[data-sel]');
    if (sel) {
      if (sel.dataset.sel === 'section' || sel.dataset.sel === 'type') { const q = state.quests.find(q => q.id === sel.dataset.id); if (q) { if (sel.dataset.sel === 'section') q.section = sel.value; else q.type = sel.value === 'laufend' ? 'laufend' : 'frist'; } }
      else if (sel.dataset.sel === 'step-type') { const q = state.quests.find(q => q.id === sel.dataset.quest); const s = q && findStep(q, sel.dataset.id); if (s) s.type = sel.value === 'laufend' ? 'laufend' : 'frist'; }
      save(); render(); return;
    }
    const input = e.target.closest('input[type="date"][data-field]');
    if (!input) return;
    const f = input.dataset.field, v = isDateStr(input.value) ? input.value : null;
    if (f === 'start' || f === 'deadline') { const q = state.quests.find(q => q.id === input.dataset.id); if (!q) return; if (f === 'start') q.start = v; else q.deadline = v; }
    else if (f === 'step-deadline') { const q = state.quests.find(q => q.id === input.dataset.quest); const s = q && findStep(q, input.dataset.id); if (s) s.deadline = v; }
    else if (f === 'ms-deadline') { const q = state.quests.find(q => q.id === input.dataset.quest); const m = q && q.milestones.find(m => m.id === input.dataset.id); if (m) m.deadline = v; }
    else if (f === 'ev-start') { const ev = state.events.find(x => x.id === input.dataset.id); if (ev && v) { ev.start = v; if (ev.end && ev.end < ev.start) ev.end = null; } }
    else if (f === 'ev-end') { const ev = state.events.find(x => x.id === input.dataset.id); if (ev) ev.end = (v && v >= ev.start) ? v : null; }
    save(); render();
  });

  /* ---------- Formulare ---------- */

  view.addEventListener('submit', e => {
    const form = e.target.closest('form[data-action]');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('input[type="text"]');
    const text = input.value.trim();
    if (!text) return;

    switch (form.dataset.action) {
      case 'add-quest': {
        const section = SECTIONS.some(s => s.key === form.dataset.section) ? form.dataset.section : 'studium';
        state.quests.push({ id: uid(), title: text, category: questCat === 'erledigt' ? 'main' : questCat, section, type: 'frist', notes: '', done: false, doneAt: null, priority: 'mittel', createdAt: todayStr(), start: null, deadline: null, milestones: [], nextStepId: null, steps: [], streak: freshStreak() });
        refocusSel = `form[data-action="add-quest"][data-section="${section}"] input`;
        break;
      }
      case 'add-step': { const q = state.quests.find(q => q.id === form.dataset.quest); if (!q) return; q.steps.push(newStep(text)); syncQuestDone(q); refocusSel = `form[data-action="add-step"][data-quest="${q.id}"] input`; break; }
      case 'add-sub': {
        const q = state.quests.find(q => q.id === form.dataset.quest);
        const s = q && findStep(q, form.dataset.step);
        if (!s) return;
        const parent = form.dataset.parent ? findSubRec(s.subs, form.dataset.parent) : null;
        (parent ? parent.subs : s.subs).push(newSub(text));
        if (parent) parent.done = false; else s.done = false;
        if (parent) parent.open = true;
        syncQuestDone(q);
        refocusSel = `form[data-action="add-sub"]${form.dataset.parent ? `[data-parent="${form.dataset.parent}"]` : `[data-step="${s.id}"]:not([data-parent])`} input`;
        break;
      }
      case 'add-ms': { const q = state.quests.find(q => q.id === form.dataset.quest); if (!q) return; q.milestones.push({ id: uid(), text, deadline: null }); refocusSel = `form[data-action="add-ms"][data-quest="${q.id}"] input`; break; }
      case 'add-agenda': { const date = isDateStr(form.dataset.date) ? form.dataset.date : todayStr(); state.agenda.push({ id: uid(), text, date, done: false, doneAt: null }); refocusSel = `form[data-action="add-agenda"] input`; break; }
      case 'add-event': { const ev = { id: uid(), name: text, start: todayStr(), end: null, notes: '' }; state.events.push(ev); activeEventId = ev.id; break; }
      case 'add-list': state.lists.push({ id: uid(), name: text, open: true, items: [] }); refocusSel = 'form[data-action="add-list"] input'; break;
      case 'add-item': { const l = state.lists.find(l => l.id === form.dataset.list); if (!l) return; l.items.push({ id: uid(), text, done: false }); refocusSel = `form[data-action="add-item"][data-list="${l.id}"] input`; break; }
      default: return;
    }
    save(); render();
  });

  tabbar.addEventListener('click', e => { const btn = e.target.closest('.tab'); if (!btn) return; activeTab = btn.dataset.tab; activeQuestId = null; activeStepId = null; activeEventId = null; render(); });

  function onReturn() { if (document.visibilityState !== 'visible') return; const ch = auditAllStreaks(); if (ch || dayStamp !== todayStr()) { dayStamp = todayStr(); if (ch) save(); render(); } }
  document.addEventListener('visibilitychange', onReturn);
  window.addEventListener('focus', onReturn);

  auditAllStreaks();
  save();
  render();

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Quest-Log: Service Worker nicht registriert', e)));
})();
