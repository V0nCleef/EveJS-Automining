"use strict";
const { compareTargets } = require("./targets");

function ownsApproach(ship, s) {
  return s.approachTarget && ship.mode === "FOLLOW" &&
    ship.targetEntityID === s.approachTarget.id &&
    Math.abs(Number(ship.followRange) - s.approachTarget.range) < 1;
}
function stopApproach(scene, session, ship, s) {
  if (ownsApproach(ship, s)) scene.stop(session);
  s.approachTarget = null;
}

function updateApproach({ api, scene, session, ship, state: s, modules, rocks, rows, now, save }) {
  if (s.approachTarget && !ownsApproach(ship, s)) {
    // A player's new movement command takes priority over the automation.
    s.approachTarget = null;
    s.approach = false;
    s.focusTarget = null;
    s.replan = true;
    save(session, s);
    s.approachStatus = "Auto-approach OFF after manual steering.";
    return true;
  }
  s.approachStatus = "";
  const mining = modules.some(m => ship.activeModuleEffects?.has(m.item.itemID));
  if (!s.approach) {
    stopApproach(scene, session, ship, s);
    s.focusTarget = null;
    return false;
  }
  const eligible = rocks.map(rock => ({
    rock,
    modules: modules.filter(m => api.compatible(scene, ship, m, rock, now, true)),
  })).filter(x => x.modules.length);
  eligible.sort((a, b) => compareTargets(s.order)(a.rock, b.rock));
  // Keep the primary asteroid until depleted/ineligible, rather than changing
  // course as distance or volume changes. Discovery includes the local belt.
  const next = eligible.find(x => x.rock.id === s.focusTarget) || eligible[0];
  s.focusTarget = next?.rock.id || null;
  if (!next) { stopApproach(scene, session, ship, s); return false; }
  if (next.modules.every(m => api.compatible(scene, ship, m, next.rock, now))) {
    stopApproach(scene, session, ship, s);
    return false;
  }
  if (mining) {
    stopApproach(scene, session, ship, s);
    s.approachStatus = `Finishing current cycles before approaching ${next.rock.name}.`;
    return true;
  }
  // Close enough for every compatible fitted miner, with a small range margin.
  const range = Math.max(0, Math.min(...next.modules.map(m => m.snapshot.maxRangeMeters)) * 0.9);
  if (!s.approachTarget || s.approachTarget.id !== next.rock.id || Math.abs(s.approachTarget.range - range) >= 1) {
    if (scene.followBall(session, next.rock.id, range)) s.approachTarget = { id: next.rock.id, range };
    else { s.approachStatus = "Waiting: ship cannot approach right now."; return true; }
  }
  s.approachStatus = `Approaching ${next.rock.name}.`;
  return true;
}

function updateSurvey({ api, scene, session, ship, state: s, now }) {
  if (!s.survey) return;
  const grid = api.surveyGrid(scene, ship);
  if (grid !== s.surveyGrid) {
    s.surveyGrid = grid;
    s.surveyResourceID = null;
    s.nextSurveyCheck = 0;
    s.nextSurvey = 0;
  }
  if (now >= (s.nextSurveyCheck || 0) || (s.surveyResourceID && now >= s.nextSurvey)) {
    s.surveyResourceID = grid ? api.surveyResource(scene, ship, s.surveyResourceID) : null;
    s.nextSurveyCheck = now + 5000;
  }
  if (!s.surveyResourceID) {
    s.surveyStatus = "Survey waiting: no ore, ice or gas in this local grid.";
    s.nextSurvey = 0;
    return;
  }
  // Arrival starts a fresh schedule, while preserving the native scan-rate
  // limit if sites change quickly or the user repeatedly toggles the feature.
  if (now < Math.max(s.nextSurvey, (s.lastSurveyRequestAt ?? -6000) + 6000)) return;
  if (!s.surveyClientReady) {
    s.surveyStatus = "Survey needs the AutoMining client companion. Relaunch the client through the Launcher after installing it.";
    s.nextSurvey = now + 5000;
    return;
  }
  session.sendNotification("OnAutoMiningSurvey", "clientID", []);
  s.lastSurveyRequestAt = now;
  s.nextSurvey = now + s.surveySeconds * 1000;
  s.surveyStatus = "Survey requested; waiting for the client.";
}
module.exports = { stopApproach, updateApproach, updateSurvey };
