/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

const { getDefaultConfig } = require('expo/metro-config');
const { resolve, sep } = require('node:path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);
const typescriptSources = [
  resolve(__dirname, 'src'),
  ...['core', 'ha', 'state', 'ui'].map((name) => resolve(__dirname, '../../packages', name, 'src')),
].map((directory) => directory.concat(sep));
const uiSource = resolve(__dirname, '../../packages/ui/src').concat(sep);
const appOrigin = resolve(__dirname, 'package.json');

// Shared packages use NodeNext ESM imports so their emitted JavaScript runs on Node.
// Metro consumes those same TypeScript sources through the react-native export.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Resolve the UI peers from the app so React Native and shared JSX use the same React instance.
  if (
    context.originModulePath.startsWith(uiSource) &&
    /^(?:react(?:\/|$)|react-native(?:\/|$)|react-native-svg(?:\/|$))/.test(moduleName)
  ) {
    return context.resolveRequest(
      { ...context, originModulePath: appOrigin },
      moduleName,
      platform,
    );
  }
  const sourceImport =
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    typescriptSources.some((directory) => context.originModulePath.startsWith(directory));
  return context.resolveRequest(
    context,
    sourceImport ? moduleName.slice(0, -3) : moduleName,
    platform,
  );
};

module.exports = config;
