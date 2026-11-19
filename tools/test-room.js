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
      " SWING_TIME, SWING_COOLDOWN, SWING_MOVE_MULT, SWING_BUFFER, FACING_LOCK_EXTRA, CHAIN_GRACE," +
      " PLAYER_MAX_HP, PLAYER_IFRAMES, SKELETON_EASY, SKELETON_HARD, skeletonStats, SWING_ARC, SWING_REACH, WAVE_SIZE, WAVE_DELAY, makeSkeleton, makeRng, setDifficulty, PLAYER_SPEED };",
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

  // Backing up while swinging: face right, walk left the whole time.
  function backingUp(pressAt) {
    const g = makeFresh();
    g.player.facing = { x: 1, y: 0 };
    const back = hold({ left: true });
    G.stepGame(g, Object.assign({}, back, { attack: true }), G.STEP);
    run(g, back, pressAt);
    G.stepGame(g, Object.assign({}, back, { attack: true }), G.STEP);
    let second = null;
    for (let i = 0; i < 60 && !second; i++) {
      G.stepGame(g, back, G.STEP);
      if (g.player.swing && g.player.swing.t < G.STEP * 1.5) second = g.player.swing;
    }
    return second;
  }
  const chained = backingUp(0.13);   // pressed before the first swing finishes
  check("press mid-swing while backing up: next swing keeps direction",
    chained && Math.abs(chained.angle - 0) < 1e-9, chained ? "angle=" + chained.angle.toFixed(2) : "no swing");
  const grace = backingUp(G.SWING_TIME + G.CHAIN_GRACE - 0.03); // just after it finished, within the grace
  check("press just after the swing (within grace) while backing up: keeps direction",
    grace && Math.abs(grace.angle - 0) < 1e-9, grace ? "angle=" + grace.angle.toFixed(2) : "no swing");
  const lateP = backingUp(G.SWING_TIME + G.CHAIN_GRACE + 0.05); // pressed after the grace ran out
  check("press after the swing while backing up: next swing turns around",
    lateP && Math.abs(Math.abs(lateP.angle) - Math.PI) < 1e-9, lateP ? "angle=" + lateP.angle.toFixed(2) : "no swing");
}

// ---------- Skeletons ----------
const attackIn = Object.assign({}, none, { attack: true });
// An empty room plus one skeleton placed dx, dy pixels from the player.
function withSkeleton(dx, dy) {
  const g = makeFresh();
  const sk = G.makeSkeleton(99, g.player.x + dx, g.player.y + dy, g.rng);
  g.skeletons.push(sk);
  return { g, sk };
}
function swingAt(g, fx, fy) {
  g.player.facing = { x: fx, y: fy };
  G.stepGame(g, attackIn, G.STEP);
  run(g, none, G.SWING_TIME + G.SWING_COOLDOWN);
}

console.log("Skeletons: getting hit");
{
  const { g, sk } = withSkeleton(34, 0);   // just right of the player, in reach
  swingAt(g, 1, 0);
  check("one sword hit takes 1 HP", sk.hp === G.SKELETON_EASY.hp - 1, "hp=" + sk.hp);
  check("hit skeleton is knocked back", sk.x > g.player.x + 34);
  // Walk back into reach and finish it.
  g.player.x = sk.x - 34; g.player.y = sk.y;
  sk.windup = 0; sk.swing = null;
  swingAt(g, 1, 0);
  check("second hit kills it (2 HP)", g.skeletons.length === 0 && g.kills === 1, "left=" + g.skeletons.length);

  const w = withSkeleton(34, 0);
  w.sk.aggro = true;
  run(w.g, none, 0.1);                       // let it start winding up
  const wasWinding = w.sk.windup > 0;
  swingAt(w.g, 1, 0);
  check("hitting a winding-up skeleton cancels its attack",
    wasWinding && w.g.player.hp === G.PLAYER_MAX_HP, "winding=" + wasWinding + " hp=" + w.g.player.hp);
}

