// Coupling: which design choices feed which budgets. This is the point of the demo.
// Every link here is a real dependency in model.js (budgets() / simulate()).

export const CHOICES = ['contract', 'power', 'thermal', 'comms', 'traj', 'engine', 'tank', 'launcher'];
export const CHOICE_LABEL = { contract: 'Instrument', power: 'Power', thermal: 'Thermal', comms: 'Antenna', traj: 'Route', engine: 'Engine', tank: 'Fuel', launcher: 'Rocket' };

// Budget keys match charts.js. The battery in the dark (eclipse) counts as Power.
export const BUDGETS = ['power', 'thermal', 'rad', 'data', 'mass', 'dv', 'cost', 'life', 'time'];
export const BUDGET_LABEL = { power: 'Power', thermal: 'Heat', rad: 'Radiation', data: 'Data', mass: 'Mass', dv: 'Fuel', cost: 'Cost', life: 'Part life', time: 'Schedule', night: 'Power' };

export const COUPLING = {
  contract: ['power', 'data', 'mass', 'cost', 'life'],
  power: ['power', 'thermal', 'mass', 'cost', 'life'],
  thermal: ['thermal', 'rad', 'power', 'mass', 'cost', 'life'],
  comms: ['data', 'power', 'mass', 'cost', 'life'],
  traj: ['time', 'cost', 'life', 'mass', 'dv', 'rad', 'thermal', 'power'],
  engine: ['dv', 'power', 'mass', 'life'],
  tank: ['dv', 'mass', 'cost'],
  launcher: ['mass', 'cost'],
};

const budgetKey = (k) => (k === 'night' ? 'power' : k);

// Two columns: your choices on the left, budgets on the right, a line for every dependency.
// failKey lights up the broken budget and every choice that feeds it.
export function couplingMap(d, partName, failKey) {
  const fail = failKey ? budgetKey(failKey) : null;
  const W = 340; const rowH = 34; const top = 4; const lx = 4; const lw = 132; const rx = 216; const rw = 120;
  const gridH = BUDGETS.length * rowH;
  const H = top + gridH;
  const ly = (i) => top + ((i + 0.5) * gridH) / CHOICES.length; // choice centers
  const ry = (j) => top + (j + 0.5) * rowH; // budget centers
  const g = [];
  const feeds = (c) => COUPLING[c].includes(fail);
  // lines: faint ones first, highlighted last so they sit on top
  for (const hot of [false, true]) {
    CHOICES.forEach((c, i) => {
      for (const b of COUPLING[c]) {
        const j = BUDGETS.indexOf(b); if (j < 0) continue;
        const isHot = fail === b;
        if (isHot !== hot) continue;
        g.push(`<line x1="${lx + lw}" y1="${ly(i)}" x2="${rx}" y2="${ry(j)}" class="cl ${isHot ? 'hot' : ''}"/>`);
      }
    });
  }
  CHOICES.forEach((c, i) => {
    const hot = fail && feeds(c);
    g.push(`<rect x="${lx}" y="${ly(i) - 14}" width="${lw}" height="28" rx="7" class="cn ${hot ? 'hot' : ''}"/>`);
    g.push(`<text x="${lx + 9}" y="${ly(i) - 1}" class="cn-t">${CHOICE_LABEL[c]}</text>`);
    g.push(`<text x="${lx + 9}" y="${ly(i) + 10}" class="cn-s">${partName(c)}</text>`);
  });
  BUDGETS.forEach((b, j) => {
    const hot = fail === b;
    g.push(`<rect x="${rx}" y="${ry(j) - 13}" width="${rw}" height="26" rx="7" class="bn ${hot ? 'hot' : ''}"/>`);
    g.push(`<text x="${rx + rw / 2}" y="${ry(j) + 5}" class="bn-t ${hot ? 'hot' : ''}" text-anchor="middle">${BUDGET_LABEL[b]}</text>`);
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="cmap" role="img" aria-label="Which choices feed which budgets">${g.join('')}</svg>`;
}
