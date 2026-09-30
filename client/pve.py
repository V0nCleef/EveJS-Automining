# Python 2.7. No travel runs at import: every movement first requires a current
# server job, current ship identity, and an immediate single-use authorization.
_am_pve_job = None
_am_pve_heartbeat = None
_am_pve_planning = False
_am_pve_plan_failure = None


def _am_pve_system():
    return getattr(session, 'solarsystemid2', None) or getattr(session, 'solarsystemid', None)


def _am_pve_id(value):
    return isinstance(value, (int, type(1 << 40))) and not isinstance(value, bool) and value > 0


def _am_pve_preview_path(source, destination, limit=201):
    if not _am_pve_id(source) or not _am_pve_id(destination):
        raise RuntimeError('No route with your route settings.')
    if source == destination:
        return [source]
    # This uses the native autopilot state: security preferences, avoidance
    # systems and gate restrictions. Preview never changes player waypoints.
    path = list(sm.GetService('clientPathfinderService').GetAutopilotPathBetween(source, destination) or [])
    if not path or any(not _am_pve_id(value) for value in path) or path[-1] != destination:
        raise RuntimeError('No route with your route settings.')
    if path[0] != source:
        path.insert(0, source)
    if len(path) > limit or len(set(path)) != len(path):
        raise RuntimeError('No route with your route settings.')
    return path


def _am_pve_prepare(response):
    global _am_pve_planning, _am_pve_plan_failure
    if (_am_pve_planning or not response.get('success') or
            _am_pve_job and _am_pve_job.valid() or not globals().get('_am_is_active', lambda: True)()):
        return
    view = response.get('pve') or {}
    if view.get('job'):
        _am_pve(None, _am_json.dumps(view['job']))
        return
    deployment = view.get('deployment') or {}
    offers = deployment.get('offers') or []
    character, ship = session.charid, session.shipid
    _am_pve_planning = True
    failure = None
    try:
        for offer in offers[:8]:
            try:
                destination = (offer.get('anchor') or offer['home'])['systemID']
                limit = 51 if deployment.get('mode') == 'standby' and offer['id'] != 'home' else 201
                systems = _am_pve_preview_path(_am_pve_system(), destination, limit)
                home = (_am_pve_preview_path(offer['home']['systemID'], destination, limit)
                        if deployment.get('mode') == 'standby' else [])
                if (session.charid != character or session.shipid != ship or
                        not globals().get('_am_is_active', lambda: True)() or _am_pve_job and _am_pve_job.valid()):
                    return
                result = _am_json.loads(sm.RemoteSvc('miningScanMgr').AutoMiningPVEPlan(
                    _am_json.dumps(dict(offerID=offer['id'], shipID=ship, systems=systems, homeSystems=home))))
                if session.charid != character or session.shipid != ship:
                    return
                if result.get('success') and (result.get('pve') or {}).get('job'):
                    _am_pve_plan_failure = None
                    _am_pve(None, _am_json.dumps(result['pve']['job']))
                    return
                ammo = result.get('pveAmmo') or {}
                failure = ammo.get('status') if ammo.get('ready') is False else None
                failure = failure or ((result.get('pve') or {}).get('deployment') or {}).get('status') or result.get('message', 'PVE request failed.')
            except Exception as error:
                failure = unicode(error)[:200]
        if failure and _am_pve_plan_failure != (character, ship, failure):
            _am_pve_plan_failure = (character, ship, failure)
            print('AUTOMINING_PVE:PLAN_FAILED ' + failure)
            _am_feedback(None, globals().get('_am_status', _am_tr)(failure))
        elif not offers:
            _am_pve_plan_failure = None
    finally:
        _am_pve_planning = False


