import type { Database } from 'bun:sqlite';

export type WorkType = 'instinct' | 'insight' | 'attachment' | 'repression';
export type StatName = 'fortitude' | 'prudence' | 'temperance' | 'justice';
export type DamageType = 'RED' | 'WHITE' | 'BLACK' | 'PALE';
export type DepartmentName = 'general' | 'control' | 'information' | 'security' | 'training' | 'command' | 'disciplinary' | 'welfare' | 'extraction' | 'record';
export type AgentStatus = 'idle' | 'working' | 'injured' | 'stressed' | 'panicked' | 'traumatized' | 'recovering' | 'dead';
export type UpgradeType = 'containment' | 'research' | 'security' | 'welfare';
export type Behaviour = 'docile' | 'possessive' | 'volatile' | 'predatory';
export type PanicBehaviorKey = 'wander' | 'breach_seeking' | 'lockdown' | 'hostile';

export type FacilityData = {
  guild_id: string;
  energy: number;
  quota: number;
  dictator_mode: number;
  manager_id: string;
  is_started: number;
  is_paused: number;
  day_count: number;
  phase: number;
  category_id: string | null;
  control_channel_id?: string | null;
  containment_channel_id: string | null;
  status_channel_id?: string | null;
  radio_channel_id?: string | null;
  research: number;
  lob_points: number;
  containment_level: number;
  security_level: number;
  welfare_level: number;
  event_seed: number;
  stable_days: number;
  current_sector?: string;
};

export type AgentRow = {
  discord_id: string;
  guild_id: string;
  name: string;
  hp: number;
  max_hp: number;
  sp: number;
  max_sp: number;
  weapon: string;
  suit: string;
  status: AgentStatus;
  level: number;
  fortitude: number;
  prudence: number;
  temperance: number;
  justice: number;
  experience: number;
  trait: string;
  recovery_days: number;
  assignments: number;
  kills: number;
  promotions: number;
  death_count?: number;
  progression?: string;
  ego_gifts?: string;
  equipped_gift?: string;
  department?: string;
  auto_response?: string;
  travel_origin?: string;
  travel_destination?: string;
  travel_remaining?: number;
  panic_turns?: number;
  panic_behavior?: string;
  stat_limit?: number;
  pe_boxes?: number;
  stim_charges?: string;
  shield_red?: number;
  shield_white?: number;
  shield_black?: number;
  shield_pale?: number;
};

export type AbnormalityRow = {
  id: number;
  guild_id: string;
  name: string;
  risk: string;
  hp: number;
  max_hp: number;
  qliphoth: number;
  max_qliphoth: number;
  damage_type: string;
  damage_amt: number;
  is_breaching: number;
  work_instinct: number;
  work_insight: number;
  work_attachment: number;
  work_repression: number;
  escape_chance: number;
  behaviour: Behaviour;
  description: string;
  rage: number;
  breaches: number;
  suppressed_count: number;
  last_worked_by?: string;
  work_streak?: number;
  gift_id?: string;
  current_work_process?: string;
  meltdown_timer?: number;
  meltdown_state?: string;
  can_breach?: number;
  is_tool?: number;
  script_id?: string;
};

export type WorkResult = 'good' | 'normal' | 'bad';

export type WorkResultContext = {
  result: WorkResult;
  peBoxes: number;
  neBoxes: number;
  workLevel: number;
  previousQliphoth: number;
};

export type FacilityEvent =
  | { type: 'work_started'; agentId: string; abnormalityId: number; workType: WorkType }
  | { type: 'work_finished'; agentId: string; abnormalityId: number; result: WorkResultContext }
  | { type: 'agent_panicked'; agentId: string }
  | { type: 'agent_died'; agentId: string }
  | { type: 'abnormality_breached'; abnormalityId: number }
  | { type: 'abnormality_suppressed'; abnormalityId: number }
  | { type: 'qliphoth_changed'; abnormalityId: number; oldValue: number; newValue: number }
  | { type: 'phase_changed'; from: number; to: number }
  | { type: 'day_started'; day: number }
  | { type: 'day_ended'; day: number };

export type FacilityEventContext = {
  guildId: string;
  abnormality: any | null;
  db: Database;
  event: FacilityEvent;
};

export type FacilityEventListener = (
  event: FacilityEvent,
  context: FacilityEventContext
) => string | null | void;

export type AbnormalityScript = {
  onWorkStart?: (agent: any, abno: any, workType: WorkType) => { cancelled: boolean; message: string } | null;
  onWorkEnd?: (agent: any, abno: any, workType: WorkType, resultOrContext: WorkResult | WorkResultContext) => string | null;
  onCombat?: (agent: any, abno: any, agentDamage: number) => { agentDamage: number; abnoDamage: number } | null;
  onFacilityEvent?: FacilityEventListener;
};

export type GiftDef = {
  id: string; name: string; icon: string; sourceAbno: string; drawback: string;
  statBonus?: Partial<Record<StatName, number>>;
  workChanceBonus?: Partial<Record<WorkType, number>>;
  incomingDamageMult?: number;
  maxSpMult?: number;
};
