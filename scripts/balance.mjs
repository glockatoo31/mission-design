// Balance test: sweeps a coarse grid over every slider and choice for every contract,
// using the same model code as the app, and checks the tuning targets.
// Run: npm run balance   (add --seeds to also sweep launch conditions for seeds 1..20)
import { CONTRACTS, DESTINATIONS, PARAMS, ENGINES, LAUNCHERS } from '../src/data.js';
import { simulate, designGrid, NOMINAL, launchConditions } from '../src/model.js';

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
  }

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
  check(fullRate >= 0.01 && fullRate <= 0.2, `${C.name}: full success ${pct(full.length, n)} in 1-20%`);
  check(Object.keys(modes).length >= 3, `${C.name}: ${Object.keys(modes).length} failure modes reachable (>=3)`);
  hazardSeen[D.id] = hazardSeen[D.id] || !!modes[hazardMode];
  for (const key of ['direct', 'assist']) {
    const fast = D.traj[key].cruise <= C.deadline;
    if (fast) check(trajCount[key] > 0, `${C.name}: ${key} meets the ${C.deadline} yr deadline and has a winning design (${trajCount[key]})`);
    else check(!!modes.deadline, `${C.name}: ${key} (${D.traj[key].cruise} yr) misses the deadline and is catchable (deadline failures ${modes.deadline || 0})`);
  }
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

console.log('\n=== Checks ===');
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.msg}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exitCode = failed ? 1 : 0;
