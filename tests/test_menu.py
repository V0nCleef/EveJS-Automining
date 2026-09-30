"""AutoMining's adapter against the Launcher's actual public menu registry.

Pass shared_menu.py as argv[1]. Native menu rendering is deliberately replaced.
"""
import base64
import builtins
import json
import sys
import types
from pathlib import Path

root = Path(__file__).resolve().parents[1]
framework = types.ModuleType('evejs_mod_menu')
framework.session = types.SimpleNamespace(userid=1, charid=42, languageID='EN')
framework.sm = types.SimpleNamespace()
exec(compile(Path(sys.argv[1]).read_bytes(), '<actual-launcher-menu-api>', 'exec'), framework.__dict__)
sys.modules['evejs_mod_menu'] = framework
descriptor = json.loads((root / 'evejs-launcher.mod.json').read_text())
assert descriptor['id'] == 'automining' and descriptor['schemaVersion'] == 3
assert descriptor['clientMenu'] == {'apiVersion': 1, 'entrypoint': 'client/menu.py'}
assert descriptor['launcherApi']['minLauncherVersion'] == '1.0.69'
source = (root / descriptor['clientMenu']['entrypoint']).read_bytes()
assert len(source) <= 128 * 1024

class Owner:
    def __init__(self, character):
        self.character, self.ready, self.opens = character, False, 0

    def usable(self):
        return self.ready and self.character == framework.session.charid

    def OnAutoMiningOpen(self):
        self.opens += 1

class Menus:
    def __init__(self, registry):
        self.history, self.closed = [], False

    def sync(self, visible, changed):
        self.history.append((visible, changed))

    def close(self):
        self.closed = True

other = b"import evejs_mod_menu as mods\nregistration = mods.register('other.mod', {'en': 'Other mod'}, lambda: None)\ndef cleanup():\n registration.close()\n"
registry = framework.Registry([
    {'id': 'automining', 'source': base64.b64encode(source)},
    {'id': 'other.mod', 'source': base64.b64encode(other)},
], menus_factory=Menus)
framework._registry = registry
owner = Owner(42)
builtins._evejs_automining_login_v1 = owner
registry.tick()
assert set(registry.entries) == {'automining', 'other.mod'}
assert [row[1] for row in registry.usable()] == ['other.mod']
assert owner.opens == 0, 'Registration must not open the HUD'
owner.ready = True
registry.refresh()
assert [row[1] for row in registry.usable()] == ['automining', 'other.mod']
label, callback, args = next(row for row in registry.menu_entries() if row[2][0] == 'automining')
callback(*args)
assert owner.opens == 1

# Repeated registration replaces one entry; stale cleanup cannot remove it.
first = registry.namespaces[0]
second = {}
exec(compile(source, '<automining-menu-repeat>', 'exec'), second)
first['cleanup']()
assert set(registry.entries) == {'automining', 'other.mod'}
assert len([row for row in registry.usable() if row[1] == 'automining']) == 1
second['cleanup']()
assert set(registry.entries) == {'other.mod'}, 'Cleanup must preserve other authors'
exec(compile(source, '<automining-menu-current>', 'exec'), second)

# Readiness follows the current login companion rather than a cached owner.
replacement = Owner(42)
replacement.ready = True
builtins._evejs_automining_login_v1 = replacement
entry = registry.entries['automining']
registry.open('automining', entry[3])
assert replacement.opens == 1 and owner.opens == 1
for language in ('EN', 'DE', 'FR', 'ES', 'IT', 'RU', 'ZH', 'JA', 'KO'):
    framework.session.languageID = language
    displayed = next(row[0] for row in registry.usable() if row[1] == 'automining')
    assert displayed and (language == 'EN' or displayed != 'AutoMining')

framework.session.charid = 43
assert 'automining' not in [row[1] for row in registry.usable()]
replacement = Owner(43)
replacement.ready = True
builtins._evejs_automining_login_v1 = replacement
registry.tick()
assert set(registry.entries) == {'automining', 'other.mod'}
registry.OnSessionReset()
assert not registry.entries and not registry.usable()
registry.OnSessionChanged(False, framework.session, {})
assert set(registry.entries) == {'automining', 'other.mod'}
registry.close()
assert not registry.entries and registry.menus.closed
del builtins._evejs_automining_login_v1
print('PASS: actual public registry accepts AutoMining; readiness, existing opener, nine labels, duplicate registration, isolated cleanup and character/relogin lifecycle work.')
