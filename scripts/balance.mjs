// Balance test: sweeps a coarse grid over every slider and choice for every contract,
// using the same model code as the app, and checks the tuning targets.
// Run: npm run balance   (add --seeds to also sweep launch conditions for seeds 1..20)
import { CONTRACTS, DESTINATIONS, PARAMS, ENGINES, LAUNCHERS, STEPS } from '../src/data.js';
import { simulate, designGrid, NOMINAL, ESTIMATE, launchConditions, budgets, budgetMargins, par } from '../src/model.js';
import { interfaces, failRow } from '../src/syseng.js';
import { trade, decisions } from '../src/trades.js';
import { PAGES, challengeState } from '../src/pages.js';

const sweepSeeds = process.argv.includes('--seeds');
const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`;
const checks = [];
const check = (ok, msg) => { checks.push({ ok, msg }); };
const allFull = [];
const hazardSeen = {};

for (const C of CONTRACTS) {
  const D = DESTINATIONS.find((x) => x.id === C.dest);
  const designs = [...designGrid(C.id)];
  const results = designs.map((d) => ({ d, r: simulate(d, NOMINAL) }));
  const n = results.length;
  const full = results.filter((x) => x.r.outcome === 'full');
  const min = results.filter((x) => x.r.outcome === 'min');
  const modes = {};
  for (const x of results) if (x.r.failure) modes[x.r.failure.mode] = (modes[x.r.failure.mode] || 0) + 1;
  for (const x of full) allFull.push(x.d);

  console.log(`\n=== ${C.name} (${D.name}, x${D.mult}) - ${n} designs ===`);
  console.log(`Deadline ${C.deadline} yr, funding $${C.budget}M, goal ${C.goalGb} Gbit with ${C.payload}`);
  console.log(`Full success: ${full.length} (${pct(full.length, n)})   Minimum: ${min.length} (${pct(min.length, n)})`);
  console.log('Failure modes (first failure):');
  for (const [m, c] of Object.entries(modes).sort((a, b) => b[1] - a[1])) console.log(`  ${m.padEnd(10)} ${String(c).padStart(6)}  ${pct(c, n)}`);

  const keys = ['massMargin', 'dvMargin', 'powerMargin', 'dataMargin', 'thermalMargin', 'radMargin', 'costMargin', 'lifeMargin', 'timeMargin', 'flybyMargin', 'hazardMargin'];
  const passes = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const x of results) for (const k of keys) { const m = x.r.b[k]; if (m === 'na' || m >= 0) passes[k]++; }
  console.log('Each constraint alone passes: ' + keys.map((k) => `${k.replace('Margin', '')} ${pct(passes[k], n)}`).join(', '));

  const trajCount = { direct: 0, assist: 0 };
  for (const x of full) trajCount[x.d.traj]++;
  console.log(`Full-success trajectories: direct ${trajCount.direct}, assist ${trajCount.assist}`);

  // What the winners look like: how many distinct values of each knob appear.
  if (full.length) {
    const line = Object.keys(PARAMS).map((k) => {
      const vals = [...new Set(full.map((x) => x.d[k]))].sort((a, b) => a - b);
      return `${k} ${vals.join('/')}`;
    }).join(' | ');
    console.log('  ' + line);
    const eng = ENGINES.map((e) => `${e.id} ${full.filter((x) => x.d.engine === e.id).length}`).join(' ');
    const lau = LAUNCHERS.map((e) => `${e.id} ${full.filter((x) => x.d.launcher === e.id).length}`).join(' ');
    console.log(`  engines: ${eng} | launchers: ${lau}`);
    const best = full.slice().sort((a, b) => a.r.cost - b.r.cost)[0];
    console.log(`Cheapest full success: $${Math.round(best.r.cost)}M of $${C.budget}M`);
    console.log('  ' + JSON.stringify(best.d));
    const parMargin = (C.budget - par(C.id)) / C.budget;
    check(parMargin >= 0.1 && parMargin <= 0.14, `${C.name}: funding keeps par (${par(C.id)}M) at ${(parMargin * 100).toFixed(0)}% cost margin (want 10-14%)`);
    // Interfaces: every row a winner is checked on must be met.
    const rows = interfaces(best.d);
    const bad = rows.filter((r) => r.margin != null && r.margin < 0).map((r) => r.label);
    check(bad.length === 0, `${C.name}: cheapest winner meets every interface requirement${bad.length ? ` (fails ${bad.join(', ')})` : ` (${rows.length} rows)`}`);
    // Mini-challenges: the cheapest winner meets every subsystem page's challenge.
    const miss = PAGES.filter((p) => !challengeState(p, best.d).met).map((p) => p.key);
    check(miss.length === 0, `${C.name}: cheapest winner meets all ${PAGES.length} mini-challenges${miss.length ? ` (misses ${miss.join(', ')})` : ''}`);
  } else check(false, `${C.name}: has a full-success design`);

  // Mini-challenges are real tests: across designs each one lands in at least two different outcomes
  // (not met, met but over-built, met and lean), so choosing well always matters.
  const seen = Object.fromEntries(PAGES.map((p) => [p.key, new Set()]));
  for (let i = 0; i < designs.length; i += 61) for (const p of PAGES) { const s = challengeState(p, designs[i]); seen[p.key].add(s.met ? (s.lean ? 'lean' : 'over') : 'unmet'); }
  const oneSided = PAGES.filter((p) => seen[p.key].size < 2).map((p) => p.key);
  check(oneSided.length === 0, `${C.name}: every mini-challenge has at least two possible outcomes${oneSided.length ? ` (one-sided: ${oneSided.join(', ')})` : ''}`);

  // Trade studies: no option may be best on every criterion (or the choice is not a trade), and the
  // decision record must work for every design a team could reach.
  const dominant = [];
  for (const traj of ['direct', 'assist']) for (const s of STEPS) {
    const t = trade(s.key, { ...designs[0], traj });
    for (const o of t.options) if (t.criteria.every((c) => t.isBest(o, c))) dominant.push(`${s.key}:${o.id}`);
  }
  check(dominant.length === 0, `${C.name}: every choice is a real trade (${dominant.length ? 'dominant ' + dominant.join(', ') : 'no option best on every criterion'})`);
  let bad = 0; for (let i = 0; i < designs.length; i += 53) { try { decisions({ ...designs[i], why: {} }).forEach((x) => { if (!x.option || !(x.gaps.length >= 0)) bad++; }); } catch { bad++; } }
  check(bad === 0, `${C.name}: the decision record works for sampled designs (${bad} errors)`);

  // Interfaces: where a need is a sum of other leads' demands, the demands must add up to it,
  // and the row a failure is traced to must really be the one in deficit.
  let drift = 0; let traced = 0; let tracedOk = 0;
  for (let i = 0; i < designs.length; i += 97) {
    const d = designs[i]; const rows = interfaces(d);
    for (const label of ['Power', 'Heat', 'Lift', 'Cost']) {
      const r = rows.find((x) => x.label === label); if (!r) continue;
      const sum = r.sources.reduce((s, x) => s + x.v, 0);
      if (Math.abs(sum - r.need) > 0.01 * Math.max(1, r.need)) drift++;
    }
    const f = simulate(d, ESTIMATE).failure;
    const lab = f && !f.partial && f.mode !== 'night' && f.mode !== 'storm' && f.mode !== 'life' && f.mode !== 'deadline' ? failRow(f, budgets(d, ESTIMATE)) : null;
    const row = lab && rows.find((x) => x.label === lab);
    if (row && row.margin != null) { traced++; if (row.margin < 0) tracedOk++; }
  }
  check(drift === 0, `${C.name}: interface demands add up to the need (${drift} mismatches)`);
  check(traced === 0 || tracedOk / traced >= 0.98, `${C.name}: failures trace to the interface in deficit (${tracedOk}/${traced})`);

  // The bars show nominal margins (no mass growth, no event). Nobody should be able to make every
  // bar green, but a winning design should exist that runs only a little thin.
  const minMargin = (d) => Math.min(...Object.values(budgetMargins(budgets(d, ESTIMATE))).filter((m) => typeof m === 'number'));
  const allGreen = designs.filter((d) => minMargin(d) >= 0.15).length;
  const bestFull = full.length ? Math.max(...full.map((x) => minMargin(x.d))) : -1;
  console.log(`Best full-success design's thinnest nominal margin: ${(bestFull * 100).toFixed(1)}%`);
  check(allGreen === 0, `${C.name}: no design has every bar green (${allGreen} do)`);
  check(bestFull >= 0.05 && bestFull < 0.15, `${C.name}: best winning design runs ${(bestFull * 100).toFixed(1)}% thin (want 5-14%)`);

  if (sweepSeeds) {
    let s = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const c = launchConditions(seed, 1);
      s += designs.filter((d) => simulate(d, c).outcome === 'full').length;
    }
    console.log(`Seeds 1-20 avg full success: ${pct(s / 20, n)}`);
  }

  const fullRate = full.length / n;
  const hazardMode = { mercury: 'overheat', moon: 'night', mars: 'storm', europa: 'radiation', pluto: 'data' }[D.id];
  // Funding is tight on purpose, so random designs rarely win; teams iterate with the graphs instead.
  check(full.length >= 5 && fullRate <= 0.2, `${C.name}: ${full.length} winning designs (>=5), ${pct(full.length, n)} of all (<=20%)`);
  check(Object.keys(modes).length >= 3, `${C.name}: ${Object.keys(modes).length} failure modes reachable (>=3)`);
  hazardSeen[D.id] = hazardSeen[D.id] || !!modes[hazardMode];
  for (const key of ['direct', 'assist']) {
    const fast = D.traj[key].cruise <= C.deadline;
    if (fast) check(trajCount[key] > 0, `${C.name}: ${key} meets the ${C.deadline} yr deadline and has a winning design (${trajCount[key]})`);
    else check(!!modes.deadline, `${C.name}: ${key} (${D.traj[key].cruise} yr) misses the deadline and is catchable (deadline failures ${modes.deadline || 0})`);
  }
}

