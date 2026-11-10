import '@fontsource-variable/geist';
import './style.css';
import { DESTINATIONS, CONTRACTS, PAYLOADS, PARAMS, STEPS } from './data.js';
import {
  budgets, budgetMargins, marginColor, parts, simulate, explain, launchConditions, teamCode, ESTIMATE,
  isComplete, par, parDesign, paramVal, mulberry32, fmtYr, fmtGb,
} from './model.js';
import { fmtU, interfaces, incoming, failRow, requirements, reqFor } from './syseng.js';
import { trade, decisions, gaveUp, fmtC } from './trades.js';
import { PAGES, challengeState, knobsFor } from './pages.js';
import {
  buildCharts, renderChart, resetCharts, attachHover, chartForFailure, CHART_ORDER, CHART_LABEL,
} from './charts.js';
import { couplingMap } from './coupling.js';
import { art } from './art.js';
import { trajMapSVG } from './route.js';
import { ICON, MARK } from './icons.js';
import { craftSVG } from './craft.js';
import { createScene } from './scene.js';

// ---------- flags + state ----------
const query = new URLSearchParams(location.search);
const DEBUG = query.has('debug');
// ?demo: three contracts, three different traps (dust storm + mass, radiation + power, heat + eclipses).
const DEMO_IDS = query.has('demo') ? ['mars-survey', 'europa-spec', 'mercury-survey'] : null;
const URL_SEED = query.has('seed') ? Math.abs(parseInt(query.get('seed'), 10)) || 1 : null;
const STORE = 'mission-design-v8';
const MAX_ROUNDS = 3;
// The three-round teaching arc. Each round has a name and one thing to learn, shown all the way through.
const ROUNDS = [
  { name: 'Blind', learn: 'Fly it blind. See what breaks, then find out why.' },
  { name: 'Silos', learn: "You see one subsystem's budgets at a time. One choice feeds many budgets." },
  { name: 'Team', learn: 'You see every budget. Trade between subsystems to fix it.' },
];
const roundNo = () => Math.min(state.attempt, MAX_ROUNDS);

// The loop: take a contract, read its requirements, then one page per subsystem (each with its
// own mini-challenge, passing the phone between leads), review, launch. Three rounds: a blind
// flight test, then siloed budgets, then the full dashboard, all on the same contract. Then a debrief.
const FLOW = ['contract', 'reqs', ...PAGES.map((p) => p.key), 'review', 'launch', 'debrief'];
const STEP = Object.fromEntries(STEPS.map((s) => [s.key, s]));
const PAGE = Object.fromEntries(PAGES.map((p) => [p.key, p]));
const STEP_NAME = { contract: 'Contract', reqs: 'Requirements', review: 'Review', launch: 'Launch', debrief: 'Debrief', ...Object.fromEntries(PAGES.map((p) => [p.key, p.title])) };
// Which lead owns each part.
const OWNER = { power: 'sp', thermal: 'sp', comms: 'sp', traj: 'ms', engine: 'ms', tank: 'ms', launcher: 'ms' };
const stepName = (k) => STEP_NAME[k];

// The starter design: a flying baseline made of the standard part in every slot, at its usual size.
function blank() {
  // why: the criterion each part was chosen for (the trade-study rationale).
  const d = { contract: null, why: {}, ...Object.fromEntries(Object.entries(PARAMS).map(([k, p]) => [k, p.def])) };
  const start = { comms: 'xdish', traj: 'direct', engine: 'biprop', tank: 'ti', thermal: 'louver', power: 'gaas', launcher: 'medium' };
  for (const s of STEPS) { d[s.key] = start[s.key]; Object.assign(d, s.list.find((x) => x.id === start[s.key]).def || {}); }
  return d;
}
const fresh = () => ({ step: 0, design: blank(), attempt: 1, seed: URL_SEED ?? 1000 + Math.floor(Math.random() * 9000), history: [] });

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (!s || !s.design || typeof s.step !== 'number') return null;
    if (s.design.contract && !CONTRACTS.some((c) => c.id === s.design.contract)) return null; // saved game from a removed mission
    if (URL_SEED != null && s.seed !== URL_SEED) return null;
    return s;
  } catch { return null; }
}
let state = load() || fresh();
let ripple = null; // budgets the last change moved (round 2+)
let dragBefore = null; // margins when a slider drag started
let anim = null; // running launch animation handle
let speed = 1; // launch playback speed (2x toggle, round 2+)
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode */ } };

const $app = document.getElementById('app');
attachHover($app);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const R = Math.round;
const n1 = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const contract = () => CONTRACTS.find((c) => c.id === state.design.contract);
const dest = () => DESTINATIONS.find((x) => x.id === contract().dest);
const key = () => FLOW[state.step];

// Round 1: blind, no going back. Round 2: each lead sees only their own subsystem's budgets (silos,
// so coupling bites). Round 3: everyone sees every budget on the dashboard, and the ripple.
const showBudgets = () => state.attempt > 1; // own-subsystem budgets
const showAll = () => state.attempt > 2; // dashboard, coupling, cross-subsystem views
const canGoBack = () => true; // a blind round-1 mis-tap can be undone before launch

// ---------- budget chips + graphs (round 2: own subsystem, round 3: all) ----------
function charts() { return isComplete(state.design) ? buildCharts(state.design, ESTIMATE) : null; }

// ---------- coupling: what a choice feeds, and what the last change moved ----------
// Margins past ±100% are "plenty" / "hopeless": clamp so only real shifts show up.
const clampM = (m) => (typeof m === 'number' ? Math.max(-1, Math.min(1, m)) : m);
const margins = () => { const ch = charts(); return ch ? Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, clampM(v.margin)])) : null; };
const fmtM = (m) => (m == null ? '–' : m >= 1 ? '100%+' : m <= -1 ? '−100%' : `${m < 0 ? '−' : ''}${Math.abs(R(m * 100))}%`);

// Every budget has an owner. A change that hurts a budget someone else owns is a change notice to them.
const BUDGET_OWNER = { power: 'sp', thermal: 'sp', rad: 'sp', night: 'sp', data: 'sp', time: 'ms', dv: 'ms', mass: 'ms', cost: 'ms' };
const ownerOf = (k) => (k === 'life' ? ((interfaces(state.design).find((r) => r.label === 'Part life') || {}).to || 'sp') : BUDGET_OWNER[k]);

