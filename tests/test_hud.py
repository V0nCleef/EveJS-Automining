"""Authored HUD behavior with UI/RPC stand-ins; not an in-game rendering test."""
import json,sys,types
from pathlib import Path
ns=types.SimpleNamespace
def module(name, **attributes):
    if '.' in name and name.rpartition('.')[0] not in sys.modules:module(name.rpartition('.')[0])
    m=types.ModuleType(name);m.__dict__.update(attributes);sys.modules[name]=m
    if '.' in name:setattr(sys.modules[name.rpartition('.')[0]],name.rpartition('.')[2],m)
    return m
widgets=[]
class Widget:
    def __init__(self,**kw):
        self.__dict__.update(kw);self.value=kw.get('setvalue',kw.get('checked',kw.get('select','')));self.text=kw.get('text','');self.entries=[];self.selected=[];self.loads=0;widgets.append(self)
    def SetValue(self,value,docallback=True):self.value=value
    def GetValue(self):return self.value
    def SetChecked(self,value,report=True):self.value=value
    def SelectItemByValue(self,value):self.value=value
    def Load(self,contentList,noContentHint):self.entries=contentList;self.loads+=1;self.selected=[]
    def GetSelected(self):return self.selected
    def LoadOptions(self, entries, select=None):self.options=entries;self.value=select
    def Startup(self, tabs, **kwargs):self.tabs=tabs
    def SelectByIdx(self, index):self.index=index

class ScrollContainer(Widget):
    def __init__(self,**kw):
        super().__init__(**kw)
        self.mainCont=Widget(parent=self)
class Window:
    def ApplyAttributes(self,attrs):self.content=Widget();self.destroyed=False
    def Close(self):self.destroyed=True
    def SetCaption(self,value):self.caption=value
module('carbonui',uiconst=ns(**{name:name for name in ['SCOPE_INGAME','TOTOP','TOBOTTOM','TOLEFT_PROP','TOPLEFT','TOPRIGHT','TORIGHT','TOALL','CENTER','CENTERLEFT','CENTERRIGHT','UI_HIDDEN','UI_NORMAL']}))
module('carbonui.control.window',Window=Window)
for name,cls in [('tabGroup','TabGroup'),('button','Button'),('checkbox','Checkbox'),('combo','Combo'),('singlelineedits.singleLineEditText','SingleLineEditText'),('singlelineedits.singleLineEditInteger','SingleLineEditInteger')]:module('carbonui.control.'+name,**{cls:Widget})
module('carbonui.primitives.container',Container=Widget)
module('carbonui.control.scrollContainer',ScrollContainer=ScrollContainer)
module('eve.client.script.ui.control.eveLabel',EveLabelMedium=Widget,EveLabelSmall=Widget)
module('eve.client.script.ui.control.eveScroll',Scroll=Widget)
module('eve.client.script.ui.control.entries.generic',Generic=object)
module('eve.client.script.ui.control.entries.util',GetFromClass=lambda cls,d:ns(**d))
module('threadutils',BeNice=lambda _:None)
module('carbon.common.script.util.commonutils',StripTags=lambda value:value)
station_names={'EN':'Penirgman V - Moon 3 - Ishukone Corporation Factory',
               'ZH':'佩尼尔格曼 V - 卫星 3 - 异株湖集团 工厂',
               'FR':'Penirgman V - Lune 3 - Usine Ishukone',
               'JA':'ペニルグマン V - 衛星 3 - イシュコネ工場',
               'DE':'Penirgman V - Moon 3 - Ishukone Corporation Fabrik',
               'ES':'Penirgman V - Luna 3 - Fábrica Ishukone',
               'IT':'Penirgman V - Luna 3 - Fabbrica Ishukone',
               'RU':'Пениргман V - Луна 3 - Фабрика Ишукона',
               'KO':'페니르그만 V - 위성 3 - 이슈코네 공장'}
class StationNameCache:
    @classmethod
    def instance(cls):return cls()
    def query(self,query):return iter(self)
    # Eve's actual cache uses cfg.evelocations.locationName, which stays English.
    def __iter__(self):return iter([(600,station_names['EN'])])
