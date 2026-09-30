import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'client' / 'activity.py'

class ActivityClientTests(unittest.TestCase):
    def fixture(self, existing=None):
        screens, logs, opened = [], [], []
        class Insider:
            def ToolMenu(self):
                return list(existing if existing is not None else [('Native tool', 'native')])
        class Commands:
            __notifyevents__ = []
        logger = types.SimpleNamespace(AddText=lambda text, category: logs.append((text, category)))
        commands = Commands()
        sm = types.SimpleNamespace(GetService=lambda name: logger if name == 'logger' else commands)
        insider = types.ModuleType('eve.devtools.script.insider'); insider.InsiderService = Insider
        ui = types.ModuleType('player_messaging.client.ui_message'); ui.message_player = screens.append
        env = {'unicode': str, 'EveCommandService': Commands, 'session': types.SimpleNamespace(charid=42),
               'sm': sm, '_am_json': json, '_am_is_active': lambda: True,
               '_am_tr': lambda value: {'Mining started.': 'Mineria iniciada.', 'AutoMining': 'Mineria automatica'}.get(value, value),
               '_am_status': str, '_am_open_hud': opened.append}
        modules = {'eve.devtools.script.insider': insider, 'player_messaging.client.ui_message': ui}
        with patch.dict(sys.modules, modules):
            exec(compile(SOURCE.read_text(encoding='utf-8-sig'), str(SOURCE), 'exec'), env)
        return env, Insider, modules, screens, logs, opened

    def event(self, key='mining', **changes):
        data = {'version': 1, 'key': key, 'message': 'Mining started.', 'args': [], 'enabled': True, 'characterID': 42}
        data.update(changes)
        return json.dumps(data)

    def test_native_menu_is_composed_and_opener_works(self):
        env, insider, _, _, _, opened = self.fixture()
        entries = insider().ToolMenu()
        self.assertEqual(entries[0], ('Native tool', 'native'))
        self.assertEqual(entries[1][0], 'MODS')
        self.assertEqual(entries[1][1][0][0], 'Mineria automatica')
        entries[1][1][0][1]()
        self.assertEqual(len(opened), 1)

    def test_existing_mods_and_repeated_install_do_not_duplicate(self):
        env, insider, modules, _, _, _ = self.fixture([('MODS', [('Other mod', 'other')]), ('Native tool', 'native')])
        original = insider.ToolMenu
        with patch.dict(sys.modules, modules):
            self.assertTrue(env['_am_install_insider']())
        self.assertIs(insider.ToolMenu, original)
        entries = insider().ToolMenu()
        self.assertEqual(len(entries[0][1]), 2)
        env['_am_insider_compose'](entries)
        self.assertEqual(len(entries[0][1]), 2)
        self.assertEqual(entries[0][1][0], ('Other mod', 'other'))

    def test_unloaded_mod_preserves_native_menu(self):
        env, insider, _, _, _, _ = self.fixture()
        env['_am_is_active'] = lambda: False
        self.assertEqual(insider().ToolMenu(), [('Native tool', 'native')])

    def test_shared_api_does_not_add_a_second_tools_menu(self):
        api = types.ModuleType('evejs_mod_menu')
        api.API_VERSION = 1
        api.register = lambda *args, **kwargs: None
        with patch.dict(sys.modules, {'evejs_mod_menu': api}):
            env, insider, _, _, _, _ = self.fixture()
            self.assertFalse(getattr(insider.ToolMenu, '_automining_menu', False))
            self.assertEqual(insider().ToolMenu(), [('Native tool', 'native')])
            self.assertTrue(env['_am_insider_installed'])

    def test_later_shared_api_makes_existing_fallback_yield(self):
        env, insider, _, _, _, _ = self.fixture()
        api = types.ModuleType('evejs_mod_menu')
        api.API_VERSION, api.register = 1, lambda *args: None
        with patch.dict(sys.modules, {'evejs_mod_menu': api}):
            self.assertEqual(insider().ToolMenu(), [('Native tool', 'native')])
        self.assertEqual(insider().ToolMenu()[1][0], 'MODS')

    def test_translated_native_screen_and_log_messages(self):
        env, _, modules, screens, logs, _ = self.fixture()
        with patch.dict(sys.modules, modules):
            env['_am_activity_receive'](None, self.event())
        self.assertEqual(screens, ['Mineria iniciada.'])
        self.assertEqual(logs, [('Mineria iniciada.', 'notify')])

    def test_off_notifications_and_other_character_are_silent(self):
        env, _, modules, screens, _, _ = self.fixture()
        with patch.dict(sys.modules, modules):
            env['_am_activity_set_state'](False)
            env['_am_activity_receive'](None, self.event())
            env['_am_activity_set_state'](True, False)
            env['_am_activity_receive'](None, self.event())
            env['_am_activity_set_state'](True, True)
            env['_am_activity_receive'](None, self.event(characterID=99))
            env['_am_activity_receive'](None, self.event(message='arbitrary remote message'))
            env['_am_activity_receive'](None, '{bad json')
        self.assertEqual(screens, [])

    def test_failure_details_are_translated_and_html_escaped(self):
        env, _, modules, screens, _, _ = self.fixture()
        with patch.dict(sys.modules, modules):
            env['_am_activity_receive'](None, self.event('failure', message='AutoMining action failed: %s', args=['<b>reason</b>']))
        self.assertEqual(screens, ['AutoMining action failed: &lt;b&gt;reason&lt;/b&gt;'])

if __name__ == '__main__':
    unittest.main()