function computeRipple(before, after) {
  if (!before || !after) return null;
  const all = Object.keys(after).filter((k) => typeof before[k] === 'number' && typeof after[k] === 'number' && Math.abs(after[k] - before[k]) >= 0.03)
    .sort((a, b) => Math.abs(after[b] - before[b]) - Math.abs(after[a] - before[a]))
    .map((k) => ({ k, from: before[k], to: after[k] }));
  const top = all.slice(0, 4); top.all = all;
  return top;
}

function rippleHTML() {
  if (!showAll() || !ripple) return '';
  if (!ripple.length) return '<div class="ripple"><b>No big change</b></div>';
  const mine = (PAGE[key()] || { charts: [] }).charts; // this page's own budgets
  const notices = ripple.all.filter((r) => r.to < r.from && r.to < 0.15 && !mine.includes(r.k));
  return `<div class="ripple">${ripple.map((r) => `<span class="rchip ${r.to < 0.15 && r.to < r.from ? 'down' : r.from < 0.15 && r.to >= 0.15 ? 'up' : ''}">${CHART_LABEL[r.k]} <i>${fmtM(r.from)}</i> → <i>${fmtM(r.to)}</i></span>`).join('')}</div>
    ${notices.length ? `<div class="notice"><b>This hurt other budgets</b>${notices.map((r) => `<div>${CHART_LABEL[r.k]} ${fmtM(r.from)} → ${fmtM(r.to)}</div>`).join('')}</div>` : ''}`;
}

// What each choice node in the coupling map says about your design.
const partName = (c) => {
  const d = state.design; const P = parts(d);
  if (c === 'contract') return P.payload ? P.payload.name : '';
  if (c === 'traj') return d.traj === 'assist' ? 'Assist' : d.traj ? 'Direct' : '';
  if (c === 'engine') return P.engine ? P.engine.name.replace(/\s*\(.*\)/, '') : '';
  if (c === 'launcher') return P.launcher ? P.launcher.name : '';
  return P[c].short;
};

// Round 3: every budget at once, who owns it, and the coupling map lit on the weakest one.
function dashHTML() {
  if (!showAll()) return '';
  const h = roundHelp(); if (!h) return '';
  const chips = h.keys.map((k) => `<span class="chip ${marginColor(h.ch[k].margin)}"><i>${BUD_SHORT[k]}</i><b>${fPct(h.ch[k].margin)}</b></span>`).join('');
  const line = `${h.bad ? `<b>Fix:</b> ${CHART_LABEL[h.bad]} ${h.level === 'red' ? 'short' : 'thin'}` : '<b>All budgets OK</b>'}${h.slack.length ? ` · <b>Trim:</b> ${h.slack.map((p) => TAB_SHORT[p.key]).join(', ')}` : ''}`;
  return `<div class="dash"><div class="chips">${chips}</div><p class="hint">${line}</p></div>`;
}

// ---------- choices: a trade table for every part ----------
const f$ = (v) => `$${R(v)}M`;

// Each option shows its value on the criteria that pull against each other (the best option per
// criterion is marked). Tapping a number picks the option and records that as the reason.
// Pixel arrow: rows of 1..4..1 squares, pointing left or right.
const arrow = (dir) => `<svg viewBox="0 0 4 7" width="16" height="28" class="arw" aria-hidden="true">${[1, 2, 3, 4, 3, 2, 1].map((w, y) => `<rect x="${dir < 0 ? 4 - w : 0}" y="${y}" width="${w}" height="1"/>`).join('')}</svg>`;

// One box per part: arrows step through the options, and the box shows the one that is picked.
function optionsHTML(step) {
  const t = trade(step.key, state.design); const cur = state.design[step.key];
  const i = Math.max(0, t.options.findIndex((o) => o.id === cur)); const o = t.options[i];
  const btn = (dir) => `<button class="arrow" ${(dir < 0 && i === 0) || (dir > 0 && i === t.options.length - 1) ? 'disabled' : ''} data-act="cycle" data-slot="${step.key}" data-dir="${dir}" aria-label="${dir < 0 ? 'Previous' : 'Next'} ${step.label}">${arrow(dir)}</button>`;
  return `<div class="opt sel">
    <div class="opt-head">${btn(-1)}<div class="opt-name">${esc(o.name)}<small>${i + 1} / ${t.options.length}</small></div>${btn(1)}</div>
    <p class="opt-blurb">${esc(o.blurb)}</p>
    <div class="crits">${t.criteria.map((c) => `<div class="crit ${t.isBest(o, c) ? 'best' : ''}"><span>${c.label}</span><b>${fmtC(c, o.vals[c.id])}</b></div>`).join('')}</div>
  </div>`;
}

// Picking a part sets its id and starts its sizes at the part's usual size (the sliders then resize
// it). A new part starts with no recorded reason unless one is given; keeping the same part keeps it.
function setChoice(k, id, whyId) {
  const opt = STEP[k].list.find((x) => x.id === id);
  const same = state.design[k] === id;
  state.design[k] = id;
  if (!same && opt && opt.def) Object.assign(state.design, opt.def);
  state.design.why = { ...state.design.why, [k]: whyId || (same ? state.design.why[k] : null) || null };
}

// ---------- screens ----------
// Round 3: a tab per subsystem (and Review) to jump straight to any of them.
function tabsHTML() {
  if (!showAll() || !(PAGE[key()] || key() === 'review')) return '';
  const h = roundHelp();
  const tab = (k) => `<button class="tab ${key() === k ? 'on' : ''} ${h && h.fixPage && h.fixPage.key === k ? 'fix' : h && h.slack.some((p) => p.key === k) ? 'slack' : ''}" data-act="goto" data-key="${k}">${TAB_SHORT[k]}</button>`;
  return `<div class="tabs">${PAGES.map((p) => tab(p.key)).join('')}${tab('review')}</div>`;
}

function header() {
  const n = state.step; const tabs = tabsHTML();
  return `<header class="top">
    <div class="top-row"><div class="brand">${MARK}Mission Design${DEBUG ? ' <span class="dbg">debug</span>' : ''}</div><span class="rsteps" role="img" aria-label="Round ${roundNo()} of ${MAX_ROUNDS}: ${ROUNDS[roundNo() - 1].name}">${ROUNDS.map((r, i) => `<i class="${i + 1 === roundNo() ? 'on' : i + 1 < roundNo() ? 'done' : ''}">${i + 1}${i + 1 === roundNo() ? ` ${r.name}` : ''}</i>`).join('')}</span></div>
    ${tabs || `<div class="countdown"><b>${n >= stepOf('launch') ? 'T+0' : `T−${stepOf('launch') - n}`}</b> · ${stepName(key())}</div>`}
    <i class="prog" style="width:${(100 * n) / (FLOW.length - 1)}%"></i>
  </header>`;
}

