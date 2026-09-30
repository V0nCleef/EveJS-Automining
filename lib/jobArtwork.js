"use strict";
// Fixed, read-only artwork delivery. Images never enter the login expression or
// normal state polling, and neither RPC arguments nor the manifest choose paths.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { clientText } = require("./hud");
const JOBS = ["mining", "hauling", "boosting", "pve"];
const CHUNK_BYTES = 128 * 1024;
const MAX_BYTES = 4 * 1024 * 1024;
const hash = body => crypto.createHash("sha256").update(body).digest("hex");

function createJobArtwork(modRoot) {
  const folder = path.join(modRoot, "assets/jobs");
  let manifest;
  const bodies = new Map();
  function entries() {
    if (manifest) return manifest;
    const file = fs.readFileSync(path.join(folder, "manifest.json"));
    if (file.length > 8192) throw Error("Invalid job artwork manifest.");
    const raw = JSON.parse(file.toString("utf8")), checked = {};
    if (Object.keys(raw).sort().join() !== JOBS.slice().sort().join()) throw Error("Invalid job artwork manifest.");
    for (const job of JOBS) {
      const row = raw[job];
      if (!row || !/^[a-f0-9]{64}$/.test(row.sha256) ||
          !Number.isInteger(row.bytes) || row.bytes < 24 || row.bytes > MAX_BYTES)
        throw Error("Invalid job artwork manifest.");
      checked[job] = { sha256: row.sha256, bytes: row.bytes };
    }
    manifest = checked;
    return manifest;
  }
  return function read(args, session) {
    try {
      const characterID = Number(session?.characterID || session?.charid);
      if (!Number.isSafeInteger(characterID) || characterID <= 0) throw Error("Character required.");
      const rows = entries();
      if (!args?.length) return JSON.stringify({ success: true, artwork: rows });
      const job = clientText(args[0], 16), expected = clientText(args[1], 64), offset = args[2];
      if (!JOBS.includes(job) || expected !== rows[job].sha256 ||
          !Number.isInteger(offset) || offset < 0 || offset >= rows[job].bytes || offset % CHUNK_BYTES)
        throw Error("Invalid job artwork request.");
      if (!bodies.has(job)) {
        const filename = path.join(folder, job + ".png");
        if (fs.statSync(filename).size !== rows[job].bytes) throw Error("Job artwork changed.");
        const body = fs.readFileSync(filename);
        if (body.length !== rows[job].bytes || hash(body) !== expected ||
            !body.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
            body.toString("ascii", 12, 16) !== "IHDR" ||
            !body.readUInt32BE(16) || body.readUInt32BE(16) > 2048 ||
            !body.readUInt32BE(20) || body.readUInt32BE(20) > 2048)
          throw Error("Invalid job artwork.");
        bodies.set(job, body);
      }
      const body = bodies.get(job);
      return JSON.stringify({ success: true, job, sha256: expected, offset, bytes: body.length,
        chunk: body.subarray(offset, offset + CHUNK_BYTES).toString("base64") });
    } catch {
      // Keep the existing native card image when custom artwork is unavailable.
      return JSON.stringify({ success: false });
    }
  };
}

function installJobArtwork(Service, modRoot) {
  Service.prototype.Handle_AutoMiningJobArtwork = createJobArtwork(modRoot);
}
module.exports = { createJobArtwork, installJobArtwork, CHUNK_BYTES, MAX_BYTES };
