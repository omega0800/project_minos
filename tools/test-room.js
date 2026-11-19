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
      " PLAYER_MAX_HP, PLAYER_IFRAMES, SKELETON_EASY, SKELETON_HARD, skeletonStats, SWING_ARC, SWING_REACH, WAVE_SIZE, WAVE_DELAY, makeSkeleton, makeRng, setDifficulty, PLAYER_SPEED, makeFirstFloor, switchArea, HEAL, DOOR, NPC, VOID, HEAL_INTERVAL, NPC_TALK_RANGE, NPC_LINES, cameraFor, inSafeRoom, VIEW_W, VIEW_H, CELL, isWalkable, CELL_EMPTY, CELL_BUILT, CELL_RESERVED, EDGE_OPEN, EDGE_UNDECIDED, DIRS, neighbour, getEdge, cellCentre, TORCH_RADIUS, GEN_RADIUS, respawnAtCheckpoint, floorDifficulty, inSafeArea, FLOORS_TO_HARD, SKEL_GIVE_UP, setTile, WALL };",
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
  check("hard: much shorter wind-up", H.windup < E.windup / 2);
  check("hard: ~15% shorter cooldown than easy", Math.abs(H.cooldown - E.cooldown * 0.85) < 1e-9);
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

  const g = G.makeGame(3, { area: "arena" });
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

  const w = G.makeGame(7, { area: "arena" });
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
    const g = G.makeGame(seed, { area: "arena" });
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

