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
    try:
        from carbonui.control.scrollContainer import ScrollContainer
    except ImportError:
        ScrollContainer = Container
    from eve.client.script.ui.control.eveLabel import EveLabelMedium, EveLabelSmall
    from eve.client.script.ui.control.eveScroll import Scroll
    from eve.client.script.ui.control.entries.generic import Generic
    from eve.client.script.ui.control.entries.util import GetFromClass

    def text(value):
        return unicode(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

    def station_search_key(value):
        # Bookmark links and the station cache can differ in spacing or dash
        # characters. NFKC also makes full-width Latin characters match.
        import unicodedata
        value = unicodedata.normalize('NFKC', unicode(value or '')).lower()
        return u' '.join(value.replace(u'–', u'-').replace(u'—', u'-').split())

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
    _NativeMedium, _NativeSmall = EveLabelMedium, EveLabelSmall

    def _widget(factory, **kwargs):
        for key in ('text', 'label', 'hint'):
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
        return _widget(_NativeMedium, **kwargs)

    def EveLabelSmall(**kwargs):
        kwargs.setdefault('fontsize', 15)
        return _widget(_NativeSmall, **kwargs)

    class AutoMiningWindow(Window):
        default_windowID = 'EveJSAutoMiningSettings'
        default_caption = 'AutoMining'
        default_width = 740
        default_height = 800
        default_minSize = (660, 650)
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
            self._selected = []
            self._stationID = 0
            self._stationResult = None
            self._stationRows = []
            self._localizedStationLanguage = None
            self._localizedStationNames = []
            self._stationOperationIDs = None
            self._destinationSerial = 0
            self._droneGroups = []
            Window.ApplyAttributes(self, attributes)
            self.SetCaption(_am_tr('AutoMining'))
            main = self.content
            self.statusLabel = EveLabelMedium(parent=main, align=C.TOTOP, autoFitToText=True, padBottom=8, text='Connecting to AutoMining...')
            actionRow = Container(parent=main, align=C.TOTOP, height=34)
            startWidth = button_width('Start / Resume')
            Button(parent=actionRow, align=C.TOPLEFT, width=startWidth, label='Start / Resume', func=self.Start)
            Button(parent=actionRow, align=C.TOPLEFT, left=startWidth + 8,
                   width=button_width('Stop'), label='Stop', func=self.Stop)
            EveLabelSmall(parent=main, align=C.TOTOP, autoFitToText=True, padBottom=8,
                          text='On / Off is saved per character')
            shared = main
            self.tabs = _widget(TabGroup, parent=shared, align=C.TOTOP, autoSelect=False, fontsize=15)
            footer = Container(parent=shared, align=C.TOBOTTOM, height=98, padTop=8)
            self.notice = EveLabelSmall(parent=footer, align=C.TOTOP, height=52, maxLines=3,
                                        text='Apply saves changes in all tabs. Switching tabs keeps unsaved changes.',
                                        hint='Apply saves changes in all tabs. Switching tabs keeps unsaved changes.')
            buttons = Container(parent=footer, align=C.TOALL)
            applyWidth = button_width('Apply settings')
            Button(parent=buttons, align=C.TOPLEFT, label='Apply settings', width=applyWidth, func=self.Apply)
            Button(parent=buttons, align=C.TOPLEFT, left=applyWidth + 8,
                   label='Reload', width=button_width('Reload'), func=self.Reload)
            panels = Container(parent=shared, align=C.TOALL)
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
            main = miningPanel
            filterActions = Container(parent=filterPanel, align=C.TOBOTTOM, height=42, padTop=6)
            moveUpWidth = button_width('Move up')
            Button(parent=filterActions, align=C.TOPLEFT, label='Move up', width=moveUpWidth, func=self.MoveOreUp)
            Button(parent=filterActions, align=C.TOPLEFT, left=moveUpWidth + 8,
                   label='Move down', width=button_width('Move down'), func=self.MoveOreDown)
            Button(parent=filterActions, align=C.TOPRIGHT, label='Clear filter',
                   width=button_width('Clear filter'), func=self.ClearFilter)
            EveLabelMedium(parent=returnPanel, align=C.TOTOP, height=26, text='Automatic unloading')
            self.haulToggle = Checkbox(parent=returnPanel, align=C.TOTOP, height=32, text='Unload and return to mining', checked=False, callback=self.Changed)
            EveLabelMedium(parent=returnPanel, align=C.TOTOP, autoFitToText=True, text='Ore hold trigger')
            thresholdRow = Container(parent=returnPanel, align=C.TOTOP, height=34)
            self.haulThresholdEdit = SingleLineEditInteger(parent=thresholdRow, align=C.TOPLEFT, width=70,
                                                            setvalue=95, minValue=1, maxValue=100, OnChange=self.Changed)
            EveLabelSmall(parent=thresholdRow, align=C.CENTERLEFT, left=80, text='% full (default 95)')
            EveLabelSmall(parent=returnPanel, align=C.TOTOP, autoFitToText=True, padBottom=14,
                          text='At the trigger, dock, unload, return to this mining position and resume.')
            EveLabelMedium(parent=returnPanel, align=C.TOTOP, height=24, text='Destination station')
            searchRow = Container(parent=returnPanel, align=C.TOTOP, height=34)
            findWidth = button_width('Find')
            Button(parent=searchRow, align=C.TOPRIGHT, width=findWidth, label='Find', func=self.FindStations)
            self.stationEdit = SingleLineEditText(parent=searchRow, align=C.TOTOP, padRight=findWidth + 10, height=28,
                                                  hint='Paste a station name; search covers all regions', OnChange=self.StationChanged, OnReturn=self.FindStations)
            stationActions = Container(parent=returnPanel, align=C.TOTOP, height=38, padTop=6)
            Button(parent=stationActions, align=C.TOPLEFT, width=button_width('Use current station'),
                   label='Use current station', func=self.UseCurrentStation)
            self.stationDetails = EveLabelSmall(parent=returnPanel, align=C.TOTOP, autoFitToText=True, padBottom=8, text='No station selected.')
            self.stationResults = Scroll(parent=returnPanel, align=C.TOTOP, height=120, multiSelect=False)
            self.stationResults.Load(contentList=[], noContentHint=_am_tr('Find a station, then select the matching result.'))
            EveLabelMedium(parent=returnPanel, align=C.TOTOP, height=28, padTop=10, text='Unload into')
            self.storageEdit = Combo(parent=returnPanel, align=C.TOTOP, options=[('Select a station first', '')], select='', callback=self.Changed)
            storageRow = Container(parent=returnPanel, align=C.TOTOP, height=40, padTop=8)
            Button(parent=storageRow, align=C.TOPLEFT, label='Refresh storage', func=self.RefreshStorages)
            EveLabelSmall(parent=returnPanel, align=C.TOTOP, autoFitToText=True, padBottom=14,
                          text='Personal hangar, your containers, or accessible corporation divisions.\nIf unloading fails, the ship stays docked.')
            self.holdLabel = EveLabelMedium(parent=returnPanel, align=C.TOTOP, height=28, text='Ore hold: waiting for ship data')
            self.returnStatus = EveLabelMedium(parent=returnPanel, align=C.TOTOP, autoFitToText=True, padBottom=8, text='Automatic hauling is off.')
            EveLabelSmall(parent=returnPanel, align=C.TOTOP, autoFitToText=True, padBottom=12,
                          text='Autopilot follows your route settings. Manual travel cancels the trip.')
            cancelRow = Container(parent=returnPanel, align=C.TOTOP, height=34)
            self.cancelReturn = Button(parent=cancelRow, align=C.TOPLEFT, label='Cancel return', func=self.CancelReturn)
            self._toggles = {}
            EveLabelMedium(parent=miningDronesPanel, align=C.TOTOP, height=30, text='Automatic mining drone orders')
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
            EveLabelMedium(parent=dronesPanel, align=C.TOTOP, height=26, text='At the mining site')
            self._toggles['launchDrones'] = Checkbox(parent=dronesPanel, align=C.TOTOP, height=32,
                text='Launch drones on arrival', checked=False, callback=self.Changed,
                hint='Launch the selected group on arrival at a mining location while AutoMining is on, or when you click Start / Resume there.')
            EveLabelSmall(parent=dronesPanel, align=C.TOTOP, autoFitToText=True, padBottom=14,
                text='Choose an existing drone group, such as Fighters or Miners.')
            EveLabelMedium(parent=dronesPanel, align=C.TOTOP, height=26, text='Drone group to launch')
            self.droneGroupEdit = Combo(parent=dronesPanel, align=C.TOTOP, options=[('Choose a drone group', '')], select='', callback=self.Changed)
            droneButtons = Container(parent=dronesPanel, align=C.TOTOP, height=42, padTop=8)
            Button(parent=droneButtons, align=C.TOPLEFT, label='Refresh groups', func=self.RefreshDroneGroups)
            EveLabelMedium(parent=dronesPanel, align=C.TOTOP, height=26, text='Before travel')
            self._toggles['recallDrones'] = Checkbox(parent=dronesPanel, align=C.TOTOP, height=32,
                text='Recall drones before warp / dock', checked=True, callback=self.Changed,
                hint='Wait for controlled drones to reach the bay before manual warp/dock or hauling departure. Works while mining is off. Stop cancels a pending departure.')
            EveLabelSmall(parent=dronesPanel, align=C.TOTOP, autoFitToText=True, padBottom=14,
                text='Wait for mining and combat drones to reach the bay, then continue travel.\nFleet warp waits for the members too.')
            self.droneStatus = EveLabelMedium(parent=dronesPanel, align=C.TOTOP, autoFitToText=True, text='Automatic launch is off.')
            EveLabelMedium(parent=dronesPanel, align=C.TOTOP, height=28, padTop=12, text='Rat response')
            self._toggles['ratDefenseEnabled'] = Checkbox(parent=dronesPanel, align=C.TOTOP, height=32,
                text='Rats detected: switch to fighter drones', checked=False, callback=self.Changed,
                hint='Recall the selected mining group, launch the selected fighter group, then restore miners after rats leave the grid.')
            EveLabelSmall(parent=dronesPanel, align=C.TOTOP, autoFitToText=True, padBottom=8,
                text='The selected fighter group returns afterward, unless it is your standard arrival group.')
            EveLabelMedium(parent=dronesPanel, align=C.TOTOP, height=24, text='Mining group to recall / restore')
            self.ratMiningGroupEdit = Combo(parent=dronesPanel, align=C.TOTOP, options=[('Choose a mining group', '')], select='', callback=self.Changed)
            EveLabelMedium(parent=dronesPanel, align=C.TOTOP, height=24, text='Fighter group to launch')
            self.ratFighterGroupEdit = Combo(parent=dronesPanel, align=C.TOTOP, options=[('Choose a fighter group', '')], select='', callback=self.Changed)
            self.ratStatus = EveLabelSmall(parent=dronesPanel, align=C.TOTOP, autoFitToText=True, padTop=8, text='Rat response is off.')
            EveLabelMedium(parent=defensePanel, align=C.TOTOP, height=30, text='Emergency retreat')
            self._toggles['defenseEnabled'] = Checkbox(parent=defensePanel, align=C.TOTOP, height=34,
                text='Retreat to station when ship health is low', checked=False, callback=self.Changed)
            EveLabelSmall(parent=defensePanel, align=C.TOTOP, autoFitToText=True, padBottom=16,
                text='Uses the destination and storage selected in Return to station. After unloading, AutoMining stays off.')
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
            EveLabelMedium(parent=boostersPanel, align=C.TOTOP, height=30, text='Mining fleet boosts')
            self._toggles['autoBoost'] = Checkbox(parent=boostersPanel, align=C.TOTOP, height=34,
                text='Activate online mining command bursts', checked=False, callback=self.Changed,
                hint='Works on boosting ships without mining lasers. Requires fitted, online mining command burst modules and their charges.')
            self._toggles['inviteFleet'] = Checkbox(parent=boostersPanel, align=C.TOTOP, height=34,
                text='Invite nearby AutoMining pilots to fleet', checked=False, callback=self.Changed,
                hint='Invite and automatically accept AutoMining pilots on the same grid after undocking, before warping to the mining site.')
            EveLabelSmall(parent=boostersPanel, align=C.TOTOP, autoFitToText=True, padBottom=14,
                text='Start AutoMining on the booster and miners. Fleet invites run after undocking. Mining boosts begin 5 seconds after the booster arrives at a mining site.')
            self.boostStatus = EveLabelMedium(parent=boostersPanel, align=C.TOTOP, autoFitToText=True, text='Automatic mining boosts are off.')
            EveLabelMedium(parent=main, align=C.TOTOP, height=26, text='Targeting')
            for pairs in [(('lock', 'Lock targets automatically'), ('approach', 'Approach out-of-range ore'))]:
                row = Container(parent=main, align=C.TOTOP, height=30)
                for key, label in pairs:
                    cell = Container(parent=row, align=C.TOLEFT_PROP, width=0.5)
                    self._toggles[key] = Checkbox(parent=cell, text=label, checked=False, callback=self.Changed)
            EveLabelMedium(parent=main, align=C.TOTOP, autoFitToText=True, text='Target priority')
            self.orderEdit = Combo(parent=main, align=C.TOTOP, options=[('Nearest first', 'nearest'), ('Furthest first', 'furthest'), ('Largest volume first', 'largest'), ('Smallest volume first', 'smallest')], select='nearest', callback=self.Changed)
            self.scopeLabel = EveLabelMedium(parent=main, align=C.TOTOP, autoFitToText=True, padBottom=6, text='')
            self.priorityHint = EveLabelSmall(parent=main, align=C.TOTOP, autoFitToText=True, padBottom=8, text='')
            EveLabelMedium(parent=main, align=C.TOTOP, height=26, text='Mining support')
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
                          text=text(_am_tr('Add in priority order, or use Move up / Move down. Double-click to move one.\nA group mines IV > III > II > base; target priority breaks ties within a grade.')))
            picker = Container(parent=filterPanel, align=C.TOALL, padBottom=8)
            leftHalf = Container(parent=picker, align=C.TOLEFT_PROP, width=0.5)
            arrows = Container(parent=leftHalf, align=C.TORIGHT, width=52)
            arrowButtons = Container(parent=arrows, align=C.CENTER, width=42, height=78)
            Button(parent=arrowButtons, align=C.TOPLEFT, width=40, label=text('>'), hint='Add selected ores to the filter', func=self.AddOres)
            Button(parent=arrowButtons, align=C.TOPLEFT, top=42, width=40, label=text('<'), hint='Remove selected ores from the filter', func=self.RemoveOres)
            available = Container(parent=leftHalf, align=C.TOALL, padRight=6)
            selected = Container(parent=picker, align=C.TOALL)
            self.availableLabel = EveLabelMedium(parent=available, align=C.TOTOP, height=24, text='Available ores')
            self.selectedLabel = EveLabelMedium(parent=selected, align=C.TOTOP, height=24, text='Mining order (top first)')
            self.availableSearch = SingleLineEditText(parent=available, align=C.TOTOP, height=28, padBottom=6, hint='Search available ore, ice or gas', OnChange=self.Search)
            self.selectedSearch = SingleLineEditText(parent=selected, align=C.TOTOP, height=28, padBottom=6, hint='Search active filter', OnChange=self.Search)
            self.availableScroll = Scroll(parent=available, align=C.TOALL, multiSelect=True)
            self.selectedScroll = Scroll(parent=selected, align=C.TOALL, multiSelect=True)
            self.tabs.Startup([(_am_tr('Mining'), miningTab, None, 'mining'), (_am_tr('Mining drones'), miningDronesTab, None, 'miningdrones'), (_am_tr('Mining Filter'), filterPanel, None, 'filter'), (_am_tr('Drones'), dronesTab, None, 'drones'), (_am_tr('Defense'), defenseTab, None, 'defense'), (_am_tr('Boosters'), boostersTab, None, 'boosters'), (_am_tr('Return to station'), returnTab, None, 'return')], groupID='AutoMiningTabs', autoselecttab=1)
            self._loading = False
            self.UpdatePriorityHint()
            _am_uthread.new(self.Refresh, True)
            _am_uthread.new(self.Poll)
            self.RefreshDroneGroups()

        def SetNotice(self, message):
            self.notice.text = message
            self.notice.hint = message

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
            if self._loading:
                return
            self._stationID = 0
            self._stationResult = None
            self._destinationSerial += 1
            self.stationDetails.text = _am_tr('Station name changed. Click Find to resolve it.')
            self.storageEdit.LoadOptions([(_am_tr('Select a station first'), '')], select='')
            self.Changed()

        def FindStations(self, *args):
            _am_uthread.new(self.FindStationsWork)

        def FindStationsWork(self):
            if self._busy or not self.ValidCharacter():
                return
            self._busy = True
            serial = self._destinationSerial
            try:
                query = self.stationEdit.GetValue().strip()
                response = self.Request('AutoMiningFindStations', query)
                localMatches, localMore = self.LocalStationMatches(query)
                rows = dict((row['stationID'], row) for row in response['stations'])
                missing = [stationID for stationID, name in localMatches if stationID not in rows]
                if missing:
                    resolved = self.Request('AutoMiningResolveStations', _am_json.dumps(missing))
                    for row in resolved['stations']:
                        rows[row['stationID']] = row
                if serial != self._destinationSerial:
                    return
                key = station_search_key(query)
                ranked = []
                for row in rows.values():
                    stationID = row['stationID']
                    shown = self.LocalizeStationRow(row)
                    exact = key == station_search_key(row['name']) or key == station_search_key(shown['name'])
                    ranked.append((not exact, station_search_key(shown['name']), stationID, shown))
                ranked.sort()
                self._stationRows = [entry[3] for entry in ranked[:30]]
                entries = [GetFromClass(Generic, {'label': text(row['name'] + ' | ' + row['systemName'] + ' / ' + row['regionName']), 'station': row, 'OnClick': self.SelectStation}) for row in self._stationRows]
                self.stationResults.Load(contentList=entries, noContentHint=_am_tr('No matching stations.'))
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
            self.SetStation(entry.sr.node.station)

        def SetStation(self, row, storage=None):
            self._loading = True
            sameStation = self._stationID == row['stationID']
            self._stationID = row['stationID']
            self._stationResult = row
            self.stationEdit.SetValue(row['name'], docallback=False)
            self.stationDetails.text = self.StationDescription(row)
            if storage is not None and not sameStation:
                self.storageEdit.LoadOptions([(_am_tr('Personal item hangar'), 'personal')], select=storage)
            self._destinationSerial += 1
            self._loading = False
            self.Changed()
            self.RefreshStorages()

        def UseCurrentStation(self, *args):
            _am_uthread.new(self.UseCurrentStationWork)

        def UseCurrentStationWork(self):
            if self._busy or not self.ValidCharacter():
                return
            stationID = int(getattr(session, 'structureid', None) or getattr(session, 'stationid', None) or 0)
            if stationID <= 0:
                self.SetNotice(_am_tr('Dock at a station to use your current station.'))
                return
            self._busy = True
            serial = self._destinationSerial
            row = None
            try:
                response = self.Request('AutoMiningResolveStations', _am_json.dumps([stationID]))
                if serial == self._destinationSerial and int(getattr(session, 'structureid', None) or getattr(session, 'stationid', None) or 0) == stationID:
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
                storage = self.storageEdit.GetValue() if self._stationID == stationID else 'personal'
                self.SetStation(row, storage or 'personal')
                self.SetNotice(_am_tr('Current station selected. Choose or confirm unload storage.'))

        def RefreshStorages(self, *args):
            _am_uthread.new(self.RefreshStoragesWork)

        def RefreshStoragesWork(self):
            if self._busy or not self._stationID or not self.ValidCharacter():
                return
            self._busy = True
            serial = self._destinationSerial
            try:
                selected = self.storageEdit.GetValue()
                response = self.Request('AutoMiningStorages', self._stationID)
                if serial != self._destinationSerial:
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
                self.storageEdit.LoadOptions(options, select=selected)
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

        def ShowResponse(self, response, replaceDraft=False):
            status = ('<b>%s</b> - ' % _am_tr('ON' if response['enabled'] else 'OFF')) + text(_am_status(response['status']))
            if self.statusLabel.text != status:
                self.statusLabel.text = status
                self.statusLabel.hint = status
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
            if 'catalog' in response:
                names = dict((row['name'].lower(), row['name']) for row in response['catalog'])
                self._catalog = {}
                for key, name in names.items():
                    if key.endswith(' 0-grade') and key[:-8] in names:
                        self._catalog[key] = name[:-8]
                    elif key + ' 0-grade' in names:
                        self._catalog[key] = name + _am_tr(' (group)')
                    else:
                        self._catalog[key] = name
            if not replaceDraft and (self._dirty or self._revision == response['revision']):
                return
            if replaceDraft or not self._dirty:
                self._loading = True
                prefs = response['settings']
                self._revision = response['revision']
                self._selected = []
                for key in prefs['ores']:
                    if key not in self._selected:
                        self._selected.append(key)
                for key, widget in self._toggles.items():
                    widget.SetChecked(prefs.get(key, key in ('recallDrones', 'defenseShieldEnabled')), report=False)
                self.orderEdit.SelectItemByValue(prefs['order'])
                self.mineDroneOrderEdit.SelectItemByValue(prefs.get('mineDroneOrder', 'nearest'))
                self.mineDroneModeEdit.SelectItemByValue(prefs.get('mineDroneMode', 'spread'))
                self.timerEdit.SetValue(prefs['surveySeconds'], docallback=False)
                self.LoadDroneGroups(prefs.get('droneGroupKey', ''), prefs.get('ratMiningGroupKey', ''), prefs.get('ratFighterGroupKey', ''))
                self.haulToggle.SetChecked(prefs.get('haulEnabled', False), report=False)
                self.haulThresholdEdit.SetValue(prefs.get('haulThreshold', 95), docallback=False)
                self.defenseShieldEdit.SetValue(prefs.get('defenseShieldThreshold', 30), docallback=False)
                self.defenseArmorEdit.SetValue(prefs.get('defenseArmorThreshold', 30), docallback=False)
                self._stationID = prefs.get('stationID', 0)
                self._stationResult = self.LocalizeStationRow(response.get('destination'))
                self._destinationSerial += 1
                self.stationEdit.SetValue((self._stationResult or {}).get('name', ''), docallback=False)
                self.stationDetails.text = self.StationDescription(self._stationResult)
                savedStorage = response.get('storage')
                self.storageEdit.LoadOptions([(_am_storage_label(savedStorage['label']), savedStorage['key'])] if savedStorage else [(_am_tr('Select storage'), '')], select=savedStorage['key'] if savedStorage else '')
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
                        self.SetNotice(_am_tr('Settings loaded. Choose your ores and click Apply.'))
            except Exception as error:
                if self.ValidCharacter():
                    self.SetNotice(text(_am_status(error)))
            finally:
                self._busy = False

        def Changed(self, *args):
            if not self._loading:
                self.UpdatePriorityHint()
                self._dirty = True
                self._editSerial += 1
                if hasattr(self, 'notice'):
                    self.SetNotice(_am_tr('Unsaved changes. Click Apply, or Reload to discard.'))

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
            available = [(key, label) for key, label in self._catalog.items() if key not in self._selected]
            active = [(key, self._catalog.get(key, key)) for key in self._selected]
            availableQuery = self.availableSearch.GetValue().strip().lower()
            suffix = _am_tr(' (group)')
            available.sort(key=lambda row: (row[1].lower().replace(suffix, ''), 0 if row[1].endswith(suffix) else 1))
            availableEntries = [GetFromClass(Generic, {'label': text(label), 'oreKey': key, 'fontsize': 15, 'vspace': 10,
                                                       'OnDblClick': self.AddOreDoubleClick})
                                for key, label in available if availableQuery in label.lower()]
            self._visibleAvailable = availableEntries
            self.availableScroll.Load(contentList=availableEntries, noContentHint=_am_tr('No matching ores' if availableQuery else 'No ores remaining'))
            activeQuery = self.selectedSearch.GetValue().strip().lower()
            activeEntries = [GetFromClass(Generic, {'label': text('%d. %s' % (index, self.ActiveOreLabel(key, label))), 'oreKey': key,
                                                    'fontsize': 15, 'vspace': 10,
                                                    'OnDblClick': self.RemoveOreDoubleClick})
                             for index, (key, label) in enumerate(active, 1) if activeQuery in label.lower()]
            self.selectedScroll.Load(contentList=activeEntries, noContentHint=_am_tr('No matching ores' if activeQuery else 'No active filter'))
            self.availableLabel.text = _am_tr('Available ore / ice / gas (%s)', len(available))
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

        def Save(self, start=False):
            if self._busy or not self.ValidCharacter():
                return
            if self._revision is None:
                self.SetNotice(_am_tr('Wait for the settings to load, then try again.'))
                return
            self._busy = True
            editSerial = self._editSerial
            try:
                prefs = dict((key, bool(widget.GetValue())) for key, widget in self._toggles.items())
                prefs.update(ores=list(self._selected), order=self.orderEdit.GetValue(), surveySeconds=self.timerEdit.GetValue(),
                             mineDroneOrder=self.mineDroneOrderEdit.GetValue(), mineDroneMode=self.mineDroneModeEdit.GetValue(),
                             droneGroupKey=self.droneGroupEdit.GetValue() or '',
                             ratMiningGroupKey=self.ratMiningGroupEdit.GetValue() or '',
                             ratFighterGroupKey=self.ratFighterGroupEdit.GetValue() or '',
                             haulEnabled=bool(self.haulToggle.GetValue()), haulThreshold=self.haulThresholdEdit.GetValue(),
                             defenseShieldThreshold=self.defenseShieldEdit.GetValue(),
                             defenseArmorThreshold=self.defenseArmorEdit.GetValue(),
                             stationID=self._stationID, storageKey=self.storageEdit.GetValue() or 'personal')
                if (prefs['haulEnabled'] or prefs['defenseEnabled']) and (not self._stationID or not self.storageEdit.GetValue()):
                    raise RuntimeError(_am_tr('Choose a station and unload storage before enabling hauling or Defense.'))
                if prefs['defenseEnabled'] and not (prefs['defenseShieldEnabled'] or prefs['defenseArmorEnabled']):
                    raise RuntimeError(_am_tr('Select shield or armor for Defense.'))
                if prefs['launchDrones'] and not prefs['droneGroupKey']:
                    raise RuntimeError(_am_tr('Select a drone group before enabling automatic launch.'))
                if prefs['inviteFleet'] and not prefs['autoBoost']:
                    raise RuntimeError(_am_tr('Turn on mining boosts before enabling fleet invites.'))
                if prefs['ratDefenseEnabled'] and (not prefs['ratMiningGroupKey'] or not prefs['ratFighterGroupKey'] or
                                                   prefs['ratMiningGroupKey'] == prefs['ratFighterGroupKey']):
                    raise RuntimeError(_am_tr('Select different mining and fighter groups for rat response.'))
                response = self.Request('AutoMiningSetSettings', _am_json.dumps({'settings': prefs, 'revision': self._revision}))
                editedDuringSave = editSerial != self._editSerial
                self.ShowResponse(response, not editedDuringSave)
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
            except Exception as error:
                if self.ValidCharacter():
                    self.SetNotice(text(_am_status(error)))
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
