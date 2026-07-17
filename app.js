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
  ];
  const CATS = [
    { key: 'main', label: 'Main' },
    { key: 'side', label: 'Side' },
    { key: 'skill', label: 'Skill' },
  ];
  const catOptions = sel => CATS.map(c => `<option value="${c.key}"${c.key === sel ? ' selected' : ''}>${c.label}</option>`).join('');
  const EVENT_COLOR = '#7A6E8A';

  /* Strava: Refresh-Token (separat gespeichert), Aktivitätstyp → Stichwörter für Auto-Abhaken. */
  const STRAVA_KEY = 'questlog-strava-refresh';
  const stravaToken = () => { try { return localStorage.getItem(STRAVA_KEY) || null; } catch (e) { return null; } };
  const setStravaToken = t => { try { if (t) localStorage.setItem(STRAVA_KEY, t); else localStorage.removeItem(STRAVA_KEY); } catch (e) {} };
  const STRAVA_MATCH = [
    { types: ['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide', 'EMountainBikeRide'], keywords: ['rad', 'fahrrad', 'rennrad', 'velo', 'bike', 'radeln'] },
    { types: ['Run', 'TrailRun', 'VirtualRun'], keywords: ['lauf', 'joggen', 'jog', 'run'] },
    { types: ['Swim'], keywords: ['schwimm', 'swim'] },
    { types: ['Walk', 'Hike'], keywords: ['spazier', 'wandern', 'walk', 'hike', 'gassi'] },
    { types: ['WeightTraining', 'Workout', 'Crossfit', 'HIIT'], keywords: ['kraft', 'gym', 'workout', 'fitness', 'training'] },
    { types: ['Yoga'], keywords: ['yoga'] },
  ];
  const stravaKeywords = type => { const g = STRAVA_MATCH.find(m => m.types.includes(type)); return g ? g.keywords : []; };
  const isRunLike = type => ['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike'].includes(type);
  const isStrengthLike = type => ['WeightTraining', 'Workout', 'Crossfit', 'HighIntensityIntervalTraining'].includes(type);
  /* Zählt "Set n: …"-Zeilen in einer Hevy/Strong-Beschreibung (Gesamtzahl über alle Übungen). */
  const countSets = desc => { const m = typeof desc === 'string' ? desc.match(/^Set \d+:/gim) : null; return m ? m.length : 0; };

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
  const nowHM = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const hmFromISO = s => (typeof s === 'string' && s.length >= 16) ? s.slice(11, 16) : ''; // "…THH:MM…" → lokale Wanduhr
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

  /* ---------- Zitat des Tages (rotiert deterministisch pro Kalendertag) ---------- */

  const QUOTES = [
    { t: `Prüfe, ob es die Dinge betrifft, die in unserer eigenen Macht stehen, oder jene, die es nicht tun; und wenn es etwas außerhalb deiner Macht betrifft, sei bereit zu sagen, dass es dich nichts angeht.`, s: `Epiktet, Enchiridion` },
    { t: `Verlange nicht, dass die Ereignisse so geschehen, wie du es wünschst; sondern wünsche, dass sie so geschehen, wie sie geschehen, und es wird dir gut ergehen.`, s: `Epiktet, Enchiridion` },
    { t: `Überall zu sein, bedeutet nirgendwo zu sein.`, s: `Seneca, Letters from a Stoic` },
    { t: `Lass jede Handlung auf ein Ziel gerichtet und in ihrer Art vollkommen sein.`, s: `Marcus Aurelius, Meditationes` },
    { t: `Bedenke bei jeder Angelegenheit, was vorausgeht und was folgt, und dann unternimm sie.`, s: `Epiktet, Enchiridion` },
    { t: `Wer also frei sein will, der soll nichts wünschen und nichts ablehnen, das von anderen abhängt; andernfalls muss er zwangsläufig ein Sklave sein.`, s: `Epiktet, Enchiridion` },
    { t: `Was vorbeifliegt, muss ergriffen werden.`, s: `Seneca, Letters from a Stoic` },
    { t: `Der eigene Geist ist der am meisten von Lärm befreite Ort der Welt, wenn die Gedanken eines Mannes so beschaffen sind, dass sie ihm vollkommene innere Ruhe sichern.`, s: `Marcus Aurelius, Meditationes` },
    { t: `Ein Mensch kann selten unglücklich sein, weil er die Gedanken eines anderen nicht kennt; aber wer nicht auf die Regungen seiner eigenen achtet, ist gewiss unglücklich.`, s: `Marcus Aurelius, Meditationes` },
    { t: `Denke bei jedem Vorfall daran, dich dir selbst zuzuwenden und zu prüfen, welche Fähigkeit du hast, um damit umzugehen.`, s: `Epiktet, Enchiridion` },
    { t: `Nichts ist unglücklicher als die Neugier des Menschen, der überall umherschweift... aber nicht bedenkt, dass es ausreicht, die Göttlichkeit in sich selbst zu verehren.`, s: `Marcus Aurelius, Meditationes` },
    { t: `Der weise Mann wird diese Dinge ertragen, aber nicht absichtlich die Konfrontation suchen; er wird den Frieden dem Krieg vorziehen.`, s: `Seneca, Letters from a Stoic` },
    { t: `Eine Veränderung des Charakters, nicht ein Tapetenwechsel, ist das, was du brauchst.`, s: `Seneca, Letters from a Stoic` },
    { t: `Eine ausgewogene Kombination beider Haltungen ist das, was wir wollen; der aktive Mensch sollte in der Lage sein, die Dinge gelassen zu nehmen, während der zur Ruhe neigende Mensch zum Handeln fähig sein sollte.`, s: `Seneca, Letters from a Stoic` },
    { t: `Trägt dies zu meinem Charakter bei?`, s: `Via Stoica, What is Eudaimonia?` },
    { t: `Ein guter Charakter ist die einzige Garantie für ein ewiges, unbeschwertes Glück.`, s: `Seneca, Letters from a Stoic` },
    { t: `Beginne damit, dir selbst einen Charakter und ein Verhalten vorzuschreiben, das du sowohl allein als auch in Gesellschaft beibehalten kannst.`, s: `Epiktet, Enchiridion` },
    { t: `Wenn du dich von der Vernunft leiten lässt und das, was vor dir liegt, mit Fleiß, Kraft und Maßhaltung bewältigst... dann wirst du ein glücklicher Mensch sein.`, s: `Marcus Aurelius, Meditationes` },
    { t: `Sei bei nichts, was du tust, widerwillig, egoistisch, unbedacht oder leidenschaftlich.`, s: `Marcus Aurelius, Meditationes` },
    { t: `Ich glaube, dass genauso wie körperliches Training vermeintlich unwillkürliche Muskeln in willkürliche verwandelt, eine ähnliche Transformation durch das Training des Geistes erreicht werden kann.`, s: `Yukio Mishima, Sun and Steel` },
    { t: `Es bedarf nur eines moderaten Arbeitsaufwands, damit der Geist gedeiht und sich entwickelt. Kultiviere ein Kapital, das die Zeit selbst verbessert.`, s: `Seneca, Letters from a Stoic` },
    { t: `Nicht derjenige, der zu wenig hat, ist arm, sondern derjenige, der sich nach mehr sehnt.`, s: `Seneca, Letters from a Stoic` },
    { t: `Wenn du dein Leben nach der Natur gestaltest, wirst du niemals arm sein; wenn nach der Meinung der Menschen, wirst du niemals reich sein.`, s: `Seneca, Letters from a Stoic` },
    { t: `Wer wenig begehrt, braucht nur wenig. Derjenige hat seinen Wunsch erfüllt, dessen Wunsch es ist, genug zu haben.`, s: `Seneca, Letters from a Stoic` },
    { t: `Die großartige 'Fähigkeit' des großen Genies, für das selbst ewiges Leiden ein zu geringer Preis ist, ist der strenge Stolz des Künstlers.`, s: `Friedrich Nietzsche, The Birth of Tragedy` },
    { t: `Erhebt eure Herzen, meine Brüder, hoch, höher! Und vergesst mir auch die Beine nicht! Erhebt auch eure Beine, ihr guten Tänzer, und besser noch: steht auch auf dem Kopf!`, s: `Friedrich Nietzsche, The Birth of Tragedy` },
    { t: `Denn eine Schwalbe macht noch keinen Sommer, auch nicht ein einziger Tag; und so macht auch ein einziger Tag oder eine kurze Zeit einen Menschen nicht gesegnet und glücklich.`, s: `Aristoteles, Nicomachean Ethics` },
    { t: `Gestalte alle deine Handlungen, Worte und Gedanken so, als könntest du in jedem Moment aus dem Leben scheiden.`, s: `Marcus Aurelius, Meditationes` },
    { t: `Jeder Tag sollte daher so gestaltet werden, als wäre er derjenige, der das Schlusslicht bildet, der unser Leben abrundet und vollendet.`, s: `Seneca, Letters from a Stoic` },
    { t: `Derjenige, der dem Morgen ohne Sorge entgegensieht, kennt eine friedliche Unabhängigkeit und ein Glück, das alles andere übertrifft.`, s: `Seneca, Letters from a Stoic` },
    { t: `Es ist deine Pflicht zu überlegen, wie du das meiste aus deinem Leben machen und das Vorhandene zum größten Vorteil nutzen kannst.`, s: `Platon (zitiert von Marcus Aurelius), Meditationes` },
  ];

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

  const emptyState = () => ({ version: 3, lists: [], quests: [], agenda: [], events: [], focusQuestId: null, topTasks: {}, journal: {}, routines: [] });

  /* Standard-Routinen bei allererster Verwendung (wenn noch nie ein routines-Feld existierte). */
  const DEFAULT_ROUTINES = ['Journal (morgens)', 'Journal (abends)', 'Lesen', 'Chronik', 'Supplements'];
  function normalizeRoutine(raw) {
    if (typeof raw === 'string') return { id: uid(), title: raw, done: [] };
    if (!raw || typeof raw !== 'object') return null;
    return { id: raw.id || uid(), title: String(raw.title ?? ''), done: (Array.isArray(raw.done) ? raw.done : []).filter(isDateStr) };
  }

  function normalizeItem(raw) {
    if (typeof raw === 'string') return { id: uid(), text: raw, done: false, subs: [], open: false };
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: raw.id || uid(), text: String(raw.text ?? raw.name ?? ''), done: !!raw.done, open: !!raw.open,
      subs: (Array.isArray(raw.subs) ? raw.subs : []).map(normalizeItem).filter(Boolean),
    };
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
    if (!raw || typeof raw !== 'object') return null;
    // Überlegung: undatiertes Event.
    if (raw.undated === true) {
      return { id: raw.id || uid(), name: String(raw.name ?? raw.title ?? ''), start: null, end: null, multiDay: false, undated: true, notes: typeof raw.notes === 'string' ? raw.notes : '', startTime: null, endTime: null };
    }
    if (!isDateStr(raw.start)) return null;
    const end = isDateStr(raw.end) ? raw.end : null;
    const multiDay = raw.multiDay !== undefined ? !!raw.multiDay : !!(end && end > raw.start);
    return {
      id: raw.id || uid(), name: String(raw.name ?? raw.title ?? ''), start: raw.start,
      end: multiDay ? (end && end >= raw.start ? end : raw.start) : null,
      multiDay, undated: false,
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

    // Journal pro Tag: { [datum]: { notes:[{id,text}], activities:[…] } }.
    const cleanNotes = arr => (Array.isArray(arr) ? arr : []).map(n => (n && typeof n === 'object' && (n.text ?? '') !== '') ? { id: n.id || uid(), text: String(n.text), at: typeof n.at === 'string' ? n.at : null } : null).filter(Boolean);
    const cleanActs = arr => (Array.isArray(arr) ? arr : []).map(a => (a && typeof a === 'object' && a.activityId != null) ? {
      id: a.id || uid(), activityId: String(a.activityId), name: String(a.name ?? ''), type: String(a.type ?? ''),
      distanceKm: Number.isFinite(a.distanceKm) ? a.distanceKm : null, movingMin: Number.isFinite(a.movingMin) ? a.movingMin : null,
      elevM: Number.isFinite(a.elevM) ? a.elevM : null, avgSpeedMs: Number.isFinite(a.avgSpeedMs) ? a.avgSpeedMs : null,
      at: typeof a.at === 'string' ? a.at : null,
      description: typeof a.description === 'string' ? a.description : '',
    } : null).filter(Boolean);
    if (raw.journal && typeof raw.journal === 'object' && !Array.isArray(raw.journal)) {
      for (const [date, day] of Object.entries(raw.journal)) {
        if (!isDateStr(date) || !day || typeof day !== 'object') continue;
        const notes = cleanNotes(day.notes), activities = cleanActs(day.activities);
        if (notes.length || activities.length) s.journal[date] = { notes, activities };
      }
    }
    // Migration alter globaler „Gedanken" → heutiger Journaltag.
    if (Array.isArray(raw.scratchpad) && raw.scratchpad.length) {
      const migrated = cleanNotes(raw.scratchpad);
      if (migrated.length) {
        const t = todayStr();
        const day = s.journal[t] || (s.journal[t] = { notes: [], activities: [] });
        day.notes = day.notes.concat(migrated);
      }
    }

    // Routinen: bestehende übernehmen, sonst (nie vorhanden) mit Standard-Routinen starten.
    if (Array.isArray(raw.routines)) s.routines = raw.routines.map(normalizeRoutine).filter(r => r && r.title);
    else s.routines = DEFAULT_ROUTINES.map(normalizeRoutine);
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

  /* ---------- Datensicherung (Export/Import als JSON-Datei) ---------- */

  function exportData() {
    try {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `questlog-backup-${todayStr()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      backupStatus = `Gesichert: questlog-backup-${todayStr()}.json`;
    } catch (e) { backupStatus = 'Export fehlgeschlagen.'; }
  }

  function importData(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { backupStatus = 'Datei ist kein gültiges JSON.'; render(); return; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { backupStatus = 'Keine gültige Sicherungsdatei.'; render(); return; }
    const n = Array.isArray(parsed.quests) ? parsed.quests.length : 0;
    if (!confirm(`Sicherung importieren? Deine aktuellen Daten in diesem Browser werden vollständig ersetzt (Datei enthält ${n} Quest${n === 1 ? '' : 's'}).`)) return;
    state = sanitizeState(parsed);
    activeQuestId = null; activeStepId = null; activeEventId = null;
    save();
    backupStatus = 'Sicherung wiederhergestellt ✓';
    render();
  }

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

  /* ---------- Journal (Gedanken/Notizen + Aktivitäten pro Tag) ---------- */

  const journalNotes = date => (state.journal[date] && state.journal[date].notes) || [];
  const journalActs = date => (state.journal[date] && state.journal[date].activities) || [];
  function journalDayRW(date) { return state.journal[date] || (state.journal[date] = { notes: [], activities: [] }); }
  function journalPrune(date) { const d = state.journal[date]; if (d && !d.notes.length && !d.activities.length) delete state.journal[date]; }
  function addJournalNote(date, text) { journalDayRW(date).notes.push({ id: uid(), text }); }
  function delJournalNote(date, id) { const d = state.journal[date]; if (!d) return; d.notes = d.notes.filter(n => n.id !== id); journalPrune(date); }
  function editJournalNote(date, id, text) { const n = journalNotes(date).find(n => n.id === id); if (n) n.text = text; }
  /* alle Journaltage mit Inhalt, neueste zuerst */
  const journalDates = () => Object.keys(state.journal).filter(d => journalNotes(d).length || journalActs(d).length).sort((a, b) => a < b ? 1 : -1);

  /* ---------- Routinen + Streaks (täglich) ---------- */

  const routineDoneOn = (r, date) => r.done.includes(date);
  function toggleRoutine(r, date) {
    if (r.done.includes(date)) r.done = r.done.filter(d => d !== date);
    else r.done.push(date);
  }
  /* aktueller Streak: aufeinanderfolgende erledigte Tage, endend heute oder gestern (sonst 0). */
  function routineCurrentStreak(r) {
    const set = new Set(r.done);
    let anchor = set.has(todayStr()) ? todayStr() : (set.has(yesterdayStr()) ? yesterdayStr() : null);
    if (!anchor) return 0;
    let n = 0, d = anchor;
    while (set.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }
  function routineLongestStreak(r) {
    const dates = [...new Set(r.done)].sort();
    let best = 0, run = 0, prev = null;
    for (const d of dates) { run = (prev && dayDiff(prev, d) === 1) ? run + 1 : 1; best = Math.max(best, run); prev = d; }
    return best;
  }

  /* Strava-Aktivität → Journaleintrag */
  function stravaToEntry(a) {
    return {
      id: uid(), activityId: String(a.id), name: a.name || '', type: a.type || '',
      distanceKm: Number.isFinite(a.distance) ? a.distance / 1000 : null,
      movingMin: Number.isFinite(a.moving_time) ? a.moving_time / 60 : null,
      elevM: Number.isFinite(a.total_elevation_gain) ? a.total_elevation_gain : null,
      avgSpeedMs: Number.isFinite(a.average_speed) ? a.average_speed : null,
      at: typeof a.start_date_local === 'string' ? a.start_date_local : null,
      description: typeof a.description === 'string' ? a.description : '',
    };
  }
  function markTaskDone(t) {
    if (t.kind === 'agenda') { const a = state.agenda.find(a => a.id === t.id); if (a && !a.done) { a.done = true; a.doneAt = nowISO(); return true; } return false; }
    if (t.kind === 'qstep') { const q = state.quests.find(q => q.id === t.questId); const s = q && findStep(q, t.stepId); if (s && !stepHasSubs(s) && !s.done) { s.done = true; s.doneAt = nowISO(); touchStreak(q.streak); syncQuestDone(q); return true; } return false; }
    if (t.kind === 'qsub') { const q = state.quests.find(q => q.id === t.questId); const s = q && findStep(q, t.stepId); const sub = s && findSubRec(s.subs, t.subId); if (sub && !sub.subs.length && !sub.done) { sub.done = true; sub.doneAt = nowISO(); touchStreak(q.streak); syncQuestDone(q); return true; } return false; }
    return false;
  }
  /* geloggte Aktivitäten ins Journal schreiben (dedupliziert) und passende Tagesaufgaben abhaken */
  function processStravaActivities(activities) {
    let logged = 0, checked = 0;
    for (const a of (Array.isArray(activities) ? activities : [])) {
      const date = (a.start_date_local || '').slice(0, 10);
      if (!isDateStr(date)) continue;
      const day = journalDayRW(date);
      if (!day.activities.some(x => x.activityId === String(a.id))) { day.activities.push(stravaToEntry(a)); logged++; }
      const kws = stravaKeywords(a.type);
      if (kws.length) {
        for (const t of collectDayTasks(date)) {
          const txt = t.text.toLowerCase();
          if (kws.some(k => txt.includes(k)) && markTaskDone(t)) checked++;
        }
      }
      journalPrune(date);
    }
    return { logged, checked };
  }
  function dayRangeEpoch(dateStr) { const d = parseDate(dateStr); const start = Math.floor(d.getTime() / 1000); return { after: start - 1, before: start + 86400 }; }

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
  const eventSpanLabel = e => e.undated ? '—' : (e.end && e.end !== e.start) ? `${fmtShort(e.start)}–${fmtShort(e.end)}` : fmtShort(e.start);
  const eventsCovering = ds => state.events.filter(e => !e.undated && e.start <= ds && ds <= eventEnd(e));
  const eventIsPast = e => !e.undated && eventEnd(e) < todayStr(); // abgelaufen → Archiv
  /* Neues Event: mehrtägig startet mit einer Standard-Spanne (Tag + 1), eintägig ohne Uhrzeiten. */
  const makeEvent = (name, start, multiDay) => ({
    id: uid(), name, start, end: multiDay ? addDays(start, 1) : null, multiDay, undated: false,
    notes: '', startTime: null, endTime: null,
  });
  /* Überlegung: undatiertes Event (nur Idee), taucht nicht im Kalender auf, später datierbar. */
  const makeIdeaEvent = name => ({ id: uid(), name, start: null, end: null, multiDay: false, undated: true, notes: '', startTime: null, endTime: null });
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
  let archiveTab = 'quests';
  let routinesOpen = true;
  let stravaSyncing = false;
  let stravaStatus = '';
  let calView = 'tag';
  let calCursor = todayStr();
  let dayStamp = todayStr();
  let refocusSel = null;
  let pendingEditSel = null;
  let backupStatus = '';

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
    const skills = done.filter(q => q.category === 'skill');
    if (skills.length) html += `<div class="arch-cat">Skills</div>${skills.map(renderArchQuest).join('')}`;
    return `<div class="archive">${html || '<div class="empty">— noch nichts erledigt —</div>'}</div>`;
  }

  /* --- Journal (Gedanken/Notizen + Aktivitäten pro Tag, neueste zuerst) --- */

  function renderJournal() {
    const dates = journalDates();
    if (!dates.length) return '<div class="archive"><div class="empty">— noch keine Einträge —</div></div>';
    const days = dates.map(ds => {
      const d = parseDate(ds);
      const acts = journalActs(ds).map(activityLine).join('');
      const notes = journalNotes(ds).map(n => journalNoteRow(n, ds)).join('');
      return `<div class="journal-day">
        <div class="journal-date">${WD_FULL[wdIndexMon(d)]}, ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}</div>
        <ul class="scratch-list">${acts}${notes}</ul>
        ${addMini('add-scratch', 'Neuer Journaleintrag', ` data-date="${ds}"`)}
      </div>`;
    }).join('');
    return `<div class="archive journal">${days}</div>`;
  }

  function renderArchiveTab() {
    const doneCount = state.quests.filter(q => q.done).length;
    const journalCount = journalDates().length;
    const pastEventCount = state.events.filter(eventIsPast).length;
    const tabs = `<div class="seg">
      <button data-action="archive-tab" data-tab="quests" class="${archiveTab === 'quests' ? 'active' : ''}">Quests<span class="seg-count">${doneCount}</span></button>
      <button data-action="archive-tab" data-tab="events" class="${archiveTab === 'events' ? 'active' : ''}">Events<span class="seg-count">${pastEventCount}</span></button>
      <button data-action="archive-tab" data-tab="journal" class="${archiveTab === 'journal' ? 'active' : ''}">Journal<span class="seg-count">${journalCount}</span></button>
    </div>`;
    const backup = `<div class="backup-bar">
      <div class="dash-label">Datensicherung</div>
      <div class="backup-actions">
        <button class="backup-btn" data-action="export-data">Sichern (Download)</button>
        <button class="backup-btn ghost" data-action="import-data">Wiederherstellen …</button>
      </div>
      ${backupStatus ? `<div class="backup-status">${esc(backupStatus)}</div>` : ''}
      <div class="backup-hint">Lädt alle Quests, Aufgaben, Events, Listen und das Journal als Datei herunter. Die Strava-Verbindung ist nicht enthalten (bei Bedarf einmal neu verbinden).</div>
    </div>`;
    const body = archiveTab === 'journal' ? renderJournal() : archiveTab === 'events' ? renderArchiveEvents() : renderArchive();
    return `<div class="board-title">Archiv</div>${tabs}${body}${backup}`;
  }

  /* Vergangene Events (abgelaufen) im Archiv — Klick öffnet den Event-Kontext. */
  function renderArchiveEvents() {
    const past = state.events.filter(eventIsPast).sort((a, b) => a.start < b.start ? 1 : -1); // neueste zuerst
    if (!past.length) return '<div class="archive"><div class="empty">— keine vergangenen Events —</div></div>';
    const rows = past.map(e => `<div class="evrow" data-action="open-event-cal" data-id="${e.id}">
      <span class="ev-dot" style="background:${EVENT_COLOR}"></span>
      <span class="ev-date">${eventSpanLabel(e)}</span>
      <span class="ev-name">${esc(e.name)}</span>
      <button class="del" data-action="del-event" data-id="${e.id}" aria-label="Event löschen">${ICONS.x}</button>
    </div>`).join('');
    return `<div class="archive ev-archive">${rows}</div>`;
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

  /* Kontext einer Überlegung (undatiert): Name, Datum festlegen (→ echtes Event), Notizen. */
  function renderIdeaContext(e) {
    return `<div class="col-notes">
      <div class="col-head">Event · Überlegung</div>
      <div class="ctx-title">${esc(e.name)}</div>
      <div class="meta-row">
        <label class="date-field">Datum festlegen<input type="date" data-field="ev-start" data-id="${e.id}" value=""></label>
      </div>
      <div class="ctx-hint">Sobald du ein Datum vergibst, wird daraus ein eintägiges Event.</div>
      <div class="ctx-block">
        <div class="ctx-label">Notizen</div>
        <textarea class="notes" data-ev-notes data-id="${e.id}" placeholder="Notizen zur Überlegung …">${esc(e.notes)}</textarea>
      </div>
    </div>`;
  }

  function renderEventContext(e) {
    if (e.undated) return renderIdeaContext(e);
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
    // Aktive (nicht vergangene) Events je Reiter; Überlegungen sind undatiert.
    const matchesTab = e => eventTab === 'idea' ? e.undated : (!e.undated && !eventIsPast(e) && !!e.multiDay === (eventTab === 'multi'));
    const events = state.events.slice()
      .filter(matchesTab)
      .sort((a, b) => eventTab === 'idea' ? 0 : (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const active = activeEventId ? state.events.find(e => e.id === activeEventId) : null;
    const singleCount = state.events.filter(e => !e.undated && !e.multiDay && !eventIsPast(e)).length;
    const multiCount = state.events.filter(e => !e.undated && e.multiDay && !eventIsPast(e)).length;
    const ideaCount = state.events.filter(e => e.undated).length;
    const tabs = `<div class="step-tabs">
      <button data-action="event-tab" data-tab="single" class="${eventTab === 'single' ? 'active' : ''}">Eintägig<span class="seg-count">${singleCount}</span></button>
      <button data-action="event-tab" data-tab="multi" class="${eventTab === 'multi' ? 'active' : ''}">Mehrtägig<span class="seg-count">${multiCount}</span></button>
      <button data-action="event-tab" data-tab="idea" class="${eventTab === 'idea' ? 'active' : ''}">Überlegungen<span class="seg-count">${ideaCount}</span></button>
    </div>`;
    const emptyLabel = eventTab === 'idea' ? 'Überlegungen' : eventTab === 'multi' ? 'mehrtägigen Events' : 'eintägigen Events';
    const list = events.length ? events.map(e => renderEventRow(e, active)).join('') : `<div class="empty">— keine ${emptyLabel} —</div>`;
    const addPh = eventTab === 'idea' ? 'Neue Überlegung' : eventTab === 'multi' ? 'Neues mehrtägiges Event' : 'Neues eintägiges Event';
    return `<div class="ev-board${active ? ' detail has-active' : ''}">
      ${active ? '<div class="detail-bar"><button class="back" data-action="close-event">← Übersicht</button></div>' : ''}
      <div class="ev-list">${tabs}${list}${addMini('add-event', addPh)}</div>
      ${active ? renderEventContext(active) : ''}
    </div>`;
  }

  const backBar = '<div class="detail-bar"><button class="back" data-action="close-quest">← Übersicht</button></div>';

  function renderQuests() {
    const counts = {
      main: state.quests.filter(q => q.category === 'main' && !q.done).length,
      side: state.quests.filter(q => q.category === 'side' && !q.done).length,
      skill: state.quests.filter(q => q.category === 'skill' && !q.done).length,
      events: state.events.filter(e => !eventIsPast(e)).length, // vergangene Events zählen nicht mit (liegen im Archiv)
    };
    if (questCat === 'erledigt') questCat = 'main'; // Erledigt ist ins Archiv gewandert
    const tabs = QUEST_TABS.map(c => `<button data-action="quest-cat" data-cat="${c.key}" class="${questCat === c.key ? 'active' : ''}">${c.label}<span class="seg-count">${counts[c.key]}</span></button>`).join('');
    const head = `<div class="board-title">Questlog</div><div class="seg">${tabs}</div>`;

    if (questCat === 'events') return head + renderEvents();

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

    const monthEvents = state.events.filter(e => !e.undated && eventEnd(e) >= gridStart && e.start <= gridEnd);
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
      <form class="add-row add-agenda" data-action="add-agenda" data-date="${calCursor}"><input type="text" placeholder="Aufgabe für diesen Tag …" autocomplete="off" enterkeyhint="done"><button type="submit" aria-label="Hinzufügen">${ICONS.plus}</button></form>
      <div class="day-notes-block">${renderRoutines(calCursor)}${renderDayNotes(calCursor)}</div></div>`;
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

  /* Ein Top-Task-Datum passt zum betrachteten Tag entweder exakt, oder — nur am heutigen
     Tag — wenn es überfällig ist (in der Vergangenheit liegt). So bleiben überfällige
     Aufgaben, die man als Top-Aufgabe markiert, dort erhalten statt sofort zu verschwinden. */
  const topDateMatches = (taskDate, dateStr) => taskDate === dateStr || (dateStr === todayStr() && taskDate < dateStr);
  const overdueDaysFor = (taskDate, dateStr) => taskDate < dateStr ? dayDiff(taskDate, dateStr) : 0;

  /* Löst eine Top-Referenz für einen bestimmten Tag auf; verwirft sie, wenn die Aufgabe
     nicht mehr existiert oder inzwischen an einem anderen Tag liegt (z. B. verschoben). */
  function resolveTopTask(ref, dateStr) {
    if (ref.kind === 'qstep') { const q = state.quests.find(q => q.id === ref.questId); const s = q && findStep(q, ref.stepId); if (!s || !topDateMatches(s.deadline, dateStr)) return null; return { kind: 'qstep', questId: q.id, stepId: s.id, text: s.text, questTitle: q.title, done: stepDone(s), overdueDays: overdueDaysFor(s.deadline, dateStr) }; }
    if (ref.kind === 'qsub') { const q = state.quests.find(q => q.id === ref.questId); const s = q && findStep(q, ref.stepId); const sub = s && findSubRec(s.subs, ref.subId); if (!sub || !topDateMatches(sub.scheduledDate, dateStr)) return null; return { kind: 'qsub', questId: q.id, stepId: s.id, subId: sub.id, text: sub.text, questTitle: q.title, done: subDone(sub), subs: sub.subs, overdueDays: overdueDaysFor(sub.scheduledDate, dateStr) }; }
    if (ref.kind === 'agenda') { const a = state.agenda.find(a => a.id === ref.id); if (!a || !topDateMatches(a.date, dateStr)) return null; return { kind: 'agenda', id: a.id, text: a.text, done: a.done, subs: a.subs, overdueDays: overdueDaysFor(a.date, dateStr) }; }
    return null;
  }

  function activityLine(a) {
    const strength = isStrengthLike(a.type);
    const parts = [];
    if (!strength && a.distanceKm != null) parts.push(`${a.distanceKm.toFixed(1).replace('.', ',')} km`);
    if (a.movingMin != null) parts.push(`${Math.round(a.movingMin)} min`);
    if (!strength && a.avgSpeedMs != null && a.avgSpeedMs > 0) {
      if (isRunLike(a.type)) { const pace = 1000 / a.avgSpeedMs / 60; const m = Math.floor(pace), s = Math.round((pace - m) * 60); parts.push(`${m}:${String(s).padStart(2, '0')} /km`); }
      else parts.push(`${(a.avgSpeedMs * 3.6).toFixed(1).replace('.', ',')} km/h`);
    }
    if (!strength && a.elevM != null && a.elevM > 0) parts.push(`${Math.round(a.elevM)} hm`);
    if (strength) { const sets = countSets(a.description); if (sets > 0) parts.push(`${sets} ${sets === 1 ? 'Satz' : 'Sätze'}`); }
    const label = a.type ? `${esc(a.name || a.type)} · ${esc(a.type)}` : esc(a.name);
    const time = hmFromISO(a.at);
    const timeTag = time ? `<span class="scratch-time">${time}</span>` : '';
    // Volle Hevy/Strong-Beschreibung nur bei Nicht-Kraft-Typen anzeigen; bei Kraft reicht die Sätze-Zahl oben.
    const desc = (!strength && a.description) ? `<div class="activity-desc">${esc(a.description)}</div>` : '';
    return `<li class="scratch-item activity"><span class="scratch-bullet">◆</span><span class="row-text">${timeTag}<strong>${label}</strong>${parts.length ? ` · ${parts.join(' · ')}` : ''}${desc}</span></li>`;
  }

  /* Zitat des Tages — deterministisch pro Kalendertag, rotiert durch alle Zitate. */
  function renderQuote() {
    if (typeof QUOTES === 'undefined' || !QUOTES.length) return '';
    const dayNum = Math.floor(parseDate(todayStr()).getTime() / 86400000);
    const q = QUOTES[((dayNum % QUOTES.length) + QUOTES.length) % QUOTES.length];
    return `<div class="dash-quote"><div class="quote-text">${esc(q.t)}</div>${q.s ? `<div class="quote-src">— ${esc(q.s)}</div>` : ''}</div>`;
  }

  /* Routinen mit Streak. Heute: volle Verwaltung inkl. Umsortieren. Vergangene Tage: nur
     nachträgliches Abhaken (Streak-Backfill), ohne Umbenennen/Löschen/Neu/Umsortieren. */
  function renderRoutines(dateStr = todayStr()) {
    const isToday = dateStr === todayStr();
    const n = state.routines.length;
    const rows = state.routines.map((r, i) => {
      const done = routineDoneOn(r, dateStr);
      const streak = routineCurrentStreak(r);
      const title = isToday
        ? `<span class="row-text editable" data-edit="routine-title" data-id="${r.id}">${esc(r.title)}</span>`
        : `<span class="row-text">${esc(r.title)}</span>`;
      const arrows = (isToday && n > 1) ? `<span class="arrows">
          <button class="arrow-up" data-action="routine-up" data-index="${i}"${i === 0 ? ' disabled' : ''} aria-label="Nach oben">${ICONS.chevron}</button>
          <button class="arrow-down" data-action="routine-down" data-index="${i}"${i === n - 1 ? ' disabled' : ''} aria-label="Nach unten">${ICONS.chevron}</button>
        </span>` : '';
      const trailing = isToday
        ? `<span class="routine-streak${streak > 0 ? ' on' : ''}" title="Aktueller Streak: ${streak} Tag${streak === 1 ? '' : 'e'} · längster: ${routineLongestStreak(r)}">${ICONS.flame}${streak}</span>
        <button class="del" data-action="del-routine" data-id="${r.id}" aria-label="Routine löschen">${ICONS.x}</button>${arrows}`
        : '';
      return `<li class="routine-row${done ? ' done' : ''}">
        <button class="checkbox" data-action="toggle-routine" data-id="${r.id}" data-date="${dateStr}" aria-label="Abhaken">${ICONS.check}</button>
        ${title}${trailing}
      </li>`;
    }).join('');
    return `<div class="dash-routines">
      <div class="dash-label routines-head" data-action="toggle-routines-open"><span class="chev${routinesOpen ? ' open' : ''}">${ICONS.chevron}</span>Routinen${isToday ? '' : ' — nachtragen'}</div>
      ${routinesOpen ? `<ul class="routine-list">${rows || '<div class="empty">— keine Routinen —</div>'}</ul>${isToday ? addMini('add-routine', 'Neue Routine') : ''}` : ''}
    </div>`;
  }

  function renderStravaBox(dateStr) {
    const connected = !!stravaToken();
    const btn = connected
      ? `<button class="strava-btn" data-action="strava-sync" data-date="${dateStr}"${stravaSyncing ? ' disabled' : ''}>${stravaSyncing ? 'Synchronisiere …' : 'Mit Strava synchronisieren'}</button>`
      : `<button class="strava-btn connect" data-action="strava-connect">Mit Strava verbinden</button>`;
    return `<div class="strava-box">${btn}${stravaStatus ? `<div class="strava-status">${esc(stravaStatus)}</div>` : ''}</div>`;
  }

  function journalNoteRow(n, dateStr) {
    return `<li class="scratch-item"><span class="scratch-bullet">•</span><span class="row-text editable" data-edit="scratch-text" data-date="${dateStr}" data-id="${n.id}">${esc(n.text)}</span><button class="del" data-action="del-scratch" data-date="${dateStr}" data-id="${n.id}" aria-label="Löschen">${ICONS.x}</button></li>`;
  }

  /* Journal-Feld pro Tag (Notizen + automatisch geloggte Strava-Aktivitäten). */
  function renderDayNotes(dateStr) {
    const notes = journalNotes(dateStr).map(n => journalNoteRow(n, dateStr)).join('');
    const acts = journalActs(dateStr).map(activityLine).join('');
    return `<div class="dash-scratch">
      <div class="dash-label">Journal</div>
      <ul class="scratch-list">${acts}${notes}</ul>
      <form class="add-row add-scratch" data-action="add-scratch" data-date="${dateStr}"><input type="text" placeholder="Neuer Journaleintrag …" autocomplete="off" enterkeyhint="done"><button type="submit" aria-label="Hinzufügen">${ICONS.plus}</button></form>
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
        ${isToday ? renderQuote() : ''}
        ${termine}
        ${topBox}
        ${overdueBox}
        ${tasksBox}
      </div>
      <div class="dash-side">${isToday ? renderRoutines() + renderStravaBox(dateStr) : ''}${renderDayNotes(dateStr)}</div>
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

  /* Listen-Eintrag rekursiv wie ein Quest-Unterschritt: Blätter mit Checkbox, Zweige mit
     Fortschrittsmarke, jeder Eintrag kann per Chevron aufgeklappt werden, um selbst
     Unterpunkte zu bekommen (auch mehrere Ebenen tief). */
  function renderListItem(item, listId) {
    const hasKids = item.subs.length > 0;
    const done = subDone(item);
    const { done: sd, total: st } = subLeaves(item);
    const control = hasKids
      ? `<span class="branch-mark${done ? ' full' : ''}">${sd}/${st}</span>`
      : `<button class="checkbox" data-action="toggle-item" data-list="${listId}" data-id="${item.id}" aria-label="Abhaken">${ICONS.check}</button>`;
    return `<li class="node sub${item.open ? ' open' : ''}${done ? ' done' : ''}">
      <div class="node-row">
        <button class="chev" data-action="toggle-item-open" data-list="${listId}" data-id="${item.id}" aria-label="Auf-/Zuklappen">${ICONS.chevron}</button>
        <span class="node-control">${control}</span>
        <span class="row-text editable" data-edit="item-text" data-list="${listId}" data-id="${item.id}">${esc(item.text)}</span>
        <button class="del" data-action="del-item" data-list="${listId}" data-id="${item.id}" aria-label="Löschen">${ICONS.x}</button>
      </div>
      ${item.open ? `<ul class="subtree">
        ${item.subs.map(k => renderListItem(k, listId)).join('')}
        <li class="add-sub">${addMini('add-sub-item', 'Unterpunkt', ` data-list="${listId}" data-parent="${item.id}"`)}</li>
      </ul>` : ''}
    </li>`;
  }

  function renderLists() {
    const blocks = state.lists.map(l => {
      const totals = l.items.reduce((a, i) => { const r = subLeaves(i); return { done: a.done + r.done, total: a.total + r.total }; }, { done: 0, total: 0 });
      return `<section class="block${l.open ? ' open' : ''}">
        <header class="block-head list-head" data-action="toggle-list" data-id="${l.id}"><span class="chev">${ICONS.chevron}</span><h2 class="editable" data-edit="list-name" data-id="${l.id}">${esc(l.name)}</h2><span class="count">${totals.done}/${totals.total}</span><button class="del" data-action="del-list" data-id="${l.id}" aria-label="Liste löschen">${ICONS.x}</button></header>
        ${l.open ? `${l.items.length ? `<ul class="subtree">${l.items.map(i => renderListItem(i, l.id)).join('')}</ul>` : '<div class="empty">— leer —</div>'}
          <form class="add-row" data-action="add-item" data-list="${l.id}"><input type="text" placeholder="Neuer Eintrag …" autocomplete="off" enterkeyhint="done"><button type="submit" aria-label="Hinzufügen">${ICONS.plus}</button></form>` : ''}
      </section>`;
    }).join('');
    return `${blocks}<form class="add-row add-block" data-action="add-list"><input type="text" placeholder="Neue Liste …" autocomplete="off" enterkeyhint="done"><button type="submit" aria-label="Liste anlegen">${ICONS.plus}</button></form>`;
  }

  function render() {
    if (editing) return;
    for (const btn of tabbar.querySelectorAll('.tab')) btn.classList.toggle('active', btn.dataset.tab === activeTab);
    view.innerHTML = activeTab === 'calendar' ? renderCalendar() : activeTab === 'quests' ? renderQuests() : activeTab === 'archive' ? renderArchiveTab() : renderLists();
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
      case 'scratch-text': { if (isDateStr(ds.date)) editJournalNote(ds.date, ds.id, val); break; }
      case 'routine-title': { const r = state.routines.find(r => r.id === ds.id); if (r) r.title = val; break; }
      case 'list-name': { const l = state.lists.find(l => l.id === ds.id); if (l) l.name = val; break; }
      case 'item-text': { const l = state.lists.find(l => l.id === ds.list); const i = l && findSubRec(l.items, ds.id); if (i) i.text = val; break; }
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

    // Strava: eigener async-Ablauf, umgeht das synchrone save()+render() am Ende.
    if (action === 'strava-connect') { window.location.href = '/.netlify/functions/strava-connect'; return; }
    if (action === 'strava-sync') { stravaSync(el.dataset.date); return; }
    if (action === 'export-data') { exportData(); render(); return; }
    if (action === 'import-data') { const inp = document.getElementById('import-file'); if (inp) inp.click(); return; }

    switch (action) {
      case 'quest-cat': questCat = el.dataset.cat; activeQuestId = null; activeStepId = null; if (questCat !== 'events') activeEventId = null; break;

      case 'open-event': if (id !== activeEventId) activeEventId = id; else return; break;
      case 'close-event': activeEventId = null; break;
      case 'event-tab': eventTab = ['multi', 'idea'].includes(el.dataset.tab) ? el.dataset.tab : 'single'; activeEventId = null; break;
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
      case 'archive-tab': archiveTab = ['journal', 'events'].includes(el.dataset.tab) ? el.dataset.tab : 'quests'; break;
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
      case 'open-quest-from-cal': { const q = state.quests.find(q => q.id === id); if (!q) return; if (q.done) { activeTab = 'archive'; archiveTab = 'quests'; } else { activeTab = 'quests'; questCat = q.category; activeQuestId = q.id; activeStepId = null; stepTab = 'aktuell'; } break; }
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
      case 'toggle-item': { const l = state.lists.find(l => l.id === listId); const i = l && findSubRec(l.items, id); if (!i || i.subs.length) return; i.done = !i.done; break; }
      case 'del-item': { const l = state.lists.find(l => l.id === listId); if (l) removeSubRec(l.items, id); break; }
      case 'toggle-item-open': { const l = state.lists.find(l => l.id === listId); const i = l && findSubRec(l.items, id); if (i) i.open = !i.open; break; }
      case 'del-scratch': { if (isDateStr(el.dataset.date)) delJournalNote(el.dataset.date, id); break; }
      case 'toggle-routine': { const r = state.routines.find(r => r.id === id); const date = isDateStr(el.dataset.date) ? el.dataset.date : todayStr(); if (r) toggleRoutine(r, date); break; }
      case 'del-routine': { const r = state.routines.find(r => r.id === id); if (!r || !confirm(`Routine „${r.title}" löschen? (inkl. Streak)`)) return; state.routines = state.routines.filter(x => x.id !== id); break; }
      case 'toggle-routines-open': routinesOpen = !routinesOpen; break;
      case 'routine-up': { const i = Number(el.dataset.index); if (i <= 0) return; [state.routines[i - 1], state.routines[i]] = [state.routines[i], state.routines[i - 1]]; break; }
      case 'routine-down': { const i = Number(el.dataset.index); if (i < 0 || i >= state.routines.length - 1) return; [state.routines[i + 1], state.routines[i]] = [state.routines[i], state.routines[i + 1]]; break; }

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
    else if (f === 'ev-start') { const ev = state.events.find(x => x.id === input.dataset.id); if (ev && v) { const wasIdea = ev.undated; ev.start = v; ev.undated = false; if (ev.end && ev.end < ev.start) ev.end = null; if (wasIdea) eventTab = ev.multiDay ? 'multi' : 'single'; } }
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
      case 'add-scratch': { const date = isDateStr(form.dataset.date) ? form.dataset.date : todayStr(); addJournalNote(date, text); refocusSel = `form[data-action="add-scratch"][data-date="${date}"] input`; break; }
      case 'add-routine': { state.routines.push({ id: uid(), title: text, done: [] }); refocusSel = `form[data-action="add-routine"] input`; break; }
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
      case 'add-event': { const ev = eventTab === 'idea' ? makeIdeaEvent(text) : makeEvent(text, todayStr(), eventTab === 'multi'); state.events.push(ev); activeEventId = ev.id; break; }
      case 'add-list': state.lists.push({ id: uid(), name: text, open: true, items: [] }); refocusSel = 'form[data-action="add-list"] input'; break;
      case 'add-item': { const l = state.lists.find(l => l.id === form.dataset.list); if (!l) return; l.items.push({ id: uid(), text, done: false, subs: [], open: false }); refocusSel = `form[data-action="add-item"][data-list="${l.id}"] input`; break; }
      case 'add-sub-item': {
        const l = state.lists.find(l => l.id === form.dataset.list);
        const parent = l && findSubRec(l.items, form.dataset.parent);
        if (!parent) return;
        parent.subs.push({ id: uid(), text, done: false, subs: [], open: false });
        parent.done = false;
        parent.open = true;
        refocusSel = `form[data-action="add-sub-item"][data-parent="${parent.id}"] input`;
        break;
      }
      default: return;
    }
    save(); render();
  });

  tabbar.addEventListener('click', e => { const btn = e.target.closest('.tab'); if (!btn) return; activeTab = btn.dataset.tab; activeQuestId = null; activeStepId = null; activeEventId = null; render(); });

  const importInput = document.getElementById('import-file');
  if (importInput) importInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { importData(String(reader.result)); importInput.value = ''; };
    reader.onerror = () => { backupStatus = 'Datei konnte nicht gelesen werden.'; importInput.value = ''; render(); };
    reader.readAsText(file);
  });

  function onReturn() { if (document.visibilityState !== 'visible') return; const ch = auditAllStreaks(); if (ch || dayStamp !== todayStr()) { dayStamp = todayStr(); if (ch) save(); render(); } }
  document.addEventListener('visibilitychange', onReturn);
  window.addEventListener('focus', onReturn);

  /* ---------- Strava-Sync ---------- */

  async function stravaSync(dateStr) {
    const token = stravaToken();
    const date = isDateStr(dateStr) ? dateStr : todayStr();
    if (!token || stravaSyncing) return;
    stravaSyncing = true; stravaStatus = ''; render();
    try {
      const { after, before } = dayRangeEpoch(date);
      const resp = await fetch('/.netlify/functions/strava-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: token, after, before }),
      });
      if (!resp.ok) {
        stravaStatus = resp.status === 401 ? 'Strava-Verbindung abgelaufen – bitte neu verbinden.' : `Sync fehlgeschlagen (${resp.status}).`;
        if (resp.status === 401) setStravaToken(null);
      } else {
        const data = await resp.json();
        if (data.refresh_token) setStravaToken(data.refresh_token);
        const res = processStravaActivities(data.activities || []);
        stravaStatus = (res.logged || res.checked)
          ? `${res.logged} Aktivität${res.logged === 1 ? '' : 'en'} geloggt · ${res.checked} Aufgabe${res.checked === 1 ? '' : 'n'} abgehakt`
          : 'Keine neuen Aktivitäten heute.';
        save();
      }
    } catch (e) {
      stravaStatus = 'Sync-Fehler (offline?).';
    }
    stravaSyncing = false; render();
  }

  /* Refresh-Token/Fehler aus dem URL-Fragment nach dem OAuth-Redirect übernehmen. */
  function handleStravaHash() {
    const h = location.hash || '';
    if (h.startsWith('#strava-refresh=')) {
      const tok = decodeURIComponent(h.slice('#strava-refresh='.length));
      if (tok) { setStravaToken(tok); stravaStatus = 'Mit Strava verbunden ✓'; activeTab = 'calendar'; calView = 'tag'; calCursor = todayStr(); }
      history.replaceState(null, '', location.pathname + location.search);
    } else if (h.startsWith('#strava-error=')) {
      stravaStatus = 'Strava-Fehler: ' + decodeURIComponent(h.slice('#strava-error='.length));
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  handleStravaHash();
  auditAllStreaks();
  save();
  render();

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Quest-Log: Service Worker nicht registriert', e)));
})();
