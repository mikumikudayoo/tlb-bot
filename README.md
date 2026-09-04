# TLB Discord facility bot

work abnormalities, manage agents, research gear and stims, and suppress emergencies.

## player documentation

read [the player guide](docs/PLAYER_GUIDE.md) for commands, stat and E.G.O. rules, ordeal stages, department quests, core challenges and differences from the supplied Tuantu guide.

## run locally

use Bun with the project's installed dependencies. provide DISCORD_TOKEN in a local .env; never commit it.

```powershell
bun run index.ts
```

the default database is facility.sqlite; FACILITY_DB_PATH selects another path. **back up your database before updating** and stop the bot before replacing code or making a consistent database backup. migrations add fields without deleting agents. restart to load new mechanics.

register the changed slash commands separately:

```powershell
bun run deploy-commands.ts YOUR_SERVER_ID --global-only
```

this keeps global commands and removes duplicate server-local commands in the named server. for a dedicated test bot, --guild-only instead keeps commands in that server **and removes global commands everywhere**. do not switch scopes casually. deployment updates Discord registrations, not running bot code; restart the bot too.

## verification

```powershell
bunx tsc --noEmit
bun test
bun test tests/progression.test.ts
```

tests use an in-memory database and disable Discord login. bootstrap tests use isolated temporary databases. never point tests at production.

- tests/gameLogic.test.ts covers production math, guild isolation, script events, panic, routing, saves, startup and prompt ownership.
- tests/progression.test.ts covers point migration/caps, personal LOB, source-specific E.G.O., persistence, shields/research, department/core rules, ordeal progression and recruitment, including fake-interaction command checks.

new rules live in src/game/progression.ts and the command adapter in src/discord/progressionCommands.ts. the older engine is still partly in index.ts; this is not a complete monolith extraction.

## live smoke test after deployment

1. /join, /stats, /lob stat:fortitude at 08:00.
2. /work through the owner-bound prompts; inspect /stats and /info.
3. fully observe a source, buy and re-equip /ego item:penitence, restart and check /status.
4. exercise /research, /stim, /core and /ordeal in a test facility.
5. view /recruit twice, accept once, verify a second acceptance is rejected.
6. /save, change progression, /load, verify personal and facility state.

automated tests cannot verify live Discord command propagation, cached menus or channel permissions. no live deployment is performed by tests. the player guide explicitly marks simplified encounters and details absent from the supplied source.
