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

work moves the clock from 08:00 to 22:00. **08:00 is your training window**, so spend your LOB before anyone starts working. you can keep working overtime at 22:00.

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

surviving work trains its matching stat. growth depends on positive boxes, stat tier, abnormality risk and damage taken during that work; fractional progress carries over. verified wiki entries use their box capacity, tier-specific preferences and mood thresholds. older entries still use fallback work rules.

each positive box also earns one personal LOB and one PE tied to that abnormality. work outside your department needs Control's `joint_command` research (legacy General agents are exempt). repeated HE/WAW/ALEPH works add 2/4/6 percentage points of overload, lowering the success cap until the next meltdown.

working also teaches you about that abnormality:

- each work type can give you two observations. two reveal its preference, four total reveal tips, and eight reveal everything.
- positive boxes from work you survive give you **PE tied to that exact abnormality**. even two copies of the same abnormality have separate balances.
- spending PE doesn't erase what you've learned. another player's observations and the shared codex don't count as your own.

## stats, LOB and cards

stats normally cap at **100**. the manager can research `extended_stats` to raise that to **150**. the **Break Your Limits** card adds another 25, for a cap of 125 or 175.

existing Break Your Limits cards still work, but reaching level 5 no longer awards one automatically. the original game's trait-choice system isn't implemented yet; these cap upgrades are legacy bot rules.

you start with **10 personal LOB**. new-day rewards are **5 × days passed + 10 × cleared facility cores**. your LOB pays for training and gear. the facility has a separate balance for upgrades and research.

```text
/lob stat:fortitude
/train agent:@player stat:prudence
```

training costs **100 personal LOB for up to +5 points**, or **200 for justice**, only at 08:00. use `/lob` for yourself; the manager can use `/train` for someone else, paid from that agent's LOB. near the cap you'll get fewer points for the same price. already capped? you won't be charged. dead or working agents can't train.

stat tiers advance at **30, 45, 65 and 85 points**. agent level comes from the sum of all four stat tiers, advancing at totals **6, 10, 14 and 18**; EXP no longer gives random stat upgrades. base HP equals fortitude and base SP equals prudence. justice improves attack speed. older tier-only agents convert to 20–100 raw points once. `/stats` shows your raw points.

## E.G.O. equipment and gifts

use `/ego` to see the gear list, and `/ego page:2` for more. `/ego item:penitence` buys and equips Penitence. already own it? equipping it again is free. the catalogue now includes 109 imported weapon/suit entries alongside legacy gear.

| item id | fully observed source | personal LOB | source PE |
| --- | --- | ---: | ---: |
| penitence | One Sin and Hundreds of Good Deeds | 10 | 3 |
| penitence_suit | One Sin and Hundreds of Good Deeds | 10 | 3 |
| mimicry | Nothing There | 280 | 280 |
| mimicry_suit | Nothing There | 160 | 160 |

you need **your own 8/8 observation record**, enough personal LOB, and PE from that same abnormality. bought gear stays in your inventory and saves; a failed purchase costs nothing. each new facility extraction increases that item's price by 10/20/30/40/50% of its base price for ZAYIN/TETH/HE/WAW/ALEPH, capped at 3×. `/ego` shows the current price. most special weapon abilities and original attack timings are not implemented yet.

| incoming damage | effect |
| --- | --- |
| RED | damages HP |
| WHITE | damages SP |
| BLACK | damages both HP and SP, not divided between them |
| PALE | percentage of maximum HP, followed by modifiers and a matching shield |

**lower suit multipliers are better**: 0.5 means half damage, 1.5 means one and a half times damage. equipment-versus-target risk also modifies damage. traits and gifts can change combat damage, but their defense modifiers do not reduce work damage. enemies only have HP, so WHITE weapons still hurt them; PALE weapons deal flat damage against abnormalities.

gifts can drop from suppression. the chance is 15% + 5% per risk tier, up to 55%, and you can't own duplicates. check `/gifts` before equipping one with `/equip-gift gift:NAME`: some have drawbacks as well as bonuses.

## stims and research

research is manager-only and costs facility LOB. `/research` lists the projects; `/research project:NAME` buys one.

| project | required department | facility LOB | unlock |
| --- | --- | ---: | --- |
| welfare_stims | welfare | 50 | health and sanity stims |
| command_shields | command | 50 | red, white and black shields |
| extended_stats | training | 100 | 150-point base stat limit |
| joint_command | control | 50 | work outside your department |
| improved_stims | welfare | 50 | 35-point healing stims |

use `/stim type:health`, `/stim type:sanity` or pick a shield color. health and sanity stims restore **20 points**, or **35** with `improved_stims`. using one at full health or sanity won't waste it. a sanity stim also clears panic or trauma and puts your agent into recovery.

shields block **50 damage** of their own color for **20 seconds**. a new shield replaces the previous one; they don't stack. red won't block BLACK. pale shields block HP damage after the percentage is worked out, not 50 percentage points.

**pale shields need both `command_shields` research and a cleared Command/Tiphereth core.** having charges in an old save doesn't skip the unlock.

