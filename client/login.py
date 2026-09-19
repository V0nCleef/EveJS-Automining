# AutoMining login bootstrap. Runs in a private namespace, never eveCommands globals.
# Python 2.7 compatible. Defer all character RPC and UI work until after login.
try:
    import __builtin__ as _am_builtins
    import base64 as _am_base64
    import os as _am_os
    import json as _am_json
    import uthread as _am_uthread
    import blue as _am_blue

    _am_key = '_evejs_automining_login_v1'
    _am_previous = getattr(_am_builtins, _am_key, None)
    if _am_previous is not None:
        _am_previous.dispose()

    class _AutoMiningLogin(object):
        __notifyevents__ = ['OnSessionChanged', 'OnAutoMiningSurvey', 'OnAutoMiningOpen', 'OnAutoMiningFeedback']

        def __init__(self):
            self.active = True
            self.ready = False
            self.character = None
            self.generation = 0
            self.registered = []
            self.namespace = None
            self.sm = None
            self.session = None

        def current(self):
            return self.active and getattr(_am_builtins, _am_key, None) is self

        def usable(self):
            return self.current() and self.ready and self.session is not None and self.character == getattr(self.session, 'charid', None)

        def close_window(self):
            window_class = (self.namespace or {}).get('_am_window_class')
            if window_class is not None:
                try:
                    window = window_class.GetIfOpen()
                    if window is not None:
                        window.Close()
                except Exception:
                    pass

        def dispose(self):
            self.active = False
            self.ready = False
            self.generation += 1
            self.close_window()
            for event in list(self.registered):
                try:
                    self.sm.UnregisterForNotifyEvent(self, event)
                except Exception:
                    pass
            self.registered = []

        def CmdMiningScan(self):
            if not self.usable():
                raise RuntimeError('AutoMining session is not ready')
            return self.sm.GetService('cmd').CmdMiningScan()

        def start(self):
            try:
                # The handshake precedes the normal character session. Yield to login.
                for attempt in range(240):
                    _am_blue.pyos.synchro.SleepWallclock(500)
                    if not self.current():
                        return
                    self.sm = _am_context.get('sm', getattr(_am_builtins, 'sm', None))
                    self.session = _am_context.get('session', getattr(_am_builtins, 'session', None))
                    if self.sm is not None and self.session is not None:
                        break
                else:
                    self.dispose()
                    return
                for event in self.__notifyevents__:
                    self.sm.RegisterForNotifyEvent(self, event)
                    self.registered.append(event)
                self.changed()
            except Exception:
                self.dispose()
                print('AUTOMINING_LOGIN:FAILED')

        def OnSessionChanged(self, *args):
            if self.current():
                if len(args) > 1 and hasattr(args[1], 'charid') and args[1] is not self.session:
                    self.ready = False
                    self.session = args[1]
                    if self.namespace is not None:
                        self.namespace['session'] = self.session
                self.changed()

        def changed(self):
            character = getattr(self.session, 'charid', None)
            if character == self.character and self.ready:
                return
            self.ready = False
            self.close_window()
            self.character = character
            self.generation += 1
            if character:
                _am_uthread.new(self.connect, self.generation)

        def connect(self, generation):
            for attempt in range(6):
                _am_blue.pyos.synchro.SleepWallclock(1500)
                if not self.current() or generation != self.generation or not self.character:
                    return
                try:
                    # A leftover archive companion owns its existing delivery path.
                    # Do not wrap command methods or register a second active companion.
                    from eve.client.script.ui.eveCommands import EveCommandService as _RealCommands
                    if 'OnAutoMiningSurvey' in _RealCommands.__notifyevents__:
                        self.dispose()
                        print('AUTOMINING_LOGIN:LEGACY')
                        return
                    remote = self.sm.RemoteSvc('miningScanMgr')
                    acknowledgement = _am_json.loads(remote.AutoMiningLoginReady(_am_token, _am_version, 0))
                    if not self.current() or generation != self.generation:
                        return
                    if acknowledgement.get('success') is not True or acknowledgement.get('token') != _am_token or acknowledgement.get('version') != _am_version:
                        self.dispose()
                        return
                    if self.namespace is None:
                        # Reuse authored survey/HUD functions without touching the real command class.
                        class _Adapter(object):
                            __notifyevents__ = []
                            def Run(self, *args, **kwargs):
                                pass
                            def OnSessionChanged(self, *args, **kwargs):
                                pass
                        namespace = {'__builtins__': _am_builtins, '__name__': 'evejs_automining_companion', 'EveCommandService': _Adapter,
                                     'sm': self.sm, 'session': self.session, '_am_is_active': self.usable}
                        eval(compile(_am_base64.b64decode(_am_source64), '<automining-companion>', 'exec'), namespace)
                        self.namespace = namespace
                    profile = _am_os.environ.get('AUTOMINING_PROFILE_SETTINGS', '')
                    if profile and getattr(self, '_profile_character', None) != self.character:
                        if _am_json.loads(profile).get('apply') is True:
                            remote.AutoMiningProfile(profile)
                        if not self.current() or generation != self.generation:
                            return
                        self._profile_character = self.character
                    acknowledgement = _am_json.loads(remote.AutoMiningLoginReady(_am_token, _am_version, 1))
                    if not self.current() or generation != self.generation:
                        return
                    if acknowledgement.get('success') is not True or acknowledgement.get('token') != _am_token or acknowledgement.get('version') != _am_version:
                        self.dispose()
                        return
                    self.ready = True
                    print('AUTOMINING_LOGIN:READY:' + _am_version)
                    return
                except Exception:
                    pass
            if self.current() and generation == self.generation:
                self.ready = False
                print('AUTOMINING_LOGIN:NOT_READY')

        def OnAutoMiningSurvey(self):
            if self.usable():
                self.namespace['_am_survey'](self)

        def OnAutoMiningOpen(self):
            if self.usable():
                self.namespace['_am_open_hud'](self)

        def OnAutoMiningFeedback(self, message):
            if self.usable():
                self.namespace['_am_feedback'](self, message)

    if _am_os.environ.get('AUTOMINING_CLIENT_DELIVERY') != 'legacy':
        _am_handler = _AutoMiningLogin()
        setattr(_am_builtins, _am_key, _am_handler)
        _am_uthread.new(_am_handler.start)
except Exception:
    # Companion problems must not prevent the existing EveJS login function finishing.
    print('AUTOMINING_LOGIN:FAILED')