console.log("Floor 1 and the safe room");
{
  const g = G.makeGame(1);
  const r = g.room;
  const T = G.TILE;
  const place = (tx, ty) => { g.player.x = tx * T + 5; g.player.y = ty * T + 5; };
  check("game starts on floor 1, inside the safe room", g.area === "maze" && g.floorNum === 1 && G.inSafeRoom(g));
  check("floor is much bigger than the screen", r.w * T > G.VIEW_W * 2 && r.h * T > G.VIEW_H * 2);
  check("no skeletons in sight at the start", g.skeletons.every((sk) => !sk.aggro));
  check("player starts on open floor", !G.boxHitsWall(r, g.player.x, g.player.y, g.player.size));
  const n0 = g.skeletons.length;
  run(g, none, G.WAVE_DELAY * 3);
  check("no arena waves spawn in the maze", g.skeletons.length === n0);

  // Every walkable tile is enclosed: no walkable tile touches VOID.
  let leaks = 0;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (!G.isWalkable(G.tileAt(r, x, y))) continue;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]])
      if (G.tileAt(r, x + dx, y + dy) === G.VOID) leaks++;
  }
  check("everything walkable is walled in (no holes into the void)", leaks === 0, leaks + " leaks");

  // Door lines up with a cell so the maze can grow from it.
  check("doorway sits on a cell's floor columns", (r.door.tx % G.CELL) === 1 && G.tileAt(r, r.door.tx + 1, r.door.ty) === G.DOOR);

  // Long random walk never ends up inside anything solid.
  let seed = 99, bad = false;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let inp = none;
  for (let i = 0; i < 20000; i++) {
    if (i % 30 === 0) inp = { up: rnd() < 0.5, down: rnd() < 0.5, left: rnd() < 0.5, right: rnd() < 0.5 };
    G.stepGame(g, inp, G.STEP);
    if (G.boxHitsWall(r, g.player.x, g.player.y, g.player.size)) { bad = true; break; }
  }
  check("20,000 random steps: never inside a wall, the void or the Old Man", !bad);

  // Walk out of the door and down the corridor.
  const out = G.makeGame(1);
  out.player.x = out.room.door.tx * T + 5;            // line up with the doorway
  run(out, hold({ down: true }), 4);
  check("can walk out through the doorway into the corridor", !G.inSafeRoom(out) && out.player.y > out.room.door.ty * T + T);

  // Camera
  const cam = G.cameraFor(out);
  const pc = { x: out.player.x + 11, y: out.player.y + 11 };
  check("camera keeps the player centred away from the edges",
    Math.abs(pc.x - cam.x - G.VIEW_W / 2) <= 1 && Math.abs(pc.y - cam.y - G.VIEW_H / 2) <= 1);
  out.player.x = 40; out.player.y = 40;
  const c0 = G.cameraFor(out);
  check("camera stops at the map's top-left edge", c0.x === 0 && c0.y === 0);
  out.player.x = r.w * T; out.player.y = r.h * T;
  const c1 = G.cameraFor(out);
  check("camera stops at the map's bottom-right edge", c1.x === r.w * T - G.VIEW_W && c1.y === r.h * T - G.VIEW_H);

  // Healing nook
  const h = G.makeGame(1);
  h.player.hp = 1;
  h.player.x = h.room.healTile.tx * T + 5; h.player.y = h.room.healTile.ty * T + 5;
  run(h, none, G.HEAL_INTERVAL * 2 + 0.05);
  check("standing on green heals 1 HP per interval", h.player.hp === 3, "hp=" + h.player.hp);
  run(h, none, 10);
  check("healing stops at max HP", h.player.hp === G.PLAYER_MAX_HP);
  const off = G.makeGame(1);
  off.player.hp = 2;
  run(off, none, 3);
  check("no healing off the green", off.player.hp === 2);
  const walk = G.makeGame(1);
  run(walk, hold({ up: true }), 4);
  const wc = { x: walk.player.x + 11, y: walk.player.y + 11 };
  check("can walk from the start straight up into the nook",
    G.tileAt(walk.room, Math.floor(wc.x / T), Math.floor(wc.y / T)) === G.HEAL);

  // The Old Man
  const n = G.makeGame(1);
  const npc = n.room.npc;
  const nearIt = () => { n.player.x = (npc.tx - 1) * T + 2; n.player.y = npc.ty * T + 5; G.stepGame(n, none, G.STEP); };
  const awayIt = () => { n.player.x = (npc.tx - 8) * T; n.player.y = (npc.ty + 4) * T; G.stepGame(n, none, G.STEP); };
  run(n, none, 0.2);
  check("Old Man quiet when the player is far", !n.npcTalking);
  nearIt();
  check("Old Man talks when the player is close", n.npcTalking && n.npcLine === 0);
  awayIt(); nearIt();
  check("walking up again gives the next line", n.npcLine === 1);

  // Arena hop keeps HP
  const t = G.makeGame(1);
  t.player.hp = 3;
  G.switchArea(t);
  check("T: arena has skeletons and keeps your HP", t.area === "arena" && t.skeletons.length === G.WAVE_SIZE && t.player.hp === 3);
  G.switchArea(t);
  check("T again: back on floor 1 in the safe room, still 3 HP", t.area === "maze" && G.inSafeRoom(t) && t.player.hp === 3);
  const t2 = G.makeGame(4);
  run(t2, hold({ down: true }), 3);
  const floor = t2.room, built = floor.builtCount;
  G.switchArea(t2); G.switchArea(t2);
  check("T and back keeps the same floor (not a new one)", t2.room === floor && t2.room.builtCount >= built);
}