const stepOf = (k) => FLOW.indexOf(k);

function nav(canGo, nextLabel = 'Next', mid = '') {
  const back = canGoBack() && state.step > 0;
  return `<nav class="bottom">
    ${back ? '<button class="btn ghost" data-act="back">Back</button>' : ''}${mid}
    <button class="btn primary" data-act="next" ${canGo ? '' : 'disabled'}>${nextLabel}</button>
  </nav>`;
}

function debugBar() {
  if (!DEBUG || !PAGE[key()]) return '';
  return `<div class="debugbar"><button class="btn small" data-act="dbg-random">Random design</button><button class="btn small" data-act="dbg-good">Cheapest full success</button><span>seed ${state.seed}</span></div>`;
}

function screenContract() {
  const sel = state.design.contract;
  const cards = CONTRACTS.filter((C) => !DEMO_IDS || DEMO_IDS.includes(C.id)).map((C) => {
    const D = DESTINATIONS.find((x) => x.id === C.dest); const pay = PAYLOADS.find((x) => x.id === C.payload);
    return `<button class="dest ${sel === C.id ? 'sel' : ''}" data-act="contract" data-id="${C.id}">
      <div class="dest-top"><img class="planet pix" src="${art(`planet_${D.id}`)}" alt=""><div class="dest-name">${esc(C.name)}</div></div>
      <div class="dline">${esc(pay.name)}</div>
      <div class="dline">${C.goalGb} Gbit · ${fmtYr(C.deadline)} · $${C.budget}M</div>
      <div class="hazard">${ICON.alert}<span>${esc(D.hazard.name)}</span></div>
    </button>`;
  }).join('');
  return `${header()}<main><h1>Contract board</h1>
    <p class="lead">Pick a mission. You fly it three times: blind, then seeing one subsystem's budgets at a time, then seeing everyone's.</p>
    <div class="dests">${cards}</div></main>${nav(!!sel)}`;
}

// ---------- requirements and interfaces ----------
const fPct = (m) => (typeof m === 'number' ? `${m < 0 ? '−' : '+'}${Math.min(999, Math.abs(R(m * 100)))}%` : '–');

function screenReqs() {
  const rows = requirements(state.design);
  const R = ROUNDS[roundNo() - 1];
  return `${header()}<main><h1>Requirements</h1>
    <div class="goal"><b>Round ${roundNo()}: ${R.name}.</b> ${R.learn}</div>
    <div class="reqs">${rows.map((r) => `<div class="req"><b class="rid">${r.id}</b><div><div class="rtext">${esc(r.text)}</div></div></div>`).join('')}</div>
  </main>${nav(true)}`;
}

// Where an interface row's need comes from, largest first.
const sourcesHTML = (r) => `<small>${[...r.sources].sort((a, c) => c.v - a.v).map((s) => `${esc(s.text)} ${fmtU(s.v, r.unit)}`).join(' · ')}</small>`;

// What this subsystem must meet.
// Attempt 1 shows what is needed; attempt 2+ adds what your design provides and the margin.
function ifacePanel(k) {
  const who = OWNER[k]; const rows = interfaces(state.design); const live = showAll();
  const mine = incoming(rows, who);
  const row = (r) => `<div class="irow ${live ? r.status : ''}"><div class="kv"><span>${r.label}</span><b>${live && r.have != null ? `${fmtU(r.need, r.unit)} of ${fmtU(r.have, r.unit)} · ${fPct(r.margin)}` : `needs ${fmtU(r.need, r.unit)}`}</b></div>${sourcesHTML(r)}${r.note && live ? `<small>${esc(r.note)}</small>` : ''}</div>`;
  return `<h2>This page must meet</h2>${mine.length ? mine.map(row).join('') : '<small>Nothing yet.</small>'}`;
}

// ---------- one page per subsystem ----------
// Each page is one lead's subsystem with its own mini-challenge. Silos: a lead sees their own
// gauges and charts; cost and lift are shared; the rest waits for Review.

// The page's own gauges: the interface rows that land on this lead and belong to this page.
function gaugesHTML(who, labels) {
  const rows = incoming(interfaces(state.design), who).filter((r) => labels.includes(r.label)); if (!rows.length) return '';
  const live = showBudgets();
  return `<div class="gauges">${rows.map((r) => (live && r.margin != null
    ? `<span class="g ${r.status}">${r.label} <b>${fPct(r.margin)}</b></span>`
    : `<span class="g">${r.label} <b>${r.label === 'Cost' ? 'total' : 'needs'} ${fmtU(r.need, r.unit)}</b></span>`)).join('')}</div>`;
}


function hudHTML() {
  if (!showAll()) return ''; // rounds 1-2: no shared view of cost and lift
  const b = budgets(state.design, ESTIMATE); const M = budgetMargins(b);
  const g = (label, text, m) => `<span class="g ${marginColor(m)}">${label} <b>${text}</b> <i>${fPct(m)}</i></span>`;
  return `<div class="hud" id="hud">${g('Cost', `${f$(b.cost)} of ${f$(b.budget)}`, M.cost)}${g('Lift', b.cap == null ? '–' : `${R(b.wet)} of ${R(b.cap)} kg`, M.mass)}</div>`;
}

// The mini-challenge card: what to do, and (from round 2) whether it is met and lean.
// This page's own gauges that are over their limit.
const redRows = (page) => incoming(interfaces(state.design), page.who).filter((r) => page.rows.includes(r.label) && r.status === 'red').map((r) => r.label);

function challengeHTML(page, cs, reds = []) {
  const m = page.minimize; const val = (v) => fmtU(v, m.unit);
  if (!showBudgets()) return `<div class="challenge"><b>Goal: ${page.name}.</b> Use the least ${m.label}.</div>`;
  if (cs.met && reds.length) return `<div class="challenge warn"><b>⚠ ${page.name}</b> met, but ${reds.join(' and ')} is over its limit</div>`;
  if (cs.met && cs.lean) return `<div class="challenge ok"><b>✓ ${page.name}</b> lean (${val(cs.cur.value)} ${m.label})</div>`;
  if (cs.met) return `<div class="challenge warn"><b>✓ ${page.name}</b> over-built: ${esc(cs.best.label)} saves ${val(cs.cur.value - cs.best.value)} ${m.label}</div>`;
  if (!cs.met && !showAll()) {
    // Round 2: the other subsystems are already locked in. If nothing on this page can meet the challenge, say so and move on.
    return cs.anyMet ? `<div class="challenge bad"><b>✗ ${page.name}</b> not met</div>`
      : `<div class="challenge bad"><b>✗ ${page.name}</b> can't be met with the other subsystems as configured. Nothing here fixes it. Move on.</div>`;
  }
  if (cs.anyMet) return `<div class="challenge bad"><b>✗ ${page.name}</b> not met. A part or size here would fix it</div>`;
  return `<div class="challenge bad"><b>✗ ${page.name}</b> not met. Another subsystem's choice is in the way</div>`;
}