module('eveui.autocomplete.location.provider',StationNameCache=StationNameCache)
messages=[];module('player_messaging.client.ui_message',message_player=messages.append)
class Service:__notifyevents__=[]
prefs=dict(ores=[],order='nearest',approach=False,lock=True,survey=False,compress=False,surveySeconds=60)
state=dict(success=True,settings=prefs,revision='r0',enabled=False,status='AutoMining is off.')
catalog=[dict(name=name,kind='ore') for name in ['Veldspar','Veldspar 0-Grade','Veldspar II-Grade','Veldspar III-Grade','Veldspar IV-Grade','Dense Veldspar','Scordite']]
calls=[]
class Remote:
    def AutoMiningGetState(self,include):
        calls.append(('read',include));return json.dumps(dict(state,**({'catalog':catalog} if include else {})))
    def AutoMiningSetSettings(self,raw):
        p=json.loads(raw);calls.append(('save',p))
        if p['revision']!=state['revision']:return json.dumps(dict(success=False,message='Settings changed elsewhere. Click Reload.'))
        state.update(settings=p['settings'],revision=state['revision']+'1',message='Saved.');return json.dumps(state)
    def AutoMiningControl(self,command):
        calls.append(('control',command));state.update(enabled=command=='on',message=command);return json.dumps(state)
    def AutoMiningFindStations(self,query):
        calls.append(('find',query))
        row=dict(stationID=600,name=station_names['EN'],systemID=30,systemName='Penirgman',regionID=1,regionName='Domain')
        structure=dict(stationID=9001,kind='structure',name='Home Upwell',systemID=30,systemName='Penirgman',regionID=1,regionName='Domain')
        matches=[candidate for candidate in (row,structure) if query.lower() in candidate['name'].lower()]
        return json.dumps(dict(success=True,stations=matches,moreStations=False))
    def AutoMiningResolveStations(self,raw):
        ids=json.loads(raw);calls.append(('resolve',ids))
        rows=[dict(stationID=600,name=station_names['EN'],systemID=30,systemName='Penirgman',regionID=1,regionName='Domain') for item in ids if item==600]
        rows += [dict(stationID=9001,kind='structure',name='Home Upwell',systemID=30,systemName='Penirgman',regionID=1,regionName='Domain') for item in ids if item==9001]
        return json.dumps(dict(success=True,stations=rows))
    def AutoMiningStorages(self,stationID):
        calls.append(('storages',stationID))
        return json.dumps(dict(success=True,storages=[dict(key='personal',label='Personal item hangar'),dict(key='corp:777:116',label='Corporation - Ore')]))
queued=[];session=ns(charid=42)
session.languageID='EN'
station_row=ns(stationID=600,stationName=station_names['EN'],solarSystemID=30,ownerID=9)
class StationRows(list):
    def Get(self,stationID):return next(row for row in self if row.stationID==stationID)
operation_queries=[]
class StationDB:
    def execute(self,sql):
        operation_queries.append(sql)
        assert sql=='SELECT stationID, operationID FROM npcStations'
        return [dict(stationID=600,operationID=4)]
cfg=ns(evelocations=ns(Get=lambda itemID:ns(locationName=station_names['EN'] if itemID==600 else {30:'Penirgman',1:'Domain'}[itemID])),
       stations=StationRows([station_row]),
       mapObjectsDb=StationDB(),
       GetNpcStationName=lambda stationID,solarSystemID,ownerID,operationID:station_names[session.languageID] if operationID==4 else None)
