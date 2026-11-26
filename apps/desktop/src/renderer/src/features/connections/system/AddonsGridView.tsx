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
  insets,
  ManagementGlassCard,
  ManagementStatusPill,
  pct,
  px,
  Row,
  Stack,
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
          <ManagementGlassCard
            radius={22}
            padding={insets(18)}
            key={group.id}
            style={{ layout: { width: pct(100), gap: px(14) } }}
          >
            <Row
              align="center"
              justify="between"
              gapPx={12}
              style={{ layout: { width: pct(100) } }}
            >
              <Row align="center" gapPx={12}>
                <BrandIcon kind="integration" id={group.id} size={44} hint={{ name: group.name }} />
                <Stack gapPx={2}>
                  <Heading level={3} size={15} weight={600}>
                    {group.name}
                  </Heading>
                  <Text size={12} tone="muted">
                    {viewStore
                      ? `${group.items.length} components`
                      : `${running}/${group.items.length} running`}
                  </Text>
                </Stack>
              </Row>
              <Row align="center" gapPx={6}>
                {!viewStore && running < group.items.length && (
                  <ManagementStatusPill label="Attention" tone="warning" />
                )}
                {group.items.some((addon) => addon.update_available) && (
                  <ManagementStatusPill label="Update available" tone="accent" />
                )}
              </Row>
            </Row>
            <Box className="addon-family-components">
              {group.items.map((addon) => (
                <AddonCard key={addon.slug} addon={addon} component {...actions} />
              ))}
            </Box>
          </ManagementGlassCard>
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
  const running = addon.state === 'started';
  return (
    <ManagementGlassCard
      radius={component ? 18 : 22}
      padding={insets(16, 18)}
      interactive
      style={{ layout: { width: pct(100), gap: px(12), justifyContent: 'between' } }}
    >
      <Row align="center" justify="between" gapPx={14} wrap style={{ layout: { width: pct(100) } }}>
        <Row align="center" gapPx={12} style={{ layout: { flexGrow: 1, minWidth: px(200) } }}>
          <BrandIcon
            kind="addon"
            id={addon.slug}
            size={44}
            hint={{
              name: addon.name,
              ...(addon.url && addon.url.includes('github.com')
                ? { repositoryUrl: addon.url }
                : {}),
              ...(addon.repository ? { repository: addon.repository } : {}),
              addonSlug: addon.slug,
            }}
          />
          <Stack gapPx={3} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Row align="center" gapPx={8} wrap>
              <Heading level={component ? 4 : 3} size={14.5} weight={600}>
                {addon.name}
              </Heading>
              {!viewStore && (
                <ManagementStatusPill
                  label={running ? 'Running' : humanize(addon.state ?? 'Unknown')}
                  tone={running ? 'success' : 'neutral'}
                  showDot
                />
              )}
              {addon.update_available && (
                <ManagementStatusPill label="Update available" tone="accent" />
              )}
            </Row>
            {addon.description && (
              <Text size={12} tone="muted" style={{ typography: { size: 12, maxLines: 2 } }}>
                {addon.description}
              </Text>
            )}
            <Text size={11.5} tone="muted">
              {addon.version
                ? `Version ${addon.version}`
                : addon.version_latest
                  ? `Version ${addon.version_latest}`
                  : addon.repository}
            </Text>
          </Stack>
        </Row>
        <Row align="center" gapPx={8}>
          {!viewStore && admin && (
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy}
              aria-label={`${running ? 'Stop' : 'Start'} ${addon.name}`}
              onPress={() => onAddonAction(addon, running ? 'stop' : 'start')}
            >
              {running ? 'Stop' : 'Start'}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${viewStore ? 'View details for' : 'Manage'} ${addon.name}`}
            onPress={() =>
              onSelectAddon({
                ...addon,
                installed: isInstalled,
              })
            }
          >
            {viewStore ? 'View details' : 'Manage'}
            <ChevronRight size={14} />
          </Button>
        </Row>
      </Row>
    </ManagementGlassCard>
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
