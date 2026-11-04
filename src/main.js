import './style.css';
import { DESTINATIONS, SLOTS, FLYBYS, LAUNCHERS } from './data.js';
import {
  budgets, simulate, explain, launchConditions, teamCode, ESTIMATE,
  isComplete, cheapestFull, allDesigns, mulberry32, launchCapacity, fmtYr, fmtGb,
} from './model.js';
import { consideration } from './considerations.js';
import {
  buildCharts, renderChart, resetCharts, attachHover, chartForFailure, CHART_ORDER, CHART_LABEL,
} from './charts.js';
import { COUPLING, BUDGET_LABEL, couplingMap } from './coupling.js';

// ---------- flags + state ----------
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const URL_SEED = params.has('seed') ? Math.abs(parseInt(params.get('seed'), 10)) || 1 : null;
const STORE = 'mission-design-v2';

// One screen per design choice. Trajectory comes before the engine, tank, and
// launcher because all three depend on the route.
const FLOW = ['dest', 'payload', 'power', 'thermal', 'comms', 'traj', 'engine', 'tank', 'launcher', 'review', 'launch'];
const SLOT = Object.fromEntries(SLOTS.map((s) => [s.key, s]));
const STEP_NAME = { dest: 'Destination', review: 'Review', launch: 'Launch' };
const stepName = (k) => STEP_NAME[k] || SLOT[k].label;

// Which budget graphs each choice moves the most.
const SLOT_CHARTS = {
  payload: ['data', 'power', 'mass'],
  power: ['power', 'night', 'mass'],
  thermal: ['thermal', 'rad', 'power'],
  comms: ['data', 'power'],
  traj: ['cost', 'life', 'mass'],
  engine: ['dv', 'power', 'life'],
  tank: ['dv', 'mass'],
  launcher: ['mass', 'cost'],
};

const blank = () => ({ dest: null, payload: null, power: null, thermal: null, comms: null, engine: null, tank: null, launcher: null, traj: null });
const fresh = () => ({ step: 0, design: blank(), attempt: 1, seed: URL_SEED ?? 1000 + Math.floor(Math.random() * 9000), history: [], open: [] });

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (!s || !s.design || typeof s.step !== 'number') return null;
    if (URL_SEED != null && s.seed !== URL_SEED) return null;
    s.open = s.open || [];
    return s;
  } catch { return null; }
}
let state = load() || fresh();
let lastStatus = null; // budget colors before the last pick, to flash what changed
let ripple = null; // budgets the last pick moved (attempt 2+)
let anim = null; // running launch animation handle
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode */ } };

const $app = document.getElementById('app');
attachHover($app);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const R = Math.round;
const dest = () => DESTINATIONS.find((d) => d.id === state.design.dest);
const key = () => FLOW[state.step];

// First attempt: no budgets and no going back. Commit, launch, learn from the failure.
const showBudgets = () => state.attempt > 1;
const canGoBack = () => state.attempt > 1;

// ---------- budget health row + graphs ----------
function charts() { return isComplete(state.design) ? buildCharts(state.design, ESTIMATE) : null; }

function healthRow(ch) {
  if (!ch) return '';
  const keys = CHART_ORDER.filter((k) => ch[k]);
  return `<div class="health">${keys.map((k) => {
    const s = ch[k].status;
    const changed = lastStatus && lastStatus[k] && lastStatus[k] !== s;
    return `<button class="hchip ${s} ${changed ? 'flash' : ''} ${state.open.includes(k) ? 'open' : ''}" data-act="chart" data-k="${k}">${CHART_LABEL[k]}<i>${{ green: '✓', yellow: '!', red: '✗' }[s] || ''}</i></button>`;
  }).join('')}</div>`;
}

function chartsSection(ch, keys, heading) {
  if (!ch) return '';
  const all = [...new Set([...keys, ...state.open])].filter((k) => ch[k]);
  return `<section class="graphs"><h2>${heading}</h2><p class="note">Blue is your design. Orange is the limit. Tap a chip above to add a graph.</p>
    <div class="chart-grid">${all.map((k) => renderChart(ch[k])).join('')}</div></section>`;
}

