# Project Minos

A top-down dungeon crawler. Each floor is a maze generated as you explore it; the stairs down can appear anywhere, more likely the more of the floor you've explored.

## Play

Open `project-minos.html` in a browser.

- WASD or arrow keys to move, Space to swing
- M for the map (the game keeps running while it's open)
- The game saves automatically; Shift+N twice starts a new game
- R returns you to your checkpoint after dying
- Testing: T toggles the skeleton test arena, where 1-5 set skeleton difficulty

## Tools (Node, headless)

- `node tools/test.js`: the full test suite (about a minute)
- `node tools/fingerprint.js check`: plays a fixed seeded run and compares its hash with `tools/fingerprint.txt`. Use it to prove a cleanup changed nothing. `save` stores a new fingerprint after an intended behaviour change.
- `node tools/tune.js exit|size|fight ...`: tuning runs (exit timing per k, time to explore a floor, fighting overhead). Results from Nov 2026 are in `tools/results/`.
