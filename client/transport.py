# Python 2.7. Server-owned pickup jobs; the client uses native travel/inventory.
# Every mutation has a fresh server authorization and a phase-specific nonce.
_am_transport_job = None
_am_transport_heartbeat = None


class _AutoMiningTransport(object):
    def __init__(self, job):
        self.id = job['id']
        self.nonce = job['nonce']
        self.character = session.charid
        self.ship = job['shipID']
        self.cancelled = False
        self.oldRoute = None
        self.ownedRoute = None
        self.routeArrived = False
        self.autoOwned = False
        self.undockOwned = False
        self.cleaned = False
        self.stage = None
        self.approachIssued = False

    def valid(self):
        return (not self.cancelled and _am_transport_job is self and session.charid == self.character and
                session.shipid == self.ship and globals().get('_am_is_active', lambda: True)())

    def request(self, action='poll', payload=None):
        if not self.valid():
            raise RuntimeError('Transport job interrupted.')
        values = dict(payload or {})
        values['nonce'] = self.nonce
        response = _am_json.loads(sm.RemoteSvc('miningScanMgr').AutoMiningTransportAction(
            self.id, action, _am_json.dumps(values)))
        if not self.valid():
            raise RuntimeError('Transport job interrupted.')
        if not response.get('success'):
            raise RuntimeError(response.get('message', 'Transport request failed.'))
        view = response['transport']
        job = view.get('job')
        if job:
            if job.get('id') != self.id or job.get('shipID') != self.ship or not job.get('nonce'):
                raise RuntimeError('Transport job changed.')
            self.nonce = job['nonce']
        return view

    def authorize(self, action, phase, grant, payload=None):
        view = self.request(action, payload)
        job = view.get('job') or {}
        if job.get('phase') != phase:
            return None
        if not view.get('authorized') or job.get('grant') != grant:
            return None
        return job

    def warp_subject(self, job):
        subject = (job.get('miner') or {}).get('warpType', 'char')
        if subject == 'item':
            return 'item'
        if subject == 'char':
            return 'char'
        raise RuntimeError('Transport job changed.')

    def route_is_owned(self):
        current = list(sm.GetService('starmap').GetWaypoints())
        return current == self.ownedRoute or (not current and self.routeArrived)

    def check_route(self, arrived=False, navigating=False):
        self.routeArrived = arrived
        if not self.route_is_owned():
            raise RuntimeError('Route changed manually. Transport cancelled.')
        if navigating and not arrived and not sm.GetService('autoPilot').GetState():
            raise RuntimeError('Autopilot was stopped. Transport cancelled.')

    def set_route(self, destination):
        autopilot, starmap = sm.GetService('autoPilot'), sm.GetService('starmap')
        if self.oldRoute is None:
            if autopilot.GetState():
                raise RuntimeError('Autopilot is already in use. Transport paused.')
            self.oldRoute = list(starmap.GetWaypoints())
        elif not self.route_is_owned():
            raise RuntimeError('Route changed manually. Transport cancelled.')
        if self.autoOwned:
            autopilot.SetOff()
        self.ownedRoute, self.routeArrived = [int(destination)], False
        settings.char.ui.Set('evejsAutoMiningTransport',
            {'old': self.oldRoute, 'owned': self.ownedRoute, 'ship': self.ship})
        starmap.SetWaypoints(list(self.ownedRoute))
        if not self.valid():
            raise RuntimeError('Transport job interrupted.')
        route = starmap.GetDestinationPath()
        if not route or None in route:
            raise RuntimeError('No route to the selected destination with your route settings.')
        self.autoOwned = True
        autopilot.SetOn()
        if not autopilot.GetState():
            raise RuntimeError('Autopilot could not be enabled.')

    def stop_owned_autopilot(self):
        if self.autoOwned:
            if not self.route_is_owned():
                raise RuntimeError('Route changed manually. Transport cancelled.')
            sm.GetService('autoPilot').SetOff()
            self.autoOwned = False

    def cleanup(self):
        if self.cleaned:
            return
        self.cleaned = True
        if session.charid != self.character:
            return
        if self.oldRoute is not None and self.route_is_owned():
            if self.autoOwned:
                sm.GetService('autoPilot').SetOff()
            sm.GetService('starmap').SetWaypoints(list(self.oldRoute))
        # Do not abort a committed warp or undo another pilot order.
        settings.char.ui.Set('evejsAutoMiningTransport', None)

    def collect(self, job):
        transfers = job.get('transfers') or []
        candidate = transfers[0] if transfers else None
        payload = {'itemID': candidate['itemID']} if candidate else {}
        authorized = self.authorize('authorizeTransfer', 'loading', 'transfer', payload)
        if not authorized:
            return
        allowed = authorized.get('transfers') or []
        if len(allowed) != 1 or candidate and allowed[0].get('itemID') != candidate['itemID']:
            raise RuntimeError('Transport transfer authorization changed.')
        transfer = allowed[0]
        quantity = int(transfer.get('quantity') or 0)
        if quantity <= 0 or int(transfer.get('flagID') or 0) != int(authorized.get('flagID') or 0):
            raise RuntimeError('Transport transfer authorization changed.')
        if not self.valid():
            raise RuntimeError('Transport job interrupted.')
        inventory = sm.GetService('invCache').GetInventoryFromId(self.ship)
        inventory.Add(transfer['itemID'], transfer['sourceLocationID'], qty=quantity, flag=transfer['flagID'])
        self.request('loaded', {'itemID': transfer['itemID']})

    def unload(self):
        job = self.authorize('authorizeUnload', 'unloading', 'unload')
        if not job:
            return
        if _am_docked_location_id() != job['station']['stationID']:
            raise RuntimeError('Not docked at the selected station.')
        destination = job['storage']
        cache = sm.GetService('invCache')
        if destination['kind'] == 'personal':
            from eve.common.lib import appConst as invconst
            inventory = cache.GetInventory(invconst.containerHangar)
        else:
            inventory = cache.GetInventoryFromId(destination['locationID'])
        if not self.valid():
            raise RuntimeError('Transport job interrupted.')
        items = job.get('items') or []
        if items:
            inventory.MultiAdd([item['itemID'] for item in items], self.ship, flag=destination['flagID'])
        return self.request('unloaded')

    def run(self):
        try:
            while self.valid():
                view = self.request()
                job = view.get('job')
                if not job or job.get('phase') == 'idle':
                    return
                phase = job['phase']
                if phase == 'joining':
                    # Native fleet invitation handling confirms membership.
                    # The lease may only poll here; no route or undock yet.
                    self.stage = phase
                    _am_blue.pyos.synchro.SleepWallclock(1000)
                    continue
                miner = job.get('miner') or {}
                station = (job.get('station') or {}).get('stationID')
                if self.ownedRoute is not None:
                    arrived = (self.routeArrived or phase == 'routePickup' and
                        not _am_docked_location_id() and getattr(session, 'solarsystemid', None) == miner.get('systemID') or
                        phase in ('outbound', 'unloading') and _am_docked_location_id() == station)
                    self.check_route(arrived, self.stage == phase and phase in ('routePickup', 'outbound'))
                if phase != self.stage:
                    self.stage = phase
                    if phase == 'routePickup':
                        if getattr(session, 'solarsystemid', None) != miner['systemID']:
                            self.set_route(miner['systemID'])
                    elif phase == 'outbound':
                        self.set_route(station)
                    elif phase == 'undocking':
                        current = self.request().get('job') or {}
                        if current.get('phase') == 'undocking' and _am_docked_location_id():
                            self.stop_owned_autopilot()
                            self.undockOwned = True
                            sm.GetService('undocking').ExitDockableLocation()
                    elif phase in ('warpPickup', 'approachPickup', 'loading', 'unloading'):
                        self.routeArrived = True
                        self.stop_owned_autopilot()
                if phase == 'warpPickup':
                    self.warp_subject(job)
                    authorized = self.authorize('authorizeWarp', 'warpPickup', 'warp')
                    if authorized:
                        target = authorized['miner'].get('targetID', authorized['miner']['characterID'])
                        sm.GetService('michelle').CmdWarpToStuff(self.warp_subject(authorized), target, minRange=0, fleet=False)
                        self.request('warped')
                elif phase == 'approachPickup':
                    if not self.approachIssued:
                        authorized = self.authorize('authorizeApproach', 'approachPickup', 'approach')
                        if authorized:
                            needed = authorized.get('approachNeeded', True)
                            distance = authorized.get('approachRange')
                            if (needed is not True and needed is not False or
                                    isinstance(distance, bool) or distance != 100):
                                raise RuntimeError('Transport job changed.')
                            if needed:
                                park = sm.GetService('michelle').GetRemotePark()
                                if park is None:
                                    raise RuntimeError('Transport ballpark is unavailable.')
                                park.CmdFollowBall(authorized['miner'].get('approachID', authorized['miner']['shipID']), distance)
                            self.approachIssued = True
                    if self.approachIssued:
                        self.request('arrived')
                elif phase == 'loading':
                    self.collect(job)
                elif phase == 'unloading':
                    result = self.unload()
                    if result is not None and not result.get('job'):
                        return
                _am_blue.pyos.synchro.SleepWallclock(1000)
        except Exception as error:
            if self.valid():
                try:
                    self.request('cancel', {'reason': unicode(error)[:200]})
                except Exception:
                    pass
                try:
                    _am_feedback(None, _am_tr('Transport paused: %s', _am_status(error)))
                except Exception:
                    pass
        finally:
            try:
                self.cleanup()
            finally:
                self.cancelled = True


