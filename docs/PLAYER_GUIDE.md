# facility player guide

make energy, meet the quota, and try to get everyone home alive. check an abnormality's info before sending someone in.

based on *A Guide to Tuantu's Lobotomization Branches!* by Pandawanwan (25 May 2025). this guide covers the discord version; some rules differ from the original game.

## getting started

new here? start with `/join`. you can come back to `/help` whenever you need it, or pick a topic for the details. only you can see the reply, and you don't need an agent to read it.

1. `/join` makes your agent. the manager starts the facility with `/start-game`.
2. check `/status` for health, sanity and gear. `/stats` has your stat points, LOB, PE, cards and department rank.
3. use `/work` to pick an abnormality, work type and level. nobody else can use your work prompt.
4. check what you've learned with `/info abnormality:NAME`.
5. something escaped? use the buttons on its breach alert. for ordeals, use `/ordeal action:fight`.
6. clear any breaches and ordeals before `/end-day`.

work moves the clock from 08:00 to 22:00. **08:00 is your training window**, so spend your LOB before anyone starts working. at 22:00, no more work can start.

## abnormalities and work

| risk | color | danger |
| --- | --- | --- |
| ZAYIN | green | lowest |
| TETH | blue | low |
| HE | yellow | moderate |
| WAW | purple | high |
| ALEPH | red | highest |

each abnormality has its own preferences and rules. the right work type helps, but it won't save you from breaking a rule that kills your agent. check your health, gear and work level too.

| work | trained stat | color |
| --- | --- | --- |
| instinct | fortitude | red |
| insight | prudence | white |
| attachment | temperance | black |
| repression | justice | pale |

finish a work alive with at least one positive box to earn **+1 to the matching stat**. leveling up also gives +1 to a random stat. higher work levels are riskier.

working also teaches you about that abnormality:

- each work type can give you two observations. two reveal its preference, four total reveal tips, and eight reveal everything.
- positive boxes from work you survive give you **PE tied to that exact abnormality**. even two copies of the same abnormality have separate balances.
- spending PE doesn't erase what you've learned. another player's observations and the shared codex don't count as your own.

## stats, LOB and cards

stats normally cap at **100**. the manager can research `extended_stats` to raise that to **150**. the **Break Your Limits** card adds another 25, for a cap of 125 or 175.

you get Break Your Limits once you survive a work at level 5 or above. you can only get it once per agent; it's the only card available right now.

you start with **10 personal LOB** and earn **10 more** for each day you survive with the quota met. your LOB pays for training and gear. the facility has a separate balance for upgrades and research.

```text
/lob stat:fortitude
/train agent:@player stat:prudence
```

training costs **5 personal LOB for up to +5 points**, only at 08:00. use `/lob` for yourself; the manager can use `/train` for someone else, paid from that agent's LOB. near the cap you'll get fewer points for the same price. already capped? you won't be charged. dead or working agents can't train.

combat uses stat tiers: 1–20 points is tier 1, 21–40 is tier 2, and so on. health, sanity and abnormality stat checks use those tiers. older agents' tier 1–5 stats convert to 20–100 points once. `/stats` shows your base points; `/status` includes gear and gift effects.

## E.G.O. equipment and gifts

use `/ego` to see the gear list. `/ego item:penitence` buys and equips Penitence. already own it? equipping it again is free.

| item id | fully observed source | personal LOB | source PE |
| --- | --- | ---: | ---: |
| penitence | One Sin and Hundreds of Good Deeds | 10 | 3 |
| penitence_suit | One Sin and Hundreds of Good Deeds | 10 | 3 |
| mimicry | Nothing There | 25 | 8 |
| mimicry_suit | Nothing There | 25 | 8 |

you need **your own 8/8 observation record**, enough personal LOB, and PE from that same abnormality. bought gear stays in your inventory and saves; a failed purchase costs nothing. only the items listed above are available for extraction right now.

| incoming damage | effect |
| --- | --- |
| RED | damages HP |
| WHITE | damages SP |
| BLACK | damages both HP and SP, not divided between them |
| PALE | percentage of maximum HP, followed by modifiers and a matching shield |

**lower suit multipliers are better**: 0.5 means half damage, 1.5 means one and a half times damage. traits and gifts can change damage too. enemies only have HP, so WHITE weapons still hurt them; PALE weapons deal a percentage of their maximum HP.

gifts can drop from suppression. the chance is 15% + 5% per risk tier, up to 55%, and you can't own duplicates. check `/gifts` before equipping one with `/equip-gift gift:NAME`: some have drawbacks as well as bonuses.

## stims and research

research is manager-only and costs facility LOB. `/research` lists the projects; `/research project:NAME` buys one.

