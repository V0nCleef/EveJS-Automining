# AutoMining client companion. Python 2.7 compatible, executed inside eveCommands.
# Only fixed survey and profile operations are exposed; no remote code execution.
import os as _am_os
import json as _am_json
import uthread as _am_uthread
import blue as _am_blue

_am_original_run = EveCommandService.Run
_am_original_session_changed = EveCommandService.OnSessionChanged


def _am_connect(self):
    for _attempt in range(3):
        _am_blue.pyos.synchro.SleepWallclock(1500)
        if not getattr(session, 'charid', None):
            return
        try:
            remote = sm.RemoteSvc('miningScanMgr')
            profile = _am_os.environ.get('AUTOMINING_PROFILE_SETTINGS', '')
            if profile and getattr(self, '_automining_profile_char', None) != session.charid:
                prefs = _am_json.loads(profile)
                if prefs.get('apply') is True:
                    remote.AutoMiningProfile(profile)
                self._automining_profile_char = session.charid
            remote.AutoMiningClientReady('1.0.3', 1)
            if globals().get('_am_drones_ready'):
                try:
                    _am_drones_ready()
                except Exception:
                    print('AUTOMINING_DRONES:NOT_READY')
            if globals().get('_am_haul_ready') and not (_am_haul_job and _am_haul_job.valid()):
                try:
                    _am_haul_ready()
                except Exception:
                    print('AUTOMINING_HAUL:NOT_READY')
            return
        except Exception:
            pass


def _am_run(self, *args, **kwargs):
    result = _am_original_run(self, *args, **kwargs)
    _am_uthread.new(_am_connect, self)
    return result


def _am_session_changed(self, *args, **kwargs):
    result = _am_original_session_changed(self, *args, **kwargs)
    _am_uthread.new(_am_connect, self)
    return result


def _am_survey(self):
    success = False
    reason = ''
    try:
        from mining.client import mining_util as _mining_util
        from mining.client.mining_overlay_controller import MiningOverlayController as _Controller
        from eve.client.script.remote.michelle import GetMichelle as _GetMichelle
        if not getattr(session, 'shipid', None) or not getattr(session, 'solarsystemid', None):
            reason = 'not in space'
        elif _GetMichelle().InWarp():
            reason = 'ship is warping'
        elif not (_mining_util.has_current_ship_integrated_mining_scanner() or _mining_util.get_current_ship_mining_scanner_upgrade_tier()):
            reason = 'Mining Surveyor is unavailable on this ship'
        elif _Controller.get_instance().effect_orchestrator.is_playing_effect:
            reason = 'a survey is already running'
        else:
            # This is exactly the command bound to the circled Mining Surveyor button.
            self.CmdMiningScan()
            success = True
    except Exception:
        reason = 'Mining Surveyor command failed'
    try:
        sm.RemoteSvc('miningScanMgr').AutoMiningSurveyAck(success, reason)
    except Exception:
        pass


if 'OnAutoMiningSurvey' not in EveCommandService.__notifyevents__:
    EveCommandService.__notifyevents__ = list(EveCommandService.__notifyevents__) + ['OnAutoMiningSurvey']
    EveCommandService.Run = _am_run
    EveCommandService.OnSessionChanged = _am_session_changed
    EveCommandService.OnAutoMiningSurvey = _am_survey
