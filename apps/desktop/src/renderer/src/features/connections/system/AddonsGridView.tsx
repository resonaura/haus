/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button, Modal } from '@heroui/react';
import { ChevronRight } from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { humanize, supervisor, type AddonInfo } from '../../../ha/management';
import type { Confirmation, Repository } from '../ManagementFeedback';

export function AddonsGridView({
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
  return (
    <div className={viewStore ? 'addon-store-grid' : 'addon-list'}>
      {filteredAddons.map((addon) => (
        <article className="addon-card" key={addon.slug}>
          <span className="addon-glyph">
            <BrandIcon kind="addon" id={addon.slug} />
          </span>
          <div className="addon-copy">
            <div>
              <h3>{addon.name}</h3>
              {!viewStore && (
                <span
                  className={`status-pill ${addon.state === 'started' ? 'status-available' : 'status-disabled'}`}
                >
                  <i />
                  {addon.state === 'started' ? 'Running' : humanize(addon.state ?? 'Unknown')}
                </span>
              )}
              {addon.update_available && <span className="update-pill">Update available</span>}
            </div>
            <p>{addon.description}</p>
            <small>
              {addon.version
                ? `Version ${addon.version}`
                : addon.version_latest
                  ? `Version ${addon.version_latest}`
                  : addon.repository}
            </small>
          </div>
          <div className="addon-actions">
            <button
              className="text-link"
              onClick={() =>
                onSelectAddon({
                  ...addon,
                  installed: addons.some((a) => a.slug === addon.slug),
                })
              }
            >
              {viewStore ? 'View details' : 'Manage'}
              <ChevronRight size={14} />
            </button>
            {!viewStore && admin && (
              <Button
                variant="secondary"
                isDisabled={busy}
                onPress={() => onAddonAction(addon, addon.state === 'started' ? 'stop' : 'start')}
              >
                {addon.state === 'started' ? 'Stop' : 'Start'}
              </Button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

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
              <div className="repository-list">
                {repositories.map((repo) => (
                  <div key={repo.slug}>
                    <span>
                      <strong>{repo.name}</strong>
                      <small>{repo.url ?? repo.source}</small>
                    </span>
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
                  </div>
                ))}
              </div>
              <form
                id="add-repository"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onPerform(
                    () => supervisor('/store/repositories', 'post', { repository: repositoryUrl }),
                    'Repository added.',
                  );
                  onChangeUrl('');
                }}
              >
                <label className="management-field">
                  <span>Repository URL</span>
                  <input
                    type="url"
                    required
                    value={repositoryUrl}
                    onChange={(e) => onChangeUrl(e.target.value)}
                    placeholder="https://github.com/…"
                  />
                </label>
              </form>
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
