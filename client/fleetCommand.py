# coding: utf-8
# Loaded on demand; this window and its translations are not a login payload.
def _am_build_fleet_command():
    from carbonui import uiconst as C
    from carbonui.control.window import Window
    from carbonui.control.button import Button
    from carbonui.control.checkbox import Checkbox
    from carbonui.control.combo import Combo
    from carbonui.control.singlelineedits.singleLineEditInteger import SingleLineEditInteger
    from carbonui.control.scrollContainer import ScrollContainer
    from carbonui.primitives.container import Container
    from carbonui.primitives.fill import Fill
    from eve.client.script.ui.control.eveLabel import Label

    def tr(key):
        return _AM_FLEET_LOCALES.get(_am_language(), {}).get(key, _am_tr(key))

    def safe(value):
        return unicode(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

    def label(parent, value, **kw):
        kw.setdefault('align', C.TOTOP)
        kw.setdefault('autoFitToText', True)
        return Label(parent=parent, text=safe(tr(value)), fontsize=15, **kw)

    def button(parent, value, callback, **kw):
        kw.setdefault('name', 'FleetCommand_' + value.replace(' ', '_'))
        return Button(parent=parent, label=tr(value), func=callback, fontsize=15, **kw)

    def section(parent, value):
        row = Container(parent=parent, align=C.TOTOP, height=36, padTop=6, padBottom=5)
        Fill(bgParent=row, align=C.TOTOP, height=1, color=(0.75, 0.82, 0.85, 0.25), state=C.UI_DISABLED)
        Label(parent=row, align=C.CENTERLEFT, left=4, text=safe(tr(value)), fontsize=16,
            color=(0.86, 0.91, 0.93, 1.0), state=C.UI_DISABLED)

    class FleetCommandWindow(_am_window_class):
        default_windowID = 'EveJSAutoMiningFleetCommand'
        default_caption = 'Fleet Command'
        default_width = 1540
        default_height = 900
        default_minSize = (1260, 780)
        default_isStackable = False
        default_scope = C.SCOPE_INGAME

        def ApplyAttributes(self, attributes):
            Window.ApplyAttributes(self, attributes)
            self.SetCaption(tr('Fleet Command'))
            self.character, self.selected = session.charid, set()
            self._selected, self._catalog = [], {}
            self._catalogTypes, self._catalogVolumes = {}, {}
            self._availableCacheToken, self._availableCacheEntries = None, []
            self._busy, self._page = False, 'mining'
            self._toggles = {}
            self.rows, self.checks = [], {}
            self.busy = False
            self.signature, self.orderSignature = None, None
            main = self.content
            Fill(bgParent=main, color=(0.025, 0.035, 0.04, 0.96), state=C.UI_DISABLED)
            header = Container(parent=main, align=C.TOTOP, height=94, padding=(18, 12, 18, 8))
            Label(parent=header, align=C.TOTOP, text=tr('Fleet Command'), fontsize=26, height=36)
            label(header, 'One order. Selected pilots. Personal settings stay saved.')
            self.status = label(header, 'Loading fleet...', padTop=6, color=(0.57, 0.78, 0.82, 1))
            footer = Container(parent=main, align=C.TOBOTTOM, height=65, padding=(18, 10, 18, 8))
            self.summary = label(footer, 'Choose pilots, then send an order.')
            self.results = label(footer, '', padTop=7)
            body = Container(parent=main, align=C.TOALL, padding=(18, 0, 18, 8))
            left = Container(parent=body, align=C.TOLEFT, width=260, padRight=14)
            section(left, 'Fleet pilots')
            tools = Container(parent=left, align=C.TOTOP, height=36)
            button(tools, 'Miners', self.SelectMiners, align=C.TOLEFT, width=90)
            button(tools, 'All', self.SelectAll, align=C.TOLEFT, width=70, padLeft=6)
            button(tools, 'Clear', self.ClearSelection, align=C.TOLEFT, width=90, padLeft=6)
            self.pilotList = ScrollContainer(parent=left, align=C.TOALL)
            right = Container(parent=body, align=C.TORIGHT, width=260, padLeft=14)
            section(right, 'Fleet actions')
            label(right, 'Controls apply to the selected pilots.', padding=(6, 6, 6, 8))
            button(right, 'Start / Resume', lambda *a: self.Send('start'), align=C.TOTOP, height=34, padBottom=8)
            button(right, 'Stop + recall drones', lambda *a: self.Send('stop'), align=C.TOTOP, height=34, padBottom=8)
            button(right, 'Recall drones', lambda *a: self.Send('recall'), align=C.TOTOP, height=34, padBottom=8)
            label(right, 'Recall orders use normal drone return behaviour.', padding=(6, 0, 6, 12))
            section(right, 'Order log')
            self.orderList = ScrollContainer(parent=right, align=C.TOALL)
            middle = Container(parent=body, align=C.TOALL)
            tabs = Container(parent=middle, align=C.TOTOP, height=44, padBottom=8)
            self.commandButtons = {}
            for page, caption in [('mining', 'Mining'), ('filter', 'Mining Filter')]:
                self.commandButtons[page] = button(tabs, caption, self.CommandPageCallback(page), align=C.TOLEFT, width=190, height=34, padRight=8)
            label(middle, 'Orders end when you stop or leave the fleet. Personal settings stay saved.', padding=(6, 6, 6, 8))
            self.commandPanels = dict((page, Container(parent=middle, align=C.TOALL, state=C.UI_HIDDEN)) for page in ('mining', 'filter'))
            mining = ScrollContainer(parent=self.commandPanels['mining'], align=C.TOALL)
            section(mining, 'Targeting')
            for key, caption, checked in [('lock', 'Lock targets automatically', True), ('approach', 'Approach out-of-range ore', False)]:
                self._toggles[key] = Checkbox(parent=mining, align=C.TOTOP, height=34, text=tr(caption), checked=checked, callback=self.Changed)
            label(mining, 'Target priority')
            self.orderEdit = Combo(parent=mining, align=C.TOTOP, options=[(tr(caption), key) for caption, key in
                [('Nearest first', 'nearest'), ('Furthest first', 'furthest'), ('Largest volume first', 'largest'), ('Smallest volume first', 'smallest')]], select='nearest', callback=self.Changed)
            self.scopeLabel = label(mining, '')
            self.priorityHint = label(mining, '', padBottom=12)
            section(mining, 'Mining support')
            for key, caption in [('survey', 'Automatic survey'), ('compress', 'Automatic compression')]:
                self._toggles[key] = Checkbox(parent=mining, align=C.TOTOP, height=34, text=tr(caption), checked=False, callback=self.Changed)
            label(mining, 'Survey seconds')
            self.timerEdit = SingleLineEditInteger(parent=mining, align=C.TOTOP, height=34, setvalue=60, minValue=6, maxValue=86400, OnChange=self.Changed)
            label(mining, 'Default 60 | Minimum 6', padTop=6, padBottom=14)
            button(mining, 'Apply mining order', lambda *a: self.Send('mining'), align=C.TOTOP, height=34, padBottom=8)
            button(mining, 'Restore personal mining settings', lambda *a: self.Send('restoreMining'), align=C.TOTOP, height=34)
            applyRow = Container(parent=self.commandPanels['filter'], align=C.TOBOTTOM, height=80, padTop=6)
            button(applyRow, 'Apply ore order', lambda *a: self.Send('filter'), align=C.TOTOP, height=34, padBottom=6)
            button(applyRow, 'Restore personal filters', lambda *a: self.Send('restore'), align=C.TOTOP, height=34)
            self.BuildOreFilter(self.commandPanels['filter'])
            self.SelectCommandPage('mining', False)
            self.UpdatePriorityHint()
            _am_uthread.new(self.Refresh, True)
            _am_uthread.new(self.Poll)
            try:
                from carbonui.uianimations import animations
                animations.FadeTo(body, startVal=0.4, endVal=1.0, duration=0.2)
            except Exception:
                body.opacity = 1.0

        def CommandPageCallback(self, page):
            return lambda *a: self.SelectCommandPage(page)

        def SelectCommandPage(self, page, animate=True):
            self._page = page
            for key, panel in self.commandPanels.items():
                panel.state = C.UI_NORMAL if key == page else C.UI_HIDDEN
                self.commandButtons[key].opacity = 1.0 if key == page else 0.55
            if page == 'filter':
                self.DrawLists()
            if animate:
                try:
                    from carbonui.uianimations import animations
                    animations.FadeTo(self.commandPanels[page], startVal=0.5, endVal=1.0, duration=0.18)
                except Exception:
                    self.commandPanels[page].opacity = 1.0

        def Request(self, method, *args):
            if self.destroyed or session.charid != self.character:
                raise RuntimeError(_am_tr('Character changed'))
            result = _am_json.loads(getattr(sm.RemoteSvc('miningScanMgr'), method)(*args))
            if self.destroyed or session.charid != self.character:
                raise RuntimeError(_am_tr('Character changed'))
            if not result.get('success'):
                raise RuntimeError(tr(result.get('message', 'AutoMining request failed')))
            return result

        def PilotName(self, row):
            name = unicode(row.get('name') or '')
            if name and not name.isdigit():
                return name
            try:
                name = unicode(cfg.eveowners.Get(row['characterID']).name)
                if name and not name.isdigit():
                    return name
            except Exception:
                pass
            return tr('Unknown pilot')

        def OreName(self, key):
            return self._catalog.get(key, key)

        def Refresh(self, initial=False):
            if self.busy or self.destroyed:
                return
            self.busy = self._busy = True
            try:
                self.Show(self.Request('AutoMiningFleetCommandView', initial))
            except Exception as error:
                if not self.destroyed:
                    self.status.text = safe(unicode(error))
            finally:
                self.busy = self._busy = False

        def Poll(self):
            while not self.destroyed and session.charid == self.character:
                _am_blue.pyos.synchro.SleepWallclock(4000)
                if not self.destroyed:
                    self.Refresh()
            if not self.destroyed:
                self.Close()

        def Show(self, result):
            self.rows = result['pilots']
            self.selected.intersection_update(set(row['characterID'] for row in self.rows if row['online']))
            if 'catalog' in result:
                self.LoadOreCatalog(result['catalog'])
                self.DrawLists()
            self.status.text = safe(tr('Fleet leader controls') + '  |  ' + str(len(self.rows)) + ' ' + tr('pilots'))
            self.DrawPilots()
            orders = result.get('orders', [])
            signature = _am_json.dumps(orders, sort_keys=True)
            if signature != self.orderSignature:
                self.orderSignature = signature
                self.orderList.Flush()
                for order in orders:
                    import time
                    stamp = time.strftime('%H:%M', time.localtime(order['at'] / 1000.0))
                    values = [self.PilotName(row) + ': ' + tr(row['result']) for row in order['results']]
                    heading = stamp + '  |  ' + tr(order['action'])
                    if order.get('ores'):
                        heading += '\n' + ', '.join(self.OreName(key) for key in order['ores'])
                    label(self.orderList, heading + '\n' + '\n'.join(values), padding=(6, 8, 6, 10))
                if not orders:
                    label(self.orderList, 'No fleet orders yet.', padding=(6, 10, 6, 0))
            self.UpdateSelection()

        def DrawPilots(self):
            signature = [(row['characterID'], row['job'], row['online'], row['enabled'], row['ores'], row.get('overridden'), row['override']) for row in self.rows]
            if signature == self.signature:
                self.UpdateSelection()
                return
            self.signature = signature
            self.pilotList.Flush()
            self.checks = {}
            for row in self.rows:
                cid = row['characterID']
                tile = Container(parent=self.pilotList, align=C.TOTOP, height=120, padBottom=6)
                Fill(bgParent=tile, color=(0.06, 0.09, 0.11, 1), state=C.UI_DISABLED)
                checkbox = Checkbox(parent=tile, name='FleetCommandPilot%s' % cid, align=C.TOTOP, height=32,
                    text=self.PilotName(row), checked=cid in self.selected, callback=self.TogglePilot(cid))
                if not row['online']:
                    checkbox.Disable()
                self.checks[cid] = checkbox
                job = tr({'mining': 'Mining', 'hauling': 'Hauling', 'boosting': 'Boosting', 'pve': 'PVE'}.get(row['job'], 'Offline'))
                label(tile, job + '  |  ' + tr('ON' if row['enabled'] else 'OFF'), padding=(30, 0, 6, 4))
                origin = tr('Fleet filter' if 'ores' in row.get('overridden', ['ores'] if row['override'] else []) else 'Personal filter')
                ores = ', '.join(self.OreName(key) for key in row['ores']) or tr('All compatible resources')
                label(tile, origin + ': ' + ores, padding=(30, 0, 6, 0), maxLines=2)
                if any(key != 'ores' for key in row.get('overridden', [])):
                    label(tile, 'Fleet mining settings active', padding=(30, 4, 6, 0), color=(0.57, 0.78, 0.82, 1))

        def TogglePilot(self, cid):
            def toggle(widget, *args):
                if widget.GetValue():
                    self.selected.add(cid)
                else:
                    self.selected.discard(cid)
                self.UpdateSelection()
            return toggle

        def UpdateSelection(self):
            for cid, checkbox in self.checks.items():
                checkbox.SetChecked(cid in self.selected, report=False)
            self.summary.text = safe(str(len(self.selected)) + ' ' + tr('selected pilots'))

        def SelectMiners(self, *args):
            self.selected = set(row['characterID'] for row in self.rows if row['online'] and row['job'] == 'mining')
            self.UpdateSelection()

        def SelectAll(self, *args):
            self.selected = set(row['characterID'] for row in self.rows if row['online'])
            self.UpdateSelection()

        def ClearSelection(self, *args):
            self.selected.clear()
            self.UpdateSelection()

        def Changed(self, *args):
            self.UpdatePriorityHint()

        def SetNotice(self, message):
            self.results.text = safe(message)

        def Send(self, action):
            _am_uthread.new(self.SendWork, action)

        def SendWork(self, action):
            if self.busy or self.destroyed:
                return
            if not self.selected or action == 'filter' and not self._selected:
                self.results.text = safe(tr('Choose pilots and at least one ore for a filter order.'))
                return
            self.busy = self._busy = True
            try:
                ores = list(self._selected)
                request = {'action': action, 'pilots': sorted(self.selected), 'ores': ores}
                if action == 'mining':
                    request['settings'] = dict((key, bool(widget.GetValue())) for key, widget in self._toggles.items())
                    request['settings'].update(order=self.orderEdit.GetValue(), surveySeconds=self.timerEdit.GetValue())
                result = self.Request('AutoMiningFleetCommandAction', _am_json.dumps(request))
                self.Show(result)
                counts = {}
                for row in result['order']['results']:
                    key = row['result']
                    counts[key] = counts.get(key, 0) + 1
                self.results.text = safe('  |  '.join(str(count) + ' ' + tr(key) for key, count in sorted(counts.items())))
            except Exception as error:
                if not self.destroyed:
                    self.results.text = safe(unicode(error))
            finally:
                self.busy = self._busy = False

    return FleetCommandWindow


_am_fleet_command_class = _am_build_fleet_command()


def _am_install_fleet_order_notices():
    # The main HUD only requests this companion after receiving a real server
    # order. Keep the recipient UI and translations out of the login envelope.
    from carbonui import uiconst as C
    from carbonui.primitives.containerAutoSize import ContainerAutoSize
    from carbonui.primitives.fill import Fill
    from eve.client.script.ui.control.eveLabel import Label

    def tr(key):
        return _AM_FLEET_LOCALES.get(_am_language(), {}).get(key, _am_tr(key))

    def safe(value):
        return unicode(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

    fields = {'lock': 'Lock targets automatically', 'approach': 'Approach out-of-range ore',
        'order': 'Target priority', 'survey': 'Automatic survey', 'compress': 'Automatic compression', 'surveySeconds': 'Survey seconds'}
    priorities = {'nearest': 'Nearest first', 'furthest': 'Furthest first', 'largest': 'Largest volume first', 'smallest': 'Smallest volume first'}
    original_show = _am_window_class.ShowResponse
    original_read = _am_window_class.ReadSettings

    def set_controls(window, values):
        for key, value in values.items():
            if key == 'ores':
                if window._selected != value:
                    window._selected = list(value)
                    window.DrawLists()
            elif key == 'order':
                window.orderEdit.SelectItemByValue(value)
            elif key == 'surveySeconds':
                window.timerEdit.SetValue(value, docallback=False)
            else:
                window._toggles[key].SetChecked(value, report=False)

    def show(window, response, replaceDraft=False, draft=False, preserveJobDrafts=False):
        previous = getattr(window, '_fleetOrderValues', {})
        personal = getattr(window, '_fleetOrderPersonal', {})
        dirty = window._dirty and not replaceDraft
        edited = original_read(window) if dirty else {}
        original_show(window, response, replaceDraft, draft, preserveJobDrafts)
        order = response.get('fleetOverride') or {}
        values = order.get('values', {}) if window._job == 'mining' else {}
        baseline = dict((key, personal.get(key, edited.get(key, response['settings'][key])) if dirty else response['settings'][key])
            for key in set(previous) | set(values))
        loading = window._loading
        window._loading = True
        try:
            # Restore only fields whose orders ended. Repainting a personal
            # filter then the same fleet filter on every poll churns its tiles.
            set_controls(window, dict((key, baseline[key]) for key in previous if key not in values))
            set_controls(window, values)
        finally:
            window._loading = loading
        window._fleetOrderValues = dict(values)
        window._fleetOrderPersonal = dict((key, baseline[key]) for key in values)
        window.fleetFilterNotice.text = ''
        for key, widget in list(window._toggles.items()) + [('order', window.orderEdit), ('surveySeconds', window.timerEdit)]:
            if key in fields:
                widget.state = C.UI_DISABLED if key in values else C.UI_NORMAL
        notices = getattr(window, '_fleetOrderNotices', {})
        for index, keys in [(0, [key for key in fields if key in values]), (2, ['ores'] if 'ores' in values else [])]:
            if keys and index not in notices:
                panel = window.tabs.tabs[index][1]
                box = ContainerAutoSize(parent=panel, idx=0, align=C.TOTOP, alignMode=C.TOTOP, padBottom=14, padding=(10, 8, 10, 8))
                Fill(bgParent=box, color=(0.22, 0.16, 0.06, 0.65), state=C.UI_DISABLED)
                title = Label(parent=box, align=C.TOTOP, autoFitToText=True, fontsize=18, color=(0.95, 0.78, 0.42, 1), state=C.UI_DISABLED)
                detail = Label(parent=box, align=C.TOTOP, autoFitToText=True, fontsize=14, padTop=5, state=C.UI_DISABLED)
                notices[index] = (box, title, detail)
            if index in notices:
                box, title, detail = notices[index]
                box.state = C.UI_NORMAL if keys else C.UI_HIDDEN
                title.text = safe(tr('Controlled by fleet commander: %s') % (order.get('leader') or tr('Fleet leader controls')))
                descriptions = []
                for key in keys:
                    value = values[key]
                    caption = tr(fields[key]) if key != 'ores' else tr('Mining Filter')
                    display = ', '.join(window._catalog.get(ore, ore) for ore in value) if key == 'ores' else tr(priorities[value]) if key == 'order' else str(value) if key == 'surveySeconds' else tr('ON' if value else 'OFF')
                    descriptions.append(caption + ': ' + display)
                detail.text = safe(' | '.join(descriptions) + '\n' + tr('Orders end when you stop or leave the fleet. Personal settings stay saved.'))
        window._fleetOrderNotices = notices
        window.UpdatePriorityHint()

    def read(window):
        prefs = original_read(window)
        prefs.update(getattr(window, '_fleetOrderPersonal', {}))
        return prefs

    def protect_filter(method):
        def guarded(window, *args):
            if 'ores' in getattr(window, '_fleetOrderValues', {}):
                window.SetNotice(tr('The fleet commander controls this filter. Stop or leave the fleet to restore your own.'))
                return
            return method(window, *args)
        return guarded

    _am_window_class.ShowResponse = show
    _am_window_class.ReadSettings = read
    for name in ['AddOreKeys', 'RemoveOreKeys', 'MoveOre', 'ClearFilter']:
        if hasattr(_am_window_class, name):
            setattr(_am_window_class, name, protect_filter(getattr(_am_window_class, name)))


_am_install_fleet_order_notices()
