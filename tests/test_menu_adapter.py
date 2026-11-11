"""Actual menu adapter with fake client services; never touches client files or UI."""
import builtins
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

SOURCE = (Path(__file__).resolve().parents[1] / 'client/menu.py').read_text(encoding='utf-8')


class MenuTests(unittest.TestCase):
    def load(self, mode='login-v1', ready=None, charid=42, hooks=True, service_failure=False):
        calls, registrations = [], []
        owner = None if ready is None else types.SimpleNamespace(usable=lambda: ready,
                            OnAutoMiningOpen=lambda: calls.append('login-open'))
        commands = types.SimpleNamespace(__notifyevents__=['OnAutoMiningSurvey', 'OnAutoMiningOpen'] if hooks else [],
                            OnAutoMiningSurvey=lambda: calls.append('survey'),
                            OnAutoMiningOpen=lambda: calls.append('legacy-open'))
        def service(name):
            self.assertEqual(name, 'cmd')
            if service_failure:
                raise RuntimeError('service unavailable')
            return commands
        fake_builtins = types.ModuleType('__builtin__')
        fake_builtins.sm = types.SimpleNamespace(GetService=service)
        fake_builtins.session = types.SimpleNamespace(charid=charid)
        if owner is not None:
            fake_builtins._evejs_automining_login_v1 = owner
        registration = types.SimpleNamespace(close=lambda: calls.append('close'))
        def register(*args, **kwargs):
            registrations.append((args, kwargs))
            return registration
        namespace = {'__builtins__': builtins}
        environment = patch.dict(os.environ, {'AUTOMINING_CLIENT_DELIVERY': mode})
        modules = patch.dict(sys.modules, {'__builtin__': fake_builtins,
                            'evejs_mod_menu': types.SimpleNamespace(register=register)})
        environment.start(); modules.start()
        self.addCleanup(environment.stop); self.addCleanup(modules.stop)
        exec(compile(SOURCE, '<actual-automining-menu>', 'exec'), namespace)
        return namespace, calls, fake_builtins, commands, registrations

    def test_login_owner_keeps_existing_route(self):
        menu, calls, _, _, _ = self.load(ready=True)
        self.assertTrue(menu['available']()); self.assertEqual(calls, [])
        menu['open_window'](); self.assertEqual(calls, ['login-open'])

    def test_verified_legacy_route_opens_existing_handler_without_login_owner(self):
        menu, calls, state, _, registrations = self.load(mode='legacy')
        self.assertTrue(menu['available']()); self.assertEqual(calls, [])
        menu['open_window'](); self.assertEqual(calls, ['legacy-open'])
        self.assertFalse(hasattr(state, '_evejs_automining_login_v1'))
        self.assertEqual(registrations[0][0][0], 'automining')
        self.assertEqual(registrations[0][1]['api_version'], 1)

    def test_unready_login_mode_does_not_use_legacy_hooks(self):
        menu, calls, _, _, _ = self.load(ready=False)
        self.assertFalse(menu['available']()); menu['open_window'](); self.assertEqual(calls, [])

    def test_unqualified_mode_does_not_use_existing_legacy_handler(self):
        menu, calls, _, _, _ = self.load(mode='unknown')
        self.assertFalse(menu['available']()); menu['open_window'](); self.assertEqual(calls, [])

    def test_legacy_requires_character_and_both_owned_hooks(self):
        for options in ({'charid': None}, {'hooks': False}, {'service_failure': True}):
            with self.subTest(options=options):
                menu, calls, _, _, _ = self.load(mode='legacy', **options)
                self.assertFalse(menu['available']()); menu['open_window'](); self.assertEqual(calls, [])

    def test_missing_legacy_callable_refuses_open(self):
        menu, calls, _, commands, _ = self.load(mode='legacy')
        commands.OnAutoMiningOpen = None
        self.assertFalse(menu['available']()); menu['open_window'](); self.assertEqual(calls, [])

    def test_legacy_services_can_come_from_the_entry_namespace(self):
        menu, calls, state, _, _ = self.load(mode='legacy')
        menu['sm'], menu['session'] = state.sm, state.session
        del state.sm; del state.session
        self.assertTrue(menu['available']()); menu['open_window']()
        self.assertEqual(calls, ['legacy-open'])

    def test_stale_login_owner_is_not_marked_ready_by_legacy_fallback(self):
        menu, calls, state, _, _ = self.load(mode='legacy', ready=False)
        owner = state._evejs_automining_login_v1
        self.assertTrue(menu['available']()); menu['open_window']()
        self.assertIs(state._evejs_automining_login_v1, owner)
        self.assertFalse(owner.usable()); self.assertEqual(calls, ['legacy-open'])

    def test_live_login_owner_wins_without_double_open(self):
        menu, calls, _, _, _ = self.load(mode='legacy', ready=True)
        menu['open_window'](); self.assertEqual(calls, ['login-open'])

    def test_logout_rechecks_current_character(self):
        menu, calls, state, _, _ = self.load(mode='legacy')
        self.assertTrue(menu['available']()); state.session.charid = None
        self.assertFalse(menu['available']()); menu['open_window'](); self.assertEqual(calls, [])

    def test_cleanup_closes_registration_only(self):
        menu, calls, _, _, _ = self.load(mode='legacy')
        menu['cleanup'](); self.assertEqual(calls, ['close'])

    def test_login_v1_initializer_acknowledges_and_uses_real_owner_menu_handler(self):
        from test_login_companion import Fixture
        fixture = Fixture(); fixture.session.charid = 42
        opened = []
        with patch.dict(os.environ, {'AUTOMINING_CLIENT_DELIVERY': 'login-v1', 'AUTOMINING_PROFILE_SETTINGS': ''}):
            owner = fixture.install(); fixture.drain()
            self.assertTrue(owner.usable())
            self.assertEqual([row[3] for row in fixture.requests if row[0] == 'ready'], [0, 1])
            # The actual owner/handler runs; only retail UI construction is an authored marker.
            owner.namespace['_am_open_hud'] = lambda handler: opened.append(handler)
            module = types.SimpleNamespace(register=lambda *args, **kwargs: types.SimpleNamespace(close=lambda: None))
            with patch.dict(sys.modules, {**fixture.modules, 'evejs_mod_menu': module}):
                namespace = {'__builtins__': builtins}
                exec(compile(SOURCE, '<actual-menu-real-login-owner>', 'exec'), namespace)
                self.assertTrue(namespace['available']()); namespace['open_window']()
            self.assertEqual(opened, [owner])


if __name__ == '__main__':
    unittest.main()