| project | required department | facility LOB | unlock |
| --- | --- | ---: | --- |
| welfare_stims | welfare | 50 | health and sanity stims |
| command_shields | command | 50 | red, white and black shields |
| extended_stats | training | 100 | 150-point base stat limit |

use `/stim type:health`, `/stim type:sanity` or pick a shield color. health and sanity stims restore 25% of your maximum. using one at full health or sanity won't waste it. a sanity stim also clears panic or trauma and puts your agent into recovery.

shields block **25 damage** of their own color. red won't block BLACK. pale shields block HP damage after the percentage is worked out, not 25 percentage points.

**pale shields need both `command_shields` research and a cleared Command/Tiphereth core.** having charges in an old save doesn't skip the unlock.

buying research gives you the supplies it unlocks. each new day refills health/sanity stims to two each and unlocked shields to one each. active shields reset too. after clearing Command's core, pale charges come with your next refill. you can't use stims while dead or working.

## meltdowns and ordeals

after someone finishes work, a meltdown alarm can target up to three abnormalities if no alarm is already active. the timer is **two completed works**, and the work that triggers it counts as the first tick. it isn't a real-time countdown.

work on a marked abnormality to defuse its timer. let it expire and its Qliphoth drops to zero. abnormalities that can't breach still won't escape, but their other effects may trigger.

| stage | meltdown level | possible colors | shared HP |
| --- | ---: | --- | ---: |
| dawn | 1 | amber, crimson, green, violet | 100 |
| noon | 2 | green, indigo | 200 |
| dusk | 3 | green | 400 |
| midnight | 4 | green | 800 |

each stage can happen once per day, with only one ordeal active at a time. meltdown level triggers them, not your energy total.

check `/ordeal`, then use `/ordeal action:fight` to attack with your equipped weapon. it hits back: violet damages sanity, the others damage HP. there's a short cooldown between attacks. everyone chips away at the same health bar; bring it to zero before ending the day.

ordeals here are shared fights, without the original game's moving enemies, minions or full boss patterns.

## departments and core suppression

check `/departments` for quests and routes. `/travel department:NAME` starts a trip; completed works advance your travel time. travelling doesn't heal you.

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

Architecture isn't available.

finish each department's quest to open the next:

1. Control: collect 40 energy → Information.
2. Information: fully document three unique abnormalities → Security.
3. Security: suppress two breaches → Training.
4. Training: complete three stat-training purchases → Command.
5. Command: finish six quota-met days → Disciplinary.
6. Disciplinary: suppress five breaches → Welfare.
7. Welfare: finish five good works stationed there → Extraction.
8. Extraction: buy three previously unowned E.G.O. items → Record.
9. Record: finish three quota-met days.

quests only count progress after their department opens. Extraction is the exception: gear you already own counts toward its quest too.

survive work while stationed in a department to build your service rank: level 1 to start, level 2 at 5 works, level 3 at 15, and captain at 30. ranks don't give combat bonuses.

once a department's quest is done, the manager can start `/core department:NAME`. only one core can be active. clear it with **five good works that you survive while stationed there**. Information's core hides `/info`, its buttons, `/stats`, `/history` and `/work-history` until you finish; it doesn't touch server messages.

clearing a core stops that department's Qliphoth meltdowns permanently and removes any active timers there. abnormalities can still escape through their usual rules. clearing Command also unlocks pale shields if you've researched them.

cores use the five-work challenge here, not the original boss fights. Information is currently the only one with an extra challenge effect.

## recruitment and manager tests

the manager can use `/recruit` to see **three offers**, then `/recruit choice:1 department:control` to take one. pick an unlocked department to house it. you get one pick per day on top of the starter abnormalities, and reopening the menu won't reroll the offers.

some abnormalities have working special effects but no finished stats yet. those use placeholder HE stats and don't come with extractable gear. their displayed risk may not match the original game.

`/abno-test` lets the manager add, breach, contain or reset abnormalities for testing. save first or use a test server. **DO-NOT-TOUCH still does what it says.** containing something with this command doesn't count toward suppression quests.

## panic, death and saves

at zero sanity, your agent panics. their strongest stat affects how they behave, and leaving them like that can lead to trauma. use a sanity stim if you have one unlocked. there's no command to kill panicked staff.

**first or second death:** `/join` revives your agent.

**third death:** your agent's stats, gear, currency, cards, ranks and personal records are wiped. your next `/join` starts fresh. shared facility history stays.

the manager's `/save`, `/load` and `/rewind` cover agents and facility progress: gear, PE, research, cores, recruitment and ordeals. loading an earlier save also rolls back deaths since that save.

older saves use defaults for anything they don't have. an unfinished old-style ordeal becomes a Dawn encounter. old pooled PE doesn't become spendable abnormality PE; you'll need to earn that through work.