console.log("Maze generation");
{
  // Explore a whole floor by hopping to the frontier (fast; checks the maze's shape).
  function exploreAll(seed) {
    const g = G.makeGame(seed);
    const r = g.room;
    for (let guard = 0; guard < 5000 && r.frontier.length; guard++) {
      const f = r.frontier[0].from;
      const c = G.cellCentre(f.cx, f.cy);
      g.player.x = c.x - 11; g.player.y = c.y - 11;
      G.stepGame(g, none, G.STEP);
    }
    return g;
  }
  let allFull = true, allConnected = true, allSealed = true, minBuilt = Infinity, maxForced = 0;
  let loopsTotal = 0, loopsMax = 0, cellsTotal = 0, hallsTotal = 0, hallsOk = true, oneWide = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const g = exploreAll(seed), r = g.room, W = r.cellsW, H = r.cellsH;
    let reserved = 0, empty = 0, openEdges = 0;
    for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
      const st = r.cells[cy * W + cx];
      if (st === G.CELL_RESERVED) reserved++;
      if (st === G.CELL_EMPTY) empty++;
      for (const d of ["e", "s"]) {
        const n = G.neighbour(r, cx, cy, d);
        if (!n) continue;
        const bothReserved = st === G.CELL_RESERVED && r.cells[n.cy * W + n.cx] === G.CELL_RESERVED;
        if (!bothReserved && G.getEdge(r, cx, cy, d) === G.EDGE_OPEN) openEdges++;
      }
    }
    if (empty !== 0) allFull = false;
    // Loops = open walls beyond the one way into each cell (safe room counted as one node).
    const loops = r.loopCount;   // (open walls inside rooms and wide halls aren't loops)
    loopsTotal += loops; loopsMax = Math.max(loopsMax, loops); cellsTotal += r.builtCount;
    // Wide halls: 2 cells wide, 3-5 long, fully open inside (no pillars).
    for (const hall of r.wideHalls) {
      hallsTotal++;
      if (hall.length < 6 || hall.length > 10) hallsOk = false;
      const xs = hall.map((c) => c[0]), ys = hall.map((c) => c[1]);
      const x0 = Math.min(...xs) * 3 + 1, x1 = (Math.max(...xs) + 1) * 3 - 1;
      const y0 = Math.min(...ys) * 3 + 1, y1 = (Math.max(...ys) + 1) * 3 - 1;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!G.isWalkable(G.tileAt(r, x, y))) hallsOk = false;
      if (Math.min(x1 - x0, y1 - y0) + 1 !== 5) hallsOk = false;
    }
    // No 1-tile-wide passages: no walkable tile has something solid on both sides.
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      if (!G.isWalkable(G.tileAt(r, x, y))) continue;
      const sol = (dx, dy) => !G.isWalkable(G.tileAt(r, x + dx, y + dy));
      if ((sol(-1, 0) && sol(1, 0)) || (sol(0, -1) && sol(0, 1))) oneWide++;
    }
    // Everything reachable from the safe room.
    const seen = new Uint8Array(W * H), q = [];
    for (let i = 0; i < W * H; i++) if (r.cells[i] === G.CELL_RESERVED) { seen[i] = 1; q.push(i); }
    while (q.length) {
      const i = q.pop(), cx = i % W, cy = (i / W) | 0;
      for (const d of G.DIRS) {
        const n = G.neighbour(r, cx, cy, d);
        if (!n || G.getEdge(r, cx, cy, d) !== G.EDGE_OPEN) continue;
        const j = n.cy * W + n.cx;
        if (!seen[j]) { seen[j] = 1; q.push(j); }
      }
    }
    if (seen.reduce((a, b) => a + b, 0) !== r.builtCount + reserved) allConnected = false;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      if (!G.isWalkable(G.tileAt(r, x, y))) continue;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]])
        if (G.tileAt(r, x + dx, y + dy) === G.VOID) allSealed = false;
    }
    minBuilt = Math.min(minBuilt, r.builtCount);
    maxForced = Math.max(maxForced, r.forcedCount || 0);
  }
  check("8 floors explored fully: every cell gets built (never traps you)", allFull, "smallest=" + minBuilt);
  console.log("        (loops: " + loopsTotal + " over 8 floors, at most " + loopsMax + " on one; " + (100 * loopsTotal / cellsTotal).toFixed(1) + "% of cells)");
  check("the maze has some loops", loopsTotal > 0);
  check("loops stay limited (under 10% of cells)", loopsTotal / cellsTotal < 0.1);
  console.log("        (wide halls: " + hallsTotal + " over 8 floors)");
  check("wide halls appear", hallsTotal > 0);
  check("wide halls are 5 tiles wide, 3-5 cells long, open inside", hallsOk);
  check("no 1-tile-wide passages anywhere", oneWide === 0, oneWide + " tiles");
  check("every cell is reachable from the safe room", allConnected);
  check("everything walkable is walled in", allSealed);
  console.log("        (anti-trap opened a wall at most " + maxForced + " times on one floor)");
  check("hallways stay 2 wide: each cell's floor is a 2x2 patch",
    (() => { const g = exploreAll(3), r = g.room; for (let cy = 0; cy < r.cellsH; cy++) for (let cx = 0; cx < r.cellsW; cx++) {
      if (r.cells[cy * r.cellsW + cx] !== G.CELL_BUILT) continue;
      for (let dy = 1; dy <= 2; dy++) for (let dx = 1; dx <= 2; dx++) if (!G.isWalkable(G.tileAt(r, cx * 3 + dx, cy * 3 + dy))) return false; }
      return true; })());

  check("generation reaches past the torchlight", G.GEN_RADIUS > G.TORCH_RADIUS + G.CELL * G.TILE);
}

