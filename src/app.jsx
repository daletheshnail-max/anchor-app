import React, { useState, useEffect, useReducer, useRef, useCallback, createContext, useContext, useMemo } from 'react';

/* ============================================================
   ANCHOR — a calm operating system for ADHD · depression · recovery
   Single-file, offline-first. State persisted to localStorage.
   Designed to plug into an external "Agent OS" via window.WellnessOS.
   ============================================================ */

const STORE_KEY = 'anchorOS.v1';
const todayISO = () => new Date().toISOString();
const dayMs = 86400000;
const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / dayMs);
// ISO week key, e.g. "2026-W27". Hoisted to module scope so every caller
// (reducer + WeeklyIntentions + WeeklyReviewPrompt + WeeklyCompassionPrompt) shares one definition.
const getWeek = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const y = d.getFullYear();
  const start = new Date(y, 0, 1);
  return y + '-W' + String(Math.ceil(((d - start) / 86400000 + 1) / 7)).padStart(2, '0');
};
// Local calendar-day key (YYYY-MM-DD in the user's own timezone) so the day rolls over at
// LOCAL midnight, not 02:00 UTC+2. Use everywhere a "which day" bucket/comparison is meant.
const localDateStr = (d = new Date()) => {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};
const todayKey = () => localDateStr(new Date());
const dayOf = (ts) => localDateStr(new Date(ts));

/* ---- Verified SA crisis contacts (confirm current; editable in Settings) ---- */
// Official lines are refreshed on every load (see loadState). Personal contacts stay separate.
// SOS renders these with no account, no payment, and no lock.
export const CRISIS = [
  { label: 'SADAG Suicide Crisis Line', sub: '24 hours', tel: '0800567567', show: '0800 567 567' },
  { label: 'DSD Substance Abuse Helpline', sub: '24 hours · SMS 32312', tel: '0800121314', show: '0800 12 13 14' },
  { label: 'Cipla Mental Health', sub: '24 hours · SMS 31393', tel: '0800456789', show: '0800 456 789' },
  { label: 'SADAG office, 8am–8pm', sub: 'office hours, not 24 hours', tel: '0112344837', show: '011 234 4837' },
  { label: 'Emergency', sub: 'mobile', tel: '112', show: '112' },
];

/* ---- Error boundary: no single widget may blank the app or the crisis path ---- */
class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err){ return { err: err }; }
  componentDidCatch(err, info){ try { console.warn('ErrorBoundary caught:', err, info); } catch(_){} }
  componentDidUpdate(prev){ if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null }); }
  render(){
    if (this.state.err) return this.props.fallback || (
      <div className="bg-panel border border-edge/40 rounded-2xl p-3 text-faint text-xs">This part hit a snag and was skipped — the rest of the app is fine.</div>
    );
    return this.props.children;
  }
}
function CrisisFallback({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-ink/97 backdrop-blur overflow-y-auto p-5">
      <div className="max-w-md mx-auto space-y-3">
        <div className="flex justify-between items-center">
          <h1 className="text-xl font-semibold">You're not alone</h1>
          {onClose && <button onClick={onClose} className="text-faint p-2" aria-label="Close">✕</button>}
        </div>
        <div className="text-faint text-sm">Something glitched, but help is one tap away.</div>
        {CRISIS.map(function(c,i){
          return (
            <a key={i} href={'tel:'+c.tel} className="block bg-panel border border-edge/40 rounded-2xl p-4">
              <div className="text-paper font-semibold">{c.label}</div>
              <div className="text-faint text-xs">{c.sub}</div>
              <div className="text-brand text-lg tabnum mt-1">{c.show}</div>
            </a>
          );
        })}
        <button onClick={function(){ location.reload(); }} className="w-full py-2 rounded-xl bg-panel2 text-paper text-sm">Reload the app</button>
      </div>
    </div>
  );
}

/* ---- Seed routines for the Flow engine ---- */
const SEED_ROUTINES = [
  { id: 'morning', name: 'Morning Start', emoji: '☀️', tint: 'warm',
    steps: [
      { id:'m1', label:'Sit up, feet on floor', sec:60 },
      { id:'m2', label:'Big glass of water', sec:90 },
      { id:'m3', label:'Take meds', sec:60 },
      { id:'m4', label:'Wash face / brush teeth', sec:180 },
      { id:'m5', label:'One stretch', sec:120 },
    ]},
  { id: 'reset', name: 'Reset', emoji: '🌀', tint: 'calm',
    steps: [
      { id:'r1', label:'Stand up, walk to window', sec:60 },
      { id:'r2', label:'Three slow breaths', sec:60 },
      { id:'r3', label:'Drink water', sec:60 },
      { id:'r4', label:'Name the next ONE task', sec:90 },
    ]},
  { id: 'winddown', name: 'Wind Down', emoji: '🌙', tint: 'brand',
    steps: [
      { id:'w1', label:'Screens dim / down', sec:120 },
      { id:'w2', label:'Tidy one surface', sec:180 },
      { id:'w3', label:'Set out tomorrow\'s water', sec:60 },
      { id:'w4', label:'Brush teeth', sec:120 },
      { id:'w5', label:'Slow breathing in bed', sec:240 },
    ]},
];

const MOODS = [
  { key:'great',   label:'Great',   emoji:'😊', tint:'grow'  },
  { key:'good',    label:'Good',    emoji:'🙂', tint:'brand' },
  { key:'ok',      label:'OK',      emoji:'😐', tint:'faint' },
  { key:'low',     label:'Low',     emoji:'😔', tint:'calm'  },
  { key:'anxious', label:'Anxious', emoji:'😰', tint:'warm'  },
];
const isHardMood = (k) => k === 'low' || k === 'anxious';

const TIPP = [
  { key:'temp',  title:'Temperature', emoji:'🧊', desc:'Cold water on your face, or hold an ice cube. Triggers the dive reflex and slows everything down.', secs:30 },
  { key:'exert', title:'Intense exercise', emoji:'🏃', desc:'60 seconds all-out — jumping jacks, run on the spot, push-ups. Burns the adrenaline.', secs:60 },
  { key:'paced', title:'Paced breathing', emoji:'💨', desc:'Breathe out longer than you breathe in. Follow the box below.', secs:60 },
  { key:'muscle',title:'Paired muscle relaxation', emoji:'💪', desc:'Tense as you breathe in, release as you breathe out. Work up the body.', secs:60 },
];

/* ---- Agent OS event envelope ---- */
const makeEvent = (type, payload) => ({
  v: 1, source: 'anchor-os', ts: todayISO(), type, payload: payload || {}
});

/* ============================ initial state ============================ */
function freshState() {
  return {
    user: { displayName: 'Dale', timezone: 'Africa/Johannesburg',
      preferences: { fontScale: 1.0, reduceMotion: false, soundEnabled: true, hapticEnabled: true, waterGoal: 8, bedtime: '22:00', sleepGoal: 7.5 },
      customAffirmations: [], favoriteAffirmations: [] },
    flow:    { routines: SEED_ROUTINES, history: [] },
    copilot: { history: [] },
    anchor:  { moodLog: [], thoughtRecords: [], gratitude: [], journal: [], sleep: [], breathingSessions: [], habits: [], habitLog: [], waterLog: [], meds: [], medLog: [], meditationLog: [], quickNotes: [], energyLog: [], focusSessions: [], intentions: [], compassionLog: [], dayRatings: [], weeklyIntentions: [], quickWins: [], tasks: [], goals: [] },
    recovery:{
      sobriety: { startDate: todayISO(), longestStreakDays: 0, totalDaysClean: 0 },
      urgeSurfSessions: [], triggers: [], relapseLog: [], recoveryJournal: [], copingSkillsLog: [], cravingLog: [],
      contacts: CRISIS.slice(), personal: [], supportNetwork: [], // supportNetwork = {name, role, contact}
      crisisPlan: { steps: ['','',''], safePerson: '', whatHelps: '' },
    },
    agentBridge: { config: { apiBaseUrl:'', apiKey:'', enabled:false },
      lastSyncAt:null, pendingEvents:[], inbox:[] },
    // Home layout: 'simple' shows a curated daily set; 'advanced' shows everything.
    // cardPrefs overrides per-card visibility in simple mode: { [cardId]: 'show' | 'hide' }.
    ui: { homeMode: 'simple', cardPrefs: {} },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return freshState();
    const s = JSON.parse(raw);
    // shallow merge to survive schema growth
    const base = freshState();
    return {
      ...base, ...s,
      user: { ...base.user, ...s.user, preferences:{ ...base.user.preferences, ...(s.user&&s.user.preferences) } },
      flow: { ...base.flow, ...s.flow },
      copilot: { ...base.copilot, ...s.copilot },
      anchor: { ...base.anchor, ...s.anchor },
      recovery: { ...base.recovery, ...s.recovery,
        // Always replace stored official lines so a number change reaches people who already have data.
        contacts: CRISIS.map(function(c){ return { ...c }; }),
        sobriety:{ ...base.recovery.sobriety, ...(s.recovery&&s.recovery.sobriety) },
        crisisPlan:{ ...base.recovery.crisisPlan, ...(s.recovery&&s.recovery.crisisPlan) } },
      agentBridge: { ...base.agentBridge, ...s.agentBridge,
        config:{ ...base.agentBridge.config, ...(s.agentBridge&&s.agentBridge.config) } },
      ui: { ...base.ui, ...s.ui, cardPrefs:{ ...(s.ui&&s.ui.cardPrefs) } },
    };
  } catch (e) {
    console.warn('load failed, fresh state', e);
    // Preserve the unreadable data under a rescue key so the 300ms persist effect can't overwrite it.
    try { const bad = localStorage.getItem(STORE_KEY); if (bad) localStorage.setItem(STORE_KEY + '.corrupt', bad); } catch (_) {}
    return freshState();
  }
}

/* ============================ reducer ============================ */
function reducer(state, action) {
  switch (action.type) {
    case 'EMIT': {
      const ev = makeEvent(action.event, action.payload);
      return { ...state, agentBridge: { ...state.agentBridge,
        pendingEvents: [...state.agentBridge.pendingEvents, ev].slice(-200) } };
    }
    case 'SET_USER':
      return { ...state, user: { ...state.user, ...action.user } };
    case 'PREFS':
      return { ...state, user: { ...state.user, preferences: { ...state.user.preferences, ...action.prefs } } };

    case 'UI_MODE':
      return { ...state, ui: { ...(state.ui||{cardPrefs:{}}), homeMode: action.mode } };
    case 'UI_CARD':
      return { ...state, ui: { ...(state.ui||{homeMode:'simple'}),
        cardPrefs: { ...((state.ui&&state.ui.cardPrefs)||{}), [action.id]: action.value } } };
    case 'UI_RESET_CARDS':
      return { ...state, ui: { ...(state.ui||{homeMode:'simple'}), cardPrefs: {} } };

    case 'FLOW_DONE':
      return { ...state, flow: { ...state.flow,
        history: [{ ts: todayISO(), routineId: action.routineId, completed: action.completed }, ...state.flow.history].slice(0,200) } };
    case 'ADD_ROUTINE':
      return { ...state, flow: { ...state.flow, routines: [...state.flow.routines, action.routine] } };
    case 'EDIT_ROUTINE':
      return { ...state, flow: { ...state.flow, routines: state.flow.routines.map(r => r.id === action.routine.id ? action.routine : r) } };
    case 'DELETE_ROUTINE':
      return { ...state, flow: { ...state.flow, routines: state.flow.routines.filter(r => r.id !== action.id) } };

    case 'COPILOT_DONE':
      return { ...state, copilot: { ...state.copilot,
        history: [{ ts: todayISO(), lengthMin: action.lengthMin, goal: action.goal, outcome: action.outcome }, ...state.copilot.history].slice(0,200) } };

    case 'MOOD_LOG':
      return { ...state, anchor: { ...state.anchor,
        moodLog: [{ ts: todayISO(), mood: action.mood, energy: action.energy, note: action.note||'', trigger: action.trigger||'' }, ...state.anchor.moodLog].slice(0,400) } };

    case 'THOUGHT_RECORD':
      return { ...state, anchor: { ...state.anchor,
        thoughtRecords: [{ id:'tr_'+Date.now(), ts: todayISO(), ...action.record }, ...state.anchor.thoughtRecords].slice(0,200) } };

    case 'GRATITUDE_LOG':
      return { ...state, anchor: { ...state.anchor,
        gratitude: [{ ts: todayISO(), items: action.items, category: action.category||'' }, ...state.anchor.gratitude].slice(0,200) } };

    case 'JOURNAL_LOG':
      return { ...state, anchor: { ...state.anchor,
        journal: [{ ts: todayISO(), text: action.text }, ...state.anchor.journal].slice(0,365) } };

    case 'WEEKLY_REFLECTION':
      return { ...state, anchor: { ...state.anchor,
        weeklyReflections: [{ ts: todayISO(), week: action.week, answers: action.answers }, ...(state.anchor.weeklyReflections||[])].slice(0,104) } };

    case 'SLEEP_LOG':
      return { ...state, anchor: { ...state.anchor,
        sleep: [{ ts: todayISO(), quality: action.quality, hours: action.hours, tags: action.tags||[] }, ...state.anchor.sleep].slice(0,365) } };

    case 'BREATHING_LOG':
      return { ...state, anchor: { ...state.anchor,
        breathingSessions: [{ ts: todayISO(), type: action.breathType, seconds: action.seconds }, ...state.anchor.breathingSessions].slice(0,500) } };

    case 'MEDITATION_LOG':
      return { ...state, anchor: { ...state.anchor,
        meditationLog: [{ ts: todayISO(), minutes: action.minutes, completed: action.completed !== false, sessionType: action.sessionType || 'meditation', theme: action.theme || '' }, ...(state.anchor.meditationLog||[])].slice(0,500) } };

    case 'ENERGY_LOG':
      // Unified: handles both the simple {level,note} and the {period,factors} payloads (was two clashing cases).
      return { ...state, anchor: { ...state.anchor,
        energyLog: [{ ts: todayISO(), level: action.level, note: action.note || '', period: action.period || '', factors: action.factors || [] }, ...(state.anchor.energyLog||[])].slice(0,500) } };

    case 'ADD_FOCUS_SESSION':
      // Store both minutes and duration so every reader (some use .minutes, some .duration) agrees.
      return { ...state, anchor: { ...state.anchor,
        focusSessions: [{ ts: todayISO(), minutes: action.duration || 25, duration: action.duration || 25, completed: action.completed !== false }, ...(state.anchor.focusSessions||[])].slice(0,500) } };

    case 'ADD_QUICK_WIN':
      return { ...state, anchor: { ...state.anchor,
        quickWins: [{ ts: todayISO(), text: action.text }, ...(state.anchor.quickWins||[])].slice(0,500) } };

    case 'ADD_QUICK_NOTE':
      return { ...state, anchor: { ...state.anchor,
        quickNotes: [{ id: Date.now().toString(36), ts: todayISO(), text: action.text }, ...(state.anchor.quickNotes||[])].slice(0,100) } };
    case 'REMOVE_QUICK_NOTE':
      return { ...state, anchor: { ...state.anchor,
        quickNotes: (state.anchor.quickNotes||[]).filter(function(n){ return n.id !== action.id; }) } };

    case 'ADD_TASK':
      return { ...state, anchor: { ...state.anchor,
        tasks: [{ id: Date.now().toString(36), text: action.text, due: action.due, priority: action.priority || 'medium', completed: false, createdTs: todayISO() }, ...(state.anchor.tasks||[])].slice(0,200) } };
    case 'COMPLETE_TASK':
      return { ...state, anchor: { ...state.anchor,
        tasks: (state.anchor.tasks||[]).map(function(t){ return t.id === action.id ? { ...t, completed: !t.completed } : t; }) } };
    case 'DELETE_TASK':
      return { ...state, anchor: { ...state.anchor,
        tasks: (state.anchor.tasks||[]).filter(function(t){ return t.id !== action.id; }) } };
    case 'UPDATE_TASK':
      return { ...state, anchor: { ...state.anchor,
        tasks: (state.anchor.tasks||[]).map(function(t){ return t.id === action.id ? { ...t, ...action.updates } : t; }) } };

    case 'ADD_GOAL':
      return { ...state, anchor: { ...state.anchor,
        goals: [{ id: Date.now().toString(36), title: action.title, target: action.target, current: 0, unit: action.unit || 'days', createdTs: todayISO() }, ...(state.anchor.goals||[])].slice(0,50) } };
    case 'UPDATE_GOAL_PROGRESS':
      return { ...state, anchor: { ...state.anchor,
        goals: (state.anchor.goals||[]).map(function(g){ return g.id === action.id ? { ...g, current: action.value } : g; }) } };
    case 'DELETE_GOAL':
      return { ...state, anchor: { ...state.anchor,
        goals: (state.anchor.goals||[]).filter(function(g){ return g.id !== action.id; }) } };

    case 'SET_INTENTION':
      return { ...state, anchor: { ...state.anchor,
        intentions: [{ date: todayKey(), text: action.text }, ...(state.anchor.intentions||[]).filter(function(i){ return i.date !== todayKey(); })].slice(0,90) } };

    case 'COMPLETE_INTENTION': {
      var today0 = todayKey();
      var already = (state.anchor.completedIntentions||[]).some(function(c){ return c.date===today0; });
      if (already) return state;
      return { ...state, anchor: { ...state.anchor,
        completedIntentions: [{ date: today0 }, ...(state.anchor.completedIntentions||[])].slice(0,365) } };
    }

    case 'ADD_THOUGHT_RECORD':
      return { ...state, anchor: { ...state.anchor,
        thoughtRecords: [{ id: Date.now().toString(36), ts: todayISO(), ...action.record }, ...(state.anchor.thoughtRecords||[])].slice(0,200) } };
    case 'REMOVE_THOUGHT_RECORD':
      return { ...state, anchor: { ...state.anchor,
        thoughtRecords: (state.anchor.thoughtRecords||[]).filter(function(r){ return r.id !== action.id; }) } };

    case 'FOCUS_LOG':
      return { ...state, anchor: { ...state.anchor,
        focusSessions: [{ ts: todayISO(), minutes: action.minutes || 25, duration: action.minutes || 25, completed: action.completed !== false, task: action.task || '' }, ...(state.anchor.focusSessions||[])].slice(0,500) } };

    case 'COMPASSION_REFLECT':
      return { ...state, anchor: { ...state.anchor,
        compassionLog: [{ ts: todayISO(), prompt: action.prompt, week: action.week }, ...(state.anchor.compassionLog||[])].slice(0,200) } };

    case 'DAY_RATING': {
      var existDR = (state.anchor.dayRatings||[]).filter(function(r){ return dayOf(r.ts) !== todayKey(); });
      return { ...state, anchor: { ...state.anchor,
        dayRatings: [{ ts: todayISO(), rating: action.rating, note: action.note||'' }, ...existDR].slice(0,365) } };
    }

    case 'SET_WEEKLY_INTENTIONS': {
      var week = action.week || getWeek();
      var existWI = (state.anchor.weeklyIntentions||[]).filter(function(w){ return w.week !== week; });
      return { ...state, anchor: { ...state.anchor,
        weeklyIntentions: [{ week: week, intentions: action.intentions||['','',''], completed: 0 }, ...existWI].slice(0,52) } };
    }

    case 'ADD_AFFIRMATION':
      return { ...state, user: { ...state.user,
        customAffirmations: [...(state.user.customAffirmations||[]), action.text].slice(0,20) } };
    case 'REMOVE_AFFIRMATION':
      return { ...state, user: { ...state.user,
        customAffirmations: (state.user.customAffirmations||[]).filter(function(_,i){ return i !== action.index; }) } };
    case 'TOGGLE_FAVORITE_AFFIRMATION': {
      var favs = state.user.favoriteAffirmations || [];
      var already = favs.includes(action.text);
      return { ...state, user: { ...state.user,
        favoriteAffirmations: already ? favs.filter(function(f){ return f !== action.text; }) : [...favs, action.text].slice(0,30) } };
    }

    case 'ADD_HABIT':
      return { ...state, anchor: { ...state.anchor,
        habits: [...(state.anchor.habits||[]), { id: Date.now().toString(36), label: action.label, icon: action.icon || '✅', why: action.why || '' }].slice(0,12) } };
    case 'SET_HABIT_WHY':
      return { ...state, anchor: { ...state.anchor,
        habits: (state.anchor.habits||[]).map(function(h){ return h.id === action.id ? { ...h, why: action.why } : h; }) } };
    case 'REMOVE_HABIT':
      return { ...state, anchor: { ...state.anchor,
        habits: (state.anchor.habits||[]).filter(function(h){ return h.id !== action.id; }) } };
    case 'TOGGLE_HABIT': {
      const log = state.anchor.habitLog || [];
      const key = action.id + ':' + todayKey();
      const restKey = action.id + ':rest:' + todayKey();
      const exists = log.some(function(e){ return e.key === key; });
      return { ...state, anchor: { ...state.anchor,
        habitLog: exists
          ? log.filter(function(e){ return e.key !== key; })
          : [{ key: key, ts: todayISO() }, ...log.filter(function(e){ return e.key !== restKey; })].slice(0,3650) } };
    }
    case 'HABIT_REST': {
      const log = state.anchor.habitLog || [];
      const restKey = action.id + ':rest:' + todayKey();
      const doneKey = action.id + ':' + todayKey();
      const alreadyRest = log.some(function(e){ return e.key === restKey; });
      return { ...state, anchor: { ...state.anchor,
        habitLog: alreadyRest
          ? log.filter(function(e){ return e.key !== restKey; })
          : [{ key: restKey, ts: todayISO() }, ...log.filter(function(e){ return e.key !== doneKey; })].slice(0,3650) } };
    }

    case 'WATER_LOG': {
      const wl = state.anchor.waterLog || [];
      const wKey = todayKey();
      const wEntry = wl.find(function(w){ return w.date === wKey; });
      if (wEntry) {
        const nCount = Math.max(0, wEntry.count + (action.delta || 1));
        return { ...state, anchor: { ...state.anchor,
          waterLog: wl.map(function(w){ return w.date === wKey ? { date: wKey, count: nCount } : w; }) } };
      }
      return { ...state, anchor: { ...state.anchor,
        waterLog: [{ date: wKey, count: Math.max(0, action.delta || 1) }, ...wl].slice(0,365) } };
    }

    case 'ADD_MED':
      return { ...state, anchor: { ...state.anchor,
        meds: [...(state.anchor.meds||[]), { id: Date.now().toString(36), name: action.name, time: action.time || 'morning', icon: action.icon || '💊' }].slice(0,20) } };
    case 'REMOVE_MED':
      return { ...state, anchor: { ...state.anchor,
        meds: (state.anchor.meds||[]).filter(function(m){ return m.id !== action.id; }) } };
    case 'TOGGLE_MED': {
      const ml = state.anchor.medLog || [];
      const mk = action.id + ':' + todayKey();
      const mexists = ml.some(function(e){ return e.key === mk; });
      return { ...state, anchor: { ...state.anchor,
        medLog: mexists ? ml.filter(function(e){ return e.key !== mk; }) : [{ key: mk, ts: todayISO() }, ...ml].slice(0,3650) } };
    }

    case 'URGE_SURF':
      return { ...state, recovery: { ...state.recovery,
        urgeSurfSessions: [{ ts: todayISO(), ...action.session }, ...state.recovery.urgeSurfSessions].slice(0,300) } };

    case 'TRIGGER_LOG':
      return { ...state, recovery: { ...state.recovery,
        triggers: [{ ts: todayISO(), ...action.trigger }, ...state.recovery.triggers].slice(0,300) } };

    case 'LOG_COPING_SKILL':
      return { ...state, recovery: { ...state.recovery,
        copingSkillsLog: [{ ts: todayISO(), skill: action.skill }, ...(state.recovery.copingSkillsLog||[])].slice(0,500) } };

    case 'LOG_CRAVING':
      return { ...state, recovery: { ...state.recovery,
        cravingLog: [{ ts: todayISO(), intensity: action.intensity }, ...(state.recovery.cravingLog||[])].slice(0,500) } };

    case 'ADD_SUPPORT':
      return { ...state, recovery: { ...state.recovery,
        supportNetwork: [{ id: Date.now().toString(36), name: action.name, role: action.role, contact: action.contact }, ...(state.recovery.supportNetwork||[])].slice(0,10) } };
    case 'REMOVE_SUPPORT':
      return { ...state, recovery: { ...state.recovery,
        supportNetwork: (state.recovery.supportNetwork||[]).filter(function(s){ return s.id !== action.id; }) } };

    case 'RELAPSE': {
      // COMPASSIONATE: never zero total. Preserve longest. Start a fresh streak from now.
      const sob = state.recovery.sobriety;
      const endedStreak = daysBetween(sob.startDate, todayISO());
      const longest = Math.max(sob.longestStreakDays || 0, endedStreak);
      const total = (sob.totalDaysClean || 0) + Math.max(0, endedStreak);
      return { ...state, recovery: { ...state.recovery,
        sobriety: { ...sob, startDate: todayISO(), longestStreakDays: longest, totalDaysClean: total },
        relapseLog: [{ ts: todayISO(), ...action.entry }, ...state.recovery.relapseLog].slice(0,200) } };
    }

    case 'RECOVERY_JOURNAL':
      return { ...state, recovery: { ...state.recovery,
        recoveryJournal: [{ ts: todayISO(), prompt: action.prompt, text: action.text, streak: action.streak || 0 }, ...(state.recovery.recoveryJournal||[])].slice(0,300) } };

    case 'SET_SOBRIETY_START':
      return { ...state, recovery: { ...state.recovery,
        sobriety: { ...state.recovery.sobriety, startDate: action.date } } };

    case 'SET_CRISIS_PLAN':
      return { ...state, recovery: { ...state.recovery,
        crisisPlan: { ...state.recovery.crisisPlan, ...action.plan } } };

    case 'SET_CONTACTS':
      return { ...state, recovery: { ...state.recovery, contacts: action.contacts } };
    case 'SET_PERSONAL':
      return { ...state, recovery: { ...state.recovery, personal: action.personal } };

    case 'BRIDGE_CONFIG':
      return { ...state, agentBridge: { ...state.agentBridge, config: { ...state.agentBridge.config, ...action.config } } };
    case 'BRIDGE_FLUSH':
      return { ...state, agentBridge: { ...state.agentBridge, pendingEvents: [], lastSyncAt: todayISO() } };
    case 'BRIDGE_INBOX':
      return { ...state, agentBridge: { ...state.agentBridge, inbox: action.inbox } };

    case 'IMPORT':
      return action.state;
    case 'RESET':
      return freshState();
    default:
      return state;
  }
}

/* ============================ context ============================ */
const Ctx = createContext(null);
const useStore = () => useContext(Ctx);

/* ============================ countdown hook ============================ */
function useCountdown(onComplete) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [running, setRunning] = useState(false);
  const endRef = useRef(0);
  const totalRef = useRef(0);
  const cbRef = useRef(onComplete);
  cbRef.current = onComplete;

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const left = Math.max(0, Math.round((endRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) { setRunning(false); buzz(80); chime(); if (cbRef.current) cbRef.current(); }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [running]);

  const start = useCallback((sec) => { totalRef.current = sec; endRef.current = Date.now()+sec*1000; setSecondsLeft(sec); setRunning(true); }, []);
  const pause = useCallback(() => setRunning(false), []);
  const resume = useCallback(() => { endRef.current = Date.now()+secondsLeft*1000; setRunning(true); }, [secondsLeft]);
  const stop  = useCallback(() => { setRunning(false); setSecondsLeft(0); }, []);
  const total = totalRef.current;
  return { secondsLeft, running, start, pause, resume, stop, total };
}

const fmt = (s) => { const m = Math.floor(s/60), ss = s%60; return m+':'+String(ss).padStart(2,'0'); };

let _prefs = { soundEnabled: true, hapticEnabled: true };
const setAudioPrefs = (p) => { _prefs = p; };
const buzz = (ms = 30) => { try { if (_prefs.hapticEnabled) navigator.vibrate && navigator.vibrate(ms); } catch(e){} };

const chime = (freq = 528, dur = 0.4) => {
  if (!_prefs.soundEnabled) return;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ac.createOscillator(); const g = ac.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    g.gain.setValueAtTime(0.15, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.connect(g); g.connect(ac.destination);
    osc.start(); osc.stop(ac.currentTime + dur);
    setTimeout(() => ac.close(), (dur + 0.1) * 1000);
  } catch(e){}
};

const AFFIRMATIONS = [
  'You are doing better than you think.',
  'Progress, not perfection.',
  'One step at a time is still moving forward.',
  'You deserve the same kindness you give others.',
  'Difficult roads often lead to beautiful places.',
  'You have survived 100% of your worst days.',
  'Rest is productive. You are allowed to pause.',
  'Small steps still count.',
  'You are not your thoughts.',
  'Today you choose yourself.',
  'Healing is not linear, and that is okay.',
  'You are stronger than the urge.',
  'Every day you show up matters.',
  'Be gentle with yourself — you are doing hard things.',
  'The fact that you are here means you are trying.',
  'You are worthy of good things.',
  'This feeling will pass. You have felt it before and survived.',
  'Your pace is valid.',
  'Breathe. You are exactly where you need to be.',
  'Tomorrow is a fresh page. Today, just do your best.',
];
const getDailyAffirmation = (custom) => {
  const pool = AFFIRMATIONS.concat(custom || []);
  const d = new Date(); const seed = d.getFullYear()*10000 + (d.getMonth()+1)*100 + d.getDate();
  return pool[seed % pool.length];
};

const MILESTONES = [
  { days:1,   msg:'Day one. You showed up.' },
  { days:7,   msg:'One week strong.' },
  { days:14,  msg:'Two weeks. Building momentum.' },
  { days:30,  msg:'A full month. That took real courage.' },
  { days:60,  msg:'60 days. This is who you are now.' },
  { days:90,  msg:'90 days. A whole quarter of growth.' },
  { days:180, msg:'Half a year. Extraordinary.' },
  { days:365, msg:'One year. You did something remarkable.' },
];
const getMilestone = (days) => MILESTONES.find(m => m.days === days);

function getAppStreak(state) {
  const allDates = new Set();
  state.anchor.moodLog.forEach(m => allDates.add(dayOf(m.ts)));
  state.flow.history.forEach(h => allDates.add(dayOf(h.ts)));
  state.copilot.history.forEach(h => allDates.add(dayOf(h.ts)));
  (state.anchor.gratitude||[]).forEach(g => allDates.add(dayOf(g.ts)));
  (state.anchor.journal||[]).forEach(j => allDates.add(dayOf(j.ts)));
  (state.anchor.sleep||[]).forEach(s => allDates.add(dayOf(s.ts)));
  (state.anchor.breathingSessions||[]).forEach(b => allDates.add(dayOf(b.ts)));
  (state.anchor.waterLog||[]).forEach(w => allDates.add(w.date));
  (state.anchor.meditationLog||[]).forEach(m => allDates.add(dayOf(m.ts)));
  (state.anchor.energyLog||[]).forEach(m => allDates.add(dayOf(m.ts)));
  (state.anchor.focusSessions||[]).forEach(m => allDates.add(dayOf(m.ts)));
  let streak = 0;
  const d = new Date();
  while (true) {
    const ds = localDateStr(d);
    if (allDates.has(ds)) { streak++; d.setDate(d.getDate()-1); }
    else break;
  }
  return streak;
}

function getWeeklyInsights(state) {
  const now = new Date();
  const weekAgo = new Date(now - 7 * dayMs).toISOString();
  const moods = state.anchor.moodLog.filter(m => m.ts >= weekAgo);
  const routines = state.flow.history.filter(h => h.ts >= weekAgo && h.completed);
  const sessions = state.copilot.history.filter(h => h.ts >= weekAgo);
  const moodVal = { great:5, good:4, ok:3, low:2, anxious:1 };
  const avg = moods.length ? (moods.reduce((s,m) => s + (moodVal[m.mood]||3), 0) / moods.length) : null;
  const avgLabel = avg ? (avg >= 4.5 ? 'Great' : avg >= 3.5 ? 'Good' : avg >= 2.5 ? 'OK' : avg >= 1.5 ? 'Low' : 'Tough') : null;
  return { moods: moods.length, routines: routines.length, sessions: sessions.length, avg, avgLabel };
}

const BREATHING_PATTERNS = {
  box: { name: 'Box Breathing', phases: ['Inhale','Hold','Exhale','Hold'], durations: [4,4,4,4], color: '#6aa0ff' },
  calm: { name: '4-7-8 Calm', phases: ['Inhale','Hold','Exhale'], durations: [4,7,8], color: '#b08cff' },
};

const BADGES = [
  { id:'first_mood', icon:'🌟', label:'First check-in', test: s => s.anchor.moodLog.length >= 1 },
  { id:'mood_10', icon:'📊', label:'10 check-ins', test: s => s.anchor.moodLog.length >= 10 },
  { id:'mood_50', icon:'🏆', label:'50 check-ins', test: s => s.anchor.moodLog.length >= 50 },
  { id:'first_routine', icon:'⚡', label:'First routine', test: s => s.flow.history.some(h => h.completed) },
  { id:'routine_7', icon:'🔥', label:'7 routines done', test: s => s.flow.history.filter(h => h.completed).length >= 7 },
  { id:'first_journal', icon:'📝', label:'First journal', test: s => (s.anchor.journal||[]).length >= 1 },
  { id:'journal_7', icon:'✍️', label:'Week of journaling', test: s => (s.anchor.journal||[]).length >= 7 },
  { id:'first_gratitude', icon:'🌻', label:'First gratitude', test: s => (s.anchor.gratitude||[]).length >= 1 },
  { id:'first_breath', icon:'🌬️', label:'First breathing', test: s => (s.anchor.breathingSessions||[]).length >= 1 },
  { id:'breath_10', icon:'🧘', label:'10 breathing sessions', test: s => (s.anchor.breathingSessions||[]).length >= 10 },
  { id:'first_sleep', icon:'😴', label:'First sleep log', test: s => (s.anchor.sleep||[]).length >= 1 },
  { id:'sleep_7', icon:'🛏️', label:'Week of sleep logs', test: s => (s.anchor.sleep||[]).length >= 7 },
  { id:'streak_3', icon:'🔗', label:'3-day streak', test: s => getAppStreak(s) >= 3 },
  { id:'streak_7', icon:'💪', label:'7-day streak', test: s => getAppStreak(s) >= 7 },
  { id:'streak_30', icon:'👑', label:'30-day streak', test: s => getAppStreak(s) >= 30 },
  { id:'session_1', icon:'🤝', label:'First focus session', test: s => s.copilot.history.length >= 1 },
  { id:'ground_1', icon:'🌳', label:'First grounding', test: s => (s.recovery.urgeSurfSessions||[]).length >= 1 },
  { id:'thought_1', icon:'🧠', label:'First thought record', test: s => s.anchor.thoughtRecords.length >= 1 },
  { id:'water_goal', icon:'💧', label:'Hit water goal', test: function(s){ var g = (s.user.preferences && s.user.preferences.waterGoal) || 8; return (s.anchor.waterLog||[]).some(function(w){ return w.count >= g; }); } },
  { id:'habit_streak', icon:'🏅', label:'All habits done', test: s => { const h = s.anchor.habits||[]; const l = s.anchor.habitLog||[]; const d = todayKey(); return h.length > 0 && h.every(function(hb){ return l.some(function(e){ return e.key === hb.id+':'+d; }); }); } },
  { id:'meds_all', icon:'💊', label:'All meds taken', test: s => { const m = s.anchor.meds||[]; const ml = s.anchor.medLog||[]; const d = todayKey(); return m.length > 0 && m.every(function(med){ return ml.some(function(e){ return e.key === med.id+':'+d; }); }); } },
  { id:'first_meditation', icon:'🧘‍♂️', label:'First meditation', test: s => (s.anchor.meditationLog||[]).length >= 1 },
  { id:'meditation_10', icon:'🪷', label:'10 meditations', test: s => (s.anchor.meditationLog||[]).filter(function(m){ return m.completed; }).length >= 10 },
  { id:'first_energy', icon:'🔋', label:'First energy log', test: function(s){ return (s.anchor.energyLog||[]).length >= 1; } },
  { id:'first_focus', icon:'🎯', label:'First focus session', test: function(s){ return (s.anchor.focusSessions||[]).filter(function(f){ return f.completed; }).length >= 1; } },
  { id:'focus_10', icon:'🏆', label:'10 focus sessions', test: function(s){ return (s.anchor.focusSessions||[]).filter(function(f){ return f.completed; }).length >= 10; } },
  { id:'gratitude_7', icon:'🌻', label:'7-day gratitude streak', test: function(s){ var g = s.anchor.gratitude||[]; var dates = new Set(g.map(function(x){ return x.ts ? dayOf(x.ts) : ''; })); var streak = 0; for(var i=0;i<7;i++){ var d = new Date(); d.setDate(d.getDate()-i); if(dates.has(localDateStr(d))) streak++; else break; } return streak >= 7; } },
  { id:'recovery_7', icon:'🌱', label:'7 days clean', test: function(s){ var sd = s.recovery && s.recovery.sobriety && s.recovery.sobriety.startDate; if(!sd) return false; return Math.floor((Date.now()-new Date(sd))/86400000) >= 7; } },
  { id:'recovery_14', icon:'🌿', label:'2 weeks clean', test: function(s){ var sd = s.recovery && s.recovery.sobriety && s.recovery.sobriety.startDate; if(!sd) return false; return Math.floor((Date.now()-new Date(sd))/86400000) >= 14; } },
  { id:'recovery_30', icon:'💚', label:'30 days clean', test: function(s){ var sd = s.recovery && s.recovery.sobriety && s.recovery.sobriety.startDate; if(!sd) return false; return Math.floor((Date.now()-new Date(sd))/86400000) >= 30; } },
  { id:'recovery_60', icon:'🎖️', label:'60 days clean', test: function(s){ var sd = s.recovery && s.recovery.sobriety && s.recovery.sobriety.startDate; if(!sd) return false; return Math.floor((Date.now()-new Date(sd))/86400000) >= 60; } },
  { id:'recovery_90', icon:'🏅', label:'90 days clean', test: function(s){ var sd = s.recovery && s.recovery.sobriety && s.recovery.sobriety.startDate; if(!sd) return false; return Math.floor((Date.now()-new Date(sd))/86400000) >= 90; } },
  { id:'recovery_180', icon:'⭐', label:'6 months clean', test: function(s){ var sd = s.recovery && s.recovery.sobriety && s.recovery.sobriety.startDate; if(!sd) return false; return Math.floor((Date.now()-new Date(sd))/86400000) >= 180; } },
  { id:'recovery_365', icon:'🏆', label:'One year clean', test: function(s){ var sd = s.recovery && s.recovery.sobriety && s.recovery.sobriety.startDate; if(!sd) return false; return Math.floor((Date.now()-new Date(sd))/86400000) >= 365; } },
  { id:'cbt_first', icon:'🧠', label:'First thought record', test: function(s){ return (s.anchor.thoughtRecords||[]).length >= 1; } },
  { id:'intention_7', icon:'🎯', label:'7 daily intentions', test: function(s){ return (s.anchor.intentions||[]).length >= 7; } },
];

function useEscape(onEscape) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onEscape(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onEscape]);
}

/* ============================ UI atoms ============================ */
function SectionLabel({ text, icon }) {
  return (
    <div className="flex items-center gap-2 mt-1 mb-1 px-1">
      {icon && <span className="text-sm">{icon}</span>}
      <span className="text-xs font-semibold uppercase tracking-widest text-faint">{text}</span>
      <div className="flex-1 h-px bg-edge/30" />
    </div>
  );
}

function Ring({ frac, size=260, stroke=14, color='#6aa0ff', children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, frac)));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width:size, height:size }}>
      <svg width={size} height={size} className="rotate-[-90deg]">
        <circle cx={size/2} cy={size/2} r={r} stroke="#1b2742" strokeWidth={stroke} fill="none" />
        <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
          style={{ transition:'stroke-dashoffset .3s linear' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">{children}</div>
    </div>
  );
}

function Btn({ children, onClick, tone='ghost', className='', ...rest }) {
  const tones = {
    primary: 'bg-brand text-ink font-semibold hover:brightness-110',
    grow:    'bg-grow text-ink font-semibold hover:brightness-110',
    calm:    'bg-calm text-ink font-semibold hover:brightness-110',
    ghost:   'bg-panel2 text-paper hover:bg-edge',
    quiet:   'bg-transparent text-faint hover:text-paper',
  };
  return (
    <button onClick={onClick} {...rest}
      className={'px-5 py-3 rounded-2xl text-base transition active:scale-[.98] '+(tones[tone]||tones.ghost)+' '+className}>
      {children}
    </button>
  );
}

function Card({ children, className='', ...rest }) {
  return <div {...rest} className={'bg-panel rounded-3xl p-5 shadow-soft border border-edge/40 '+className}>{children}</div>;
}

/* ============================ Search ============================ */
function SearchOverlay({ onClose }) {
  var _s = useStore(); var state = _s.state; var a = state.anchor;
  var [q, setQ] = useState('');
  var inputRef = useRef(null);
  useEffect(function(){ if(inputRef.current) inputRef.current.focus(); }, []);
  var query = q.trim().toLowerCase();
  var results = [];
  if (query.length >= 2) {
    (a.journal||[]).forEach(function(e){
      if (e.text && e.text.toLowerCase().includes(query))
        results.push({ type:'Journal', icon:'📝', date:e.ts, snippet: e.text.slice(0,120) });
    });
    (a.gratitude||[]).forEach(function(e){
      var match = (e.items||[]).filter(function(it){ return it.toLowerCase().includes(query); });
      if (match.length)
        results.push({ type:'Gratitude', icon:'🌻', date:e.ts, snippet: match.join(' · ').slice(0,120) });
    });
    (a.moodLog||[]).forEach(function(e){
      if (e.note && e.note.toLowerCase().includes(query))
        results.push({ type:'Mood note', icon:'💬', date:e.ts, snippet: e.note.slice(0,120) });
    });
    (a.quickNotes||[]).forEach(function(e){
      if (e.text && e.text.toLowerCase().includes(query))
        results.push({ type:'Quick note', icon:'⚡', date:e.ts, snippet: e.text.slice(0,120) });
    });
    (a.thoughtRecords||[]).forEach(function(e){
      var text = [e.thought,e.challenge,e.reframe].filter(Boolean).join(' ');
      if (text.toLowerCase().includes(query))
        results.push({ type:'CBT record', icon:'🧠', date:e.ts, snippet: text.slice(0,120) });
    });
    (a.weeklyReflections||[]).forEach(function(e){
      var text = Object.values(e.answers||{}).join(' ');
      if (text.toLowerCase().includes(query))
        results.push({ type:'Reflection', icon:'📋', date:e.ts, snippet: text.slice(0,120) });
    });
    results.sort(function(a2,b2){ return b2.date > a2.date ? 1 : -1; });
  }
  function highlight(text) {
    if (!query) return text;
    var idx = text.toLowerCase().indexOf(query);
    if (idx < 0) return text;
    return text.slice(0,idx) + '«' + text.slice(idx, idx+query.length) + '»' + text.slice(idx+query.length);
  }
  function fmtDate(ts){ return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
  return (
    <div className="fixed inset-0 z-50 bg-ink/95 backdrop-blur flex flex-col">
      <div className="max-w-md mx-auto w-full flex flex-col flex-1 px-4 pt-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 flex items-center gap-2 bg-panel border border-edge rounded-2xl px-3 py-2">
            <span className="text-faint">🔍</span>
            <input ref={inputRef} value={q} onChange={function(e){ setQ(e.target.value); }}
              placeholder="Search journal, gratitude, notes..." autoComplete="off"
              className="flex-1 bg-transparent text-paper text-sm outline-none placeholder-faint" />
            {q && <button className="text-faint hover:text-paper" onClick={function(){ setQ(''); }}>✕</button>}
          </div>
          <button onClick={onClose} className="text-faint hover:text-paper text-sm px-2 py-1">Done</button>
        </div>
        {query.length > 0 && query.length < 2 && (
          <div className="text-faint text-sm text-center mt-8">Type at least 2 characters...</div>
        )}
        {query.length >= 2 && results.length === 0 && (
          <div className="text-faint text-sm text-center mt-8">No results for &ldquo;{q}&rdquo;</div>
        )}
        {results.length > 0 && (
          <div className="text-xs text-faint mb-3">{results.length} result{results.length!==1?'s':''}</div>
        )}
        <div className="flex-1 overflow-y-auto space-y-2 pb-8">
          {results.map(function(r,i){
            return (
              <div key={i} className="bg-panel border border-edge rounded-2xl p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-faint"
                    dangerouslySetInnerHTML={{__html: r.icon+' '+r.type}}></span>
                  <span className="text-xs text-faint">{fmtDate(r.date)}</span>
                </div>
                <div className="text-sm text-paper leading-snug">{highlight(r.snippet)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================ Header ============================ */
function Header({ onSettings, onSearch }) {
  const { state } = useStore();
  const clean = daysBetween(state.recovery.sobriety.startDate, todayISO());
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(()=>setNow(new Date()), 30000); return ()=>clearInterval(id); }, []);
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <header className="flex items-center justify-between gap-3 px-1 pt-2 pb-4">
      <div>
        <div className="text-faint text-sm">{greet}, {state.user.displayName}</div>
        <div className="flex items-center gap-2 mt-1">
          <span className="inline-flex items-center gap-2 bg-panel rounded-full px-3 py-1 border border-grow/30">
            <span className="w-2 h-2 rounded-full bg-grow"></span>
            <span className="text-sm tabnum"><b className="text-grow">{clean}</b> day{clean===1?'':'s'} of recovery</span>
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
      <button onClick={onSearch} className="text-faint hover:text-paper p-2 rounded-xl hover:bg-panel" title="Search" aria-label="Search">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      </button>
      <button onClick={onSettings} className="text-faint hover:text-paper p-2 rounded-xl hover:bg-panel" title="Settings" aria-label="Settings">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      </div>
    </header>
  );
}

/* ============================ Bottom nav ============================ */
const TABS = [
  { key:'home',    label:'Home',     icon:'M3 11l9-8 9 8M5 10v10h14V10' },
  { key:'flow',    label:'Flow',     icon:'M5 12h14M12 5l7 7-7 7' },
  { key:'copilot', label:'Co-Pilot', icon:'M12 3a4 4 0 014 4v1a4 4 0 01-8 0V7a4 4 0 014-4zM5 21v-1a7 7 0 0114 0v1' },
  { key:'anchor',  label:'Anchor',   icon:'M12 8a3 3 0 100-6 3 3 0 000 6zM12 8v13M5 13a7 7 0 0014 0' },
];
function BottomNav({ tab, setTab }) {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 bg-ink/85 backdrop-blur border-t border-edge/50">
      <div className="max-w-md mx-auto flex">
        {TABS.map(t => {
          const on = tab === t.key;
          return (
            <button key={t.key} onClick={()=>setTab(t.key)}
              className={'flex-1 flex flex-col items-center gap-1 py-3 transition '+(on?'text-brand':'text-faint hover:text-paper')}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={t.icon}/></svg>
              <span className="text-xs">{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ============================ SOS floating button ============================ */
function SOSButton({ onClick }) {
  return (
    <button onClick={onClick} aria-label="SOS — cravings & distress help"
      className="fixed z-40 right-4 bottom-24 w-20 h-20 rounded-full bg-rose text-ink font-bold text-lg shadow-glow active:scale-95 transition flex flex-col items-center justify-center leading-none">
      <span className="text-2xl">⚓</span>
      <span className="text-[11px] mt-0.5 tracking-wide">SOS</span>
    </button>
  );
}

function BreathingExercise({ onClose }) {
  const { state, dispatch } = useStore();
  const [pattern, setPattern] = useState(null);
  const [phase, setPhase] = useState(0);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const [cycles, setCycles] = useState(0);
  const elapsed = useRef(0);
  const _cr = useState([4, 0, 6]); const customRaw = _cr[0]; const setCustomRaw = _cr[1];
  const customRawRef = useRef([4, 0, 6]);
  useEffect(function(){ customRawRef.current = customRaw; }, [customRaw]);
  function buildCustomPat(raw) {
    var phases = []; var durs = [];
    var names = ['Inhale','Hold','Exhale'];
    for (var i = 0; i < 3; i++) { if (raw[i] > 0) { phases.push(names[i]); durs.push(raw[i]); } }
    if (!phases.length) { phases = ['Inhale']; durs = [4]; }
    return { name:'Custom', phases:phases, durations:durs, color:'#3ddc97' };
  }
  const customPatRef = useRef(buildCustomPat([4,0,6]));
  useEffect(function(){ customPatRef.current = buildCustomPat(customRaw); }, [customRaw]);
  function resolvePattern(key) { return key === 'custom' ? customPatRef.current : BREATHING_PATTERNS[key]; }

  useEffect(() => {
    if (!running || !pattern) return;
    const p = resolvePattern(pattern);
    if (!p || !p.durations[phase]) return;
    const id = setInterval(() => {
      setTick(t => {
        const next = t + 1;
        elapsed.current++;
        if (next >= p.durations[phase]) {
          setPhase(ph => {
            const np = ph + 1;
            if (np >= p.phases.length) { setCycles(c => c + 1); return 0; }
            return np;
          });
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, pattern, phase]);

  const stop = () => {
    setRunning(false);
    if (elapsed.current > 5) {
      dispatch({ type:'BREATHING_LOG', breathType: pattern, seconds: elapsed.current });
      buzz(30); chime(528, 0.5);
    }
  };

  if (!pattern) {
    var bSessions = state.anchor.breathingSessions || [];
    var todayStr2 = todayKey();
    var todaySessions = bSessions.filter(function(b){ return dayOf(b.ts) === todayStr2; }).length;
    var totalMins = Math.round(bSessions.reduce(function(s,b){ return s + (b.seconds||0); }, 0) / 60);
    var typeCounts = {};
    bSessions.forEach(function(b){ typeCounts[b.type] = (typeCounts[b.type]||0) + 1; });
    var favType = Object.keys(typeCounts).sort(function(a,b){ return typeCounts[b]-typeCounts[a]; })[0];
    var favLabel = favType && BREATHING_PATTERNS[favType] ? BREATHING_PATTERNS[favType].name : null;
    return (
      <div className="rise space-y-4">
        {onClose && <button onClick={onClose} className="text-faint text-sm">‹ Back</button>}
        <h2 className="text-xl font-semibold">Breathing exercises</h2>
        {bSessions.length > 0 && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-panel2 rounded-xl py-2 px-1">
              <div className="text-lg font-bold tabnum text-brand">{bSessions.length}</div>
              <div className="text-faint text-[10px]">total</div>
            </div>
            <div className="bg-panel2 rounded-xl py-2 px-1">
              <div className="text-lg font-bold tabnum text-calm">{totalMins}</div>
              <div className="text-faint text-[10px]">minutes</div>
            </div>
            <div className="bg-panel2 rounded-xl py-2 px-1">
              <div className="text-sm font-bold text-grow truncate px-1">{favLabel || '—'}</div>
              <div className="text-faint text-[10px]">favourite</div>
            </div>
          </div>
        )}
        {todaySessions > 0 && (
          <div className="text-xs text-grow text-center">{todaySessions} session{todaySessions!==1?'s':''} today ✓</div>
        )}
        <p className="text-faint text-sm">Pick a pattern. Follow the guide. Your body knows what to do.</p>
        {Object.entries(BREATHING_PATTERNS).map(([k,v]) => (
          <Card key={k} className="cursor-pointer hover:border-brand/40" onClick={() => { setPattern(k); setRunning(true); setPhase(0); setTick(0); setCycles(0); elapsed.current = 0; }}>
            <div className="flex items-center justify-between">
              <div className="font-semibold" style={{color:v.color}}>{v.name}</div>
              {typeCounts[k] > 0 && <span className="text-xs text-faint">{typeCounts[k]}×</span>}
            </div>
            <div className="text-faint text-sm">{v.phases.map((p,i) => p+' '+v.durations[i]+'s').join(' → ')}</div>
          </Card>
        ))}
        {(function(){
          var CLABELS = ['Inhale (s)','Hold (s)','Exhale (s)'];
          var preview = buildCustomPat(customRaw);
          function step(i, delta) {
            setCustomRaw(function(prev){
              var next = prev.slice();
              next[i] = Math.max(i === 1 ? 0 : 1, Math.min(20, next[i] + delta));
              return next;
            });
          }
          return (
            <Card className="border-grow/20">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold text-grow">⚙ Custom</div>
                <button onClick={function(){
                  setPattern('custom'); setRunning(true); setPhase(0); setTick(0); setCycles(0); elapsed.current = 0;
                }} className="text-xs bg-grow/20 text-grow px-3 py-1 rounded-full hover:bg-grow/30">Start</button>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {CLABELS.map(function(lbl, i){
                  return React.createElement('div', { key: i, className:'text-center' },
                    React.createElement('div', { className:'text-[10px] text-faint mb-1' }, lbl),
                    React.createElement('div', { className:'flex items-center justify-center gap-1.5' },
                      React.createElement('button', {
                        onClick: function(){ step(i, -1); },
                        className:'text-faint hover:text-paper text-base w-7 h-7 rounded-lg bg-panel2 flex items-center justify-center'
                      }, '−'),
                      React.createElement('span', { className:'tabnum text-paper font-semibold text-sm w-6 text-center' }, customRaw[i]),
                      React.createElement('button', {
                        onClick: function(){ step(i, +1); },
                        className:'text-faint hover:text-paper text-base w-7 h-7 rounded-lg bg-panel2 flex items-center justify-center'
                      }, '+')
                    )
                  );
                })}
              </div>
              <div className="text-faint text-xs text-center">
                {preview.phases.map(function(ph,i){ return ph+' '+preview.durations[i]+'s'; }).join(' → ')}
              </div>
            </Card>
          );
        })()}
      </div>
    );
  }

  const p = resolvePattern(pattern);
  const frac = tick / (p.durations[phase] || 1);
  const scale = p.phases[phase] === 'Inhale' ? 0.6 + frac * 0.4 : p.phases[phase] === 'Exhale' ? 1.0 - frac * 0.4 : 1.0;

  return (
    <div className="rise space-y-6 text-center">
      <div className="flex justify-between items-center">
        <button onClick={() => { stop(); setPattern(null); }} className="text-faint text-sm">‹ Back</button>
        <span className="text-faint text-sm tabnum">{cycles} cycle{cycles !== 1 ? 's' : ''}</span>
      </div>
      <div className="flex justify-center">
        <div className="rounded-full flex items-center justify-center transition-transform duration-1000" style={{
          width: '180px', height: '180px',
          background: 'radial-gradient(circle,' + p.color + '22,' + p.color + '08)',
          border: '3px solid ' + p.color + '66',
          transform: 'scale(' + scale + ')',
        }}>
          <div>
            <div className="text-3xl font-bold" style={{color:p.color}}>{p.phases[phase]}</div>
            <div className="text-5xl font-bold tabnum text-paper mt-1">{p.durations[phase] - tick}</div>
          </div>
        </div>
      </div>
      <div className="flex justify-center gap-1">
        {p.phases.map((ph,i) => (
          <div key={i} className="rounded-full h-2 transition-all" style={{
            width: i === phase ? '32px' : '8px',
            background: i === phase ? p.color : p.color + '44',
          }} />
        ))}
      </div>
      <Btn tone={running ? 'ghost' : 'grow'} className="w-full" onClick={() => {
        if (running) stop(); else { setRunning(true); setPhase(0); setTick(0); }
      }}>{running ? 'Stop' : 'Resume'}</Btn>
    </div>
  );
}

function SleepLogger() {
  const { state, dispatch } = useStore();
  const todayStr = todayKey();
  const todayLog = (state.anchor.sleep||[]).find(s => dayOf(s.ts) === todayStr);
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState(3);
  const [hours, setHours] = useState(7);
  const [sleepTags, setSleepTags] = useState([]);
  const sleepEmoji = ['','😫','😪','😐','😊','😴'];
  const SLEEP_TAGS = ['Caffeine','Stress','Late screen','Exercise','Alcohol','Late meal','Noise','Anxiety','Good routine'];
  const toggleSleepTag = function(t){ setSleepTags(function(prev){ return prev.includes(t) ? prev.filter(function(x){ return x!==t; }) : [...prev,t]; }); };

  const save = () => {
    dispatch({ type:'SLEEP_LOG', quality, hours, tags: sleepTags });
    buzz(20); chime(440, 0.3);
    setOpen(false);
    setSleepTags([]);
  };

  if (todayLog) return (
    <Card className="border-brand/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{sleepEmoji[todayLog.quality]}</span>
          <span className="text-faint text-sm">Slept {todayLog.hours}h · quality {todayLog.quality}/5</span>
        </div>
        <EnergyIndicator />
      </div>
    </Card>
  );

  if (!open) return (
    <Card className="border-brand/20 cursor-pointer hover:border-brand/40" onClick={() => setOpen(true)}>
      <div className="flex items-center gap-2"><span className="text-xl">😴</span><span className="text-paper font-semibold">Log last night&#39;s sleep</span></div>
      <div className="text-faint text-sm mt-1">Track your rest to spot patterns</div>
    </Card>
  );

  return (
    <Card className="border-brand/40 space-y-3">
      <div className="text-faint text-sm">How did you sleep?</div>
      <div className="flex justify-between">
        {[1,2,3,4,5].map(q => (
          <button key={q} onClick={() => setQuality(q)}
            className={'rounded-xl py-2 px-3 transition ' + (quality === q ? 'bg-brand/20 scale-110' : 'hover:bg-panel2')}>
            <span className="text-2xl">{sleepEmoji[q]}</span>
          </button>
        ))}
      </div>
      <Slider label="Hours" value={hours} min={1} max={14} onChange={setHours} color="#6aa0ff" />
      <div>
        <div className="text-[11px] text-faint mb-1.5">What affected your sleep? (optional)</div>
        <div className="flex flex-wrap gap-1.5">
          {SLEEP_TAGS.map(function(t){
            var sel = sleepTags.includes(t);
            return React.createElement('button', {
              key:t,
              onClick: function(){ toggleSleepTag(t); },
              className: 'text-[11px] px-2.5 py-1 rounded-full border transition ' +
                (sel ? 'bg-brand/20 border-brand/40 text-brand' : 'border-edge/40 text-faint hover:border-brand/30')
            }, t);
          })}
        </div>
      </div>
      <div className="flex gap-2">
        <Btn tone="ghost" className="flex-1" onClick={() => { setOpen(false); setSleepTags([]); }}>Cancel</Btn>
        <Btn tone="grow" className="flex-1" onClick={save}>Log sleep</Btn>
      </div>
    </Card>
  );
}

function SleepTagInsights() {
  var _o = useState(false); var open = _o[0]; var setOpen = _o[1];
  var store = useStore(); var state = store.state;
  var sleepLog = state.anchor.sleep || [];
  var tagged = sleepLog.filter(function(s){ return s.tags && s.tags.length > 0; });
  if (tagged.length < 4) return null;

  var tagQuality = {};
  var tagCount = {};
  tagged.forEach(function(s){
    s.tags.forEach(function(t){
      if (!tagQuality[t]) { tagQuality[t]=0; tagCount[t]=0; }
      tagQuality[t] += s.quality||3;
      tagCount[t]++;
    });
  });

  var noTagNights = sleepLog.filter(function(s){ return !s.tags || s.tags.length===0; });
  var avgNoTag = noTagNights.length ? noTagNights.reduce(function(s,e){ return s+(e.quality||3); },0)/noTagNights.length : null;

  var tagStats = Object.keys(tagQuality).map(function(t){
    var avg = tagQuality[t]/tagCount[t];
    return { tag:t, avg:avg, count:tagCount[t], diff: avgNoTag !== null ? avg - avgNoTag : null };
  }).filter(function(t){ return t.count >= 2; })
    .sort(function(a,b){ return a.avg - b.avg });

  if (tagStats.length < 2) return null;

  return (
    <Card className="space-y-2">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span dangerouslySetInnerHTML={{__html:'💤'}} />
          <span className="text-sm font-medium">Sleep factors</span>
          <span className="text-[10px] text-faint">{tagged.length} tagged nights</span>
        </div>
        <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: open ? '▲' : '▼'}} />
      </button>
      <div className="border-t border-edge/20 pt-2 space-y-1.5">
        <div className="text-[10px] text-faint mb-2">Average sleep quality when each factor is present (out of 5):</div>
        {tagStats.map(function(t){
          var pct = Math.round((t.avg/5)*100);
          var bg = t.avg >= 4 ? 'bg-grow' : t.avg >= 3 ? 'bg-yellow-500' : 'bg-rose/60';
          var diffTxt = t.diff !== null ? (t.diff >= 0.2 ? ' +'+t.diff.toFixed(1) : t.diff <= -0.2 ? ' '+t.diff.toFixed(1) : '') : '';
          var diffColor = t.diff >= 0.2 ? 'text-grow' : t.diff <= -0.2 ? 'text-rose' : 'text-faint';
          return (
            <div key={t.tag} className="flex items-center gap-2">
              <span className="text-xs text-faint w-24 flex-shrink-0 truncate">{t.tag}</span>
              <div className="flex-1 h-1.5 bg-panel2 rounded-full overflow-hidden">
                <div className={'h-full rounded-full '+bg} style={{width:pct+'%'}} />
              </div>
              <span className="text-[10px] tabnum text-paper/70 w-6 text-right">{t.avg.toFixed(1)}</span>
              {diffTxt && <span className={'text-[10px] tabnum w-8 '+diffColor}>{diffTxt}</span>}
            </div>
          );
        })}
        {avgNoTag !== null && (
          <div className="text-[10px] text-faint pt-1 border-t border-edge/20">Baseline (untagged nights): {avgNoTag.toFixed(1)}/5</div>
        )}
      </div>
    </Card>
  );
}

function SleepGoalCard() {
  var _edit = useState(false); var editing = _edit[0]; var setEditing = _edit[1];
  var _tmp = useState(goal); var tmpGoal = _tmp[0]; var setTmpGoal = _tmp[1];
  var store = useStore(); var state = store.state; var dispatch = store.dispatch;
  var sleepLog = state.anchor.sleep || [];
  var goal = (state.user.preferences && state.user.preferences.sleepGoal) || 7.5;

  if (sleepLog.length < 3) return null;

  // Last 14 nights
  var now = new Date();
  var days = [];
  for (var i = 13; i >= 0; i--) {
    var d = new Date(now);
    d.setDate(d.getDate() - i);
    var ds = localDateStr(d);
    var entry = sleepLog.find(function(s){ return dayOf(s.ts) === ds; });
    days.push({ ds: ds, hours: entry ? entry.hours : null, hit: entry ? entry.hours >= goal : null });
  }

  var logged = days.filter(function(d){ return d.hours !== null; });
  var hits = logged.filter(function(d){ return d.hit; }).length;
  var pct = logged.length ? Math.round((hits / logged.length) * 100) : 0;
  var avgHours = logged.length ? (logged.reduce(function(s,d){ return s+d.hours; },0) / logged.length).toFixed(1) : null;


  var pctColor = pct >= 70 ? '#3ddc97' : pct >= 50 ? '#6aa0ff' : '#facc15';

  return (
    <Card className="border-brand/20">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🎯</span>
          <span className="font-semibold text-sm">Sleep Goal</span>
        </div>
        <button onClick={function(){ setEditing(!editing); setTmpGoal(goal); }}
          className="text-[10px] text-faint hover:text-paper border border-edge/30 hover:border-edge/60 px-2 py-0.5 rounded-full transition">
          {editing ? 'cancel' : goal + 'h goal'}
        </button>
      </div>

      {editing ? (
        <div className="space-y-2 mb-3">
          <div className="flex items-center justify-between text-xs text-faint mb-1">
            <span>Nightly sleep target</span>
            <span className="font-bold text-paper tabnum">{tmpGoal}h</span>
          </div>
          <input type="range" min={4} max={12} step={0.5} value={tmpGoal}
            onChange={function(e){ setTmpGoal(parseFloat(e.target.value)); }}
            className="w-full accent-brand" />
          <Btn tone="grow" className="w-full text-xs" onClick={function(){
            dispatch({ type:'SET_PREFS', prefs:{ sleepGoal: tmpGoal } });
            setEditing(false);
            buzz(10);
          }}>Set goal: {tmpGoal}h/night</Btn>
        </div>
      ) : null}

      <div className="flex items-center gap-3 mb-3">
        <div className="text-center">
          <div className="text-2xl font-bold tabnum" style={{color: pctColor}}>{pct}%</div>
          <div className="text-faint text-[9px]">goal met</div>
        </div>
        <div className="flex-1 space-y-1">
          <div className="h-2 bg-panel2 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{width:pct+'%', background:pctColor}}></div>
          </div>
          <div className="flex justify-between text-[9px] text-faint">
            <span>{hits}/{logged.length} nights hit {goal}h</span>
            {avgHours && <span>avg {avgHours}h</span>}
          </div>
        </div>
      </div>

      <div className="flex gap-0.5">
        {days.map(function(d, i){
          var bg = d.hours === null ? '#1e2030' : d.hit ? '#3ddc97' : '#f87171';
          var opacity = d.hours === null ? 0.15 : 1;
          return React.createElement('div', {
            key: i,
            title: d.ds + (d.hours !== null ? ': ' + d.hours + 'h (' + (d.hit ? 'met' : 'missed') + ')' : ': no data'),
            style: { flex:1, height:20, borderRadius:3, background:bg, opacity:opacity }
          });
        })}
      </div>
      <div className="flex justify-between text-[8px] text-faint mt-0.5">
        <span>14 days ago</span><span>today</span>
      </div>
    </Card>
  );
}

function JournalEntry() {
  const { state, dispatch } = useStore();
  const todayStr = todayKey();
  const todayEntry = (state.anchor.journal||[]).find(j => dayOf(j.ts) === todayStr);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const save = () => {
    if (!text.trim()) return;
    dispatch({ type:'JOURNAL_LOG', text: text.trim() });
    buzz(20); chime(528, 0.3);
    setOpen(false);
    setText('');
  };

  if (todayEntry) return (
    <Card className="border-calm/20">
      <div className="flex items-center gap-2 mb-1"><span className="text-lg">📝</span><span className="text-faint text-sm">Today&#39;s journal</span></div>
      <div className="text-paper text-sm leading-relaxed line-clamp-3">{todayEntry.text}</div>
    </Card>
  );

  var PROMPTS = [
    'What made you smile today?',
    'What is one thing you are proud of this week?',
    'Describe a challenge you overcame recently.',
    'What would you tell your younger self?',
    'What does your ideal tomorrow look like?',
    'Name something you learned about yourself lately.',
    'What are you looking forward to?',
    'Write about someone who made a difference in your life.',
    'What is one boundary you want to set?',
    'How did you show yourself kindness today?',
    'What would you do if you knew you could not fail?',
    'Describe your current mood in three words.',
    'What habit are you most proud of building?',
    'Write a letter to your future self.',
    'What does recovery mean to you today?'
  ];
  var promptIdx = Math.floor(Date.now() / 86400000) % PROMPTS.length;
  var _pi = useState(promptIdx); var pIdx = _pi[0]; var setPIdx = _pi[1];

  if (!open) return (
    <Card className="border-calm/20 cursor-pointer hover:border-calm/40" onClick={() => setOpen(true)}>
      <div className="flex items-center gap-2"><span className="text-xl">📝</span><span className="text-paper font-semibold">Daily journal</span></div>
      <div className="text-faint text-sm mt-1">Write anything on your mind</div>
    </Card>
  );

  return (
    <Card className="border-calm/40 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-faint text-sm">What&#39;s on your mind today?</div>
        <button onClick={function(){ setPIdx(function(i){ return (i+1) % PROMPTS.length; }); }}
          className="text-calm/60 text-[10px] hover:text-calm">new prompt</button>
      </div>
      <div className="text-calm/70 text-xs italic px-1">{PROMPTS[pIdx]}</div>
      <textarea value={text} onChange={e => setText(e.target.value)} autoFocus placeholder="No rules. Just write..."
        className="w-full bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-sm outline-none focus:border-calm min-h-[100px] resize-none" />
      <div className="flex gap-2">
        <Btn tone="ghost" className="flex-1" onClick={() => { setOpen(false); setText(''); }}>Cancel</Btn>
        <Btn tone="grow" className="flex-1" onClick={save} disabled={!text.trim()}>Save</Btn>
      </div>
    </Card>
  );
}

function JournalHistory() {
  var _s = useStore(); var state = _s.state;
  var entries = (state.anchor.journal || []);
  var todayStr = todayKey();
  var past = entries.filter(function(e){ return dayOf(e.ts) !== todayStr; })
    .sort(function(a,b){ return b.ts > a.ts ? 1 : -1; });
  var [open, setOpen] = useState(false);
  var [query, setQuery] = useState('');
  var [expand, setExpand] = useState({});
  if (past.length === 0) return null;
  var filtered = query.trim()
    ? past.filter(function(e){ return e.text.toLowerCase().includes(query.trim().toLowerCase()); })
    : past;
  var hlQuery = query.trim().toLowerCase();
  function highlight(text) {
    if (!hlQuery) return text;
    var idx = text.toLowerCase().indexOf(hlQuery);
    if (idx < 0) return text;
    return text.slice(0, idx) + '«' + text.slice(idx, idx + hlQuery.length) + '»' + text.slice(idx + hlQuery.length);
  }
  function fmtDate(ts) {
    var d = new Date(ts); var now = new Date();
    var diff = Math.floor((now - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return diff + ' days ago';
    return d.toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' });
  }
  return (
    <Card className="border-edge/30">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); setQuery(''); }}>
        <div className="flex items-center gap-2">
          <span className="text-base">🗂</span>
          <span className="text-faint text-sm">Journal history</span>
          <span className="text-faint text-[11px] tabnum">({past.length})</span>
        </div>
        <span className="text-faint text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={function(e){ setQuery(e.target.value); }}
              placeholder="Search entries..."
              className="w-full bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-sm outline-none focus:border-calm pr-8"
            />
            {query && (
              <button onClick={function(){ setQuery(''); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-paper text-xs">✕</button>
            )}
          </div>
          {query.trim() && (
            <div className="text-faint text-[11px] px-1">{filtered.length} match{filtered.length !== 1 ? 'es' : ''}</div>
          )}
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {filtered.length === 0 && (
              <div className="text-faint text-sm text-center py-4">No entries match</div>
            )}
            {filtered.map(function(e, i) {
              var isExp = expand[e.ts];
              var preview = e.text.length > 120 ? e.text.slice(0, 120) + '...' : e.text;
              var shown = isExp ? e.text : preview;
              var needsMore = e.text.length > 120;
              return (
                <div key={e.ts} className="bg-panel2 rounded-xl px-3 py-2 space-y-1">
                  <div className="text-faint text-[11px] tabnum">{fmtDate(e.ts)}</div>
                  <div className="text-paper text-sm leading-relaxed whitespace-pre-wrap">
                    {query.trim() ? highlight(shown) : shown}
                  </div>
                  {needsMore && (
                    <button onClick={function(){ setExpand(function(prev){ var n = Object.assign({}, prev); n[e.ts] = !n[e.ts]; return n; }); }}
                      className="text-calm/60 text-[11px] hover:text-calm">
                      {isExp ? 'show less' : 'read more'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function JournalSearch() {
  var store = useStore(); var state = store.state;
  var _q = useState(''); var query = _q[0]; var setQuery = _q[1];
  var _open = useState(false); var open = _open[0]; var setOpen = _open[1];

  if (!open) {
    var totalEntries = (state.anchor.journal||[]).length + (state.anchor.gratitude||[]).length + (state.recovery.recoveryJournal||[]).length;
    if (totalEntries < 5) return null;
    return (
      <button onClick={function(){ setOpen(true); }}
        className="w-full flex items-center gap-2 bg-panel2 hover:bg-panel2/80 border border-edge/30 hover:border-edge rounded-xl px-3 py-2 text-left transition">
        <span className="text-faint" dangerouslySetInnerHTML={{__html:'🔍'}} />
        <span className="text-faint text-sm">Search your entries...</span>
        <span className="ml-auto text-faint text-[10px]">{totalEntries} total</span>
      </button>
    );
  }

  var q = query.toLowerCase().trim();
  var results = [];

  if (q.length >= 2) {
    (state.anchor.journal||[]).forEach(function(e){
      if (e.text && e.text.toLowerCase().includes(q))
        results.push({ type:'Journal', date: dayOf(e.ts), text: e.text, color:'#a78bfa', icon:'📝' });
    });
    (state.anchor.gratitude||[]).forEach(function(e){
      var text = Array.isArray(e.items) ? e.items.join(', ') : (e.text||'');
      if (text.toLowerCase().includes(q))
        results.push({ type:'Gratitude', date: dayOf(e.ts), text: text, color:'#fbbf24', icon:'✨' });
    });
    (state.recovery.recoveryJournal||[]).forEach(function(e){
      if (e.text && e.text.toLowerCase().includes(q))
        results.push({ type:'Recovery', date: dayOf(e.ts), text: e.text, color:'#3ddc97', icon:'📓' });
    });
    results.sort(function(a,b){ return b.date.localeCompare(a.date); });
  }

  var highlight = function(text, term) {
    if (!term) return text;
    var idx = text.toLowerCase().indexOf(term);
    if (idx < 0) return text.slice(0,120) + (text.length > 120 ? '...' : '');
    var start = Math.max(0, idx - 40);
    var end = Math.min(text.length, idx + term.length + 80);
    return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
  };

  return (
    <Card className="border-edge/30 space-y-3">
      <div className="flex items-center gap-2">
        <span dangerouslySetInnerHTML={{__html:'🔍'}} className="text-faint" />
        <input value={query} onChange={function(e){ setQuery(e.target.value); }}
          placeholder="Search journal, gratitude, recovery..."
          autoFocus
          className="flex-1 bg-panel2 border border-edge rounded-xl px-3 py-1.5 text-paper text-sm outline-none focus:border-calm" />
        <button onClick={function(){ setOpen(false); setQuery(''); }} className="text-faint hover:text-paper text-xs px-1">✕</button>
      </div>

      {q.length >= 2 && (
        <div>
          {results.length === 0 ? (
            <div className="text-faint text-sm text-center py-2">No entries match "{query}"</div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {results.slice(0,20).map(function(r, i){
                return (
                  <div key={i} className="border-l-2 pl-2 py-1" style={{borderColor: r.color}}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="text-[10px]" dangerouslySetInnerHTML={{__html: r.icon}} />
                      <span className="text-[10px] font-medium" style={{color:r.color}}>{r.type}</span>
                      <span className="text-[10px] text-faint">&middot; {r.date}</span>
                    </div>
                    <div className="text-xs text-paper/80 leading-relaxed">{highlight(r.text, q)}</div>
                  </div>
                );
              })}
              {results.length > 20 && <div className="text-[10px] text-faint text-center">{results.length - 20} more results</div>}
            </div>
          )}
        </div>
      )}
      {q.length < 2 && q.length > 0 && (
        <div className="text-faint text-xs text-center">Type at least 2 characters</div>
      )}
    </Card>
  );
}

function JournalStats() {
  var store = useStore(); var state = store.state;
  var entries = state.anchor.journal || [];
  if (entries.length < 3) return null;
  var wordCount = function(text) { return text.trim().split(/\s+/).filter(function(w){ return w.length > 0; }).length; };
  var totalWords = entries.reduce(function(s, e){ return s + wordCount(e.text); }, 0);
  var avgWords = Math.round(totalWords / entries.length);
  var now = new Date();
  var weekStart = new Date(now); weekStart.setDate(now.getDate() - 6);
  var weekStartStr = localDateStr(weekStart);
  var thisWeek = entries.filter(function(e){ return dayOf(e.ts) >= weekStartStr; }).length;
  var longestEntry = entries.reduce(function(best, e){ var w = wordCount(e.text); return w > best ? w : best; }, 0);
  var longestStreak = 0; var curStreak = 0;
  var sortedDates = entries.map(function(e){ return dayOf(e.ts); }).sort();
  var uniq = sortedDates.filter(function(d, i){ return sortedDates.indexOf(d) === i; });
  for (var i = 0; i < uniq.length; i++) {
    if (i === 0) { curStreak = 1; }
    else {
      var prev = new Date(uniq[i-1] + 'T12:00:00');
      var curr = new Date(uniq[i] + 'T12:00:00');
      var diff = Math.round((curr - prev) / 86400000);
      if (diff === 1) { curStreak++; } else { curStreak = 1; }
    }
    if (curStreak > longestStreak) longestStreak = curStreak;
  }
  var stats = [
    { icon: '📝', label: 'Entries', value: entries.length },
    { icon: '✍', label: 'Total words', value: totalWords.toLocaleString() },
    { icon: '↔', label: 'Avg / entry', value: avgWords + ' words' },
    { icon: '🔥', label: 'Best streak', value: longestStreak + (longestStreak === 1 ? ' day' : ' days') },
    { icon: '📅', label: 'This week', value: thisWeek + (thisWeek === 1 ? ' entry' : ' entries') },
    { icon: '🏆', label: 'Longest entry', value: longestEntry + ' words' },
  ];
  return (
    <div className="rounded-xl border border-edge/20 bg-panel p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-base" dangerouslySetInnerHTML={{__html:'📊'}} />
        <span className="text-xs font-semibold text-paper">Journal stats</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {stats.map(function(s, i){
          return React.createElement('div', { key: i, className: 'bg-panel2 rounded-lg p-2 text-center' },
            React.createElement('div', { className: 'text-sm', dangerouslySetInnerHTML: { __html: s.icon } }),
            React.createElement('div', { className: 'text-[11px] font-semibold text-paper tabnum leading-tight mt-0.5' }, s.value),
            React.createElement('div', { className: 'text-[9px] text-faint leading-tight' }, s.label)
          );
        })}
      </div>
    </div>
  );
}

function StreakSummaryCard() {
  var store = useStore(); var state = store.state;
  var today = todayKey();
  var yesterday = localDateStr(new Date(Date.now() - dayMs));
  function calcStreak(dates) {
    var uniq = dates.filter(function(d,i,a){ return a.indexOf(d) === i; }).sort().reverse();
    if (!uniq.length) return 0;
    if (uniq[0] !== today && uniq[0] !== yesterday) return 0;
    var s = 1;
    for (var i = 1; i < uniq.length; i++) {
      var a = new Date(uniq[i-1] + 'T12:00:00');
      var b = new Date(uniq[i] + 'T12:00:00');
      if (Math.round((a - b) / 86400000) === 1) s++;
      else break;
    }
    return s;
  }
  var moodStreak    = calcStreak((state.anchor.moodLog||[]).map(function(m){ return dayOf(m.ts); }));
  var journalStreak = calcStreak((state.anchor.journal||[]).map(function(e){ return dayOf(e.ts); }));
  var gratStreak    = calcStreak((state.anchor.gratitude||[]).map(function(g){ return dayOf(g.ts); }));
  var medStreak     = calcStreak((state.anchor.meditationLog||[]).filter(function(m){ return m.completed && m.sessionType !== 'bodyscan'; }).map(function(m){ return dayOf(m.ts); }));
  var scanStreak    = calcStreak((state.anchor.meditationLog||[]).filter(function(m){ return m.completed && m.sessionType === 'bodyscan'; }).map(function(m){ return dayOf(m.ts); }));
  var focusStreak   = calcStreak((state.anchor.focusSessions||[]).filter(function(s){ return s.completed; }).map(function(s){ return dayOf(s.ts); }));
  var waterStreak   = calcStreak((state.anchor.waterLog||[]).map(function(w){ return dayOf(w.ts); }));
  var sleepStreak   = calcStreak((state.anchor.sleep||[]).map(function(s){ return dayOf(s.ts); }));
  var rows = [
    { icon:'😊', label:'Mood check-in', streak:moodStreak },
    { icon:'📝', label:'Journal', streak:journalStreak },
    { icon:'🌻', label:'Gratitude', streak:gratStreak },
    { icon:'🧘', label:'Meditation', streak:medStreak },
    { icon:'🌊', label:'Body scan', streak:scanStreak },
    { icon:'⏱', label:'Focus', streak:focusStreak },
    { icon:'💧', label:'Hydration', streak:waterStreak },
    { icon:'😴', label:'Sleep log', streak:sleepStreak },
  ].filter(function(r){ return r.streak >= 2; });
  var habits = (state.anchor.habits||[]);
  habits.forEach(function(h) {
    if (!h.log || !h.log.length) return;
    var hs = calcStreak(h.log.map(function(d){ return typeof d === 'string' ? d.slice(0,10) : ''; }).filter(Boolean));
    if (hs >= 2) rows.push({ icon: h.icon || '✅', label: h.name, streak: hs });
  });
  rows.sort(function(a,b){ return b.streak - a.streak; });
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-warm/20 bg-panel p-3 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base" dangerouslySetInnerHTML={{__html:'🔥'}} />
        <span className="text-xs font-semibold text-paper">Active streaks</span>
        <span className="ml-auto text-[10px] text-faint">{rows.length} running</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {rows.slice(0, 8).map(function(r, i){
          var color = r.streak >= 14 ? 'text-warm border-warm/30 bg-warm/5' : r.streak >= 7 ? 'text-grow border-grow/30 bg-grow/5' : 'text-brand border-brand/20 bg-brand/5';
          return React.createElement('div', {
            key: i,
            className: 'flex items-center gap-2 rounded-lg border px-2 py-1.5 ' + color
          },
            React.createElement('span', { className:'text-sm', dangerouslySetInnerHTML:{__html:r.icon} }),
            React.createElement('div', { className:'flex-1 min-w-0' },
              React.createElement('div', { className:'text-[10px] text-faint truncate' }, r.label),
              React.createElement('div', { className:'text-xs font-bold tabnum leading-none' }, r.streak + (r.streak === 1 ? ' day' : ' days'))
            )
          );
        })}
      </div>
    </div>
  );
}

function BadgesCard() {
  const { state } = useStore();
  const earned = BADGES.filter(b => b.test(state));
  const locked = BADGES.filter(b => !b.test(state));
  if (earned.length === 0) return null;
  return (
    <Card className="border-edge/30">
      <div className="flex justify-between items-center mb-2">
        <span className="text-faint text-sm">Achievements</span>
        <span className="text-faint text-[11px] tabnum">{earned.length}/{BADGES.length}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {earned.map(b => (
          <span key={b.id} title={b.label} className="text-2xl cursor-default hover:scale-125 transition">{b.icon}</span>
        ))}
        {locked.slice(0,4).map(b => (
          <span key={b.id} title={'Locked: ' + b.label} className="text-2xl opacity-20 cursor-default">{b.icon}</span>
        ))}
      </div>
    </Card>
  );
}

function MoodTrend() {
  const [selDay, setSelDay] = useState(null);
  const { state } = useStore();
  const moodLog = state.anchor.moodLog || [];
  if (moodLog.length < 2) return null;
  const moodVal = { great:5, good:4, ok:3, low:2, anxious:1 };
  const moodColor = { great:'#4ade80', good:'#6aa0ff', ok:'#a78bfa', low:'#facc15', anxious:'#f87171' };
  const moodEmoji = { great:'😄', good:'🙂', ok:'😐', low:'😔', anxious:'😰' };
  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = localDateStr(d);
    const dayMoods = moodLog.filter(function(m){ return dayOf(m.ts) === ds; });
    const dayLabel = ['Su','Mo','Tu','We','Th','Fr','Sa'][d.getDay()];
    if (dayMoods.length) {
      const avg = dayMoods.reduce(function(s,m){ return s + (moodVal[m.mood]||3); }, 0) / dayMoods.length;
      const lastMoodKey = dayMoods[dayMoods.length - 1].mood;
      days.push({ ds: ds, label: dayLabel, val: avg, color: moodColor[lastMoodKey] || '#a78bfa', count: dayMoods.length, entries: dayMoods });
    } else {
      days.push({ ds: ds, label: dayLabel, val: 0, color: 'transparent', count: 0, entries: [] });
    }
  }
  const maxH = 40;
  const selData = selDay ? days.find(function(d){ return d.ds === selDay; }) : null;
  const notedEntries = selData ? selData.entries.filter(function(e){ return e.note && e.note.trim(); }) : [];

  return (
    <Card className="border-edge/30">
      <div className="text-faint text-sm mb-3">Mood · 7 days <span className="text-xs opacity-50">(tap bar to see notes)</span></div>
      <div className="flex items-end justify-between gap-1" style={{height: maxH + 20 + 'px'}}>
        {days.map(function(d){
          const h = d.val ? (d.val / 5) * maxH : 4;
          const isSel = d.ds === selDay;
          return (
            <div key={d.ds} className="flex-1 flex flex-col items-center gap-1 cursor-pointer"
              onClick={function(){ setSelDay(isSel ? null : (d.count ? d.ds : null)); }}>
              <div className="rounded-full transition-all" style={{
                width: '100%', maxWidth: '28px', height: Math.round(h) + 'px',
                backgroundColor: d.color, opacity: d.val ? 1 : 0.15,
                outline: isSel ? '2px solid white' : 'none', outlineOffset: '2px'
              }} />
              <span className="text-[10px]" style={{color: isSel ? '#fff' : 'var(--faint)'}}>{d.label}</span>
            </div>
          );
        })}
      </div>
      {selData && selData.count > 0 && (
        <div className="mt-3 pt-3 border-t border-edge/20 space-y-1">
          <div className="text-xs text-faint mb-2">{selData.ds} · {selData.count} check-in{selData.count!==1?'s':''}</div>
          {selData.entries.map(function(e, i){
            return (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span>{moodEmoji[e.mood] || '·'}</span>
                <span className="text-paper/60">{e.mood}</span>
                {e.note ? <span className="text-paper/80 flex-1">— {e.note}</span> : null}
              </div>
            );
          })}
          {notedEntries.length === 0 && <div className="text-xs text-faint italic">No notes for this day</div>}
        </div>
      )}
    </Card>
  );
}

function MoodCalendar() {
  var _sel = useState(null); var sel = _sel[0]; var setSel = _sel[1];
  var _o = useState(false); var open = _o[0]; var setOpen = _o[1];
  var store = useStore(); var state = store.state;
  var moodLog = state.anchor.moodLog || [];
  if (moodLog.length < 7) return null;
  var moodColor = { great:'#4ade80', good:'#6aa0ff', ok:'#a78bfa', low:'#facc15', anxious:'#f87171' };
  var moodEmoji = { great:'😄', good:'🙂', ok:'😐', low:'😔', anxious:'😰' };
  var moodVal   = { great:5, good:4, ok:3, low:2, anxious:1 };

  var now = new Date();
  var days = [];
  for (var i = 29; i >= 0; i--) {
    var d = new Date(now); d.setDate(d.getDate() - i);
    var ds = localDateStr(d);
    var entries = moodLog.filter(function(m){ return dayOf(m.ts) === ds; });
    var color = null; var topMood = null; var avgV = 0;
    if (entries.length) {
      avgV = entries.reduce(function(s,m){ return s + (moodVal[m.mood]||3); },0) / entries.length;
      topMood = entries[0].mood;
      color = moodColor[topMood] || '#a78bfa';
    }
    days.push({ ds:ds, color:color, topMood:topMood, count:entries.length, entries:entries, avgV:avgV });
  }

  var selDay = sel ? days.find(function(d){ return d.ds === sel; }) : null;

  return (
    <Card className="border-edge/30 space-y-2">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); setSel(null); }}>
        <div className="flex items-center gap-2">
          <span>🗓</span>
          <span className="text-faint text-sm">30-day mood map</span>
        </div>
        <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: open ? '▲' : '▼'}} />
      </button>
      {open && (
        <div className="space-y-3">
          <div className="grid grid-cols-10 gap-1.5">
            {days.map(function(d){
              var isSel = sel === d.ds;
              return (
                <button key={d.ds} onClick={function(){ setSel(isSel ? null : (d.count ? d.ds : null)); }}
                  title={d.ds}
                  style={{
                    width:'100%', aspectRatio:'1', borderRadius:'50%',
                    backgroundColor: d.color || 'rgba(42,58,92,0.3)',
                    opacity: d.count ? 1 : 0.15,
                    outline: isSel ? '2px solid white' : 'none',
                    outlineOffset: '2px',
                    transition: 'transform 0.1s',
                  }} />
              );
            })}
          </div>
          <div className="flex items-center justify-center gap-3 text-[10px] text-faint flex-wrap">
            {['great','good','ok','low','anxious'].map(function(m){
              return React.createElement('span', { key:m, className:'flex items-center gap-1' },
                React.createElement('span', { style:{ width:'8px', height:'8px', borderRadius:'50%', backgroundColor:moodColor[m], display:'inline-block' } }),
                m
              );
            })}
          </div>
          {selDay && selDay.count > 0 && (
            <div className="bg-panel2 rounded-xl px-3 py-2 space-y-1">
              <div className="text-xs text-faint">{selDay.ds} &middot; {selDay.count} check-in{selDay.count>1?'s':''}</div>
              {selDay.entries.map(function(e, i){
                return (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span dangerouslySetInnerHTML={{__html: moodEmoji[e.mood]||'·'}}></span>
                    <span className="text-paper/70">{e.mood}</span>
                    {e.note && <span className="text-paper/80 flex-1 truncate">— {e.note}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function HabitTracker() {
  const { state, dispatch } = useStore();
  const habits = state.anchor.habits || [];
  const log = state.anchor.habitLog || [];
  const todayStr = todayKey();
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newWhy, setNewWhy] = useState('');
  const [editWhyId, setEditWhyId] = useState(null);
  const [editWhyVal, setEditWhyVal] = useState('');
  const HABIT_ICONS = ['✅','💧','💊','🏃','📖','🧘','🍎','🛏️'];
  const [pickIcon, setPickIcon] = useState('✅');

  if (habits.length === 0 && !adding) return (
    <Card className="border-edge/20 cursor-pointer hover:border-grow/40" onClick={function(){setAdding(true);}}>
      <div className="flex items-center gap-2"><span className="text-xl">📋</span><span className="text-paper font-semibold">Start tracking habits</span></div>
      <div className="text-faint text-sm mt-1">Build consistency with daily check-offs</div>
    </Card>
  );

  const done = habits.filter(function(h){ return log.some(function(e){ return e.key === h.id+':'+todayStr; }); }).length;

  var getHabitStreak = function(hid) {
    var s = 0;
    var d = new Date();
    while (true) {
      var ds = localDateStr(d);
      var found = log.some(function(e){ return e.key === hid+':'+ds || e.key === hid+':rest:'+ds; });
      if (!found) break;
      s++;
      d.setDate(d.getDate()-1);
    }
    return s;
  };

  return (
    <Card className="border-edge/30">
      <div className="flex justify-between items-center mb-2">
        <span className="text-faint text-sm">Habits</span>
        <span className="text-faint text-[11px] tabnum">{done}/{habits.length} today</span>
      </div>
      <div className="space-y-1">
        {habits.map(function(h){
          var checked = log.some(function(e){ return e.key === h.id+':'+todayStr; });
          var rested  = log.some(function(e){ return e.key === h.id+':rest:'+todayStr; });
          var streak = getHabitStreak(h.id);
          var rowBg = checked ? 'bg-grow/10' : rested ? 'bg-warm/5' : 'bg-panel2 hover:bg-panel2/80';
          return (
            <div key={h.id}>
              <div className={'flex items-center gap-2 rounded-xl px-3 py-2 group transition ' + rowBg}>
                <span className={'text-lg cursor-pointer transition ' + (checked ? 'opacity-100' : rested ? 'opacity-50' : 'opacity-40')}
                  onClick={function(){ dispatch({type:'TOGGLE_HABIT',id:h.id}); buzz(15); }}>
                  {checked ? h.icon : rested ? '🏖' : '○'}
                </span>
                <div className="flex-1 min-w-0">
                  <span className={'text-sm cursor-pointer ' + (checked ? 'text-grow line-through opacity-70' : rested ? 'text-warm/70 italic' : 'text-paper')}
                    onClick={function(){ dispatch({type:'TOGGLE_HABIT',id:h.id}); buzz(15); }}>
                    {h.label}{rested ? ' · rest day' : ''}
                  </span>
                  {!checked && !rested && h.why && (
                    <div className="text-[10px] text-faint italic truncate mt-0.5">💡 {h.why}</div>
                  )}
                  {editWhyId === h.id && (
                    <div className="flex gap-1 mt-1" onClick={function(e){e.stopPropagation();}}>
                      <input value={editWhyVal} onChange={function(e){setEditWhyVal(e.target.value);}}
                        placeholder="Why does this matter to you?"
                        autoFocus
                        className="flex-1 bg-panel2 border border-edge rounded-lg px-2 py-0.5 text-[11px] text-paper outline-none focus:border-calm"
                        onKeyDown={function(e){
                          if(e.key==='Enter'){ dispatch({type:'SET_HABIT_WHY',id:h.id,why:editWhyVal.trim()}); setEditWhyId(null); }
                          if(e.key==='Escape'){ setEditWhyId(null); }
                        }} />
                      <button className="text-[10px] text-calm px-1"
                        onClick={function(){ dispatch({type:'SET_HABIT_WHY',id:h.id,why:editWhyVal.trim()}); setEditWhyId(null); }}>Save</button>
                    </div>
                  )}
                </div>
                {streak > 1 && React.createElement('span', { className: 'text-[10px] text-brand tabnum' }, '🔥' + streak)}
                {!checked && React.createElement('button', {
                  onClick: function(e){ e.stopPropagation(); dispatch({type:'HABIT_REST',id:h.id}); buzz(10); },
                  title: rested ? 'Cancel rest day' : 'Mark as rest day (keeps streak)',
                  className: 'text-[10px] px-1.5 py-0.5 rounded-full border transition ' + (rested ? 'border-warm/50 text-warm bg-warm/10' : 'border-edge/40 text-faint hover:border-warm/40 hover:text-warm opacity-0 group-hover:opacity-100')
                }, rested ? '❌ rest' : '🏖 rest')}
                <button onClick={function(e){ e.stopPropagation(); setEditWhyId(editWhyId===h.id?null:h.id); setEditWhyVal(h.why||''); }}
                  title="Set motivational why"
                  className="text-[10px] text-faint hover:text-calm opacity-0 group-hover:opacity-100">💡</button>
                <button onClick={function(e){ e.stopPropagation(); dispatch({type:'REMOVE_HABIT',id:h.id}); }}
                  className="text-faint hover:text-rose text-xs opacity-0 group-hover:opacity-100">✕</button>
              </div>
            </div>
          );
        })}
      </div>
      {adding ? (
        <div className="mt-2 space-y-2">
          <div className="text-xs text-faint mb-1">Quick add:</div>
          <div className="flex flex-wrap gap-1 mb-2">
            {[
              {icon:'🏃',label:'Exercise'},
              {icon:'💧',label:'Drink water'},
              {icon:'📖',label:'Read'},
              {icon:'🧘',label:'Meditate'},
              {icon:'🛏️',label:'Sleep by 10pm'},
              {icon:'🍎',label:'Eat well'},
              {icon:'🚶',label:'Walk outside'},
              {icon:'📵',label:'Phone-free hour'},
              {icon:'✍️',label:'Journal'},
              {icon:'🌞',label:'Morning routine'},
            ].filter(function(t){ return !habits.some(function(h){ return h.label === t.label; }); })
            .map(function(t){
              return (
                <button key={t.label} onClick={function(){
                  dispatch({type:'ADD_HABIT',label:t.label,icon:t.icon});
                  buzz(15);
                  setAdding(false);
                }} className="flex items-center gap-1 text-xs bg-panel2 hover:bg-grow/20 hover:text-grow rounded-full px-2 py-1">
                  <span>{t.icon}</span><span>{t.label}</span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-1 flex-wrap">
            {HABIT_ICONS.map(function(ic){
              return <button key={ic} onClick={function(){setPickIcon(ic);}}
                className={'rounded-lg px-2 py-1 text-lg ' + (pickIcon===ic ? 'bg-brand/20 scale-110' : 'hover:bg-panel2')}>{ic}</button>;
            })}
          </div>
          <div className="flex gap-2">
            <input value={newLabel} onChange={function(e){setNewLabel(e.target.value);}} placeholder="Custom habit..."
              onKeyDown={function(e){ if(e.key==='Enter' && newLabel.trim()){ dispatch({type:'ADD_HABIT',label:newLabel.trim(),icon:pickIcon,why:newWhy.trim()}); setNewLabel(''); setNewWhy(''); setAdding(false); } }}
              autoFocus className="flex-1 bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-sm outline-none focus:border-grow" />
            <Btn tone="grow" onClick={function(){ if(newLabel.trim()){ dispatch({type:'ADD_HABIT',label:newLabel.trim(),icon:pickIcon,why:newWhy.trim()}); setNewLabel(''); setNewWhy(''); setAdding(false); } }}
              disabled={!newLabel.trim()}>Add</Btn>
          </div>
          <input value={newWhy} onChange={function(e){setNewWhy(e.target.value);}} placeholder="Why does this matter to you? (optional)"
            className="w-full bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-xs outline-none focus:border-calm" />
          <Btn tone="ghost" className="w-full" onClick={function(){setAdding(false);setNewLabel('');setNewWhy('');}}>Cancel</Btn>
        </div>
      ) : (
        <button onClick={function(){setAdding(true);}} className="mt-2 text-faint hover:text-grow text-sm">+ add habit</button>
      )}
      <HabitHeatmap />
      {habits.length > 0 && log.length > 3 && (function(){
        var now30 = new Date();
        var days30 = [];
        for (var ki = 29; ki >= 0; ki--) {
          var dd = new Date(now30); dd.setDate(dd.getDate()-ki);
          days30.push(localDateStr(dd));
        }
        var rated = habits.map(function(h) {
          var taken = days30.filter(function(ds){ return log.some(function(e){ return e.key===h.id+':'+ds; }); }).length;
          return { id:h.id, icon:h.icon, label:h.label, pct: Math.round((taken/30)*100), taken:taken };
        }).sort(function(a,b){ return b.pct-a.pct; });
        return (
          <div className="mt-3 border-t border-edge/30 pt-3 space-y-1.5">
            <div className="text-faint text-[10px] mb-2">30-day completion rates</div>
            {rated.map(function(h) {
              var c = h.pct>=70?'#3ddc97':h.pct>=40?'#6aa0ff':'#ffce6a';
              return (
                <div key={h.id} className="flex items-center gap-2">
                  <span className="text-sm w-5">{h.icon}</span>
                  <div className="flex-1 h-1.5 bg-panel2 rounded-full overflow-hidden">
                    <div style={{width:h.pct+'%',height:'100%',backgroundColor:c,borderRadius:'999px'}} />
                  </div>
                  <span className="text-[11px] tabnum text-faint w-8 text-right">{h.pct}%</span>
                </div>
              );
            })}
          </div>
        );
      })()}
    </Card>
  );
}

function EnergyFactorInsights() {
  var _o = useState(false); var open = _o[0]; var setOpen = _o[1];
  var store = useStore(); var state = store.state;
  var energyLog = state.anchor.energyLog || [];
  var tagged = energyLog.filter(function(e){ return e.factors && e.factors.length > 0; });
  if (tagged.length < 4) return null;

  var factorLevels = {};
  var factorCounts = {};
  tagged.forEach(function(e){
    e.factors.forEach(function(f){
      if (!factorLevels[f]) { factorLevels[f]=0; factorCounts[f]=0; }
      factorLevels[f] += e.level;
      factorCounts[f]++;
    });
  });

  var noFactorEntries = energyLog.filter(function(e){ return !e.factors || e.factors.length===0; });
  var baselineAvg = noFactorEntries.length ? noFactorEntries.reduce(function(s,e){ return s+e.level; },0)/noFactorEntries.length : null;

  var stats = Object.keys(factorLevels).map(function(f){
    var avg = factorLevels[f]/factorCounts[f];
    return { factor:f, avg:avg, count:factorCounts[f], diff: baselineAvg!==null ? avg-baselineAvg : null };
  }).filter(function(f){ return f.count >= 2; })
    .sort(function(a,b){ return b.avg-a.avg; });

  if (stats.length < 2) return null;

  return (
    <Card className="space-y-2">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span dangerouslySetInnerHTML={{__html:'⚡'}} />
          <span className="text-sm font-medium">Energy factors</span>
          <span className="text-[10px] text-faint">{tagged.length} tagged</span>
        </div>
        <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: open ? '▲' : '▼'}} />
      </button>
      <div className="border-t border-edge/20 pt-2 space-y-1.5">
        <div className="text-[10px] text-faint mb-1">Avg energy level (1-5) when factor is present:</div>
        {stats.map(function(s){
          var pct = Math.round((s.avg/5)*100);
          var bg = s.avg >= 4 ? 'bg-grow' : s.avg >= 3 ? 'bg-yellow-500' : 'bg-rose/60';
          var diffStr = s.diff!==null ? (s.diff>=0.2?'+'+s.diff.toFixed(1):s.diff<=-0.2?s.diff.toFixed(1):'') : '';
          var diffColor = s.diff>=0.2 ? 'text-grow' : s.diff<=-0.2 ? 'text-rose' : '';
          return (
            <div key={s.factor} className="flex items-center gap-2">
              <span className="text-xs text-faint w-24 flex-shrink-0 truncate">{s.factor}</span>
              <div className="flex-1 h-1.5 bg-panel2 rounded-full overflow-hidden">
                <div className={'h-full rounded-full '+bg} style={{width:pct+'%'}} />
              </div>
              <span className="text-[10px] tabnum text-paper/70 w-6 text-right">{s.avg.toFixed(1)}</span>
              {diffStr && <span className={'text-[10px] tabnum w-8 '+diffColor}>{diffStr}</span>}
            </div>
          );
        })}
        {baselineAvg !== null && <div className="text-[10px] text-faint pt-1 border-t border-edge/20">Baseline (untagged): {baselineAvg.toFixed(1)}/5</div>}
      </div>
    </Card>
  );
}

function WaterTracker() {
  const { state, dispatch } = useStore();
  const todayStr = todayKey();
  const wl = state.anchor.waterLog || [];
  const todayEntry = wl.find(function(w){ return w.date === todayStr; });
  const count = todayEntry ? todayEntry.count : 0;
  const goal = state.user.preferences.waterGoal || 8;
  const pct = Math.min(100, Math.round((count / goal) * 100));
  return (
    <Card className="border-edge/30">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">💧</span>
          <span className="text-faint text-sm">Water</span>
        </div>
        <span className="text-faint text-sm">{count}/{goal} glasses</span>
      </div>
      <div className="w-full bg-panel2 rounded-full h-2 mb-3">
        <div className="bg-brand rounded-full h-2 transition-all" style={{width: pct + '%'}} />
      </div>
      <div className="flex items-center justify-center gap-4">
        <button onClick={function(){ if(count > 0) dispatch({type:'WATER_LOG', delta:-1}); }}
          className={'w-10 h-10 rounded-full flex items-center justify-center text-lg border transition ' + (count > 0 ? 'border-edge text-faint hover:text-paper hover:border-paper' : 'border-edge/30 text-edge cursor-not-allowed')}>-</button>
        <div className="text-3xl font-bold text-brand tabnum">{count}</div>
        <button onClick={function(){ dispatch({type:'WATER_LOG', delta:1}); buzz(15); }}
          className="w-10 h-10 rounded-full flex items-center justify-center text-lg border border-brand text-brand hover:bg-brand hover:text-ink transition">+</button>
      </div>
      {count >= goal && <div className="text-center text-grow text-sm mt-2">Goal reached! 🎉</div>}
    </Card>
  );
}

function WaterPaceCard() {
  var store = useStore(); var state = store.state;
  var todayStr = todayKey();
  var wl = state.anchor.waterLog || [];
  var todayEntry = wl.find(function(w){ return w.date === todayStr; });
  var count = todayEntry ? todayEntry.count : 0;
  var goal = (state.user.preferences && state.user.preferences.waterGoal) || 8;

  // Pace calculation: assume active hours 7am–10pm = 15 hours
  var now = new Date();
  var hr = now.getHours() + now.getMinutes()/60;
  var wakeHr = 7, sleepHr = 22;
  var activeFrac = Math.min(1, Math.max(0, (hr - wakeHr) / (sleepHr - wakeHr)));
  var expected = Math.round(goal * activeFrac * 10) / 10;
  var diff = count - expected;
  var ahead = diff >= 0.5;
  var behind = diff <= -1;
  var paceColor = ahead ? '#3ddc97' : behind ? '#f87171' : '#6aa0ff';
  var paceLabel = ahead ? 'Ahead of pace' : behind ? 'Behind pace' : 'On track';
  var paceIcon = ahead ? '✅' : behind ? '⚠' : '💧';

  // Hours remaining
  var hrsLeft = Math.max(0, sleepHr - hr);
  var cupsLeft = Math.max(0, goal - count);

  if (count === 0 && hr < wakeHr) return null;

  return (
    <Card className="border-brand/10">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span dangerouslySetInnerHTML={{__html:paceIcon}} />
          <span className="text-sm font-medium" style={{color:paceColor}}>{paceLabel}</span>
        </div>
        <span className="text-[10px] text-faint tabnum">{Math.round(activeFrac*100)}% of day elapsed</span>
      </div>

      <div className="flex gap-3 text-center mb-3">
        <div className="flex-1">
          <div className="text-xl font-bold tabnum text-brand">{count}</div>
          <div className="text-faint text-[9px]">had</div>
        </div>
        <div className="flex-1">
          <div className="text-xl font-bold tabnum text-faint">{expected.toFixed(1)}</div>
          <div className="text-faint text-[9px]">expected now</div>
        </div>
        <div className="flex-1">
          <div className={'text-xl font-bold tabnum ' + (diff >= 0 ? 'text-grow' : 'text-rose')}>{diff >= 0 ? '+' : ''}{diff.toFixed(1)}</div>
          <div className="text-faint text-[9px]">vs pace</div>
        </div>
        {cupsLeft > 0 && hrsLeft > 0.5 && (
          <div className="flex-1">
            <div className="text-xl font-bold tabnum text-warm">{(cupsLeft/hrsLeft).toFixed(1)}</div>
            <div className="text-faint text-[9px]">cups/hr needed</div>
          </div>
        )}
      </div>

      {/* Timeline bar */}
      <div className="relative h-3 bg-panel2 rounded-full overflow-hidden mb-1">
        {/* expected fill */}
        <div className="absolute left-0 top-0 h-full rounded-full opacity-30 bg-brand"
          style={{width: Math.min(100, Math.round(activeFrac*100))+'%'}} />
        {/* actual fill */}
        <div className="absolute left-0 top-0 h-full rounded-full"
          style={{width: Math.min(100, Math.round((count/goal)*100))+'%', background: paceColor}} />
      </div>
      <div className="flex justify-between text-[8px] text-faint">
        <span>7am</span>
        <span>{goal} cups by 10pm</span>
      </div>
    </Card>
  );
}

function WaterTrend() {
  var store = useStore(); var state = store.state;
  var wl = state.anchor.waterLog || [];
  if (wl.length < 2) return null;
  var goal = (state.user.preferences && state.user.preferences.waterGoal) || 8;
  var now = new Date();
  var days = [];
  for (var i = 6; i >= 0; i--) {
    var d = new Date(now); d.setDate(d.getDate()-i);
    var ds = localDateStr(d);
    var dayLabel = ['Su','Mo','Tu','We','Th','Fr','Sa'][d.getDay()];
    var entry = wl.find(function(w){ return w.date===ds; });
    var count = entry ? (entry.count||0) : 0;
    days.push({ ds:ds, label:dayLabel, count:count });
  }
  var maxH = 44;
  var daysWithData = days.filter(function(d){ return d.count>0; });
  if (daysWithData.length < 2) return null;
  var avgCount = daysWithData.reduce(function(s,d){ return s+d.count; },0) / daysWithData.length;
  var goalDays = daysWithData.filter(function(d){ return d.count>=goal; }).length;
  return (
    <Card className="border-edge/30">
      <div className="flex items-center justify-between mb-3">
        <div className="text-faint text-sm">Water · 7 days</div>
        <div className="flex gap-3 text-[11px] text-faint">
          <span className="tabnum">avg {avgCount.toFixed(1)} glasses</span>
          <span className="tabnum text-brand">{goalDays}/7 goal days</span>
        </div>
      </div>
      <div className="flex items-end justify-between gap-1" style={{height:(maxH+16)+'px'}}>
        {days.map(function(d) {
          var frac = Math.min(d.count / goal, 1.3);
          var h = d.count ? Math.max(6, Math.round(frac * maxH)) : 4;
          var bg = d.count >= goal ? '#3ddc97' : d.count > 0 ? '#6aa0ff' : 'rgba(42,58,92,0.3)';
          var overflow = d.count > goal;
          return (
            <div key={d.ds} className="flex-1 flex flex-col items-center gap-1">
              {d.count > 0 && <div className="text-[9px] tabnum text-faint">{d.count}</div>}
              <div style={{width:'100%', maxWidth:'28px', height:h+'px',
                borderRadius:'6px', backgroundColor:bg, opacity:d.count?1:0.2,
                boxShadow: overflow?'0 0 6px rgba(61,220,151,0.4)':'none'}} />
              <span className="text-faint text-[10px]">{d.label}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WaterInsights() {
  var _o = useState(false); var open = _o[0]; var setOpen = _o[1];
  var store = useStore(); var state = store.state;
  var wl = state.anchor.waterLog || [];
  if (wl.length < 10) return null;
  var goal = (state.user.preferences && state.user.preferences.waterGoal) || 8;

  var DOW_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var dowSums = [0,0,0,0,0,0,0]; var dowCounts = [0,0,0,0,0,0,0];
  wl.forEach(function(w){
    if (!w.date) return;
    var dow = new Date(w.date).getDay();
    dowSums[dow] += (w.count||0); dowCounts[dow]++;
  });
  var validDows = DOW_NAMES.map(function(name, i){
    return dowCounts[i] >= 2 ? { name:name, avg: dowSums[i]/dowCounts[i], i:i } : null;
  }).filter(Boolean);
  if (validDows.length < 4) return null;

  var best = validDows.reduce(function(a,b){ return a.avg >= b.avg ? a : b; });
  var worst = validDows.reduce(function(a,b){ return a.avg <= b.avg ? a : b; });
  var diff = best.avg - worst.avg;
  if (diff < 0.5) return null;

  var goalHitRate = wl.length ? Math.round(wl.filter(function(w){ return (w.count||0) >= goal; }).length / wl.length * 100) : 0;
  var maxDow = validDows.reduce(function(a,b){ return a.avg >= b.avg ? a : b; });
  var barMax = Math.max.apply(null, validDows.map(function(d){ return d.avg; }));

  return (
    <Card className="border-edge/30 space-y-2">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span>💧</span>
          <span className="text-faint text-sm">Hydration patterns</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-brand tabnum text-xs">{goalHitRate}% goal days</span>
          <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: open ? '▲' : '▼'}} />
        </div>
      </button>
      {open && (
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <div className="text-xs text-faint">Avg glasses by day of week</div>
            {validDows.map(function(d){
              var w = Math.round((d.avg / barMax) * 100);
              var color = d.avg >= goal ? '#3ddc97' : d.avg >= goal * 0.7 ? '#6aa0ff' : '#ffce6a';
              return React.createElement('div', { key:d.i, className:'space-y-0.5' },
                React.createElement('div', { className:'flex justify-between text-xs' },
                  React.createElement('span', { className:'text-paper/80' }, d.name),
                  React.createElement('span', { className:'tabnum text-faint' }, d.avg.toFixed(1))
                ),
                React.createElement('div', { className:'h-1.5 bg-panel2 rounded-full overflow-hidden' },
                  React.createElement('div', { className:'h-full rounded-full', style:{ width:w+'%', backgroundColor:color } })
                )
              );
            })}
          </div>
          <div className="bg-panel2 rounded-xl px-3 py-2 text-xs text-paper">
            {best.name + 's are your best hydration day (' + best.avg.toFixed(1) + ' glasses). ' + worst.name + 's are the hardest (' + worst.avg.toFixed(1) + '). Consider a ' + worst.name + ' reminder.'}
          </div>
        </div>
      )}
    </Card>
  );
}

function HabitHeatmap() {
  var store = useStore();
  var state = store.state;
  var habits = state.anchor.habits || [];
  var habitLog = state.anchor.habitLog || [];
  if (habits.length === 0 || habitLog.length === 0) return null;
  var total = habits.length;
  var now = new Date();
  var weeks = 7; // 7 weeks back = 49 days
  var cols = [];
  // Build columns = weeks (left=oldest), rows = days of week (top=Sun)
  for (var w = weeks - 1; w >= 0; w--) {
    var col = [];
    for (var dow = 0; dow < 7; dow++) {
      var offset = w * 7 + (6 - ((now.getDay() - dow + 7) % 7));
      var d = new Date(now);
      d.setDate(d.getDate() - offset);
      // skip future days
      if (d > now) { col.push(null); continue; }
      var ds = localDateStr(d);
      var done = habitLog.filter(function(e){ return e.key.endsWith(':'+ds); }).length;
      var frac = total > 0 ? Math.min(1, done / total) : 0;
      col.push({ ds: ds, done: done, frac: frac });
    }
    cols.push(col);
  }
  var heatColor = function(f) {
    if (f === 0) return 'bg-panel2';
    if (f < 0.33) return 'bg-grow/30';
    if (f < 0.66) return 'bg-grow/60';
    return 'bg-grow';
  };
  return (
    <div className="mt-3 pt-3 border-t border-edge/20">
      <div className="text-xs text-faint mb-2">Habit completion · 7 weeks</div>
      <div className="flex gap-0.5">
        {cols.map(function(col, wi){
          return (
            <div key={wi} className="flex flex-col gap-0.5 flex-1">
              {col.map(function(cell, di){
                if (!cell) return <div key={di} className="aspect-square rounded-sm opacity-0" />;
                return (
                  <div key={di} title={cell.ds + ': ' + cell.done + '/' + total}
                    className={'aspect-square rounded-sm ' + heatColor(cell.frac)} />
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-1 mt-2 text-[10px] text-faint">
        <span>Less</span>
        <div className="w-3 h-3 rounded-sm bg-panel2" />
        <div className="w-3 h-3 rounded-sm bg-grow/30" />
        <div className="w-3 h-3 rounded-sm bg-grow/60" />
        <div className="w-3 h-3 rounded-sm bg-grow" />
        <span>More</span>
      </div>
    </div>
  );
}

function HabitMoodCorrelation() {
  var _o = useState(false); var open = _o[0]; var setOpen = _o[1];
  var store = useStore(); var state = store.state;
  var habits = state.anchor.habits || [];
  var habitLog = state.anchor.habitLog || [];
  var moodLog = state.anchor.moodLog || [];
  if (habits.length < 1 || moodLog.length < 10 || habitLog.length < 15) return null;

  var moodVal = { great:5, good:4, ok:3, low:2, anxious:1 };

  // Build day → avg mood map
  var dayMood = {};
  moodLog.forEach(function(m){
    var d = dayOf(m.ts);
    if (!dayMood[d]) dayMood[d] = [];
    dayMood[d].push(moodVal[m.mood] || 3);
  });
  var avgForDays = function(dates) {
    var vals = [];
    dates.forEach(function(d){ if (dayMood[d]) vals = vals.concat(dayMood[d]); });
    return vals.length ? vals.reduce(function(s,v){ return s+v; },0)/vals.length : null;
  };

  // All logged dates with mood data
  var moodDates = new Set(Object.keys(dayMood));

  // Per-habit: days done vs not done, both must have mood
  var stats = habits.map(function(h){
    var doneDates = [], notDoneDates = [];
    moodDates.forEach(function(d){
      if (habitLog.some(function(e){ return e.key === h.id+':'+d; })) doneDates.push(d);
      else notDoneDates.push(d);
    });
    var doneAvg = avgForDays(doneDates);
    var notAvg  = avgForDays(notDoneDates);
    var delta = (doneAvg !== null && notAvg !== null) ? doneAvg - notAvg : null;
    return { h: h, doneAvg: doneAvg, notAvg: notAvg, delta: delta, doneN: doneDates.length };
  }).filter(function(s){ return s.delta !== null && s.doneN >= 3; })
    .sort(function(a,b){ return b.delta - a.delta; });

  if (stats.length < 1) return null;

  var maxAbs = Math.max.apply(null, stats.map(function(s){ return Math.abs(s.delta); }));
  if (maxAbs < 0.1) return null;


  return (
    <Card className="border-edge/30">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span className="text-base">📊</span>
          <span className="text-sm font-medium">Habits that lift your mood</span>
        </div>
        <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: open ? '▲' : '▼'}} />
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="text-[10px] text-faint mb-2">Mood avg on days each habit is done vs not done (higher = better):</div>
          {stats.map(function(s){
            var pos = s.delta >= 0;
            var barW = Math.round((Math.abs(s.delta)/maxAbs)*100);
            var barColor = pos ? '#3ddc97' : '#f87171';
            var sign = pos ? '+' : '';
            return (
              <div key={s.h.id}>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="flex items-center gap-1">
                    <span>{s.h.icon}</span>
                    <span className="text-paper/80">{s.h.label}</span>
                  </span>
                  <span className="tabnum" style={{color:barColor}}>{sign}{s.delta.toFixed(2)} pts</span>
                </div>
                <div className="h-1.5 bg-panel2 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{width:barW+'%', background:barColor}}></div>
                </div>
                <div className="text-[9px] text-faint mt-0.5">
                  Done: {s.doneAvg.toFixed(1)}/5 &middot; Not done: {s.notAvg.toFixed(1)}/5 &middot; {s.doneN} days sampled
                </div>
              </div>
            );
          })}
          <div className="text-[9px] text-faint/60 italic pt-1 border-t border-edge/20">Correlation, not causation. More data improves accuracy.</div>
        </div>
      )}
    </Card>
  );
}

function HabitStreakBoard() {
  var _s = useStore(); var state = _s.state;
  var habits = state.anchor.habits || [];
  var habitLog = state.anchor.habitLog || [];
  if (habits.length < 2 || habitLog.length < 3) return null;
  var ranked = habits.map(function(h){
    var streak = 0; var longest = 0; var cur = 0; var totalDays = 0;
    for (var i = 0; i < 90; i++) {
      var d = new Date(); d.setDate(d.getDate()-i);
      var ds = localDateStr(d);
      var done = habitLog.some(function(e){ return e.key === h.id+':'+ds; });
      if (done) { if (i === streak) streak++; cur++; totalDays++; } else { if (cur > longest) longest = cur; cur = 0; }
    }
    if (cur > longest) longest = cur;
    return { id: h.id, icon: h.icon, label: h.label, streak: streak, longest: longest, totalDays: totalDays };
  }).filter(function(h){ return h.totalDays > 0; })
    .sort(function(a,b){ return b.streak !== a.streak ? b.streak-a.streak : b.longest-a.longest; });
  if (ranked.length === 0) return null;
  var medalColors = ['text-yellow-400', 'text-slate-300', 'text-amber-600'];
  var medals = ['🥇','🥈','🥉'];
  return (
    <Card className="space-y-2 mt-2">
      <div className="flex items-center gap-2">
        <span className="text-base">🏆</span>
        <span className="text-sm font-medium">Habit streaks</span>
      </div>
      {ranked.map(function(h, i){
        var barW = ranked[0].streak > 0 ? Math.round((h.streak/ranked[0].streak)*100) : 0;
        return (
          <div key={h.id} className="space-y-0.5">
            <div className="flex items-center gap-2 text-xs">
              {i < 3
                ? <span className={medalColors[i] || 'text-faint'} dangerouslySetInnerHTML={{__html:medals[i]}}></span>
                : <span className="text-faint w-4 text-center">{i+1}</span>}
              <span className="text-base">{h.icon}</span>
              <span className="text-paper flex-1 truncate">{h.label}</span>
              <span className="text-brand font-bold tabnum">{h.streak}d</span>
              {h.longest > h.streak && <span className="text-faint">best {h.longest}</span>}
            </div>
            {h.streak > 0 && (
              <div className="w-full bg-edge/20 rounded-full h-1 ml-6">
                <div className="bg-brand/60 rounded-full h-1 transition-all" style={{width:barW+'%'}}></div>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

function WeeklyStatsCard() {
  const { state } = useStore();
  const [expanded, setExpanded] = useState(false);
  const now = new Date();
  const weekAgo = new Date(now - 7 * dayMs).toISOString();
  const moods = state.anchor.moodLog.filter(function(m){ return m.ts >= weekAgo; });
  const routines = state.flow.history.filter(function(h){ return h.ts >= weekAgo && h.completed; });
  const sessions = state.copilot.history.filter(function(h){ return h.ts >= weekAgo; });
  const gratitudes = (state.anchor.gratitude || []).filter(function(g){ return g.ts >= weekAgo; });
  const journals = (state.anchor.journal || []).filter(function(j){ return j.ts >= weekAgo; });
  const sleeps = (state.anchor.sleep || []).filter(function(s){ return s.ts >= weekAgo; });
  const breaths = (state.anchor.breathingSessions || []).filter(function(b){ return b.ts >= weekAgo; });
  const total = moods.length + routines.length + sessions.length + gratitudes.length + journals.length + sleeps.length + breaths.length;
  if (total < 3) return null;
  const moodVal = { great:5, good:4, ok:3, low:2, anxious:1 };
  const avgMood = moods.length ? (moods.reduce(function(s,m){ return s + (moodVal[m.mood]||3); }, 0) / moods.length).toFixed(1) : null;
  const avgSleep = sleeps.length ? (sleeps.reduce(function(s,e){ return s + e.hours; }, 0) / sleeps.length).toFixed(1) : null;
  const streak = getAppStreak(state);
  return (
    <Card className="border-edge/30 cursor-pointer" onClick={function(){ setExpanded(!expanded); }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">📈</span>
          <span className="text-faint text-sm">Weekly progress</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-brand font-bold tabnum">{total}</span>
          <span className="text-faint text-sm">activities</span>
          <span className="text-faint text-sm">{expanded ? '▾' : '▸'}</span>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            {moods.length > 0 && <div className="bg-panel2 rounded-xl px-3 py-2"><span className="text-calm font-bold tabnum">{moods.length}</span> <span className="text-faint">check-ins</span>{avgMood && <div className="text-faint text-[11px]">avg {avgMood}/5</div>}</div>}
            {routines.length > 0 && <div className="bg-panel2 rounded-xl px-3 py-2"><span className="text-grow font-bold tabnum">{routines.length}</span> <span className="text-faint">routines</span></div>}
            {sessions.length > 0 && <div className="bg-panel2 rounded-xl px-3 py-2"><span className="text-brand font-bold tabnum">{sessions.length}</span> <span className="text-faint">focus sessions</span></div>}
            {sleeps.length > 0 && <div className="bg-panel2 rounded-xl px-3 py-2"><span className="text-warm font-bold tabnum">{sleeps.length}</span> <span className="text-faint">sleep logs</span>{avgSleep && <div className="text-faint text-[11px]">avg {avgSleep}h</div>}</div>}
            {breaths.length > 0 && <div className="bg-panel2 rounded-xl px-3 py-2"><span className="text-calm font-bold tabnum">{breaths.length}</span> <span className="text-faint">breathing</span></div>}
            {gratitudes.length > 0 && <div className="bg-panel2 rounded-xl px-3 py-2"><span className="text-warm font-bold tabnum">{gratitudes.length}</span> <span className="text-faint">gratitudes</span></div>}
            {journals.length > 0 && <div className="bg-panel2 rounded-xl px-3 py-2"><span className="text-rose font-bold tabnum">{journals.length}</span> <span className="text-faint">journals</span></div>}
          </div>
          {streak > 0 && <div className="text-center text-warm text-sm mt-1">🔥 {streak} day streak</div>}
        </div>
      )}
    </Card>
  );
}

function EnergyIndicator() {
  const { state } = useStore();
  const todayStr = todayKey();
  const todayMoods = state.anchor.moodLog.filter(function(m){ return dayOf(m.ts) === todayStr && m.energy; });
  if (todayMoods.length === 0) return null;
  const last = todayMoods[0];
  const LEVELS = { low: { label: 'Low', color: 'text-rose', bar: '▮' }, medium: { label: 'Med', color: 'text-warm', bar: '▮▮' }, high: { label: 'High', color: 'text-grow', bar: '▮▮▮' }, peak: { label: 'Peak', color: 'text-brand', bar: '▮▮▮▮' } };
  const lvl = LEVELS[last.energy] || LEVELS.medium;
  return (
    <div className="flex items-center gap-1 text-xs">
      <span>⚡</span>
      <span className={lvl.color + ' font-mono text-[11px]'}>{lvl.bar}</span>
      <span className="text-faint">{lvl.label}</span>
    </div>
  );
}

function DailyProgressRing() {
  const { state } = useStore();
  const todayStr = todayKey();
  var goals = [];
  var done = 0;
  var total = 0;
  var moods = state.anchor.moodLog.filter(function(m){ return dayOf(m.ts) === todayStr; }).length;
  goals.push({ label: 'Check-in', done: moods > 0, icon: '🧭' });
  total++; if (moods > 0) done++;
  var sleeps = (state.anchor.sleep||[]).filter(function(s){ return dayOf(s.ts) === todayStr; }).length;
  goals.push({ label: 'Sleep log', done: sleeps > 0, icon: '😴' });
  total++; if (sleeps > 0) done++;
  var journals = (state.anchor.journal||[]).filter(function(j){ return dayOf(j.ts) === todayStr; }).length;
  goals.push({ label: 'Journal', done: journals > 0, icon: '📝' });
  total++; if (journals > 0) done++;
  var grats = (state.anchor.gratitude||[]).filter(function(g){ return dayOf(g.ts) === todayStr; }).length;
  goals.push({ label: 'Gratitude', done: grats > 0, icon: '🌻' });
  total++; if (grats > 0) done++;
  var water = (state.anchor.waterLog||[]).find(function(w){ return w.date === todayStr; });
  var wGoal = state.user.preferences.waterGoal || 8;
  var waterDone = water && water.count >= wGoal;
  goals.push({ label: 'Water goal', done: waterDone, icon: '💧' });
  total++; if (waterDone) done++;
  var habits = state.anchor.habits||[];
  var habitLog = state.anchor.habitLog||[];
  var allHabits = habits.length > 0 && habits.every(function(h){ return habitLog.some(function(e){ return e.key === h.id+':'+todayStr; }); });
  if (habits.length > 0) { goals.push({ label: 'Habits', done: allHabits, icon: '✅' }); total++; if (allHabits) done++; }
  var meds = state.anchor.meds||[];
  var medLog = state.anchor.medLog||[];
  var allMeds = meds.length > 0 && meds.every(function(m){ return medLog.some(function(e){ return e.key === m.id+':'+todayStr; }); });
  if (meds.length > 0) { goals.push({ label: 'Meds', done: allMeds, icon: '💊' }); total++; if (allMeds) done++; }
  var frac = total > 0 ? done / total : 0;
  var pct = Math.round(frac * 100);
  var color = pct >= 100 ? '#3ddc97' : pct >= 60 ? '#6aa0ff' : pct >= 30 ? '#ffce6a' : '#ff9aa6';
  return (
    <Card className="border-edge/30">
      <div className="flex items-center gap-4">
        <Ring frac={frac} size={72} stroke={6} color={color}>
          <span className="text-sm font-bold tabnum" style={{color:color}}>{pct}%</span>
        </Ring>
        <div className="flex-1">
          <div className="text-faint text-sm mb-2">{pct >= 100 ? '🎉 All goals complete!' : "Today's progress"}</div>
          <div className="flex flex-wrap gap-2">
            {goals.map(function(g){
              return React.createElement('span', { key: g.label, className: 'inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ' + (g.done ? 'bg-grow/15 text-grow' : 'bg-panel2 text-faint') },
                React.createElement('span', null, g.icon),
                g.done ? '✓' : '—'
              );
            })}
          </div>
        </div>
      </div>
      {pct >= 100 && React.createElement('div', { className: 'text-center text-grow text-sm mt-2 animate-pulse' }, 'You showed up for yourself today. That matters.')}
    </Card>
  );
}

function MeditationTimer() {
  const { state, dispatch } = useStore();
  var PRESETS = [3, 5, 10, 15];
  var todayStr = todayKey();
  var todayCount = (state.anchor.meditationLog||[]).filter(function(m){ return dayOf(m.ts) === todayStr; }).length;
  var ref = useRef(null);
  var animRef = useRef(null);
  var startRef = useRef(0);
  var durRef = useRef(0);
  var _s = useState(null); var chosen = _s[0]; var setChosen = _s[1];
  var _r = useState(false); var running = _r[0]; var setRunning = _r[1];
  var _t = useState(0); var elapsed = _t[0]; var setElapsed = _t[1];
  var _d = useState(false); var done = _d[0]; var setDone = _d[1];
  var _th = useState(''); var theme = _th[0]; var setTheme = _th[1];

  var THEMES = [
    { key: 'breath', label: 'Breath Focus', icon: '💨', color: '#60a5fa', guide: 'Follow each breath in and out. When the mind wanders, gently return to the breath.' },
    { key: 'body', label: 'Body Scan', icon: '🧘', color: '#34d399', guide: 'Slowly move awareness from the top of your head down through each part of your body.' },
    { key: 'compassion', label: 'Compassion', icon: '💜', color: '#f472b6', guide: 'Send warmth and kindness to yourself, then to others. You are worthy of care.' },
    { key: 'visualize', label: 'Visualization', icon: '🌄', color: '#fbbf24', guide: 'Picture a calm, safe place. Notice every detail — colours, sounds, the air around you.' },
  ];

  var start = function(mins) {
    setChosen(mins);
    setRunning(true);
    setElapsed(0);
    setDone(false);
    startRef.current = Date.now();
    durRef.current = mins * 60 * 1000;
    buzz(20);
  };

  useEffect(function() {
    if (!running) return;
    var tick = function() {
      var e = Date.now() - startRef.current;
      setElapsed(Math.min(e, durRef.current));
      if (e >= durRef.current) {
        setRunning(false);
        setDone(true);
        buzz(80);
        chime(528, 0.6);
        dispatch({ type: 'MEDITATION_LOG', minutes: chosen, completed: true, theme: theme });
      } else {
        animRef.current = requestAnimationFrame(tick);
      }
    };
    animRef.current = requestAnimationFrame(tick);
    return function() { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [running]);

  var cancel = function() {
    setRunning(false);
    setDone(false);
    setChosen(null);
    setTheme('');
    if (animRef.current) cancelAnimationFrame(animRef.current);
  };

  if (done) {
    return (
      <Card className="border-calm/30 text-center">
        <div className="text-3xl mb-2">🪷</div>
        <div className="font-semibold text-calm">Meditation complete</div>
        <div className="text-faint text-sm mt-1">{chosen} minutes of stillness</div>
        <button onClick={function(){ setDone(false); setChosen(null); }} className="text-brand text-sm mt-3 hover:underline">Done</button>
      </Card>
    );
  }

  if (running && chosen) {
    var totalSecs = chosen * 60;
    var elapsedSecs = Math.floor(elapsed / 1000);
    var remaining = totalSecs - elapsedSecs;
    var mins = Math.floor(remaining / 60);
    var secs = remaining % 60;
    var frac = elapsed / durRef.current;
    return (
      <Card className="border-calm/30 text-center">
        <Ring frac={frac} size={140} stroke={8} color="#b08cff">
          <div className="text-3xl font-bold text-calm tabnum">{mins}:{String(secs).padStart(2,'0')}</div>
          <div className="text-faint text-xs mt-1">remaining</div>
        </Ring>
        {(function(){
          var tData = THEMES.find(function(t){ return t.key === theme; });
          if (tData) return (
            <div className="mt-3 text-center">
              <div className="text-xs font-semibold mb-1" style={{color: tData.color}} dangerouslySetInnerHTML={{__html: tData.icon + ' ' + tData.label}}></div>
              <div className="text-faint text-xs leading-relaxed" style={{animation:'pulsePresence 4s ease infinite'}}>{tData.guide}</div>
            </div>
          );
          return <div className="text-faint text-sm mt-3" style={{animation:'pulsePresence 4s ease infinite'}}>Breathe gently. Be here now.</div>;
        })()}
        <button onClick={cancel} className="text-rose/70 text-sm mt-3 hover:underline">End early</button>
      </Card>
    );
  }

  return (
    <Card className="border-edge/30">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🧘</span>
          <span className="font-semibold">Meditate</span>
        </div>
        {todayCount > 0 && <span className="text-calm text-xs">{todayCount} today</span>}
      </div>
      <div className="mb-3">
        <div className="text-faint text-[10px] mb-1 uppercase tracking-wide">Theme (optional)</div>
        <div className="flex flex-wrap gap-1">
          {THEMES.map(function(t){
            return React.createElement('button', {
              key: t.key,
              onClick: function(){ setTheme(theme === t.key ? '' : t.key); },
              className: 'flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border transition ' + (theme === t.key ? 'border-current font-semibold' : 'border-edge/30 text-faint hover:border-edge'),
              style: theme === t.key ? { color: t.color, borderColor: t.color } : {}
            },
              React.createElement('span', { dangerouslySetInnerHTML: { __html: t.icon } }),
              t.label
            );
          })}
        </div>
        {(function(){
          var tData = THEMES.find(function(t){ return t.key === theme; });
          if (!tData) return null;
          return React.createElement('div', { className: 'text-[10px] text-faint mt-1 italic' }, tData.guide);
        })()}
      </div>
      <div className="flex gap-2">
        {PRESETS.map(function(m){
          return React.createElement('button', {
            key: m,
            onClick: function(){ start(m); },
            className: 'flex-1 bg-panel2 hover:bg-calm/20 text-paper rounded-xl py-3 text-center transition active:scale-95'
          },
            React.createElement('div', { className: 'text-lg font-bold tabnum' }, m),
            React.createElement('div', { className: 'text-faint text-[10px]' }, 'min')
          );
        })}
      </div>
      {(function(){
        var allMed = state.anchor.meditationLog || [];
        if (allMed.length < 2) return null;
        var totalMins = allMed.filter(function(m){ return m.completed; }).reduce(function(s,m){ return s+(m.minutes||0); },0);
        var totalSessions = allMed.filter(function(m){ return m.completed; }).length;
        var best = allMed.reduce(function(b,m){ return (m.minutes||0)>(b.minutes||0)?m:b; }, allMed[0]);
        var todayMins = allMed.filter(function(m){ return dayOf(m.ts)===todayStr && m.completed; }).reduce(function(s,m){ return s+(m.minutes||0); },0);
        return (
          <div className="mt-3 flex gap-2 border-t border-edge/30 pt-3">
            <div className="flex-1 text-center">
              <div className="text-calm font-bold tabnum">{totalMins}m</div>
              <div className="text-faint text-[9px]">total time</div>
            </div>
            <div className="flex-1 text-center">
              <div className="text-calm font-bold tabnum">{totalSessions}</div>
              <div className="text-faint text-[9px]">sessions</div>
            </div>
            <div className="flex-1 text-center">
              <div className="text-calm font-bold tabnum">{best.minutes}m</div>
              <div className="text-faint text-[9px]">personal best</div>
            </div>
            {todayMins > 0 && (
              <div className="flex-1 text-center">
                <div className="text-calm font-bold tabnum">{todayMins}m</div>
                <div className="text-faint text-[9px]">today</div>
              </div>
            )}
          </div>
        );
      })()}
    </Card>
  );
}

function MeditationThemeStats() {
  const { state } = useStore();
  var log = (state.anchor.meditationLog || []).filter(function(m){ return m.completed && m.theme; });
  if (log.length < 3) return null;
  var THEME_META = {
    breath:    { label: 'Breath Focus', color: '#60a5fa', icon: '💨' },
    body:      { label: 'Body Scan',    color: '#34d399', icon: '🧘' },
    compassion:{ label: 'Compassion',   color: '#f472b6', icon: '💜' },
    visualize: { label: 'Visualization',color: '#fbbf24', icon: '🌄' },
  };
  var stats = {};
  log.forEach(function(m){
    if (!stats[m.theme]) stats[m.theme] = { count: 0, totalMins: 0 };
    stats[m.theme].count++;
    stats[m.theme].totalMins += (m.minutes || 0);
  });
  var rows = Object.keys(stats).map(function(k){
    return { key: k, count: stats[k].count, avgMins: Math.round(stats[k].totalMins / stats[k].count), meta: THEME_META[k] || { label: k, color: '#9ca3af', icon: '🧘' } };
  }).sort(function(a,b){ return b.count - a.count; });
  var maxCount = rows[0].count;
  return (
    <Card className="border-edge/30">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🎯</span>
        <span className="font-semibold text-sm">Meditation Themes</span>
        <span className="text-faint text-xs ml-auto">{log.length} themed sessions</span>
      </div>
      <div className="space-y-2">
        {rows.map(function(r){
          var pct = Math.round((r.count / maxCount) * 100);
          return (
            <div key={r.key}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="flex items-center gap-1">
                  <span dangerouslySetInnerHTML={{__html: r.meta.icon}}></span>
                  <span style={{color: r.meta.color}}>{r.meta.label}</span>
                </span>
                <span className="text-faint">{r.count}x &middot; avg {r.avgMins}m</span>
              </div>
              <div className="h-1.5 bg-panel2 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{width: pct+'%', background: r.meta.color}}></div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

var BODY_SCAN_STEPS = [
  { zone:'Feet & toes', cue:'Notice the weight of your feet. Breathe in, and as you breathe out, let your feet soften.' },
  { zone:'Calves & shins', cue:'Bring your attention to your lower legs. Release any holding you find there.' },
  { zone:'Knees & thighs', cue:'Scan your thighs. Let them be heavy, supported, at rest.' },
  { zone:'Hips & lower back', cue:'Any tension here? With your next exhale, invite it to melt.' },
  { zone:'Belly', cue:'Rest one hand here. Feel it rise and fall. You are safe. Nothing to do right now.' },
  { zone:'Chest & heart', cue:'Notice your heartbeat. Thank it quietly for working without being asked.' },
  { zone:'Hands & arms', cue:'Let your hands uncurl. Feel the tips of your fingers, warm and alive.' },
  { zone:'Shoulders', cue:'This is where we carry the most. On your next exhale, let them drop just a little.' },
  { zone:'Neck & throat', cue:'Soften your jaw, your tongue. Let your throat be easy.' },
  { zone:'Face & scalp', cue:'Unclench your brow. Soften around your eyes, your cheeks, your lips.' },
  { zone:'Whole body', cue:'Take a breath and feel yourself from feet to crown — one whole, breathing thing. You are here.' },
];

function BodyScan({ onDone }) {
  const { dispatch } = useStore();
  var [step, setStep] = useState(0);
  var [secs, setSecs] = useState(30);
  var [running, setRunning] = useState(false);
  var [complete, setComplete] = useState(false);
  var timerRef = useRef(null);

  var startStep = function(idx) {
    setStep(idx);
    setSecs(30);
    setRunning(true);
  };

  useEffect(function() {
    if (!running) return;
    timerRef.current = setInterval(function() {
      setSecs(function(s) {
        if (s <= 1) {
          clearInterval(timerRef.current);
          setRunning(false);
          if (step >= BODY_SCAN_STEPS.length - 1) {
            setComplete(true);
            dispatch({ type:'MEDITATION_LOG', minutes: Math.round(BODY_SCAN_STEPS.length * 30 / 60), completed: true, sessionType:'bodyscan' });
            buzz(80); chime(528, 0.6);
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return function() { clearInterval(timerRef.current); };
  }, [running, step]);

  var next = function() {
    clearInterval(timerRef.current);
    setRunning(false);
    if (step < BODY_SCAN_STEPS.length - 1) {
      startStep(step + 1);
    } else {
      setComplete(true);
      dispatch({ type:'MEDITATION_LOG', minutes: Math.round(BODY_SCAN_STEPS.length * 30 / 60), completed: true, sessionType:'bodyscan' });
      buzz(80); chime(528, 0.6);
    }
  };

  if (complete) return (
    <Card className="border-calm/30 text-center">
      <div className="text-4xl mb-2">🌊</div>
      <div className="font-semibold text-calm">Body scan complete</div>
      <p className="text-faint text-sm mt-1 mb-4">You checked in with every part of yourself. That takes care.</p>
      <Btn tone="calm" className="w-full" onClick={onDone}>Done</Btn>
    </Card>
  );

  var cur = BODY_SCAN_STEPS[step];
  var pct = ((30 - secs) / 30) * 100;

  if (!running && secs === 30 && step === 0) {
    return (
      <Card className="border-calm/30 space-y-4">
        <div className="text-center">
          <div className="text-4xl mb-2">🌊</div>
          <div className="font-semibold text-paper">5-minute body scan</div>
          <p className="text-faint text-sm mt-2">You will be guided through 11 body zones, 30 seconds each. Get comfortable — lying down is best.</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-center text-xs text-faint">
          {BODY_SCAN_STEPS.map(function(s, i){ return <span key={i} className="px-2 py-0.5 rounded-full bg-panel2">{s.zone}</span>; })}
        </div>
        <Btn tone="calm" className="w-full" onClick={function(){ startStep(0); }}>Begin</Btn>
        <button onClick={onDone} className="w-full text-center text-faint text-sm">Maybe later</button>
      </Card>
    );
  }

  return (
    <Card className="border-calm/30 space-y-4">
      <div className="flex items-center gap-2 text-xs text-faint">
        {BODY_SCAN_STEPS.map(function(s, i){
          return <span key={i} className={'flex-1 h-1 rounded-full transition-all ' + (i < step ? 'bg-calm' : i === step ? 'bg-calm/70' : 'bg-edge')} />;
        })}
      </div>
      <div className="text-center">
        <div className="text-faint text-xs uppercase tracking-widest mb-1">{step+1} of {BODY_SCAN_STEPS.length}</div>
        <div className="text-2xl font-semibold text-paper mb-3">{cur.zone}</div>
        <p className="text-faint text-sm leading-relaxed px-2">{cur.cue}</p>
      </div>
      <div className="relative h-1.5 bg-edge rounded-full overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-calm rounded-full transition-all" style={{width: pct+'%'}} />
      </div>
      <div className="flex gap-2">
        {running && (
          <div className="flex-1 text-center text-faint text-sm tabnum">{secs}s</div>
        )}
        <Btn tone="calm" className="flex-1" onClick={next}>
          {step < BODY_SCAN_STEPS.length - 1 ? 'Next zone' : 'Finish'}
        </Btn>
      </div>
      {running && (
        <p className="text-center text-faint text-xs italic">Breathe slowly. Notice without judging.</p>
      )}
    </Card>
  );
}

function BodyScanCard() {
  var [open, setOpen] = useState(false);
  if (!open) return (
    <Card className="border-edge/20 cursor-pointer hover:border-calm/40" onClick={function(){ setOpen(true); }}>
      <div className="flex items-center gap-2">
        <span className="text-xl">🌊</span>
        <span className="text-paper font-semibold">Body scan</span>
        <span className="ml-auto text-faint text-xs">5 min guided</span>
      </div>
      <div className="text-faint text-sm mt-1">Progressive relaxation through 11 body zones</div>
    </Card>
  );
  return <BodyScan onDone={function(){ setOpen(false); }} />;
}

function BodyScanHistory() {
  var store = useStore();
  var state = store.state;
  var sessions = (state.anchor.meditationLog || []).filter(function(m){ return m.sessionType === 'bodyscan' && m.completed; });
  if (sessions.length < 2) return null;
  var today = new Date();
  var days14 = [];
  for (var i = 13; i >= 0; i--) {
    var d = new Date(today); d.setDate(today.getDate() - i);
    days14.push(localDateStr(d));
  }
  var doneSet = {};
  sessions.forEach(function(s){ doneSet[dayOf(s.ts)] = true; });
  var streak = 0;
  for (var di = 0; di < days14.length; di++) {
    var dd = days14[days14.length - 1 - di];
    if (doneSet[dd]) streak++; else break;
  }
  var totalMins = sessions.length * Math.round(BODY_SCAN_STEPS.length * 30 / 60);
  return (
    React.createElement('div', { className:'rounded-xl border border-edge/20 bg-panel p-3 space-y-2' },
      React.createElement('div', { className:'flex items-center gap-2' },
        React.createElement('span', { className:'text-base' }, '🌊'),
        React.createElement('span', { className:'text-xs font-semibold text-paper' }, 'Body Scan History'),
        streak > 0 && React.createElement('span', { className:'ml-auto text-xs px-2 py-0.5 rounded-full bg-calm/20 text-calm' },
          streak + ' day' + (streak !== 1 ? 's' : '') + ' streak'
        )
      ),
      React.createElement('div', { className:'flex gap-1' },
        days14.map(function(d, i){
          var done = !!doneSet[d];
          var isToday = d === localDateStr(today);
          return React.createElement('div', {
            key: i,
            title: d + (done ? ' – completed' : ''),
            className: 'flex-1 h-4 rounded-sm ' + (done ? 'bg-calm' : 'bg-edge/30') + (isToday ? ' ring-1 ring-calm/60' : '')
          });
        })
      ),
      React.createElement('div', { className:'flex gap-4 text-xs text-faint' },
        React.createElement('span', null, sessions.length + ' total sessions'),
        React.createElement('span', null, totalMins + ' mins of relaxation')
      )
    )
  );
}

function MoodInsights() {
  var _e = useState(false); var expanded = _e[0]; var setExpanded = _e[1];
  var store = useStore();
  var state = store.state;
  var logs = state.anchor.moodLog || [];
  if (logs.length < 3) return null;
  var moodVal = { great:5, good:4, ok:3, low:2, anxious:1 };
  var todayStr = todayKey();
  var weekAgo = localDateStr(new Date(Date.now() - 7 * dayMs));
  var thisWeek = logs.filter(function(m){ return dayOf(m.ts) >= weekAgo; });
  var prevWeekStart = localDateStr(new Date(Date.now() - 14 * dayMs));
  var lastWeek = logs.filter(function(m){ var d = dayOf(m.ts); return d >= prevWeekStart && d < weekAgo; });
  if (thisWeek.length < 2) return null;
  var avgThis = thisWeek.reduce(function(s,m){ return s + (moodVal[m.mood]||3); }, 0) / thisWeek.length;
  var avgLast = lastWeek.length >= 2 ? lastWeek.reduce(function(s,m){ return s + (moodVal[m.mood]||3); }, 0) / lastWeek.length : null;
  var moodCounts = {};
  thisWeek.forEach(function(m){ moodCounts[m.mood] = (moodCounts[m.mood]||0) + 1; });
  var topMood = Object.keys(moodCounts).sort(function(a,b){ return moodCounts[b] - moodCounts[a]; })[0];
  var moodEmoji = { great:'😊', good:'🙂', ok:'😐', low:'😔', anxious:'😰' };
  var trend = avgLast !== null ? (avgThis > avgLast + 0.3 ? 'up' : avgThis < avgLast - 0.3 ? 'down' : 'steady') : null;
  var trendIcon = trend === 'up' ? '📈' : trend === 'down' ? '📉' : '➡️';
  var trendText = trend === 'up' ? 'Mood is trending up from last week' : trend === 'down' ? 'Mood dipped a bit — be gentle with yourself' : 'Mood has been steady';
  // Energy-mood correlation
  var energyLogs = state.anchor.energyLog || [];
  var energyInsight = null;
  if (energyLogs.length >= 3 && logs.length >= 3) {
    var highEnDays = new Set();
    var lowEnDays = new Set();
    energyLogs.forEach(function(e) {
      if (e.level >= 4) highEnDays.add(dayOf(e.ts));
      else if (e.level <= 2) lowEnDays.add(dayOf(e.ts));
    });
    var moodOnHigh = logs.filter(function(m){ return highEnDays.has(dayOf(m.ts)); });
    var moodOnLow  = logs.filter(function(m){ return lowEnDays.has(dayOf(m.ts)); });
    if (moodOnHigh.length >= 2 && moodOnLow.length >= 2) {
      var avgHigh = moodOnHigh.reduce(function(s,m){ return s+(moodVal[m.mood]||3); },0)/moodOnHigh.length;
      var avgLow  = moodOnLow.reduce(function(s,m){ return s+(moodVal[m.mood]||3); },0)/moodOnLow.length;
      var diff = avgHigh - avgLow;
      if (Math.abs(diff) >= 0.5) {
        energyInsight = diff > 0
          ? 'On high-energy days your mood scores ' + diff.toFixed(1) + ' pts higher — energy and mood move together for you.'
          : 'Interestingly, your mood holds up even on low-energy days. That\'s resilience.';
      }
    }
  }

  // Sleep-mood correlation
  var sleepLog = state.anchor.sleep || [];
  var sleepInsight = null;
  if (sleepLog.length >= 3 && logs.length >= 3) {
    var goodSleepDays = new Set(); var poorSleepDays = new Set();
    sleepLog.forEach(function(s){ if ((s.quality||0) >= 4) goodSleepDays.add(dayOf(s.ts)); else if ((s.quality||0) <= 2) poorSleepDays.add(dayOf(s.ts)); });
    var moodGoodSleep = logs.filter(function(m){ return goodSleepDays.has(dayOf(m.ts)); });
    var moodPoorSleep = logs.filter(function(m){ return poorSleepDays.has(dayOf(m.ts)); });
    if (moodGoodSleep.length >= 2 && moodPoorSleep.length >= 2) {
      var avgGS = moodGoodSleep.reduce(function(s,m){ return s+(moodVal[m.mood]||3); },0)/moodGoodSleep.length;
      var avgPS = moodPoorSleep.reduce(function(s,m){ return s+(moodVal[m.mood]||3); },0)/moodPoorSleep.length;
      var sdiff = avgGS - avgPS;
      if (Math.abs(sdiff) >= 0.4) sleepInsight = sdiff > 0
        ? 'After good sleep your mood scores ' + sdiff.toFixed(1) + ' pts higher on average.'
        : 'Your mood stays resilient even after poor sleep — that is a real strength.';
    }
  }
  // Time-of-day mood: morning vs evening check-ins
  var morningMoods = logs.filter(function(m){ var h=new Date(m.ts).getHours(); return h>=5 && h<12; });
  var eveningMoods = logs.filter(function(m){ var h=new Date(m.ts).getHours(); return h>=17 && h<23; });
  var timeInsight = null;
  if (morningMoods.length >= 3 && eveningMoods.length >= 3) {
    var avgMorn = morningMoods.reduce(function(s,m){ return s+(moodVal[m.mood]||3); },0)/morningMoods.length;
    var avgEve  = eveningMoods.reduce(function(s,m){ return s+(moodVal[m.mood]||3); },0)/eveningMoods.length;
    var tdiff = avgMorn - avgEve;
    if (Math.abs(tdiff) >= 0.4) timeInsight = tdiff > 0
      ? 'Your mornings tend to feel better than evenings (' + avgMorn.toFixed(1) + ' vs ' + avgEve.toFixed(1) + ').'
      : 'You tend to feel better in the evenings than mornings (' + avgEve.toFixed(1) + ' vs ' + avgMorn.toFixed(1) + ').';
  }

  // Day-of-week mood pattern (needs 14+ days of data)
  var DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var dowSums = [0,0,0,0,0,0,0]; var dowCounts = [0,0,0,0,0,0,0];
  logs.forEach(function(m){
    var dow = new Date(m.ts).getDay();
    dowSums[dow] += (moodVal[m.mood]||3);
    dowCounts[dow]++;
  });
  var dowInsight = null;
  var validDows = DOW_NAMES.map(function(name, i){
    return dowCounts[i] >= 2 ? { name:name, avg: dowSums[i]/dowCounts[i], i:i } : null;
  }).filter(Boolean);
  if (validDows.length >= 4) {
    var bestDow = validDows.reduce(function(a,b){ return a.avg >= b.avg ? a : b; });
    var worstDow = validDows.reduce(function(a,b){ return a.avg <= b.avg ? a : b; });
    if (bestDow.avg - worstDow.avg >= 0.5) {
      dowInsight = { best: bestDow.name, worst: worstDow.name, bestAvg: bestDow.avg, worstAvg: worstDow.avg };
    }
  }

  return (
    <Card className="border-edge/30 cursor-pointer" onClick={function(){ setExpanded(!expanded); }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">💡</span>
          <span className="font-semibold">Mood insights</span>
        </div>
        <span className="text-faint text-sm">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span>{moodEmoji[topMood] || '🙂'}</span>
            <span className="text-faint">Most common this week:</span>
            <span className="text-paper font-medium">{topMood}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>📊</span>
            <span className="text-faint">Average:</span>
            <span className="text-paper font-medium tabnum">{avgThis.toFixed(1)}/5</span>
          </div>
          {trend && (
            <div className="flex items-center gap-2">
              <span>{trendIcon}</span>
              <span className={trend==='down'?'text-rose/80':trend==='up'?'text-grow':'text-faint'}>{trendText}</span>
            </div>
          )}
          {energyInsight && (
            <div className="flex items-start gap-2 mt-1 pt-2 border-t border-edge/20">
              <span>⚡</span>
              <span className="text-faint leading-snug">{energyInsight}</span>
            </div>
          )}
          {sleepInsight && (
            <div className="flex items-start gap-2 mt-1 pt-2 border-t border-edge/20">
              <span>😴</span>
              <span className="text-faint leading-snug">{sleepInsight}</span>
            </div>
          )}
          {timeInsight && (
            <div className="flex items-start gap-2 mt-1 pt-2 border-t border-edge/20">
              <span>🕐</span>
              <span className="text-faint leading-snug">{timeInsight}</span>
            </div>
          )}
          {dowInsight && (
            <div className="flex items-start gap-2 mt-1 pt-2 border-t border-edge/20">
              <span>📅</span>
              <span className="text-faint leading-snug">
                {'You tend to feel best on ' + dowInsight.best + 's (' + dowInsight.bestAvg.toFixed(1) + '/5). ' + dowInsight.worst + 's are often harder (' + dowInsight.worstAvg.toFixed(1) + '/5).'}
              </span>
            </div>
          )}
          <div className="text-faint text-xs">{thisWeek.length} check-ins this week</div>
        </div>
      )}
    </Card>
  );
}

function AffirmationCard() {
  var store = useStore();
  var state = store.state;
  var dispatch = store.dispatch;
  var builtIn = [
    'You are enough, exactly as you are.',
    'Progress, not perfection.',
    'You deserve the same kindness you give others.',
    'One step at a time is still moving forward.',
    'Your feelings are valid.',
    'You are stronger than you think.',
    'It is okay to rest.',
    'You are worthy of good things.',
    'Healing is not linear.',
    'Today is a fresh start.',
    'You have survived 100% of your worst days.',
    'Small wins count.',
    'Be patient with yourself.',
    'You are not your mistakes.',
    'Breathe. You are here. That matters.',
    'Rest is productive. Stillness is not nothing.',
    'You do not have to earn your worth.',
    'Hard feelings pass. You stay.',
    'Each small step is a victory worth noticing.',
    'You are allowed to take up space.'
  ];
  var custom = (state.user.customAffirmations || []);
  var favs = state.user.favoriteAffirmations || [];
  var all = custom.length > 0 ? custom.concat(builtIn) : builtIn;
  var dayIndex = Math.floor(Date.now() / 86400000) % all.length;
  var _r = useState(0); var offset = _r[0]; var setOffset = _r[1];
  var _v = useState(false); var showFavs = _v[0]; var setShowFavs = _v[1];
  var current = all[(dayIndex + offset) % all.length];
  var isFav = favs.includes(current);

  if (showFavs) return (
    <Card className="border-brand/20 space-y-2">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2"><span>🌱</span><span className="text-faint text-sm">Saved affirmations</span></div>
        <button onClick={function(){ setShowFavs(false); }} className="text-faint text-xs hover:text-brand">back</button>
      </div>
      {favs.length === 0
        ? <p className="text-faint text-sm italic text-center py-2">None saved yet — tap ♡ on any affirmation</p>
        : favs.map(function(f, i){
            return (
              <div key={i} className="flex items-start gap-2 text-sm text-paper/80 py-1 border-b border-edge/20">
                <span className="flex-1 italic leading-snug">{f}</span>
                <button onClick={function(){ dispatch({ type:'TOGGLE_FAVORITE_AFFIRMATION', text: f }); }}
                  className="text-rose/70 hover:text-rose text-xs flex-shrink-0">✕</button>
              </div>
            );
          })
      }
    </Card>
  );

  return (
    <Card className="border-brand/20 text-center">
      <div className="text-3xl mb-2">🌱</div>
      <div className="text-paper text-lg italic leading-relaxed px-2">{'"'}{current}{'"'}</div>
      <div className="flex items-center justify-center gap-4 mt-3">
        <button onClick={function(){ setOffset(function(o){ return (o+1) % all.length; }); buzz(15); }}
          className="text-faint text-xs hover:text-brand transition">shuffle</button>
        <button onClick={function(){
          dispatch({ type:'TOGGLE_FAVORITE_AFFIRMATION', text: current });
          if (!isFav) { buzz(20); chime(528, 0.2); }
        }} className={'text-lg transition ' + (isFav ? 'text-rose' : 'text-faint hover:text-rose')}>
          {isFav ? '♥' : '♡'}
        </button>
        {favs.length > 0 && (
          <button onClick={function(){ setShowFavs(true); }} className="text-faint text-xs hover:text-brand transition">
            saved ({favs.length})
          </button>
        )}
      </div>
    </Card>
  );
}

function EnergyTracker() {
  var store = useStore();
  var state = store.state;
  var dispatch = store.dispatch;
  var todayStr = todayKey();
  var todayLogs = (state.anchor.energyLog||[]).filter(function(e){ return dayOf(e.ts) === todayStr; });
  var periods = [
    { key: 'morning', label: 'AM', icon: '🌅' },
    { key: 'afternoon', label: 'PM', icon: '☀️' },
    { key: 'evening', label: 'Eve', icon: '🌙' }
  ];
  var levels = [
    { val: 1, emoji: '😴', label: 'Depleted' },
    { val: 2, emoji: '😔', label: 'Low' },
    { val: 3, emoji: '😐', label: 'Okay' },
    { val: 4, emoji: '🙂', label: 'Good' },
    { val: 5, emoji: '⚡', label: 'Great' }
  ];
  var logged = {};
  todayLogs.forEach(function(e){ logged[e.period] = e; });
  var _s = useState(null); var picking = _s[0]; var setPicking = _s[1];
  var _p = useState(null); var pending = _p[0]; var setPending = _p[1];
  var _f = useState([]); var selFactors = _f[0]; var setSelFactors = _f[1];
  var ENERGY_FACTORS = ['Good sleep','Exercise','Coffee','Stress','Poor sleep','Heavy meal','Meditation','Fresh air','Sick'];
  var toggleFactor = function(f){ setSelFactors(function(prev){ return prev.includes(f)?prev.filter(function(x){return x!==f;}):[...prev,f]; }); };
  var commitPending = function() {
    if (!pending) return;
    dispatch({ type: 'ENERGY_LOG', period: pending.period, level: pending.level, factors: selFactors });
    setPicking(null); setPending(null); setSelFactors([]);
    buzz(20); chime(520, 0.12);
  };
  var filledCount = Object.keys(logged).length;
  return (
    <Card className="border-edge/30">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{'🔋'}</span>
          <span className="font-semibold">Energy</span>
        </div>
        {filledCount > 0 && React.createElement('span', { className: 'text-faint text-sm' }, filledCount + '/3')}
      </div>
      <div className="flex gap-2">
        {periods.map(function(p) {
          var entry = logged[p.key];
          var val = entry ? entry.level : null;
          var active = picking === p.key;
          return React.createElement('div', { key: p.key, className: 'flex-1' },
            React.createElement('button', {
              onClick: function(){ setPicking(active ? null : p.key); setPending(null); setSelFactors([]); },
              className: 'w-full rounded-xl py-2 text-center transition ' + (val ? 'bg-brand/15 border border-brand/30' : 'bg-panel2 border border-edge/20 hover:border-brand/30')
            },
              React.createElement('div', { className: 'text-lg' }, val ? levels[val-1].emoji : p.icon),
              React.createElement('div', { className: 'text-[10px] text-faint mt-1' }, p.label)
            ),
            active && !pending && React.createElement('div', { className: 'flex justify-center gap-1 mt-1' },
              levels.map(function(l) {
                return React.createElement('button', {
                  key: l.val,
                  onClick: function(){ setPending({ period: p.key, level: l.val }); },
                  className: 'text-lg hover:scale-125 transition',
                  title: l.label
                }, l.emoji);
              })
            )
          );
        })}
      </div>
      {pending && (
        <div className="mt-2 space-y-2 border-t border-edge/20 pt-2">
          <div className="text-[11px] text-faint">What drove your energy? (optional — tap to add)</div>
          <div className="flex flex-wrap gap-1.5">
            {ENERGY_FACTORS.map(function(f){
              var sel = selFactors.includes(f);
              return React.createElement('button', {
                key:f,
                onClick: function(){ toggleFactor(f); },
                className: 'text-[11px] px-2.5 py-1 rounded-full border transition ' +
                  (sel ? 'bg-brand/20 border-brand/40 text-brand' : 'border-edge/40 text-faint hover:border-brand/30')
              }, f);
            })}
          </div>
          <div className="flex gap-2">
            <button className="flex-1 text-xs text-faint hover:text-paper py-1.5 rounded-xl bg-panel2" onClick={commitPending}>Log {levels[pending.level-1].emoji} (skip factors)</button>
            {selFactors.length > 0 && <button className="flex-1 text-xs text-brand font-medium py-1.5 rounded-xl bg-brand/15 hover:bg-brand/25" onClick={commitPending}>Log with factors</button>}
          </div>
        </div>
      )}
    </Card>
  );
}

function EnergyTrend() {
  var [selDay, setSelDay] = useState(null);
  var store = useStore(); var state = store.state;
  var energyLog = state.anchor.energyLog || [];
  if (energyLog.length < 2) return null;
  var now = new Date();
  var days = [];
  for (var i = 6; i >= 0; i--) {
    var d = new Date(now); d.setDate(d.getDate()-i);
    var ds = localDateStr(d);
    var dayLabel = ['Su','Mo','Tu','We','Th','Fr','Sa'][d.getDay()];
    var dayLogs = energyLog.filter(function(e){ return dayOf(e.ts)===ds; });
    var avg = dayLogs.length ? dayLogs.reduce(function(s,e){ return s+e.level; },0)/dayLogs.length : 0;
    var am  = dayLogs.find(function(e){ return e.period==='morning'; });
    var pm  = dayLogs.find(function(e){ return e.period==='afternoon'; });
    var eve = dayLogs.find(function(e){ return e.period==='evening'; });
    days.push({ ds:ds, label:dayLabel, avg:avg, am:am&&am.level, pm:pm&&pm.level, eve:eve&&eve.level });
  }
  var energyColor = function(v) {
    if (!v) return 'transparent';
    if (v >= 4) return '#3ddc97';
    if (v >= 3) return '#6aa0ff';
    if (v >= 2) return '#ffce6a';
    return '#ff9aa6';
  };
  var energyEmoji = ['','😴','😔','😐','🙂','⚡'];
  var maxH = 40;
  var selData = selDay ? days.find(function(d){ return d.ds===selDay; }) : null;
  return (
    <Card className="border-edge/30">
      <div className="text-faint text-sm mb-3">Energy · 7 days</div>
      <div className="flex items-end justify-between gap-1" style={{height: (maxH+20)+'px'}}>
        {days.map(function(d) {
          var h = d.avg ? (d.avg/5)*maxH : 4;
          var isSel = selDay===d.ds;
          return (
            <div key={d.ds} className="flex-1 flex flex-col items-center gap-1 cursor-pointer"
              onClick={function(){ setSelDay(isSel?null:(d.avg?d.ds:null)); }}>
              {d.avg > 0 && <div className="text-[9px] tabnum text-faint">{d.avg.toFixed(1)}</div>}
              <div style={{width:'100%', maxWidth:'28px', height:Math.round(h)+'px',
                borderRadius:'6px', backgroundColor: d.avg?energyColor(d.avg):'rgba(42,58,92,0.3)',
                outline: isSel?'2px solid white':'none', outlineOffset:'2px', opacity:d.avg?1:0.2}} />
              <span className="text-faint text-[10px]">{d.label}</span>
            </div>
          );
        })}
      </div>
      {selData && selData.avg > 0 && (
        <div className="mt-3 bg-panel2 rounded-xl px-3 py-2 flex justify-around text-center">
          {[['🌅','AM',selData.am],['☀️','PM',selData.pm],['🌙','Eve',selData.eve]].map(function(col){
            return (
              <div key={col[1]}>
                <div className="text-base">{col[2] ? energyEmoji[col[2]] : col[0]}</div>
                <div className="text-faint text-[10px]">{col[1]}</div>
                {col[2] && <div className="text-[11px] tabnum" style={{color:energyColor(col[2])}}>{col[2]}/5</div>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function EnergyInsights() {
  var store = useStore(); var state = store.state;
  var logs = state.anchor.energyLog || [];
  var _o = useState(false); var open = _o[0]; var setOpen = _o[1];
  if (logs.length < 6) return null;

  var DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var dowSums = [0,0,0,0,0,0,0]; var dowCounts = [0,0,0,0,0,0,0];
  logs.forEach(function(e){
    var dow = new Date(e.ts).getDay();
    dowSums[dow] += e.level; dowCounts[dow]++;
  });
  var validDows = DOW_NAMES.map(function(name, i){
    return dowCounts[i] >= 2 ? { name:name, avg: dowSums[i]/dowCounts[i] } : null;
  }).filter(Boolean);
  var dowInsight = null;
  if (validDows.length >= 4) {
    var bestDow = validDows.reduce(function(a,b){ return a.avg >= b.avg ? a : b; });
    var worstDow = validDows.reduce(function(a,b){ return a.avg <= b.avg ? a : b; });
    if (bestDow.avg - worstDow.avg >= 0.4) dowInsight = { best: bestDow.name, worst: worstDow.name, bestAvg: bestDow.avg, worstAvg: worstDow.avg };
  }

  var amLogs = logs.filter(function(e){ return e.period === 'morning'; });
  var pmLogs = logs.filter(function(e){ return e.period === 'afternoon'; });
  var eveLogs = logs.filter(function(e){ return e.period === 'evening'; });
  var avg = function(arr){ return arr.length ? arr.reduce(function(s,e){ return s+e.level; },0)/arr.length : null; };
  var amAvg = avg(amLogs); var pmAvg = avg(pmLogs); var eveAvg = avg(eveLogs);
  var periods = [{label:'Morning',avg:amAvg,icon:'🌅'},{label:'Afternoon',avg:pmAvg,icon:'☀'},{label:'Evening',avg:eveAvg,icon:'🌙'}].filter(function(p){ return p.avg !== null; });
  var bestPeriod = periods.length >= 2 ? periods.reduce(function(a,b){ return a.avg >= b.avg ? a : b; }) : null;
  var worstPeriod = periods.length >= 2 ? periods.reduce(function(a,b){ return a.avg <= b.avg ? a : b; }) : null;

  if (!dowInsight && !bestPeriod) return null;

  var energyColor = function(v){ if(v>=4)return'#3ddc97';if(v>=3)return'#6aa0ff';if(v>=2)return'#ffce6a';return'#ff9aa6'; };

  return (
    <Card className="border-edge/30 space-y-2">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span>⚡</span>
          <span className="text-sm font-medium">Energy patterns</span>
        </div>
        <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: open ? '▲' : '▼'}} />
      </button>
      {open && (
        <div className="space-y-3 pt-1">
          {dowInsight && (
            <div className="bg-panel2 rounded-xl p-3 space-y-1">
              <div className="text-xs text-faint font-medium">Day of week</div>
              <div className="text-sm text-paper">
                {'Your energy peaks on ' + dowInsight.best + 's '}
                <span className="tabnum" style={{color: energyColor(dowInsight.bestAvg)}}>({'avg ' + dowInsight.bestAvg.toFixed(1) + '/5'})</span>
                {'. ' + dowInsight.worst + 's tend to run lower '}
                <span className="tabnum" style={{color: energyColor(dowInsight.worstAvg)}}>({'avg ' + dowInsight.worstAvg.toFixed(1) + '/5'})</span>.
              </div>
            </div>
          )}
          {bestPeriod && worstPeriod && bestPeriod.label !== worstPeriod.label && (
            <div className="bg-panel2 rounded-xl p-3 space-y-2">
              <div className="text-xs text-faint font-medium">Time of day</div>
              <div className="flex gap-2">
                {periods.map(function(p){
                  return (
                    <div key={p.label} className="flex-1 text-center bg-panel rounded-lg py-2">
                      <div className="text-base" dangerouslySetInnerHTML={{__html:p.icon}}></div>
                      <div className="text-[10px] text-faint">{p.label}</div>
                      <div className="text-sm tabnum font-semibold" style={{color:energyColor(p.avg)}}>{p.avg.toFixed(1)}</div>
                    </div>
                  );
                })}
              </div>
              <div className="text-xs text-faint">{'Peak: ' + bestPeriod.label + ' · Dip: ' + worstPeriod.label}</div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function BreathingHistory() {
  var _s = useStore(); var state = _s.state;
  var sessions = (state.anchor.breathingSessions || []);
  var [open, setOpen] = useState(false);
  if (sessions.length < 2) return null;
  var todayStr = todayKey();
  var totalSecs = sessions.reduce(function(s,b){ return s+(b.seconds||0); }, 0);
  var totalMins = Math.round(totalSecs/60);
  var typeCounts = {};
  sessions.forEach(function(b){ typeCounts[b.type]=(typeCounts[b.type]||0)+1; });
  var favType = Object.keys(typeCounts).sort(function(a,b){ return typeCounts[b]-typeCounts[a]; })[0];
  var favLabel = favType && BREATHING_PATTERNS[favType] ? BREATHING_PATTERNS[favType].name : favType;
  var days7 = Array.from({length:7}, function(_,i){
    var d = new Date(); d.setDate(d.getDate()-6+i);
    var ds = localDateStr(d);
    var count = sessions.filter(function(b){ return b.ts && dayOf(b.ts)===ds; }).length;
    return { ds: ds, count: count, isToday: ds===todayStr };
  });
  var streak = 0;
  for (var i = 0; i < 7; i++) {
    var sd = new Date(); sd.setDate(sd.getDate()-i);
    var sds = localDateStr(sd);
    if (sessions.some(function(b){ return b.ts && dayOf(b.ts)===sds; })) { streak++; } else { break; }
  }
  var d6ago = new Date(); d6ago.setDate(d6ago.getDate()-6);
  var d6str = localDateStr(d6ago);
  var week7 = sessions.filter(function(b){ return b.ts && dayOf(b.ts)>=d6str; }).length;
  var recent = sessions.slice(0,5);
  function fmtSecs(s){ var m=Math.floor(s/60); var sec=s%60; return m>0?(m+'m'+(sec>0?' '+sec+'s':'')):(s+'s'); }
  function fmtDate(ts){ var d=new Date(ts); return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between cursor-pointer" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span className="text-lg">💨</span>
          <span className="font-medium text-sm">Breathing history</span>
        </div>
        <div className="flex items-center gap-3">
          {streak > 0 && <span className="text-xs text-brand font-bold">{streak}-day streak</span>}
          <span className="text-faint text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </div>
      <div className="flex gap-2">
        {days7.map(function(d){
          var intensity = d.count===0?'bg-edge/20':d.count===1?'bg-calm/40':'bg-calm/80';
          return (
            <div key={d.ds} className="flex-1 flex flex-col items-center gap-1">
              <div className={'h-6 w-full rounded ' + intensity + (d.isToday?' ring-1 ring-calm/60':'')} title={d.count+' session(s)'}></div>
              <span className="text-[9px] text-faint">{new Date(d.ds+'T12:00:00').toLocaleDateString(undefined,{weekday:'narrow'})}</span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 text-xs text-faint">
        <span className="flex-1 text-center">{sessions.length} total</span>
        <span className="flex-1 text-center">{totalMins}m total</span>
        <span className="flex-1 text-center">{week7} this week</span>
        {favLabel && <span className="flex-1 text-center truncate">{favLabel}</span>}
      </div>
      {open && (
        <div className="space-y-1 border-t border-edge/30 pt-2">
          <div className="text-faint text-[10px] mb-1">Recent sessions</div>
          {recent.map(function(b,i){
            var label = BREATHING_PATTERNS[b.type] ? BREATHING_PATTERNS[b.type].name : (b.type||'');
            return (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-faint">{fmtDate(b.ts)}</span>
                <span className="text-paper">{label}</span>
                <span className="text-calm">{fmtSecs(b.seconds||0)}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

var COPING_CATEGORIES = [
  { key:'adhd', icon:'⚡', label:'ADHD focus', color:'brand', tips:[
    { title:'2-minute rule', body:'If it takes under 2 minutes, do it now. Kills the stack of small tasks that breeds avoidance.' },
    { title:'Body double', body:'Work alongside someone — even a YouTube study stream. Your brain performs when observed.' },
    { title:'Intention parking', body:'Write the next micro-task before you stop. Your future self picks it up without re-loading context.' },
    { title:'10-minute dare', body:'Promise yourself only 10 minutes. Starting IS the hardest part — you almost always continue.' },
  ]},
  { key:'mood', icon:'🌱', label:'Low mood', color:'grow', tips:[
    { title:'1 pleasant event', body:'Pick one small thing that usually gives even a flicker of good feeling. Schedule it for today, right now.' },
    { title:'Opposite action', body:'Mood says stay in. Do the opposite — go outside, call someone. The action comes first; the feeling follows.' },
    { title:'Behavioral activation', body:'Depression shrinks your world. Each small action (shower, cook, walk) is a vote against the shrink.' },
    { title:'Self-compassion pause', body:'Hand on heart. Say: "This is a moment of suffering. I am not alone in this."' },
  ]},
  { key:'anxiety', icon:'🌊', label:'Anxiety', color:'calm', tips:[
    { title:'5-4-3-2-1 grounding', body:'Name 5 things you see, 4 you touch, 3 you hear, 2 you smell, 1 you taste. Anchors you to now.' },
    { title:'STOP technique', body:'Stop. Take a breath. Observe what is happening in your body. Proceed with intention.' },
    { title:'Worry time', body:'Schedule 15 minutes of "allowed worrying" at 5pm. When worry hits earlier, write it down for then.' },
    { title:'Extend the out-breath', body:'Breathe in 4 counts, out 6-8. The long exhale activates your parasympathetic brake.' },
  ]},
  { key:'recovery', icon:'🛡️', label:'Recovery', color:'warm', tips:[
    { title:'HALT check', body:'Hungry? Angry? Lonely? Tired? Most urges are one of these in disguise. Address the real need.' },
    { title:'Urge surfing', body:'An urge peaks and passes in ~15 minutes. Ride it like a wave — observe it without fighting or obeying.' },
    { title:'Play the tape forward', body:'Don\'t replay the high. Play the full tape: what happens after, the next day, the shame, the reset.' },
    { title:'One phone call', body:'Call someone safe before you use, not after. The act of reaching out changes the outcome.' },
  ]},
  { key:'energy', icon:'🔋', label:'Energy lift', color:'rose', tips:[
    { title:'Cold water hit', body:'Splash cold water on your face or hold an ice cube. Activates the dive reflex, drops heart rate fast.' },
    { title:'Movement snack', body:'90 seconds of movement (jumping jacks, walk, stretch). Blood flow to the brain improves focus for 20+ min.' },
    { title:'Light exposure', body:'Step outside or face a bright light for 5 minutes. Resets your alertness clock.' },
    { title:'Power nap window', body:'10-20 min nap before 3pm. Under 20 min avoids sleep inertia. Set an alarm — it works.' },
  ]},
];

function CopingToolkit() {
  var [open, setOpen] = useState(false);
  var [cat, setCat] = useState(null);
  var [tip, setTip] = useState(null);
  var activeCat = cat ? COPING_CATEGORIES.find(function(c){ return c.key===cat; }) : null;
  var activeTip = activeCat && tip !== null ? activeCat.tips[tip] : null;
  var colorMap = { brand:'#6aa0ff', grow:'#3ddc97', calm:'#b08cff', warm:'#ffce6a', rose:'#ff9aa6' };
  return (
    <Card className="border-edge/30">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); setCat(null); setTip(null); }}>
        <div className="flex items-center gap-2">
          <span className="text-base">🧰</span>
          <span className="font-semibold text-sm">Coping toolkit</span>
        </div>
        <span className="text-faint text-xs">{open?'▲':'▼'}</span>
      </button>
      {open && !cat && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {COPING_CATEGORIES.map(function(c){
            return (
              <button key={c.key} onClick={function(){ setCat(c.key); setTip(null); }}
                className="text-left bg-panel2 rounded-xl px-3 py-3 hover:bg-panel2/80 active:scale-[.98] transition">
                <div className="text-2xl mb-1">{c.icon}</div>
                <div className="text-paper text-sm font-semibold">{c.label}</div>
                <div className="text-faint text-[10px]">{c.tips.length} techniques</div>
              </button>
            );
          })}
        </div>
      )}
      {open && activeCat && tip === null && (
        <div className="mt-3 space-y-2">
          <button onClick={function(){ setCat(null); }} className="text-faint text-xs hover:text-paper">‹ back</button>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">{activeCat.icon}</span>
            <span className="font-semibold">{activeCat.label}</span>
          </div>
          <div className="space-y-2">
            {activeCat.tips.map(function(t, i){
              return (
                <button key={i} onClick={function(){ setTip(i); }}
                  className="w-full text-left bg-panel2 rounded-xl px-3 py-2.5 hover:bg-panel2/80 flex items-center justify-between">
                  <span className="text-sm text-paper">{t.title}</span>
                  <span className="text-faint text-xs">›</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {open && activeTip && (
        <div className="mt-3 space-y-3">
          <button onClick={function(){ setTip(null); }} className="text-faint text-xs hover:text-paper">‹ back</button>
          <div className="bg-panel2 rounded-2xl p-4 space-y-3">
            <div className="font-semibold text-paper" style={{color: colorMap[activeCat.color]}}>{activeTip.title}</div>
            <p className="text-sm text-paper/90 leading-relaxed">{activeTip.body}</p>
          </div>
          <div className="flex gap-2">
            {tip > 0 && <button onClick={function(){ setTip(tip-1); }} className="text-faint text-xs hover:text-paper">‹ prev</button>}
            {tip < activeCat.tips.length-1 && <button onClick={function(){ setTip(tip+1); }} className="ml-auto text-faint text-xs hover:text-paper">next ›</button>}
          </div>
        </div>
      )}
    </Card>
  );
}

function FocusTimer() {
  var store = useStore();
  var dispatch = store.dispatch;
  var state = store.state;
  var _m = useState(null); var mode = _m[0]; var setMode = _m[1];
  var _r = useState(0); var remaining = _r[0]; var setRemaining = _r[1];
  var _c = useState(0); var cycles = _c[0]; var setCycles = _c[1];
  var _tk = useState(''); var task = _tk[0]; var setTask = _tk[1];
  var WORK = 25 * 60;
  var BREAK = 5 * 60;
  var rafRef = useRef(null);
  var startRef = useRef(null);
  var durRef = useRef(0);
  var taskRef = useRef('');

  useEffect(function() {
    if (!mode) return;
    startRef.current = Date.now();
    durRef.current = mode === 'work' ? WORK : BREAK;
    setRemaining(durRef.current);
    function tick() {
      var elapsed = (Date.now() - startRef.current) / 1000;
      var left = Math.max(0, durRef.current - elapsed);
      setRemaining(Math.ceil(left));
      if (left <= 0) {
        if (mode === 'work') {
          dispatch({ type: 'FOCUS_LOG', minutes: 25, completed: true, task: taskRef.current });
          setCycles(function(c){ return c + 1; });
          chime(660, 0.3);
          buzz(40);
          setMode('break');
        } else {
          chime(440, 0.2);
          setMode(null);
        }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return function(){ if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [mode]);

  var todayStr = todayKey();
  var todaySessions = (state.anchor.focusSessions||[]).filter(function(f){ return dayOf(f.ts) === todayStr && f.completed; });
  var totalMin = todaySessions.reduce(function(s,f){ return s + f.minutes; }, 0);

  var allSessions = state.anchor.focusSessions || [];
  var completedTotal = allSessions.filter(function(f){ return f.completed; }).length;
  var totalMinAll = allSessions.filter(function(f){ return f.completed; }).reduce(function(s,f){ return s + (f.minutes||25); }, 0);
  var recentSessions = allSessions.slice(0, 8);

  var relDay = function(ts) {
    var d = ts.slice(0,10);
    var t = todayStr;
    var yest = localDateStr(new Date(Date.now() - 86400000));
    if (d === t) return 'Today';
    if (d === yest) return 'Yesterday';
    return d.slice(5).replace('-', '/');
  };

  if (!mode) {
    return (
      <Card className="border-edge/30">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎯</span>
            <span className="font-semibold">Focus</span>
          </div>
          {totalMin > 0 && <span className="text-faint text-sm tabnum">{totalMin} min today</span>}
        </div>
        <input value={task} onChange={function(e){ setTask(e.target.value); taskRef.current = e.target.value; }}
          placeholder="What are you focusing on? (optional)"
          className="w-full bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-sm placeholder-faint/50 outline-none focus:border-brand mb-2" />
        <button onClick={function(){ setMode('work'); setCycles(0); buzz(20); }}
          className="w-full bg-brand/15 hover:bg-brand/25 border border-brand/30 rounded-xl py-3 text-brand font-semibold transition">
          Start 25-min focus
        </button>
        {cycles > 0 && <div className="text-center text-faint text-sm mt-2">{cycles} cycle{cycles > 1 ? 's' : ''} completed</div>}
        {completedTotal > 0 && (
          <div className="mt-3 pt-3 border-t border-edge/20">
            <div className="flex items-center justify-between text-xs text-faint mb-2">
              <span>Recent sessions</span>
              <span>{completedTotal} total · {totalMinAll} min</span>
            </div>
            <div className="space-y-1">
              {recentSessions.map(function(s, i){
                return (
                  <div key={i} className="space-y-0.5">
                    <div className="flex items-center gap-2 text-xs">
                      <span className={'w-1.5 h-1.5 rounded-full flex-shrink-0 ' + (s.completed ? 'bg-brand' : 'bg-edge')} />
                      <span className="text-faint">{relDay(s.ts)}</span>
                      <span className="flex-1 text-right text-paper/60 tabnum">{s.minutes || 25} min</span>
                      {!s.completed && <span className="text-faint/50 text-[10px]">partial</span>}
                    </div>
                    {s.task && <div className="pl-4 text-[11px] text-faint/70 truncate">{s.task}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    );
  }

  var total = mode === 'work' ? WORK : BREAK;
  var pct = ((total - remaining) / total) * 100;
  var mins = Math.floor(remaining / 60);
  var secs = remaining % 60;
  return (
    <Card className={'border-edge/30 ' + (mode === 'break' ? 'bg-grow/5' : '')}>
      <div className="text-center">
        <div className="text-faint text-sm mb-1">{mode === 'work' ? 'Focus time' : 'Break time'}</div>
        {mode === 'work' && task && <div className="text-paper/70 text-xs mb-2 italic truncate px-4">{task}</div>}
        <div className="relative w-24 h-24 mx-auto mb-3">
          {React.createElement(Ring, { pct: pct, size: 96, stroke: 6, color: mode === 'work' ? '#6aa0ff' : '#3ddc97' })}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-bold tabnum text-paper">{mins + ':' + String(secs).padStart(2,'0')}</span>
          </div>
        </div>
        <button onClick={function(){
          if (mode === 'work') dispatch({ type: 'FOCUS_LOG', minutes: Math.round((WORK - remaining)/60), completed: false });
          setMode(null);
        }} className="text-faint text-sm hover:text-rose transition">End {mode === 'work' ? 'early' : 'break'}</button>
      </div>
    </Card>
  );
}

function FocusAnalytics() {
  var _s = useStore(); var state = _s.state;
  var sessions = (state.anchor.focusSessions || []);
  var completed = sessions.filter(function(f){ return f.completed; });
  if (completed.length < 3) return null;
  var todayStr = todayKey();
  var streak = 0;
  for (var i = 0; i < 30; i++) {
    var d = new Date(); d.setDate(d.getDate()-i);
    var ds = localDateStr(d);
    if (completed.some(function(f){ return f.ts && dayOf(f.ts)===ds; })) { streak++; } else { break; }
  }
  var totalMins = completed.reduce(function(s,f){ return s+(f.minutes||25); },0);
  var compRate = Math.round((completed.length/sessions.length)*100);
  var hourCounts = {};
  completed.forEach(function(f){
    var h = new Date(f.ts).getHours();
    var period = h<12?'Morning':h<17?'Afternoon':'Evening';
    hourCounts[period] = (hourCounts[period]||0)+1;
  });
  var bestPeriod = Object.keys(hourCounts).sort(function(a,b){ return hourCounts[b]-hourCounts[a]; })[0];
  var days7ago = new Date(); days7ago.setDate(days7ago.getDate()-6);
  var days7str = localDateStr(days7ago);
  var week7 = completed.filter(function(f){ return f.ts && dayOf(f.ts)>=days7str; });
  var weekMins = week7.reduce(function(s,f){ return s+(f.minutes||25); },0);
  var days14 = Array.from({length:14}, function(_,i){
    var d2 = new Date(); d2.setDate(d2.getDate()-13+i);
    var ds2 = localDateStr(d2);
    var count = completed.filter(function(f){ return f.ts && dayOf(f.ts)===ds2; }).length;
    return { ds: ds2, count: count, isToday: ds2===todayStr };
  });
  var maxCount = Math.max.apply(null, days14.map(function(d2){ return d2.count; })) || 1;
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🎯</span>
          <span className="text-sm font-medium">Focus analytics</span>
        </div>
        {streak > 0 && <span className="text-xs text-brand font-bold">{streak}-day streak</span>}
      </div>
      <div className="flex gap-1 items-end h-10">
        {days14.map(function(d2){
          var h = Math.max(4, Math.round((d2.count/maxCount)*40));
          return (
            <div key={d2.ds} className="flex-1 flex flex-col items-center justify-end gap-0.5">
              <div style={{height:h+'px'}} className={'w-full rounded-sm ' + (d2.count>0?'bg-brand/70':'bg-edge/20') + (d2.isToday?' ring-1 ring-brand/60':'')}></div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-4 gap-1 text-center text-xs">
        <div><div className="text-brand font-bold">{completed.length}</div><div className="text-faint">sessions</div></div>
        <div><div className="text-brand font-bold">{Math.round(totalMins/60*10)/10}h</div><div className="text-faint">total</div></div>
        <div><div className="text-brand font-bold">{weekMins}m</div><div className="text-faint">this week</div></div>
        <div><div className="text-brand font-bold">{compRate}%</div><div className="text-faint">completed</div></div>
      </div>
      {bestPeriod && (
        <div className="text-xs text-faint border-t border-edge/20 pt-2">
          🕐 Your peak focus time: <span className="text-paper">{bestPeriod}</span>
          {Object.keys(hourCounts).length > 1 && (
            <span> ({Object.entries(hourCounts).map(function(e){ return e[0]+' '+e[1]+'x'; }).join(', ')})</span>
          )}
        </div>
      )}
    </Card>
  );
}

function LifetimeStats() {
  var store = useStore();
  var state = store.state;
  var a = state.anchor;
  var _e = useState(false); var exp = _e[0]; var setExp = _e[1];

  var totalWater = (a.waterLog||[]).reduce(function(s, w){ return s + (w.count||0); }, 0);
  var focusDone = (a.focusSessions||[]).filter(function(f){ return f.completed; });
  var focusMins = focusDone.reduce(function(s, f){ return s + (f.minutes||25); }, 0);

  var allDates = new Set();
  var addDates = function(arr, key) { (arr||[]).forEach(function(x){ if(x.ts || x[key]) allDates.add((x.ts||x[key]||'').slice(0,10)); }); };
  addDates(a.moodLog); addDates(a.breathingSessions); addDates(a.gratitude);
  addDates(a.journal); addDates(a.sleep); addDates(a.waterLog);
  addDates(a.meditationLog); addDates(a.energyLog); addDates(a.focusSessions);
  addDates(a.habitLog); addDates(state.flow.history);
  allDates.delete('');
  var daysActive = allDates.size;

  var allDateArr = Array.from(allDates).sort();
  var firstDate = allDateArr[0];
  var daysSinceStart = firstDate ? Math.floor((Date.now() - new Date(firstDate)) / 86400000) + 1 : 0;

  var stats = [
    { icon: '😊', label: 'Check-ins', val: (a.moodLog||[]).length },
    { icon: '📝', label: 'Journal entries', val: (a.journal||[]).length },
    { icon: '🌻', label: 'Gratitude', val: (a.gratitude||[]).length },
    { icon: '🌬️', label: 'Breathing sessions', val: (a.breathingSessions||[]).length },
    { icon: '🧘', label: 'Meditations', val: (a.meditationLog||[]).length },
    { icon: '🎯', label: 'Focus sessions', val: focusDone.length },
    { icon: '⏱️', label: 'Focus minutes', val: focusMins },
    { icon: '😴', label: 'Sleep logs', val: (a.sleep||[]).length },
    { icon: '💧', label: 'Glasses of water', val: totalWater },
    { icon: '🔋', label: 'Energy logs', val: (a.energyLog||[]).length },
    { icon: '✅', label: 'Habit completions', val: (a.habitLog||[]).length },
    { icon: '💊', label: 'Meds taken', val: (a.medLog||[]).length },
  ];

  return (
    <Card className="border-edge/30">
      <div className="flex items-center justify-between cursor-pointer" onClick={function(){ setExp(!exp); }}>
        <div className="flex items-center gap-2">
          <span className="text-lg">📊</span>
          <span className="font-semibold text-sm">Lifetime stats</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-faint">{daysActive} active days</span>
          <span className="text-faint text-xs">{exp ? '▾' : '▸'}</span>
        </div>
      </div>
      {exp && (
        <div className="mt-3">
          {daysSinceStart > 0 && (
            <div className="text-xs text-faint mb-3">Since {firstDate} · {daysSinceStart} days on Anchor</div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {stats.map(function(s){
              return (
                <div key={s.label} className="flex items-center gap-2 bg-panel2 rounded-lg p-2">
                  <span className="text-base">{s.icon}</span>
                  <div>
                    <div className="text-sm font-bold tabnum">{s.val}</div>
                    <div className="text-xs text-faint">{s.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function WeeklyReview() {
  var store = useStore();
  var state = store.state;
  var _e = useState(false); var expanded = _e[0]; var setExpanded = _e[1];
  var now = new Date();
  var dayOfWeek = now.getDay();
  var weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  var weekDates = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    weekDates.push(localDateStr(d));
  }
  var inWeek = function(ts) { var ds = ts.slice(0,10); return weekDates.indexOf(ds) >= 0; };
  var moods = state.anchor.moodLog.filter(function(m){ return inWeek(m.ts); });
  var journals = (state.anchor.journal||[]).filter(function(j){ return inWeek(j.ts); });
  var sleeps = (state.anchor.sleep||[]).filter(function(s){ return inWeek(s.ts); });
  var waters = (state.anchor.waterLog||[]).filter(function(w){ return weekDates.indexOf(w.date) >= 0; });
  var meditations = (state.anchor.meditationLog||[]).filter(function(m){ return inWeek(m.ts) && m.completed; });
  var focuses = (state.anchor.focusSessions||[]).filter(function(f){ return inWeek(f.ts) && f.completed; });
  var energies = (state.anchor.energyLog||[]).filter(function(e){ return inWeek(e.ts); });
  var gratitudes = (state.anchor.gratitude||[]).filter(function(g){ return inWeek(g.ts); });
  var avgMood = moods.length > 0 ? (moods.reduce(function(s,m){ return s + m.value; }, 0) / moods.length).toFixed(1) : null;
  var avgSleep = sleeps.length > 0 ? (sleeps.reduce(function(s,e){ return s + e.hours; }, 0) / sleeps.length).toFixed(1) : null;
  var totalWater = waters.reduce(function(s,w){ return s + (w.glasses||1); }, 0);
  var focusMin = focuses.reduce(function(s,f){ return s + f.minutes; }, 0);
  var activeDays = new Set();
  moods.forEach(function(m){ activeDays.add(dayOf(m.ts)); });
  journals.forEach(function(j){ activeDays.add(dayOf(j.ts)); });
  sleeps.forEach(function(s){ activeDays.add(dayOf(s.ts)); });
  var stats = [
    { icon: '🧭', label: 'Check-ins', val: moods.length },
    { icon: '😴', label: 'Avg sleep', val: avgSleep ? avgSleep + 'h' : '-' },
    { icon: '📝', label: 'Journals', val: journals.length },
    { icon: '💧', label: 'Water', val: totalWater + ' glasses' },
    { icon: '🧘', label: 'Meditations', val: meditations.length },
    { icon: '🎯', label: 'Focus', val: focusMin > 0 ? focusMin + ' min' : '0' },
    { icon: '🔋', label: 'Energy logs', val: energies.length },
    { icon: '🌻', label: 'Gratitude', val: gratitudes.length }
  ];
  return (
    <Card className="border-edge/30 cursor-pointer" onClick={function(){ setExpanded(!expanded); }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{'📋'}</span>
          <span className="font-semibold">Weekly review</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-brand font-bold tabnum">{activeDays.size}</span>
          <span className="text-faint text-sm">active days</span>
          <span className="text-faint text-sm">{expanded ? '▾' : '▸'}</span>
        </div>
      </div>
      {expanded && React.createElement('div', { className: 'mt-3 grid grid-cols-2 gap-2' },
        stats.map(function(s) {
          return React.createElement('div', { key: s.label, className: 'flex items-center gap-2 bg-panel2/60 rounded-lg px-3 py-2' },
            React.createElement('span', null, s.icon),
            React.createElement('div', null,
              React.createElement('div', { className: 'text-paper text-sm font-medium tabnum' }, s.val),
              React.createElement('div', { className: 'text-faint text-[10px]' }, s.label)
            )
          );
        }),
        avgMood && React.createElement('div', { className: 'col-span-2 text-center text-faint text-sm mt-1' },
          'Avg mood: ' + avgMood + '/5 · ' + activeDays.size + '/7 days active'
        )
      )}
    </Card>
  );
}

function StreakCalendar() {
  var store = useStore();
  var state = store.state;
  var _e = useState(false); var expanded = _e[0]; var setExpanded = _e[1];
  var _v = useState('activity'); var viewMode = _v[0]; var setViewMode = _v[1];
  var allDates = new Set();
  state.anchor.moodLog.forEach(function(m){ allDates.add(dayOf(m.ts)); });
  state.flow.history.forEach(function(h){ allDates.add(dayOf(h.ts)); });
  state.copilot.history.forEach(function(h){ allDates.add(dayOf(h.ts)); });
  (state.anchor.gratitude||[]).forEach(function(g){ allDates.add(dayOf(g.ts)); });
  (state.anchor.journal||[]).forEach(function(j){ allDates.add(dayOf(j.ts)); });
  (state.anchor.sleep||[]).forEach(function(s){ allDates.add(dayOf(s.ts)); });
  (state.anchor.breathingSessions||[]).forEach(function(b){ allDates.add(dayOf(b.ts)); });
  (state.anchor.waterLog||[]).forEach(function(w){ allDates.add(w.date); });
  (state.anchor.meditationLog||[]).forEach(function(m){ allDates.add(dayOf(m.ts)); });
  (state.anchor.energyLog||[]).forEach(function(e){ allDates.add(dayOf(e.ts)); });
  (state.anchor.focusSessions||[]).forEach(function(f){ allDates.add(dayOf(f.ts)); });
  if (allDates.size < 1) return null;

  // Build mood-by-day index
  var moodVal = { great:5, good:4, ok:3, low:2, anxious:1 };
  var moodColor = { great:'#4ade80', good:'#6aa0ff', ok:'#a78bfa', low:'#facc15', anxious:'#f87171' };
  var moodEmoji = { great:'😄', good:'🙂', ok:'😐', low:'😔', anxious:'😰' };
  var moodByDay = {};
  (state.anchor.moodLog||[]).forEach(function(m){
    var d = dayOf(m.ts);
    if (!moodByDay[d] || (moodVal[m.mood]||3) < (moodVal[moodByDay[d].mood]||3)) {
      moodByDay[d] = m; // store lowest mood of day (most needs-attention)
    }
  });

  var now = new Date();
  var year = now.getFullYear();
  var month = now.getMonth();
  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month];
  var todayStr = localDateStr(now);
  var cells = [];
  for (var i = 0; i < firstDay; i++) cells.push(null);
  for (var d = 1; d <= daysInMonth; d++) {
    var ds = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    cells.push({ day: d, ds: ds, active: allDates.has(ds), today: ds === todayStr, moodEntry: moodByDay[ds] || null });
  }
  var activeDays = cells.filter(function(c){ return c && c.active; }).length;
  var hasMoods = Object.keys(moodByDay).length > 0;

  return (
    <Card className="border-edge/30">
      <div className="flex items-center justify-between cursor-pointer" onClick={function(){ setExpanded(!expanded); }}>
        <div className="flex items-center gap-2">
          <span className="text-xl">📅</span>
          <span className="font-semibold">Activity · {monthName}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-brand font-bold tabnum">{activeDays}</span>
          <span className="text-faint text-sm">days</span>
          <span className="text-faint text-sm">{expanded ? '▾' : '▸'}</span>
        </div>
      </div>
      {expanded && (
        <div className="mt-3">
          {hasMoods && (
            <div className="flex gap-1 mb-3">
              {['activity','mood'].map(function(v){
                return (
                  <button key={v} onClick={function(e){ e.stopPropagation(); setViewMode(v); }}
                    className={'flex-1 py-1 rounded-lg text-xs transition ' + (viewMode===v ? 'bg-panel2 text-paper font-medium' : 'text-faint hover:text-paper')}>
                    {v === 'activity' ? '✅ Activity' : '🎨 Mood'}
                  </button>
                );
              })}
            </div>
          )}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-faint mb-1">
            {['Su','Mo','Tu','We','Th','Fr','Sa'].map(function(d){ return <div key={d}>{d}</div>; })}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map(function(c, i) {
              if (!c) return <div key={'e'+i} />;
              if (viewMode === 'mood' && hasMoods) {
                var bg = c.moodEntry ? moodColor[c.moodEntry.mood] + '55' : (c.active ? '#ffffff18' : 'transparent');
                var border = c.today ? '2px solid #6aa0ff' : 'none';
                var emoji = c.moodEntry ? moodEmoji[c.moodEntry.mood] : '';
                return (
                  <div key={c.day} title={c.ds + (c.moodEntry ? ' · ' + c.moodEntry.mood : '')}
                    className="w-full aspect-square rounded-md flex flex-col items-center justify-center text-[10px]"
                    style={{ background: bg, border: border, opacity: c.ds > todayStr ? 0 : 1 }}>
                    {emoji ? <span style={{fontSize:'11px'}}>{emoji}</span> : <span className="text-faint/30 text-[9px]">{c.day}</span>}
                  </div>
                );
              }
              var cls = 'w-full aspect-square rounded-md flex items-center justify-center text-[11px] tabnum ';
              if (c.today) cls += c.active ? 'bg-brand text-ink font-bold ring-2 ring-brand/50' : 'bg-panel2 text-paper ring-2 ring-brand/30';
              else if (c.active) cls += 'bg-grow/25 text-grow';
              else cls += 'bg-panel2/50 text-faint/40';
              return <div key={c.day} className={cls}>{c.day}</div>;
            })}
          </div>
          {viewMode === 'mood' && hasMoods && (
            <div className="flex flex-wrap gap-2 mt-2 text-[10px] text-faint">
              {Object.entries(moodColor).map(function(pair){
                return (
                  <span key={pair[0]} className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full inline-block" style={{background:pair[0]}} />
                    {pair[0]}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function CBTInsights() {
  var store = useStore(); var state = store.state;
  var records = state.anchor.thoughtRecords || [];
  var withDist = records.filter(function(r){ return r.distortions && r.distortions.length > 0; });
  if (withDist.length < 2) return null;
  var counts = {};
  withDist.forEach(function(r){
    r.distortions.forEach(function(d){ counts[d] = (counts[d]||0) + 1; });
  });
  var sorted = Object.keys(counts).sort(function(a,b){ return counts[b]-counts[a]; }).slice(0,6);
  var max = counts[sorted[0]] || 1;
  var avgIntensity = records.filter(function(r){ return r.intensity; }).reduce(function(s,r,_,a){ return s + r.intensity/a.length; }, 0);
  return (
    <div className="rounded-xl border border-edge/20 bg-panel p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-base">🧠</span>
        <span className="text-xs font-semibold text-paper">Thought patterns</span>
        <span className="ml-auto text-[10px] text-faint">{withDist.length} labelled records</span>
      </div>
      <div className="space-y-1.5">
        {sorted.map(function(d){
          var pct = Math.round((counts[d]/max)*100);
          return React.createElement('div', { key:d, className:'flex items-center gap-2' },
            React.createElement('div', { className:'text-[11px] text-faint w-32 flex-shrink-0 truncate' }, d),
            React.createElement('div', { className:'flex-1 h-2 bg-panel2 rounded-full overflow-hidden' },
              React.createElement('div', { className:'h-full bg-brand/60 rounded-full', style:{ width:pct+'%' } })
            ),
            React.createElement('span', { className:'text-[10px] text-faint tabnum w-4 text-right' }, counts[d])
          );
        })}
      </div>
      {avgIntensity > 0 && React.createElement('div', { className:'text-[10px] text-faint pt-1 border-t border-edge/20' },
        'Avg emotional intensity: ' + avgIntensity.toFixed(1) + '/10 across ' + records.length + ' records'
      )}
    </div>
  );
}

function CBTJournal() {
  var store = useStore();
  var state = store.state;
  var dispatch = store.dispatch;
  var _open = useState(false); var open = _open[0]; var setOpen = _open[1];
  var _form = useState({ situation:'', emotion:'', intensity:5, thought:'', evidFor:'', evidAgainst:'', balanced:'', distortions:[] });
  var form = _form[0]; var setForm = _form[1];
  var _hist = useState(false); var showHist = _hist[0]; var setShowHist = _hist[1];
  var records = state.anchor.thoughtRecords || [];

  var STEPS = ['Situation','Emotion','Hot thought','Evidence FOR','Evidence AGAINST','Balanced view','Distortions?'];
  var KEYS  = ['situation','emotion','thought','evidFor','evidAgainst','balanced','distortions'];
  var _step = useState(0); var step = _step[0]; var setStep = _step[1];
  var CBT_DISTORTIONS = [
    'All-or-nothing','Overgeneralizing','Mental filter','Discounting positives',
    'Mind reading','Fortune telling','Catastrophizing','Emotional reasoning',
    'Should statements','Labeling','Personalization','Blaming others',
  ];

  var next = function() {
    if (step < STEPS.length - 1) { setStep(step + 1); }
    else {
      dispatch({ type: 'ADD_THOUGHT_RECORD', record: { ...form } });
      setForm({ situation:'', emotion:'', intensity:5, thought:'', evidFor:'', evidAgainst:'', balanced:'', distortions:[] });
      setStep(0);
      setOpen(false);
      buzz(20);
    }
  };
  var key = KEYS[step];
  var placeholder = ['Briefly describe what happened','What emotion(s) did you feel? (e.g. anxious, sad)','The automatic thought that went through your mind','Facts that support this thought','Facts that challenge this thought','A more balanced, realistic perspective',''][step];

  return (
    <Card className="border-edge/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧠</span>
          <span className="font-semibold text-sm">Thought record</span>
          <span className="text-xs text-faint">CBT</span>
        </div>
        <div className="flex items-center gap-2">
          {records.length > 0 && <button className="text-xs text-faint hover:text-label" onClick={function(){ setShowHist(!showHist); }}>{records.length} records</button>}
          <button className="text-xs bg-brand/20 hover:bg-brand/30 text-brand px-2 py-1 rounded-lg" onClick={function(){ setOpen(!open); setShowHist(false); }}>
            {open ? 'cancel' : '+ new'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3">
          <div className="flex gap-1 mb-3">
            {STEPS.map(function(s, i){
              return <div key={i} className={'h-1 flex-1 rounded-full ' + (i <= step ? 'bg-brand' : 'bg-panel2')} />;
            })}
          </div>
          <div className="text-xs text-faint mb-1">Step {step+1} of {STEPS.length} — {STEPS[step]}</div>
          {step === 6 ? (
            <div className="space-y-2 mb-2">
              <div className="text-xs text-faint mb-1">Select any that apply (optional — tap to toggle):</div>
              <div className="flex flex-wrap gap-1.5">
                {CBT_DISTORTIONS.map(function(d){
                  var sel = (form.distortions||[]).indexOf(d) >= 0;
                  return React.createElement('button', {
                    key: d,
                    onClick: function(){
                      var cur = form.distortions || [];
                      var next = sel ? cur.filter(function(x){ return x !== d; }) : [...cur, d];
                      setForm(Object.assign({}, form, { distortions: next }));
                    },
                    className: 'text-[11px] px-2 py-1 rounded-full border transition ' +
                      (sel ? 'bg-brand/20 border-brand/40 text-brand' : 'border-edge/40 text-faint hover:border-brand/30')
                  }, d);
                })}
              </div>
            </div>
          ) : step === 1 ? (
            <div>
              <textarea className="w-full bg-panel2 rounded-lg p-2 text-sm resize-none border border-edge/40 focus:border-brand/60 outline-none mb-2" rows={2} placeholder={placeholder} value={form[key]} onChange={function(e){ setForm(Object.assign({}, form, { [key]: e.target.value })); }} autoFocus />
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-faint">Intensity</span>
                <input type="range" min={1} max={10} value={form.intensity} onChange={function(e){ setForm(Object.assign({}, form, { intensity: +e.target.value })); }} className="flex-1" />
                <span className="text-sm font-bold tabnum w-5">{form.intensity}</span>
              </div>
            </div>
          ) : (
            <textarea className="w-full bg-panel2 rounded-lg p-2 text-sm resize-none border border-edge/40 focus:border-brand/60 outline-none mb-2" rows={3} placeholder={placeholder} value={form[key]} onChange={function(e){ setForm(Object.assign({}, form, { [key]: e.target.value })); }} autoFocus />
          )}
          <div className="flex gap-2">
            {step > 0 && <button className="px-3 py-1 text-sm text-faint hover:text-label" onClick={function(){ setStep(step-1); }}>← back</button>}
            <button className={'flex-1 py-1 text-sm rounded-lg bg-brand/20 hover:bg-brand/30 text-brand'} onClick={function(){ if(form[key] || step === 1 || step === 6) next(); }}>
              {step < STEPS.length - 1 ? 'next →' : 'save record ✓'}
            </button>
          </div>
        </div>
      )}

      {showHist && !open && (
        <div className="mt-3 flex flex-col gap-2 max-h-64 overflow-y-auto">
          {records.slice(0,10).map(function(r){
            return (
              <div key={r.id} className="bg-panel2 rounded-lg p-2 text-xs">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-faint">{r.ts ? dayOf(r.ts) : ''}</span>
                  <button className="text-faint hover:text-rose-400" onClick={function(){ dispatch({ type:'REMOVE_THOUGHT_RECORD', id: r.id }); }}>✕</button>
                </div>
                <div className="text-label mb-1"><span className="text-faint">Situation: </span>{r.situation}</div>
                {r.balanced && <div className="text-grow"><span className="text-faint">Balanced: </span>{r.balanced}</div>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function HabitStreakVisualizer() {
  var store = useStore();
  var habits = (store.state.anchor.habits || []);
  var habitLog = (store.state.anchor.habitLog || []);
  var _selected = useState(habits.length > 0 ? habits[0].id : null); var selected = _selected[0]; var setSelected = _selected[1];

  var selectedHabit = habits.find(function(h) { return h.id === selected; });
  if (!selectedHabit) return null;

  var logs = habitLog.filter(function(l) { return l.habitId === selected; });
  var last30Dates = [];
  for (var i = 29; i >= 0; i--) {
    var d = new Date();
    d.setDate(d.getDate() - i);
    var dateStr = localDateStr(d);
    var logged = logs.some(function(l) { return dayOf(l.ts) === dateStr; });
    last30Dates.push({ date: dateStr, done: logged });
  }

  var currentStreak = 0;
  for (var i = 0; i < last30Dates.length; i++) {
    if (last30Dates[last30Dates.length - 1 - i].done) {
      currentStreak++;
    } else {
      break;
    }
  }

  return React.createElement(Card, { title: '📊 Habit Streaks', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-2' },
      React.createElement('select', {
        value: selected || '',
        onChange: function(e) { setSelected(e.target.value); },
        className: 'w-full bg-gray-700 rounded px-2 py-1 text-sm text-white'
      },
        habits.map(function(h) {
          return React.createElement('option', { key: h.id, value: h.id }, h.label);
        })),
      selectedHabit
        ? React.createElement('div', { className: 'space-y-2' },
            React.createElement('div', { className: 'flex gap-4' },
              React.createElement('div', { className: 'text-center' },
                React.createElement('div', { className: 'text-2xl font-bold text-green-400' }, currentStreak),
                React.createElement('div', { className: 'text-xs text-gray-500' }, 'day streak')),
              React.createElement('div', { className: 'text-center' },
                React.createElement('div', { className: 'text-2xl font-bold text-indigo-400' }, logs.length),
                React.createElement('div', { className: 'text-xs text-gray-500' }, 'completed'))),
            React.createElement('div', { className: 'grid grid-cols-10 gap-1' },
              last30Dates.map(function(day, i) {
                return React.createElement('div', {
                  key: i,
                  title: day.date,
                  className: 'w-4 h-4 rounded text-xs flex items-center justify-center ' + (day.done ? 'bg-green-500 text-white' : 'bg-gray-700')
                }, day.done ? '✓' : '');
              })),
            React.createElement('div', { className: 'text-xs text-gray-600 text-center' }, 'Last 30 days'))
        : null
    )
  );
}

function GoalTracker() {
  var store = useStore();
  var goals = (store.state.anchor.goals || []);
  var _title = useState(''); var title = _title[0]; var setTitle = _title[1];
  var _target = useState(30); var target = _target[0]; var setTarget = _target[1];
  var _unit = useState('days'); var unit = _unit[0]; var setUnit = _unit[1];
  var _showForm = useState(false); var showForm = _showForm[0]; var setShowForm = _showForm[1];

  function addGoal() {
    if (!title.trim()) return;
    store.dispatch({ type: 'ADD_GOAL', title: title.trim(), target: target, unit: unit });
    setTitle('');
    setTarget(30);
    setUnit('days');
    setShowForm(false);
    chime(880, 0.15);
  }

  function updateProgress(id, val) {
    store.dispatch({ type: 'UPDATE_GOAL_PROGRESS', id: id, value: val });
  }

  function deleteGoal(id) {
    store.dispatch({ type: 'DELETE_GOAL', id: id });
  }

  return React.createElement(Card, { title: '🎯 Goals', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-2' },
      React.createElement('button', {
        onClick: function() { setShowForm(!showForm); },
        className: 'w-full text-xs text-indigo-400 hover:text-indigo-300 underline'
      }, showForm ? 'Hide' : '+ New goal'),
      showForm
        ? React.createElement('div', { className: 'space-y-1 bg-gray-800 rounded p-2' },
            React.createElement('input', {
              placeholder: 'Goal (e.g., "30 days sober")...',
              value: title,
              onChange: function(e) { setTitle(e.target.value); },
              maxLength: '50',
              className: 'w-full bg-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-500'
            }),
            React.createElement('div', { className: 'flex gap-1' },
              React.createElement('input', {
                type: 'number',
                min: '1',
                value: target.toString(),
                onChange: function(e) { setTarget(parseInt(e.target.value) || 1); },
                className: 'flex-1 bg-gray-700 rounded px-2 py-1 text-xs text-white'
              }),
              React.createElement('select', {
                value: unit,
                onChange: function(e) { setUnit(e.target.value); },
                className: 'bg-gray-700 rounded px-2 py-1 text-xs text-white'
              },
                React.createElement('option', { value: 'days' }, 'Days'),
                React.createElement('option', { value: 'weeks' }, 'Weeks'),
                React.createElement('option', { value: 'count' }, 'Count'))),
            React.createElement('button', {
              onClick: addGoal,
              disabled: !title.trim(),
              className: 'w-full py-1 rounded text-xs font-semibold ' + (title.trim() ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed')
            }, 'Create goal'))
        : null,
      goals.length > 0
        ? React.createElement('div', { className: 'space-y-2' },
            goals.map(function(goal) {
              var pct = Math.min(100, Math.round((goal.current / goal.target) * 100));
              var complete = goal.current >= goal.target;
              return React.createElement('div', { key: goal.id, className: 'space-y-1' },
                React.createElement('div', { className: 'flex items-center justify-between' },
                  React.createElement('div', { className: 'text-xs font-semibold text-indigo-300' }, goal.title),
                  React.createElement('button', {
                    onClick: function() { deleteGoal(goal.id); },
                    className: 'text-xs text-gray-600 hover:text-red-400'
                  }, '✕')),
                React.createElement('div', { className: 'flex items-center gap-2' },
                  React.createElement('input', {
                    type: 'range',
                    min: '0',
                    max: goal.target.toString(),
                    value: goal.current.toString(),
                    onChange: function(e) { updateProgress(goal.id, parseInt(e.target.value)); },
                    className: 'flex-1'
                  }),
                  React.createElement('span', { className: 'text-xs font-bold text-indigo-300 w-12 text-right' }, goal.current, '/', goal.target)),
                React.createElement('div', { className: 'h-1 bg-gray-700 rounded overflow-hidden' },
                  React.createElement('div', { className: 'h-1 ' + (complete ? 'bg-green-500' : 'bg-indigo-500'), style: { width: pct + '%', transition: 'width 0.3s' } })),
                complete
                  ? React.createElement('div', { className: 'text-xs text-green-400 font-semibold' }, '✓ Complete!')
                  : null);
            }))
        : null
    )
  );
}

function QuickStatsDashboard() {
  var store = useStore();
  var moods = (store.state.anchor.moodLog || []);
  var sobriety = store.state.recovery.sobriety || {};
  var wins = (store.state.anchor.quickWins || []).filter(function(w) { return dayOf(w.ts) === todayKey(); });
  var tasks = (store.state.anchor.tasks || []);
  var completedTasks = tasks.filter(function(t) { return t.completed; });

  var avgMood = moods.length > 0 ? Math.round(moods.slice(0, 7).reduce(function(a, m) { return a + m.mood; }, 0) / Math.min(7, moods.length)) : 0;
  var daysSober = Math.floor((new Date() - new Date(sobriety.startDate || todayISO())) / (1000 * 60 * 60 * 24));

  var stats = [
    { label: 'Sober', value: daysSober, color: '#10b981', icon: '🌙' },
    { label: 'Mood', value: avgMood + '/10', color: '#3b82f6', icon: '😊' },
    { label: 'Wins', value: wins.length, color: '#f59e0b', icon: '🎯' },
    { label: 'Tasks', value: completedTasks.length + '/' + tasks.length, color: '#8b5cf6', icon: '✓' }
  ];

  return React.createElement('div', { className: 'grid grid-cols-4 gap-2 mb-3' },
    stats.map(function(stat) {
      return React.createElement('div', { key: stat.label, className: 'bg-gray-800 rounded p-2 text-center' },
        React.createElement('div', { className: 'text-sm', dangerouslySetInnerHTML: { __html: stat.icon } }),
        React.createElement('div', { className: 'text-lg font-bold mt-1', style: { color: stat.color } }, stat.value),
        React.createElement('div', { className: 'text-xs text-gray-500' }, stat.label));
    })
  );
}

function TaskManager() {
  var store = useStore();
  var tasks = (store.state.anchor.tasks || []);
  var today = todayKey();
  var _input = useState(''); var input = _input[0]; var setInput = _input[1];
  var _priority = useState('medium'); var priority = _priority[0]; var setPriority = _priority[1];
  var _dueOffset = useState(0); var dueOffset = _dueOffset[0]; var setDueOffset = _dueOffset[1];
  var _recurring = useState('none'); var recurring = _recurring[0]; var setRecurring = _recurring[1];
  var _showForm = useState(false); var showForm = _showForm[0]; var setShowForm = _showForm[1];

  function getDueDate(offset) {
    var d = new Date();
    d.setDate(d.getDate() + offset);
    return localDateStr(d);
  }

  function addTask() {
    if (!input.trim()) return;
    var dueDate = dueOffset === 0 ? null : getDueDate(dueOffset);
    store.dispatch({ type: 'ADD_TASK', text: input.trim(), priority: priority, due: dueDate, recurring: recurring });
    setInput('');
    setPriority('medium');
    setDueOffset(0);
    setRecurring('none');
    setShowForm(false);
    chime(880, 0.1);
  }

  function toggleTask(id) {
    store.dispatch({ type: 'COMPLETE_TASK', id: id });
    buzz(1);
  }

  function deleteTask(id) {
    store.dispatch({ type: 'DELETE_TASK', id: id });
  }

  var pending = tasks.filter(function(t) { return !t.completed; });
  var completed = tasks.filter(function(t) { return t.completed; });
  var highPriority = pending.filter(function(t) { return t.priority === 'high'; });

  var priorityColor = { high: '#dc2626', medium: '#f97316', low: '#84cc16' };

  return React.createElement(Card, { title: '✅ Tasks', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-2' },
      React.createElement('div', { className: 'flex items-center justify-between' },
        React.createElement('div', { className: 'text-xs text-gray-400' },
          pending.length, ' to do',
          highPriority.length > 0 ? ' • ' + highPriority.length + ' high priority' : ''),
        React.createElement('button', {
          onClick: function() { setShowForm(!showForm); },
          className: 'text-xs text-indigo-400 hover:text-indigo-300 underline'
        }, showForm ? 'Hide' : '+ Add')),
      showForm
        ? React.createElement('div', { className: 'space-y-1 bg-gray-800 rounded p-2' },
            React.createElement('input', {
              placeholder: 'Task description...',
              value: input,
              onChange: function(e) { setInput(e.target.value); },
              onKeyDown: function(e) { if (e.key === 'Enter') addTask(); },
              maxLength: '80',
              className: 'w-full bg-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-500'
            }),
            React.createElement('div', { className: 'flex gap-1' },
              ['low', 'medium', 'high'].map(function(p) {
                return React.createElement('button', {
                  key: p,
                  onClick: function() { setPriority(p); },
                  className: 'flex-1 px-2 py-0.5 rounded text-xs font-semibold transition-all ' + (priority === p ? 'ring-2 ring-white' : 'opacity-60'),
                  style: { backgroundColor: priorityColor[p], color: '#fff' }
                }, p);
              })),
            React.createElement('div', { className: 'grid grid-cols-2 gap-1' },
              React.createElement('select', {
                value: dueOffset.toString(),
                onChange: function(e) { setDueOffset(parseInt(e.target.value)); },
                className: 'bg-gray-700 rounded px-1 py-0.5 text-xs text-white'
              },
                React.createElement('option', { value: '0' }, 'Due: Today'),
                React.createElement('option', { value: '1' }, 'Due: Tomorrow'),
                React.createElement('option', { value: '3' }, 'Due: 3 days'),
                React.createElement('option', { value: '7' }, 'Due: Next week')),
              React.createElement('select', {
                value: recurring,
                onChange: function(e) { setRecurring(e.target.value); },
                className: 'bg-gray-700 rounded px-1 py-0.5 text-xs text-white'
              },
                React.createElement('option', { value: 'none' }, 'Once'),
                React.createElement('option', { value: 'daily' }, 'Daily'),
                React.createElement('option', { value: 'weekly' }, 'Weekly'))),
            React.createElement('button', {
              onClick: addTask,
              disabled: !input.trim(),
              className: 'w-full py-1 rounded text-xs font-semibold ' + (input.trim() ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed')
            }, 'Add task'))
        : null,
      pending.length > 0
        ? React.createElement('div', { className: 'space-y-1' },
            pending.slice(0, 8).map(function(task) {
              return React.createElement('div', { key: task.id, className: 'flex items-center gap-2 p-1 rounded hover:bg-gray-800 group' },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: false,
                  onChange: function() { toggleTask(task.id); },
                  className: 'w-4 h-4 cursor-pointer'
                }),
                React.createElement('div', { className: 'flex-1 min-w-0' },
                  React.createElement('div', { className: 'text-xs text-gray-300 truncate' }, task.text),
                  React.createElement('div', { className: 'text-xs mt-0.5' },
                    React.createElement('span', { style: { color: priorityColor[task.priority] } }, task.priority))),
                React.createElement('button', {
                  onClick: function() { deleteTask(task.id); },
                  className: 'text-xs text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100'
                }, '✕'));
            }),
          pending.length > 8
            ? React.createElement('div', { className: 'text-xs text-gray-600' }, '+ ', pending.length - 8, ' more')
            : null)
        : null,
      completed.length > 0
        ? React.createElement('div', { className: 'text-xs text-gray-600 border-t border-gray-700 pt-1 mt-1' },
            '✓ ', completed.length, ' completed')
        : null
    )
  );
}

function JournalingPromptGenerator() {
  var _idx = useState(Math.floor(Math.random() * 20)); var idx = _idx[0]; var setIdx = _idx[1];

  var prompts = [
    'What are you grateful for today?',
    'What challenged you today? How did you respond?',
    'Describe a moment that made you smile.',
    'What would you do if you weren\'t afraid?',
    'How are you taking care of yourself?',
    'What progress have you made recently?',
    'Who do you appreciate? Why?',
    'What brings you joy?',
    'Describe a time you felt strong.',
    'What would you tell your younger self?',
    'What are you learning about yourself?',
    'How can you be kinder to yourself today?',
    'What does recovery mean to you?',
    'Write about your hopes.',
    'What am I avoiding?',
    'What felt good about today?',
    'How did you handle stress today?',
    'What\'s one thing you did right?',
    'What would help you feel better?',
    'What are you proud of?'
  ];

  function next() {
    setIdx((idx + 1) % prompts.length);
  }

  return React.createElement(Card, { title: '📝 Journal Prompt', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-2' },
      React.createElement('div', { className: 'bg-indigo-900 bg-opacity-30 rounded-lg p-3 text-center' },
        React.createElement('p', { className: 'text-indigo-100 italic text-sm' }, '“', prompts[idx], '”')),
      React.createElement('button', {
        onClick: next,
        className: 'w-full py-1.5 rounded text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white'
      }, 'Next prompt'),
      React.createElement('a', {
        href: '#',
        onClick: function(e) { e.preventDefault(); },
        className: 'block text-center text-xs text-indigo-400 hover:text-indigo-300 underline mt-1'
      }, 'Start journaling')
    )
  );
}

function CravingIntensityTracker() {
  var store = useStore();
  var log = (store.state.recovery.cravingLog || []);
  var today = todayKey();
  var todayLog = log.filter(function(l) { return dayOf(l.ts) === today; });
  var _intensity = useState(0); var intensity = _intensity[0]; var setIntensity = _intensity[1];

  function log_craving() {
    if (intensity === 0) return;
    store.dispatch({ type: 'LOG_CRAVING', intensity: intensity });
    setIntensity(0);
    buzz(2);
  }

  var last7 = log.slice(0, 7).reverse();
  var peak = todayLog.length > 0 ? Math.max.apply(null, todayLog.map(function(l) { return l.intensity; })) : 0;
  var colors = ['#6b7280','#dc2626','#f97316','#f97316','#eab308','#eab308','#84cc16','#22c55e','#22c55e','#059669','#065f46'];

  return React.createElement(Card, { title: '🔥 Craving Level', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-3' },
      React.createElement('div', { className: 'flex items-center gap-3' },
        React.createElement('input', {
          type: 'range',
          min: '0',
          max: '10',
          value: intensity.toString(),
          onChange: function(e) { setIntensity(parseInt(e.target.value)); },
          className: 'flex-1'
        }),
        React.createElement('div', { className: 'text-2xl font-bold', style: { color: colors[intensity] } }, intensity, React.createElement('span', { className: 'text-sm text-gray-500' }, '/10'))),
      React.createElement('button', {
        onClick: log_craving,
        disabled: intensity === 0,
        className: 'w-full py-1 rounded text-sm font-semibold ' + (intensity > 0 ? 'bg-red-900 hover:bg-red-800 text-red-100' : 'bg-gray-700 text-gray-500 cursor-not-allowed')
      }, 'Log craving'),
      peak > 0
        ? React.createElement('div', { className: 'text-xs text-gray-500' },
            'Today: peak ', peak, '/10, ', todayLog.length, ' check-in', todayLog.length !== 1 ? 's' : '')
        : null,
      last7.length >= 3
        ? React.createElement('div', null,
            React.createElement('p', { className: 'text-xs text-gray-500 mb-1' }, 'Last 7 days'),
            React.createElement('div', { className: 'flex items-end gap-1', style: { height: '36px' } },
              last7.map(function(l, i) {
                var h = Math.round((l.intensity / 10) * 32) + 4;
                return React.createElement('div', {
                  key: i,
                  title: dayOf(l.ts) + ': ' + l.intensity + '/10',
                  style: { height: h + 'px', backgroundColor: colors[l.intensity], flex: 1, borderRadius: '2px', minWidth: '4px', maxWidth: '12px', cursor: 'pointer' }
                });
              })))
        : null
    )
  );
}

function RelapsePreventionToolkit() {
  var _open = useState(false); var open = _open[0]; var setOpen = _open[1];

  var signs = ['Isolation', 'Cravings', 'Skipping routines', 'Stress buildup', 'Mood crash'];
  var steps = ['Call support', 'Use coping skill', 'Take a break', 'Reach out NOW'];

  return React.createElement(Card, { title: '🚨 If In Crisis', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-2' },
      !open
        ? React.createElement('button', {
            onClick: function() { setOpen(true); },
            className: 'w-full py-2 rounded text-sm font-semibold bg-red-900 hover:bg-red-800 text-red-100'
          }, 'I need help NOW')
        : React.createElement('div', { className: 'space-y-2' },
            React.createElement('div', { className: 'bg-red-900 bg-opacity-50 rounded p-2' },
              React.createElement('div', { className: 'text-sm font-bold text-red-300 mb-1' }, '🚨 Early Warning Signs:'),
              React.createElement('div', { className: 'flex flex-wrap gap-1' },
                signs.map(function(sign, i) {
                  return React.createElement('span', { key: i, className: 'text-xs bg-red-800 text-red-100 px-2 py-0.5 rounded' }, sign);
                }))),
            React.createElement('div', { className: 'bg-indigo-900 bg-opacity-50 rounded p-2' },
              React.createElement('div', { className: 'text-sm font-bold text-indigo-300 mb-1' }, '✓ Action Steps:'),
              steps.map(function(step, i) {
                return React.createElement('div', { key: i, className: 'text-xs text-indigo-100 py-0.5' }, '→ ', step);
              })),
            React.createElement('button', {
              onClick: function() { setOpen(false); },
              className: 'w-full py-1 rounded text-xs font-semibold bg-gray-700 hover:bg-gray-600 text-gray-200'
            }, 'Close'))
    )
  );
}

function WeeklyReviewPrompt() {
  var week = getWeek();
  var _expand = useState(false); var expand = _expand[0]; var setExpand = _expand[1];
  var _responses = useState({}); var responses = _responses[0]; var setResponses = _responses[1];

  var prompts = [
    'What went well this week?',
    'What challenged you?',
    'Did you use any coping skills?',
    'How was your mood overall?',
    'What will you focus on next week?'
  ];

  function updateResponse(idx, text) {
    var newResp = Object.assign({}, responses);
    newResp[idx] = text;
    setResponses(newResp);
  }

  var answered = Object.keys(responses).length;

  return React.createElement(Card, { title: '💡 Weekly Reflection', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-2' },
      !expand
        ? React.createElement('div', { className: 'bg-indigo-900 bg-opacity-30 rounded p-2 text-center' },
            React.createElement('div', { className: 'text-sm font-semibold text-indigo-200', dangerouslySetInnerHTML: { __html: 'Week ' + week } }),
            React.createElement('div', { className: 'text-xs text-indigo-300 mt-1' }, answered, ' / ', prompts.length, ' reflected'),
            React.createElement('button', {
              onClick: function() { setExpand(true); },
              className: 'w-full mt-2 py-1 rounded text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white'
            }, 'Open reflection'))
        : React.createElement('div', { className: 'space-y-2' },
            prompts.map(function(prompt, idx) {
              return React.createElement('div', { key: idx, className: 'space-y-1' },
                React.createElement('label', { className: 'text-xs font-semibold text-indigo-300' }, prompt),
                React.createElement('textarea', {
                  value: responses[idx] || '',
                  onChange: function(e) { updateResponse(idx, e.target.value); },
                  placeholder: 'Your thoughts...',
                  maxLength: '150',
                  className: 'w-full bg-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-500 h-12 resize-none'
                }));
            }),
            React.createElement('button', {
              onClick: function() { setExpand(false); },
              className: 'w-full py-1 rounded text-xs font-semibold bg-gray-700 hover:bg-gray-600 text-gray-200'
            }, 'Done'))
    )
  );
}

function DistractionActivities() {
  var _selected = useState([]); var selected = _selected[0]; var setSelected = _selected[1];

  var activities = [
    { id: 'walk', label: '🚶 Walk', duration: '15m' },
    { id: 'game', label: '🎮 Game', duration: '20m' },
    { id: 'book', label: '📖 Read', duration: '30m' },
    { id: 'music', label: '🎵 Music', duration: '20m' },
    { id: 'cook', label: '🍳 Cook', duration: '45m' },
    { id: 'puzzle', label: '🧩 Puzzle', duration: '30m' },
    { id: 'call', label: '📞 Call friend', duration: '20m' },
    { id: 'movie', label: '🎬 Movie', duration: '90m' },
  ];

  function toggle(id) {
    setSelected(selected.includes(id) ? selected.filter(function(x) { return x !== id; }) : selected.concat([id]));
  }

  var picks = activities.filter(function(a) { return selected.includes(a.id); });

  return React.createElement(Card, { title: '🌥 When Urges Hit', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-2' },
      React.createElement('p', { className: 'text-xs text-gray-500' }, 'Pick 2–3 activities for right now'),
      React.createElement('div', { className: 'grid grid-cols-2 gap-1' },
        activities.map(function(a) {
          var picked = selected.includes(a.id);
          return React.createElement('button', {
            key: a.id,
            onClick: function() { toggle(a.id); },
            className: 'p-2 rounded text-xs font-semibold text-center transition-all ' + (picked ? 'bg-green-600 text-white ring-2 ring-white scale-105' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'),
          },
            a.label, React.createElement('br', null),
            React.createElement('span', { className: 'text-xs opacity-70' }, a.duration));
        })),
      picks.length > 0
        ? React.createElement('div', { className: 'bg-indigo-900 bg-opacity-50 rounded p-2 space-y-1' },
            React.createElement('div', { className: 'text-sm font-semibold text-indigo-200' }, 'Go do:'),
            picks.map(function(p, i) {
              return React.createElement('div', { key: i, className: 'text-indigo-100 text-sm' }, '→ ', p.label, ' (', p.duration, ')');
            }))
        : null
    )
  );
}

function MedicationReminder() {
  var store = useStore();
  var meds = (store.state.anchor.meds || []);
  var today = todayKey();
  var todayMeds = meds.filter(function(m) { return dayOf(m.ts) === today; });
  var _custom = useState(''); var custom = _custom[0]; var setCustom = _custom[1];

  var defaultMeds = ['Vitamin D', 'Multivitamin', 'Antidepressant', 'Anti-anxiety'];

  function toggle(medName) {
    var exists = todayMeds.some(function(m) { return m.name === medName; });
    if (!exists) {
      store.dispatch({ type: 'ADD_MED', name: medName, time: new Date().toLocaleTimeString() });
      chime(659, 0.1);
    }
  }

  function addCustom() {
    if (!custom.trim()) return;
    store.dispatch({ type: 'ADD_MED', name: custom.trim(), time: new Date().toLocaleTimeString() });
    setCustom('');
    buzz(2);
  }

  var allMeds = Array.from(new Set([...defaultMeds, ...meds.map(function(m) { return m.name; })]));
  var todayNames = new Set(todayMeds.map(function(m) { return m.name; }));

  return React.createElement(Card, { title: '🌍 Medications', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-2' },
      React.createElement('div', { className: 'grid grid-cols-2 gap-1' },
        allMeds.slice(0, 6).map(function(med) {
          var taken = todayNames.has(med);
          return React.createElement('button', {
            key: med,
            onClick: function() { toggle(med); },
            disabled: taken,
            className: 'px-2 py-1 rounded text-xs font-semibold transition-all ' + (taken ? 'bg-green-600 text-white scale-105' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'),
          }, taken ? '✓ ' : '', med);
        })),
      React.createElement('div', { className: 'flex gap-1' },
        React.createElement('input', {
          placeholder: 'Add custom...',
          value: custom,
          onChange: function(e) { setCustom(e.target.value); },
          onKeyDown: function(e) { if (e.key === 'Enter') addCustom(); },
          maxLength: '30',
          className: 'flex-1 bg-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-500'
        }),
        React.createElement('button', {
          onClick: addCustom,
          disabled: !custom.trim(),
          className: 'px-2 py-1 rounded text-xs font-semibold ' + (custom.trim() ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed')
        }, '+')),
      todayMeds.length > 0
        ? React.createElement('div', { className: 'bg-gray-800 rounded p-1.5 text-xs' },
            React.createElement('div', { className: 'text-gray-400 mb-1' }, 'Today: ', todayMeds.length, ' taken'),
            todayMeds.map(function(m, i) {
              return React.createElement('div', { key: i, className: 'text-green-300' }, '✓ ', m.name, ' at ', m.time);
            }))
        : null
    )
  );
}

function MoodByTimeOfDay() {
  var store = useStore();
  var moods = (store.state.anchor.moodLog || []);
  var last30 = moods.slice(0, 30);

  var hours = {};
  for (var h = 6; h < 23; h++) {
    hours[h] = [];
  }
  last30.forEach(function(m) {
    var ts = m.ts || '';
    var hour = parseInt(ts.split('T')[1].split(':')[0]);
    if (hour >= 6 && hour < 23) {
      hours[hour].push(m.mood);
    }
  });

  var avgByHour = {};
  for (var h = 6; h < 23; h++) {
    if (hours[h].length > 0) {
      avgByHour[h] = Math.round(hours[h].reduce(function(a, b) { return a + b; }, 0) / hours[h].length);
    }
  }

  var colors = ['#1f2937','#7f1d1d','#991b1b','#dc2626','#f97316','#eab308','#84cc16','#22c55e','#10b981','#059669'];

  return React.createElement(Card, { title: '🌈 Mood by Hour', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-2' },
      React.createElement('p', { className: 'text-xs text-gray-500' }, 'Last 30 days average mood by time'),
      React.createElement('div', { className: 'grid grid-cols-6 gap-1' },
        Object.keys(avgByHour).map(function(h) {
          var mood = avgByHour[h];
          return React.createElement('div', {
            key: h,
            title: h + ':00 – avg ' + mood + '/10',
            className: 'flex flex-col items-center gap-1 p-1 rounded text-xs',
            style: { backgroundColor: colors[mood] }
          },
            React.createElement('span', { className: 'font-bold text-white' }, mood),
            React.createElement('span', { className: 'text-gray-200' }, h));
        })),
      Object.keys(avgByHour).length === 0
        ? React.createElement('div', { className: 'text-xs text-gray-600 text-center py-3' }, 'Log moods to see patterns')
        : null
    )
  );
}

function BoxBreathingTimer() {
  var _active = useState(false); var active = _active[0]; var setActive = _active[1];
  var _phase = useState('inhale'); var phase = _phase[0]; var setPhase = _phase[1];
  var _count = useState(4); var count = _count[0]; var setCount = _count[1];
  var _rounds = useState(0); var rounds = _rounds[0]; var setRounds = _rounds[1];

  function start() {
    setActive(true);
    setPhase('inhale');
    setCount(4);
    setRounds(0);
  }

  React.useEffect(function() {
    if (!active) return;
    var timer = setTimeout(function() {
      if (count > 1) {
        setCount(count - 1);
      } else {
        var phases = ['inhale', 'hold', 'exhale', 'hold'];
        var nextPhase = phases[(phases.indexOf(phase) + 1) % 4];
        setPhase(nextPhase);
        setCount(4);
        if (nextPhase === 'inhale') {
          setRounds(rounds + 1);
          chime(523, 0.1);
        } else {
          buzz(1);
        }
      }
    }, 1000);
    return function() { clearTimeout(timer); };
  }, [active, phase, count, rounds]);

  var phaseLabel = { inhale: 'Breathe in', hold: 'Hold', exhale: 'Breathe out' };
  var phaseColor = phase === 'inhale' ? '#60a5fa' : phase === 'hold' ? '#fbbf24' : '#34d399';
  var scale = phase === 'inhale' ? 1.5 : phase === 'exhale' ? 0.7 : 1;

  return React.createElement(Card, { title: '💨 Box Breathing', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-4' },
      active
        ? React.createElement('div', { className: 'flex flex-col items-center gap-4' },
            React.createElement('div', { className: 'w-20 h-20 rounded-lg transition-all duration-1000',
              style: { backgroundColor: phaseColor, transform: 'scale(' + scale + ')' } }),
            React.createElement('div', { className: 'text-center' },
              React.createElement('div', { className: 'text-sm font-semibold text-indigo-300' }, phaseLabel[phase]),
              React.createElement('div', { className: 'text-2xl font-bold mt-1' }, count),
              React.createElement('div', { className: 'text-xs text-gray-500 mt-2' }, 'Round ', rounds + 1)),
            React.createElement('button', {
              onClick: function() { setActive(false); },
              className: 'px-4 py-1.5 rounded text-sm font-semibold bg-red-900 hover:bg-red-800 text-red-100'
            }, 'Stop'))
        : React.createElement('div', { className: 'text-center space-y-3' },
            React.createElement('div', { className: 'text-sm text-gray-400' },
              'Calm your nervous system',
              React.createElement('br', null),
              '4-4-4-4 breathing rhythm'),
            React.createElement('button', {
              onClick: start,
              className: 'w-full py-2 rounded text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white'
            }, 'Start'),
            rounds > 0
              ? React.createElement('div', { className: 'text-xs text-gray-500' }, 'Last session: ', rounds, ' rounds')
              : null)
    )
  );
}

function GroundingTechnique() {
  var _grounded = useState(false); var grounded = _grounded[0]; var setGrounded = _grounded[1];
  var _seen = useState([]); var seen = _seen[0]; var setSeen = _seen[1];
  var _hear = useState([]); var hear = _hear[0]; var setHear = _hear[1];
  var _touch = useState([]); var touch = _touch[0]; var setTouch = _touch[1];
  var _smell = useState([]); var smell = _smell[0]; var setSmell = _smell[1];
  var _taste = useState([]); var taste = _taste[0]; var setTaste = _taste[1];

  function toggle(sense, idx) {
    var arr = sense === 'see' ? seen : sense === 'hear' ? hear : sense === 'touch' ? touch : sense === 'smell' ? smell : taste;
    var setArr = sense === 'see' ? setSeen : sense === 'hear' ? setHear : sense === 'touch' ? setTouch : sense === 'smell' ? setSmell : setTaste;
    var newArr = arr.includes(idx) ? arr.filter(function(i) { return i !== idx; }) : arr.concat([idx]);
    setArr(newArr);
    if (newArr.length === 5 && seen.length === 5 && hear.length === 4 && touch.length === 3 && smell.length === 2 && taste.length === 1) {
      setGrounded(true);
    }
  }

  var senses = [
    { label: '👀 See 5 things', items: ['Something blue', 'Something shiny', 'Something soft-looking', 'Something round', 'Something small'], sense: 'see', arr: seen, setter: setSeen },
    { label: '👂 Hear 4 sounds', items: ['Bird', 'Wind', 'Voice', 'Traffic'], sense: 'hear', arr: hear, setter: setHear },
    { label: '🦠 Feel 3 textures', items: ['Something smooth', 'Something rough', 'Something warm'], sense: 'touch', arr: touch, setter: setTouch },
    { label: '🌌 Smell 2 scents', items: ['Fresh air', 'Any scent'], sense: 'smell', arr: smell, setter: setSmell },
    { label: '👅 Taste 1 flavor', items: ['Gum / mint / lemon'], sense: 'taste', arr: taste, setter: setTaste },
  ];

  return React.createElement(Card, { title: '🪓 5-4-3-2-1 Grounding', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-3' },
      grounded
        ? React.createElement('div', { className: 'bg-green-900 bg-opacity-50 rounded p-3 text-center' },
            React.createElement('div', { className: 'text-lg font-bold text-green-300' }, '🌚 You\'re grounded!'),
            React.createElement('div', { className: 'text-xs text-green-200 mt-1' }, 'Notice your 5 senses. You\'re present.'))
        : null,
      senses.map(function(s) {
        return React.createElement('div', { key: s.sense, className: 'space-y-1' },
          // Text children only. dangerouslySetInnerHTML plus children throws React error #60
          // and used to blank the whole SOS screen ("Something glitched").
          React.createElement('div', { className: 'text-sm font-semibold text-indigo-300 flex items-center justify-between' },
            React.createElement('span', null, s.label),
            React.createElement('span', { className: 'text-xs text-gray-500' }, s.arr.length, '/', s.items.length)),
          React.createElement('div', { className: 'space-y-1' },
            s.items.map(function(item, i) {
              var checked = s.arr.includes(i);
              return React.createElement('button', {
                key: i,
                onClick: function() { toggle(s.sense, i); },
                className: 'w-full text-left px-2 py-1 rounded text-sm transition-all ' + (checked ? 'bg-indigo-600 text-white scale-105' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'),
              }, checked ? '✓ ' : '○ ', item);
            })));
      }),
      React.createElement('button', {
        onClick: function() { setSeen([]); setHear([]); setTouch([]); setSmell([]); setTaste([]); setGrounded(false); },
        className: 'w-full text-xs text-gray-500 underline hover:text-gray-400 mt-2'
      }, 'Reset')
    )
  );
}

function CopingSkillsChecklist() {
  var store = useStore();
  var log = (store.state.recovery.copingSkillsLog || []);
  var today = todayKey();
  var todaySkills = new Set(log.filter(function(l) { return dayOf(l.ts) === today; }).map(function(l) { return l.skill; }));

  var SKILLS = [
    { id: 'breathe', label: '💨 Breathe', color: '#60a5fa' },
    { id: 'walk', label: '🚶 Take a walk', color: '#34d399' },
    { id: 'call', label: '☎ Call someone', color: '#f472b6' },
    { id: 'ice', label: '🧊 Ice on face', color: '#38bdf8' },
    { id: 'write', label: '📝 Write it out', color: '#fbbf24' },
    { id: 'move', label: '🩸 Move body', color: '#a78bfa' },
    { id: 'music', label: '🎧 Music', color: '#fb7185' },
    { id: 'art', label: '🎨 Art/draw', color: '#ec4899' },
    { id: 'pet', label: '🐾 Pet/cuddle', color: '#f97316' },
    { id: 'snack', label: '🍫 Healthy snack', color: '#84cc16' },
    { id: 'shower', label: '🚠 Shower', color: '#06b6d4' },
    { id: 'mindful', label: '🧘 Mindfulness', color: '#a855f7' },
  ];

  function toggle(skillId) {
    store.dispatch({ type: 'LOG_COPING_SKILL', skill: skillId });
    buzz(2);
  }

  return React.createElement(Card, { title: '🆗 Coping Skills', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-2' },
      React.createElement('div', { className: 'grid grid-cols-3 gap-2' },
        SKILLS.map(function(skill) {
          var used = todaySkills.has(skill.id);
          return React.createElement('button', {
            key: skill.id,
            onClick: function() { toggle(skill.id); },
            className: 'p-2 rounded text-xs font-semibold transition-all ' + (used ? 'ring-2 ring-white scale-105' : 'opacity-70 hover:opacity-100'),
            style: { backgroundColor: skill.color, color: '#fff' }
          }, React.createElement('span', { dangerouslySetInnerHTML: { __html: skill.label.split(' ')[0] } }), React.createElement('div', { className: 'text-xs mt-0.5' }, skill.label.split(' ').slice(1).join(' ')));
        })),
      todaySkills.size > 0
        ? React.createElement('div', { className: 'bg-gray-800 rounded p-2 text-center text-xs text-green-300' },
            'Using ', todaySkills.size, ' skill', todaySkills.size !== 1 ? 's' : '', ' today ✓')
        : null
    )
  );
}

function QuickWinsJournal() {
  var store = useStore();
  var wins = (store.state.anchor.quickWins || []);
  var today = todayKey();
  var todayWins = wins.filter(function(w) { return dayOf(w.ts) === today; });
  var _input = useState(''); var input = _input[0]; var setInput = _input[1];

  function add() {
    if (!input.trim()) return;
    store.dispatch({ type: 'ADD_QUICK_WIN', text: input.trim() });
    setInput('');
    chime(880, 0.1);
  }

  var milestones = [5, 10, 25, 50, 100];
  var totalWins = wins.length;
  var nextMilestone = milestones.find(function(m) { return m > totalWins; });
  var isMilestone = milestones.includes(totalWins);

  return React.createElement(Card, { title: '🎉 Quick Wins', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-3' },
      React.createElement('div', { className: 'flex gap-2' },
        React.createElement('input', {
          placeholder: 'What went well today?',
          value: input,
          onChange: function(e) { setInput(e.target.value); },
          onKeyDown: function(e) { if (e.key === 'Enter') add(); },
          maxLength: '60',
          className: 'flex-1 bg-gray-700 rounded px-2 py-1 text-sm text-white placeholder-gray-500'
        }),
        React.createElement('button', {
          onClick: add,
          disabled: !input.trim(),
          className: 'px-3 py-1 rounded text-sm font-semibold ' + (input.trim() ? 'bg-amber-600 hover:bg-amber-500 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed')
        }, '+')),
      isMilestone
        ? React.createElement('div', { className: 'bg-amber-900 bg-opacity-50 rounded p-2 text-center' },
            React.createElement('div', { className: 'text-sm font-semibold text-amber-300' }, '💥 ', totalWins, ' wins!')
          )
        : nextMilestone
          ? React.createElement('div', { className: 'text-xs text-gray-500 text-center' },
              nextMilestone - totalWins, ' wins to ', nextMilestone)
          : null,
      React.createElement('div', { className: 'text-xs text-gray-400' },
        'Today: ', todayWins.length, ' win', todayWins.length !== 1 ? 's' : ''),
      todayWins.length > 0
        ? React.createElement('div', { className: 'space-y-1' },
            todayWins.map(function(w, i) {
              return React.createElement('div', { key: i, className: 'bg-gray-800 rounded px-2 py-1 text-sm text-amber-100' },
                '✓ ', w.text);
            }))
        : null,
      wins.length > todayWins.length
        ? React.createElement('div', { className: 'text-xs text-gray-600 mt-2' },
            React.createElement('div', { className: 'font-semibold text-gray-500 mb-1' }, 'Recent:'),
            wins.slice(todayWins.length, Math.min(todayWins.length + 5, wins.length)).map(function(w, i) {
              return React.createElement('div', { key: i, className: 'py-0.5' }, dayOf(w.ts), ' – ', w.text);
            }))
        : null
    )
  );
}

function SleepQualityRating() {
  var store = useStore();
  var sleep = (store.state.anchor.sleep || []);
  var today = todayKey();
  var todayLog = sleep.find(function(s) { return dayOf(s.ts) === today; });
  var _q = useState(todayLog ? todayLog.quality : 5); var q = _q[0]; var setQ = _q[1];
  var _note = useState(todayLog ? (todayLog.tags || []).join(', ') : ''); var note = _note[0]; var setNote = _note[1];

  function save() {
    store.dispatch({ type: 'SLEEP_LOG', quality: q, hours: todayLog ? todayLog.hours : 0, tags: note.trim().split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t; }) });
    chime(523, 0.1);
  }

  var last7 = sleep.slice(0, 7).reverse();
  var colors = ['#7f1d1d','#991b1b','#dc2626','#f97316','#eab308','#84cc16','#22c55e','#10b981','#059669','#047857','#065f46'];

  return React.createElement(Card, { title: '🛌 Sleep Quality', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-3' },
      React.createElement('div', { className: 'flex items-center gap-3' },
        React.createElement('input', {
          type: 'range',
          min: '1',
          max: '10',
          value: q.toString(),
          onChange: function(e) { setQ(parseInt(e.target.value)); },
          className: 'flex-1'
        }),
        React.createElement('div', { className: 'text-2xl font-bold', style: { color: colors[q] } }, q, React.createElement('span', { className: 'text-sm text-gray-500' }, '/10'))),
      React.createElement('input', {
        placeholder: 'Tags: woke up, bad dreams, etc. (comma-separated)',
        value: note,
        onChange: function(e) { setNote(e.target.value); },
        maxLength: '60',
        className: 'w-full bg-gray-700 rounded px-2 py-1 text-sm text-white placeholder-gray-500'
      }),
      React.createElement('button', {
        onClick: save,
        className: 'w-full py-1 rounded text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white'
      }, 'Rate sleep'),
      todayLog
        ? React.createElement('div', { className: 'text-xs text-gray-400' },
            'Quality: ', todayLog.quality, '/10',
            todayLog.hours ? ' · ' + todayLog.hours + 'h sleep' : '',
            todayLog.tags && todayLog.tags.length ? ' · ' + todayLog.tags.join(', ') : '')
        : null,
      last7.length >= 3
        ? React.createElement('div', null,
            React.createElement('p', { className: 'text-xs text-gray-500 mb-1' }, 'Last 7 nights'),
            React.createElement('div', { className: 'flex items-end gap-1', style: { height: '36px' } },
              last7.map(function(s, i) {
                var h = Math.round((s.quality / 10) * 32) + 4;
                return React.createElement('div', {
                  key: i,
                  title: dayOf(s.ts) + ': ' + s.quality + '/10' + (s.hours ? ' (' + s.hours + 'h)' : ''),
                  style: { height: h + 'px', backgroundColor: colors[s.quality], flex: 1, borderRadius: '2px', minWidth: '4px', maxWidth: '12px', cursor: 'pointer' }
                });
              })))
        : null
    )
  );
}

function AffirmationOfTheDay() {
  var store = useStore();
  var all = [
    'You are capable of great things',
    'This moment is an opportunity',
    'You are stronger than you think',
    'Progress over perfection',
    'I choose to be present',
    'My effort today matters',
    'I am growing every day',
    'Challenges help me grow',
    'I deserve kindness, especially from myself',
    'I am worthy of love and respect',
    'This is a fresh start',
    'I can handle what comes',
    'My struggles don\'t define me',
    'I am resilient',
    'Small steps lead to big changes'
  ].concat(store.state.user.customAffirmations || []);
  var today = todayKey();
  var _idx = useState(Math.floor(Math.random() * all.length)); var idx = _idx[0]; var setIdx = _idx[1];
  var _show = useState(false); var show = _show[0]; var setShow = _show[1];

  function next() {
    setIdx((idx + 1) % all.length);
  }

  function prev() {
    setIdx((idx - 1 + all.length) % all.length);
  }

  return React.createElement(Card, { title: '🌚 Affirmation', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-3' },
      React.createElement('div', { className: 'bg-gradient-to-r from-purple-900 to-indigo-900 rounded-lg p-4 text-center min-h-20 flex items-center justify-center' },
        React.createElement('p', { className: 'text-lg font-semibold text-white italic' }, '“', all[idx], '”')),
      React.createElement('div', { className: 'flex gap-2 justify-center' },
        React.createElement('button', {
          onClick: prev,
          className: 'px-3 py-1 rounded text-sm bg-gray-700 hover:bg-gray-600 text-white'
        }, '←'),
        React.createElement('button', {
          onClick: next,
          className: 'px-3 py-1 rounded text-sm bg-gray-700 hover:bg-gray-600 text-white'
        }, '→')),
      React.createElement('div', { className: 'text-xs text-gray-500 text-center' },
        idx + 1, ' / ', all.length),
      React.createElement('button', {
        onClick: function() { setShow(!show); },
        className: 'w-full text-xs text-gray-500 underline hover:text-gray-400'
      }, show ? 'Hide' : 'Add custom')
    )
  );
}

function FocusSessionsTracker() {
  var store = useStore();
  var sessions = (store.state.anchor.focusSessions || []);
  var today = todayKey();
  var todaySession = sessions.filter(function(s) { return dayOf(s.ts) === today && s.completed; });
  var _dur = useState(25); var dur = _dur[0]; var setDur = _dur[1];

  function logSession() {
    store.dispatch({ type: 'ADD_FOCUS_SESSION', duration: dur, completed: true });
    chime(880, 0.15);
  }

  var last7 = sessions.filter(function(s) { return s.completed; }).slice(0, 7).reverse();
  var totalMins = todaySession.reduce(function(a, s) { return a + (s.duration || 25); }, 0);
  var pomodoros = Math.floor(totalMins / 25);
  var minLeft = totalMins % 25;

  return React.createElement(Card, { title: '🎯 Focus Sessions', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-3' },
      React.createElement('div', { className: 'flex items-center gap-2' },
        React.createElement('div', { className: 'text-3xl font-bold text-green-400' }, pomodoros),
        React.createElement('div', { className: 'text-xs text-gray-400' },
          React.createElement('div', null, '25-min blocks'),
          minLeft > 0 ? React.createElement('div', { className: 'text-gray-600' }, '+ ', minLeft, ' min') : null)),
      React.createElement('div', { className: 'flex items-center gap-2' },
        React.createElement('select', {
          value: dur.toString(),
          onChange: function(e) { setDur(parseInt(e.target.value)); },
          className: 'flex-1 bg-gray-700 rounded px-2 py-1 text-sm text-white'
        },
          [15, 20, 25, 30, 45, 60].map(function(d) {
            return React.createElement('option', { key: d, value: d.toString() }, d, ' min');
          })),
        React.createElement('button', {
          onClick: logSession,
          className: 'flex-1 py-1 rounded text-sm font-semibold bg-green-600 hover:bg-green-500 text-white'
        }, 'Log session')),
      todaySession.length > 0
        ? React.createElement('div', { className: 'text-xs text-gray-400' },
            'Today: ', todaySession.length, ' session', todaySession.length !== 1 ? 's' : '')
        : null,
      last7.length >= 3
        ? React.createElement('div', null,
            React.createElement('p', { className: 'text-xs text-gray-500 mb-1' }, 'Last 7 days (mins)'),
            React.createElement('div', { className: 'flex items-end gap-1', style: { height: '36px' } },
              last7.map(function(s, i) {
                var h = Math.round((s.duration / 60) * 32) + 4;
                return React.createElement('div', {
                  key: i,
                  title: dayOf(s.ts) + ': ' + s.duration + ' min',
                  style: { height: h + 'px', backgroundColor: '#4ade80', flex: 1, borderRadius: '2px', minWidth: '4px', maxWidth: '12px', cursor: 'pointer' }
                });
              })))
        : null
    )
  );
}

function EnergyLevelTracker() {
  var store = useStore();
  var logs = (store.state.anchor.energyLog || []);
  var _level = useState(5); var level = _level[0]; var setLevel = _level[1];
  var _note = useState(''); var note = _note[0]; var setNote = _note[1];

  function log() {
    store.dispatch({ type: 'ENERGY_LOG', level: level, note: note.trim() });
    setLevel(5);
    setNote('');
    chime(523, 0.1);
  }

  var today = todayKey();
  var todayLog = logs.find(function(l) { return dayOf(l.ts) === today; });
  var last7 = logs.slice(0, 7).reverse();
  var avg = logs.length > 0 ? Math.round(logs.slice(0, 7).reduce(function(a, l) { return a + l.level; }, 0) / Math.min(7, logs.length)) : 0;

  var colors = ['#7f1d1d','#991b1b','#dc2626','#f97316','#eab308','#84cc16','#22c55e','#10b981','#059669','#047857','#065f46'];

  return React.createElement(Card, { title: '⚡ Energy Level', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-3' },
      React.createElement('div', { className: 'flex items-center gap-3' },
        React.createElement('input', {
          type: 'range',
          min: '1',
          max: '10',
          value: level.toString(),
          onChange: function(e) { setLevel(parseInt(e.target.value)); },
          className: 'flex-1'
        }),
        React.createElement('div', { className: 'text-2xl font-bold', style: { color: colors[level] } }, level, React.createElement('span', { className: 'text-sm text-gray-500' }, '/10'))),
      React.createElement('textarea', {
        placeholder: 'What affects your energy? (optional)',
        value: note,
        onChange: function(e) { setNote(e.target.value); },
        maxLength: '60',
        className: 'w-full bg-gray-700 rounded px-2 py-1 text-sm text-white placeholder-gray-500 h-8 resize-none'
      }),
      React.createElement('button', {
        onClick: log,
        className: 'w-full py-1 rounded text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white'
      }, todayLog ? 'Update today' : 'Log energy'),
      todayLog
        ? React.createElement('div', { className: 'text-xs text-gray-400' },
            'Today: ', todayLog.level, '/10', todayLog.note ? ' — ' + todayLog.note : '')
        : null,
      last7.length >= 3
        ? React.createElement('div', null,
            React.createElement('div', { className: 'flex items-center gap-2 mt-2' },
              React.createElement('span', { className: 'text-xs text-gray-500' }, '7-day avg:'),
              React.createElement('span', { className: 'text-sm font-semibold', style: { color: colors[avg] } }, avg, '/10')),
            React.createElement('div', { className: 'flex items-end gap-1 mt-1', style: { height: '40px' } },
              last7.map(function(l, i) {
                var h = Math.round((l.level / 10) * 36) + 4;
                return React.createElement('div', {
                  key: i,
                  title: dayOf(l.ts) + ': ' + l.level + '/10',
                  style: { height: h + 'px', backgroundColor: colors[l.level], flex: 1, borderRadius: '2px', minWidth: '4px', maxWidth: '12px', cursor: 'pointer' }
                });
              })))
        : null
    )
  );
}

function WeeklyIntentions() {
  var store = useStore();
  var wi = (store.state.anchor.weeklyIntentions || []);
  var week = getWeek();
  var thisWeek = wi.find(function(w) { return w.week === week; });
  var _i1 = useState(thisWeek ? thisWeek.intentions[0] : ''); var i1 = _i1[0]; var setI1 = _i1[1];
  var _i2 = useState(thisWeek ? thisWeek.intentions[1] : ''); var i2 = _i2[0]; var setI2 = _i2[1];
  var _i3 = useState(thisWeek ? thisWeek.intentions[2] : ''); var i3 = _i3[0]; var setI3 = _i3[1];
  var _open = useState(false); var open = _open[0]; var setOpen = _open[1];

  function save() {
    var intentions = [i1.trim(), i2.trim(), i3.trim()].filter(function(i) { return i.length > 0; });
    if (!intentions.length) return;
    store.dispatch({ type: 'SET_WEEKLY_INTENTIONS', week: week, intentions: [i1, i2, i3] });
    chime(880, 0.1);
  }

  var past = wi.filter(function(w) { return w.week !== week; }).slice(0, 8);

  return React.createElement(Card, { title: '🎯 Weekly Intentions', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-2' },
      thisWeek && !open
        ? React.createElement('div', { className: 'bg-gray-800 rounded p-2' },
            React.createElement('div', { className: 'text-xs font-semibold text-indigo-300 mb-1' }, thisWeek.week),
            thisWeek.intentions.filter(function(i) { return i; }).map(function(i, idx) {
              return React.createElement('div', { key: idx, className: 'text-sm text-gray-300 py-0.5' }, '• ', i);
            }),
            React.createElement('button', {
              onClick: function() { setOpen(true); },
              className: 'text-xs text-gray-500 underline mt-1'
            }, 'Edit'))
        : React.createElement('div', { className: 'space-y-1' },
            [1,2,3].map(function(n) {
              var val = n === 1 ? i1 : n === 2 ? i2 : i3;
              var setVal = n === 1 ? setI1 : n === 2 ? setI2 : setI3;
              return React.createElement('div', { key: n },
                React.createElement('input', {
                  placeholder: 'Intention ' + n + '...',
                  value: val,
                  onChange: function(e) { setVal(e.target.value); },
                  className: 'w-full bg-gray-700 rounded px-2 py-1 text-sm text-white placeholder-gray-500'
                }));
            }),
            React.createElement('button', {
              onClick: save,
              className: 'w-full py-1 rounded text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white'
            }, 'Save intentions'),
            open && React.createElement('button', {
              onClick: function() { setOpen(false); },
              className: 'w-full text-xs text-gray-500 underline'
            }, 'Close')),
      past.length > 0
        ? React.createElement('div', { className: 'mt-2 pt-2 border-t border-gray-700' },
            React.createElement('div', { className: 'text-xs text-gray-500 mb-1' }, 'Past weeks'),
            past.map(function(p, idx) {
              return React.createElement('div', { key: idx, className: 'text-xs text-gray-600 py-0.5' },
                React.createElement('span', { className: 'font-semibold text-gray-500' }, p.week, ': '),
                p.intentions.filter(function(i) { return i; }).join(' • '));
            }))
        : null
    )
  );
}

function DayRating() {
  var store = useStore();
  var ratings = (store.state.anchor.dayRatings || []);
  var todayStr = todayKey();
  var todayEntry = ratings.find(function(r) { return dayOf(r.ts) === todayStr; });
  var _sel = useState(todayEntry ? todayEntry.rating : 0); var sel = _sel[0]; var setSel = _sel[1];
  var _note = useState(todayEntry ? todayEntry.note : ''); var note = _note[0]; var setNote = _note[1];
  var _saved = useState(!!todayEntry); var saved = _saved[0]; var setSaved = _saved[1];
  var _open = useState(false); var open = _open[0]; var setOpen = _open[1];

  var last30 = ratings.slice(0, 30).reverse();
  var maxR = 10;

  function save() {
    if (!sel) return;
    store.dispatch({ type: 'DAY_RATING', rating: sel, note: note.trim() });
    setSaved(true);
    chime(660, 0.15);
  }

  var colors = ['', '#ef4444','#f97316','#f97316','#eab308','#eab308','#84cc16','#22c55e','#22c55e','#10b981','#06b6d4'];

  return React.createElement(Card, { title: '⭐ Day Rating', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-3' },
      saved
        ? React.createElement('div', { className: 'flex items-center gap-3' },
            React.createElement('div', { className: 'text-4xl font-bold', style: { color: colors[todayEntry ? todayEntry.rating : sel] } },
              todayEntry ? todayEntry.rating : sel, React.createElement('span', { className: 'text-lg text-gray-400' }, '/10')),
            React.createElement('div', { className: 'flex-1' },
              React.createElement('div', { className: 'text-sm text-gray-400' }, "Today's rating saved"),
              todayEntry && todayEntry.note
                ? React.createElement('div', { className: 'text-xs text-gray-500 mt-1 italic' }, '"', todayEntry.note, '"')
                : null),
            React.createElement('button', { className: 'text-xs text-gray-500 underline', onClick: function() { setSaved(false); } }, 'Edit'))
        : React.createElement('div', { className: 'space-y-2' },
            React.createElement('p', { className: 'text-xs text-gray-400' }, 'How was today overall?'),
            React.createElement('div', { className: 'flex gap-1 flex-wrap' },
              [1,2,3,4,5,6,7,8,9,10].map(function(n) {
                return React.createElement('button', {
                  key: n,
                  onClick: function() { setSel(n); },
                  className: 'w-8 h-8 rounded text-sm font-bold transition-all ' + (sel === n ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'),
                  style: { backgroundColor: sel === n ? colors[n] : '#374151', color: '#fff' }
                }, n);
              })),
            sel > 0
              ? React.createElement('input', {
                  className: 'w-full bg-gray-700 rounded px-2 py-1 text-sm text-white placeholder-gray-500',
                  placeholder: 'Optional note about today...',
                  value: note,
                  onChange: function(e) { setNote(e.target.value); },
                  onKeyDown: function(e) { if (e.key === 'Enter') save(); }
                })
              : null,
            React.createElement('button', {
              onClick: save,
              disabled: !sel,
              className: 'w-full py-1.5 rounded text-sm font-semibold ' + (sel ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed')
            }, 'Save Rating')),
      last30.length >= 3
        ? React.createElement('div', null,
            React.createElement('p', { className: 'text-xs text-gray-500 mb-1' }, 'Last 30 days'),
            React.createElement('div', { className: 'flex items-end gap-0.5', style: { height: '48px' } },
              last30.map(function(r, i) {
                var h = Math.round((r.rating / 10) * 44) + 4;
                return React.createElement('div', {
                  key: i,
                  title: dayOf(r.ts) + ': ' + r.rating + '/10' + (r.note ? ' — ' + r.note : ''),
                  style: { height: h + 'px', backgroundColor: colors[r.rating], flex: 1, borderRadius: '2px', minWidth: '4px', maxWidth: '14px' }
                });
              })))
        : null
    )
  );
}

function EveningWrapUp() {
  var store = useStore();
  var state = store.state;
  var hour = new Date().getHours();
  if (hour < 18) return null;

  var a = state.anchor;
  var todayStr = todayKey();
  var waterGoal = (state.user.preferences && state.user.preferences.waterGoal) || 8;

  var todayMoods = (a.moodLog||[]).filter(function(m){ return dayOf(m.ts) === todayStr; });
  var todaySleep = (a.sleep||[]).find(function(s){ return s.date === todayStr || (s.ts && dayOf(s.ts) === todayStr); });
  var todayWater = (a.waterLog||[]).find(function(w){ return w.date === todayStr; });
  var waterCount = todayWater ? todayWater.count : 0;
  var habits = a.habits || [];
  var doneHabits = habits.filter(function(h){ return (a.habitLog||[]).some(function(e){ return e.key === h.id+':'+todayStr; }); });
  var todayFocus = (a.focusSessions||[]).filter(function(f){ return f.ts && dayOf(f.ts) === todayStr && f.completed; });
  var todayGratitude = (a.gratitude||[]).some(function(g){ return g.ts && dayOf(g.ts) === todayStr; });
  var todayJournal = (a.journal||[]).some(function(j){ return j.ts && dayOf(j.ts) === todayStr; });

  var wins = [];
  if (todayMoods.length > 0) wins.push(todayMoods.length + ' check-in' + (todayMoods.length > 1 ? 's' : ''));
  if (todaySleep) wins.push('sleep tracked');
  if (waterCount >= waterGoal) wins.push('water goal hit');
  if (doneHabits.length > 0) wins.push(doneHabits.length + '/' + habits.length + ' habits');
  if (todayFocus.length > 0) wins.push(todayFocus.length + ' focus session' + (todayFocus.length > 1 ? 's' : ''));
  if (todayGratitude) wins.push('gratitude logged');
  if (todayJournal) wins.push('journaled');

  var msgs = [
    'Rest now. You earned it.',
    'Today happened. You were here for it.',
    'Whatever today was, you showed up.',
    'Sleep is healing. Let yourself rest.',
    'Tomorrow is a clean page.',
  ];
  var msg = msgs[new Date().getDate() % msgs.length];

  return (
    <Card className="border-warm/30 bg-warm/5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">🌙</span>
        <span className="font-semibold text-sm">Evening check-in</span>
      </div>
      {wins.length > 0 ? (
        <div>
          <div className="text-xs text-faint mb-2">Today you:</div>
          <div className="flex flex-wrap gap-1 mb-3">
            {wins.map(function(w){
              return <span key={w} className="text-xs bg-grow/15 text-grow rounded-full px-2 py-0.5">{w}</span>;
            })}
          </div>
        </div>
      ) : (
        <div className="text-xs text-faint mb-3">Nothing tracked yet today — that is okay too.</div>
      )}
      <div className="text-sm italic text-calm/80">{msg}</div>
    </Card>
  );
}

function DailySummaryCard() {
  var store = useStore(); var state = store.state;
  var todayStr = todayKey();
  var a = state.anchor;
  var [open, setOpen] = useState(false);
  var waterGoal = (state.user.preferences && state.user.preferences.waterGoal) || 8;

  var todayMoods    = (a.moodLog||[]).filter(function(m){ return dayOf(m.ts) === todayStr; });
  var avgMoodToday  = todayMoods.length ? todayMoods.reduce(function(s,m){ var v={great:5,good:4,ok:3,low:2,anxious:1}; return s+(v[m.mood]||3); },0)/todayMoods.length : 0;
  var moodEmojis    = {great:'😄',good:'🙂',ok:'😐',low:'😔',anxious:'😰'};
  var lastMoodKey   = todayMoods[0] && todayMoods[0].mood;
  var todaySleep    = (a.sleep||[]).find(function(s){ return s.ts && dayOf(s.ts) === todayStr; });
  var todayWater    = (a.waterLog||[]).find(function(w){ return w.date === todayStr; });
  var waterCount    = todayWater ? (todayWater.count || 0) : 0;
  var habits        = a.habits || [];
  var doneHabits    = habits.filter(function(h){ return (a.habitLog||[]).some(function(e){ return e.key===h.id+':'+todayStr; }); });
  var todayFocus    = (a.focusSessions||[]).filter(function(f){ return f.ts && dayOf(f.ts)===todayStr && f.completed; });
  var focusMins     = todayFocus.reduce(function(s,f){ return s+(f.minutes||25); },0);
  var todayMed      = (a.meditationLog||[]).filter(function(m){ return m.ts && dayOf(m.ts)===todayStr; });
  var medMins       = todayMed.reduce(function(s,m){ return s+(m.minutes||0); },0);
  var todayGrat     = (a.gratitude||[]).some(function(g){ return g.ts && dayOf(g.ts)===todayStr; });
  var todayJournal  = (a.journal||[]).some(function(j){ return j.ts && dayOf(j.ts)===todayStr; });
  var todayEnergy   = (a.energyLog||[]).find(function(e){ return e.ts && dayOf(e.ts)===todayStr; });
  var todayMeds     = a.meds ? a.meds.filter(function(m){ return (a.medLog||[]).some(function(e){ return e.key===m.id+':'+todayStr; }); }) : [];
  var todayRoutines = state.flow.history.filter(function(h){ return dayOf(h.ts)===todayStr && h.completed; }).length;
  var todayCopilot  = state.copilot.history.filter(function(h){ return dayOf(h.ts)===todayStr; }).length;
  var todayBreath   = (a.breathingSessions||[]).filter(function(b){ return b.ts && dayOf(b.ts)===todayStr; }).length;

  var itemCount = (todayMoods.length>0?1:0)+(todaySleep?1:0)+(waterCount>0?1:0)+(doneHabits.length>0?1:0)+
    (todayFocus.length>0?1:0)+(medMins>0?1:0)+(todayGrat?1:0)+(todayJournal?1:0)+
    (todayEnergy?1:0)+(todayMeds.length>0?1:0)+(todayRoutines>0?1:0)+(todayCopilot>0?1:0)+(todayBreath>0?1:0);
  if (itemCount === 0) return null;

  var tiles = [];
  if (todayMoods.length > 0) tiles.push({ icon: lastMoodKey ? moodEmojis[lastMoodKey] : '🙂', label: 'Mood', val: todayMoods.length + ' log' + (todayMoods.length>1?'s':''), color:'text-calm' });
  if (todaySleep) tiles.push({ icon:'😴', label:'Sleep', val: todaySleep.hours+'h', color:'text-brand' });
  if (waterCount > 0) tiles.push({ icon:'💧', label:'Water', val: waterCount+'/'+waterGoal, color: waterCount>=waterGoal?'text-grow':'text-brand' });
  if (habits.length > 0) tiles.push({ icon:'✅', label:'Habits', val: doneHabits.length+'/'+habits.length, color: doneHabits.length===habits.length?'text-grow':'text-warm' });
  if (todayFocus.length > 0) tiles.push({ icon:'🎯', label:'Focus', val: focusMins+'m', color:'text-brand' });
  if (medMins > 0) tiles.push({ icon:'🧘', label:'Meditation', val: medMins+'m', color:'text-calm' });
  if (todayBreath > 0) tiles.push({ icon:'💨', label:'Breathing', val: todayBreath+'×', color:'text-calm' });
  if (todayRoutines > 0) tiles.push({ icon:'⚡', label:'Routines', val: todayRoutines+'×', color:'text-grow' });
  if (todayCopilot > 0) tiles.push({ icon:'🤝', label:'Co-Pilot', val: todayCopilot+'×', color:'text-calm' });
  if (todayGrat) tiles.push({ icon:'🙏', label:'Gratitude', val: '✓', color:'text-warm' });
  if (todayJournal) tiles.push({ icon:'📝', label:'Journal', val: '✓', color:'text-warm' });
  if (todayEnergy) tiles.push({ icon:'⚡', label:'Energy', val: todayEnergy.level+'/5', color:'text-grow' });
  if (a.meds && a.meds.length > 0 && todayMeds.length > 0) tiles.push({ icon:'💊', label:'Meds', val: todayMeds.length+'/'+a.meds.length, color:'text-rose' });

  return (
    <Card className="border-brand/20">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span className="text-base">📋</span>
          <span className="font-semibold text-sm">Today at a glance</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-faint text-xs">{itemCount} thing{itemCount!==1?'s':''} done</span>
          <span className="text-faint text-xs">{open?'▲':'▼'}</span>
        </div>
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {tiles.map(function(t, i) {
            return (
              <div key={i} className="bg-panel2 rounded-xl px-2 py-2 text-center">
                <div className="text-base">{t.icon}</div>
                <div className={'font-bold text-xs tabnum ' + t.color}>{t.val}</div>
                <div className="text-faint text-[9px] mt-0.5">{t.label}</div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function DailyIntention() {
  var store = useStore();
  var state = store.state;
  var dispatch = store.dispatch;
  var todayStr = todayKey();
  var todayIntent = (state.anchor.intentions||[]).find(function(i){ return i.date === todayStr; });
  var completed = (state.anchor.completedIntentions||[]).some(function(c){ return c.date === todayStr; });
  var _i = useState(''); var input = _i[0]; var setInput = _i[1];
  var _e = useState(false); var editing = _e[0]; var setEditing = _e[1];
  var allDates = new Set((state.anchor.completedIntentions||[]).map(function(c){ return c.date; }));
  var streak = 0;
  for (var si = 0; si < 365; si++) {
    var sd = new Date(); sd.setDate(sd.getDate()-si);
    if (allDates.has(localDateStr(sd))) { streak++; } else { break; }
  }

  var save = function() {
    var t = input.trim();
    if (!t) return;
    dispatch({ type: 'SET_INTENTION', text: t });
    setEditing(false);
    setInput('');
    buzz(10);
  };
  var complete = function() {
    dispatch({ type: 'COMPLETE_INTENTION' });
    buzz(30); chime(660, 0.4);
  };

  return (
    <Card className={'border-brand/30' + (completed ? ' border-grow/40' : '')}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎯</span>
          <span className="font-semibold text-sm">Today&#39;s intention</span>
        </div>
        {streak > 1 && <span className="text-xs text-brand font-bold">{streak}-day streak</span>}
      </div>
      {todayIntent && !editing ? (
        <div className="space-y-2">
          <p className={'text-sm italic flex-1 ' + (completed ? 'text-faint line-through' : 'text-label')}>&ldquo;{todayIntent.text}&rdquo;</p>
          <div className="flex items-center gap-2">
            {!completed && (
              <button onClick={complete}
                className="flex-1 flex items-center justify-center gap-1.5 bg-grow/15 hover:bg-grow/25 text-grow rounded-xl py-1.5 text-xs font-medium transition">
                <span>✓</span> Mark done
              </button>
            )}
            {completed && <span className="text-xs text-grow">✓ Done — intention kept</span>}
            <button className="text-xs text-faint hover:text-label" onClick={function(){ setInput(todayIntent.text); setEditing(true); }}>edit</button>
          </div>
        </div>
      ) : (
        <div>
          {!todayIntent && !editing && (
            <button className="text-xs text-faint border border-dashed border-edge/40 rounded-lg w-full py-2 hover:border-brand/40 hover:text-label" onClick={function(){ setEditing(true); }}>
              + Set your intention for today
            </button>
          )}
          {editing && (
            <div className="flex flex-col gap-2">
              <textarea
                className="w-full bg-panel2 rounded-lg p-2 text-sm resize-none border border-edge/40 focus:border-brand/60 outline-none"
                rows={2}
                placeholder="What matters most to you today?"
                value={input}
                onChange={function(e){ setInput(e.target.value); }}
                onKeyDown={function(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); save(); } }}
                autoFocus
              />
              <div className="flex gap-2">
                <button className="flex-1 bg-brand/20 hover:bg-brand/30 text-brand rounded-lg py-1 text-sm" onClick={save}>Set intention</button>
                <button className="px-3 text-faint hover:text-label text-sm" onClick={function(){ setEditing(false); setInput(''); }}>✕</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function QuickNote() {
  var store = useStore();
  var state = store.state;
  var dispatch = store.dispatch;
  var allNotes = state.anchor.quickNotes || [];
  var _s = useState(''); var text = _s[0]; var setText = _s[1];
  var _e = useState(false); var showInput = _e[0]; var setShowInput = _e[1];
  var _o = useState(false); var showOld = _o[0]; var setShowOld = _o[1];
  var submit = function() {
    if (!text.trim()) return;
    dispatch({ type: 'ADD_QUICK_NOTE', text: text.trim() });
    setText('');
    setShowInput(false);
    buzz(20);
  };
  var todayStr = todayKey();
  var todayNotes = allNotes.filter(function(n){ return dayOf(n.ts) === todayStr; });
  var olderNotes = allNotes.filter(function(n){ return dayOf(n.ts) !== todayStr; });

  var groupByDate = function(notes) {
    var groups = {};
    notes.forEach(function(n){
      var d = dayOf(n.ts);
      if (!groups[d]) groups[d] = [];
      groups[d].push(n);
    });
    return Object.keys(groups).sort(function(a,b){ return b.localeCompare(a); }).map(function(d){ return { date:d, notes:groups[d] }; });
  };

  var fmtOldDate = function(ds) {
    var d = new Date(ds + 'T12:00:00');
    return d.toLocaleDateString('en-ZA', { month:'short', day:'numeric' });
  };

  return (
    <Card className="border-edge/30">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">💭</span>
          <span className="font-semibold">Quick thoughts</span>
          {allNotes.length > 0 && <span className="text-faint text-[10px]">{allNotes.length}</span>}
        </div>
        {!showInput && React.createElement('button', {
          onClick: function(){ setShowInput(true); },
          className: 'text-brand text-sm hover:underline'
        }, '+ add')}
      </div>
      {showInput && React.createElement('div', { className: 'flex gap-2 mb-2' },
        React.createElement('input', {
          value: text,
          onChange: function(e){ setText(e.target.value); },
          onKeyDown: function(e){ if (e.key === 'Enter') submit(); },
          placeholder: 'Quick thought...',
          className: 'flex-1 bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-sm placeholder-faint/60 outline-none focus:border-brand',
          autoFocus: true
        }),
        React.createElement('button', { onClick: submit, className: 'text-brand text-sm px-3' }, '✓'),
        React.createElement('button', { onClick: function(){ setShowInput(false); setText(''); }, className: 'text-faint text-sm' }, '✕')
      )}
      {todayNotes.length > 0 && React.createElement('div', { className: 'space-y-1 mb-1' },
        todayNotes.map(function(n) {
          return React.createElement('div', { key: n.id, className: 'flex items-start gap-2 text-sm group' },
            React.createElement('span', { className: 'text-faint text-[10px] mt-1 tabnum' }, n.ts.slice(11,16)),
            React.createElement('span', { className: 'text-paper/80 flex-1 leading-snug' }, n.text),
            React.createElement('button', {
              onClick: function(e){ e.stopPropagation(); dispatch({ type: 'REMOVE_QUICK_NOTE', id: n.id }); },
              className: 'text-faint/0 group-hover:text-faint hover:text-rose text-xs flex-shrink-0'
            }, '✕')
          );
        })
      )}
      {todayNotes.length === 0 && !showInput && React.createElement('div', { className: 'text-faint text-sm' }, 'Capture a thought before it fades')}
      {olderNotes.length > 0 && (
        React.createElement('div', { className: 'mt-2 pt-2 border-t border-edge/20' },
          React.createElement('button', {
            onClick: function(){ setShowOld(!showOld); },
            className: 'text-faint text-xs hover:text-brand'
          }, showOld ? '▲ hide older' : ('▼ ' + olderNotes.length + ' older note' + (olderNotes.length !== 1 ? 's' : ''))),
          showOld && React.createElement('div', { className: 'mt-2 space-y-3' },
            groupByDate(olderNotes).slice(0, 10).map(function(g){
              return React.createElement('div', { key: g.date },
                React.createElement('div', { className: 'text-faint text-[10px] mb-1' }, fmtOldDate(g.date)),
                React.createElement('div', { className: 'space-y-1' },
                  g.notes.map(function(n){
                    return React.createElement('div', { key: n.id, className: 'flex items-start gap-2 text-sm group pl-1' },
                      React.createElement('span', { className: 'text-faint text-[10px] mt-0.5 tabnum flex-shrink-0' }, n.ts.slice(11,16)),
                      React.createElement('span', { className: 'text-paper/60 flex-1 leading-snug text-xs' }, n.text),
                      React.createElement('button', {
                        onClick: function(){ dispatch({ type: 'REMOVE_QUICK_NOTE', id: n.id }); },
                        className: 'text-faint/0 group-hover:text-faint/60 hover:text-rose text-xs flex-shrink-0'
                      }, '✕')
                    );
                  })
                )
              );
            })
          )
        )
      )}
    </Card>
  );
}

function SleepTrend() {
  var store = useStore();
  var state = store.state;
  var sleepLog = state.anchor.sleep || [];
  if (sleepLog.length < 2) return null;
  var days = [];
  var now = new Date();
  for (var i = 6; i >= 0; i--) {
    var d = new Date(now);
    d.setDate(d.getDate() - i);
    var ds = localDateStr(d);
    var dayLogs = sleepLog.filter(function(s){ return dayOf(s.ts) === ds; });
    var dayLabel = ['Su','Mo','Tu','We','Th','Fr','Sa'][d.getDay()];
    if (dayLogs.length) {
      var avg = dayLogs.reduce(function(s,e){ return s + e.hours; }, 0) / dayLogs.length;
      var qual = dayLogs.reduce(function(s,e){ return s + e.quality; }, 0) / dayLogs.length;
      days.push({ ds: ds, label: dayLabel, hours: avg, quality: qual });
    } else {
      days.push({ ds: ds, label: dayLabel, hours: 0, quality: 0 });
    }
  }
  var maxH = 40;
  var qualColor = function(q) {
    if (q >= 4) return '#3ddc97';
    if (q >= 3) return '#6aa0ff';
    if (q >= 2) return '#ffce6a';
    return '#ff9aa6';
  };
  return (
    <Card className="border-edge/30">
      <div className="text-faint text-sm mb-3">Sleep · 7 days</div>
      <div className="flex items-end justify-between gap-1" style={{height: maxH + 20 + 'px'}}>
        {days.map(function(d) {
          var h = d.hours ? (d.hours / 10) * maxH : 4;
          return React.createElement('div', { key: d.ds, className: 'flex-1 flex flex-col items-center gap-1' },
            d.hours > 0 && React.createElement('div', { className: 'text-[9px] tabnum text-faint' }, d.hours.toFixed(0) + 'h'),
            React.createElement('div', {
              className: 'rounded-full transition-all',
              style: { width: '100%', maxWidth: '28px', height: Math.round(h) + 'px',
                backgroundColor: d.hours ? qualColor(d.quality) : 'transparent', opacity: d.hours ? 1 : 0.15 }
            }),
            React.createElement('span', { className: 'text-faint text-[10px]' }, d.label)
          );
        })}
      </div>
    </Card>
  );
}

function SleepInsights() {
  var [open, setOpen] = useState(false);
  var store = useStore(); var state = store.state;
  var sleepLog = state.anchor.sleep || [];
  if (sleepLog.length < 3) return null;
  var now = new Date();
  function dsOf(offset) {
    var d = new Date(now); d.setDate(d.getDate() - offset);
    return localDateStr(d);
  }
  var last14 = sleepLog.filter(function(s){ return dayOf(s.ts) >= dsOf(14); });
  var last7  = sleepLog.filter(function(s){ return dayOf(s.ts) >= dsOf(7); });
  var prev7  = sleepLog.filter(function(s){
    var ds = dayOf(s.ts); return ds >= dsOf(14) && ds < dsOf(7);
  });
  var avgH = last14.length ? (last14.reduce(function(s,e){ return s + e.hours; }, 0) / last14.length) : 0;
  var avgQ7  = last7.length  ? last7.reduce(function(s,e){ return s + e.quality; }, 0) / last7.length  : 0;
  var avgQp7 = prev7.length  ? prev7.reduce(function(s,e){ return s + e.quality; }, 0) / prev7.length : 0;
  var qDiff = avgQ7 - avgQp7;
  var trend = prev7.length === 0 ? null : qDiff >= 0.3 ? 'improving' : qDiff <= -0.3 ? 'declining' : 'stable';
  var trendIcon = { improving: '📈', declining: '📉', stable: '➡️' };
  var trendColor = { improving: 'text-grow', declining: 'text-red-400', stable: 'text-faint' };
  var sorted = sleepLog.slice().sort(function(a,b){ return b.quality - a.quality || b.hours - a.hours; });
  var bestNight = sorted[0];
  var worstNight = sorted[sorted.length - 1];
  var sleepEmoji = ['','😫','😪','😐','😊','😴'];
  function fmtDate(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' });
  }
  var highQual = last14.filter(function(e){ return e.quality >= 4; });
  var lowQual  = last14.filter(function(e){ return e.quality <= 2; });
  var avgHhigh = highQual.length ? highQual.reduce(function(s,e){ return s + e.hours; }, 0) / highQual.length : 0;
  var avgHlow  = lowQual.length  ? lowQual.reduce(function(s,e){ return s + e.hours; }, 0) / lowQual.length  : 0;
  var hasCorrelation = highQual.length >= 2 && lowQual.length >= 2;
  return (
    <Card className="border-edge/30">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span className="text-base">💤</span>
          <span className="text-faint text-sm">Sleep insights</span>
        </div>
        <div className="flex items-center gap-2">
          {trend && <span className={'text-xs ' + trendColor[trend]}>{trendIcon[trend]} {trend}</span>}
          <span className="text-faint text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-panel2 rounded-xl px-2 py-2 text-center">
              <div className="text-calm font-bold tabnum text-lg">{avgH.toFixed(1)}h</div>
              <div className="text-faint text-[10px]">avg / night</div>
            </div>
            <div className="bg-panel2 rounded-xl px-2 py-2 text-center">
              <div className="text-calm font-bold tabnum text-lg">{avgQ7.toFixed(1)}/5</div>
              <div className="text-faint text-[10px]">avg quality</div>
            </div>
            <div className="bg-panel2 rounded-xl px-2 py-2 text-center">
              <div className="text-calm font-bold tabnum text-lg">{sleepLog.length}</div>
              <div className="text-faint text-[10px]">nights logged</div>
            </div>
          </div>
          {trend && prev7.length > 0 && (
            <div className={'text-xs px-1 ' + trendColor[trend]}>
              {trendIcon[trend]} Quality {trend} vs prior week ({qDiff > 0 ? '+' : ''}{qDiff.toFixed(1)} pts)
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-panel2 rounded-xl px-3 py-2">
              <div className="text-faint text-[10px] mb-1">Best night</div>
              <div className="text-paper text-sm">{sleepEmoji[Math.round(bestNight.quality)]} {bestNight.hours}h</div>
              <div className="text-faint text-[11px]">{fmtDate(bestNight.ts)}</div>
            </div>
            <div className="bg-panel2 rounded-xl px-3 py-2">
              <div className="text-faint text-[10px] mb-1">Worst night</div>
              <div className="text-paper text-sm">{sleepEmoji[Math.round(worstNight.quality)]} {worstNight.hours}h</div>
              <div className="text-faint text-[11px]">{fmtDate(worstNight.ts)}</div>
            </div>
          </div>
          {hasCorrelation && (
            <div className="bg-panel2 rounded-xl px-3 py-2 text-xs text-faint">
              <span className="text-paper">⚡ Pattern: </span>
              {avgHhigh > avgHlow
                ? ('High-quality nights average ' + avgHhigh.toFixed(1) + 'h vs ' + avgHlow.toFixed(1) + 'h on poor nights — more sleep → better rest')
                : ('Low-quality nights average ' + avgHlow.toFixed(1) + 'h vs ' + avgHhigh.toFixed(1) + 'h on good nights — shorter sleep linked to poor quality')}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function SleepDOWInsights() {
  var _o = useState(false); var open = _o[0]; var setOpen = _o[1];
  var store = useStore(); var state = store.state;
  var sleepLog = state.anchor.sleep || [];
  if (sleepLog.length < 10) return null;

  var DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var qualSums = [0,0,0,0,0,0,0]; var hourSums = [0,0,0,0,0,0,0]; var counts = [0,0,0,0,0,0,0];
  sleepLog.forEach(function(s){
    var dow = new Date(s.ts).getDay();
    qualSums[dow] += (s.quality||3); hourSums[dow] += (s.hours||7); counts[dow]++;
  });
  var validDows = DOW_NAMES.map(function(name, i){
    return counts[i] >= 2 ? { name:name, qual: qualSums[i]/counts[i], hours: hourSums[i]/counts[i], i:i } : null;
  }).filter(Boolean);
  if (validDows.length < 4) return null;

  var bestQual = validDows.reduce(function(a,b){ return a.qual >= b.qual ? a : b; });
  var worstQual = validDows.reduce(function(a,b){ return a.qual <= b.qual ? a : b; });
  if (bestQual.qual - worstQual.qual < 0.4) return null;

  var mostHours = validDows.reduce(function(a,b){ return a.hours >= b.hours ? a : b; });
  var leastHours = validDows.reduce(function(a,b){ return a.hours <= b.hours ? a : b; });
  var qualColor = function(q){ return q >= 4 ? '#3ddc97' : q >= 3 ? '#6aa0ff' : q >= 2 ? '#ffce6a' : '#ff9aa6'; };
  var qualMax = Math.max.apply(null, validDows.map(function(d){ return d.qual; }));

  return (
    <Card className="border-edge/30 space-y-2">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span>📊</span>
          <span className="text-faint text-sm">Sleep by day of week</span>
        </div>
        <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: open ? '▲' : '▼'}} />
      </button>
      {open && (
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <div className="text-xs text-faint">Avg quality rating</div>
            {validDows.map(function(d){
              var w = Math.round((d.qual / qualMax) * 100);
              return React.createElement('div', { key:d.i, className:'space-y-0.5' },
                React.createElement('div', { className:'flex justify-between text-xs' },
                  React.createElement('span', { className:'text-paper/80' }, d.name),
                  React.createElement('div', { className:'flex gap-2 text-faint tabnum text-[11px]' },
                    React.createElement('span', null, d.qual.toFixed(1) + '/5'),
                    React.createElement('span', { className:'opacity-50' }, d.hours.toFixed(1) + 'h')
                  )
                ),
                React.createElement('div', { className:'h-1.5 bg-panel2 rounded-full overflow-hidden' },
                  React.createElement('div', { className:'h-full rounded-full', style:{ width:w+'%', backgroundColor:qualColor(d.qual) } })
                )
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-panel2 rounded-xl px-3 py-2">
              <div className="text-[10px] text-faint">Best sleep</div>
              <div className="text-sm text-paper font-semibold" style={{color:qualColor(bestQual.qual)}}>{bestQual.name}</div>
              <div className="text-[11px] text-faint tabnum">{bestQual.qual.toFixed(1)}/5 avg</div>
            </div>
            <div className="bg-panel2 rounded-xl px-3 py-2">
              <div className="text-[10px] text-faint">Worst sleep</div>
              <div className="text-sm text-paper font-semibold" style={{color:qualColor(worstQual.qual)}}>{worstQual.name}</div>
              <div className="text-[11px] text-faint tabnum">{worstQual.qual.toFixed(1)}/5 avg</div>
            </div>
          </div>
          {mostHours.hours - leastHours.hours >= 0.5 && (
            <div className="text-xs text-faint px-1">
              {'You get most hours on ' + mostHours.name + 's (' + mostHours.hours.toFixed(1) + 'h) and least on ' + leastHours.name + 's (' + leastHours.hours.toFixed(1) + 'h).'}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function SleepDebtTracker() {
  var store = useStore(); var state = store.state;
  var sleepLog = state.anchor.sleep || [];
  if (sleepLog.length < 3) return null;

  var TARGET = 8;
  var days = [];
  for (var i = 13; i >= 0; i--) {
    var d = new Date(); d.setDate(d.getDate()-i);
    var ds = localDateStr(d);
    var entry = sleepLog.find(function(s){ return s.ts && dayOf(s.ts)===ds; });
    var hours = entry ? entry.hours : null;
    var deficit = hours !== null ? Math.max(0, TARGET-hours) : null;
    var surplus = hours !== null ? Math.max(0, hours-TARGET) : null;
    days.push({ ds:ds, hours:hours, deficit:deficit, surplus:surplus,
      label: new Date(ds+'T12:00:00').toLocaleDateString(undefined,{weekday:'narrow'}) });
  }

  var loggedDays = days.filter(function(d){ return d.hours !== null; });
  if (loggedDays.length < 3) return null;

  var totalDebt = loggedDays.reduce(function(s,d){ return s + (d.deficit||0); }, 0);
  var totalSurplus = loggedDays.reduce(function(s,d){ return s + (d.surplus||0); }, 0);
  var netDebt = Math.round((totalDebt - totalSurplus)*10)/10;
  var avgHours = loggedDays.reduce(function(s,d){ return s+(d.hours||0); },0)/loggedDays.length;

  var debtColor = netDebt <= 0 ? '#22c55e' : netDebt <= 3 ? '#eab308' : netDebt <= 7 ? '#f97316' : '#ef4444';
  var debtLabel = netDebt <= 0 ? 'Well rested' : netDebt <= 3 ? 'Mild debt' : netDebt <= 7 ? 'Moderate debt' : 'High debt';

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span dangerouslySetInnerHTML={{__html:'💤'}} />
          <span className="text-sm font-medium">Sleep debt · 14 days</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold tabnum" style={{color:debtColor}}>{netDebt > 0 ? netDebt+'h' : '0h'}</span>
          <span className="text-[10px]" style={{color:debtColor}}>{debtLabel}</span>
        </div>
      </div>
      <div className="flex items-end gap-0.5 h-10">
        {days.map(function(d, i){
          if (d.hours === null) {
            return React.createElement('div', { key:i, className:'flex-1 flex flex-col items-center gap-0.5' },
              React.createElement('div', { className:'w-full h-4 rounded-sm bg-panel2/40', title:'No data' }),
              React.createElement('span', { className:'text-[8px] text-faint/50' }, d.label)
            );
          }
          var isDeficit = d.deficit > 0;
          var barH = isDeficit ? Math.round((d.deficit/4)*100) : Math.round((d.surplus/2)*100);
          barH = Math.min(100, Math.max(8, barH));
          var bg = isDeficit ? (d.deficit >= 2 ? 'bg-red-400' : 'bg-orange-400') : 'bg-grow';
          return React.createElement('div', { key:i, className:'flex-1 flex flex-col items-center justify-end gap-0.5', title:d.hours+'h — '+(isDeficit?'-'+d.deficit+'h deficit':'+'+d.surplus+'h surplus') },
            React.createElement('div', { className:'w-full rounded-sm '+bg, style:{height:barH+'%'} }),
            React.createElement('span', { className:'text-[8px] text-faint' }, d.label)
          );
        })}
      </div>
      <div className="flex gap-1 text-[10px] text-faint">
        <div className="w-3 h-3 rounded-sm bg-grow flex-shrink-0 mt-0.5" />
        <span>Surplus</span>
        <div className="w-3 h-3 rounded-sm bg-orange-400 flex-shrink-0 mt-0.5 ml-2" />
        <span>Small deficit</span>
        <div className="w-3 h-3 rounded-sm bg-red-400 flex-shrink-0 mt-0.5 ml-2" />
        <span>Large deficit</span>
        <span className="ml-auto">avg {avgHours.toFixed(1)}h/night</span>
      </div>
      {netDebt > 5 && (
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl px-3 py-2 text-xs text-orange-300 leading-snug">
          You have carried significant sleep debt this fortnight. Even one extra hour on weekends accelerates recovery.
        </div>
      )}
    </Card>
  );
}

function MedTracker() {
  const { state, dispatch } = useStore();
  const meds = state.anchor.meds || [];
  const medLog = state.anchor.medLog || [];
  const todayStr = todayKey();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTime, setNewTime] = useState('morning');
  const MED_ICONS = ['💊','💉','🧴','🌿','🥤','🧪'];
  const [pickIcon, setPickIcon] = useState('💊');
  const taken = function(id){ return medLog.some(function(e){ return e.key === id+':'+todayStr; }); };
  const takenCount = meds.filter(function(m){ return taken(m.id); }).length;

  if (meds.length === 0 && !adding) return (
    <Card className="border-edge/30 cursor-pointer hover:border-calm/40" onClick={function(){ setAdding(true); }}>
      <div className="flex items-center gap-3">
        <span className="text-2xl">💊</span>
        <div className="flex-1">
          <div className="font-semibold text-paper">Track medications</div>
          <div className="text-faint text-sm">Never miss a dose</div>
        </div>
      </div>
    </Card>
  );

  return (
    <Card className="border-edge/30">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">💊</span>
          <span className="text-faint text-sm">Medications</span>
        </div>
        <span className="text-faint text-sm">{takenCount}/{meds.length} taken</span>
      </div>
      <div className="space-y-1">
        {meds.map(function(m){
          const isDone = taken(m.id);
          return (
            <div key={m.id} className={'flex items-center gap-2 px-2 py-1.5 rounded-xl cursor-pointer transition ' + (isDone ? 'bg-grow/10' : 'hover:bg-panel2')}
              onClick={function(){ dispatch({type:'TOGGLE_MED', id:m.id}); buzz(15); }}>
              <span className="text-lg">{isDone ? '✅' : m.icon}</span>
              <span className={'flex-1 text-sm ' + (isDone ? 'text-faint line-through' : 'text-paper')}>{m.name}</span>
              <span className="text-faint text-[10px]">{m.time}</span>
              <button onClick={function(e){ e.stopPropagation(); dispatch({type:'REMOVE_MED', id:m.id}); }}
                className="text-faint hover:text-rose text-sm ml-1">✕</button>
            </div>
          );
        })}
      </div>
      {adding ? (
        <div className="mt-2 space-y-2">
          <div className="flex gap-1 flex-wrap">{MED_ICONS.map(function(ic){
            return <button key={ic} onClick={function(){setPickIcon(ic);}}
              className={'text-lg p-1.5 rounded-lg border ' + (pickIcon===ic ? 'border-calm bg-panel2' : 'border-transparent')}>{ic}</button>;
          })}</div>
          <div className="flex gap-2">
            <input value={newName} onChange={function(e){setNewName(e.target.value);}} placeholder="Medication name..."
              onKeyDown={function(e){ if(e.key==='Enter' && newName.trim()){ dispatch({type:'ADD_MED',name:newName.trim(),time:newTime,icon:pickIcon}); setNewName(''); setAdding(false); } }}
              autoFocus className="flex-1 bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-sm outline-none focus:border-calm" />
            <select value={newTime} onChange={function(e){setNewTime(e.target.value);}}
              className="bg-panel2 border border-edge rounded-xl px-2 py-2 text-paper text-sm outline-none">
              <option value="morning">AM</option>
              <option value="evening">PM</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Btn tone="calm" onClick={function(){ if(newName.trim()){ dispatch({type:'ADD_MED',name:newName.trim(),time:newTime,icon:pickIcon}); setNewName(''); setAdding(false); } }}
              disabled={!newName.trim()} className="flex-1">Add</Btn>
            <Btn tone="ghost" onClick={function(){setAdding(false);setNewName('');}} className="flex-1">Cancel</Btn>
          </div>
        </div>
      ) : (
        <button onClick={function(){setAdding(true);}} className="mt-2 text-faint hover:text-calm text-sm">+ add medication</button>
      )}
      {takenCount === meds.length && meds.length > 0 && <div className="text-center text-grow text-sm mt-2">All taken today ✓</div>}
    </Card>
  );
}

function MedAdherence() {
  var [open, setOpen] = useState(false);
  var store = useStore(); var state = store.state;
  var meds = state.anchor.meds || [];
  var medLog = state.anchor.medLog || [];
  if (meds.length === 0 || medLog.length === 0) return null;
  var now = new Date();
  var days30 = [];
  for (var i = 29; i >= 0; i--) {
    var d = new Date(now); d.setDate(d.getDate()-i);
    days30.push(localDateStr(d));
  }
  var medStats = meds.map(function(m) {
    var taken = days30.filter(function(ds) {
      return medLog.some(function(e){ return e.key === m.id+':'+ds; });
    }).length;
    var pct = Math.round((taken / 30) * 100);
    var streak = 0;
    for (var si = 0; si < days30.length; si++) {
      var ds = days30[days30.length-1-si];
      if (medLog.some(function(e){ return e.key === m.id+':'+ds; })) streak++;
      else break;
    }
    return { id:m.id, name:m.name, icon:m.icon||'💊', taken:taken, pct:pct, streak:streak };
  });
  var overallPct = Math.round(medStats.reduce(function(s,m){ return s+m.pct; },0) / medStats.length);
  var color = overallPct >= 80 ? 'text-grow' : overallPct >= 50 ? 'text-warm' : 'text-rose';
  return (
    <Card className="border-edge/30">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span className="text-base">💊</span>
          <span className="text-faint text-sm">Medication adherence</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={'font-bold tabnum text-sm ' + color}>{overallPct}%</span>
          <span className="text-faint text-xs">{open?'▲':'▼'}</span>
        </div>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="text-faint text-[11px]">Last 30 days</div>
          {medStats.map(function(m) {
            var barColor = m.pct >= 80 ? '#3ddc97' : m.pct >= 50 ? '#ffce6a' : '#ff9aa6';
            return (
              <div key={m.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span>{m.icon}</span>
                    <span className="text-paper">{m.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-faint">
                    {m.streak > 0 && <span className="text-[10px]">🔥{m.streak}d streak</span>}
                    <span className="tabnum font-semibold" style={{color:barColor}}>{m.pct}%</span>
                  </div>
                </div>
                <div className="h-2 bg-panel2 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{width:m.pct+'%', backgroundColor:barColor}} />
                </div>
                <div className="text-faint text-[10px]">{m.taken}/30 days taken</div>
              </div>
            );
          })}
          <div className="text-xs text-faint italic px-1">
            {overallPct >= 80 ? 'Great consistency — keep it up.' :
             overallPct >= 50 ? 'Room to improve. Even one more day a week shifts this.' :
             'Missing doses has compounding effects. Small steps matter.'}
          </div>
        </div>
      )}
    </Card>
  );
}

function MedTimeInsights() {
  var _o = useState(false); var open = _o[0]; var setOpen = _o[1];
  var store = useStore(); var state = store.state;
  var meds = state.anchor.meds || [];
  var medLog = state.anchor.medLog || [];
  if (meds.length === 0 || medLog.length < 7) return null;

  var now = new Date();
  var days30 = [];
  for (var i = 29; i >= 0; i--) {
    var d = new Date(now); d.setDate(d.getDate()-i);
    days30.push({ ds: localDateStr(d), dow: d.getDay() });
  }

  var amMeds = meds.filter(function(m){ return m.time === 'morning' || m.time === 'both'; });
  var pmMeds = meds.filter(function(m){ return m.time === 'evening' || m.time === 'both'; });

  var adherenceForGroup = function(group) {
    if (!group.length) return null;
    var total = 0; var taken = 0;
    group.forEach(function(m){
      days30.forEach(function(day){
        total++;
        if (medLog.some(function(e){ return e.key === m.id+':'+day.ds; })) taken++;
      });
    });
    return total ? Math.round((taken/total)*100) : null;
  };

  var amPct = adherenceForGroup(amMeds);
  var pmPct = adherenceForGroup(pmMeds);

  var DOW_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var dowMiss = [0,0,0,0,0,0,0]; var dowTotal = [0,0,0,0,0,0,0];
  meds.forEach(function(m){
    days30.forEach(function(day){
      dowTotal[day.dow]++;
      if (!medLog.some(function(e){ return e.key === m.id+':'+day.ds; })) dowMiss[day.dow]++;
    });
  });
  var dowMissRates = DOW_NAMES.map(function(name, i){
    return dowTotal[i] > 0 ? { name:name, rate: dowMiss[i]/dowTotal[i], i:i } : null;
  }).filter(Boolean);

  var worstDow = null;
  if (dowMissRates.length >= 5) {
    var sorted = dowMissRates.slice().sort(function(a,b){ return b.rate - a.rate; });
    if (sorted[0].rate - sorted[1].rate >= 0.1) worstDow = sorted[0];
  }

  if (amPct === null && pmPct === null && !worstDow) return null;

  var barColor = function(pct){ return pct >= 80 ? '#3ddc97' : pct >= 50 ? '#ffce6a' : '#ff9aa6'; };

  return (
    <Card className="border-edge/30 space-y-2">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span>⏰</span>
          <span className="text-faint text-sm">Dose timing patterns</span>
        </div>
        <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: open ? '▲' : '▼'}} />
      </button>
      {open && (
        <div className="space-y-3 pt-1">
          {amPct !== null && pmPct !== null && (
            <div className="space-y-2">
              <div className="text-xs text-faint">AM vs PM adherence (30 days)</div>
              {[['Morning 🌅', amPct], ['Evening 🌙', pmPct]].map(function(row){
                return React.createElement('div', { key:row[0], className:'space-y-0.5' },
                  React.createElement('div', { className:'flex justify-between text-xs' },
                    React.createElement('span', { className:'text-paper', dangerouslySetInnerHTML:{__html:row[0]} }),
                    React.createElement('span', { className:'tabnum font-semibold', style:{color:barColor(row[1])} }, row[1]+'%')
                  ),
                  React.createElement('div', { className:'h-2 bg-panel2 rounded-full overflow-hidden' },
                    React.createElement('div', { className:'h-full rounded-full', style:{width:row[1]+'%', backgroundColor:barColor(row[1])} })
                  )
                );
              })}
              {amPct !== pmPct && (
                <div className="text-xs text-faint italic">
                  {amPct < pmPct ? 'Morning doses are harder to remember. Try a visible cue near your toothbrush.' : 'Evening doses slip more. A bedside reminder can help.'}
                </div>
              )}
            </div>
          )}
          {worstDow && (
            <div className="bg-panel2 rounded-xl px-3 py-2">
              <div className="text-xs text-faint">Toughest day</div>
              <div className="text-sm text-paper">{worstDow.name + 's have the most missed doses (' + Math.round(worstDow.rate*100) + '% miss rate). Worth setting a ' + worstDow.name + ' reminder.'}</div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function GratitudeJournal() {
  const { state, dispatch } = useStore();
  const todayStr = todayKey();
  const todayEntry = (state.anchor.gratitude||[]).find(g => dayOf(g.ts) === todayStr);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(['','','']);
  const [promptIdx, setPromptIdx] = useState(new Date().getDate() % 12);
  const [gCat, setGCat] = useState('');
  const GCATS = [
    { key:'People', icon:'🤝' },
    { key:'Small joys', icon:'✨' },
    { key:'Nature', icon:'🌿' },
    { key:'Body', icon:'💪' },
    { key:'Achievement', icon:'🏆' },
    { key:'Growth', icon:'🌱' },
  ];
  const upd = (i,v) => setItems(s => s.map((x,j) => j===i ? v : x));
  const valid = items.some(x => x.trim());
  const save = () => { dispatch({ type:'GRATITUDE_LOG', items: items.filter(x=>x.trim()), category: gCat }); buzz(20); chime(660,0.3); setOpen(false); setGCat(''); };

  var GPROMPTS = [
    'What small comfort made today easier?',
    'Who made you feel seen recently?',
    'What did your body do well today?',
    'What beauty did you notice?',
    'What would you miss if it were gone?',
    'What are you glad you didn\'t have to do today?',
    'Who showed up for you this week?',
    'What skill or strength do you have?',
    'What moment of peace did you have?',
    'What are you learning right now?',
    'What food or drink brought you comfort?',
    'What made you smile, even briefly?',
  ];

  if (todayEntry) return (
    <Card className="border-warm/30">
      <div className="flex items-center gap-2 mb-2"><span className="text-xl">🌻</span><span className="text-faint text-sm">Today I am grateful for</span></div>
      <div className="space-y-1">{todayEntry.items.map((it,i) => <div key={i} className="text-paper text-sm pl-4">· {it}</div>)}</div>
    </Card>
  );

  if (!open) return (
    <Card className="border-warm/20 cursor-pointer hover:border-warm/40" onClick={() => setOpen(true)}>
      <div className="flex items-center gap-2"><span className="text-xl">🌻</span><span className="text-paper font-semibold">Gratitude check</span></div>
      <div className="text-faint text-sm mt-1">Name 3 things you are grateful for today</div>
    </Card>
  );

  return (
    <Card className="border-warm/40 space-y-2">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2"><span className="text-xl">🌻</span><span className="text-faint text-sm">3 things you are grateful for</span></div>
        <button className="text-xs text-faint hover:text-warm" onClick={function(){ setPromptIdx((promptIdx+1) % GPROMPTS.length); }}>prompt ✦</button>
      </div>
      <div className="text-xs italic text-warm/70 px-1">{GPROMPTS[promptIdx]}</div>
      {items.map((it,i) => (
        <input key={i} value={it} onChange={e=>upd(i,e.target.value)} placeholder={(i+1)+'. ...'} autoFocus={i===0}
          className="w-full bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-sm outline-none focus:border-warm" />
      ))}
      <div>
        <div className="text-[11px] text-faint mb-1.5">What theme is this gratitude? (optional)</div>
        <div className="flex flex-wrap gap-1.5">
          {GCATS.map(function(c){
            return React.createElement('button', {
              key:c.key,
              onClick: function(){ setGCat(gCat===c.key?'':c.key); },
              className: 'flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border transition ' +
                (gCat===c.key ? 'bg-warm/25 border-warm/50 text-warm' : 'border-edge/40 text-faint hover:border-warm/30')
            },
              React.createElement('span', { dangerouslySetInnerHTML:{__html:c.icon} }),
              c.key
            );
          })}
        </div>
      </div>
      <div className="flex gap-2">
        <Btn tone="ghost" className="flex-1" onClick={()=>{ setOpen(false); setGCat(''); }}>Cancel</Btn>
        <Btn tone="grow" className="flex-1" onClick={save} disabled={!valid}>Save</Btn>
      </div>
    </Card>
  );
}

var WEEKLY_QS = [
  { key:'wins',    label:'What went well this week?',            placeholder:'Even small wins count...' },
  { key:'hard',    label:'What was the hardest part?',           placeholder:'Be honest with yourself...' },
  { key:'learned', label:'What did I learn about myself?',       placeholder:'Patterns, triggers, strengths...' },
  { key:'next',    label:'What do I want to focus on next week?',placeholder:'One intention is enough...' },
  { key:'body',    label:'How did my body feel overall?',        placeholder:'Energy, sleep, pain, mood...' },
];

function WeeklyReflection() {
  var _s = useStore(); var state = _s.state; var dispatch = _s.dispatch;
  var now = new Date();
  var dayOfWeek = now.getDay();
  var weekNum = Math.floor((now - new Date(now.getFullYear(),0,1)) / 604800000);
  var weekKey = now.getFullYear() + '-W' + String(weekNum).padStart(2,'0');
  var reflections = state.anchor.weeklyReflections || [];
  var thisWeek = reflections.find(function(r){ return r.week === weekKey; });
  var isSunday = dayOfWeek === 0;
  var [open, setOpen] = useState(false);
  var [answers, setAnswers] = useState({});
  var [viewPast, setViewPast] = useState(false);
  var upd = function(k,v){ setAnswers(function(a){ var n={}; Object.assign(n,a); n[k]=v; return n; }); };
  var valid = Object.values(answers).some(function(v){ return v && v.trim(); });
  function save() {
    dispatch({ type:'WEEKLY_REFLECTION', week: weekKey, answers: answers });
    buzz(25); chime(528, 0.4); setOpen(false); setAnswers({});
  }
  if (!isSunday && reflections.length === 0) return null;
  if (thisWeek && !viewPast) return (
    <Card className="border-grow/30 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><span className="text-lg">📋</span><span className="text-sm font-medium text-grow">This week reviewed</span></div>
        <button className="text-xs text-faint hover:text-paper" onClick={function(){ setViewPast(true); }}>view past</button>
      </div>
      {WEEKLY_QS.filter(function(q){ return thisWeek.answers[q.key]; }).map(function(q){
        return (
          <div key={q.key} className="text-xs space-y-0.5">
            <div className="text-faint">{q.label}</div>
            <div className="text-paper pl-2">{thisWeek.answers[q.key]}</div>
          </div>
        );
      })}
    </Card>
  );
  if (viewPast) {
    var past = reflections.slice(0,5);
    return (
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><span>📋</span><span className="text-sm font-medium">Weekly reflections</span></div>
          <button className="text-xs text-faint" onClick={function(){ setViewPast(false); }}>‹ back</button>
        </div>
        {past.map(function(r,i){
          var filled = WEEKLY_QS.filter(function(q){ return r.answers[q.key]; });
          return (
            <div key={i} className="border-t border-edge/30 pt-2 space-y-1">
              <div className="text-xs text-faint">{r.week} &middot; {new Date(r.ts).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</div>
              {filled.slice(0,2).map(function(q){
                return <div key={q.key} className="text-xs text-paper pl-2">“{r.answers[q.key]}”</div>;
              })}
              {filled.length > 2 && <div className="text-[10px] text-faint">+{filled.length-2} more</div>}
            </div>
          );
        })}
      </Card>
    );
  }
  if (!open) return (
    <Card className={'cursor-pointer hover:border-grow/40 ' + (isSunday ? 'border-grow/30' : 'border-edge/20')}
      onClick={function(){ setOpen(true); setAnswers({}); }}>
      <div className="flex items-center gap-2">
        <span className="text-xl">📋</span>
        <div>
          <div className="text-paper font-semibold text-sm">{isSunday ? 'Sunday reflection' : 'Weekly reflection'}</div>
          <div className="text-faint text-xs">{isSunday ? 'Take 5 min to review your week' : 'Tap to reflect on the week'}</div>
        </div>
      </div>
      {reflections.length > 0 && <div className="text-[10px] text-faint mt-1">{reflections.length} reflection{reflections.length!==1?'s':''} saved</div>}
    </Card>
  );
  return (
    <Card className="border-grow/40 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><span className="text-lg">📋</span><span className="text-sm font-medium">Weekly reflection</span></div>
        <button className="text-xs text-faint" onClick={function(){ setOpen(false); }}>cancel</button>
      </div>
      <div className="text-xs text-faint">Answer what feels true. No pressure to fill everything.</div>
      {WEEKLY_QS.map(function(q){
        return (
          <div key={q.key} className="space-y-1">
            <div className="text-xs text-faint">{q.label}</div>
            <textarea value={answers[q.key]||''} onChange={function(e){ upd(q.key, e.target.value); }}
              placeholder={q.placeholder} rows={2}
              className="w-full bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-sm outline-none focus:border-grow resize-none" />
          </div>
        );
      })}
      <Btn tone="grow" className="w-full" onClick={save} disabled={!valid}>Save reflection</Btn>
    </Card>
  );
}

function GratitudeStreak() {
  var _s = useStore(); var state = _s.state;
  var gratitude = (state.anchor.gratitude || []);
  if (gratitude.length < 3) return null;
  var dates = new Set(gratitude.map(function(g){ return g.ts ? dayOf(g.ts) : ''; }));
  var streak = 0;
  for (var i = 0; i < 365; i++) {
    var d = new Date(); d.setDate(d.getDate()-i);
    if (dates.has(localDateStr(d))) { streak++; } else { break; }
  }
  var longest = 0; var cur = 0;
  var sorted = Array.from(dates).sort();
  for (var j = 0; j < sorted.length; j++) {
    if (j === 0) { cur = 1; } else {
      var prev = new Date(sorted[j-1]+'T12:00:00');
      var curr = new Date(sorted[j]+'T12:00:00');
      var diff = Math.round((curr-prev)/86400000);
      cur = diff === 1 ? cur+1 : 1;
    }
    if (cur > longest) longest = cur;
  }
  var days14 = Array.from({length:14}, function(_,i){
    var d2 = new Date(); d2.setDate(d2.getDate()-13+i);
    var ds2 = localDateStr(d2);
    return { ds: ds2, has: dates.has(ds2), label: new Date(ds2+'T12:00:00').toLocaleDateString(undefined,{weekday:'narrow'}) };
  });
  var color = streak >= 7 ? 'text-warm' : streak >= 3 ? 'text-grow' : 'text-faint';
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🍋</span>
          <span className="text-sm font-medium">Gratitude streak</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={color + ' font-bold'}>{streak} day{streak!==1?'s':''}</span>
          {longest > streak && <span className="text-faint">best {longest}</span>}
        </div>
      </div>
      <div className="flex gap-1">
        {days14.map(function(d2){
          return (
            <div key={d2.ds} className="flex-1 flex flex-col items-center gap-0.5">
              <div className={'h-5 w-full rounded ' + (d2.has ? 'bg-warm/60' : 'bg-edge/20')}></div>
              {d2.label === 'S' || d2.label === 'M' || d2.label === 'Su' || true
                ? <span className="text-[8px] text-faint">{d2.label}</span>
                : null}
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 text-[11px] text-faint">
        <span>{gratitude.length} total entries</span>
        <span>longest {longest}-day run</span>
      </div>
    </Card>
  );
}

function BedtimeCountdown() {
  var store = useStore(); var state = store.state;
  var now = new Date();
  var hour = now.getHours();
  if (hour < 17 || hour >= 24) return null;
  var todayStr = localDateStr(now);
  var sleptToday = (state.anchor.sleep||[]).some(function(s){ return (s.date||'') === todayStr || (s.ts||'').slice(0,10) === todayStr; });
  if (sleptToday) return null;
  var bedtime = (state.user.preferences && state.user.preferences.bedtime) || '22:00';
  var parts = bedtime.split(':'); var btH = parseInt(parts[0]||22); var btM = parseInt(parts[1]||0);
  var target = new Date(now); target.setHours(btH, btM, 0, 0);
  if (target <= now) return null;
  var diffMs = target - now;
  var diffMins = Math.floor(diffMs / 60000);
  var hrs = Math.floor(diffMins / 60);
  var mins = diffMins % 60;
  var urgency = diffMins <= 30 ? 'rose' : diffMins <= 60 ? 'warm' : 'faint';
  var msg = diffMins <= 15 ? 'Time to wind down — bedtime is almost here.'
    : diffMins <= 60 ? 'Start winding down soon for a good sleep.'
    : 'Plan your evening with your bedtime in mind.';
  return (
    <div className={'rounded-xl border px-4 py-3 flex items-center gap-3 ' + (urgency==='rose'?'border-rose/30 bg-rose/5':urgency==='warm'?'border-warm/25 bg-warm/5':'border-edge/20 bg-panel')}>
      <span className="text-xl flex-shrink-0" dangerouslySetInnerHTML={{__html: urgency==='rose'?'😴':'🌙'}} />
      <div className="flex-1 min-w-0">
        <div className={'text-xs tabnum font-semibold ' + (urgency==='rose'?'text-rose':urgency==='warm'?'text-warm':'text-paper')}>
          {hrs > 0 ? hrs + 'h ' : ''}{mins}m to bedtime ({bedtime})
        </div>
        <div className="text-[10px] text-faint mt-0.5">{msg}</div>
      </div>
    </div>
  );
}

function GratitudeWeeklyDigest() {
  var store = useStore(); var state = store.state;
  var gratitude = state.anchor.gratitude || [];
  var weekAgo = localDateStr(new Date(Date.now() - 6 * dayMs));
  var thisWeek = gratitude.filter(function(g){ return g.ts && dayOf(g.ts) >= weekAgo; });
  var _o = useState(false); var open = _o[0]; var setOpen = _o[1];
  if (thisWeek.length < 2) return null;
  var allItems = [];
  thisWeek.forEach(function(g){ (g.items||[]).forEach(function(it){ if(it.trim()) allItems.push({ text:it.trim(), ts:g.ts }); }); });
  if (allItems.length < 3) return null;
  var totalItems = allItems.length;
  function fmtDay(ts) {
    var d = new Date(ts); var now = new Date();
    var diff = Math.floor((now - d) / dayMs);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString('en-ZA', { weekday:'long' });
  }
  var grouped = {};
  thisWeek.forEach(function(g){ var dk = dayOf(g.ts); if(!grouped[dk]) grouped[dk]=[]; grouped[dk].push(g); });
  var days = Object.keys(grouped).sort().reverse();
  return (
    <div className="rounded-xl border border-warm/15 bg-panel p-3 space-y-2">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span className="text-base" dangerouslySetInnerHTML={{__html:'🌟'}} />
          <span className="text-xs font-semibold text-paper">This week in gratitude</span>
          <span className="text-[10px] text-warm/80 tabnum">{totalItems} things</span>
        </div>
        <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: open ? '▲' : '▼'}} />
      </button>
      {open && React.createElement('div', { className:'space-y-3 pt-1' },
        days.map(function(dk){
          var dayEntries = grouped[dk];
          var dayItems = [];
          dayEntries.forEach(function(g){ (g.items||[]).forEach(function(it){ if(it.trim()) dayItems.push(it.trim()); }); });
          return React.createElement('div', { key:dk },
            React.createElement('div', { className:'text-[10px] text-faint mb-1' }, fmtDay(dayEntries[0].ts)),
            React.createElement('ul', { className:'space-y-0.5 pl-2' },
              dayItems.map(function(it, i){
                return React.createElement('li', { key:i, className:'text-sm text-paper/80 flex items-start gap-1.5' },
                  React.createElement('span', { className:'text-warm/60 mt-0.5 flex-shrink-0', dangerouslySetInnerHTML:{__html:'♥'} }),
                  it
                );
              })
            )
          );
        }),
        React.createElement('div', { className:'pt-2 border-t border-edge/20 text-[10px] text-faint italic text-center' },
          'You found ' + totalItems + ' things worth being grateful for this week.'
        )
      )}
    </div>
  );
}

function MoodTriggerInsights() {
  var _o = useState(false); var open = _o[0]; var setOpen = _o[1];
  var store = useStore(); var state = store.state;
  var moodLog = state.anchor.moodLog || [];
  var tagged = moodLog.filter(function(m){ return m.trigger && (m.mood==='low'||m.mood==='anxious'); });
  if (tagged.length < 3) return null;

  var counts = {};
  tagged.forEach(function(m){ counts[m.trigger] = (counts[m.trigger]||0)+1; });
  var sorted = Object.keys(counts).sort(function(a,b){ return counts[b]-counts[a]; });
  var maxCount = counts[sorted[0]] || 1;

  var moodVal = { great:5, good:4, ok:3, low:2, anxious:1 };

  return (
    <Card className="space-y-2">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span dangerouslySetInnerHTML={{__html:'⚠'}} />
          <span className="text-sm font-medium">Mood triggers</span>
          <span className="text-[10px] text-faint">{tagged.length} tagged</span>
        </div>
        <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: open ? '▲' : '▼'}} />
      </button>
      <div className="space-y-2 pt-1 border-t border-edge/20">
        <div className="text-[10px] text-faint">What tends to bring your mood down:</div>
        {sorted.map(function(trigger){
          var pct = Math.round((counts[trigger]/maxCount)*100);
          var isTop = trigger === sorted[0];
          return (
            <div key={trigger} className="space-y-0.5">
              <div className="flex items-center justify-between text-xs">
                <span className={isTop ? 'text-rose font-medium' : 'text-faint'}>{trigger}</span>
                <span className="text-faint tabnum">{counts[trigger]}x</span>
              </div>
              <div className="h-1.5 bg-panel2 rounded-full overflow-hidden">
                <div className={'h-full rounded-full ' + (isTop ? 'bg-rose/70' : 'bg-rose/30')} style={{width:pct+'%'}} />
              </div>
            </div>
          );
        })}
      </div>
      {open && (
        <div className="text-[10px] text-faint italic border-t border-edge/20 pt-1">
          Trigger data is tagged by you during low or anxious check-ins. More data improves accuracy.
        </div>
      )}
    </Card>
  );
}

function MoodCalendarYear() {
  var _hover = useState(null); var hovered = _hover[0]; var setHovered = _hover[1];
  var store = useStore(); var state = store.state;
  var moodLog = state.anchor.moodLog || [];
  if (moodLog.length < 7) return null;

  var moodVal   = { great:5, good:4, ok:3, low:2, anxious:1 };
  var moodColor = { great:'#4ade80', good:'#6aa0ff', ok:'#a78bfa', low:'#facc15', anxious:'#f87171' };

  // Build day-keyed map of best (avg) mood
  var dayMap = {};
  moodLog.forEach(function(m){
    var d = dayOf(m.ts);
    if (!dayMap[d]) dayMap[d] = [];
    dayMap[d].push(m);
  });

  // Build 365-day grid ending today
  var today = new Date();
  today.setHours(0,0,0,0);
  var days = [];
  for (var i = 364; i >= 0; i--) {
    var d = new Date(today);
    d.setDate(d.getDate() - i);
    var ds = localDateStr(d);
    var entries = dayMap[ds] || [];
    var color = '#1e2030';
    var topMood = '';
    if (entries.length > 0) {
      var avg = entries.reduce(function(s,m){ return s+(moodVal[m.mood]||3); },0) / entries.length;
      var best = entries.reduce(function(b,m){ return (moodVal[m.mood]||3)>(moodVal[b.mood]||3)?m:b; }, entries[0]);
      topMood = best.mood;
      color = moodColor[topMood] || '#a78bfa';
    }
    days.push({ ds: ds, color: color, count: entries.length, mood: topMood, dow: d.getDay() });
  }

  // Group into weeks (cols)
  var firstDow = days[0].dow;
  var weeks = [];
  var cur = [];
  // Pad start
  for (var p = 0; p < firstDow; p++) cur.push(null);
  days.forEach(function(d){
    cur.push(d);
    if (cur.length === 7) { weeks.push(cur); cur = []; }
  });
  if (cur.length > 0) {
    while (cur.length < 7) cur.push(null);
    weeks.push(cur);
  }

  // Month labels: track which week each month starts in
  var monthLabels = {};
  weeks.forEach(function(wk, wi){
    wk.forEach(function(cell){
      if (!cell) return;
      var m = cell.ds.slice(0,7);
      if (!monthLabels[m]) monthLabels[m] = wi;
    });
  });
  var MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  var cellSize = 11;
  var gap = 2;
  var rowH = cellSize + gap;
  var colW = cellSize + gap;
  var gridW = weeks.length * colW;
  var gridH = 7 * rowH;

  return (
    <Card className="border-edge/30 overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-base">📅</span>
          <span className="font-semibold text-sm">Mood Year</span>
        </div>
        <div className="flex items-center gap-1 text-[9px] text-faint">
          {Object.keys(moodColor).map(function(k){
            return React.createElement('span', { key: k, className: 'flex items-center gap-0.5' },
              React.createElement('span', { style: { display:'inline-block', width:7, height:7, borderRadius:2, background: moodColor[k] } }),
              k
            );
          })}
        </div>
      </div>
      <div style={{overflowX:'auto'}}>
        <div style={{position:'relative', width: gridW + 26 + 'px', minWidth: gridW + 26 + 'px'}}>
          {/* Month labels */}
          <div style={{position:'relative', height:14, marginLeft:26}}>
            {Object.keys(monthLabels).map(function(m){
              var wi = monthLabels[m];
              return React.createElement('span', {
                key: m,
                style: { position:'absolute', left: wi * colW, fontSize:9, color:'#6b7280', whiteSpace:'nowrap' }
              }, MONTH_SHORT[parseInt(m.slice(5,7),10)-1]);
            })}
          </div>
          {/* Grid */}
          <div style={{display:'flex', gap: gap + 'px'}}>
            {/* DOW labels */}
            <div style={{display:'flex', flexDirection:'column', gap: gap + 'px', marginTop:0}}>
              {DOW.map(function(d,i){
                return React.createElement('div', { key:d, style: { height: cellSize, width:22, fontSize:8, color:'#6b7280', display:'flex', alignItems:'center', opacity: (i%2===1)?1:0 } }, d);
              })}
            </div>
            {/* Week columns */}
            {weeks.map(function(wk, wi){
              return React.createElement('div', { key:wi, style:{ display:'flex', flexDirection:'column', gap: gap+'px' } },
                wk.map(function(cell, di){
                  if (!cell) return React.createElement('div', { key:di, style:{ width:cellSize, height:cellSize } });
                  return React.createElement('div', {
                    key: cell.ds,
                    title: cell.ds + (cell.count ? ' · ' + cell.mood + ' (' + cell.count + 'x)' : ''),
                    onMouseEnter: function(){ setHovered(cell); },
                    onMouseLeave: function(){ setHovered(null); },
                    style: {
                      width: cellSize, height: cellSize,
                      borderRadius: 2,
                      background: cell.color,
                      opacity: cell.count ? 1 : 0.12,
                      cursor: cell.count ? 'pointer' : 'default',
                      transition: 'transform 0.1s',
                      transform: (hovered && hovered.ds === cell.ds) ? 'scale(1.4)' : 'scale(1)'
                    }
                  });
                })
              );
            })}
          </div>
        </div>
      </div>
      {hovered && hovered.count > 0 && (
        <div className="mt-2 text-xs text-faint border-t border-edge/20 pt-1">
          <span className="font-semibold" style={{color: moodColor[hovered.mood]}}>{hovered.mood}</span>
          <span> &middot; {hovered.ds} &middot; {hovered.count} check-in{hovered.count>1?'s':''}</span>
        </div>
      )}
    </Card>
  );
}

function CrossInsights() {
  var store = useStore(); var state = store.state;
  var moodLog = state.anchor.moodLog || [];
  var sleepLog = state.anchor.sleep || [];
  var meditationLog = state.anchor.meditationLog || [];
  var habitLog = state.anchor.habitLog || [];
  var habits = state.anchor.habits || [];
  var energyLog = state.anchor.energyLog || [];
  var _o = useState(false); var open = _o[0]; var setOpen = _o[1];

  if (moodLog.length < 7) return null;

  var moodVal = { great:5, good:4, ok:3, low:2, anxious:1 };
  var insights = [];

  function avgMoodForDates(dates) {
    if (!dates.length) return null;
    var matched = moodLog.filter(function(m){ return dates.indexOf(dayOf(m.ts)) >= 0; });
    if (!matched.length) return null;
    return matched.reduce(function(s,m){ return s+(moodVal[m.mood]||3); },0)/matched.length;
  }

  // Sleep > 7h vs < 6h mood
  if (sleepLog.length >= 5 && moodLog.length >= 10) {
    var longSleepDates = sleepLog.filter(function(s){ return s.hours >= 7; }).map(function(s){ return dayOf(s.ts); });
    var shortSleepDates = sleepLog.filter(function(s){ return s.hours < 6; }).map(function(s){ return dayOf(s.ts); });
    var avgLong = avgMoodForDates(longSleepDates);
    var avgShort = avgMoodForDates(shortSleepDates);
    if (avgLong !== null && avgShort !== null && avgLong - avgShort >= 0.5) {
      insights.push({ icon:'😴', text:'You score ' + (avgLong - avgShort).toFixed(1) + ' pts higher on mood after 7+ hours of sleep (' + avgLong.toFixed(1) + ' vs ' + avgShort.toFixed(1) + ').' });
    }
  }

  // Meditation days vs non-meditation mood
  if (meditationLog.length >= 5 && moodLog.length >= 10) {
    var medDates = meditationLog.map(function(m){ return dayOf(m.ts); });
    var nonMedDates = moodLog.map(function(m){ return dayOf(m.ts); }).filter(function(d){ return medDates.indexOf(d) < 0; });
    var avgMed = avgMoodForDates(medDates);
    var avgNonMed = avgMoodForDates(nonMedDates);
    if (avgMed !== null && avgNonMed !== null && Math.abs(avgMed - avgNonMed) >= 0.4) {
      if (avgMed > avgNonMed) {
        insights.push({ icon:'🧘', text:'Meditation days show +' + (avgMed - avgNonMed).toFixed(1) + ' mood lift (' + avgMed.toFixed(1) + ' vs ' + avgNonMed.toFixed(1) + ' on non-meditation days).' });
      } else {
        insights.push({ icon:'🧘', text:'You meditate most when mood is lower — using it as a coping tool. That is exactly what it is for.' });
      }
    }
  }

  // Energy high days vs mood
  if (energyLog.length >= 5 && moodLog.length >= 10) {
    var highEnergyDates = energyLog.filter(function(e){ return e.level >= 4; }).map(function(e){ return dayOf(e.ts); });
    var lowEnergyDates  = energyLog.filter(function(e){ return e.level <= 2; }).map(function(e){ return dayOf(e.ts); });
    var avgHighE = avgMoodForDates(highEnergyDates);
    var avgLowE  = avgMoodForDates(lowEnergyDates);
    if (avgHighE !== null && avgLowE !== null && avgHighE - avgLowE >= 0.5) {
      insights.push({ icon:'⚡', text:'On high-energy days your mood is ' + (avgHighE - avgLowE).toFixed(1) + ' pts better (' + avgHighE.toFixed(1) + ' vs ' + avgLowE.toFixed(1) + '). Energy and mood move together for you.' });
    }
  }

  // Habit completion rate vs mood
  if (habits.length >= 2 && moodLog.length >= 10 && habitLog.length >= 20) {
    var allLogDates = new Set(habitLog.map(function(e){ return dayOf(e.ts); }));
    var moodDates = moodLog.map(function(m){ return dayOf(m.ts); });
    var highHabitDates = [];
    var lowHabitDates = [];
    allLogDates.forEach(function(ds){
      var done = habits.filter(function(h){
        return habitLog.some(function(e){ return e.key === h.id+':'+ds; });
      }).length;
      var rate = done / habits.length;
      if (rate >= 0.75) highHabitDates.push(ds);
      else if (rate <= 0.25) lowHabitDates.push(ds);
    });
    var avgHighH = avgMoodForDates(highHabitDates);
    var avgLowH  = avgMoodForDates(lowHabitDates);
    if (avgHighH !== null && avgLowH !== null && avgHighH - avgLowH >= 0.4) {
      insights.push({ icon:'✅', text:'Days where you complete 75%+ of habits score ' + (avgHighH - avgLowH).toFixed(1) + ' pts higher on mood (' + avgHighH.toFixed(1) + ' vs ' + avgLowH.toFixed(1) + ').' });
    }
  }

  if (!insights.length) return null;

  return (
    <Card className="border-brand/20 space-y-2">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span dangerouslySetInnerHTML={{__html:'🔍'}} />
          <span className="text-sm font-medium">What the data says</span>
          <span className="text-[10px] text-brand/70">{insights.length} pattern{insights.length>1?'s':''}</span>
        </div>
        <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: open ? '▲' : '▼'}} />
      </button>
      {open && (
        <div className="space-y-2 pt-1">
          {insights.map(function(ins, i){
            return (
              <div key={i} className="flex items-start gap-2.5 bg-panel2 rounded-xl px-3 py-2.5">
                <span className="text-base flex-shrink-0 mt-0.5" dangerouslySetInnerHTML={{__html:ins.icon}} />
                <span className="text-sm text-paper/90 leading-snug">{ins.text}</span>
              </div>
            );
          })}
          <div className="text-[10px] text-faint italic px-1">Based on your personal data — patterns may evolve as more data accumulates.</div>
        </div>
      )}
    </Card>
  );
}

function MonthOverMonth() {
  var _o = useState(false); var open = _o[0]; var setOpen = _o[1];
  var store = useStore(); var state = store.state;
  var now = new Date();
  var thisMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  var prevDate = new Date(now.getFullYear(), now.getMonth()-1, 1);
  var lastMonth = prevDate.getFullYear() + '-' + String(prevDate.getMonth()+1).padStart(2,'0');

  function inMonth(ts, ym) { return (ts||'').slice(0,7) === ym; }

  var moodLog = state.anchor.moodLog || [];
  var moodVal = { great:5, good:4, ok:3, low:2, anxious:1 };
  function avgMood(ym) {
    var ms = moodLog.filter(function(m){ return inMonth(m.ts,ym); });
    if (!ms.length) return null;
    return ms.reduce(function(s,m){ return s+(moodVal[m.mood]||3); },0)/ms.length;
  }

  var sleepLog = state.anchor.sleep || [];
  function avgSleep(ym) {
    var ss = sleepLog.filter(function(s){ return inMonth(s.ts,ym); });
    if (!ss.length) return null;
    return ss.reduce(function(s,e){ return s+e.hours; },0)/ss.length;
  }

  var waterLog = state.anchor.waterLog || [];
  var waterGoal = state.anchor.waterGoal || 8;
  function avgWater(ym) {
    var ws = waterLog.filter(function(w){ return inMonth(w.date||w.ts,ym); });
    if (!ws.length) return null;
    return ws.reduce(function(s,w){ return s+(w.cups||0); },0)/ws.length;
  }

  var habits = state.anchor.habits || [];
  var habitLog = state.anchor.habitLog || [];
  function habitRate(ym) {
    var year = parseInt(ym.slice(0,4)); var mon = parseInt(ym.slice(5,7));
    var daysInMonth = new Date(year, mon, 0).getDate();
    if (!habits.length) return null;
    var possible = habits.length * daysInMonth;
    var done = 0;
    for (var d = 1; d <= daysInMonth; d++) {
      var ds = ym + '-' + String(d).padStart(2,'0');
      habits.forEach(function(h){ if (habitLog.some(function(e){ return e.key === h.id+':'+ds; })) done++; });
    }
    return possible ? done/possible : null;
  }

  var tm = avgMood(thisMonth); var lm = avgMood(lastMonth);
  var ts = avgSleep(thisMonth); var ls = avgSleep(lastMonth);
  var tw = avgWater(thisMonth); var lw = avgWater(lastMonth);
  var th = habitRate(thisMonth); var lh = habitRate(lastMonth);

  var rows = [];
  if (tm !== null || lm !== null) rows.push({ label:'Mood avg', icon:'😊', thisVal:tm, lastVal:lm, fmt:function(v){ return v?v.toFixed(1)+'/5':'—'; }, better:function(a,b){ return a>b; } });
  if (ts !== null || ls !== null) rows.push({ label:'Sleep avg', icon:'🌙', thisVal:ts, lastVal:ls, fmt:function(v){ return v?v.toFixed(1)+'h':'—'; }, better:function(a,b){ return a>b; } });
  if (tw !== null || lw !== null) rows.push({ label:'Water avg', icon:'💧', thisVal:tw, lastVal:lw, fmt:function(v){ return v?v.toFixed(1)+' cups':'—'; }, better:function(a,b){ return a>b; } });
  if (th !== null || lh !== null) rows.push({ label:'Habit rate', icon:'✅', thisVal:th, lastVal:lh, fmt:function(v){ return v!==null?Math.round(v*100)+'%':'—'; }, better:function(a,b){ return a>b; } });

  if (rows.length < 2) return null;

  var mnLabel = function(ym){ var d = new Date(ym+'-15'); return d.toLocaleDateString(undefined,{month:'short'}); };

  return (
    <Card className="space-y-2">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span dangerouslySetInnerHTML={{__html:'📅'}} />
          <span className="text-sm font-medium">Month over month</span>
        </div>
        <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: open ? '▲' : '▼'}} />
      </button>
      <div className="grid grid-cols-3 gap-1 text-[10px] text-faint font-medium uppercase tracking-wide pt-1 border-t border-edge/20">
        <div>Metric</div>
        <div className="text-center">{mnLabel(lastMonth)}</div>
        <div className="text-center">{mnLabel(thisMonth)}</div>
      </div>
      <div className="space-y-1.5">
        {rows.map(function(row, i){
          var improved = row.thisVal !== null && row.lastVal !== null && row.better(row.thisVal, row.lastVal);
          var declined = row.thisVal !== null && row.lastVal !== null && row.better(row.lastVal, row.thisVal);
          var arrowHtml = improved ? '▲' : declined ? '▼' : '';
          var arrowClass = improved ? 'text-grow' : declined ? 'text-red-400' : '';
          return (
            <div key={i} className="grid grid-cols-3 gap-1 items-center bg-panel2 rounded-lg px-2 py-2">
              <div className="flex items-center gap-1.5 text-xs">
                <span dangerouslySetInnerHTML={{__html:row.icon}} />
                <span className="text-faint text-[11px]">{row.label}</span>
              </div>
              <div className="text-center text-xs text-paper/60">{row.fmt(row.lastVal)}</div>
              <div className="text-center text-xs font-medium flex items-center justify-center gap-1">
                <span>{row.fmt(row.thisVal)}</span>
                {arrowHtml && <span className={'text-[10px] ' + arrowClass} dangerouslySetInnerHTML={{__html:arrowHtml}} />}
              </div>
            </div>
          );
        })}
      </div>
      {open && (
        <div className="text-[10px] text-faint italic pt-0.5">Comparing full calendar months. This month is partial until it ends.</div>
      )}
    </Card>
  );
}

function WeeklyWellnessScore() {
  var _o = useState(false); var open = _o[0]; var setOpen = _o[1];
  var store = useStore(); var state = store.state;
  var today = new Date();
  var weekDates = [];
  for (var i = 6; i >= 0; i--) {
    var d = new Date(today); d.setDate(today.getDate()-i);
    weekDates.push(localDateStr(d));
  }
  var weekSet = new Set(weekDates);

  // --- mood score (0-20): avg mood value in week ---
  var moodLog = state.anchor.moodLog || [];
  var moodVal = { great:5, good:4, ok:3, low:2, anxious:1 };
  var weekMoods = moodLog.filter(function(m){ return weekSet.has(dayOf(m.ts)); });
  var moodScore = 0;
  if (weekMoods.length) {
    var avgMood = weekMoods.reduce(function(s,m){ return s+(moodVal[m.mood]||3); },0)/weekMoods.length;
    moodScore = Math.round((avgMood/5)*20);
  }

  // --- sleep score (0-20): avg hours vs 8h goal ---
  var sleepLog = state.anchor.sleep || [];
  var weekSleep = sleepLog.filter(function(s){ return weekSet.has(dayOf(s.ts)); });
  var sleepScore = 0;
  if (weekSleep.length) {
    var avgH = weekSleep.reduce(function(s,e){ return s+e.hours; },0)/weekSleep.length;
    sleepScore = Math.min(20, Math.round((avgH/8)*20));
  }

  // --- habits score (0-20): completion rate this week ---
  var habits = state.anchor.habits || [];
  var habitLog = state.anchor.habitLog || [];
  var habitScore = 0;
  if (habits.length) {
    var possible = habits.length * weekDates.length;
    var done = weekDates.reduce(function(sum, ds){
      return sum + habits.filter(function(h){ return habitLog.some(function(e){ return e.key === h.id+':'+ds; }); }).length;
    }, 0);
    habitScore = possible ? Math.round((done/possible)*20) : 0;
  }

  // --- water score (0-20): avg cups vs goal ---
  var waterLog = state.anchor.waterLog || [];
  var waterGoal = (state.anchor.waterGoal || 8);
  var weekWater = waterLog.filter(function(w){ return weekSet.has((w.date||w.ts||'').slice(0,10)); });
  var waterScore = 0;
  if (weekWater.length) {
    var avgCups = weekWater.reduce(function(s,w){ return s+(w.cups||0); },0)/weekWater.length;
    waterScore = Math.min(20, Math.round((avgCups/waterGoal)*20));
  }

  // --- mindfulness score (0-20): meditation + focus sessions this week ---
  var medLog = state.anchor.meditationLog || [];
  var focusLog = state.anchor.focusSessions || [];
  var medDays = new Set(medLog.filter(function(m){ return weekSet.has(dayOf(m.ts)); }).map(function(m){ return dayOf(m.ts); }));
  var focusDays = new Set(focusLog.filter(function(f){ return weekSet.has((f.ts||'').slice(0,10)); }).map(function(f){ return dayOf(f.ts); }));
  var activeDays = new Set([].concat(Array.from(medDays), Array.from(focusDays)));
  var mindScore = Math.min(20, Math.round((activeDays.size/7)*20));

  var total = moodScore + sleepScore + habitScore + waterScore + mindScore;
  var hasData = weekMoods.length + weekSleep.length + weekWater.length + (habits.length ? habitLog.length : 0) + medLog.length;
  if (hasData < 3) return null;


  var ringColor = total >= 80 ? '#22c55e' : total >= 60 ? '#eab308' : total >= 40 ? '#f97316' : '#ef4444';
  var label = total >= 80 ? 'Excellent' : total >= 60 ? 'Good' : total >= 40 ? 'Fair' : 'Needs care';
  var r = 36; var circ = 2*Math.PI*r;
  var pct = total/100; var dash = circ*pct; var gap = circ - dash;

  var pillars = [
    { name:'Mood',        score: moodScore,  icon:'😊', max:20 },
    { name:'Sleep',       score: sleepScore, icon:'🌙', max:20 },
    { name:'Habits',      score: habitScore, icon:'✅',  max:20 },
    { name:'Hydration',   score: waterScore, icon:'💧', max:20 },
    { name:'Mindfulness', score: mindScore,  icon:'🧘', max:20 },
  ];

  return (
    <Card className="space-y-2">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span dangerouslySetInnerHTML={{__html:'📊'}} />
          <span className="text-sm font-medium">Weekly wellness score</span>
          <span className="text-xs font-bold" style={{color:ringColor}}>{total}/100</span>
        </div>
        <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: open ? '▲' : '▼'}} />
      </button>
      <div className="flex items-center gap-4 pt-1">
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#1e293b" strokeWidth="10"/>
          <circle cx="50" cy="50" r={r} fill="none" stroke={ringColor} strokeWidth="10"
            strokeDasharray={dash + ' ' + gap} strokeDashoffset={circ/4}
            strokeLinecap="round"/>
          <text x="50" y="46" textAnchor="middle" fill="#e2e8f0" fontSize="18" fontWeight="bold">{total}</text>
          <text x="50" y="60" textAnchor="middle" fill="#94a3b8" fontSize="9">{label}</text>
        </svg>
        <div className="flex-1 space-y-1.5">
          {pillars.map(function(p){
            var pf = p.score/p.max;
            var bc = pf >= 0.8 ? 'bg-grow' : pf >= 0.6 ? 'bg-yellow-500' : pf >= 0.4 ? 'bg-orange-500' : 'bg-red-500';
            return (
              <div key={p.name} className="space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1">
                    <span dangerouslySetInnerHTML={{__html:p.icon}} />
                    <span className="text-faint">{p.name}</span>
                  </div>
                  <span className="text-paper/70">{p.score}/{p.max}</span>
                </div>
                <div className="h-1.5 rounded-full bg-panel2 overflow-hidden">
                  <div className={'h-full rounded-full ' + bc} style={{width:(pf*100)+'%'}} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {open && (
        <div className="pt-1 text-xs text-faint border-t border-edge/20 space-y-0.5">
          <div>Score based on your last 7 days of tracked data.</div>
          <div>Each pillar is out of 20 pts: mood avg, sleep avg vs 8h, habit rate, water vs goal, mindful sessions.</div>
          <div>Track more consistently to improve accuracy.</div>
        </div>
      )}
    </Card>
  );
}

function GratitudeCategoryBreakdown() {
  var _o = useState(false); var open = _o[0]; var setOpen = _o[1];
  var store = useStore(); var state = store.state;
  var gratitude = state.anchor.gratitude || [];
  var tagged = gratitude.filter(function(g){ return g.category; });
  if (tagged.length < 4) return null;

  var counts = {};
  tagged.forEach(function(g){ counts[g.category] = (counts[g.category]||0)+1; });
  var sorted = Object.keys(counts).sort(function(a,b){ return counts[b]-counts[a]; });
  var total = tagged.length;
  var CAT_ICONS = { 'People':'🤝', 'Small joys':'✨', 'Nature':'🌿', 'Body':'💪', 'Achievement':'🏆', 'Growth':'🌱' };
  var CAT_COLORS = { 'People':'#6aa0ff', 'Small joys':'#ffce6a', 'Nature':'#3ddc97', 'Body':'#f97316', 'Achievement':'#a78bfa', 'Growth':'#22c55e' };


  return (
    <Card className="space-y-2">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span dangerouslySetInnerHTML={{__html:'📊'}} />
          <span className="text-sm font-medium">What you are grateful for</span>
        </div>
        <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: open ? '▲' : '▼'}} />
      </button>
      <div className="space-y-1.5 border-t border-edge/20 pt-2">
        {sorted.map(function(cat){
          var pct = Math.round((counts[cat]/total)*100);
          var color = CAT_COLORS[cat] || '#94a3b8';
          var icon = CAT_ICONS[cat] || '⭐';
          return (
            <div key={cat} className="flex items-center gap-2">
              <span className="text-sm w-5 text-center flex-shrink-0" dangerouslySetInnerHTML={{__html:icon}} />
              <span className="text-xs text-faint w-20 flex-shrink-0">{cat}</span>
              <div className="flex-1 h-2 bg-panel2 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{width:pct+'%', backgroundColor:color}} />
              </div>
              <span className="text-[10px] text-faint w-6 text-right tabnum">{pct}%</span>
            </div>
          );
        })}
      </div>
      {open && (
        <div className="text-[10px] text-faint italic border-t border-edge/20 pt-1">
          Based on {tagged.length} tagged entries. Tag theme when logging gratitude to build this chart.
        </div>
      )}
    </Card>
  );
}

function GratitudeThemes() {
  var _o = useState(false); var open = _o[0]; var setOpen = _o[1];
  var store = useStore(); var state = store.state;
  var gratitude = state.anchor.gratitude || [];
  if (gratitude.length < 5) return null;

  var STOP_WORDS = new Set(['a','an','the','and','or','but','in','on','at','to','for','of','my','i','me','it','is','was','be','am','are','with','that','this','so','very','just','so','have','has','had','been','not','no','its','about','can','do','got','get','all','some','more','was','were','from','by','they','we','you','he','she','him','her','our','their','its','your','up','out','also','as','who','when','time','day','today','good','great','so']);

  var freq = {};
  gratitude.forEach(function(g){
    var allText = (g.items||[]).concat(g.notes||[]).join(' ');
    allText.toLowerCase().match(/\b[a-z]{3,}\b/g).forEach(function(word){
      if (!STOP_WORDS.has(word)) freq[word] = (freq[word]||0) + 1;
    });
  });

  var topWords = Object.keys(freq).filter(function(w){ return freq[w] >= 2; })
    .sort(function(a,b){ return freq[b]-freq[a]; }).slice(0, 18);

  if (topWords.length < 4) return null;

  var maxFreq = freq[topWords[0]];

  return (
    <div className="rounded-xl border border-warm/15 bg-panel p-3 space-y-2">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span dangerouslySetInnerHTML={{__html:'✨'}} />
          <span className="text-xs font-semibold text-paper">Your gratitude themes</span>
        </div>
        <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: open ? '▲' : '▼'}} />
      </button>
      {open && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap gap-1.5">
            {topWords.map(function(word){
              var pct = freq[word] / maxFreq;
              var size = pct >= 0.8 ? 'text-base' : pct >= 0.5 ? 'text-sm' : 'text-xs';
              var opacity = pct >= 0.8 ? 'opacity-100' : pct >= 0.5 ? 'opacity-80' : 'opacity-60';
              return (
                <span key={word} className={'bg-panel2 rounded-full px-2.5 py-1 text-warm ' + size + ' ' + opacity}>
                  {word}
                  <span className="text-faint text-[10px] ml-1 tabnum">{freq[word]}</span>
                </span>
              );
            })}
          </div>
          <div className="text-[10px] text-faint italic">From {gratitude.length} gratitude entries</div>
        </div>
      )}
    </div>
  );
}

/* ============================ Home card registry ============================ */
/* Single source of truth for the Home dashboard. `simple:true` = shown by default
   in Simple mode. Everything is always available in Advanced mode, and each card
   can be individually shown/hidden via Settings → Customize home. */
const HOME_SECTIONS = [
  { title:'Your day', icon:'🌅', cards:[
    { id:'DailyIntention',      label:"Today's intention",    Comp: DailyIntention, simple:true },
    { id:'DailyProgressRing',   label:'Daily progress ring',  Comp: DailyProgressRing },
    { id:'DailySummaryCard',    label:'Daily summary',        Comp: DailySummaryCard },
    { id:'AffirmationCard',     label:'Affirmation',          Comp: AffirmationCard },
    { id:'QuickStatsDashboard', label:'Quick stats',          Comp: QuickStatsDashboard },
    { id:'GoalTracker',         label:'Goals',                Comp: GoalTracker },
    { id:'TaskManager',         label:'Tasks',                Comp: TaskManager },
    { id:'StreakCalendar',      label:'Streak calendar',      Comp: StreakCalendar },
    { id:'EveningWrapUp',       label:'Evening wrap-up',      Comp: EveningWrapUp },
    { id:'DayRating',           label:'Rate your day',        Comp: DayRating },
    { id:'WeeklyIntentions',    label:'Weekly intentions',    Comp: WeeklyIntentions },
    { id:'WeeklyReviewPrompt',  label:'Weekly review',        Comp: WeeklyReviewPrompt },
  ]},
  { title:'Body', icon:'💪', cards:[
    { id:'WaterTracker',        label:'Water',                Comp: WaterTracker, simple:true },
    { id:'HabitTracker',        label:'Habits',               Comp: HabitTracker, simple:true },
    { id:'WaterPaceCard',       label:'Water pace',           Comp: WaterPaceCard },
    { id:'WaterTrend',          label:'Water trend',          Comp: WaterTrend },
    { id:'WaterInsights',       label:'Water insights',       Comp: WaterInsights },
    { id:'EnergyTracker',       label:'Energy',               Comp: EnergyTracker },
    { id:'EnergyTrend',         label:'Energy trend',         Comp: EnergyTrend },
    { id:'EnergyInsights',      label:'Energy insights',      Comp: EnergyInsights },
    { id:'EnergyFactorInsights',label:'Energy factors',       Comp: EnergyFactorInsights },
    { id:'MedTracker',          label:'Medications',          Comp: MedTracker },
    { id:'MedAdherence',        label:'Med adherence',        Comp: MedAdherence },
    { id:'MedTimeInsights',     label:'Med timing',           Comp: MedTimeInsights },
  ]},
  { title:'Rest', icon:'😴', cards:[
    { id:'BedtimeCountdown',    label:'Bedtime countdown',    Comp: BedtimeCountdown },
    { id:'SleepLogger',         label:'Log sleep',            Comp: SleepLogger },
    { id:'SleepGoalCard',       label:'Sleep goal',           Comp: SleepGoalCard },
    { id:'SleepTrend',          label:'Sleep trend',          Comp: SleepTrend },
    { id:'SleepInsights',       label:'Sleep insights',       Comp: SleepInsights },
    { id:'SleepDOWInsights',    label:'Sleep by weekday',     Comp: SleepDOWInsights },
    { id:'SleepDebtTracker',    label:'Sleep debt',           Comp: SleepDebtTracker },
    { id:'SleepTagInsights',    label:'Sleep tags',           Comp: SleepTagInsights },
  ]},
  { title:'Mind', icon:'🧠', cards:[
    { id:'GratitudeJournal',    label:'Gratitude',            Comp: GratitudeJournal },
    { id:'GratitudeStreak',     label:'Gratitude streak',     Comp: GratitudeStreak },
    { id:'GratitudeWeeklyDigest',label:'Gratitude digest',    Comp: GratitudeWeeklyDigest },
    { id:'GratitudeCategoryBreakdown',label:'Gratitude categories', Comp: GratitudeCategoryBreakdown },
    { id:'GratitudeThemes',     label:'Gratitude themes',     Comp: GratitudeThemes },
    { id:'JournalEntry',        label:'Journal',              Comp: JournalEntry },
    { id:'JournalStats',        label:'Journal stats',        Comp: JournalStats },
    { id:'JournalHistory',      label:'Journal history',      Comp: JournalHistory },
    { id:'JournalSearch',       label:'Journal search',       Comp: JournalSearch },
    { id:'JournalingPromptGenerator',label:'Journal prompts', Comp: JournalingPromptGenerator },
    { id:'WeeklyReflection',    label:'Weekly reflection',    Comp: WeeklyReflection },
    { id:'CBTJournal',          label:'CBT journal',          Comp: CBTJournal },
    { id:'CBTInsights',         label:'CBT insights',         Comp: CBTInsights },
    { id:'QuickNote',           label:'Quick note',           Comp: QuickNote },
  ]},
  { title:'Focus', icon:'🎯', cards:[
    { id:'MeditationTimer',     label:'Meditation',           Comp: MeditationTimer },
    { id:'MeditationThemeStats',label:'Meditation themes',    Comp: MeditationThemeStats },
    { id:'BreathingHistory',    label:'Breathing history',    Comp: BreathingHistory },
    { id:'BodyScanCard',        label:'Body scan',            Comp: BodyScanCard },
    { id:'BodyScanHistory',     label:'Body scan history',    Comp: BodyScanHistory },
    { id:'FocusTimer',          label:'Focus timer',          Comp: FocusTimer },
    { id:'FocusAnalytics',      label:'Focus analytics',      Comp: FocusAnalytics },
    { id:'CopingToolkit',       label:'Coping toolkit',       Comp: CopingToolkit },
  ]},
  { title:'Progress', icon:'📈', cards:[
    { id:'StreakSummaryCard',   label:'Streak summary',       Comp: StreakSummaryCard },
    { id:'WeeklyWellnessScore', label:'Weekly wellness score',Comp: WeeklyWellnessScore },
    { id:'MonthOverMonth',      label:'Month over month',     Comp: MonthOverMonth },
    { id:'BadgesCard',          label:'Badges',               Comp: BadgesCard },
    { id:'MoodTrend',           label:'Mood trend',           Comp: MoodTrend },
    { id:'MoodCalendar',        label:'Mood calendar',        Comp: MoodCalendar },
    { id:'MoodInsights',        label:'Mood insights',        Comp: MoodInsights },
    { id:'MoodByTimeOfDay',     label:'Mood by time of day',  Comp: MoodByTimeOfDay },
    { id:'MoodTriggerInsights', label:'Mood triggers',        Comp: MoodTriggerInsights },
    { id:'MoodCalendarYear',    label:'Mood year',            Comp: MoodCalendarYear },
    { id:'CrossInsights',       label:'Cross insights',       Comp: CrossInsights },
    { id:'AffirmationOfTheDay', label:'Affirmation of the day',Comp: AffirmationOfTheDay },
    { id:'QuickWinsJournal',    label:'Quick wins',           Comp: QuickWinsJournal },
    { id:'HabitStreakVisualizer',label:'Habit streaks',       Comp: HabitStreakVisualizer },
    { id:'HabitMoodCorrelation',label:'Habit ↔ mood',         Comp: HabitMoodCorrelation },
    { id:'HabitStreakBoard',    label:'Habit board',          Comp: HabitStreakBoard },
    { id:'EnergyLevelTracker',  label:'Energy level log',     Comp: EnergyLevelTracker },
    { id:'FocusSessionsTracker',label:'Focus sessions log',   Comp: FocusSessionsTracker },
    { id:'WeeklyReview',        label:'Weekly review card',   Comp: WeeklyReview },
    { id:'WeeklyStatsCard',     label:'Weekly stats',         Comp: WeeklyStatsCard },
    { id:'LifetimeStats',       label:'Lifetime stats',       Comp: LifetimeStats },
  ]},
];
const HOME_CARD_COUNT = HOME_SECTIONS.reduce((n,s)=>n+s.cards.length, 0);
function cardVisible(card, ui) {
  if (!ui || ui.homeMode === 'advanced') return true;
  const pref = ui.cardPrefs && ui.cardPrefs[card.id];
  if (pref === 'show') return true;
  if (pref === 'hide') return false;
  return !!card.simple;
}

function HomeScreen({ setTab, openSOS, onSettings }) {
  const { state, dispatch } = useStore();
  const ui = state.ui || { homeMode:'simple', cardPrefs:{} };
  const simpleMode = ui.homeMode !== 'advanced';
  const lastMood = state.anchor.moodLog[0];
  const clean = daysBetween(state.recovery.sobriety.startDate, todayISO());
  const inbox = state.agentBridge.inbox || [];
  const ms = getMilestone(clean);
  const todayStr = todayKey();
  const todayMoods = state.anchor.moodLog.filter(m => dayOf(m.ts) === todayStr).length;
  const todayRoutines = state.flow.history.filter(h => dayOf(h.ts) === todayStr && h.completed).length;
  const todaySessions = state.copilot.history.filter(h => dayOf(h.ts) === todayStr).length;
  const todayCount = todayMoods + todayRoutines + todaySessions;
  const streak = getAppStreak(state);
  const weekly = getWeeklyInsights(state);
  const affirmation = getDailyAffirmation(state.user.customAffirmations);
  const [quickLogged, setQuickLogged] = useState(null);
  const [pendingMood, setPendingMood] = useState(null);
  const [moodNote, setMoodNote] = useState('');
  const [moodTrigger, setMoodTrigger] = useState('');
  const MOOD_TRIGGERS = ['Work','Sleep','Relationships','Health','Finances','Loneliness','Overwhelm','Other'];
  const quickMood = (m) => {
    buzz(20);
    setPendingMood(m);
    setMoodNote('');
    setMoodTrigger('');
    if (isHardMood(m.key)) setTab('anchor');
  };
  const submitMood = () => {
    if (!pendingMood) return;
    dispatch({ type:'MOOD_LOG', mood:pendingMood.key, energy:null, note:moodNote, trigger:moodTrigger });
    dispatch({ type:'EMIT', event:'anchor.mood_logged', payload:{ mood:pendingMood.key, energy:null } });
    setQuickLogged(pendingMood.key);
    setPendingMood(null);
    setMoodNote('');
    setMoodTrigger('');
    setTimeout(()=>setQuickLogged(null), 2000);
  };
  return (
    <div className="rise space-y-4">
      <h1 className="text-2xl font-semibold">Today</h1>
      <div className="text-calm/80 text-sm italic leading-relaxed">{affirmation}</div>
      <div className="flex items-center justify-between -mt-1">
        <span className="text-faint text-xs">{simpleMode ? 'Simple view' : 'Full view · all cards'}</span>
        <div className="flex items-center gap-2">
          <button onClick={()=>dispatch({type:'UI_MODE', mode: simpleMode ? 'advanced' : 'simple'})}
            className="text-xs px-3 py-1 rounded-full border border-edge/50 text-faint hover:text-paper hover:border-brand/40 transition">
            {simpleMode ? 'Show everything' : 'Simplify'}
          </button>
          <button onClick={onSettings} className="text-xs px-3 py-1 rounded-full border border-edge/50 text-faint hover:text-paper hover:border-brand/40 transition">Customize</button>
        </div>
      </div>
      {inbox.length>0 && (
        <Card className="border-calm/40">
          <div className="flex items-start gap-3">
            <div className="text-2xl">🤖</div>
            <div className="flex-1">
              <div className="text-faint text-xs mb-1">From your Agent OS</div>
              {inbox.map((m,i)=>(<div key={i} className="text-paper text-sm mb-1">{typeof m==='string'?m:(m.text||JSON.stringify(m))}</div>))}
            </div>
            <button onClick={()=>dispatch({type:'BRIDGE_INBOX',inbox:[]})} className="text-faint hover:text-paper text-sm">✕</button>
          </div>
        </Card>
      )}
      <Card className="border-grow/30">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-faint text-sm mb-1">Recovery</div>
            <div className="text-3xl font-bold text-grow tabnum">{clean} <span className="text-base font-normal text-faint">days · total {state.recovery.sobriety.totalDaysClean+clean}</span></div>
            <div className="text-faint text-sm mt-1">No streak to lose. Every day counts and they add up.</div>
            {(function() {
              var milestones = [7,14,30,60,90,180,365];
              var next = milestones.find(function(m){ return m > clean; });
              if (!next) return null;
              var left = next - clean;
              var pct = Math.round((clean / next) * 100);
              return (
                <div className="mt-2">
                  <div className="text-xs text-faint mb-1">{left} day{left!==1?'s':''} to {next}-day milestone</div>
                  <div className="h-1.5 bg-panel2 rounded-full overflow-hidden">
                    <div className="h-full bg-grow rounded-full" style={{width: pct+'%'}} />
                  </div>
                </div>
              );
            })()}
          </div>
          {streak > 1 && (
            <div className="text-center ml-3 flex-shrink-0">
              <div className="text-2xl font-bold text-warm tabnum">{streak}</div>
              <div className="text-faint text-[10px]">day streak</div>
            </div>
          )}
        </div>
      </Card>
      {ms && (
        <Card className="border-grow/50 bg-grow/5 text-center">
          <div className="text-3xl mb-1">🎉</div>
          <div className="font-semibold text-grow">{ms.msg}</div>
        </Card>
      )}
      {todayCount > 0 && (
        <div className="flex gap-3 text-center text-sm">
          {todayRoutines > 0 && <div className="flex-1 bg-panel rounded-2xl py-2 border border-edge/30"><span className="text-brand font-bold tabnum">{todayRoutines}</span> <span className="text-faint">routine{todayRoutines>1?'s':''}</span></div>}
          {todayMoods > 0 && <div className="flex-1 bg-panel rounded-2xl py-2 border border-edge/30"><span className="text-calm font-bold tabnum">{todayMoods}</span> <span className="text-faint">check-in{todayMoods>1?'s':''}</span></div>}
          {todaySessions > 0 && <div className="flex-1 bg-panel rounded-2xl py-2 border border-edge/30"><span className="text-grow font-bold tabnum">{todaySessions}</span> <span className="text-faint">session{todaySessions>1?'s':''}</span></div>}
        </div>
      )}
      {(weekly.moods + weekly.routines + weekly.sessions) > 2 && (
        <Card className="border-edge/30">
          <div className="text-faint text-sm mb-2">This week</div>
          <div className="flex gap-4 text-center text-sm">
            {weekly.avgLabel && <div className="flex-1"><div className="text-brand font-bold">{weekly.avgLabel}</div><div className="text-faint text-[11px]">avg mood</div></div>}
            <div className="flex-1"><div className="text-grow font-bold tabnum">{weekly.routines}</div><div className="text-faint text-[11px]">routines</div></div>
            <div className="flex-1"><div className="text-calm font-bold tabnum">{weekly.sessions}</div><div className="text-faint text-[11px]">sessions</div></div>
            <div className="flex-1"><div className="text-warm font-bold tabnum">{weekly.moods}</div><div className="text-faint text-[11px]">check-ins</div></div>
          </div>
        </Card>
      )}
      <Card className="border-edge/30">
        <div className="text-faint text-sm mb-2">{quickLogged ? 'Logged ✓' : pendingMood ? pendingMood.emoji + ' ' + pendingMood.label : 'Quick check-in'}</div>
        {!pendingMood && !quickLogged && (
          <div className="flex justify-between">
            {MOODS.map(m=>(
              <button key={m.key} onClick={()=>quickMood(m)}
                className={'rounded-xl py-2 px-3 transition active:scale-90 hover:bg-panel2'}>
                <span className="text-2xl">{m.emoji}</span>
              </button>
            ))}
          </div>
        )}
        {pendingMood && (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              className="w-full bg-panel2 border border-edge/40 focus:border-brand/60 rounded-xl px-3 py-2 text-sm outline-none"
              placeholder="Add a note? (optional)"
              value={moodNote}
              onChange={function(e){ setMoodNote(e.target.value); }}
              onKeyDown={function(e){ if(e.key==='Enter') submitMood(); }}
              autoFocus
            />
            {(pendingMood.key === 'low' || pendingMood.key === 'anxious') && (
              <div>
                <div className="text-[11px] text-faint mb-1">What triggered this? (optional)</div>
                <div className="flex flex-wrap gap-1.5">
                  {MOOD_TRIGGERS.map(function(t){
                    return React.createElement('button', {
                      key:t,
                      onClick: function(){ setMoodTrigger(moodTrigger===t?'':t); },
                      className: 'text-[11px] px-2.5 py-1 rounded-full border transition ' +
                        (moodTrigger===t ? 'bg-rose/20 border-rose/40 text-rose' : 'border-edge/40 text-faint hover:border-rose/30')
                    }, t);
                  })}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button className="flex-1 bg-brand/20 hover:bg-brand/30 text-brand rounded-xl py-1.5 text-sm" onClick={submitMood}>Log it ✓</button>
              <button className="px-3 text-faint hover:text-label text-sm" onClick={function(){ setPendingMood(null); setMoodNote(''); setMoodTrigger(''); }}>✕</button>
            </div>
          </div>
        )}
        {quickLogged && (
          <div className="text-center text-grow py-2">✓ Feeling logged</div>
        )}
        {(function() {
          var logs = state.anchor.moodLog || [];
          if (logs.length < 2) return null;
          var days = [];
          for (var i = 6; i >= 0; i--) {
            var d = new Date(); d.setDate(d.getDate() - i);
            var ds = localDateStr(d);
            var entry = logs.find(function(l){ return l.ts && dayOf(l.ts) === ds; });
            var mood = entry ? MOODS.find(function(m){ return m.key === entry.mood; }) : null;
            days.push({ ds: ds, mood: mood, isToday: i === 0 });
          }
          return (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-edge/20">
              {days.map(function(d) {
                return (
                  <div key={d.ds} className={'flex flex-col items-center gap-0.5 ' + (d.isToday ? 'opacity-100' : 'opacity-60')}>
                    <span className="text-lg">{d.mood ? d.mood.emoji : '·'}</span>
                    <span className="text-[9px] text-faint">{['Su','Mo','Tu','We','Th','Fr','Sa'][new Date(d.ds+'T12:00').getDay()]}</span>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </Card>
      {HOME_SECTIONS.map(function(sec){
        var vis = sec.cards.filter(function(c){ return cardVisible(c, ui); });
        if (!vis.length) return null;
        return (
          <React.Fragment key={sec.title}>
            <SectionLabel text={sec.title} icon={sec.icon} />
            {vis.map(function(c){ var Comp = c.Comp; return <ErrorBoundary key={c.id}><Comp /></ErrorBoundary>; })}
          </React.Fragment>
        );
      })}
      {simpleMode && (
        <button onClick={()=>dispatch({type:'UI_MODE', mode:'advanced'})}
          className="w-full text-center text-faint text-xs py-3 hover:text-paper transition">
          Showing your daily essentials · tap to see all {HOME_CARD_COUNT} tools
        </button>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Card className="cursor-pointer hover:border-brand/40" onClick={()=>setTab('flow')}>
          <div className="text-3xl mb-2">{'✨'}</div>
          <div className="font-semibold">Start a routine</div>
          <div className="text-faint text-sm">One step at a time</div>
        </Card>
        <Card className="cursor-pointer hover:border-calm/40" onClick={()=>setTab('copilot')}>
          <div className="text-3xl mb-2">{'🤝'}</div>
          <div className="font-semibold">Focus session</div>
          <div className="text-faint text-sm">Work alongside me</div>
        </Card>
        <Card className="cursor-pointer hover:border-calm/40" onClick={()=>setTab('anchor')}>
          <div className="text-3xl mb-2">{'🧭'}</div>
          <div className="font-semibold">Check in</div>
          <div className="text-faint text-sm">{lastMood ? 'Last: '+lastMood.mood : 'How are you?'}</div>
        </Card>
        <Card className="cursor-pointer hover:border-rose/40" onClick={openSOS}>
          <div className="text-3xl mb-2">{'⚓'}</div>
          <div className="font-semibold">Ride out an urge</div>
          <div className="text-faint text-sm">It will pass</div>
        </Card>
      </div>
    </div>
  );
}

/* ============================ Module 1 · FLOW (routine player) ============================ */
const TINTS = ['warm','calm','brand','grow'];
const ROUTINE_EMOJIS = ['☀️','🌀','🌙','🏋️','🧘','📖','🎨','🍳','🧹','💊'];

function RoutineEditor({ routine, onSave, onCancel }) {
  const [name, setName] = useState(routine ? routine.name : '');
  const [emoji, setEmoji] = useState(routine ? routine.emoji : '✨');
  const [tint, setTint] = useState(routine ? routine.tint : 'brand');
  const [steps, setSteps] = useState(routine ? routine.steps.map(s=>({...s})) : [{ id:'s1', label:'', sec:60 }]);
  const addStep = () => setSteps(s=>[...s, { id:'s'+Date.now(), label:'', sec:60 }]);
  const rmStep = (i) => setSteps(s=>s.filter((_,j)=>j!==i));
  const updStep = (i, k, v) => setSteps(s=>s.map((st,j)=>j===i?{...st,[k]:v}:st));
  const valid = name.trim() && steps.length > 0 && steps.every(s=>s.label.trim());
  const save = () => {
    const r = { id: routine ? routine.id : 'r_'+Date.now(), name: name.trim(), emoji, tint, steps: steps.map((s,i)=>({ ...s, id: s.id||'s'+i, sec: Math.max(10,s.sec) })) };
    onSave(r);
  };
  return (
    <div className="rise space-y-4">
      <button onClick={onCancel} className="text-faint text-sm">‹ Cancel</button>
      <h2 className="text-xl font-semibold">{routine ? 'Edit routine' : 'New routine'}</h2>
      <div className="flex gap-2 flex-wrap">{ROUTINE_EMOJIS.map(e=>(<button key={e} onClick={()=>setEmoji(e)} className={'text-2xl p-2 rounded-xl border '+(emoji===e?'border-brand bg-panel2':'border-edge/30')}>{e}</button>))}</div>
      <input value={name} onChange={e=>setName(e.target.value)} placeholder="Routine name"
        className="w-full bg-panel border border-edge rounded-2xl px-4 py-3 text-paper placeholder-faint/60 outline-none focus:border-brand" />
      <div className="flex gap-2">{TINTS.map(t=>(<button key={t} onClick={()=>setTint(t)} className={'w-8 h-8 rounded-full border-2 transition bg-'+t+'/60 '+(tint===t?'border-paper scale-110':'border-transparent')}></button>))}</div>
      <div className="space-y-2">
        {steps.map((s,i)=>(
          <div key={s.id} className="flex gap-2 items-center">
            <span className="text-faint text-sm w-5">{i+1}</span>
            <input value={s.label} onChange={e=>updStep(i,'label',e.target.value)} placeholder="Step description"
              className="flex-1 bg-panel border border-edge rounded-xl px-3 py-2 text-paper text-sm placeholder-faint/60 outline-none focus:border-brand" />
            <input type="number" value={s.sec} onChange={e=>updStep(i,'sec',Number(e.target.value))} min={10} step={10}
              className="w-16 bg-panel border border-edge rounded-xl px-2 py-2 text-paper text-sm text-center tabnum outline-none focus:border-brand" />
            <span className="text-faint text-xs">s</span>
            {steps.length > 1 && <button onClick={()=>rmStep(i)} className="text-faint hover:text-rose text-sm">✕</button>}
          </div>
        ))}
        <button onClick={addStep} className="text-brand text-sm hover:underline">+ Add step</button>
      </div>
      <Btn tone="grow" className="w-full" disabled={!valid} onClick={save}>{routine ? 'Save changes' : 'Create routine'}</Btn>
    </div>
  );
}

function FlowScreen() {
  const { state, dispatch } = useStore();
  const [active, setActive] = useState(null);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  if (active) return <RoutinePlayer routine={active} onExit={()=>setActive(null)} />;
  if (creating || editing) return <RoutineEditor routine={editing} onCancel={()=>{ setEditing(null); setCreating(false); }}
    onSave={(r)=>{ dispatch({ type: editing ? 'EDIT_ROUTINE' : 'ADD_ROUTINE', routine: r, id: r.id }); setEditing(null); setCreating(false); }} />;
  return (
    <div className="rise space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Flow</h1>
        <button onClick={()=>setCreating(true)} className="text-brand text-sm hover:underline">+ New routine</button>
      </div>
      <p className="text-faint -mt-2">Pick one. You'll only ever see the next step.</p>
      <div className="space-y-3">
        {state.flow.routines.map(r => (
          <Card key={r.id} className="flex items-center gap-4">
            <div className="text-4xl cursor-pointer" onClick={()=>setActive(r)}>{r.emoji}</div>
            <div className="flex-1 cursor-pointer" onClick={()=>setActive(r)}>
              <div className="font-semibold text-lg">{r.name}</div>
              <div className="text-faint text-sm">{r.steps.length} steps · about {Math.round(r.steps.reduce((a,s)=>a+s.sec,0)/60)} min</div>
            </div>
            <div className="flex flex-col gap-1">
              <button onClick={()=>setEditing(r)} className="text-faint hover:text-brand text-xs">edit</button>
              {!['morning','reset','winddown'].includes(r.id) && <button onClick={()=>dispatch({type:'DELETE_ROUTINE',id:r.id})} className="text-faint hover:text-rose text-xs">del</button>}
            </div>
            <div className={'text-'+r.tint+' text-2xl cursor-pointer'} onClick={()=>setActive(r)}>›</div>
          </Card>
        ))}
      </div>
      {state.flow.history.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="text-faint text-xs">Completion · last 7 days</div>
          {state.flow.routines.map(function(r) {
            var now7 = new Date();
            var days = [];
            for (var di = 6; di >= 0; di--) {
              var dd = new Date(now7); dd.setDate(dd.getDate()-di);
              var ds = localDateStr(dd);
              var dayLabel = ['S','M','T','W','T','F','S'][dd.getDay()];
              var match = state.flow.history.filter(function(h){ return h.routineId===r.id && dayOf(h.ts)===ds; });
              var status = match.length===0 ? 'none' : match.some(function(h){ return h.completed; }) ? 'done' : 'partial';
              days.push({ ds: ds, label: dayLabel, status: status });
            }
            var totalDone = state.flow.history.filter(function(h){ return h.routineId===r.id && h.completed; }).length;
            if (totalDone === 0) return null;
            var tintMap = { brand:'#6aa0ff', calm:'#b08cff', grow:'#3ddc97', warm:'#ffce6a' };
            var color = tintMap[r.tint] || '#6aa0ff';
            return (
              <div key={r.id} className="flex items-center gap-2">
                <span className="text-base w-6 flex-shrink-0">{r.emoji}</span>
                <div className="flex gap-1 flex-1">
                  {days.map(function(d) {
                    var bg = d.status==='done' ? color : d.status==='partial' ? '#ffce6a' : 'rgba(42,58,92,0.5)';
                    return (
                      <div key={d.ds} className="flex-1 flex flex-col items-center gap-0.5">
                        <div style={{width:'100%', maxWidth:'22px', height:'18px', borderRadius:'4px', backgroundColor: bg, opacity: d.status==='none'?0.25:1}} />
                        <span className="text-faint text-[9px]">{d.label}</span>
                      </div>
                    );
                  })}
                </div>
                <span className="text-faint text-[11px] tabnum w-10 text-right">{totalDone}×</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RoutinePlayer({ routine, onExit }) {
  const { dispatch } = useStore();
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(false);
  const idxRef = useRef(0); idxRef.current = idx;
  const advanceRef = useRef(null);
  const timer = useCountdown(() => advanceRef.current && advanceRef.current());
  const steps = routine.steps;
  const step = steps[idx];

  // finish reads idx via ref, so it never goes stale and never runs inside a state updater
  const finish = useCallback((completed) => {
    setDone(true); timer.stop();
    dispatch({ type:'FLOW_DONE', routineId: routine.id, completed });
    dispatch({ type:'EMIT', event:'flow.routine_'+(completed?'completed':'exited'), payload:{ routineId: routine.id, stepsDone: idxRef.current + (completed?1:0) } });
  }, [dispatch, routine.id, timer]);

  // single code path for both the timer hitting zero and a manual "Done"/"Skip" tap
  const advance = useCallback(() => {
    const next = idxRef.current + 1;
    if (next >= steps.length) finish(true);
    else setIdx(next);
  }, [steps.length, finish]);
  advanceRef.current = advance;

  // auto-start each step → reaching zero calls advance() → this is the auto-advance
  useEffect(() => { if (!done) timer.start(steps[idx].sec); /* eslint-disable-next-line */ }, [idx]);

  if (done) {
    return (
      <div className="rise flex flex-col items-center justify-center text-center pt-10 gap-5">
        <div className="text-6xl">🌿</div>
        <h1 className="text-2xl font-semibold">That's done.</h1>
        <p className="text-faint max-w-xs">You showed up and moved through it. That's the whole win.</p>
        <Btn tone="grow" onClick={onExit}>Back to routines</Btn>
      </div>
    );
  }

  const frac = timer.total ? timer.secondsLeft / timer.total : 0;
  const tintHex = { warm:'#ffce6a', calm:'#b08cff', brand:'#6aa0ff', grow:'#3ddc97' }[routine.tint] || '#6aa0ff';

  return (
    <div className="rise flex flex-col items-center text-center pt-2">
      <div className="flex items-center justify-between w-full mb-2">
        <button onClick={()=>finish(false)} className="text-faint hover:text-paper text-sm">‹ Exit</button>
        <div className="text-faint text-sm">{routine.emoji} {routine.name}</div>
        <div className="w-12"></div>
      </div>

      <div className="text-faint text-sm mb-1">Step {idx+1} of {steps.length}</div>
      <h1 className="text-3xl font-semibold leading-snug mb-6 px-2 min-h-[4.5rem] flex items-center">{step.label}</h1>

      <Ring frac={frac} color={tintHex} size={260}>
        <div className="text-5xl font-bold tabnum">{fmt(timer.secondsLeft)}</div>
        <div className="text-faint text-sm mt-1">{timer.running ? 'breathe and do it' : 'paused'}</div>
      </Ring>

      <div className="flex gap-1.5 mt-6">
        {steps.map((s,i)=>(
          <span key={s.id} className={'h-2 rounded-full transition-all '+(i<idx?'w-2 bg-grow':i===idx?'w-8 bg-brand':'w-2 bg-edge')}></span>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 justify-center mt-7">
        <Btn tone="primary" onClick={advance}>Done ✓</Btn>
        {timer.running
          ? <Btn tone="ghost" onClick={timer.pause}>Pause</Btn>
          : <Btn tone="ghost" onClick={timer.resume}>Resume</Btn>}
        <Btn tone="ghost" onClick={()=>timer.start(timer.secondsLeft + 60)}>+1 min</Btn>
        <Btn tone="quiet" onClick={advance}>Skip →</Btn>
      </div>
      <p className="text-faint text-xs mt-4 max-w-xs">No pressure. Snooze or skip freely — moving on isn't failing.</p>
    </div>
  );
}

/* ============================ Module 2 · CO-PILOT (body doubling) ============================ */
function Presence({ active }) {
  return (
    <div className="relative w-28 h-28 flex items-center justify-center mx-auto">
      <div className="absolute inset-0 rounded-full bg-calm/20" style={{ animation: active?'breathe 4s ease-in-out infinite':'none' }}></div>
      <div className="absolute inset-3 rounded-full bg-calm/30" style={{ animation: active?'pulsePresence 3s ease-in-out infinite':'none' }}></div>
      <div className="relative w-16 h-16 rounded-full bg-calm/80 flex items-center justify-center text-3xl">🤖</div>
    </div>
  );
}

function CoPilotHistory({ history }) {
  const [showAll, setShowAll] = useState(false);
  const allH = history || [];
  const visible = showAll ? allH : allH.slice(0,3);
  const fmtDate = (ts) => { const d = new Date(ts); return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}); };
  return (
    <div className="pt-2 border-t border-edge/20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-faint text-sm">Session history</span>
        {allH.length > 3 && (
          <button className="text-xs text-faint hover:text-calm" onClick={()=>setShowAll(!showAll)}>
            {showAll ? 'show less' : 'all '+allH.length}
          </button>
        )}
      </div>
      {visible.map(function(h,i){
        return (
          <div key={i} className="py-2 border-b border-edge/20 last:border-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-calm text-xs tabnum font-bold">{h.lengthMin}m</span>
              <span className="text-paper text-sm flex-1">{h.goal || 'No goal set'}</span>
              <span className="text-faint text-xs">{fmtDate(h.ts)}</span>
            </div>
            {h.outcome && (
              <div className="text-xs text-faint pl-6 leading-snug italic">&ldquo;{h.outcome}&rdquo;</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CoPilotScreen() {
  const { state, dispatch } = useStore();
  const [phase, setPhase] = useState('setup'); // setup | intent | working | review
  const [len, setLen] = useState(25);
  const [goal, setGoal] = useState('');
  const [outcome, setOutcome] = useState('');
  const timer = useCountdown(() => setPhase('review'));

  const begin = () => { setPhase('working'); timer.start(len*60); dispatch({ type:'EMIT', event:'copilot.session_started', payload:{ lengthMin: len, goal } }); };
  const save = () => {
    dispatch({ type:'COPILOT_DONE', lengthMin: len, goal, outcome });
    dispatch({ type:'EMIT', event:'copilot.session_done', payload:{ lengthMin: len, goal, outcome } });
    setPhase('setup'); setGoal(''); setOutcome('');
  };

  if (phase==='setup') {
  var hist = state.copilot.history || [];
  var totalSessions = hist.length;
  var totalFocusMins = hist.reduce(function(s,h){ return s + (h.lengthMin||0); }, 0);
  var weekAgoCS = new Date(); weekAgoCS.setDate(weekAgoCS.getDate()-7);
  var weekAgoCSstr = weekAgoCS.toISOString();
  var weekSessions = hist.filter(function(h){ return h.ts >= weekAgoCSstr; }).length;
  return (
    <div className="rise space-y-4">
      <h1 className="text-2xl font-semibold">Co-Pilot</h1>
      <p className="text-faint -mt-2">We start together, work in parallel, and check in at the end. You're not doing this alone.</p>
      {totalSessions > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-panel2 rounded-xl px-2 py-2 text-center">
            <div className="text-calm font-bold tabnum">{totalSessions}</div>
            <div className="text-faint text-[10px]">total sessions</div>
          </div>
          <div className="bg-panel2 rounded-xl px-2 py-2 text-center">
            <div className="text-calm font-bold tabnum">{totalFocusMins >= 60 ? (totalFocusMins/60).toFixed(1)+'h' : totalFocusMins+'m'}</div>
            <div className="text-faint text-[10px]">focused time</div>
          </div>
          <div className="bg-panel2 rounded-xl px-2 py-2 text-center">
            <div className="text-calm font-bold tabnum">{weekSessions}</div>
            <div className="text-faint text-[10px]">this week</div>
          </div>
        </div>
      )}
      <Presence active={false} />
      <div className="grid grid-cols-2 gap-3">
        {[25,50].map(m=>(
          <Card key={m} onClick={()=>setLen(m)}
            className={'cursor-pointer text-center '+(len===m?'border-calm/70 ring-1 ring-calm/50':'hover:border-calm/30')}>
            <div className="text-3xl font-bold tabnum">{m}</div>
            <div className="text-faint text-sm">minutes</div>
          </Card>
        ))}
      </div>
      <Btn tone="calm" className="w-full" onClick={()=>setPhase('intent')}>Set up the session</Btn>
      {state.copilot.history.length > 0 && <CoPilotHistory history={state.copilot.history} />}
    </div>
  );
  }

  var COPILOT_TEMPLATES = [
    'Get through the next hour without overthinking',
    'Write one paragraph on something I\'ve been avoiding',
    'Process a feeling that\'s been sitting with me',
    'Plan one thing I can do differently today',
    'Respond to one message I\'ve been putting off',
    'Clear my head and make a small decision',
    'Prepare for a hard conversation',
    'Identify what\'s draining me this week',
    'Do one task I\'ve been avoiding',
    'Ground myself and feel steadier',
  ];

  if (phase==='intent') return (
    <div className="rise space-y-4">
      <h1 className="text-2xl font-semibold">What's the one thing?</h1>
      <p className="text-faint -mt-2">Say it out loud to me. Small and specific beats big and vague.</p>
      {!goal.trim() && (
        <div className="space-y-2">
          <div className="text-xs text-faint">Quick starts:</div>
          <div className="flex flex-wrap gap-1.5">
            {COPILOT_TEMPLATES.map(function(t, i){
              return (
                <button key={i} onClick={function(){ setGoal(t); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-calm/30 text-calm/80 hover:bg-calm/10 hover:border-calm/60 transition">
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <textarea autoFocus value={goal} onChange={e=>setGoal(e.target.value)}
        placeholder="e.g. Draft the first paragraph of the email"
        className="w-full bg-panel border border-edge rounded-2xl p-4 text-paper placeholder-faint/60 outline-none focus:border-calm min-h-[110px]" />
      <div className="flex gap-2">
        <Btn tone="quiet" onClick={()=>setPhase('setup')}>Back</Btn>
        <Btn tone="calm" className="flex-1" onClick={begin} disabled={!goal.trim()}>Start {len}-min session →</Btn>
      </div>
    </div>
  );

  if (phase==='working') {
    const frac = timer.total ? timer.secondsLeft/timer.total : 0;
    const elapsed = 1 - frac;
    const checkin = elapsed < 0.05 ? "I'm here. Let's get into it together."
      : elapsed > 0.92 ? "Almost there — bring it to a stopping point."
      : elapsed > 0.45 && elapsed < 0.55 ? "Halfway. Still on the one thing?"
      : "Working alongside you…";
    return (
      <div className="rise flex flex-col items-center text-center pt-2">
        <Presence active={timer.running} />
        <div className="text-calm text-sm mt-3 mb-4 min-h-[1.5rem]">{checkin}</div>
        <Ring frac={frac} color="#b08cff" size={240}>
          <div className="text-5xl font-bold tabnum">{fmt(timer.secondsLeft)}</div>
          <div className="text-faint text-xs mt-1">{timer.running?'in session':'paused'}</div>
        </Ring>
        <Card className="mt-6 w-full text-left border-calm/20">
          <div className="text-faint text-xs mb-1">Your goal</div>
          <div className="text-paper">{goal}</div>
        </Card>
        <div className="flex gap-2 mt-5">
          {timer.running ? <Btn tone="ghost" onClick={timer.pause}>Pause</Btn> : <Btn tone="ghost" onClick={timer.resume}>Resume</Btn>}
          <Btn tone="calm" onClick={()=>setPhase('review')}>End & review</Btn>
        </div>
      </div>
    );
  }

  // review
  return (
    <div className="rise space-y-4">
      <h1 className="text-2xl font-semibold">How did it go?</h1>
      <Card className="border-calm/20">
        <div className="text-faint text-xs mb-1">You set out to</div>
        <div className="text-paper">{goal}</div>
      </Card>
      <textarea value={outcome} onChange={e=>setOutcome(e.target.value)}
        placeholder="What moved? Even a tiny bit counts."
        className="w-full bg-panel border border-edge rounded-2xl p-4 text-paper placeholder-faint/60 outline-none focus:border-calm min-h-[90px]" />
      <Btn tone="grow" className="w-full" onClick={save}>Log it & finish</Btn>
    </div>
  );
}

/* ============================ shared atoms for Phase 4 ============================ */
function Slider({ value, onChange, min=0, max=10, color='#6aa0ff', label }) {
  return (
    <div className="w-full">
      {label && <div className="flex justify-between text-sm text-faint mb-1"><span>{label}</span><span className="tabnum text-paper text-lg font-semibold">{value}</span></div>}
      <input type="range" min={min} max={max} value={value} onChange={e=>onChange(Number(e.target.value))}
        className="w-full h-2" style={{ accentColor: color }} />
    </div>
  );
}

const BREATH_PATTERNS = {
  box:   { label:'Box breathing', seq:[['Breathe in',4],['Hold',4],['Breathe out',6],['Hold',2]], desc:'in 4 · hold 4 · out 6 · hold 2' },
  fourSevenEight: { label:'4-7-8 breathing', seq:[['Breathe in',4],['Hold',7],['Breathe out',8]], desc:'in 4 · hold 7 · out 8' },
};

function BoxBreath({ pattern: patternKey }) {
  const [mode, setMode] = useState(patternKey || 'box');
  const pat = BREATH_PATTERNS[mode];
  const seq = pat.seq;
  const cycle = seq.reduce((a,s)=>a+s[1],0);
  const [sec, setSec] = useState(0);
  useEffect(() => { setSec(0); }, [mode]);
  useEffect(() => { const id = setInterval(()=>setSec(s=>(s+1)%cycle), 1000); return ()=>clearInterval(id); }, [cycle, mode]);
  let acc=0, pi=0, within=1;
  for (let i=0;i<seq.length;i++){ if (sec < acc+seq[i][1]){ pi=i; within=seq[i][1]-(sec-acc); break; } acc+=seq[i][1]; }
  const big = pi===0 || (seq.length===4 && pi===1);
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-2">
        {Object.entries(BREATH_PATTERNS).map(([k,p])=>(
          <button key={k} onClick={()=>setMode(k)} className={'text-xs px-3 py-1 rounded-full border transition '+(mode===k?'border-brand text-brand bg-brand/10':'border-edge text-faint hover:text-paper')}>{p.label}</button>
        ))}
      </div>
      <div className="w-40 h-40 rounded-full bg-brand/25 border border-brand/40 flex items-center justify-center"
           style={{ transition:'transform 1s ease-in-out', transform:`scale(${big?1:0.66})` }}>
        <div className="text-center">
          <div className="text-base text-paper">{seq[pi][0]}</div>
          <div className="text-3xl font-bold tabnum text-brand">{within}</div>
        </div>
      </div>
      <div className="text-faint text-xs">{pat.desc}</div>
    </div>
  );
}

function WeeklyCompassionPrompt() {
  var store = useStore(); var state = store.state; var dispatch = store.dispatch;
  var log = state.anchor.compassionLog || [];

  var PROMPTS = [
    'What would you say to a close friend who was struggling the way you are right now?',
    'Name one thing your body did for you today that you can be grateful for.',
    'What is one thing you are proud of surviving this week, even if no one else noticed?',
    'In what area of your life have you been too hard on yourself lately?',
    'What does the kindest version of yourself know that you sometimes forget?',
    'If you could send one compassionate message back to yourself one year ago, what would it be?',
    'What small act of self-care did you manage this week, even on a hard day?',
    'What would it feel like to give yourself the same grace you give others?',
    'What emotion have you been pushing away lately that deserves a little space?',
    'What is one thing you would tell yourself tonight if you knew it would bring peace?',
  ];

  // Determine current ISO week number
  var getWeek = function(date) {
    var d = new Date(date);
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() + 4 - (d.getDay()||7));
    var y = d.getFullYear();
    var start = new Date(y, 0, 1);
    return y + '-W' + String(Math.ceil(((d - start) / 86400000 + 1) / 7)).padStart(2,'0');
  };
  var thisWeek = getWeek(new Date());
  var alreadyDone = log.some(function(e){ return e.week === thisWeek; });

  // Pick prompt deterministically by week
  var weekNum = parseInt(thisWeek.slice(-2), 10) || 0;
  var prompt = PROMPTS[weekNum % PROMPTS.length];

  var _done = useState(false); var justDone = _done[0]; var setJustDone = _done[1];

  if (alreadyDone || justDone) return (
    <Card className="border-calm/20 text-center py-4">
      <div className="text-2xl mb-1">💙</div>
      <div className="text-calm font-semibold text-sm">Reflected this week</div>
      <div className="text-faint text-xs mt-1 italic max-w-xs mx-auto">{prompt}</div>
    </Card>
  );

  return (
    <Card className="border-calm/30">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl">🧠</span>
        <span className="font-semibold text-sm">Weekly Self-Compassion</span>
        <span className="text-[10px] text-calm ml-auto bg-calm/10 px-2 py-0.5 rounded-full">once a week</span>
      </div>
      <div className="text-paper text-sm leading-relaxed mb-4 italic">"{prompt}"</div>
      <div className="text-faint text-xs mb-3">Take a quiet moment to sit with this question. There is nothing to get right.</div>
      <button
        onClick={function(){
          dispatch({ type:'COMPASSION_REFLECT', prompt: prompt, week: thisWeek });
          setJustDone(true);
          chime(396, 0.5);
          buzz(30);
        }}
        className="w-full py-2.5 rounded-xl bg-calm/15 hover:bg-calm/25 text-calm font-medium text-sm transition active:scale-95">
        ❤ I have reflected
      </button>
    </Card>
  );
}

function RecoveryJournal() {
  var store = useStore(); var state = store.state; var dispatch = store.dispatch;
  var journal = state.recovery.recoveryJournal || [];
  var clean = daysBetween(state.recovery.sobriety.startDate, todayISO());

  var PROMPTS = [
    'What kept you clean today, even when it was hard?',
    'What is one thing your sobriety has given back to you?',
    'What urge did you ride out recently, and what helped?',
    'Who in your life benefits most from you staying the course?',
    'What does a sober future look and feel like to you?',
    'What is the biggest lie your addiction told you that you no longer believe?',
    'Name one strength you have discovered through recovery.',
    'What would you tell someone on Day 1 of their journey?',
    'What fear about sobriety turned out to be smaller than you expected?',
    'What does peace feel like in your body right now?',
  ];

  var todayStr = todayKey();
  var todayEntry = journal.find(function(e){ return dayOf(e.ts) === todayStr; });

  var promptIdx = (clean + new Date().getDay()) % PROMPTS.length;
  var todayPrompt = PROMPTS[promptIdx];

  var _open = useState(false); var open = _open[0]; var setOpen = _open[1];
  var _text = useState(''); var text = _text[0]; var setText = _text[1];
  var _showAll = useState(false); var showAll = _showAll[0]; var setShowAll = _showAll[1];

  var save = function() {
    if (!text.trim()) return;
    dispatch({ type:'RECOVERY_JOURNAL', prompt: todayPrompt, text: text.trim(), streak: clean });
    setText('');
    setOpen(false);
    buzz(20);
    chime(440, 0.4);
  };

  return (
    <Card className="border-grow/20">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">📓</span>
          <span className="font-semibold text-sm">Recovery Journal</span>
        </div>
        <span className="text-[10px] text-faint">{journal.length} entr{journal.length===1?'y':'ies'}</span>
      </div>

      {!open && !todayEntry && (
        <div>
          <div className="text-faint text-xs italic mb-3 leading-relaxed">"{todayPrompt}"</div>
          <button onClick={function(){ setOpen(true); setText(''); }}
            className="w-full py-2 rounded-xl bg-grow/10 hover:bg-grow/20 text-grow text-sm font-medium transition active:scale-95">
            Write today's entry
          </button>
        </div>
      )}

      {todayEntry && !open && (
        <div>
          <div className="text-faint text-[10px] italic mb-1">"{todayEntry.prompt}"</div>
          <div className="text-paper text-sm leading-relaxed bg-panel2 rounded-xl px-3 py-2 mb-2">{todayEntry.text}</div>
          <div className="text-faint text-[10px]">Day {todayEntry.streak} &middot; {dayOf(todayEntry.ts)}</div>
        </div>
      )}

      {open && (
        <div className="space-y-2">
          <div className="text-xs text-calm italic leading-relaxed mb-1">"{todayPrompt}"</div>
          <textarea value={text} onChange={function(e){setText(e.target.value);}} rows={4}
            placeholder="Write freely — this is just for you..."
            autoFocus
            className="w-full bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-sm outline-none focus:border-grow resize-none leading-relaxed" />
          <div className="flex gap-2">
            <Btn tone="grow" className="flex-1" onClick={save} disabled={!text.trim()}>Save entry</Btn>
            <Btn tone="ghost" onClick={function(){ setOpen(false); setText(''); }}>Cancel</Btn>
          </div>
        </div>
      )}

      {journal.length > 1 && (
        <div className="mt-3 border-t border-edge/20 pt-2">
          <button onClick={function(){ setShowAll(!showAll); }}
            className="text-[10px] text-faint hover:text-paper flex items-center gap-1">
            <span dangerouslySetInnerHTML={{__html: showAll ? '▲' : '▼'}} />
            {showAll ? 'Hide' : 'Past entries (' + (journal.length-1) + ')'}
          </button>
          {showAll && (
            <div className="mt-2 space-y-3">
              {journal.slice(1, 10).map(function(e, i){
                return (
                  <div key={i} className="border-l-2 border-grow/30 pl-3">
                    <div className="text-[10px] text-faint mb-0.5">Day {e.streak} &middot; {dayOf(e.ts)}</div>
                    <div className="text-[10px] text-calm/70 italic mb-0.5">"{e.prompt}"</div>
                    <div className="text-xs text-paper/80 leading-relaxed">{e.text}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function CrisisPlan() {
  var store = useStore(); var state = store.state; var dispatch = store.dispatch;
  var plan = state.recovery.crisisPlan || { steps:['','',''], safePerson:'', whatHelps:'' };
  var _e = useState(false); var editing = _e[0]; var setEditing = _e[1];
  var _d = useState(null); var draft = _d[0]; var setDraft = _d[1];

  var hasContent = plan.steps.some(function(s){ return s.trim().length > 0; }) || plan.safePerson.trim() || plan.whatHelps.trim();

  function startEdit() {
    setDraft({ steps: plan.steps.slice(), safePerson: plan.safePerson, whatHelps: plan.whatHelps });
    setEditing(true);
  }
  function save() {
    dispatch({ type:'SET_CRISIS_PLAN', plan: draft });
    setEditing(false); setDraft(null); chime(440, 0.15);
  }
  function cancel() { setEditing(false); setDraft(null); }
  function setStep(i, val) {
    var steps = draft.steps.slice(); steps[i] = val;
    setDraft({ ...draft, steps:steps });
  }

  if (editing && draft) return (
    <Card className="border-calm/30 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><span>🚨</span><span className="text-sm font-medium">My crisis plan</span></div>
        <span className="text-[10px] text-faint italic">Fill when calm · read when struggling</span>
      </div>
      <div className="space-y-2">
        <div className="text-xs text-faint">Steps I will take (when I need help)</div>
        {[0,1,2].map(function(i){
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-faint text-xs tabnum">{i+1}.</span>
              <input value={draft.steps[i]} onChange={function(e){ setStep(i, e.target.value); }}
                placeholder={'Step ' + (i+1) + '...'}
                className="flex-1 bg-panel2 border border-edge rounded-xl px-3 py-1.5 text-sm text-paper outline-none focus:border-calm" />
            </div>
          );
        })}
      </div>
      <div className="space-y-1">
        <div className="text-xs text-faint">Safe person to call</div>
        <input value={draft.safePerson} onChange={function(e){ setDraft({...draft, safePerson:e.target.value}); }}
          placeholder="Name or number..."
          className="w-full bg-panel2 border border-edge rounded-xl px-3 py-1.5 text-sm text-paper outline-none focus:border-calm" />
      </div>
      <div className="space-y-1">
        <div className="text-xs text-faint">What helps me most</div>
        <input value={draft.whatHelps} onChange={function(e){ setDraft({...draft, whatHelps:e.target.value}); }}
          placeholder="e.g. music, walk, breathing..."
          className="w-full bg-panel2 border border-edge rounded-xl px-3 py-1.5 text-sm text-paper outline-none focus:border-calm" />
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={save} className="flex-1 bg-calm/20 hover:bg-calm/30 text-calm text-sm rounded-xl py-2 transition">Save plan</button>
        <button onClick={cancel} className="flex-1 bg-panel2 hover:bg-edge/30 text-faint text-sm rounded-xl py-2 transition">Cancel</button>
      </div>
    </Card>
  );

  if (!hasContent) return (
    <Card className="border-calm/20">
      <button onClick={startEdit} className="w-full flex items-center gap-3 text-left">
        <span className="text-2xl">🚨</span>
        <div className="flex-1">
          <div className="text-sm font-medium">Build your crisis plan</div>
          <div className="text-xs text-faint">Write it when you are calm — have it ready when you are not</div>
        </div>
        <span className="text-faint text-sm">+</span>
      </button>
    </Card>
  );

  return (
    <Card className="border-calm/30 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><span>🚨</span><span className="text-sm font-medium">My crisis plan</span></div>
        <button onClick={startEdit} className="text-xs text-faint hover:text-calm transition">edit</button>
      </div>
      {plan.steps.filter(function(s){ return s.trim(); }).length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-faint uppercase tracking-wide">When I need help, I will</div>
          {plan.steps.map(function(s, i){
            if (!s.trim()) return null;
            return (
              <div key={i} className="flex items-start gap-2 text-sm text-paper/90">
                <span className="text-calm font-bold tabnum flex-shrink-0">{i+1}.</span>
                <span>{s}</span>
              </div>
            );
          })}
        </div>
      )}
      {plan.safePerson.trim() && (
        <div className="bg-panel2 rounded-xl px-3 py-2 flex items-center gap-2">
          <span>📞</span>
          <div>
            <div className="text-[10px] text-faint">Safe person</div>
            <div className="text-sm text-paper">{plan.safePerson}</div>
          </div>
        </div>
      )}
      {plan.whatHelps.trim() && (
        <div className="bg-panel2 rounded-xl px-3 py-2 flex items-center gap-2">
          <span>✨</span>
          <div>
            <div className="text-[10px] text-faint">What helps me</div>
            <div className="text-sm text-paper">{plan.whatHelps}</div>
          </div>
        </div>
      )}
    </Card>
  );
}

function RecoveryAffirmations() {
  var _idx = useState(0); var idx = _idx[0]; var setIdx = _idx[1];
  var affirmations = [
    'I am strong. I am capable. I am worthy.',
    'Recovery is possible. I am living proof.',
    'One day at a time. One breath at a time.',
    'I choose myself. I choose sobriety. I choose life.',
    'My past does not define my future.',
    'I am not alone. My recovery matters.',
    'Today I am one day closer to the person I want to be.',
    'I deserve love, respect, and recovery.',
    'My struggles make me stronger.',
    'I am rewriting my story.',
    'Craving pass. I can ride this wave.',
    'I am rebuilding my life with purpose.',
    'Help is a sign of strength.',
    'I am grateful for my recovery.',
    'Today I choose healing over harm.'
  ];

  function next() {
    setIdx((idx + 1) % affirmations.length);
  }

  return React.createElement(Card, { title: '💪 Recovery Affirmations', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-2' },
      React.createElement('div', { className: 'bg-green-900 bg-opacity-30 rounded-lg p-3 text-center' },
        React.createElement('p', { className: 'text-green-100 text-sm italic' }, '“', affirmations[idx], '”')),
      React.createElement('button', {
        onClick: next,
        className: 'w-full py-1.5 rounded text-sm font-semibold bg-green-600 hover:bg-green-500 text-white'
      }, 'Next affirmation'),
      React.createElement('div', { className: 'text-xs text-gray-500 text-center' }, idx + 1, ' / ', affirmations.length)
    )
  );
}

function RelapsePreventionContract() {
  var _contract = useState(''); var contract = _contract[0]; var setContract = _contract[1];
  var _signed = useState(false); var signed = _signed[0]; var setSigned = _signed[1];

  function sign() {
    if (!contract.trim()) return;
    setSigned(true);
    buzz(3);
    chime(880, 0.2);
  }

  return React.createElement(Card, { title: '📋 My Commitment', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-2' },
      !signed
        ? React.createElement('div', { className: 'space-y-1' },
            React.createElement('p', { className: 'text-xs text-gray-400' }, 'Write your personal commitment to recovery:'),
            React.createElement('textarea', {
              placeholder: 'I commit to... I will... When triggered, I will...',
              value: contract,
              onChange: function(e) { setContract(e.target.value); },
              maxLength: '300',
              className: 'w-full bg-gray-700 rounded px-2 py-2 text-xs text-white placeholder-gray-500 h-20 resize-none'
            }),
            React.createElement('button', {
              onClick: sign,
              disabled: !contract.trim(),
              className: 'w-full py-1 rounded text-sm font-semibold ' + (contract.trim() ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed')
            }, 'Sign commitment'))
        : React.createElement('div', { className: 'bg-indigo-900 bg-opacity-50 rounded p-2 space-y-2' },
            React.createElement('div', { className: 'text-sm font-semibold text-indigo-300' }, '✓ Your commitment:'),
            React.createElement('div', { className: 'text-xs text-indigo-100 italic' }, contract),
            React.createElement('button', {
              onClick: function() { setSigned(false); },
              className: 'text-xs text-gray-500 underline hover:text-gray-400'
            }, 'Edit'))
    )
  );
}

function SafePersonButton() {
  var store = useStore();
  var network = (store.state.recovery.supportNetwork || []);
  var safePerson = network.length > 0 ? network[0] : null;

  return safePerson
    ? React.createElement('div', { className: 'fixed bottom-20 right-4 z-50' },
        React.createElement('button', {
          onClick: function() { window.alert('Call ' + safePerson.name + ': ' + safePerson.contact); },
          className: 'w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 text-white font-bold text-3xl shadow-lg hover:shadow-xl transition-all',
          title: 'Emergency: Call ' + safePerson.name
        }, '📞'))
    : null;
}

function SupportNetwork() {
  var store = useStore();
  var network = (store.state.recovery.supportNetwork || []);
  var _name = useState(''); var name = _name[0]; var setName = _name[1];
  var _role = useState('sponsor'); var role = _role[0]; var setRole = _role[1];
  var _contact = useState(''); var contact = _contact[0]; var setContact = _contact[1];
  var _showForm = useState(false); var showForm = _showForm[0]; var setShowForm = _showForm[1];

  function add() {
    if (!name.trim() || !contact.trim()) return;
    store.dispatch({ type: 'ADD_SUPPORT', name: name.trim(), role: role, contact: contact.trim() });
    setName('');
    setContact('');
    setRole('sponsor');
    setShowForm(false);
    chime(880, 0.1);
  }

  function remove(id) {
    store.dispatch({ type: 'REMOVE_SUPPORT', id: id });
  }

  var roleColors = { sponsor: '#3b82f6', mentor: '#8b5cf6', therapist: '#ec4899', friend: '#14b8a6' };

  return React.createElement(Card, { title: '🤝 Support Network', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-2' },
      React.createElement('button', {
        onClick: function() { setShowForm(!showForm); },
        className: 'w-full text-xs text-indigo-400 hover:text-indigo-300 underline'
      }, showForm ? 'Hide' : '+ Add person'),
      showForm
        ? React.createElement('div', { className: 'space-y-1 bg-gray-800 rounded p-2' },
            React.createElement('input', {
              placeholder: 'Name...',
              value: name,
              onChange: function(e) { setName(e.target.value); },
              maxLength: '30',
              className: 'w-full bg-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-500'
            }),
            React.createElement('select', {
              value: role,
              onChange: function(e) { setRole(e.target.value); },
              className: 'w-full bg-gray-700 rounded px-2 py-1 text-xs text-white'
            },
              React.createElement('option', { value: 'sponsor' }, 'Sponsor'),
              React.createElement('option', { value: 'mentor' }, 'Mentor'),
              React.createElement('option', { value: 'therapist' }, 'Therapist'),
              React.createElement('option', { value: 'friend' }, 'Friend')),
            React.createElement('input', {
              placeholder: 'Phone/Email...',
              value: contact,
              onChange: function(e) { setContact(e.target.value); },
              maxLength: '40',
              className: 'w-full bg-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-500'
            }),
            React.createElement('button', {
              onClick: add,
              disabled: !name.trim() || !contact.trim(),
              className: 'w-full py-1 rounded text-xs font-semibold ' + (name.trim() && contact.trim() ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed')
            }, 'Add'))
        : null,
      network.length > 0
        ? React.createElement('div', { className: 'space-y-1' },
            network.map(function(person) {
              return React.createElement('div', { key: person.id, className: 'flex items-start gap-2 p-1.5 rounded bg-gray-800 hover:bg-gray-700 group' },
                React.createElement('div', { className: 'flex-1 min-w-0' },
                  React.createElement('div', { className: 'text-xs font-semibold text-gray-200' }, person.name),
                  React.createElement('div', { className: 'text-xs mt-0.5' },
                    React.createElement('span', { style: { color: roleColors[person.role] } }, person.role),
                    React.createElement('span', { className: 'text-gray-600 mx-1' }, '•'),
                    React.createElement('span', { className: 'text-gray-500' }, person.contact))),
                React.createElement('button', {
                  onClick: function() { remove(person.id); },
                  className: 'text-xs text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100'
                }, '✕'));
            }))
        : null
    )
  );
}

function SobrietyCounter() {
  var store = useStore();
  var sob = store.state.recovery.sobriety || {};
  var startDate = sob.startDate ? new Date(sob.startDate) : new Date();
  var now = new Date();
  var daysSober = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
  var _reset = useState(false); var reset = _reset[0]; var setReset = _reset[1];
  var _showBadges = useState(false); var showBadges = _showBadges[0]; var setShowBadges = _showBadges[1];

  var milestones = [7, 14, 30, 60, 90, 180, 365];
  var achievedMilestones = milestones.filter(function(m) { return m <= daysSober; });
  var nextMilestone = milestones.find(function(m) { return m > daysSober; });
  var daysToNext = nextMilestone ? nextMilestone - daysSober : null;
  var badgeEmojis = { 7: '🌟', 14: '⭐', 30: '🏆', 60: '👑', 90: '💎', 180: '🔥', 365: '🌈' };

  function resetSobriety() {
    if (!window.confirm('Reset sobriety date to today?')) return;
    store.dispatch({ type: 'SET_SOBRIETY_START', date: todayISO() });
    setReset(false);
    buzz(3);
  }

  return React.createElement(Card, { title: '🌚 Sobriety Counter', collapsible: true, defaultOpen: false },
    React.createElement('div', { className: 'space-y-3' },
      React.createElement('div', { className: 'text-center py-4' },
        React.createElement('div', { className: 'text-6xl font-bold text-indigo-400' }, daysSober),
        React.createElement('div', { className: 'text-sm text-gray-400 mt-2' }, daysSober === 1 ? 'day sober' : 'days sober')),
      daysToNext
        ? React.createElement('div', { className: 'bg-gray-800 rounded p-2 text-center' },
            React.createElement('div', { className: 'text-xs text-gray-400' }, nextMilestone + ' days — ', daysToNext, ' to go'),
            React.createElement('div', { className: 'h-1 bg-gray-700 rounded mt-1 overflow-hidden' },
              React.createElement('div', { className: 'h-1 bg-indigo-500', style: { width: (daysSober / nextMilestone * 100) + '%' } })))
        : React.createElement('div', { className: 'bg-green-900 bg-opacity-30 rounded p-2 text-center' },
            React.createElement('div', { className: 'text-sm font-semibold text-green-300' }, '🎉 Year milestone reached!'),
            React.createElement('div', { className: 'text-xs text-gray-400 mt-1' }, daysSober, ' days of strength')),
      React.createElement('div', { className: 'text-xs text-gray-500' },
        React.createElement('div', null, 'Since: ', sob.startDate),
        sob.longestStreakDays
          ? React.createElement('div', { className: 'mt-1' }, 'Longest streak: ', sob.longestStreakDays, ' days')
          : null),
      achievedMilestones.length > 0
        ? React.createElement('div', { className: 'bg-purple-900 bg-opacity-30 rounded p-2 text-center' },
            React.createElement('button', {
              onClick: function() { setShowBadges(!showBadges); },
              className: 'text-sm font-semibold text-purple-300 hover:text-purple-200 w-full'
            }, showBadges ? 'Hide badges' : 'Show ' + achievedMilestones.length + ' badge' + (achievedMilestones.length !== 1 ? 's' : '')),
            showBadges
              ? React.createElement('div', { className: 'flex flex-wrap gap-2 justify-center mt-2' },
                  achievedMilestones.map(function(m) {
                    return React.createElement('div', { key: m, className: 'text-center' },
                      React.createElement('div', { className: 'text-3xl', dangerouslySetInnerHTML: { __html: badgeEmojis[m] } }),
                      React.createElement('div', { className: 'text-xs text-purple-300' }, m, ' days'));
                  }))
              : null)
        : null,
      React.createElement('button', {
        onClick: function() { setReset(!reset); },
        className: 'text-xs text-gray-500 underline hover:text-gray-400'
      }, reset ? 'Cancel' : 'Reset sobriety date'),
      reset
        ? React.createElement('button', {
            onClick: resetSobriety,
            className: 'w-full py-1 rounded text-sm bg-red-900 hover:bg-red-800 text-red-100'
          }, 'Confirm reset to today')
        : null
    )
  );
}

function UrgeSurfingTimer() {
  var _run = useState(false); var running = _run[0]; var setRunning = _run[1];
  var _secs = useState(0); var secs = _secs[0]; var setSecs = _secs[1];
  var _done = useState(false); var done = _done[0]; var setDone = _done[1];

  React.useEffect(function(){
    if (!running) return;
    var id = setInterval(function(){ setSecs(function(s){ return s+1; }); }, 1000);
    return function(){ clearInterval(id); };
  }, [running]);

  React.useEffect(function(){
    if (secs >= 600 && running) { setRunning(false); setDone(true); }
  }, [secs, running]);

  var MILESTONES = [
    { s:60,  msg:'One minute in. The urge peaks now — hold on.' },
    { s:120, msg:'Two minutes. Peak intensity is passing.' },
    { s:180, msg:'Three minutes. Your brain is recalibrating.' },
    { s:300, msg:'Five minutes. The craving is losing its grip.' },
    { s:480, msg:'Eight minutes. You are winning this.' },
    { s:600, msg:'Ten minutes. Most cravings dissolve in 10 — you did it.' },
  ];

  var m = Math.floor(secs/60); var s = secs%60;
  var timeStr = m + ':' + String(s).padStart(2,'0');

  var currentMsg = '';
  for (var i = MILESTONES.length-1; i >= 0; i--) {
    if (secs >= MILESTONES[i].s) { currentMsg = MILESTONES[i].msg; break; }
  }
  if (!currentMsg && running) currentMsg = 'Stay with it. Urges always pass.';

  var pct = Math.min(100, Math.round((secs/600)*100));
  var ringColor = done ? '#22c55e' : secs >= 300 ? '#3b82f6' : secs >= 120 ? '#eab308' : '#f97316';
  var r = 40; var circ = 2*Math.PI*r;
  var dash = circ*(pct/100); var gap = circ - dash;

  function reset() { setRunning(false); setSecs(0); setDone(false); }

  return (
    <Card className="border-rose/20 space-y-3">
      <div className="flex items-center gap-2">
        <span dangerouslySetInnerHTML={{__html:'🌊'}} />
        <span className="text-sm font-medium">Urge surfing timer</span>
        <span className="text-[10px] text-faint ml-auto">Most cravings pass in 10 min</span>
      </div>
      <div className="flex items-center gap-5">
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#1e293b" strokeWidth="8"/>
          <circle cx="50" cy="50" r={r} fill="none" stroke={ringColor} strokeWidth="8"
            strokeDasharray={dash + ' ' + gap} strokeDashoffset={circ/4}
            strokeLinecap="round" style={{transition:'stroke-dasharray 0.5s ease, stroke 0.5s ease'}}/>
          <text x="50" y="46" textAnchor="middle" fill="#e2e8f0" fontSize="16" fontWeight="bold">{timeStr}</text>
          <text x="50" y="61" textAnchor="middle" fill="#94a3b8" fontSize="9">{pct}%</text>
        </svg>
        <div className="flex-1 space-y-3">
          {currentMsg ? (
            <div className="text-sm text-paper/80 leading-snug italic">{currentMsg}</div>
          ) : (
            <div className="text-sm text-faint leading-snug">Press start when an urge hits. Watch the ring fill as the craving fades.</div>
          )}
          {done && (
            <div className="bg-grow/10 border border-grow/30 rounded-xl px-3 py-2 text-sm text-grow font-medium">You surfed it. Ten full minutes.</div>
          )}
          <div className="flex gap-2">
            {!running && !done && (
              <button className="flex-1 bg-rose/20 hover:bg-rose/30 text-rose font-semibold rounded-xl py-2 text-sm transition"
                onClick={function(){ setRunning(true); setSecs(0); }}>Start</button>
            )}
            {running && (
              <button className="flex-1 bg-panel2 hover:bg-edge/30 text-paper font-semibold rounded-xl py-2 text-sm transition"
                onClick={function(){ setRunning(false); }}>Pause</button>
            )}
            {!running && secs > 0 && (
              <button className="flex-1 bg-panel2 hover:bg-edge/30 text-faint rounded-xl py-2 text-sm transition"
                onClick={reset}>Reset</button>
            )}
            {!running && secs > 0 && !done && (
              <button className="flex-1 bg-grow/20 hover:bg-grow/30 text-grow font-semibold rounded-xl py-2 text-sm transition"
                onClick={function(){ setRunning(true); }}>Resume</button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function CrisisStrip() {
  const { state } = useStore();
  const personal = (state.recovery.personal||[]).map(p=>({ label:p.label, sub:'your person', tel:(p.tel||'').replace(/\s/g,''), show:p.tel }));
  const all = [...(state.recovery.contacts||[]), ...personal];
  return (
    <div className="space-y-2">
      <div className="text-faint text-xs uppercase tracking-wide">Reach a human — anytime, no shame</div>
      {all.map((c,i)=>(
        <a key={i} href={'tel:'+c.tel} className="flex items-center justify-between gap-3 bg-panel border border-edge rounded-2xl px-4 py-3 hover:border-rose/50 transition">
          <div className="min-w-0"><div className="font-semibold">{c.label}</div><div className="text-faint text-xs">{c.sub}</div></div>
          <div className="text-rose font-semibold tabnum whitespace-nowrap shrink-0">{c.show}</div>
        </a>
      ))}
    </div>
  );
}

/* ============================ Module 4 · RECOVERY ============================ */
function WaveSurf({ onDone }) {
  const { dispatch } = useStore();
  const [view, setView] = useState('intro'); // intro | surf | after
  const [mins, setMins] = useState(15);
  const [before, setBefore] = useState(7);
  const [after, setAfter] = useState(3);
  const timer = useCountdown(() => setView('after'));

  const start = () => { setView('surf'); timer.start(mins*60); dispatch({ type:'EMIT', event:'recovery.urge_surf_started', payload:{ mins, before } }); };
  const stopEarly = () => { timer.pause(); setView('after'); };
  const save = () => {
    const elapsed = mins*60 - timer.secondsLeft;
    dispatch({ type:'URGE_SURF', session:{ durationSec: elapsed, plannedSec: mins*60, completed: timer.secondsLeft<=0, intensityBefore: before, intensityAfter: after } });
    dispatch({ type:'EMIT', event:'recovery.urge_surf_done', payload:{ before, after, completed: timer.secondsLeft<=0 } });
    onDone();
  };

  if (view==='intro') return (
    <div className="space-y-5 rise">
      <p className="text-faint">An urge is a wave. It rises, it peaks, and it <i>always</i> breaks. You don't have to fight it or feed it — just float and let it pass.</p>
      <Card><Slider label="How strong is the urge right now?" value={before} onChange={setBefore} color="#ff9aa6" /></Card>
      <div className="flex gap-2 justify-center">
        {[5,10,15].map(m=>(
          <button key={m} onClick={()=>setMins(m)} className={'px-4 py-2 rounded-xl '+(mins===m?'bg-brand text-ink font-semibold':'bg-panel2 text-faint')}>{m} min</button>
        ))}
      </div>
      <Btn tone="primary" className="w-full" onClick={start}>Start surfing the urge</Btn>
    </div>
  );

  if (view==='surf') {
    const frac = timer.total ? 1 - timer.secondsLeft/timer.total : 0;
    const level = Math.sin(frac*Math.PI);
    const pct = Math.round(8 + level*80);
    const guide = frac<0.18 ? 'Notice the urge arriving. You don\'t have to do anything about it.'
      : frac<0.42 ? 'It\'s rising. Let it. You can feel this fully and still not act.'
      : frac<0.60 ? 'This is the peak. Stay with me. It cannot make you do anything.'
      : frac<0.85 ? 'Feel it starting to fall. The wave is breaking.'
      : 'It\'s passing. You rode it out — that\'s the skill, right there.';
    return (
      <div className="space-y-4 rise">
        <div className="relative h-72 rounded-3xl overflow-hidden border border-edge bg-panel">
          <div className="absolute inset-x-0 bottom-0" style={{ height: pct+'%', transition:'height 1s linear', background:'linear-gradient(180deg,#6aa0ff 0%, #3a5fa8 100%)' }}>
            <svg className="absolute -top-3 left-0 w-[200%] h-6" viewBox="0 0 1200 40" preserveAspectRatio="none" style={{ animation:'drift 7s linear infinite' }}>
              <path d="M0,20 C150,0 300,40 600,20 C900,0 1050,40 1200,20 L1200,40 L0,40 Z" fill="#6aa0ff"/>
            </svg>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <div className="text-4xl font-bold tabnum drop-shadow">{fmt(timer.secondsLeft)}</div>
          </div>
        </div>
        <p className="text-center text-paper min-h-[3rem] px-2">{guide}</p>
        <div className="flex gap-2 justify-center">
          {timer.running ? <Btn tone="ghost" onClick={timer.pause}>Pause</Btn> : <Btn tone="ghost" onClick={timer.resume}>Resume</Btn>}
          <Btn tone="grow" onClick={stopEarly}>I'm okay now</Btn>
        </div>
      </div>
    );
  }

  // after
  return (
    <div className="space-y-5 rise">
      <div className="text-center text-5xl">🌊</div>
      <p className="text-center text-paper">You stayed with it without acting. However strong it was, you proved it passes.</p>
      <Card><Slider label="How strong is the urge now?" value={after} onChange={setAfter} color="#3ddc97" /></Card>
      <Btn tone="grow" className="w-full" onClick={save}>Done — log it</Btn>
    </div>
  );
}

function TIPPView() {
  const [open, setOpen] = useState('paced');
  return (
    <div className="space-y-3 rise">
      <p className="text-faint">Fast ways to drop the intensity in your body when everything is too much.</p>
      {TIPP.map(t => (
        <Card key={t.key} onClick={()=>setOpen(open===t.key?null:t.key)} className="cursor-pointer">
          <div className="flex items-center gap-3">
            <div className="text-3xl">{t.emoji}</div>
            <div className="flex-1 font-semibold">{t.title}</div>
            <div className="text-faint text-xl">{open===t.key?'–':'+'}</div>
          </div>
          {open===t.key && (
            <div className="mt-3 text-faint">
              {t.desc}
              {t.key==='paced' && <div className="mt-4 flex justify-center"><BoxBreath/></div>}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function RelapseFlow({ onDone }) {
  const { state, dispatch } = useStore();
  const [step, setStep] = useState(0);
  const [what, setWhat] = useState('');
  const [need, setNeed] = useState('');
  const [next, setNext] = useState('');
  const preservedTotal = state.recovery.sobriety.totalDaysClean + daysBetween(state.recovery.sobriety.startDate, todayISO());

  const commit = () => {
    dispatch({ type:'RELAPSE', entry:{ what, need, next, reflection:[what,need,next].filter(Boolean).join(' | '), selfCompassionDone:true } });
    dispatch({ type:'EMIT', event:'recovery.relapse_logged', payload:{} });
    setStep(2);
  };

  if (step===0) return (
    <div className="space-y-5 rise">
      <div className="text-center text-5xl">🌱</div>
      <h2 className="text-xl font-semibold text-center">This is part of recovery, not the end of it.</h2>
      <p className="text-faint text-center">A lapse is information, not a verdict. You're not back to zero — nothing you've built disappears. Let's be gentle and figure out the next small step together.</p>
      <Btn tone="grow" className="w-full" onClick={()=>setStep(1)}>I'm ready</Btn>
      <button onClick={onDone} className="w-full text-faint text-sm">Not now</button>
    </div>
  );

  if (step===1) return (
    <div className="space-y-4 rise">
      <h2 className="text-xl font-semibold">No judgement. Just notice.</h2>
      <div>
        <div className="text-faint text-sm mb-1">What happened?</div>
        <textarea value={what} onChange={e=>setWhat(e.target.value)} className="w-full bg-panel border border-edge rounded-2xl p-3 text-paper outline-none focus:border-grow min-h-[70px]" />
      </div>
      <div>
        <div className="text-faint text-sm mb-1">What did you actually need in that moment?</div>
        <textarea value={need} onChange={e=>setNeed(e.target.value)} className="w-full bg-panel border border-edge rounded-2xl p-3 text-paper outline-none focus:border-grow min-h-[70px]" />
      </div>
      <div>
        <div className="text-faint text-sm mb-1">One small, kind next step?</div>
        <textarea value={next} onChange={e=>setNext(e.target.value)} className="w-full bg-panel border border-edge rounded-2xl p-3 text-paper outline-none focus:border-grow min-h-[70px]" />
      </div>
      <Btn tone="grow" className="w-full" onClick={commit}>Save & be kind to myself</Btn>
    </div>
  );

  // step 2 — affirmation, NEVER punitive
  return (
    <div className="space-y-5 rise text-center">
      <div className="text-5xl">💚</div>
      <h2 className="text-xl font-semibold">Your recovery still stands.</h2>
      <Card className="border-grow/30">
        <div className="text-3xl font-bold text-grow tabnum">{preservedTotal} days</div>
        <div className="text-faint text-sm">of recovery — kept, not erased.</div>
      </Card>
      <p className="text-faint">Today is day one of your next stretch, and that is completely okay. Showing up here right now <i>is</i> the work.</p>
      <CrisisStrip />
      <Btn tone="grow" className="w-full" onClick={onDone}>Continue</Btn>
    </div>
  );
}

var TRIGGER_CHIPS = [
  'Stress','Boredom','Loneliness','Conflict','Celebration','Social pressure',
  'Anxiety','Bad news','Cravings','Fatigue','Anger','Nostalgia',
];

function TriggerLog({ onDone }) {
  const { state, dispatch } = useStore();
  const [selected, setSelected] = useState([]);
  const [custom, setCustom] = useState('');
  const [intensity, setIntensity] = useState(5);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);

  var recent = (state.recovery.triggers || []).slice(0, 8);

  var toggle = function(chip) {
    setSelected(function(s) {
      return s.includes(chip) ? s.filter(function(x){ return x !== chip; }) : [...s, chip];
    });
  };

  var save = function() {
    var tags = selected.slice();
    if (custom.trim()) tags.push(custom.trim());
    if (!tags.length) return;
    dispatch({ type:'TRIGGER_LOG', trigger:{ tags: tags, intensity: intensity, note: note.trim() } });
    buzz(15); chime(440, 0.2);
    setDone(true);
  };

  if (done) return (
    <div className="rise space-y-4 text-center py-6">
      <div className="text-5xl">📌</div>
      <div className="text-paper font-semibold">Logged. Awareness is the first move.</div>
      <p className="text-faint text-sm">You named it — that puts distance between you and it.</p>
      <Btn tone="grow" className="w-full mt-2" onClick={onDone}>Back to safety tools</Btn>
    </div>
  );

  return (
    <div className="rise space-y-5">
      <p className="text-faint text-sm">What was going on? Pick all that apply.</p>
      <div className="flex flex-wrap gap-2">
        {TRIGGER_CHIPS.map(function(c){
          var sel = selected.includes(c);
          return (
            <button key={c} onClick={function(){toggle(c);}}
              className={'px-3 py-1.5 rounded-full text-sm border transition '+(sel?'border-calm bg-calm/20 text-paper':'border-edge text-faint hover:border-calm/40')}>
              {c}
            </button>
          );
        })}
      </div>
      <input value={custom} onChange={function(e){setCustom(e.target.value);}} placeholder="Something else..."
        className="w-full bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-sm outline-none focus:border-calm" />
      <div>
        <div className="flex justify-between text-xs text-faint mb-1">
          <span>Urge intensity</span><span className="text-paper font-semibold tabnum">{intensity}/10</span>
        </div>
        <input type="range" min="1" max="10" value={intensity} onChange={function(e){setIntensity(+e.target.value);}}
          className="w-full accent-calm" />
      </div>
      <textarea value={note} onChange={function(e){setNote(e.target.value);}} placeholder="Anything else about the moment? (optional)"
        className="w-full bg-panel border border-edge rounded-2xl p-4 text-paper text-sm placeholder-faint/60 outline-none focus:border-calm min-h-[70px]" />
      <Btn tone="calm" className="w-full" onClick={save} disabled={selected.length === 0 && !custom.trim()}>Save trigger</Btn>
      {recent.length > 0 && (
        <div className="pt-2">
          <div className="text-xs text-faint mb-2">Recent triggers</div>
          <div className="space-y-1">
            {recent.map(function(t, i){
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-faint opacity-60">{t.ts.slice(5,10)}</span>
                  <span className="text-paper/70">{(t.tags||[]).join(', ')}</span>
                  <span className="ml-auto text-calm/70">intensity {t.intensity}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TriggerPatterns() {
  var [open, setOpen] = useState(false);
  var store = useStore(); var state = store.state;
  var triggers = state.recovery.triggers || [];
  if (triggers.length < 3) return null;
  var tagCounts = {};
  var tagIntensity = {};
  triggers.forEach(function(t) {
    (t.tags || []).forEach(function(tag) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      tagIntensity[tag] = (tagIntensity[tag] || 0) + (t.intensity || 5);
    });
  });

  var TOD_BLOCKS = [
    { label:'Night', range:'10pm–6am', hours:[22,23,0,1,2,3,4,5], icon:'🌒' },
    { label:'Morning', range:'6am–12pm', hours:[6,7,8,9,10,11], icon:'🌙' },
    { label:'Afternoon', range:'12–6pm', hours:[12,13,14,15,16,17], icon:'🌞' },
    { label:'Evening', range:'6–10pm', hours:[18,19,20,21], icon:'🌓' },
  ];
  var todCounts = [0,0,0,0];
  triggers.forEach(function(t) {
    try {
      var h = new Date(t.ts).getHours();
      for (var bi = 0; bi < TOD_BLOCKS.length; bi++) {
        if (TOD_BLOCKS[bi].hours.indexOf(h) >= 0) { todCounts[bi]++; break; }
      }
    } catch(e){}
  });
  var todMax = Math.max.apply(null, todCounts) || 1;
  var peakIdx = todCounts.indexOf(Math.max.apply(null, todCounts));
  var sorted = Object.keys(tagCounts).sort(function(a,b){ return tagCounts[b] - tagCounts[a]; }).slice(0,7);
  var maxCount = sorted.length ? tagCounts[sorted[0]] : 1;
  var avgIntensityOverall = triggers.length
    ? triggers.reduce(function(s,t){ return s + (t.intensity || 5); }, 0) / triggers.length
    : 5;
  var last30 = new Date(); last30.setDate(last30.getDate() - 30);
  var last30str = last30.toISOString();
  var recent30 = triggers.filter(function(t){ return t.ts >= last30str; }).length;
  return (
    <div className="bg-panel rounded-3xl border border-edge/40 px-5 py-4">
      <button className="w-full flex items-center justify-between" onClick={function(){ setOpen(!open); }}>
        <div className="flex items-center gap-2">
          <span className="text-base">📊</span>
          <span className="text-sm font-semibold">Trigger patterns</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-faint text-xs">{triggers.length} logged</span>
          <span className="text-faint text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-panel2 rounded-xl px-3 py-2 text-center">
              <div className="text-calm font-bold tabnum">{recent30}</div>
              <div className="text-faint text-[10px]">last 30 days</div>
            </div>
            <div className="bg-panel2 rounded-xl px-3 py-2 text-center">
              <div className="text-calm font-bold tabnum">{avgIntensityOverall.toFixed(1)}/10</div>
              <div className="text-faint text-[10px]">avg intensity</div>
            </div>
          </div>
          {sorted.length > 0 && (
            <div className="space-y-2">
              <div className="text-faint text-xs">Top triggers</div>
              {sorted.map(function(tag) {
                var count = tagCounts[tag];
                var pct = Math.round((count / maxCount) * 100);
                var avgInt = tagIntensity[tag] / count;
                return (
                  <div key={tag} className="space-y-0.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-paper">{tag}</span>
                      <span className="text-faint tabnum">{count}× · avg {avgInt.toFixed(0)}/10</span>
                    </div>
                    <div className="h-1.5 bg-panel2 rounded-full overflow-hidden">
                      <div className="h-full bg-calm/60 rounded-full transition-all" style={{width: pct + '%'}} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {sorted.length > 0 && (
            <div className="text-xs text-faint italic px-1">
              Knowing your patterns gives you a head start.
            </div>
          )}
          {todMax > 0 && (function(){
            return (
              <div className="space-y-2">
                <div className="text-faint text-xs">When triggers hit</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {TOD_BLOCKS.map(function(block, i){
                    var count = todCounts[i];
                    var barH = count > 0 ? Math.max(16, Math.round((count / todMax) * 56)) : 6;
                    var isPeak = i === peakIdx && count > 0;
                    return (
                      <div key={i} className="flex flex-col items-center gap-1">
                        <div className="flex flex-col-reverse" style={{height:'64px', justifyContent:'flex-start'}}>
                          <div
                            className={'w-full rounded-t-lg transition-all ' + (isPeak ? 'bg-warn/70' : 'bg-calm/30')}
                            style={{height: barH + 'px', minHeight: count > 0 ? '6px' : '2px'}}
                          />
                        </div>
                        <span className="text-xs" dangerouslySetInnerHTML={{__html: block.icon}} />
                        <div className="text-center">
                          <div className={'text-xs tabnum font-semibold ' + (isPeak ? 'text-warn' : 'text-faint')}>{count}</div>
                          <div className="text-[9px] text-faint leading-tight">{block.label}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {todCounts[peakIdx] > 0 && (
                  <div className="text-[11px] text-faint/80 italic">
                    Most triggers in the <span className="text-warn/80 not-italic font-medium">{TOD_BLOCKS[peakIdx].label.toLowerCase()}</span> ({TOD_BLOCKS[peakIdx].range})
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

var RECOVERY_QUOTES = [
  { text: 'You don\'t have to see the whole staircase. Just take the first step.', author: 'Martin Luther King Jr.' },
  { text: 'Recovery is not a race. You don\'t have to feel guilty if it takes you longer than you thought it would.', author: 'Anonymous' },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'Every day is a new beginning. Take a deep breath and start again.', author: 'Anonymous' },
  { text: 'You are braver than you believe, stronger than you seem, and smarter than you think.', author: 'A.A. Milne' },
  { text: 'Rock bottom became the solid foundation on which I rebuilt my life.', author: 'J.K. Rowling' },
  { text: 'The only way out is through.', author: 'Robert Frost' },
  { text: 'Courage isn\'t having the strength to go on — it is going on when you don\'t have strength.', author: 'Napoleon Bonaparte' },
  { text: 'What lies behind us and what lies before us are tiny matters compared to what lies within us.', author: 'Ralph Waldo Emerson' },
  { text: 'In the middle of every difficulty lies opportunity.', author: 'Albert Einstein' },
  { text: 'It always seems impossible until it\'s done.', author: 'Nelson Mandela' },
  { text: 'You have within you right now, everything you need to deal with whatever the world can throw at you.', author: 'Brian Tracy' },
  { text: 'Our greatest glory is not in never falling, but in rising every time we fall.', author: 'Confucius' },
  { text: 'The greatest weapon against stress is our ability to choose one thought over another.', author: 'William James' },
  { text: 'Although the world is full of suffering, it is also full of the overcoming of it.', author: 'Helen Keller' },
  { text: 'Believe you can and you\'re halfway there.', author: 'Theodore Roosevelt' },
  { text: 'Each day is a gift — not a guarantee.', author: 'Anonymous' },
  { text: 'Sobriety was the greatest gift I ever gave myself.', author: 'Rob Lowe' },
  { text: 'Recovery is about progression, not perfection.', author: 'Anonymous' },
  { text: 'You can\'t go back and change the beginning, but you can start where you are and change the ending.', author: 'C.S. Lewis' },
  { text: 'One day at a time.', author: 'A.A. Tradition' },
  { text: 'Pain is inevitable. Suffering is optional.', author: 'Haruki Murakami' },
  { text: 'Stars can\'t shine without darkness.', author: 'D.H. Sidebottom' },
  { text: 'Fall seven times, stand up eight.', author: 'Japanese Proverb' },
  { text: 'You don\'t have to be defined by what happened to you.', author: 'Anonymous' },
  { text: 'The body heals with play, the mind heals with laughter, and the spirit heals with joy.', author: 'Proverb' },
  { text: 'This too shall pass.', author: 'Persian Proverb' },
  { text: 'I am not what happened to me. I am what I choose to become.', author: 'Carl Jung' },
  { text: 'Even the darkest night will end, and the sun will rise.', author: 'Victor Hugo' },
  { text: 'You are enough, exactly as you are.', author: 'Anonymous' },
];

var RECOVERY_MILESTONES = [
  { days:1,   icon:'🌱', label:'24 hours' },
  { days:3,   icon:'🌱', label:'72 hours' },
  { days:7,   icon:'🌱', label:'1 week' },
  { days:14,  icon:'🌿', label:'2 weeks' },
  { days:21,  icon:'🌿', label:'3 weeks' },
  { days:30,  icon:'💚', label:'1 month' },
  { days:60,  icon:'💚', label:'2 months' },
  { days:90,  icon:'🎍', label:'90 days' },
  { days:120, icon:'🎍', label:'4 months' },
  { days:180, icon:'⭐',  label:'6 months' },
  { days:270, icon:'⭐',  label:'9 months' },
  { days:365, icon:'🏆', label:'1 year' },
  { days:500, icon:'🏆', label:'500 days' },
  { days:730, icon:'🏆', label:'2 years' },
];

function DailyRecoveryQuote() {
  var now = new Date();
  var start = new Date(now.getFullYear(), 0, 0);
  var dayOfYear = Math.floor((now - start) / dayMs);
  var q = RECOVERY_QUOTES[(dayOfYear + now.getFullYear()) % RECOVERY_QUOTES.length];
  var [saved, setSaved] = useState(false);
  return (
    <div className="rounded-2xl border border-warm/20 bg-panel px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className="text-warm/60 text-lg leading-none mt-0.5" dangerouslySetInnerHTML={{__html:'❝'}} />
        <p className="text-paper/90 text-sm leading-relaxed italic flex-1">{q.text}</p>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-faint text-xs">— {q.author}</span>
        <button onClick={function(){setSaved(!saved); if(!saved){ buzz(15); chime(440,0.2); }}}
          className={'text-xs px-2 py-0.5 rounded-full border transition ' + (saved ? 'border-warm/40 text-warm bg-warm/10' : 'border-edge/40 text-faint hover:border-warm/30')}>
          {saved ? '♥ saved' : 'save'}
        </button>
      </div>
    </div>
  );
}

function RecoveryMilestones({ clean }) {
  var earned = RECOVERY_MILESTONES.filter(function(m){ return clean >= m.days; });
  var upcoming = RECOVERY_MILESTONES.filter(function(m){ return clean < m.days; });
  var lastEarned = earned.length > 0 ? earned[earned.length - 1] : null;
  var nextFour = upcoming.slice(0, 4);
  var _exp = useState(false); var exp = _exp[0]; var setExp = _exp[1];

  var timelineItems = [];
  if (lastEarned) timelineItems.push({ type:'earned', m: lastEarned });
  timelineItems.push({ type:'now', days: clean });
  nextFour.forEach(function(m){ timelineItems.push({ type:'future', m:m }); });

  return (
    <Card className="space-y-3">
      <button className="w-full flex items-center justify-between" onClick={function(){ setExp(!exp); }}>
        <div className="flex items-center gap-2">
          <span className="text-base">🏅</span>
          <span className="text-sm font-medium">Milestone timeline</span>
          {lastEarned && <span className="text-[10px] text-grow">✓ {earned.length} earned</span>}
        </div>
        <span className="text-faint text-xs" dangerouslySetInnerHTML={{__html: exp ? '▲' : '▼'}} />
      </button>

      {nextFour.length > 0 && (function(){
        var next = nextFour[0];
        var prev = lastEarned ? lastEarned.days : 0;
        var span = next.days - prev;
        var pct = span > 0 ? Math.min(100, Math.round(((clean - prev) / span) * 100)) : 100;
        return React.createElement('div', { className:'space-y-1' },
          React.createElement('div', { className:'flex items-center justify-between text-xs' },
            React.createElement('span', { className:'text-faint' }, 'Next: ', React.createElement('span', { className:'text-paper' }, next.label)),
            React.createElement('span', { className:'text-brand font-bold tabnum' }, (next.days - clean) + ' day' + (next.days - clean !== 1 ? 's' : '') + ' away')
          ),
          React.createElement('div', { className:'relative h-2 bg-edge/20 rounded-full overflow-hidden' },
            React.createElement('div', { className:'absolute h-full bg-grow rounded-full transition-all', style:{ width:pct+'%' } })
          )
        );
      })()}

      {exp && React.createElement('div', { className:'pt-1' },
        timelineItems.map(function(item, idx){
          var isLast = idx === timelineItems.length - 1;
          if (item.type === 'now') return React.createElement('div', { key:'now', className:'flex items-center gap-3 py-1' },
            React.createElement('div', { className:'flex flex-col items-center w-6 flex-shrink-0' },
              React.createElement('div', { className:'w-3 h-3 rounded-full bg-grow ring-2 ring-grow/40 flex-shrink-0' }),
              !isLast && React.createElement('div', { className:'w-0.5 h-5 bg-edge/40 mt-0.5' })
            ),
            React.createElement('div', { className:'flex-1' },
              React.createElement('div', { className:'text-xs font-semibold text-grow' }, 'Day ' + clean + ' — today'),
              React.createElement('div', { className:'text-[10px] text-faint' }, 'You are here. Keep going.')
            )
          );
          if (item.type === 'earned') return React.createElement('div', { key:item.m.days, className:'flex items-center gap-3 py-1' },
            React.createElement('div', { className:'flex flex-col items-center w-6 flex-shrink-0' },
              React.createElement('div', { className:'w-5 h-5 rounded-full bg-grow/20 border border-grow/50 flex items-center justify-center text-[10px]', dangerouslySetInnerHTML:{__html:'✓'} }),
              !isLast && React.createElement('div', { className:'w-0.5 h-5 bg-grow/30 mt-0.5' })
            ),
            React.createElement('div', { className:'flex items-center gap-2 flex-1' },
              React.createElement('span', { dangerouslySetInnerHTML:{__html:item.m.icon} }),
              React.createElement('span', { className:'text-xs text-grow/80' }, item.m.label),
              React.createElement('span', { className:'text-[10px] text-faint ml-auto' }, '✓ done')
            )
          );
          var daysAway = item.m.days - clean;
          return React.createElement('div', { key:item.m.days, className:'flex items-center gap-3 py-1' },
            React.createElement('div', { className:'flex flex-col items-center w-6 flex-shrink-0' },
              React.createElement('div', { className:'w-4 h-4 rounded-full border border-edge/50 bg-panel2 flex-shrink-0' }),
              !isLast && React.createElement('div', { className:'w-0.5 h-5 bg-edge/20 mt-0.5' })
            ),
            React.createElement('div', { className:'flex items-center gap-2 flex-1' },
              React.createElement('span', { className:'opacity-40', dangerouslySetInnerHTML:{__html:item.m.icon} }),
              React.createElement('span', { className:'text-xs text-faint' }, item.m.label),
              React.createElement('span', { className:'text-[10px] text-faint/60 ml-auto tabnum' }, 'in ' + daysAway + ' day' + (daysAway !== 1 ? 's' : ''))
            )
          );
        })
      )}

      {earned.length === 0 && nextFour.length > 0 && (
        <div className="text-xs text-faint">You are building something real. {nextFour[0].label} is {nextFour[0].days - clean} day{nextFour[0].days - clean !== 1 ? 's' : ''} away.</div>
      )}
    </Card>
  );
}

function RecoveryOverlay({ onClose }) {
  useEscape(onClose);
  const { state } = useStore();
  const [view, setView] = useState('home');
  const clean = daysBetween(state.recovery.sobriety.startDate, todayISO());
  const titles = { home:'You\'re safe here', surf:'Surf the urge', tipp:'Cool the body', breathe:'Just breathe', relapse:'Be gentle', trigger:'What set it off?' };

  const tiles = [
    { k:'surf',    emoji:'🌊', label:'Surf an urge',  sub:'15-min wave timer', tint:'brand' },
    { k:'tipp',    emoji:'🧊', label:'TIPP skills',   sub:'drop the intensity', tint:'calm' },
    { k:'breathe', emoji:'💨', label:'Breathe',       sub:'paced box breathing', tint:'grow' },
    { k:'relapse', emoji:'🌱', label:'I slipped',     sub:'no shame, next step', tint:'warm' },
    { k:'trigger', emoji:'📌', label:'Log a trigger', sub:'name what set it off', tint:'calm' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-ink/97 backdrop-blur overflow-y-auto">
      <div className="max-w-md mx-auto p-5 min-h-full pb-12">
        <div className="flex justify-between items-center mb-4">
          {view==='home'
            ? <h1 className="text-2xl font-semibold">{titles.home}</h1>
            : <button onClick={()=>setView('home')} className="text-faint hover:text-paper">‹ Back</button>}
          <button onClick={onClose} className="text-faint hover:text-paper p-2" aria-label="Close">✕</button>
        </div>

        {view==='home' && (
          <div className="space-y-5 rise">
            <Card className="border-grow/30 text-center">
              <div className="text-faint text-sm">You're holding</div>
              <div className="text-3xl font-bold text-grow tabnum">{clean} day{clean===1?'':'s'}</div>
              <div className="text-faint text-sm">total recovery {state.recovery.sobriety.totalDaysClean + clean} days · this moment counts</div>
            </Card>
            <RecoveryMilestones clean={clean} />
            <div className="grid grid-cols-2 gap-3">
              {tiles.slice(0,4).map(function(t){
                return (
                  <button key={t.k} onClick={function(){setView(t.k);}}
                    className={'text-left bg-panel rounded-3xl p-5 border border-edge/40 hover:border-'+t.tint+'/50 active:scale-[.98] transition'}>
                    <div className="text-4xl mb-2">{t.emoji}</div>
                    <div className="font-semibold">{t.label}</div>
                    <div className="text-faint text-xs">{t.sub}</div>
                  </button>
                );
              })}
            </div>
            <button onClick={function(){setView('trigger');}}
              className="w-full text-left bg-panel rounded-3xl px-5 py-4 border border-edge/40 hover:border-calm/50 active:scale-[.99] transition flex items-center gap-3">
              <span className="text-3xl">📌</span>
              <div>
                <div className="font-semibold">Log a trigger</div>
                <div className="text-faint text-xs">Name what set it off — awareness is armour</div>
              </div>
              <span className="ml-auto text-faint">›</span>
            </button>
            <TriggerPatterns />
            <DailyRecoveryQuote />
            <WeeklyCompassionPrompt />
            <RecoveryJournal />
            <SobrietyCounter />
            <SupportNetwork />
            <RecoveryAffirmations />
            <RelapsePreventionContract />
            <CopingSkillsChecklist />
            <SafePersonButton />
            <GroundingTechnique />
            <BoxBreathingTimer />
            <DistractionActivities />
            <CravingIntensityTracker />
            <RelapsePreventionToolkit />
            <UrgeSurfingTimer />
            <CrisisPlan />
            <CrisisStrip />
          </div>
        )}

        {view!=='home' && <div className="mb-2"><h2 className="text-xl font-semibold mb-3">{titles[view]}</h2></div>}
        {view==='surf'    && <WaveSurf onDone={()=>setView('home')} />}
        {view==='tipp'    && <TIPPView />}
        {view==='breathe' && <div className="rise space-y-4 text-center"><p className="text-faint">Follow the circle. Let your out-breath be longer than your in-breath.</p><div className="flex justify-center py-4"><BoxBreath/></div></div>}
        {view==='relapse' && <RelapseFlow onDone={()=>setView('home')} />}
        {view==='trigger' && <TriggerLog onDone={function(){setView('home');}} />}
      </div>
    </div>
  );
}

/* ============================ Module 3 · ANCHOR (mood + CBT) ============================ */
const TR_STEPS = [
  { k:'trigger',          q:'What happened?',              h:'The situation that set this off — just the facts, like a camera saw it.' },
  { k:'automaticThought', q:'What\'s the thought underneath?', h:'Write it the way it actually sounds in your head.' },
  { k:'evidenceFor',      q:'What makes it feel true?',    h:'' },
  { k:'evidenceAgainst',  q:'What argues against it?',     h:'What would you say to a friend who believed this about themselves?' },
  { k:'reframe',          q:'A truer, kinder version?',    h:'Not fake positivity — just fairer and more balanced.' },
];
function ThoughtRecord({ mood, onClose }) {
  const { dispatch } = useStore();
  const [i, setI] = useState(0);
  const [data, setData] = useState({});
  const [moodAfter, setMoodAfter] = useState(null);
  const onLast = i >= TR_STEPS.length;
  const save = () => {
    dispatch({ type:'THOUGHT_RECORD', record:{ ...data, moodBefore: mood?mood.key:null, moodAfter: moodAfter?moodAfter.key:null } });
    dispatch({ type:'EMIT', event:'anchor.thought_record', payload:{ moodBefore: mood?mood.key:null, moodAfter: moodAfter?moodAfter.key:null } });
    onClose();
  };

  if (onLast) return (
    <div className="space-y-4 rise">
      <h2 className="text-xl font-semibold">After working it through, how do you feel?</h2>
      <div className="grid grid-cols-5 gap-2">
        {MOODS.map(m=>(
          <button key={m.key} onClick={()=>setMoodAfter(m)} className={'rounded-2xl py-3 text-2xl border '+(moodAfter&&moodAfter.key===m.key?'border-brand bg-panel2':'border-edge bg-panel')}>{m.emoji}</button>
        ))}
      </div>
      <Btn tone="grow" className="w-full" onClick={save}>Save this thought record</Btn>
      <button onClick={()=>setI(i-1)} className="w-full text-faint text-sm">Back</button>
    </div>
  );

  const st = TR_STEPS[i];
  return (
    <div className="space-y-4 rise">
      <div className="flex gap-1.5">{TR_STEPS.map((s,k)=>(<span key={s.k} className={'h-1.5 flex-1 rounded-full '+(k<=i?'bg-calm':'bg-edge')}></span>))}</div>
      <h2 className="text-xl font-semibold">{st.q}</h2>
      {st.h && <p className="text-faint text-sm -mt-2">{st.h}</p>}
      <textarea autoFocus value={data[st.k]||''} onChange={e=>setData(d=>({...d,[st.k]:e.target.value}))}
        className="w-full bg-panel border border-edge rounded-2xl p-4 text-paper outline-none focus:border-calm min-h-[110px]" />
      <div className="flex gap-2">
        {i>0 && <Btn tone="quiet" onClick={()=>setI(i-1)}>Back</Btn>}
        <Btn tone="calm" className="flex-1" onClick={()=>setI(i+1)}>{i===TR_STEPS.length-1?'Almost done →':'Next →'}</Btn>
      </div>
    </div>
  );
}

const GROUND = [
  { n:5, sense:'things you can SEE' },
  { n:4, sense:'things you can FEEL' },
  { n:3, sense:'things you can HEAR' },
  { n:2, sense:'things you can SMELL' },
  { n:1, sense:'thing you can TASTE' },
];
function Grounding({ onClose }) {
  const [i, setI] = useState(0);
  const g = GROUND[i];
  return (
    <div className="space-y-5 rise text-center">
      <div className="text-faint text-sm">5 · 4 · 3 · 2 · 1 grounding</div>
      <div className="flex gap-2 justify-center">
        {GROUND.map((_, j) => (
          <span key={j} className={'w-3 h-3 rounded-full transition-all ' + (j < i ? 'bg-grow' : j === i ? 'bg-brand scale-125' : 'bg-edge')}></span>
        ))}
      </div>
      <div className="text-7xl font-bold text-brand tabnum">{g.n}</div>
      <div className="text-xl">{g.sense}</div>
      <p className="text-faint text-sm">Name them slowly, to yourself. No rush.</p>
      {i > 0 && <button onClick={()=>setI(i-1)} className="text-faint text-sm hover:text-paper">‹ Back</button>}
      {i < GROUND.length-1
        ? <Btn tone="primary" className="w-full" onClick={()=>setI(i+1)}>Next</Btn>
        : <Btn tone="grow" className="w-full" onClick={onClose}>I'm more here now</Btn>}
    </div>
  );
}

function AnchorScreen() {
  const { state, dispatch } = useStore();
  const [view, setView] = useState('pick'); // pick | detail | cbt | ground
  const [mood, setMood] = useState(null);
  const [energy, setEnergy] = useState(3);
  const [note, setNote] = useState('');

  const logMood = (m, en, nt) => {
    dispatch({ type:'MOOD_LOG', mood:m.key, energy:en, note:nt||'' });
    dispatch({ type:'EMIT', event:'anchor.mood_logged', payload:{ mood:m.key, energy:en } });
  };
  const pickMood = (m) => {
    setMood(m);
    if (isHardMood(m.key)) { logMood(m, null, ''); setView('cbt'); }   // auto-open CBT on Low/Anxious
    else { setEnergy(3); setNote(''); setView('detail'); }
  };

  const recent = state.anchor.moodLog.slice(0,7);

  if (view==='cbt')   return <div className="rise"><button onClick={()=>setView('pick')} className="text-faint text-sm mb-3">‹ I just needed to log it</button><p className="text-faint mb-4">That sounds heavy. Let&#39;s gently untangle one thought — it really helps.</p><ThoughtRecord mood={mood} onClose={()=>setView('pick')} /></div>;
  if (view==='ground')return <div className="rise"><button onClick={()=>setView('pick')} className="text-faint text-sm mb-3">‹ Back</button><Grounding onClose={()=>setView('pick')} /></div>;
  if (view==='breathe')return <div className="rise"><BreathingExercise onClose={()=>setView('pick')} /></div>;

  if (view==='detail') return (
    <div className="rise space-y-4">
      <button onClick={()=>setView('pick')} className="text-faint text-sm">‹ Back</button>
      <div className="text-center"><div className="text-6xl">{mood.emoji}</div><div className="text-faint mt-1">Feeling {mood.label.toLowerCase()}</div></div>
      <Card><Slider label="Energy" value={energy} onChange={setEnergy} min={1} max={5} color="#3ddc97" /></Card>
      <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Anything you want to note? (optional)"
        className="w-full bg-panel border border-edge rounded-2xl p-4 text-paper placeholder-faint/60 outline-none focus:border-brand min-h-[80px]" />
      <Btn tone="grow" className="w-full" onClick={()=>{ logMood(mood, energy, note); setView('pick'); }}>Log it</Btn>
    </div>
  );

  // pick
  return (
    <div className="rise space-y-5">
      <h1 className="text-2xl font-semibold">How are you, really?</h1>
      <div className="grid grid-cols-5 gap-2">
        {MOODS.map(m=>(
          <button key={m.key} onClick={()=>pickMood(m)} className="rounded-2xl py-4 bg-panel border border-edge hover:border-brand/50 active:scale-95 transition flex flex-col items-center gap-1">
            <span className="text-3xl">{m.emoji}</span>
            <span className="text-[11px] text-faint">{m.label}</span>
          </button>
        ))}
      </div>
      <Card onClick={()=>setView('ground')} className="cursor-pointer hover:border-brand/40 flex items-center gap-3">
        <div className="text-3xl">🌳</div>
        <div className="flex-1"><div className="font-semibold">Feeling scattered or panicky?</div><div className="text-faint text-sm">5-4-3-2-1 grounding</div></div>
        <div className="text-faint text-xl">›</div>
      </Card>
      <Card onClick={()=>setView('breathe')} className="cursor-pointer hover:border-calm/40 flex items-center gap-3">
        <div className="text-3xl">🌬️</div>
        <div className="flex-1"><div className="font-semibold">Breathing exercise</div><div className="text-faint text-sm">Box breathing or 4-7-8 calm</div></div>
        <div className="text-faint text-xl">›</div>
      </Card>
      {recent.length>0 && (
        <div>
          <div className="text-faint text-sm mb-2">Recent check-ins</div>
          <div className="flex gap-2 text-2xl">{recent.map((r,i)=>{ const mm=MOODS.find(x=>x.key===r.mood); return <span key={i} title={new Date(r.ts).toLocaleString()}>{mm?mm.emoji:'·'}</span>; })}</div>
        </div>
      )}
      {state.anchor.moodLog.length >= 2 && (() => {
        const moodVal = { great:5, good:4, ok:3, low:2, anxious:1 };
        const last14 = state.anchor.moodLog.slice(0,14).reverse();
        const pts = last14.map((m,i) => {
          const v = moodVal[m.mood] || 3;
          const x = last14.length === 1 ? 75 : 10 + (i / (last14.length-1)) * 130;
          const y = 52 - (v - 1) * 10;
          return `${x},${y}`;
        });
        const colors = { great:'#3ddc97', good:'#6aa0ff', ok:'#8a8a9a', low:'#b08cff', anxious:'#ffce6a' };
        return (
          <Card>
            <div className="text-faint text-sm mb-2">Mood trend</div>
            <svg viewBox="0 0 150 56" className="w-full h-14">
              <polyline points={pts.join(' ')} fill="none" stroke="#6aa0ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
              {last14.map((m,i) => {
                const v = moodVal[m.mood] || 3;
                const x = last14.length === 1 ? 75 : 10 + (i / (last14.length-1)) * 130;
                const y = 52 - (v - 1) * 10;
                return <circle key={i} cx={x} cy={y} r="3.5" fill={colors[m.mood]||'#6aa0ff'} />;
              })}
            </svg>
            <div className="flex justify-between text-faint text-[10px] -mt-1">
              <span>{new Date(last14[0].ts).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span>
              <span>{new Date(last14[last14.length-1].ts).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span>
            </div>
          </Card>
        );
      })()}
      {state.anchor.thoughtRecords.length>0 && <div className="text-faint text-sm">{state.anchor.thoughtRecords.length} thought record{state.anchor.thoughtRecords.length===1?'':'s'} saved 🧠</div>}
    </div>
  );
}

/* ============================ Settings overlay ============================ */
function Toggle({ on, onClick }) {
  return (
    <button onClick={onClick} className={'w-12 h-7 rounded-full transition relative '+(on?'bg-grow':'bg-edge')}>
      <span className={'absolute top-1 w-5 h-5 rounded-full bg-ink transition-all '+(on?'left-6':'left-1')}></span>
    </button>
  );
}
function Section({ title, children }) {
  return <Card className="space-y-3"><div className="text-faint text-xs uppercase tracking-wide">{title}</div>{children}</Card>;
}

function AffirmationAdder({ dispatch }) {
  const [text, setText] = useState('');
  const add = function() {
    if (!text.trim()) return;
    dispatch({ type:'ADD_AFFIRMATION', text: text.trim() });
    setText('');
  };
  return (
    <div className="flex gap-2 mt-1">
      <input value={text} onChange={function(e){setText(e.target.value);}} placeholder="Your affirmation..."
        onKeyDown={function(e){ if(e.key==='Enter') add(); }}
        className="flex-1 bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-sm outline-none focus:border-calm" />
      <Btn tone="grow" onClick={add} disabled={!text.trim()}>Add</Btn>
    </div>
  );
}

function CustomizeHomeSection({ state, dispatch }) {
  const [openSec, setOpenSec] = useState(null);
  const ui = state.ui || { homeMode:'simple', cardPrefs:{} };
  const prefs = ui.cardPrefs || {};
  const simpleCount = HOME_SECTIONS.reduce(function(n,s){ return n + s.cards.filter(function(c){ return cardVisible(c,{homeMode:'simple',cardPrefs:prefs}); }).length; }, 0);
  return (
    <Section title="Home layout">
      <div className="flex items-center justify-between">
        <div className="pr-3">
          <div className="text-paper text-sm">Simple home</div>
          <div className="text-faint text-xs">Show only your daily essentials. Turn off to see all {HOME_CARD_COUNT} cards.</div>
        </div>
        <Toggle on={ui.homeMode!=='advanced'} onClick={function(){ dispatch({type:'UI_MODE', mode: ui.homeMode==='advanced'?'simple':'advanced'}); }} />
      </div>
      <div className="text-faint text-xs pt-1">{simpleCount} card{simpleCount!==1?'s':''} on your simple home. Tap a group to choose what shows:</div>
      {HOME_SECTIONS.map(function(sec){
        var open = openSec === sec.title;
        var onCount = sec.cards.filter(function(c){ return cardVisible(c,{homeMode:'simple',cardPrefs:prefs}); }).length;
        return (
          <div key={sec.title} className="border-t border-edge/20 pt-2">
            <button onClick={function(){ setOpenSec(open?null:sec.title); }} className="w-full flex items-center justify-between">
              <span className="text-paper text-sm">{sec.icon} {sec.title}</span>
              <span className="text-faint text-xs tabnum">{onCount}/{sec.cards.length} {open?'▲':'▾'}</span>
            </button>
            {open && (
              <div className="pt-1 pl-1">
                {sec.cards.map(function(c){
                  var on = cardVisible(c,{homeMode:'simple',cardPrefs:prefs});
                  return (
                    <div key={c.id} className="flex items-center justify-between py-1">
                      <span className="text-paper text-sm">{c.label}</span>
                      <Toggle on={on} onClick={function(){ dispatch({type:'UI_CARD', id:c.id, value: on?'hide':'show'}); }} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <button onClick={function(){ dispatch({type:'UI_RESET_CARDS'}); }} className="text-faint text-sm hover:text-paper pt-2">Reset to defaults</button>
    </Section>
  );
}

function SettingsOverlay({ onClose, flushBridge }) {
  useEscape(onClose);
  const { state, dispatch } = useStore();
  const [nl, setNl] = useState(''); const [nt, setNt] = useState('');
  const [msg, setMsg] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef(null);
  const sob = state.recovery.sobriety;
  const cfg = state.agentBridge.config;

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state,null,2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='anchor-backup-'+todayKey()+'.json'; a.click();
    URL.revokeObjectURL(url); setMsg('Backup downloaded ✓');
  };
  const onImport = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { dispatch({ type:'IMPORT', state: JSON.parse(r.result) }); setMsg('Restored from backup ✓'); } catch(err){ setMsg('Import failed: '+err.message); } };
    r.readAsText(f);
  };
  const addContact = () => {
    if (!nl.trim() || !nt.trim()) return;
    dispatch({ type:'SET_PERSONAL', personal:[ ...(state.recovery.personal||[]), { label:nl.trim(), tel:nt.trim() } ] });
    setNl(''); setNt('');
  };
  const removeContact = (i) => dispatch({ type:'SET_PERSONAL', personal: state.recovery.personal.filter((_,k)=>k!==i) });
  const syncNow = async () => { setMsg('Syncing…'); const r = await flushBridge(); setMsg(r.ok ? ('Synced '+(r.sent||0)+' events ✓') : ('Sync: '+(r.reason||r.error||('HTTP '+r.status)))); };

  return (
    <div className="fixed inset-0 z-50 bg-ink/97 backdrop-blur overflow-y-auto">
      <div className="max-w-md mx-auto p-5 pb-12 space-y-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <button onClick={onClose} className="text-faint hover:text-paper p-2" aria-label="Close">✕</button>
        </div>
        {msg && <div className="text-grow text-sm">{msg}</div>}

        <Section title="You">
          <label className="block">
            <span className="text-faint text-sm">Name</span>
            <input value={state.user.displayName} onChange={e=>dispatch({type:'SET_USER',user:{displayName:e.target.value}})}
              className="w-full mt-1 bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper outline-none focus:border-brand" />
          </label>
          <Slider label="Text size" value={Math.round(state.user.preferences.fontScale*100)} min={85} max={140}
            onChange={v=>dispatch({type:'PREFS',prefs:{fontScale:v/100}})} color="#6aa0ff" />
          <Slider label="Water goal (glasses)" value={state.user.preferences.waterGoal||8} min={4} max={16}
            onChange={v=>dispatch({type:'PREFS',prefs:{waterGoal:v}})} color="#6aa0ff" />
          <div className="flex items-center justify-between">
            <span className="text-paper text-sm">Target bedtime</span>
            <input type="time" value={state.user.preferences.bedtime||'22:00'}
              onChange={function(e){ dispatch({type:'PREFS',prefs:{bedtime:e.target.value}}); }}
              className="bg-panel2 border border-edge rounded-xl px-3 py-1.5 text-paper text-sm outline-none focus:border-brand tabnum" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-paper">Reduce motion</span>
            <Toggle on={state.user.preferences.reduceMotion} onClick={()=>dispatch({type:'PREFS',prefs:{reduceMotion:!state.user.preferences.reduceMotion}})} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-paper">Sound effects</span>
            <Toggle on={state.user.preferences.soundEnabled} onClick={()=>dispatch({type:'PREFS',prefs:{soundEnabled:!state.user.preferences.soundEnabled}})} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-paper">Haptic feedback</span>
            <Toggle on={state.user.preferences.hapticEnabled} onClick={()=>dispatch({type:'PREFS',prefs:{hapticEnabled:!state.user.preferences.hapticEnabled}})} />
          </div>
        </Section>

        <CustomizeHomeSection state={state} dispatch={dispatch} />

        <Section title="Affirmations">
          <div className="text-faint text-xs mb-1">Add your own affirmations that rotate with defaults</div>
          {(state.user.customAffirmations||[]).map(function(a,i){
            return (
              <div key={i} className="flex items-center justify-between bg-panel2 rounded-xl px-3 py-2 mb-1">
                <span className="text-sm text-paper italic">{a}</span>
                <button onClick={function(){dispatch({type:'REMOVE_AFFIRMATION',index:i});}} className="text-faint hover:text-rose text-sm ml-2">✕</button>
              </div>
            );
          })}
          <AffirmationAdder dispatch={dispatch} />
        </Section>

        <Section title="Recovery">
          <label className="block">
            <span className="text-faint text-sm">Recovery start date</span>
            <input type="date" value={sob.startDate.slice(0,10)} max={todayKey()}
              onChange={e=>{ if(e.target.value) dispatch({type:'SET_SOBRIETY_START', date:new Date(e.target.value+'T00:00:00').toISOString()}); }}
              className="w-full mt-1 bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper outline-none focus:border-grow" />
          </label>
          <div className="text-faint text-xs">Total recovery kept across slips: <b className="text-grow">{sob.totalDaysClean}</b> · longest stretch <b className="text-grow">{sob.longestStreakDays}</b> days</div>
          <div className="pt-1">
            <div className="text-faint text-sm mb-1">Your people (added to the SOS screen)</div>
            {(state.recovery.personal||[]).map((p,i)=>(
              <div key={i} className="flex items-center justify-between bg-panel2 rounded-xl px-3 py-2 mb-1">
                <span className="text-sm">{p.label} · {p.tel}</span>
                <button onClick={()=>removeContact(i)} className="text-faint hover:text-rose text-sm">remove</button>
              </div>
            ))}
            <div className="flex gap-2 mt-1">
              <input value={nl} onChange={e=>setNl(e.target.value)} placeholder="Sponsor / friend"
                className="flex-1 bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-sm outline-none focus:border-grow" />
              <input value={nt} onChange={e=>setNt(e.target.value)} placeholder="Number"
                className="w-28 bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-sm outline-none focus:border-grow" />
              <button onClick={addContact} className="px-3 rounded-xl bg-grow text-ink font-semibold">+</button>
            </div>
          </div>
          <div className="text-faint text-[11px] leading-relaxed pt-1">Crisis numbers are SA lines: SADAG 0800 567 567 (24h), DSD substance helpline 0800 12 13 14 (SMS 32312), Cipla mental health 0800 456 789 (SMS 31393, 24h), SADAG office 011 234 4837 (8am–8pm). If a number ever fails, dial emergency 112. SOS is always free.</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs">
            <a href="#/terms" className="text-brand underline">Terms</a>
            <a href="#/privacy" className="text-brand underline">Privacy</a>
            <button type="button" onClick={function(){ location.hash = '#/support'; }} className="text-brand underline">Support The Anchor</button>
          </div>
        </Section>

        <Section title="Agent OS connection">
          <div className="flex items-center justify-between">
            <span className="text-paper">Send events to Agent OS</span>
            <Toggle on={cfg.enabled} onClick={()=>dispatch({type:'BRIDGE_CONFIG',config:{enabled:!cfg.enabled}})} />
          </div>
          <input value={cfg.apiBaseUrl} onChange={e=>dispatch({type:'BRIDGE_CONFIG',config:{apiBaseUrl:e.target.value}})}
            placeholder="https://your-agent-os/api/anchor  (e.g. http://127.0.0.1:7777/api/anchor)"
            className="w-full bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-sm outline-none focus:border-brand" />
          <input value={cfg.apiKey} onChange={e=>dispatch({type:'BRIDGE_CONFIG',config:{apiKey:e.target.value}})}
            placeholder="API key (optional → sent as Bearer)" type="password"
            className="w-full bg-panel2 border border-edge rounded-xl px-3 py-2 text-paper text-sm outline-none focus:border-brand" />
          <div className="flex items-center justify-between text-faint text-xs">
            <span>{state.agentBridge.pendingEvents.length} queued · last sync {state.agentBridge.lastSyncAt?new Date(state.agentBridge.lastSyncAt).toLocaleTimeString():'never'}</span>
            <button onClick={syncNow} className="px-3 py-1 rounded-lg bg-panel2 text-paper hover:bg-edge">Sync now</button>
          </div>
          <div className="text-faint text-[11px]">POSTs <code className="text-brand">{'{ source, sentAt, events[] }'}</code>. Read live state in JS via <code className="text-brand">window.WellnessOS.getState()</code>; push a nudge with <code className="text-brand">window.WellnessOS.pushInbox(["text"])</code>.</div>
        </Section>

        <Section title="Your data">
          <div className="text-faint text-xs">Everything lives only in this browser. Back it up so a browser clean-up can't erase your history.</div>
          <div className="flex gap-2">
            <Btn tone="ghost" className="flex-1" onClick={exportData}>Export backup</Btn>
            <Btn tone="ghost" className="flex-1" onClick={()=>fileRef.current.click()}>Import</Btn>
            <input ref={fileRef} type="file" accept="application/json" onChange={onImport} className="hidden" />
          </div>
          {!confirmReset
            ? <button onClick={()=>setConfirmReset(true)} className="text-faint text-sm hover:text-rose">Reset all data…</button>
            : <div className="flex items-center gap-2"><span className="text-rose text-sm">Erase everything?</span>
                <button onClick={()=>{ dispatch({type:'RESET'}); setConfirmReset(false); setMsg('Reset.'); }} className="px-3 py-1 rounded-lg bg-rose text-ink text-sm font-semibold">Yes, reset</button>
                <button onClick={()=>setConfirmReset(false)} className="px-3 py-1 rounded-lg bg-panel2 text-paper text-sm">Cancel</button></div>}
        </Section>

        <div className="text-center text-faint text-xs pt-2">Anchor · offline-first · your calm operating system</div>
      </div>
    </div>
  );
}

/* ============================ App ============================ */
function App({ bootSOS = false }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [tab, setTab] = useState('home');
  const [sos, setSos] = useState(!!bootSOS);
  const [settings, setSettings] = useState(false);
  const [search, setSearch] = useState(false);

  // persist (debounced — sliders and rapid taps don't hammer localStorage)
  useEffect(() => {
    const id = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch(e){ console.warn('save failed (storage full or blocked) — export a backup', e); } }, 300);
    return () => clearTimeout(id);
  }, [state]);
  // lock body scroll when overlays open
  useEffect(() => {
    document.body.classList.toggle('overlay-open', sos || settings || search);
    return () => document.body.classList.remove('overlay-open');
  }, [sos, settings]);
  // font scale + reduce motion
  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', state.user.preferences.fontScale);
    document.body.classList.toggle('no-motion', !!state.user.preferences.reduceMotion);
  }, [state.user.preferences.fontScale, state.user.preferences.reduceMotion]);
  // sync audio/haptic prefs
  useEffect(() => {
    setAudioPrefs({ soundEnabled: state.user.preferences.soundEnabled, hapticEnabled: state.user.preferences.hapticEnabled });
  }, [state.user.preferences.soundEnabled, state.user.preferences.hapticEnabled]);

  // ---- Agent OS bridge: flush queued events to the configured endpoint ----
  const flushBridge = useCallback(async () => {
    const { config, pendingEvents } = state.agentBridge;
    if (!config.apiBaseUrl) return { ok:false, reason:'no endpoint configured' };
    if (pendingEvents.length === 0) return { ok:true, sent:0 };
    try {
      const res = await fetch(config.apiBaseUrl, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', ...(config.apiKey ? { 'Authorization':'Bearer '+config.apiKey } : {}) },
        body: JSON.stringify({ source:'anchor-os', sentAt: todayISO(), events: pendingEvents }),
      });
      if (res.ok) { dispatch({ type:'BRIDGE_FLUSH' }); return { ok:true, sent: pendingEvents.length }; }
      return { ok:false, status: res.status };
    } catch (e) { return { ok:false, error: String(e) }; }
  }, [state.agentBridge]);

  // auto-flush shortly after new events when the bridge is enabled
  useEffect(() => {
    const { config, pendingEvents } = state.agentBridge;
    if (!config.enabled || !config.apiBaseUrl || pendingEvents.length===0) return;
    const id = setTimeout(() => { flushBridge(); }, 1500);
    return () => clearTimeout(id);
  }, [state.agentBridge.pendingEvents, state.agentBridge.config.enabled, state.agentBridge.config.apiBaseUrl, flushBridge]);

  // expose a stable bridge API for an external Agent OS to read + drive the app
  useEffect(() => {
    window.WellnessOS = {
      version: 'anchor.v1',
      getState: () => state,
      emit: (type, payload) => dispatch({ type:'EMIT', event:type, payload }),
      dispatch,
      flush: flushBridge,
      pushInbox: (items) => dispatch({ type:'BRIDGE_INBOX', inbox: items }),
      eventTypes: ['flow.routine_completed','flow.routine_exited','copilot.session_started','copilot.session_done','anchor.mood_logged','anchor.thought_record','recovery.urge_surf_started','recovery.urge_surf_done','recovery.relapse_logged'],
    };
  }, [state, flushBridge]);

  const store = useMemo(() => ({ state, dispatch }), [state]);

  return (
    <Ctx.Provider value={store}>
      <div className="max-w-md mx-auto px-4 pb-28 pt-2 min-h-screen">
        <Header onSettings={()=>setSettings(true)} onSearch={()=>setSearch(true)} />
        <main>
          <ErrorBoundary resetKey={tab}>
            {tab==='home'    && <HomeScreen setTab={setTab} openSOS={()=>setSos(true)} onSettings={()=>setSettings(true)} />}
            {tab==='flow'    && <FlowScreen />}
            {tab==='copilot' && <CoPilotScreen />}
            {tab==='anchor'  && <AnchorScreen />}
          </ErrorBoundary>
        </main>
      </div>
      <SOSButton onClick={()=>setSos(true)} />
      <BottomNav tab={tab} setTab={setTab} />
      {sos && <ErrorBoundary fallback={<CrisisFallback onClose={()=>setSos(false)} />}><RecoveryOverlay onClose={()=>setSos(false)} /></ErrorBoundary>}
      {search && <ErrorBoundary resetKey={search}><SearchOverlay onClose={()=>setSearch(false)} /></ErrorBoundary>}
      {settings && <ErrorBoundary resetKey={settings}><SettingsOverlay onClose={()=>setSettings(false)} flushBridge={flushBridge} /></ErrorBoundary>}
    </Ctx.Provider>
  );
}

export { ErrorBoundary, CrisisFallback };
export default App;