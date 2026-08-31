# TLB Facility automated torture-test harness

This package is based on the current 3,772-line facility build.

## What changed in `index.ts`

Only testability plumbing was added:

- `FACILITY_DB_PATH` can point the engine at `:memory:` or a temporary SQLite file.
- `BOT_TEST_MODE=1` / `NODE_ENV=test` prevents a real Discord login when the module is imported by tests.
- `__test` exposes the **real production helpers** to `bun:test`, so tests do not duplicate work/damage logic.

Normal `bun run index.ts` behavior is unchanged when those test environment variables are not set.

## Install into your project

Copy:

- `index.ts` -> your project root `index.ts`
- `deploy-commands.ts` -> your project root `deploy-commands.ts`
- `tests/gameLogic.test.ts` -> `tests/gameLogic.test.ts`

`tests/_test-stubs.d.ts` is only used for the static TypeScript validation done while generating this package. You do **not** need it in a normal Bun project with real dependencies installed.

## Run

```bash
bun test
```

Or only this suite:

```bash
bun test tests/gameLogic.test.ts
```

## What it covers

The suite tests the real engine for:

- schema/table/column integrity
- SQL `?` placeholder vs `.run(...)` argument mismatches
- repeated schema bootstrap/migration safety
- slash-command registration names
- shift profiles and hard 22:00 stop
- production damage calculations (RED/WHITE/BLACK/PALE)
- traits and E.G.O. gift modifiers
- EXP/level progression
- real work success calculations and work-level risk
- qualitative work favor
- PE/NE display generation
- per-agent abnormality knowledge
- 2-PE work favor / 4-PE tips / 8-PE description unlocks
- private work history and observation confidence
- fake multiplayer relationships
- panic behavior, support, containment interference, and recovery
- quest-driven department unlock chain
- travel duration and persistence
- fake Discord category/channel repair and radio delivery
- ambient radio persistence
- meltdowns and timer breaches
- ordeals
- daily events
- spontaneous breach eligibility
- daily reset state
- deep serialization/restoration
- memory checkpoint retention and rewind
- abnormality event hooks

## Still requires a real Discord smoke test

Automation cannot fully prove Discord's external behavior. After this suite passes, manually smoke-test:

1. `/join`
2. `/start-game`
3. `/work` through dropdown -> work type -> level buttons
4. `/info` and its three buttons
5. `/radio mode:test`
6. `/departments` and `/travel`
7. one real suppression button
8. `/save`, mutate state, `/load`
9. restart the bot and verify channels were not duplicated

Those are mostly Discord API/UI checks; the engine underneath them is covered here.
