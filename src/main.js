import './style.css';
import { DESTINATIONS, SLOTS, FLYBYS, LAUNCHERS } from './data.js';
import {
  budgets, simulate, explain, marginColor, launchConditions, teamCode, ESTIMATE,
  isComplete, cheapestFull, allDesigns, mulberry32, launchCapacity, fmtYr, fmtGb,
} from './model.js';

// ---------- flags + state ----------
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const URL_SEED = params.has('seed') ? Math.abs(parseInt(params.get('seed'), 10)) || 1 : null;
const STORE = 'mission-design-v1';
const SCREENS = ['Destination', 'Payload', 'Spacecraft', 'Launch plan', 'Review', 'Launch'];

const blank = () => ({ dest: null, payload: null, power: null, thermal: null, comms: null, engine: null, tank: null, launcher: null, traj: null });
const fresh = () => ({ screen: 1, design: blank(), attempt: 1, seed: URL_SEED ?? 1000 + Math.floor(Math.random() * 9000), history: [] });

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (!s || !s.design) return null;
    if (URL_SEED != null && s.seed !== URL_SEED) return null;
    return s;
  } catch { return null; }
}
let state = load() || fresh();
let deltas = null; // last selection's effect on the live strip
let anim = null; // running launch animation handle
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode */ } };

