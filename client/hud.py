# AutoMining native settings window. Loaded lazily so UI import failures cannot
# interfere with the command service or the independent survey companion.
_am_window_class = None


def _am_build_window_class():
    from carbonui import uiconst as C
    from carbonui.control.window import Window
    from carbonui.control.button import Button
    from carbonui.control.checkbox import Checkbox
    from carbonui.control.combo import Combo
    from carbonui.control.singlelineedits.singleLineEditText import SingleLineEditText
    from carbonui.control.singlelineedits.singleLineEditInteger import SingleLineEditInteger
    from carbonui.primitives.container import Container
    from eve.client.script.ui.control.eveLabel import EveLabelMedium, EveLabelSmall
    from eve.client.script.ui.control.eveScroll import Scroll
    from eve.client.script.ui.control.entries.generic import Generic
    from eve.client.script.ui.control.entries.util import GetFromClass

    def text(value):
        return unicode(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

    class AutoMiningWindow(Window):
        default_windowID = 'EveJSAutoMiningSettings'
        default_caption = 'AutoMining'
        default_width = 660
        default_height = 790
        default_minSize = (620, 740)
        default_isStackable = False
        default_scope = C.SCOPE_INGAME

        def ApplyAttributes(self, attributes):
            self._character = session.charid
            self._loading = True
            self._busy = False
            self._dirty = False
            self._editSerial = 0
            self._revision = None
            self._catalog = {}
            self._selected = set()
            Window.ApplyAttributes(self, attributes)
            main = self.content
            self.statusLabel = EveLabelMedium(parent=main, align=C.TOTOP, autoFitToText=True, padBottom=8, text='Connecting to AutoMining...')
            actionRow = Container(parent=main, align=C.TOTOP, height=34)
            Button(parent=actionRow, align=C.TOPLEFT, width=120, label='Start / Resume', func=self.Start)
            Button(parent=actionRow, align=C.TOPLEFT, left=130, width=95, label='Stop', func=self.Stop)
            EveLabelSmall(parent=actionRow, align=C.CENTERRIGHT, text='On / Off is saved per character')
            self._toggles = {}
            for pairs in [(('lock', 'Lock targets automatically'), ('approach', 'Approach out-of-range ore')),
                          (('survey', 'Automatic survey'), ('compress', 'Automatic compression'))]:
                row = Container(parent=main, align=C.TOTOP, height=30)
                for key, label in pairs:
                    cell = Container(parent=row, align=C.TOLEFT_PROP, width=0.5)
                    self._toggles[key] = Checkbox(parent=cell, text=label, checked=False, callback=self.Changed)
            orderRow = Container(parent=main, align=C.TOTOP, height=34)
            EveLabelMedium(parent=orderRow, align=C.CENTERLEFT, text='Target priority')
            self.orderEdit = Combo(parent=orderRow, align=C.TOPLEFT, left=145, width=240, options=[('Nearest first', 'nearest'), ('Furthest first', 'furthest'), ('Largest volume first', 'largest'), ('Smallest volume first', 'smallest')], select='nearest', callback=self.Changed)
            self.scopeLabel = EveLabelMedium(parent=main, align=C.TOTOP, autoFitToText=True, padBottom=6, text='')
            self.priorityHint = EveLabelSmall(parent=main, align=C.TOTOP, autoFitToText=True, padBottom=8, text='')
            EveLabelSmall(parent=main, align=C.TOTOP, autoFitToText=True, padBottom=12, text='Range includes active mining boosts, per module. Your ore filter always applies.')
            timerRow = Container(parent=main, align=C.TOTOP, height=34)
            EveLabelMedium(parent=timerRow, align=C.CENTERLEFT, text='Survey seconds')
            self.timerEdit = SingleLineEditInteger(parent=timerRow, align=C.TOPLEFT, left=145, width=100, setvalue=60, minValue=6, maxValue=86400, OnChange=self.Changed)
            EveLabelSmall(parent=timerRow, align=C.CENTERLEFT, left=260, text='Default 60 | Minimum 6')
            self.filterLabel = EveLabelMedium(parent=main, align=C.TOTOP, height=24, text='Resource filter: all compatible resources')
            EveLabelSmall(parent=main, align=C.TOTOP, autoFitToText=True, padBottom=8,
                          text=text('Select ore, ice or gas, then use > to add or < to remove.\nCtrl/Shift selects several. Ore names also match their named variants.'))
            footer = Container(parent=main, align=C.TOBOTTOM, height=64, padTop=8)
            self.notice = EveLabelSmall(parent=footer, align=C.TOTOP, height=28, maxLines=2, text='Changes are saved when you click Apply. Closing discards unsaved changes.')
            buttons = Container(parent=footer, align=C.TOALL)
            Button(parent=buttons, align=C.TOPLEFT, label='Apply settings', width=120, func=self.Apply)
            Button(parent=buttons, align=C.TOPLEFT, left=130, label='Reload', width=85, func=self.Reload)
            Button(parent=buttons, align=C.TOPRIGHT, label='Clear filter', width=100, func=self.ClearFilter)
            picker = Container(parent=main, align=C.TOALL)
            leftHalf = Container(parent=picker, align=C.TOLEFT_PROP, width=0.5)
            arrows = Container(parent=leftHalf, align=C.TORIGHT, width=52)
            arrowButtons = Container(parent=arrows, align=C.CENTER, width=42, height=78)
            Button(parent=arrowButtons, align=C.TOPLEFT, width=40, label=text('>'), hint='Add selected ores to the filter', func=self.AddOres)
            Button(parent=arrowButtons, align=C.TOPLEFT, top=42, width=40, label=text('<'), hint='Remove selected ores from the filter', func=self.RemoveOres)
            available = Container(parent=leftHalf, align=C.TOALL, padRight=6)
            selected = Container(parent=picker, align=C.TOALL)
            self.availableLabel = EveLabelMedium(parent=available, align=C.TOTOP, height=24, text='Available ores')
            self.selectedLabel = EveLabelMedium(parent=selected, align=C.TOTOP, height=24, text='Active filter')
            self.availableSearch = SingleLineEditText(parent=available, align=C.TOTOP, height=28, padBottom=6, hint='Search available ore, ice or gas', OnChange=self.Search)
            self.selectedSearch = SingleLineEditText(parent=selected, align=C.TOTOP, height=28, padBottom=6, hint='Search active filter', OnChange=self.Search)
            self.availableScroll = Scroll(parent=available, align=C.TOALL, multiSelect=True)
            self.selectedScroll = Scroll(parent=selected, align=C.TOALL, multiSelect=True)
            self._loading = False
            self.UpdatePriorityHint()
            _am_uthread.new(self.Refresh, True)
            _am_uthread.new(self.Poll)

        def ValidCharacter(self):
            if not globals().get('_am_is_active', lambda: True)():
                if not self.destroyed:
                    self.Close()
                return False
            if self.destroyed:
                return False
            if session.charid != self._character:
                self.Close()
                return False
            return True

        def Request(self, method, *args):
            if not self.ValidCharacter():
                raise RuntimeError('Character changed')
            response = _am_json.loads(getattr(sm.RemoteSvc('miningScanMgr'), method)(*args))
            if not self.ValidCharacter():
                raise RuntimeError('Character changed')
            if not response.get('success'):
                raise RuntimeError(response.get('message', 'AutoMining request failed'))
            return response

        def ShowResponse(self, response, replaceDraft=False):
            status = ('<b>ON</b> - ' if response['enabled'] else '<b>OFF</b> - ') + text(response['status'])
            if self.statusLabel.text != status:
                self.statusLabel.text = status
            if 'catalog' in response:
                self._catalog = dict((row['name'].lower(), row['name']) for row in response['catalog'])
            if not replaceDraft and (self._dirty or self._revision == response['revision']):
                return
            if replaceDraft or not self._dirty:
                self._loading = True
                prefs = response['settings']
                self._revision = response['revision']
                self._selected = set(prefs['ores'])
                for key, widget in self._toggles.items():
                    widget.SetChecked(prefs[key], report=False)
                self.orderEdit.SelectItemByValue(prefs['order'])
                self.timerEdit.SetValue(prefs['surveySeconds'], docallback=False)
                self._loading = False
                self._dirty = False
                self.UpdatePriorityHint()
                self.DrawLists()

        def Poll(self):
            while self.ValidCharacter():
                _am_blue.pyos.synchro.SleepWallclock(2500)
                if self.ValidCharacter() and not self._busy:
                    self.Refresh(False)

        def Refresh(self, replaceDraft=False):
            if self._busy or not self.ValidCharacter():
                return
            self._busy = True
            editSerial = self._editSerial
            try:
                response = self.Request('AutoMiningGetState', not bool(self._catalog))
                if self.ValidCharacter():
                    self.ShowResponse(response, replaceDraft and editSerial == self._editSerial)
                    if replaceDraft and editSerial == self._editSerial:
                        self.notice.text = 'Settings loaded. Choose your ores and click Apply.'
            except Exception as error:
                if self.ValidCharacter():
                    self.notice.text = text(error)
            finally:
                self._busy = False

        def Changed(self, *args):
            if not self._loading:
                self.UpdatePriorityHint()
                self._dirty = True
                self._editSerial += 1
                if hasattr(self, 'notice'):
                    self.notice.text = 'Unsaved changes. Click Apply, or Reload to discard.'

        def UpdatePriorityHint(self):
            if not hasattr(self, 'priorityHint'):
                return
            approach = bool(self._toggles['approach'].GetValue())
            order = self.orderEdit.GetValue()
            self.scopeLabel.text = 'Search area: ' + ('whole current belt' if approach else 'within mining range')
            priority = {'nearest': 'nearest to furthest', 'furthest': 'furthest to nearest',
                        'largest': 'largest to smallest remaining volume', 'smallest': 'smallest to largest remaining volume'}.get(order, 'nearest to furthest')
            description = 'Select matching asteroids from %s.\n' % priority
            description += ('Your ship may fly from one end of the current belt to the other to follow this order.' if approach
                            else 'The mod will not move your ship. Asteroids outside effective mining range are ignored.')
            if order in ('largest', 'smallest'):
                description += '\nVolume means remaining cubic metres, not ISK value.'
                description += '\nRequires an available Mining Surveyor or built-in equivalent. No scan required.'
            self.priorityHint.text = description

        def Search(self, *args):
            if hasattr(self, 'selectedScroll'):
                self.DrawLists()

        def DrawLists(self):
            if not hasattr(self, 'selectedScroll'):
                return
            available = [(key, label) for key, label in self._catalog.items() if key not in self._selected]
            active = [(key, self._catalog.get(key, key)) for key in self._selected]
            for rows, search, scroll in [(available, self.availableSearch, self.availableScroll), (active, self.selectedSearch, self.selectedScroll)]:
                query = search.GetValue().strip().lower()
                entries = [GetFromClass(Generic, {'label': text(label), 'oreKey': key})
                           for key, label in sorted(rows, key=lambda row: row[1].lower()) if query in label.lower()]
                scroll.Load(contentList=entries, noContentHint='No matching ores' if query else 'Empty - all compatible resources' if scroll is self.selectedScroll else 'No ores remaining')
            self.availableLabel.text = 'Available ore / ice / gas (%s)' % len(available)
            self.selectedLabel.text = 'Active filter (%s)' % len(active)
            self.filterLabel.text = 'Resource filter: %s' % ('%s selected' % len(active) if active else 'all compatible resources')

        def AddOres(self, *args):
            if self._busy:
                return
            self._selected.update(node.oreKey for node in self.availableScroll.GetSelected())
            self.Changed()
            self.DrawLists()

        def RemoveOres(self, *args):
            if self._busy:
                return
            self._selected.difference_update(node.oreKey for node in self.selectedScroll.GetSelected())
            self.Changed()
            self.DrawLists()

        def ClearFilter(self, *args):
            if not self._busy:
                self._selected.clear()
                self.Changed()
                self.DrawLists()

        def Save(self, start=False):
            if self._busy or not self.ValidCharacter():
                return
            if self._revision is None:
                self.notice.text = 'Wait for the settings to load, then try again.'
                return
            self._busy = True
            editSerial = self._editSerial
            try:
                prefs = dict((key, bool(widget.GetValue())) for key, widget in self._toggles.items())
                prefs.update(ores=sorted(self._selected), order=self.orderEdit.GetValue(), surveySeconds=self.timerEdit.GetValue())
                response = self.Request('AutoMiningSetSettings', _am_json.dumps({'settings': prefs, 'revision': self._revision}))
                editedDuringSave = editSerial != self._editSerial
                self.ShowResponse(response, not editedDuringSave)
                if editedDuringSave:
                    self._revision = response['revision']
                if start:
                    response = self.Request('AutoMiningControl', 'on')
                    self.ShowResponse(response)
                self.notice.text = 'Earlier changes saved. You have further unsaved changes.' if editedDuringSave else text(response.get('message', 'Settings saved.'))
            except Exception as error:
                if self.ValidCharacter():
                    self.notice.text = text(error)
            finally:
                self._busy = False

        def StopWork(self):
            if self._busy or not self.ValidCharacter():
                return
            self._busy = True
            try:
                response = self.Request('AutoMiningControl', 'off')
                self.ShowResponse(response)
                self.notice.text = text(response['message'])
            except Exception as error:
                if self.ValidCharacter():
                    self.notice.text = text(error)
            finally:
                self._busy = False

        def Apply(self, *args):
            _am_uthread.new(self.Save)

        def Start(self, *args):
            _am_uthread.new(self.Save, True)

        def Stop(self, *args):
            _am_uthread.new(self.StopWork)

        def Reload(self, *args):
            _am_uthread.new(self.Refresh, True)

    return AutoMiningWindow


def _am_open_hud(self):
    global _am_window_class
    try:
        if not getattr(session, 'charid', None):
            return
        if _am_window_class is None:
            _am_window_class = _am_build_window_class()
        _am_window_class.Open()
    except Exception:
        import log
        log.LogException('AutoMining settings window failed to open')
        from player_messaging.client.ui_message import message_player
        message_player('AutoMining could not open its settings. Restart the client through the Launcher after updating the mod.')


if 'OnAutoMiningOpen' not in EveCommandService.__notifyevents__:
    EveCommandService.__notifyevents__ = list(EveCommandService.__notifyevents__) + ['OnAutoMiningOpen']
    EveCommandService.OnAutoMiningOpen = _am_open_hud


def _am_feedback(self, message):
    from player_messaging.client.ui_message import message_player
    safe = unicode(message)[:1000].replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    message_player(safe)


if 'OnAutoMiningFeedback' not in EveCommandService.__notifyevents__:
    EveCommandService.__notifyevents__ = list(EveCommandService.__notifyevents__) + ['OnAutoMiningFeedback']
    EveCommandService.OnAutoMiningFeedback = _am_feedback
