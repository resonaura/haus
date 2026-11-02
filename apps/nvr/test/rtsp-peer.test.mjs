/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer as tcp, connect } from "node:net";
import { createServer as http } from "node:http";
import { once } from "node:events";
import { RtspPeer, openPeerRtsp } from "../lib/rtsp-peer.mjs";

test("node-to-node RTSP shares only an owned source and closes when its lease is revoked",{timeout:5000},async(t)=>{
  const source=tcp((socket)=>socket.on("data",()=>socket.write("RTSP/1.0 200 OK\r\nCSeq: 1\r\n\r\n")));
  source.listen(0,"127.0.0.1");await once(source,"listening");
  let allowed=true;
  const peers=new RtspPeer({owned:()=>{if(!allowed)throw Error("revoked");return{};},engine:{localRtsp:()=>`rtsp://127.0.0.1:${source.address().port}/fixture`}});
  const server=http();server.on("upgrade",(req,socket,head)=>peers.upgrade(req,socket,head));server.listen(0,"127.0.0.1");await once(server,"listening");
  const grant=peers.grant({sessionId:"owned",owner:"owner"});
  const reader=await openPeerRtsp({url:`http://127.0.0.1:${server.address().port}`,allowHttp:true,...grant});
  const socket=connect(Number(new URL(reader.url).port),"127.0.0.1");
  t.after(()=>{socket.destroy();reader.stop();peers.stop();server.close();source.close();});
  await once(socket,"connect");socket.write("OPTIONS rtsp://source/fixture RTSP/1.0\r\nCSeq: 1\r\n\r\n");
  assert.match(String((await once(socket,"data"))[0]),/RTSP\/1.0 200/);
  const closed=once(socket,"close");allowed=false;peers.sweep();await closed;
  assert.throws(()=>peers.grant({sessionId:"owned",owner:"owner"}),/revoked/);
});
