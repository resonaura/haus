/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import{Node}from'./node.mjs';
import{bootstrapNode}from'./bootstrap.mjs';
const service=new Node({bootstrap:bootstrapNode});
await service.start();
const shutdown=()=>void service.stop().then(()=>process.exit(0));
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
