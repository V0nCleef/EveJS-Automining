"""Authored client behavior with native API stand-ins, not a live flight test."""
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

NS = types.SimpleNamespace
SOURCE = (Path(__file__).resolve().parents[1] / 'client/hauling.py').read_text()


class Fixture:
    def __init__(self, problem=None, same_system=False, storage='personal', structure=False):
        self.problem = problem
        self.same_system = same_system
        self.structure = structure
        self.events = []
        self.route = [999]
        self.autopilot = 0
        self.saved = {}
        self.session = NS(charid=42, shipid=10, stationid=None, structureid=None, solarsystemid=30)
        self.trip = dict(id='one', phase='outbound', shipID=10, station=dict(stationID=9001 if structure else 600),
                         origin=dict(systemID=30), storage=dict(kind=storage, locationID=777, flagID=116 if storage == 'corporation' else 4),
                         items=[dict(itemID=9)], flagID=134)
        self.sleeps = 0
        self.sm = NS(GetService=lambda name: self, RemoteSvc=lambda name: self)
        self.scope = dict(unicode=str, session=self.session, sm=self.sm, settings=NS(char=NS(ui=self)),
                          _am_json=json, _am_blue=NS(pyos=NS(synchro=NS(SleepWallclock=self.sleep))),
                          _am_uthread=NS(new=lambda fn, *args: None), _am_feedback=lambda *args: None,
                          EveCommandService=type('Commands', (), {'__notifyevents__': []}))
        exec(SOURCE, self.scope)
        self.job = self.scope['_AutoMiningHaul'](self.trip)
        self.scope['_am_haul_job'] = self.job

    def Get(self, key, default=None):
        return self.saved.get(key, default)

    def Set(self, key, value):
        self.saved[key] = value

    def GetState(self):
        return self.autopilot

    def SetOn(self):
        self.events.append('on')
        self.autopilot = 1

    def SetOff(self):
        self.events.append('off')
        self.autopilot = 0

    def GetWaypoints(self):
        return self.route[:]

    def SetWaypoints(self, value):
        self.events.append(('route', value[:]))
        self.route = value[:]

    def GetDestinationPath(self):
        return [None] if self.problem == 'no-route' else self.route[:]

    def AutoMiningHaulAction(self, token, action, reason):
        assert token == 'one'
        self.events.append(('rpc', action))
        if action == 'cancel':
            self.trip['phase'] = 'idle'
        elif action == 'unloaded':
            if self.problem == 'unconfirmed':
                return json.dumps(dict(success=False, message='Ore not confirmed in selected storage'))
            self.trip['phase'] = 'undocking'
        elif action == 'position':
            self.trip['atOrigin'] = True
        elif action == 'complete':
            assert self.route == [999], 'Restore route before resuming mining'
            self.trip['phase'] = 'idle'
        return json.dumps(dict(success=True, trip=self.trip))

    def GetInventory(self, container):
        self.events.append(('inventory', container))
        return self

    def GetInventoryFromId(self, container):
        self.events.append(('inventory-id', container))
        return self

    def MultiAdd(self, items, source, **kwargs):
        assert (self.session.structureid if self.structure else self.session.stationid) == (9001 if self.structure else 600)
        self.events.append(('transfer', items, source, kwargs))
        if self.problem == 'unload':
            raise RuntimeError('Destination full or access denied')

    def ExitDockableLocation(self):
        assert ('rpc', 'unloaded') in self.events
        self.events.append('undock')
        self.session.stationid = None
        self.session.structureid = None
        self.session.solarsystemid = 30 if self.same_system else 31
        self.trip['phase'] = 'returning' if self.same_system else 'inbound'

    def PastUndockPointOfNoReturn(self):
        return False

    def AbortUndock(self):
        self.events.append('abort-undock')

    def sleep(self, ms):
        self.sleeps += 1
        assert self.sleeps < 12, 'Worker failed to finish'
        if self.trip['phase'] == 'outbound':
            if self.problem == 'manual-route':
                self.route = [888]
                return
            if self.problem == 'manual-stop':
                self.autopilot = 0
                return
            if self.structure:
                self.session.structureid = 9001
            else:
                self.session.stationid = 600
            self.session.solarsystemid = None
            self.route = []
            self.autopilot = 0
            self.trip['phase'] = 'unloading'
        elif self.trip['phase'] == 'inbound' and self.job.stage == 'inbound':
            self.session.solarsystemid = 30
            self.route = []
            self.autopilot = 0
            self.trip['phase'] = 'returning'

    def run(self):
        modules = {'eve': types.ModuleType('eve'), 'eve.common': types.ModuleType('eve.common'),
                   'eve.common.lib': NS(appConst=NS(containerHangar=10004))}
        with patch.dict(sys.modules, modules):
            self.job.run()


class ClientTests(unittest.TestCase):
    def test_upwell_trip_uses_structure_location_for_route_and_unload(self):
        f = Fixture(structure=True)
        f.run()
        self.assertIn(('route', [9001]), f.events)
        self.assertIn(('rpc', 'complete'), f.events)
        self.assertIn('undock', f.events)
        self.assertEqual(f.route, [999])

    def test_round_trip_uses_native_apis_and_restores_waypoints(self):
        for same_system in (False, True):
            for storage in ('personal', 'corporation', 'container'):
                with self.subTest(same_system=same_system, storage=storage):
                    f = Fixture(same_system=same_system, storage=storage)
                    f.run()
                    self.assertIn('undock', f.events)
                    self.assertIn(('rpc', 'complete'), f.events)
                    self.assertEqual(f.route, [999])
                    self.assertEqual(f.events.count('undock'), 1)
                    self.assertFalse(f.job.valid(), 'Completed worker must not block the next full-hold trip')
                    self.assertEqual(len([x for x in f.events if isinstance(x, tuple) and x[0] == 'transfer']), 1)
                    if not same_system:
                        self.assertIn(('route', [30]), f.events)

    def test_failed_or_unconfirmed_unload_stays_docked(self):
        for problem in ('unload', 'unconfirmed'):
            f = Fixture(problem=problem)
            f.run()
            self.assertEqual(f.session.stationid, 600)
            self.assertNotIn('undock', f.events)
            self.assertNotIn(('rpc', 'complete'), f.events)

    def test_manual_route_and_autopilot_changes_are_not_fought(self):
        f = Fixture(problem='manual-route'); f.run()
        self.assertEqual(f.route, [888])
        self.assertEqual(f.autopilot, 1)
        self.assertEqual(f.events.count('on'), 1)
        self.assertNotIn('undock', f.events)
        f = Fixture(problem='manual-stop'); f.run()
        self.assertEqual(f.autopilot, 0)
        self.assertEqual(f.events.count('on'), 1)

    def test_existing_autopilot_is_not_taken_over(self):
        f = Fixture(); f.autopilot = 1; f.run()
        self.assertEqual(f.route, [999])
        self.assertEqual(f.autopilot, 1)
        self.assertNotIn('off', f.events)

    def test_no_route_restores_previous_route_without_departure(self):
        f = Fixture(problem='no-route'); f.run()
        self.assertEqual(f.route, [999])
        self.assertNotIn('on', f.events)

    def test_different_character_and_duplicate_delivery_are_ignored(self):
        f = Fixture(); f.session.charid = 43; f.run()
        self.assertEqual(f.events, [])
        f = Fixture(); f.scope['_am_haul'](None, json.dumps(f.trip))
        self.assertIs(f.scope['_am_haul_job'], f.job)


if __name__ == '__main__':
    unittest.main()