buying research gives you the supplies it unlocks. each new day and meltdown refills researched stims. active shields reset on a new day too. after clearing Command's core, pale charges come with your next refill. you can't use stims while dead or working.

## meltdowns and ordeals

after someone finishes work, a meltdown alarm can target up to three abnormalities if no alarm is already active. the timer is **two completed works**, and the work that triggers it counts as the first tick. it isn't a real-time countdown.

work on a marked abnormality to defuse its timer. let it expire and its Qliphoth drops to zero. abnormalities that can't breach still won't escape, but their other effects may trigger.

| stage | meltdown level | possible colors | shared HP |
| --- | ---: | --- | ---: |
| dawn | 1 | amber, crimson, green, violet | 100 |
| noon | 3 | green, indigo, violet | 200 |
| dusk | 5 | green, amber | 400 |
| midnight | 7 | green, amber | 800 |

each stage can happen once per day, with only one ordeal active at a time. dawn/noon/dusk/midnight unlock on days **6/11/21/26**. suppressing them awards **10/15/20/25% of quota** in energy, once. days 46–49 use White ordeals exclusively.

check `/ordeal`, then use `/ordeal action:fight` to attack with your equipped weapon. it hits back: violet deals BLACK damage, the others currently use RED. there's a short cooldown between attacks. everyone chips away at the same health bar; bring it to zero before ending the day.

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

once a department's quest is done, the manager can start `/core department:NAME` at 08:00. only one core can be active. upper-layer cores unlock on day 20, middle-layer cores on day 35, and lower-layer cores on day 41. new cores cannot start from day 46 onward. everyone can inspect `/core`.

Control, Information, Training and Security require meltdown 6 and quota; Command requires 10, Welfare 8, and Record 11. finish any active ordeal before the core can clear. Disciplinary and Extraction require defeating their bosses instead. an already-running five-work challenge from an old save keeps its old goal.

Information's core hides `/info`, its buttons, `/stats`, `/history` and `/work-history`; it doesn't touch server messages. Command and Record temporarily override cleared departments' meltdown immunity. the other non-boss core side effects are still unfinished.

clearing a core stops that department's Qliphoth meltdowns permanently and removes any active timers there. abnormalities can still escape through their usual rules. clearing Command also unlocks pale shields if you've researched them.

clearing Disciplinary halves extraction prices. Record raises the cap by 10 for fortitude, prudence and temperance, and 30 for justice. several other original core rewards remain unfinished. a day cannot end while a core is active; use an earlier save if you need to abandon the attempt.

## core boss encounters

start with `/core department:disciplinary` for the Red Mist, or `/core department:extraction` for An Arbiter. only the manager starts fights, but every living, sane agent who isn't working or travelling can participate.

- `/core` shows the current phase, HP, next attack and any marked containment units.
- `/core action:fight` attacks and takes the boss's response.
- `/core action:block` gives up your attack to halve incoming damage. unblockable attacks ignore it.
- `/core action:dodge` gives up your attack to evade the telegraphed attack. active Waves still hurt.
- `/core action:ability` uses Mimicry's Downslam: 80–130 RED base damage and 50% defense for the response. other active weapon abilities aren't wired yet.

these are turn-based encounters, not frame-timed combat. phases, counters, special targets and your action cooldown save with the facility. one large hit cannot skip a phase. crossing into a new phase interrupts the previous attack.

**the Red Mist** has four separate 3,000-HP phases and changes resistances each phase. her attacks progress through Red Eyes/Penitence, Smile/Justitia, Da Capo/Mimicry (including the half-health Great Splits), and Twilight. phase four's hunt leaves a ten-second opening. portal movement, Da Capo's separate summoned enemy, full stagger mechanics and some secondary attacks aren't simulated yet.

**An Arbiter** has three separate 4,000-HP phases. work the IDs listed by `/core` using the normal work menu; surviving a completed work clears that target.

- Gold: clear every target to stun her for 12–20 seconds, depending on living agent count. expires after 60 seconds; failure restores 120 HP at the next combat action instead of regenerating gradually.
- Dark Fog: clear every target to change her resistance to 1.5 for 25 seconds, then 0.4. the initial resistance is 0.1. expires after 60 seconds.
- Waves: BLACK chip damage during combat actions until the targets are cleared; no countdown.
- Bounding of Fairies: phase-three immunity until every target is cleared. **untimed in this bot**, without the original 30-second instant-death penalty.

Binah uses two containment targets when available. pillar movement, Lock, Chain, the Fairy status debuff and facility-wide attacks remain unfinished. attack cadence and target count are Discord adaptations. timed effects are checked on actions and aren't suspended by pausing the shift.

Mimicry heals 25% of actual damage dealt, not overkill. Da Capo resolves its four 5–6 WHITE hits plus a 6–7 finisher as one attack. Smile starts at 12–18 BLACK, increases with kills up to 36–42 at ten kills, and heals 25% max HP on a kill. these basic weapon effects also work in ordinary suppression and ordeals. none can revive a dead attacker.

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
