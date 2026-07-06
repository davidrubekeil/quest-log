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
    { key: 'skill', label: 'Skills' },
    { key: 'events', label: 'Events' },
    { key: 'erledigt', label: 'Erledigt' },
  ];
  const CATS = [
    { key: 'main', label: 'Main' },
    { key: 'side', label: 'Side' },
    { key: 'skill', label: 'Skill' },
  ];
  const catOptions = sel => CATS.map(c => `<option value="${c.key}"${c.key === sel ? ' selected' : ''}>${c.label}</option>`).join('');
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
  const isTimeStr = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
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
  /* Tagesüberschrift ohne Monat/Jahr (die stehen bereits in der Kalender-Kopfzeile). */
  const dayTitle = d => `${WD_FULL[wdIndexMon(d)]}, der ${d.getDate()}.`;

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

  const newSub = text => ({ id: uid(), text, done: false, doneAt: null, subs: [], open: false, scheduledDate: null });
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
  /* Enthält ein Knoten (Schritt/Unterschritt) irgendwo erledigte Nachfahren? */
  function anyDoneWithin(node) { for (const c of node.subs) { if (subDone(c) || anyDoneWithin(c)) return true; } return false; }
  const isSkill = q => q.category === 'skill';
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

  const emptyState = () => ({ version: 3, lists: [], quests: [], agenda: [], events: [], focusQuestId: null, topTasks: {}, scratchpad: [] });

  function normalizeItem(raw) {
    if (typeof raw === 'string') return { id: uid(), text: raw, done: false };
    if (!raw || typeof raw !== 'object') return null;
    return { id: raw.id || uid(), text: String(raw.text ?? raw.name ?? ''), done: !!raw.done };
  }

  const kidsOf = n => Array.isArray(n.subs) ? n.subs : (Array.isArray(n.steps) ? n.steps : (Array.isArray(n.items) ? n.items : []));

  function normalizeSub(raw) {
    if (typeof raw === 'string') return newSub(raw);
    if (!raw || typeof raw !== 'object') return null;
    return { id: raw.id || uid(), text: String(raw.text ?? raw.name ?? ''), done: !!raw.done, doneAt: raw.doneAt || null, subs: kidsOf(raw).map(normalizeSub).filter(Boolean), open: !!raw.open, scheduledDate: isDateStr(raw.scheduledDate) ? raw.scheduledDate : null };
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
  function normalizeAgendaSub(raw) {
    if (typeof raw === 'string') return { id: uid(), text: raw, done: false, doneAt: null };
    if (!raw || typeof raw !== 'object') return null;
    return { id: raw.id || uid(), text: String(raw.text ?? ''), done: !!raw.done, doneAt: raw.doneAt || null };
  }
  function normalizeAgenda(raw) {
    if (!raw || typeof raw !== 'object' || !isDateStr(raw.date)) return null;
    return {
      id: raw.id || uid(), text: String(raw.text ?? ''), date: raw.date, done: !!raw.done, doneAt: raw.doneAt || null,
      eventId: typeof raw.eventId === 'string' ? raw.eventId : null,
      subs: (Array.isArray(raw.subs) ? raw.subs : []).map(normalizeAgendaSub).filter(Boolean),
    };
  }
  function normalizeEvent(raw) {
    if (!raw || typeof raw !== 'object' || !isDateStr(raw.start)) return null;
    const end = isDateStr(raw.end) ? raw.end : null;
    const multiDay = raw.multiDay !== undefined ? !!raw.multiDay : !!(end && end > raw.start);
    return {
      id: raw.id || uid(), name: String(raw.name ?? raw.title ?? ''), start: raw.start,
      end: multiDay ? (end && end >= raw.start ? end : raw.start) : null,
      multiDay,
      notes: typeof raw.notes === 'string' ? raw.notes : '',
      startTime: multiDay ? null : (isTimeStr(raw.startTime) ? raw.startTime : null),
      endTime: multiDay ? null : (isTimeStr(raw.endTime) ? raw.endTime : null),
    };
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
        category: ['side', 'skill'].includes(q.category) ? q.category : 'main',
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

    // Top-Aufgaben sind pro Tag (Objekt: Datum -> Referenzliste). Migration aus der
    // alten flachen Liste: einem Task nach seinem aktuellen Datum zuordnen.
    const addTop = (map, date, ref) => { if (!isDateStr(date)) return; (map[date] || (map[date] = [])); if (map[date].length < 3) map[date].push(ref); };
    if (Array.isArray(raw.topTasks)) {
      for (const t of raw.topTasks) { if (t && typeof t === 'object' && taskRefExists(s, t)) addTop(s.topTasks, taskRefDate(s, t), t); }
    } else if (raw.topTasks && typeof raw.topTasks === 'object') {
      for (const [date, arr] of Object.entries(raw.topTasks)) {
        if (!isDateStr(date) || !Array.isArray(arr)) continue;
        for (const t of arr) if (t && typeof t === 'object' && taskRefExists(s, t)) addTop(s.topTasks, date, t);
      }
    }

    if (Array.isArray(raw.scratchpad)) {
      s.scratchpad = raw.scratchpad.map(n => (n && typeof n === 'object' && (n.text ?? '') !== '') ? { id: n.id || uid(), text: String(n.text) } : null).filter(Boolean);
    }
    return s;
  }

  /* aktuelles Datum, unter dem eine Top-Referenz einsortiert gehört (für Migration/Validierung) */
  function taskRefDate(s, t) {
    if (t.kind === 'agenda') { const a = s.agenda.find(a => a.id === t.id); return a ? a.date : null; }
    if (t.kind === 'qstep') { const q = s.quests.find(q => q.id === t.questId); const st = q && findStep(q, t.stepId); return st ? st.deadline : null; }
    if (t.kind === 'qsub') { const q = s.quests.find(q => q.id === t.questId); const st = q && findStep(q, t.stepId); const sub = st && findSubRec(st.subs, t.subId); return sub ? sub.scheduledDate : null; }
    return null;
  }

  /* prüft, ob eine Top-Aufgaben-Referenz noch auf einen echten Datensatz zeigt */
  function taskRefExists(s, t) {
    if (t.kind === 'qstep') { const q = s.quests.find(q => q.id === t.questId); const st = q && findStep(q, t.stepId); return !!st; }
    if (t.kind === 'qsub') { const q = s.quests.find(q => q.id === t.questId); const st = q && findStep(q, t.stepId); const sub = st && findSubRec(st.subs, t.subId); return !!sub; }
    if (t.kind === 'agenda') return s.agenda.some(a => a.id === t.id);
    return false;
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
      if (q.category === 'skill') continue; // Skills haben keine Termine/Kalendereinträge
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

  /* ---------- Dashboard (Tagesstartseite) ---------- */

  function taskKey(t) {
    if (t.kind === 'qstep') return `qstep:${t.questId}:${t.stepId}`;
    if (t.kind === 'qsub') return `qsub:${t.questId}:${t.stepId}:${t.subId}`;
    if (t.kind === 'agenda') return `agenda:${t.id}`;
    return '';
  }
  const topList = date => state.topTasks[date] || [];
  const isStarred = (t, date) => topList(date).some(x => taskKey(x) === taskKey(t));
  /* entfernt eine Task-Referenz aus allen Tages-Top-Listen (bei Verschieben/Löschen) */
  function removeFromAllTop(key) {
    for (const date of Object.keys(state.topTasks)) {
      const arr = state.topTasks[date].filter(x => taskKey(x) !== key);
      if (arr.length) state.topTasks[date] = arr; else delete state.topTasks[date];
    }
  }

  /* Container-Schritte (mit Unterschritten), deren Frist auf dateStr fällt — rein informativ, klickbar zur Quest. */
  function collectDayDeadlineSteps(dateStr) {
    const out = [];
    for (const q of state.quests) {
      if (q.category === 'skill') continue;
      for (const s of q.steps) {
        if (s.deadline === dateStr && s.type !== 'laufend' && stepHasSubs(s) && !stepDone(s)) {
          out.push({ questId: q.id, stepId: s.id, text: s.text, questTitle: q.title });
        }
      }
    }
    return out;
  }

  function walkSubsMatching(subs, questId, stepId, questTitle, dateMatches, wantDone, out) {
    for (const sub of subs) {
      if (sub.scheduledDate && subDone(sub) === wantDone && dateMatches(sub.scheduledDate)) {
        out.push({ kind: 'qsub', questId, stepId, subId: sub.id, text: sub.text, questTitle, done: wantDone, subs: sub.subs, refDate: sub.scheduledDate });
      }
      walkSubsMatching(sub.subs, questId, stepId, questTitle, dateMatches, wantDone, out);
    }
  }
  /* Einheitliche Aufgaben-Liste: Quest-Blätter (Frist), Quest-Unterschritte (geplant) und Tagesaufgaben.
     wantDone=false → offene Aufgaben, wantDone=true → das erledigte Gegenstück (Dashboard-Archiv). */
  function collectTasksMatching(dateMatches, wantDone = false) {
    const out = [];
    for (const q of state.quests) {
      if (q.category === 'skill') continue;
      for (const s of q.steps) {
        // Frist-Schritt als Blatt = eigene Tagesaufgabe. Laufend-Schritte selbst nicht,
        // aber ihre terminierten Unterschritte sehr wohl → Teilbaum immer durchlaufen.
        if (s.type !== 'laufend' && !stepHasSubs(s) && s.deadline && s.done === wantDone && dateMatches(s.deadline)) {
          out.push({ kind: 'qstep', questId: q.id, stepId: s.id, text: s.text, questTitle: q.title, done: wantDone, refDate: s.deadline });
        }
        walkSubsMatching(s.subs, q.id, s.id, q.title, dateMatches, wantDone, out);
      }
    }
    for (const a of state.agenda) {
      if (a.done === wantDone && dateMatches(a.date)) out.push({ kind: 'agenda', id: a.id, text: a.text, done: wantDone, subs: a.subs, refDate: a.date });
    }
    return out;
  }
  const collectDayTasks = dateStr => collectTasksMatching(d => d === dateStr, false);
  const collectDoneDayTasks = dateStr => collectTasksMatching(d => d === dateStr, true);
  const collectOverdueTasks = beforeDateStr => collectTasksMatching(d => d < beforeDateStr, false)
    .map(t => ({ ...t, overdueDays: dayDiff(t.refDate, beforeDateStr) }))
    .sort((a, b) => b.overdueDays - a.overdueDays);

  /* Zeit-Label für Events in der Termine-Zeile (an-/abwesende Uhrzeiten je nach Tagesrand). */
  function eventTimeLabel(e, ds) {
    const isStart = ds === e.start, isEnd = ds === eventEnd(e);
    if (isStart && isEnd) return e.startTime && e.endTime ? `${e.startTime}–${e.endTime}` : e.startTime ? `ab ${e.startTime}` : '';
    if (isStart) return e.startTime ? `ab ${e.startTime}` : '';
    if (isEnd) return e.endTime ? `bis ${e.endTime}` : '';
    return '';
  }

  const eventEnd = e => e.end || e.start;
  const eventSpanLabel = e => (e.end && e.end !== e.start) ? `${fmtShort(e.start)}–${fmtShort(e.end)}` : fmtShort(e.start);
  const eventsCovering = ds => state.events.filter(e => e.start <= ds && ds <= eventEnd(e));
  /* Neues Event: mehrtägig startet mit einer Standard-Spanne (Tag + 1), eintägig ohne Uhrzeiten. */
  const makeEvent = (name, start, multiDay) => ({
    id: uid(), name, start, end: multiDay ? addDays(start, 1) : null, multiDay,
    notes: '', startTime: null, endTime: null,
  });
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
  let activeTab = 'calendar';   // Tagesstartseite: Kalender/Tag mit heute als Default
  let questCat = 'main';
  let activeQuestId = null;
  let activeStepId = null;
  let activeEventId = null;
  let stepTab = 'aktuell';
  let dashTab = 'offen';
  let eventTab = 'single';
  let calView = 'tag';
  let calCursor = todayStr();
  let dayStamp = todayStr();
  let refocusSel = null;
  let pendingEditSel = null;

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

  const catField = q => `<label class="sel-field"><span class="sel-label">Reiter</span><select data-sel="cat" data-id="${q.id}">${catOptions(q.category)}</select></label>`;
  const progressRow = q => { const { done, total } = questLeaves(q); return total ? `<div class="progress-row"><span class="pcount">${done}/${total}</span><div class="track"><div class="fill" style="width:${questPct(q)}%"></div></div><span class="pct">${questPct(q)}%</span></div>` : ''; };

  function renderQuestMeta(q) {
    if (isSkill(q)) {
      return `<div class="qmeta"><div class="meta-row">${catField(q)}</div>${progressRow(q)}</div>`;
    }
    const laufend = q.type === 'laufend';
    const p = prioOf(q.priority);
    return `<div class="qmeta">
      <div class="meta-row">
        ${catField(q)}
        <label class="sel-field"><span class="sel-label">Bereich</span><select data-sel="section" data-id="${q.id}">${sectionOptions(q.section)}</select></label>
        <label class="sel-field"><span class="sel-label">Typ</span><select data-sel="type" data-id="${q.id}">${typeOptions(q.type)}</select></label>
        ${laufend ? '' : `<button class="chip prio-btn" data-action="cycle-prio" data-id="${q.id}">${dotHtml(p)}${p.label}</button>`}
      </div>
      ${laufend ? '' : `<div class="meta-row">
        <label class="date-field">Start<input type="date" data-field="start" data-id="${q.id}" value="${q.start || q.createdAt}"></label>
        <label class="date-field">Ende<input type="date" data-field="deadline" data-id="${q.id}" value="${q.deadline || ''}"></label>
      </div>`}
      ${progressRow(q)}
      ${laufend ? '' : timeRow(q)}
    </div>`;
  }

  function renderQuestRow(q, active) {
    const isActive = active && q.id === active.id;
    const isFocus = q.id === state.focusQuestId;
    const skill = isSkill(q);
    const laufend = q.type === 'laufend';
    const p = prioOf(q.priority);
    const pct = questPct(q);
    const eff = questEffDeadline(q);
    const du = eff ? daysUntil(eff) : null;
    const hasSteps = questLeaves(q).total > 0;
    const dot = skill ? 'var(--muted)' : (laufend ? 'var(--flow)' : p.color);
    const tail = skill ? '' : (laufend ? '<span class="flow-badge">laufend</span>' : (du !== null && !q.done ? `<span class="rest${du < 0 ? ' over' : ''}">${fmtRest(du)}</span>` : ''));
    return `<div class="qwrap">
      <div class="qrow${isActive ? ' active' : ''}${isFocus ? ' focus' : ''}${q.done ? ' done' : ''}" data-action="open-quest" data-id="${q.id}">
        ${!hasSteps && !laufend && !skill
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

  /* Aktuell-Ansicht: erledigte Unterschritte werden ausgeblendet (ins Erledigt-Archiv). */
  function renderSub(sub, questId, stepId, nextId, showNext) {
    const hasKids = sub.subs.length > 0;
    const done = subDone(sub);
    const isNext = sub.id === nextId;
    const hasNextInside = nextId && !isNext && !!findSubRec(sub.subs, nextId);
    const { done: sd, total: st } = subLeaves(sub);
    const control = hasKids
      ? `<span class="branch-mark${done ? ' full' : ''}">${sd}/${st}</span>`
      : `<button class="checkbox" data-action="toggle-sub" data-quest="${questId}" data-step="${stepId}" data-id="${sub.id}" aria-label="Abhaken">${ICONS.check}</button>`;
    const kids = sub.subs.filter(k => !subDone(k));
    // Jeder Unterschritt lässt sich mit Datum als Tagesaufgabe aufs Dashboard legen (bei Skills nicht).
    // Das native Datumsfeld bleibt unsichtbar; ein Klick öffnet direkt den OS-Datumsdialog (showPicker),
    // damit in der schmalen Schritt-Spalte kein breites Eingabefeld den Text zerquetscht.
    const dref = ` data-quest="${questId}" data-step="${stepId}" data-id="${sub.id}"`;
    const schedule = showNext
      ? `<span class="sub-sched${sub.scheduledDate ? ' set' : ''}">
          ${sub.scheduledDate
            ? `<button type="button" class="sub-sched-chip" data-action="sub-sched-open"${dref} title="Tagesaufgabe am ${fmtShort(sub.scheduledDate)} — Datum ändern">${fmtShort(sub.scheduledDate)}</button>`
            : `<button type="button" class="sub-schedule-btn" data-action="sub-sched-open"${dref} aria-label="Als Tagesaufgabe planen" title="Als Tagesaufgabe aufs Dashboard legen">${ICONS.calendar}</button>`}
          <input type="date" class="sub-sched-input" data-field="sub-schedule"${dref} value="${sub.scheduledDate || ''}" tabindex="-1" aria-hidden="true">
          ${sub.scheduledDate ? `<button class="sub-sched-clear" data-action="sub-sched-clear"${dref} aria-label="Planung entfernen" title="Planung entfernen">${ICONS.x}</button>` : ''}
        </span>`
      : '';
    return `<li class="node sub${isNext ? ' next' : ''}${hasNextInside ? ' has-next' : ''}${sub.open ? ' open' : ''}${sub.scheduledDate ? ' scheduled' : ''}">
      <div class="node-row">
        <button class="chev" data-action="toggle-sub-open" data-quest="${questId}" data-step="${stepId}" data-id="${sub.id}" aria-label="Auf-/Zuklappen">${ICONS.chevron}</button>
        <span class="node-control">${control}</span>
        <span class="row-text editable" data-edit="sub-text" data-quest="${questId}" data-step="${stepId}" data-id="${sub.id}">${esc(sub.text)}</span>
        ${schedule}
        ${showNext ? nextBtn(questId, sub.id, isNext) : ''}
        <button class="del" data-action="del-sub" data-quest="${questId}" data-step="${stepId}" data-id="${sub.id}" aria-label="Löschen">${ICONS.x}</button>
      </div>
      ${sub.open ? `<ul class="subtree">
        ${kids.map(k => renderSub(k, questId, stepId, nextId, showNext)).join('')}
        <li class="add-sub">${addMini('add-sub', 'Unterschritt', ` data-quest="${questId}" data-step="${stepId}" data-parent="${sub.id}"`)}</li>
      </ul>` : ''}
    </li>`;
  }

  function renderStep(s, questId, nextId, showNext) {
    const hasSubs = stepHasSubs(s);
    const sel = s.id === activeStepId;
    const isNext = s.id === nextId;
    const hasNextInside = nextId && !isNext && !!findSubRec(s.subs, nextId);
    const { done: sd, total: st } = stepLeaves(s);
    const eff = stepEffDeadline(s);
    const du = eff ? daysUntil(eff) : null;
    const control = hasSubs
      ? `<span class="branch-mark">${sd}/${st}</span>`
      : `<button class="checkbox" data-action="toggle-step" data-quest="${questId}" data-id="${s.id}" aria-label="Abhaken">${ICONS.check}</button>`;
    const tail = showNext && s.type === 'laufend' ? '<span class="flow-badge">laufend</span>' : (showNext && du !== null ? `<span class="rest${du < 0 ? ' over' : ''}">${fmtRest(du)}</span>` : '');
    const kids = s.subs.filter(sub => !subDone(sub));
    return `<li class="node step${sel ? ' sel' : ''}${isNext ? ' next' : ''}${hasNextInside ? ' has-next' : ''}${s.open ? ' open' : ''}">
      <div class="node-row" data-action="select-step" data-quest="${questId}" data-id="${s.id}">
        <button class="chev" data-action="toggle-step-open" data-quest="${questId}" data-id="${s.id}" aria-label="Auf-/Zuklappen">${ICONS.chevron}</button>
        <span class="node-control">${control}</span>
        <span class="row-text${sel ? ' editable' : ''}"${sel ? ` data-edit="step-text" data-quest="${questId}" data-id="${s.id}"` : ''}>${esc(s.text)}</span>
        ${tail}
        ${showNext ? nextBtn(questId, s.id, isNext) : ''}
        <button class="del" data-action="del-step" data-quest="${questId}" data-id="${s.id}" aria-label="Löschen">${ICONS.x}</button>
      </div>
      ${s.open ? `<ul class="subtree">
        ${kids.map(sub => renderSub(sub, questId, s.id, nextId, showNext)).join('')}
        <li class="add-sub">${addMini('add-sub', 'Unterschritt', ` data-quest="${questId}" data-step="${s.id}"`)}</li>
      </ul>` : ''}
    </li>`;
  }

  /* Erledigt-Archiv: erledigte Knoten in ihrer Hierarchie, ausgegraut; nicht-erledigte
     Vorfahren als blasser Kontext. Erledigte Blätter lassen sich zum Reaktivieren abhaken. */
  function renderDoneSub(sub, questId, stepId) {
    const done = subDone(sub);
    const hasKids = sub.subs.length > 0;
    const kids = sub.subs.filter(k => subDone(k) || anyDoneWithin(k));
    const { done: sd, total: st } = subLeaves(sub);
    const control = hasKids
      ? `<span class="branch-mark${done ? ' full' : ''}">${sd}/${st}</span>`
      : `<button class="checkbox" data-action="toggle-sub" data-quest="${questId}" data-step="${stepId}" data-id="${sub.id}" aria-label="Reaktivieren">${ICONS.check}</button>`;
    return `<li class="node sub arch${done ? ' done' : ' context'}">
      <div class="node-row"><span class="node-control">${control}</span><span class="row-text">${esc(sub.text)}</span></div>
      ${kids.length ? `<ul class="subtree">${kids.map(k => renderDoneSub(k, questId, stepId)).join('')}</ul>` : ''}
    </li>`;
  }
  function renderDoneStep(s, questId) {
    const done = stepDone(s);
    const hasSubs = stepHasSubs(s);
    const kids = s.subs.filter(k => subDone(k) || anyDoneWithin(k));
    const { done: sd, total: st } = stepLeaves(s);
    const control = hasSubs
      ? `<span class="branch-mark${done ? ' full' : ''}">${sd}/${st}</span>`
      : `<button class="checkbox" data-action="toggle-step" data-quest="${questId}" data-id="${s.id}" aria-label="Reaktivieren">${ICONS.check}</button>`;
    return `<li class="node step arch${done ? ' done' : ' context'}">
      <div class="node-row"><span class="node-control">${control}</span><span class="row-text">${esc(s.text)}</span></div>
      ${kids.length ? `<ul class="subtree">${kids.map(k => renderDoneSub(k, questId, s.id)).join('')}</ul>` : ''}
    </li>`;
  }

  function renderStepsCol(q) {
    const showNext = !isSkill(q);
    const activeSteps = q.steps.filter(s => !stepDone(s));
    const doneLeaves = questLeaves(q).done;
    let body;
    if (stepTab === 'erledigt') {
      const rows = q.steps.filter(s => stepDone(s) || anyDoneWithin(s)).map(s => renderDoneStep(s, q.id)).join('');
      body = rows || '<div class="empty">— nichts erledigt —</div>';
    } else {
      const list = activeSteps.slice().sort(byStepUrgency);
      body = list.length ? list.map(s => renderStep(s, q.id, q.nextStepId, showNext)).join('') : '<div class="empty">— keine Schritte —</div>';
    }
    return `<div class="col-steps">
      <div class="step-tabs">
        <button data-action="step-tab" data-tab="aktuell" class="${stepTab === 'aktuell' ? 'active' : ''}">Schritte<span class="seg-count">${activeSteps.length}</span></button>
        <button data-action="step-tab" data-tab="erledigt" class="${stepTab === 'erledigt' ? 'active' : ''}">Erledigt<span class="seg-count">${doneLeaves}</span></button>
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
    const skill = isSkill(q);
    const step = activeStepId ? findStep(q, activeStepId) : null;
    if (skill) {
      if (step) {
        return `<div class="col-notes">
          <div class="col-head">Kontext · Schritt<button class="ctx-up" data-action="deselect-step">↑ Skill</button></div>
          <div class="ctx-title">${esc(step.text)}</div>
          <div class="ctx-label">Notizen</div>
          <textarea class="notes" data-step-notes data-quest="${q.id}" data-id="${step.id}" placeholder="Notizen zum Schritt …">${esc(step.notes)}</textarea>
        </div>`;
      }
      return `<div class="col-notes">
        <div class="col-head">Notizen</div>
        <textarea class="notes" data-notes data-id="${q.id}" placeholder="Notizen zum Skill …">${esc(q.notes)}</textarea>
      </div>`;
    }
    if (step) {
      const laufend = step.type === 'laufend';
      const isNext = q.nextStepId === step.id;
      return `<div class="col-notes">
        <div class="col-head">Kontext · Schritt<button class="ctx-up" data-action="deselect-step">↑ Quest</button></div>
        <div class="ctx-title">${esc(step.text)}</div>
        <div class="meta-row">
          <label class="sel-field"><span class="sel-label">Typ</span><select data-sel="step-type" data-quest="${q.id}" data-id="${step.id}">${typeOptions(step.type)}</select></label>
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
    // Verknüpfte Aufgaben (eventId) unabhängig vom Datum + unverknüpfte Aufgaben in der Event-Spanne.
    const tasks = state.agenda
      .filter(a => a.eventId === e.id || (!a.eventId && a.date >= e.start && a.date <= eventEnd(e)))
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    const taskRows = tasks.map(a => {
      const subRows = a.subs.length ? `<ul class="dash-subs">${a.subs.map(sub => `<li class="row${sub.done ? ' done' : ''}"><button class="checkbox" data-action="toggle-agenda-sub" data-agenda="${a.id}" data-id="${sub.id}" aria-label="Abhaken">${ICONS.check}</button><span class="row-text">${esc(sub.text)}</span><button class="del" data-action="del-agenda-sub" data-agenda="${a.id}" data-id="${sub.id}" aria-label="Löschen">${ICONS.x}</button></li>`).join('')}</ul>` : '';
      const early = a.date < e.start ? ' before' : '';
      return `<li class="row${a.done ? ' done' : ''}"><button class="checkbox" data-action="toggle-agenda" data-id="${a.id}" aria-label="Abhaken">${ICONS.check}</button><span class="row-text editable" data-edit="agenda-text" data-id="${a.id}">${esc(a.text)}</span><input class="ev-task-dateinput${early}" type="date" data-field="agenda-date" data-id="${a.id}" value="${a.date}" title="Datum der Aufgabe"><button class="del" data-action="del-agenda" data-id="${a.id}" aria-label="Löschen">${ICONS.x}</button></li>${subRows}`;
    }).join('');
    const dateFields = e.multiDay
      ? `<div class="meta-row">
        <label class="date-field">Von<input type="date" data-field="ev-start" data-id="${e.id}" value="${e.start}"></label>
        <label class="date-field">Bis<input type="date" data-field="ev-end" data-id="${e.id}" value="${e.end || ''}"></label>
      </div>`
      : `<div class="meta-row">
        <label class="date-field">Datum<input type="date" data-field="ev-start" data-id="${e.id}" value="${e.start}"></label>
      </div>
      <div class="meta-row">
        <label class="date-field">Uhrzeit von<input type="time" data-field="ev-start-time" data-id="${e.id}" value="${e.startTime || ''}"></label>
        <label class="date-field">Uhrzeit bis<input type="time" data-field="ev-end-time" data-id="${e.id}" value="${e.endTime || ''}"></label>
      </div>`;
    return `<div class="col-notes">
      <div class="col-head">Event · ${e.multiDay ? 'mehrtägig' : 'eintägig'}</div>
      <button class="ctx-title ctx-title-link" data-action="open-event-month" data-id="${e.id}" title="Im Kalender anzeigen">${esc(e.name)}</button>
      ${dateFields}
      <div class="ctx-block">
        <div class="ctx-label">Tagesaufgaben</div>
        <ul class="items">${taskRows}</ul>
        ${addMini('add-agenda', 'Tagesaufgabe', ` data-date="${e.start}" data-event="${e.id}"`)}
      </div>
      <div class="ctx-block">
        <div class="ctx-label">Notizen</div>
        <textarea class="notes" data-ev-notes data-id="${e.id}" placeholder="Notizen zum Event …">${esc(e.notes)}</textarea>
      </div>
    </div>`;
  }

  function renderEvents() {
    const wantMulti = eventTab === 'multi';
    const events = state.events.slice()
      .filter(e => !!e.multiDay === wantMulti)
      .sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
    const active = activeEventId ? events.find(e => e.id === activeEventId) : null;
    const singleCount = state.events.filter(e => !e.multiDay).length;
    const multiCount = state.events.filter(e => e.multiDay).length;
    const tabs = `<div class="step-tabs">
      <button data-action="event-tab" data-tab="single" class="${eventTab === 'single' ? 'active' : ''}">Eintägig<span class="seg-count">${singleCount}</span></button>
      <button data-action="event-tab" data-tab="multi" class="${eventTab === 'multi' ? 'active' : ''}">Mehrtägig<span class="seg-count">${multiCount}</span></button>
    </div>`;
    const list = events.length ? events.map(e => renderEventRow(e, active)).join('') : `<div class="empty">— keine ${wantMulti ? 'mehrtägigen' : 'eintägigen'} Events —</div>`;
    return `<div class="ev-board${active ? ' detail has-active' : ''}">
      ${active ? '<div class="detail-bar"><button class="back" data-action="close-event">← Übersicht</button></div>' : ''}
      <div class="ev-list">${tabs}${list}${addMini('add-event', wantMulti ? 'Neues mehrtägiges Event' : 'Neues eintägiges Event')}</div>
      ${active ? renderEventContext(active) : ''}
    </div>`;
  }

  const backBar = '<div class="detail-bar"><button class="back" data-action="close-quest">← Übersicht</button></div>';

  function renderQuests() {
    const counts = {
      main: state.quests.filter(q => q.category === 'main' && !q.done).length,
      side: state.quests.filter(q => q.category === 'side' && !q.done).length,
      skill: state.quests.filter(q => q.category === 'skill' && !q.done).length,
      events: state.events.length,
      erledigt: state.quests.filter(q => q.done).length,
    };
    const tabs = QUEST_TABS.map(c => `<button data-action="quest-cat" data-cat="${c.key}" class="${questCat === c.key ? 'active' : ''}">${c.label}<span class="seg-count">${counts[c.key]}</span></button>`).join('');
    const head = `<div class="board-title">Questlog</div><div class="seg">${tabs}</div>`;

    if (questCat === 'events') return head + renderEvents();
    if (questCat === 'erledigt') return head + renderArchive();

    if (questCat === 'skill') {
      const inTab = state.quests.filter(q => q.category === 'skill' && !q.done);
      const active = activeQuestId ? inTab.find(q => q.id === activeQuestId) : null;
      const rows = inTab.length ? inTab.map(q => renderQuestRow(q, active)).join('') : '';
      return head + `<div class="board${active ? ' detail has-active' : ''}">
        ${active ? backBar : ''}
        <div class="col-list"><section class="board-section${active ? ' has-active' : ''}"><div class="section-title">Skills</div>${rows || '<div class="empty">— keine Skills —</div>'}${addMini('add-quest', 'Neuer Skill', ' data-section="studium"')}</section></div>
        ${active ? renderStepsCol(active) + renderContextCol(active) : ''}
      </div>`;
    }

    const inTab = state.quests.filter(q => q.category === questCat && !q.done);
    const active = activeQuestId ? inTab.find(q => q.id === activeQuestId) : null;
    const sections = SECTIONS.map(sec => renderSection(sec, inTab.filter(q => q.section === sec.key), active)).join('');
    return head + `<div class="board${active ? ' detail has-active' : ''}">
      ${active ? backBar : ''}
      <div class="col-list">${sections}</div>
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
      cells += `<div class="cal-cell${d.getMonth() === c.getMonth() ? '' : ' other'}${ds === todayStr() ? ' today' : ''}" data-action="cal-day" data-date="${ds}"><span class="cal-daynum">${d.getDate()}</span><button class="cal-add" data-action="cal-add-event" data-date="${ds}" aria-label="Event hinzufügen" title="Event hinzufügen">${ICONS.plus}</button>${bars}${chips}${more}</div>`;
    }
    return `<div class="cal-grid">${weekdays}${cells}</div>`;
  }

  function calEntryRow(e) {
    if (e.kind === 'step') return `<li class="row${e.done ? ' done' : ''}"><button class="checkbox" data-action="toggle-step" data-quest="${e.questId}" data-id="${e.stepId}" aria-label="Abhaken">${ICONS.check}</button><span class="row-text">${esc(e.text)}</span><button class="cal-ctx" data-action="open-quest-from-cal" data-id="${e.questId}">${esc(e.questTitle)}</button></li>`;
    if (e.kind === 'agenda') return `<li class="row${e.done ? ' done' : ''}"><button class="checkbox" data-action="toggle-agenda" data-id="${e.id}" aria-label="Abhaken">${ICONS.check}</button><span class="row-text">${esc(e.text)}</span><button class="del" data-action="del-agenda" data-id="${e.id}" aria-label="Löschen">${ICONS.x}</button></li>`;
    const tag = e.kind === 'quest' ? 'Quest-Frist' : e.kind === 'milestone' ? 'Milestone' : 'Frist';
    return `<li class="row marker"><span class="cdot" style="background:${DOT[e.kind]}"></span><button class="marker-link" data-action="open-quest-from-cal" data-id="${e.questId}">${esc(e.text)}${e.kind !== 'quest' ? ` · ${esc(e.questTitle)}` : ''}</button><span class="marker-tag">${tag}</span></li>`;
  }

  function renderPlainDay(byDate) {
    const items = byDate[calCursor] || [];
    const markers = items.filter(e => !e.checkable);
    const steps = items.filter(e => e.kind === 'step');
    const tasks = items.filter(e => e.kind === 'agenda');
    const d = parseDate(calCursor);
    const evCover = eventsCovering(calCursor);
    const group = (label, arr) => arr.length ? `<div class="day-group"><div class="day-group-label">${label}</div><ul class="items">${arr.map(calEntryRow).join('')}</ul></div>` : '';
    const evGroup = evCover.length ? `<div class="day-group"><div class="day-group-label">Events</div><ul class="items">${evCover.map(e => `<li class="row marker"><span class="cdot" style="background:${EVENT_COLOR}"></span><button class="marker-link" data-action="open-event-cal" data-id="${e.id}">${esc(e.name)}${eventTimeLabel(e, calCursor) ? ` · ${eventTimeLabel(e, calCursor)}` : ''}</button><span class="marker-tag">${eventSpanLabel(e)}</span></li>`).join('')}</ul></div>` : '';
    const body = (evCover.length || markers.length || steps.length || tasks.length) ? evGroup + group('Fristen', markers) + group('Schritte', steps) + group('Aufgaben', tasks) : '<div class="empty">— nichts an diesem Tag —</div>';
    return `<div class="day-view"><div class="day-head"><span class="day-title">${dayTitle(d)}</span></div>${body}
      <form class="add-row add-agenda" data-action="add-agenda" data-date="${calCursor}"><input type="text" placeholder="Aufgabe für diesen Tag …" autocomplete="off" enterkeyhint="done"><button type="submit" aria-label="Hinzufügen">${ICONS.plus}</button></form></div>`;
  }

  /* ---------- Dashboard-Rendering (heutiger Tag) ---------- */

  /* Unterschritte eines terminierten Schrittes als verschachtelte Teilaufgaben der Tagesaufgabe.
     Erledigte werden ausgeblendet (wie in der Quest-Aktuell-Ansicht); Blätter abhakbar, Zwischen-
     ebenen mit Fortschrittsmarke. Abhaken/Umbenennen/Löschen wirken direkt in die Quest zurück. */
  function dashSubTree(subs, questId, stepId) {
    return subs.filter(s => !subDone(s)).map(sub => {
      const hasKids = sub.subs.length > 0;
      const { done, total } = subLeaves(sub);
      const control = hasKids
        ? `<span class="branch-mark dash-branch">${done}/${total}</span>`
        : `<button class="checkbox" data-action="toggle-sub" data-quest="${questId}" data-step="${stepId}" data-id="${sub.id}" aria-label="Abhaken">${ICONS.check}</button>`;
      return `<li class="row">${control}<span class="row-text editable" data-edit="sub-text" data-quest="${questId}" data-step="${stepId}" data-id="${sub.id}">${esc(sub.text)}</span><button class="del" data-action="del-sub" data-quest="${questId}" data-step="${stepId}" data-id="${sub.id}" aria-label="Löschen">${ICONS.x}</button></li>${hasKids ? `<ul class="dash-subs">${dashSubTree(sub.subs, questId, stepId)}</ul>` : ''}`;
    }).join('');
  }

  function dashTaskRow(t, opts = {}) {
    const { starButton = true, arrowIndex = -1, arrowsLen = 0, canStar = true, showSubForm = true, taskActions = false, date = todayStr() } = opts;
    const nextDate = addDays(date, 1);
    // Branch-Unterschritt (mit Kindern) ist nicht direkt abhakbar → Fortschrittsmarke statt Checkbox.
    const isBranch = t.kind === 'qsub' && t.subs && t.subs.length > 0;
    const branchLeaves = isBranch ? t.subs.reduce((a, c) => { const r = subLeaves(c); return { done: a.done + r.done, total: a.total + r.total }; }, { done: 0, total: 0 }) : null;
    const checkAttr = t.kind === 'qstep' ? `data-action="toggle-step" data-quest="${t.questId}" data-id="${t.stepId}"`
      : t.kind === 'qsub' ? `data-action="toggle-sub" data-quest="${t.questId}" data-step="${t.stepId}" data-id="${t.subId}"`
      : `data-action="toggle-agenda" data-id="${t.id}"`;
    const control = isBranch
      ? `<span class="branch-mark dash-branch" title="Teilaufgaben unten abhaken">${branchLeaves.done}/${branchLeaves.total}</span>`
      : `<button class="checkbox" ${checkAttr} aria-label="Abhaken">${ICONS.check}</button>`;
    // Namen umbenennbar (nutzt die bestehende Edit-Mechanik je nach Aufgaben-Typ).
    const editAttr = t.kind === 'qstep' ? `data-edit="step-text" data-quest="${t.questId}" data-id="${t.stepId}"`
      : t.kind === 'qsub' ? `data-edit="sub-text" data-quest="${t.questId}" data-step="${t.stepId}" data-id="${t.subId}"`
      : `data-edit="agenda-text" data-id="${t.id}"`;
    const delAttr = t.kind === 'qstep' ? `data-action="del-step" data-quest="${t.questId}" data-id="${t.stepId}"`
      : t.kind === 'qsub' ? `data-action="del-sub" data-quest="${t.questId}" data-step="${t.stepId}" data-id="${t.subId}"`
      : `data-action="del-agenda" data-id="${t.id}"`;
    const pushAttr = t.kind === 'qstep' ? `data-kind="qstep" data-quest="${t.questId}" data-step="${t.stepId}"`
      : t.kind === 'qsub' ? `data-kind="qsub" data-quest="${t.questId}" data-step="${t.stepId}" data-sub="${t.subId}"`
      : `data-kind="agenda" data-id="${t.id}"`;
    const questTag = (t.kind === 'qstep' || t.kind === 'qsub') ? `<button class="dash-tag" data-action="open-quest-from-cal" data-id="${t.questId}">${esc(t.questTitle)}</button>` : '';
    const overdueTag = t.overdueDays ? `<span class="dash-overdue-tag">seit ${t.overdueDays} ${t.overdueDays === 1 ? 'Tag' : 'Tagen'} überfällig</span>` : '';
    const starAttr = `data-kind="${t.kind}" data-date="${date}"${t.questId ? ` data-quest="${t.questId}"` : ''}${t.stepId ? ` data-step="${t.stepId}"` : ''}${t.subId ? ` data-sub="${t.subId}"` : ''}${t.id ? ` data-id="${t.id}"` : ''}`;
    const push = taskActions ? `<button class="dash-push" data-action="task-push" ${pushAttr} data-next="${nextDate}" aria-label="Auf nächsten Tag verschieben" title="Auf nächsten Tag verschieben">${ICONS.arrowRight}</button>` : '';
    const del = taskActions ? `<button class="del" ${delAttr} aria-label="Aufgabe löschen">${ICONS.x}</button>` : '';
    const star = starButton ? `<button class="star${isStarred(t, date) ? ' active' : ''}" data-action="toggle-star" ${starAttr}${!canStar ? ' disabled' : ''} aria-label="Als Top-Aufgabe markieren">${ICONS.star}</button>` : '';
    const arrows = arrowsLen > 1 ? `<span class="arrows">
        <button class="arrow-up" data-action="topTask-up" data-date="${date}" data-index="${arrowIndex}"${arrowIndex === 0 ? ' disabled' : ''} aria-label="Nach oben">${ICONS.chevron}</button>
        <button class="arrow-down" data-action="topTask-down" data-date="${date}" data-index="${arrowIndex}"${arrowIndex === arrowsLen - 1 ? ' disabled' : ''} aria-label="Nach unten">${ICONS.chevron}</button>
      </span>` : '';
    const subForm = !showSubForm ? '' : t.kind === 'agenda'
      ? addMini('dash-add-agenda-sub', 'Unterschritt', ` data-agenda="${t.id}"`)
      : addMini('dash-add-qsub', 'Unterschritt', ` data-quest="${t.questId}" data-step="${t.stepId}"${t.kind === 'qsub' ? ` data-parent="${t.subId}"` : ''}`);
    const subsList = (t.kind === 'agenda' && t.subs && t.subs.length)
      ? `<ul class="dash-subs">${t.subs.map(sub => `<li class="row${sub.done ? ' done' : ''}"><button class="checkbox" data-action="toggle-agenda-sub" data-agenda="${t.id}" data-id="${sub.id}" aria-label="Abhaken">${ICONS.check}</button><span class="row-text">${esc(sub.text)}</span><button class="del" data-action="del-agenda-sub" data-agenda="${t.id}" data-id="${sub.id}" aria-label="Löschen">${ICONS.x}</button></li>`).join('')}</ul>`
      : (isBranch ? `<ul class="dash-subs">${dashSubTree(t.subs, t.questId, t.stepId)}</ul>` : '');
    return `<li class="dash-task${t.done ? ' done' : ''}">
      <div class="row">
        ${control}
        <span class="row-text editable" ${editAttr}>${esc(t.text)}</span>
        ${questTag}${overdueTag}${push}${del}${star}${arrows}
      </div>
      ${subsList}${subForm}
    </li>`;
  }

  /* Löst eine Top-Referenz für einen bestimmten Tag auf; verwirft sie, wenn die Aufgabe
     nicht mehr existiert oder inzwischen an einem anderen Tag liegt (z. B. verschoben). */
  function resolveTopTask(ref, dateStr) {
    if (ref.kind === 'qstep') { const q = state.quests.find(q => q.id === ref.questId); const s = q && findStep(q, ref.stepId); if (!s || s.deadline !== dateStr) return null; return { kind: 'qstep', questId: q.id, stepId: s.id, text: s.text, questTitle: q.title, done: stepDone(s) }; }
    if (ref.kind === 'qsub') { const q = state.quests.find(q => q.id === ref.questId); const s = q && findStep(q, ref.stepId); const sub = s && findSubRec(s.subs, ref.subId); if (!sub || sub.scheduledDate !== dateStr) return null; return { kind: 'qsub', questId: q.id, stepId: s.id, subId: sub.id, text: sub.text, questTitle: q.title, done: subDone(sub) }; }
    if (ref.kind === 'agenda') { const a = state.agenda.find(a => a.id === ref.id); if (!a || a.date !== dateStr) return null; return { kind: 'agenda', id: a.id, text: a.text, done: a.done, subs: a.subs }; }
    return null;
  }

  function renderScratchpad() {
    const items = state.scratchpad.map(n => `<li class="scratch-item"><span class="scratch-bullet">•</span><span class="row-text editable" data-edit="scratch-text" data-id="${n.id}">${esc(n.text)}</span><button class="del" data-action="del-scratch" data-id="${n.id}" aria-label="Löschen">${ICONS.x}</button></li>`).join('');
    return `<div class="dash-scratch">
      <div class="dash-label">Gedanken</div>
      <ul class="scratch-list">${items}</ul>
      <form class="add-row add-scratch" data-action="add-scratch"><input type="text" placeholder="Gedanke …" autocomplete="off" enterkeyhint="done"><button type="submit" aria-label="Hinzufügen">${ICONS.plus}</button></form>
    </div>`;
  }

  function renderDashboard(dateStr) {
    const d = parseDate(dateStr);
    const isToday = dateStr === todayStr();
    const evCover = eventsCovering(dateStr);
    const deadlineSteps = collectDayDeadlineSteps(dateStr);
    const termineRows = [
      ...evCover.map(e => `<li class="row marker"><span class="cdot" style="background:${EVENT_COLOR}"></span><button class="marker-link" data-action="open-event-cal" data-id="${e.id}">${esc(e.name)}${eventTimeLabel(e, dateStr) ? ` · ${eventTimeLabel(e, dateStr)}` : ''}</button><span class="marker-tag">${eventSpanLabel(e)}</span></li>`),
      ...deadlineSteps.map(s => `<li class="row marker"><span class="cdot" style="background:${DOT.branch}"></span><button class="marker-link" data-action="open-quest-from-cal" data-id="${s.questId}">${esc(s.text)} · ${esc(s.questTitle)}</button><span class="marker-tag">Frist</span></li>`),
    ].join('');
    const termine = termineRows ? `<div class="dash-termine"><ul class="items">${termineRows}</ul></div>` : '';

    const topRefs = topList(dateStr).map(ref => resolveTopTask(ref, dateStr)).filter(Boolean);
    const topKeys = new Set(topRefs.map(taskKey));
    const allTasks = collectDayTasks(dateStr).filter(t => !topKeys.has(taskKey(t)));
    const overdue = isToday ? collectOverdueTasks(dateStr).filter(t => !topKeys.has(taskKey(t))) : [];
    const canStar = topRefs.length < 3;

    const topBox = `<div class="dash-top"><div class="dash-label">Top-Aufgaben${topRefs.length ? '' : ' <span class="dash-hint">— mit ★ markieren</span>'}</div>
      ${topRefs.length ? `<ul class="items">${topRefs.map((t, i) => dashTaskRow(t, { date: dateStr, arrowIndex: i, arrowsLen: topRefs.length })).join('')}</ul>` : ''}
    </div>`;

    const overdueBox = overdue.length ? `<div class="dash-overdue"><div class="dash-label warn">Überfällig</div><ul class="items">${overdue.map(t => dashTaskRow(t, { date: dateStr, canStar, taskActions: true })).join('')}</ul></div>` : '';

    const doneTasks = collectDoneDayTasks(dateStr).filter(t => !topKeys.has(taskKey(t)));
    const dashTabs = `<div class="step-tabs">
      <button data-action="dash-tab" data-tab="offen" class="${dashTab === 'offen' ? 'active' : ''}">Offen<span class="seg-count">${allTasks.length}</span></button>
      <button data-action="dash-tab" data-tab="erledigt" class="${dashTab === 'erledigt' ? 'active' : ''}">Erledigt<span class="seg-count">${doneTasks.length}</span></button>
    </div>`;
    const openList = allTasks.length ? `<ul class="items">${allTasks.map(t => dashTaskRow(t, { date: dateStr, canStar, taskActions: true })).join('')}</ul>` : '<div class="empty">— keine Aufgaben —</div>';
    const doneList = doneTasks.length ? `<ul class="items">${doneTasks.map(t => dashTaskRow(t, { date: dateStr, starButton: false, showSubForm: false })).join('')}</ul>` : '<div class="empty">— nichts erledigt —</div>';

    const tasksBox = `<div class="dash-tasks">
      ${dashTabs}
      ${dashTab === 'erledigt' ? doneList : openList}
      ${dashTab === 'offen' ? `<form class="add-row add-agenda" data-action="add-agenda" data-date="${dateStr}"><input type="text" placeholder="${isToday ? 'Aufgabe für heute …' : 'Aufgabe für diesen Tag …'}" autocomplete="off" enterkeyhint="done"><button type="submit" aria-label="Hinzufügen">${ICONS.plus}</button></form>` : ''}
    </div>`;

    return `<div class="dashboard">
      <div class="dash-main">
        <div class="day-head"><span class="day-title">${dayTitle(d)}</span></div>
        ${termine}
        ${topBox}
        ${overdueBox}
        ${tasksBox}
      </div>
      <div class="dash-side">${renderScratchpad()}</div>
    </div>`;
  }

  /* Dashboard für heute und künftige Tage; vergangene Tage weiterhin als einfache Liste. */
  function renderDay(byDate) { return calCursor >= todayStr() ? renderDashboard(calCursor) : renderPlainDay(byDate); }

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
    if (pendingEditSel) { const el = view.querySelector(pendingEditSel); pendingEditSel = null; if (el) startEdit(el); }
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
      case 'agenda-text': { const a = state.agenda.find(a => a.id === ds.id); if (a) a.text = val; break; }
      case 'scratch-text': { const n = state.scratchpad.find(n => n.id === ds.id); if (n) n.text = val; break; }
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
      case 'event-tab': eventTab = el.dataset.tab === 'multi' ? 'multi' : 'single'; activeEventId = null; break;
      case 'del-event': { const ev = state.events.find(x => x.id === id); if (!ev || !confirm(`Event „${ev.name}" löschen?`)) return; state.events = state.events.filter(x => x.id !== id); if (id === activeEventId) activeEventId = null; break; }
      case 'open-event-cal': { const ev = state.events.find(x => x.id === id); activeTab = 'quests'; questCat = 'events'; eventTab = ev && ev.multiDay ? 'multi' : 'single'; activeEventId = id; activeQuestId = null; activeStepId = null; break; }
      case 'open-event-month': { const ev = state.events.find(x => x.id === id); if (!ev) return; activeTab = 'calendar'; calView = 'monat'; calCursor = ev.start; break; }
      case 'cal-add-event': { const date = isDateStr(el.dataset.date) ? el.dataset.date : todayStr(); const ev = makeEvent('Neues Event', date, false); state.events.push(ev); activeTab = 'quests'; questCat = 'events'; eventTab = 'single'; activeEventId = ev.id; activeQuestId = null; activeStepId = null; pendingEditSel = '.ev-name.editable'; break; }

      case 'open-quest': if (id !== activeQuestId) { activeQuestId = id; activeStepId = null; stepTab = 'aktuell'; } else return; break;
      case 'close-quest': activeQuestId = null; activeStepId = null; break;

      case 'toggle-quest': { const q = state.quests.find(q => q.id === id); if (!q || q.steps.length) return; q.done = !q.done; q.doneAt = q.done ? nowISO() : null; if (q.done) { touchStreak(q.streak); if (id === activeQuestId) activeQuestId = null; } break; }
      case 'del-quest': { const q = state.quests.find(q => q.id === id); if (!q || !confirm(`Quest „${q.title}" löschen?`)) return; state.quests = state.quests.filter(x => x.id !== id); if (id === state.focusQuestId) state.focusQuestId = null; if (id === activeQuestId) { activeQuestId = null; activeStepId = null; } break; }
      case 'reactivate-quest': { const q = state.quests.find(q => q.id === id); if (!q) return; if (q.steps.length) reopenFirstLeaf(q); else { q.done = false; q.doneAt = null; } syncQuestDone(q); break; }
      case 'cycle-prio': { const q = state.quests.find(q => q.id === id); if (!q) return; const i = PRIOS.findIndex(p => p.key === q.priority); q.priority = PRIOS[(i + 1) % PRIOS.length].key; break; }
      case 'toggle-focus': state.focusQuestId = state.focusQuestId === id ? null : id; break;

      case 'step-tab': stepTab = el.dataset.tab === 'erledigt' ? 'erledigt' : 'aktuell'; break;
      case 'dash-tab': dashTab = el.dataset.tab === 'erledigt' ? 'erledigt' : 'offen'; break;
      case 'select-step': { if (id === activeStepId) return; activeStepId = id; const q = state.quests.find(q => q.id === questId); const s = q && findStep(q, id); if (s) s.open = true; break; }
      case 'deselect-step': activeStepId = null; break;
      case 'toggle-step-open': { const q = state.quests.find(q => q.id === questId); const s = q && findStep(q, id); if (s) s.open = !s.open; break; }
      case 'toggle-next': { const q = state.quests.find(q => q.id === questId); if (!q) return; q.nextStepId = q.nextStepId === id ? null : id; break; }

      case 'toggle-step': { const q = state.quests.find(q => q.id === questId); const s = q && findStep(q, id); if (!s || stepHasSubs(s)) return; s.done = !s.done; s.doneAt = s.done ? nowISO() : null; if (s.done) touchStreak(q.streak); syncQuestDone(q); if (q.done && q.id === activeQuestId) { activeQuestId = null; activeStepId = null; } break; }
      case 'del-step': { const q = state.quests.find(q => q.id === questId); if (!q) return; q.steps = q.steps.filter(s => s.id !== id); removeFromAllTop(taskKey({ kind: 'qstep', questId, stepId: id })); if (id === activeStepId) activeStepId = null; if (id === q.nextStepId) q.nextStepId = null; syncQuestDone(q); break; }
      case 'toggle-sub-open': { const q = state.quests.find(q => q.id === questId); const s = q && findStep(q, stepId); const sub = s && findSubRec(s.subs, id); if (sub) sub.open = !sub.open; break; }
      case 'toggle-sub': { const q = state.quests.find(q => q.id === questId); const s = q && findStep(q, stepId); const sub = s && findSubRec(s.subs, id); if (!sub || sub.subs.length) return; sub.done = !sub.done; sub.doneAt = sub.done ? nowISO() : null; if (sub.done) touchStreak(q.streak); syncQuestDone(q); if (q.done && q.id === activeQuestId) { activeQuestId = null; activeStepId = null; } break; }
      case 'del-sub': { const q = state.quests.find(q => q.id === questId); const s = q && findStep(q, stepId); if (!s) return; removeSubRec(s.subs, id); removeFromAllTop(taskKey({ kind: 'qsub', questId, stepId, subId: id })); syncQuestDone(q); break; }
      case 'sub-sched-open': { const inp = el.parentElement.querySelector('.sub-sched-input'); if (inp) { if (typeof inp.showPicker === 'function') { try { inp.showPicker(); } catch (err) { inp.focus(); } } else inp.focus(); } return; }
      case 'sub-sched-clear': { const q = state.quests.find(q => q.id === questId); const s = q && findStep(q, stepId); const sub = s && findSubRec(s.subs, id); if (sub) { removeFromAllTop(taskKey({ kind: 'qsub', questId, stepId, subId: id })); sub.scheduledDate = null; } break; }

      case 'del-ms': { const q = state.quests.find(q => q.id === questId); if (q) q.milestones = q.milestones.filter(m => m.id !== id); break; }

      case 'cal-view': calView = el.dataset.view === 'tag' ? 'tag' : 'monat'; break;
      case 'cal-prev': calCursor = calView === 'monat' ? addMonths(calCursor, -1) : addDays(calCursor, -1); break;
      case 'cal-next': calCursor = calView === 'monat' ? addMonths(calCursor, 1) : addDays(calCursor, 1); break;
      case 'cal-today': calCursor = todayStr(); break;
      case 'cal-day': calCursor = el.dataset.date; calView = 'tag'; break;
      case 'open-quest-from-cal': { const q = state.quests.find(q => q.id === id); if (!q) return; activeTab = 'quests'; questCat = q.done ? 'erledigt' : q.category; activeQuestId = q.done ? null : q.id; activeStepId = null; stepTab = 'aktuell'; break; }
      case 'toggle-agenda': { const a = state.agenda.find(a => a.id === id); if (!a) return; a.done = !a.done; a.doneAt = a.done ? nowISO() : null; break; }
      case 'del-agenda': state.agenda = state.agenda.filter(a => a.id !== id); removeFromAllTop(taskKey({ kind: 'agenda', id })); break;
      case 'toggle-agenda-sub': { const a = state.agenda.find(a => a.id === el.dataset.agenda); const sub = a && a.subs.find(s => s.id === id); if (!sub) return; sub.done = !sub.done; sub.doneAt = sub.done ? nowISO() : null; break; }
      case 'del-agenda-sub': { const a = state.agenda.find(a => a.id === el.dataset.agenda); if (a) a.subs = a.subs.filter(s => s.id !== id); break; }

      case 'toggle-star': {
        const ds = el.dataset;
        const date = ds.date;
        const ref = ds.kind === 'agenda' ? { kind: 'agenda', id: ds.id } : { kind: ds.kind, questId: ds.quest, stepId: ds.step, subId: ds.sub || undefined };
        const k = taskKey(ref);
        const arr = (state.topTasks[date] || []).filter(x => resolveTopTask(x, date)); // veraltete Referenzen bereinigen
        const i = arr.findIndex(x => taskKey(x) === k);
        if (i >= 0) arr.splice(i, 1);
        else if (arr.length < 3) arr.push(ref);
        else return;
        if (arr.length) state.topTasks[date] = arr; else delete state.topTasks[date];
        break;
      }
      case 'topTask-up': { const date = el.dataset.date; const arr = state.topTasks[date]; const i = Number(el.dataset.index); if (!arr || i <= 0) return; [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; break; }
      case 'topTask-down': { const date = el.dataset.date; const arr = state.topTasks[date]; const i = Number(el.dataset.index); if (!arr || i < 0 || i >= arr.length - 1) return; [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; break; }
      case 'task-push': {
        const ds = el.dataset;
        const next = isDateStr(ds.next) ? ds.next : addDays(todayStr(), 1);
        let key = '';
        if (ds.kind === 'agenda') { const a = state.agenda.find(a => a.id === ds.id); if (a) { a.date = next; key = taskKey({ kind: 'agenda', id: a.id }); } }
        else if (ds.kind === 'qsub') { const q = state.quests.find(q => q.id === ds.quest); const s = q && findStep(q, ds.step); const sub = s && findSubRec(s.subs, ds.sub); if (sub) { sub.scheduledDate = next; key = taskKey({ kind: 'qsub', questId: ds.quest, stepId: ds.step, subId: ds.sub }); } }
        else if (ds.kind === 'qstep') { const q = state.quests.find(q => q.id === ds.quest); const s = q && findStep(q, ds.step); if (s) { s.deadline = next; key = taskKey({ kind: 'qstep', questId: ds.quest, stepId: ds.step }); } }
        if (key) removeFromAllTop(key); // verschobene Aufgabe verlässt die Top-Liste ihres alten Tages
        break;
      }

      case 'toggle-list': { const l = state.lists.find(l => l.id === id); if (l) l.open = !l.open; break; }
      case 'del-list': { const l = state.lists.find(l => l.id === id); if (!l || !confirm(`Liste „${l.name}" löschen?`)) return; state.lists = state.lists.filter(x => x.id !== id); break; }
      case 'toggle-item': { const l = state.lists.find(l => l.id === listId); const i = l && l.items.find(i => i.id === id); if (i) i.done = !i.done; break; }
      case 'del-item': { const l = state.lists.find(l => l.id === listId); if (l) l.items = l.items.filter(i => i.id !== id); break; }
      case 'del-scratch': state.scratchpad = state.scratchpad.filter(n => n.id !== id); break;

      default: return;
    }
    save(); render();
  });

  /* ---------- Feldänderungen ---------- */

  view.addEventListener('change', e => {
    const sel = e.target.closest('select[data-sel]');
    if (sel) {
      if (sel.dataset.sel === 'cat') { const q = state.quests.find(q => q.id === sel.dataset.id); if (q && CATS.some(c => c.key === sel.value)) { q.category = sel.value; questCat = sel.value; activeStepId = null; } }
      else if (sel.dataset.sel === 'section' || sel.dataset.sel === 'type') { const q = state.quests.find(q => q.id === sel.dataset.id); if (q) { if (sel.dataset.sel === 'section') q.section = sel.value; else q.type = sel.value === 'laufend' ? 'laufend' : 'frist'; } }
      else if (sel.dataset.sel === 'step-type') { const q = state.quests.find(q => q.id === sel.dataset.quest); const s = q && findStep(q, sel.dataset.id); if (s) s.type = sel.value === 'laufend' ? 'laufend' : 'frist'; }
      save(); render(); return;
    }
    const timeInput = e.target.closest('input[type="time"][data-field]');
    if (timeInput) {
      const tf = timeInput.dataset.field, tv = isTimeStr(timeInput.value) ? timeInput.value : null;
      const ev = state.events.find(x => x.id === timeInput.dataset.id);
      if (ev) { if (tf === 'ev-start-time') ev.startTime = tv; else if (tf === 'ev-end-time') ev.endTime = tv; }
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
    else if (f === 'agenda-date') { const a = state.agenda.find(a => a.id === input.dataset.id); if (a && v) { removeFromAllTop(taskKey({ kind: 'agenda', id: a.id })); a.date = v; } }
    else if (f === 'sub-schedule') { const q = state.quests.find(q => q.id === input.dataset.quest); const s = q && findStep(q, input.dataset.step); const sub = s && findSubRec(s.subs, input.dataset.id); if (sub) { removeFromAllTop(taskKey({ kind: 'qsub', questId: input.dataset.quest, stepId: input.dataset.step, subId: input.dataset.id })); sub.scheduledDate = v; } }
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
      case 'add-agenda': { const date = isDateStr(form.dataset.date) ? form.dataset.date : todayStr(); const eventId = form.dataset.event || null; state.agenda.push({ id: uid(), text, date, done: false, doneAt: null, subs: [], eventId }); refocusSel = `form[data-action="add-agenda"]${eventId ? `[data-event="${eventId}"]` : ''} input`; break; }
      case 'add-scratch': { state.scratchpad.push({ id: uid(), text }); refocusSel = `form[data-action="add-scratch"] input`; break; }
      case 'dash-add-agenda-sub': { const a = state.agenda.find(a => a.id === form.dataset.agenda); if (!a) return; a.subs.push({ id: uid(), text, done: false, doneAt: null }); refocusSel = `form[data-action="dash-add-agenda-sub"][data-agenda="${a.id}"] input`; break; }
      case 'dash-add-qsub': {
        const q = state.quests.find(q => q.id === form.dataset.quest);
        const s = q && findStep(q, form.dataset.step);
        if (!s) return;
        const parent = form.dataset.parent ? findSubRec(s.subs, form.dataset.parent) : null;
        const sub = newSub(text);
        sub.scheduledDate = todayStr();
        (parent ? parent.subs : s.subs).push(sub);
        if (parent) parent.done = false; else s.done = false;
        syncQuestDone(q);
        refocusSel = `form[data-action="dash-add-qsub"][data-quest="${q.id}"][data-step="${s.id}"] input`;
        break;
      }
      case 'add-event': { const ev = makeEvent(text, todayStr(), eventTab === 'multi'); state.events.push(ev); activeEventId = ev.id; break; }
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
