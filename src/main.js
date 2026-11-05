import '@fontsource-variable/pixelify-sans';
import '@fontsource-variable/geist-mono';
import './style.css';
import { DESTINATIONS, CONTRACTS, PAYLOADS, PARAMS, STEPS } from './data.js';
import {
  budgets, budgetMargins, marginColor, parts, simulate, explain, launchConditions, teamCode, ESTIMATE,
  isComplete, par, parDesign, paramVal, mulberry32, fmtYr, fmtGb,
} from './model.js';
import { LEAD, fmtU, interfaces, incoming, outgoing, failRow, requirements, reqFor } from './syseng.js';
import { trade, decisions, gaveUp, fmtC } from './trades.js';
import { PAGES, challengeState, knobsFor } from './pages.js';
import {
  buildCharts, renderChart, resetCharts, attachHover, chartForFailure, CHART_ORDER, CHART_LABEL,
} from './charts.js';
import { couplingMap } from './coupling.js';
import { art } from './art.js';
import { ICON, MARK } from './icons.js';
import { craftSVG } from './craft.js';
import { createScene } from './scene.js';

// ---------- flags + state ----------
const query = new URLSearchParams(location.search);
const DEBUG = query.has('debug');
// ?demo: three contracts, three different traps (deadline + battery, dust storm + mass, radiation + power).
const DEMO_IDS = query.has('demo') ? ['lunar-survey', 'mars-survey', 'europa-spec'] : null;
const URL_SEED = query.has('seed') ? Math.abs(parseInt(query.get('seed'), 10)) || 1 : null;
const STORE = 'mission-design-v8';
const MAX_ROUNDS = 3;

// The loop: take a contract, read its requirements, then one page per subsystem (each with its
// own mini-challenge, passing the phone between leads), review, launch. Three rounds: a blind
// flight test, then siloed budgets with the contract amended, then the full dashboard. Then a debrief.
const FLOW = ['contract', 'reqs', ...PAGES.map((p) => p.key), 'review', 'launch', 'debrief'];
const STEP = Object.fromEntries(STEPS.map((s) => [s.key, s]));
const PAGE = Object.fromEntries(PAGES.map((p) => [p.key, p]));
const STEP_NAME = { contract: 'Contract', reqs: 'Requirements', review: 'Review', launch: 'Launch', debrief: 'Debrief', ...Object.fromEntries(PAGES.map((p) => [p.key, p.title])) };
// Which lead owns each part.
const OWNER = { power: 'pt', thermal: 'pt', comms: 'comms', traj: 'prop', engine: 'prop', tank: 'prop', launcher: 'launch' };
const stepName = (k) => STEP_NAME[k];
const roleBadge = (k) => (PAGE[k] ? `Pass phone → ${LEAD[PAGE[k].who]}` : 'Role: Flight Director');

// The starter design: a flying baseline made of the standard part in every slot, at its usual size.
function blank() {
  // why: the criterion each part was chosen for (the trade-study rationale).
  const d = { contract: null, changed: false, why: {}, ...Object.fromEntries(Object.entries(PARAMS).map(([k, p]) => [k, p.def])) };
  const start = { comms: 'xdish', traj: 'direct', engine: 'biprop', tank: 'ti', thermal: 'louver', power: 'gaas', launcher: 'medium' };
  for (const s of STEPS) { d[s.key] = start[s.key]; Object.assign(d, s.list.find((x) => x.id === start[s.key]).def || {}); }
  return d;
}
const fresh = () => ({ step: 0, design: blank(), attempt: 1, seed: URL_SEED ?? 1000 + Math.floor(Math.random() * 9000), history: [] });

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (!s || !s.design || typeof s.step !== 'number') return null;
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
const canGoBack = () => state.attempt > 1;

// ---------- budget chips + graphs (round 2: own subsystem, round 3: all) ----------
function charts() { return isComplete(state.design) ? buildCharts(state.design, ESTIMATE) : null; }

// ---------- coupling: what a choice feeds, and what the last change moved ----------
// Margins past ±100% are "plenty" / "hopeless": clamp so only real shifts show up.
const clampM = (m) => (typeof m === 'number' ? Math.max(-1, Math.min(1, m)) : m);
const margins = () => { const ch = charts(); return ch ? Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, clampM(v.margin)])) : null; };
const fmtM = (m) => (m == null ? '–' : m >= 1 ? '100%+' : m <= -1 ? '−100%' : `${m < 0 ? '−' : ''}${Math.abs(R(m * 100))}%`);