// ---------- coupling: what a choice feeds, and what the last pick moved ----------
// Margins past ±100% are "plenty" / "hopeless": clamp so only real shifts show up.
const clampM = (m) => (typeof m === 'number' ? Math.max(-1, Math.min(1, m)) : m);
const margins = () => { const ch = charts(); return ch ? Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, clampM(v.margin)])) : null; };
const fmtM = (m) => (m == null ? '–' : m >= 1 ? '100%+' : m <= -1 ? '−100%' : `${m < 0 ? '−' : ''}${Math.abs(R(m * 100))}%`);

function computeRipple(before, after) {
  if (!before || !after) return null;
  return Object.keys(after).filter((k) => typeof before[k] === 'number' && typeof after[k] === 'number' && Math.abs(after[k] - before[k]) >= 0.03)
    .sort((a, b) => Math.abs(after[b] - before[b]) - Math.abs(after[a] - before[a])).slice(0, 4)
    .map((k) => ({ k, from: before[k], to: after[k] }));
}

function rippleHTML() {
  if (!showBudgets() || !ripple) return '';
  if (!ripple.length) return '<div class="ripple"><b>That pick barely moved any budget.</b></div>';
  return `<div class="ripple"><b>That pick moved:</b>${ripple.map((r) => `<span class="rchip ${r.to < 0.15 && r.to < r.from ? 'down' : r.from < 0.15 && r.to >= 0.15 ? 'up' : ''}">${CHART_LABEL[r.k]} <i>${fmtM(r.from)}</i> → <i>${fmtM(r.to)}</i></span>`).join('')}</div>
    <p class="note">Margin left. Same choice, many budgets.</p>`;
}

const partName = (c) => {
  const v = state.design[c]; if (!v) return '';
  if (c === 'traj') return v === 'assist' ? 'Assist' : 'Direct';
  return SLOT[c].list.find((p) => p.id === v).name.replace(/\s*\(.*\)/, '');
};

// ---------- option cards ----------
function statsFor(slotKey, p) {
  const D = dest(); const d = state.design; const s = [];
  const add = (k, v) => s.push(`<span class="stat"><b>${v}</b> ${k}</span>`);
  if (p.mass != null && slotKey !== 'launcher') add('kg', p.mass);
  if (p.cost != null) add('', `$${p.cost}M`);
  switch (slotKey) {
    case 'payload': add('W', p.powerW); add('Gbit/yr', p.genGb); break;
    case 'power': {
      const here = p.type === 'rtg' ? p.outW : R(p.outW * Math.min(1 / D.sunAU ** 2, D.solarCap));
      add(`W at ${D.name}`, here); add('kWh battery', (p.batteryWh / 1000).toFixed(p.batteryWh < 10000 ? 1 : 0));
      break;
    }
    case 'thermal': {
      const heat = D.coldW * p.heaterFactor;
      add('x sun max', p.hotLimit); add('krad shield', p.radTol); if (heat > 0) add('W heater here', R(heat));
      break;
    }
    case 'comms': {
      const down = (p.rateGb * D.contact) / (D.earthAU * D.earthAU);
      add('W', p.powerW); add(`Gbit/yr from ${D.name}`, down >= 100 ? R(down) : down.toFixed(1));
      break;
    }
    case 'engine': add('Isp (s)', p.isp); add('thrust', p.thrustN >= 400 ? 'High' : p.thrustN >= 50 ? 'Medium' : 'Tiny'); if (p.powerW) add('W to run', p.powerW); break;
    case 'tank': add('kg fuel', p.prop); break;
    case 'launcher': {
      const tr = D.traj[d.traj || 'direct'];
      add(`kg to ${D.name}${d.traj ? '' : ' (Direct)'}`, R(launchCapacity(p, tr.c3)));
      break;
    }
    case 'traj': {
      const tr = D.traj[p.id];
      add('yr cruise', fmtYr(tr.cruise, true)); add('m/s burn', tr.dv);
      add('launch energy', tr.c3 > 30 ? 'High' : tr.c3 > 10 ? 'Med' : 'Low');
      add('ops cost', `$${R(D.opsCostPerYr * (tr.cruise + D.opsYears))}M`);
      if (tr.flyby) add('', `${FLYBYS[tr.flyby].name} ⚠`);
      break;
    }
    default: break;
  }
  if (p.life != null && slotKey !== 'tank') add('yr life', p.life);
  return s.join('');
}

