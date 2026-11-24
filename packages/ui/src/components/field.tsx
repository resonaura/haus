/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Text, TextInput } from '../primitives/elements.js';
import type { HostTextInputProps } from '../renderers/host.js';

export function ConnectionField({
  label,
  hint,
  ...input
}: HostTextInputProps & { readonly label: string; readonly hint?: string }) {
  return (
    <>
      <Text semantic="label" htmlFor={input.id} tone={input.style ? 'primary' : undefined}>
        {label}
      </Text>
      <TextInput {...input} ariaLabel={input.ariaLabel ?? label} />
      {hint && (
        <Text semantic="p" className="input-hint" tone={input.style ? 'secondary' : undefined}>
          {hint}
        </Text>
      )}
    </>
  );
}