scope=dict(unicode=str,EveCommandService=Service,session=session,cfg=cfg,sm=ns(RemoteSvc=lambda _:Remote()),_am_json=json,_am_uthread=ns(new=lambda f,*args:queued.append((f,args))),_am_blue=ns())
root=Path(__file__).resolve().parents[1]
exec((root / 'client/i18n.py').read_text(encoding='utf-8'),scope)
locales=json.loads((root / 'client/locales.json').read_text(encoding='utf-8'))
patterns=json.loads((root / 'client/statusPatterns.json').read_text(encoding='utf-8'))
scope['_AM_TRANSLATIONS']={lang:dict(zip(locales['keys'],rows)) for lang,rows in locales['translations'].items()}
scope['_AM_PATTERN_TRANSLATIONS']={lang:list(zip([p['regex'] for p in patterns['patterns']],rows)) for lang,rows in patterns['translations'].items()}
exec((root / 'client/hud.py').read_text(),scope)
cls=scope['_am_build_window_class']();w=cls();w.ApplyAttributes({});w.Refresh(True)
assert not w._toggles['survey'].GetValue() and w.timerEdit.GetValue()==60
assert [value for label,value in w.orderEdit.options]==['nearest','furthest','largest','smallest']
w.orderEdit.SelectItemByValue('largest');w.Changed()
assert w.scopeLabel.text=='Search area: within mining range'
assert 'largest to smallest' in w.priorityHint.text and 'outside effective mining range' in w.priorityHint.text
w._toggles['approach'].SetChecked(True);w.Changed()
assert w.scopeLabel.text=='Search area: whole current belt'
assert 'one end' in w.priorityHint.text and 'not ISK' in w.priorityHint.text
w.Save();assert state['settings']['order']=='largest' and state['settings']['approach']
w.orderEdit.SelectItemByValue('smallest');w.Changed()
assert 'smallest to largest' in w.priorityHint.text
w.Refresh(True);assert w.orderEdit.GetValue()=='largest'
assert len(w.availableScroll.entries)==7 and not w.selectedScroll.entries
assert all(entry.fontsize == 15 and entry.vspace == 10 for entry in w.availableScroll.entries)
assert [tab[0] for tab in w.tabs.tabs] == ['Mining', 'Mining drones', 'Mining Filter', 'Drones', 'Defense', 'Boosters', 'Return to station']
assert w.availableScroll.parent.parent.parent.parent is w.tabs.tabs[2][1]
# The native ScrollContainer redirects directly parented controls into its
# auto-sized content. Parenting to mainCont bypasses that redirection and
# leaves the whole tab clipped/blank in the actual client.
assert w._toggles['lock'].parent.parent.parent is w.tabs.tabs[0][1]
assert w._toggles['mineDrones'].parent is w.tabs.tabs[1][1]
assert w.haulToggle.parent is w.tabs.tabs[6][1]
assert w._toggles['defenseEnabled'].parent is w.tabs.tabs[4][1]
assert w.tabs.fontsize == 15
assert w.statusLabel.fontsize == 16
assert w.notice.fontsize == 15
assert w._toggles['mineDrones'].GetValue() is False
w._toggles['mineDrones'].SetChecked(True);w.mineDroneOrderEdit.SelectItemByValue('furthest')
w.mineDroneModeEdit.SelectItemByValue('focus');w.Changed();w.Save()
assert state['settings']['mineDrones'] is True and state['settings']['mineDroneOrder']=='furthest'
assert state['settings']['mineDroneMode']=='focus'
w.availableSearch.SetValue('veldspar');w.Search()
assert [(n.label,n.oreKey) for n in w.availableScroll.entries if n.oreKey in ('veldspar','veldspar 0-grade')] == [
    ('Veldspar (group)','veldspar'),('Veldspar','veldspar 0-grade')]
w.availableSearch.SetValue('');w.Search()
w.availableScroll.selected=[n for n in w.availableScroll.entries if n.oreKey=='scordite'];w.AddOres()
assert [n.oreKey for n in w.selectedScroll.entries]==['scordite']
assert w.selectedScroll.entries[0].fontsize == 15 and w.selectedScroll.entries[0].vspace == 10
assert 'scordite' not in [n.oreKey for n in w.availableScroll.entries]
group=next(n for n in w.availableScroll.entries if n.oreKey=='veldspar')
group.OnDblClick(ns(sr=ns(node=group)))
assert w._selected==['scordite','veldspar']
assert [n.label for n in w.selectedScroll.entries]==['1. Scordite','2. Veldspar (group)  IV &gt; III &gt; II &gt; base']
w.selectedScroll.selected=[next(n for n in w.selectedScroll.entries if n.oreKey=='veldspar')]
w.MoveOreUp()
assert w._selected==['veldspar','scordite']
assert [n.label for n in w.selectedScroll.entries]==['1. Veldspar (group)  IV &gt; III &gt; II &gt; base','2. Scordite']
w.availableSearch.SetValue('dense');w.Search();assert len(w.availableScroll.entries)==1
w.Refresh(False);assert w._dirty and 'scordite' in w._selected
w.timerEdit.SetValue(30);w.haulThresholdEdit.SetValue(80);w._toggles['survey'].SetChecked(True);w.Save(start=True)
assert state['enabled'] and state['settings']['ores']==['veldspar','scordite'] and state['settings']['surveySeconds']==30
assert state['settings']['haulThreshold']==80
assert not w._dirty
group=next(n for n in w.selectedScroll.entries if n.oreKey=='veldspar')
group.OnDblClick(ns(sr=ns(node=group)))
assert w._selected==['scordite']
loads=w.availableScroll.loads;w.Refresh();assert w.availableScroll.loads==loads
w.selectedScroll.selected=list(w.selectedScroll.entries);w.RemoveOres();assert not w._selected
w.Save();assert state['settings']['ores']==[]
w.StopWork();assert not state['enabled']
w.ClearFilter();state['revision']='external';w.Save();assert w._dirty and 'changed elsewhere' in w.notice.text
w.Reload();queued[-1][0](*queued[-1][1]);assert not w._dirty
Service().OnAutoMiningFeedback('AutoMining SURVEY OFF.');assert messages[-1]=='AutoMining SURVEY OFF.'
# New controls preserve mining explanations and shared dirty drafts.
assert w._toggles['recallDrones'].GetValue() is True
w._toggles['recallDrones'].SetChecked(False);w.Changed();w.Save()
assert state['settings']['recallDrones'] is False
w._toggles['recallDrones'].SetChecked(True);w.Changed();w.Save()
assert state['settings']['recallDrones'] is True
w.stationEdit.SetValue('Jita');w.StationChanged()
assert w._stationID == 0 and w._dirty
w.haulToggle.SetChecked(True)
prior=len(calls);w.Save()
assert len(calls)==prior and 'Choose a station' in w.notice.text
w._stationID=600;w._stationResult=dict(name='Jita IV',systemName='Jita',regionName='The Forge')
w.storageEdit.LoadOptions([('Corporation - Ore', 'corp:777:116')],select='corp:777:116')
w.tabs.SelectByIdx(1)
w.Save()
assert state['settings']['haulEnabled'] and state['settings']['stationID']==600
assert state['settings']['storageKey']=='corp:777:116'
assert state['settings']['haulThreshold']==80
w.stationEdit.SetValue('Amarr');w.StationChanged()
assert w._stationID==0 and not w.storageEdit.GetValue()
assert w._dirty
w.tabs.SelectByIdx(0)
assert w.stationEdit.GetValue()=='Amarr' and w._dirty
count=len(calls);session.charid=43;w.Save();assert w.destroyed and len(calls)==count
print('PASS: HUD construction, dual searchable lists, add/remove/clear, no duplicates, draft preservation, apply/start/stop, seconds field, stale-save rejection, unchanged-list redraw avoidance, direct feedback, and character-change closure. Native rendering remains untested.')

