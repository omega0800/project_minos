// Headless tests for Project Minos.
// Usage: node tools/test-room.js
// Loads the game script out of project-minos.html and runs it without a browser.

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadGame() {
  const html = fs.readFileSync(path.join(__dirname, "..", "project-minos.html"), "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("No <script> block found");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    m[1] + "\n;this.__api = { TILE, ROOM_W, ROOM_H, STEP, PLAYER_SPEED, WALL, FLOOR, makeGame, stepGame, tileAt, boxHitsWall," +
      " SWING_TIME, SWING_COOLDOWN, SWING_MOVE_MULT, SWING_BUFFER, FACING_LOCK_EXTRA };",
    ctx
  );
  return ctx.__api;
}

const G = loadGame();
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name + (detail ? "  (" + detail + ")" : "")); }
}
const none = { up: false, down: false, left: false, right: false };
function hold(dirs) { return Object.assign({}, none, dirs); }
function run(game, input, seconds) {
  const n = Math.round(seconds / G.STEP);
  for (let i = 0; i < n; i++) G.stepGame(game, input, G.STEP);
}

console.log("Room");
{
  const g = makeFresh();
  const r = g.room;
  let borderOk = true, insideOk = true;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const edge = x === 0 || y === 0 || x === r.w - 1 || y === r.h - 1;
    const t = G.tileAt(r, x, y);
    if (edge && t !== G.WALL) borderOk = false;
    if (!edge && t !== G.FLOOR) insideOk = false;
  }
  check("border is all wall", borderOk);
  check("interior is all floor", insideOk);
  check("player starts out of walls", !G.boxHitsWall(r, g.player.x, g.player.y, g.player.size));
}

console.log("Movement");
{
  const g = makeFresh();
  const x0 = g.player.x;
  run(g, hold({ right: true }), 0.5);
  const moved = g.player.x - x0;
  check("moves right at PLAYER_SPEED", Math.abs(moved - G.PLAYER_SPEED * 0.5) < 1, "moved " + moved.toFixed(2));

  const h = makeFresh();
  const hx = h.player.x, hy = h.player.y;
  run(h, hold({ right: true, down: true }), 0.5);
  const diag = Math.hypot(h.player.x - hx, h.player.y - hy);
  check("diagonal speed equals straight speed", Math.abs(diag - G.PLAYER_SPEED * 0.5) < 1, "moved " + diag.toFixed(2));

  const s = makeFresh();
  const sx = s.player.x, sy = s.player.y;
  run(s, none, 1);
  check("no input, no movement", s.player.x === sx && s.player.y === sy);
}

console.log("Walls block the player on every side");
for (const [dir, test] of [
  ["left",  (p, r) => p.x === G.TILE],
  ["right", (p, r) => p.x + p.size === (r.w - 1) * G.TILE],
  ["up",    (p, r) => p.y === G.TILE],
  ["down",  (p, r) => p.y + p.size === (r.h - 1) * G.TILE],
]) {
  const g = makeFresh();
  run(g, hold({ [dir]: true }), 10);
  check(dir + ": stops flush against the wall", test(g.player, g.room),
    "x=" + g.player.x + " y=" + g.player.y);
}

console.log("Corners and sliding");
{
  const g = makeFresh();
  run(g, hold({ up: true, left: true }), 10);
  check("pushing into top-left corner stays inside", g.player.x === G.TILE && g.player.y === G.TILE,
    "x=" + g.player.x + " y=" + g.player.y);

  const s = makeFresh();
  run(s, hold({ left: true }), 10);          // pinned to left wall
  const y0 = s.player.y;
  run(s, hold({ left: true, down: true }), 0.3);
  check("slides along a wall while pushing into it", s.player.y > y0 && s.player.x === G.TILE);
}

console.log("Long random walk never leaves the room");
{
  const g = makeFresh();
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let escaped = false;
  for (let i = 0; i < 20000; i++) {
    if (i % 30 === 0) var inp = { up: rnd() < 0.5, down: rnd() < 0.5, left: rnd() < 0.5, right: rnd() < 0.5 };
    G.stepGame(g, inp, G.STEP);
    if (G.boxHitsWall(g.room, g.player.x, g.player.y, g.player.size)) { escaped = true; break; }
  }
  check("20,000 random steps, never inside a wall", !escaped);
}

