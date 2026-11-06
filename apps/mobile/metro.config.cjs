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
const sharedSources = ['core', 'state'].map((name) =>
  resolve(__dirname, '../../packages', name, 'src').concat(sep),
);

// Core uses NodeNext ESM imports so its emitted JavaScript works directly on Node.
// Metro consumes those same TypeScript sources through the react-native export.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const sourceImport =
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    sharedSources.some((directory) => context.originModulePath.startsWith(directory));
  return context.resolveRequest(
    context,
    sourceImport ? moduleName.slice(0, -3) : moduleName,
    platform,
  );
};

module.exports = config;
