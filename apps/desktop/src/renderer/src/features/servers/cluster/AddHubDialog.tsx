/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useState } from 'react';
import { Box, Pressable, Text } from '@haus/ui';
import {
  AddClusterHubModal,
  Dialog,
  type AddClusterHubSubmitInput,
  type AddClusterHubSubmitResult,
  type DiscoveredClusterHubCandidate,
} from '@haus/ui/components';
import { ChevronRight, Server } from 'lucide-react';
import { serverRequest } from '../server-api';

export function AddServerMenuDialog({
  onClose,
  onSelectHub,
  onSelectNvr,
  onSelectSsh,
}: {
  readonly onClose: () => void;
  readonly onSelectHub?: () => void;
  readonly onSelectNvr: () => void;
  readonly onSelectSsh: () => void;
}) {
  return (
    <Dialog title="Add a server" onClose={onClose}>
      <Text semantic="p" className="registry-help">
        Choose how you want to connect this machine.
      </Text>
      <Box className="server-add-methods">
        {onSelectHub && (
          <Pressable
            onPress={() => {
              onClose();
              onSelectHub();
            }}
          >
            <Server size={20} />
            <Text>
              <Text semantic="strong">Add Hub to Home network</Text>
              <Text semantic="small">
                Join another Haus Hub in one click for failover, storage, and distributed apps.
              </Text>
            </Text>
            <ChevronRight size={17} />
          </Pressable>
        )}
        <Pressable
          onPress={() => {
            onClose();
            onSelectNvr();
          }}
        >
          <Server size={20} />
          <Text>
            <Text semantic="strong">NVR media worker</Text>
            <Text semantic="small">
              Dedicated camera storage and live streaming node with node key.
            </Text>
          </Text>
          <ChevronRight size={17} />
        </Pressable>
        <Pressable
          onPress={() => {
            onClose();
            onSelectSsh();
          }}
        >
          <Server size={20} />
          <Text>
            <Text semantic="strong">SSH server</Text>
            <Text semantic="small">
              Secure shell access and a place for this machine in your home.
            </Text>
          </Text>
          <ChevronRight size={17} />
        </Pressable>
      </Box>
    </Dialog>
  );
}

interface EnrollApiResponse {
  readonly status?: string;
  readonly challengeSessionId?: string;
  readonly targetName?: string;
  readonly node?: { readonly name?: string };
}

export function AddHubDialog({
  open,
  onClose,
  onJoined,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onJoined: () => unknown;
}) {
  const [candidates, setCandidates] = useState<DiscoveredClusterHubCandidate[]>([]);
  const [scanning, setScanning] = useState(false);

  const scan = useCallback(() => {
    const native = window.hausNative;
    if (!native?.discover) return () => {};
    let active = true;
    setScanning(true);
    void native
      .discover({ rawHubsOnly: true })
      .then((list) => {
        if (!active) return;
        setCandidates(
          list
            .filter((item) => item.kind !== 'home-assistant' && (item.hubCount ?? 1) <= 1)
            .map((item) => ({
              id: item.id,
              name: item.name,
              url: item.url,
              ...(item.hubId ? { hubId: item.hubId } : {}),
              ...(item.homeId ? { homeId: item.homeId } : {}),
              ...(item.onboarded !== undefined ? { onboarded: item.onboarded } : {}),
            })),
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setScanning(false);
      });
    return () => {
      active = false;
      native.cancelDiscovery?.();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    return scan();
  }, [open, scan]);

  const handleSubmit = async (
    input: AddClusterHubSubmitInput,
  ): Promise<AddClusterHubSubmitResult> => {
    const res = await serverRequest<EnrollApiResponse>('POST', '/api/cluster/enroll-hub', {
      targetUrl: input.targetUrl,
      ...(input.name ? { name: input.name } : {}),
      roles: [...input.roles],
      ...(input.pairingCode ? { pairingCode: input.pairingCode } : {}),
      ...(input.challengeSessionId ? { challengeSessionId: input.challengeSessionId } : {}),
    });
    if (res.status === 'pairing_code_required' && res.challengeSessionId) {
      return {
        status: 'pairing_code_required',
        challengeSessionId: res.challengeSessionId,
        targetName: res.targetName,
      };
    }
    await onJoined();
    return { status: 'joined', hubName: res.node?.name };
  };

  return (
    <AddClusterHubModal
      open={open}
      candidates={candidates}
      scanning={scanning}
      onRescan={scan}
      onSubmit={handleSubmit}
      onClose={onClose}
    />
  );
}