console.log("Skeletons: difficulty profiles");
{
  const E = G.SKELETON_EASY;
  const mid = G.skeletonStats(0.5), lo = G.skeletonStats(0), hi = G.skeletonStats(1);
  let blendOk = true;
  for (const k of Object.keys(E)) {
    if (k === "hp") continue;
    const want = (G.SKELETON_EASY[k] + G.SKELETON_HARD[k]) / 2;
    if (Math.abs(mid[k] - want) > 1e-9) blendOk = false;
  }
  check("difficulty 0.5 is halfway between easy and hard", blendOk);
  check("difficulty 0 = easy, 1 = hard", lo.speed === E.speed && hi.speed === G.SKELETON_HARD.speed);
  check("hp is a whole number", Number.isInteger(G.skeletonStats(0.37).hp));
  check("easy skeleton swing is shorter and narrower than the player's",
    E.swingReach < G.SWING_REACH && E.swingArc < G.SWING_ARC);
  check("easy skeleton only attacks when its blade can reach",
    E.attackRange <= E.swingReach + 11);   // 11 = half the player's body

  // Its swing reaches a player right in front, but not one just past its reach.
  function skeletonSwingHits(gap) {
    const { g, sk } = withSkeleton(0, 0);
    sk.x = g.player.x + 22 + gap; sk.y = g.player.y;   // player is to its left
    sk.aggro = true; sk.cooldown = 0;
    sk.windup = 0.0001; sk.windupAngle = Math.PI;
    G.stepGame(g, none, G.STEP);
    run(g, none, E.swingTime + G.STEP);
    return g.player.hp < G.PLAYER_MAX_HP;
  }
  check("easy swing hits a player standing close", skeletonSwingHits(6));
  check("easy swing misses a player just past its reach", !skeletonSwingHits(E.swingReach - 8));

  const H = G.SKELETON_HARD;
  check("hard: faster than the player", H.speed > G.PLAYER_SPEED);
  check("hard: notices from further away", H.aggroRange > E.aggroRange);
  check("hard: much shorter wind-up", H.windup < E.windup / 3);
  check("hard: 135 degree swing, 43 px reach", Math.abs(H.swingArc - Math.PI * 3 / 4) < 1e-9 && H.swingReach === 43);
  check("hard: attacks only when its blade can reach", H.attackRange <= H.swingReach + 11);
  check("hard: hp and damage same as easy (placeholders)", H.hp === E.hp && H.damage === E.damage);

  function timeToFirstHit(difficulty) {
    const g = makeFresh();
    const sk = G.makeSkeleton(99, g.player.x + 150, g.player.y, g.rng, difficulty);
    g.skeletons.push(sk);
    for (let i = 0; i < Math.round(5 / G.STEP); i++) {
      G.stepGame(g, none, G.STEP);
      if (g.player.hp < G.PLAYER_MAX_HP) return i * G.STEP;
    }
    return Infinity;
  }
  const te = timeToFirstHit(0), th = timeToFirstHit(1);
  check("hard skeleton lands its first hit much sooner (" + te.toFixed(2) + " s vs " + th.toFixed(2) + " s)", th < te * 0.6);

  const g = G.makeGame(3);
  G.setDifficulty(g, 1);
  check("setDifficulty respawns the wave at that difficulty",
    g.skeletons.length === G.WAVE_SIZE && g.skeletons.every((sk) => sk.difficulty === 1));
}

console.log("Skeletons: aggro");
{
  const far = withSkeleton(G.SKELETON_EASY.aggroRange + 60, 0);
  run(far.g, none, 2);
  check("stays calm when the player is out of range", !far.sk.aggro);

  const near = withSkeleton(G.SKELETON_EASY.aggroRange - 40, 0);
  G.stepGame(near.g, none, G.STEP);
  check("notices the player in range", near.sk.aggro);

  near.g.player.x = 40; near.g.player.y = 40;      // teleport far away
  near.sk.x = 900; near.sk.y = 560;
  G.stepGame(near.g, none, G.STEP);
  check("gives up beyond leash range", !near.sk.aggro);
}