// Every part is a trade study: the numbers pull against each other, and the lead records which
// one they chose it for. The page's Next stays locked until each of its parts has a reason.
// The sizing sliders for the part that is chosen on this page.
const fmtV = (v, p) => `${n1(v)}${p.unit ? ` ${p.unit}` : ''}`;
function slidersHTML(page) {
  const d = state.design; const D = dest();
  const ks = knobsFor(page, d).filter((k) => k.key !== 'battery' || D.dark);
  if (!ks.length) return '';
  return `<div class="sliders"><h3 class="slh">Size it</h3>${ks.map((k) => {
    const v = Math.min(k.max, Math.max(k.min, paramVal(d, k.key)));
    return `<div class="slider"><div class="s-head"><label for="sl-${k.key}">${k.label}</label><output id="out-${k.key}" class="s-val">${fmtV(v, k)}</output></div>
      <input id="sl-${k.key}" type="range" min="${k.min}" max="${k.max}" step="${k.step}" value="${v}" data-key="${k.key}">
      <div class="s-scale"><span>${fmtV(k.min, k)}</span><span>${fmtV(k.max, k)}</span></div></div>`;
  }).join('')}</div>`;
}

// The parts of a page that move when something changes: the cost/lift bar, the challenge card,
// the gauges, the charts and the craft. Sliders never re-render themselves, only these do.
function chartsHTML(page) {
  const ch = showBudgets() ? buildCharts(state.design, ESTIMATE) : null;
  // Round 3: this page's budgets, and all the others one tap away.
  const grid = (ks) => `<div class="chart-grid">${ks.filter((k) => ch[k]).map((k) => renderChart(ch[k])).join('')}</div>`;
  const rest = CHART_ORDER.filter((k) => !page.charts.includes(k));
  return ch ? `<section class="graphs">${grid(page.charts)}${showAll() ? `<details class="picks"><summary>More budgets</summary>${grid(rest)}</details>` : ''}</section>` : '';
}
function refreshPage(page) {
  resetCharts();
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const hud = document.getElementById('hud'); if (hud) hud.outerHTML = hudHTML();
  set('challenge', challengeHTML(page, challengeState(page, state.design), redRows(page)));
  set('gauges', gaugesHTML(page.who, page.rows));
  set('trajmap', trajMapSVG(dest(), state.design.traj));
  set('craft', craftSVG(state.design, { screen: page.craft }));
  set('rip', rippleHTML());
  set('dash', dashHTML());
}

function screenPage(page) {
  const d = state.design; const D = dest();
  const idx = PAGES.indexOf(page); const traj = page.key === 'traj';
  const mid = showBudgets() ? `<button class="btn ghost" data-act="sheet" data-kind="page" data-page="${page.key}">Graphs</button>` : '';
  return `${header()}<main class="fit ${page.steps.length > 1 ? 'two' : ''}">${debugBar()}
    <h1>${page.title}: ${page.name}</h1>
    <div id="challenge">${challengeHTML(page, challengeState(page, d), redRows(page))}</div>
    <div class="visual" id="${traj ? 'trajmap' : 'craft'}">${traj ? trajMapSVG(D, d.traj) : craftSVG(d, { screen: page.craft })}</div>
    ${showAll() ? `<div id="dash">${dashHTML()}</div>` : `<div id="gauges">${gaugesHTML(page.who, page.rows)}</div>`}
    <div id="rip">${rippleHTML()}</div>
    ${page.steps.map((k) => `<div class="card">${optionsHTML(STEP[k])}</div>`).join('')}
    ${slidersHTML(page)}
  </main>${nav(true, idx === PAGES.length - 1 ? 'Review' : 'Next', mid)}`;
}

// The decision record: what each lead chose, why, whether it was the best on that reason, and
// what it gave up.
function decisionHTML() {
  return decisions(state.design).map((x) => {
    return `<div class="vrow ${x.whyBest === false ? 'yellow' : 'green'}"><div><div>${x.label}: ${esc(x.option.name)}</div>
    </div></div>`;
  }).join('');
}

function screenReview() {
  const d = state.design;
  if (!isComplete(d)) return `${header()}<main><h1>Design review</h1><p>Some parts are missing.</p></main>${nav(false)}`;
  const b = budgets(d, ESTIMATE);
  if (!showAll()) {
    const parts2 = decisions(d).map((x) => `<span class="pc"><i>${x.label}</i> ${esc(x.option.name)}</span>`).join('');
    return `${header()}<main class="fit"><h1>Final design</h1><div class="visual">${craftSVG(d)}</div><div class="partgrid">${parts2}</div></main>${nav(true, 'Launch')}`;
  }
  const reqs = requirements(d); const over = b.cost > b.budget;
  const chal = PAGES.map((p) => { const cs = challengeState(p, d); return `<span class="chip ${cs.met ? (cs.lean ? 'green' : 'yellow') : 'red'}"><i>${TAB_SHORT[p.key]}</i><b>${cs.met ? (cs.lean ? 'lean' : 'heavy') : 'unmet'}</b></span>`; }).join('');
  return `${header()}<main class="fit"><h1>Design review</h1>
    <div class="visual">${craftSVG(d)}</div>
    <div class="verify">${reqs.map((r) => `<div class="vrow ${r.status}"><b class="rid">${r.id}</b><div>${esc(r.name)}</div><span class="r-m">${fPct(r.margin)}</span></div>`).join('')}</div>
    <div class="chips six">${chal}</div>
    ${over ? `<div class="warn">Launch blocked: over budget by $${R(b.cost - b.budget)}M.</div>` : ''}
  </main>${nav(!over, 'Launch', '<button class="btn ghost" data-act="sheet" data-kind="review">Details</button>')}`;
}

function historyHTML() {
  return `<div class="history"><b>Rounds</b>${state.history.map((h) => `<div class="h-row"><span>${h.attempt} · ${ROUNDS[h.attempt - 1].name}</span><span class="stars" aria-label="${h.stars} of 3 stars">${starsOf(h.stars)}</span><span>${h.score} pts</span><span class="code">${h.code}</span></div>`).join('')}</div>`;
}
const starsOf = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
const tierName = (o) => ({ none: 'No mission', min: 'Minimum', full: 'Full success' }[o]);

