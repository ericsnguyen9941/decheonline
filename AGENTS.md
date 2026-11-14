# aoe1web

Browser remake of Age of Empires 1 (target: AoE1 + Rise of Rome 1.0a), deterministic lockstep, 2-player rooms by invite code. npm-workspaces TypeScript monorepo, Node >= 24.

## Layout
- `packages/sim` pure deterministic rules: no DOM, no Node, no deps.
- `packages/data` dat reader and typed rule set.
- `packages/protocol` client/server messages (`messages.ts` types, `codec.ts` validation).
- `packages/formats` DRS / SLP / palette decoders.
- `apps/client` Vite + PixiJS. `apps/server` Node + `ws` (`/health`; relay on WebSocket `/ws`, rooms in `src/rooms.ts`).
- `tools/` repo scripts (`check-tracked-files.mjs`). `docs/spec/` reverse-engineering specs. `e2e/` Playwright. `assets-local/` gitignored game files.

Packages are consumed as TypeScript source (`exports` -> `src/index.ts`); there is no per-package build step. The client is built by Vite, the server bundled by esbuild into `apps/server/dist/`.

## Commands
- `npm ci`: install. After it, once per machine: `npx playwright install chromium` (needed by `test:e2e` only).
- `npm run dev`: server (`:8787`, env `PORT`) + client (`:5173`, env `CLIENT_PORT`).
- `npm run build`: client and server bundles.
- `npm run check`: tracked-file guard, ESLint, typecheck, unit tests. Run before every commit.
- `npm test`: unit tests (Vitest) in every workspace; one workspace: `npm test -w @aoe/sim`.
- `npm run test:e2e`: Playwright; starts its own `npm run dev` on `:5273` / `:8887`.
- `AOE1_DIR=<install> npm run test:golden`: tests against real game files (skipped without `AOE1_DIR`); `@aoe/data` parses `data2/empires.dat` to its last byte.

## Standing rules
- Original game files never go in git. They live in `assets-local/` or under `AOE1_DIR`. `npm run guard` (part of `check`) fails if a `.drs .slp .dat .wav .mid .exe .dll` file or anything under `assets-local/` is tracked or staged.
- The decompiled source (github.com/dcostap/aoe1-decomp) is read to write `docs/spec/`, never pasted into the repo.
- `packages/sim` must not use `Math.random`, `Date` or transcendental `Math.*` (sin, cos, tan, pow, exp, log, sqrt, atan2, ...). ESLint enforces it (`eslint.config.js`); sim code uses its own deterministic helpers.
- Game numbers come from the original `empires.dat`, not wiki pages alone.

## Traps
- TypeScript is pinned to 6.0.x: typescript-eslint 8.x does not accept TypeScript 7 yet.