console.log("Sword");
{
  const attack = Object.assign({}, none, { attack: true });

  const g = makeFresh();
  G.stepGame(g, attack, G.STEP);
  check("pressing attack starts a swing", !!g.player.swing);
  run(g, none, G.SWING_TIME + G.STEP);
  check("swing ends after SWING_TIME", !g.player.swing && g.player.cooldown > 0);
  G.stepGame(g, attack, G.STEP);
  check("can't swing again during cooldown (press is buffered)", !g.player.swing && g.player.buffered > 0);
  run(g, none, G.SWING_COOLDOWN);
  check("buffered press swings once cooldown ends", !!g.player.swing);

  const h = makeFresh();
  G.stepGame(h, attack, G.STEP);
  run(h, none, G.SWING_TIME + G.SWING_COOLDOWN + 0.5);
  check("one press = one swing (no auto-repeat)", !h.player.swing);

  const late = makeFresh();
  G.stepGame(late, attack, G.STEP);
  run(late, none, 0.02);
  G.stepGame(late, attack, G.STEP);     // early press mid-swing...
  run(late, none, G.SWING_TIME + G.SWING_COOLDOWN);
  check("a press long before the swing ends is dropped", !late.player.swing);

  const mv = makeFresh();
  const x0 = mv.player.x;
  G.stepGame(mv, Object.assign({}, attack, { right: true }), G.STEP);
  run(mv, hold({ right: true }), 0.1);
  const moved = mv.player.x - x0;
  const expect = G.PLAYER_SPEED * G.SWING_MOVE_MULT * (0.1 + G.STEP);
  check("movement slowed while swinging", Math.abs(moved - expect) < 1, "moved " + moved.toFixed(2) + ", expected " + expect.toFixed(2));

  const f = makeFresh();
  f.player.facing = { x: 0, y: 1 };
  G.stepGame(f, Object.assign({}, attack, { right: true }), G.STEP);
  run(f, hold({ right: true }), 0.1);
  check("facing stays locked mid-swing", f.player.facing.x === 0 && f.player.facing.y === 1);

  const fl = makeFresh();
  fl.player.facing = { x: 0, y: 1 };
  G.stepGame(fl, attack, G.STEP);
  run(fl, none, G.SWING_TIME + G.STEP);       // swing just ended
  run(fl, hold({ right: true }), G.FACING_LOCK_EXTRA / 2);
  check("facing still locked just after the swing", fl.player.facing.x === 0 && fl.player.facing.y === 1);
  const xa = fl.player.x;
  run(fl, hold({ right: true }), 0.1);
  check("normal speed right after the swing", Math.abs((fl.player.x - xa) - G.PLAYER_SPEED * 0.1) < 1);
  check("facing turns once the lock ends", fl.player.facing.x === 1);
}

console.log("Sword vs dummies");
{
  const attack = Object.assign({}, none, { attack: true });
  function besideDummy(facingX) {
    const g = makeFresh();
    const d = g.dummies[0];
    // Stand just left of the dummy, a small gap between them.
    g.player.x = d.x - g.player.size - 8;
    g.player.y = d.y + (d.size - g.player.size) / 2;
    g.player.facing = { x: facingX, y: 0 };
    return g;
  }
  const g = besideDummy(1);
  G.stepGame(g, attack, G.STEP);
  run(g, none, G.SWING_TIME);
  check("swing toward a dummy hits it", g.dummies[0].hits === 1, "hits=" + g.dummies[0].hits);
  check("only one hit per swing", g.dummies[0].hits === 1);
  check("far dummy untouched", g.dummies[1].hits === 0);

  const away = besideDummy(-1);
  G.stepGame(away, attack, G.STEP);
  run(away, none, G.SWING_TIME);
  check("swing facing away misses", away.dummies[0].hits === 0);

  const twice = besideDummy(1);
  for (let i = 0; i < 2; i++) {
    G.stepGame(twice, attack, G.STEP);
    run(twice, none, G.SWING_TIME + G.SWING_COOLDOWN);
  }
  check("two swings = two hits", twice.dummies[0].hits === 2, "hits=" + twice.dummies[0].hits);
}

function makeFresh() { return G.makeGame(); }

console.log(failures === 0 ? "\nAll tests passed." : "\n" + failures + " test(s) FAILED.");
process.exit(failures === 0 ? 0 : 1);