// ---------- launch screen ----------
function screenLaunch() {
  return `${header()}<main class="launch fit">
    <div id="banner"></div>
    <div class="lrow"><div class="phase-name" id="phase">Countdown</div><div class="clock" id="clock">T-0</div>${state.attempt > 1 ? '<button class="btn small ff" data-act="ff" aria-pressed="false">2x</button>' : ''}</div>
    <div class="scene-wrap visual" id="scene"></div>
    <div class="track" id="track"></div>
    <div class="phases" id="phases"></div>
    <ul class="log" id="log"></ul>
    <div id="result"></div>
  </main>`;
}

function startLaunch() {
  const d = state.design;
  // Attempt 1 flies even over budget, so every team sees a real failure mode.
  const cond = { ...launchConditions(state.seed, state.attempt), bailout: state.attempt === 1 };
  const res = simulate(d, cond);
  if (res.b.cost > res.b.budget && cond.bailout) {
    document.getElementById('banner').innerHTML = `<div class="warn">Over budget by $${R(res.b.cost - res.b.budget)}M — emergency bailout granted for the round 1 flight test!</div>`;
  }
  const b = res.b; const cruise = b.tr.cruise; const end = cruise + b.D.opsYears;
  const f = res.failure;
  const stopT = f && !f.partial ? f.t : end;

  // Map mission time (years) to animation time (ms).
  // Skip timers in debug mode, or if this attempt already flew (page was reloaded).
  const instant = DEBUG || state.history.some((h) => h.attempt === state.attempt);
  const P = instant ? { lift: 0, cruise: 0, arr: 0, ops: 0 } : { lift: 4000, cruise: 13000, arr: 4000, ops: 8000 };
  const tOf = (t, phase) => {
    if (phase === 'launch') return P.lift * 0.85;
    if (phase === 'review') return 0;
    if (phase === 'arrival') return P.lift + P.cruise + P.arr * 0.7;
    if (phase === 'cruise' || (t < cruise && phase !== 'ops')) return P.lift + P.cruise * (cruise > 0 ? t / cruise : 1);
    return P.lift + P.cruise + P.arr + P.ops * ((t - cruise) / Math.max(0.001, end - cruise));
  };
  const totalMs = P.lift + P.cruise + P.arr + P.ops;

  const beats = [];
  if (!(f && f.phase === 'review')) beats.push({ ms: P.lift * 0.85, cls: f && f.mode === 'launcher' ? 'fail' : 'ok', text: f && f.mode === 'launcher' ? f.text : `Liftoff on ${b.P.launcher.name}. ${R(b.wet)} kg away.`, fail: f && f.mode === 'launcher' });
  for (const e of res.events) {
    const phase = e.kind === 'arrival' ? 'arrival' : e.t < cruise ? 'cruise' : 'ops';
    if (e.kind === 'arrival') continue;
    beats.push({ ms: tOf(e.t, phase), cls: e.kind === 'random' ? 'info' : 'warn', text: `${e.kind === 'random' ? 'Event' : e.kind === 'flyby' ? 'Flyby' : 'Hazard'}: ${e.text}`, t: e.t });
  }
  if (!f || f.partial || (f.t >= cruise && f.phase === 'ops')) beats.push({ ms: tOf(cruise, 'arrival'), cls: 'ok', text: `Arrival burn: needed ${R(b.dvReq)} m/s, had ${R(b.dvAvail)} m/s. In position at ${b.D.name}.` });
  if (f && f.mode !== 'launcher') beats.push({ ms: f.partial ? totalMs : tOf(f.t, f.phase), cls: f.partial ? 'warn' : 'fail', text: f.text, fail: !f.partial });
  if (!f) beats.push({ ms: totalMs, cls: 'ok', text: `Mission complete: ${fmtGb(res.scienceGb)} returned.` });
  beats.sort((a, b2) => a.ms - b2.ms);
  const stopMs = f && !f.partial ? Math.min(...beats.filter((x) => x.fail).map((x) => x.ms)) : totalMs;

  // Static track with year ticks and markers.
  const track = document.getElementById('track');
  const years = Math.ceil(end);
  const pos = (t) => `${(100 * t) / end}%`;
  const marks = res.events.filter((e) => e.kind !== 'arrival').map((e) => `<span class="mk ${e.kind}" style="left:${pos(e.t)}" title="${esc(e.text)}"></span>`).join('');
  const ticks = Array.from({ length: years + 1 }, (_, i) => (i <= end ? `<span class="tick" style="left:${pos(i)}">${end > 12 && i % 2 ? '' : i}</span>` : '')).join('');
  track.innerHTML = `<div class="bar"><div class="cruise-zone" style="width:${pos(cruise)}"></div><div class="fill" id="fill"></div>${marks}<span class="mk arrival" style="left:${pos(cruise)}"></span>${f && !f.partial ? `<span class="mk failmk" id="failmk" style="left:${pos(Math.min(end, f.t))}; display:none"></span>` : ''}</div><div class="ticks">${ticks}</div><div class="track-legend"><span>Cruise</span><span>Operations</span><span>years</span></div>`;
  document.getElementById('phases').innerHTML = ['Liftoff', 'Cruise', 'Arrival', 'Operations'].map((p, i) => `<span id="ph${i}">${p}</span>`).join('');

  const log = document.getElementById('log');
  const scene = createScene(document.getElementById('scene'), { design: d, b, failure: f });
  const phaseStart = [0, P.lift, P.lift + P.cruise, P.lift + P.cruise + P.arr]; const phaseLen = [P.lift, P.cruise, P.arr, P.ops];
  const finalPose = () => (!f || f.partial ? { ph: 3, p: 1 }
    : f.phase === 'review' ? { ph: 0, p: 0 } : f.phase === 'launch' ? { ph: 0, p: 0.85 }
      : f.phase === 'cruise' ? { ph: 1, p: f.t / cruise } : f.phase === 'arrival' ? { ph: 2, p: 0.7 } : { ph: 3, p: (f.t - cruise) / (end - cruise) });
  // Virtual clock so the 2x toggle can change speed mid-flight.
  let next = 0; let clock = 0; let last = performance.now(); speed = 1;
  const phaseAt = (ms) => (ms < P.lift ? 0 : ms < P.lift + P.cruise ? 1 : ms < P.lift + P.cruise + P.arr ? 2 : 3);
  const missionT = (ms) => {
    if (ms < P.lift) return 0;
    if (ms < P.lift + P.cruise) return cruise * ((ms - P.lift) / P.cruise);
    if (ms < P.lift + P.cruise + P.arr) return cruise;
    return cruise + (end - cruise) * Math.min(1, (ms - P.lift - P.cruise - P.arr) / P.ops);
  };

  function frame(now) {
    clock += (now - last) * speed; last = now;
    const ms = Math.min(clock, stopMs);
    const ph = phaseAt(ms);
    const tm = instant ? stopT : Math.min(missionT(ms), stopT);
    document.getElementById('phase').textContent = f && f.phase === 'review' ? 'Program review' : ['Liftoff', 'Cruise', 'Arrival burn', 'Operations'][ph];
    document.getElementById('clock').textContent = ph === 0 ? 'T+0' : `Year ${tm.toFixed(1)}`;
    document.getElementById('fill').style.width = pos(tm);
    for (let i = 0; i < 4; i++) document.getElementById(`ph${i}`).className = i < ph ? 'done' : i === ph ? 'now' : '';
    const pose = instant ? finalPose() : { ph, p: Math.min(1, (ms - phaseStart[ph]) / phaseLen[ph]) };
    scene.update({ ...pose, ms, dead: !!f && !f.partial && (instant || ms >= stopMs) });
    while (next < beats.length && beats[next].ms <= ms) {
      const bt = beats[next++];
      log.insertAdjacentHTML('afterbegin', `<li class="${bt.cls}">${bt.cls === 'ok' ? ICON.check : bt.cls === 'fail' ? ICON.x : bt.cls === 'warn' ? ICON.alert : ICON.info}<span>${esc(bt.text)}</span></li>`);
      if (bt.fail) { const fm = document.getElementById('failmk'); if (fm) fm.style.display = 'block'; document.querySelector('.launch').classList.add('shake'); }
    }
    // Timers (not requestAnimationFrame) so the launch keeps going if the phone is backgrounded.
    if (ms < stopMs) anim = setTimeout(() => frame(performance.now()), 33);
    else if (instant) { anim = null; showResult(res); }
    else anim = setTimeout(() => { anim = null; showResult(res); }, 900 / speed);
  }
  frame(performance.now());
}

