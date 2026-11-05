// Mission Design sprites. Build: node <pxl>/bin/pxl.js build art/art.px.js --out art/out --no-preview
// Then copy art/out/sprites/*.png to src/art/. Palette = sweetie16, same hexes as src/style.css.
use("sweetie16")
pal({ k: 0, r: 2, o: 3, y: 4, g: 6, n: 8, b: 9, a: 10, c: 11, w: 12, l: 13, s: 14, d: 15 })

// ---- planets: 24x24, lit top-left, one terminator crescent, a few features ----
const R = 11, C = 12
function planet(name, base, dark, ...feat) {
  sprite(name, { w: 24, h: 24 },
    circ(C, C, R, dark),
    clip([C, C, R], circ(C - 2, C - 2, R - 1, base)),
    clip([C, C, R], ...feat))
}
planet("planet_mercury", "l", "s", ring(8, 9, 2, "s"), ring(15, 14, 3, "s"), px(6, 15, "s"), px(14, 6, "s"))
planet("planet_moon", "w", "l", ring(8, 8, 2, "l"), ring(14, 12, 3, "l"), ring(10, 16, 1, "l"), px(16, 6, "l"))
planet("planet_mars", "o", "r", ellipse(12, 6, 4, 1, "w"), rect(5, 12, 5, 2, "r"), rect(11, 15, 6, 2, "r"), px(15, 10, "r"))
planet("planet_europa", "w", "a", line(3, 9, 12, 14, "a"), line(10, 4, 18, 16, "l"), line(6, 17, 16, 12, "l"), px(8, 8, "a"))
planet("planet_pluto", "y", "o", circ(10, 14, 3, "w"), circ(13, 13, 3, "w"), rect(4, 5, 5, 2, "o"), px(17, 7, "o"))
planet("planet_earth", "a", "b", rect(5, 7, 6, 4, "g"), rect(8, 11, 3, 5, "g"), rect(14, 12, 5, 3, "g"), rect(12, 4, 3, 2, "w"), px(17, 7, "g"))

// ---- rockets: left half incl. center column, mirrored + outlined ----
// nose, body (band + window), fin/engine block. hw = columns in the half.
function rocketRows(hw, bodyH, win = true) {
  const rows = []
  const nose = hw * 2
  for (let i = 0; i < nose; i++) { const f = Math.max(1, Math.round(((i + 1) * hw) / nose)); rows.push(".".repeat(hw - f) + (i < 2 ? "r" : "w").repeat(f).replace(/^w/, i > 2 ? "l" : "w")) }
  for (let i = 0; i < bodyH; i++) {
    let row = "." + "l" + "w".repeat(hw - 2)
    if (i % 9 === 8) row = "." + "l" + "r".repeat(hw - 2)
    if (win && i === 3) row = "." + "l" + "w".repeat(hw - 4) + "aa"
    rows.push(row.slice(0, hw))
  }
  for (let i = 0; i < 6; i++) rows.push(i < 4 ? "r" + "l".repeat(hw - 1) : "r" + "s".repeat(hw - 1))
  rows.push(".".repeat(hw - 2) + "ss", ".".repeat(hw - 2) + "ss")
  return rows
}
const rk = (hw, h) => rocketRows(hw, h).join("\n")
sprite("rocket_light", { mx: "c", outline: "k" }, rk(4, 14))
sprite("rocket_f9", { mx: "c", outline: "k" }, rk(5, 17))
sprite("rocket_medium", { mx: "c", outline: "k" }, rk(6, 20))
{
  // heavy: a core plus two side boosters (3 cols, drawn on the left, mirrored)
  const core = rocketRows(5, 22)
  const boost = ["..r", ".rw", ".lw", ".lw", "llw", "llw"]
  while (boost.length < core.length - 8) boost.push("llw")
  boost.push("rrr", "lll", "lll", "sss", ".ss")
  const off = core.length - boost.length
  const rows = core.map((r, i) => { const b = i >= off ? boost[i - off] : "..."; return b + r })
  sprite("rocket_heavy", { mx: "c", outline: "k" }, rows.join("\n"))
}

// ---- stars: seamless 64x64 tile, hand-placed by a fixed LCG ----
sprite("stars", { w: 64, h: 64 }, (c) => {
  let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(rnd() * 64), y = Math.floor(rnd() * 64), t = rnd()
    c.px(x, y, t > 0.85 ? "w" : t > 0.5 ? "d" : "s")
    if (t > 0.94) { c.px(x + 1, y, "d"); c.px(x - 1, y, "d"); c.px(x, y + 1, "d"); c.px(x, y - 1, "d") }
  }
})
