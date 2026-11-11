"""Execute released initializer bytes in existing fake EVE services; no retail client."""
import contextlib
import io
import json
import sys
import types
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_login_companion import Fixture

data = json.load(sys.stdin)
f = Fixture()
assignments = []

class TrackedBuiltins(types.ModuleType):
    def __setattr__(self, name, value):
        if name in ('_evejs_automining_login_v1', '_evejs_ourmods_fitting_runtime', '_evejs_asteroid_erosion_v1'):
            assignments.append(name)
        super().__setattr__(name, value)

f.builtins.__class__ = TrackedBuiltins

class Park:
    def RealFlushState(self, state):
        return 'native-flush'
    def SetDestructionEffectOnRemove(self, ball_id, effect):
        return 'native-destruction'

class Asteroid:
    def Release(self, origin=None):
        return 'native-release'

f.modules['eve.client.script.remote.michelle'].Park = Park
f.modules['eve.client.script.environment.spaceObject.asteroid'] = types.SimpleNamespace(Asteroid=Asteroid)
f.modules['evetypes'] = types.SimpleNamespace(GetGroupID=lambda _: 1)
f.modules['inventorycommon.const'] = types.SimpleNamespace(groupIce=465)
f.session.charid = 42
namespace = {'__builtins__': f.builtins, 'sm': f.sm, 'session': f.session}
output = io.StringIO()
with contextlib.redirect_stdout(output), patch.dict(sys.modules, f.modules):
    result = eval(compile(data['expression'], '<reported-loadout>', 'eval'), namespace)
    f.drain()
    owner = getattr(f.builtins, '_evejs_automining_login_v1', None)
    erosion = getattr(f.builtins, '_evejs_asteroid_erosion_v1', None)
    ready = owner is not None and owner.usable()
report = dict(result=result, output=output.getvalue(), assignments=assignments,
              requests=f.requests, autoReady=ready, listenerCounts={key: len(rows) for key, rows in f.listeners.items()},
              erosionActive=bool(erosion and erosion.current()), erosionHooks=len(erosion.hooks) if erosion else 0)
print(json.dumps(report))
