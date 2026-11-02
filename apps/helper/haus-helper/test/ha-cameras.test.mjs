/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { HaCameras } from "../lib/ha-cameras.mjs";
import { discoverCameras } from "../lib/discovery.mjs";

test("HA enrollment is one-use, camera-only and revocable without persisting plaintext tokens",async(t)=>{
  const db=new DatabaseSync(":memory:"); let at=1000000;
  const access=new HaCameras({store:{db},registry:()=>({cameras:[{id:"camera.source",available:true}]}),snapshots:{snapshot:async()=>({buffer:Buffer.from([255,216])})},sessions:{},now:()=>at});
  t.after(async()=>{await access.stop();db.close();});
  const code=access.setup({action:"setup"});
  const enrolled=access.enroll({code:code.setupCode});
  assert.throws(()=>access.enroll({code:code.setupCode}),/invalid_ha_setup_code/);
  assert.equal(access.authenticate({headers:{authorization:`Bearer ${enrolled.token}`}}),enrolled.clientId);
  assert.notEqual(db.prepare("SELECT token_hash FROM ha_camera_clients").get().token_hash,enrolled.token);
  assert.equal((await access.command(enrolled.clientId,"camera.source","snapshot",{})).buffer[0],255);
  await access.revoke(enrolled.clientId);
  assert.equal(access.authenticate({headers:{authorization:`Bearer ${enrolled.token}`}}),undefined);
  const stale=access.setup({action:"setup"});at+=600001;
  assert.throws(()=>access.enroll({code:stale.setupCode}),/invalid_ha_setup_code/);
});

test("optimized Haus cameras are never rediscovered as source cameras",()=>{
  const cameras=discoverCameras([
    {entity_id:"camera.original",state:"idle",attributes:{friendly_name:"Original"}},
    {entity_id:"camera.haus_proxy",state:"idle",attributes:{haus_camera_proxy:1,haus_source_camera:"camera.original"}},
    {entity_id:"camera.hidden_marker",state:"idle",attributes:{}},
  ],[{entity_id:"camera.hidden_marker",platform:"haus"}],[]);
  assert.deepEqual(cameras.map((camera)=>camera.id),["camera.original"]);
});