const $app = document.getElementById('app');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const R = Math.round;
const signed = (x, unit = '', digits = 0) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}${unit}`;
const dest = () => DESTINATIONS.find((d) => d.id === state.design.dest);

// ---------- live strip ----------
function stripMetrics(d) {
  if (!d.dest) return null;
  const dd = { ...d, traj: d.traj || 'direct' };
  const b = budgets(dd, ESTIMATE);
  const m = {};
  m.mass = { label: 'Mass', v: b.wet, text: `${R(b.wet)} kg`, sub: b.cap != null ? `lift ${R(b.cap)}` : 'no launcher yet', state: b.cap == null ? 'none' : marginColor(b.massMargin), better: -1, unit: ' kg' };
  if (b.powerMargin != null) {
    let spare = b.supplyEnd - b.load;
    if (b.ionMargin != null) spare = Math.min(spare, b.supplyArrive - b.ionLoad);
    const pm = b.ionMargin != null ? Math.min(b.powerMargin, b.ionMargin) : b.powerMargin;
    m.power = { label: 'Power', v: spare, text: `${signed(spare)} W`, sub: 'spare at end', state: marginColor(pm), better: 1, unit: ' W' };
  } else m.power = { label: 'Power', v: null, text: '—', sub: 'pick power', state: 'none' };
  m.cost = { label: 'Cost', v: b.cost, text: `$${R(b.cost)}M`, sub: `of $${b.budget}M`, state: marginColor(b.costMargin), better: -1, unit: 'M', money: true };
  if (b.dvMargin != null) m.dv = { label: 'Delta-v', v: b.dvAvail - b.dvReq, text: `${signed(b.dvAvail - b.dvReq)}`, sub: 'm/s spare', state: marginColor(b.dvMargin), better: 1, unit: ' m/s' };
  else m.dv = { label: 'Delta-v', v: null, text: '—', sub: 'pick engine+tank', state: 'none' };
  if (b.dataMargin != null) { const p = (100 * b.returnable) / b.D.fullGb; m.data = { label: 'Data', v: p, text: `${p >= 999 ? '999+' : R(p)}%`, sub: 'of goal', state: marginColor(b.dataMargin), better: 1, unit: '%' }; }
  else m.data = { label: 'Data', v: null, text: '—', sub: 'pick payload+antenna', state: 'none' };
  m.years = { label: 'Duration', v: b.years, text: fmtYr(b.years), sub: d.traj ? b.tr.label : 'if Direct', state: 'neutral', better: 0, unit: ' yr', digits: 1 };
  return m;
}

function computeDeltas(before, after) {
  if (!before || !after) return null;
  const out = {};
  for (const k of Object.keys(after)) {
    const a = before[k]; const b = after[k];
    if (a && b && a.v != null && b.v != null) {
      const dlt = b.v - a.v;
      if (Math.abs(dlt) >= (b.digits ? 0.05 : 0.5)) out[k] = dlt;
    }
  }
  return out;
}

function stripHTML() {
  const m = stripMetrics(state.design); if (!m) return '';
  const cell = (k) => {
    const g = m[k]; const dl = deltas && deltas[k];
    let badge = '';
    if (dl != null) {
      const good = g.better === 0 ? 'neutral' : (dl * g.better > 0 ? 'good' : 'bad');
      const txt = g.money ? `${dl >= 0 ? '+' : '−'}$${Math.abs(dl).toFixed(0)}M` : `${signed(dl, '', g.digits || 0)}${g.unit}`;
      badge = `<span class="delta ${good}">${txt}</span>`;
    }
    return `<div class="gauge ${g.state}"><div class="g-top"><span class="g-label">${g.label}</span>${badge}</div><div class="g-val">${esc(g.text)}</div><div class="g-sub">${esc(g.sub)}</div></div>`;
  };
  return `<div class="strip">${['mass', 'power', 'cost', 'dv', 'data', 'years'].map(cell).join('')}</div>`;
}

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
      add('x sun max', p.hotLimit); add('krad shield', p.radTol); if (heat > 0) add(`W heater here`, R(heat));
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
  const list = slot.key === 'traj' ? slot.list.map((t) => ({ ...t, name: t.id === 'assist' ? `Assist: ${D.traj.assist.label}` : 'Direct', blurb: t.blurb })) : slot.list;
  return `<section class="slot"><div class="slot-head"><h2>${slot.label}</h2><span class="role">${slot.role}</span></div>
    <div class="opts">${list.map((p) => `
      <button class="opt ${cur === p.id ? 'sel' : ''}" data-act="pick" data-slot="${slot.key}" data-id="${p.id}">
        <div class="opt-name">${esc(p.name)}</div><div class="opt-blurb">${esc(p.blurb)}</div>
        <div class="stats">${statsFor(slot.key, p)}</div>
      </button>`).join('')}</div></section>`;
}

// ---------- screens ----------
function header() {
  const n = state.screen;
  return `<header class="top">
    <div class="brand">Mission Design${DEBUG ? ' <span class="dbg">DEBUG</span>' : ''}</div>
    <div class="meta"><span>Step ${n}/6 · ${SCREENS[n - 1]}</span><span class="attempt">Attempt ${state.attempt}</span></div>
    <div class="dots">${SCREENS.map((_, i) => `<i class="${i + 1 <= n ? 'on' : ''}"></i>`).join('')}</div>
  </header>`;
}

function nav(canNext, nextLabel = 'Next', back = true) {
  return `<nav class="bottom">
    ${back ? '<button class="btn ghost" data-act="back">Back</button>' : '<span></span>'}
    <button class="btn primary" data-act="next" ${canNext ? '' : 'disabled'}>${nextLabel}</button>
  </nav>`;
}

function debugBar() {
  if (!DEBUG || state.screen < 2 || state.screen > 4) return '';
  return `<div class="debugbar"><button class="btn small" data-act="dbg-random">Random design</button><button class="btn small" data-act="dbg-good">Cheapest full success</button><span>seed ${state.seed}</span></div>`;
}

function screen1() {
  const sel = state.design.dest;
  const cards = DESTINATIONS.map((D) => `
    <button class="dest ${sel === D.id ? 'sel' : ''}" data-act="dest" data-id="${D.id}">
      <div class="dest-top"><span class="planet" style="--c:${D.color}"></span>
        <div><div class="dest-name">${D.name}</div><div class="stars">${'★'.repeat(D.difficulty)}${'☆'.repeat(5 - D.difficulty)}</div></div>
        <span class="mult">×${D.mult} score</span></div>
      <div class="dest-goal">${esc(D.goal)}</div>
      <div class="kv"><span>Getting there</span><b>${D.dvLabel}</b></div>
      <div class="kv"><span>Temperature</span><b>${D.thermalLabel}</b></div>
      <div class="kv"><span>Budget</span><b>$${D.budget}M</b></div>
      <div class="hazard"><b>⚠ ${esc(D.hazard.name)}:</b> ${esc(D.hazard.text)}</div>
      <div class="goals"><div><span class="tier min">Minimum</span> ${esc(D.minGoal)}</div><div><span class="tier full">Full</span> ${esc(D.fullGoal)}</div></div>
    </button>`).join('');
  return `${header()}<main><h1>Where are we going?</h1><p class="lead">Whole team decides. Harder targets score more.</p>
    ${state.history.length ? historyHTML() : ''}<div class="dests">${cards}</div>
    <button class="link" data-act="reset">Start over (new team)</button></main>${nav(!!sel, 'Next', false)}`;
}

function screenBuild(n, title, lead) {
  const slots = SLOTS.filter((s) => s.screen === n);
  const done = slots.every((s) => state.design[s.key]);
  let extra = '';
  if (n === 4) extra = costBox();
  return `${header()}${stripHTML()}<main>${debugBar()}<h1>${title}</h1><p class="lead">${lead}</p>
    ${slots.map(optionsHTML).join('')}${extra}</main>${nav(done)}`;
}

function costBox() {
  const d = state.design; if (!d.traj || !d.launcher) return '';
  const b = budgets(d, ESTIMATE);
  const over = b.cost > b.budget;
  return `<section class="slot"><div class="slot-head"><h2>Budget check</h2><span class="role">Systems</span></div>
    <div class="costbox ${over ? 'red' : marginColor(b.costMargin)}">
      <div class="kv"><span>Spacecraft parts</span><b>$${R(b.partCost)}M</b></div>
      <div class="kv"><span>Launcher</span><b>$${b.launchCost}M</b></div>
      <div class="kv"><span>Mission ops ($${b.D.opsCostPerYr}M/yr × ${fmtYr(b.years)})</span><b>$${R(b.opsCost)}M</b></div>
      <div class="kv total"><span>Total vs budget $${b.budget}M</span><b>$${R(b.cost)}M</b></div>
      ${over ? `<div class="warn">Over budget by $${R(b.cost - b.budget)}M. You can't launch like this.</div>` : ''}
    </div></section>`;
}

const ROWS = [
  ['mass', 'Mass', 'massMargin'], ['power', 'Power', 'powerMargin'], ['dv', 'Delta-v', 'dvMargin'],
  ['data', 'Data', 'dataMargin'], ['thermal', 'Thermal', 'thermalMargin'], ['rad', 'Radiation', 'radMargin'],
  ['cost', 'Cost', 'costMargin'], ['life', 'Design life', 'lifeMargin'], ['flyby', 'Flyby hazard', 'flybyMargin'],
];

function reviewRows(b) {
  const D = b.D; const P = b.P;
  const pctm = (m) => `${m >= 0 ? '' : '−'}${Math.abs(R(m * 100))}%`;
  const txt = {
    mass: `${R(b.wet)} of ${R(b.cap)} kg`,
    power: `${R(b.supplyEnd)} W for ${R(b.load)} W load${b.ionMargin != null ? ` · ion ${R(b.supplyArrive)}/${R(b.ionLoad)} W` : ''}`,
    dv: `${R(b.dvAvail)} of ${R(b.dvReq)} m/s`,
    data: `${fmtGb(b.returnable)} of ${D.fullGb} Gbit`,
    thermal: `${b.hotFlux.toFixed(b.hotFlux < 0.1 ? 3 : 1)}x sun vs ${b.hotLimit}x limit`,
    rad: `${R(b.dose)} of ${b.radTol} krad`,
    cost: `$${R(b.cost)}M of $${b.budget}M`,
    life: b.weakest ? `${b.weakest.part.name}: ${b.weakest.part.life} yr vs ${fmtYr(b.weakest.need)}` : '',
    flyby: b.flybyMargin === 'na' ? 'No flyby' : b.tr.flyby === 'venus' ? `Venus: ${b.flybyFlux.toFixed(1)}x sun vs ${P.thermal.hotLimit}x` : `Jupiter: ${R(b.flybyDose)} of ${P.thermal.radTol} krad`,
  };
  const hz = { mercury: 'thermal', europa: 'rad', pluto: 'data' }[D.id];
  const rows = ROWS.map(([k, label, mk]) => {
    let m = b[mk];
    if (k === 'power' && b.ionMargin != null) m = Math.min(m, b.ionMargin);
    const c = marginColor(m);
    return { label: label + (hz === k ? ` <span class="hz">⚠ ${esc(D.hazard.name)}</span>` : ''), text: txt[k], c, m: m === 'na' ? '—' : pctm(m) };
  });
  if (D.id === 'moon') rows.push({ label: `<span class="hz">⚠ Lunar night</span>`, text: `${(b.nightNeedWh / 1000).toFixed(1)} kWh needed, battery ${(b.batteryWh / 1000).toFixed(1)}`, c: marginColor(b.hazardMargin), m: pctm(b.hazardMargin) });
  if (D.id === 'mars') rows.push({ label: `<span class="hz">⚠ Dust storm</span>`, text: `${R(b.stormSupply)} W in storm, need ${R(b.stormLoad)} W`, c: marginColor(b.hazardMargin), m: pctm(b.hazardMargin) });
  return rows;
}

function screen5() {
  const d = state.design;
  if (!isComplete(d)) return `${header()}<main><h1>Design review</h1><p>Some parts are missing.</p></main>${nav(false)}`;
  const b = budgets(d, ESTIMATE);
  const rows = reviewRows(b);
  const reds = rows.filter((r) => r.c === 'red').length; const yellows = rows.filter((r) => r.c === 'yellow').length;
  const over = b.cost > b.budget;
  return `${header()}<main><h1>Design review</h1><p class="lead">Systems reads it out. Green ≥ 15% margin, yellow is thin, red is broken.</p>
    <table class="review"><tbody>${rows.map((r) => `<tr class="${r.c}"><td class="dot"><i></i></td><td><div class="r-label">${r.label}</div><div class="r-text">${esc(r.text)}</div></td><td class="r-m">${r.m}</td></tr>`).join('')}</tbody></table>
    <div class="summary">${reds ? `<b class="red-t">${reds} red</b> · ` : ''}${yellows ? `<b class="yellow-t">${yellows} yellow</b> · ` : ''}Mission ${fmtYr(b.years)} · ${esc(b.tr.label)}</div>
    <p class="note">Real hardware always comes out a little different than the estimate. Margins matter.</p>
    ${over ? `<div class="warn">Launch blocked: over budget by $${R(b.cost - b.budget)}M.</div>` : ''}
  </main>${nav(!over, '🚀 Launch')}`;
}

function historyHTML() {
  return `<div class="history"><b>Past attempts</b>${state.history.map((h) => `<div class="h-row"><span>#${h.attempt} ${esc(h.dest)}</span><span class="tier ${h.outcome}">${tierName(h.outcome)}</span><span>${h.score} pts</span><span class="code">${h.code}</span></div>`).join('')}</div>`;
}
const tierName = (o) => ({ none: 'No mission', min: 'Minimum', full: 'Full success' }[o]);

// ---------- launch screen ----------
function screen6() {
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
  beats.push({ ms: P.lift * 0.85, cls: f && f.mode === 'launcher' ? 'fail' : 'ok', text: f && f.mode === 'launcher' ? f.text : `Liftoff on ${b.P.launcher.name}. ${R(b.wet)} kg away.`, fail: f && f.mode === 'launcher' });
  for (const e of res.events) {
    const phase = e.kind === 'arrival' ? 'arrival' : e.t < cruise ? 'cruise' : 'ops';
    if (e.kind === 'arrival') continue;
    beats.push({ ms: tOf(e.t, phase), cls: e.kind === 'random' ? 'info' : 'warn', text: `${e.kind === 'random' ? 'Event' : e.kind === 'flyby' ? 'Flyby' : 'Hazard'}: ${e.text}`, t: e.t });
  }
  if (!f || f.partial || f.t >= cruise && f.phase === 'ops') beats.push({ ms: tOf(cruise, 'arrival'), cls: 'ok', text: `Arrival burn: ${R(b.dvAvail)} of ${R(b.dvReq)} m/s. In position at ${b.D.name}.` });
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
    document.getElementById('phase').textContent = ['Liftoff', 'Cruise', 'Arrival burn', 'Operations'][ph];
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
  if (state.screen !== 6 || !document.getElementById('result')) return;
  const d = state.design; const D = res.b.D;
  const code = teamCode(d, state.seed, state.attempt);
  if (!state.history.find((h) => h.attempt === state.attempt)) {
    state.history.push({ attempt: state.attempt, dest: D.name, outcome: res.outcome, score: res.score, code, cost: R(res.cost) });
    save();
  }
  const chains = explain(d, res);
  const f = res.failure;
  const closest = !f ? closestCall(res.b) : null;
  const ev = res.opts.event;
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
      <p class="a-sub">Root cause, traced back to your choices:</p>
      ${chains.map((c) => `<ol class="chain">${c.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`).join('')}
      </section>` : `<section class="anomaly good"><h2>Mission report</h2><p>Every constraint held. ${closest ? `Closest call: <b>${closest}</b>.` : ''}</p></section>`}
    ${ev ? `<p class="note">Random event this launch: ${esc(ev.text)}</p>` : ''}
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
  const n = state.screen;
  let html = '';
  if (n === 1) html = screen1();
  else if (n === 2) html = screenBuild(2, 'Pick the science', 'Science picks the instrument. It sets data, power, mass, and cost.');
  else if (n === 3) html = screenBuild(3, 'Spacecraft bus', 'Power & Thermal, Comms & Data, and Propulsion each pick their parts. Watch the strip.');
  else if (n === 4) html = screenBuild(4, 'Launch plan', 'Systems picks the rocket and the route, and checks the budget.');
  else if (n === 5) html = screen5();
  else html = screen6();
  $app.innerHTML = html;
  if (n === 6) startLaunch();
}

