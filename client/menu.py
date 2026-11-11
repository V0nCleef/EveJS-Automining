# coding: utf-8
# Launcher shared Mods menu API v1. The login companion owns the actual HUD.
import evejs_mod_menu as mods
import os as _os
try:
    import __builtin__ as _builtins
except ImportError:
    import builtins as _builtins

def _owner():
    return getattr(_builtins, '_evejs_automining_login_v1', None)


def _ready_owner():
    owner = _owner()
    try:
        return owner if owner is not None and owner.usable() else None
    except Exception:
        return None


def _legacy_commands():
    # The host helper selects legacy only after verifying the owned archive.
    # Keep that existing route; never create a second login owner or fake its ack.
    if _os.environ.get('AUTOMINING_CLIENT_DELIVERY') != 'legacy':
        return None
    manager = globals().get('sm') or getattr(_builtins, 'sm', None)
    session = globals().get('session') or getattr(_builtins, 'session', None)
    if manager is None or not getattr(session, 'charid', None):
        return None
    try:
        commands = manager.GetService('cmd')
        events = getattr(commands, '__notifyevents__', ())
        if (all(event in events for event in ('OnAutoMiningSurvey', 'OnAutoMiningOpen'))
                and callable(getattr(commands, 'OnAutoMiningSurvey', None))
                and callable(getattr(commands, 'OnAutoMiningOpen', None))):
            return commands
    except Exception:
        pass
    return None


def available():
    return _ready_owner() is not None or _legacy_commands() is not None


def open_window():
    owner = _ready_owner()
    if owner is not None:
        owner.OnAutoMiningOpen()
    else:
        commands = _legacy_commands()
        if commands is not None:
            commands.OnAutoMiningOpen()


registration = mods.register('automining', {
    'en': u'AutoMining', 'de': u'Automatischer Bergbau',
    'fr': u'Minage automatique', 'es': u'Miner\u00eda autom\u00e1tica',
    'it': u'Estrazione automatica', 'ru': u'\u0410\u0432\u0442\u043e\u0434\u043e\u0431\u044b\u0447\u0430',
    'zh_CN': u'\u81ea\u52a8\u91c7\u77ff', 'ja': u'\u81ea\u52d5\u63a1\u6398',
    'ko': u'\uc790\ub3d9 \ucc44\uad74',
}, open_window, is_available=available, api_version=1)


def cleanup():
    # This adapter owns only the registration. The existing login companion
    # closes its window and jobs on logout, character change and replacement.
    registration.close()
