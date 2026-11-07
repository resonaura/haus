/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { isAbsolute } from 'node:path';
import { MemoryProbe } from './memory.js';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output' || !isAbsolute(args[1]))
  throw Error('Usage: memory probe --output /absolute/hardware.json');
await new MemoryProbe().write(args[1]);
