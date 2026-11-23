/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useMemo } from 'react';
import {
  Box,
  HausButton as Button,
  HausForm,
  HausModalOverlay as Modal,
  Heading,
  Pressable,
  Text,
  TextInput,
} from '@haus/ui';
import { ChevronRight } from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { humanize, supervisor, type AddonInfo } from '../../../ha/management';
import type { Confirmation, Repository } from '../ManagementFeedback';
import { groupAddonFamilies } from '../details/families';

type AddonActions = {
  installedSlugs: ReadonlySet<string>;
  viewStore: boolean;
  admin: boolean;
  busy: boolean;
  onSelectAddon: (addon: AddonInfo) => void;
  onAddonAction: (addon: AddonInfo, action: string) => void;
};

export const AddonsGridView = memo(function AddonsGridView({
  filteredAddons,
  addons,
  viewStore,
  admin,
  busy,
  onSelectAddon,
  onAddonAction,
}: {
  filteredAddons: readonly AddonInfo[];
  addons: readonly AddonInfo[];
  viewStore: boolean;
  admin: boolean;
  busy: boolean;
  onSelectAddon: (addon: AddonInfo) => void;
  onAddonAction: (addon: AddonInfo, action: string) => void;
}) {
  const installedSlugs = useMemo(() => new Set(addons.map((a) => a.slug)), [addons]);
  const families = useMemo(() => groupAddonFamilies(filteredAddons), [filteredAddons]);
  const actions: AddonActions = {
    installedSlugs,
    viewStore,
    admin,
    busy,
    onSelectAddon,
    onAddonAction,
  };
  return (
    <Box className={viewStore ? 'addon-store-grid' : 'addon-list'}>
      {families.map((group) => {
        if (!['tuya', 'govee'].includes(group.id)) {
          return group.items.map((addon) => (
            <AddonCard key={addon.slug} addon={addon} {...actions} />
          ));
        }
        const running = group.items.filter((addon) => addon.state === 'started').length;
        return (
          <Box semantic="article" className="addon-card addon-family" key={group.id}>
            <Box semantic="header" className="addon-family-header">
              <BrandIcon kind="integration" id={group.id} size={44} hint={{ name: group.name }} />
              <Box>
                <Heading level={3}>{group.name}</Heading>
                <Text semantic="p">
                  {viewStore
                    ? `${group.items.length} components`
                    : `${running}/${group.items.length} running`}
                </Text>
              </Box>
              {!viewStore && running < group.items.length && (
                <Text className="attention-pill">Attention</Text>
              )}
              {group.items.some((addon) => addon.update_available) && (
                <Text className="update-pill">Update available</Text>
              )}
            </Box>
            <Box className="addon-family-components">
              {group.items.map((addon) => (
                <AddonCard key={addon.slug} addon={addon} component {...actions} />
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
});

const AddonCard = memo(function AddonCard({
  addon,
  component,
  installedSlugs,
  viewStore,
  admin,
  busy,
  onSelectAddon,
  onAddonAction,
}: AddonActions & {
  addon: AddonInfo;
  component?: boolean;
}) {
  const isInstalled = installedSlugs.has(addon.slug);
  return (
    <Box
      semantic="article"
      className="addon-card"
      dataAttrs={{ component: component || undefined }}
    >
      <Text className="addon-glyph">
        <BrandIcon
          kind="addon"
          id={addon.slug}
          size={44}
          hint={{
            name: addon.name,
            ...(addon.url && addon.url.includes('github.com') ? { repositoryUrl: addon.url } : {}),
            ...(addon.repository ? { repository: addon.repository } : {}),
            addonSlug: addon.slug,
          }}
        />
      </Text>
      <Box className="addon-copy">
        <Box>
          <Heading level={component ? 4 : 3}>{addon.name}</Heading>
          {!viewStore && (
            <Text
              className={`status-pill ${addon.state === 'started' ? 'status-available' : 'status-disabled'}`}
            >
              <Text semantic="swatch" />
              {addon.state === 'started' ? 'Running' : humanize(addon.state ?? 'Unknown')}
            </Text>
          )}
          {addon.update_available && <Text className="update-pill">Update available</Text>}
        </Box>
        <Text semantic="p">{addon.description}</Text>
        <Text semantic="small">
          {addon.version
            ? `Version ${addon.version}`
            : addon.version_latest
              ? `Version ${addon.version_latest}`
              : addon.repository}
        </Text>
      </Box>
      <Box className="addon-actions">
        <Pressable
          className="text-link"
          ariaLabel={`${viewStore ? 'View details for' : 'Manage'} ${addon.name}`}
          onPress={() =>
            onSelectAddon({
              ...addon,
              installed: isInstalled,
            })
          }
        >
          {viewStore ? 'View details' : 'Manage'}
          <ChevronRight size={14} />
        </Pressable>
        {!viewStore && admin && (
          <Button
            variant="secondary"
            isDisabled={busy}
            aria-label={`${addon.state === 'started' ? 'Stop' : 'Start'} ${addon.name}`}
            onPress={() => onAddonAction(addon, addon.state === 'started' ? 'stop' : 'start')}
          >
            {addon.state === 'started' ? 'Stop' : 'Start'}
          </Button>
        )}
      </Box>
    </Box>
  );
});

export function AddonRepositoriesModal({
  repositories,
  repositoryUrl,
  admin,
  busy,
  onChangeUrl,
  onClose,
  onPerform,
  onConfirm,
}: {
  repositories: readonly Repository[];
  repositoryUrl: string;
  admin: boolean;
  busy: boolean;
  onChangeUrl: (next: string) => void;
  onClose: () => void;
  onPerform: (operation: () => Promise<unknown>, success?: string) => Promise<void>;
  onConfirm: (confirmation: Confirmation) => void;
}) {
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container size="lg">
          <Modal.Dialog className="haus-dialog">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Add-on repositories</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Box className="repository-list">
                {repositories.map((repo) => (
                  <Box key={repo.slug}>
                    <Text>
                      <Text semantic="strong">{repo.name}</Text>
                      <Text semantic="small">{repo.url ?? repo.source}</Text>
                    </Text>
                    {admin && !['core', 'local'].includes(repo.slug) && (
                      <Button
                        variant="ghost"
                        onPress={() =>
                          onConfirm({
                            title: `Remove ${repo.name}?`,
                            label: 'Remove repository',
                            description:
                              'Installed add-ons remain on your server. This repository will be removed from the store.',
                            action: () => supervisor(`/store/repositories/${repo.slug}`, 'delete'),
                          })
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </Box>
                ))}
              </Box>
              <HausForm
                id="add-repository"
                onSubmit={() => {
                  void onPerform(
                    () => supervisor('/store/repositories', 'post', { repository: repositoryUrl }),
                    'Repository added.',
                  );
                  onChangeUrl('');
                }}
              >
                <Text semantic="label" className="management-field">
                  <Text>Repository URL</Text>
                  <TextInput
                    inputType="url"
                    required
                    value={repositoryUrl}
                    onChange={onChangeUrl}
                    placeholder="https://github.com/…"
                  />
                </Text>
              </HausForm>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose}>
                Done
              </Button>
              <Button type="submit" form="add-repository" isDisabled={busy || !admin}>
                Add repository
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
