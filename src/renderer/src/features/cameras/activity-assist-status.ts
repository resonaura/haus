import type { ActivityStatus } from '../../ha/camera-settings';
export type { ActivityStatus } from '../../ha/camera-settings';

/** Explain the server's actual placement decision, including before the user opts in. */
export function activityPlacementNotice(status: ActivityStatus) {
  if (status.placement === 'nvr')
    return {
      warning: false,
      title: status.processor ?? 'NVR cluster',
      description: 'Automatically chooses the least-loaded available NVR node.',
    };
  if (status.placement !== 'home') return undefined;
  const processor = status.processor || 'Home Assistant';
  const reason = {
    no_nodes: 'No NVR nodes are connected.',
    no_analysis_nodes: 'No NVR node is available for video analysis.',
    nodes_unavailable: 'Your NVR nodes are unavailable.',
    nodes_busy: 'Your NVR nodes are busy or recovering.',
  }[status.fallbackReason ?? 'no_nodes'];
  const capacity =
    status.blocked === 'unsupported'
      ? ' This installation cannot run local analysis. Connect a compatible NVR node to use Activity assist.'
      : status.blocked === 'capacity'
        ? ' Analysis waits when there is not enough capacity.'
        : ' A compatible NVR node will take over when one is available.';
  return {
    warning: true,
    title:
      status.blocked === 'unsupported' ? 'An NVR node is needed' : `Video analysis on ${processor}`,
    description: `${reason} ${status.blocked === 'unsupported' ? 'Without one, video analysis would use' : 'When enabled, video analysis uses'} ${processor} and can put significant load on this device.${capacity}`,
  };
}