function optionsHTML(slot) {
  const D = dest(); const cur = state.design[slot.key];
  const list = slot.key === 'traj' ? slot.list.map((t) => ({ ...t, name: t.id === 'assist' ? `Assist: ${D.traj.assist.label}` : 'Direct' })) : slot.list;
  return `<div class="opts">${list.map((p) => `
      <button class="opt ${cur === p.id ? 'sel' : ''}" data-act="pick" data-slot="${slot.key}" data-id="${p.id}">
        <div class="opt-name">${esc(p.name)}</div><div class="opt-blurb">${esc(p.blurb)}</div>
        <div class="stats">${statsFor(slot.key, p)}</div>
      </button>`).join('')}</div>`;
}

// ---------- screens ----------
function header() {
  const n = state.step;
  return `<header class="top">
    <div class="brand">Mission Design${DEBUG ? ' <span class="dbg">DEBUG</span>' : ''}</div>
    <div class="meta"><span>Step ${n + 1}/${FLOW.length} · ${stepName(key())}</span><span class="attempt">Attempt ${state.attempt}</span></div>
    <div class="dots">${FLOW.map((_, i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>
  </header>`;
}

function nav(canNext, nextLabel = 'Next') {
  const back = canGoBack() && state.step > 0;
  const lock = !canGoBack() && state.step > 0 ? '<span class="lock">No going back on the first attempt</span>' : '<span></span>';
  return `<nav class="bottom">
    ${back ? '<button class="btn ghost" data-act="back">Back</button>' : lock}
    <button class="btn primary" data-act="next" ${canNext ? '' : 'disabled'}>${nextLabel}</button>
  </nav>`;
}

function debugBar() {
  if (!DEBUG || key() === 'dest' || key() === 'review' || key() === 'launch') return '';
  return `<div class="debugbar"><button class="btn small" data-act="dbg-random">Random design</button><button class="btn small" data-act="dbg-good">Cheapest full success</button><span>seed ${state.seed}</span></div>`;
}

function screenDest() {
  const sel = state.design.dest;
  const cards = DESTINATIONS.map((D) => `
    <button class="dest ${sel === D.id ? 'sel' : ''}" data-act="dest" data-id="${D.id}">
      <div class="dest-top"><span class="planet" style="--c:${D.color}"></span>
        <div><div class="dest-name">${D.name}</div><div class="stars">${'★'.repeat(D.difficulty)}${'☆'.repeat(5 - D.difficulty)}</div></div>
        <span class="mult">×${D.mult} score</span></div>
      <div class="dest-goal">${esc(D.goal)}</div>
      <div class="hazard"><b>⚠ ${esc(D.hazard.name)}</b></div>
      ${showBudgets() ? `<div class="kv"><span>Budget</span><b>$${D.budget}M</b></div>` : ''}
    </button>`).join('');
  const intro = state.attempt === 1
    ? '<p class="lead">One choice per screen. No going back. Every choice ripples into the others.</p>'
    : '<p class="lead">Harder targets score more.</p>';
  return `${header()}<main><h1>Where are we going?</h1>${intro}
    ${state.history.length ? historyHTML() : ''}<div class="dests">${cards}</div>
    <button class="link" data-act="reset">Start over (new team)</button></main>${nav(!!sel)}`;
}

