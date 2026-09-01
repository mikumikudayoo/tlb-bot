import { db } from '../../db/database';
import type {
  AbnormalityScript,
  FacilityEvent,
  FacilityEventContext,
  FacilityEventListener,
  WorkResult,
  WorkResultContext,
  WorkType
} from '../../types/game';
import { applyPanicState } from '../logic';

type FacilityEventSubscription = {
  guildId?: string;
  listener: FacilityEventListener;
};

const FACILITY_EVENT_SUBSCRIPTIONS = new Set<FacilityEventSubscription>();

function normalizeWorkResult(resultOrContext: WorkResult | WorkResultContext): WorkResult {
  if (typeof resultOrContext === 'string') return resultOrContext;
  return resultOrContext.result ?? 'normal';
}

function lowerQliphoth(abno: any, amount = 1) {
  abno.qliphoth = Math.max(0, Number(abno.qliphoth ?? 0) - amount);
  if (abno.qliphoth <= 0 && Number(abno.can_breach ?? 1)) {
    abno.is_breaching = 1;
  }
  return abno.qliphoth;
}

function raiseQliphoth(abno: any, amount = 1) {
  const max = Number(abno.max_qliphoth ?? abno.qliphoth ?? 0);
  abno.qliphoth = Math.min(max, Number(abno.qliphoth ?? 0) + amount);
  return abno.qliphoth;
}

export function subscribeFacilityEvents(
  listener: FacilityEventListener,
  options: { guildId?: string } = {}
): () => void {
  const subscription: FacilityEventSubscription = {
    listener,
    ...(options.guildId ? { guildId: options.guildId } : {})
  };
  FACILITY_EVENT_SUBSCRIPTIONS.add(subscription);
  return () => FACILITY_EVENT_SUBSCRIPTIONS.delete(subscription);
}

function dispatchFacilityEventListener(
  listener: FacilityEventListener,
  event: FacilityEvent,
  context: FacilityEventContext,
  messages: string[],
  source: string
) {
  try {
    const message = listener(event, context);
    if (typeof message === 'string' && message.trim()) messages.push(message);
  } catch (error) {
    console.error(`[facility-event-bus] ${source} failed for ${event.type} in guild ${context.guildId}`, error);
  }
}

export function emitFacilityEvent(guildId: string, event: FacilityEvent): string[] {
  const messages: string[] = [];

  const baseContext: FacilityEventContext = {
    guildId,
    abnormality: null,
    db,
    event
  };

  // Snapshot subscriptions so listeners may safely subscribe or unsubscribe
  // while an event is being delivered without changing the current dispatch.
  for (const subscription of [...FACILITY_EVENT_SUBSCRIPTIONS]) {
    if (subscription.guildId && subscription.guildId !== guildId) continue;
    dispatchFacilityEventListener(subscription.listener, event, baseContext, messages, 'subscriber');
  }

  const abnormalities = db.query(`SELECT * FROM abnormalities WHERE guild_id = ? ORDER BY id`).all(guildId) as any[];

  for (const abnormality of abnormalities) {
    const scriptId = abnormality?.script_id;
    if (!scriptId) continue;

    const script = ABNORMALITY_SCRIPTS[scriptId];
    if (!script?.onFacilityEvent) continue;

    dispatchFacilityEventListener(
      script.onFacilityEvent,
      event,
      { ...baseContext, abnormality },
      messages,
      `abnormality script ${scriptId}`
    );
  }

  return messages;
}

