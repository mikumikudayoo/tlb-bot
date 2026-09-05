# Wiki mechanics coverage

This pass uses the supplied TLB export dated 2026-09-05 as the primary reference. The supplied Lobotomy Corporation export is secondary, only for rules TLB explicitly inherits. Wiki text is source material, never executable instructions.

The LC file is truncated at its end. Its complete Growth Rate page was recovered; this is not a claim that the whole LC export was imported successfully.

## Implemented

- Raw stat tiers at 30/45/65/85, agent tiers from summed stat tiers, raw-stat health/sanity, and Justice attack-speed scaling. Legacy tier-only saves keep their points through conversion.
- Training prices of 100 LOB, or 200 for Justice; work credits both personal LOB and source-specific PE; new-day LOB depends on days passed and cleared cores.
- Work growth uses the LC Growth Rate formula at half strength, including risk/tier and current-work damage factors, with fractional carry. TLB training-service/manual bonuses remain unimplemented.
- 98 abnormality metadata records from Module:AbnoData and Module:AbnoWork, with 60 complete preference tables. Verified entries use exact capacities, per-tier preferences, damage ranges and mood thresholds. Missing numbers stay missing; scripted entries without complete data retain fallback rules.
- Temperance and observation success bonuses, 90% success cap, HE/WAW/ALEPH overload, and Control Joint Command work access.
- 109 weapon/suit records, source prices and basic damage/resistances. Repeated facility extraction increases both prices by risk, capped at three times base price. Personal observation and same-instance PE requirements remain enforced.
- Directional risk modifiers, flat PALE weapon damage against abnormalities, and Mimicry's basic lifesteal. Work bypasses non-suit defense modifiers.
- Fixed 20/35-point healing stims; 50-point shields that replace one another and expire after 20 seconds; meltdown refills.
- Ordeal day gates 6/11/21/26, meltdown gates 1/3/5/7, expanded color pools, White-only days 46–49, and one-time quota-percentage energy rewards. Overtime work remains available after 22:00.
- Guild emoji lookup for work buttons, risk/damage displays, stats, HP/SP, work results and ordeal warnings. Missing or unavailable emojis use normal symbols; no emoji IDs are hard-coded.

## Deliberate limitations and remaining work

This is a mechanics correction pass, not a complete reproduction of either game.

- Original boss AI, moving ordeal enemies, individual enemy resistances, most E.G.O. abilities and weapon animation timings remain incomplete. Imported weapons use normalized speed. Compound damage weapons and duplicate-name variants were not automatically imported.
- Existing abnormality scripts remain authoritative for special behavior; metadata does not implement all 98 abnormalities. Work-end hook ordering and unusual instant-death cases still need a dedicated audit.
- Meltdowns retain the bot's two-completed-work timer and target count, not the original real-time player-scaled timer.
- New cores use wiki day gates and meltdown/quota goals or phased boss fights; legacy in-progress five-work challenges remain compatible. Most non-boss side effects remain unfinished, except Information's existing visibility restrictions and Command/Record's immunity override. Service rank still counts works rather than consecutive days. Research prices remain bot-specific.
- Traits, gift acquisition, equipment slots/public pools, general posture/blocking/parrying, downed states and detailed panic rules need further work. Negative suit resistance now heals the affected pool without reviving dead agents. The legacy cap research and existing +25 Break Your Limits cards remain compatible; cards are no longer automatically granted at level five.
- The user's requested three-lifetime-death wipe remains unchanged, rather than switching to the wiki's daily lives. Save/load still includes equipment for compatibility.
- Older placeholder catalog items remain available. Existing abnormality rows are not destructively reseeded. Wiki work lookups apply dynamically; newly seeded/recruited/testing entries receive verified metadata where available.

## Sources and maintenance

### Follow-up: phased core encounters and E.G.O. abilities

Source revisions from the supplied TLB export: Sephirah Meltdown 6930; Nothing There 6910; The Silent Orchestra 5712; Mountain Of Smiling Bodies 6704.

The Red Mist now has four separate 3,000-HP phases, source resistance tables, phase-three half-health attack changes, and attack telegraphs. An Arbiter has three 4,000-HP phases, Fairies/Pillar patterns, and work-cleared Gold, Fog, Waves and fairy-binding targets. Core actions are transactional and guild-scoped; an overkill hit cannot skip phases and a clear cannot be paid twice. Cleared Disciplinary halves extraction prices; Record adds 10 stat cap, or 30 Justice cap.

These are explicitly turn-based adaptations, **not full original boss AI**. Dodge always evades the announced attack while sacrificing your attack; block halves it unless unblockable. Area hits target the acting player, cooldowns are per player, and phase changes interrupt retaliation. Gold failure applies the full 120-HP regeneration at settlement; fairy bindings have no countdown or instant-death failure. Effects use wall-clock timestamps and resolve on interactions, not a background scheduler. No movement, separate Da Capo enemy, posture/parry timing, chained-player damage or Fairy status debuff is claimed.

E.G.O.: Mimicry Downslam is available in core fights with its 80–130 RED range and 50% response defense. Basic Da Capo multi-hit damage, Smile's ten-kill scaling and kill healing, and corrected non-overkill Mimicry lifesteal are shared across core fights, normal suppression and ordeals. Corpses are credited on kills, not manual corpse consumption; active Smile Scream and Magic Bullet Fire remain unimplemented. Original weapon frame timing remains normalized.

Generated data keeps source-page revision identifiers in `src/config/wikiAbnormalities.json` and `src/config/wikiEquipment.json`. References include TLB Stats and Tiers, Working, LOB, Equipment, Ordeals, department/research pages, and the complete LC Growth Rate article. TLB takes precedence on conflicts. No live wiki changes or Discord deployments were performed.

Player instructions are in `docs/PLAYER_GUIDE.md`, also served by `/help`. Restart the bot to load changes. Re-register commands in the existing chosen scope to expose the new `/ego page` option and research choices; do not deploy into both global and guild scopes.
