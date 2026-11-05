"""Drone group launch receipts; authored client code with simulated native events."""
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class Fixture:
    def __init__(self, quantities=(5,), delayed=False, partial=False):
        self.session = types.SimpleNamespace(charid=42, shipid=10, solarsystemid=20, stationid=None)
        self.bay = [types.SimpleNamespace(itemID=100 + i, stacksize=n) for i, n in enumerate(quantities)]
        self.group = {'droneIDs': set(i.itemID for i in self.bay)}
        self.groups = {('Miners', 'group'): self.group}
        self.space = {}
        self.result = None
        self.claims = []
        self.syncs = []
        self.launches = []
        self.delayed = delayed
        self.partial = partial
        self.pending = []
        self.sleeps = 0
        self.in_warp = False
        self.active = True
        self.controller = types.SimpleNamespace(GetGroupByID=lambda key: self.groups.get(key))
        self.remote = types.SimpleNamespace(AutoMiningDroneClaim=self.claim, AutoMiningDroneSync=self.sync,
                                           AutoMiningDroneResult=self.receipt)
        michelle = types.SimpleNamespace(InWarp=lambda: self.in_warp, GetDrones=lambda: self.space)
        self.scope = {'_am_json': json, 'unicode': str, 'session': self.session,
                      '_am_is_active': lambda: self.active,
                      '_am_blue': types.SimpleNamespace(pyos=types.SimpleNamespace(synchro=types.SimpleNamespace(SleepWallclock=self.sleep))),
                      'sm': types.SimpleNamespace(GetService=lambda _: michelle, RemoteSvc=lambda _: self.remote),
                      'EveCommandService': type('Commands', (), {'__notifyevents__': []})}
        self.modules = {
            'eve.client.script.ui.inflight.drones.droneGroupsController': types.SimpleNamespace(GetDroneGroupsController=lambda: self.controller),
            'eve.client.script.ui.inflight.drones.dronesUtil': types.SimpleNamespace(GetDronesInBay=lambda: self.bay),
            'eve.client.script.ui.services.menuSvcExtras.droneFunctions': types.SimpleNamespace(LaunchDrones=self.launch)}
        source = Path(os.environ.get('AUTOMINING_DRONES_SOURCE', str(Path(__file__).resolve().parents[1] / 'client/drones.py')))
        exec(compile(source.read_text(), 'drones.py', 'exec'), self.scope)

    def claim(self, request):
        self.claims.append(request)
        return json.dumps({'success': True})

    def receipt(self, request, text, ids):
        self.result = {'request': request, 'text': text, 'ids': ids}

    def sync(self, request, ids):
        self.syncs.append(list(ids))
        for drone_id in self.pending:
            self.add(drone_id)
        self.pending = []

    def add(self, drone_id, owner=42, controller=10):
        self.space[drone_id] = types.SimpleNamespace(ownerID=owner, controllerID=controller)

    def launch(self, ids):
        self.launches.append(list(ids))
        drone_ids = []
        for i, item in enumerate(self.bay):
            drone_ids.extend([item.itemID] + [1000 + i * 100 + n for n in range(1, item.stacksize)])
        if self.partial:
            drone_ids = drone_ids[:3]
        if self.delayed:
            self.pending = drone_ids
        else:
            self.group['droneIDs'].update(drone_ids)
            for drone_id in drone_ids:
                self.add(drone_id)

    def sleep(self, ms):
        self.sleeps += 1
        if self.pending:
            self.group['droneIDs'].update(self.pending)
            # Exercise the native state refresh path after the first four polls.

    def run(self):
        with patch.dict(sys.modules, self.modules):
            self.scope['_am_launch_drones_work'](json.dumps({'id': 'grant', 'characterID': 42, 'shipID': 10,
                                                           'groupKey': json.dumps(['Miners', 'group'])}))
        return self.result


class DroneLaunchTests(unittest.TestCase):
    def test_stack_split_reports_all_five_native_group_members(self):
        f = Fixture()
        result = f.run()
        self.assertEqual(f.launches, [[100]])
        self.assertEqual(len(result['ids']), 5)
        self.assertEqual(set(result['ids']), f.group['droneIDs'])
        self.assertEqual(f.syncs, [])

    def test_five_individual_drones_keep_the_same_receipt(self):
        f = Fixture((1, 1, 1, 1, 1))
        self.assertEqual(f.run()['ids'], [100, 101, 102, 103, 104])

    def test_multiple_stacks_and_existing_selected_drones(self):
        f = Fixture((2, 2))
        f.group['droneIDs'].add(500)
        f.add(500)
        self.assertEqual(len(f.run()['ids']), 5)

    def test_delayed_split_members_are_included_in_native_state_refresh(self):
        f = Fixture(delayed=True)
        self.assertEqual(len(f.run()['ids']), 5)
        self.assertEqual(len(f.syncs[0]), 5)

    def test_partial_launch_reports_only_actual_members_in_space(self):
        f = Fixture(partial=True)
        self.assertEqual(len(f.run()['ids']), 3)

    def test_other_groups_foreign_owners_and_other_ships_are_not_adopted(self):
        f = Fixture()
        for drone_id, owner, controller in [(501, 43, 10), (502, 42, 11)]:
            f.group['droneIDs'].add(drone_id)
            f.add(drone_id, owner, controller)
        f.add(503)
        ids = f.run()['ids']
        self.assertEqual(len(ids), 5)
        self.assertTrue({501, 502, 503}.isdisjoint(ids))

    def test_lost_session_does_not_claim_launch_or_report(self):
        f = Fixture()
        f.active = False
        self.assertIsNone(f.run())
        self.assertEqual(f.launches, [])
        self.assertEqual(f.claims, [])

    def test_warp_does_not_launch(self):
        f = Fixture()
        f.in_warp = True
        self.assertEqual(f.run()['ids'], [])
        self.assertEqual(f.launches, [])
        self.assertEqual(f.claims, [])


if __name__ == '__main__':
    unittest.main()