function showResult(res) {
  if (key() !== 'launch' || !document.getElementById('result')) return;
  const d = state.design; const D = res.b.D; const C = res.b.C;
  const code = teamCode(d, state.seed, state.attempt);
  const first = state.attempt === 1; const last = state.attempt >= MAX_ROUNDS;
  const f = res.failure;
  // Stars: one for arriving and operating, two for the science goal, three for doing it within 10% of par.
  const parCost = par(d.contract);
  // Over budget fails R4: a round-1 bailout buys the flight, not the stars.
  const over = res.cost > res.b.budget;
  let stars = res.outcome === 'full' ? (res.cost <= parCost * 1.1 ? 3 : 2) : res.outcome === 'min' ? 1 : 0;
  if (over) stars = Math.min(stars, 1);
  const rq = f ? requirements(d).find((r) => r.id === reqFor(f)) : null;
  if (!state.history.find((h) => h.attempt === state.attempt)) {
    state.history.push({ attempt: state.attempt, name: C.name, outcome: res.outcome, stars, score: res.score, code, cost: R(res.cost), req: rq ? `${rq.id} (${rq.text})` : over ? 'R4 (afford it)' : null, why: f ? f.text : over ? `Over budget by ${f$(res.cost - res.b.budget)}.` : null });
    save();
  }
  const chains = explain(d, res);
  const closest = !f ? closestCall(res.b) : null;
  // The graph of the budget that broke, flown with the real launch conditions.
  const ch = buildCharts(d, res.opts, f);
  const fk = chartForFailure(f, res.b);
  const failChart = ch && fk && ch[fk] ? renderChart(ch[fk]) : '';
  const map = f ? `${couplingMap(d, partName, fk)}` : '';
  const later = f ? downstream(res, fk) : [];
  const warnLater = later.length ? `<div class="warn">Even if you survived ${fk ? CHART_LABEL[fk].toLowerCase() : 'that'}, this design also failed ${later.map((k) => CHART_LABEL[k].toLowerCase()).join(' and ')}.</div>` : '';
  const reqLine = !rq ? '' : `<p class="a-req"><b>${rq.id} not met:</b> ${esc(rq.text)}</p>`;
  // The detail sheet: the failure in full (graph, map, causes) and the round history.
  resultDetails = `${f ? `<section class="anomaly"><p class="a-what">${esc(f.text)}</p>${reqLine}${warnLater}${failChart}${map}
      ${chains.slice(0, 1).map((c) => `<ol class="chain">${c.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`).join('')}
      ${chains.length > 1 ? chains.slice(1).map((c) => `<ol class="chain">${c.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`).join('') : ''}</section>`
      : over ? `<section class="anomaly"><p class="a-req"><b>Over budget</b> by ${f$(res.cost - res.b.budget)}</p></section>`
      : `<section class="anomaly good"><p>${closest ? `Closest call: <b>${closest}</b>` : 'All constraints held'}</p></section>`}${historyHTML()}`;
  const line = f ? esc(f.text) : over ? `Over budget by ${f$(res.cost - res.b.budget)}` : closest ? `Closest call: ${closest}` : 'All constraints held';
  document.getElementById('result').innerHTML = `
    <div class="outcome ${res.outcome}">
      <div class="o-row"><div class="o-stars" role="img" aria-label="${stars} of 3 stars">${starsOf(stars)}</div><div class="o-tier">${tierName(res.outcome)}</div></div>
      <div class="o-grid">
        <div><span>Score</span><b>${res.score}</b></div>
        <div><span>Science</span><b>${fmtGb(res.scienceGb)}</b></div>
        <div><span>Cost</span><b>${f$(res.cost)}</b></div>
        <div><span>Par</span><b>${f$(parCost)}</b></div>
      </div>
    </div>
    <p class="a-line">${line}</p>
    ${!f && !over ? '' : `<p class="a-hint">Try next: ${esc(HINT[f ? f.mode : 'cost'] || 'Open Why? and fix the bar in red.')}</p>`}
    <div class="end-actions two">
      <button class="btn ghost" data-act="sheet" data-kind="result">Why?</button>
      ${last ? '<button class="btn primary" data-act="finish">Debrief</button>' : `<button class="btn primary" data-act="redesign">Round ${state.attempt + 1}</button>`}
    </div>`;
  document.querySelector('main.launch')?.classList.add('done');
  document.querySelector('.ff')?.remove();
}

// Chief engineer's note: up to two other budgets that would also have killed this design,
// from later failures in the flight, then anything already broken on paper.
function downstream(res, fk) {
  const keys = (res.others || []).map((o) => chartForFailure(o, res.b));
  const M = budgetMargins(budgets(state.design, ESTIMATE));
  keys.push(...Object.keys(M).filter((k) => M[k] < 0));
  return [...new Set(keys)].filter((k) => k && k !== fk).slice(0, 2);
}

