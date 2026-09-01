import type { WorkType, StatName } from '../types/game';

export const WORK_TYPES: Record<WorkType, { stat: StatName; icon: string; label: string }> = {
  instinct: { stat: 'fortitude', icon: 'Instinct', label: 'instinct' },
  insight: { stat: 'prudence', icon: 'Insight', label: 'insight' },
  attachment: { stat: 'temperance', icon: 'Attachment', label: 'attachment' },
  repression: { stat: 'justice', icon: 'Repression', label: 'repression' }
};

export function getWorkType(type: WorkType) {
  return WORK_TYPES[type]!;
}
