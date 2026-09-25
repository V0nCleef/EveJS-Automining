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
        if service.fleet is None or service.fleetID != fleetID:
            service.fleet = GetFleet(fleetID)
            service.InitFleet()
    except Exception as error:
        print('AUTOMINING_FLEET_INIT: ' + str(error))


if 'OnAutoMiningFleetReady' not in EveCommandService.__notifyevents__:
    EveCommandService.__notifyevents__ = list(EveCommandService.__notifyevents__) + ['OnAutoMiningFleetReady']
    EveCommandService.OnAutoMiningFleetReady = _am_fleet_ready
