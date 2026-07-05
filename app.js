/* Quest-Log — App-Logik
   Persönliches Projekt-Register (Mac): Quests (hierarchisch) + Listen.
   Übersicht mit Bereichen → Klick auf eine Quest öffnet die 3-Spalten-Detailansicht
   (Auswahl/Kurzinfos · Schritte · Notizen). Quests sind entweder „Mit Frist"
   (Priorität + Deadline) oder „Laufend" (grüner Marker, ohne Frist/Priorität).
   Persistenz: localStorage, Key questlog-state-v3. v1/v2 werden migriert. */

(() => {
  'use strict';

  /* ---------- Konstanten ---------- */

  const KEYS = ['questlog-state-v3', 'questlog-state-v2', 'questlog-state-v1'];
  const KEY_SAVE = KEYS[0];

  const QUEST_CATS = [
    { key: 'main', label: 'Main' },
    { key: 'side', label: 'Side' },
  ];

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
  const sectionOf = k => SECTIONS.find(s => s.key === k) || SECTIONS[0];

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
  const timeHM = iso => {
    const d = new Date(iso);
    return isNaN(d) ? '' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  const isDateStr = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const parseDate = ds => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayDiff = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
  const daysUntil = ds => dayDiff(todayStr(), ds);
  const fmtShort = ds => { const [, m, d] = ds.split('-'); return `${d}.${m}.`; };
  const fmtRest = n =>
    n < 0 ? 'überfällig' :
    n === 0 ? 'heute' :
    n === 1 ? 'morgen' : `in ${n} Tagen`;

  const addDays = (ds, n) => { const d = parseDate(ds); d.setDate(d.getDate() + n); return dateStr(d); };
  const addMonths = (ds, n) => { const d = parseDate(ds); d.setDate(1); d.setMonth(d.getMonth() + n); return dateStr(d); };
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const WD_FULL = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const wdIndexMon = d => (d.getDay() + 6) % 7; // Montag = 0

  /* ---------- Streak (intern weitergeführt, ohne Anzeige) ---------- */

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
    if (s.currentStreak !== 0 && s.lastActiveDate !== todayStr() && s.lastActiveDate !== yesterdayStr()) {
      s.currentStreak = 0;
      return true;
    }
    return false;
  }

  function auditAllStreaks() {
    let changed = false;
    for (const q of state.quests) changed = auditStreak(q.streak) || changed;
    return changed;
  }

  /* ---------- Baum-Helfer ---------- */

  const newNode = text => ({
    id: uid(), text, done: false, doneAt: null,
    priority: 'mittel', deadline: null, steps: [], open: false,
  });

  const isLeaf = n => n.steps.length === 0;
  function isNodeDone(n) { return isLeaf(n) ? !!n.done : n.steps.every(isNodeDone); }

  function countLeaves(n) {
    if (isLeaf(n)) return { done: n.done ? 1 : 0, total: 1 };
    return n.steps.reduce((a, c) => {
      const r = countLeaves(c);
      return { done: a.done + r.done, total: a.total + r.total };
    }, { done: 0, total: 0 });
  }

  function questLeaves(q) {
    return q.steps.reduce((a, c) => {
      const r = countLeaves(c);
      return { done: a.done + r.done, total: a.total + r.total };
    }, { done: 0, total: 0 });
  }

  function questPct(q) {
    const { done, total } = questLeaves(q);
    return total ? Math.round(done / total * 100) : (q.done ? 100 : 0);
  }

  function effDeadline(node) {
    if (isNodeDone(node)) return null;
    let best = node.deadline || null;
    for (const c of node.steps) { const e = effDeadline(c); if (e && (!best || e < best)) best = e; }
    return best;
  }

  function questEffDeadline(q) {
    if (q.done || q.type === 'laufend') return null;
    let best = q.deadline || null;
    for (const s of q.steps) { const e = effDeadline(s); if (e && (!best || e < best)) best = e; }
    return best;
  }

  function byUrgency(a, b) {
    const ad = isNodeDone(a), bd = isNodeDone(b);
    if (ad !== bd) return ad ? 1 : -1;
    const ae = effDeadline(a), be = effDeadline(b);
    if (ae && be) return ae < be ? -1 : ae > be ? 1 : 0;
    if (ae) return -1;
    if (be) return 1;
    return 0;
  }
  const sortedSteps = arr => arr.slice().sort(byUrgency);

  const byQuestUrgency = (x, y) => {
    const xe = questEffDeadline(x), ye = questEffDeadline(y);
    if (xe && ye) return xe < ye ? -1 : xe > ye ? 1 : 0;
    if (xe) return -1;
    if (ye) return 1;
    return 0;
  };

  function findNode(nodes, id) {
    for (const n of nodes) {
      if (n.id === id) return n;
      const f = findNode(n.steps, id);
      if (f) return f;
    }
    return null;
  }

  function removeNode(nodes, id) {
    const i = nodes.findIndex(n => n.id === id);
    if (i >= 0) { nodes.splice(i, 1); return true; }
    for (const n of nodes) if (removeNode(n.steps, id)) return true;
    return false;
  }

  function syncQuestDone(q) {
    const { done, total } = questLeaves(q);
    if (total === 0) return;
    if (done === total) {
      if (!q.done) { q.done = true; q.doneAt = nowISO(); }
    } else {
      q.done = false; q.doneAt = null;
    }
  }

  /* ---------- State, Migration, Persistenz ---------- */

  const emptyState = () => ({ version: 3, lists: [], quests: [], agenda: [] });

  /* Freie Tagesaufgaben (gehören zu keiner Quest, nur im Kalender). */
  function normalizeAgenda(raw) {
    if (!raw || typeof raw !== 'object' || !isDateStr(raw.date)) return null;
    return {
      id: raw.id || uid(),
      text: String(raw.text ?? ''),
      date: raw.date,
      done: !!raw.done,
      doneAt: raw.doneAt || null,
    };
  }

  function normalizeItem(raw) {
    if (typeof raw === 'string') return { id: uid(), text: raw, done: false };
    if (!raw || typeof raw !== 'object') return null;
    return { id: raw.id || uid(), text: String(raw.text ?? raw.name ?? ''), done: !!raw.done };
  }

  function normalizeNode(raw) {
    if (typeof raw === 'string') return newNode(raw);
    if (!raw || typeof raw !== 'object') return null;
    const kids = Array.isArray(raw.steps) ? raw.steps
      : Array.isArray(raw.items) ? raw.items : [];
    return {
      id: raw.id || uid(),
      text: String(raw.text ?? raw.name ?? ''),
      done: !!raw.done,
      doneAt: raw.doneAt || null,
      priority: PRIOS.some(p => p.key === raw.priority) ? raw.priority : 'mittel',
      deadline: isDateStr(raw.deadline) ? raw.deadline : null,
      steps: kids.map(normalizeNode).filter(Boolean),
      open: !!raw.open,
    };
  }

  function sanitizeState(raw) {
    const s = emptyState();
    if (!raw || typeof raw !== 'object') return s;

    if (Array.isArray(raw.lists)) {
      s.lists = raw.lists
        .filter(l => l && typeof l === 'object')
        .map(l => ({
          id: l.id || uid(),
          name: String(l.name ?? ''),
          open: !!l.open,
          items: (Array.isArray(l.items) ? l.items : []).map(normalizeItem).filter(Boolean),
        }));
    }

    if (Array.isArray(raw.quests)) {
      s.quests = raw.quests
        .filter(q => q && typeof q === 'object')
        .map(q => ({
          id: q.id || uid(),
          title: String(q.title ?? ''),
          category: q.category === 'side' ? 'side' : 'main',
          section: SECTIONS.some(x => x.key === q.section) ? q.section : 'studium',
          type: q.type === 'laufend' ? 'laufend' : 'frist',
          notes: typeof q.notes === 'string' ? q.notes : '',
          done: !!q.done,
          doneAt: q.doneAt || null,
          priority: PRIOS.some(p => p.key === q.priority) ? q.priority : 'mittel',
          createdAt: isDateStr(q.createdAt) ? q.createdAt : todayStr(),
          start: isDateStr(q.start) ? q.start : null,
          deadline: isDateStr(q.deadline) ? q.deadline : null,
          steps: (Array.isArray(q.steps) ? q.steps : []).map(normalizeNode).filter(Boolean),
          streak: sanitizeStreak(q.streak),
          open: q.open === undefined ? true : !!q.open,
        }));
      for (const q of s.quests) syncQuestDone(q);
    }

    if (Array.isArray(raw.agenda)) {
      s.agenda = raw.agenda.map(normalizeAgenda).filter(Boolean);
    }

    return s;
  }

  function loadState() {
    for (const key of KEYS) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) return sanitizeState(JSON.parse(raw));
      } catch (e) { console.warn(`Quest-Log: ${key} unlesbar`, e); }
    }
    return emptyState();
  }

  function save() {
    try {
      localStorage.setItem(KEY_SAVE, JSON.stringify(state));
    } catch (e) { console.warn('Quest-Log: Speichern fehlgeschlagen', e); }
  }

  /* ---------- Quest-Akzent (Ton-in-Ton von --red) ---------- */

  function questAccent(id) {
    let h = 2166136261;
    for (const c of id) h = ((h ^ c.charCodeAt(0)) * 16777619) >>> 0;
    const hue = 5 + (h % 13) - 6;
    const lig = 41 + ((h >> 8) % 9) - 4;
    return { line: `hsl(${hue} 60% ${lig}%)`, tint: `hsl(${hue} 60% ${lig}% / 0.09)` };
  }

  /* ---------- Rendering ---------- */

  const view = document.getElementById('view');
  const tabbar = document.getElementById('tabbar');

  let state = loadState();
  let activeTab = 'quests';
  let questCat = 'main';
  let activeQuestId = null; // in der Detailansicht geöffnete Quest
  let calView = 'monat';    // 'monat' | 'tag'
  let calCursor = todayStr();
  let dayStamp = todayStr();
  let refocusSel = null;

  /* Alle datierten Einträge quest-übergreifend einsammeln.
     kind: 'quest' (Frist, Markierung) | 'branch' (Ast mit Termin, Markierung)
           | 'step' (Blatt mit Termin, abhakbar, zählt zum Fortschritt)
           | 'agenda' (freie Tagesaufgabe, abhakbar). */
  function collectEntries() {
    const out = [];
    const walk = (nodes, q) => {
      for (const n of nodes) {
        if (n.deadline) {
          const leaf = isLeaf(n);
          out.push({
            date: n.deadline, kind: leaf ? 'step' : 'branch',
            questId: q.id, nodeId: n.id, text: n.text, questTitle: q.title,
            done: isNodeDone(n), checkable: leaf,
          });
        }
        walk(n.steps, q);
      }
    };
    for (const q of state.quests) {
      if (q.deadline) out.push({ date: q.deadline, kind: 'quest', questId: q.id, text: q.title, done: q.done, checkable: false });
      walk(q.steps, q);
    }
    for (const a of state.agenda) {
      out.push({ date: a.date, kind: 'agenda', id: a.id, text: a.text, done: a.done, checkable: true });
    }
    return out;
  }

  function entriesByDate() {
    const map = {};
    for (const e of collectEntries()) (map[e.date] || (map[e.date] = [])).push(e);
    return map;
  }

  const dotHtml = p => `<span class="prio-dot" style="background:${p.color}" title="Priorität: ${p.label}"></span>`;
  const sectionOptions = sel => SECTIONS.map(s => `<option value="${s.key}"${s.key === sel ? ' selected' : ''}>${esc(s.label)}</option>`).join('');
  const typeOptions = sel => TYPES.map(t => `<option value="${t.key}"${t.key === sel ? ' selected' : ''}>${t.label}</option>`).join('');

  /* Rekursive Schritt-Zeile (Spalte 2 der Detailansicht). */
  function renderNode(node, questId) {
    const leaf = isLeaf(node);
    const done = isNodeDone(node);
    const c = countLeaves(node);
    const p = prioOf(node.priority);
    const eff = effDeadline(node);
    const du = eff ? daysUntil(eff) : null;

    const control = leaf
      ? `<button class="checkbox" data-action="toggle-node" data-quest="${questId}" data-id="${node.id}" aria-label="Abhaken">${ICONS.check}</button>`
      : `<span class="branch-mark${done ? ' full' : ''}">${c.done}/${c.total}</span>`;

    return `<li class="node${done ? ' done' : ''}${node.open ? ' open' : ''}">
      <div class="node-row">
        <button class="chev" data-action="toggle-open" data-quest="${questId}" data-id="${node.id}" aria-label="Auf-/Zuklappen">${ICONS.chevron}</button>
        ${control}
        ${node.priority !== 'mittel' ? dotHtml(p) : ''}
        <span class="row-text editable" data-edit="node-text" data-quest="${questId}" data-id="${node.id}">${esc(node.text)}</span>
        ${du !== null ? `<span class="rest${du < 0 ? ' over' : ''}">${fmtRest(du)}</span>` : ''}
        ${leaf && node.doneAt ? `<span class="row-time">${timeHM(node.doneAt)}</span>` : ''}
        <button class="del" data-action="del-node" data-quest="${questId}" data-id="${node.id}" aria-label="Löschen">${ICONS.x}</button>
      </div>
      ${node.open ? `<ul class="subtree">
        <li class="meta-row">
          <button class="chip prio-btn" data-action="cycle-prio-node" data-quest="${questId}" data-node="${node.id}">${dotHtml(p)}${p.label}</button>
          <label class="date-field">Termin
            <input type="date" data-field="node-deadline" data-quest="${questId}" data-node="${node.id}" value="${node.deadline || ''}">
          </label>
        </li>
        ${sortedSteps(node.steps).map(k => renderNode(k, questId)).join('')}
        <li class="add-sub">
          <form class="add-row thin dated" data-action="add-sub" data-quest="${questId}" data-parent="${node.id}">
            <input type="text" placeholder="Unterschritt …" autocomplete="off" enterkeyhint="done">
            <input type="date" class="add-date" aria-label="Termin (optional)">
            <button type="submit" aria-label="Hinzufügen">${ICONS.plus}</button>
          </form>
        </li>
      </ul>` : ''}
    </li>`;
  }

  function timeRow(q) {
    if (!q.deadline) return '';
    const start = q.start || q.createdAt;
    const total = dayDiff(start, q.deadline);
    const gone = dayDiff(start, todayStr());
    const pct = total <= 0 ? 100 : Math.max(0, Math.min(100, Math.round(gone / total * 100)));
    const over = daysUntil(q.deadline) < 0;
    return `<div class="time-row">
      <span>${fmtShort(start)}</span>
      <div class="track${over ? ' over' : ''}">
        <div class="fill time-fill" style="width:${pct}%"></div>
        <div class="mark" style="left:${pct}%"></div>
      </div>
      <span>${fmtShort(q.deadline)}</span>
    </div>`;
  }

  /* Kurzinfos + Steuerung unter dem hervorgehobenen Questnamen (Spalte 1). */
  function renderQuestMeta(q) {
    const laufend = q.type === 'laufend';
    const p = prioOf(q.priority);
    const { done, total } = questLeaves(q);
    const pct = questPct(q);
    const hasSteps = total > 0;

    return `<div class="qmeta">
      <div class="meta-row">
        <label class="sel-field">Bereich
          <select data-sel="section" data-id="${q.id}">${sectionOptions(q.section)}</select>
        </label>
        <label class="sel-field">Typ
          <select data-sel="type" data-id="${q.id}">${typeOptions(q.type)}</select>
        </label>
        ${laufend ? '' : `<button class="chip prio-btn" data-action="cycle-prio" data-id="${q.id}">${dotHtml(p)}${p.label}</button>`}
      </div>
      ${laufend ? '' : `<div class="meta-row">
        <label class="date-field">Start
          <input type="date" data-field="start" data-id="${q.id}" value="${q.start || q.createdAt}">
        </label>
        <label class="date-field">Ende
          <input type="date" data-field="deadline" data-id="${q.id}" value="${q.deadline || ''}">
        </label>
      </div>`}
      ${hasSteps ? `<div class="progress-row">
        <span>${done}/${total}</span>
        <div class="track"><div class="fill" style="width:${pct}%"></div></div>
        <span class="pct">${pct}%</span>
      </div>` : ''}
      ${laufend ? '' : timeRow(q)}
    </div>`;
  }

  /* Quest-Zeile in der Bereichsliste (Spalte 1). */
  function renderQuestRow(q, active) {
    const isActive = active && q.id === active.id;
    const laufend = q.type === 'laufend';
    const p = prioOf(q.priority);
    const pct = questPct(q);
    const eff = questEffDeadline(q);
    const du = eff ? daysUntil(eff) : null;
    const hasSteps = questLeaves(q).total > 0;
    const dot = laufend ? 'var(--flow)' : p.color;

    const tail = laufend
      ? '<span class="flow-badge">laufend</span>'
      : (du !== null && !q.done ? `<span class="rest${du < 0 ? ' over' : ''}">${fmtRest(du)}</span>` : '');

    return `<div class="qwrap">
      <div class="qrow${isActive ? ' active' : ''}${q.done ? ' done' : ''}" data-action="open-quest" data-id="${q.id}">
        ${!hasSteps && !laufend
          ? `<button class="checkbox" data-action="toggle-quest" data-id="${q.id}" aria-label="Quest abhaken">${ICONS.check}</button>`
          : `<span class="qdot" style="background:${dot}"></span>`}
        <span class="qname${isActive ? ' editable' : ''}"${isActive ? ` data-edit="quest-title" data-id="${q.id}"` : ''}>${esc(q.title)}</span>
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
      body = `<div class="group-label">Mit Deadline</div>${frist.map(q => renderQuestRow(q, active)).join('')}
        <div class="group-label">Laufend</div>${laufend.map(q => renderQuestRow(q, active)).join('')}`;
    } else {
      const all = frist.concat(laufend);
      body = all.length ? all.map(q => renderQuestRow(q, active)).join('') : '<div class="empty">— keine Quests —</div>';
    }

    return `<section class="board-section${isActiveHere ? ' has-active' : ''}">
      <div class="section-title">${esc(sec.label)}</div>
      ${body}
      <form class="add-row add-block" data-action="add-quest" data-section="${sec.key}">
        <input type="text" placeholder="Neue Quest …" autocomplete="off" enterkeyhint="done">
        <select class="add-type" aria-label="Typ">${typeOptions('frist')}</select>
        <button type="submit" aria-label="Quest anlegen">${ICONS.plus}</button>
      </form>
    </section>`;
  }

  function renderStepsCol(q) {
    return `<div class="col-steps">
      <div class="col-head">Schritte</div>
      <ul class="tree">${sortedSteps(q.steps).map(n => renderNode(n, q.id)).join('')}</ul>
      <form class="add-row dated" data-action="add-step" data-quest="${q.id}">
        <input type="text" placeholder="Neuer Schritt …" autocomplete="off" enterkeyhint="done">
        <input type="date" class="add-date" aria-label="Termin (optional)">
        <button type="submit" aria-label="Hinzufügen">${ICONS.plus}</button>
      </form>
    </div>`;
  }

  function renderNotesCol(q) {
    return `<div class="col-notes">
      <div class="col-head">Notizen</div>
      <textarea class="notes" data-notes data-id="${q.id}" placeholder="Notizen …">${esc(q.notes)}</textarea>
    </div>`;
  }

  function renderQuests() {
    const counts = {
      main: state.quests.filter(q => q.category === 'main').length,
      side: state.quests.filter(q => q.category === 'side').length,
    };
    const tabs = QUEST_CATS.map(c =>
      `<button data-action="quest-cat" data-cat="${c.key}" class="${questCat === c.key ? 'active' : ''}">
        ${c.label}<span class="seg-count">${counts[c.key]}</span></button>`).join('');

    const inTab = state.quests.filter(q => q.category === questCat);
    const active = activeQuestId ? inTab.find(q => q.id === activeQuestId) : null;
    const sections = SECTIONS
      .map(sec => renderSection(sec, inTab.filter(q => q.section === sec.key), active))
      .join('');

    return `<div class="board-title">Questlog</div>
      <div class="seg">${tabs}</div>
      <div class="board${active ? ' detail has-active' : ''}">
        <div class="col-list">
          ${active ? '<button class="back" data-action="close-quest">← Übersicht</button>' : ''}
          ${sections}
        </div>
        ${active ? renderStepsCol(active) + renderNotesCol(active) : ''}
      </div>`;
  }

  function renderLists() {
    const blocks = state.lists.map(l => {
      const doneCount = l.items.filter(i => i.done).length;
      return `<section class="block${l.open ? ' open' : ''}">
        <header class="block-head list-head" data-action="toggle-list" data-id="${l.id}">
          <span class="chev">${ICONS.chevron}</span>
          <h2 class="editable" data-edit="list-name" data-id="${l.id}">${esc(l.name)}</h2>
          <span class="count">${doneCount}/${l.items.length}</span>
          <button class="del" data-action="del-list" data-id="${l.id}" aria-label="Liste löschen">${ICONS.x}</button>
        </header>
        ${l.open ? `
          ${l.items.length
            ? `<ul class="items">${l.items.map(i => `<li class="row${i.done ? ' done' : ''}">
                <button class="checkbox" data-action="toggle-item" data-list="${l.id}" data-id="${i.id}" aria-label="Abhaken">${ICONS.check}</button>
                <span class="row-text editable" data-edit="item-text" data-list="${l.id}" data-id="${i.id}">${esc(i.text)}</span>
                <button class="del" data-action="del-item" data-list="${l.id}" data-id="${i.id}" aria-label="Löschen">${ICONS.x}</button>
              </li>`).join('')}</ul>`
            : '<div class="empty">— leer —</div>'}
          <form class="add-row" data-action="add-item" data-list="${l.id}">
            <input type="text" placeholder="Neuer Eintrag …" autocomplete="off" enterkeyhint="done">
            <button type="submit" aria-label="Hinzufügen">${ICONS.plus}</button>
          </form>` : ''}
      </section>`;
    }).join('');

    return `${blocks}
      <form class="add-row add-block" data-action="add-list">
        <input type="text" placeholder="Neue Liste …" autocomplete="off" enterkeyhint="done">
        <button type="submit" aria-label="Liste anlegen">${ICONS.plus}</button>
      </form>`;
  }

  const DOT = { quest: 'var(--red)', branch: 'var(--muted)', step: 'var(--blue)', agenda: 'var(--flow)' };

  function renderMonth(byDate) {
    const c = parseDate(calCursor);
    const year = c.getFullYear(), month = c.getMonth();
    const first = new Date(year, month, 1);
    const gridStart = addDays(dateStr(first), -wdIndexMon(first));

    const weekdays = WD_SHORT.map(w => `<div class="cal-weekday">${w}</div>`).join('');
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const ds = addDays(gridStart, i);
      const d = parseDate(ds);
      const inMonth = d.getMonth() === month;
      const isToday = ds === todayStr();
      const items = byDate[ds] || [];
      const chips = items.slice(0, 3).map(e =>
        `<div class="cal-chip${e.done ? ' done' : ''}"><span class="cdot" style="background:${DOT[e.kind]}"></span>${esc(e.text)}</div>`).join('');
      const more = items.length > 3 ? `<div class="cal-more">+${items.length - 3} mehr</div>` : '';
      cells += `<div class="cal-cell${inMonth ? '' : ' other'}${isToday ? ' today' : ''}" data-action="cal-day" data-date="${ds}">
        <span class="cal-daynum">${d.getDate()}</span>${chips}${more}</div>`;
    }
    return `<div class="cal-grid">${weekdays}${cells}</div>`;
  }

  function calEntryRow(e) {
    if (e.checkable && e.kind === 'step') {
      return `<li class="row${e.done ? ' done' : ''}">
        <button class="checkbox" data-action="toggle-node" data-quest="${e.questId}" data-id="${e.nodeId}" aria-label="Abhaken">${ICONS.check}</button>
        <span class="row-text">${esc(e.text)}</span>
        <button class="cal-ctx" data-action="open-quest-from-cal" data-id="${e.questId}">${esc(e.questTitle)}</button>
      </li>`;
    }
    if (e.kind === 'agenda') {
      return `<li class="row${e.done ? ' done' : ''}">
        <button class="checkbox" data-action="toggle-agenda" data-id="${e.id}" aria-label="Abhaken">${ICONS.check}</button>
        <span class="row-text">${esc(e.text)}</span>
        <button class="del" data-action="del-agenda" data-id="${e.id}" aria-label="Löschen">${ICONS.x}</button>
      </li>`;
    }
    // Markierung (Quest-Frist oder Ast mit Termin), nicht abhakbar
    return `<li class="row marker${e.done ? ' done' : ''}">
      <span class="cdot" style="background:${DOT[e.kind]}"></span>
      <button class="marker-link" data-action="open-quest-from-cal" data-id="${e.questId}">${esc(e.text)}${e.kind === 'branch' ? ` · ${esc(e.questTitle)}` : ''}</button>
      <span class="marker-tag">${e.kind === 'quest' ? 'Quest-Frist' : 'Frist'}</span>
    </li>`;
  }

  function renderDay(byDate) {
    const items = (byDate[calCursor] || []);
    const markers = items.filter(e => !e.checkable);
    const steps = items.filter(e => e.kind === 'step');
    const tasks = items.filter(e => e.kind === 'agenda');
    const d = parseDate(calCursor);

    const group = (label, arr) => arr.length
      ? `<div class="day-group"><div class="day-group-label">${label}</div><ul class="items">${arr.map(calEntryRow).join('')}</ul></div>` : '';

    const body = (markers.length || steps.length || tasks.length)
      ? group('Fristen', markers) + group('Schritte', steps) + group('Aufgaben', tasks)
      : '<div class="empty">— nichts an diesem Tag —</div>';

    return `<div class="day-view">
      <div class="day-head">
        <span class="day-title">${WD_FULL[wdIndexMon(d)]}, ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}</span>
      </div>
      ${body}
      <form class="add-row add-agenda" data-action="add-agenda" data-date="${calCursor}">
        <input type="text" placeholder="Aufgabe für diesen Tag …" autocomplete="off" enterkeyhint="done">
        <button type="submit" aria-label="Hinzufügen">${ICONS.plus}</button>
      </form>
    </div>`;
  }

  function renderCalendar() {
    const byDate = entriesByDate();
    const cd = parseDate(calCursor);
    const label = `${MONTHS[cd.getMonth()]} ${cd.getFullYear()}`;

    const views = [['monat', 'Monat'], ['tag', 'Tag']].map(([k, l]) =>
      `<button data-action="cal-view" data-view="${k}" class="${calView === k ? 'active' : ''}">${l}</button>`).join('');

    return `<div class="cal-toolbar">
        <div class="cal-views">${views}</div>
        <span class="cal-period">${label}</span>
        <div class="cal-nav">
          <button data-action="cal-prev" aria-label="Zurück">‹</button>
          <button class="cal-today" data-action="cal-today">Heute</button>
          <button data-action="cal-next" aria-label="Vor">›</button>
        </div>
      </div>
      ${calView === 'monat' ? renderMonth(byDate) : renderDay(byDate)}`;
  }

  function render() {
    if (editing) return;
    for (const btn of tabbar.querySelectorAll('.tab')) {
      btn.classList.toggle('active', btn.dataset.tab === activeTab);
    }
    view.innerHTML = activeTab === 'calendar' ? renderCalendar()
      : activeTab === 'quests' ? renderQuests()
      : renderLists();

    if (refocusSel) {
      const el = view.querySelector(refocusSel);
      if (el) el.focus();
      refocusSel = null;
    }
  }

  /* ---------- Inline-Umbenennen (Doppelklick) ---------- */

  let editing = null;

  function startEdit(el) {
    if (editing) return;
    editing = el;
    el.setAttribute('contenteditable', 'plaintext-only');
    el.classList.add('editing');
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function applyEdit(ds, val) {
    switch (ds.edit) {
      case 'quest-title': { const q = state.quests.find(q => q.id === ds.id); if (q) q.title = val; break; }
      case 'node-text': { const q = state.quests.find(q => q.id === ds.quest); const n = q && findNode(q.steps, ds.id); if (n) n.text = val; break; }
      case 'list-name': { const l = state.lists.find(l => l.id === ds.id); if (l) l.name = val; break; }
      case 'item-text': { const l = state.lists.find(l => l.id === ds.list); const i = l && l.items.find(i => i.id === ds.id); if (i) i.text = val; break; }
    }
  }

  function commitEdit(cancel) {
    if (!editing) return;
    const el = editing;
    editing = null;
    el.removeAttribute('contenteditable');
    el.classList.remove('editing');
    const val = el.textContent.trim();
    if (!cancel && val) applyEdit({ ...el.dataset }, val);
    save();
    render();
  }

  view.addEventListener('dblclick', e => {
    const el = e.target.closest('.editable');
    if (el) startEdit(el);
  });
  view.addEventListener('keydown', e => {
    if (!editing) return;
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(false); }
    else if (e.key === 'Escape') { e.preventDefault(); commitEdit(true); }
  });
  view.addEventListener('focusout', e => {
    if (editing && e.target === editing) commitEdit(false);
  });

  /* Escape schließt die Detailansicht. */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !editing && activeQuestId) { activeQuestId = null; render(); }
  });

  /* ---------- Notizen (ohne Re-Render, damit der Fokus bleibt) ---------- */

  view.addEventListener('input', e => {
    const ta = e.target.closest('textarea[data-notes]');
    if (!ta) return;
    const q = state.quests.find(q => q.id === ta.dataset.id);
    if (q) { q.notes = ta.value; save(); }
  });

  /* ---------- Klick-Aktionen ---------- */

  view.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || !view.contains(el) || el.tagName === 'FORM') return;
    if (el.closest('.editable')) return;
    const { action, id, list: listId, quest: questId } = el.dataset;

    switch (action) {
      case 'quest-cat':
        questCat = el.dataset.cat;
        activeQuestId = null;
        break;

      case 'cal-view':
        calView = el.dataset.view === 'tag' ? 'tag' : 'monat';
        break;
      case 'cal-prev':
        calCursor = calView === 'monat' ? addMonths(calCursor, -1) : addDays(calCursor, -1);
        break;
      case 'cal-next':
        calCursor = calView === 'monat' ? addMonths(calCursor, 1) : addDays(calCursor, 1);
        break;
      case 'cal-today':
        calCursor = todayStr();
        break;
      case 'cal-day':
        calCursor = el.dataset.date;
        calView = 'tag';
        break;
      case 'open-quest-from-cal': {
        const q = state.quests.find(q => q.id === id);
        if (!q) return;
        activeTab = 'quests';
        questCat = q.category;
        activeQuestId = q.id;
        break;
      }
      case 'toggle-agenda': {
        const a = state.agenda.find(a => a.id === id);
        if (!a) return;
        a.done = !a.done;
        a.doneAt = a.done ? nowISO() : null;
        break;
      }
      case 'del-agenda':
        state.agenda = state.agenda.filter(a => a.id !== id);
        break;

      case 'open-quest':
        if (id !== activeQuestId) activeQuestId = id; // aktive Quest bleibt offen (Schließen via Zurück/Escape)
        else return;
        break;
      case 'close-quest':
        activeQuestId = null;
        break;

      case 'toggle-quest': {
        const q = state.quests.find(q => q.id === id);
        if (!q || q.steps.length) return;
        q.done = !q.done;
        q.doneAt = q.done ? nowISO() : null;
        if (q.done) touchStreak(q.streak);
        break;
      }
      case 'del-quest': {
        const q = state.quests.find(q => q.id === id);
        if (!q || !confirm(`Quest „${q.title}" löschen?`)) return;
        state.quests = state.quests.filter(x => x.id !== id);
        if (id === activeQuestId) activeQuestId = null;
        break;
      }
      case 'cycle-prio': {
        const q = state.quests.find(q => q.id === id);
        if (!q) return;
        const i = PRIOS.findIndex(p => p.key === q.priority);
        q.priority = PRIOS[(i + 1) % PRIOS.length].key;
        break;
      }
      case 'cycle-prio-node': {
        const q = state.quests.find(q => q.id === el.dataset.quest);
        const n = q && findNode(q.steps, el.dataset.node);
        if (!n) return;
        const i = PRIOS.findIndex(p => p.key === n.priority);
        n.priority = PRIOS[(i + 1) % PRIOS.length].key;
        break;
      }

      case 'toggle-open': {
        const q = state.quests.find(q => q.id === questId);
        const n = q && findNode(q.steps, id);
        if (n) n.open = !n.open;
        break;
      }
      case 'toggle-node': {
        const q = state.quests.find(q => q.id === questId);
        const n = q && findNode(q.steps, id);
        if (!n || !isLeaf(n)) return;
        n.done = !n.done;
        n.doneAt = n.done ? nowISO() : null;
        if (n.done) touchStreak(q.streak);
        syncQuestDone(q);
        break;
      }
      case 'del-node': {
        const q = state.quests.find(q => q.id === questId);
        if (!q) return;
        removeNode(q.steps, id);
        syncQuestDone(q);
        break;
      }

      case 'toggle-list': {
        const l = state.lists.find(l => l.id === id);
        if (l) l.open = !l.open;
        break;
      }
      case 'del-list': {
        const l = state.lists.find(l => l.id === id);
        if (!l || !confirm(`Liste „${l.name}" löschen?`)) return;
        state.lists = state.lists.filter(x => x.id !== id);
        break;
      }
      case 'toggle-item': {
        const l = state.lists.find(l => l.id === listId);
        const i = l && l.items.find(i => i.id === id);
        if (i) i.done = !i.done;
        break;
      }
      case 'del-item': {
        const l = state.lists.find(l => l.id === listId);
        if (l) l.items = l.items.filter(i => i.id !== id);
        break;
      }

      default: return;
    }

    save();
    render();
  });

  /* ---------- Änderungen an Feldern (Datum + Dropdowns) ---------- */

  view.addEventListener('change', e => {
    const sel = e.target.closest('select[data-sel]');
    if (sel) {
      const q = state.quests.find(q => q.id === sel.dataset.id);
      if (q) {
        if (sel.dataset.sel === 'section') q.section = sel.value;
        else if (sel.dataset.sel === 'type') q.type = (sel.value === 'laufend' ? 'laufend' : 'frist');
      }
      save();
      render();
      return;
    }

    const input = e.target.closest('input[type="date"][data-field]');
    if (!input) return;
    const f = input.dataset.field;
    const v = isDateStr(input.value) ? input.value : null;
    if (f === 'start' || f === 'deadline') {
      const q = state.quests.find(q => q.id === input.dataset.id);
      if (!q) return;
      if (f === 'start') q.start = v; else q.deadline = v;
    } else if (f === 'node-deadline') {
      const q = state.quests.find(q => q.id === input.dataset.quest);
      const n = q && findNode(q.steps, input.dataset.node);
      if (n) n.deadline = v;
    }
    save();
    render();
  });

  /* ---------- Formulare (Anlegen) ---------- */

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
        const typeSel = form.querySelector('.add-type');
        const type = typeSel && typeSel.value === 'laufend' ? 'laufend' : 'frist';
        state.quests.push({
          id: uid(), title: text, category: questCat, section, type, notes: '',
          done: false, doneAt: null,
          priority: 'mittel', createdAt: todayStr(), start: null, deadline: null,
          steps: [], streak: freshStreak(), open: true,
        });
        refocusSel = `form[data-action="add-quest"][data-section="${section}"] input[type="text"]`;
        break;
      }

      case 'add-step': {
        const q = state.quests.find(q => q.id === form.dataset.quest);
        if (!q) return;
        const node = newNode(text);
        const di = form.querySelector('.add-date');
        if (di && isDateStr(di.value)) node.deadline = di.value;
        q.steps.push(node);
        syncQuestDone(q);
        refocusSel = `form[data-action="add-step"][data-quest="${q.id}"] input[type="text"]`;
        break;
      }

      case 'add-sub': {
        const q = state.quests.find(q => q.id === form.dataset.quest);
        const parent = q && findNode(q.steps, form.dataset.parent);
        if (!parent) return;
        const node = newNode(text);
        const di = form.querySelector('.add-date');
        if (di && isDateStr(di.value)) node.deadline = di.value;
        parent.done = false;
        parent.open = true;
        parent.steps.push(node);
        syncQuestDone(q);
        refocusSel = `form[data-action="add-sub"][data-parent="${parent.id}"] input[type="text"]`;
        break;
      }

      case 'add-agenda': {
        const date = isDateStr(form.dataset.date) ? form.dataset.date : todayStr();
        state.agenda.push({ id: uid(), text, date, done: false, doneAt: null });
        refocusSel = `form[data-action="add-agenda"] input[type="text"]`;
        break;
      }

      case 'add-list':
        state.lists.push({ id: uid(), name: text, open: true, items: [] });
        refocusSel = 'form[data-action="add-list"] input';
        break;
      case 'add-item': {
        const l = state.lists.find(l => l.id === form.dataset.list);
        if (!l) return;
        l.items.push({ id: uid(), text, done: false });
        refocusSel = `form[data-action="add-item"][data-list="${l.id}"] input`;
        break;
      }

      default: return;
    }

    save();
    render();
  });

  tabbar.addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    activeQuestId = null;
    render();
  });

  function onReturn() {
    if (document.visibilityState !== 'visible') return;
    const changed = auditAllStreaks();
    if (changed || dayStamp !== todayStr()) {
      dayStamp = todayStr();
      if (changed) save();
      render();
    }
  }
  document.addEventListener('visibilitychange', onReturn);
  window.addEventListener('focus', onReturn);

  /* ---------- Start ---------- */

  auditAllStreaks();
  save();
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(e =>
        console.warn('Quest-Log: Service Worker nicht registriert', e));
    });
  }
})();
