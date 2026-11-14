/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { nativeApi, type FormField } from '../../ha/management';

export interface RichSelectorConfig {
  accept?: string;
  radius?: boolean;
  enable_day?: boolean;
  unit?: string;
  min?: number;
  max?: number;
  min_mireds?: number;
  max_mireds?: number;
  step?: number;
  entity_id?: string;
  hide_attributes?: string[];
  placeholder?: string;
  multiline?: boolean;
  custom_value?: boolean;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function rgbArrayToHex(value: unknown): string {
  if (!Array.isArray(value) || value.length < 3) return '#ffffff';
  const hex = (n: unknown) =>
    Math.max(0, Math.min(255, Math.round(Number(n) || 0)))
      .toString(16)
      .padStart(2, '0');
  return `#${hex(value[0])}${hex(value[1])}${hex(value[2])}`;
}

export function hexToRgbArray(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = Number.parseInt(clean.slice(0, 2) || 'ff', 16);
  const g = Number.parseInt(clean.slice(2, 4) || 'ff', 16);
  const b = Number.parseInt(clean.slice(4, 6) || 'ff', 16);
  return [Number.isFinite(r) ? r : 255, Number.isFinite(g) ? g : 255, Number.isFinite(b) ? b : 255];
}

export function SelectorFieldShell({
  caption,
  required,
  description,
  error,
  asLabel = true,
  children,
}: {
  caption: string;
  required?: boolean;
  description?: string;
  error?: string;
  asLabel?: boolean;
  children: ReactNode;
}) {
  const cls = `management-field${error ? ' has-error' : ''}`;
  const body = (
    <>
      <span>
        {caption}
        {required && <i aria-label="required"> *</i>}
      </span>
      {children}
      {description && !error && <small>{description}</small>}
      {error && (
        <small className="form-error" role="alert">
          {error}
        </small>
      )}
    </>
  );
  return asLabel ? <label className={cls}>{body}</label> : <div className={cls}>{body}</div>;
}

export function FileUploadField({
  caption,
  field,
  config,
  value,
  description,
  error,
  onChange,
}: {
  caption: string;
  field: FormField;
  config: RichSelectorConfig;
  value: unknown;
  description?: string;
  error?: string;
  onChange: (next: unknown) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [uploadError, setUploadError] = useState('');

  const handleFile = async (selected: File | undefined) => {
    if (!selected) return;
    setUploading(true);
    setUploadError('');
    try {
      const contentBase64 = arrayBufferToBase64(await selected.arrayBuffer());
      const res = await nativeApi().management<{ fileId?: string; file_id?: string }>({
        method: 'POST',
        path: 'commissioning/files',
        data: { filename: selected.name, contentBase64 },
      });
      const fileId = res?.fileId ?? res?.file_id;
      if (!fileId) throw new Error('Hub did not return a file identifier.');
      setFileName(selected.name);
      onChange(fileId);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'File upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <SelectorFieldShell
      asLabel={false}
      caption={caption}
      required={field.required}
      description={description}
      error={uploadError || error}
    >
      <label className="management-file-row">
        <Upload size={15} />
        <span>
          {uploading
            ? 'Uploading…'
            : fileName ||
              (typeof value === 'string' && value ? `Uploaded (${value})` : 'Choose file…')}
        </span>
        <input
          type="file"
          accept={config.accept}
          disabled={uploading}
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
      </label>
    </SelectorFieldShell>
  );
}
