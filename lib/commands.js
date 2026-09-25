"use strict";
const { validSurveySeconds, MIN_SURVEY_SECONDS, MAX_SURVEY_SECONDS, MAX_ORE_FILTERS } = require("./settings");
const { ORDERS } = require("./targets");

// Input aliases are deliberately independent of session.languageID: a pilot
// can use any known translation without changing the client language. Keep
// the original command and ore names as stable protocol values.
const COMMAND_NAMES = ["automining", "自动采矿", "自動採礦", "自動採掘", "자동채굴", "자동 채굴",
  "autobergbau", "automatischerbergbau", "automatischer bergbau",
  "minageauto", "minageautomatique", "minage automatique",
  "mineriaautomatica", "mineríaautomática", "minería automática",
  "estrazioneautomatica", "estrazione automatica", "автодобыча", "автоматическая добыча"];
const ALIASES = {
  on: ["on", "开启", "啟動", "启动", "開始", "オン", "開始", "켜기", "시작", "ein", "starten", "activer", "activar", "attiva", "attivare", "вкл", "включить"],
  off: ["off", "关闭", "關閉", "停止", "オフ", "停止", "끄기", "중지", "aus", "stoppen", "désactiver", "desactivar", "disattiva", "disattivare", "выкл", "выключить"],
  clear: ["clear", "清空", "清除", "クリア", "초기화", "leeren", "vider", "vaciar", "svuota", "очистить"],
  status: ["status", "状态", "狀態", "状態", "상태", "statut", "estado", "stato", "статус"],
  help: ["help", "帮助", "幫助", "ヘルプ", "도움말", "hilfe", "aide", "ayuda", "aiuto", "помощь"],
  nearest: ["nearest", "closest", "最近", "最寄り", "가까운", "nächste", "proche", "cercano", "vicino", "ближайший"],
  furthest: ["furthest", "farthest", "最远", "最遠", "最も遠い", "먼", "entfernteste", "éloigné", "lejano", "lontano", "дальний"],
  largest: ["largest", "最大", "最大量", "가장큰", "größte", "grand", "mayor", "maggiore", "крупнейший"],
  smallest: ["smallest", "最小", "最少", "가장작은", "kleinste", "petit", "menor", "minore", "наименьший"],
  approach: ["approach", "接近", "接近する", "접근", "annähern", "approcher", "acercar", "avvicina", "приблизиться"],
  lock: ["lock", "锁定", "鎖定", "ロック", "잠금", "erfassen", "verrouiller", "fijar", "aggancia", "захват"],
  survey: ["survey", "扫描", "掃描", "スキャン", "스캔", "scan", "sondage", "escaneo", "scansione", "сканирование"],
  compress: ["compress", "压缩", "壓縮", "圧縮", "압축", "komprimieren", "compresser", "comprimir", "comprimi", "сжать"],
  interval: ["interval", "间隔", "間隔", "間隔", "간격", "intervall", "intervalle", "intervalo", "intervallo", "интервал"],
};
const aliasOf = (word, action) => ALIASES[action].includes(word);
const canonical = word => Object.keys(ALIASES).find(action => aliasOf(word, action));

function parse(message) {
  const input = String(message ?? "").normalize("NFKC").trim().replace(/^[!/]/, "").toLowerCase();
  const name = COMMAND_NAMES.find(alias => input === alias || input.startsWith(alias + " "));
  if (!name) return null;
  const value = input.slice(name.length).trim();
  const parts = value.split(/\s+/);
  const first = canonical(parts[0]);
  const second = canonical(parts[1]);
  if (["approach", "lock", "survey", "compress"].includes(first) && parts.length === 2 && ["on", "off"].includes(second)) {
    return { action: "toggle", setting: first, enabled: second === "on" };
  }
  if (first === "survey" && parts.length > 1) {
    const raw = parts[parts.length - 1];
    const validShape = parts.length === 2 || parts.length === 3 && second === "interval";
    const seconds = validShape && /^\d+$/.test(raw) ? Number(raw) : NaN;
    return validSurveySeconds(seconds) ? { action: "surveyInterval", seconds }
      : { action: "error", message: `AutoMining: survey interval must be a whole number from ${MIN_SURVEY_SECONDS} to ${MAX_SURVEY_SECONDS} seconds. Example: !AutoMining survey 30.` };
  }
  if (["approach", "lock", "survey", "compress"].includes(first)) return { action: "help" };
  if (parts.length === 1 && ["on", "off", "clear", "status", "help", ...ORDERS].includes(first)) return { action: first };
  const ores = value.split(",").map(x => x.trim().replace(/\s+/g, " "));
  if (!value || ores.some(x => !x || x.length > 80 || !/^[\p{L}\p{N} '-]+$/u.test(x)) || ores.length > MAX_ORE_FILTERS) {
    return { action: "help" };
  }
  return { action: "filter", ores: [...new Set(ores)] };
}

// Whole words allow "veldspar" to include "Dense Veldspar", without matching
// arbitrary substrings or evaluating user-supplied regular expressions.
function matchesOre(name, ores) {
  const words = ` ${String(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  return ores.length === 0 || ores.some(ore => words.includes(` ${ore.replace(/[^\p{L}\p{N}]+/gu, " ")} `));
}

function installChat(exports, controller) {
  const original = exports.executeChatCommand;
  exports.executeChatCommand = function(session, message, hub, options = {}) {
    const command = parse(message);
    if (!command) return original.apply(this, arguments);
    const reply = controller.command(session, command);
    controller.feedback?.(session, reply);
    if (hub && options.emitChatFeedback !== false) {
      hub.sendSystemMessage(session, reply, options.feedbackChannel || options.channel || null);
    }
    return { handled: true, message: reply };
  };
  if (Array.isArray(exports.AVAILABLE_SLASH_COMMANDS)) {
    for (const name of COMMAND_NAMES.filter(value => !value.includes(" "))) {
      if (!exports.AVAILABLE_SLASH_COMMANDS.includes(name)) exports.AVAILABLE_SLASH_COMMANDS.push(name);
    }
  }
}

function installPlainChat(exports, controller) {
  for (const [name, index] of [["broadcastLocalMessage", 1], ["sendChannelMessage", 2]]) {
    const original = exports[name];
    if (typeof original !== "function") continue;
    exports[name] = function(...args) {
      const command = parse(args[index]);
      if (!command) return original.apply(this, args);
      // EveJS catches this at the chat boundary and returns the message only to
      // its sender. The command never enters channel broadcast or chat history.
      const reply = controller.command(args[0], command);
      controller.feedback?.(args[0], reply);
      throw new Error(reply);
    };
  }
}

module.exports = { parse, matchesOre, installChat, installPlainChat, COMMAND_NAMES };
