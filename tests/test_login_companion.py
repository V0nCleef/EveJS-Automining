"""Authored Python only; simulated EVE services, no client files or runtime.

Python 3 checks logic shared with the Python 2.7 target. They do not replace
an actual client smoke test or Python 2.7 runtime coverage.
"""
import base64
import builtins
import json
import os
from pathlib import Path
import subprocess
import sys
import types
import unittest
import zlib
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
DELIVERIES = {}


def delivery_expression(token):
    if token not in DELIVERIES:
        # Use the exact bounded, encoded production payload and its native envelope.
        script = "const a=require('./lib/loginDelivery');const b=Buffer.from('None');const h=Buffer.alloc(5);h[0]=0x74;h.writeUInt32LE(b.length,1);process.stdout.write(a.createDelivery(process.cwd(),{token:process.argv[1]}).compose(Buffer.concat([h,b])).subarray(5));"
        DELIVERIES[token] = subprocess.check_output(['node', '-e', script, token], cwd=ROOT).decode('ascii')
    return DELIVERIES[token]


class Fixture:
    def __init__(self):
        self.queue = []
        self.background = []
        self.listeners = {}
        self.requests = []
        self.services = []
        self.sleep_hook = None
        self.scans = 0
        self.session = types.SimpleNamespace(charid=None, shipid=10, solarsystemid=20)
        self.builtins = types.ModuleType('__builtin__')
        self.builtins.__dict__.update(vars(builtins))
        self.builtins.unicode = str
        self.sm = types.SimpleNamespace(RegisterForNotifyEvent=self.register, UnregisterForNotifyEvent=self.unregister,
                                        RemoteSvc=lambda _: self, GetService=self.get_service)
        self.builtins.session = self.session
        self.builtins.sm = self.sm
        self.builtins.settings = types.SimpleNamespace(char=types.SimpleNamespace(ui=types.SimpleNamespace(Get=lambda *args: None, Set=lambda *args: None)))
        self.real_commands = type('RealCommands', (), {'__notifyevents__': ['ExistingEvent'], 'Run': lambda self: None})
        self.modules = {'__builtin__': self.builtins,
                        'uthread': types.SimpleNamespace(new=lambda fn, *args: self.queue.append((fn, args))),
                        'blue': types.SimpleNamespace(pyos=types.SimpleNamespace(synchro=types.SimpleNamespace(SleepWallclock=self.sleep))),
                        'eve.client.script.ui.eveCommands': types.SimpleNamespace(EveCommandService=self.real_commands),
                        'mining.client': types.SimpleNamespace(mining_util=types.SimpleNamespace(has_current_ship_integrated_mining_scanner=lambda: True)),
                        'mining.client.mining_overlay_controller': types.SimpleNamespace(MiningOverlayController=types.SimpleNamespace(
                            get_instance=lambda: types.SimpleNamespace(effect_orchestrator=types.SimpleNamespace(is_playing_effect=False)))),
                        'eve.client.script.remote.michelle': types.SimpleNamespace(GetMichelle=lambda: types.SimpleNamespace(InWarp=lambda: False))}
        self.accept_token = 'server-A'
        self.fail_ready = False
        self.fail_drones_ready = False
        self.fail_transport_ready = 0
        self.transport_job = None

    def get_service(self, name):
        self.services.append(name)
        return self

    def sleep(self, duration):
        if self.sleep_hook:
            self.sleep_hook(duration)

    def register(self, handler, event):
        self.listeners.setdefault(event, []).append(handler)

    def unregister(self, handler, event):
        self.listeners[event].remove(handler)

    def AutoMiningLoginReady(self, token, version, ready):
        self.requests.append(('ready', token, version, ready))
        if self.fail_ready:
            raise RuntimeError('remote service unavailable')
        return json.dumps(dict(success=token == self.accept_token, token=self.accept_token, version=version))

    def AutoMiningProfile(self, profile):
        self.requests.append(('profile', json.loads(profile)))

    def AutoMiningHaulReady(self):
        self.requests.append(('hauling-ready',))
        return json.dumps(dict(success=True))

    def AutoMiningDronesReady(self):
        self.requests.append(('drones-ready',))
        if self.fail_drones_ready:
            raise RuntimeError('drone readiness unavailable')
        return json.dumps(dict(success=True))

    def AutoMiningTransportReady(self):
        self.requests.append(('transport-ready',))
        if self.fail_transport_ready:
            self.fail_transport_ready -= 1
            raise RuntimeError('transport readiness unavailable')
        return json.dumps(dict(success=True))

    def AutoMiningFleetReady(self):
        self.requests.append(('fleet-ready',))
        return json.dumps(dict(success=True))

    def AutoMiningPVEReady(self):
        self.requests.append(('pve-ready',))
        return json.dumps(dict(success=True))

    def AutoMiningTransportAction(self, job_id, action, raw):
        values = json.loads(raw)
        self.requests.append(('transport-action', job_id, action, values))
        return json.dumps(dict(success=True, transport=dict(job=self.transport_job)))

    def AutoMiningSurveyAck(self, success, reason):
        self.requests.append(('survey', success, reason))

    def CmdMiningScan(self):
        self.scans += 1

    def install(self, token='server-A'):
        namespace = {'__builtins__': self.builtins, 'sm': self.sm, 'session': self.session}
        with patch.dict(sys.modules, self.modules):
            eval(compile(delivery_expression(token), '<encoded-native-login>', 'eval'), namespace)
        return getattr(self.builtins, '_evejs_automining_login_v1', None)

    def drain(self):
        with patch.dict(sys.modules, self.modules):
            for _ in range(20):
                if not self.queue:
                    return
                fn, args = self.queue.pop(0)
                if fn.__name__ in ('_am_transport_idle', '_am_fleet_management_poll', '_am_pve_idle'):
                    self.background.append((fn, args))
                    continue
                fn(*args)
        raise AssertionError('unbounded background work')

    def change(self, charid):
        self.session.charid = charid
        for handler in list(self.listeners.get('OnSessionChanged', [])):
            handler.OnSessionChanged(False, self.session, {'charid': (None, charid)})


class LoginTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {'AUTOMINING_CLIENT_DELIVERY': 'login-v1', 'AUTOMINING_PROFILE_SETTINGS': ''})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_login_defers_rpc_until_character_and_keeps_real_command_class_untouched(self):
        f = Fixture(); original = dict(f.real_commands.__dict__)
        h = f.install(); self.assertEqual(f.requests, [])
        f.drain(); self.assertEqual(f.requests, [])
        f.change(42); f.drain()
        self.assertTrue(h.usable())
        self.assertEqual(dict(f.real_commands.__dict__), original)
        with patch.dict(sys.modules, f.modules):
            h.OnAutoMiningSurvey()
        self.assertEqual(f.scans, 1)
        self.assertIn(('survey', True, ''), f.requests)

    def test_rat_group_notification_reaches_the_active_companion(self):
        f = Fixture(); f.session.charid = 42
        h = f.install(); f.drain()
        self.assertIn(h, f.listeners['OnAutoMiningRatGroups'])
        received = []
        h.namespace['_am_rat_groups'] = lambda handler, message: received.append((handler, message))
        h.OnAutoMiningRatGroups('group-request')
        self.assertEqual(received, [(h, 'group-request')])
        h.dispose()
        h.OnAutoMiningRatGroups('stale-request')
        self.assertEqual(len(received), 1)

    def test_encoded_docked_login_starts_transport_and_dispatches_real_joining_worker(self):
        f = Fixture(); f.session.charid = 42; f.session.stationid = 600; f.session.solarsystemid = None
        h = f.install(); f.drain()
        self.assertIn(('transport-ready',), f.requests)
        self.assertIn(('pve-ready',), f.requests)
        self.assertEqual([fn.__name__ for fn, _ in f.background],
                         ['_am_transport_idle', '_am_fleet_management_poll', '_am_pve_idle'])
        self.assertIn(h, f.listeners['OnAutoMiningTransport'])
        f.transport_job = dict(id='pickup', nonce='join-token', shipID=10, phase='joining')
        for handler in list(f.listeners['OnAutoMiningTransport']):
            handler.OnAutoMiningTransport(json.dumps(f.transport_job))
        worker = h.namespace['_am_transport_job']
        self.assertIsInstance(worker, h.namespace['_AutoMiningTransport'])
        def stop_after_joining_poll(duration):
            if duration == 1000:
                worker.cancelled = True
        f.sleep_hook = stop_after_joining_poll
        f.drain()
        self.assertEqual([r[2] for r in f.requests if r[0] == 'transport-action'], ['poll'])
        self.assertTrue(worker.cleaned)
        self.assertFalse(set(f.services) & {'undocking', 'michelle', 'starmap', 'autoPilot', 'invCache'})

    def test_sibling_readiness_failure_is_isolated_and_transport_heartbeat_retries(self):
        f = Fixture(); f.session.charid = 42; f.fail_drones_ready = True; f.fail_transport_ready = 1
        h = f.install(); f.drain()
        self.assertTrue(h.usable()); self.assertIn(('hauling-ready',), f.requests); self.assertIn(('pve-ready',), f.requests)
        background = [(fn, args) for fn, args in f.background if fn.__name__ == '_am_transport_idle']
        self.assertEqual(len(background), 1)
        h.OnSessionChanged(); f.drain()
        self.assertEqual(len(f.background), 3, 'an unchanged session does not duplicate readiness workers')
        sleeps = []
        def bounded_heartbeat(duration):
            sleeps.append(duration)
            if len(sleeps) == 2:
                h.ready = False
        f.sleep_hook = bounded_heartbeat
        with patch.dict(sys.modules, f.modules):
            background[0][0](*background[0][1])
        self.assertEqual(sleeps, [5000, 5000]); self.assertEqual(f.requests.count(('transport-ready',)), 2)
        self.assertIsNone(h.namespace['_am_transport_heartbeat'])

    def test_readiness_does_not_start_sibling_jobs_after_session_generation_changes(self):
        f = Fixture(); f.session.charid = 42
        h = f.install()
        def changed_during_transport_ready():
            f.requests.append(('transport-ready',)); h.generation += 1; h.ready = False
            return json.dumps(dict(success=True))
        f.AutoMiningTransportReady = changed_during_transport_ready
        f.drain()
        self.assertFalse(h.usable()); self.assertNotIn(('pve-ready',), f.requests)
        self.assertEqual([fn.__name__ for fn, _ in f.background], ['_am_transport_idle'])

    def test_new_notification_bindings_reject_replaced_and_disconnected_login_owners(self):
        f = Fixture(); f.session.charid = 42
        first = f.install(); f.drain(); received = []
        for event, function in [('OnAutoMiningPVE', '_am_pve'), ('OnAutoMiningActivity', '_am_activity_receive')]:
            self.assertIn(first, f.listeners[event])
            first.namespace[function] = lambda handler, raw, event=event: received.append((event, handler, raw))
            getattr(first, event)('active')
        self.assertEqual(len(received), 2)
        second = f.install(); f.drain()
        for event in ['OnAutoMiningTransport', 'OnAutoMiningPVE', 'OnAutoMiningActivity']:
            self.assertEqual(f.listeners[event], [second])
            getattr(first, event)('stale')
        self.assertEqual(len(received), 2)
        f.change(None)
        second.OnAutoMiningTransport(json.dumps(dict(id='stale', nonce='n', shipID=10, phase='joining')))
        self.assertIsNone(second.namespace['_am_transport_job'])

    def test_repeated_login_replaces_handlers_and_pending_work(self):
        f = Fixture(); f.session.charid = 42
        first = f.install(); f.drain()
        second = f.install(); f.drain()
        self.assertFalse(first.usable()); self.assertTrue(second.usable())
        self.assertTrue(all(items == [second] for items in f.listeners.values()))
        first.OnAutoMiningSurvey(); self.assertEqual(f.scans, 0)

    def test_replaced_bootstrap_cannot_register_late(self):
        f = Fixture(); f.session.charid = 42
        first = f.install(); second = f.install(); f.drain()
        self.assertFalse(first.usable()); self.assertTrue(second.usable())
        self.assertTrue(all(items == [second] for items in f.listeners.values()))

    def test_legacy_archive_companion_wins_without_duplicate_scan(self):
        f = Fixture(); f.session.charid = 42
        f.real_commands.__notifyevents__.append('OnAutoMiningSurvey')
        h = f.install(); f.drain()
        self.assertFalse(h.active)
        self.assertEqual(f.requests, [])
        self.assertTrue(all(not items for items in f.listeners.values()))

    def test_launcher_legacy_mode_skips_new_registration(self):
        f = Fixture()
        with patch.dict(os.environ, {'AUTOMINING_CLIENT_DELIVERY': 'legacy'}):
            f.install(); f.drain()
        self.assertEqual(f.listeners, {})

    def test_wrong_server_token_disposes_without_profile_or_scan(self):
        f = Fixture(); f.session.charid = 42; f.accept_token = 'server-B'
        h = f.install(); f.drain()
        self.assertFalse(h.active)
        self.assertTrue(all(row[0] == 'ready' for row in f.requests))

    def test_disconnected_character_cannot_use_previous_window_or_scan(self):
        f = Fixture(); f.session.charid = 42
        h = f.install(); f.drain(); f.change(None)
        self.assertFalse(h.usable())
        h.OnAutoMiningSurvey(); self.assertEqual(f.scans, 0)
        f.change(43); f.drain(); self.assertTrue(h.usable())

    def test_profile_applies_once_per_character_without_reset_on_ship_change(self):
        f = Fixture(); f.session.charid = 42
        with patch.dict(os.environ, {'AUTOMINING_PROFILE_SETTINGS': json.dumps({'apply': True, 'order': 'largest'})}):
            h = f.install(); f.drain(); h.OnSessionChanged(); f.drain()
        self.assertEqual(len([row for row in f.requests if row[0] == 'profile']), 1)

    def test_rpc_failure_is_bounded_and_does_not_claim_ready(self):
        f = Fixture(); f.session.charid = 42; f.fail_ready = True
        h = f.install(); f.drain()
        self.assertFalse(h.usable()); self.assertEqual(len(f.requests), 6)

    def test_partial_notification_registration_is_cleaned_up(self):
        f = Fixture(); original = f.sm.RegisterForNotifyEvent
        def fail(handler, event):
            if event == 'OnAutoMiningOpen':
                raise RuntimeError('fixture failure')
            original(handler, event)
        f.sm.RegisterForNotifyEvent = fail
        h = f.install(); f.drain()
        self.assertFalse(h.active)
        self.assertTrue(all(not items for items in f.listeners.values()))

    def test_replaced_session_object_updates_hud_context(self):
        f = Fixture(); f.session.charid = 42
        h = f.install(); f.drain()
        replacement = types.SimpleNamespace(charid=43, shipid=11, solarsystemid=21)
        h.OnSessionChanged(False, replacement, {'charid': (42, 43)})
        f.drain()
        self.assertTrue(h.usable())
        self.assertIs(h.namespace['session'], replacement)


if __name__ == '__main__':
    unittest.main()
