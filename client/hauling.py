# Python 2.7. Fixed native navigation and inventory operations, independent of HUD.
_am_haul_job = None


def _am_docked_location_id():
    return int(getattr(session, 'structureid', None) or getattr(session, 'stationid', None) or 0)


class _AutoMiningHaul(object):
    def __init__(self, trip):
        self.id = trip['id']
        self.character = session.charid
        self.ship = trip['shipID']
        self.cancelled = False
        self.oldRoute = None
        self.ownedRoute = None
        self.routeArrived = False
        self.stage = None
        self.autoOwned = False
        self.undockOwned = False
        self.cleaned = False

    def valid(self):
        return (not self.cancelled and _am_haul_job is self and session.charid == self.character and
                session.shipid == self.ship and globals().get('_am_is_active', lambda: True)())

    def request(self, action='poll', reason=''):
        if not self.valid():
            raise RuntimeError('Return trip interrupted')
        response = _am_json.loads(sm.RemoteSvc('miningScanMgr').AutoMiningHaulAction(self.id, action, reason))
        if not self.valid():
            raise RuntimeError('Return trip interrupted')
        if not response.get('success'):
            raise RuntimeError(response.get('message', 'Return trip failed'))
        return response['trip']

    def set_route(self, destination):
        autopilot = sm.GetService('autoPilot')
        starmap = sm.GetService('starmap')
        if self.oldRoute is None:
            if autopilot.GetState():
                raise RuntimeError('Autopilot is already in use. Hauling paused.')
            self.oldRoute = list(starmap.GetWaypoints())
        elif not self.route_is_owned():
            raise RuntimeError('Route changed manually. Hauling cancelled.')
        if self.autoOwned:
            autopilot.SetOff()
        self.ownedRoute = [destination]
        self.routeArrived = False
        # Record ownership before changing the route, for reconnect recovery.
        settings.char.ui.Set('evejsAutoMiningTrip', {'old': self.oldRoute, 'owned': self.ownedRoute, 'ship': self.ship})
        starmap.SetWaypoints(list(self.ownedRoute))
        if not self.valid():
            raise RuntimeError('Return trip interrupted')
        route = starmap.GetDestinationPath()
        if not route or None in route:
            raise RuntimeError('No route to the selected destination with your route settings.')
        self.autoOwned = True
        autopilot.SetOn()
        if not autopilot.GetState():
            raise RuntimeError('Autopilot could not be enabled.')

    def route_is_owned(self):
        current = list(sm.GetService('starmap').GetWaypoints())
        return current == self.ownedRoute or (not current and self.routeArrived)

    def check_route(self, arrived=False, navigating=True):
        self.routeArrived = arrived
        if not self.route_is_owned():
            raise RuntimeError('Route changed manually. Hauling cancelled.')
        if navigating and not arrived and not sm.GetService('autoPilot').GetState():
            raise RuntimeError('Autopilot was stopped. Hauling cancelled.')

    def cleanup(self):
        if self.cleaned:
            return
        self.cleaned = True
        if session.charid != self.character:
            return
        if self.autoOwned and self.route_is_owned():
            sm.GetService('autoPilot').SetOff()
        if self.undockOwned and _am_docked_location_id():
            undocking = sm.GetService('undocking')
            if not undocking.PastUndockPointOfNoReturn():
                undocking.AbortUndock()
        if self.oldRoute is not None and self.route_is_owned():
            sm.GetService('starmap').SetWaypoints(list(self.oldRoute))
        settings.char.ui.Set('evejsAutoMiningTrip', None)

    def run(self):
        try:
            while self.valid():
                trip = self.request()
                phase = trip['phase']
                if phase == 'idle':
                    return
                station = trip['station']['stationID']
                origin = trip['origin']['systemID']
                if self.ownedRoute is not None:
                    arrived = (self.routeArrived or self.ownedRoute == [station] and _am_docked_location_id() == station or
                               self.ownedRoute == [origin] and getattr(session, 'solarsystemid', None) == origin)
                    self.check_route(arrived, self.stage == phase and phase in ('outbound', 'inbound'))
                if phase != self.stage:
                    self.stage = phase
                    if phase == 'outbound':
                        self.set_route(station)
                    elif phase == 'unloading':
                        self.routeArrived = True
                        if self.autoOwned:
                            sm.GetService('autoPilot').SetOff()
                        if _am_docked_location_id() != station:
                            raise RuntimeError('Not docked at the selected station.')
                        dest = trip['storage']
                        cache = sm.GetService('invCache')
                        if dest['kind'] == 'personal':
                            from eve.common.lib import appConst as _am_invconst
                            inventory = cache.GetInventory(_am_invconst.containerHangar)
                        else:
                            inventory = cache.GetInventoryFromId(dest['locationID'])
                        if not self.valid():
                            raise RuntimeError('Return trip interrupted')
                        inventory.MultiAdd([item['itemID'] for item in trip['items']], self.ship, flag=dest['flagID'])
                        # The server verifies empty hold AND gains in chosen storage.
                        self.request('unloaded')
                    elif phase == 'undocking':
                        # Recheck server state immediately before an irreversible session move.
                        self.request()
                        self.undockOwned = True
                        sm.GetService('undocking').ExitDockableLocation()
                    elif phase == 'inbound':
                        self.undockOwned = False
                        if getattr(session, 'solarsystemid', None) != origin:
                            self.set_route(origin)
                    elif phase == 'returning':
                        self.routeArrived = True
                        if self.autoOwned:
                            sm.GetService('autoPilot').SetOff()
                if phase == 'returning':
                    reached = self.request('position')
                    if reached.get('atOrigin'):
                        # Restore the player's route before mining can resume.
                        self.cleanup()
                        self.autoOwned = False
                        self.oldRoute = None
                        self.request('complete')
                        return
                _am_blue.pyos.synchro.SleepWallclock(1000)
        except Exception as error:
            if self.valid():
                try:
                    self.request('cancel', unicode(error)[:200])
                except Exception:
                    pass
                try:
                    _am_feedback(None, 'AutoMining hauling paused: ' + unicode(error))
                except Exception:
                    pass
        finally:
            try:
                self.cleanup()
            finally:
                self.cancelled = True


def _am_haul(self, raw):
    global _am_haul_job
    trip = _am_json.loads(raw)
    if trip.get('cancel'):
        if _am_haul_job and _am_haul_job.id == trip['cancel']:
            _am_haul_job.cancelled = True
            _am_uthread.new(_am_haul_job.cleanup)
        return
    if _am_haul_job and _am_haul_job.id == trip['id']:
        return
    if _am_haul_job and _am_haul_job.valid():
        return
    if _am_haul_job:
        _am_haul_job.cleanup()
    _am_haul_job = _AutoMiningHaul(trip)
    _am_uthread.new(_am_haul_job.run)


def _am_haul_ready():
    # Only reconnect recovery may touch a persisted route. No trip is replayed.
    previous = settings.char.ui.Get('evejsAutoMiningTrip', None)
    if previous:
        starmap = sm.GetService('starmap')
        if list(starmap.GetWaypoints()) == previous.get('owned'):
            sm.GetService('autoPilot').SetOff()
            starmap.SetWaypoints(previous.get('old', []))
        settings.char.ui.Set('evejsAutoMiningTrip', None)
    sm.RemoteSvc('miningScanMgr').AutoMiningHaulReady()


if 'OnAutoMiningHaul' not in EveCommandService.__notifyevents__:
    EveCommandService.__notifyevents__ = list(EveCommandService.__notifyevents__) + ['OnAutoMiningHaul']
    EveCommandService.OnAutoMiningHaul = _am_haul
