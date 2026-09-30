"""The leader's client binds the native fleet before opening its member UI."""
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch
import sys
import unittest


class FleetTests(unittest.TestCase):
    def test_matching_native_fleet_id_still_refreshes_truncated_roster(self):
        fleet = object()
        members = {42: 'Lincoln'}
        def init():
            members.update({1: 'Vonessa', 2: 'Anna'})
        service = NS(fleet=fleet, fleetID=77, members=members, InitFleet=init)
        scope = dict(session=NS(fleetid=77), sm=NS(GetService=lambda _:service),
            _am_uthread=NS(new=lambda *args:None), _am_blue=NS(),
            EveCommandService=type('Commands', (), {'__notifyevents__':[]}))
        with patch.dict(sys.modules, {'eve.common.script.net.eveMoniker':NS(GetFleet=lambda _:fleet)}):
            exec((Path(__file__).resolve().parents[1]/'client/fleet.py').read_text(), scope)
            scope['_am_fleet_ready_work'](77)
        self.assertEqual(set(members), {42,1,2})

    def test_leader_binds_native_fleet_and_fetches_members(self):
        fleet = object()
        events = []
        service = NS(fleet=None, fleetID=None,
                     InitFleet=lambda: events.append('init'))
        session = NS(fleetid=77)
        scope = dict(session=session, sm=NS(GetService=lambda _: service),
                     _am_uthread=NS(new=lambda *args: None),
                     _am_blue=NS(pyos=NS(synchro=NS(SleepWallclock=lambda ms: None))),
                     _am_is_active=lambda: True,
                     EveCommandService=type('Commands', (), {'__notifyevents__': []}))
        module = NS(GetFleet=lambda fleet_id: fleet)
        with patch.dict(sys.modules, {'eve.common.script.net.eveMoniker': module}):
            exec((Path(__file__).resolve().parents[1] / 'client/fleet.py').read_text(), scope)
            scope['_am_fleet_ready_work'](77)
        self.assertIs(service.fleet, fleet)
        self.assertEqual(events, ['init'])


if __name__ == '__main__':
    unittest.main()
