/* Quest-Log — App-Logik
   Persönliches Projekt-Register: Quests (hierarchisch, mit Deadline/Priorität) + Listen.
   Persistenz: localStorage, Key questlog-state-v3.
   Ältere v1/v2-Daten werden beim ersten Laden on-the-fly migriert. */

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

  /* Datums-Helfer auf Basis "YYYY-MM-DD" (lokale Zeitzone, taggenau) */
  const isDateStr = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const parseDate = ds => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayDiff = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5); // b − a in Tagen
  const daysUntil = ds => dayDiff(todayStr(), ds);
  const fmtShort = ds => { const [, m, d] = ds.split('-'); return `${d}.${m}.`; };
  const fmtRest = n =>
    n < 0 ? 'überfällig' :
    n === 0 ? 'heute' :
    n === 1 ? 'morgen' : `in ${n} Tagen`;

  /* ---------- Streak (intern weitergeführt, aktuell ohne Anzeige) ---------- */

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

  /* ---------- Baum-Helfer (Schritte / Unterschritte, beliebig tief) ---------- */

  const newNode = text => ({ id: uid(), text, done: false, doneAt: null, steps: [], open: false });

  const isLeaf = n => n.steps.length === 0;

  /* Abgeleiteter Erledigt-Zustand: Blatt = eigenes done; Ast = alle Kinder erledigt. */
  function isNodeDone(n) {
    return isLeaf(n) ? !!n.done : n.steps.every(isNodeDone);
  }

  /* Zählt Blätter (echte Schritte) unter einem Knoten. */
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

  /* Fortschritt in % über alle Ebenen (Quests ohne Schritte: 0 oder 100). */
  function questPct(q) {
    const { done, total } = questLeaves(q);
    return total ? Math.round(done / total * 100) : (q.done ? 100 : 0);
  }

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

  /* Quest gilt als erledigt, sobald alle Blätter erledigt sind (100 %).
     Quests ohne Schritte bleiben manuell abhakbar. */
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

  /* Listen-Items (flach). v1 kann Strings statt Objekte enthalten. */
  function normalizeItem(raw) {
    if (typeof raw === 'string') return { id: uid(), text: raw, done: false };
    if (!raw || typeof raw !== 'object') return null;
    return { id: raw.id || uid(), text: String(raw.text ?? raw.name ?? ''), done: !!raw.done };
  }

  /* Quest-Schritte (rekursiv). Alte flache Schritte werden zu Blättern. */
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
      steps: kids.map(normalizeNode).filter(Boolean),
      open: !!raw.open,
    };
  }

  /* Bringt v1/v2/v3 in die aktuelle Form; neue Felder bekommen Defaults. */
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

  /* ---------- Quest-Akzent: Ton-in-Ton-Variation von --red ---------- */

  function questAccent(id) {
    let h = 2166136261;
    for (const c of id) h = ((h ^ c.charCodeAt(0)) * 16777619) >>> 0;
    const hue = 5 + (h % 13) - 6;          // -1 … 11
    const lig = 41 + ((h >> 8) % 9) - 4;   // 37 … 45
    return {
      line: `hsl(${hue} 60% ${lig}%)`,
      tint: `hsl(${hue} 60% ${lig}% / 0.09)`,
    };
  }

  /* ---------- Rendering ---------- */

  const view = document.getElementById('view');
  const tabbar = document.getElementById('tabbar');
  const headerDate = document.getElementById('headerDate');

  let state = loadState();
  let activeTab = 'quests';
  let questCat = 'main';
  let dayStamp = todayStr();
  let refocusSel = null;

  const WEEKDAYS = ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'];
  function renderHeaderDate() {
    const d = new Date();
    headerDate.textContent =
      `${WEEKDAYS[d.getDay()]} ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
  }

  /* Rekursive Schritt-Zeile inkl. beliebig tiefer Unterschritte. */
  function renderNode(node, questId) {
    const leaf = isLeaf(node);
    const done = isNodeDone(node);
    const c = countLeaves(node);
    const showChildren = node.open;

    const control = leaf
      ? `<button class="checkbox" data-action="toggle-node" data-quest="${questId}" data-id="${node.id}" aria-label="Abhaken">${ICONS.check}</button>`
      : `<span class="branch-mark${done ? ' full' : ''}">${c.done}/${c.total}</span>`;

    return `<li class="node${done ? ' done' : ''}${showChildren ? ' open' : ''}">
      <div class="node-row">
        <button class="chev" data-action="toggle-open" data-quest="${questId}" data-id="${node.id}" aria-label="Auf-/Zuklappen">${ICONS.chevron}</button>
        ${control}
        <span class="row-text">${esc(node.text)}</span>
        ${leaf && node.doneAt ? `<span class="row-time">${timeHM(node.doneAt)}</span>` : ''}
        <button class="del" data-action="del-node" data-quest="${questId}" data-id="${node.id}" aria-label="Löschen">${ICONS.x}</button>
      </div>
      ${showChildren ? `<ul class="subtree">
        ${node.steps.map(k => renderNode(k, questId)).join('')}
        <li class="add-sub">
          <form class="add-row thin" data-action="add-sub" data-quest="${questId}" data-parent="${node.id}">
            <input type="text" placeholder="Unterschritt …" autocomplete="off" enterkeyhint="done">
            <button type="submit" aria-label="Hinzufügen">${ICONS.plus}</button>
          </form>
        </li>
      </ul>` : ''}
    </li>`;
  }

  /* Zeitbalken Start → Deadline mit Heute-Marker; nur bei gesetzter Deadline. */
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

  function renderQuest(q) {
    const a = questAccent(q.id);
    const { done, total } = questLeaves(q);
    const pct = questPct(q);
    const hasSteps = total > 0;
    const p = prioOf(q.priority);
    const du = q.deadline ? daysUntil(q.deadline) : null;

    const control = hasSteps
      ? ''
      : `<button class="checkbox" data-action="toggle-quest" data-id="${q.id}" aria-label="Quest abhaken">${ICONS.check}</button>`;

    return `<section class="block accented${q.open ? ' open' : ''}" style="--accent:${a.line};--accent-tint:${a.tint}">
      <header class="block-head${q.done ? ' done' : ''}">
        <button class="chev" data-action="toggle-quest-open" data-id="${q.id}" aria-label="Auf-/Zuklappen">${ICONS.chevron}</button>
        <span class="prio-dot" style="background:${p.color}" title="Priorität: ${p.label}"></span>
        ${control}
        <h2 class="${q.done ? 'done' : ''}">${esc(q.title)}</h2>
        ${q.done ? '<span class="stamp">Erledigt</span>' : ''}
        <span class="qpct">${pct}%</span>
        ${du !== null && !q.done ? `<span class="rest${du < 0 ? ' over' : ''}">${fmtRest(du)}</span>` : ''}
        <button class="del" data-action="del-quest" data-id="${q.id}" aria-label="Quest löschen">${ICONS.x}</button>
      </header>
      ${q.open ? `
        <div class="meta-row">
          <button class="prio-btn" data-action="cycle-prio" data-id="${q.id}">
            <span class="prio-dot" style="background:${p.color}"></span>${p.label}
          </button>
          <label class="date-field">Start
            <input type="date" data-field="start" data-id="${q.id}" value="${q.start || q.createdAt}">
          </label>
          <label class="date-field">Ende
            <input type="date" data-field="deadline" data-id="${q.id}" value="${q.deadline || ''}">
          </label>
        </div>
        ${hasSteps ? `<div class="progress-row">
          <span>${done}/${total}</span>
          <div class="track"><div class="fill" style="width:${pct}%"></div></div>
          <span class="pct">${pct}%</span>
        </div>` : ''}
        ${timeRow(q)}
        <ul class="tree">${q.steps.map(n => renderNode(n, q.id)).join('')}</ul>
        <form class="add-row" data-action="add-step" data-quest="${q.id}">
          <input type="text" placeholder="Neuer Schritt …" autocomplete="off" enterkeyhint="done">
          <button type="submit" aria-label="Hinzufügen">${ICONS.plus}</button>
        </form>` : ''}
    </section>`;
  }

  function renderGroup(label, quests) {
    if (!quests.length) return '';
    return `<div class="group-label">${label}</div>${quests.map(renderQuest).join('')}`;
  }

  function renderQuests() {
    const counts = {
      main: state.quests.filter(q => q.category === 'main').length,
      side: state.quests.filter(q => q.category === 'side').length,
    };
    const tabs = QUEST_CATS.map(c =>
      `<button data-action="quest-cat" data-cat="${c.key}" class="${questCat === c.key ? 'active' : ''}">
        ${c.label}<span class="seg-count">${counts[c.key]}</span></button>`).join('');

    const quests = state.quests.filter(q => q.category === questCat);
    const withDl = quests.filter(q => q.deadline)
      .sort((x, y) => x.deadline < y.deadline ? -1 : x.deadline > y.deadline ? 1 : 0);
    const withoutDl = quests.filter(q => !q.deadline);

    return `<div class="board-title">Questlog</div>
      <div class="seg">${tabs}</div>
      ${quests.length
        ? renderGroup('Mit Deadline', withDl) + renderGroup('Ohne Deadline', withoutDl)
        : '<div class="empty">— keine Quests in dieser Kategorie —</div>'}
      <form class="add-row add-block" data-action="add-quest">
        <input type="text" placeholder="Neue ${questCat === 'main' ? 'Main' : 'Side'}-Quest …" autocomplete="off" enterkeyhint="done">
        <button type="submit" aria-label="Quest anlegen">${ICONS.plus}</button>
      </form>`;
  }

  function renderLists() {
    const blocks = state.lists.map(l => {
      const doneCount = l.items.filter(i => i.done).length;
      return `<section class="block${l.open ? ' open' : ''}">
        <header class="block-head list-head" data-action="toggle-list" data-id="${l.id}">
          <span class="chev">${ICONS.chevron}</span>
          <h2>${esc(l.name)}</h2>
          <span class="count">${doneCount}/${l.items.length}</span>
          <button class="del" data-action="del-list" data-id="${l.id}" aria-label="Liste löschen">${ICONS.x}</button>
        </header>
        ${l.open ? `
          ${l.items.length
            ? `<ul class="items">${l.items.map(i => `<li class="row${i.done ? ' done' : ''}">
                <button class="checkbox" data-action="toggle-item" data-list="${l.id}" data-id="${i.id}" aria-label="Abhaken">${ICONS.check}</button>
                <span class="row-text">${esc(i.text)}</span>
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
    renderHeaderDate();
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

  /* ---------- Aktionen ---------- */

  view.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || !view.contains(el) || el.tagName === 'FORM') return;
    const { action, id, list: listId, quest: questId } = el.dataset;

    switch (action) {
      case 'quest-cat':
        questCat = el.dataset.cat;
        break;

      case 'toggle-quest-open': {
        const q = state.quests.find(q => q.id === id);
        if (q) q.open = !q.open;
        break;
      }
      case 'toggle-quest': {
        const q = state.quests.find(q => q.id === id);
        if (!q || q.steps.length) return; // mit Schritten: rein abgeleitet
        q.done = !q.done;
        q.doneAt = q.done ? nowISO() : null;
        if (q.done) touchStreak(q.streak);
        break;
      }
      case 'del-quest': {
        const q = state.quests.find(q => q.id === id);
        if (!q || !confirm(`Quest „${q.title}" löschen?`)) return;
        state.quests = state.quests.filter(x => x.id !== id);
        break;
      }
      case 'cycle-prio': {
        const q = state.quests.find(q => q.id === id);
        if (!q) return;
        const i = PRIOS.findIndex(p => p.key === q.priority);
        q.priority = PRIOS[(i + 1) % PRIOS.length].key;
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

  /* Datumsfelder (Start/Ende) — leeres Feld löscht den Wert. */
  view.addEventListener('change', e => {
    const input = e.target.closest('input[type="date"][data-field]');
    if (!input) return;
    const q = state.quests.find(q => q.id === input.dataset.id);
    if (!q) return;
    const v = isDateStr(input.value) ? input.value : null;
    if (input.dataset.field === 'start') q.start = v;
    else q.deadline = v;
    save();
    render();
  });

  view.addEventListener('submit', e => {
    const form = e.target.closest('form[data-action]');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('input');
    const text = input.value.trim();
    if (!text) return;

    switch (form.dataset.action) {
      case 'add-quest':
        state.quests.push({
          id: uid(), title: text, category: questCat,
          done: false, doneAt: null,
          priority: 'mittel', createdAt: todayStr(), start: null, deadline: null,
          steps: [], streak: freshStreak(), open: true,
        });
        refocusSel = 'form[data-action="add-quest"] input';
        break;

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
        parent.done = false; // ehemaliges Blatt wird Ast
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
    render();
  });

  /* Beim Zurückkehren in die App: Tageswechsel erkennen (Restzeiten/Zeitbalken
     aktualisieren, abgelaufene Streaks intern nullen). */
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
  save(); // persistiert die (ggf. migrierte) Struktur unter dem v3-Key
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(e =>
        console.warn('Quest-Log: Service Worker nicht registriert', e));
    });
  }
})();
