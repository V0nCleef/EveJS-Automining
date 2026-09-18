"use strict";
const { validSurveySeconds, MIN_SURVEY_SECONDS, MAX_SURVEY_SECONDS, MAX_ORE_FILTERS } = require("./settings");
const { ORDERS } = require("./targets");

function parse(message) {
  const match = String(message ?? "").trim().match(/^[!/]?automining(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const value = (match[1] || "").trim().toLowerCase();
  const toggle = value.match(/^(approach|lock|survey|compress)\s+(on|off)$/);
  if (toggle) return { action: "toggle", setting: toggle[1], enabled: toggle[2] === "on" };
  const interval = value.match(/^survey(?: interval)?\s+(.+)$/);
  if (interval) {
    const seconds = /^\d+$/.test(interval[1]) ? Number(interval[1]) : NaN;
    return validSurveySeconds(seconds) ? { action: "surveyInterval", seconds }
      : { action: "error", message: `AutoMining: survey interval must be a whole number from ${MIN_SURVEY_SECONDS} to ${MAX_SURVEY_SECONDS} seconds. Example: !AutoMining survey 30.` };
  }
  if (/^(approach|lock|survey|compress)(?:\s|$)/.test(value)) return { action: "help" };
  if (value === "status") return { action: "status" };
  if (["on", "off", "clear", ...ORDERS].includes(value)) return { action: value };
  if (value === "closest") return { action: "nearest" };
  if (value === "farthest") return { action: "furthest" };
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
  if (Array.isArray(exports.AVAILABLE_SLASH_COMMANDS)) exports.AVAILABLE_SLASH_COMMANDS.push("automining");
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

module.exports = { parse, matchesOre, installChat, installPlainChat };
