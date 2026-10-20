import type { FlowProgress, IntegrationEntry } from '../../ha/management';
export const attentionFlow = (entry: IntegrationEntry, progress: FlowProgress[]) =>
  progress.find(
    (flow) =>
      flow.handler === entry.domain &&
      flow.context?.entry_id === entry.entry_id &&
      ['reauth', 'reconfigure'].includes(flow.context.source ?? ''),
  );
export const entryNeedsAttention = (entry: IntegrationEntry, progress: FlowProgress[] = []) =>
  !entry.disabled_by &&
  (['setup_error', 'migration_error', 'setup_retry', 'failed_unload'].includes(entry.state) ||
    Boolean(attentionFlow(entry, progress)));