def _am_transport(self, raw):
    global _am_transport_job
    job = _am_json.loads(raw)
    if job.get('cancel'):
        if _am_transport_job and _am_transport_job.id == job['cancel']:
            _am_transport_job.cancelled = True
            _am_uthread.new(_am_transport_job.cleanup)
        return
    if _am_transport_job and _am_transport_job.id == job.get('id') and _am_transport_job.valid():
        return
    if _am_transport_job and _am_transport_job.valid():
        return
    if globals().get('_am_haul_job') and _am_haul_job.valid():
        return
    if _am_transport_job:
        _am_transport_job.cleanup()
    if not job.get('id') or not job.get('nonce') or job.get('shipID') != session.shipid:
        return
    _am_transport_job = _AutoMiningTransport(job)
    _am_uthread.new(_am_transport_job.run)


def _am_transport_ready():
    global _am_transport_heartbeat
    if not _am_transport_heartbeat or _am_transport_heartbeat[0] != session.charid:
        _am_transport_heartbeat = (session.charid, object())
        _am_uthread.new(_am_transport_idle, session.charid, _am_transport_heartbeat)
    if _am_transport_job and _am_transport_job.valid():
        return
    previous = settings.char.ui.Get('evejsAutoMiningTransport', None)
    if previous:
        starmap = sm.GetService('starmap')
        if list(starmap.GetWaypoints()) == previous.get('owned'):
            sm.GetService('autoPilot').SetOff()
            starmap.SetWaypoints(previous.get('old', []))
        settings.char.ui.Set('evejsAutoMiningTransport', None)
    # Reconnect only restores an owned route. It never replays inventory moves.
    sm.RemoteSvc('miningScanMgr').AutoMiningTransportReady()
def _am_transport_idle(character, token):
    global _am_transport_heartbeat
    try:
        while (_am_transport_heartbeat is token and session.charid == character and
               globals().get('_am_is_active', lambda: True)()):
            _am_blue.pyos.synchro.SleepWallclock(5000)
            if (_am_transport_heartbeat is not token or session.charid != character or
                    not globals().get('_am_is_active', lambda: True)()):
                return
            if not _am_transport_job or not _am_transport_job.valid():
                try:
                    sm.RemoteSvc('miningScanMgr').AutoMiningTransportReady()
                except Exception:
                    pass
    finally:
        if _am_transport_heartbeat is token:
            _am_transport_heartbeat = None


if 'OnAutoMiningTransport' not in EveCommandService.__notifyevents__:
    EveCommandService.__notifyevents__ = list(EveCommandService.__notifyevents__) + ['OnAutoMiningTransport']
    EveCommandService.OnAutoMiningTransport = _am_transport