function go(n) { state.screen = n; deltas = null; save(); render(); window.scrollTo(0, 0); }

function autoPick(mode) {
  const D = dest(); if (!D) return;
  if (mode === 'good') {
    const best = cheapestFull(D.id); if (best) state.design = { ...best.d };
  } else {
    const rng = mulberry32(Date.now() & 0xffffffff);
    for (const s of SLOTS) state.design[s.key] = s.list[Math.floor(rng() * s.list.length)].id;
  }
  deltas = null; save(); render();
}

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  if (act === 'dest') {
    state.design.dest = el.dataset.id; save(); render();
  } else if (act === 'pick') {
    const before = stripMetrics(state.design);
    state.design[el.dataset.slot] = el.dataset.id;
    deltas = computeDeltas(before, stripMetrics(state.design));
    save();
    const y = window.scrollY; render(); window.scrollTo(0, y);
  } else if (act === 'next') {
    if (state.screen === 1 && DEBUG && !SLOTS.some((s) => state.design[s.key])) { autoPick('random'); }
    go(Math.min(6, state.screen + 1));
  } else if (act === 'back') go(Math.max(1, state.screen - 1));
  else if (act === 'redesign') { state.attempt += 1; go(2); }
  else if (act === 'newdest') { state.attempt += 1; go(1); }
  else if (act === 'reset') {
    if (confirm('Start over as a new team? This clears all attempts.')) { state = fresh(); deltas = null; save(); render(); }
  } else if (act === 'dbg-random') autoPick('random');
  else if (act === 'dbg-good') autoPick('good');
});

// If the page was reloaded mid-launch, replay the launch for this attempt.
render();

// Expose for quick console checks.
if (DEBUG) window.__md = { state: () => state, budgets, simulate, allDesigns, LAUNCHERS };