console.log("Rooms");
{
  function exploreAll(seed, opts) {
    const g = G.makeGame(seed, opts);
    const r = g.room;
    for (let guard = 0; guard < 5000 && r.frontier.length; guard++) {
      const f = r.frontier[0].from;
      const c = G.cellCentre(f.cx, f.cy);
      g.player.x = c.x - 11; g.player.y = c.y - 11;
      G.stepGame(g, none, G.STEP);
      g.player.hp = G.PLAYER_MAX_HP; g.player.iframes = 1; // the hopper isn't here to fight
    }
    return g;
  }
  let rooms = 0, shapesOk = true, openOk = true, spawnsOk = true, countsOk = true, skels = 0, sizes = {};
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const g = exploreAll(seed), r = g.room;
    for (const rm of r.rooms) {
      rooms++;
      const key = rm.w + "x" + rm.h; sizes[key] = (sizes[key] || 0) + 1;
      if (![4, 6, 9].includes(rm.w * rm.h) || rm.cells.length !== rm.w * rm.h) shapesOk = false;
      for (let y = rm.rect.y0; y <= rm.rect.y1; y++) for (let x = rm.rect.x0; x <= rm.rect.x1; x++)
        if (!G.isWalkable(G.tileAt(r, x, y))) openOk = false;
      const a = rm.w * rm.h, n = rm.spawns.length;
      if ((a === 4 && (n < 1 || n > 2)) || (a === 6 && (n < 2 || n > 3)) || (a === 9 && (n < 2 || n > 4))) countsOk = false;
      for (const sp of rm.spawns) {
        skels++;
        if (G.boxHitsWall(r, sp.x, sp.y, 22)) spawnsOk = false;
        const cx = sp.x + 11, cy = sp.y + 11;
        if (cx < rm.rect.x0 * G.TILE || cx > (rm.rect.x1 + 1) * G.TILE || cy < rm.rect.y0 * G.TILE || cy > (rm.rect.y1 + 1) * G.TILE) spawnsOk = false;
      }
    }
  }
  console.log("        (" + rooms + " rooms over 6 floors: " + JSON.stringify(sizes) + "; " + skels + " skeletons)");
  check("rooms appear (several per floor)", rooms / 6 >= 5);
  check("rooms are 2x2, 2x3, 3x2 or 3x3 cells", shapesOk);
  check("rooms are fully open inside", openOk);
  check("skeleton counts fit the room size (1-2 / 2-3 / 2-4)", countsOk);
  check("skeletons spawn inside their room, not in walls", spawnsOk);

  const empty = exploreAll(1, { enemies: false });
  check("enemies off: rooms still appear but stay empty", empty.room.rooms.length > 0 && empty.skeletons.length === 0);

  // Floor difficulty
  const rng = G.makeRng(5);
  let f1max = 0, f20sum = 0;
  for (let i = 0; i < 200; i++) { f1max = Math.max(f1max, G.floorDifficulty(1, rng)); f20sum += G.floorDifficulty(G.FLOORS_TO_HARD, rng); }
  check("floor 1 skeletons are near max easy (difficulty <= 0.1)", f1max <= 0.1 + 1e-9);
  check("by floor " + G.FLOORS_TO_HARD + " skeletons average near max hard", f20sum / 200 > 0.9);
  check("difficulty never drops going deeper", [1, 3, 6, 10, 15, 20, 30].every((f, i, a) => i === 0 ||
    G.floorDifficulty(f, () => 0.5) >= G.floorDifficulty(a[i - 1], () => 0.5)));
}