// Every budget has an owner. A change that hurts a budget someone else owns is a change notice to them.
const BUDGET_OWNER = { power: 'pt', thermal: 'pt', rad: 'pt', night: 'pt', data: 'comms', time: 'prop', dv: 'prop', mass: 'launch', cost: 'launch' };
const ownerOf = (k) => (k === 'life' ? ((interfaces(state.design).find((r) => r.label === 'Part life') || {}).to || 'pt') : BUDGET_OWNER[k]);

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
  if (!ripple.length) return '<div class="ripple"><b>That change barely moved any budget.</b></div>';
  const me = ripple.who; // the lead who just made the change
  const notices = ripple.all.filter((r) => r.to < r.from && r.to < 0.15 && ownerOf(r.k) !== me);
  return `<div class="ripple"><b>That change moved:</b>${ripple.map((r) => `<span class="rchip ${r.to < 0.15 && r.to < r.from ? 'down' : r.from < 0.15 && r.to >= 0.15 ? 'up' : ''}">${CHART_LABEL[r.k]} <i>${fmtM(r.from)}</i> → <i>${fmtM(r.to)}</i></span>`).join('')}</div>
    ${notices.length ? `<div class="notice"><b>Change notice</b>${notices.map((r) => `<div>${LEAD[ownerOf(r.k)]}: ${CHART_LABEL[r.k]} ${fmtM(r.from)} → ${fmtM(r.to)}. They must respond.</div>`).join('')}</div>` : ''}
    <p class="note">Margin left. Same choice, many budgets.</p>`;
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
  const ch = charts(); if (!ch) return '';
  const keys = CHART_ORDER.filter((k) => ch[k] && typeof ch[k].margin === 'number');
  if (!keys.length) return '';
  const worst = keys.reduce((a, k) => (ch[k].margin < ch[a].margin ? k : a), keys[0]);
  const bad = marginColor(ch[worst].margin) !== 'green' ? worst : null;
  return `<details class="dash" open><summary>Team dashboard</summary>
    <div class="gauges">${keys.map((k) => `<span class="g ${marginColor(ch[k].margin)}">${CHART_LABEL[k]} <b>${fPct(ch[k].margin)}</b> <i>${LEAD[ownerOf(k)].replace(' Lead', '')}</i></span>`).join('')}</div>
    <p class="note">${bad ? `Weakest: ${CHART_LABEL[bad]}. Lit up: every choice that feeds it. Fix it together, not alone.` : 'Every budget has margin. Lines show which choices feed which budget.'}</p>
    ${couplingMap(state.design, partName, bad)}</details>`;
}

// ---------- choices: a trade table for every part ----------
const f$ = (v) => `$${R(v)}M`;