function screenChoice(k) {
  const slot = SLOT[k]; const D = dest();
  const c = consideration(k, D, state.design);
  const ch = showBudgets() ? charts() : null;
  const html = `${header()}${ch ? healthRow(ch) : ''}<main>${debugBar()}
    <section class="consider">
      <div class="eyebrow"><span class="role">${slot.role}</span></div>
      <h1>${esc(c.title)}</h1>
      <p class="why">${esc(c.why)}</p>
      <ul class="here">${c.here.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
      <div class="feeds"><span>Ripples into</span>${COUPLING[k].map((b) => `<i>${BUDGET_LABEL[b]}</i>`).join('')}</div>
    </section>
    ${optionsHTML(slot)}
    ${rippleHTML()}
    ${ch ? chartsSection(ch, SLOT_CHARTS[k], 'Your budgets') : ''}
  </main>${nav(!!state.design[k])}`;
  lastStatus = ch ? Object.fromEntries(Object.entries(ch).map(([kk, v]) => [kk, v.status])) : null;
  return html;
}

function screenReview() {
  const d = state.design;
  if (!isComplete(d)) return `${header()}<main><h1>Design review</h1><p>Some parts are missing.</p></main>${nav(false)}`;
  const b = budgets(d, ESTIMATE);
  const picks = FLOW.filter((k) => SLOT[k]).map((k) => {
    const p = SLOT[k].list.find((x) => x.id === d[k]);
    const name = k === 'traj' ? (d.traj === 'assist' ? `Assist: ${b.D.traj.assist.label}` : 'Direct') : p.name;
    return `<div class="kv"><span>${SLOT[k].label}</span><b>${esc(name)}</b></div>`;
  }).join('');
  if (!showBudgets()) {
    return `${header()}<main><h1>Final design</h1><p class="lead">Flying to ${b.D.name}. Launch it and see what happens.</p>
      <div class="costbox">${picks}</div>
    </main>${nav(true, '🚀 Launch')}`;
  }
  const ch = buildCharts(d, ESTIMATE);
  const keys = CHART_ORDER.filter((k) => ch[k]);
  const reds = keys.filter((k) => ch[k].status === 'red').length; const yellows = keys.filter((k) => ch[k].status === 'yellow').length;
  const over = b.cost > b.budget;
  return `${header()}<main><h1>Design review</h1>
    <div class="summary">${reds ? `<b class="red-t">${reds} failing</b> · ` : ''}${yellows ? `<b class="yellow-t">${yellows} thin</b> · ` : ''}${!reds && !yellows ? '<b class="green-t">All clear</b> · ' : ''}Real hardware comes out heavier. Leave margin.</div>
    <div class="chart-grid">${keys.map((k) => renderChart(ch[k])).join('')}</div>
    <details class="picks"><summary>Your parts</summary><div class="costbox">${picks}</div></details>
    ${over ? `<div class="warn">Launch blocked: over budget by $${R(b.cost - b.budget)}M.</div>` : ''}
  </main>${nav(!over, '🚀 Launch')}`;
}

function historyHTML() {
  return `<div class="history"><b>Past attempts</b>${state.history.map((h) => `<div class="h-row"><span>#${h.attempt} ${esc(h.dest)}</span><span class="tier ${h.outcome}">${tierName(h.outcome)}</span><span>${h.score} pts</span><span class="code">${h.code}</span></div>`).join('')}</div>`;
}
const tierName = (o) => ({ none: 'No mission', min: 'Minimum', full: 'Full success' }[o]);

// ---------- launch screen ----------
function screenLaunch() {
  return `${header()}<main class="launch">
    <div class="phase-name" id="phase">Countdown</div>
    <div class="clock" id="clock">T-0</div>
    <div class="track" id="track"></div>
    <div class="phases" id="phases"></div>
    <ul class="log" id="log"></ul>
    <div id="result"></div>
  </main>`;
}

