# Python 2.7. Bind the fleet created for this pilot through the native service.
def _am_fleet_ready(self, fleetID):
    _am_uthread.new(_am_fleet_ready_work, fleetID)


def _am_fleet_ready_work(fleetID):
    for attempt in range(20):
        if not globals().get('_am_is_active', lambda: True)():
            return
        if session.fleetid == fleetID:
            break
        _am_blue.pyos.synchro.SleepWallclock(250)
    else:
        return
    try:
        from eve.common.script.net.eveMoniker import GetFleet
        service = sm.GetService('fleet')
        if session.fleetid != fleetID:
            return
        # Native ProcessSessionChange clears members even when a moniker/ID
        # is already present. Matching IDs do not attest a complete roster.
        service.fleet = GetFleet(fleetID)
        service.InitFleet()
    except Exception as error:
        print('AUTOMINING_FLEET_INIT: ' + str(error))


if 'OnAutoMiningFleetReady' not in EveCommandService.__notifyevents__:
    EveCommandService.__notifyevents__ = list(EveCommandService.__notifyevents__) + ['OnAutoMiningFleetReady']
    EveCommandService.OnAutoMiningFleetReady = _am_fleet_ready


_am_fleet_management_token = None


def _am_fleet_management_ready():
    global _am_fleet_management_token
    character = getattr(session, 'charid', None)
    if not character:
        return
    if _am_fleet_management_token and _am_fleet_management_token[0] == character:
        return
    token = (character, object())
    _am_fleet_management_token = token
    _am_uthread.new(_am_fleet_management_poll, token)


def _am_fleet_management_poll(token):
    global _am_fleet_management_token
    try:
        while (_am_fleet_management_token is token and getattr(session, 'charid', None) == token[0]
               and globals().get('_am_is_active', lambda: True)()):
            try:
                sm.RemoteSvc('miningScanMgr').AutoMiningFleetReady()
            except Exception:
                pass
            _am_blue.pyos.synchro.SleepWallclock(5000)
    finally:
        if _am_fleet_management_token is token:
            _am_fleet_management_token = None
