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
planet("planet_mars", "o", "r", ellipse(12, 6, 4, 1, "w"), rect(5, 12, 5, 2, "r"), rect(11, 15, 6, 2, "r"), px(15, 10, "r"))
planet("planet_europa", "w", "a", line(3, 9, 12, 14, "a"), line(10, 4, 18, 16, "l"), line(6, 17, 16, 12, "l"), px(8, 8, "a"))
planet("planet_pluto", "y", "o", circ(10, 14, 3, "w"), circ(13, 13, 3, "w"), rect(4, 5, 5, 2, "o"), px(17, 7, "o"))
planet("planet_earth", "a", "b", rect(5, 7, 6, 4, "g"), rect(8, 11, 3, 5, "g"), rect(14, 12, 5, 3, "g"), rect(12, 4, 3, 2, "w"), px(17, 7, "g"))

// ---- rockets, modelled on the real vehicles. Left half incl. the center column, mirrored + outlined. ----
const rep = (row, n) => Array(n).fill(row)
const pad = (s, hw) => s.padStart(hw, ".")

// Electron: slim, all black carbon-fibre, two stages, a thin light band and a small fairing.
sprite("rocket_light", { mx: "c", outline: "k" }, [
  "..l", ".ds", ".ds", ".dd",              // fairing ogive
  ...rep(".dd", 5), "lss",                  // payload section, stage break
  ...rep(".dd", 12), "ldd", ...rep(".dd", 6), // first stage
  "dss", ".ss", ".ss",                       // Rutherford engine bells
].join("\n"))

// Falcon 9: white, black interstage, grid fins near the top of stage 1, four landing legs.
sprite("rocket_f9", { mx: "c", outline: "k" }, [
  ".....w", "....ww", "...www",              // fairing
  ...rep("...lww", 6),                       // second stage
  "..dddd", "..dddd",                        // black interstage
  ".dlwww",                                  // grid fin
  ...rep("..lwww", 12),                      // first stage
  ".dlwww", ".dlwww", "d.lwww", "d.lwww",   // landing legs
  "dd.sss", "...sss",
].join("\n"))

// Ares I: a tall, thin stack: launch-abort needle, Orion capsule, J-2X upper stage, five-segment solid booster.
sprite("rocket_medium", { mx: "c", outline: "k" }, [
  ...rep("..l", 5),                          // launch abort tower
  "..w", ".ww", ".ww",                        // Orion capsule
  ...rep("lww", 7), "ooo",                    // upper stage + orange band
  "ddd", "ddd",                               // interstage
  ...[0, 1, 2, 3, 4].flatMap(() => [...rep("lww", 5), "ddd"]), // five booster segments with black joints
  ".ss", ".ss",                               // nozzle
].join("\n"))

// Falcon Heavy: a fairing-topped center core between two nose-coned side boosters (black interstage bands).
{
  const center = [
    "..w", ".ww", "lww", ...rep("lww", 8), "ddd", "ddd", ...rep("lww", 30), "sss", ".ss",
  ]
  const booster = [
    "..w..", ".wwl.", ...rep("lwwww", 3), "ddddd", ...rep("lwwww", 20), "sssss",
  ]
  const off = center.length - booster.length
  const rows = center.map((c, i) => {
    const b = i >= off ? booster[i - off] : "....."
    return b + (i >= off ? "d" : ".") + c
  })
  sprite("rocket_heavy", { mx: "c", outline: "k" }, rows.join("\n"))
}

// ---- stars: seamless 64x64 tile, five dim dots only (the background should stay quiet) ----
sprite("stars", { w: 64, h: 64 }, (c) => {
  let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 5; i++) c.px(Math.floor(rnd() * 64), Math.floor(rnd() * 64), i === 0 ? "d" : "f")
})