console.log("Skeletons in the maze");
{
  // Arena scenarios with walls built in, so positions are exact.
  function arenaWith(walls) {
    const g = G.makeGame(1, { area: "arena", skeletons: false });
    for (const [x, y] of walls) G.setTile(g.room, x, y, G.WALL);
    return g;
  }
  // A wall column at x = 15 from y = 2 to 17.
  const col = []; for (let y = 2; y <= 17; y++) col.push([15, y]);
  const a = arenaWith(col);
  a.player.x = 17 * G.TILE; a.player.y = 10 * G.TILE;
  const sk = G.makeSkeleton(50, 12 * G.TILE, 10 * G.TILE, a.rng, 0);
  a.skeletons.push(sk);
  run(a, none, 2);
  check("doesn't notice you through a wall", !sk.aggro);

  // Same wall; it sees you first, then you step behind the wall: it goes around.
  const b = arenaWith(col);
  b.player.x = 12 * G.TILE; b.player.y = 1 * G.TILE + 5;      // above the wall's end, in view
  const sk2 = G.makeSkeleton(51, 12 * G.TILE, 6 * G.TILE, b.rng, 0);
  b.skeletons.push(sk2);
  G.stepGame(b, none, G.STEP);
  const noticed = sk2.aggro;
  b.player.x = 17 * G.TILE; b.player.y = 6 * G.TILE;          // now hidden behind the wall
  let reached = false;
  for (let i = 0; i < Math.round(8 / G.STEP) && !reached; i++) {
    G.stepGame(b, none, G.STEP);
    if (b.player.hp < G.PLAYER_MAX_HP) reached = true;
  }
  check("chases you around a wall (path-finding) and attacks", noticed && reached, "noticed=" + noticed + " reached=" + reached);

  // Gives up after losing you for a while.
  const c = arenaWith(col);
  c.player.x = 12 * G.TILE; c.player.y = 1 * G.TILE + 5;
  const sk3 = G.makeSkeleton(52, 12 * G.TILE, 6 * G.TILE, c.rng, 0);
  c.skeletons.push(sk3);
  G.stepGame(c, none, G.STEP);
  c.player.x = 27 * G.TILE; c.player.y = 17 * G.TILE;
  // Box the player in so it can't be reached.
  for (let y = 15; y <= 18; y++) G.setTile(c.room, 25, y, G.WALL);
  for (let x = 25; x <= 28; x++) G.setTile(c.room, x, 15, G.WALL);
  run(c, none, G.SKEL_GIVE_UP + 1);
  check("gives up when it loses you for " + G.SKEL_GIVE_UP + " s", !sk3.aggro);

  // Idle skeletons stay in their room.
  // Explore until a room with skeletons is within their active range of the
  // safe room (idle skeletons far from you don't move at all).
  const g = G.makeGame(3);
  const spawn = g.room.spawn;
  const nearRoom = () => g.room.rooms.some((rm) => rm.spawns.length &&
    Math.hypot((rm.rect.x0 + rm.rect.x1) / 2 * G.TILE - spawn.x, (rm.rect.y0 + rm.rect.y1) / 2 * G.TILE - spawn.y) < 18 * G.TILE);
  for (let guard = 0; guard < 3000 && !nearRoom() && g.room.frontier.length; guard++) {
    const f = g.room.frontier[0].from, cc = G.cellCentre(f.cx, f.cy);
    g.player.x = cc.x - 11; g.player.y = cc.y - 11; G.stepGame(g, none, G.STEP);
  }
  G.respawnAtCheckpoint(g);   // fresh skeletons at their spawn points; player in the safe room
  let wandered = false, inRoom = true;
  const starts = g.skeletons.map((s2) => [s2.x, s2.y]);
  for (let i = 0; i < Math.round(20 / G.STEP); i++) {
    G.stepGame(g, none, G.STEP);
  }
  // (only skeletons within active range of the player move; check those that did)
  g.skeletons.forEach((s2, i) => {
    if (s2.x !== starts[i][0] || s2.y !== starts[i][1]) wandered = true;
    const h = s2.home, cx2 = s2.x + 11, cy2 = s2.y + 11;
    if (h && (cx2 < h.x0 || cx2 > h.x1 || cy2 < h.y0 || cy2 > h.y1)) inRoom = false;
  });
  check("idle skeletons wander but stay in their rooms", inRoom && (wandered || g.skeletons.length === 0));

  // A fighting bot explores with skeletons around: nobody ends up in walls,
  // skeletons never get into the safe room, and dying brings you back.
  let wallBad = false, safeBad = false, deaths = 0, kills = 0, respawnOk = true, simT = 0;
  for (const seed of [1, 2, 3]) {
    const f = G.makeGame(seed, { floorCells: 15 }), r = f.room, W = r.cellsW;
    const leaveSafeRoom = () => { f.player.x = r.door.tx * G.TILE + 5; f.player.y = (r.door.ty + 2) * G.TILE; };
    leaveSafeRoom();
    const cellOf = () => ({ cx: Math.floor((f.player.x + 11) / 96), cy: Math.floor((f.player.y + 11) / 96) });
    let path = null;
    for (let i = 0; i < Math.round(240 / G.STEP); i++) {
      simT += G.STEP;
      const p = f.player, pc = { x: p.x + 11, y: p.y + 11 };
      let inp = Object.assign({}, none);
      // Fight anything chasing and close; otherwise explore.
      const foe = f.skeletons.filter((s2) => s2.aggro).sort((s1, s2) => Math.hypot(s1.x - p.x, s1.y - p.y) - Math.hypot(s2.x - p.x, s2.y - p.y))[0];
      if (foe && Math.hypot(foe.x - p.x, foe.y - p.y) < 48) {
        const dx = foe.x - p.x, dy = foe.y - p.y, dd = Math.hypot(dx, dy) || 1;
        p.facing = { x: dx / dd, y: dy / dd };
        if (i % 12 === 0) inp.attack = true;
      } else if (r.frontier.length) {
        if (!path || !path.length) {
          const targets = new Set(r.frontier.map((q) => q.from.cy * W + q.from.cx));
          const st = cellOf(), prev = new Map([[st.cy * W + st.cx, null]]), qq = [st.cy * W + st.cx];
          path = null;
          while (qq.length) {
            const k = qq.shift();
            if (targets.has(k)) { path = []; let z = k; while (z !== null) { path.unshift(z); z = prev.get(z); } break; }
            const cx = k % W, cy = (k / W) | 0;
            for (const d of G.DIRS) {
              const n = G.neighbour(r, cx, cy, d);
              if (!n || G.getEdge(r, cx, cy, d) !== G.EDGE_OPEN) continue;
              const j = n.cy * W + n.cx;
              if (r.cells[j] === G.CELL_EMPTY || prev.has(j)) continue;
              prev.set(j, k); qq.push(j);
            }
          }
          if (!path) path = [];
        }
        if (path.length) {
          const k = path[0], c2 = G.cellCentre(k % W, (k / W) | 0);
          inp = { right: c2.x - pc.x > 2, left: c2.x - pc.x < -2, down: c2.y - pc.y > 2, up: c2.y - pc.y < -2 };
          if (!inp.right && !inp.left && !inp.down && !inp.up) path.shift();
        }
      }
      G.stepGame(f, inp, G.STEP);
      for (const e of [f.player, ...f.skeletons]) if (G.boxHitsWall(r, e.x, e.y, e.size)) wallBad = true;
      for (const s2 of f.skeletons) if (G.inSafeArea(r, s2.x + 11, s2.y + 11)) safeBad = true;
      if (f.over) {
        deaths++;
        const builtBefore = r.builtCount, spawns = r.rooms.reduce((n, rm) => n + rm.spawns.length, 0);
        G.respawnAtCheckpoint(f);
        const ok = G.inSafeRoom(f);
        leaveSafeRoom();
        if (!ok || f.room !== r || f.room.builtCount !== builtBefore || f.player.hp !== G.PLAYER_MAX_HP ||
            f.skeletons.length !== spawns) respawnOk = false;
        path = null;
      }
    }
    kills += f.kills;
  }
  console.log("        (fighting bot: " + simT.toFixed(0) + " s, " + kills + " kills, " + deaths + " deaths)");
  check("fighting in the maze: nobody ever inside a wall", !wallBad);
  check("skeletons never get into the safe room", !safeBad);
  check("dying: back in the safe room, full HP, same floor, every room's skeletons back", respawnOk);
}

