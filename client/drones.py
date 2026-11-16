# Python 2.7. Native membership is authoritative; names never assign drones.
def _am_drone_context():
    return (int(getattr(session, 'charid', 0) or 0), int(getattr(session, 'shipid', 0) or 0))


def _am_owned_drone_bay_items():
    # Existing native invCache.ListDroneBay supplies identity in both states.
    context = _am_drone_context()
    if not all(context):
        return None
    try:
        from eve.client.script.ui.inflight.drones.dronesUtil import GetDronesInBay
        items = GetDronesInBay()
        if items is None:
            return None
        owned = []
        for item in items:
            if any(getattr(item, key, None) is None for key in ('ownerID', 'locationID', 'flagID')):
                return None
            if (int(item.ownerID) != context[0] or int(item.locationID) != context[1] or
                    int(item.flagID) != 87):
                continue
            if getattr(item, 'categoryID', 18) != 18:
                continue
            # Assembled drones encode quantity=-1, singleton=1, stacksize=1.
            quantity = getattr(item, 'quantity', None)
            if int(getattr(item, 'singleton', 0) or 0) != 1 and quantity is not None and int(quantity) <= 0:
                continue
            owned.append(item)
        return owned if context == _am_drone_context() else None
    except Exception:
        return None


def _am_drone_bay():
    context = _am_drone_context()
    items = _am_owned_drone_bay_items()
    if items is None or context != _am_drone_context():
        return None
    return {'characterID': context[0], 'shipID': context[1],
            'itemIDs': [int(item.itemID) for item in items],
            'groupIDs': dict((str(item.itemID), getattr(item, 'groupID', None)) for item in items),
            'quantities': dict((str(item.itemID), max(1, int(getattr(item, 'stacksize', 1) or 1))) for item in items)}


def _am_owned_drones_in_space():
    context = _am_drone_context()
    if not all(context):
        return None
    if getattr(session, 'stationid', None) or getattr(session, 'structureid', None):
        return {}
    try:
        michelle = sm.GetService('michelle')
        if michelle.GetBallpark() is None:
            return None
        # Native GetDronesInLocalSpace accepts owner OR controller. Require both.
        drones = dict((int(itemID), drone) for itemID, drone in (michelle.GetDrones() or {}).items()
                      if int(getattr(drone, 'ownerID', 0) or 0) == context[0] and
                      int(getattr(drone, 'controllerID', 0) or 0) == context[1])
        return drones if context == _am_drone_context() else None
    except Exception:
        return None


def _am_drone_groups(bay=None):
    # A saved name does not prove its item IDs match this ship. Keep every native
    # group selectable, with read-only owned bay/deployed availability.
    from eve.client.script.ui.inflight.drones.droneGroupsController import GetDroneGroupsController
    groups = GetDroneGroupsController().GetGroupsByName()
    in_bay = None
    context = _am_drone_context()
    if (isinstance(bay, dict) and isinstance(bay.get('itemIDs'), list) and
            (bay.get('characterID'), bay.get('shipID')) == context):
        in_bay = set([int(x) for x in bay.get('itemIDs')])
    deployed = _am_owned_drones_in_space()
    if context != _am_drone_context():
        in_bay, deployed = None, None
    rows = []
    for name, group in groups.items():
        if not group.get('id'):
            continue
        key = _am_json.dumps(list(group['id']), ensure_ascii=True, separators=(',', ':'))
        members = set([int(x) for x in (group.get('droneIDs') or [])])
        quantities = bay.get('quantities') if isinstance(bay, dict) else None
        expected_group = group.get('droneGroupID')
        matched_bay = (set(itemID for itemID in members & in_bay if expected_group is None or
                       (bay.get('groupIDs') or {}).get(str(itemID)) == expected_group) if in_bay is not None else None)
        count = sum(max(1, int((quantities or {}).get(str(itemID), 1))) for itemID in matched_bay) if matched_bay is not None else None
        outside = len(members.intersection(deployed)) if deployed is not None else None
        state = ('matched' if count else 'deployed' if outside else
                 'unmatched' if count is not None and outside is not None else 'unknown')
        rows.append((key, unicode(name), {'bay': count, 'deployed': outside, 'state': state}))
    rows.sort(key=lambda row: (row[2]['bay'] is None, -(row[2]['bay'] or 0),
                              -(row[2]['deployed'] or 0), row[1].lower()))
    return rows


def _am_drones_ready():
    sm.RemoteSvc('miningScanMgr').AutoMiningDronesReady()


def _am_launch_drones(self, message):
    _am_uthread.new(_am_launch_drones_work, message)