assert w._toggles['recallDrones'].parent is w.tabs.tabs[3][1]
assert w._toggles['launchDrones'].parent is w.tabs.tabs[3][1]
assert w._toggles['ratDefenseEnabled'].parent is w.tabs.tabs[3][1]
assert w._toggles['autoBoost'].parent is w.tabs.tabs[5][1]
assert w._toggles['inviteFleet'].parent is w.tabs.tabs[5][1]
session.charid=42;w.destroyed=False;w.haulToggle.SetChecked(False)
group_key=json.dumps(['Miners','123'],separators=(',',':'))
scope['_am_drone_groups']=lambda:[(group_key,'Miners')]
w.RefreshDroneGroupsWork();w.droneGroupEdit.SelectItemByValue(group_key)
w._toggles['launchDrones'].SetChecked(True);w.Changed();w.Save()
assert state['settings']['launchDrones'] and state['settings']['droneGroupKey']==group_key
w._dirty=True;w.RefreshDroneGroupsWork();assert w._dirty and w.droneGroupEdit.GetValue()==group_key
scope['_am_drone_groups']=lambda:[]
w.RefreshDroneGroupsWork();assert w.droneGroupEdit.GetValue()==group_key
assert 'unavailable' in w.droneGroupEdit.options[1][0]
print('PASS: Drones tab, group selection, launch/recall settings, and missing-group draft preservation.')

fighter_key=json.dumps(['Fighters','456'],separators=(',',':'))
scope['_am_drone_groups']=lambda:[(group_key,'Miners'),(fighter_key,'Fighters')]
w.RefreshDroneGroupsWork()
w.ratMiningGroupEdit.SelectItemByValue(group_key)
w.ratFighterGroupEdit.SelectItemByValue(fighter_key)
w._toggles['ratDefenseEnabled'].SetChecked(True)
w._toggles['autoBoost'].SetChecked(True)
w._toggles['inviteFleet'].SetChecked(True)
w.Changed();w.Save()
assert state['settings']['ratDefenseEnabled'] and state['settings']['ratMiningGroupKey']==group_key
assert state['settings']['ratFighterGroupKey']==fighter_key
assert state['settings']['autoBoost'] and state['settings']['inviteFleet']
print('PASS: Boosters tab and separate rat-response drone groups save through the HUD.')

