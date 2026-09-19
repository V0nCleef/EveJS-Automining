"""Authored Python only; simulated EVE services, no client files or runtime.

Python 3 checks logic shared with the Python 2.7 target. They do not replace
an actual client smoke test or Python 2.7 runtime coverage.
"""
import base64
import builtins
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '\n'.join((ROOT / 'client' / name).read_text(encoding='utf-8') for name in ['companion.py', 'hud.py'])
BOOTSTRAP = (ROOT / 'client/login.py').read_text(encoding='utf-8')


class Fixture:
    def __init__(self):
        self.queue = []
        self.listeners = {}
        self.requests = []
        self.scans = 0
        self.session = types.SimpleNamespace(charid=None, shipid=10, solarsystemid=20)
        self.builtins = types.ModuleType('__builtin__')
        self.builtins.__dict__.update(vars(builtins))
        self.builtins.unicode = str
        self.sm = types.SimpleNamespace(RegisterForNotifyEvent=self.register, UnregisterForNotifyEvent=self.unregister,
                                        RemoteSvc=lambda _: self, GetService=lambda _: self)
        self.builtins.session = self.session
        self.builtins.sm = self.sm
        self.real_commands = type('RealCommands', (), {'__notifyevents__': ['ExistingEvent'], 'Run': lambda self: None})
        self.modules = {'__builtin__': self.builtins,
                        'uthread': types.SimpleNamespace(new=lambda fn, *args: self.queue.append((fn, args))),
                        'blue': types.SimpleNamespace(pyos=types.SimpleNamespace(synchro=types.SimpleNamespace(SleepWallclock=lambda _: None))),
                        'eve.client.script.ui.eveCommands': types.SimpleNamespace(EveCommandService=self.real_commands),
                        'mining.client': types.SimpleNamespace(mining_util=types.SimpleNamespace(has_current_ship_integrated_mining_scanner=lambda: True)),
                        'mining.client.mining_overlay_controller': types.SimpleNamespace(MiningOverlayController=types.SimpleNamespace(
                            get_instance=lambda: types.SimpleNamespace(effect_orchestrator=types.SimpleNamespace(is_playing_effect=False)))),
                        'eve.client.script.remote.michelle': types.SimpleNamespace(GetMichelle=lambda: types.SimpleNamespace(InWarp=lambda: False))}
        self.accept_token = 'server-A'
        self.fail_ready = False

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

    def AutoMiningSurveyAck(self, success, reason):
        self.requests.append(('survey', success, reason))

    def CmdMiningScan(self):
        self.scans += 1

    def install(self, token='server-A'):
        namespace = {'__builtins__': vars(builtins), '_am_context': {}, '_am_token': token,
                     '_am_version': '1.0.7', '_am_source64': base64.b64encode(SOURCE.encode()).decode()}
        with patch.dict(sys.modules, self.modules):
            exec(compile(BOOTSTRAP, '<authored-bootstrap>', 'exec'), namespace)
        return getattr(self.builtins, '_evejs_automining_login_v1', None)

    def drain(self):
        with patch.dict(sys.modules, self.modules):
            for _ in range(20):
                if not self.queue:
                    return
                fn, args = self.queue.pop(0)
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
