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

// ---- stars: seamless 64x64 tile, five dim dots only (the background should stay quiet) ----
sprite("stars", { w: 64, h: 64 }, (c) => {
  let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 5; i++) c.px(Math.floor(rnd() * 64), Math.floor(rnd() * 64), i === 0 ? "d" : "f")
})