function startLaunch() {
  const d = state.design;
  const cond = launchConditions(state.seed, state.attempt);
  const res = simulate(d, cond);
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
  let next = 0; const t0 = performance.now();
  const phaseAt = (ms) => (ms < P.lift ? 0 : ms < P.lift + P.cruise ? 1 : ms < P.lift + P.cruise + P.arr ? 2 : 3);
  const missionT = (ms) => {
    if (ms < P.lift) return 0;
    if (ms < P.lift + P.cruise) return cruise * ((ms - P.lift) / P.cruise);
    if (ms < P.lift + P.cruise + P.arr) return cruise;
    return cruise + (end - cruise) * Math.min(1, (ms - P.lift - P.cruise - P.arr) / P.ops);
  };

  function frame(now) {
    const ms = Math.min(now - t0, stopMs);
    const ph = phaseAt(ms);
    const tm = Math.min(missionT(ms), stopT);
    document.getElementById('phase').textContent = f && f.phase === 'review' ? 'Program review' : ['Liftoff', 'Cruise', 'Arrival burn', 'Operations'][ph];
    document.getElementById('clock').textContent = ph === 0 ? 'T+0' : `Year ${tm.toFixed(1)}`;
    document.getElementById('fill').style.width = pos(tm);
    for (let i = 0; i < 4; i++) document.getElementById(`ph${i}`).className = i < ph ? 'done' : i === ph ? 'now' : '';
    while (next < beats.length && beats[next].ms <= ms) {
      const bt = beats[next++];
      log.insertAdjacentHTML('afterbegin', `<li class="${bt.cls}"><span>${bt.cls === 'ok' ? '✓' : bt.cls === 'fail' ? '✗' : bt.cls === 'warn' ? '!' : 'i'}</span>${esc(bt.text)}</li>`);
      if (bt.fail) { const fm = document.getElementById('failmk'); if (fm) fm.style.display = 'block'; document.querySelector('.launch').classList.add('shake'); }
    }
    // Timers (not requestAnimationFrame) so the launch keeps going if the phone is backgrounded.
    if (ms < stopMs) anim = setTimeout(() => frame(performance.now()), 33);
    else if (instant) { anim = null; showResult(res); }
    else anim = setTimeout(() => { anim = null; showResult(res); }, 900);
  }
  frame(performance.now());
}