class _AutoMiningPVE(object):
    def __init__(self, job):
        self.id, self.nonce, self.ship = job['id'], job['nonce'], job['shipID']
        self.character = session.charid
        self.cancelled = False
        self.oldRoute = self.ownedRoute = None
        self.autoOwned = False
        self.arrived = False
        self.stage = None
        self.orbit = None
        self.approvedPath = None
        self.routeDestination = None
        self.undockIssued = False
        self.lastAction = None

    def valid(self):
        return (not self.cancelled and _am_pve_job is self and session.charid == self.character and
                session.shipid == self.ship and globals().get('_am_is_active', lambda: True)())

    def request(self, action='poll', payload=None):
        if not self.valid():
            raise RuntimeError('PVE job interrupted.')
        values = dict(payload or {})
        values['nonce'] = self.nonce
        self.lastAction = action
        response = _am_json.loads(sm.RemoteSvc('miningScanMgr').AutoMiningPVEAction(
            self.id, action, _am_json.dumps(values)))
        if not self.valid():
            raise RuntimeError('PVE job interrupted.')
        if not response.get('success'):
            raise RuntimeError(response.get('message', 'PVE request failed.'))
        view = response['pve']
        job = view.get('job')
        if job:
            if job.get('id') != self.id or job.get('shipID') != self.ship or not job.get('nonce'):
                raise RuntimeError('PVE job changed.')
            self.nonce = job['nonce']
        return view

    def authorize(self, action, phase, grant):
        view = self.request(action)
        job = view.get('job') or {}
        if job.get('phase') == phase and view.get('authorized') and job.get('grant') == grant:
            return job
        return None

    def route_owned(self):
        current = list(sm.GetService('starmap').GetWaypoints())
        return current == self.ownedRoute or not current and self.arrived

    def prime_route(self, job):
        target = sm.GetService('autoPilot').GetNextItemIDInRoute()
        if not _am_pve_id(target):
            return False
        view = self.request('authorizeGate', dict(gateID=target))
        current = view.get('job') or {}
        return bool(view.get('authorized') and current.get('phase') == job['phase'] and current.get('grant') == 'authorizeGate')

    def set_route(self, destination, job=None):
        autopilot, starmap = sm.GetService('autoPilot'), sm.GetService('starmap')
        if autopilot.GetState():
            raise RuntimeError('Autopilot is already in use. PVE paused.')
        if job:
            system = (job['home']['systemID'] if job['phase'] == 'returning' else job['anchor']['systemID']) if job.get('deployment') else job['belt']['systemID']
            selected = _am_pve_preview_path(_am_pve_system(), system)
            view = self.request('authorizeRoute', dict(systems=selected))
            current = view.get('job') or {}
            route = current.get('route') or {}
            if not view.get('authorized') or current.get('phase') != job['phase']:
                return False
            assigned = system if job['phase'] == 'returning' else destination
            if route.get('systems') != selected or route.get('destinationID') != assigned or route.get('destinationSystemID') != system:
                raise RuntimeError('PVE job changed.')
            self.approvedPath = selected
            self.routeDestination = (destination, system)
        self.oldRoute = list(starmap.GetWaypoints())
        self.ownedRoute = [int(destination)]
        settings.char.ui.Set('evejsAutoMiningPVE', {'id': self.id, 'old': self.oldRoute, 'owned': self.ownedRoute, 'ship': self.ship})
        starmap.SetWaypoints(list(self.ownedRoute))
        if not self.valid():
            raise RuntimeError('PVE job interrupted.')
        route = starmap.GetDestinationPath()
        if not route or None in route:
            raise RuntimeError('No route with your route settings.')
        if self.approvedPath is not None:
            self.check_selected_path()
            if not self.prime_route(job):
                return False
        self.autoOwned = True
        autopilot.SetOn()
        if not autopilot.GetState():
            raise RuntimeError('Autopilot could not be enabled.')
        return True

    def check_selected_path(self):
        selected = list(sm.GetService('starmap').GetDestinationPath() or [])
        destination, system = self.routeDestination
        if selected and destination != system and selected[-1] == destination:
            selected.pop()
        current = _am_pve_system()
        if not selected or selected[0] != current:
            selected.insert(0, current)
        if current not in self.approvedPath or selected != self.approvedPath[self.approvedPath.index(current):]:
            raise RuntimeError('Route changed manually. PVE cancelled.')

    def cleanup_route(self):
        if session.charid != self.character or self.ownedRoute is None:
            return
        marker = settings.char.ui.Get('evejsAutoMiningPVE', None)
        if marker and marker.get('id') != self.id:
            return
        if self.route_owned():
            if self.autoOwned:
                sm.GetService('autoPilot').SetOff()
            sm.GetService('starmap').SetWaypoints(self.oldRoute or [])
        settings.char.ui.Set('evejsAutoMiningPVE', None)
        self.oldRoute = self.ownedRoute = None
        self.autoOwned = False
        self.approvedPath = self.routeDestination = None

    def return_home(self, job):
        michelle = sm.GetService('michelle')
        if michelle.InWarp():
            return
        home = job.get('home') or {}
        if not _am_pve_id(home.get('stationID')) or home.get('systemID') != _am_pve_system():
            raise RuntimeError('PVE job changed.')
        ballpark = michelle.GetBallpark()
        ball = ballpark.GetBall(home['stationID']) if ballpark else None
        from eve.common.lib import appConst
        if ball is None or ball.surfaceDist >= appConst.minWarpDistance:
            authorized = self.authorize('authorizeWarp', 'returning', 'authorizeWarp')
            if authorized and authorized.get('home') == home:
                michelle.CmdWarpToStuff('item', home['stationID'], minRange=0, fleet=False)
                self.request('warped')
        else:
            authorized = self.authorize('authorizeDock', 'returning', 'authorizeDock')
            if authorized and authorized.get('home') == home:
                park = michelle.GetRemotePark()
                if park is not None:
                    # Exact native RealDock call shape, including the session
                    # change service; native docking/range/structure rights apply.
                    from eveexceptions import UserError
                    try:
                        sm.GetService('sessionMgr').PerformSessionChange('dock', park.CmdDock, home['stationID'], self.ship)
                    except UserError as error:
                        if error.msg != 'DockingApproach':
                            raise
                        return
                    self.request('docked')

    def stop_orbit(self, job):
        if not self.orbit or job.get('targetID'):
            return
        authorized = self.authorize('authorizeStopOrbit', job['phase'], 'stop')
        if authorized:
            park = sm.GetService('michelle').GetRemotePark()
            if park is not None:
                park.CmdStop()
                self.request('orbitStopped')
                self.orbit = None

    def run(self):
        try:
            while self.valid():
                view = self.request()
                job = view.get('job')
                if not job:
                    return
                phase, belt = job['phase'], job.get('belt')
                deployment = job.get('deployment') is True
                target = (job.get('home') if phase in ('returning', 'docked') else job.get('anchor')) if deployment else belt
                destination = (target.get('stationID') if phase in ('returning', 'docked') else target.get('systemID')) if target else None
                targetSystem = target.get('systemID') if target else None
                routeTarget = targetSystem if phase == 'returning' else destination
                if job.get('paused'):
                    self.stop_orbit(job)
                    self.cleanup_route()
                    _am_blue.pyos.synchro.SleepWallclock(1000)
                    continue
                # The server can observe undock/arrival before the client has
                # attached its space ballpark. Keep polling while it loads;
                # request movement grants only after the native park exists.
                if not _am_docked_location_id() and sm.GetService('michelle').GetRemotePark() is None:
                    self.orbit = None
                    _am_blue.pyos.synchro.SleepWallclock(1000)
                    continue
                if self.ownedRoute is not None:
                    self.arrived = phase in ('warpBelt', 'warpFleet', 'engaging') or _am_pve_system() == targetSystem
                    if not self.route_owned():
                        raise RuntimeError('Route changed manually. PVE cancelled.')
                    if self.autoOwned and phase in ('routeBelt', 'routeFleet', 'returning') and not self.arrived and not sm.GetService('autoPilot').GetState():
                        raise RuntimeError('Autopilot was stopped. PVE cancelled.')
                    if (self.approvedPath is not None and self.routeDestination == (routeTarget, targetSystem) and
                            phase in ('routeBelt', 'routeFleet', 'returning') and not self.arrived):
                        self.check_selected_path()
                if phase != self.stage:
                    self.stage = phase
                    self.undockIssued = False
                    if phase != 'engaging':
                        self.orbit = None
                    if phase in ('warpBelt', 'warpFleet', 'engaging', 'docked'):
                        self.arrived = True
                        self.cleanup_route()
                if phase in ('undocking', 'returning') and _am_docked_location_id() and not self.undockIssued:
                    authorized = self.authorize('authorizeUndock', phase, 'authorizeUndock')
                    if authorized and _am_docked_location_id():
                        self.undockIssued = True
                        sm.GetService('undocking').ExitDockableLocation()
                if phase in ('routeBelt', 'routeFleet', 'returning') and not _am_docked_location_id():
                    if _am_pve_system() == targetSystem:
                        self.cleanup_route()
                        if phase == 'returning':
                            self.return_home(job)
                    elif self.ownedRoute is None or self.routeDestination != (routeTarget, targetSystem):
                        self.cleanup_route()
                        self.set_route(routeTarget, job)
                    elif self.prime_route(job) and not self.autoOwned:
                        self.autoOwned = True
                        sm.GetService('autoPilot').SetOn()
                if phase == 'warpBelt':
                    authorized = self.authorize('authorizeWarp', 'warpBelt', 'warp')
                    if authorized:
                        sm.GetService('michelle').CmdWarpToStuff('item', authorized['belt']['beltID'], minRange=0, fleet=False)
                        self.request('warped')
                elif phase == 'warpFleet':
                    authorized = self.authorize('authorizeWarp', 'warpFleet', 'authorizeWarp')
                    if authorized:
                        anchor = authorized.get('anchor') or {}
                        if not _am_pve_id(anchor.get('characterID')) or not _am_pve_id(anchor.get('shipID')) or anchor.get('systemID') != _am_pve_system():
                            raise RuntimeError('PVE job changed.')
                        sm.GetService('michelle').CmdWarpToStuff('char', anchor['characterID'], minRange=0, fleet=False)
                        self.request('warped')
                elif phase == 'engaging':
                    orbit = (job.get('targetID'), job.get('orbitRange'))
                    if self.orbit and not orbit[0]:
                        self.stop_orbit(job)
                    elif orbit[0] and orbit[1] and orbit != self.orbit:
                        authorized = self.authorize('authorizeOrbit', 'engaging', 'orbit')
                        if authorized:
                            targetID, distance = authorized.get('targetID'), authorized.get('orbitRange')
                            if not _am_pve_id(targetID) or isinstance(distance, bool) or not isinstance(distance, (int, type(1 << 40), float)) or not 0 < distance < float('inf'):
                                raise RuntimeError('PVE job changed.')
                            if authorized.get('orbitKind') == 'escort':
                                anchor = authorized.get('anchor') or {}
                                if targetID != anchor.get('shipID') or not _am_pve_id(anchor.get('characterID')) or anchor.get('systemID') != _am_pve_system():
                                    raise RuntimeError('PVE job changed.')
                            park = sm.GetService('michelle').GetRemotePark()
                            # A session transition can also begin while the
                            # authorization RPC yields. Retry with a new grant
                            # next poll rather than cancelling or caching it.
                            if park is not None:
                                result = park.CmdOrbit(targetID, distance)
                                if not isinstance(result, dict) or result.get('_amPVEOrbitSkipped') is not True:
                                    self.orbit = (targetID, distance)
                                    self.request('orbited')
                            else:
                                self.orbit = None
                _am_blue.pyos.synchro.SleepWallclock(1000)
        except Exception as error:
            if self.valid():
                reason = unicode(error).replace('\r', ' ').replace('\n', ' ')[:180]
                context = 'action=%s phase=%s %s' % (self.lastAction, self.stage, reason)
                try:
                    print('AUTOMINING_PVE:WORKER_FAILED ' + context)
                except Exception:
                    pass
                try:
                    self.request('cancel', dict(reason=context))
                except Exception:
                    pass
                try:
                    _am_feedback(None, _am_tr('PVE paused; use Start / Resume to retry.'))
                except Exception:
                    pass
        finally:
            self.cleanup_route()
            self.cancelled = True


