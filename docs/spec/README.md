# docs/spec — behaviour specs for the simulation

These files describe how Age of Empires (Rise of Rome) behaves, so that
`packages/sim` can reproduce it. They are written from reading the community
decompilation and are the only place its knowledge enters this repository.

## Source

- Decompilation: `github.com/dcostap/aoe1-decomp`, pinned at commit `6d6d8b1`.
  Clone it **outside** this repo, at `../ref/aoe1-decomp` (that is,
  `/Users/erics/workspace/aoe1online/ref/aoe1-decomp`).
- Per-function match status lives in the clone at
  `config/functions/src/<file>.cpp.json` (`matching`, `accepted_drift`,
  `accepted_logic`, `nonmatching`; meanings in the clone's `README.md`).

## Rules for writing a spec

1. **Read, never paste.** Describe behaviour in prose, tables, formulas and
   pseudo-steps in our own words. No block of decompiled code longer than 3
   lines; prefer none. Short identifiers (`RGE_Game_World::update`,
   `random_seed`) and constants are fine.
2. **Reference format:** `src/<file>.cpp:<line>` or
   `include/<file>.h:<line>`, relative to the clone root at `6d6d8b1`; a
   range is `file:start-end`. A function is named `Class::method` with the
   line of its definition. Every behavioural claim carries a reference or is
   marked `unverified`.
3. **Status:** when a claim rests on one function, give its match status
   (`M` matching, `D` accepted_drift, `L` accepted_logic, `N` nonmatching).
   `L` and `N` bodies were not byte-proven; treat them as weaker evidence.
4. **Implications for the port** (what `packages/sim` must do) are marked as
   such and kept apart from what the code does.

## Version caveat: beta, not 1.0a

The decompilation is of the **17 July 1998 beta** of Rise of Rome
(`empiresx.exe` with `age1_x1.pdb`), not the retail RoR 1.0a on AoE 1.0c that
this project targets. Its author reports no known logic differences but has
not compared them. Expect differences mostly in data (`empires.dat` values,
new civs/techs), which we take from the retail data files anyway; logic is
assumed equal until a retail recording disproves it. Any spec point that
looks version-sensitive is flagged `beta-only?`.

Code outside the decomp source (the static VC5 C runtime, e.g. `rand`) is not
in the clone; specs that depend on it say so.

## Files

- `INDEX.md` — subsystem → decomp files/functions map with match status.
- `core.md` — update loop, time step, turns and command scheduling, numeric
  types, RNG.
- `movement.md` — movement and pathing.
- `economy.md` — gather, drop-off, build, train.
- `combat.md` — attacks, damage, projectiles, line of sight.
- `techs.md` — techs and the effect engine.
- `support-actions.md` — convert, heal, repair, trade.
- `victory.md` — victory conditions and score.
- `random-maps.md` — random map generation.
- `unit-ai.md` — idle behaviour, auto-attack, reactions.
