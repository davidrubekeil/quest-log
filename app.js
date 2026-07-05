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

  const emptyState = () => ({ version: 3, lists: [], quests: [] });

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
  let dayStamp = todayStr();
  let refocusSel = null;

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
          <form class="add-row thin" data-action="add-sub" data-quest="${questId}" data-parent="${node.id}">
            <input type="text" placeholder="Unterschritt …" autocomplete="off" enterkeyhint="done">
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
      <form class="add-row" data-action="add-step" data-quest="${q.id}">
        <input type="text" placeholder="Neuer Schritt …" autocomplete="off" enterkeyhint="done">
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

  function render() {
    if (editing) return;
    for (const btn of tabbar.querySelectorAll('.tab')) {
      btn.classList.toggle('active', btn.dataset.tab === activeTab);
    }
    view.innerHTML = activeTab === 'quests' ? renderQuests() : renderLists();

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
        q.steps.push(newNode(text));
        syncQuestDone(q);
        refocusSel = `form[data-action="add-step"][data-quest="${q.id}"] input`;
        break;
      }

      case 'add-sub': {
        const q = state.quests.find(q => q.id === form.dataset.quest);
        const parent = q && findNode(q.steps, form.dataset.parent);
        if (!parent) return;
        parent.done = false;
        parent.open = true;
        parent.steps.push(newNode(text));
        syncQuestDone(q);
        refocusSel = `form[data-action="add-sub"][data-parent="${parent.id}"] input`;
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