// One plain nudge toward the fix for each way a flight can fail.
const HINT = {
  launcher: 'Try a bigger rocket, or trim mass elsewhere.', deadline: 'Try the faster route, or a faster engine.',
  flyby: 'Add thermal or shielding, or take the other route.', life: 'Pick parts with a longer design life.',
  radiation: 'Add shielding, or spend less time near the radiation.', insertion: 'Add fuel or a more efficient engine.',
  overheat: 'Add radiators, or shrink what makes heat.', brownout: 'Add power, or cut the loads.',
  freeze: 'Add power for the heaters.', night: 'Add battery for the dark.', storm: 'Add array area or battery for the storm.',
  data: 'Bigger antenna, more transmit power, or longer contact.', cost: 'Cut cost: smaller parts, a cheaper rocket.',
};
function closestCall(b) {
  const opts = [['Mass', b.massMargin], ['Power', b.powerMargin], ['Delta-v', b.dvMargin], ['Data', b.dataMargin], ['Thermal', b.thermalMargin], ['Radiation', b.radMargin], ['Cost', b.costMargin], ['Design life', b.lifeMargin], ['Schedule', b.timeMargin]];
  const m = opts.filter((x) => typeof x[1] === 'number').sort((a, c) => a[1] - c[1])[0];
  return m ? `${m[0]} margin ${R(m[1] * 100)}%` : null;
}

// Between rounds: how the last round went, the takeaway, and what changes next.
// Between rounds: how the last round went, the takeaway, and what changes next.
function takeaway(done) {
  if (done === 1) return { take: 'Budget before you select parts.', more: 'Every part you pick loads a budget. Set the budgets first, then choose parts that fit them.', next: "Round 2: you see one subsystem's budgets at a time." };
  return { take: 'Everything is coupled.', more: 'A choice on one page moves budgets on others. A fix on one page can break another.', next: 'Round 3: the whole team sees every budget and works together.' };
}
function screenTransition() {
  const done = state.attempt - 1; const h = state.history.find((x) => x.attempt === done); const T = takeaway(done);
  return `<header class="top plain"><div class="top-row"><div class="brand">${MARK}Mission Design</div><span class="attempt">Between rounds</span></div></header><main class="transition"><h1>Round ${done} done</h1>
    ${h ? `<div class="outcome ${h.outcome}"><div class="o-stars" role="img" aria-label="${h.stars} of 3 stars">${starsOf(h.stars)}</div><div class="o-tier">${tierName(h.outcome)}${h.req ? ` · failed ${esc(h.req)}` : ''}</div></div>` : ''}
    <h2>Takeaway</h2><p class="take big">${T.take}</p><p class="take">${T.more}</p>
    ${h && h.why ? `<h2>What happened</h2><p class="take">${esc(h.why)}</p>` : ''}
    <h2>Next</h2><p class="take">${T.next}</p>
  </main><nav class="bottom"><span></span><button class="btn primary" data-act="begin">Start round ${state.attempt}</button></nav>`;
}

// ---------- debrief ----------
function screenDebrief() {
  const hs = state.history;
  const best = hs.reduce((a, h) => (!a || h.score > a.score || (h.score === a.score && h.stars > a.stars) ? h : a), null);
  const total = hs.reduce((s, h) => s + h.stars, 0);
  return `${header()}<main><h1>Mission debrief</h1>
    <div class="outcome ${best.outcome}">
      <div class="o-stars" role="img" aria-label="${best.stars} of 3 stars">${starsOf(best.stars)}</div>
      <div class="o-tier">Best: round ${best.attempt}</div>
      <div class="o-grid">
        <div><span>Stars earned</span><b>${total} of ${MAX_ROUNDS * 3}</b></div>
        <div><span>Best score</span><b>${best.score}</b></div>
        <div><span>Best cost</span><b>${f$(best.cost)}</b></div>
        <div><span>Team code</span><b class="code">${best.code}</b></div>
      </div>
    </div>
    <h2>Takeaway</h2><p class="take">When everyone sees every budget, the team can fix coupled problems together.</p>
    ${historyHTML()}
    <div class="end-actions"><button class="btn primary" data-act="newgame">New mission</button></div>
  </main>`;
}

const BUD_SHORT = { power: 'Power', thermal: 'Heat', rad: 'Rad', data: 'Data', time: 'Time', cost: 'Cost', mass: 'Mass', dv: 'Fuel', life: 'Life', night: 'Dark' };
const TAB_SHORT = { comms: 'Comms', thermal: 'Thermal', power: 'Power', traj: 'Route', prop: 'Engine', rocket: 'Rocket', review: 'Review' };

function roundHelp() {
  const ch = charts(); if (!ch) return null;
  const keys = CHART_ORDER.filter((k) => ch[k] && typeof ch[k].margin === 'number'); if (!keys.length) return null;
  const worst = keys.reduce((a, k) => (ch[k].margin < ch[a].margin ? k : a), keys[0]);
  const level = marginColor(ch[worst].margin); // 'green' | 'yellow' | 'red'
  const bad = level !== 'green' ? worst : null;
  const fixPage = bad ? (PAGES.find((p) => p.charts.includes(bad)) || PAGES.find((p) => p.who === ownerOf(bad))) : null;
  const slack = PAGES.filter((p) => { const cs = challengeState(p, state.design); return cs.met && !cs.lean; });
  return { ch, keys, worst, level, bad, fixPage, slack };
}

function reviewDetails() {
  const d = state.design; const b = budgets(d, ESTIMATE);
  const ch = buildCharts(d, ESTIMATE); const keys = CHART_ORDER.filter((k) => ch && ch[k]);
  const reqs = requirements(d); const ifs = interfaces(d).filter((r) => r.margin != null);
  const ifRow = (r) => `<div class="vrow ${r.status}"><div><div>${r.label}</div><small>${fmtU(r.need, r.unit)} needed of ${fmtU(r.have, r.unit)} provided</small>${sourcesHTML(r)}</div><span class="r-m">${fPct(r.margin)}</span></div>`;
  return `<h2>System requirements</h2><div class="verify">${reqs.map((r) => `<div class="vrow ${r.status}"><b class="rid">${r.id}</b><div><div>${esc(r.text)}</div><small>${r.by}</small></div><span class="r-m">${fPct(r.margin)}</span></div>`).join('')}</div>
    <h2>Interfaces</h2><div class="verify">${ifs.map(ifRow).join('')}</div>
    <h2>Budgets</h2><div class="chart-grid">${keys.map((k) => renderChart(ch[k])).join('')}</div>
    <h2>Decisions</h2><div class="verify">${decisionHTML()}</div>`;
}