console.log("Skeletons: attacking the player");
{
  const { g } = withSkeleton(150, 0);
  let firstHit = null;
  for (let i = 0; i < Math.round(4 / G.STEP); i++) {
    G.stepGame(g, none, G.STEP);
    if (firstHit === null && g.player.hp < G.PLAYER_MAX_HP) firstHit = i * G.STEP;
  }
  check("chases and hits a player standing still", firstHit !== null, "never hit");
  check("first hit takes a moment (approach + wind-up)", firstHit !== null && firstHit > G.SKELETON_EASY.windup,
    "t=" + (firstHit === null ? "-" : firstHit.toFixed(2)));

  const one = withSkeleton(150, 0);
  let hpAfter = null, t = 0;
  for (; t < 4 && hpAfter === null; t += G.STEP) {
    G.stepGame(one.g, none, G.STEP);
    if (one.g.player.hp < G.PLAYER_MAX_HP) hpAfter = one.g.player.hp;
  }
  run(one.g, none, G.PLAYER_IFRAMES * 0.9);
  check("invincible right after a hit", one.g.player.hp === hpAfter, "hp=" + one.g.player.hp);
}

console.log("Death and waves");
{
  const { g } = withSkeleton(60, 0);
  run(g, none, 20);
  check("standing still against a skeleton eventually dies", g.over && g.player.hp === 0, "hp=" + g.player.hp);
  const px = g.player.x;
  run(g, hold({ right: true }), 0.5);
  check("dead player can't move", g.player.x === px);

  const w = G.makeGame(7);
  check("room starts with a full wave", w.skeletons.length === G.WAVE_SIZE, "n=" + w.skeletons.length);
  const minD = Math.min(...w.skeletons.map((s) => Math.hypot(s.x - w.player.x, s.y - w.player.y)));
  check("wave spawns away from the player", minD > 200, "closest=" + minD.toFixed(0));
  w.skeletons = [];
  run(w, none, G.WAVE_DELAY + 0.1);
  check("a new wave appears after the room is cleared", w.skeletons.length === G.WAVE_SIZE);
}

console.log("Long fight simulation");
{
  // A scrappy bot: walks toward the nearest skeleton and swings when close.
  let wallBreak = false, deaths = 0, kills = 0, steps = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = G.makeGame(seed);
    for (let i = 0; i < Math.round(60 / G.STEP); i++) {
      steps++;
      let inp = Object.assign({}, none);
      const p = g.player;
      let best = null, bd = Infinity;
      for (const s of g.skeletons) {
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) {
        const dx = best.x - p.x, dy = best.y - p.y;
        if (bd > 30) {
          inp.right = dx > 6; inp.left = dx < -6; inp.down = dy > 6; inp.up = dy < -6;
        } else {
          p.facing = { x: dx / bd, y: dy / bd };
        }
        if (bd < 40 && i % 12 === 0) inp.attack = true;
      }
      G.stepGame(g, inp, G.STEP);
      for (const ent of [p, ...g.skeletons]) if (G.boxHitsWall(g.room, ent.x, ent.y, ent.size)) wallBreak = true;
      if (g.over) { deaths++; break; }
    }
    kills += g.kills;
  }
  check("5 x 60 s of fighting: nobody ever inside a wall", !wallBreak);
  check("the bot kills skeletons (" + kills + " kills, " + deaths + " deaths in 5 runs)", kills > 0);
}

function makeFresh() { return G.makeGame(1, { skeletons: false }); }

console.log(failures === 0 ? "\nAll tests passed." : "\n" + failures + " test(s) FAILED.");
process.exit(failures === 0 ? 0 : 1);