def _am_pve(self, raw):
    global _am_pve_job
    try:
        job = _am_json.loads(raw)
    except Exception:
        return
    if not isinstance(job, dict):
        return
    if job.get('cancel'):
        if _am_pve_job and _am_pve_job.id == job['cancel']:
            _am_pve_job.cancelled = True
            _am_uthread.new(_am_pve_job.cleanup_route)
        return
    if _am_pve_job and _am_pve_job.valid():
        return
    if globals().get('_am_haul_job') and _am_haul_job.valid() or globals().get('_am_transport_job') and _am_transport_job.valid():
        return
    if _am_pve_job:
        _am_pve_job.cleanup_route()
    if not isinstance(job.get('id'), (str, unicode)) or not isinstance(job.get('nonce'), (str, unicode)) or job.get('shipID') != session.shipid:
        return
    _am_pve_job = _AutoMiningPVE(job)
    _am_uthread.new(_am_pve_job.run)


def _am_pve_ready():
    global _am_pve_heartbeat
    if _am_pve_job and _am_pve_job.valid():
        return
    previous = settings.char.ui.Get('evejsAutoMiningPVE', None)
    if previous:
        starmap = sm.GetService('starmap')
        if list(starmap.GetWaypoints()) == previous.get('owned'):
            sm.GetService('autoPilot').SetOff()
            starmap.SetWaypoints(previous.get('old', []))
        settings.char.ui.Set('evejsAutoMiningPVE', None)
    _am_pve_prepare(_am_pve_ready_response())
    if not _am_pve_heartbeat or _am_pve_heartbeat[0] != session.charid:
        _am_pve_heartbeat = (session.charid, object())
        _am_uthread.new(_am_pve_idle, session.charid, _am_pve_heartbeat)


