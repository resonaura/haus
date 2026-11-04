/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import{Hub}from'./hub.mjs';
import{bootstrapHub}from'./bootstrap.mjs';
const service=new Hub({bootstrap:bootstrapHub});
await service.start();
const shutdown=()=>void service.stop().then(()=>process.exit(0));
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
