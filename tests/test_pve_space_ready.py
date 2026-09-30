"""Replay the live undock-loading gap with the authored PVE worker."""
import unittest

from test_pve_client import Fixture
from test_pve_deployment_client import deployment


class SpaceReadyTests(unittest.TestCase):
    def test_escort_undocks_once_waits_for_space_then_orbits_without_cancellation(self):
        f = deployment('undocking')
        f.session.stationid = 600
        f.job.update(anchor=dict(characterID=2, shipID=200, systemID=300),
                     targetID=200, orbitKind='escort', orbitRange=2500)

        def undock():
            f.events.append(('undock',))
            f.session.stationid = None
            f.job['phase'] = 'engaging'

        f.ExitDockableLocation = undock
        f.GetRemotePark = lambda: f if f.steps >= 3 else None
        f.worker.run()
        self.assertEqual(sum(e[0] == 'undock' for e in f.events), 1)
        self.assertIn(('orbit', (200, 2500)), f.events)
        self.assertFalse(any(e[:2] == ('rpc', 'cancel') for e in f.events))
        self.assertEqual(sum(e[:2] == ('rpc', 'authorizeOrbit') for e in f.events), 1)

    def test_unavailable_space_polls_without_motion_grants_or_cancelling(self):
        for phase in ('engaging', 'warpFleet', 'routeFleet', 'returning'):
            with self.subTest(phase=phase):
                f = deployment(phase)
                f.job['home'] = dict(stationID=600, systemID=300)
                f.GetRemotePark = lambda: None
                f.worker.run()
                self.assertTrue(f.steps >= 5)
                self.assertTrue(all(e[1] == 'poll' for e in f.events if e[0] == 'rpc'))
                self.assertFalse(any(e[0] in ('orbit', 'warp', 'autopilot', 'undock') for e in f.events))

    def test_space_lost_during_authorization_waits_and_uses_fresh_target_grant(self):
        f = Fixture()
        original_action, original_sleep = f.AutoMiningPVEAction, f.sleep
        lost = []
        f.GetRemotePark = lambda: None if lost == [True] else f

        def action(id, name, raw):
            result = original_action(id, name, raw)
            if name == 'authorizeOrbit' and not lost:
                lost.append(True)
            return result

        def sleep(ms):
            original_sleep(ms)
            if lost == [True]:
                lost.append(False)
                f.job.update(targetID=10, nonce='n8')

        f.AutoMiningPVEAction = action
        f.scope['_am_blue'].pyos.synchro.SleepWallclock = sleep
        f.worker.run()
        self.assertEqual([e[1] for e in f.events if e[0] == 'orbit'], [(10, 10000)])
        self.assertEqual(sum(e[:2] == ('rpc', 'authorizeOrbit') for e in f.events), 2)
        self.assertEqual(sum(e[:2] == ('rpc', 'orbited') for e in f.events), 1)
        self.assertFalse(any(e[:2] == ('rpc', 'cancel') for e in f.events))

    def test_stop_or_ship_change_while_loading_never_restarts_or_moves(self):
        for change in ('stop', 'ship'):
            with self.subTest(change=change):
                f = Fixture()
                f.GetRemotePark = lambda: None

                def sleep(ms):
                    f.steps += 1
                    if change == 'stop':
                        f.active = False
                    else:
                        f.session.shipid = 101

                f.scope['_am_blue'].pyos.synchro.SleepWallclock = sleep
                f.worker.run()
                self.assertEqual([e[1] for e in f.events if e[0] == 'rpc'], ['poll'])
                self.assertFalse(any(e[0] in ('orbit', 'warp', 'undock') for e in f.events))

    def test_job_removed_while_loading_never_issues_cached_move(self):
        f = Fixture()
        f.GetRemotePark = lambda: None

        def sleep(ms):
            f.steps += 1
            f.job = None

        f.scope['_am_blue'].pyos.synchro.SleepWallclock = sleep
        f.worker.run()
        self.assertEqual([e[1] for e in f.events if e[0] == 'rpc'], ['poll', 'poll'])
        self.assertFalse(any(e[0] == 'orbit' for e in f.events))

    def test_reloaded_space_reissues_previously_cached_orbit(self):
        f = Fixture()
        f.worker.orbit = (9, 10000)
        f.GetRemotePark = lambda: f if f.steps >= 2 else None
        f.worker.run()
        self.assertEqual([e[1] for e in f.events if e[0] == 'orbit'], [(9, 10000)])
        self.assertFalse(any(e[:2] == ('rpc', 'cancel') for e in f.events))


if __name__ == '__main__':
    unittest.main()