def _am_pve_idle(character, token):
    global _am_pve_heartbeat
    try:
        while (_am_pve_heartbeat is token and session.charid == character and globals().get('_am_is_active', lambda: True)()):
            _am_blue.pyos.synchro.SleepWallclock(5000)
            if (_am_pve_heartbeat is not token or session.charid != character or not globals().get('_am_is_active', lambda: True)()):
                return
            try:
                # This separate readiness heartbeat proves client liveness
                # while native recall/warp RPCs block the movement worker.
                # It never consumes a navigation grant or changes our nonce.
                if _am_pve_job and _am_pve_job.valid():
                    sm.RemoteSvc('miningScanMgr').AutoMiningPVEHeartbeat(_am_pve_job.id)
                else:
                    _am_pve_prepare(_am_pve_ready_response())
            except Exception:
                pass
    finally:
        if _am_pve_heartbeat is token:
            _am_pve_heartbeat = None


def _am_pve_ready_response():
    character, ship = session.charid, session.shipid
    remote = sm.RemoteSvc('miningScanMgr')
    response = _am_json.loads(remote.AutoMiningPVEReady())
    if session.charid != character or session.shipid != ship or not globals().get('_am_is_active', lambda: True)():
        return dict(success=False)
    key = response.get('pveDroneGroupKey')
    if response.get('success') and response.get('pveDronesEnabled') and key:
        from eve.client.script.ui.inflight.drones.droneGroupsController import GetDroneGroupsController
        group = GetDroneGroupsController().GetGroupByID(tuple(_am_json.loads(key)))
        ids = sorted([int(value) for value in group.get('droneIDs', [])])[:256] if group else []
        response = _am_json.loads(remote.AutoMiningPVEAmmoGroups(_am_json.dumps(dict(shipID=ship, groupKey=key, ids=ids))))
    return response


if 'OnAutoMiningPVE' not in EveCommandService.__notifyevents__:
    EveCommandService.__notifyevents__ = list(EveCommandService.__notifyevents__) + ['OnAutoMiningPVE']
    EveCommandService.OnAutoMiningPVE = _am_pve
