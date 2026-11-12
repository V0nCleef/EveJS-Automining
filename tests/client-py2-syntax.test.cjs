"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The client runs on embedded Python 2.7: keyword-only arguments after *args
// (a Python 3 feature) are a SyntaxError there and break the whole companion.
test("client sources stay Python 2 compatible (no keyword-only args after *args)", () => {
  const dir = path.join(__dirname, "..", "client");
  const offenders = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".py")) continue;
    const lines = fs.readFileSync(path.join(dir, name), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (/lambda\s+\*[^,)],\s*\w+\s*=/.test(line) ||
          /def\s+\w+\([^)]*\*\w+\s*,\s*\w+\s*=/.test(line)) {
        offenders.push(name + ":" + (index + 1) + " " + line.trim());
      }
    });
  }
  assert.deepEqual(offenders, [], "Python 3 keyword-only syntax found in client code:\n" + offenders.join("\n"));
});

test("client login companion reports eval failures instead of silent retries", () => {
  const login = fs.readFileSync(path.join(__dirname, "..", "client", "login.py"), "utf8");
  assert.match(login, /AutoMiningClientError/);
  const loader = fs.readFileSync(path.join(__dirname, "..", "loader.js"), "utf8");
  assert.match(loader, /Handle_AutoMiningClientError/);
});
