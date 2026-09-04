# facility player guide

produce Enkephalin (shown as **energy**), meet the daily quota, keep agents alive and suppress containment failures. read management information before taking risks.

this bot adapts the supplied *A Guide to Tuantu's Lobotomization Branches!* by Pandawanwan (25 May 2025). the excerpt describes systems but not every price, formula or challenge. bot-specific balance choices are identified below; this is not a claim of exact parity with the original game.

## getting started

read this guide inside Discord with `/help`. choose `/help topic:…` for work, stats, E.G.O., stims, ordeals, departments, recruitment or death and saves. replies are private to you; joining first is not required.

1. `/join` creates your agent; the manager uses `/start-game`.
2. `/status` shows health, sanity and gear. `/stats` shows base stat points, personal LOB, PE balances, cards and department service rank.
3. `/work` offers abnormality, work-type and level choices. only the prompt's owner can use it.
4. `/info abnormality:NAME` reveals your personal observations.
5. suppress breaches through their alert buttons; fight ordeals with `/ordeal action:fight`.
6. `/end-day` moves to the next day. active breaches and ordeals must be cleared first.

work advances the clock from 08:00 toward 22:00. no new work begins after 22:00. the opening **08:00 phase is the bot's intermission**: spend training LOB before the first work of that day.

## abnormalities and work

| risk | color | danger |
| --- | --- | --- |
| ZAYIN | green | lowest |
| TETH | blue | low |
| HE | yellow | moderate |
| WAW | purple | high |
| ALEPH | red | highest |

preferences, agent condition, work level, equipment and scripts all matter. a favorable work type cannot cancel a special execution condition.

| work | trained stat | guide color |
| --- | --- | --- |
| instinct | fortitude | red |
| insight | prudence | white |
| attachment | temperance | black |
| repression | justice | pale |

a survived, completed work with a positive box grants **one point to its matching stat**. EXP still levels agents; promotion grants one extra random stat point. higher work levels increase risk.

observation and spending are separate:

- each work type records up to two unique observations.
- two observations of a work type reveal its preference; four total reveal tips; eight fully reveal the abnormality.
- positive boxes from survived work also build **spendable PE for that exact abnormality instance**.
- buying gear does not erase observations. other players' knowledge, other sources' PE and the shared codex cannot pay for your extraction.

## stats, LOB and cards

the base stat cap is **100**. manager research `extended_stats` raises it to **150**. **Break Your Limits** adds 25, allowing 125 or 175.

bot adaptation: that card is awarded after a survived work at agent level 5 or higher, once per agent. the source is uncertain about card acquisition; other card effects have not been invented.

new agents receive **10 personal LOB**. every quota-complete day awards **10 personal LOB to each surviving agent**. this is separate from shared facility LOB, which funds upgrades and research.

```text
/lob stat:fortitude
/train agent:@player stat:prudence
```

both purchase up to **+5 points for 5 of that agent's personal LOB**, only at 08:00. `/train` is manager-only; `/lob` trains yourself. near the cap, gain is limited to available room. at the cap, no currency is consumed. dead or working agents cannot train.

existing combat/script balance uses tiers: each 20-point band becomes one tier, rounded up. old 1–5-tier agents map to 20–100 points on first progression use, without repeated conversion. HP/SP, gifts and script checks retain the bot's existing tier-based balance. `/stats` shows base point progress; `/status` includes equipment and gift effects.

## E.G.O. equipment and gifts

`/ego` lists extractable items. `/ego item:penitence` buys and equips one; selecting an owned item re-equips it for free.

| item id | fully observed source | personal LOB | source PE |
| --- | --- | ---: | ---: |
| penitence | One Sin and Hundreds of Good Deeds | 10 | 3 |
| penitence_suit | One Sin and Hundreds of Good Deeds | 10 | 3 |
| mimicry | Nothing There | 25 | 8 |
| mimicry_suit | Nothing There | 25 | 8 |

you need **your own 8/8 record** and enough PE from the same source instance. extraction permanently adds gear to inventory and equips it. failed purchases consume nothing. gear survives restart and saves. no source-to-gear data means **no extractable gear**; a behavior script alone does not supply equipment metadata.

| incoming damage | effect |
| --- | --- |
| RED | damages HP |
| WHITE | damages SP |
| BLACK | damages both HP and SP, not divided between them |
| PALE | percentage of maximum HP, followed by modifiers and a matching shield |

**lower suit multipliers mean better resistance**: 0.5 reduces damage; 1.5 increases it. this corrects the contradictory resistance sentence in the supplied excerpt. traits, gifts and suit defense also modify damage. enemies use HP; WHITE weapons still damage enemies, and PALE weapons scale from enemy maximum HP.

configured gifts remain suppression drops. the existing bot uses 15% + 5% per risk tier, capped at 55%, prevents duplicate ownership, and preserves each gift's benefits/drawbacks. these are bot rates, not guide rarity data. inspect `/gifts`; equip with `/equip-gift gift:NAME`.

## stims and research

the manager uses `/research` to list projects or `/research project:NAME` to buy one.

| project | required department | facility LOB | unlock |
| --- | --- | ---: | --- |
| welfare_stims | welfare | 50 | health and sanity stims |
| command_shields | command | 50 | red, white and black shields |
| extended_stats | training | 100 | 150-point base stat limit |