// The round-2 amendment: the amended contract is still winnable with par at ~12% cost margin,
// and the cheapest round-1 design no longer wins, so the team has to re-plan.
for (const C of CONTRACTS) {
  const p0 = par(C.id); const p1 = par(C.id, true);
  const budget = C.change.patch.budget ?? C.budget;
  let winners = 0; for (const d of designGrid(C.id, true)) if (simulate(d, NOMINAL).outcome === 'full') winners++;
  const first = [...designGrid(C.id)].map((d) => ({ d, r: simulate(d, NOMINAL) })).filter((x) => x.r.outcome === 'full').sort((a, b) => a.r.cost - b.r.cost)[0];
  const stillWins = simulate({ ...first.d, changed: true }, NOMINAL).outcome === 'full';
  check(winners >= 5, `${C.name} amended: ${winners} winning designs (>=5)`);
  check(p1 != null && (budget - p1) / budget >= 0.1 && (budget - p1) / budget <= 0.14, `${C.name} amended: par ${p1}M inside ${budget}M funding (want 10-14% margin)`);
  check(!stillWins, `${C.name} amended: the round-1 cheapest design no longer wins`);
}

// Each destination's unique hazard should be the first failure of at least one design there.
for (const D of DESTINATIONS) {
  const mode = { mercury: 'overheat', moon: 'night', mars: 'storm', europa: 'radiation', pluto: 'data' }[D.id];
  if (hazardSeen[D.id] !== undefined) check(hazardSeen[D.id], `${D.name}: unique hazard (${mode}) reachable`);
}

// No single choice in every successful design (across all contracts).
for (const [key, list] of [['engine', ENGINES.map((e) => e.id)], ['launcher', LAUNCHERS.map((e) => e.id)]]) {
  for (const id of list) {
    const c = allFull.filter((d) => d[key] === id).length;
    check(c < allFull.length, `${key} ${id} is not in every successful design (${c}/${allFull.length})`);
  }
}
for (const key of Object.keys(PARAMS)) {
  const vals = new Set(allFull.map((d) => d[key]));
  check(vals.size > 1, `${key} takes ${vals.size} different values among full successes`);
}

// Attempt-1 bailout: an over-budget design flies instead of being cancelled at program review.
{
  let d = null;
  for (const x of designGrid(CONTRACTS[0].id)) if (simulate(x, NOMINAL).failure?.mode === 'cost') { d = x; break; }
  const flown = simulate(d, { ...NOMINAL, bailout: true });
  check(flown.failure?.mode !== 'cost', `Bailout: over-budget design flies on attempt 1 (${flown.outcome}${flown.failure ? `, ${flown.failure.mode}` : ''})`);
}

console.log('\n=== Checks ===');
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.msg}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exitCode = failed ? 1 : 0;