session.languageID='ZH'
chinese=cls();chinese.ApplyAttributes({})
assert [tab[0] for tab in chinese.tabs.tabs] == ['采矿','采矿无人机','采矿筛选','无人机','防御','增效','返回空间站']
assert chinese.notice.text.startswith('应用将保存')
assert chinese._toggles['launchDrones'].text == '抵达后发射无人机'
assert scope['_am_status']('Paused for warp; resumes at a mining location.') == '跃迁期间暂停；抵达采矿地点后继续。'
assert scope['_am_status']('Armed - waiting for ore hold to reach 95%.') == '已就绪：等待矿石舱达到 95%。'
assert scope['_am_storage_label']('Corporation - Ore (2)') == '军团 - Ore (2)'
session.languageID='FR'
assert scope['_am_tr']('Mining') == scope['_AM_TRANSLATIONS']['fr']['Mining']
assert scope['_am_tr']('AutoMining') == scope['_AM_NAMES']['fr']
session.languageID='EN'
print('PASS: per-client Chinese HUD labels, runtime status, storage names, and English fallback.')

for language in ['ZH','FR','JA','DE','ES','IT','RU','KO']:
    session.languageID=language
    widgets[:]=[]
    localized=cls();localized.ApplyAttributes({})
    assert localized.caption==scope['_AM_NAMES'][language.lower()]
    def button_for(method):
        return next(node for node in widgets if getattr(getattr(node,'func',None),'__self__',None) is localized
                    and node.func.__name__==method)
    for first,second in [('Start','Stop'),('Apply','Reload'),('MoveOreUp','MoveOreDown')]:
        one,two=button_for(first),button_for(second)
        assert two.left >= getattr(one,'left',0) + one.width + 8,(language,first,second)
    up,down,clear=button_for('MoveOreUp'),button_for('MoveOreDown'),button_for('ClearFilter')
    assert down.left + down.width + 8 + clear.width <= 660,(language,'filter buttons exceed minimum window width')
    find=button_for('FindStations')
    assert localized.stationEdit.padRight >= find.width + 10
    localized.stationEdit.SetValue(station_names[language]);localized.StationChanged()
    localized.FindStationsWork()
    assert localized._stationRows[0]['stationID']==600
    assert localized._stationRows[0]['name']==station_names[language],(language,localized._stationRows[0]['name'])
    assert ('resolve',[600]) in calls
    localized.SelectStation(ns(sr=ns(node=ns(station=localized._stationRows[0]))))
    assert localized._stationID==600 and localized.stationEdit.GetValue()==station_names[language]
    cached_names=localized._localizedStationNames
    localized.stationEdit.SetValue(station_names['EN']);localized.StationChanged()
    localized.FindStationsWork()
    assert localized._stationRows[0]['name']==station_names[language]
    assert localized._localizedStationNames is cached_names
    assert operation_queries.count('SELECT stationID, operationID FROM npcStations')==['ZH','FR','JA','DE','ES','IT','RU','KO'].index(language)+1
session.languageID='EN'
print('PASS: localized station lookup across eight non-English client languages, English fallback and stable station IDs.')

quick=cls();quick.ApplyAttributes({});quick.Refresh(True)
session.stationid=600
quick.UseCurrentStationWork()
assert quick._stationID==600 and quick.stationEdit.GetValue()==station_names['EN']
assert quick.storageEdit.GetValue()=='personal'
assert ('resolve',[600]) in calls
quick.storageEdit.LoadOptions([('Corporation - Ore','corp:777:116')],select='corp:777:116')
quick.UseCurrentStationWork()
assert quick.storageEdit.GetValue()=='corp:777:116'
session.structureid=9001;session.stationid=0
quick.UseCurrentStationWork()
assert quick._stationID==9001 and quick.stationEdit.GetValue()=='Home Upwell'
assert quick.storageEdit.GetValue()=='personal'
quick.stationEdit.SetValue('Home Upwell');quick.StationChanged();quick.FindStationsWork()
assert quick._stationRows[0]['stationID']==9001
assert quick._stationRows[0]['name']=='Home Upwell'
quick.SelectStation(ns(sr=ns(node=ns(station=quick._stationRows[0]))))
quick.storageEdit.LoadOptions([('Personal item hangar','personal')],select='personal')
quick._toggles['defenseEnabled'].SetChecked(True)
quick._toggles['defenseShieldEnabled'].SetChecked(True)
quick._toggles['defenseArmorEnabled'].SetChecked(True)
quick.defenseShieldEdit.SetValue(30)
quick.defenseArmorEdit.SetValue(25)
quick.Changed();quick.Save()
assert state['settings']['defenseEnabled'] and state['settings']['defenseArmorThreshold']==25
assert state['settings']['defenseShieldThreshold']==30
session.stationid=0;session.structureid=0
quick.UseCurrentStationWork()
assert 'Dock at a station' in quick.notice.text
print('PASS: current-station selection preserves storage and Defense settings save independently.')
