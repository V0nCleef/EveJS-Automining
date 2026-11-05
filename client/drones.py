# Python 2.7. Use the player's native named groups and normal launch command.
def _am_drone_bay():
    # The native bay view only exists in space. The server can report the
    # active ship's bay in both states, so ask it before filtering groups.
    try:
        response = _am_json.loads(sm.RemoteSvc('miningScanMgr').AutoMiningDroneBay() or '{}')
        if response.get('success') and isinstance(response.get('bay'), dict):
            return response['bay']
    except Exception as error:
        print('AUTOMINING_DRONE_BAY: ' + str(error))
    return None


def _am_drone_groups(bay=None):
    # Groups are client-side; membership is drone item IDs. When the server
    # reports this ship's bay, keep only groups that actually have drones in
    # it and show how many, so the list is short and ship-specific.
    from eve.client.script.ui.inflight.drones.droneGroupsController import GetDroneGroupsController
    groups = GetDroneGroupsController().GetGroupsByName()
    in_bay = None
    if isinstance(bay, dict) and isinstance(bay.get('itemIDs'), list):
        in_bay = set([int(x) for x in bay.get('itemIDs')])
    rows = []
    for name, group in groups.items():
        if not group.get('id'):
            continue
        key = _am_json.dumps(list(group['id']), ensure_ascii=True, separators=(',', ':'))
        members = set([int(x) for x in (group.get('droneIDs') or [])])
        quantities = bay.get('quantities') if isinstance(bay, dict) else None
        count = sum(max(1, int((quantities or {}).get(str(itemID), 1))) for itemID in members & in_bay) if in_bay is not None else None
        rows.append((key, unicode(name), count))
    if in_bay is not None:
        matched = [row for row in rows if row[2] > 0]
        # An empty bay would hide every group; keep the full list so a
        # selection can still be made before drones are moved aboard.
        rows = matched if matched else [(key, name, None) for key, name, _ in rows]
    rows.sort(key=lambda row: (row[2] is None, -(row[2] or 0), row[1].lower()))
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
        from eve.client.script.ui.inflight.drones.dronesUtil import GetDronesInBay
        from eve.client.script.ui.services.menuSvcExtras.droneFunctions import LaunchDrones
        groupID = tuple(_am_json.loads(request['groupKey']))
        control = GetDroneGroupsController()
        group = control.GetGroupByID(groupID)
        if group is None:
            raise RuntimeError('Selected drone group is unavailable. Select it again in Drones.')
        bay = [item for item in GetDronesInBay() if item.itemID in group['droneIDs']]
        ids = [item.itemID for item in bay]
        if not ids:
            raise RuntimeError('No drones from the selected group are in this ship\'s drone bay.')
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
        result = 'Drone launch: ' + unicode(error)
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