def _am_launch_drones_work(message):
    request = _am_json.loads(message)
    launched = []
    def valid():
        return (globals().get('_am_is_active', lambda: True)() and
                session.charid == request['characterID'] and session.shipid == request['shipID'] and
                getattr(session, 'solarsystemid', None) and not getattr(session, 'stationid', None))
    if not valid():
        return
    remote = sm.RemoteSvc('miningScanMgr')
    try:
        # The server can reach the saved position before the client finishes
        # its warp animation. Keep this arrival pending instead of consuming
        # its one-shot grant and silently dropping the launch.
        michelle = sm.GetService('michelle')
        for attempt in range(40):
            if not valid():
                return
            if not michelle.InWarp():
                break
            _am_blue.pyos.synchro.SleepWallclock(500)
        else:
            raise RuntimeError('Still waiting for landing after 20 seconds. Use Start / Resume to retry.')
        from eve.client.script.ui.inflight.drones.droneGroupsController import GetDroneGroupsController
        from eve.client.script.ui.services.menuSvcExtras.droneFunctions import LaunchDrones
        groupID = tuple(_am_json.loads(request['groupKey']))
        control = GetDroneGroupsController()
        group = control.GetGroupByID(groupID)
        if group is None:
            raise RuntimeError(_am_tr('Selected native drone group is unavailable. Refresh groups. If it is still missing, close EVE and use Launcher Settings > Recover drone groups.'))
        owned = _am_owned_drone_bay_items()
        if owned is None:
            raise RuntimeError(_am_tr('Drone bay is not ready. Wait for ship inventory, then refresh groups.'))
        # Use a native declared drone kind when present; never infer it from the name.
        expected_group = group.get('droneGroupID')
        bay = [item for item in owned if item.itemID in group['droneIDs'] and
               (expected_group is None or getattr(item, 'groupID', None) == expected_group)]
        ids = [item.itemID for item in bay]
        if not ids:
            outside = _am_owned_drones_in_space()
            if outside is not None and set(group['droneIDs']).intersection(outside):
                # No claim, relaunch or adoption of manually deployed drones.
                if valid():
                    try:
                        remote.AutoMiningDroneResult(request['id'], _am_tr('The selected group is already deployed; no additional drones were launched.'), [])
                    except Exception:
                        pass
                return
            raise RuntimeError(_am_tr('The selected group has no owned drones in this ship\'s bay. Refresh groups. If it still has no matches, close EVE and use Launcher Settings > Recover drone groups. If recovery cannot verify membership, regroup your drones in EVE.'))
        if not valid():
            return
        response = _am_json.loads(remote.AutoMiningDroneClaim(request['id']))
        if not response.get('success'):
            return
        if not valid():
            return
        if michelle.InWarp():
            raise RuntimeError('Warp started before launch. Waiting for the next arrival.')
        def members():
            current = control.GetGroupByID(groupID)
            return sorted(current.get('droneIDs', [])) if current else []
        def visible():
            drones = michelle.GetDrones() or {}
            return [itemID for itemID in members() if itemID in drones and
                    getattr(drones[itemID], 'ownerID', None) == session.charid and
                    getattr(drones[itemID], 'controllerID', None) == session.shipid]
        expected = len(visible()) + sum(max(1, int(getattr(item, 'stacksize', 1) or 1)) for item in bay)
        # No combat/mining orders: Alternate Mining Drones can take over normally.
        LaunchDrones(ids)
        # The server may launch before Michelle records the drone-state batch.
        # Launching a stack creates new item IDs. The native group follows those
        # splits; reread it instead of tracking only the original stack ID.
        for attempt in range(4):
            if not valid():
                return
            launched = visible()
            if len(launched) >= expected:
                break
            _am_blue.pyos.synchro.SleepWallclock(500)
        if len(launched) < expected and not michelle.InWarp():
            remote.AutoMiningDroneSync(request['id'], members()[:25])
            for attempt in range(4):
                if not valid():
                    return
                launched = visible()
                if len(launched) >= expected:
                    break
                _am_blue.pyos.synchro.SleepWallclock(500)
        result = ('%s drone(s) visible in the native Drones window.' % len(launched) if launched else
                  'Drone launch was not reflected in the native Drones window; check before warping.')
    except Exception as error:
        result = _am_tr('Drone launch: %s', unicode(error))
    if valid():
        try:
            remote.AutoMiningDroneResult(request['id'], result[:500], launched)
        except Exception:
            pass


def _am_rat_groups(self, message):
    _am_uthread.new(_am_rat_groups_work, message)


def _am_rat_groups_work(message):
    try:
        request = _am_json.loads(message)
        if (not globals().get('_am_is_active', lambda: True)() or
                session.charid != request['characterID'] or session.shipid != request['shipID']):
            return
        from eve.client.script.ui.inflight.drones.droneGroupsController import GetDroneGroupsController
        control = GetDroneGroupsController()
        def members(key):
            if not key:
                return []
            group = control.GetGroupByID(tuple(_am_json.loads(key)))
            return sorted([int(itemID) for itemID in group.get('droneIDs', [])]) if group else []
        request['miningIDs'] = members(request['miningKey'])
        request['fighterIDs'] = members(request['fighterKey'])
        sm.RemoteSvc('miningScanMgr').AutoMiningRatGroups(_am_json.dumps(request))
    except Exception as error:
        print('AUTOMINING_RAT_GROUPS: ' + str(error))


if 'OnAutoMiningLaunchDrones' not in EveCommandService.__notifyevents__:
    EveCommandService.__notifyevents__ = list(EveCommandService.__notifyevents__) + ['OnAutoMiningLaunchDrones']
    EveCommandService.OnAutoMiningLaunchDrones = _am_launch_drones
if 'OnAutoMiningRatGroups' not in EveCommandService.__notifyevents__:
    EveCommandService.__notifyevents__ = list(EveCommandService.__notifyevents__) + ['OnAutoMiningRatGroups']
    EveCommandService.OnAutoMiningRatGroups = _am_rat_groups
