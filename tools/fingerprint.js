// Behaviour fingerprint for Project Minos.
// Plays a fixed, seeded run headlessly and hashes the resulting state, so a
// cleanup that is meant to change nothing can prove it changed nothing.
//   node tools/fingerprint.js          print the fingerprint
//   node tools/fingerprint.js save     store it in tools/fingerprint.txt
//   node tools/fingerprint.js check    compare with the stored one (exit 1 if different)
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const src = fs.readFileSync(path.join(__dirname, "..", "project-minos.html"), "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src + "\n;this.G = { makeGame, stepGame, STEP, cellCentre, serializeGame, gameFromSave, switchArea, setDifficulty, respawnAtCheckpoint };", ctx);
const G = ctx.G;

const hash = crypto.createHash("sha256");
const feed = (x) => hash.update(typeof x === "string" ? x : JSON.stringify(x));
const ents = (g) => [g.player, ...g.skeletons].map((e) => [e.id, Math.round(e.x * 100), Math.round(e.y * 100), e.hp]);

// 1) Arena combat with scripted input, every difficulty.
for (const d of [0, 0.5, 1]) {
  const g = G.makeGame(11, { area: "arena" });
  G.setDifficulty(g, d);
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let inp = {};
  for (let i = 0; i < 3600; i++) {
    if (i % 20 === 0) inp = { up: rnd() < 0.4, down: rnd() < 0.4, left: rnd() < 0.4, right: rnd() < 0.4 };
    G.stepGame(g, Object.assign({}, inp, { attack: i % 9 === 0 }), G.STEP);
    if (g.over) G.respawnAtCheckpoint(g), G.switchArea(g);
    if (i % 300 === 0) feed(ents(g));
  }
  feed([g.kills, g.player.hp]);
}

// 2) The maze: walk out of floor 0, then hop through floors 1-4 with skeletons on.
const g = G.makeGame(23);
const onExit = () => { const [tx, ty] = g.room.exit.tiles[0]; g.player.x = (tx + 0.5) * 32 - 11; g.player.y = (ty + 0.5) * 32 - 11; G.stepGame(g, {}, G.STEP); };
for (let i = 0; i < 120; i++) G.stepGame(g, { down: true, left: i > 90 }, G.STEP);   // wander floor 0 (not onto the stairs)
onExit();
for (let n = 1; n <= 4; n++) {
  const r = g.room;
  for (let k = 0; k < 20000 && r.frontier.length; k++) {
    const f = r.frontier[k % Math.max(1, r.frontier.length)].from, c = G.cellCentre(f.cx, f.cy);
    g.player.x = c.x - 11; g.player.y = c.y - 11;
    G.stepGame(g, { attack: k % 7 === 0 }, G.STEP);
    if (g.over) { G.respawnAtCheckpoint(g); break; }
    if (k % 200 === 0) feed(ents(g));
  }
  if (g.floorNum !== n) break;
  feed([n, r.builtCount, r.loopCount, r.rooms.length, r.wideHalls.length, r.exit && r.exit.tiles]);
  onExit();
}

// 3) Save, load, and the full saved state.
const text = G.serializeGame(g);
feed(JSON.parse(text).floors);
const loaded = G.gameFromSave(text, 99);
feed([loaded.floorNum, loaded.checkpointFloor, loaded.deepestFloor, loaded.skeletons.length, ents(loaded)]);

const fp = hash.digest("hex").slice(0, 16);
console.log("(covered floors " + [...g.floors.keys()].join(",") + "; deepest " + g.deepestFloor + "; kills " + g.kills + ")");
const file = path.join(__dirname, "fingerprint.txt");
const mode = process.argv[2];
if (mode === "save") { fs.writeFileSync(file, fp + "\n"); console.log("saved " + fp); }
else if (mode === "check") {
  const want = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : null;
  if (want === fp) { console.log("identical " + fp); }
  else { console.log("DIFFERENT: now " + fp + ", stored " + want); process.exit(1); }
} else console.log(fp);
