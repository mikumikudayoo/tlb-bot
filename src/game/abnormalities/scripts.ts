import { db } from '../../db/database';
import type { AbnormalityScript, WorkType } from '../../types/game';
import { applyPanicState } from '../logic';

export const ABNORMALITY_SCRIPTS: Record<string, AbnormalityScript> = {
  'F-01-02': {
    onWorkStart: (agent: any, abno: any, workType: WorkType) => {
      if (agent.status === 'stressed' || agent.status === 'panicked' || agent.status === 'traumatized') {
        agent.status = 'idle';
        agent.sp = Math.max(agent.sp, Math.floor(agent.max_sp * 0.7));
        return {
          cancelled: false,
          message: `✨ **DIVINE ABSOLUTION:** ${abno.name} eases ${agent.name}'s mind, restoring ${Math.max(0, Math.floor(agent.max_sp * 0.7))} SP and washing away the emotional residue.`
        };
      }
      return null;
    }
  },
  'T-06-27': {
    onWorkEnd: (agent: any, abno: any, workType: WorkType, result: 'good' | 'normal' | 'bad') => {
      if (result === 'bad') {
        abno.rage = Math.min((abno.rage ?? 0) + 2, 10);
        return `🎯 **STRAY BULLET:** ${abno.name} fires a wandering shot through the facility, rattling nearby staff and lowering the containment mood.`;
      }
      return null;
    }
  },
  'O-05-47': {
    onWorkStart: (agent: any, abno: any, workType: WorkType) => {
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
  'O-02-62': {
    onWorkStart: (agent: any, abno: any, workType: WorkType) => {
      const guilt = (agent.kills ?? 0) + Math.max(0, 6 - (agent.fortitude ?? 0)) + (agent.assignments > 10 ? 2 : 0);
      if (guilt >= 8) {
        agent.status = 'dead';
        agent.hp = 0;
        return {
          cancelled: true,
          message: `🪶 **JUDGEMENT PASSED:** ${abno.name} sees ${agent.name} as irredeemable. The bird's verdict is swift and final.`
        };
      }
      return null;
    }
  },
  'DO-NOT-TOUCH': {
    onWorkStart: (agent: any, abno: any, workType: WorkType) => {
      const guildId = agent?.guild_id ?? '';
      if (guildId) {
        db.query(`UPDATE abnormalities SET is_breaching = 1, rage = 10 WHERE guild_id = ?`).run(guildId);
      }

      agent.sp = 0;
      applyPanicState(agent);

      return {
        cancelled: true,
        message: `🛑 **████████ ERROR: CATASTROPHIC CONTAINMENT FAILURE ████████**\n\n*You shouldn't have touched that.*\n\n**${agent.name}** triggered **Don't Touch Me**. Every single containment unit in the facility has instantly blown its locks. Good luck. 🩸`
      };
    }
  },
  'O-06-20': {
    onWorkStart: (agent: any, abno: any, workType: WorkType) => {
      if (agent.fortitude < 4) {
        agent.status = 'dead';
        agent.hp = 0;
        return {
          cancelled: true,
          message: `💀 **FATAL ERROR:** ${agent.name} did not have the Fortitude to comprehend Nothing There. The entity consumed their existence and left only an empty shell behind.`
        };
      }
      return null;
    }
  },
  'O-02-56': {
    onCombat: (agent: any, abno: any, agentDamage: number) => {
      agent.status = 'dead';
      agent.hp = 0;
      return { agentDamage: 0, abnoDamage: 9999 };
    }
  }
};