export const ABNORMALITY_SCRIPTS: Record<string, AbnormalityScript> = {
  'F-01-02': {
    onWorkStart: (agent: any, abno: any) => {
      if (agent.status === 'stressed' || agent.status === 'panicked' || agent.status === 'traumatized') {
        agent.status = 'idle';
        agent.sp = Math.max(agent.sp, Math.floor(agent.max_sp * 0.7));
        return {
          cancelled: false,
          message: `🔥 **MATCHLIGHT:** ${abno.name} soothes ${agent.name}'s mind and restores ${Math.max(0, Math.floor(agent.max_sp * 0.7))} SP.`
        };
      }
      return null;
    },
    onWorkEnd: (_agent: any, abno: any, _workType: WorkType, resultOrContext: WorkResult | WorkResultContext) => {
      const result = normalizeWorkResult(resultOrContext);
      let destabilized = false;
      if (result === 'normal' && Math.random() < 0.5) {
        lowerQliphoth(abno);
        destabilized = true;
      }
      if (result === 'bad' && Math.random() < 0.7) {
        lowerQliphoth(abno);
        destabilized = true;
      }
      if (!destabilized) return null;
      return abno.qliphoth <= 0
        ? `🔥 **MATCHLIGHT COLLAPSES:** ${abno.name}'s containment state has fallen to zero.`
        : `🔥 **MATCHLIGHT:** ${abno.name}'s Qliphoth Counter falls to **${abno.qliphoth}/${abno.max_qliphoth}**.`;
    }
  },
  'O-03-03': {
    onWorkStart: (agent: any, abno: any) => {
      if (agent.status === 'stressed' || agent.status === 'panicked' || agent.status === 'traumatized') {
        agent.status = 'idle';
        const restoredTo = Math.floor(agent.max_sp * 0.7);
        agent.sp = Math.max(agent.sp, restoredTo);
        return {
          cancelled: false,
          message: `✨ **ABSOLUTION:** ${abno.name} calms ${agent.name}'s mind, restoring **${agent.sp}/${agent.max_sp}** SP.`
        };
      }
      return null;
    }
  },
  'O-01-04': {
    onWorkEnd: (_agent: any, abno: any, _workType: WorkType, resultOrContext: WorkResult | WorkResultContext) => {
      const result = normalizeWorkResult(resultOrContext);
      if (result === 'bad') {
        lowerQliphoth(abno);
        return abno.qliphoth <= 0
          ? `💔 **HATRED OVERCOMES HER:** ${abno.name}'s Qliphoth Counter reached zero.`
          : `💔 **HYSTERIA:** ${abno.name} grows increasingly unstable. Qliphoth: **${abno.qliphoth}/${abno.max_qliphoth}**.`;
      }
      if (Number(abno.qliphoth) >= Number(abno.max_qliphoth)) {
        return `💖 **MAGICAL GIRL'S BLESSING:** the room steadies and the handler feels restored.`;
      }
      if (Number(abno.qliphoth) === 1 && result === 'good') {
        raiseQliphoth(abno);
        return `✨ **HOPE RESTORED:** ${abno.name} regains her composure.`;
      }
      return null;
    }
  },
  'T-04-06': {
    onWorkStart: (agent: any, abno: any) => {
      if (abno.last_worked_by && String(abno.last_worked_by) === String(agent.discord_id)) {
        agent.hp = 0;
        agent.status = 'dead';
        return {
          cancelled: true,
          message: `🧸 **A FAMILIAR EMBRACE:** ${abno.name} recognizes ${agent.name}. The session ends immediately.`
        };
      }
      return null;
    }
  },
  'T-01-31': {
    onWorkEnd: (_agent: any, abno: any, _workType: WorkType, resultOrContext: WorkResult | WorkResultContext) => {
      const result = normalizeWorkResult(resultOrContext);
      if (result === 'normal') {
        return `🎼 **INTERMISSION:** ${abno.name} remains still. The performance has not begun.`;
      }
      lowerQliphoth(abno);
      if (abno.qliphoth <= 0) {
        return `🎹 **THE CURTAINS RISE:** ${abno.name}'s Qliphoth Counter reached zero. The first note arrives in the dark.`;
      }
      return `🎼 **AN IMPERFECT SILENCE:** a ${result.toUpperCase()} result disturbs the concerto. Qliphoth: **${abno.qliphoth}/${abno.max_qliphoth}**.`;
    }
  },
  'O-05-47': {
    onWorkStart: (agent: any, abno: any, _workType: WorkType) => {
      if (agent.assignments > 0 && (agent.assignments % 3 === 0)) {
        abno.rage = Math.min((abno.rage ?? 0) + 1, 10);
        return {
          cancelled: false,
          message: `👁️ **OBSERVED TOO LONG:** ${abno.name} grows more restless under scrutiny, and its escape pressure spikes with each repeated glance.`
        };
      }
      return null;
    }
  },
  'O-02-56': {
    onCombat: (agent: any, _abno: any) => {
      agent.status = 'dead';
      agent.hp = 0;
      return { agentDamage: 0, abnoDamage: 9999 };
    }
  },
  'O-02-62': {
    onWorkStart: (agent: any, abno: any) => {
      const guilt = (agent.kills ?? 0) + Math.max(0, 6 - (agent.fortitude ?? 0)) + (agent.assignments > 10 ? 2 : 0);
      if (guilt >= 8) {
        agent.status = 'dead';
        agent.hp = 0;
        return {
          cancelled: true,
          message: `🪶 **JUDGEMENT PASSED:** ${abno.name} sees ${agent.name} as irredeemable.`
        };
      }
      return null;
    }
  },
  'O-05-76': {
    onWorkStart: (agent: any, abno: any) => {
      if (agent.assignments > 0 && agent.assignments % 3 === 0) {
        abno.rage = Math.min((abno.rage ?? 0) + 1, 10);
        lowerQliphoth(abno);
        return {
          cancelled: false,
          message: `👁️ **OBSERVED TOO LONG:** ${abno.name} notices the attention. The space behind its casing feels colder.`
        };
      }
      return null;
    }
  },
  'T-06-27': {
    onWorkEnd: (_agent: any, abno: any, _workType: WorkType, resultOrContext: WorkResult | WorkResultContext) => {
      const result = normalizeWorkResult(resultOrContext);
      if (result === 'bad') {
        abno.rage = Math.min((abno.rage ?? 0) + 2, 10);
        return `🎯 **STRAY BULLET:** ${abno.name} fires a wandering shot through the facility, rattling nearby staff and lowering the containment mood.`;
      }
      return null;
    }
  },
  'T-01-68': {
    onWorkStart: (agent: any, abno: any) => {
      const lowJustice = Number(agent.justice ?? 1) <= 2;
      const excessiveFortitude = Number(agent.fortitude ?? 1) >= 4;
      if (lowJustice || excessiveFortitude) {
        lowerQliphoth(abno);
        return {
          cancelled: false,
          message: `🦋 **A SOLEMN WARNING:** ${abno.name} is dissatisfied with ${agent.name}; Qliphoth falls to **${abno.qliphoth}/${abno.max_qliphoth}**.`
        };
      }
      return null;
    },
    onWorkEnd: (_agent: any, abno: any, _workType: WorkType, resultOrContext: WorkResult | WorkResultContext) => {
      const result = normalizeWorkResult(resultOrContext);
      if (result === 'bad' && Math.random() < 0.8) {
        lowerQliphoth(abno);
        return `🦋 **THE PROCESSION STIRS:** the poor result destabilizes containment further.`;
      }
      return null;
    }
  },
  'F-01-69': {
    onWorkEnd: (agent: any, abno: any, _workType: WorkType, resultOrContext: WorkResult | WorkResultContext) => {
      const result = normalizeWorkResult(resultOrContext);
      const justiceTooLow = Number(agent.justice ?? 1) < 3;
      if (justiceTooLow || result === 'normal' || result === 'bad') {
        lowerQliphoth(abno);
        if (result === 'bad') {
          abno.rage = Math.min(Number(abno.rage ?? 0) + 2, 10);
        }
        return `🎯 **MAGIC BULLET:** ${abno.name}'s containment counter drops.`;
      }
      return null;
    }
  },
  'O-06-20': {
    onWorkStart: (agent: any, abno: any) => {
      if ((agent.fortitude ?? 1) < 4) {
        agent.status = 'dead';
        agent.hp = 0;
        return {
          cancelled: true,
          message: `💀 **FATAL ERROR:** ${agent.name} did not have the Fortitude to comprehend ${abno.name}.`
        };
      }
      return null;
    }
  },
  'DO-NOT-TOUCH': {
    onWorkStart: (agent: any, abno: any) => {
      const guildId = agent?.guild_id ?? '';
      if (guildId) {
        db.query(`UPDATE abnormalities SET is_breaching = 1, rage = 10 WHERE guild_id = ?`).run(guildId);
      }
      agent.sp = 0;
      applyPanicState(agent);
      return {
        cancelled: true,
        message: `🛑 **████████ ERROR: CATASTROPHIC CONTAINMENT FAILURE ████████**\n\n*You shouldn't have touched that.*\n\n**${agent.name}** triggered **Don't Touch Me**. Every single containment unit in the facility has instantly blown its locks.`
      };
    }
  }
};