// A full-screen sheet for the detail a phone screen cannot hold at once. It scrolls inside itself.
let resultDetails = '';
function openSheet(kind, pageKey) {
  const d = state.design; let title = 'Details'; let body = '';
  if (kind === 'result') { title = 'What happened'; body = resultDetails; }
  else if (kind === 'review') { title = 'Review details'; body = reviewDetails(); }
  else {
    const page = PAGE[pageKey]; const ch = buildCharts(d, ESTIMATE); const h = showAll() ? roundHelp() : null;
    const keys = showAll() ? CHART_ORDER : page.charts;
    title = showAll() ? 'All budgets' : `${page.title} budgets`;
    body = `<div class="chart-grid">${keys.filter((k) => ch && ch[k]).map((k) => renderChart(ch[k])).join('')}</div>
      ${showAll() ? couplingMap(d, partName, h && h.bad, h ? h.level : 'red') : ''}
      <section class="alloc">${ifacePanel(page.steps[0])}</section>`;
  }
  $app.insertAdjacentHTML('beforeend', `<div class="sheet" id="sheet"><div class="sheet-head"><b>${title}</b><button class="btn small" data-act="close-sheet">Close</button></div><div class="sheet-body">${body}</div></div>`);
}

// ---------- render + events ----------
const SCREENS = { contract: screenContract, reqs: screenReqs, ...Object.fromEntries(PAGES.map((p) => [p.key, () => screenPage(p)])), review: screenReview, launch: screenLaunch, debrief: screenDebrief };

function render() {
  if (anim) { clearTimeout(anim); anim = null; }
  resetCharts();
  if (state.transition) { $app.innerHTML = screenTransition(); return; }
  const k = key();
  $app.innerHTML = SCREENS[k]();
  if (k === 'launch') startLaunch();
}

function go(n) { state.step = n; ripple = null; save(); render(); window.scrollTo(0, 0); }

// Debug helper: record a plausible reason for every part (what the chosen option is best at).
function autoWhy() {
  for (const s of STEPS) {
    const t = trade(s.key, state.design); const o = t.options.find((x) => x.id === state.design[s.key]);
    state.design.why[s.key] = (t.criteria.find((c) => t.isBest(o, c)) || t.criteria[0]).id;
  }
}

function autoPick(mode) {
  if (!state.design.contract) return;
  if (mode === 'good') {
    // The stored par design: the cheapest full success (par.js, checked by the balance test).
    const best = parDesign(state.design.contract); if (best) state.design = { ...best, why: {} };
  } else {
    const rng = mulberry32(Date.now() & 0xffffffff);
    for (const s of STEPS) { const o = s.list[Math.floor(rng() * s.list.length)]; state.design[s.key] = o.id; Object.assign(state.design, o.def || {}); }
    // a random size for whichever sliders the chosen parts use
    for (const p of PAGES) for (const k of knobsFor(p, state.design)) state.design[k.key] = +(k.min + Math.floor(rng() * (Math.round((k.max - k.min) / k.step) + 1)) * k.step).toFixed(2);
  }
  autoWhy();
  save(); render();
}

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  const keepScroll = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };
  if (act === 'contract') {
    state.design.contract = el.dataset.id; save(); render();
  } else if (act === 'cycle') {
    const slot = el.dataset.slot; const ids = trade(slot, state.design).options.map((o) => o.id);
    const j = ids.indexOf(state.design[slot]) + +el.dataset.dir; if (j < 0 || j >= ids.length) return;
    const id = ids[j];
    const before = showAll() ? margins() : null;
    setChoice(slot, id);
    ripple = computeRipple(before, showAll() ? margins() : null);
    if (ripple) ripple.who = OWNER[slot];
    save(); keepScroll();
  } else if (act === 'pick') {
    const before = showAll() ? margins() : null;
    setChoice(el.dataset.slot, el.dataset.id, el.dataset.why);
    ripple = computeRipple(before, showAll() ? margins() : null);
    if (ripple) ripple.who = OWNER[el.dataset.slot];
    save(); keepScroll();
  } else if (act === 'ff') {
    speed = speed === 1 ? 2 : 1;
    el.setAttribute('aria-pressed', String(speed === 2));
  } else if (act === 'next') go(Math.min(FLOW.length - 1, state.step + 1));
  else if (act === 'sheet') openSheet(el.dataset.kind, el.dataset.page);
  else if (act === 'close-sheet') document.getElementById('sheet')?.remove();
  else if (act === 'goto') go(stepOf(el.dataset.key));
  else if (act === 'back') { if (canGoBack()) go(Math.max(0, state.step - 1)); }
  else if (act === 'redesign') { state.attempt += 1; state.design.why = {}; state.transition = true; go(stepOf('reqs')); }
  else if (act === 'begin') { state.transition = false; save(); render(); window.scrollTo(0, 0); }
  else if (act === 'finish') go(stepOf('debrief'));
  else if (act === 'newgame') { state = { ...fresh(), seed: state.seed }; save(); render(); window.scrollTo(0, 0); }
  else if (act === 'reset') {
    if (confirm('Start over as a new team? This clears all rounds.')) { state = fresh(); save(); render(); }
  } else if (act === 'dbg-random') autoPick('random');
  else if (act === 'dbg-good') autoPick('good');
});

// Sliders: the design and the page's live parts update while you drag; what moved is shown on release.
$app.addEventListener('input', (e) => {
  const el = e.target; if (!el.matches || !el.matches('input[type=range][data-key]')) return;
  const k = el.dataset.key; const page = PAGE[key()]; if (!page) return;
  if (dragBefore === null && showAll()) dragBefore = margins();
  state.design[k] = parseFloat(el.value);
  const out = document.getElementById(`out-${k}`); if (out) out.textContent = fmtV(state.design[k], { unit: PARAMS[k].unit });
  save(); refreshPage(page);
});
$app.addEventListener('change', (e) => {
  const el = e.target; if (!el.matches || !el.matches('input[type=range][data-key]')) return;
  const page = PAGE[key()];
  if (dragBefore && page) { ripple = computeRipple(dragBefore, margins()); if (ripple) ripple.who = page.who; refreshPage(page); }
  dragBefore = null;
});

// If the page was reloaded mid-launch, replay the launch for this round.
render();

// Expose for quick console checks.
if (DEBUG) window.__md = { state: () => state, budgets, simulate, buildCharts };
