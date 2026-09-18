"use strict";

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
    save(session, s);
    s.approachStatus = "Auto-approach OFF after manual steering.";
    return;
  }
  s.approachStatus = "";
  const mining = modules.some(m => ship.activeModuleEffects?.has(m.item.itemID));
  if (!s.approach || mining || rows.some(m => m.targets.length)) {
    stopApproach(scene, session, ship, s);
    return;
  }
  const eligible = rocks.map(rock => ({
    rock,
    modules: modules.filter(m => api.compatible(scene, ship, m, rock, now, true)),
  })).filter(x => x.modules.length);
  eligible.sort((a, b) => (s.order === "furthest" ? b.rock.distance - a.rock.distance : a.rock.distance - b.rock.distance) || a.rock.id - b.rock.id);
  const next = eligible[0];
  if (!next) { stopApproach(scene, session, ship, s); return; }
  // Close enough for every compatible fitted miner, with a small range margin.
  const range = Math.max(0, Math.min(...next.modules.map(m => m.snapshot.maxRangeMeters)) * 0.9);
  if (!s.approachTarget || s.approachTarget.id !== next.rock.id || Math.abs(s.approachTarget.range - range) >= 1) {
    if (scene.followBall(session, next.rock.id, range)) s.approachTarget = { id: next.rock.id, range };
    else { s.approachStatus = "Waiting: ship cannot approach right now."; return; }
  }
  s.approachStatus = `Approaching ${next.rock.name}.`;
}

function updateSurvey({ api, scene, session, ship, state: s, now }) {
  if (!s.survey || now < s.nextSurvey) return;
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
