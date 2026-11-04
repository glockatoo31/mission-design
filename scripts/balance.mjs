// Balance test: enumerates every design for every destination using the same
// model code as the app, and checks the tuning targets from the design brief.
// Run: npm run balance   (add --seeds to also sweep launch conditions for seeds 1..20)
import { DESTINATIONS, SLOTS } from '../src/data.js';
import { simulate, allDesigns, NOMINAL, launchConditions } from '../src/model.js';

const sweepSeeds = process.argv.includes('--seeds');
const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`;
const checks = [];
const check = (ok, msg) => { checks.push({ ok, msg }); };

const optionLabel = (key, id) => SLOTS.find((s) => s.key === key).list.find((p) => p.id === id).name;

for (const D of DESTINATIONS) {
  const designs = [...allDesigns(D.id)];
  const results = designs.map((d) => ({ d, r: simulate(d, NOMINAL) }));
  const n = results.length;
  const full = results.filter((x) => x.r.outcome === 'full');
  const min = results.filter((x) => x.r.outcome === 'min');
  const modes = {};
  for (const x of results) if (x.r.failure) modes[x.r.failure.mode] = (modes[x.r.failure.mode] || 0) + 1;

  console.log(`\n=== ${D.name} (x${D.mult}) - ${n} designs ===`);
  console.log(`Full success: ${full.length} (${pct(full.length, n)})   Minimum: ${min.length} (${pct(min.length, n)})   Any success: ${pct(full.length + min.length, n)}`);
  console.log('Failure modes (first failure):');
  for (const [m, c] of Object.entries(modes).sort((a, b) => b[1] - a[1])) console.log(`  ${m.padEnd(10)} ${String(c).padStart(5)}  ${pct(c, n)}`);

  // How often each constraint passes on its own (helps tuning data.js).
  const keys = ['massMargin', 'dvMargin', 'powerMargin', 'dataMargin', 'thermalMargin', 'radMargin', 'costMargin', 'lifeMargin', 'flybyMargin', 'hazardMargin'];
  const passes = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const x of results) for (const k of keys) { const m = x.r.b[k]; if (m === 'na' || m >= 0) passes[k]++; }
  console.log('Each constraint alone passes: ' + keys.map((k) => `${k.replace('Margin', '')} ${pct(passes[k], n)}`).join(', '));

  const trajCount = { direct: 0, assist: 0 };
  for (const x of full) trajCount[x.d.traj]++;
  console.log(`Full-success trajectories: direct ${trajCount.direct}, assist ${trajCount.assist}`);

  // Option frequency among full successes
  const always = [];
  for (const s of SLOTS) {
    const counts = {};
    for (const x of full) counts[x.d[s.key]] = (counts[x.d[s.key]] || 0) + 1;
    const line = s.list.map((p) => `${p.name} ${counts[p.id] || 0}`).join(' | ');
    console.log(`  ${s.key.padEnd(8)} ${line}`);
    for (const p of s.list) if (full.length && counts[p.id] === full.length) always.push(`${s.key}=${p.name}`);
  }

  // Cheapest full success
  const best = full.slice().sort((a, b) => a.r.cost - b.r.cost)[0];
  if (best) {
    console.log(`Cheapest full success: $${Math.round(best.r.cost)}M of $${D.budget}M`);
    console.log('  ' + SLOTS.map((s) => optionLabel(s.key, best.d[s.key])).join(', '));
  }

  // Redesign distance: from each failed design, fewest slot changes to reach a full success.
  const fullKeys = full.map((x) => x.d);
  let distSum = 0; let distN = 0; const hist = {};
  for (let i = 0; i < results.length; i += 7) {
    const x = results[i]; if (x.r.outcome === 'full') continue;
    let best2 = 99;
    for (const f of fullKeys) {
      let k = 0; for (const s of SLOTS) if (f[s.key] !== x.d[s.key]) k++;
      if (k < best2) best2 = k;
    }
    distSum += best2; distN++; hist[best2] = (hist[best2] || 0) + 1;
  }
  const avgDist = distSum / Math.max(1, distN);
  console.log(`Avg changes from a failed design to nearest full success: ${avgDist.toFixed(2)}  (hist ${JSON.stringify(hist)})`);

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
  check(fullRate >= 0.05 && fullRate <= 0.15, `${D.name}: full success ${pct(full.length, n)} in 5-15%`);
  check(Object.keys(modes).length >= 3, `${D.name}: ${Object.keys(modes).length} failure modes reachable (>=3)`);
  check(!!modes[hazardMode], `${D.name}: unique hazard (${hazardMode}) reachable`);
  check(trajCount.direct > 0 && trajCount.assist > 0, `${D.name}: both Direct and Assist succeed (${trajCount.direct}/${trajCount.assist})`);
  check(avgDist <= 3.5, `${D.name}: avg redesign distance ${avgDist.toFixed(2)} slot changes (<=3.5)`);
  if (always.length) console.log(`  Forced at this destination: ${always.join(', ')}`);
}

// No single option in every successful design (across all destinations).
const allFull = [];
for (const D of DESTINATIONS) for (const d of allDesigns(D.id)) if (simulate(d, NOMINAL).outcome === 'full') allFull.push(d);
for (const s of SLOTS) for (const p of s.list) {
  const c = allFull.filter((d) => d[s.key] === p.id).length;
  if (c === allFull.length) check(false, `Option ${p.name} appears in every successful design`);
}
check(true, `Checked ${allFull.length} full-success designs for always-present options`);

console.log('\n=== Checks ===');
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.msg}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exitCode = failed ? 1 : 0;