function showResult(res) {
  if (key() !== 'launch' || !document.getElementById('result')) return;
  const d = state.design; const D = res.b.D;
  const code = teamCode(d, state.seed, state.attempt);
  const first = state.attempt === 1;
  if (!state.history.find((h) => h.attempt === state.attempt)) {
    state.history.push({ attempt: state.attempt, dest: D.name, outcome: res.outcome, score: res.score, code, cost: R(res.cost) });
    save();
  }
  const chains = explain(d, res);
  const f = res.failure;
  const closest = !f ? closestCall(res.b) : null;
  const ev = res.opts.event;
  // The graph of the budget that broke, flown with the real launch conditions.
  const ch = buildCharts(d, res.opts, f);
  const fk = chartForFailure(f, res.b);
  const failChart = ch && fk && ch[fk] ? renderChart(ch[fk]) : '';
  const map = f ? `<p class="a-sub">The failure traces back to these choices:</p>${couplingMap(d, partName, fk)}` : '';
  document.getElementById('result').innerHTML = `
    <div class="outcome ${res.outcome}">
      <div class="o-tier">${tierName(res.outcome)}</div>
      <div class="o-grid">
        <div><span>Score</span><b>${res.score}</b></div>
        <div><span>Science</span><b>${fmtGb(res.scienceGb)}</b></div>
        <div><span>Cost</span><b>$${R(res.cost)}M</b></div>
        <div><span>Team code</span><b class="code">${code}</b></div>
      </div>
      <div class="o-note">${res.points} science pts × ${D.mult} (${D.name})</div>
    </div>
    ${f ? `<section class="anomaly"><h2>Anomaly report</h2><p class="a-what">${esc(f.text)}</p>
      ${failChart}
      ${map}
      <p class="a-sub">The chain of cause and effect:</p>
      ${chains.slice(0, 1).map((c) => `<ol class="chain">${c.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`).join('')}
      ${chains.length > 1 ? `<details class="picks"><summary>More causes</summary>${chains.slice(1).map((c) => `<ol class="chain">${c.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`).join('')}</details>` : ''}
      </section>` : `<section class="anomaly good"><h2>Mission report</h2><p>Every constraint held. ${closest ? `Closest call: <b>${closest}</b>.` : ''}</p></section>`}
    ${ev ? `<p class="note">Random event: ${esc(ev.text)}</p>` : ''}
    ${first ? `<div class="unlock"><b>Budgets unlocked.</b> Graphs on every screen. Back works now.</div>` : ''}
    ${historyHTML()}
    <div class="end-actions">
      <button class="btn primary" data-act="redesign">Redesign · Attempt ${state.attempt + 1}</button>
      <button class="btn ghost" data-act="newdest">Change destination</button>
    </div>`;
  if (!DEBUG) document.getElementById('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closestCall(b) {
  const opts = [['Mass', b.massMargin], ['Power', b.powerMargin], ['Delta-v', b.dvMargin], ['Data', b.dataMargin], ['Thermal', b.thermalMargin], ['Radiation', b.radMargin], ['Cost', b.costMargin], ['Design life', b.lifeMargin]];
  const m = opts.filter((x) => typeof x[1] === 'number').sort((a, c) => a[1] - c[1])[0];
  return m ? `${m[0]} margin ${R(m[1] * 100)}%` : null;
}

// ---------- render + events ----------
function render() {
  if (anim) { clearTimeout(anim); anim = null; }
  resetCharts();
  const k = key();
  let html = '';
  if (k === 'dest') html = screenDest();
  else if (k === 'review') html = screenReview();
  else if (k === 'launch') html = screenLaunch();
  else html = screenChoice(k);
  $app.innerHTML = html;
  if (k === 'launch') startLaunch();
}

function go(n) { state.step = n; lastStatus = null; ripple = null; save(); render(); window.scrollTo(0, 0); }
const stepOf = (k) => FLOW.indexOf(k);

function autoPick(mode) {
  const D = dest(); if (!D) return;
  if (mode === 'good') {
    const best = cheapestFull(D.id); if (best) state.design = { ...best.d };
  } else {
    const rng = mulberry32(Date.now() & 0xffffffff);
    for (const s of SLOTS) state.design[s.key] = s.list[Math.floor(rng() * s.list.length)].id;
  }
  save(); render();
}

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  const keepScroll = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };
  if (act === 'dest') {
    state.design.dest = el.dataset.id; save(); render();
  } else if (act === 'pick') {
    const before = showBudgets() ? margins() : null;
    state.design[el.dataset.slot] = el.dataset.id;
    ripple = computeRipple(before, showBudgets() ? margins() : null);
    save(); keepScroll();
  } else if (act === 'chart') {
    const k = el.dataset.k;
    state.open = state.open.includes(k) ? state.open.filter((x) => x !== k) : [...state.open, k];
    lastStatus = null; save(); keepScroll();
  } else if (act === 'next') {
    if (key() === 'dest' && DEBUG && !SLOTS.some((s) => state.design[s.key])) autoPick('random');
    go(Math.min(FLOW.length - 1, state.step + 1));
  } else if (act === 'back') { if (canGoBack()) go(Math.max(0, state.step - 1)); }
  else if (act === 'redesign') { state.attempt += 1; go(stepOf('payload')); }
  else if (act === 'newdest') { state.attempt += 1; go(stepOf('dest')); }
  else if (act === 'reset') {
    if (confirm('Start over as a new team? This clears all attempts.')) { state = fresh(); save(); render(); }
  } else if (act === 'dbg-random') autoPick('random');
  else if (act === 'dbg-good') autoPick('good');
});

// If the page was reloaded mid-launch, replay the launch for this attempt.
render();

// Expose for quick console checks.
if (DEBUG) window.__md = { state: () => state, budgets, simulate, allDesigns, buildCharts, LAUNCHERS };
