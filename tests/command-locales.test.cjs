"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parse, COMMAND_NAMES } = require("../lib/commands");

test("localized command names and verbs work independently of client language", () => {
  const samples = [
    ["/automining", "on", "off", "survey", "status"],
    ["/自动采矿", "开启", "关闭", "扫描", "状态"],
    ["/自動採掘", "オン", "オフ", "スキャン", "状態"],
    ["/자동채굴", "시작", "중지", "스캔", "상태"],
    ["/자동 채굴", "시작", "중지", "스캔", "상태"],
    ["/autobergbau", "ein", "aus", "scan", "status"],
    ["/minageauto", "activer", "désactiver", "sondage", "statut"],
    ["/mineríaautomática", "activar", "desactivar", "escaneo", "estado"],
    ["/estrazioneautomatica", "attiva", "disattiva", "scansione", "stato"],
    ["/автодобыча", "вкл", "выкл", "сканирование", "статус"],
  ];
  for (const [name, on, off, survey, status] of samples) {
    assert.deepEqual(parse(`${name} ${on}`), { action: "on" }, name);
    assert.deepEqual(parse(`${name} ${off}`), { action: "off" }, name);
    assert.deepEqual(parse(`${name} ${status}`), { action: "status" }, name);
    assert.deepEqual(parse(`${name} ${survey} 30`), { action: "surveyInterval", seconds: 30 }, name);
    assert.deepEqual(parse(name), { action: "help" }, name);
  }
  assert.deepEqual(parse("!minage automatique compresser activer"), { action: "toggle", setting: "compress", enabled: true });
  assert.deepEqual(parse("/自动采矿 接近 开启"), { action: "toggle", setting: "approach", enabled: true });
  assert.deepEqual(parse("/autobergbau nächSTe"), { action: "nearest" });
  assert.deepEqual(parse("/minageauto veldspar, scordite"), { action: "filter", ores: ["veldspar", "scordite"] });
  assert.equal(parse("/自动采矿石 开启"), null);
  assert.ok(COMMAND_NAMES.includes("automining"));
});
