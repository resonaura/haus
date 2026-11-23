/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  CheckboxInput,
  HausButton,
  HausCode,
  HausForm,
  Heading,
  Pressable,
  Text,
  TextInput,
} from '@haus/ui';
import { LoaderCircle, RefreshCw, ExternalLink } from 'lucide-react';
import type { Snapshot } from '../../model';
import { humanize, nativeApi, rest, supervisor, type AddonInfo } from '../../ha/management';
import { ConnectionDetailLayout } from './ConnectionDetailLayout';
import { BrandIcon } from '../../components/brand/BrandIcon';

import { JsonField, SchemaFields } from '../../components/forms/SchemaForm';
import { ServerMarkdown } from '../../components/ui/ServerMarkdown';

import { ManagementFeedback } from './ManagementFeedback';
export function AddonDetails({
  addon,
  snapshot,
  busy,
  onClose,
  onAction,
  onChange,
  revision,
  feedback,
}: {
  addon: AddonInfo;
  snapshot: Snapshot;
  busy: boolean;
  onClose: () => void;
  onAction: (addon: AddonInfo, action: string) => void;
  onChange: (operation: () => Promise<unknown>, success?: string) => Promise<void>;
  revision: AddonInfo[];
  feedback: { error: string; notice: string };
}) {
  const [info, setInfo] = useState<AddonInfo | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('info');
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [network, setNetwork] = useState<Record<string, unknown>>({});
  const [boot, setBoot] = useState(false);
  const [watchdog, setWatchdog] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [panel, setPanel] = useState(false);
  const installed = revision.some((a) => a.slug === addon.slug);
  const load = useCallback(async () => {
    setReading(true);
    setError('');
    try {
      const result = await supervisor<AddonInfo>(
        installed ? `/addons/${addon.slug}/info` : `/store/addons/${addon.slug}`,
      );
      setInfo(result);
      setOptions(result.options ?? {});
      setNetwork(result.network ?? {});
      setBoot(result.boot === 'auto');
      setWatchdog(!!result.watchdog);
      setAutoUpdate(!!result.auto_update);
      setPanel(!!result.ingress_panel);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read add-on details.');
    } finally {
      setReading(false);
    }
  }, [addon.slug, installed]);
  useEffect(() => {
    void load();
  }, [load, revision]);
  const readText = useCallback(async () => {
    setReading(true);
    setError('');
    try {
      const result = await rest<string>(
        'GET',
        `hassio/addons/${addon.slug}/${tab === 'docs' ? 'documentation' : tab === 'changes' ? 'changelog' : 'logs'}`,
      );
      setText(
        typeof result === 'string'
          ? result.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
          : JSON.stringify(result, null, 2),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read add-on data.');
    } finally {
      setReading(false);
    }
  }, [addon.slug, tab]);
  useEffect(() => {
    if (['logs', 'docs', 'changes'].includes(tab)) void readText();
  }, [tab, readText]);
  const admin = snapshot.user.is_admin;
  const current = info ?? addon;
  return (
    <ConnectionDetailLayout
      title={addon.name}
      icon={
        <BrandIcon
          kind="addon"
          id={addon.slug}
          hint={{
            name: current.name,
            ...(current.url && current.url.includes('github.com')
              ? { repositoryUrl: current.url }
              : {}),
            ...(current.repository ? { repository: current.repository } : {}),
            addonSlug: addon.slug,
          }}
        />
      }
      subtitle={
        current.version
          ? `Version ${current.version}`
          : current.version_latest
            ? `Version ${current.version_latest}`
            : undefined
      }
      onBack={onClose}
      actions={
        tab === 'options' ? (
          <HausButton
            type="submit"
            form="addon-options"
            isDisabled={!admin || busy || reading}
            isPending={busy}
          >
            Save configuration
          </HausButton>
        ) : undefined
      }
    >
      <ManagementFeedback {...feedback} />
      <Box className="filter-tabs management-detail-tabs">
        {[
          { id: 'info', label: 'Overview' },
          ...(installed
            ? [
                { id: 'options', label: 'Configuration' },
                { id: 'logs', label: 'Logs' },
              ]
            : []),
          ...(current.documentation ? [{ id: 'docs', label: 'Documentation' }] : []),
          ...(current.changelog ? [{ id: 'changes', label: 'Changelog' }] : []),
        ].map((item) => (
          <Pressable
            key={item.id}
            ariaPressed={tab === item.id}
            className={tab === item.id ? 'selected' : ''}
            onPress={() => setTab(item.id)}
          >
            {item.label}
          </Pressable>
        ))}
      </Box>
      {error && (
        <Text semantic="p" role="alert" className="form-error">
          {error}
        </Text>
      )}
      {reading && (
        <Box className="management-loading">
          <LoaderCircle className="spin" size={18} />
          Loading…
        </Box>
      )}
      {tab === 'info' && (
        <>
          <Text semantic="p" className="flow-description">
            {current.description}
          </Text>
          {current.long_description && <ServerMarkdown text={current.long_description} />}
          <Box className="addon-facts">
            <Text>
              State
              <Text semantic="strong">
                {installed ? humanize(current.state ?? 'unknown') : 'Not installed'}
              </Text>
            </Text>
            <Text>
              Repository<Text semantic="strong">{current.repository ?? 'Unknown'}</Text>
            </Text>
            <Text>
              Latest version<Text semantic="strong">{current.version_latest ?? 'Unknown'}</Text>
            </Text>
          </Box>
          <Box className="management-action-row">
            {installed && (current.ingress || current.webui) && (
              <HausButton
                variant="secondary"
                isDisabled={current.state !== 'started' || busy}
                onPress={() =>
                  void nativeApi()
                    .openAddon(addon.slug)
                    .catch((e) => setError(e.message))
                }
              >
                <ExternalLink size={15} />
                Open web interface
              </HausButton>
            )}
            {installed ? (
              <>
                <HausButton
                  isDisabled={!admin || busy}
                  variant="secondary"
                  onPress={() => onAction(current, current.state === 'started' ? 'stop' : 'start')}
                >
                  {current.state === 'started' ? 'Stop' : 'Start'}
                </HausButton>
                <HausButton
                  variant="secondary"
                  isDisabled={!admin || busy || current.state !== 'started'}
                  onPress={() => onAction(current, 'restart')}
                >
                  Restart
                </HausButton>
                {current.update_available && (
                  <HausButton
                    isDisabled={!admin || busy}
                    onPress={() => onAction(current, 'update')}
                  >
                    Update with backup
                  </HausButton>
                )}
                {current.repository === 'local' && (
                  <HausButton
                    variant="ghost"
                    isDisabled={!admin || busy}
                    onPress={() => onAction(current, 'rebuild')}
                  >
                    Rebuild
                  </HausButton>
                )}
              </>
            ) : (
              <HausButton
                isDisabled={!admin || busy || current.available === false}
                onPress={() => onAction(current, 'install')}
              >
                Install add-on
              </HausButton>
            )}
          </Box>
          {installed && !current.system_managed && (
            <Pressable
              className="management-remove"
              disabled={!admin || busy}
              onPress={() => onAction(current, 'uninstall')}
            >
              Uninstall add-on
            </Pressable>
          )}
        </>
      )}
      {tab === 'options' && info && (
        <HausForm
          id="addon-options"
          onSubmit={() => {
            setError('');
            void onChange(async () => {
              const checked = await supervisor<{ valid: boolean; message?: string }>(
                `/addons/${addon.slug}/options/validate`,
                'post',
                { options },
              );
              if (!checked.valid)
                throw new Error(checked.message ?? 'The add-on configuration is not valid.');
              await supervisor(`/addons/${addon.slug}/options`, 'post', {
                options,
                network,
                ...(info.boot_config !== 'manual_only' ? { boot: boot ? 'auto' : 'manual' } : {}),
                watchdog,
                auto_update: autoUpdate,
                ...(info.ingress_panel !== undefined ? { ingress_panel: panel } : {}),
              });
            }, 'Add-on configuration saved. Restart the add-on if required.');
          }}
        >
          <Heading level={3} className="management-form-heading">
            Options
          </Heading>
          {info.schema?.length ? (
            <SchemaFields
              schema={info.schema}
              values={options}
              onChange={setOptions}
              snapshot={snapshot}
            />
          ) : (
            <JsonField
              label="Add-on options"
              value={options}
              onChange={(next) => setOptions(next as Record<string, unknown>)}
            />
          )}
          {!!Object.keys(network).length && (
            <>
              <Heading level={3} className="management-form-heading">
                Network ports
              </Heading>
              {Object.entries(network).map(([key, value]) => (
                <Text semantic="label" className="management-field" key={key}>
                  <Text>{key}</Text>
                  <TextInput
                    inputType="number"
                    min={1}
                    max={65535}
                    placeholder="Disabled"
                    value={value == null ? '' : String(value)}
                    onChange={(raw) =>
                      setNetwork({
                        ...network,
                        [key]: raw ? Number(raw) : null,
                      })
                    }
                  />
                </Text>
              ))}
            </>
          )}
          <Heading level={3} className="management-form-heading">
            Startup & maintenance
          </Heading>
          {info.boot_config !== 'manual_only' && (
            <Text semantic="label" className="management-check">
              <CheckboxInput checked={boot} onChange={setBoot} />
              <Text>Start on boot</Text>
            </Text>
          )}
          <Text semantic="label" className="management-check">
            <CheckboxInput checked={watchdog} onChange={setWatchdog} />
            <Text>Watchdog · restart if the add-on stops</Text>
          </Text>
          <Text semantic="label" className="management-check">
            <CheckboxInput checked={autoUpdate} onChange={setAutoUpdate} />
            <Text>Automatic updates</Text>
          </Text>
          {info.ingress_panel !== undefined && (
            <Text semantic="label" className="management-check">
              <CheckboxInput checked={panel} onChange={setPanel} />
              <Text>Show in Home Assistant sidebar</Text>
            </Text>
          )}
        </HausForm>
      )}
      {['logs', 'docs', 'changes'].includes(tab) && (
        <>
          <Box className="management-text-toolbar">
            <Text>
              {tab === 'logs'
                ? 'Latest server logs'
                : tab === 'docs'
                  ? 'Documentation'
                  : 'Release notes'}
            </Text>
            <Pressable className="text-link" onPress={() => void readText()} disabled={reading}>
              <RefreshCw size={14} />
              Refresh
            </Pressable>
          </Box>
          {tab === 'logs' ? (
            <HausCode block className="management-server-text is-log">
              {text || (reading ? 'Loading…' : 'No content reported.')}
            </HausCode>
          ) : (
            <ServerMarkdown text={text || (reading ? 'Loading…' : 'No content reported.')} />
          )}
        </>
      )}
    </ConnectionDetailLayout>
  );
}
