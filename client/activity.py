# Python 2.7. Native Insider menu composition and pilot activity messages.
# Verified against build 3396210 InsiderService.ToolMenu (MenuList) and
# player_messaging.client.ui_message.message_player, plus logger.AddText.
_am_activity_enabled = None
_am_activity_notifications = True
_AM_ACTIVITY_SOURCES = {
    'mining': 'Mining started.', 'warp': 'Mining paused for warp.',
    'outbound': 'Returning to station.', 'unloading': 'Docked; unloading ore.',
    'resupplying': 'Docked; restocking Heavy Water.', 'undocking': 'Transfer complete; undocking.',
    'inbound': 'Returning to the mining site.', 'resumed': 'Mining resumed at the saved position.',
    'fuelComplete': 'Fuel restocking complete.', 'oreComplete': 'Ore unloading complete.',
    'stackComplete': 'Inventory stacks merged.', 'jettisonComplete': 'Ore jettison complete.', 'fuelReserve': 'Heavy Water reserve reached.',
    'defenseShield': 'Defense retreat: low shield.', 'defenseArmor': 'Defense retreat: low armor.',
    'coreWaiting': 'Waiting for industrial core cycle before departure.',
    'manualCore': 'Manual industrial core active; stop it before departure.',
    'coreActive': 'Industrial core activated.', 'compressorActive': 'Asteroid ore compressor activated.',
    'boostsActive': 'Mining boosts activated.', 'dronesReturned': 'Drones recalled before departure.',
    'failure': 'AutoMining action failed: %s',
}


def _am_activity_set_state(enabled, notifications=True):
    global _am_activity_enabled, _am_activity_notifications
    _am_activity_enabled = enabled is True
    _am_activity_notifications = notifications is not False


def _am_activity_receive(self, raw):
    if (not globals().get('_am_is_active', lambda: True)() or
            _am_activity_enabled is False or not _am_activity_notifications or
            not getattr(session, 'charid', None)):
        return
    try:
        if not isinstance(raw, (str, unicode)) or len(raw) > 2000:
            return
        event = _am_json.loads(raw)
        if not isinstance(event, dict) or event.get('version') != 1 or event.get('enabled') is not True:
            return
        if event.get('characterID') != session.charid:
            return
        key = event.get('key')
        if not isinstance(key, (str, unicode)) or key not in _AM_ACTIVITY_SOURCES:
            return
        if event.get('message') != _AM_ACTIVITY_SOURCES[key]:
            return
        args = event.get('args', [])
        if not isinstance(args, list) or len(args) != (1 if key == 'failure' else 0):
            return
        if any(not isinstance(arg, (str, unicode)) or len(arg) > 300 for arg in args):
            return
        message = _am_tr(_AM_ACTIVITY_SOURCES[key])
        if args:
            message = message % tuple(_am_status(arg) for arg in args)
        safe = unicode(message)[:1000].replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        from player_messaging.client.ui_message import message_player
        message_player(safe)
        sm.GetService('logger').AddText(safe, 'notify')
    except Exception:
        # Bad activity data must never interfere with commands or the HUD.
        return


def _am_insider_open(*args):
    if globals().get('_am_is_active', lambda: True)() and getattr(session, 'charid', None):
        _am_open_hud(sm.GetService('cmd'))


def _am_has_shared_menu():
    try:
        import evejs_mod_menu
        return evejs_mod_menu.API_VERSION == 1 and callable(evejs_mod_menu.register)
    except Exception:
        return False


def _am_insider_compose(entries):
    # Native ToolMenu returns MenuList containing (caption, submenu) tuples.
    # Preserve the returned native list and every unrelated entry.
    if _am_has_shared_menu():
        return entries
    label = _am_tr('AutoMining')
    for index, entry in enumerate(entries):
        if isinstance(entry, (tuple, list)) and len(entry) >= 2 and entry[0] == 'MODS':
            if not isinstance(entry[1], (tuple, list)):
                return entries
            children = list(entry[1])
            if not any(isinstance(child, (tuple, list)) and len(child) >= 2 and
                       child[1] is _am_insider_open for child in children):
                children.append((label, _am_insider_open))
                entries[index] = tuple([entry[0], children] + list(entry[2:]))
            return entries
    entries.append(('MODS', [(label, _am_insider_open)]))
    return entries


def _am_install_insider():
    # The Launcher owns Neocom and the top-level Insider MODS category.
    # Retain the old Tools entry only when its public API is unavailable.
    if _am_has_shared_menu():
        return True
    try:
        from eve.devtools.script.insider import InsiderService
        original = InsiderService.ToolMenu
        if getattr(original, '_automining_menu', False):
            return True

        def tool_menu(self, *args, **kwargs):
            entries = original(self, *args, **kwargs)
            if globals().get('_am_is_active', lambda: True)():
                return _am_insider_compose(entries)
            return entries

        tool_menu._automining_menu = True
        InsiderService.ToolMenu = tool_menu
        return True
    except Exception:
        # Insider isn't available on every client/account. Keep native menu and
        # the independent !automining opener intact.
        return False


if 'OnAutoMiningActivity' not in EveCommandService.__notifyevents__:
    EveCommandService.__notifyevents__ = list(EveCommandService.__notifyevents__) + ['OnAutoMiningActivity']
    EveCommandService.OnAutoMiningActivity = _am_activity_receive

_am_insider_installed = _am_install_insider()

