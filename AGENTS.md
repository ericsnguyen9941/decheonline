# aoe1web

Browser remake of Age of Empires 1 (target: AoE1 + Rise of Rome 1.0a), deterministic lockstep, 2-player rooms by invite code. npm-workspaces TypeScript monorepo, Node >= 24.

## Layout
- `packages/sim` pure deterministic rules: no DOM, no Node, no deps. Units: `units.ts` (dat numbers per unit type, checked against the real dat by `packages/data/src/units.golden.test.ts`), `movement.ts` + `pathing.ts` (docs/spec/movement.md; §13 vectors in `movement.test.ts`), `trig.ts` (deterministic atan2/sin/cos); `unit-data.ts` is generated (`AOE1_DIR=<install> npm run gen:sim-tables` runs `tools/gen-sim-tables.mjs` over `renderSimTables` in `packages/data/src/sim-tables.ts`; edit ROOTS in the tool to add types; the golden test regenerates and diffs it); `buildings.ts` (placement, destructables, construction, costs, production queue and train action; docs/spec/economy.md §4-6; vectors E2-E4 in `buildings.test.ts`), `techs.ts` (tech states, effect engine), `build.ts` (action 101); `world.ts` `startingUnits` places 3 Villagers per player, `new_game` attributes and the commands `build`/`queue`/`cancel` (queue and cancel ignore another player's objects but still draw their rand()).
- `packages/data` dat reader and typed rule set.
- `packages/protocol` client/server messages (`messages.ts` types, `codec.ts` validation).
- `packages/formats` DRS / SLP / palette decoders, `pe-strings.ts` (RT_STRING tables of language.dll / languagex.dll).
- `apps/client` Vite + PixiJS (`src/net` relay link, `src/lobby` lobby session + DOM, `src/lockstep` turn loop over `@aoe/sim`, `src/map` isometric map renderer over `@aoe/sim` `TileMap` (`?debug=map&col=&row=` draws the fixed test map without a lobby; `window.__map`; middle-button drag scrolls), `src/units` draws every sim object from `e.sprite` (units, TC, trees, mines, animals), selection (left click / box) and right-click orders (`work` on the object under the pointer by pixel hit test, else `move`), `src/hud` game screen panels in the original layout and art (`game-hud.ts`, `layout.ts`, spec docs/spec/hud.md) with the resource counts, `cursors.ts` the original mouse cursors; selection marker (diamond + hp bar) is drawn by `src/units`, `src/multiplayer.ts` wiring; games start from `startingObjects`; `?debug=net&speed=20` exposes `window.__game` (units, objects, resources, `resourcesAt(turn, player)`, `issueMove`, `issueWork`, selection) and `window.__map`; Vite proxies `/ws` and `/assets`). `apps/server` Node + `ws` (`/health`; relay on WebSocket `/ws`, rooms in `src/rooms.ts`).
- `tools/` repo scripts (`check-tracked-files.mjs`); `tools/assets-import` (`@aoe/assets-import`) turns an install into the pack in `assets-local/pack/` (format: `src/manifest.ts`; graphics, terrain, border and interface (`interfac.drs`, `data2` overriding) SLPs, PNG atlas per SLP, one per player owner when it has player colour; `empires.dat` copied; `manifest.strings` the language strings, which the HUD reads through `hud/text.ts`, ids in docs/spec/hud.md). Server serves it at `/assets/*` (env `ASSETS_DIR`), client `src/assets/` loads it (`?debug=assets`). `docs/spec/` reverse-engineering specs. `e2e/` Playwright. `assets-local/` gitignored game files.

Packages are consumed as TypeScript source (`exports` -> `src/index.ts`); there is no per-package build step. The client is built by Vite, the server bundled by esbuild into `apps/server/dist/`.

## Commands
- `npm ci`: install. After it, once per machine: `npx playwright install chromium firefox webkit` (needed by `test:e2e` only; the determinism test runs all three).
- `npm run dev`: server (`:8787`, env `PORT`) + client (`:5173`, env `CLIENT_PORT`).
- `npm run build`: client and server bundles.
- `npm run check`: tracked-file guard, ESLint, typecheck, unit tests. Run before every commit.
- `npm test`: unit tests (Vitest) in every workspace; one workspace: `npm test -w @aoe/sim`.
- `npm run test:e2e`: Playwright; starts its own `npm run dev` on `:5273` / `:8887`. `npm run test:e2e -- determinism`: one sim replay hashed in Node, Chromium, Firefox and WebKit.
- `AOE1_DIR=<install> npm run assets:import`: build the pack (~8 s, ~100 MB). Then `AOE1_DIR=<install> npm run test:e2e:real -w @aoe/e2e` (local-only screenshot to `assets-local/screenshots/`).
- `AOE1_DIR=<install> npm run test:golden`: tests against real game files (skipped without `AOE1_DIR`); `@aoe/data` parses `data2/empires.dat` to its last byte.
- `AOE1_DIR=<install> npm run dat:dump -- unit 83`: print a record from `data2/empires.dat` (`unit|tech|graphic|terrain|effect|civ <id>`, `summary`; no vitest).

## Standing rules
- Original game files never go in git. They live in `assets-local/` or under `AOE1_DIR`. `npm run guard` (part of `check`) fails if a `.drs .slp .dat .wav .mid .exe .dll` file or anything under `assets-local/` is tracked or staged.
- The decompiled source (github.com/dcostap/aoe1-decomp) is read to write `docs/spec/`, never pasted into the repo.
- `packages/sim` must not use `Math.random`, `Date` or transcendental `Math.*` (sin, cos, tan, pow, exp, log, atan2, ...; `Math.sqrt` is allowed, it is correctly rounded). ESLint enforces it (`eslint.config.js`); sim code uses its own deterministic helpers.
- Game numbers come from the original `empires.dat`, not wiki pages alone.

## Traps
- Playwright's Firefox (159, v1572) does not start on macOS 27 ("Could not find profile folder"). Run the e2e suite in the matching Linux image: `docker run --rm --name aoe1online-<worktree>-pw -v "$PWD":/src:ro mcr.microsoft.com/playwright:v1.65.1-noble bash -c 'mkdir /work && tar -C /src --exclude=node_modules -cf - . | tar -C /work -xf - && cd /work && npm ci && npm run test:e2e -- determinism'`.
- TypeScript is pinned to 6.0.x: typescript-eslint 8.x does not accept TypeScript 7 yet.
- `window.__game.applied()` lists a batch when it is received; `World.addBatch` runs it `COMMAND_DELAY_TURNS` (2) turns later. An e2e that waits on `applied()` must also wait 2 more turns before reading unit state (`e2e/tests/move.spec.ts` `settle`).
- A new `window.__game` hook must also be typed in `e2e/globals.d.ts`, or `npm run check` fails on the e2e typecheck.
