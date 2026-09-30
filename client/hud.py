# AutoMining native settings window. Loaded lazily so UI import failures cannot
# interfere with the command service or the independent survey companion.
_am_window_class = None


def _am_build_window_class():
    from carbonui import uiconst as C
    from carbonui.control.window import Window
    from carbonui.control.button import Button
    from carbonui.control.checkbox import Checkbox
    from carbonui.control.combo import Combo
    from carbonui.control.tabGroup import TabGroup
    from carbonui.control.singlelineedits.singleLineEditText import SingleLineEditText
    from carbonui.control.singlelineedits.singleLineEditInteger import SingleLineEditInteger
    from carbonui.primitives.container import Container
    from carbonui.primitives.containerAutoSize import ContainerAutoSize
    from carbonui.primitives.fill import Fill
    from carbonui.primitives.frame import Frame
    from carbonui.primitives.sprite import Sprite
    try:
        from carbonui.control.scrollContainer import ScrollContainer
    except ImportError:
        ScrollContainer = Container
    from eve.client.script.ui.control.eveLabel import Label
    from eve.client.script.ui.control.eveScroll import Scroll
    from eve.client.script.ui.control.entries.generic import Generic
    from eve.client.script.ui.control.entries.util import GetFromClass
    from eve.client.script.ui.control.eveIcon import Icon

    def text(value):
        return unicode(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

    def station_search_key(value):
        # Bookmark links and the station cache can differ in spacing or dash
        # characters. NFKC also makes full-width Latin characters match.
        import unicodedata
        value = unicodedata.normalize('NFKC', unicode(value or '')).lower()
        return u' '.join(value.replace(u'\u2013', u'-').replace(u'\u2014', u'-').split())

    def button_width(label, minimum=70):
        # Native buttons keep their supplied width even when a translated
        # caption is longer. Reserve room for the 15px HUD font and the button
        # chrome; wide CJK glyphs need more room than Latin letters.
        import unicodedata
        caption = unicode(_am_tr(label))
        glyphs = sum(18 if unicodedata.east_asian_width(char) in ('W', 'F') else 10
                     for char in caption if not unicodedata.combining(char))
        return max(minimum, glyphs + 32)

    # Localize presentation only. Internal choice values and saved settings
    # remain stable when different clients use different languages.
    _NativeButton, _NativeCheckbox, _NativeCombo = Button, Checkbox, Combo
    _NativeTextEdit, _NativeIntegerEdit = SingleLineEditText, SingleLineEditInteger
    _NativeLabel = Label

    def _widget(factory, **kwargs):
        for key in ('text', 'label', 'hint', 'hintText'):
            if key in kwargs and isinstance(kwargs[key], (str, unicode)):
                kwargs[key] = _am_tr(kwargs[key])
        if 'options' in kwargs:
            kwargs['options'] = [(_am_tr(label), value) for label, value in kwargs['options']]
        try:
            return factory(**kwargs)
        except TypeError as error:
            # Older client labels may reject the font keyword. Keep the HUD
            # usable and apply the size through the exposed property if present.
            if 'fontsize' not in kwargs or 'fontsize' not in unicode(error):
                raise
            size = kwargs.pop('fontsize')
            widget = factory(**kwargs)
            if hasattr(widget, 'fontsize'):
                widget.fontsize = size
            return widget

    def Button(**kwargs):
        kwargs.setdefault('fontsize', 15)
        return _widget(_NativeButton, **kwargs)

    def Checkbox(**kwargs):
        kwargs.setdefault('fontsize', 15)
        return _widget(_NativeCheckbox, **kwargs)

    def Combo(**kwargs):
        kwargs.setdefault('fontsize', 15)
        return _widget(_NativeCombo, **kwargs)

    def SingleLineEditText(**kwargs):
        kwargs.setdefault('fontsize', 15)
        return _widget(_NativeTextEdit, **kwargs)

    def SingleLineEditInteger(**kwargs):
        kwargs.setdefault('fontsize', 15)
        return _widget(_NativeIntegerEdit, **kwargs)

    def EveLabelMedium(**kwargs):
        kwargs.setdefault('fontsize', 16)
        # EveStyleLabel resets custom sizes and emits a traceback on every
        # refresh. Native Label supports the HUD's explicit readable sizes.
        return _widget(_NativeLabel, **kwargs)

    def EveLabelSmall(**kwargs):
        kwargs.setdefault('fontsize', 15)
        return _widget(_NativeLabel, **kwargs)

    def Section(parent, text, **kwargs):
        bar = Container(parent=parent, align=C.TOTOP, height=36, padTop=6, padBottom=5)
        Fill(bgParent=bar, align=C.TOTOP, height=1, color=(0.75, 0.82, 0.85, 0.25), state=C.UI_DISABLED)
        return EveLabelMedium(parent=bar, align=C.CENTERLEFT, left=4, text=text,
                              color=(0.86, 0.91, 0.93, 1.0), state=C.UI_DISABLED)

    def stop_motion(widget):
        try:
            widget.StopAnimations()
        except Exception:
            pass

    def fade(widget, start, end, duration=0.26, offset=0.0):
        stop_motion(widget)
        # Always establish the final state before requesting optional motion.
        # A missing/broken animation API must not leave controls invisible.
        widget.opacity = end
        try:
            from carbonui.uianimations import animations
            animations.FadeTo(widget, startVal=start, endVal=end, duration=duration, timeOffset=offset)
        except Exception:
            widget.opacity = end

    def morph(widget, attribute, start, end, duration=0.2):
        setattr(widget, attribute, end)
        try:
            from carbonui.uianimations import animations
            animations.MorphScalar(widget, attribute, start, end, duration=duration)
        except Exception:
            setattr(widget, attribute, end)

    class ResourcePicker(ScrollContainer):
        """Native icon tiles with the existing ore selection/order interface."""
        def __init__(self, window, active=False, **kwargs):
            self.window, self.active = window, active
            ScrollContainer.__init__(self, **kwargs)
            self.entries, self.selected, self.loads, self.tiles = [], [], 0, []
            self.signature, self.records, self.chosen = None, {}, set()
            self.hintLabel = None
            self.rows = ContainerAutoSize(parent=self, align=C.TOTOP, alignMode=C.TOTOP)

        def GetSelected(self):
            return self.selected

        def Click(self, node):
            if self.window._busy:
                return
            if not self.active:
                if node.oreKey in self.window._selected:
                    self.window.RemoveOreKeys([node.oreKey])
                else:
                    self.window.AddOreKeys([node.oreKey])
                return
            self.selected = [node]
            for tile, background, item in self.tiles:
                background.color = (0.15, 0.23, 0.27, 0.95) if item is node else (0.07, 0.11, 0.13, 0.8)

        def Callback(self, node, double=False):
            if double:
                if self.active:
                    return lambda *args: self.window.RemoveOreKeys([node.oreKey])
                # Native input sends OnClick before OnDblClick. Do not undo
                # the first click's selection when somebody double-clicks.
                return lambda *args: None
            return lambda *args: self.Click(node)

        def Load(self, contentList, noContentHint):
            previous = [item[0] for item in self.signature] if self.signature is not None else []
            picked = set(node.oreKey for node in self.selected) if self.active else set()
            self.entries = list(contentList)
            self.selected = [node for node in self.entries if node.oreKey in picked]
            self.loads += 1
            # Keep data ready for settings/search, but do not request hundreds
            # of native icons while opening an unrelated job page.
            if self.window._page != 'filter':
                return
            signature = [(node.oreKey, node.label, getattr(node, 'typeID', 0), getattr(node, 'volume', None)) for node in self.entries]
            chosenKeys = set(self.window._selected)
            if not self.active and signature == self.signature:
                for key in self.chosen.symmetric_difference(chosenKeys):
                    record = self.records.get(key)
                    if record:
                        record['background'].color = (0.12, 0.19, 0.22, 0.9) if key in chosenKeys else (0.07, 0.11, 0.13, 0.8)
                        record['stroke'].opacity = 0.55 if key in chosenKeys else 0.18
                        if key in chosenKeys and record['tick'] is None:
                            record['tick'] = self.CheckMark(record['tile'])
                        if record['tick']:
                            record['tick'].state = C.UI_DISABLED if key in chosenKeys else C.UI_HIDDEN
                self.chosen = chosenKeys
                return
            if not self.active:
                self.rows.Flush()
                self.records = {}
                self.hintLabel = None
            else:
                remaining = set(node.oreKey for node in self.entries)
                for key in list(self.records):
                    if key not in remaining:
                        self.records.pop(key)['row'].Close()
                if self.hintLabel:
                    self.hintLabel.Close()
                    self.hintLabel = None
            self.signature, self.chosen, self.tiles = signature, chosenKeys, []
            if not self.entries:
                self.hintLabel = EveLabelSmall(parent=self.rows, align=C.TOTOP, autoFitToText=True,
                    padding=(12, 18, 12, 12), text=noContentHint, color=(0.57, 0.64, 0.68, 1))
                return
            columns = 1 if self.active else 2
            for offset in range(0, len(self.entries), columns):
                if self.active and self.entries[offset].oreKey in self.records:
                    node = self.entries[offset]
                    record = self.records[node.oreKey]
                    record['row'].SetOrder(offset)
                    record['caption'].text = node.label
                    record['tile'].OnClick = self.Callback(node)
                    record['tile'].OnDblClick = self.Callback(node, double=True)
                    record['background'].color = (0.15, 0.23, 0.27, 0.95) if node.oreKey in picked else (0.07, 0.11, 0.13, 0.8)
                    self.tiles.append((record['tile'], record['background'], node))
                    if offset >= len(previous) or previous[offset] != node.oreKey:
                        record['tile'].left = 0
                        fade(record['tile'], 0.3, 1.0, duration=0.23)
                    continue
                row = Container(parent=self.rows, align=C.TOTOP, height=76 if self.active else 68, padBottom=7)
                if self.active:
                    row.SetOrder(offset)
                for index, node in enumerate(self.entries[offset:offset + columns]):
                    tile = Container(parent=row, align=C.TOALL if self.active or index else C.TOLEFT_PROP,
                        width=0 if self.active or index else 0.5, padRight=8 if not self.active and index == 0 else 0,
                        state=C.UI_NORMAL, hint=node.label, clipChildren=True)
                    chosen = node.oreKey in self.window._selected
                    color = ((0.15, 0.23, 0.27, 0.95) if node.oreKey in picked else (0.07, 0.11, 0.13, 0.8)) if self.active else (
                        (0.12, 0.19, 0.22, 0.9) if chosen else (0.07, 0.11, 0.13, 0.8))
                    background = Fill(bgParent=tile, color=color, state=C.UI_DISABLED)
                    stroke = Frame(parent=tile, texturePath='res:/UI/Texture/Shared/DarkStyle/panel2Corner_Stroke.png',
                        cornerSize=9, color=(0.51, 0.72, 0.75, 1), opacity=0.55 if chosen else 0.18, state=C.UI_DISABLED)
                    typeID = getattr(node, 'typeID', 0)
                    if typeID:
                        try:
                            Icon(parent=tile, align=C.CENTERLEFT, left=10, size=40, typeID=typeID,
                                ignoreSize=True, state=C.UI_DISABLED)
                        except Exception:
                            # An unfamiliar server type must not blank the picker.
                            pass
                    caption = node.label
                    if not self.active and getattr(node, 'volume', None) is not None:
                        caption += '<br><color=#ff859aa4><fontsize=12>' + _am_tr('%.2f m3 / unit', node.volume) + '</fontsize></color>'
                    captionLabel = EveLabelMedium(parent=tile, align=C.TOALL, padding=(58 if typeID else 12, 9, 27, 5),
                        fontsize=15 if self.active else 16, maxLines=3, text=caption,
                        color=(0.82, 0.88, 0.91, 1), state=C.UI_DISABLED)
                    tickLabel = None
                    if chosen and not self.active:
                        tickLabel = self.CheckMark(tile)
                    tile.OnClick = self.Callback(node)
                    tile.OnDblClick = self.Callback(node, double=True)
                    self.tiles.append((tile, background, node))
                    self.records[node.oreKey] = dict(row=row, tile=tile, background=background,
                        stroke=stroke, tick=tickLabel, caption=captionLabel)
                    position = offset + index
                    if self.active and (position >= len(previous) or previous[position] != node.oreKey):
                        fade(tile, 0.3, 1.0, duration=0.23)
                        morph(tile, 'left', 8, 0, duration=0.23)

        def CheckMark(self, tile):
            tick = u'\u2713'
            return EveLabelSmall(parent=tile, align=C.CENTERRIGHT, left=10, text=tick,
                color=(0.62, 0.82, 0.82, 1), state=C.UI_DISABLED)

    class DestinationContext(object):
        def __init__(self, window, context):
            object.__setattr__(self, 'window', window)
            object.__setattr__(self, 'context', context)
        def __getattr__(self, name):
            return getattr(self.window, self.Name(name))
        def __setattr__(self, name, value):
            setattr(self.window, self.Name(name), value)
        def Name(self, name):
            if name.startswith('_'):
                return '_' + self.context + name[1:2].upper() + name[2:]
            return self.context + name[:1].upper() + name[1:]

    class Navigation(object):
        def __init__(self, window, parent):
            self.window, self.parent, self.tabs, self.buttons = window, parent, [], []
            self.labels, self.backgrounds = [], []
            self.order = [9, 0, 1, 2, 3, 6, 8, 5, 10, 11, 4, 7]
            self._layoutToken = None
            self.parent._OnSizeChange_NoBlock = self.Layout

        def SelectCallback(self, index):
            # Native input callbacks can supply the control or mouse event.
            # Capture the page in a separate closure, never a default argument
            # that a Button/control argument can overwrite.
            return lambda *args: self.SelectByIdx(index)

        def Startup(self, tabs, **kwargs):
            self.tabs = tabs
            self.buttons, self.labels, self.backgrounds = [None] * len(tabs), [None] * len(tabs), [None] * len(tabs)
            for index in self.order:
                label, panel, unused, key = tabs[index]
                row = Container(parent=self.parent, align=C.TOPLEFT, height=38,
                                state=C.UI_HIDDEN, hint=label)
                row.OnClick = self.SelectCallback(index)
                background = Fill(bgParent=row, color=(0.12, 0.19, 0.22, 0.0), state=C.UI_DISABLED)
                marker = Fill(parent=row, align=C.TOBOTTOM, height=1,
                              color=(0.57, 0.78, 0.82, 0.0), state=C.UI_DISABLED)
                caption = EveLabelMedium(parent=row, align=C.CENTERLEFT, left=12,
                    text=label, fontsize=16, color=(0.64, 0.71, 0.75, 1), state=C.UI_DISABLED)
                row.OnMouseEnter = self.HoverCallback(index, True)
                row.OnMouseExit = self.HoverCallback(index, False)
                self.buttons[index] = (row, marker)
                self.labels[index] = caption
                self.backgrounds[index] = background
            self.marker = Fill(parent=self.parent, align=C.TOPLEFT, height=2, width=50,
                color=(0.73, 0.92, 0.94, 1), state=C.UI_DISABLED)
            self.Layout()
            self.SelectByIdx(9, animate=False)

        def HoverCallback(self, index, inside):
            return lambda *args: self.Hover(index, inside)

        def Hover(self, index, inside):
            self.labels[index].color = (0.93, 0.97, 0.98, 1) if inside or index == self.index else (0.64, 0.71, 0.75, 1)

        def Layout(self, width=None, height=None):
            if not self.buttons or not hasattr(self, 'marker'):
                return
            if not width:
                try:
                    width = self.parent.GetAbsoluteSize()[0]
                except Exception:
                    width = getattr(self.window, 'width', self.window.default_width) - 40
            width = max(300, int(width) - 16)
            allowed = self.window.JobPages()
            token = (width, tuple(sorted(allowed)))
            if token == self._layoutToken:
                return
            self._layoutToken = token
            left, top = 8, 0
            for index in self.order:
                row, unused = self.buttons[index]
                if index not in allowed:
                    continue
                labelWidth = getattr(self.labels[index], 'textwidth', 0)
                rowWidth = max(64, int(labelWidth) + 24 if labelWidth else button_width(self.tabs[index][0], 64) - 8)
                rowWidth = min(rowWidth, width - 16)
                if left > 8 and left + rowWidth > width:
                    left, top = 8, top + 38
                row.left, row.top, row.width = left, top, rowWidth
                left += rowWidth + 4
            self.parent.height = top + 40
            if hasattr(self, 'index'):
                self.MoveMarker(False)

        def MoveMarker(self, animate):
            row = self.buttons[self.index][0]
            target = {'left': row.left + 6, 'top': row.top + 37, 'width': max(20, row.width - 12)}
            stop_motion(self.marker)
            for attribute, end in target.items():
                start = getattr(self.marker, attribute, end)
                if animate:
                    morph(self.marker, attribute, start, end)
                else:
                    setattr(self.marker, attribute, end)

        def SelectByIdx(self, index, animate=True):
            # Validate before hiding anything. Bad input must leave the active
            # page visible rather than turning the whole window blank.
            if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(self.tabs):
                return
            if index not in self.window.JobPages():
                return
            changed = getattr(self, 'index', None) != index
            self.index = index
            for i, item in enumerate(self.tabs):
                stop_motion(item[1])
                item[1].opacity, item[1].top = 1.0, 0
                item[1].state = C.UI_NORMAL if i == index else C.UI_HIDDEN
                self.buttons[i][1].color = (0.57, 0.78, 0.82, 0.3 if i == index else 0.0)
                self.backgrounds[i].color = (0.12, 0.19, 0.22, 0.3 if i == index else 0.0)
                self.labels[i].color = (0.92, 0.97, 0.98, 1.0) if i == index else (0.64, 0.71, 0.75, 1.0)
            self.Layout()
            self.MoveMarker(animate and changed)
            if changed and animate:
                panel = self.tabs[index][1]
                fade(panel, 0.3, 1.0)
                morph(panel, 'top', 12, 0, duration=0.26)
            self.window._page = self.tabs[index][3]
            if hasattr(self.window, 'pageBreadcrumb'):
                self.window.pageBreadcrumb.text = 'AutoMining / ' + self.tabs[index][0]
            if self.window._page == 'statistics':
                _am_uthread.new(self.window.StatisticsWork)
            elif self.window._page == 'filter':
                self.window.DrawLists()

    class AutoMiningWindow(Window):
        default_windowID = 'EveJSAutoMiningSettings'
        default_caption = 'AutoMining'
        default_width = 1200
        default_height = 820
        default_minSize = (1040, 740)
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
            self._catalogTypes = {}
            self._catalogVolumes = {}
            self._availableCacheToken = None
            self._availableCacheEntries = []
            self._selected = []
            self._stationID = 0
            self._stationResult = None
            self._stationRows = []
            self._localizedStationLanguage = None
            self._localizedStationNames = []
            self._stationOperationIDs = None
            self._destinationSerial = 0
            self._droneGroups = []
            self._fuelStationID = 0
            self._fuelStationResult = None
            self._fuelStationRows = []
            self._fuelDestinationSerial = 0
            self._transportStationID = 0
            self._transportStationResult = None
            self._transportStationRows = []
            self._transportDestinationSerial = 0
            self._shipRole = 'boosting'
            self._transportRevision = None
            self._page = 'jobs'
            self._job = 'mining'
            self._jobChosen = False
            self._savedJob = 'mining'
            self._jobDrafts = {}
            self._lastResponse = None
            self._jobPreviewSerial = 0
            self._enabled = False
            self._pveBeltID = 0
            self._pveBelt = None
            self._fleetView = {}
            self._fleetRosterDraft = set()
            self._fleetRosterDirty = False
            self._fleetRosterToken = None
            self._fleetGroupID = ''
            self._statsRevision = None
            self._statsTicks = 0
            self._statsSessions = False
            self._statsOffset = 0
            self._industrialModules = []
            self._intervalDraft = {'core': {}, 'compressor': {}}
            Window.ApplyAttributes(self, attributes)
            self.SetCaption(_am_tr('AutoMining'))
            main = self.content
            Fill(bgParent=main, color=(0.025, 0.035, 0.04, 0.88), state=C.UI_DISABLED)
            navigation = Container(parent=main, align=C.TOTOP, height=40, padBottom=8)
            Fill(bgParent=navigation, align=C.TOBOTTOM, height=1, color=(0.75, 0.82, 0.85, 0.14), state=C.UI_DISABLED)
            self.tabs = Navigation(self, navigation)
            self.statusLabel = EveLabelMedium(parent=main, align=C.TOTOP, autoFitToText=True,
                padding=(18, 3, 18, 8), text='Connecting to AutoMining...')
            actionRow = Container(parent=main, align=C.TOTOP, height=34)
            startWidth = button_width('Start / Resume')
            stopWidth = button_width('Stop')
            Button(parent=actionRow, align=C.TOPRIGHT, left=stopWidth + 26, width=startWidth, label='Start / Resume', func=self.Start)
            Button(parent=actionRow, align=C.TOPRIGHT, left=18,
                   width=stopWidth, label='Stop', func=self.Stop)
            self.stopFleetButton = Button(parent=actionRow, align=C.TOPRIGHT,
                left=startWidth + stopWidth + 34, width=button_width('Stop fleet AutoMining'), label='Stop fleet AutoMining',
                state=C.UI_HIDDEN, func=self.StopFleet)
            EveLabelSmall(parent=actionRow, align=C.CENTERLEFT, left=18,
                          text='On / Off is saved per character', color=(0.58, 0.65, 0.68, 1))
            shared = main
            searchRow = Container(parent=shared, align=C.TOTOP, height=46, padTop=8, padBottom=8)
            self.pageBreadcrumb = EveLabelSmall(parent=searchRow, align=C.CENTERLEFT, left=18,
                text='AutoMining', color=(0.65, 0.75, 0.79, 1))
            self.settingSearch = SingleLineEditText(parent=searchRow, align=C.TOPRIGHT, left=18, width=260, height=30,
                hint='Find a setting...', hintText='Find a setting...', OnChange=self.FindSetting)
            self.settingResults = Scroll(parent=shared, align=C.TOTOP, height=90, state=C.UI_HIDDEN, multiSelect=False)
            footer = ContainerAutoSize(parent=shared, align=C.TOBOTTOM, alignMode=C.TOTOP, padTop=8, padBottom=8)
            Fill(bgParent=footer, align=C.TOTOP, height=1, color=(0.75, 0.82, 0.85, 0.14), state=C.UI_DISABLED)
            self.notice = EveLabelSmall(parent=footer, align=C.TOTOP, autoFitToText=True, maxLines=3, padding=(18, 4, 18, 8),
                                        text='Apply saves changes in all tabs. Switching tabs keeps unsaved changes.',
                                        hint='Apply saves changes in all tabs. Switching tabs keeps unsaved changes.')
            buttons = Container(parent=footer, align=C.TOTOP, height=34)
            applyWidth = button_width('Apply settings')
            Button(parent=buttons, align=C.TOPRIGHT, left=18, label='Apply settings', width=applyWidth, func=self.Apply)
            Button(parent=buttons, align=C.TOPRIGHT, left=applyWidth + 26,
                   label='Reload', width=button_width('Reload'), func=self.Reload)
            body = Container(parent=shared, align=C.TOALL, padding=(28, 10, 28, 12))
            panels = Container(parent=body, align=C.TOALL)
            self.searchHighlight = EveLabelSmall(parent=panels, align=C.TOTOP, height=0, text='', color=(0.61, 0.81, 0.86, 1))
            panels = Container(parent=panels, align=C.TOALL)
            miningTab = ScrollContainer(parent=panels, align=C.TOALL)
            miningPanel = miningTab
            miningDronesTab = ScrollContainer(parent=panels, align=C.TOALL, state=C.UI_HIDDEN)
            miningDronesPanel = miningDronesTab
            filterPanel = Container(parent=panels, align=C.TOALL, state=C.UI_HIDDEN)
            returnTab = ScrollContainer(parent=panels, align=C.TOALL, state=C.UI_HIDDEN)
            returnPanel = returnTab
            dronesTab = ScrollContainer(parent=panels, align=C.TOALL, state=C.UI_HIDDEN)
            dronesPanel = dronesTab

            defenseTab = ScrollContainer(parent=panels, align=C.TOALL, state=C.UI_HIDDEN)
            defensePanel = defenseTab
            boostersTab = ScrollContainer(parent=panels, align=C.TOALL, state=C.UI_HIDDEN)
            boostersPanel = boostersTab
            statisticsTab = ScrollContainer(parent=panels, align=C.TOALL, state=C.UI_HIDDEN)
            transportTab = ScrollContainer(parent=panels, align=C.TOALL, state=C.UI_HIDDEN)
            jobsTab = ScrollContainer(parent=panels, align=C.TOALL, state=C.UI_HIDDEN)
            pveTab = ScrollContainer(parent=panels, align=C.TOALL, state=C.UI_HIDDEN)
            fleetTab = ScrollContainer(parent=panels, align=C.TOALL, state=C.UI_HIDDEN)
            main = miningPanel
            filterActions = Container(parent=filterPanel, align=C.TOBOTTOM, height=42, padTop=6)
            moveUpWidth = button_width('Move up')
            Button(parent=filterActions, align=C.TOPLEFT, label='Move up', width=moveUpWidth, func=self.MoveOreUp)
            Button(parent=filterActions, align=C.TOPLEFT, left=moveUpWidth + 8,
                   label='Move down', width=button_width('Move down'), func=self.MoveOreDown)
            Button(parent=filterActions, align=C.TOPRIGHT, label='Clear filter',
                   width=button_width('Clear filter'), func=self.ClearFilter)
            Section(parent=returnPanel, text='Ore handling')
            self.oreModeEdit = Combo(parent=returnPanel, align=C.TOTOP,
                options=[('Leave aboard', 'leave'), ('Jettison ore', 'jettison'), ('Unload and return to mining', 'unload'), ('Request fleet pickup', 'pickup'), ("Put into booster's fleet hangar", 'fleetHangar')], select='leave', callback=self.Changed)
            self.fleetHangarHint = EveLabelSmall(parent=returnPanel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                state=C.UI_HIDDEN, text='Requires Receive fleet ore, the same fleet, hangar access and 2500 m range. The booster chooses which ore to accept.')
            self.mineFleetOreStatus = EveLabelSmall(parent=returnPanel, align=C.TOTOP, autoFitToText=True,
                padBottom=8, state=C.UI_HIDDEN, text='')
            self.pickupStyle = Combo(parent=returnPanel, align=C.TOTOP, options=[('Jettison a bin and let the hauler approach', 'binFirst'), ('Keep ore aboard until the hauler arrives', 'onArrival')], select='binFirst', callback=self.Changed)
            self.jettisonAbandon = Checkbox(parent=returnPanel, align=C.TOTOP, height=32,
                text='Abandon jetcan', checked=False, callback=self.Changed)
            EveLabelSmall(parent=returnPanel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='Abandoning opens the can to other pilots and compatible NPC collectors.')
            Button(parent=returnPanel, align=C.TOTOP, height=30, label='Jettison now', func=self.JettisonNow)
            EveLabelSmall(parent=returnPanel, align=C.TOTOP, autoFitToText=True, padBottom=12,
                text='Jettison now uses saved settings. Apply changes first.')
            self.requestPickupButton = Button(parent=returnPanel, align=C.TOTOP, height=30,
                label='Request pickup now', state=C.UI_DISABLED, func=self.RequestPickup)
            self.requestPickupHint = EveLabelSmall(parent=returnPanel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='Select Fleet pickup and apply settings before requesting pickup.')
            self.stackOreHold = Checkbox(parent=returnPanel, align=C.TOTOP, height=32,
                text='Auto-stack ore hold', checked=True, callback=self.Changed)
            self.stackFleetHangar = Checkbox(parent=returnPanel, align=C.TOTOP, height=32,
                text='Auto-stack fleet hangar', checked=True, callback=self.Changed)
            self.oreThresholdTitle = EveLabelMedium(parent=returnPanel, align=C.TOTOP, autoFitToText=True, text='Ore hold trigger')
            self.oreThresholdRow = Container(parent=returnPanel, align=C.TOTOP, height=34)
            self.haulThresholdEdit = SingleLineEditInteger(parent=self.oreThresholdRow, align=C.TOPLEFT, width=70,
                                                            setvalue=95, minValue=1, maxValue=100, OnChange=self.Changed)
            EveLabelSmall(parent=self.oreThresholdRow, align=C.CENTERLEFT, left=80, text='% full (default 95)')
            self.oreThresholdHelp = EveLabelSmall(parent=returnPanel, align=C.TOTOP, autoFitToText=True, padBottom=14,
                          text='At the trigger, follow the selected ore handling mode.')
            Button(parent=returnPanel, align=C.TOTOP, label='Choose station and storage', func=self.OpenDestination)
            Section(parent=defensePanel, text='Retreat and mining unload destination')
            EveLabelMedium(parent=defensePanel, align=C.TOTOP, height=24, text='Destination station')
            searchRow = Container(parent=defensePanel, align=C.TOTOP, height=34)
            findWidth = button_width('Find')
            Button(parent=searchRow, align=C.TOPRIGHT, width=findWidth, label='Find', func=self.FindStations)
            self.stationEdit = SingleLineEditText(parent=searchRow, align=C.TOTOP, padRight=findWidth + 10, height=28,
                                                  hint='Paste a station name; search covers all regions', OnChange=self.StationChanged, OnReturn=self.FindStations)
            stationActions = Container(parent=defensePanel, align=C.TOTOP, height=38, padTop=6)
            Button(parent=stationActions, align=C.TOPLEFT, width=button_width('Use current station'),
                   label='Use current station', func=self.UseCurrentStation)
            self.stationDetails = EveLabelSmall(parent=defensePanel, align=C.TOTOP, autoFitToText=True, padBottom=8, text='No station selected.')
            self.stationResults = Scroll(parent=defensePanel, align=C.TOTOP, height=120, multiSelect=False)
            self.stationResults.Load(contentList=[], noContentHint=_am_tr('Find a station, then select the matching result.'))
            EveLabelMedium(parent=defensePanel, align=C.TOTOP, height=28, padTop=10, text='Unload into')
            self.storageEdit = Combo(parent=defensePanel, align=C.TOTOP, options=[('Select a station first', '')], select='', callback=self.Changed)
            storageRow = Container(parent=defensePanel, align=C.TOTOP, height=40, padTop=8)
            Button(parent=storageRow, align=C.TOPLEFT, label='Refresh storage', func=self.RefreshStorages)
            EveLabelSmall(parent=defensePanel, align=C.TOTOP, autoFitToText=True, padBottom=14,
                          text='Personal hangar, your containers, or accessible corporation divisions.\nIf unloading fails, the ship stays docked.')
            self.holdLabel = EveLabelMedium(parent=defensePanel, align=C.TOTOP, height=28, text='Ore hold: waiting for ship data')
            self.returnStatus = EveLabelMedium(parent=returnPanel, align=C.TOTOP, autoFitToText=True, padBottom=8, text='Automatic hauling is off.')
            EveLabelSmall(parent=returnPanel, align=C.TOTOP, autoFitToText=True, padBottom=12,
                          text='Autopilot follows your route settings. Manual travel cancels the trip.')
            cancelRow = Container(parent=returnPanel, align=C.TOTOP, height=34)
            self.cancelReturn = Button(parent=cancelRow, align=C.TOPLEFT, label='Cancel return', func=self.CancelReturn)
            self._toggles = {}
            Section(parent=miningDronesPanel, text='Automatic mining drone orders')
            self._toggles['mineDrones'] = Checkbox(parent=miningDronesPanel, align=C.TOTOP, height=32,
                text='Make launched mining drones mine automatically', checked=False, callback=self.Changed)
            EveLabelSmall(parent=miningDronesPanel, align=C.TOTOP, autoFitToText=True, padBottom=14,
                text='Uses the Mining Filter. An empty filter allows all ore.\nOnly drones launched by AutoMining receive mining orders.')
            EveLabelMedium(parent=miningDronesPanel, align=C.TOTOP, height=26, text='Drone target priority')
            self.mineDroneOrderEdit = Combo(parent=miningDronesPanel, align=C.TOTOP,
                options=[('Nearest first', 'nearest'), ('Furthest first', 'furthest'), ('Largest volume first', 'largest'), ('Smallest volume first', 'smallest')],
                select='nearest', callback=self.Changed)
            EveLabelSmall(parent=miningDronesPanel, align=C.TOTOP, autoFitToText=True, padBottom=12,
                text='Filter order and highest grade first; this priority breaks ties.\nVolume means remaining cubic metres.')
            EveLabelMedium(parent=miningDronesPanel, align=C.TOTOP, height=26, text='Drone targeting mode')
            self.mineDroneModeEdit = Combo(parent=miningDronesPanel, align=C.TOTOP,
                options=[('Spread: separate asteroids when possible', 'spread'), ('Focus: same best asteroid', 'focus')],
                select='spread', callback=self.Changed)
            EveLabelSmall(parent=miningDronesPanel, align=C.TOTOP, autoFitToText=True, padBottom=14,
                text='Mining orders are optional. Drone launch is configured in Drones.')
            self.mineDroneStatus = EveLabelMedium(parent=miningDronesPanel, align=C.TOTOP, autoFitToText=True,
                text='Automatic mining orders are off.')
            self._droneArrivalPanel = ContainerAutoSize(parent=dronesPanel, align=C.TOTOP)
            self._pveDronePanel = ContainerAutoSize(parent=dronesPanel, align=C.TOTOP)
            Section(parent=self._droneArrivalPanel, text='At the mining site')
            self._toggles['launchDrones'] = Checkbox(parent=self._droneArrivalPanel, align=C.TOTOP, height=32,
                text='Launch drones on arrival', checked=False, callback=self.Changed,
                hint='Launch the selected group on arrival at a mining location while AutoMining is on, or when you click Start / Resume there.')
            EveLabelSmall(parent=self._droneArrivalPanel, align=C.TOTOP, autoFitToText=True, padBottom=14,
                text='Choose an existing drone group, such as Fighters or Miners.')
            EveLabelMedium(parent=self._droneArrivalPanel, align=C.TOTOP, height=26, text='Drone group to launch')
            self.droneGroupEdit = Combo(parent=self._droneArrivalPanel, align=C.TOTOP, options=[('Choose a drone group', '')], select='', callback=self.Changed)
            droneButtons = Container(parent=self._droneArrivalPanel, align=C.TOTOP, height=42, padTop=8)
            Button(parent=droneButtons, align=C.TOPLEFT, label='Refresh groups', func=self.RefreshDroneGroups)
            Section(parent=dronesPanel, text='Before travel')
            self._toggles['recallDrones'] = Checkbox(parent=dronesPanel, align=C.TOTOP, height=32,
                text='Recall drones before warp / dock', checked=True, callback=self.Changed,
                hint='Wait for controlled drones to reach the bay before manual warp/dock or hauling departure. Works while mining is off. Stop cancels a pending departure.')
            EveLabelSmall(parent=dronesPanel, align=C.TOTOP, autoFitToText=True, padBottom=14,
                text='Wait for mining and combat drones to reach the bay, then continue travel.\nFleet warp waits for the members too.')
            self.droneStatus = EveLabelMedium(parent=self._droneArrivalPanel, align=C.TOTOP, autoFitToText=True, text='Automatic launch is off.')
            self._droneRatPanel = ContainerAutoSize(parent=dronesPanel, align=C.TOTOP)
            Section(parent=self._droneRatPanel, text='Rat response')
            self._toggles['ratDefenseEnabled'] = Checkbox(parent=self._droneRatPanel, align=C.TOTOP, height=32,
                text='Rats detected: switch to fighter drones', checked=False, callback=self.Changed,
                hint='Recall the selected mining group, launch the selected fighter group, then restore miners after rats leave the grid.')
            EveLabelSmall(parent=self._droneRatPanel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='The selected fighter group returns afterward, unless it is your standard arrival group.')
            EveLabelMedium(parent=self._droneRatPanel, align=C.TOTOP, height=24, text='Mining group to recall / restore')
            self.ratMiningGroupEdit = Combo(parent=self._droneRatPanel, align=C.TOTOP, options=[('Choose a mining group', '')], select='', callback=self.Changed)
            EveLabelMedium(parent=self._droneRatPanel, align=C.TOTOP, height=24, text='Fighter group to launch')
            self.ratFighterGroupEdit = Combo(parent=self._droneRatPanel, align=C.TOTOP, options=[('Choose a fighter group', '')], select='', callback=self.Changed)
            self.ratStatus = EveLabelSmall(parent=self._droneRatPanel, align=C.TOTOP, autoFitToText=True, padTop=8, text='Rat response is off.')
            Section(parent=defensePanel, text='Emergency retreat')
            self._toggles['defenseEnabled'] = Checkbox(parent=defensePanel, align=C.TOTOP, height=34,
                text='Retreat to station when ship health is low', checked=False, callback=self.Changed)
            EveLabelSmall(parent=defensePanel, align=C.TOTOP, autoFitToText=True, padBottom=16,
                text='Uses the destination and storage selected in Ore handling. After unloading, AutoMining stays off.')
            self._toggles['defenseShieldEnabled'] = Checkbox(parent=defensePanel, align=C.TOTOP, height=34,
                text='Watch shield', checked=True, callback=self.Changed)
            EveLabelMedium(parent=defensePanel, align=C.TOTOP, autoFitToText=True, text='Shield at or below (%)')
            shieldRow = Container(parent=defensePanel, align=C.TOTOP, height=34)
            self.defenseShieldEdit = SingleLineEditInteger(parent=shieldRow, align=C.TOPLEFT,
                width=100, setvalue=30, minValue=1, maxValue=100, OnChange=self.Changed)
            EveLabelSmall(parent=defensePanel, align=C.TOTOP, autoFitToText=True, padBottom=16,
                text='Shield retreat waits for drones while shield remains; it warps when shield is gone or armor takes damage.')
            self._toggles['defenseArmorEnabled'] = Checkbox(parent=defensePanel, align=C.TOTOP, height=34,
                text='Watch armor', checked=False, callback=self.Changed)
            EveLabelMedium(parent=defensePanel, align=C.TOTOP, autoFitToText=True, text='Armor at or below (%)')
            armorRow = Container(parent=defensePanel, align=C.TOTOP, height=34)
            self.defenseArmorEdit = SingleLineEditInteger(parent=armorRow, align=C.TOPLEFT,
                width=100, setvalue=30, minValue=1, maxValue=100, OnChange=self.Changed)
            EveLabelSmall(parent=defensePanel, align=C.TOTOP, autoFitToText=True, padBottom=16,
                text='Armor retreat orders drones home and warps immediately. Drones still outside may be left behind.')
            self.defenseStatus = EveLabelMedium(parent=defensePanel, align=C.TOTOP, autoFitToText=True,
                text='Defense is off.')
            Section(parent=boostersPanel, text='Mining fleet boosts')
            self._toggles['autoBoost'] = Checkbox(parent=boostersPanel, align=C.TOTOP, height=34,
                text='Activate online mining command bursts', checked=False, callback=self.Changed,
                hint='Works on boosting ships without mining lasers. Requires fitted, online mining command burst modules and their charges.')
            self._toggles['inviteFleet'] = Checkbox(parent=boostersPanel, align=C.TOTOP, height=34,
                text='Invite nearby AutoMining pilots to fleet', checked=False, callback=self.Changed,
                hint='Invite and automatically accept AutoMining pilots on the same grid after undocking, before warping to the mining site.')
            EveLabelSmall(parent=boostersPanel, align=C.TOTOP, autoFitToText=True, padBottom=14,
                text='Configure fleet membership on the Fleet page. Mining boosts begin 5 seconds after arrival.')
            self.boostStatus = EveLabelMedium(parent=boostersPanel, align=C.TOTOP, autoFitToText=True, text='Automatic mining boosts are off.')
            Section(parent=main, text='Targeting')
            for pairs in [(('lock', 'Lock targets automatically'), ('approach', 'Approach out-of-range ore'))]:
                row = Container(parent=main, align=C.TOTOP, height=30)
                for key, label in pairs:
                    cell = Container(parent=row, align=C.TOLEFT_PROP, width=0.5)
                    self._toggles[key] = Checkbox(parent=cell, text=label, checked=False, callback=self.Changed)
            EveLabelMedium(parent=main, align=C.TOTOP, autoFitToText=True, text='Target priority')
            self.orderEdit = Combo(parent=main, align=C.TOTOP, options=[('Nearest first', 'nearest'), ('Furthest first', 'furthest'), ('Largest volume first', 'largest'), ('Smallest volume first', 'smallest')], select='nearest', callback=self.Changed)
            self.scopeLabel = EveLabelMedium(parent=main, align=C.TOTOP, autoFitToText=True, padBottom=6, text='')
            self.priorityHint = EveLabelSmall(parent=main, align=C.TOTOP, autoFitToText=True, padBottom=8, text='')
            Section(parent=main, text='Mining support')
            row = Container(parent=main, align=C.TOTOP, height=30)
            for key, label in [('survey', 'Automatic survey'), ('compress', 'Automatic compression')]:
                cell = Container(parent=row, align=C.TOLEFT_PROP, width=0.5)
                self._toggles[key] = Checkbox(parent=cell, text=label, checked=False, callback=self.Changed)
            EveLabelMedium(parent=main, align=C.TOTOP, autoFitToText=True, text='Survey seconds')
            timerRow = Container(parent=main, align=C.TOTOP, height=34)
            self.timerEdit = SingleLineEditInteger(parent=timerRow, align=C.TOPLEFT, width=100, setvalue=60, minValue=6, maxValue=86400, OnChange=self.Changed)
            EveLabelSmall(parent=timerRow, align=C.CENTERLEFT, left=110, text='Default 60 | Minimum 6')
            self.filterLabel = EveLabelMedium(parent=filterPanel, align=C.TOTOP, height=24, text='No filter: all compatible resources')
            EveLabelSmall(parent=filterPanel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                          text=text(_am_tr('Click a resource to include it. Click it again to remove it.\nSelect an entry in Mining order to move it up or down.')))
            picker = Container(parent=filterPanel, align=C.TOALL, padBottom=8)
            leftHalf = Container(parent=picker, align=C.TOLEFT_PROP, width=0.70, padRight=20)
            available = Container(parent=leftHalf, align=C.TOALL, padRight=6)
            selected = Container(parent=picker, align=C.TOALL)
            self.availableLabel = EveLabelMedium(parent=available, align=C.TOTOP, height=24, text='Available ores')
            self.selectedLabel = EveLabelMedium(parent=selected, align=C.TOTOP, height=24, text='Mining order (top first)')
            self.availableSearch = SingleLineEditText(parent=available, align=C.TOTOP, height=28, padBottom=6, hint='Search available ore, ice or gas', OnChange=self.Search)
            self.selectedSearch = SingleLineEditText(parent=selected, align=C.TOTOP, height=28, padBottom=6, hint='Search active filter', OnChange=self.Search)
            self.availableScroll = ResourcePicker(self, parent=available, align=C.TOALL)
            self.selectedScroll = ResourcePicker(self, active=True, parent=selected, align=C.TOALL)
            self.boosterRole = Combo(parent=boostersPanel, align=C.TOTOP, options=[('Boosting', 'boosting'), ('Transport', 'transport')],
                select='boosting', state=C.UI_HIDDEN, callback=self.BoosterRoleChanged)
            self.BuildIndustrial(boostersPanel)
            self.BuildTransport(transportTab)
            self.BuildStatistics(statisticsTab)
            self.BuildJobs(jobsTab)
            self.BuildPVE(pveTab)
            self.BuildFleet(fleetTab)
            self._toggles['actionNotifications'] = Checkbox(parent=jobsTab, align=C.TOTOP, height=32,
                text='Show AutoMining action messages', checked=True, callback=self.Changed)
            self.tabs.Startup([(_am_tr('Mining'), miningTab, None, 'mining'), (_am_tr('Mining drones'), miningDronesTab, None, 'miningdrones'), (_am_tr('Mining Filter'), filterPanel, None, 'filter'), (_am_tr('Drones'), dronesTab, None, 'drones'), (_am_tr('Defense'), defenseTab, None, 'defense'), (_am_tr('Boosters'), boostersTab, None, 'boosters'), (_am_tr('Ore handling'), returnTab, None, 'return'), (_am_tr('Statistics'), statisticsTab, None, 'statistics'), (_am_tr('Hauling'), transportTab, None, 'transport'), (_am_tr('Jobs'), jobsTab, None, 'jobs'), (_am_tr('PVE'), pveTab, None, 'pve'), (_am_tr('Fleet'), fleetTab, None, 'fleet')], groupID='AutoMiningTabs', autoselecttab=1)
            self.ConfigureJobNavigation()
            self._toggles['inviteFleet'].state = C.UI_HIDDEN
            self.BuildSettingIndex()
            self._loading = False
            self.UpdatePriorityHint()
            _am_uthread.new(self.Refresh, True)
            _am_uthread.new(self.Poll)
            self.RefreshDroneGroups()

        def JobPages(self):
            if not self._jobChosen:
                return set((7, 9))
            return set({'mining': (0, 1, 2, 3, 6), 'hauling': (8, 3), 'boosting': (5, 1, 2, 3), 'pve': (10, 3)}.get(self._job, (0,))) | set((4, 7, 9, 11))

        def ConfigureJobNavigation(self, animate=False):
            if not getattr(self.tabs, 'buttons', None):
                return
            allowed = self.JobPages()
            revealed = []
            for index, (row, marker) in enumerate(self.tabs.buttons):
                if index in allowed and row.state == C.UI_HIDDEN:
                    revealed.append(row)
                row.state = C.UI_NORMAL if index in allowed else C.UI_HIDDEN
                row.opacity = 1.0
            self.UpdateDroneJobControls()
            self.settingSearch.hintText = _am_tr('Find a setting for this job...' if self._jobChosen else 'Find a setting...')
            self.jobSummary.state = C.UI_NORMAL if self._jobChosen else C.UI_HIDDEN
            self.jobSummary.text = _am_tr('Selected job: %s', _am_tr({'mining': 'Mining', 'hauling': 'Hauling', 'boosting': 'Boosting', 'pve': 'PVE'}[self._job]))
            if getattr(self.tabs, 'index', 9) not in allowed:
                self.tabs.SelectByIdx(9, animate=False)
            self.tabs.Layout()
            if animate and revealed:
                for index, row in enumerate(revealed):
                    fade(row, 0.4, 1.0, duration=0.24, offset=index * 0.025)
            if hasattr(self, '_settingIndex'):
                self.FindSetting()

        def JobCallback(self, job):
            return lambda *args: self.OpenJob(job)

        def OpenDestination(self, *args):
            self.tabs.SelectByIdx(4)

        def BuildJobs(self, panel):
            EveLabelMedium(parent=panel, align=C.TOTOP, height=42, fontsize=27, text='Choose a job')
            self.jobSummary = EveLabelMedium(parent=panel, align=C.TOTOP, height=28, text='Selected job: Mining')
            EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=18,
                text='Choose one job. Settings for other jobs stay saved. Start / Stop controls the selected job.',
                color=(0.65, 0.72, 0.76, 1))
            self.jobCards, self._cardVisuals = {}, {}
            descriptions = {'mining': 'Mine ore, ice or gas with lasers and drones.', 'hauling': 'Collect fleet ore and deliver it to your station.',
                'boosting': 'Run mining boosts, industrial equipment and fuel restocking.',
                'pve': 'Patrol belts, escort fleets or answer reinforcement calls.'}
            textures = {'mining': 'card_AsteroidBelts.png', 'hauling': 'card_AgentsDistribution.png',
                        'boosting': 'card_FleetUp.png', 'pve': 'card_CombatSites.png'}
            tags = {'mining': ('Mining Filter', 'Mining drones', 'Ore handling'),
                    'hauling': ('Request fleet pickup', 'Transport destination'),
                    'boosting': ('Industrial Core', 'Automatic compression', 'Fleet ore collection'),
                    'pve': ('Belt patrol', 'Fleet escort', 'Reinforcement standby')}
            row = Container(parent=panel, align=C.TOTOP, height=375, padBottom=12)
            for index, job in enumerate(('mining', 'hauling', 'boosting', 'pve')):
                card = Container(parent=row, align=C.TOLEFT_PROP, width=0.25,
                    padRight=14 if index < 3 else 0, state=C.UI_NORMAL, clipChildren=True)
                Fill(bgParent=card, color=(0.025, 0.04, 0.05, 1), state=C.UI_DISABLED)
                texture = 'res:/UI/Texture/Classes/Agency/navigationCards/' + textures[job]
                try:
                    import trinity
                    # Background objects append behind previous backgrounds.
                    # The opaque Fill must stay behind art, as in native Agency.
                    art = Frame(bgParent=card, idx=0, align=C.TOALL, textureSecondaryPath=texture,
                        texturePath='res:/UI/Texture/Classes/Agency/navMask.png',
                        spriteEffect=trinity.TR2_SFX_MODULATE, cornerSize=10, opacity=0.85, state=C.UI_DISABLED)
                    if art.textureSecondary:
                        art.textureSecondary.scale, art.textureSecondary.scalingCenter = (1.0, 1.0), (0.5, 0.5)
                        art.textureSecondary.useTransform = True
                except Exception:
                    art = Sprite(bgParent=card, idx=0, align=C.TOALL, texturePath=texture, opacity=0.85, state=C.UI_DISABLED)
                stroke = Frame(parent=card, align=C.TOALL,
                    texturePath='res:/UI/Texture/Shared/DarkStyle/panel2Corner_Stroke.png', cornerSize=9,
                    color=(0.73, 0.85, 0.86, 1), opacity=0.18, state=C.UI_DISABLED)
                card.OnClick = self.JobCallback(job)
                card.OnMouseEnter = self.CardHoverCallback(job, True)
                card.OnMouseExit = self.CardHoverCallback(job, False)
                self.jobCards[job] = card
                name = {'mining': 'Mining', 'hauling': 'Hauling', 'boosting': 'Boosting', 'pve': 'PVE'}[job]
                ribbon = Container(parent=card, align=C.TOPLEFT, left=0, top=40,
                    width=button_width(name, 112), height=42, state=C.UI_DISABLED)
                Frame(bgParent=ribbon, texturePath='res:/UI/Texture/classes/Agency/navButtonTitleBar.png',
                    cornerSize=26, color=(0.02, 0.03, 0.04, 0.97), state=C.UI_DISABLED)
                Fill(parent=ribbon, align=C.TOBOTTOM, height=1, padRight=24,
                    color=(0.58, 0.78, 0.82, 0.85), state=C.UI_DISABLED)
                EveLabelMedium(parent=ribbon, align=C.CENTERLEFT, left=14, fontsize=21,
                    text=name, color=(0.93, 0.97, 0.98, 1), state=C.UI_DISABLED)
                EveLabelSmall(parent=card, align=C.TOPRIGHT, left=12, top=14,
                    text='%02d' % (index + 1), fontsize=11, color=(0.65, 0.71, 0.72, 0.7), state=C.UI_DISABLED)
                overlay = ContainerAutoSize(parent=card, align=C.TOBOTTOM, alignMode=C.TOTOP,
                    minHeight=106, padding=(1, 1, 1, 1), state=C.UI_DISABLED)
                Frame(bgParent=overlay, texturePath='res:/UI/Texture/Shared/DarkStyle/panel1Corner_Solid.png',
                    cornerSize=9, color=(0.015, 0.025, 0.03, 0.89), state=C.UI_DISABLED)
                EveLabelSmall(parent=overlay, align=C.TOTOP, autoFitToText=True, padding=(14, 12, 14, 6),
                    text=descriptions[job], fontsize=15, color=(0.82, 0.89, 0.92, 1), state=C.UI_DISABLED)
                tagLabel = EveLabelSmall(parent=overlay, align=C.TOTOP, autoFitToText=True, padding=(14, 5, 14, 15),
                    text=' / '.join(_am_tr(tag) for tag in tags[job]), fontsize=12,
                    color=(0.57, 0.74, 0.78, 1), opacity=0.6, state=C.UI_DISABLED)
                self._cardVisuals[job] = (art, stroke, tagLabel)
            EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True,
                text='Fleet and Defense appear after you choose a job. Statistics is always available.',
                fontsize=13, color=(0.55, 0.65, 0.70, 1))
            if globals().get('_am_load_job_artwork'):
                _am_load_job_artwork(self)

        def ApplyJobArtwork(self, paths):
            if getattr(self, 'destroyed', False):
                return
            for job, path in paths.items():
                if job not in self._cardVisuals:
                    continue
                art = self._cardVisuals[job][0]
                if getattr(art, 'destroyed', False):
                    continue
                if getattr(art, 'textureSecondary', None) is not None:
                    art.SetSecondaryTexturePath(path)
                else:
                    art.texturePath = path

        def CardHoverCallback(self, job, inside):
            return lambda *args: self.CardHover(job, inside)

        def CardHover(self, job, inside):
            if job not in self._cardVisuals or getattr(self, 'destroyed', False):
                return
            art, stroke, tags = self._cardVisuals[job]
            fade(art, getattr(art, 'opacity', 0.85), 1.0 if inside else 0.85, duration=0.3)
            fade(stroke, getattr(stroke, 'opacity', 0.18), 0.75 if inside else 0.18, duration=0.2)
            fade(tags, getattr(tags, 'opacity', 0.6), 1.0 if inside else 0.6, duration=0.2)
            texture = getattr(art, 'textureSecondary', None)
            if texture:
                end = (0.966, 0.966) if inside else (1.0, 1.0)
                try:
                    from carbonui.uianimations import animations
                    animations.MorphVector2(texture, 'scale', texture.scale, end, duration=0.4)
                except Exception:
                    texture.scale = end

        def OpenJob(self, job):
            if job not in ('mining', 'hauling', 'boosting', 'pve') or self._busy:
                return
            if self._enabled and job != self._job:
                from player_messaging.client.ui_message import prompt_player_fsd_dialog
                if prompt_player_fsd_dialog('CustomQuestion', {'header': _am_tr('Switch job'),
                        'question': _am_tr('Stop the current job and switch? The new job will wait for Start.')}, C.YESNO) != C.ID_YES:
                    return
                _am_uthread.new(self.SwitchJobWork, job)
                return
            if job == self._job:
                self.SelectJobDraft(job)
            else:
                _am_uthread.new(self.SelectJobDraft, job)

        def DraftResponse(self):
            response = dict(self._lastResponse or {})
            response['settings'] = self.ReadSettings()
            response['presentation'] = {}
            for context, view, storageView in (('ore', 'destination', 'storage'), ('fuel', 'fuelDestination', 'fuelStorage'),
                    ('transport', 'transportDestination', 'transportStorage'), ('pveHome', 'pveHomeDestination', None)):
                destination = self.Destination(context)
                response[view] = destination._stationResult
                response['presentation'][context] = (destination.stationEdit.GetValue(), destination.stationDetails.text)
                if storageView:
                    response[storageView] = {'key': destination.storageEdit.GetValue() or '', 'label': destination.storageEdit.GetKey()}
            response['pve'] = dict(response.get('pve') or {}, belt=self._pveBelt)
            response['pveAmmo'] = dict(response.get('pveAmmo') or {}, sourceKey=self.pveAmmoSource.GetValue(), sourceLabel=self.pveAmmoSource.GetKey())
            return response

        def LoadJobDraft(self, response):
            self.ShowResponse(response, True, draft=True)
            for context, values in response.get('presentation', {}).items():
                destination = self.Destination(context)
                destination.stationEdit.SetValue(values[0], docallback=False)
                destination.stationDetails.text = values[1]

        def SelectJobDraft(self, job):
            if job not in ('mining', 'hauling', 'boosting', 'pve'):
                return False
            if job != self._job:
                if self._revision is None:
                    self.SetNotice(_am_tr('Wait for the settings to load, then try again.'))
                    return False
                old, ship = self._job, getattr(session, 'shipid', None)
                self._jobPreviewSerial += 1
                serial = self._jobPreviewSerial
                busy, self._busy = self._busy, True
                try:
                    preview = self.Request('AutoMiningJobProfile', job)
                    if self._job != old or getattr(session, 'shipid', None) != ship or serial != self._jobPreviewSerial:
                        return False
                    if preview.get('revision') != self._revision:
                        raise RuntimeError(_am_tr('Settings changed elsewhere. Click Reload before applying your changes.'))
                    fields = preview.get('fields') or []
                    if not fields or preview.get('job') != job:
                        raise RuntimeError(_am_tr('Invalid job settings.'))
                    current = self.DraftResponse()
                    self._jobDrafts[old] = current
                    target = self._jobDrafts.get(job)
                    prefs = dict(current['settings'])
                    source = (target or preview)['settings']
                    for key in fields:
                        prefs[key] = source.get(key, preview['settings'].get(key))
                    prefs['job'] = job
                    prefs['shipRole'] = 'transport' if job == 'hauling' else 'boosting'
                    response = dict(current)
                    response.update(preview)
                    response.update(settings=prefs, presentation={})
                    for context, key, view, storageView in (('ore', 'stationID', 'destination', 'storage'),
                            ('fuel', 'fuelStationID', 'fuelDestination', 'fuelStorage'),
                            ('transport', 'transportStationID', 'transportDestination', 'transportStorage'),
                            ('pveHome', 'pveHomeStationID', 'pveHomeDestination', None)):
                        owner = target if key in fields and target else current if key not in fields else None
                        if owner:
                            response[view] = owner.get(view)
                            if storageView:
                                response[storageView] = owner.get(storageView)
                            response['presentation'][context] = owner['presentation'][context]
                    if target and 'pveBeltID' in fields:
                        response['pve'] = dict(response.get('pve') or {}, belt=(target.get('pve') or {}).get('belt'))
                    if target and 'pveAmmoSourceKey' in fields:
                        sourceView = target.get('pveAmmo') or {}
                        response['pveAmmo'] = dict(response.get('pveAmmo') or {}, sourceKey=sourceView.get('sourceKey'), sourceLabel=sourceView.get('sourceLabel', ''))
                    self.LoadJobDraft(response)
                except Exception as error:
                    if self.ValidCharacter():
                        self.SetNotice(text(_am_status(error)))
                    return False
                finally:
                    self._busy = busy
                self._shipRole = 'transport' if job == 'hauling' else 'boosting'
                self.Changed()
            self._jobChosen = True
            self.ConfigureJobNavigation(animate=True)
            self.tabs.SelectByIdx({'mining': 0, 'hauling': 8, 'boosting': 5, 'pve': 10}[job])
            return True

        def SwitchJobWork(self, job):
            old = self.DraftResponse()
            oldRole, oldChosen, oldPage, oldDirty = self._shipRole, self._jobChosen, self.tabs.index, self._dirty
            if not self.SelectJobDraft(job):
                return
            if not self.Save():
                self._jobChosen = oldChosen
                self.LoadJobDraft(old)
                self._shipRole, self._dirty = oldRole, oldDirty
                self.ConfigureJobNavigation()
                self.tabs.SelectByIdx(oldPage)
                return
            self.SetNotice(_am_tr('Job switched. Configure it, then press Start.'))

        def BuildPVE(self, panel):
            Section(parent=panel, text='PVE')
            self.pveStatus = EveLabelMedium(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8, text='PVE is off.')
            self.pveMode = Combo(parent=panel, align=C.TOTOP,
                options=[('Belt patrol', 'belt'), ('Fleet escort', 'escort'), ('Reinforcement standby', 'standby')], select='belt', callback=self.PVEModeChanged)
            self._pveFleetID, self._pveAnchorID = 0, 0
            self._pveFleets, self._pveQueueToken = [], None
            self._pveHomeStationID, self._pveHomeStationResult, self._pveHomeDestinationSerial = 0, None, 0
            self._pveHomeStationRows = []
            self.pveModePanels = dict((mode, ContainerAutoSize(parent=panel, align=C.TOTOP)) for mode in ('belt', 'escort', 'standby'))
            escort = self.pveModePanels['escort']
            Section(parent=escort, text='Fleet escort')
            Button(parent=escort, align=C.TOTOP, label='Refresh fleets', func=self.RefreshPVEFleets)
            self.pveFleetEdit = Combo(parent=escort, align=C.TOTOP, options=[('Choose a fleet', 0)], select=0, callback=self.PVEFleetChanged)
            self.pveAnchorEdit = Combo(parent=escort, align=C.TOTOP, options=[('Default anchor', 0)], select=0, callback=self.PVEAnchorChanged)
            EveLabelSmall(parent=escort, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='Escort remains assigned after docking. Apply settings, then Start.')
            self.pveEscortHelp = EveLabelSmall(parent=escort, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='Escort orbits the selected pilot while idle, switches to a rat in combat, then returns to the pilot.')
            standby = self.pveModePanels['standby']
            Section(parent=standby, text='Home station')
            searchRow = Container(parent=standby, align=C.TOTOP, height=34)
            findWidth = button_width('Find')
            Button(parent=searchRow, align=C.TOPRIGHT, label='Find', width=findWidth,
                func=lambda *args: _am_uthread.new(self.FindStationsWork, 'pveHome'))
            self.pveHomeStationEdit = SingleLineEditText(parent=searchRow, align=C.TOTOP, height=28, padRight=findWidth + 10,
                hint='Paste a station name; search covers all regions', OnChange=lambda *args: self.DestinationChanged('pveHome'),
                OnReturn=lambda *args: _am_uthread.new(self.FindStationsWork, 'pveHome'))
            Button(parent=standby, align=C.TOTOP, label='Use current station', func=lambda *args: _am_uthread.new(self.UseCurrentStationWork, 'pveHome'))
            self.pveHomeStationDetails = EveLabelSmall(parent=standby, align=C.TOTOP, autoFitToText=True, text='No station selected.')
            self.pveHomeStationResults = Scroll(parent=standby, align=C.TOTOP, height=100, multiSelect=False)
            self.pveHomeStationResults.Load(contentList=[], noContentHint=_am_tr('Find a station, then select the matching result.'))
            EveLabelMedium(parent=standby, align=C.TOTOP, autoFitToText=True, text='Maximum route jumps')
            self.pveMaxJumps = SingleLineEditInteger(parent=standby, align=C.TOTOP, height=30, setvalue=2, minValue=0, maxValue=50, OnChange=self.Changed)
            EveLabelSmall(parent=standby, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='0 jumps means this system, not this grid. Return home after 60 seconds without threats.')
            self.pveDeployment = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8, text='')
            self.pveQueue = Scroll(parent=panel, align=C.TOTOP, height=100, multiSelect=False)
            self.pveQueue.Load(contentList=[], noContentHint=_am_tr('No reinforcement requests.'))
            EveLabelMedium(parent=panel, align=C.TOTOP, height=26, text='Weapon fire mode')
            self.pveFireMode = Combo(parent=panel, align=C.TOTOP, options=[('Focus fire', 'focus'), ('Spread fire', 'spread')], select='focus', callback=self.Changed)
            EveLabelMedium(parent=panel, align=C.TOTOP, height=26, text='Hostile priority')
            self.pvePriority = Combo(parent=panel, align=C.TOTOP, options=[('Strongest first', 'strongest'), ('Weakest first', 'weakest')], select='strongest', callback=self.Changed)
            beltPanel = self.pveModePanels['belt']
            Section(parent=beltPanel, text='Asteroid belt')
            self.pveBeltSearch = SingleLineEditText(parent=beltPanel, align=C.TOTOP, height=30, hintText='Search belt or system name...', OnReturn=self.FindBelts)
            Button(parent=beltPanel, align=C.TOTOP, label='Find belts', func=self.FindBelts)
            self.pveBeltResults = Scroll(parent=beltPanel, align=C.TOTOP, height=130, multiSelect=False)
            self.pveBeltResults.Load(contentList=[], noContentHint=_am_tr('Find a belt, then select the matching result.'))
            self.pveBeltLabel = EveLabelSmall(parent=beltPanel, align=C.TOTOP, autoFitToText=True, padBottom=8, text='No belt selected.')
            Section(parent=panel, text='Weapon range')
            self.pveRange = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8, text='Waiting for fitted weapon data.')
            EveLabelMedium(parent=panel, align=C.TOTOP, height=26, text='Orbit range override in meters (0 = automatic)')
            self.pveOrbit = SingleLineEditInteger(parent=panel, align=C.TOTOP, height=30, setvalue=0, minValue=0, maxValue=250000, OnChange=self.Changed)
            EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='Automatic range follows your highest-DPS weapon, ammunition and skills.')
            self.pveDrones = Checkbox(parent=self._pveDronePanel, align=C.TOTOP, height=32, text='Use PVE drones', checked=False, callback=self.Changed)
            EveLabelMedium(parent=self._pveDronePanel, align=C.TOTOP, autoFitToText=True, text='Drone group to launch')
            self.pveDroneGroup = Combo(parent=self._pveDronePanel, align=C.TOTOP, options=[('No groups found - refresh', '')], select='', callback=self.Changed)
            Button(parent=self._pveDronePanel, align=C.TOTOP, label='Refresh drone groups', func=self.RefreshDroneGroups)
            Section(parent=panel, text='Ammo')
            self.pveAmmoRestock = Checkbox(parent=panel, align=C.TOTOP, height=32,
                text='Restock ammo when docked', checked=True, callback=self.Changed)
            self.pveAmmoSource = Combo(parent=panel, align=C.TOTOP, options=[('Personal item hangar', 'personal')], select='personal', callback=self.Changed)
            Button(parent=panel, align=C.TOTOP, label='Refresh ammo storage', func=self.RefreshAmmoStorage)
            self.pveAmmoSearch = SingleLineEditText(parent=panel, align=C.TOTOP, height=30, hintText='Search ammo...', OnChange=self.FilterPVEAmmo)
            EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='Loaded / Cargo / Cargo target (rounds). 0 means no restock. No ammo is bought.')
            self.pveAmmoStatus = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8, text='')
            self.pveAmmoList = ScrollContainer(parent=panel, align=C.TOTOP, height=220)
            self._pveAmmoTargets, self._pveAmmoItems, self._pveAmmoRows = {}, [], {}
            self._pveAmmoToken = None
            self.UpdatePVEMode()

        def FilterPVEAmmo(self, *args):
            status = self.pveAmmoStatus.text
            self.RenderPVEAmmo({'items': self._pveAmmoItems}, rebuild=True)
            self.pveAmmoStatus.text = status

        def PVEAmmoTargetCallback(self, typeID):
            def changed(*args):
                if not self._loading and typeID in self._pveAmmoRows:
                    self._pveAmmoTargets[str(typeID)] = self._pveAmmoRows[typeID][1].GetValue()
                    self.Changed()
            return changed

        def RenderPVEAmmo(self, view, rebuild=False):
            self.pveAmmoStatus.text = text(_am_status(view.get('status', '')))
            if 'items' in view:
                self._pveAmmoItems = view['items']
            query = station_search_key(self.pveAmmoSearch.GetValue())
            items = [(row, self.TypeName(row['typeID'])) for row in self._pveAmmoItems]
            items = [(row, name) for row, name in items if not query or query in station_search_key(name) or query == str(row['typeID'])]
            token = [(row['typeID'], name) for row, name in items]
            if rebuild or token != self._pveAmmoToken:
                self._pveAmmoToken = token
                self.pveAmmoList.Flush()
                self._pveAmmoRows = {}
                for item, name in items:
                    typeID = item['typeID']
                    row = ContainerAutoSize(parent=self.pveAmmoList.mainCont, align=C.TOTOP, padBottom=8)
                    EveLabelMedium(parent=row, align=C.TOTOP, autoFitToText=True, text=text(name))
                    controls = ContainerAutoSize(parent=row, align=C.TOTOP, minHeight=34, alignMode=C.TOTOP)
                    counts = EveLabelSmall(parent=controls, align=C.TOTOP, padRight=100, autoFitToText=True, text='')
                    target = SingleLineEditInteger(parent=controls, align=C.TOPRIGHT, width=90,
                        setvalue=self._pveAmmoTargets.get(str(typeID), 0), minValue=0, maxValue=1000000,
                        OnChange=self.PVEAmmoTargetCallback(typeID))
                    self._pveAmmoRows[typeID] = (counts, target)
            for item, name in items:
                self._pveAmmoRows[item['typeID']][0].text = _am_tr('Loaded: %d | Cargo: %d', item.get('loaded', 0), item.get('cargo', 0))

        def RefreshAmmoStorage(self, *args):
            _am_uthread.new(self.RefreshAmmoStorageWork)

        def RefreshAmmoStorageWork(self):
            if self._busy or not self.ValidCharacter():
                return
            stationID = int(getattr(session, 'structureid', 0) or getattr(session, 'stationid', 0) or 0)
            if not stationID:
                self.SetNotice(_am_tr('Dock to choose ammo storage.'))
                return
            self._busy = True
            try:
                response = self.Request('AutoMiningStorages', stationID)
                selected = self.pveAmmoSource.GetValue() or 'personal'
                options = [(_am_storage_label(row['label']), row['key']) for row in response.get('storages', [])]
                if selected not in [value for label, value in options]:
                    options.insert(0, (_am_tr('Previous storage unavailable - choose again'), selected))
                loading, self._loading = self._loading, True
                try:
                    self.pveAmmoSource.LoadOptions(options, select=selected)
                finally:
                    self._loading = loading
            except Exception as error:
                self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False

        def PVEModeChanged(self, *args):
            self.UpdatePVEMode()
            self.Changed()

        def UpdatePVEMode(self):
            mode = self.pveMode.GetValue()
            for key, panel in self.pveModePanels.items():
                panel.state = C.UI_NORMAL if key == mode else C.UI_HIDDEN
            self.pveQueue.state = C.UI_HIDDEN if mode == 'belt' else C.UI_NORMAL
            if hasattr(self, '_settingIndex'):
                self.FindSetting()

        def RefreshPVEFleets(self, *args):
            _am_uthread.new(self.RefreshPVEFleetsWork)

        def RefreshPVEFleetsWork(self):
            if self._busy or not self.ValidCharacter():
                return
            self._busy = True
            try:
                response = self.Request('AutoMiningPVEFleets')
                self._pveFleets = response.get('pveFleets') or []
                preview = globals().get('_am_pve_preview_path')
                for fleet in self._pveFleets:
                    try:
                        fleet['jumps'] = len(preview(int(getattr(session, 'solarsystemid2', 0) or getattr(session, 'solarsystemid', 0) or 0), fleet['systemID'])) - 1
                    except Exception:
                        fleet.pop('jumps', None)
                self.LoadPVEFleets()
            except Exception as error:
                self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False

        def LoadPVEFleets(self):
            options = [(_am_tr('Choose a fleet'), 0)]
            for fleet in self._pveFleets[:100]:
                system = self.LocalizedLocationName(fleet['systemID'], fleet.get('systemName', str(fleet['systemID'])))
                options.append((text(_am_tr('%s | %s | %d pilots | %s jumps', self.PVEFleetName(fleet),
                    system, fleet.get('memberCount', 0), fleet.get('jumps', _am_tr('Waiting')))) + ' | ' + _am_tr('Joinable' if fleet.get('joinable') else 'Unavailable'), fleet['fleetID']))
            if self._pveFleetID and not any(value == self._pveFleetID for label, value in options):
                options.append((_am_tr('Fleet') + ': ' + str(self._pveFleetID), self._pveFleetID))
            loading, self._loading = self._loading, True
            try:
                self.pveFleetEdit.LoadOptions(options, select=self._pveFleetID)
                self.LoadPVEAnchors()
            finally:
                self._loading = loading

        def PVEFleetName(self, row):
            if row.get('fleetName') or row.get('name'):
                return row.get('fleetName') or row['name']
            anchorName = row.get('anchorName')
            if not anchorName and row.get('anchorID'):
                anchorName = self.PilotName(row['anchorID'])
            return _am_tr("%s's fleet", anchorName) if anchorName else _am_tr('Fleet') + ': ' + str(row.get('fleetID', ''))

        def PVEFleetChanged(self, *args):
            if self._loading:
                return
            self._pveFleetID = self.pveFleetEdit.GetValue() or 0
            self._pveAnchorID = 0
            self.LoadPVEAnchors()
            self.Changed()

        def LoadPVEAnchors(self):
            fleet = next((row for row in self._pveFleets if row['fleetID'] == self._pveFleetID), {})
            defaultName = next((row.get('name') for row in fleet.get('anchors', []) if row['characterID'] == fleet.get('anchorID')), None)
            defaultLabel = _am_tr('Default anchor') + (' | ' + text(defaultName) if defaultName else '')
            options = [(defaultLabel, 0)] + [(text(row.get('name') or self.PilotName(row['characterID'])), row['characterID']) for row in fleet.get('anchors', [])]
            if self._pveAnchorID and not any(value == self._pveAnchorID for label, value in options):
                options.append((self.PilotName(self._pveAnchorID), self._pveAnchorID))
            loading, self._loading = self._loading, True
            try:
                self.pveAnchorEdit.LoadOptions(options, select=self._pveAnchorID)
            finally:
                self._loading = loading

        def PVEAnchorChanged(self, *args):
            if not self._loading:
                self._pveAnchorID = self.pveAnchorEdit.GetValue() or 0
                self.Changed()

        def BeltLabel(self, belt):
            if not belt:
                return _am_tr('No belt selected.')
            name = belt['name'] if belt.get('_localized') else self.LocalizedLocationName(belt['beltID'], belt.get('name', str(belt['beltID'])))
            system = self.LocalizedLocationName(belt['systemID'], belt.get('systemName', str(belt['systemID'])))
            return text(name + ' / ' + system)

        def FindBelts(self, *args):
            _am_uthread.new(self.FindBeltsWork)

        def FindBeltsWork(self):
            if self._busy or not self.ValidCharacter():
                return
            self._busy = True
            try:
                query = unicode(self.pveBeltSearch.GetValue()).strip()
                key = station_search_key(query)
                language = _am_language()
                if getattr(self, '_beltIndexLanguage', None) != language:
                    self.BuildBeltIndex(language)
                matches = dict((row['beltID'], row) for row in self._beltIndex if
                    key and (key in row['_search'] or query == str(row['beltID']) or query == str(row['systemID'])))
                if not query:
                    systemID = getattr(session, 'solarsystemid', None) or getattr(session, 'solarsystemid2', None)
                    matches = dict((row['beltID'], row) for row in self._beltIndex if row['systemID'] == systemID)
                else:
                    response = self.Request('AutoMiningBelts', query)
                    for row in response['belts']:
                        if row['beltID'] not in matches:
                            matches[row['beltID']] = row
                rows = sorted(matches.values(), key=lambda row: (station_search_key(row.get('name')), row['beltID']))[:100]
                entries = [GetFromClass(Generic, {'label': self.BeltLabel(row), 'belt': row, 'OnClick': self.SelectBelt, 'fontsize': 15}) for row in rows]
                self.pveBeltResults.Load(contentList=entries, noContentHint=_am_tr('No matching belts.'))
            except Exception as error:
                self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False

        def BuildBeltIndex(self, language):
            import threadutils
            rows = []
            try:
                from eve.common.lib import appConst
                # Native eveCfg.py verifies this table and its name formatter.
                native = cfg.mapObjectsDb.execute('SELECT * FROM celestials WHERE groupID = %d' % appConst.groupAsteroidBelt)
                for index, row in enumerate(native):
                    name = cfg.GetCelestialNameFromLocalRow(row, True)
                    rows.append({'beltID': int(row['celestialID']), 'systemID': int(row['solarSystemID']),
                        'name': unicode(name), 'systemName': self.LocalizedLocationName(row['solarSystemID'], str(row['solarSystemID'])), '_localized': True})
                    if index % 128 == 0:
                        threadutils.BeNice(5)
            except Exception:
                rows = []
                offset = 0
                while True:
                    page = self.Request('AutoMiningBeltCatalog', offset, 500)
                    rows.extend(page['belts'])
                    if not page.get('more'):
                        break
                    if not page['belts'] or offset >= 100000:
                        raise RuntimeError(_am_tr('Belt catalog is too large.'))
                    offset += len(page['belts'])
                    threadutils.BeNice(5)
            for row in rows:
                row['_search'] = station_search_key(row['name'] + ' ' + row.get('systemName', ''))
            self._beltIndex, self._beltIndexLanguage = rows, language

        def SelectBelt(self, entry):
            node = entry.sr.node if hasattr(entry, 'sr') else entry
            self._pveBelt = node.belt
            self._pveBeltID = node.belt['beltID']
            self.pveBeltLabel.text = self.BeltLabel(node.belt)
            self.Changed()

        def LoadPVEDroneGroups(self, value=None):
            value = self.pveDroneGroup.GetValue() if value is None else value
            options = [(text(name), key) for key, name in self._droneGroups]
            if value and value not in [key for label, key in options]:
                options.insert(0, (_am_tr('Saved group unavailable - refresh or choose again'), value))
            self.pveDroneGroup.LoadOptions(options or [(_am_tr('No groups found - refresh'), '')], select=value or '')

        def RenderPVE(self, view):
            self.pveStatus.text = text(_am_status(view.get('status', 'PVE is off.')))
            self.pveRange.text = _am_tr('Automatic range: %.0f m | Orbit setting: %.0f m | Weapons: %d',
                view.get('automaticRange', 0), view.get('orbitRange', 0), view.get('weaponCount', 0))
            deployment = view.get('deployment') or {}
            self.pveDeployment.text = text(_am_status(deployment.get('status', '')))
            assignment = deployment.get('assignment')
            if assignment:
                self.pveDeployment.text += '\n' + text(_am_tr('Fleet %s | %s', self.PVEFleetName(assignment), _am_status(_am_tr(assignment.get('status', 'Waiting')))))
                if assignment.get('anchorName'):
                    self.pveDeployment.text += ' | ' + text(assignment['anchorName'])
            pool = deployment.get('pool') or {}
            if pool:
                self.pveDeployment.text += '\n' + _am_tr('%d available | %d requests', pool.get('available', 0), pool.get('requests', 0))
            request = deployment.get('requestStatus') or {}
            self.reinforcementStatus.text = text(_am_status(request.get('status', '') if isinstance(request, dict) else request))
            if isinstance(request, dict) and request.get('incidentID'):
                self.reinforcementStatus.text += ' | ' + _am_tr('%d/%d responders', request.get('responders', 0), request.get('needed', 1))
            routeRange = deployment.get('range')
            if routeRange:
                self.pveDeployment.text += '\n' + _am_tr('Out of range: %d jumps (limit %d).', routeRange['jumps'], routeRange['limit'])
            token = _am_json.dumps(deployment.get('queue') or [], sort_keys=True)
            if token != self._pveQueueToken:
                self._pveQueueToken = token
                entries = []
                for row in (deployment.get('queue') or [])[:32]:
                    system = self.LocalizedLocationName(row['systemID'], row.get('systemName', str(row['systemID'])))
                    label = _am_tr('Fleet %s | %s | %s jumps | %d/%d responders', self.PVEFleetName(row),
                        system, row.get('jumps', _am_tr('Waiting')), row.get('responders', 0), row.get('needed', 1))
                    if row.get('status'):
                        label += ' | ' + _am_status(row['status'])
                    if row.get('ageSeconds') is not None:
                        label += ' | ' + _am_tr('%d s ago', row['ageSeconds'])
                    entries.append(GetFromClass(Generic, {'label': text(label), 'fontsize': 15}))
                self.pveQueue.Load(contentList=entries, noContentHint=_am_tr('No reinforcement requests.'))

        def BuildFleet(self, panel):
            Section(parent=panel, text='Fleet')
            Section(parent=panel, text='Reinforcements')
            self.reinforcementAutoCall = Checkbox(parent=panel, align=C.TOTOP, height=32,
                text='Request reinforcements when attacked', checked=False, callback=self.Changed)
            Button(parent=panel, align=C.TOTOP, label='Call reinforcements', func=self.CallReinforcements)
            self.reinforcementStatus = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8, text='')
            EveLabelMedium(parent=panel, align=C.TOTOP, autoFitToText=True, text='Responder limit')
            self.reinforcementResponderLimit = SingleLineEditInteger(parent=panel, align=C.TOTOP, height=30,
                setvalue=1, minValue=1, maxValue=8, OnChange=self.Changed)
            self.fleetEnabled = Checkbox(parent=panel, align=C.TOTOP, height=32, text='Enable shared fleet management', checked=False, callback=self.Changed)
            self.fleetMode = Combo(parent=panel, align=C.TOTOP, options=[('Manual fleet', 'manual'), ('Automatic fleet', 'automatic')], select='manual', callback=self.FleetModeChanged)
            self.fleetStatus = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8, text='Fleet management is off.')
            EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='Manual mode keeps fleet membership under your control. Automatic mode uses the selected preset.')
            self.fleetPreset = Combo(parent=panel, align=C.TOTOP, options=[('Select a fleet preset', '')], select='', callback=self.FleetPresetChanged)
            self.fleetPresetName = SingleLineEditText(parent=panel, align=C.TOTOP, height=30, hintText='Fleet preset name...')
            self.fleetSave = Button(parent=panel, align=C.TOTOP, label='Save fleet preset', func=self.SaveFleetPreset)
            self.fleetDelete = Button(parent=panel, align=C.TOTOP, label='Delete fleet preset', func=self.DeleteFleetPreset)
            Button(parent=panel, align=C.TOTOP, label='Refresh fleet roster', func=self.RefreshFleet)
            self.fleetRoster = ScrollContainer(parent=panel, align=C.TOTOP, height=280)
            self.fleetMembers = []

        def CallReinforcements(self, *args):
            _am_uthread.new(self.CallReinforcementsWork)

        def CallReinforcementsWork(self):
            if self._busy or not self.ValidCharacter():
                return
            self._busy = True
            try:
                self.ShowResponse(self.Request('AutoMiningCallReinforcements'))
            except Exception as error:
                self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False

        def UpdateFleetControls(self):
            automatic = self.fleetMode.GetValue() == 'automatic'
            for widget in (self.fleetPreset, self.fleetPresetName, self.fleetSave, self.fleetDelete):
                widget.state = C.UI_NORMAL if automatic else C.UI_DISABLED
            for widget in getattr(self, 'fleetMembers', []):
                widget.state = C.UI_NORMAL if automatic else C.UI_DISABLED

        def FleetModeChanged(self, *args):
            self.UpdateFleetControls()
            self.Changed()

        def FleetPresetChanged(self, *args):
            self._fleetGroupID = self.fleetPreset.GetValue() or ''
            preset = next((row for row in self._fleetView.get('presets', []) if row['id'] == self._fleetGroupID), None)
            self.fleetPresetName.SetValue(preset['name'] if preset else '', docallback=False)
            self._fleetRosterDraft = set(preset.get('characterIDs', [])) if preset else set()
            self._fleetRosterDirty = False
            self._fleetRosterToken = None
            self.RenderFleet(self._fleetView)
            self.Changed()

        def LoadFleetPresets(self, selected):
            options = [(_am_tr('Select a fleet preset'), '')] + [(text(row['name']), row['id']) for row in self._fleetView.get('presets', [])]
            if selected and selected not in [value for label, value in options]:
                options.append((_am_tr('Saved preset unavailable'), selected))
            self.fleetPreset.LoadOptions(options, select=selected)

        def FleetMemberCallback(self, characterID):
            def changed(widget, *args):
                if widget.GetValue():
                    self._fleetRosterDraft.add(characterID)
                else:
                    self._fleetRosterDraft.discard(characterID)
                self._fleetRosterDirty = True
            return changed

        def RenderFleet(self, view):
            self._fleetView = view
            self.fleetStatus.text = text(_am_status(view.get('status', 'Fleet management is off.')))
            if view.get('revision') != getattr(self, '_fleetPresetRevision', None):
                self._fleetPresetRevision = view.get('revision')
                self.LoadFleetPresets(self._fleetGroupID)
            token = _am_json.dumps({'roster': view.get('roster', []), 'group': self._fleetGroupID,
                'mode': self.fleetMode.GetValue(), 'revision': view.get('revision')}, sort_keys=True)
            if token == self._fleetRosterToken:
                return
            self._fleetRosterToken = token
            if not self._fleetRosterDirty:
                preset = next((row for row in view.get('presets', []) if row['id'] == self._fleetGroupID), None)
                self._fleetRosterDraft = set(preset.get('characterIDs', [])) if preset else set()
            self.fleetRoster.Flush()
            self.fleetMembers = []
            for member in view.get('roster', [])[:100]:
                characterID = member['characterID']
                row = Container(parent=self.fleetRoster, align=C.TOTOP, height=64, padBottom=6)
                try:
                    from carbonui.primitives.sprite import Sprite
                    portrait = Sprite(parent=row, align=C.TOPLEFT, width=48, height=48, state=C.UI_DISABLED)
                    sm.GetService('photo').GetPortrait(characterID, 64, portrait)
                except Exception:
                    pass
                checkbox = Checkbox(parent=row, align=C.TOTOP, padLeft=58, text=member.get('name') or self.PilotName(characterID),
                    checked=characterID in self._fleetRosterDraft, callback=self.FleetMemberCallback(characterID))
                self.fleetMembers.append(checkbox)
                EveLabelSmall(parent=row, align=C.TOTOP, padLeft=58, text=_am_tr(member.get('status', 'Ready')),
                    color=(0.5, 0.87, 0.94, 1) if member.get('online') else (0.55, 0.6, 0.65, 1))
            self.UpdateFleetControls()

        def FleetActionWork(self, action, payload):
            if self._busy or not self.ValidCharacter():
                return
            self._busy = True
            try:
                response = self.Request('AutoMiningFleetAction', action, _am_json.dumps(payload))
                if action == 'savePreset':
                    saved = next((row for row in response['fleet'].get('presets', []) if row['name'] == payload['name']), None)
                    if saved:
                        self._fleetGroupID = saved['id']
                elif action == 'deletePreset' and self._fleetGroupID == payload['id']:
                    self._fleetGroupID = ''
                self._fleetRosterDirty = False
                self.RenderFleet(response['fleet'])
                self.LoadFleetPresets(self._fleetGroupID)
                if action in ('savePreset', 'deletePreset'):
                    self.Changed()
                self.SetNotice(text(_am_status(response.get('message', 'Fleet preset saved.' if action == 'savePreset' else 'Fleet roster refreshed.'))))
            except Exception as error:
                self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False

        def SaveFleetPreset(self, *args):
            payload = {'revision': self._fleetView.get('revision'), 'id': self._fleetGroupID or None,
                       'name': unicode(self.fleetPresetName.GetValue()), 'characterIDs': sorted(self._fleetRosterDraft)}
            _am_uthread.new(self.FleetActionWork, 'savePreset', payload)

        def DeleteFleetPreset(self, *args):
            if self._fleetGroupID:
                _am_uthread.new(self.FleetActionWork, 'deletePreset', {'revision': self._fleetView.get('revision'), 'id': self._fleetGroupID})

        def RefreshFleet(self, *args):
            _am_uthread.new(self.FleetActionWork, 'refresh', {})

        def Destination(self, context):
            return self if context == 'ore' else DestinationContext(self, context)

        def FuelStationChanged(self, *args):
            self.DestinationChanged('fuel')

        def FuelFindStations(self, *args):
            _am_uthread.new(self.FindStationsWork, 'fuel')

        def FuelUseCurrentStation(self, *args):
            _am_uthread.new(self.UseCurrentStationWork, 'fuel')

        def FuelRefreshStorages(self, *args):
            _am_uthread.new(self.RefreshStoragesWork, 'fuel')

        def BoosterRoleChanged(self, *args):
            self.ChangeRole(self.boosterRole.GetValue())

        def TransportRoleChanged(self, *args):
            self.ChangeRole(self.transportRole.GetValue())

        def ChangeRole(self, role):
            if self._loading or role not in ('boosting', 'transport'):
                return
            self._shipRole = role
            self._loading = True
            try:
                self.boosterRole.SelectItemByValue(role)
                self.transportRole.SelectItemByValue(role)
            finally:
                self._loading = False
            self.Changed()

        def TransportStationChanged(self, *args):
            self.DestinationChanged('transport')

        def TransportFindStations(self, *args):
            _am_uthread.new(self.FindStationsWork, 'transport')

        def TransportUseCurrentStation(self, *args):
            _am_uthread.new(self.UseCurrentStationWork, 'transport')

        def TransportRefreshStorages(self, *args):
            _am_uthread.new(self.RefreshStoragesWork, 'transport')

        def BuildTransport(self, panel):
            Section(parent=panel, text='Hauling')
            self.transportEligibility = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True,
                padBottom=8, text='Waiting for ship eligibility.')
            self.transportRole = Combo(parent=panel, align=C.TOTOP,
                options=[('Boosting', 'boosting'), ('Transport', 'transport')], select='boosting', state=C.UI_HIDDEN, callback=self.TransportRoleChanged)
            EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='Transport suspends mining, boosts, cores and compressors. Their settings are kept.')
            self.transportToggle = Checkbox(parent=panel, align=C.TOTOP, height=32,
                text='Enable shared hauling', checked=False, callback=self.Changed)
            EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='The shared pool assigns pickups. Haulers join temporarily when needed and leave after docking. Existing fleets are preserved.')
            EveLabelMedium(parent=panel, align=C.TOTOP, height=26, text='Unload at hold fullness (%)')
            self.transportThreshold = SingleLineEditInteger(parent=panel, align=C.TOTOP, height=30,
                setvalue=95, minValue=1, maxValue=100, OnChange=self.Changed)
            EveLabelMedium(parent=panel, align=C.TOTOP, height=26, text='Unload partial cargo after idle seconds')
            self.transportIdle = SingleLineEditInteger(parent=panel, align=C.TOTOP, height=30,
                setvalue=60, minValue=1, maxValue=3600, OnChange=self.Changed)
            Section(parent=panel, text='Transport destination')
            EveLabelMedium(parent=panel, align=C.TOTOP, height=26, text='Transport station')
            searchRow = Container(parent=panel, align=C.TOTOP, height=34)
            findWidth = button_width('Find')
            Button(parent=searchRow, align=C.TOPRIGHT, width=findWidth, label='Find', func=self.TransportFindStations)
            self.transportStationEdit = SingleLineEditText(parent=searchRow, align=C.TOTOP, height=28,
                padRight=findWidth + 10, hint='Paste a station name; search covers all regions',
                OnChange=self.TransportStationChanged, OnReturn=self.TransportFindStations)
            Button(parent=panel, align=C.TOTOP, height=30, label='Use current station', func=self.TransportUseCurrentStation)
            self.transportStationDetails = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, text='No station selected.')
            self.transportStationResults = Scroll(parent=panel, align=C.TOTOP, height=110, multiSelect=False)
            self.transportStationResults.Load(contentList=[], noContentHint=_am_tr('Find a station, then select the matching result.'))
            EveLabelMedium(parent=panel, align=C.TOTOP, height=26, text='Transport storage')
            self.transportStorageEdit = Combo(parent=panel, align=C.TOTOP,
                options=[('Select a station first', '')], select='', callback=self.Changed)
            Button(parent=panel, align=C.TOTOP, height=30, label='Refresh storage', func=self.TransportRefreshStorages)
            EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='Personal or accessible corporation storage. Native permissions apply when unloading.')
            Section(parent=panel, text='Current job and queue')
            self.transportStatus = EveLabelMedium(parent=panel, align=C.TOTOP, autoFitToText=True, text='Transport is off.')
            self.transportPool = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True,
                padBottom=8, text='', state=C.UI_HIDDEN)
            self.transportJob = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8, text='No active transport job.')
            self.transportQueue = Scroll(parent=panel, align=C.TOTOP, height=160, multiSelect=False)
            self.transportQueue.Load(contentList=[], noContentHint=_am_tr('No pickup requests.'))

        def PilotName(self, characterID):
            try:
                return unicode(cfg.eveowners.Get(int(characterID)).name)
            except Exception:
                return str(characterID)

        def RenderTransport(self, view):
            eligible = bool(view.get('eligible'))
            roleOptions = [('Boosting', 'boosting'), ('Transport', 'transport')]
            if eligible and not view.get('dualRole'):
                roleOptions = [('Transport', 'transport')]
                if self._shipRole != 'transport':
                    roleOptions.insert(0, ('Select Transport role', ''))
            roleToken = (eligible, bool(view.get('dualRole')), self._shipRole)
            if roleToken != getattr(self, '_transportRoleOptions', None):
                self._transportRoleOptions = roleToken
                selected = self._shipRole if any(value == self._shipRole for label, value in roleOptions) else ''
                self.transportRole.LoadOptions([(_am_tr(label), value) for label, value in roleOptions], select=selected)
            self.transportEligibility.text = _am_tr('Eligible ore transport ship.' if eligible else 'This ship cannot use the Transport role.')
            self.transportToggle.state = C.UI_NORMAL if eligible else C.UI_DISABLED
            self.transportRole.state = C.UI_NORMAL if eligible else C.UI_DISABLED
            self.boosterRole.state = C.UI_HIDDEN
            self.transportRole.state = C.UI_HIDDEN
            self.transportStatus.text = text(_am_status(view.get('status', 'Transport is off.')))
            phases = {'joining': 'Joining the pickup fleet.', 'routePickup': 'Routing to pickup', 'warpPickup': 'Warping to pilot',
                'approachPickup': 'Approaching pickup', 'loading': 'Collecting ore', 'outbound': 'Delivering ore',
                'unloading': 'Unloading ore', 'undocking': 'Undocking'}
            job = view.get('job') or {}
            miner = job.get('miner') or {}
            detail = (_am_tr('Pickup from %s', self.PilotName(miner.get('characterID'))) + '\n' +
                _am_tr(phases.get(job.get('phase'), 'Waiting'))) if job.get('id') else _am_tr('No active transport job.')
            lease = view.get('temporaryFleet') or {}
            reservation = view.get('binReservation') or {}
            fleetID = lease.get('fleetID') or miner.get('fleetID')
            if fleetID:
                fleetName = lease.get('fleetName') or miner.get('fleetName') or str(fleetID)
                detail += '\n' + _am_tr('Fleet: %s | Reserved bin: %s', fleetName,
                    str(reservation.get('canID')) if reservation.get('canID') else _am_tr('Waiting'))
            self.transportJob.text = text(detail)
            pool = view.get('pool')
            self.transportPool.state = C.UI_NORMAL if pool is not None else C.UI_HIDDEN
            if pool is not None:
                self.transportPool.text = _am_tr('Shared pool: %d hauler(s), %d available, %d request(s)',
                    int(pool.get('haulers', 0)), int(pool.get('available', 0)), int(pool.get('requests', 0)))
            token = _am_json.dumps(view.get('queue') or [], sort_keys=True)
            if token != self._transportRevision:
                self._transportRevision = token
                entries = []
                for row in (view.get('queue') or [])[:30]:
                    pilotID = row.get('characterID', row.get('minerID', 0))
                    label = _am_tr('Pickup from %s', row.get('name') or self.PilotName(pilotID))
                    if row.get('volume') is not None:
                        label += ' | ' + _am_tr('%.1f m3 waiting', row['volume'])
                    if row.get('status'):
                        label += ' | ' + _am_status(row['status'])
                    entries.append(GetFromClass(Generic, {'label': text(label), 'fontsize': 15}))
                self.transportQueue.Load(contentList=entries, noContentHint=_am_tr('No pickup requests.'))

        def RequestPickup(self, *args):
            _am_uthread.new(self.RequestPickupWork)

        def RequestPickupWork(self):
            if self._busy or not self.ValidCharacter():
                return
            self._busy = True
            try:
                self.ShowResponse(self.Request('AutoMiningTransportRequest'))
            except Exception as error:
                self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False

        def BuildIndustrial(self, panel):
            Section(parent=panel, text='Industrial Core')
            self.coreToggle = Checkbox(parent=panel, align=C.TOTOP, height=32,
                text='Automatic Industrial Core', checked=False, callback=self.Changed)
            EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='The active core cycle can block warp. Stop prevents future cycles.')
            coreModules = ContainerAutoSize(parent=panel, align=C.TOTOP, minHeight=30)
            Section(parent=panel, text='Asteroid Ore Compressor')
            self.compressorToggle = Checkbox(parent=panel, align=C.TOTOP, height=32,
                text='Automatic Asteroid Ore Compressor', checked=False, callback=self.Changed)
            EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='Activation interval follows successful starts; native cycle duration is the minimum.')
            self.modulePanel = ContainerAutoSize(parent=panel, align=C.TOTOP, minHeight=30)
            self._modulePanels = {'core': coreModules, 'compressor': self.modulePanel}
            self.moduleEmpty = EveLabelSmall(parent=self.modulePanel, align=C.TOTOP,
                autoFitToText=True, text='No supported fitted modules.')
            self._moduleRows = {}
            self.industrialStatus = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, text='')
            Section(parent=panel, text='Fleet ore collection')
            self.receiveFleetOre = Checkbox(parent=panel, align=C.TOTOP, height=32,
                text='Receive fleet ore', checked=False, callback=self.Changed)
            self.receiveFleetAcceptCompressed = Checkbox(parent=panel, align=C.TOTOP, height=32,
                text='Accept compressed ore', checked=True, callback=self.Changed)
            self.receiveFleetAcceptUncompressed = Checkbox(parent=panel, align=C.TOTOP, height=32,
                text='Accept uncompressed ore', checked=True, callback=self.Changed)
            EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='Nearby fleet miners transfer accepted ore into your fleet hangar. Compressed-only reception waits for compression.')
            self.fleetOreStatus = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True,
                padBottom=8, text='Fleet ore collection is off.')
            Section(parent=panel, text='Fuel restocking')
            self.fuelToggle = Checkbox(parent=panel, align=C.TOTOP, height=32,
                text='Restock Heavy Water automatically', checked=False, callback=self.Changed)
            self.fuelSummary = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True,
                padBottom=8, text='Heavy Water: waiting for ship data')
            EveLabelMedium(parent=panel, align=C.TOTOP, autoFitToText=True, text='Restock below remaining core cycles')
            self.fuelReserve = SingleLineEditInteger(parent=panel, align=C.TOTOP, height=30,
                setvalue=2, minValue=1, maxValue=1000, OnChange=self.Changed)
            EveLabelMedium(parent=panel, align=C.TOTOP, autoFitToText=True, text='Refill target in core cycles')
            self.fuelTarget = SingleLineEditInteger(parent=panel, align=C.TOTOP, height=30,
                setvalue=20, minValue=2, maxValue=10000, OnChange=self.Changed)
            EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='Refill target must exceed reserve.')
            self.fuelCargo = Checkbox(parent=panel, align=C.TOTOP, height=32,
                text='Allow Heavy Water in cargo', checked=False, callback=self.Changed)
            EveLabelMedium(parent=panel, align=C.TOTOP, autoFitToText=True, text='Fuel station')
            searchRow = Container(parent=panel, align=C.TOTOP, height=34)
            findWidth = button_width('Find')
            Button(parent=searchRow, align=C.TOPRIGHT, width=findWidth, label='Find', func=self.FuelFindStations)
            self.fuelStationEdit = SingleLineEditText(parent=searchRow, align=C.TOTOP, height=28,
                padRight=findWidth + 10, hint='Paste a station name; search covers all regions',
                OnChange=self.FuelStationChanged, OnReturn=self.FuelFindStations)
            Button(parent=panel, align=C.TOTOP, height=30, label='Use current station', func=self.FuelUseCurrentStation)
            self.fuelStationDetails = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, text='No station selected.')
            self.fuelStationResults = Scroll(parent=panel, align=C.TOTOP, height=110, multiSelect=False)
            self.fuelStationResults.Load(contentList=[], noContentHint=_am_tr('Find a station, then select the matching result.'))
            EveLabelMedium(parent=panel, align=C.TOTOP, height=26, text='Fuel source storage')
            self.fuelStorageEdit = Combo(parent=panel, align=C.TOTOP,
                options=[('Select a station first', '')], select='', callback=self.Changed)
            Button(parent=panel, align=C.TOTOP, height=30, label='Refresh storage', func=self.FuelRefreshStorages)
            EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=12,
                text='Uses existing Heavy Water stock. Missing fuel or access leaves the ship docked.')

        def IntervalChanged(self, typeID, kind, widget, *args):
            if not self._loading:
                self._intervalDraft[kind][str(typeID)] = widget.GetValue()
                self.Changed()

        def ResetInterval(self, module, widget, *args):
            import math
            value = max(int(module.get('defaultSeconds') or 1), int(math.ceil(module.get('durationSeconds') or 1)))
            widget.SetValue(value)
            self.IntervalChanged(module['typeID'], module['kind'], widget)

        def RenderIndustrial(self, industrial, force=False):
            modules = industrial.get('modules') or []
            ids = [(row['itemID'], row.get('kind')) for row in modules]
            if force or ids != self._industrialModules:
                self._industrialModules = ids
                for kind, panel in self._modulePanels.items():
                    panel.Flush()
                    if not any(row.get('kind') == kind for row in modules):
                        EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, text='No supported fitted modules.')
                self._moduleRows = {}
                for module in modules:
                    kind = module.get('kind', 'core')
                    if kind not in ('core', 'compressor'):
                        continue
                    card = ContainerAutoSize(parent=self._modulePanels[kind], align=C.TOTOP, padBottom=8)
                    Fill(bgParent=card, state=C.UI_DISABLED, color=(0.055, 0.07, 0.09, 0.8))
                    title = ContainerAutoSize(parent=card, align=C.TOTOP, alignMode=C.TOTOP, minHeight=30)
                    Icon(parent=title, align=C.TOPLEFT, width=24, height=24, typeID=module['typeID'])
                    EveLabelMedium(parent=title, align=C.TOTOP, autoFitToText=True, padLeft=30,
                        text=self.TypeName(module['typeID']))
                    EveLabelSmall(parent=card, align=C.TOTOP, autoFitToText=True,
                        text=_am_tr('Equipment default: %s s | Fitted cycle: %s s', module.get('defaultSeconds', 0), module.get('durationSeconds', 0)))
                    controls = Container(parent=card, align=C.TOTOP, height=34)
                    interval = self._intervalDraft[kind].get(str(module['typeID']), module.get('intervalSeconds', module.get('defaultSeconds', 1)))
                    editor = SingleLineEditInteger(parent=controls, align=C.TOPLEFT, width=90,
                        setvalue=int(interval), minValue=1, maxValue=86400, hint='Activation interval in seconds')
                    editor.OnChange = self.IntervalCallback(module['typeID'], kind, editor)
                    Button(parent=controls, align=C.TOPRIGHT, label='Reset to equipment default',
                        width=button_width('Reset to equipment default'), func=self.ResetCallback(module, editor))
                    state = EveLabelSmall(parent=card, align=C.TOTOP, autoFitToText=True, text='')
                    self._moduleRows[module['itemID']] = state
            for module in modules:
                label = self._moduleRows.get(module['itemID'])
                if label:
                    value = _am_tr('Active: %s s remaining', int(module.get('remainingSeconds', 0))) if module.get('active') else _am_tr('Waiting')
                    if label.text != value:
                        label.text = value
            self.industrialStatus.text = text(_am_status(industrial.get('status', '')))
            fuel = industrial.get('fuel') or {}
            value = _am_tr('Heavy Water: %s units | %s cycles | Target: %s units',
                           fuel.get('quantity', 0), fuel.get('cycles', 0), fuel.get('targetUnits', 0))
            self.fuelSummary.text = value + ('\n' + text(_am_status(fuel['status'])) if fuel.get('status') else '')

        def IntervalCallback(self, typeID, kind, widget):
            return lambda *args: self.IntervalChanged(typeID, kind, widget)

        def ResetCallback(self, module, widget):
            return lambda *args: self.ResetInterval(module, widget)

        def BuildStatistics(self, panel):
            Section(parent=panel, text='Statistics')
            self.statsView = Combo(parent=panel, align=C.TOTOP, options=[('Pilot', 'pilot'), ('Fleet', 'fleet')],
                select='pilot', callback=self.StatisticsChanged)
            self.statsPeriod = Combo(parent=panel, align=C.TOTOP, options=[('Current run', 'session'),
                ('Today (UTC)', 'today'), ('Last 7 days (UTC)', 'week'), ('Since tracking began', 'tracked')],
                select='session', callback=self.StatisticsChanged)
            actions = Container(parent=panel, align=C.TOTOP, height=70, padTop=8)
            Button(parent=actions, align=C.TOPLEFT, label='Start new run', width=button_width('Start new run'), func=self.ResetStatistics)
            Button(parent=actions, align=C.TOPRIGHT, label='Sessions', width=button_width('Sessions'), func=self.StatisticsSessions)
            EveLabelSmall(parent=actions, align=C.TOBOTTOM, height=30,
                text='Start new run archives your current run. Other fleet pilots keep their runs.')
            self.statsScope = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='Counters start with this update. Native mining history is retained for 90 days.')
            self.statsCombatNote = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True,
                state=C.UI_HIDDEN, padBottom=8, color=(0.95, 0.74, 0.4, 1),
                text='Live combat statistics are unavailable; restart the server.')
            cards = Container(parent=panel, align=C.TOTOP, height=94)
            self.statsCards = []
            self.statsCardTitles = []
            for caption in ('Harvested m3', 'Mining deliveries', 'Completed docks', 'Confirmed unloads'):
                card = Container(parent=cards, align=C.TOLEFT_PROP, width=0.25, padRight=8)
                Fill(bgParent=card, state=C.UI_DISABLED, color=(0.055, 0.09, 0.12, 0.9))
                self.statsCardTitles.append(EveLabelSmall(parent=card, align=C.TOTOP, height=42, text=caption))
                self.statsCards.append(EveLabelMedium(parent=card, align=C.TOTOP, height=30, text=str(0)))
            self.statsYield = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padTop=8, text='')
            progress = Container(parent=panel, align=C.TOTOP, height=6, padTop=2, padBottom=2)
            Fill(bgParent=progress, state=C.UI_DISABLED, color=(0.12, 0.14, 0.16, 1))
            self.statsProgress = Fill(parent=progress, align=C.TOLEFT_PROP, width=0.001, color=(0.28, 0.72, 0.8, 1))
            self.statsHold = EveLabelSmall(parent=panel, align=C.TOTOP, autoFitToText=True, padBottom=8, text='Ore hold: waiting for ship data')
            split = Container(parent=panel, align=C.TOTOP, height=260)
            self.statsList = Scroll(parent=split, align=C.TOLEFT_PROP, width=0.55, multiSelect=False)
            detailPanel = Container(parent=split, align=C.TOALL, padLeft=10)
            self.statsIcon = Icon(parent=detailPanel, align=C.TOTOP, width=40, height=40, state=C.UI_HIDDEN)
            self.statsDetail = EveLabelSmall(parent=detailPanel, align=C.TOTOP, autoFitToText=True, text='')
            Section(parent=panel, text='Recent activity')
            self.statsRecent = Scroll(parent=panel, align=C.TOTOP, height=140, multiSelect=False)
            paging = Container(parent=panel, align=C.TOTOP, height=34)
            Button(parent=paging, align=C.TOPLEFT, label='Previous', width=button_width('Previous'), func=self.PreviousSessions)
            Button(parent=paging, align=C.TOPRIGHT, label='Next', width=button_width('Next'), func=self.NextSessions)

        def StatisticsChanged(self, *args):
            self._statsSessions = False
            self._statsRevision = None
            self.statsPeriod.state = C.UI_DISABLED if self.statsView.GetValue() == 'fleet' else C.UI_NORMAL
            _am_uthread.new(self.StatisticsWork)

        def StatisticsWork(self):
            if self._busy or self._page != 'statistics' or not self.ValidCharacter():
                return
            self._busy = True
            try:
                response = self.Request('AutoMiningStatistics', self.statsView.GetValue(), self.statsPeriod.GetValue())
                self.RenderStatistics(response['statistics'])
            except Exception as error:
                self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False

        def TypeName(self, typeID):
            try:
                import evetypes
                return unicode(evetypes.GetName(typeID))
            except Exception:
                pass
            try:
                return unicode(cfg.invtypes.Get(typeID).name)
            except Exception:
                return str(typeID)

        def TimeLabel(self, milliseconds):
            import time
            return time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(milliseconds / 1000.0))

        def RenderStatistics(self, stats):
            self._statsSessions = False
            self.statsCombatNote.state = C.UI_NORMAL if self._job == 'pve' and stats.get('combatAvailable') is False else C.UI_HIDDEN
            total = stats.get('totals') or {}
            keys, captions = self.StatisticsCardProfile()
            for title, label, key, caption in zip(self.statsCardTitles, self.statsCards, keys, captions):
                title.text = _am_tr(caption)
                number = total.get(key, 0)
                if key == 'elapsedSeconds':
                    number = number / 60.0
                value = ('%.1f' % number) if key in ('volume', 'collectedVolume', 'deliveredVolume', 'damageDealt', 'elapsedSeconds') else str(number)
                if label.text != value:
                    label.text = value
            value = _am_tr('Lasers: %.1f m3 | Drones: %.1f m3 | Average: %.1f m3/h',
                total.get('moduleVolume', 0), total.get('droneVolume', 0), total.get('averageVolumePerHour', 0))
            value += '\n' + _am_tr('Run elapsed: %.1f min. Average includes idle time.', total.get('elapsedSeconds', 0) / 60.0)
            value += '\n' + _am_tr('Transport collected: %.1f m3 | Delivered: %.1f m3 | Pickups: %d | Deliveries: %d',
                total.get('collectedVolume', 0), total.get('deliveredVolume', 0),
                total.get('pickups', 0), total.get('transportDeliveries', 0))
            value += '\n' + _am_tr('PVE rats destroyed: %d | Damage dealt: %.1f', total.get('ratsDestroyed', 0), total.get('damageDealt', 0))
            self.statsYield.text = value
            self.statsHold.text = self.holdLabel.text
            token = _am_json.dumps({'revision': stats.get('revision'), 'view': stats.get('view'),
                'period': stats.get('period'), 'members': [(m['characterID'], m.get('online'), m.get('inFleet'), m.get('participated')) for m in stats.get('members') or []],
                'ores': total.get('ores'), 'transport': [total.get(key, 0) for key in
                    ('collectedVolume', 'deliveredVolume', 'pickups', 'transportDeliveries')],
                'pve': [total.get('ratsDestroyed', 0), total.get('damageDealt', 0)], 'job': self._job,
                'recent': total.get('recent')}, sort_keys=True)
            if token == self._statsRevision:
                return
            self._statsRevision = token
            entries = []
            if stats.get('view') == 'fleet':
                self.statsScope.text = _am_tr('Current fleet operation only. Personal history is private.')
                if stats.get('contributorsTrimmed'):
                    self.statsScope.text += '\n' + _am_tr('Fleet totals include earlier contributors not shown.')
                for member in stats.get('members') or []:
                    mt = member.get('totals') or {}
                    name = member['name'] + (' ' + _am_tr('(left fleet)') if member.get('inFleet') is False else '')
                    label = '%s | %s | %s' % (name, self.StatisticsRowSummary(mt), _am_tr('Online' if member.get('online') else 'Offline'))
                    entries.append(GetFromClass(Generic, {'label': text(label), 'detail': mt, 'OnClick': self.StatisticsDetail, 'fontsize': 15}))
            else:
                self.statsScope.text = _am_tr('Tracking began: %s. Days use UTC; historical docks are unavailable.', self.TimeLabel(stats.get('trackedSince', 0)))
                for ore in total.get('ores') or []:
                    label = '%s | %s | %.1f m3' % (self.TypeName(ore['typeID']), ore['units'], ore['volume'])
                    entries.append(GetFromClass(Generic, {'label': text(label), 'detail': ore, 'OnClick': self.StatisticsDetail, 'fontsize': 15}))
            self.statsList.Load(contentList=entries, noContentHint=_am_tr('No statistics yet.'))
            recent = []
            for row in total.get('recent') or []:
                if row['kind'] == 'combat':
                    action = _am_tr('Damage dealt: %.1f', row.get('damage', 0))
                    if row.get('killed'):
                        action = _am_tr('Rat destroyed.') + ' | ' + action
                    if row.get('typeID'):
                        action += ' | ' + self.TypeName(row['typeID'])
                else:
                    action = (_am_tr('Harvested %s units of %s', row.get('units', 0), self.TypeName(row.get('typeID', 0)))
                          if row['kind'] == 'mining' else _am_tr({'dock': 'Dock completed',
                              'pickup': 'Fleet ore collected', 'delivery': 'Collected ore delivered',
                              'trip': 'Unload confirmed'}.get(row['kind'], 'Activity completed')))
                recent.append(GetFromClass(Generic, {'label': text(self.TimeLabel(row['at']) + ' | ' + action), 'fontsize': 15}))
            self.statsRecent.Load(contentList=recent, noContentHint=_am_tr('No recent activity.'))
            self.statsIcon.state = C.UI_HIDDEN
            self.statsDetail.text = _am_tr('You are not in a fleet.') if stats.get('view') == 'fleet' and not stats.get('inFleet') else (_am_tr('Most mined resource: %s', self.TypeName(total.get('mostMinedTypeID'))) if total.get('mostMinedTypeID') else '')

        def StatisticsDetail(self, entry, *args):
            row = entry.sr.node.detail
            self.statsIcon.state = C.UI_NORMAL if row.get('typeID') else C.UI_HIDDEN
            if row.get('typeID'):
                self.statsIcon.LoadIconByTypeID(row['typeID'], size=40)
            self.statsDetail.text = _am_tr('Harvested: %.1f m3 | Units: %s', row.get('volume', 0), row.get('units', 0))
            if 'moduleVolume' in row:
                self.statsDetail.text += '\n' + _am_tr('Lasers: %.1f m3 | Drones: %.1f m3 | Average: %.1f m3/h',
                    row.get('moduleVolume', 0), row.get('droneVolume', 0), row.get('averageVolumePerHour', 0))
            self.statsDetail.text += '\n' + _am_tr('Transport collected: %.1f m3 | Delivered: %.1f m3 | Pickups: %d | Deliveries: %d',
                row.get('collectedVolume', 0), row.get('deliveredVolume', 0), row.get('pickups', 0), row.get('transportDeliveries', 0))
            self.statsDetail.text += '\n' + _am_tr('PVE rats destroyed: %d | Damage dealt: %.1f', row.get('ratsDestroyed', 0), row.get('damageDealt', 0))

        def StatisticsCardProfile(self):
            if self._job == 'hauling':
                return (('collectedVolume', 'deliveredVolume', 'pickups', 'transportDeliveries'),
                        ('Collected m3', 'Delivered m3', 'Completed pickups', 'Transport deliveries'))
            if self._job == 'pve':
                return (('ratsDestroyed', 'damageDealt', 'docks', 'elapsedSeconds'),
                        ('Rats destroyed', 'Damage dealt', 'Completed docks', 'Elapsed minutes'))
            return (('volume', 'deliveries', 'docks', 'trips'),
                    ('Harvested m3', 'Mining deliveries', 'Completed docks', 'Confirmed unloads'))

        def StatisticsRowSummary(self, total):
            if self._job == 'pve':
                return _am_tr('PVE rats destroyed: %d | Damage dealt: %.1f', total.get('ratsDestroyed', 0), total.get('damageDealt', 0))
            if self._job == 'hauling':
                return _am_tr('Collected: %.1f m3 | Delivered: %.1f m3', total.get('collectedVolume', 0), total.get('deliveredVolume', 0))
            return '%.1f m3' % total.get('volume', 0)

        def ResetStatistics(self, *args):
            _am_uthread.new(self.ResetStatisticsWork)

        def ResetStatisticsWork(self):
            if self._busy or not self.ValidCharacter():
                return
            self._busy = True
            try:
                response = self.Request('AutoMiningResetStatistics')
                self.statsView.SelectItemByValue('pilot')
                self.statsPeriod.SelectItemByValue('session')
                self.RenderStatistics(response['statistics'])
                self.SetNotice(_am_tr('Run archived. A new run has started.'))
            except Exception as error:
                self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False

        def StatisticsSessions(self, *args):
            self._statsOffset = 0
            _am_uthread.new(self.SessionsWork)

        def PreviousSessions(self, *args):
            if self._statsSessions:
                self._statsOffset = max(0, self._statsOffset - 10)
                _am_uthread.new(self.SessionsWork)

        def NextSessions(self, *args):
            if self._statsSessions and self._statsOffset + 10 < self._statsSessionCount:
                self._statsOffset += 10
                _am_uthread.new(self.SessionsWork)

        def SessionsWork(self):
            if self._busy or not self.ValidCharacter():
                return
            self._busy = True
            try:
                response = self.Request('AutoMiningStatisticsSessions', self._statsOffset, 10)
                sessions = response['sessions']
                self._statsSessions = True
                self._statsSessionCount = sessions['total']
                self.statsScope.text = _am_tr('Saved runs: %s (latest 50 retained)', sessions['total'])
                entries = []
                for row in sessions['rows']:
                    total = row['totals']
                    label = '%s | %.1f min | %s' % (self.TimeLabel(row['started']), row['durationSeconds'] / 60.0, self.StatisticsRowSummary(total))
                    detail = dict(total)
                    detail['started'], detail['ended'] = row['started'], row['ended']
                    entries.append(GetFromClass(Generic, {'label': text(label), 'detail': detail, 'OnClick': self.SessionDetail, 'fontsize': 15}))
                self.statsList.Load(contentList=entries, noContentHint=_am_tr('No saved runs. Start a new run to archive this one.'))
                self.statsDetail.text = ''
                self.statsRecent.Load(contentList=[], noContentHint=_am_tr('Choose a saved run to see its summary.'))
            except Exception as error:
                self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False

        def SessionDetail(self, entry, *args):
            self.StatisticsDetail(entry)
            row = entry.sr.node.detail
            self.statsDetail.text += '\n' + self.TimeLabel(row['started']) + '\n' + self.TimeLabel(row['ended'])
            self.statsDetail.text += '\n' + _am_tr('Docks: %s | Unloads: %s', row.get('docks', 0), row.get('trips', 0))

        def JettisonNow(self, *args):
            _am_uthread.new(self.JettisonWork)

        def JettisonWork(self):
            if self._busy or not self.ValidCharacter():
                return
            self._busy = True
            try:
                self.ShowResponse(self.Request('AutoMiningJettison'))
            except Exception as error:
                self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False

        def StopFleet(self, *args):
            if self._busy or not self.ValidCharacter():
                return
            from player_messaging.client.ui_message import prompt_player_fsd_dialog
            if prompt_player_fsd_dialog('CustomQuestion', {'header': _am_tr('Stop fleet AutoMining'),
                'question': _am_tr('Stop fleet AutoMining and recall deployed drones?')}, C.YESNO) == C.ID_YES:
                _am_uthread.new(self.StopFleetWork)

        def StopFleetWork(self):
            if self._busy or not self.ValidCharacter():
                return
            self._busy = True
            try:
                response = self.Request('AutoMiningStopFleet')
                self.ShowResponse(response)
                if 'stopped' in response:
                    self.SetNotice(_am_tr('AutoMining stopped for %d fleet pilot(s). Recall ordered: %d. Recall failures: %d.',
                        response['stopped'], response.get('recallOrdered', 0), response.get('recallFailed', 0)))
                else:
                    self.SetNotice(text(_am_status(response.get('message', ''))))
            except Exception as error:
                self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False

        def BuildSettingIndex(self):
            self._settingIndex = []
            pages = {'mineDrones': 1, 'launchDrones': 3, 'recallDrones': 3, 'ratDefenseEnabled': 3,
                     'defenseEnabled': 4, 'defenseShieldEnabled': 4, 'defenseArmorEnabled': 4,
                     'autoBoost': 5, 'inviteFleet': 5, 'actionNotifications': 9}
            for key, widget in self._toggles.items():
                if key == 'inviteFleet':
                    continue
                label = getattr(widget, 'text', key)
                self._settingIndex.append((pages.get(key, 0), label, widget))
            for page, label, widget in [(0, 'Target priority', self.orderEdit), (0, 'Survey seconds', self.timerEdit),
                (1, 'Drone target priority', self.mineDroneOrderEdit), (1, 'Drone targeting mode', self.mineDroneModeEdit),
                (2, 'Mining Filter', self.availableSearch), (3, 'Drone group to launch', self.droneGroupEdit),
                (4, 'Shield at or below (%)', self.defenseShieldEdit), (4, 'Armor at or below (%)', self.defenseArmorEdit),
                (5, 'Automatic Industrial Core', self.coreToggle), (5, 'Automatic Asteroid Ore Compressor', self.compressorToggle),
                (5, 'Receive fleet ore', self.receiveFleetOre),
                (5, 'Accept compressed ore', self.receiveFleetAcceptCompressed),
                (5, 'Accept uncompressed ore', self.receiveFleetAcceptUncompressed),
                (5, 'Restock Heavy Water automatically', self.fuelToggle), (5, 'Fuel station', self.fuelStationEdit),
                (5, 'Fuel source storage', self.fuelStorageEdit), (5, 'Restock below remaining core cycles', self.fuelReserve),
                (5, 'Refill target in core cycles', self.fuelTarget), (5, 'Allow Heavy Water in cargo', self.fuelCargo),
                (6, 'Ore handling', self.oreModeEdit), (6, 'Abandon jetcan', self.jettisonAbandon),
                (6, 'Auto-stack ore hold', self.stackOreHold), (6, 'Auto-stack fleet hangar', self.stackFleetHangar),
                (6, 'Ore hold trigger', self.haulThresholdEdit), (4, 'Destination station', self.stationEdit),
                (4, 'Unload into', self.storageEdit), (7, 'Statistics', self.statsView),
                (8, 'Enable fleet transport', self.transportToggle),
                (8, 'Transport station', self.transportStationEdit), (8, 'Transport storage', self.transportStorageEdit),
                (6, 'Pickup style', self.pickupStyle), (10, 'Weapon fire mode', self.pveFireMode),
                (10, 'Assignment', self.pveMode), (10, 'Fleet escort', self.pveFleetEdit),
                (10, 'Default anchor', self.pveAnchorEdit), (10, 'Home station', self.pveHomeStationEdit),
                (10, 'Maximum route jumps', self.pveMaxJumps),
                (10, 'Restock ammo when docked', self.pveAmmoRestock), (10, 'Ammo', self.pveAmmoSearch),
                (10, 'Ammo source', self.pveAmmoSource),
                (11, 'Request reinforcements when attacked', self.reinforcementAutoCall),
                (11, 'Responder limit', self.reinforcementResponderLimit),
                (10, 'Hostile priority', self.pvePriority), (10, 'Asteroid belt', self.pveBeltSearch),
                (10, 'Orbit range override in meters (0 = automatic)', self.pveOrbit), (3, 'Use PVE drones', self.pveDrones),
                (3, 'Drone group to launch', self.pveDroneGroup),
                (11, 'Enable shared fleet management', self.fleetEnabled), (11, 'Fleet mode', self.fleetMode),
                (11, 'Fleet preset', self.fleetPreset), (8, 'Unload at hold fullness (%)', self.transportThreshold), (8, 'Unload partial cargo after idle seconds', self.transportIdle)]:
                self._settingIndex.append((page, _am_tr(label), widget))

        def FindSetting(self, *args):
            if not hasattr(self, '_settingIndex'):
                return
            allowed = self.JobPages()
            query = station_search_key(self.settingSearch.GetValue())
            self.settingResults.state = C.UI_NORMAL if query else C.UI_HIDDEN
            if not query:
                self.searchHighlight.text = ''
                self.searchHighlight.height = 0
                return
            entries = []
            for page, label, widget in self._settingIndex:
                if page not in allowed:
                    continue
                if not self.PVEControlVisible(widget):
                    continue
                haystack = unicode(label) + ' ' + unicode(getattr(widget, 'hint', '')) + ' ' + self.tabs.tabs[page][0]
                if query in station_search_key(haystack):
                    entries.append(GetFromClass(Generic, {'label': text(self.tabs.tabs[page][0] + ' | ' + label),
                        'page': page, 'setting': widget, 'caption': label, 'OnClick': self.SelectSetting, 'fontsize': 15}))
            self.settingResults.Load(contentList=entries[:30], noContentHint=_am_tr('No matching settings.'))

        def SelectSetting(self, entry, *args):
            node = entry.sr.node
            if node.page not in self.JobPages():
                return
            if not self.PVEControlVisible(node.setting):
                return
            self.tabs.SelectByIdx(node.page)
            self.searchHighlight.text = _am_tr('Found setting: %s', node.caption)
            self.searchHighlight.height = 26

            self.settingResults.state = C.UI_HIDDEN
            # Native focus highlights the existing control. No duplicate editors.
            try:
                if hasattr(node.setting, 'SetFocus'):
                    node.setting.SetFocus()
                panel = self.tabs.tabs[node.page][1]
                if hasattr(panel, 'ScrollToRevealChildVertical'):
                    target = node.setting
                    children = panel.mainCont.children
                    while target not in children and getattr(target, 'parent', None):
                        target = target.parent
                    if target in children:
                        panel.ScrollToRevealChildVertical(target)
                if getattr(self, '_settingHighlight', None):
                    self._settingHighlight.Close()
                self._settingHighlight = Fill(bgParent=node.setting, color=(0.22, 0.7, 0.85, 0.15), state=C.UI_DISABLED)
            except Exception:
                pass

        def PVEControlVisible(self, widget):
            contexts = list(self.pveModePanels.values()) + [self._droneArrivalPanel, self._pveDronePanel, self._droneRatPanel]
            while widget is not None:
                if any(widget is panel for panel in contexts):
                    return widget.state != C.UI_HIDDEN
                widget = getattr(widget, 'parent', None)
            return True

        def SetNotice(self, message):
            self.notice.text = message
            self.notice.hint = message

        def LoadStorageChoice(self, widget, saved, value):
            if value and value.get('key') == saved:
                options = [(_am_storage_label(value['label']), saved)]
            else:
                options = [(_am_tr('Personal item hangar' if saved == 'personal' else 'Previous storage unavailable - choose again' if saved else 'Select storage'), saved)]
            widget.LoadOptions(options, select=saved)

        def LoadDroneGroups(self, selected, miningSelected=None, fighterSelected=None):
            if miningSelected is None:
                miningSelected = self.ratMiningGroupEdit.GetValue() or ''
            if fighterSelected is None:
                fighterSelected = self.ratFighterGroupEdit.GetValue() or ''
            options = [(text(name), key) for key, name in self._droneGroups]
            def load(widget, value):
                choices = list(options)
                if value and value not in [key for label, key in choices]:
                    choices.insert(0, (_am_tr('Saved group unavailable - refresh or choose again'), value))
                choices.insert(0, (_am_tr('Choose a drone group'), ''))
                widget.LoadOptions(choices, select=value)
            load(self.droneGroupEdit, selected)
            load(self.ratMiningGroupEdit, miningSelected)
            load(self.ratFighterGroupEdit, fighterSelected)

        def RefreshDroneGroups(self, *args):
            _am_uthread.new(self.RefreshDroneGroupsWork)

        def RefreshDroneGroupsWork(self):
            if not self.ValidCharacter():
                return
            try:
                groups = _am_drone_groups()
                if not self.ValidCharacter():
                    return
                self._droneGroups = groups
                loading = self._loading
                self._loading = True
                try:
                    self.LoadDroneGroups(self.droneGroupEdit.GetValue())
                    self.LoadPVEDroneGroups()
                finally:
                    self._loading = loading
            except Exception as error:
                self.SetNotice(text(_am_tr('Could not load drone groups: ') + _am_status(error)))

        def StationDescription(self, row):
            return text('%s\n%s / %s' % (row['name'], row['systemName'], row['regionName'])) if row else _am_tr('No station selected.')

        def LocalizedLocationName(self, locationID, fallback):
            try:
                from carbon.common.script.util.commonutils import StripTags
                location = cfg.evelocations.Get(int(locationID))
                return unicode(StripTags(location.locationName))
            except Exception:
                return fallback

        def LocalizedStationName(self, stationID, fallback):
            # EveJS sends English cfg.evelocations.locationName for stations.
            # Eve's own NPC-station formatter builds the active-language name
            # from the orbit, corporation and operation localization records.
            try:
                from carbon.common.script.util.commonutils import StripTags
                if self._stationOperationIDs is None:
                    self._stationOperationIDs = {}
                    self._stationOperationIDs.update(
                        (int(row['stationID']), row['operationID'])
                        for row in cfg.mapObjectsDb.execute(
                            'SELECT stationID, operationID FROM npcStations'))
                station = cfg.stations.Get(int(stationID))
                name = cfg.GetNpcStationName(int(stationID), station.solarSystemID,
                                             station.ownerID,
                                             self._stationOperationIDs.get(int(stationID)))
                if name:
                    return unicode(StripTags(name))
            except Exception:
                pass
            return self.LocalizedLocationName(stationID, fallback)

        def LocalizeStationRow(self, row):
            if not row:
                return row
            result = dict(row)
            # Upwell names are player-defined. NPC station formatting must not
            # replace one with a static location name (or fail on its item ID).
            if row.get('kind') != 'structure':
                result['name'] = self.LocalizedStationName(row['stationID'], row['name'])
            result['systemName'] = self.LocalizedLocationName(row['systemID'], row['systemName'])
            result['regionName'] = self.LocalizedLocationName(row['regionID'], row['regionName'])
            return result

        def LocalStationMatches(self, query):
            # Eve's autocomplete cache uses cfg.evelocations.locationName,
            # which EveJS supplies in English. Search it for English paste,
            # then search locally formatted names for the active language.
            import threadutils
            try:
                from eveui.autocomplete.location.provider import StationNameCache
                cache = StationNameCache.instance()
                candidates = cache.query(query)
            except Exception:
                from carbon.common.script.util.commonutils import StripTags
                cache = None
                candidates = ((station.stationID, StripTags(cfg.evelocations.Get(station.stationID).locationName)) for station in cfg.stations)
            key = station_search_key(query)
            found = {}
            def collect(items):
                for index, (stationID, name) in enumerate(items):
                    normalized = station_search_key(name)
                    if key in normalized:
                        found[int(stationID)] = unicode(name)
                    if index % 128 == 0:
                        threadutils.BeNice(5)
            collect(candidates)
            if not found and cache is not None:
                # The cache's letter index uses the unnormalized query. A
                # punctuation variant can miss there even when names match.
                collect(cache)
            if _am_language() != 'en':
                language = _am_language()
                if self._localizedStationLanguage != language:
                    # Build once per HUD language, only after the user presses
                    # Find. This never runs in a mining or drone scan tick.
                    self._localizedStationNames = []
                    for index, station in enumerate(cfg.stations):
                        name = self.LocalizedStationName(station.stationID,
                                                         station.stationName)
                        self._localizedStationNames.append((station.stationID, name))
                        if index % 128 == 0:
                            threadutils.BeNice(5)
                    self._localizedStationLanguage = language
                collect(self._localizedStationNames)
            matches = sorted(found.items(), key=lambda item: (station_search_key(item[1]) != key,
                                                               station_search_key(item[1]), item[0]))
            return matches[:30], len(matches) > 30

        def StationChanged(self, *args):
            return self.DestinationChanged('ore')

        def DestinationChanged(self, context):
            destination = self.Destination(context)
            if self._loading:
                return
            destination._stationID = 0
            destination._stationResult = None
            destination._destinationSerial += 1
            destination.stationDetails.text = _am_tr('Station name changed. Click Find to resolve it.')
            if context != 'pveHome':
                destination.storageEdit.LoadOptions([(_am_tr('Select a station first'), '')], select='')
            self.Changed()

        def FindStations(self, *args):
            _am_uthread.new(self.FindStationsWork)

        def FindStationsWork(self, context='ore'):
            destination = self.Destination(context)
            if self._busy or not self.ValidCharacter():
                return
            self._busy = True
            serial = destination._destinationSerial
            try:
                query = destination.stationEdit.GetValue().strip()
                response = self.Request('AutoMiningFindStations', query)
                localMatches, localMore = self.LocalStationMatches(query)
                rows = dict((row['stationID'], row) for row in response['stations'])
                missing = [stationID for stationID, name in localMatches if stationID not in rows]
                if missing:
                    resolved = self.Request('AutoMiningResolveStations', _am_json.dumps(missing))
                    for row in resolved['stations']:
                        rows[row['stationID']] = row
                if serial != destination._destinationSerial:
                    return
                key = station_search_key(query)
                ranked = []
                for row in rows.values():
                    stationID = row['stationID']
                    shown = self.LocalizeStationRow(row)
                    exact = key == station_search_key(row['name']) or key == station_search_key(shown['name'])
                    ranked.append((not exact, station_search_key(shown['name']), stationID, shown))
                ranked.sort()
                destination._stationRows = [entry[3] for entry in ranked[:30]]
                entries = [GetFromClass(Generic, {'label': text(row['name'] + ' | ' + row['systemName'] + ' / ' + row['regionName']), 'station': row, 'context': context, 'OnClick': self.SelectStation}) for row in destination._stationRows]
                destination.stationResults.Load(contentList=entries, noContentHint=_am_tr('No matching stations.'))
                self.SetNotice(_am_tr('Select a station from the results.') if entries else _am_tr('No matching stations.'))
                if response.get('moreStations') or localMore or len(ranked) > 30:
                    self.SetNotice(_am_tr('Showing 30 results. Enter more of the station name to narrow the search.'))
            except Exception as error:
                self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False

        def SelectStation(self, entry, *args):
            if self._busy:
                return
            self.SetStation(entry.sr.node.station, context=getattr(entry.sr.node, 'context', 'ore'))

        def SetStation(self, row, storage=None, context='ore'):
            destination = self.Destination(context)
            self._loading = True
            sameStation = destination._stationID == row['stationID']
            destination._stationID = row['stationID']
            destination._stationResult = row
            destination.stationEdit.SetValue(row['name'], docallback=False)
            destination.stationDetails.text = self.StationDescription(row)
            if context != 'pveHome' and storage is not None and not sameStation:
                destination.storageEdit.LoadOptions([(_am_tr('Personal item hangar'), 'personal')], select=storage)
            destination._destinationSerial += 1
            self._loading = False
            self.Changed()
            if context != 'pveHome':
                _am_uthread.new(self.RefreshStoragesWork, context)

        def UseCurrentStation(self, *args):
            _am_uthread.new(self.UseCurrentStationWork)

        def UseCurrentStationWork(self, context='ore'):
            destination = self.Destination(context)
            if self._busy or not self.ValidCharacter():
                return
            stationID = int(getattr(session, 'structureid', None) or getattr(session, 'stationid', None) or 0)
            if stationID <= 0:
                self.SetNotice(_am_tr('Dock at a station to use your current station.'))
                return
            self._busy = True
            serial = destination._destinationSerial
            row = None
            try:
                response = self.Request('AutoMiningResolveStations', _am_json.dumps([stationID]))
                if serial == destination._destinationSerial and int(getattr(session, 'structureid', None) or getattr(session, 'stationid', None) or 0) == stationID:
                    rows = response.get('stations') or []
                    if rows and rows[0]['stationID'] == stationID:
                        row = self.LocalizeStationRow(rows[0])
                    else:
                        self.SetNotice(_am_tr('Current station could not be resolved.'))
            except Exception as error:
                self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False
            if row and self.ValidCharacter():
                storage = None if context == 'pveHome' else destination.storageEdit.GetValue() if destination._stationID == stationID else 'personal'
                self.SetStation(row, storage or 'personal', context)
                self.SetNotice(text(row['name']) if context == 'pveHome' else _am_tr('Current station selected. Choose or confirm unload storage.'))

        def RefreshStorages(self, *args):
            _am_uthread.new(self.RefreshStoragesWork)

        def RefreshStoragesWork(self, context='ore'):
            destination = self.Destination(context)
            if self._busy or not destination._stationID or not self.ValidCharacter():
                return
            self._busy = True
            serial = destination._destinationSerial
            try:
                selected = destination.storageEdit.GetValue()
                response = self.Request('AutoMiningStorages', destination._stationID)
                if serial != destination._destinationSerial:
                    return
                options = [(_am_storage_label(row['label']), row['key']) for row in response['storages']]
                keys = [key for label, key in options]
                # No silent fallback when a previously chosen container disappears.
                if selected and selected not in keys:
                    options.insert(0, (_am_tr('Previous storage unavailable - choose again'), ''))
                    selected = ''
                elif not selected:
                    options.insert(0, (_am_tr('Choose unload storage'), ''))
                self._loading = True
                destination.storageEdit.LoadOptions(options, select=selected)
                self._loading = False
                self.Changed()
            except Exception as error:
                self.SetNotice(text(_am_status(error)))
            finally:
                self._loading = False
                self._busy = False

        def CancelReturn(self, *args):
            _am_uthread.new(self.CancelReturnWork)

        def CancelReturnWork(self):
            if self._busy or not self.ValidCharacter():
                return
            self._busy = True
            try:
                self.ShowResponse(self.Request('AutoMiningCancelHaul'))
            except Exception as error:
                self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False

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
                raise RuntimeError(_am_tr('Character changed'))
            response = _am_json.loads(getattr(sm.RemoteSvc('miningScanMgr'), method)(*args))
            if not self.ValidCharacter():
                raise RuntimeError(_am_tr('Character changed'))
            if not response.get('success'):
                raise RuntimeError(_am_status(response.get('message', _am_tr('AutoMining request failed'))))
            return response

        def ShowResponse(self, response, replaceDraft=False, draft=False, preserveJobDrafts=False):
            if not draft:
                self._lastResponse = response
                if replaceDraft and not preserveJobDrafts:
                    self._jobDrafts = {}
            status = ('<b>%s</b> - ' % _am_tr('ON' if response['enabled'] else 'OFF')) + text(_am_status(response['status']))
            if self.statusLabel.text != status:
                self.statusLabel.text = status
                self.statusLabel.hint = status
            self.stopFleetButton.state = C.UI_NORMAL if response.get('canStopFleet') else C.UI_HIDDEN
            if not draft and globals().get('_am_activity_set_state'):
                _am_activity_set_state(response['enabled'], response.get('settings', {}).get('actionNotifications', True))
            trip = response.get('hauling') or {}
            self.returnStatus.text = text(_am_status(trip.get('status', 'Automatic hauling is off.')))
            self.droneStatus.text = text(_am_status(response.get('droneStatus', 'Automatic launch is off.')))
            self.mineDroneStatus.text = text(_am_status(response.get('mineDroneStatus', 'Automatic mining orders are off.')))
            self.ratStatus.text = text(_am_status(response.get('ratStatus', 'Rat response is off.')))
            self.defenseStatus.text = text(_am_status(response.get('defenseStatus', 'Defense is off.')))
            self.boostStatus.text = text(_am_status(response.get('boostStatus', 'Automatic mining boosts are off.')))
            self.cancelReturn.state = C.UI_NORMAL if trip.get('id') else C.UI_HIDDEN
            hold = response.get('hold')
            self.holdLabel.text = (_am_tr('Ore hold: %.1f / %.1f m3 (%.1f%%)', hold['used'], hold['capacity'], 100.0 * hold['used'] / hold['capacity'])) if hold and hold.get('capacity', 0) > 0 else _am_tr('Ore hold: waiting for ship data')
            if hold and hold.get('capacity', 0) > 0:
                self.statsProgress.width = max(0.001, min(1.0, float(hold['used']) / hold['capacity']))
                self.statsProgress.color = (0.8, 0.58, 0.25, 1) if self.statsProgress.width >= 0.95 else (0.28, 0.72, 0.8, 1)
            self._enabled = bool(response.get('enabled'))
            saved = ((self._lastResponse or response) if draft else response).get('settings') or {}
            miningOn = self._enabled and saved.get('job', 'mining') == 'mining'
            pickupReady = miningOn and saved.get('oreMode', 'leave') == 'pickup'
            self.requestPickupButton.state = C.UI_NORMAL if pickupReady else C.UI_DISABLED
            pickupHint = ('Request pickup uses saved settings. Apply changes first.' if pickupReady else
                'Select Fleet pickup and apply settings before requesting pickup.' if miningOn else
                'Start the Mining job before requesting pickup.')
            self.requestPickupHint.text = _am_tr(pickupHint)
            self.requestPickupButton.hint = self.requestPickupHint.text
            self.RenderPVE(response.get('pve') or {})
            self.RenderPVEAmmo(response.get('pveAmmo') or {})
            self.RenderFleet(response.get('fleet') or {})
            self.RenderTransport(response.get('transport') or {})
            self.RenderIndustrial(response.get('industrial') or {})
            self.fleetOreStatus.text = text(_am_status((response.get('fleetOre') or {}).get('status', 'Fleet ore collection is off.')))
            self.mineFleetOreStatus.text = self.fleetOreStatus.text
            oreHandling = response.get('oreHandling') or {}
            if oreHandling.get('status'):
                self.returnStatus.text = text(_am_status(oreHandling['status']))
            if 'catalog' in response:
                names = dict((row['name'].lower(), row['name']) for row in response['catalog'])
                self._catalogTypes = dict((row['name'].lower(), int(row.get('typeID') or 0)) for row in response['catalog'])
                self._catalogVolumes = dict((row['name'].lower(), row.get('volume')) for row in response['catalog'])
                self._catalog = {}
                for key, name in names.items():
                    typeID = self._catalogTypes[key]
                    localized = self.TypeName(typeID) if typeID else name
                    if localized == str(typeID):
                        localized = name
                    if key.endswith(' 0-grade') and key[:-8] in names:
                        baseID = self._catalogTypes.get(key[:-8], 0)
                        base = self.TypeName(baseID) if baseID else name[:-8]
                        self._catalog[key] = base if base != str(baseID) else name[:-8]
                        # EveJS's synthetic base-grade records share the native
                        # family's artwork; the client may not know their IDs.
                        self._catalogTypes[key] = baseID or typeID
                    elif key + ' 0-grade' in names:
                        self._catalog[key] = localized + _am_tr(' (group)')
                    else:
                        self._catalog[key] = localized
            if not replaceDraft and (self._dirty or self._revision == response['revision']):
                return
            if replaceDraft or not self._dirty:
                self._loading = True
                prefs = response['settings']
                self._job = prefs.get('job', 'hauling' if prefs.get('shipRole') == 'transport' else 'mining')
                if not draft:
                    self._savedJob = self._job
                openActiveJob = not draft and self._revision is None and self._enabled and self._job in ('mining', 'hauling', 'boosting', 'pve')
                if openActiveJob:
                    # The first server snapshot determines the opening page.
                    # An already-running job should not need another card click.
                    self._jobChosen = True
                self.ConfigureJobNavigation()
                if openActiveJob:
                    self.tabs.SelectByIdx({'mining': 0, 'hauling': 8, 'boosting': 5, 'pve': 10}[self._job], animate=False)
                self.pveMode.SelectItemByValue(prefs.get('pveMode', 'belt'))
                self._pveFleetID, self._pveAnchorID = prefs.get('pveFleetID', 0), prefs.get('pveAnchorID', 0)
                self.LoadPVEFleets()
                self._pveHomeStationID = prefs.get('pveHomeStationID', 0)
                self._pveHomeStationResult = self.LocalizeStationRow(response.get('pveHomeDestination') or (response.get('pve') or {}).get('homeDestination'))
                self._pveHomeDestinationSerial += 1
                self.pveHomeStationEdit.SetValue((self._pveHomeStationResult or {}).get('name', ''), docallback=False)
                self.pveHomeStationDetails.text = self.StationDescription(self._pveHomeStationResult)
                self.pveMaxJumps.SetValue(prefs.get('pveMaxJumps', 2), docallback=False)
                self.UpdatePVEMode()
                self.pveAmmoRestock.SetChecked(prefs.get('pveAmmoRestock', True), report=False)
                self._pveAmmoTargets = dict((str(key), value) for key, value in prefs.get('pveAmmoTargets', {}).items())
                sourceKey = prefs.get('pveAmmoSourceKey', 'personal')
                ammo = response.get('pveAmmo') or {}
                sourceLabel = 'Personal item hangar' if sourceKey == 'personal' else sourceKey
                if ammo.get('sourceKey') == sourceKey and ammo.get('sourceLabel'):
                    sourceLabel = ammo['sourceLabel']
                self.pveAmmoSource.LoadOptions([(_am_storage_label(sourceLabel), sourceKey)], select=sourceKey)
                for typeID, (counts, target) in self._pveAmmoRows.items():
                    target.SetValue(self._pveAmmoTargets.get(str(typeID), 0), docallback=False)
                self.reinforcementAutoCall.SetChecked(prefs.get('reinforcementAutoCall', False), report=False)
                self.reinforcementResponderLimit.SetValue(prefs.get('reinforcementResponderLimit', 1), docallback=False)
                self.pickupStyle.SelectItemByValue(prefs.get('pickupStyle', 'binFirst'))
                self.pveFireMode.SelectItemByValue(prefs.get('pveFireMode', 'focus'))
                self.pvePriority.SelectItemByValue(prefs.get('pvePriority', 'strongest'))
                self.pveOrbit.SetValue(prefs.get('pveOrbitOverride', 0), docallback=False)
                self._pveBeltID = prefs.get('pveBeltID', 0)
                self._pveBelt = (response.get('pve') or {}).get('belt')
                self.pveBeltLabel.text = self.BeltLabel(self._pveBelt)
                self.pveDrones.SetChecked(prefs.get('pveDronesEnabled', False), report=False)
                self.LoadPVEDroneGroups(prefs.get('pveDroneGroupKey', ''))
                self.fleetEnabled.SetChecked(prefs.get('fleetEnabled', False), report=False)
                self.fleetMode.SelectItemByValue(prefs.get('fleetMode', 'manual'))
                self._fleetGroupID = prefs.get('fleetGroupID', '')
                self.LoadFleetPresets(self._fleetGroupID)
                self.UpdateFleetControls()
                self._revision = response['revision']
                self._selected = []
                for key in prefs['ores']:
                    if key not in self._selected:
                        self._selected.append(key)
                for key, widget in self._toggles.items():
                    widget.SetChecked(prefs.get(key, key in ('recallDrones', 'defenseShieldEnabled', 'actionNotifications')), report=False)
                self.UpdateDroneJobControls()
                self.orderEdit.SelectItemByValue(prefs['order'])
                self.mineDroneOrderEdit.SelectItemByValue(prefs.get('mineDroneOrder', 'nearest'))
                self.mineDroneModeEdit.SelectItemByValue(prefs.get('mineDroneMode', 'spread'))
                self.timerEdit.SetValue(prefs['surveySeconds'], docallback=False)
                self.LoadDroneGroups(prefs.get('droneGroupKey', ''), prefs.get('ratMiningGroupKey', ''), prefs.get('ratFighterGroupKey', ''))
                self._shipRole = prefs.get('shipRole', 'boosting')
                self._transportRoleOptions = None
                self.boosterRole.SelectItemByValue(self._shipRole)
                self.transportRole.SelectItemByValue(self._shipRole)
                self.transportToggle.SetChecked(prefs.get('transportEnabled', False), report=False)
                self.transportThreshold.SetValue(prefs.get('transportThreshold', 95), docallback=False)
                self.transportIdle.SetValue(prefs.get('transportIdleSeconds', 60), docallback=False)
                self._transportStationID = prefs.get('transportStationID', 0)
                self._transportStationResult = self.LocalizeStationRow(response.get('transportDestination'))
                self._transportDestinationSerial += 1
                self.transportStationEdit.SetValue((self._transportStationResult or {}).get('name', ''), docallback=False)
                self.transportStationDetails.text = self.StationDescription(self._transportStationResult)
                transportStorage = response.get('transportStorage')
                self.LoadStorageChoice(self.transportStorageEdit, prefs.get('transportStorageKey', 'personal'), transportStorage)
                self.oreModeEdit.SelectItemByValue(prefs.get('oreMode', 'unload' if prefs.get('haulEnabled') else 'leave'))
                self.UpdateOreModeHint()
                self.jettisonAbandon.SetChecked(prefs.get('jettisonAbandon', False), report=False)
                self.stackOreHold.SetChecked(prefs.get('stackOreHold', True), report=False)
                self.stackFleetHangar.SetChecked(prefs.get('stackFleetHangar', True), report=False)
                self.coreToggle.SetChecked(prefs.get('coreEnabled', False), report=False)
                self.compressorToggle.SetChecked(prefs.get('compressorEnabled', False), report=False)
                self.receiveFleetOre.SetChecked(prefs.get('receiveFleetOre', False), report=False)
                self.receiveFleetAcceptCompressed.SetChecked(prefs.get('receiveFleetAcceptCompressed', True), report=False)
                self.receiveFleetAcceptUncompressed.SetChecked(prefs.get('receiveFleetAcceptUncompressed', not prefs.get('compressorEnabled', False)), report=False)
                self.fuelToggle.SetChecked(prefs.get('fuelEnabled', False), report=False)
                self.fuelCargo.SetChecked(prefs.get('fuelUseCargo', False), report=False)
                self.fuelReserve.SetValue(prefs.get('fuelReserveCycles', 2), docallback=False)
                self.fuelTarget.SetValue(prefs.get('fuelTargetCycles', 20), docallback=False)
                self._intervalDraft = {'core': dict(prefs.get('coreIntervals', {})), 'compressor': dict(prefs.get('compressorIntervals', {}))}
                self._fuelStationID = prefs.get('fuelStationID', 0)
                self._fuelStationResult = self.LocalizeStationRow(response.get('fuelDestination'))
                self._fuelDestinationSerial += 1
                self.fuelStationEdit.SetValue((self._fuelStationResult or {}).get('name', ''), docallback=False)
                self.fuelStationDetails.text = self.StationDescription(self._fuelStationResult)
                fuelStorage = response.get('fuelStorage')
                self.LoadStorageChoice(self.fuelStorageEdit, prefs.get('fuelStorageKey', 'personal'), fuelStorage)
                self.RenderIndustrial(response.get('industrial') or {}, True)
                self.haulThresholdEdit.SetValue(prefs.get('haulThreshold', 95), docallback=False)
                self.defenseShieldEdit.SetValue(prefs.get('defenseShieldThreshold', 30), docallback=False)
                self.defenseArmorEdit.SetValue(prefs.get('defenseArmorThreshold', 30), docallback=False)
                self._stationID = prefs.get('stationID', 0)
                self._stationResult = self.LocalizeStationRow(response.get('destination'))
                self._destinationSerial += 1
                self.stationEdit.SetValue((self._stationResult or {}).get('name', ''), docallback=False)
                self.stationDetails.text = self.StationDescription(self._stationResult)
                savedStorage = response.get('storage')
                self.LoadStorageChoice(self.storageEdit, prefs.get('storageKey', 'personal'), savedStorage)
                self._loading = False
                self._dirty = False
                self.UpdatePriorityHint()
                self.DrawLists()

        def Poll(self):
            while self.ValidCharacter():
                _am_blue.pyos.synchro.SleepWallclock(2500)
                if self.ValidCharacter() and not self._busy:
                    self.Refresh(False)
                    self._statsTicks += 1
                    if self._page == 'statistics' and self._statsTicks % 2 == 0 and not self._statsSessions:
                        self.StatisticsWork()

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
                        self.SetNotice(_am_tr('Settings loaded. Choose your ores and click Apply.'))
            except Exception as error:
                if self.ValidCharacter():
                    self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False

        def Changed(self, *args):
            if not self._loading:
                self.UpdateDroneJobControls()
                self.UpdateOreModeHint()
                self.UpdatePriorityHint()
                self._dirty = True
                self._editSerial += 1
                if hasattr(self, 'notice'):
                    self.SetNotice(_am_tr('Unsaved changes. Click Apply, or Reload to discard.'))

        def UpdateDroneJobControls(self):
            pve = self._job == 'pve'
            self._droneArrivalPanel.state = self._droneRatPanel.state = C.UI_HIDDEN if pve else C.UI_NORMAL
            self._pveDronePanel.state = C.UI_NORMAL if pve else C.UI_HIDDEN
            self.ratMiningGroupEdit.state = C.UI_NORMAL if self._job == 'mining' or self._job == 'boosting' and self._toggles['mineDrones'].GetValue() else C.UI_DISABLED

        def UpdateOreModeHint(self):
            if hasattr(self, 'fleetHangarHint'):
                visible = C.UI_NORMAL if self.oreModeEdit.GetValue() == 'fleetHangar' else C.UI_HIDDEN
                self.fleetHangarHint.state = self.mineFleetOreStatus.state = visible
                for widget in (self.oreThresholdTitle, self.oreThresholdRow, self.oreThresholdHelp):
                    widget.state = C.UI_HIDDEN if visible == C.UI_NORMAL else C.UI_NORMAL

        def UpdatePriorityHint(self):
            if not hasattr(self, 'priorityHint'):
                return
            approach = bool(self._toggles['approach'].GetValue())
            order = self.orderEdit.GetValue()
            self.scopeLabel.text = _am_tr('Search area: ') + _am_tr('whole current belt' if approach else 'within mining range')
            priority = {'nearest': 'nearest to furthest', 'furthest': 'furthest to nearest',
                         'largest': 'largest to smallest remaining volume', 'smallest': 'smallest to largest remaining volume'}.get(order, 'nearest to furthest')
            description = _am_tr('Mining Filter order and grade come first. Within one grade: %s.\n', _am_tr(priority))
            description += _am_tr('Your ship may fly from one end of the current belt to the other to follow this order.' if approach
                                  else 'The mod will not move your ship. Asteroids outside effective mining range are ignored.')
            if order in ('largest', 'smallest'):
                description += _am_tr('\nVolume means remaining cubic metres, not ISK value.')
                description += _am_tr('\nRequires an available Mining Surveyor or built-in equivalent. No scan required.')
            self.priorityHint.text = description

        def Search(self, *args):
            if hasattr(self, 'selectedScroll'):
                self.DrawLists()

        def ActiveOreLabel(self, key, label):
            if not label.endswith(_am_tr(' (group)')):
                return label
            grades = [name for name, suffix in [('IV', ' iv-grade'), ('III', ' iii-grade'), ('II', ' ii-grade')]
                      if key + suffix in self._catalog]
            if key + ' 0-grade' in self._catalog:
                grades.append(_am_tr('base'))
            return label + ('  ' + ' > '.join(grades) if grades else '')

        def DrawLists(self):
            if not hasattr(self, 'selectedScroll'):
                return
            active = [(key, self._catalog.get(key, key)) for key in self._selected]
            availableQuery = station_search_key(self.availableSearch.GetValue())
            token = (id(self._catalog), availableQuery)
            if token != self._availableCacheToken:
                available = list(self._catalog.items())
                suffix = _am_tr(' (group)')
                available.sort(key=lambda row: (row[1].lower().replace(suffix, ''), 0 if row[1].endswith(suffix) else 1))
                self._availableCacheEntries = [GetFromClass(Generic, {'label': text(label), 'oreKey': key, 'fontsize': 15, 'vspace': 10,
                                                       'typeID': self._catalogTypes.get(key, 0), 'volume': self._catalogVolumes.get(key),
                                                       'OnDblClick': self.AddOreDoubleClick})
                                for key, label in available if availableQuery in station_search_key(label + ' ' + key)]
                self._availableCacheToken = token
            availableEntries = self._availableCacheEntries
            self._visibleAvailable = availableEntries
            self.availableScroll.Load(contentList=availableEntries, noContentHint=_am_tr('No matching ores' if availableQuery else 'No ores remaining'))
            activeQuery = station_search_key(self.selectedSearch.GetValue())
            activeEntries = [GetFromClass(Generic, {'label': text('%d. %s' % (index, self.ActiveOreLabel(key, label))), 'oreKey': key,
                                                    'fontsize': 15, 'vspace': 10,
                                                    'typeID': self._catalogTypes.get(key, 0),
                                                    'OnDblClick': self.RemoveOreDoubleClick})
                             for index, (key, label) in enumerate(active, 1) if activeQuery in station_search_key(label + ' ' + key)]
            self.selectedScroll.Load(contentList=activeEntries, noContentHint=_am_tr('No matching ores' if activeQuery else 'No active filter'))
            self.availableLabel.text = _am_tr('Available ore / ice / gas (%s)', len(self._catalog))
            self.selectedLabel.text = _am_tr('Mining order: top first (%s)', len(active))
            self.filterLabel.text = _am_tr('Priority: entry 1 first, then entry 2' if active else 'No filter: all compatible resources')

        def AddOreKeys(self, keys):
            if self._busy:
                return
            changed = False
            for key in keys:
                if key not in self._selected:
                    self._selected.append(key)
                    changed = True
            if changed:
                self.Changed()
                self.DrawLists()

        def RemoveOreKeys(self, keys):
            if self._busy:
                return
            remove = set(keys)
            remaining = [key for key in self._selected if key not in remove]
            if len(remaining) != len(self._selected):
                self._selected = remaining
                self.Changed()
                self.DrawLists()

        def AddOres(self, *args):
            selected = set(node.oreKey for node in self.availableScroll.GetSelected())
            self.AddOreKeys(node.oreKey for node in self._visibleAvailable if node.oreKey in selected)

        def RemoveOres(self, *args):
            self.RemoveOreKeys(node.oreKey for node in self.selectedScroll.GetSelected())

        def AddOreDoubleClick(self, entry, *args):
            self.AddOreKeys([entry.sr.node.oreKey])

        def RemoveOreDoubleClick(self, entry, *args):
            self.RemoveOreKeys([entry.sr.node.oreKey])

        def MoveOre(self, direction):
            if self._busy:
                return
            selected = self.selectedScroll.GetSelected()
            if len(selected) != 1:
                self.SetNotice(_am_tr('Select one active ore or group to move.'))
                return
            key = selected[0].oreKey
            index = self._selected.index(key)
            nextIndex = index + direction
            if 0 <= nextIndex < len(self._selected):
                self._selected[index], self._selected[nextIndex] = self._selected[nextIndex], self._selected[index]
                self.Changed()
                self.DrawLists()

        def MoveOreUp(self, *args):
            self.MoveOre(-1)

        def MoveOreDown(self, *args):
            self.MoveOre(1)

        def ClearFilter(self, *args):
            if not self._busy:
                self._selected = []
                self.Changed()
                self.DrawLists()

        def ReadSettings(self):
            prefs = dict((key, bool(widget.GetValue())) for key, widget in self._toggles.items())
            prefs.update(ores=list(self._selected), order=self.orderEdit.GetValue(), surveySeconds=self.timerEdit.GetValue(),
                         mineDroneOrder=self.mineDroneOrderEdit.GetValue(), mineDroneMode=self.mineDroneModeEdit.GetValue(),
                         droneGroupKey=self.droneGroupEdit.GetValue() or '',
                         ratMiningGroupKey=self.ratMiningGroupEdit.GetValue() or '',
                         ratFighterGroupKey=self.ratFighterGroupEdit.GetValue() or '',
                         haulEnabled=self.oreModeEdit.GetValue() == 'unload', oreMode=self.oreModeEdit.GetValue(),
                         haulThreshold=self.haulThresholdEdit.GetValue(), jettisonAbandon=bool(self.jettisonAbandon.GetValue()),
                         stackOreHold=bool(self.stackOreHold.GetValue()), stackFleetHangar=bool(self.stackFleetHangar.GetValue()),
                         coreEnabled=bool(self.coreToggle.GetValue()), compressorEnabled=bool(self.compressorToggle.GetValue()),
                         receiveFleetOre=bool(self.receiveFleetOre.GetValue()),
                         receiveFleetAcceptCompressed=bool(self.receiveFleetAcceptCompressed.GetValue()),
                         receiveFleetAcceptUncompressed=bool(self.receiveFleetAcceptUncompressed.GetValue()),
                         coreIntervals=dict(self._intervalDraft['core']), compressorIntervals=dict(self._intervalDraft['compressor']),
                         fuelEnabled=bool(self.fuelToggle.GetValue()), fuelUseCargo=bool(self.fuelCargo.GetValue()),
                         job=self._job, pickupStyle=self.pickupStyle.GetValue(),
                         pveFireMode=self.pveFireMode.GetValue(), pvePriority=self.pvePriority.GetValue(),
                         pveMode=self.pveMode.GetValue(), pveFleetID=self._pveFleetID, pveAnchorID=self._pveAnchorID,
                         pveHomeStationID=self._pveHomeStationID, pveMaxJumps=self.pveMaxJumps.GetValue(),
                         pveAmmoRestock=bool(self.pveAmmoRestock.GetValue()), pveAmmoTargets=dict(self._pveAmmoTargets),
                         pveAmmoSourceKey=self.pveAmmoSource.GetValue() or 'personal',
                         reinforcementAutoCall=bool(self.reinforcementAutoCall.GetValue()),
                         reinforcementResponderLimit=self.reinforcementResponderLimit.GetValue(),
                         pveOrbitOverride=self.pveOrbit.GetValue(), pveBeltID=self._pveBeltID,
                         pveDronesEnabled=bool(self.pveDrones.GetValue()), pveDroneGroupKey=self.pveDroneGroup.GetValue() or '',
                         fleetEnabled=bool(self.fleetEnabled.GetValue()), fleetMode=self.fleetMode.GetValue(), fleetGroupID=self.fleetPreset.GetValue() or '',
                         shipRole='transport' if self._job == 'hauling' else 'boosting', transportEnabled=bool(self.transportToggle.GetValue()),
                         transportThreshold=self.transportThreshold.GetValue(), transportIdleSeconds=self.transportIdle.GetValue(),
                         transportStationID=self._transportStationID, transportStorageKey=self.transportStorageEdit.GetValue() or 'personal',
                         fuelReserveCycles=self.fuelReserve.GetValue(), fuelTargetCycles=self.fuelTarget.GetValue(),
                         fuelStationID=self._fuelStationID, fuelStorageKey=self.fuelStorageEdit.GetValue() or 'personal',
                         defenseShieldThreshold=self.defenseShieldEdit.GetValue(),
                         defenseArmorThreshold=self.defenseArmorEdit.GetValue(),
                         stationID=self._stationID, storageKey=self.storageEdit.GetValue() or 'personal')
            return prefs

        def Save(self, start=False):
            if self._busy or not self.ValidCharacter():
                return
            if self._revision is None:
                self.SetNotice(_am_tr('Wait for the settings to load, then try again.'))
                return
            self._busy = True
            editSerial = self._editSerial
            try:
                prefs = self.ReadSettings()
                if (self._job == 'mining' and prefs['haulEnabled'] or prefs['defenseEnabled']) and (not self._stationID or not self.storageEdit.GetValue()):
                    raise RuntimeError(_am_tr('Choose a station and unload storage before enabling hauling or Defense.'))
                if self._job == 'hauling' and (start or self._savedJob == 'hauling' and self._enabled) and prefs['transportEnabled'] and (not self._transportStationID or not self.transportStorageEdit.GetValue()):
                    raise RuntimeError(_am_tr('Choose a transport station and unload storage before enabling Transport.'))
                if self._job == 'boosting' and prefs['fuelTargetCycles'] <= prefs['fuelReserveCycles']:
                    raise RuntimeError(_am_tr('Refill target must exceed reserve.'))
                if self._job == 'boosting' and prefs['fuelEnabled'] and (not self._fuelStationID or not self.fuelStorageEdit.GetValue()):
                    raise RuntimeError(_am_tr('Choose a fuel station and source storage.'))
                if prefs['defenseEnabled'] and not (prefs['defenseShieldEnabled'] or prefs['defenseArmorEnabled']):
                    raise RuntimeError(_am_tr('Select shield or armor for Defense.'))
                if self._job != 'pve' and prefs['launchDrones'] and not prefs['droneGroupKey']:
                    raise RuntimeError(_am_tr('Select a drone group before enabling automatic launch.'))
                if self._job != 'pve' and prefs['ratDefenseEnabled'] and (not prefs['ratFighterGroupKey'] or (self._job == 'mining' or self._job == 'boosting' and prefs['mineDrones']) and
                        (not prefs['ratMiningGroupKey'] or prefs['ratMiningGroupKey'] == prefs['ratFighterGroupKey'])):
                    raise RuntimeError(_am_tr('Select different mining and fighter groups for rat response.'))
                response = self.Request('AutoMiningSetSettings', _am_json.dumps({'settings': prefs, 'revision': self._revision}))
                editedDuringSave = editSerial != self._editSerial
                self.ShowResponse(response, not editedDuringSave, preserveJobDrafts=True)
                if editedDuringSave:
                    self._revision = response['revision']
                if start:
                    response = self.Request('AutoMiningControl', 'on')
                    self.ShowResponse(response)
                if editedDuringSave:
                    self.SetNotice(_am_tr('Earlier changes saved. You have further unsaved changes.'))
                elif start and response.get('enabled'):
                    self.SetNotice(_am_tr('AutoMining started.'))
                else:
                    self.SetNotice(text(_am_status(response.get('message', 'Settings saved.'))))
                return True
            except Exception as error:
                if self.ValidCharacter():
                    self.SetNotice(text(_am_status(error)))
                return False
            finally:
                self._busy = False

        def StopWork(self):
            if self._busy or not self.ValidCharacter():
                return
            self._busy = True
            try:
                response = self.Request('AutoMiningControl', 'off')
                self.ShowResponse(response)
                self.SetNotice(_am_tr('AutoMining stopped.') if not response.get('enabled') else text(_am_status(response['message'])))
            except Exception as error:
                if self.ValidCharacter():
                    self.SetNotice(text(_am_status(error)))
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
        message_player(_am_tr('AutoMining could not open its settings. Restart the client through the Launcher after updating the mod.'))


if 'OnAutoMiningOpen' not in EveCommandService.__notifyevents__:
    EveCommandService.__notifyevents__ = list(EveCommandService.__notifyevents__) + ['OnAutoMiningOpen']
    EveCommandService.OnAutoMiningOpen = _am_open_hud


def _am_feedback(self, message):
    from player_messaging.client.ui_message import message_player
    safe = _am_status(message)[:1000].replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    message_player(safe)


if 'OnAutoMiningFeedback' not in EveCommandService.__notifyevents__:
    EveCommandService.__notifyevents__ = list(EveCommandService.__notifyevents__) + ['OnAutoMiningFeedback']
    EveCommandService.OnAutoMiningFeedback = _am_feedback