// Each option shows its value on the criteria that pull against each other (the best option per
// criterion is marked). Tapping a number picks the option and records that as the reason.
function optionsHTML(step) {
  const t = trade(step.key, state.design); const cur = state.design[step.key];
  return `<div class="opts">${t.options.map((o) => `
    <div class="opt ${cur === o.id ? 'sel' : ''}">
      <button class="opt-main" data-act="pick" data-slot="${step.key}" data-id="${o.id}"><span class="opt-name">${esc(o.name)}</span><span class="opt-blurb">${esc(o.blurb)}</span></button>
      <div class="crits">${t.criteria.map((c) => `<div class="crit ${t.isBest(o, c) ? 'best' : ''}"><span>${c.label}</span><b>${fmtC(c, o.vals[c.id])}</b></div>`).join('')}</div>
    </div>`).join('')}</div>`;
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
function header() {
  const n = state.step;
  return `<header class="top">
    <div class="top-row"><div class="brand">${MARK}Mission Design${DEBUG ? ' <span class="dbg">debug</span>' : ''}</div><span class="attempt">Round ${Math.min(state.attempt, MAX_ROUNDS)} of ${MAX_ROUNDS}</span></div>
    <div class="countdown"><b>${n >= stepOf('launch') ? 'T+0' : `T−${stepOf('launch') - n}`}</b> · ${stepName(key())} <span class="role-badge">${roleBadge(key())}</span></div>
    <i class="prog" style="width:${(100 * n) / (FLOW.length - 1)}%"></i>
  </header>`;
}

const stepOf = (k) => FLOW.indexOf(k);

function nav(canGo, nextLabel = 'Next') {
  const back = canGoBack() && state.step > 0;
  const lock = !canGoBack() && state.step > 0 ? '<span class="lock">No going back in the flight test</span>' : '<span></span>';
  return `<nav class="bottom">
    ${back ? '<button class="btn ghost" data-act="back">Back</button>' : lock}
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
      <div class="dest-top"><img class="planet pix" src="${art(`planet_${D.id}`)}" alt="">
        <div><div class="dest-name">${esc(C.name)}</div><div class="diff" role="img" aria-label="Difficulty ${D.difficulty} of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= D.difficulty ? 'on' : ''}"></i>`).join('')}</div></div>
        <span class="mult">×${D.mult} score</span></div>
      <div class="dest-goal">${esc(C.brief)}</div>
      <div class="kv"><span>Instrument</span><b>${esc(pay.name)}</b></div>
      <div class="kv"><span>Science goal</span><b>${C.goalGb} Gbit</b></div>
      <div class="kv"><span>Arrive within</span><b>${fmtYr(C.deadline)}</b></div>
      <div class="kv"><span>Funding</span><b>$${C.budget}M</b></div>
      <div class="hazard">${ICON.alert}<span>${esc(D.hazard.name)}</span></div>
    </button>`;
  }).join('');
  return `${header()}<main><h1>Contract board</h1>
    <p class="lead">Take a contract. Three rounds: a blind flight test, then each lead sees only their own budgets while the customer changes the contract, then the whole team gets the dashboard for a final attempt. Earn up to three stars a round.</p>
    <div class="dests">${cards}</div>
    <button class="link" data-act="reset">Start over (new team)</button></main>${nav(!!sel)}`;
}

// ---------- requirements and interfaces ----------
const fPct = (m) => (typeof m === 'number' ? `${m < 0 ? '−' : '+'}${Math.min(999, Math.abs(R(m * 100)))}%` : '–');

function screenReqs() {
  const rows = requirements(state.design);
  return `${header()}<main><h1>Requirements</h1>${amendHTML()}
    <p class="lead">The contract, as testable requirements. Each has an owner. Every choice you make puts new requirements on another lead. At Review you verify them all.</p>
    <div class="reqs">${rows.map((r) => `<div class="req"><b class="rid">${r.id}</b><div><div class="rtext">${esc(r.text)}</div><div class="rmeta">Owner: ${r.owner}</div><div class="rmeta">Satisfied by: ${r.by}</div></div></div>`).join('')}</div>
  </main>${nav(true)}`;
}

// Where an interface row's need comes from, largest first.
const sourcesHTML = (r) => `<small>${[...r.sources].sort((a, c) => c.v - a.v).map((s) => `${LEAD[s.from].replace(' Lead', '')}: ${esc(s.text)} ${fmtU(s.v, r.unit)}`).join(' · ')}</small>`;

// "Requirements on you" and "your choices put on others", for the lead holding the phone.
// Attempt 1 shows what is needed; attempt 2+ adds what your design provides and the margin.
function ifacePanel(k) {
  const who = OWNER[k]; const rows = interfaces(state.design); const live = showAll();
  const mine = incoming(rows, who);
  const row = (r) => `<div class="irow ${live ? r.status : ''}"><div class="kv"><span>${r.label}</span><b>${live && r.have != null ? `${fmtU(r.need, r.unit)} of ${fmtU(r.have, r.unit)} · ${fPct(r.margin)}` : `needs ${fmtU(r.need, r.unit)}`}</b></div>${sourcesHTML(r)}${r.note && live ? `<small>${esc(r.note)}</small>` : ''}</div>`;
  const out = showAll() ? outgoing(rows, who) : []; // what you put on others is a round-3 view
  const byLead = {};
  for (const o of out) (byLead[o.row.to] = byLead[o.row.to] || []).push(`${o.row.label} ${fmtU(o.src.v, o.row.unit)} (${esc(o.src.text)})`);
  return `<h2>Requirements on you</h2>${mine.length ? mine.map(row).join('') : '<small>Nothing yet.</small>'}
    ${out.length ? `<h2>Your choices put on others</h2>${Object.entries(byLead).map(([to, xs]) => `<div class="irow"><div class="kv"><span>${LEAD[to]}</span></div><small>${xs.join(' · ')}</small></div>`).join('')}` : ''}`;
}

// ---------- one page per subsystem ----------
// Each page is one lead's subsystem with its own mini-challenge. Silos: a lead sees their own
// gauges and charts; cost and lift are shared; the rest waits for Review.

// The contract amendment that lands from round 2.
function amendment() {
  const C0 = contract(); if (!state.design.changed || !C0.change) return null;
  const p = C0.change.patch; const out = [];
  if (p.payload && p.payload !== C0.payload) out.push(`new instrument: ${PAYLOADS.find((x) => x.id === p.payload).name}`);
  if (p.goalGb && p.goalGb !== C0.goalGb) out.push(`science goal ${C0.goalGb} → ${p.goalGb} Gbit`);
  if (p.deadline && p.deadline !== C0.deadline) out.push(`arrive within ${fmtYr(p.deadline)}`);
  if (p.budget && p.budget !== C0.budget) out.push(`funding $${C0.budget}M → $${p.budget}M`);
  return out.join(', ');
}
const amendHTML = () => { const t = amendment(); return t ? `<div class="notice"><b>Contract amendment</b>${esc(t)}. Your round-1 design may no longer fit.</div>` : ''; };

// The page's own gauges: the interface rows that land on this lead and belong to this page.
function gaugesHTML(who, labels) {
  const rows = incoming(interfaces(state.design), who).filter((r) => labels.includes(r.label)); if (!rows.length) return '';
  const live = showBudgets();
  return `<div class="gauges">${rows.map((r) => (live && r.margin != null
    ? `<span class="g ${r.status}">${r.label} <b>${fPct(r.margin)}</b></span>`
    : `<span class="g">${r.label} <b>needs ${fmtU(r.need, r.unit)}</b></span>`)).join('')}</div>`;
}


function hudHTML() {
  if (!showBudgets()) return '<div class="hud" id="hud"><span>Round 1 flies blind. Pick, then launch.</span></div>';
  if (!showAll()) return ''; // round 2: no shared view of cost and lift
  const b = budgets(state.design, ESTIMATE); const M = budgetMargins(b);
  const g = (label, text, m) => `<span class="g ${marginColor(m)}">${label} <b>${text}</b> <i>${fPct(m)}</i></span>`;
  return `<div class="hud" id="hud">${g('Cost', `${f$(b.cost)} of ${f$(b.budget)}`, M.cost)}${g('Lift', b.cap == null ? '–' : `${R(b.wet)} of ${R(b.cap)} kg`, M.mass)}</div>`;
}

// The mini-challenge card: what to do, and (from round 2) whether it is met and lean.
function challengeHTML(page, cs) {
  const m = page.minimize; const val = (v) => fmtU(v, m.unit);
  const goal = `Meet it with the least ${m.label}.`;
  if (!showBudgets()) return `<div class="challenge"><b>Mini-challenge: ${page.name}.</b> ${goal} You will see how you did after the flight.</div>`;
  if (cs.met && cs.lean) return `<div class="challenge ok"><b>✓ ${page.name}: met, and lean.</b> Nothing much lighter would do it (${val(cs.cur.value)} ${m.label}).</div>`;
  if (cs.met) return `<div class="challenge warn"><b>✓ ${page.name}: met, but over-built.</b> ${esc(cs.best.label)} also does it with ${val(cs.cur.value - cs.best.value)} less ${m.label}.</div>`;
  if (!cs.met && !showAll()) return `<div class="challenge bad"><b>✗ ${page.name}: not met yet.</b> Keep trying parts and sizes on this page.</div>`;
  if (cs.anyMet) return `<div class="challenge bad"><b>✗ ${page.name}: not met yet.</b> A different part or size here would meet it with the rest of the spacecraft as it is.</div>`;
  return `<div class="challenge bad"><b>✗ ${page.name}: not met, and nothing on this page can fix it.</b> Something another lead chose is in the way. Open "Who needs what".</div>`;
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
  return ch ? `<section class="graphs"><div class="chart-grid">${page.charts.filter((k) => ch[k]).map((k) => renderChart(ch[k])).join('')}</div></section>` : '';
}
function refreshPage(page) {
  resetCharts();
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const hud = document.getElementById('hud'); if (hud) hud.outerHTML = hudHTML();
  set('challenge', challengeHTML(page, challengeState(page, state.design)));
  set('gauges', gaugesHTML(page.who, page.rows));
  set('charts', chartsHTML(page));
  set('craft', craftSVG(state.design, { screen: page.craft }));
  set('rip', rippleHTML());
  set('dash', dashHTML());
}

function screenPage(page) {
  const d = state.design; const D = dest(); const b = budgets(d, ESTIMATE); const C = b.C;
  const idx = PAGES.indexOf(page);
  const ctx = { D, C, b };
  return `${header()}${hudHTML()}<main>${debugBar()}
    <div class="eyebrow"><span class="role">Subsystem ${idx + 1} of ${PAGES.length} · ${LEAD[page.who]}</span></div>
    <h1>${page.title}: ${page.name}</h1>
    <p class="lead">${esc(page.brief(ctx))}</p>
    <div id="challenge">${challengeHTML(page, challengeState(page, d))}</div>
    <p class="note">${esc(page.physics(ctx))}</p>
    <div class="craft-wrap" id="craft">${craftSVG(d, { screen: page.craft })}</div>
    <div id="gauges">${gaugesHTML(page.who, page.rows)}</div>
    <div id="rip">${rippleHTML()}</div>
    <div id="dash">${dashHTML()}</div>
    ${page.steps.map((k) => `<div class="card"><h3>${STEP[k].label}</h3>${optionsHTML(STEP[k])}</div>`).join('')}
    <p class="note">Every part is a trade, shown at its usual size. Tap a part to choose it (green is the best of the options on that number).</p>
    ${slidersHTML(page)}
    <div id="charts">${chartsHTML(page)}</div>
    <details class="who"><summary>Who needs what</summary><section class="alloc">${ifacePanel(page.steps[0])}</section></details>
  </main>${nav(true, idx === PAGES.length - 1 ? 'Review' : 'Next')}`;
}

// The decision record: what each lead chose, why, whether it was the best on that reason, and
// what it gave up.
function decisionHTML() {
  return decisions(state.design).map((x) => {
    const gave = gaveUp(x).slice(0, 2).map((g) => `${g.crit.label} ${fmtC(g.crit, g.value)} (best ${fmtC(g.crit, g.best)}, ${esc(g.bestOption)})`).join(' · ');
    return `<div class="vrow ${x.whyBest === false ? 'yellow' : 'green'}"><div><div>${x.label}: ${esc(x.option.name)}</div>
      <small>${x.whyBest === false ? `Not the best on ${x.why.label}: ${esc(x.gaps.find((g) => g.crit.id === x.why.id).bestOption)} is. ` : ''}${gave ? `Gave up: ${gave}` : x.whyBest === false ? 'Best on the other criteria.' : 'Best on every criterion.'}</small></div></div>`;
  }).join('');
}

function screenReview() {
  const d = state.design;
  if (!isComplete(d)) return `${header()}<main><h1>Design review</h1><p>Some parts are missing.</p></main>${nav(false)}`;
  const b = budgets(d, ESTIMATE); const C = b.C; const P = b.P;
  const rows = decisionHTML();
  if (!showAll()) {
    return `${header()}<main><h1>Final design</h1><p class="lead">${esc(C.name)}. Here is every trade you made. Launch it and see what happens.</p>
      <div class="craft-wrap">${craftSVG(d)}</div>
      <h2>Decision record</h2><div class="verify">${rows}</div>
    </main>${nav(true, 'Launch')}`;
  }
  const ch = buildCharts(d, ESTIMATE);
  const keys = CHART_ORDER.filter((k) => ch[k]);
  const reqs = requirements(d); const ifs = interfaces(d).filter((r) => r.margin != null);
  const reds = reqs.filter((r) => r.status === 'red').length; const yellows = reqs.filter((r) => r.status === 'yellow').length;
  const over = b.cost > b.budget;
  const challengeRows = PAGES.map((p) => {
    const cs = challengeState(p, d);
    return `<div class="vrow ${cs.met ? (cs.lean ? 'green' : 'yellow') : 'red'}"><div><div>${p.title}: ${p.name}</div><small>${cs.met ? (cs.lean ? 'Met, and lean' : 'Met, but over-built') : 'Not met'} · ${LEAD[p.who]}</small></div></div>`;
  }).join('');
  const ifRow = (r) => `<div class="vrow ${r.status}"><div><div>${r.label} <span class="rmeta">→ ${LEAD[r.to]}</span></div><small>${fmtU(r.need, r.unit)} needed of ${fmtU(r.have, r.unit)} provided</small>${sourcesHTML(r)}</div><span class="r-m">${fPct(r.margin)}</span></div>`;
  return `${header()}<main><h1>Design review</h1>
    <div class="craft-wrap">${craftSVG(d)}</div>
    <h2>System requirements</h2>
    <div class="summary">${reds ? `<b class="red-t">${reds} failing</b> · ` : ''}${yellows ? `<b class="yellow-t">${yellows} thin</b> · ` : ''}${!reds && !yellows ? '<b class="green-t">All verified</b>' : ''}</div>
    <div class="verify">${reqs.map((r) => `<div class="vrow ${r.status}"><b class="rid">${r.id}</b><div><div>${esc(r.text)}</div><small>${r.owner} · ${r.by}</small></div><span class="r-m">${fPct(r.margin)}</span></div>`).join('')}</div>
    <div class="unlock">Nominal margins shown. Launch adds 0–15% dry-mass growth + 1 deep-space anomaly.</div>
    <h2>Interface requirements</h2>
    <p class="note">What each lead asked of the others, and whether it was met.</p>
    <div class="verify">${ifs.map(ifRow).join('')}</div>
    <details class="picks"><summary>All budget graphs</summary><div class="chart-grid">${keys.map((k) => renderChart(ch[k])).join('')}</div></details>
    <h2>Subsystem challenges</h2>
    <p class="note">Each page's mini-challenge: meet the requirement with the least of its own cost.</p>
    <div class="verify">${challengeRows}</div>
    <h2>Decision record</h2>
    <p class="note">Each trade you made and what it gave up.</p>
    <div class="verify">${rows}</div>
    ${over ? `<div class="warn">Launch blocked: over budget by $${R(b.cost - b.budget)}M.</div>` : ''}
  </main>${nav(!over, 'Launch')}`;
}

function historyHTML() {
  return `<div class="history"><b>Rounds</b>${state.history.map((h) => `<div class="h-row"><span>Round ${h.attempt}</span><span class="stars" aria-label="${h.stars} of 3 stars">${starsOf(h.stars)}</span><span>${h.score} pts</span><span class="code">${h.code}</span></div>`).join('')}</div>`;
}
const starsOf = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
const tierName = (o) => ({ none: 'No mission', min: 'Minimum', full: 'Full success' }[o]);

// ---------- launch screen ----------
function screenLaunch() {
  return `${header()}<main class="launch">
    <div id="banner"></div>
    ${state.attempt > 1 ? '<button class="btn small ff" data-act="ff" aria-pressed="false">2x &gt;&gt;</button>' : ''}
    <div class="phase-name" id="phase">Countdown</div>
    <div class="clock" id="clock">T-0</div>
    <div class="scene-wrap" id="scene"></div>
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
  if (!f || f.partial || (f.t >= cruise && f.phase === 'ops')) beats.push({ ms: tOf(cruise, 'arrival'), cls: 'ok', text: `Arrival burn: ${R(b.dvAvail)} of ${R(b.dvReq)} m/s. In position at ${b.D.name}.` });
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
  const parCost = par(d.contract, d.changed);
  // Over budget fails R4: a round-1 bailout buys the flight, not the stars.
  const over = res.cost > res.b.budget;
  let stars = res.outcome === 'full' ? (res.cost <= parCost * 1.1 ? 3 : 2) : res.outcome === 'min' ? 1 : 0;
  if (over) stars = Math.min(stars, 1);
  const rq = f ? requirements(d).find((r) => r.id === reqFor(f)) : null;
  if (!state.history.find((h) => h.attempt === state.attempt)) {
    state.history.push({ attempt: state.attempt, name: C.name, outcome: res.outcome, stars, score: res.score, code, cost: R(res.cost), req: rq ? `${rq.id} (${rq.text})` : over ? 'R4 (afford it)' : null });
    save();
  }
  const chains = explain(d, res);
  const closest = !f ? closestCall(res.b) : null;
  const ev = res.opts.event;
  // The graph of the budget that broke, flown with the real launch conditions.
  const ch = buildCharts(d, res.opts, f);
  const fk = chartForFailure(f, res.b);
  const failChart = ch && fk && ch[fk] ? renderChart(ch[fk]) : '';
  const map = f ? `<p class="a-sub">The failure traces back to these choices:</p>${couplingMap(d, partName, fk)}` : '';
  const later = f ? downstream(res, fk) : [];
  const warnLater = later.length ? `<div class="warn">Downstream Warning: Even if you survived ${fk ? CHART_LABEL[fk].toLowerCase() : 'that'}, this design also failed ${later.map((k) => CHART_LABEL[k].toLowerCase()).join(' and ')}.</div>` : '';
  // Trace the failed requirement back through the interface that carried it: who asked for what.
  const fr = f ? interfaces(d).find((r) => r.label === failRow(f, res.b)) : null;
  const top = fr ? [...fr.sources].sort((a, c) => c.v - a.v).slice(0, 2) : [];
  const reqLine = !rq ? '' : `<p class="a-req"><b>${rq.id} not met:</b> ${esc(rq.text)}. Owner: ${rq.owner}.</p>
      ${fr && top.length ? `<p class="note"><b>${fr.label}</b> was asked of the ${LEAD[fr.to]}. Biggest demands: ${top.map((s) => `${LEAD[s.from]} (${esc(s.text)}, ${fmtU(s.v, fr.unit)})`).join('; ')}.${fr.have != null ? ` Their design provided ${fmtU(fr.have, fr.unit)}.` : ''}</p>` : ''}`;
  // The trade behind the failure: the decision that gave up the criterion this interface row measures.
  const traded = fr ? decisions(d).flatMap((x) => gaveUp(x).filter((g) => g.crit.row === fr.label).map((g) => ({ x, g }))).sort((a, c) => c.g.gap - a.g.gap)[0] : null;
  const tradeLine = traded ? `<p class="note"><b>The trade behind it:</b> the ${LEAD[OWNER[traded.x.key]]} chose ${esc(traded.x.option.name)}${traded.x.why ? ` for ${traded.x.why.label}` : ''}, which gave up ${traded.g.crit.label} (${fmtC(traded.g.crit, traded.g.value)} against ${fmtC(traded.g.crit, traded.g.best)} for ${esc(traded.g.bestOption)}).</p>` : '';
  document.getElementById('result').innerHTML = `
    <div class="outcome ${res.outcome}">
      <div class="o-stars" role="img" aria-label="${stars} of 3 stars">${starsOf(stars)}</div>
      <div class="o-tier">${tierName(res.outcome)}</div>
      <div class="o-grid">
        <div><span>Score</span><b>${res.score}</b></div>
        <div><span>Science</span><b>${fmtGb(res.scienceGb)}</b></div>
        <div><span>Cost</span><b>${f$(res.cost)}</b></div>
        <div><span>Team code</span><b class="code">${code}</b></div>
      </div>
      <div class="o-note">${res.points} science pts × ${D.mult} (${esc(C.name)})</div>
      <div class="o-note">Your Cost: ${f$(res.cost)} | Target Par Cost: ${f$(parCost)}${stars === 2 ? '. Three stars needs a full success within 10% of par.' : over ? '. Over budget: one star at most.' : ''}</div>
    </div>
    ${f ? `<section class="anomaly"><h2>Anomaly report</h2><p class="a-what">${esc(f.text)}</p>
      ${reqLine}${tradeLine}${warnLater}
      ${failChart}
      ${map}
      <p class="a-sub">The chain of cause and effect:</p>
      ${chains.slice(0, 1).map((c) => `<ol class="chain">${c.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`).join('')}
      ${chains.length > 1 ? `<details class="picks"><summary>More causes</summary>${chains.slice(1).map((c) => `<ol class="chain">${c.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`).join('')}</details>` : ''}
      </section>` : over ? `<section class="anomaly"><h2>Requirement check</h2><p class="a-req"><b>R4 not met:</b> Afford it: stay under ${f$(res.b.budget)}. Owner: Flight Director.</p><p class="note">The flight worked, but the design cost ${f$(res.cost - res.b.budget)} too much. The bailout bought this flight only. Cost is a requirement like any other.</p></section>`
      : `<section class="anomaly good"><h2>Mission report</h2><p>Every constraint held. ${closest ? `Closest call: <b>${closest}</b>.` : ''}</p></section>`}
    ${ev ? `<p class="note">Random event: ${esc(ev.text)}</p>` : ''}
    ${first ? '<div class="unlock"><b>Gauges unlocked.</b> Back works now. Next, the customer changes the contract.</div>' : ''}
    ${historyHTML()}
    <div class="end-actions">
      ${last ? '<button class="btn primary" data-act="finish">Mission debrief</button>' : `<button class="btn primary" data-act="redesign">Round ${state.attempt + 1}: ${first ? 'the contract changes' : 'final attempt'}</button>`}
    </div>`;
  document.querySelector('.ff')?.remove();
  if (!DEBUG) document.getElementById('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Chief engineer's note: up to two other budgets that would also have killed this design,
// from later failures in the flight, then anything already broken on paper.
function downstream(res, fk) {
  const keys = (res.others || []).map((o) => chartForFailure(o, res.b));
  const M = budgetMargins(budgets(state.design, ESTIMATE));
  keys.push(...Object.keys(M).filter((k) => M[k] < 0));
  return [...new Set(keys)].filter((k) => k && k !== fk).slice(0, 2);
}

function closestCall(b) {
  const opts = [['Mass', b.massMargin], ['Power', b.powerMargin], ['Delta-v', b.dvMargin], ['Data', b.dataMargin], ['Thermal', b.thermalMargin], ['Radiation', b.radMargin], ['Cost', b.costMargin], ['Design life', b.lifeMargin], ['Schedule', b.timeMargin]];
  const m = opts.filter((x) => typeof x[1] === 'number').sort((a, c) => a[1] - c[1])[0];
  return m ? `${m[0]} margin ${R(m[1] * 100)}%` : null;
}

// ---------- debrief ----------
function screenDebrief() {
  const hs = state.history;
  const best = hs.reduce((a, h) => (!a || h.score > a.score || (h.score === a.score && h.stars > a.stars) ? h : a), null);
  const total = hs.reduce((s, h) => s + h.stars, 0);
  const first = hs[0];
  const lessons = [];
  if (first && first.stars < 2) lessons.push(['A flight test finds what paper cannot.', `Round 1 ${first.outcome === 'none' ? 'failed' : 'fell short'}${first.req ? ` on ${first.req}` : ''}. Every failure traced back to a choice someone made for good reasons.`]);
  lessons.push(['Requirements flow down.', 'A choice by one lead became a requirement on another: the transmitter loaded Power, the fuel loaded the rocket, the route set the radiation dose.']);
  const dec = decisions(state.design); const hit = dec.filter((x) => !x.gaps.length).length;
  const big = dec.flatMap((x) => gaveUp(x).map((g) => ({ x, g }))).sort((a, c) => c.g.gap - a.g.gap)[0];
  lessons.push(['Every choice is a trade.', `${hit} of ${dec.length} choices were the best option on every criterion.${big ? ` Biggest give-up: ${big.x.option.name} (${big.x.label}) gave up ${big.g.crit.label}, ${fmtC(big.g.crit, big.g.value)} against ${fmtC(big.g.crit, big.g.best)}.` : ''}`]);
  lessons.push(['Requirements change.', `In round 2 the contract was amended (${amendment() || 'new goal and funding'}). A design is only as good as its latest requirements.`]);
  lessons.push(['Margin is a choice.', `Your final design's closest call: ${closestCall(budgets(state.design, ESTIMATE)) || 'n/a'}. Launch adds mass growth and one surprise, so thin margin is a bet.`]);
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
    ${historyHTML()}
    <section class="anomaly good"><h2>What you practised</h2>${lessons.map(([t, x]) => `<p><b>${t}</b> ${esc(x)}</p>`).join('')}</section>
    <div class="end-actions"><button class="btn primary" data-act="newgame">New mission</button></div>
  </main>`;
}

// ---------- render + events ----------
const SCREENS = { contract: screenContract, reqs: screenReqs, ...Object.fromEntries(PAGES.map((p) => [p.key, () => screenPage(p)])), review: screenReview, launch: screenLaunch, debrief: screenDebrief };

function render() {
  if (anim) { clearTimeout(anim); anim = null; }
  resetCharts();
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
    const best = parDesign(state.design.contract, state.design.changed); if (best) state.design = { ...best, why: {} };
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
  else if (act === 'back') { if (canGoBack()) go(Math.max(0, state.step - 1)); }
  else if (act === 'redesign') { state.attempt += 1; state.design.changed = true; state.design.why = {}; go(stepOf('reqs')); } // requirements changed: re-confirm every trade
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
