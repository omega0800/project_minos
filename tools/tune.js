// Tuning runs for Project Minos (headless).
// Usage:
//   node tools/tune.js exit  [floorsPerK]        exit timing for several k values
//   node tools/tune.js size  <cells> <seed>      walking-bot time to fully explore one floor
//   node tools/tune.js fight <cells> <seed> <0|1> fighting bot on one floor, with/without skeletons
// Constants can be overridden: e.g. EXIT_K=14 node tools/tune.js ...
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadGame(overrides) {
  let src = fs.readFileSync(path.join(__dirname, "..", "project-minos.html"), "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const [k, v] of Object.entries(overrides || {})) {
    const re = new RegExp("const " + k + " = [^;]+;");
    if (!re.test(src)) throw new Error("no constant " + k);
    src = src.replace(re, "const " + k + " = " + v + ";");
  }
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + "\n;this.G = { makeGame, stepGame, STEP, cellCentre, neighbour, getEdge, DIRS, EDGE_OPEN, CELL_EMPTY, TILE, exitChance };", ctx);
  return ctx.G;
}

const envOverrides = {};
for (const k of ["EXIT_K", "LOOP_CHANCE", "ROOM_CHANCE", "WIDE_HALL_CHANCE", "BRANCH_CHANCE"])
  if (process.env[k]) envOverrides[k] = process.env[k];

const none = {};

// Fast exploration: hop to the frontier (no walking). Good for shape/exit stats.
function hopExplore(G, g) {
  const r = g.room;
  for (let guard = 0; guard < 20000 && r.frontier.length; guard++) {
    const f = r.frontier[0].from, c = G.cellCentre(f.cx, f.cy);
    g.player.x = c.x - 11; g.player.y = c.y - 11;
    g.stairsLock = true;
    G.stepGame(g, none, G.STEP);
    g.player.hp = 5; g.player.iframes = 1;
  }
}

// A bot that walks to the nearest frontier through open cells, fights anything
// chasing it when close, and never takes stairs. Returns game seconds used.
function walkExplore(G, g, maxSeconds, fight) {
  const r = g.room, W = r.cellsW, CELLPX = 3 * G.TILE;
  const cellOf = () => ({ cx: Math.floor((g.player.x + 11) / CELLPX), cy: Math.floor((g.player.y + 11) / CELLPX) });
  let path = null, steps = 0, deaths = 0;
  const maxSteps = Math.round(maxSeconds / G.STEP);
  for (; steps < maxSteps && r.frontier.length; steps++) {
    const p = g.player, pc = { x: p.x + 11, y: p.y + 11 };
    let inp = {};
    const foe = fight ? g.skeletons.filter((s) => s.aggro).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0] : null;
    if (foe && Math.hypot(foe.x - p.x, foe.y - p.y) < 48) {
      const dx = foe.x - p.x, dy = foe.y - p.y, d = Math.hypot(dx, dy) || 1;
      p.facing = { x: dx / d, y: dy / d };
      if (steps % 12 === 0) inp.attack = true;
    } else {
      if (!path || !path.length) {
        const targets = new Set(r.frontier.map((q) => q.from.cy * W + q.from.cx));
        const st = cellOf(), start = st.cy * W + st.cx, prev = new Map([[start, null]]), q = [start];
        path = [];
        for (let h = 0; h < q.length; h++) {
          const k = q[h];
          if (targets.has(k)) { let z = k; while (z !== null) { path.unshift(z); z = prev.get(z); } break; }
          const cx = k % W, cy = (k / W) | 0;
          for (const d of G.DIRS) {
            const n = G.neighbour(r, cx, cy, d);
            if (!n || G.getEdge(r, cx, cy, d) !== G.EDGE_OPEN) continue;
            const j = n.cy * W + n.cx;
            if (r.cells[j] === G.CELL_EMPTY || prev.has(j)) continue;
            prev.set(j, k); q.push(j);
          }
        }
      }
      if (path.length) {
        const k = path[0], c = G.cellCentre(k % W, (k / W) | 0);
        inp = { right: c.x - pc.x > 2, left: c.x - pc.x < -2, down: c.y - pc.y > 2, up: c.y - pc.y < -2 };
        if (!inp.right && !inp.left && !inp.down && !inp.up) { path.shift(); continue; }
      }
    }
    g.stairsLock = true;
    G.stepGame(g, inp, G.STEP);
    if (g.over) { deaths++; g.over = false; g.player.hp = 5; }   // keep going (count it)
  }
  return { seconds: steps * G.STEP, done: r.frontier.length === 0, deaths, kills: g.kills };
}

const mode = process.argv[2];

if (mode === "exit") {
  const n = +process.argv[3] || 25;
  for (const k of [6, 10, 14, 18]) {
    const G = loadGame(Object.assign({}, envOverrides, { EXIT_K: k }));
    const fr = [];
    for (let seed = 1; seed <= n; seed++) {
      const g = G.makeGame(1000 + seed, { startFloor: 1, enemies: false });
      hopExplore(G, g);
      fr.push(g.room.exit.atBuilt / g.room.buildable);
    }
    fr.sort((a, b) => a - b);
    const q = (p) => Math.round(fr[Math.min(fr.length - 1, Math.floor(p * fr.length))] * 100);
    console.log(JSON.stringify({ k, floors: n, p10: q(0.1), median: q(0.5), p90: q(0.9) }));
  }
} else if (mode === "size") {
  const cells = +process.argv[3], seed = +process.argv[4];
  const G = loadGame(envOverrides);
  const g = G.makeGame(seed, { startFloor: 1, floorCells: cells, enemies: false });
  const t0 = Date.now();
  const res = walkExplore(G, g, 8000, false);
  const r = g.room;
  console.log(JSON.stringify({ cells, seed, gameSeconds: Math.round(res.seconds), done: res.done,
    rooms: r.rooms.length, loops: r.loopCount, wideHalls: r.wideHalls.length, cpuSeconds: Math.round((Date.now() - t0) / 1000) }));
} else if (mode === "fight") {
  const cells = +process.argv[3], seed = +process.argv[4], enemies = process.argv[5] === "1";
  const G = loadGame(envOverrides);
  const g = G.makeGame(seed, { startFloor: 1, floorCells: cells, enemies });
  const res = walkExplore(G, g, 8000, true);
  console.log(JSON.stringify({ cells, seed, enemies, gameSeconds: Math.round(res.seconds), done: res.done, deaths: res.deaths, kills: res.kills }));
} else {
  console.log("usage: node tools/tune.js exit|size|fight ...");
}