console.log("Walking the maze (never see it being built)");
{
  // A bot that really walks: heads for the nearest frontier through open cells.
  // Small 15x15 floor so the test stays quick; full-size timing is a tuning job.
  const g = G.makeGame(11, { floorCells: 15, enemies: false }), r = g.room, W = r.cellsW, T = G.TILE;
  const typeAt = new Int8Array(r.w * r.h).fill(-1); // tile type when last seen
  let sawVoid = 0, popped = 0, steps = 0;
  const cellOf = () => { const c = { x: g.player.x + 11, y: g.player.y + 11 }; return { cx: Math.floor(c.x / (3 * T)), cy: Math.floor(c.y / (3 * T)) }; };
  function pathTo(targets) {
    const start = cellOf(), prev = new Map(), key = (cx, cy) => cy * W + cx;
    const q = [[start.cx, start.cy]]; prev.set(key(start.cx, start.cy), null);
    while (q.length) {
      const [cx, cy] = q.shift();
      if (targets.has(key(cx, cy))) {
        const path = []; let k = key(cx, cy);
        while (k !== null) { path.unshift(k); k = prev.get(k); }
        return path;
      }
      for (const d of G.DIRS) {
        const n = G.neighbour(r, cx, cy, d);
        if (!n || G.getEdge(r, cx, cy, d) !== G.EDGE_OPEN) continue;
        if (r.cells[key(n.cx, n.cy)] !== G.CELL_BUILT) continue;
        if (!prev.has(key(n.cx, n.cy))) { prev.set(key(n.cx, n.cy), key(cx, cy)); q.push([n.cx, n.cy]); }
      }
    }
    return null;
  }
  // Step out of the safe room first.
  g.player.x = r.door.tx * T + 5;
  for (let i = 0; i < 200; i++) G.stepGame(g, hold({ down: true }), G.STEP);
  let path = null;
  for (; steps < 60000 && r.frontier.length; steps++) {
    if (!path || !path.length) {
      path = pathTo(new Set(r.frontier.map((f) => f.from.cy * W + f.from.cx)));
      if (!path) break;
    }
    const k = path[0], c = G.cellCentre(k % W, (k / W) | 0);
    const px = g.player.x + 11, py = g.player.y + 11;
    const inp = { right: c.x - px > 2, left: c.x - px < -2, down: c.y - py > 2, up: c.y - py < -2 };
    if (!inp.right && !inp.left && !inp.down && !inp.up) { path.shift(); continue; }
    G.stepGame(g, inp, G.STEP);
    for (const i of r.visList) if (r.tiles[i] === G.VOID) sawVoid++;
    if (steps % 4 === 0) {
      for (let i = 0; i < r.w * r.h; i++) {
        if (!r.seen[i]) continue;
        if (typeAt[i] !== -1 && typeAt[i] !== r.tiles[i]) popped++;
        typeAt[i] = r.tiles[i];
      }
    }
  }
  const total = r.cellsW * r.cellsH - 42;
  console.log("        (bot walked " + (steps * G.STEP).toFixed(0) + " s of game time, built " + r.builtCount + "/" + total +
    " cells; " + r.loopCount + " loops, " + r.wideHalls.length + " wide halls)");
  check("walking bot explores the whole floor", r.frontier.length === 0 && r.builtCount === total);
  check("never sees unbuilt space (no void inside the torchlight)", sawVoid === 0, sawVoid + " times");
  check("no tile you've seen ever changes (no walls popping open)", popped === 0, popped + " tiles");
}

function makeFresh() { return G.makeGame(1, { area: "arena", skeletons: false }); }

console.log(failures === 0 ? "\nAll tests passed." : "\n" + failures + " test(s) FAILED.");
process.exit(failures === 0 ? 0 : 1);