use `/stim type:health`, `/stim type:sanity` or a shield color. health/sanity restore 25% of the corresponding maximum. a full pool does not waste a charge. sanity recovery clears panic metadata and puts panicked/traumatized staff into recovery.

shields absorb **25 actual damage points** of their own color. red shields do not protect against BLACK. pale shields absorb damage after percentage conversion, not percentage points.

**pale requires command_shields research AND the Command/Tiphereth core challenge.** research gates apply even if an older save has charges.

research issues an unlocked loadout. new days refill health/sanity to two each and researched shields to one each, and clear active shields. pale charges arrive with the next loadout after the core unlock. dead or working agents cannot use stims.

## meltdowns and ordeals

after each completed facility-wide work, the bot attempts a new alarm if none is active. up to three targets receive a **two-work-action timer**; the triggering action consumes the first tick. these are actions, not real seconds. working a targeted abnormality defuses its current timer. expiry drops Qliphoth to zero; non-breaching abnormalities do not gain fake breach flags, though scripts may react to the counter event.

| stage | meltdown level | possible colors | shared HP |
| --- | ---: | --- | ---: |
| dawn | 1 | amber, crimson, green, violet | 100 |
| noon | 2 | green, indigo | 200 |
| dusk | 3 | green | 400 |
| midnight | 4 | green | 800 |

stages occur once each per day, one active at a time. energy alone no longer spawns ordeals. `/ordeal` shows the encounter; `/ordeal action:fight` uses equipped gear and receives retaliation. violet attacks sanity; the other current encounters retaliate physically. attacks have a short cooldown. zero shared HP suppresses the encounter; unresolved encounters block ending the day.

the color pools follow the guide. levels, HP and damage are **Discord adaptations**, paced to fit a shift. these are simplified shared encounters, not full color-specific movement/minion/boss simulations.

## departments and core suppression

`/departments` shows quests, routes, layers and Sephirot. `/travel department:NAME` takes work-driven phases; it neither teleports nor heals you.

| layer | department | Sephirah |
| --- | --- | --- |
| Asiyah | control | Malkuth |
| Asiyah | information | Yesod |
| Asiyah | training | Hod |
| Asiyah | security | Netzach |
| Briah | command | Tiphereth A and B |
| Briah | disciplinary | Gebura |
| Briah | welfare | Chesed |
| Atziluth | extraction | Binah |
| Atziluth | record | Hokma |

Architecture remains unavailable, as in the guide. keyboard/mobile controls and elevator music do not apply to the bot.

the bot unlock chain and objectives are:

1. Control: collect 40 energy → Information.
2. Information: fully document three unique abnormalities → Security.
3. Security: suppress two breaches → Training.
4. Training: complete three stat-training purchases → Command.
5. Command: finish six quota-met days → Disciplinary.
6. Disciplinary: suppress five breaches → Welfare.
7. Welfare: finish five good works stationed there → Extraction.
8. Extraction: buy three previously unowned E.G.O. items → Record.
9. Record: finish three quota-met days.

only unlocked departments earn quest progress, except Extraction also counts existing owned catalogue gear when it opens. service rank counts survived work while stationed in a department: level 1 initially, level 2 at 5 assignments, level 3 at 15 and captain at 30. ranks are titles, not added combat buffs.

after completing its quest, the manager can start `/core department:NAME`. one challenge can be active. **five good, survived works while stationed in that department** clear it. the Information challenge obscures `/info`, its buttons, `/stats`, `/history` and `/work-history`; Discord chat is not deleted or modified.

clearing a core permanently prevents that department's Qliphoth meltdowns, including already assigned timers. it does not prevent scripted breaches or natural escape. Command unlocks eligibility for pale shields.

these five-work challenges are an explicit stand-in for full Sephirah bosses. the excerpt lacks most win conditions; only the Information visibility effect has a distinct implementation.

## recruitment and manager tests

`/recruit` gives the manager **three persistent offers**. `/recruit choice:1 department:control` accepts one and places it in an unlocked sector. one acceptance is allowed per day; reopening the menu does not reroll it. recruitment supplements the existing starter set.

configured templates retain their balance. registry-only ids from `src/game/abnormalities/scripts.ts` use generic HE test stats with real behavior hooks, not invented canonical metadata or gear.

`/abno-test` bypasses normal pacing for debugging: add, breach, contain or reset. dangerous scripts such as `DO-NOT-TOUCH` remain dangerous. use a separate facility or a save first. debug containment does not earn suppression quest credit.

## panic, death and saves

zero sanity enters panic. dominant stats influence behavior; unsupported panic can progress to trauma. the guide's advice about killing panicked staff is not an extra player command.

after death one or two, `/join` revives your agent. the third death wipes the active agent's stats, inventory, wallets, cards, service ranks and personal records; the next `/join` starts fresh. shared facility history stays. manager saves/checkpoints are explicit rollback snapshots and can restore earlier game state, including earlier deaths.

`/save`, `/load` and `/rewind` include progression, equipment, source PE, research, cores, recruitment offers and ordeal state. old saves lacking new fields use legacy defaults; active legacy placeholder ordeals become playable Dawn encounters. old aggregate PE cannot be reliably assigned to a source, so it is not converted into source-specific spending balances.
