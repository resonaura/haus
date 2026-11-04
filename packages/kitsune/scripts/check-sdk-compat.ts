/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import ts from 'typescript-api';
import { boundedFetch, verifyIntegrity } from '../src/runtime/registry.ts';
import { tarFiles } from '../src/runtime/archives.ts';
import {
  implementedSurface,
  ScryptedInterface,
  ScryptedDeviceType,
  ScryptedMimeTypes,
} from '../src/sdk/v1/surface.ts';

// Declaration text stays in memory; no SDK runtime module is evaluated or installed.
const metadata = JSON.parse(
  (
    await boundedFetch('https://registry.npmjs.org/%40scrypted%2Fsdk/latest', 1024 * 1024)
  ).toString(),
);
const archive = await boundedFetch(metadata.dist.tarball, 64 * 1024 ** 2);
verifyIntegrity(archive, metadata.dist.integrity);
const declarations = await tarFiles(archive, (path) => path.endsWith('.d.ts'));
const methods: Record<string, Set<string>> = {},
  enums: Record<string, Set<string>> = {},
  exported = new Set<string>();
for (const [path, bytes] of declarations) {
  const source = ts.createSourceFile(path, bytes.toString(), ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
      const name = node.name?.text;
      if (name) {
        methods[name] ??= new Set();
        for (const member of node.members)
          if (member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)))
            methods[name].add(member.name.text);
      }
    }
    if (ts.isEnumDeclaration(node)) {
      enums[node.name.text] ??= new Set();
      for (const member of node.members)
        if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
          enums[node.name.text].add(member.name.text);
    }
    if (
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const named = node as ts.Node & { name?: ts.Identifier };
      if (named.name && ts.isIdentifier(named.name)) exported.add(named.name.text);
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause))
      for (const specifier of node.exportClause.elements) exported.add(specifier.name.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
}
console.log(
  `Kitsune SDK v1 vs @scrypted/sdk ${metadata.version} (${declarations.size} declaration files, memory only)`,
);
let count = 0;
const missing = (path: string) => {
  console.log(`- [ ] ${path}`);
  count++;
};
for (const [name, implemented] of Object.entries(implementedSurface)) {
  if (name === 'exports') continue;
  const declared = methods[name] ?? methods[name[0].toUpperCase() + name.slice(1)];
  for (const method of declared ?? [])
    if (!(implemented as readonly string[]).includes(method)) missing(`${name}.${method}`);
}
for (const [name, implemented] of Object.entries({
  ScryptedInterface,
  ScryptedDeviceType,
  ScryptedMimeTypes,
}))
  for (const value of enums[name] ?? []) if (!(value in implemented)) missing(`${name}.${value}`);
for (const name of exported)
  if (!(implementedSurface.exports as readonly string[]).includes(name))
    missing(`export ${name} (type-only exports may need no runtime adapter)`);
if (!count)
  console.log(
    'No additional declaration symbols found. This is a surface comparison, not runtime compatibility proof.',
  );
