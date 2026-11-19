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
    m[1] + "\n;this.__api = { TILE, ROOM_W, ROOM_H, STEP, PLAYER_SPEED, WALL, FLOOR, makeGame, stepGame, tileAt, boxHitsWall };",
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

function makeFresh() { return G.makeGame(); }

console.log(failures === 0 ? "\nAll tests passed." : "\n" + failures + " test(s) FAILED.");
process.exit(failures === 0 ? 0 : 1);
