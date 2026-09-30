"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const { createJobArtwork, installJobArtwork, CHUNK_BYTES } = require("../lib/jobArtwork");
const root = path.resolve(__dirname, "..");
const digest = body => crypto.createHash("sha256").update(body).digest("hex");
const session = { characterID: 42 };

test("all approved banners round-trip through bounded independent RPC chunks with exact bytes", () => {
  class Service {}
  installJobArtwork(Service, root);
  const read = new Service().Handle_AutoMiningJobArtwork;
  const manifest = JSON.parse(read([], session));
  assert.equal(manifest.success, true);
  assert.deepEqual(Object.keys(manifest.artwork), ["mining", "hauling", "boosting", "pve"]);
  for (const [job, row] of Object.entries(manifest.artwork)) {
    const chunks = [];
    for (let offset = 0; offset < row.bytes; offset += CHUNK_BYTES) {
      const raw = read([{ type: "wstring", value: job }, Buffer.from(row.sha256), offset], session);
      assert.ok(Buffer.byteLength(raw) < 176000);
      const result = JSON.parse(raw);
      assert.equal(result.success, true); assert.equal(result.offset, offset);
      chunks.push(Buffer.from(result.chunk, "base64"));
    }
    const body = Buffer.concat(chunks);
    assert.equal(body.length, row.bytes); assert.equal(digest(body), row.sha256);
    assert.deepEqual(body, fs.readFileSync(path.join(root, "assets/jobs", job + ".png")));
  }
});

test("arbitrary paths, stale content, oversized inputs and invalid offsets cannot read a file", () => {
  const read = createJobArtwork(root), rows = JSON.parse(read([], session)).artwork;
  for (const args of [["../loader", rows.mining.sha256, 0], ["mining", "a".repeat(64), 0],
    ["mining", rows.mining.sha256, -1], ["mining", rows.mining.sha256, 1],
    ["mining", rows.mining.sha256, "0"], ["mining", rows.mining.sha256, rows.mining.bytes],
    ["x".repeat(10000), rows.mining.sha256, 0]])
    assert.deepEqual(JSON.parse(read(args, session)), { success: false });
  assert.deepEqual(JSON.parse(read([], {})), { success: false });
});

test("tampered artwork fails independently of jobs; successful chunk reads reuse verified memory", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "automining-art-"));
  try {
    fs.cpSync(path.join(root, "assets"), path.join(temporary, "assets"), { recursive: true });
    const read = createJobArtwork(temporary), rows = JSON.parse(read([], session)).artwork;
    const filename = path.join(temporary, "assets/jobs/mining.png"), original = fs.readFileSync(filename);
    original[original.length - 30] ^= 1;
    fs.writeFileSync(filename, original);
    assert.deepEqual(JSON.parse(read(["mining", rows.mining.sha256, 0], session)), { success: false });
    const first = read(["hauling", rows.hauling.sha256, 0], session);
    assert.equal(JSON.parse(first).success, true);
    fs.unlinkSync(path.join(temporary, "assets/jobs/hauling.png"));
    assert.equal(read(["hauling", rows.hauling.sha256, 0], session), first);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
