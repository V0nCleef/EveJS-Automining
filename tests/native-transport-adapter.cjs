"use strict";
// Passive compatibility check: load the real server handlers without a world
// tick, mutation handlers or filesystem writes; verify inventory adapter seams.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = fs.realpathSync(process.argv[2]);
process.env.EVEJS_GAMESTORE_OWNER_ROLE = "reader";

const blockedWrites = [];
const deny = name => () => { blockedWrites.push(name); throw Error(`Read-only native load attempted ${name}`); };
for (const name of ["writeFile", "appendFile", "mkdir", "rename", "unlink", "rm", "rmdir",
  "copyFile", "truncate", "chmod", "chown", "symlink", "link", "utimes", "write", "writev"]) {
  if (fs[name]) fs[name] = deny(name);
  if (fs[name + "Sync"]) fs[name + "Sync"] = deny(name + "Sync");
  if (fs.promises[name]) fs.promises[name] = deny("promises." + name);
}
fs.createWriteStream = deny("createWriteStream");
const readFlag = flags => typeof flags === "number"
  ? !(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND))
  : ["r", "rs", "sr"].includes(flags || "r");
for (const name of ["open", "openSync"]) {
  const original = fs[name];
  fs[name] = function(file, flags, ...args) {
    if (!readFlag(flags)) return deny(name)(file);
    return original.call(this, file, flags, ...args);
  };
}
const openPromise = fs.promises.open;
fs.promises.open = function(file, flags, ...args) {
  if (!readFlag(flags)) return deny("promises.open")(file);
  return openPromise.call(this, file, flags, ...args);
};

// Keep the native service graph, but prevent its logger from opening files.
const loggerPath = path.resolve(require.resolve(path.join(root, "server/src/utils/logger"))).toLowerCase();
const logger = new Proxy({}, { get: (_, key) => key === "isVerboseDebugEnabled" ? () => false : () => {} });
const nativeLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (!Module.isBuiltin(request) &&
      path.resolve(Module._resolveFilename(request, parent, isMain)).toLowerCase() === loggerPath) return logger;
  return nativeLoad.apply(this, arguments);
};

