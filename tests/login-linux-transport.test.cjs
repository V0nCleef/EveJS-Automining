"use strict";
// Linux transport only: real TCP/native AES/codec; client receipts are fixtures.
// No Python interpreter, EVE client, credentials service or player state is used.
const { test } = require("node:test"), assert = require("node:assert/strict");
const net = require("node:net"), crypto = require("node:crypto"), zlib = require("node:zlib");
const path = require("node:path"), fs = require("node:fs");
const { once } = require("node:events");
const { createHarness } = require("./support/nativeLoginHarness.cjs");
const delivery = require("../lib/loginDelivery");

function parser(callback) {
  let pending = Buffer.alloc(0);
  return data => {
    pending = Buffer.concat([pending, data]);
    while (pending.length >= 4) {
      const length = pending.readUInt32LE(0);
      assert.ok(length > 0 && length <= 2 * 1024 * 1024);
      if (pending.length < length + 4) return;
      const frame = pending.subarray(0, length + 4);
      pending = pending.subarray(length + 4);
      callback(frame);
    }
  };
}

for (const encrypted of [false, true]) test("Linux TCP + canonical runtime + released hooks, AES=" + encrypted,
  { skip: process.platform !== "linux", timeout: 15000 }, async t => {
    const companion = delivery.createDelivery(path.resolve(__dirname, ".."), { token: "fixture-server" });
    const received = [], sockets = [], framesSent = [], key = Buffer.alloc(32, 7);
    let clientIv = Buffer.alloc(16, 9), session, serverFragments = 0, nativeDone = false;
    const h = createHarness({ order: ["runtime", "dcb", "haulers"], specs: [
      { id: "automining", source: companion.source, onReceipt: (_, status) => received.push(status.id) },
      { id: "linux.transport.fixture", source: "pass\n", onReceipt: (_, status) => received.push(status.id) },
    ] });
    let fail = () => {};
    const server = net.createServer(socket => {
      sockets.push(socket); socket.setNoDelay(true); socket.on("error", error => fail(error));
      session = h.session({ encrypted }); session.socket = socket;
      const nativeWrite = socket.write;
      socket.write = function(frame, ...args) { framesSent.push(Buffer.from(frame)); return nativeWrite.call(this, frame, ...args); };
      const accept = parser(frame => {
        const body = encrypted ? session._decrypt(frame.subarray(4)) : frame.subarray(4);
        const result = session._handleFuncResult(h.codec.marshalDecodeExact(body));
        assert.equal(result.done, true); nativeDone = true;
      });
      socket.on("data", data => {
        try {
          // Force reply parser fragmentation independently of OS coalescing.
          for (let at = 0; at < data.length; at += 17) { serverFragments++; accept(data.subarray(at, at + 17)); }
        } catch (error) { fail(error); }
      });
      session._sendPacket(h.Service.fixturePacket.call(session));
      session.state = "WAIT_FUNC_RESULT";
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    let client;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("isolated transport timeout")), 10000);
        fail = error => { clearTimeout(timer); reject(error); };
        let phase = 0;
        client = net.createConnection(server.address().port, "127.0.0.1"); client.setNoDelay(true);
        client.on("error", fail);
        const accept = parser(frame => {
          let body = frame.subarray(4);
          if (encrypted) {
            const decryptor = crypto.createDecipheriv("aes-256-cbc", key, clientIv);
            clientIv = body.subarray(-16);
            body = Buffer.concat([decryptor.update(body), decryptor.final()]);
          }
          const value = h.codec.marshalDecodeExact(body);
          if (phase++ === 0) {
            assert.equal(value[1][1], 0);
            const expression = value[1][0].toString("latin1", 5);
            const outer = Buffer.from(expression.match(/b64decode\("([A-Za-z0-9+/=]+)"\)/)[1], "base64").toString("utf8");
            const payload = JSON.parse(Buffer.from(outer.match(/json.loads\(base64.b64decode\('([A-Za-z0-9+/=]+)'\)\)/)[1], "base64"));
            const own = payload.find(provider => provider.id === "automining");
            assert.equal(zlib.inflateSync(Buffer.from(own.source, "base64")).toString("utf8"), companion.source);
            const nonce = outer.match(/EVEJS_LOGIN:v1:([a-f0-9]{32}):/)[1];
            const generation = h.haulerLogs.join("\n").match(/SENT generation=([a-f0-9]{24})/)[1];
            const fixtureOutput = payload.map(provider => "EVEJS_LOGIN:v1:" + nonce + ":" + provider.id + ":OK\n").join("") +
              "EMPIRE_HAULERS:" + generation + ":CATALOG_READY ships=12 blueprintTypes=12\n";
            let reply = h.codec.encodePacket(["55087", Buffer.from(fixtureOutput), 77]);
            if (encrypted) {
              const cipher = crypto.createCipheriv("aes-256-cbc", key, clientIv);
              const ciphertext = Buffer.concat([cipher.update(reply.subarray(4)), cipher.final()]);
              clientIv = ciphertext.subarray(-16); reply = h.codec.wrapPacket(ciphertext);
            }
            client.write(reply.subarray(0, 2)); client.write(reply.subarray(2, 7)); client.write(reply.subarray(7));
          } else {
            assert.equal(value.type, "dict");
            assert.equal(Number(h.codec.dictGet(h.codec.dictGet(value, "session_init"), "userid")), 42);
            clearTimeout(timer); resolve();
          }
        });
        client.on("data", data => { try { accept(data); } catch (error) { fail(error); } });
      });
      assert.equal(nativeDone, true); assert.equal(session.state, "DONE");
      assert.deepEqual(received, ["automining", "linux.transport.fixture"]);
      assert.equal(framesSent.length, 2); assert.ok(serverFragments > 1);
      assert.match(h.haulerLogs.join("\n"), /CLIENT_REPORT.*CATALOG_READY/);
      if (encrypted) assert.deepEqual(session.sessionIV, clientIv);
      t.diagnostic(JSON.stringify({ linux: true, encrypted, realTcpLoopback: true, loginBytes: framesSent[0].length,
        nativeAckBytes: framesSent[1].length, replyFragments: serverFragments,
        runtimeSha256: crypto.createHash("sha256").update(fs.readFileSync(require("./support/runtimeUnderTest.cjs").file)).digest("hex"),
        exactAutoMiningInitializerBytesVerified: true, clientReceipts: "synthetic", pythonOrRetailClientExecuted: false }));
    } finally {
      client?.destroy(); for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  });
