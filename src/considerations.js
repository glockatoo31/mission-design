// The design consideration shown at the top of each choice screen.
// Written for engineering freshmen: one paragraph of general physics, then
// what is special about the chosen destination, then the question to argue about.
import { FLYBYS, POWER, ENGINES, PAYLOADS } from './data.js';
import { fmtYr } from './model.js';

const solarFactor = (D) => Math.min(1 / (D.sunAU * D.sunAU), D.solarCap);
const rawSun = (D) => 1 / (D.sunAU * D.sunAU);
const pct = (x) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x >= 0.01 ? `${(x * 100).toFixed(1)}%` : `${(x * 100).toFixed(2)}%`);
const watts = (w) => (w >= 10 ? `${Math.round(w)} W` : w >= 1 ? `${w.toFixed(1)} W` : `${w.toFixed(2)} W`);
const energy = (c3) => (c3 > 30 ? 'high' : c3 > 10 ? 'medium' : 'low');

export function consideration(slot, D, d) {
  const tr = d.traj ? D.traj[d.traj] : null;
  const f = BUILDERS[slot];
  return f ? f(D, d, tr) : null;
}

const BUILDERS = {
  payload(D) {
    const here = [`Goal: ${D.fullGoal}`, `You get about ${fmtYr(D.opsYears)} of operations at ${D.name} to do it.`];
    here.push({
      mercury: 'That is a lot of data, but Mercury is close enough to Earth to send plenty home.',
      moon: 'The Moon is right next door, so sending data home is easy. Surviving the 14-day lunar night is the hard part, and every watt your instrument draws makes it harder.',
      mars: 'Mars is the friendliest target. But a global dust storm will dim the Sun, and a power-hungry instrument makes that harder to survive.',
      europa: 'Jupiter\'s radiation will eventually kill your electronics, so you need to collect data fast enough to beat the clock.',
      pluto: 'Collecting data at Pluto is easy. Getting it home from 33 AU is the hard part: the radio link, not the camera, is the bottleneck.',
    }[D.id]);
    return {
      title: `Science for ${D.name}`,
      why: 'The instrument is the reason you are going. Bigger instruments collect more data, but every kilogram and every watt they need has to be supplied by the rest of the spacecraft.',
      here,
      ask: 'How much instrument do you really need, and can the rest of the spacecraft carry it?',
    };
  },

  power(D) {
    const small = POWER.find((p) => p.id === 'ssolar');
    const here = [];
    if (rawSun(D) > 1.5) {
      here.push(`${D.name} is ${D.sunAU} AU from the Sun. Sunlight there is about ${rawSun(D).toFixed(1)}x Earth's, so hot that arrays must be tilted away and only use about ${D.solarCap}x. They also wear out fast (${Math.round(D.solarDeg * 100)}% per year).`);
    } else if (D.sunAU === 1) {
      here.push('The Moon gets the same sunlight as Earth, when the Sun is up.');
    } else {
      here.push(`${D.name} is ${D.sunAU} AU from the Sun. Sunlight there is ${pct(solarFactor(D))} of what it is at Earth.`);
    }
    here.push(`${small.name} that make ${small.outW} W at Earth would make about ${watts(small.outW * solarFactor(D))} at ${D.name}.`);
    if (D.id === 'moon') here.push('Lunar night lasts 14 days with no sun at all. Batteries (or an RTG) must keep the spacecraft alive until morning.');
    if (D.id === 'mars') here.push('A global dust storm will cut sunlight by 80% for weeks. You have to survive it.');
    if (D.coldW >= 60) here.push(`It is cold at ${D.name}, so heaters will add to the power you need.`);
    here.push(`The mission lasts years. What counts is the power you still have at the end, at ${D.name}.`);
    return {
      title: `Power at ${D.name}`,
      why: 'Every part of the spacecraft runs on electricity. Solar arrays are light and cheap, but sunlight weakens with distance squared: twice as far from the Sun means one quarter the power. An RTG (a nuclear battery) makes steady power anywhere, but it is heavy, expensive, and its waste heat warms the spacecraft. Every power source slowly wears down.',
      here,
      ask: `Will you still have enough power at the end of the mission, at ${D.name}, in the worst conditions?`,
    };
  },

  thermal(D, d) {
    const here = [{
      mercury: `At Mercury the Sun is ${D.hotFlux}x stronger than at Earth. Most protection cannot get rid of that much heat.`,
      moon: 'The lunar surface swings from about +120 C in the day to -170 C at night. You need to handle both.',
      mars: 'Mars is cold but mild. Heaters will need some power, but nothing extreme.',
      europa: `Jupiter's radiation belts deliver about ${D.opsDosePerYr} krad per year of operations. Unshielded electronics do not last long there.`,
      pluto: 'At -230 C, heaters work hard. An RTG\'s waste heat can help keep the spacecraft warm.',
    }[D.id]];
    here.push(`Space radiation also builds up during the ${D.id === 'moon' ? 'trip' : 'long trip'} (about ${D.cruiseDosePerYr} krad per year of cruise).`);
    const fb = D.traj.assist.flyby;
    if (fb === 'venus') here.push(`One route to ${D.name} swings past Venus, where sunlight is about ${FLYBYS.venus.flux}x Earth's.`);
    if (fb === 'jupiter') here.push(`One route to ${D.name} flies past Jupiter and its radiation belts (+${FLYBYS.jupiter.dose} krad in a day).`);
    if (d.power === 'rtg') here.push('You picked an RTG. It runs warm: it adds heat (bad where it is hot) but cuts the heater power you need (good where it is cold).');
    return {
      title: `Heat, cold, and radiation at ${D.name}`,
      why: 'Electronics need to stay near room temperature. Too much sunlight cooks them; too little freezes them unless heaters keep them warm, and heaters cost power. The same enclosure also shields the electronics from radiation, which adds up over time like a dose.',
      here,
      ask: `Hot, cold, or radiation: which one is the real threat at ${D.name}?`,
    };
  },

  comms(D, d) {
    const here = [];
    if (D.earthAU < 0.5) here.push('The Moon is very close to Earth, so even a small antenna works well.');
    else here.push(`${D.name} is about ${D.earthAU} AU from Earth (1 AU is the Earth-Sun distance). The signal arrives ${D.earthAU >= 2 ? `about ${Math.round(D.earthAU * D.earthAU)}x` : 'a bit'} weaker than from 1 AU.`);
    here.push(`Earth's big ground antennas can listen to you about ${Math.round(D.contact * 100)}% of the time. They are shared with other missions.`);
    if (d.payload) {
      const p = PAYLOADS.find((x) => x.id === d.payload).genGb;
      here.push(`Your instrument makes about ${p} Gbit per year. Whatever you cannot send home stays stuck on board.`);
    }
    return {
      title: `Talking to Earth from ${D.name}`,
      why: 'Science only counts once it reaches Earth. A radio signal spreads out, so it gets weaker with distance squared. A bigger dish focuses the signal and sends data much faster, but it is heavier, costs more, and needs more power.',
      here,
      ask: 'Can you send data home as fast as your instrument collects it?',
    };
  },

  traj(D) {
    const dir = D.traj.direct; const as = D.traj.assist;
    const here = [
      `Direct: ${fmtYr(dir.cruise)} trip, ${energy(dir.c3)} launch energy, ${dir.dv} m/s burn on arrival.`,
      `Assist (${as.label}): ${fmtYr(as.cruise)} trip, ${energy(as.c3)} launch energy, ${as.dv} m/s burn on arrival.`,
    ];
    if (as.flyby === 'venus') here.push('The Venus flybys put you in sunlight about 2x Earth\'s. Your thermal protection has to take it.');
    if (as.flyby === 'jupiter') here.push(`The Jupiter flyby adds ${FLYBYS.jupiter.dose} krad of radiation in a single day.`);
    here.push(`The mission team costs $${D.opsCostPerYr}M per year, from launch to the end of the mission. A longer trip costs more, and every part has to last longer.`);
    return {
      title: `Route to ${D.name}`,
      why: 'There are two ways to get there. Direct is fast but needs a lot of launch energy, which means a bigger rocket. A gravity assist steals speed from a planet flyby, so a smaller rocket works, but the trip takes longer.',
      here,
      ask: 'Is the time you save worth the bigger rocket?',
    };
  },

  engine(D, d, tr) {
    const ion = ENGINES.find((e) => e.lowThrust);
    const here = [];
    if (tr) here.push(D.id === 'pluto'
      ? `Pluto is a flyby, so you only need course corrections (${tr.dv} m/s). But the engine has to survive a ${fmtYr(tr.cruise)} trip.`
      : `Your route needs a ${tr.dv} m/s burn when you arrive at ${D.name}, after a ${fmtYr(tr.cruise)} trip. The engine has to still work then.`);
    if (D.lowThrustPenalty >= 10) here.push('You are landing on the Moon. An ion engine pushes far too gently to land.');
    else if (D.lowThrustPenalty > 1) here.push(`Ion engines push gently, so slowing down at ${D.name} takes about ${D.lowThrustPenalty}x more delta-v.`);
    here.push(`An ion engine needs ${ion.powerW} W to run, on top of everything else, at ${D.name}.`);
    return {
      title: `Engine for ${D.name}`,
      why: 'When you arrive you have to fire an engine to slow down into orbit (or to land). An engine\'s efficiency, its Isp, sets how much speed change (delta-v) you get from each kilogram of fuel. Ion engines are about 10x more efficient, but push very gently, need a lot of electrical power, and wear out sooner.',
      here,
      ask: 'Efficiency, power, or reliability: what matters most for your burn?',
    };
  },

  tank(D, d, tr) {
    const here = [];
    if (tr) here.push(`Your arrival burn is ${tr.dv} m/s${d.engine === 'ion' && D.lowThrustPenalty > 1 ? ` (x${D.lowThrustPenalty} for a low-thrust ion engine)` : ''}.`);
    here.push('Every part you picked so far has mass. The heavier the dry spacecraft, the more fuel the same burn takes.');
    here.push('Real hardware almost always comes out heavier than the estimate.');
    return {
      title: 'Propellant',
      why: 'More propellant gives more delta-v, but propellant is mass, and the rocket has to lift it. The rocket equation is unforgiving: doubling the fuel does not double your delta-v, because early in the burn you are also pushing the fuel you have not burned yet.',
      here,
      ask: 'Enough fuel to make the burn, but not so much that the rocket cannot lift it?',
    };
  },

  launcher(D, d, tr) {
    const here = [];
    if (tr) here.push(`Your route (${d.traj === 'assist' ? tr.label : 'Direct'}) needs ${energy(tr.c3)} launch energy.`);
    here.push(`Your total budget for ${D.name} is $${D.budget}M. It has to pay for the parts, the rocket, and the team for the whole ${tr ? fmtYr(tr.cruise + D.opsYears) : ''} mission.`);
    here.push('Real hardware usually comes out a little heavier than planned. Leave some room.');
    return {
      title: 'Launch vehicle',
      why: 'The rocket has to lift your fully fueled spacecraft and throw it fast enough to follow your route. The more launch energy your route needs, the less mass any rocket can carry. The rocket is often the biggest single bill on a mission.',
      here,
      ask: 'Which rocket can lift your spacecraft without blowing the budget?',
    };
  },
};
