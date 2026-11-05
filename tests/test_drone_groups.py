"""Run the actual client group reader against native-shaped bay/group data."""
import ast
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest

root = Path(__file__).resolve().parents[1]


class DroneGroupsTests(unittest.TestCase):
    def setUp(self):
        self.groups = {
            'Miners': {'id': ['Miners', '1'], 'droneIDs': [11, 12, 13, 14, 15]},
            'Fighters': {'id': ['Fighters', '2'], 'droneIDs': [21, 22]},
            'Other ship': {'id': ['Other ship', '3'], 'droneIDs': [99]},
        }
        self.bay = {'shipID': 100, 'itemIDs': [11, 12, 13, 14, 15, 21, 22]}
        self.calls = []
        name = 'eve.client.script.ui.inflight.drones.droneGroupsController'
        self.saved_modules = dict(sys.modules)
        for size in range(1, len(name.split('.')) + 1):
            key = '.'.join(name.split('.')[:size])
            sys.modules[key] = ModuleType(key)
        sys.modules[name].GetDroneGroupsController = lambda: SimpleNamespace(GetGroupsByName=lambda: self.groups)
        self.scope = {'unicode': str, '_am_json': json, 'sm': SimpleNamespace(RemoteSvc=self.remote)}
        tree = ast.parse((root / 'client/drones.py').read_text(encoding='utf-8'))
        methods = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)
                                  and n.name in ('_am_drone_bay', '_am_drone_groups')], type_ignores=[])
        exec(compile(methods, 'actual-client-drone-groups', 'exec'), self.scope)

    def tearDown(self):
        for name in list(sys.modules):
            if name.startswith('eve'):
                if name in self.saved_modules:
                    sys.modules[name] = self.saved_modules[name]
                else:
                    del sys.modules[name]

    def remote(self, service):
        self.calls.append(service)
        return SimpleNamespace(AutoMiningDroneBay=lambda: json.dumps({'success': True, 'bay': self.bay}))

    def test_rpc_filters_by_active_bay_and_counts_each_group(self):
        bay = self.scope['_am_drone_bay']()
        self.assertEqual(self.calls, ['miningScanMgr'])
        rows = self.scope['_am_drone_groups'](bay)
        self.assertEqual([(name, count) for _, name, count in rows], [('Miners', 5), ('Fighters', 2)])
        self.assertEqual(json.loads(rows[0][0]), ['Miners', '1'])

    def test_ship_change_updates_membership_and_count(self):
        rows = self.scope['_am_drone_groups']({'shipID': 200, 'itemIDs': [99]})
        self.assertEqual([(name, count) for _, name, count in rows], [('Other ship', 1)])

    def test_stacked_drones_count_units_instead_of_inventory_rows(self):
        rows = self.scope['_am_drone_groups']({'shipID': 100, 'itemIDs': [11, 12, 21],
                                              'quantities': {'11': 5, '12': 1, '21': 10}})
        self.assertEqual([(name, count) for _, name, count in rows], [('Fighters', 10), ('Miners', 6)])

    def test_empty_unknown_and_unmatched_bays_preserve_preselection(self):
        for bay in (None, {'itemIDs': []}, {'itemIDs': [555]}):
            with self.subTest(bay=bay):
                rows = self.scope['_am_drone_groups'](bay)
                self.assertEqual([name for _, name, _ in rows], ['Fighters', 'Miners', 'Other ship'])
                self.assertTrue(all(count is None for _, _, count in rows))


if __name__ == '__main__':
    unittest.main()
