# Python 2.7. Use the player's native named groups and normal launch command.
def _am_drone_groups():
    from eve.client.script.ui.inflight.drones.droneGroupsController import GetDroneGroupsController
    groups = GetDroneGroupsController().GetGroupsByName()
    return sorted([(_am_json.dumps(list(group['id']), ensure_ascii=True, separators=(',', ':')), unicode(name))
                   for name, group in groups.items() if group.get('id')], key=lambda row: row[1].lower())


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
        group = GetDroneGroupsController().GetGroupByID(groupID)
        if group is None:
            raise RuntimeError('Selected drone group is unavailable. Select it again in Drones.')
        ids = [item.itemID for item in GetDronesInBay() if item.itemID in group['droneIDs']]
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
        # No combat/mining orders: Alternate Mining Drones can take over normally.
        LaunchDrones(ids)
        # The server may launch before Michelle records the drone-state batch.
        # Confirm against the same state the native Drones window reads.
        for attempt in range(4):
            if not valid():
                return
            launched = [itemID for itemID in ids if itemID in (michelle.GetDrones() or {})]
            if len(launched) == len(ids):
                break
            _am_blue.pyos.synchro.SleepWallclock(500)
        if len(launched) != len(ids) and not michelle.InWarp():
            remote.AutoMiningDroneSync(request['id'], ids)
            for attempt in range(4):
                if not valid():
                    return
                launched = [itemID for itemID in ids if itemID in (michelle.GetDrones() or {})]
                if len(launched) == len(ids):
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