try {
  const load = file => require(path.join(root, "server/src", file));
  const Broker = load("services/inventory/invBrokerService.js");
  const items = load("services/inventory/itemStore.js");
  const types = load("services/inventory/itemTypeRegistry.js");
  const mining = load("services/mining/miningInventory.js");
  const industry = load("services/mining/miningIndustry.js");
  const shipServices = load("services/ship/shipServiceAccess.js");
  const loot = load("services/_shared/spaceLootEntitlement.js");
  const interaction = load("space/destiny/identity/interactionScope.js");
  const fleets = load("services/fleets/fleetRuntime.js");
  const characters = load("services/character/characterState.js");
  for (const [module, names] of [[items,["listContainerItems","findItemById"]],
    [types,["resolveItemByTypeID"]], [mining,["classifyMiningMaterialType","getShipHoldCapacityByFlag","getPreferredMiningHoldFlagForType"]],
    [industry,["isCompressedType"]], [shipServices,["canUseShipServiceFlag"]],
    [loot,["sessionHasSpaceLootRight","buildSpaceLootSourceFromItem"]], [interaction,["canEntitiesInteractLocally","resolveEntityInteractionScope"]],
    [fleets,["getFleetForCharacter","createFleetRecord","initFleet","leaveFleet","inviteCharacter","acceptInvite","rejectInvite","makeLeader"]],
    [characters,["peekCharacterRecord"]]])
    for (const name of names) assert.equal(typeof module[name], "function", "Native transport export " + name);
  assert.ok(Number(fleets.FLEET.FLEET_JOB_CREATOR)>0);
  assert.ok(fleets.runtimeState.invitesByCharacter instanceof Map);
  // Prove the real invitation/leave contracts without executing fleet mutations.
  const inviteSource=String(fleets.inviteCharacter),leaveSource=String(fleets.leaveFleet);
  assert.match(inviteSource,/ensureFleetMembership\(session, fleetID\)/);
  assert.doesNotMatch(inviteSource,/ensureFleetBoss|ensureFleetCommander/);
  assert.match(inviteSource,/getFleetForCharacter\(normalizedInvitee\)/);
  assert.match(inviteSource,/createInviteRecord\(fleet, inviterCharID, normalizedInvitee, placement, options\)/);
  assert.match(inviteSource,/"OnFleetInvite"/);
  assert.match(leaveSource,/ensureFleetMembership\(session, fleetID\)/);
  assert.match(leaveSource,/removeMemberFromFleet\(fleet, characterID/);
  const fleetSource=fs.readFileSync(path.join(root,"server/src/services/fleets/fleetRuntime.js"),"utf8");
  assert.match(fleetSource,/\["autoAccept", autoAccept\]/);
  assert.match(fleetSource,/autoAccept: Boolean\(options.autoAccept\)/);
  assert.equal(fleets.FLEET.FLEET_ROLE_MEMBER,4);
  assert.equal(types.resolveItemByTypeID(656).groupID, 28);
  const state = {generalMiningHoldCapacity:42000,asteroidHoldCapacity:25000};
  assert.equal(mining.getShipHoldCapacityByFlag(state,134),42000);
  assert.equal(mining.getShipHoldCapacityByFlag(state,182),25000);
  const ore = {typeID:123456791,categoryID:25,groupID:450};
  assert.equal(mining.getPreferredMiningHoldFlagForType(state,ore),182);
  assert.equal(mining.getPreferredMiningHoldFlagForType({generalMiningHoldCapacity:42000},ore),134);
  assert.equal(mining.classifyMiningMaterialType(ore).kind,"ore");
  assert.equal(mining.classifyMiningMaterialType({typeID:123456789,categoryID:25,groupID:465}).kind,"ice");
  assert.equal(mining.classifyMiningMaterialType({typeID:123456790,categoryID:25,groupID:711}).kind,"gas");
  // Use an isolated owner identity, avoiding any real guest character lookup.
  assert.equal(shipServices.canUseShipServiceFlag({characterID:42},{itemID:900000001,ownerID:42},155),true);
  assert.equal(industry.isCompressedType(1230),false);
  // Exercise the actual native capacity handler with an isolated bound context.
  // Only record lookup/calculation are fixtures; no real account inventory binds.
  const broker = Object.create(Broker.prototype); broker._boundContexts = new Map();
  let context = null, queried = [];
  broker._getBoundContext = () => context;
  broker._makeBoundSubstruct = value => {context=value;return value;};
  broker._ensureSecureContainerGeneralAccess = (session,id) => assert.equal(id,900000001);
  broker._traceInventory = () => {};
  broker._calculateCapacity = (session,bound,flag) => {
    assert.equal(bound,context);queried.push(flag);
    return broker._buildCapacityInfo(mining.getShipHoldCapacityByFlag(state,flag),5);
  };
  broker._makeBoundSubstruct({inventoryID:900000001,flagID:null,kind:"ship",locationID:300});
  for(const flag of [182,134]) assert.deepEqual(Object.fromEntries(broker.Handle_GetCapacity([flag],{characterID:42},{}).args.entries),
    {capacity:mining.getShipHoldCapacityByFlag(state,flag),used:5});
  assert.deepEqual(queried,[182,134]);
  const source=loot.buildSpaceLootSourceFromItem({itemID:900000002,typeID:23,categoryID:12,ownerID:99});
  assert.equal(typeof source,"object");
  assert.equal(source.ownerID,99);assert.equal(source.itemID,900000002);
  assert.equal(loot.sessionHasSpaceLootRight({characterID:42},{ownerID:42,lootInfo:{}}),true);
  assert.equal(loot.sessionHasSpaceLootRight({characterID:42},{ownerID:99,lootInfo:{abandoned:true}}),true);
  assert.equal(loot.sessionHasSpaceLootRight({characterID:42},null),false);
  // The actual native loot algorithm runs against isolated read-only identity
  // queries. No real character, native fleet map or invitation is modified.
  const oldCharacterQuery=characters.getCharacterRecord,oldFleetQuery=fleets.getSessionFleetState;
  try {
    characters.getCharacterRecord=id=>Number(id)===900000099?{characterID:id}:null;
    fleets.getSessionFleetState=session=>({fleetid:session.fixtureFleetID||null});
    const source={ownerID:900000099,locationID:300,lootInfo:loot.buildSpaceLootRightsSnapshot({fleetID:10})};
    assert.equal(loot.sessionHasSpaceLootRight({characterID:42,fixtureFleetID:10,_space:{systemID:300}},source),true);
    assert.equal(loot.sessionHasSpaceLootRight({characterID:42,fixtureFleetID:20,_space:{systemID:300}},source),false);
    assert.equal(loot.sessionHasSpaceLootRight({characterID:42,fixtureFleetID:10,_space:{systemID:301}},source),false);
    source.lootInfo=loot.buildSpaceLootRightsSnapshot({fleetID:0});
    assert.equal(loot.sessionHasSpaceLootRight({characterID:42,fixtureFleetID:10,_space:{systemID:300}},source),false);
    source.lootInfo.abandoned=true;
    assert.equal(loot.sessionHasSpaceLootRight({characterID:42,fixtureFleetID:20,_space:{systemID:300}},source),true);
    const itemSource=fs.readFileSync(path.join(root,"server/src/services/inventory/itemStore.js"),"utf8");
    assert.match(itemSource,/createdAtMs/);assert.match(itemSource,/expiresAtMs/);
  } finally {characters.getCharacterRecord=oldCharacterQuery;fleets.getSessionFleetState=oldFleetQuery;}
  assert.equal(interaction.canEntitiesInteractLocally({itemID:1},{itemID:2}),true);
  assert.equal(interaction.canEntitiesInteractLocally({itemID:1,abyssalRunID:10,abyssalRoomIndex:1},
    {itemID:2,abyssalRunID:11,abyssalRoomIndex:1}),false);
  assert.deepEqual(blockedWrites,[]);
  console.log("PASS: real native transport/fleet-ore exports, member invitation/autoAccept and owned leave source contracts, scoped creation-time fleet loot rights, can fingerprint fields, ship-service authorization, compressed classifier, 134/182 hold selection, capacity RPC binding/records, ore classifier and interaction scope; no writes, ticks, invitations or inventory/movement mutations.");
} catch(error) {
  console.error(error.stack);console.error("Blocked writes:",blockedWrites);process.exitCode=1;
}
