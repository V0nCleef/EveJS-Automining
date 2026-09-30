"""Authored HUD behavior with UI/RPC stand-ins; not an in-game rendering test."""
import json,sys,types,subprocess
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
    def GetKey(self):return next((label for label,value in getattr(self,'options',[]) if value==self.value),'')
    def SetChecked(self,value,report=True):self.value=value
    def SelectItemByValue(self,value):self.value=value
    def Load(self,contentList,noContentHint):self.entries=contentList;self.loads+=1;self.selected=[]
    def GetSelected(self):return self.selected
    def LoadOptions(self, entries, select=None):self.options=entries;self.value=select
    def Startup(self, tabs, **kwargs):self.tabs=tabs
    def SelectByIdx(self, index):self.index=index
    def Flush(self):self.entries=[]
    def Close(self):self.destroyed=True
    def SetOrder(self,index):self.order=index
    def SetFocus(self):self.focused=True
    def LoadIconByTypeID(self,typeID,**kwargs):self.typeID=typeID

class ScrollContainer(Widget):
    def __init__(self,**kw):
        super().__init__(**kw)
        self.mainCont=Widget(parent=self)
class Window:
    def ApplyAttributes(self,attrs):self.content=Widget();self.destroyed=False
    def Close(self):self.destroyed=True
    def SetCaption(self,value):self.caption=value
module('carbonui',uiconst=ns(**{name:name for name in ['SCOPE_INGAME','TOTOP','TOBOTTOM','TOLEFT_PROP','TOPLEFT','TOPRIGHT','TORIGHT','TOALL','CENTER','CENTERLEFT','CENTERRIGHT','UI_HIDDEN','UI_NORMAL','UI_DISABLED','YESNO','ID_YES']}))
module('carbonui.control.window',Window=Window)
for name,cls in [('tabGroup','TabGroup'),('button','Button'),('checkbox','Checkbox'),('combo','Combo'),('singlelineedits.singleLineEditText','SingleLineEditText'),('singlelineedits.singleLineEditInteger','SingleLineEditInteger')]:module('carbonui.control.'+name,**{cls:Widget})
module('carbonui.primitives.container',Container=Widget)
class AutoSizeWidget(Widget):
    def ContentHeight(self):
        children=[child for child in widgets if getattr(child,'parent',None) is self and
                  (not hasattr(self,'alignMode') or getattr(child,'align',None)==self.alignMode)]
        size=sum((child.ContentHeight() if isinstance(child,AutoSizeWidget) else getattr(child,'height',0))+
                 getattr(child,'padTop',0)+getattr(child,'padBottom',0) for child in children)
        return max(getattr(self,'minHeight',0),size)
module('carbonui.primitives.containerAutoSize',ContainerAutoSize=AutoSizeWidget)
module('carbonui.primitives.fill',Fill=Widget)
module('carbonui.primitives.frame',Frame=Widget)
module('carbonui.primitives.sprite',Sprite=Widget)
module('carbonui.control.scrollContainer',ScrollContainer=ScrollContainer)
class FixedStyleLabel(Widget):
    def __init__(self,**kw):
        assert 'fontsize' not in kw, 'Native EveStyleLabel rejects custom font sizes'
        super().__init__(**kw)
module('eve.client.script.ui.control.eveLabel',Label=Widget,EveLabelMedium=FixedStyleLabel,EveLabelSmall=FixedStyleLabel)
module('eve.client.script.ui.control.eveIcon',Icon=Widget)
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
    def AutoMiningJobProfile(self,job):
        calls.append(('profile',job))
        settings=dict(profile_contract[job]['settings'],**state['settings']);settings['job']=job
        return json.dumps(dict(state,job=job,fields=profile_contract[job]['fields'],settings=settings))
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
profile_contract=json.loads(subprocess.check_output(['node','-e',"const p=require('./lib/jobProfiles');console.log(JSON.stringify(Object.fromEntries(['mining','boosting','hauling','pve'].map(job=>[job,{fields:p.profileFields(job),settings:p.switchProfile({job},{job:'none',jobProfiles:{}})}]))));"],cwd=root))
exec((root / 'client/i18n.py').read_text(encoding='utf-8'),scope)
locales=json.loads((root / 'client/locales.json').read_text(encoding='utf-8'))
patterns=json.loads((root / 'client/statusPatterns.json').read_text(encoding='utf-8'))
scope['_AM_TRANSLATIONS']={lang:dict(zip(locales['keys'],rows)) for lang,rows in locales['translations'].items()}
scope['_AM_PATTERN_TRANSLATIONS']={lang:list(zip([p['regex'] for p in patterns['patterns']],rows)) for lang,rows in patterns['translations'].items()}
exec((root / 'client/hud.py').read_text(encoding='utf8'),scope)
cls=scope['_am_build_window_class']();w=cls();w.ApplyAttributes({});w.Refresh(True)
assert not w._jobChosen and w._page=='jobs' and w.JobPages()=={7,9}
assert [i for i,(row,_) in enumerate(w.tabs.buttons) if row.state=='UI_NORMAL']==[7,9]
assert [i for i,(_,panel,_,_) in enumerate(w.tabs.tabs) if panel.state=='UI_NORMAL']==[9]
assert w.jobSummary.state=='UI_HIDDEN' and w.settingSearch.hintText=='Find a setting...'
w.tabs.SelectByIdx(7);assert w._page=='statistics'
w.tabs.SelectByIdx(0);assert w._page=='statistics'
w.Refresh(True);assert not w._jobChosen and w._page=='statistics' and w.JobPages()=={7,9}
w.SelectJobDraft('mining')
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
assert [tab[0] for tab in w.tabs.tabs] == ['Mining', 'Mining drones', 'Mining Filter', 'Drones', 'Defense', 'Boosters', 'Ore handling', 'Statistics', 'Hauling', 'Jobs', 'PVE', 'Fleet']
assert w.availableScroll.parent.parent.parent.parent is w.tabs.tabs[2][1]
# The native ScrollContainer redirects directly parented controls into its
# auto-sized content. Parenting to mainCont bypasses that redirection and
# leaves the whole tab clipped/blank in the actual client.
assert w._toggles['lock'].parent.parent.parent is w.tabs.tabs[0][1]
assert w._toggles['mineDrones'].parent is w.tabs.tabs[1][1]
assert w.oreModeEdit.parent is w.tabs.tabs[6][1]
assert w._toggles['defenseEnabled'].parent is w.tabs.tabs[4][1]
assert len(w.tabs.buttons) == 12
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
assert 'scordite' in [n.oreKey for n in w.availableScroll.entries]  # Selected ore remains visible as a checked tile.
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
w.oreModeEdit.SelectItemByValue('unload')
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
assert w._toggles['launchDrones'].parent is w._droneArrivalPanel and w._droneArrivalPanel.parent is w.tabs.tabs[3][1]
assert w._toggles['ratDefenseEnabled'].parent is w._droneRatPanel and w._droneRatPanel.parent is w.tabs.tabs[3][1]
assert w._toggles['autoBoost'].parent is w.tabs.tabs[5][1]
assert w._toggles['inviteFleet'].parent is w.tabs.tabs[5][1]
session.charid=42;w.destroyed=False;w.oreModeEdit.SelectItemByValue('leave')
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
assert [tab[0] for tab in chinese.tabs.tabs] == ['采矿','采矿无人机','采矿筛选','无人机','防御','增效','矿石处理','统计',scope['_am_tr']('Hauling'),scope['_am_tr']('Jobs'),scope['_am_tr']('PVE'),scope['_am_tr']('Fleet')]
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
        assert two.left >= getattr(one,'left',0) + one.width + 8 or getattr(one,'left',0) >= two.left + two.width + 8,(language,first,second)
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

# Independent fuel picker must never overwrite the ore destination or storage.
original_save_settings=Remote.AutoMiningSetSettings
def save_feature_settings(self,raw):
    response=json.loads(original_save_settings(self,raw))
    if response.get('success'):
        p=response['settings']
        def station_row(stationID):
            return dict(stationID=stationID,kind='structure' if stationID==9001 else 'station',name='Home Upwell' if stationID==9001 else station_names['EN'],systemID=30,systemName='Penirgman',regionID=1,regionName='Domain') if stationID else None
        response.update(destination=station_row(p['stationID']),storage=dict(key=p['storageKey'],label='Personal item hangar'),
            fuelDestination=station_row(p['fuelStationID']),fuelStorage=dict(key=p['fuelStorageKey'],label='Personal item hangar'),
            transportDestination=station_row(p['transportStationID']),transportStorage=dict(key=p['transportStorageKey'],label='Personal item hangar'))
    return json.dumps(response)
Remote.AutoMiningSetSettings=save_feature_settings
quick.storageEdit.LoadOptions([('Personal item hangar','personal')],select='personal')
ore_id,ore_storage=quick._stationID,quick.storageEdit.GetValue()
quick.SelectJobDraft('boosting')
quick.fuelStationEdit.SetValue(station_names['EN']);quick.FuelStationChanged()
quick.FindStationsWork('fuel')
assert quick._stationID==ore_id and quick.storageEdit.GetValue()==ore_storage
fuel_node=quick.fuelStationResults.entries[0]
assert fuel_node.context=='fuel'
quick.SelectStation(ns(sr=ns(node=fuel_node)))
quick.RefreshStoragesWork('fuel')
quick.fuelStorageEdit.SelectItemByValue('personal')
quick.fuelToggle.SetChecked(True)
quick.oreModeEdit.SelectItemByValue('jettison')
quick.Changed();quick.Save()
assert state['settings']['fuelStationID']==600 and state['settings']['stationID']==ore_id, (quick.notice.text,quick._fuelStationID,state['settings'])
assert state['settings']['fuelStorageKey']=='personal' and state['settings']['storageKey']==ore_storage
assert state['settings']['oreMode']=='jettison' and not state['settings']['haulEnabled']
assert state['settings']['stackOreHold'] and state['settings']['stackFleetHangar']
assert not state['settings']['jettisonAbandon'] and state['settings']['actionNotifications']
quick.fuelTarget.SetValue(2);quick.Changed();quick.Save()
assert quick._dirty and 'must exceed reserve' in quick.notice.text
quick.fuelTarget.SetValue(20);quick.Save()

# Local search navigates to the original widget without clearing drafts.
quick.timerEdit.SetValue(42);quick.Changed()
quick.SelectJobDraft('boosting');quick.settingSearch.SetValue('fuel source');quick.FindSetting()
node=quick.settingResults.entries[0]
quick.SelectSetting(ns(sr=ns(node=node)))
assert quick._page=='boosters' and node.setting is quick.fuelStorageEdit
assert quick._dirty and quick.timerEdit.GetValue()==42
quick.settingSearch.SetValue('');quick.FindSetting()
assert quick.settingResults.state=='UI_HIDDEN'

quick.RenderIndustrial({'modules':[dict(itemID=1,typeID=28668,kind='core',defaultSeconds=75,durationSeconds=90,intervalSeconds=90,active=True,remainingSeconds=23)],'fuel':dict(quantity=100,cycles=4,targetUnits=500)},True)
editor=next(widget for widget in reversed(widgets) if getattr(widget,'hint','')=='Activation interval in seconds')
editor.SetValue(120);editor.OnChange()
assert quick._intervalDraft['core']['28668']==120
quick.RenderIndustrial({'modules':[dict(itemID=1,typeID=28668,kind='core',defaultSeconds=75,durationSeconds=90,intervalSeconds=90,active=True,remainingSeconds=22)]})
assert quick._intervalDraft['core']['28668']==120
quick.ResetInterval(dict(typeID=28668,kind='core',defaultSeconds=75,durationSeconds=90),editor)
assert quick._intervalDraft['core']['28668']==90

stats_total=dict(volume=15,units=150,moduleVolume=10,droneVolume=5,deliveries=2,docks=1,trips=1,
                 elapsedSeconds=60,averageVolumePerHour=900,ores=[dict(typeID=123,units=150,volume=15)],recent=[])
stats_payload=dict(revision=1,view='pilot',period='session',trackedSince=1000,totals=stats_total)
def remote_statistics(self,view,period):
    calls.append(('statistics',view,period));return json.dumps(dict(success=True,statistics=stats_payload))
def remote_sessions(self,offset,limit):
    calls.append(('sessions',offset,limit));return json.dumps(dict(success=True,sessions=dict(total=1,offset=offset,limit=limit,rows=[dict(started=1000,ended=61000,durationSeconds=60,totals=stats_total)])))
def remote_reset(self):
    calls.append(('reset',));return json.dumps(dict(success=True,statistics=dict(stats_payload,totals=dict(stats_total,volume=0,units=0))))
def remote_stop_fleet(self):
    calls.append(('stopFleet',));state.update(enabled=False);return json.dumps(dict(state,stopped=2,recallOrdered=5,recallFailed=1))
Remote.AutoMiningStatistics=remote_statistics;Remote.AutoMiningStatisticsSessions=remote_sessions
Remote.AutoMiningResetStatistics=remote_reset;Remote.AutoMiningStopFleet=remote_stop_fleet
quick._page='mining';before=len(calls);quick.StatisticsWork();assert len(calls)==before
quick._page='statistics';quick.StatisticsWork()
assert quick.statsCards[0].text=='15.0'
loads=quick.statsList.loads;quick.StatisticsWork();assert quick.statsList.loads==loads
quick.SessionsWork();assert quick._statsSessions and len(quick.statsList.entries)==1
quick.SessionDetail(ns(sr=ns(node=quick.statsList.entries[0])))
assert 'Docks: 1' in quick.statsDetail.text
quick.ResetStatisticsWork();assert not quick._statsSessions and quick.statsCards[0].text=='0.0'
quick.ShowResponse(dict(state,canStopFleet=True));assert quick.stopFleetButton.state=='UI_NORMAL'
sys.modules['player_messaging.client.ui_message'].prompt_player_fsd_dialog=lambda *args:'ID_YES'
quick.StopFleet();queued[-1][0](*queued[-1][1]);assert ('stopFleet',) in calls
assert 'Recall ordered: 5. Recall failures: 1.' in quick.notice.text
print('PASS: isolated fuel picker, feature drafts/defaults, setting search, fitted interval reset, active-page statistics, unchanged list redraw, saved sessions/reset and fleet-stop confirmation/RPC.')

# Reproduce the real native callback convention: controls pass themselves.
# The old lambda i=index hid every page when called with the native Button.
assert quick.settingSearch.hintText=='Find a setting for this job...'
for index,(row,marker) in enumerate(quick.tabs.buttons):
    quick.SelectJobDraft({5:'boosting',8:'hauling',10:'pve'}.get(index,'mining'))
    assert row.align=='TOPLEFT' and row.height==38
    assert row.state in ('UI_NORMAL','UI_HIDDEN')
    assert quick.tabs.labels[index].fontsize==16
    assert quick.tabs.labels[index].state=='UI_DISABLED'
    assert quick.tabs.backgrounds[index].bgParent is row
    row.OnClick(row)
    assert quick._page==quick.tabs.tabs[index][3]
    assert [panel.state for _,panel,_,_ in quick.tabs.tabs]==['UI_NORMAL' if i==index else 'UI_HIDDEN' for i in range(12)]
    assert marker.color[-1]>0 and quick.tabs.labels[index].color[-1]==1.0
    assert quick.tabs.backgrounds[index].color[-1]==0.3
active=quick.tabs.index
for invalid in (object(),None,-1,12,True,'1'):
    quick.tabs.SelectByIdx(invalid)
    assert quick.tabs.index==active
    assert sum(panel.state=='UI_NORMAL' for _,panel,_,_ in quick.tabs.tabs)==1
for background in [widget for widget in widgets if hasattr(widget,'bgParent')]:
    assert getattr(background,'state',None)=='UI_DISABLED'
print('PASS: native-style callback arguments keep exactly one page visible, invalid selection preserves page, horizontal navigation and background-only section/card fills; actual native rendering remains untested.')


# Transport drafts share a role, not destinations or storage.
quick.SelectJobDraft('boosting')
assert quick.transportThreshold.GetValue()==95 and quick.transportIdle.GetValue()==60
assert not quick.transportToggle.GetValue()
quick.boosterRole.SelectItemByValue('transport');quick.BoosterRoleChanged()
assert quick._shipRole=='transport' and quick.transportRole.GetValue()=='transport'
quick.transportRole.SelectItemByValue('boosting');quick.TransportRoleChanged()
assert quick._shipRole=='boosting' and quick.boosterRole.GetValue()=='boosting'
ore_before=(quick._stationID,quick.storageEdit.GetValue())
fuel_before=(quick._fuelStationID,quick.fuelStorageEdit.GetValue())
quick.transportStationEdit.SetValue(station_names['EN']);quick.TransportStationChanged();quick.FindStationsWork('transport')
transport_node=quick.transportStationResults.entries[0];assert transport_node.context=='transport'
quick.SelectStation(ns(sr=ns(node=transport_node)));quick.RefreshStoragesWork('transport')
quick.transportStorageEdit.SelectItemByValue('corp:777:116')
assert ore_before==(quick._stationID,quick.storageEdit.GetValue())
assert fuel_before==(quick._fuelStationID,quick.fuelStorageEdit.GetValue())
quick.transportToggle.SetChecked(True);quick.ChangeRole('transport');assert quick.Save(),(quick.notice.text,quick._job,quick.ReadSettings())
assert state['settings']['transportEnabled'] and state['settings']['job']=='boosting'
assert state['settings']['transportStationID']==600 and state['settings']['transportStorageKey']=='corp:777:116'
assert state['settings']['transportThreshold']==95 and state['settings']['transportIdleSeconds']==60
quick.RenderTransport(dict(eligible=True,dualRole=True,status='Transport ready for fleet pickup.',queue=[dict(characterID=43)]))
assert quick.transportToggle.state=='UI_NORMAL' and quick.boosterRole.state=='UI_HIDDEN'
count=quick.transportQueue.loads;quick.RenderTransport(dict(eligible=True,dualRole=True,queue=[dict(characterID=43)]));assert quick.transportQueue.loads==count
quick.RenderTransport(dict(eligible=False));assert quick.transportToggle.state=='UI_DISABLED'
def remote_pickup(self):
    calls.append(('pickup',));return json.dumps(dict(state,transport=dict(eligible=True,status='Fleet pickup requested.')))
Remote.AutoMiningTransportRequest=remote_pickup;quick.RequestPickupWork();assert ('pickup',) in calls
quick.SelectJobDraft('hauling');quick.settingSearch.SetValue('transport storage');quick.FindSetting()
assert any(node.setting is quick.transportStorageEdit for node in quick.settingResults.entries)
print('PASS: Transport role mirroring, independent third destination/storage, opt-in defaults and saved settings, eligibility, bounded queue redraw and saved-settings pickup RPC.')
quick._shipRole='boosting';quick.RenderTransport(dict(eligible=True,dualRole=False))
assert quick.transportRole.GetValue()=='' and quick._shipRole=='boosting'
assert [value for label,value in quick.transportRole.options]==['','transport']
quick.ChangeRole('transport');quick.RenderTransport(dict(eligible=True,dualRole=False))
assert [value for label,value in quick.transportRole.options]==['transport']
assert quick.boosterRole.state=='UI_HIDDEN'
quick.RenderStatistics(dict(stats_payload,totals=dict(stats_total,collectedVolume=20,deliveredVolume=10,pickups=2,transportDeliveries=1,recent=[dict(kind='pickup',at=1000,volume=20)])))
assert 'Transport collected: 20.0' in quick.statsYield.text
assert 'Fleet ore collected' in quick.statsRecent.entries[0].label
# Job cards are native argument-safe and preserve other job drafts.
quick._enabled=False;quick.timerEdit.SetValue(42);quick.Changed();quick.SelectJobDraft('pve');quick.pveOrbit.SetValue(8500);quick.Changed();quick.SelectJobDraft('boosting')
for job,page in [('mining','mining'),('hauling','transport'),('boosting','boosters'),('pve','pve')]:
    quick.jobCards[job].OnClick(quick.jobCards[job])
    if quick._job!=job:
        fn,args=queued[-1];fn(*args)
    assert quick._job==job and quick._page==page,quick.notice.text
    assert sum(panel.state=='UI_NORMAL' for _,panel,_,_ in quick.tabs.tabs)==1
    assert quick.pveOrbit.GetValue()==8500
    assert all(row.state==('UI_NORMAL' if i in quick.JobPages() else 'UI_HIDDEN') for i,(row,_) in enumerate(quick.tabs.buttons))
    quick.tabs.SelectByIdx(9);assert quick._page=='jobs'
quick.SelectJobDraft('pve');quick.settingSearch.SetValue('fuel source');quick.FindSetting();assert not quick.settingResults.entries
quick.settingSearch.SetValue('orbit');quick.FindSetting();assert any(node.setting is quick.pveOrbit for node in quick.settingResults.entries)
quick.OpenDestination();assert quick._page=='defense'
assert quick.stationEdit.parent.parent is quick.tabs.tabs[4][1]
assert quick.storageEdit.parent is quick.tabs.tabs[4][1]
assert quick.ratMiningGroupEdit.state=='UI_DISABLED'
# Running change is explicitly confirmed, stopped atomically and not auto-started.
original_settings_rpc=Remote.AutoMiningSetSettings
old_pilot_save=Remote.AutoMiningSetSettings
def jobs_settings_rpc(self,raw):
    p=json.loads(raw)
    response=json.loads(old_pilot_save(self,raw))
    if response.get('success') and p['settings']['job']!=state.get('activeJob','mining'):
        state['enabled']=False;response['enabled']=False
    state['activeJob']=p['settings']['job']
    return json.dumps(response)
Remote.AutoMiningSetSettings=jobs_settings_rpc
quick._enabled=True;state['enabled']=True;state['activeJob']='pve'
sys.modules['player_messaging.client.ui_message'].prompt_player_fsd_dialog=lambda *args:'ID_NO'
quick.OpenJob('mining');assert quick._job=='pve'
sys.modules['player_messaging.client.ui_message'].prompt_player_fsd_dialog=lambda *args:'ID_YES'
quick.OpenJob('mining');fn,args=queued[-1];fn(*args)
assert quick._job=='mining' and not quick._enabled and not state['enabled'], (quick._job,quick._enabled,state['enabled'],quick.notice.text,calls[-1])
assert state['settings']['pveOrbitOverride']==8500
assert 'Job switched.' in quick.notice.text
# PVE belt picker and settings use stable IDs.
def belts_rpc(self,query):return json.dumps(dict(success=True,belts=[dict(beltID=800,systemID=30,name='Belt A',systemName='Penirgman')]))
Remote.AutoMiningBelts=belts_rpc
Remote.AutoMiningBeltCatalog=lambda self,offset,limit:json.dumps(dict(success=True,belts=[dict(beltID=800,systemID=30,name='Belt A',systemName='Penirgman')],more=False))
session.solarsystemid=30
quick.SelectJobDraft('pve');quick.FindBeltsWork();quick.SelectBelt(ns(sr=ns(node=quick.pveBeltResults.entries[0])))
quick.SelectJobDraft('pve');quick.pveFireMode.SelectItemByValue('spread');quick.pvePriority.SelectItemByValue('weakest');quick.Changed();quick.Save()
assert state['settings']['pveBeltID']==800 and state['settings']['pveFireMode']=='spread' and state['settings']['pvePriority']=='weakest'
quick.RenderPVE(dict(automaticRange=12000,orbitRange=8500,weaponCount=3,status='Engaging hostile rats.'))
assert '12000 m' in quick.pveRange.text and '8500 m' in quick.pveRange.text
assert 'Orbit setting:' in quick.pveRange.text and 'Current orbit:' not in quick.pveRange.text
assert quick.pveEscortHelp.parent is quick.pveModePanels['escort'] and quick.pveEscortHelp.autoFitToText
# Fleet polling leaves settings clean and preserves checked roster drafts.
fleet=dict(revision='f1',status='Fleet group ready.',presets=[dict(id='g1',name='Team',characterIDs=[42])],roster=[dict(characterID=42,name='Pilot A',online=True,status='Working'),dict(characterID=43,name='Pilot B',online=False,status='Offline')])
quick._dirty=False;quick.RenderFleet(fleet);assert not quick._dirty
assert all(member.state=='UI_DISABLED' for member in quick.fleetMembers)
quick.fleetMode.SelectItemByValue('automatic');quick.FleetModeChanged();assert quick._dirty
quick.fleetPreset.SelectItemByValue('g1');quick.FleetPresetChanged()
assert quick.fleetMembers[0].GetValue()
quick.fleetMembers[1].SetChecked(True);quick.fleetMembers[1].callback(quick.fleetMembers[1])
quick.RenderFleet(dict(fleet,roster=[dict(characterID=42,name='Pilot A',online=True,status='Ready'),dict(characterID=43,name='Pilot B',online=False,status='Offline')]))
assert quick._fleetRosterDraft=={42,43} and quick.fleetMembers[1].GetValue()
def fleet_rpc(self,action,raw):
    payload=json.loads(raw);calls.append(('fleet',action,payload));return json.dumps(dict(success=True,fleet=fleet))
Remote.AutoMiningFleetAction=fleet_rpc;quick.fleetPresetName.SetValue('Team');quick.SaveFleetPreset();fn,args=queued[-1];fn(*args)
assert calls[-1][0:2]==('fleet','savePreset') and calls[-1][2]['revision']=='f1' and calls[-1][2]['characterIDs']==[42,43]
quick.Save();assert state['settings']['fleetEnabled'] is False and state['settings']['fleetMode']=='automatic' and state['settings']['fleetGroupID']=='g1'
print('PASS: Jobs landing/cards, every contextual profile, shared destination, draft preservation, confirmed atomic stop-and-switch without restart, PVE stable belt/settings/range and fleet presets/manual controls/checkbox draft/revision.')
# Complete localized belt names come from the verified native formatter, not server English cache.
module('eve.common.lib.appConst',groupAsteroidBelt=9)
belt_names={'EN':'Remote - Asteroid Belt I','DE':'Remote - Asteroidengürtel I','FR':'Remote - Ceinture d\u0027astéroïdes I','ES':'Remote - Cinturón de asteroides I','IT':'Remote - Cintura di asteroidi I','RU':'Remote - Пояс астероидов I','ZH':'Remote - 小行星带 I','JA':'Remote - アステロイドベルト I','KO':'Remote - 소행성 벨트 I'}
class BeltDB:
    def __init__(self):self.calls=0
    def execute(self,sql):
        assert sql=='SELECT * FROM celestials WHERE groupID = 9';self.calls+=1
        return [dict(celestialID=801,solarSystemID=31,groupID=9)]
belt_db=BeltDB();old_db=cfg.mapObjectsDb;cfg.mapObjectsDb=belt_db
cfg.GetCelestialNameFromLocalRow=lambda row,localized:belt_names[session.languageID]
quick._beltIndexLanguage=None
old_belt_rpc=Remote.AutoMiningBelts;Remote.AutoMiningBelts=lambda self,query:json.dumps(dict(success=True,belts=[]))
for language in ('EN','DE','FR','ES','IT','RU','ZH','JA','KO'):
    session.languageID=language
    quick.pveBeltSearch.SetValue(belt_names[language]);quick.FindBeltsWork()
    assert len(quick.pveBeltResults.entries)==1,(language,quick.notice.text)
    node=quick.pveBeltResults.entries[0];assert node.belt['beltID']==801 and node.belt['systemID']==31
    assert belt_names[language] in node.label
    reads=belt_db.calls;quick.FindBeltsWork();assert belt_db.calls==reads
    quick.SelectBelt(ns(sr=ns(node=node)));assert quick._pveBeltID==801
cfg.mapObjectsDb=old_db;Remote.AutoMiningBelts=old_belt_rpc;session.languageID='EN'
assert quick._toggles['inviteFleet'].state=='UI_HIDDEN'
print('PASS: all nine languages resolve full localized cross-system belt names through native celestials metadata and cached formatter, with stable belt/system IDs and no HUD-refresh scan.')
# Fleet ore collection is opt-in and survives hidden-job drafts.
assert not w.receiveFleetOre.GetValue()
quick.SelectJobDraft('boosting');quick.receiveFleetOre.SetChecked(True);quick.Changed();quick.Save()
assert state['settings']['receiveFleetOre'] is True
quick.SelectJobDraft('pve');quick.Save();assert state['settings']['receiveFleetOre'] is True
quick.ShowResponse(dict(state,fleetOre=dict(status='Waiting for fleet compression.')))
assert quick.fleetOreStatus.text=='Waiting for fleet compression.'
quick.SelectJobDraft('boosting');quick.settingSearch.SetValue('receive fleet ore');quick.FindSetting()
assert any(node.setting is quick.receiveFleetOre for node in quick.settingResults.entries)
print('PASS: fleet ore collection defaults off, persists through other jobs, exposes contextual search and renders compression wait snapshot.')
# Statistics show job-specific counters in pilot/fleet totals and saved run details.
combat_total=dict(stats_total,ratsDestroyed=4,damageDealt=1234.5,collectedVolume=80,deliveredVolume=70,pickups=3,transportDeliveries=2,recent=[dict(kind='combat',at=1000,damage=55.5,killed=True,typeID=123)])
quick._job='pve';quick.RenderStatistics(dict(stats_payload,totals=combat_total))
assert [label.text for label in quick.statsCards][:2]==['4','1234.5']
assert [title.text for title in quick.statsCardTitles][:2]==['Rats destroyed','Damage dealt']
assert 'PVE rats destroyed: 4' in quick.statsYield.text and 'Rat destroyed.' in quick.statsRecent.entries[0].label
assert 'Damage dealt: 55.5' in quick.statsRecent.entries[0].label
quick.RenderStatistics(dict(stats_payload,view='fleet',inFleet=True,totals=combat_total,members=[dict(characterID=42,name='Pilot A',online=True,totals=combat_total)]))
assert 'PVE rats destroyed: 4' in quick.statsList.entries[0].label
quick.StatisticsDetail(ns(sr=ns(node=quick.statsList.entries[0])))
assert 'Damage dealt: 1234.5' in quick.statsDetail.text and 'Transport collected: 80.0' in quick.statsDetail.text
quick.SessionDetail(ns(sr=ns(node=ns(detail=dict(combat_total,started=1000,ended=61000)))))
assert 'PVE rats destroyed: 4' in quick.statsDetail.text and 'Pickups: 3' in quick.statsDetail.text
quick._job='hauling';quick.RenderStatistics(dict(stats_payload,totals=combat_total))
assert [label.text for label in quick.statsCards]==['80.0','70.0','3','2']
assert [title.text for title in quick.statsCardTitles]==['Collected m3','Delivered m3','Completed pickups','Transport deliveries']
quick.RenderStatistics(dict(stats_payload,view='fleet',inFleet=True,totals=combat_total,members=[dict(characterID=42,name='Pilot A',online=True,totals=combat_total)]))
assert 'Collected: 80.0 m3' in quick.statsList.entries[0].label
for job,expected in [('pve',['0','0.0','0','0.0']),('hauling',['0.0','0.0','0','0'])]:
    quick._job=job;quick.RenderStatistics(dict(stats_payload,totals={}))
    assert [label.text for label in quick.statsCards]==expected
print('PASS: visible PVE and hauling cards, fleet member totals, archived-run details, committed combat recent labels and zero defaults for older snapshots.')
# Optional combat capture availability never hides retained counters or claims old snapshots are unavailable.
quick._job='pve'
for available,expected in [(False,'UI_NORMAL'),(True,'UI_HIDDEN'),(None,'UI_HIDDEN')]:
    snapshot=dict(stats_payload,totals=combat_total)
    if available is not None:snapshot['combatAvailable']=available
    quick.RenderStatistics(snapshot)
    assert quick.statsCombatNote.state==expected
    assert [label.text for label in quick.statsCards][:2]==['4','1234.5']
for job in ('mining','hauling','boosting'):
    quick._job=job;quick.RenderStatistics(dict(stats_payload,totals=combat_total,combatAvailable=False))
    assert quick.statsCombatNote.state=='UI_HIDDEN'
print('PASS: optional combat availability notice distinguishes explicit failure from old snapshots, preserves history and stays scoped to PVE.')

# A running job opens on its own page; an inactive saved job opens on Jobs.
animation_calls=[]
def record_fade(widget, **kwargs):
    animation_calls.append((widget,kwargs));widget.opacity=kwargs['endVal']
module('carbonui.uianimations',animations=ns(FadeTo=record_fade))
for job in ('mining','hauling','boosting','pve'):
    opening=cls();opening.ApplyAttributes({})
    snapshot=dict(state,settings=dict(state['settings'],job=job),revision='opening-'+job,enabled=True)
    rpc_count=len(calls);fade_count=len(animation_calls)
    opening.ShowResponse(snapshot,True)
    assert opening._enabled and opening._job==job and opening._jobChosen
    assert opening._page=={'mining':'mining','hauling':'transport','boosting':'boosters','pve':'pve'}[job]
    assert [i for i,(row,_) in enumerate(opening.tabs.buttons) if row.state=='UI_NORMAL']==sorted(opening.JobPages())
    assert len(calls)==rpc_count and len(animation_calls)==fade_count
    opening.tabs.buttons[7][0].OnClick(opening.tabs.buttons[7][0]);assert opening._page=='statistics'
    assert len(animation_calls)>fade_count
    fade_count=len(animation_calls)
    opening.ShowResponse(dict(snapshot,revision='refreshed-'+job),True)
    assert opening._page=='statistics' and opening._jobChosen and len(animation_calls)==fade_count
    changed_job='hauling' if job!='hauling' else 'pve'
    opening.ShowResponse(dict(snapshot,settings=dict(snapshot['settings'],job=changed_job),revision='remote-change-'+job),True)
    assert opening._job==changed_job and opening._jobChosen and opening._page=='statistics'
    opening.ShowResponse(snapshot,True)
    assert opening._job==job and opening._page=='statistics'
    old_prompt=sys.modules['player_messaging.client.ui_message'].prompt_player_fsd_dialog
    sys.modules['player_messaging.client.ui_message'].prompt_player_fsd_dialog=lambda *args:'ID_NO'
    opening.OpenJob('hauling' if job!='hauling' else 'mining')
    assert opening._jobChosen and opening._page=='statistics' and opening._job==job
    sys.modules['player_messaging.client.ui_message'].prompt_player_fsd_dialog=old_prompt
    opening.jobCards[job].OnClick(opening.jobCards[job])
    assert opening._jobChosen and opening._job==job and opening._enabled and not opening._dirty
    assert opening._page=={'mining':'mining','hauling':'transport','boosting':'boosters','pve':'pve'}[job]
    assert len(calls)==rpc_count
    assert [i for i,(row,_) in enumerate(opening.tabs.buttons) if row.state=='UI_NORMAL']==sorted(opening.JobPages())
    assert len(animation_calls)>fade_count
    opening.tabs.SelectByIdx(9);assert opening._page=='jobs'
    opening.ShowResponse(dict(snapshot,revision='chosen-'+job),True)
    assert opening._jobChosen and opening.JobPages()!={7,9}
    assert sum(panel.state=='UI_NORMAL' for _,panel,_,_ in opening.tabs.tabs)==1
    opening._enabled=False;state.update(settings=dict(snapshot['settings']),revision=opening._revision,enabled=False)
    opening.timerEdit.SetValue(77);opening.Changed()
    opening.SelectJobDraft('hauling' if job!='hauling' else 'pve')
    assert opening.timerEdit.GetValue()==77 and opening._dirty
    assert sum(panel.state=='UI_NORMAL' for _,panel,_,_ in opening.tabs.tabs)==1
    inactive=cls();inactive.ApplyAttributes({})
    inactive.ShowResponse(dict(snapshot,enabled=False,revision='inactive-'+job),True)
    assert not inactive._enabled and not inactive._jobChosen and inactive._job==job
    assert inactive.JobPages()=={7,9} and inactive._page=='jobs'
    inactive.tabs.SelectByIdx(7)
    inactive.ShowResponse(dict(snapshot,enabled=False,revision='inactive-refresh-'+job),True)
    assert inactive._page=='statistics' and inactive.JobPages()=={7,9}
def failed_fade(widget, **kwargs):
    widget.opacity=0.0
    raise RuntimeError('Animation unavailable')
sys.modules['carbonui.uianimations'].animations=ns(FadeTo=failed_fade)
opening.SelectJobDraft('mining')
assert all(row.opacity==1.0 for row,_ in opening.tabs.buttons if row.state=='UI_NORMAL')
del sys.modules['carbonui.uianimations']
opening.SelectJobDraft('boosting')
assert all(row.opacity==1.0 for row,_ in opening.tabs.buttons if row.state=='UI_NORMAL')
opening._jobChosen=False;opening.ConfigureJobNavigation();opening.tabs.SelectByIdx(7)
old_job,old_role=opening._job,opening._shipRole
opening.Save=lambda:False
opening.SwitchJobWork('pve')
assert not opening._jobChosen and opening._job==old_job and opening._shipRole==old_role
assert opening._page=='statistics' and opening.JobPages()=={7,9}
print('PASS: running jobs open their own pages without mutations; inactive jobs open Jobs/Statistics only; refresh preserves the selected page, drafts and shared pages persist, and native fade failures remain fully visible.')

# Pickup readiness always follows saved server settings, even with conflicting drafts.
requesting=cls();requesting.ApplyAttributes({})
saved=dict(state,enabled=True,settings=dict(state['settings'],job='mining',oreMode='unload'),revision='request-mode')
requesting.ShowResponse(saved,True)
assert requesting.requestPickupButton.state=='UI_DISABLED'
assert 'Select Fleet pickup and apply' in requesting.requestPickupHint.text
requesting.oreModeEdit.SelectItemByValue('pickup');requesting.Changed()
requesting.ShowResponse(dict(saved,revision='unsaved-pickup'))
assert requesting.requestPickupButton.state=='UI_DISABLED' and requesting._dirty
ready=dict(saved,settings=dict(saved['settings'],oreMode='pickup'),revision='saved-pickup')
requesting.ShowResponse(ready)
assert requesting.requestPickupButton.state=='UI_NORMAL'
assert 'saved settings' in requesting.requestPickupHint.text
for response in (dict(ready,enabled=False),dict(ready,settings=dict(ready['settings'],job='hauling'))):
    requesting.ShowResponse(response)
    assert requesting.requestPickupButton.state=='UI_DISABLED'
    assert 'Start the Mining job' in requesting.requestPickupHint.text
requesting.RenderTransport(dict(eligible=True,status='Joining the pickup fleet.',pool=dict(haulers=2,available=1,requests=3),
    job=dict(id='job-1',phase='joining',miner=dict(characterID=17,fleetID=7)),
    temporaryFleet=dict(fleetID=7,fleetName='<Ore Team>',joining=True),binReservation=dict(canID=999,jobID='job-1',haulerID=42)))
assert requesting.transportPool.state=='UI_NORMAL' and '2 hauler(s), 1 available, 3 request(s)' in requesting.transportPool.text
assert 'Joining the pickup fleet.' in requesting.transportJob.text
assert '&lt;Ore Team&gt;' in requesting.transportJob.text and 'Reserved bin: 999' in requesting.transportJob.text
requesting.RenderTransport(dict(eligible=True,job=dict(id='job-2',phase='loading',miner=dict(characterID=17,fleetID=8))))
assert requesting.transportPool.state=='UI_HIDDEN' and 'Fleet: 8 | Reserved bin: Waiting' in requesting.transportJob.text
former=dict(characterID=17,name='Jimbo',online=True,inFleet=False,participated=True,totals=combat_total)
requesting._job='hauling';requesting.RenderStatistics(dict(stats_payload,view='fleet',inFleet=True,totals=combat_total,members=[former],contributorsTrimmed=1))
assert 'Jimbo (left fleet)' in requesting.statsList.entries[0].label
assert 'earlier contributors not shown' in requesting.statsScope.text
loads=requesting.statsList.loads
requesting.RenderStatistics(dict(stats_payload,view='fleet',inFleet=True,totals=combat_total,members=[dict(former,inFleet=True)],contributorsTrimmed=1))
assert requesting.statsList.loads==loads+1 and '(left fleet)' not in requesting.statsList.entries[0].label
print('PASS: pickup button uses saved Mining/ON/pickup state despite drafts; compact pool, joining/fleet/reserved-bin details escape names, and former contributor metadata updates rows without discarding fleet totals.')

# The new miner delivery mode is an explicit draft; receiver settings never select it.
session.languageID='EN'
mode=cls();mode.ApplyAttributes({})
mode.ShowResponse(dict(state,settings=dict(state['settings'],job='mining',oreMode='leave',receiveFleetOre=True,
    defenseEnabled=False,fuelEnabled=False,ratDefenseEnabled=False,mineDrones=False,launchDrones=False)),True)
assert mode.oreModeEdit.GetValue()=='leave' and mode.fleetHangarHint.state=='UI_HIDDEN'
assert ("Put into booster's fleet hangar",'fleetHangar') in mode.oreModeEdit.options
mode.SelectJobDraft('mining');before=len(calls)
mode.haulThresholdEdit.SetValue(73)
mode.oreModeEdit.SelectItemByValue('fleetHangar');mode.Changed()
assert mode._dirty and len(calls)==before
assert mode.fleetHangarHint.state=='UI_NORMAL' and mode.mineFleetOreStatus.state=='UI_NORMAL'
assert mode.oreThresholdRow.state==mode.oreThresholdTitle.state==mode.oreThresholdHelp.state=='UI_HIDDEN'
assert '2500 m' in mode.fleetHangarHint.text
mode.ShowResponse(dict(state,fleetOre=dict(status='Waiting for fleet compression.')))
assert mode.oreModeEdit.GetValue()=='fleetHangar' and mode.mineFleetOreStatus.text=='Waiting for fleet compression.'
mode.Save()
assert state['settings']['oreMode']=='fleetHangar' and not state['settings']['haulEnabled'],mode.notice.text
assert state['settings']['haulThreshold']==73
mode.ShowResponse(dict(state),True)
assert mode.oreModeEdit.GetValue()=='fleetHangar' and mode.fleetHangarHint.state=='UI_NORMAL'
mode.oreModeEdit.SelectItemByValue('pickup');mode.Changed()
assert mode.fleetHangarHint.state==mode.mineFleetOreStatus.state=='UI_HIDDEN'
assert mode.oreThresholdRow.state==mode.oreThresholdTitle.state==mode.oreThresholdHelp.state=='UI_NORMAL'
assert mode.haulThresholdEdit.GetValue()==73
print('PASS: fleet-hangar mode is explicit, survives Apply/Reload, displays compression/access status inline, and never follows receiver opt-in automatically.')

# Native ContainerAutoSize sums wrapped TOTOP rows; no fixed card height can cut them off.
module('evetypes',GetName=lambda typeID:'Localized equipment '+str(typeID)+' / long name '*8)
mode.RenderIndustrial(dict(modules=[dict(itemID=31,typeID=62590,kind='core',defaultSeconds=75,durationSeconds=75,intervalSeconds=300),
    dict(itemID=32,typeID=62622,kind='compressor',defaultSeconds=60,durationSeconds=60,intervalSeconds=60)],
    status='Compressor waiting for an active core.'),True)
core=mode._moduleRows[31].parent;compressor=mode._moduleRows[32].parent
assert core.parent is mode._modulePanels['core'] and compressor.parent is mode._modulePanels['compressor']
assert isinstance(core,AutoSizeWidget) and isinstance(compressor,AutoSizeWidget)
assert not hasattr(core,'height') and not hasattr(compressor,'height')
title=next(child for child in widgets if getattr(child,'parent',None) is compressor and isinstance(child,AutoSizeWidget))
name=next(child for child in widgets if getattr(child,'parent',None) is title and getattr(child,'autoFitToText',False))
assert 'Localized equipment 62622' in name.text and title.alignMode=='TOTOP'
name.height=80
duration=next(child for child in widgets if getattr(child,'parent',None) is compressor and 'Fitted cycle:' in getattr(child,'text',''))
assert duration.autoFitToText and mode._moduleRows[32].autoFitToText
duration.height=70;mode._moduleRows[32].height=45
wide=compressor.ContentHeight();assert wide>128
name.height=150;duration.height=110
assert compressor.ContentHeight()>wide and mode.industrialStatus.autoFitToText
print('PASS: core/compressor cards use their native-kind sections, native localized names and automatic row height for long wrapped labels/resizing. Actual native rendering remains untested.')

# Boosting can opt into drone mining without exposing laser controls or starting it.
booster=cls();booster.ApplyAttributes({})
state.update(enabled=False,settings=dict(state['settings'],job='boosting',shipRole='boosting',oreMode='leave',
    defenseEnabled=False,fuelEnabled=False,ratDefenseEnabled=False,mineDrones=False,launchDrones=False,
    autoBoost=False,ratMiningGroupKey='',ratFighterGroupKey=fighter_key))
booster.ShowResponse(dict(state,catalog=catalog),True)
assert booster.JobPages()=={7,9} and not booster._jobChosen
assert booster.ratMiningGroupEdit.state=='UI_DISABLED'
before=len(calls)
booster.jobCards['boosting'].OnClick(booster.jobCards['boosting'])
assert booster.JobPages()=={1,2,3,4,5,7,9,11} and len(calls)==before
for page in (1,2,3):
    booster.tabs.buttons[page][0].OnClick(booster.tabs.buttons[page][0])
    assert booster.tabs.index==page and booster.tabs.tabs[page][1].state=='UI_NORMAL'
    assert sum(panel.state=='UI_NORMAL' for _,panel,_,_ in booster.tabs.tabs)==1
booster.tabs.SelectByIdx(0);assert booster.tabs.index==3
booster.tabs.SelectByIdx(6);assert booster.tabs.index==3
booster.settingSearch.SetValue('mining filter');booster.FindSetting()
assert any(node.setting is booster.availableSearch for node in booster.settingResults.entries)
booster.settingSearch.SetValue('survey seconds');booster.FindSetting();assert not booster.settingResults.entries
# Fighter-only Boosting keeps its existing validation when drone mining is off.
booster._toggles['ratDefenseEnabled'].SetChecked(True);booster.Changed()
assert booster.Save(),booster.notice.text
assert not state['settings']['mineDrones'] and not state['settings']['ratMiningGroupKey']
booster._toggles['mineDrones'].SetChecked(True);booster.Changed()
assert booster.ratMiningGroupEdit.state=='UI_NORMAL'
before=len(calls);assert not booster.Save() and len(calls)==before
booster.ratMiningGroupEdit.SelectItemByValue(fighter_key)
assert not booster.Save()
booster.ratMiningGroupEdit.SelectItemByValue(group_key)
booster._selected=['veldspar'];booster.mineDroneOrderEdit.SelectItemByValue('largest')
booster.mineDroneModeEdit.SelectItemByValue('focus');booster.Changed()
assert booster.Save(),booster.notice.text
assert state['settings']['job']=='boosting' and state['settings']['shipRole']=='boosting'
assert state['settings']['mineDrones'] and state['settings']['ores']==['veldspar']
assert state['settings']['mineDroneOrder']=='largest' and state['settings']['mineDroneMode']=='focus'
assert not state['settings']['autoBoost'] and not state['enabled']
booster.ShowResponse(dict(state),True)
assert booster._jobChosen and booster.JobPages()=={1,2,3,4,5,7,9,11}
assert booster._toggles['mineDrones'].GetValue() and booster.ratMiningGroupEdit.state=='UI_NORMAL'
booster.SelectJobDraft('hauling')
assert booster.JobPages()=={3,4,7,8,9,11} and booster._page=='transport'
assert booster._toggles['mineDrones'].GetValue() and booster._selected==['veldspar']
booster.SelectJobDraft('boosting');booster._toggles['mineDrones'].SetChecked(False);booster.Changed()
assert booster.ratMiningGroupEdit.state=='UI_DISABLED' and booster.ratMiningGroupEdit.GetValue()==group_key
assert not any(call[0]=='control' for call in calls[before:])
print('PASS: Boosting reveals optional Mining drones/Filter after an explicit card choice, keeps laser/ore pages hidden, saves draft drone/filter choices without starting, and preserves fighter-only versus miner/fighter rat validation.')

# Ore admission belongs to the booster and remains independent of compressor edits.
admit=cls();admit.ApplyAttributes({})
assert admit.receiveFleetAcceptCompressed.GetValue() and admit.receiveFleetAcceptUncompressed.GetValue()
admission_settings=dict(state['settings'],job='boosting',oreMode='leave',mineDrones=False,ratDefenseEnabled=False,
    launchDrones=False,defenseEnabled=False,fuelEnabled=False)
admission_settings.pop('receiveFleetAcceptCompressed',None)
admission_settings.pop('receiveFleetAcceptUncompressed',None)
for compressor in (False,True):
    admit.ShowResponse(dict(state,settings=dict(admission_settings,compressorEnabled=compressor)),True)
    assert admit.receiveFleetAcceptCompressed.GetValue() is True
    assert admit.receiveFleetAcceptUncompressed.GetValue() is (not compressor)
for compressed,uncompressed in ((True,True),(True,False),(False,True),(False,False)):
    state['settings']=dict(admission_settings,receiveFleetAcceptCompressed=compressed,
        receiveFleetAcceptUncompressed=uncompressed,compressorEnabled=True,receiveFleetOre=True)
    admit.ShowResponse(dict(state),True);admit.SelectJobDraft('boosting')
    assert admit.receiveFleetAcceptCompressed.GetValue() is compressed
    assert admit.receiveFleetAcceptUncompressed.GetValue() is uncompressed
    admit.compressorToggle.SetChecked(False);admit.Changed()
    assert admit.receiveFleetAcceptCompressed.GetValue() is compressed
    assert admit.receiveFleetAcceptUncompressed.GetValue() is uncompressed
    assert admit.Save(),admit.notice.text
    assert state['settings']['receiveFleetAcceptCompressed'] is compressed
    assert state['settings']['receiveFleetAcceptUncompressed'] is uncompressed
    admit.SelectJobDraft('pve');assert admit.Save(),admit.notice.text
    assert state['settings']['receiveFleetAcceptCompressed'] is compressed
    assert state['settings']['receiveFleetAcceptUncompressed'] is uncompressed
    admit.ShowResponse(dict(state),True);admit.SelectJobDraft('boosting')
    assert admit.receiveFleetAcceptCompressed.GetValue() is compressed
    assert admit.receiveFleetAcceptUncompressed.GetValue() is uncompressed
admit.receiveFleetAcceptCompressed.SetChecked(True);admit.receiveFleetAcceptUncompressed.SetChecked(False);admit.Changed()
admit.ShowResponse(dict(state,revision=state['revision']+'-poll',settings=dict(state['settings'],
    receiveFleetAcceptCompressed=False,receiveFleetAcceptUncompressed=True)))
assert admit._dirty and admit.receiveFleetAcceptCompressed.GetValue() and not admit.receiveFleetAcceptUncompressed.GetValue()
admit.receiveFleetOre.SetChecked(False);admit.compressorToggle.SetChecked(True);admit.Changed()
assert admit.receiveFleetAcceptCompressed.GetValue() and not admit.receiveFleetAcceptUncompressed.GetValue()
admit.settingSearch.SetValue('accept');admit.FindSetting()
assert {node.setting for node in admit.settingResults.entries}=={admit.receiveFleetAcceptCompressed,admit.receiveFleetAcceptUncompressed}
print('PASS: both independent admission toggles persist in all four combinations across Apply/Reload/hidden jobs; legacy absent values preserve compressor policy, explicit choices survive compressor/receive edits and polls, and job search reaches the existing controls.')

# PVE assignment panels share combat settings and keep the home picker independent.
session.languageID='EN';session.solarsystemid=30
deployment=cls();deployment.ApplyAttributes({})
state['settings']=dict(state['settings'],job='pve',pveMode='escort',pveFleetID=7,pveAnchorID=43,
    pveHomeStationID=0,pveMaxJumps=2,reinforcementAutoCall=False,reinforcementResponderLimit=1)
deployment.ShowResponse(dict(state),True)
assert deployment.JobPages()=={7,9} and not deployment._jobChosen
assert deployment.pveMaxJumps.GetValue()==2 and deployment.pveMaxJumps.minValue==0 and deployment.pveMaxJumps.maxValue==50
assert not deployment.reinforcementAutoCall.GetValue() and deployment.reinforcementResponderLimit.GetValue()==1
deployment.jobCards['pve'].OnClick(deployment.jobCards['pve'])
before=len(calls)
for mode_value in ('belt','escort','standby'):
    deployment.pveMode.SelectItemByValue(mode_value);deployment.PVEModeChanged()
    assert [key for key,panel in deployment.pveModePanels.items() if panel.state=='UI_NORMAL']==[mode_value]
    assert deployment.pveQueue.state==('UI_HIDDEN' if mode_value=='belt' else 'UI_NORMAL')
    assert len(calls)==before and deployment._dirty
    deployment.settingSearch.SetValue('home station');deployment.FindSetting()
    assert bool(deployment.settingResults.entries)==(mode_value=='standby')
deployment.pveMode.SelectItemByValue('belt');deployment.PVEModeChanged()
deployment.SelectSetting(ns(sr=ns(node=ns(page=10,setting=deployment.pveHomeStationEdit))))
assert deployment._page=='pve'
deployment.pveMode.SelectItemByValue('standby');deployment.PVEModeChanged()
old_dest=(deployment._stationID,deployment._fuelStationID,deployment._transportStationID)
old_storage_calls=sum(c[0]=='storages' for c in calls)
session.languageID='FR'
deployment.pveHomeStationEdit.SetValue(station_names['FR']);deployment.DestinationChanged('pveHome')
deployment.FindStationsWork('pveHome')
home_row=deployment.pveHomeStationResults.entries[0]
deployment.SelectStation(ns(sr=ns(node=home_row)))
assert deployment._pveHomeStationID==600 and (deployment._stationID,deployment._fuelStationID,deployment._transportStationID)==old_dest
assert sum(c[0]=='storages' for c in calls)==old_storage_calls
session.languageID='EN'
deployment.pveMaxJumps.SetValue(0);deployment.reinforcementResponderLimit.SetValue(1)
assert deployment.Save(),deployment.notice.text
assert state['settings']['pveMode']=='standby' and state['settings']['pveHomeStationID']==600 and state['settings']['pveMaxJumps']==0
deployment.pveMode.SelectItemByValue('escort');deployment.PVEModeChanged()
scope['_am_pve_preview_path']=lambda a,b:[a] if a==b else [a,b]
def pve_fleets(self):
    calls.append(('pve-fleets',));return json.dumps(dict(success=True,pveFleets=[dict(fleetID=7,name='<Escort>',systemID=30,
        systemName='Penirgman',memberCount=3,joinable=True,anchors=[dict(characterID=43,name='Anchor')])]))
Remote.AutoMiningPVEFleets=pve_fleets
original_load_options=Widget.LoadOptions
def native_load_options(widget,entries,select=None):
    original_load_options(widget,entries,select)
    if hasattr(widget,'callback'):widget.callback(widget)
Widget.LoadOptions=native_load_options
deployment._dirty=False;deployment._pveFleetID=7;deployment._pveAnchorID=43
deployment.RefreshPVEFleetsWork()
assert deployment._pveFleetID==7 and deployment._pveAnchorID==43 and not deployment._dirty
assert '&lt;Escort&gt;' in deployment.pveFleetEdit.options[1][0] and '0 jumps' in deployment.pveFleetEdit.options[1][0]
assert 'Joinable' in deployment.pveFleetEdit.options[1][0]
session.solarsystemid=None;session.solarsystemid2=30
deployment.RefreshPVEFleetsWork()
assert '0 jumps' in deployment.pveFleetEdit.options[1][0] and not deployment._dirty
session.solarsystemid=30;session.solarsystemid2=None
Widget.LoadOptions=original_load_options
deployment.RenderPVE(dict(deployment=dict(status='Ready',requestStatus=dict(status='Working',incidentID='i',responders=1,needed=1),assignment=dict(fleetID=7,fleetName='<Escort>',anchorName='Anchor',status='Ready',phase='routeFleet'),
    pool=dict(available=2,requests=1),queue=[dict(id='i',fleetID=7,systemID=30,responders=1,needed=1,ageSeconds=4)])))
assert deployment.reinforcementStatus.text=='Working | 1/1 responders' and '2 available' in deployment.pveDeployment.text
assert '&lt;Escort&gt;' in deployment.pveDeployment.text and 'Anchor' in deployment.pveDeployment.text and 'routeFleet' not in deployment.pveDeployment.text
assert 'Waiting jumps' in deployment.pveQueue.entries[0].label and '4 s ago' in deployment.pveQueue.entries[0].label
deployment.RenderPVE(dict(status='Escorting the selected pilot.',deployment=dict(status='Escorting the selected pilot.',
    assignment=dict(fleetID=7,fleetName='<Escort>',anchorName='Anchor',status='Escorting the selected pilot.',phase='engaging'),
    queue=[dict(id='i',fleetID=7,systemID=30,responders=1,needed=1,ageSeconds=4)])))
assert deployment.pveStatus.text=='Escorting the selected pilot.'
assert 'Escorting the selected pilot.' in deployment.pveDeployment.text and 'Engaging hostile rats.' not in deployment.pveDeployment.text
loads=deployment.pveQueue.loads
deployment.RenderPVE(dict(deployment=dict(queue=[dict(id='i',fleetID=7,systemID=30,responders=1,needed=1,ageSeconds=4)])))
assert deployment.pveQueue.loads==loads
deployment.RenderPVE(dict(deployment=dict(queue=[dict(id=str(i),fleetID=i+1,systemID=30,responders=0,needed=1) for i in range(32)])))
assert len(deployment.pveQueue.entries)==32 and '32' in deployment.pveQueue.entries[-1].label
def call_reinforcements(self):
    calls.append(('reinforcements',));return json.dumps(dict(state,pve=dict(deployment=dict(requestStatus='Ready'))))
Remote.AutoMiningCallReinforcements=call_reinforcements
deployment._dirty=True;deployment.reinforcementAutoCall.SetChecked(True)
deployment.CallReinforcementsWork()
assert ('reinforcements',) in calls and deployment.reinforcementStatus.text=='Ready'
assert deployment._dirty and deployment.reinforcementAutoCall.GetValue()
print('PASS: PVE assignment contexts hide inactive controls/search; home station search is multilingual/independent and needs no storage; zero/route jumps are distinct; native fleet refresh preserves anchor drafts; bounded callout/status updates use explicit RPCs without starting or overwriting drafts.')

# All compatible ammo remains searchable, with cargo targets independent of loaded rounds.
module('evetypes',GetName=lambda typeID:'Ammo '+str(typeID))
ammo_items=[dict(typeID=2000+i,loaded=30 if i==0 else 0,cargo=7 if i==0 else 0) for i in range(80)]
deployment.RenderPVEAmmo(dict(items=ammo_items,status='PVE ammunition is ready.'))
assert len(deployment._pveAmmoRows)==80 and deployment.pveAmmoRestock.GetValue()
assert all(editor.GetValue()==0 for counts,editor in deployment._pveAmmoRows.values())
counts,editor=deployment._pveAmmoRows[2000]
editor.SetValue(100);editor.OnChange(editor)
assert deployment._pveAmmoTargets['2000']==100 and 'Loaded: 30 | Cargo: 7'==counts.text
deployment.RenderPVEAmmo(dict(items=[dict(row,cargo=8) if row['typeID']==2000 else row for row in ammo_items]))
assert deployment._pveAmmoRows[2000][1] is editor and editor.GetValue()==100
deployment.pveAmmoSearch.SetValue('2079');deployment.FilterPVEAmmo()
assert set(deployment._pveAmmoRows)=={2079} and deployment._pveAmmoTargets['2000']==100
deployment.pveAmmoSearch.SetValue('');deployment.FilterPVEAmmo()
assert len(deployment._pveAmmoRows)==80 and deployment._pveAmmoRows[2000][1].GetValue()==100
deployment.RenderPVEAmmo(dict(items=ammo_items[1:],status='PVE ammunition source is short of stock.'))
assert deployment._pveAmmoTargets['2000']==100 and deployment.pveAmmoStatus.text=='PVE ammunition source is short of stock.'
session.stationid=600
old_home=deployment._pveHomeStationID
deployment.RefreshAmmoStorageWork()
assert deployment._pveHomeStationID==old_home and ('storages',600) in calls
deployment.pveAmmoSource.SelectItemByValue('corp:777:116')
deployment.pveAmmoRestock.SetChecked(False);deployment.Changed()
assert deployment.Save(),deployment.notice.text
assert state['settings']['pveAmmoTargets']=={'2000':100}
assert state['settings']['pveAmmoSourceKey']=='corp:777:116' and state['settings']['pveAmmoRestock'] is False
deployment.ShowResponse(dict(state,pveAmmo=dict(items=ammo_items,sourceKey='corp:777:116',sourceLabel='Corporation - Ore')),True)
assert deployment._pveAmmoRows[2000][1].GetValue()==100 and deployment.pveAmmoSource.GetValue()=='corp:777:116'
deployment.ShowResponse(dict(state,pveAmmo=dict(items=ammo_items,sourceKey='corp:777:116',sourceLabel='')),True)
assert deployment.pveAmmoSource.GetKey()=='corp:777:116'
deployment.ShowResponse(dict(state,settings=dict(state['settings'],pveAmmoSourceKey='personal'),pveAmmo=dict(sourceKey='personal',sourceLabel='')),True)
assert deployment.pveAmmoSource.GetKey()=='Personal item hangar'
deployment.RenderPVEAmmo(dict(items=ammo_items,status='PVE ammunition cargo capacity reached.'))
assert deployment.pveAmmoStatus.text=='PVE ammunition cargo capacity reached.'
session.stationid=None
print('PASS: native ammo names/all variants remain reachable; counts update without replacing focused edits; cargo targets start at0, ignore loaded rounds and survive filter/refit/Apply/Reload; restock/source are independent from home and stock/capacity states stay explicit.')

# Profile RPCs expose server-owned fields; draft switches never rewrite archives or runtime state.
session.languageID='EN';session.shipid=10
state.update(settings=dict(state['settings'],job='mining',shipRole='boosting',oreMode='pickup',launchDrones=True,
    droneGroupKey=group_key,recallDrones=False,mineDrones=True,mineDroneOrder='furthest',ratDefenseEnabled=True,
    ratMiningGroupKey=group_key,ratFighterGroupKey=fighter_key,pveDronesEnabled=False,pveDroneGroupKey='',
    defenseEnabled=False,fuelEnabled=False,actionNotifications=True),revision='profiles-r1',enabled=True,status='Mining with 2 module(s).')
rig=cls();rig.ApplyAttributes({});rig.ShowResponse(dict(state),True);rig.SelectJobDraft('mining')
old_group_reader=scope['_am_drone_groups'];scope['_am_drone_groups']=lambda:[]
rig._droneGroups=[];rig.RefreshDroneGroupsWork()
rig._toggles['actionNotifications'].SetChecked(False);rig.defenseShieldEdit.SetValue(77);rig.Changed()
activity=[];scope['_am_activity_set_state']=lambda *args:activity.append(args)
original_profile_rpc=Remote.AutoMiningJobProfile
profile_requests=[];inject_shared_edit=[True]
def partial_profile(self,job):
    profile_requests.append(job)
    settings=dict(state['settings']);settings.update(profile_contract[job]['settings']);settings['job']=job
    if job=='mining':
        settings.update(launchDrones=True,droneGroupKey=group_key,recallDrones=False,mineDrones=True,
            mineDroneOrder='furthest',ratDefenseEnabled=True,ratMiningGroupKey=group_key,ratFighterGroupKey=fighter_key)
    if job=='pve':
        settings['pveBeltID']=700
    if inject_shared_edit[0]:
        inject_shared_edit[0]=False
        rig.defenseShieldEdit.SetValue(82);rig.reinforcementAutoCall.SetChecked(True)
        rig.stationEdit.SetValue('unfinished station query');rig.DestinationChanged('ore');rig.Changed()
    # Exact controller metadata shape; the RPC wrapper normally adds actual status.
    return json.dumps(dict(success=True,job=job,settings=settings,fields=profile_contract[job]['fields'],revision=state['revision'],
        fuelDestination=None,fuelStorage=None,transportDestination=None,transportStorage=None,pveHomeDestination=None,
        pve=dict(belt=dict(beltID=700,name='Target belt',systemID=30,systemName='System') if job=='pve' else None),
        pveAmmo=dict(items=ammo_items,sourceKey='personal',sourceLabel='Personal item hangar',status='PVE ammunition is ready.')))
Remote.AutoMiningJobProfile=partial_profile
mutations=sum(c[0] in ('save','control') for c in calls)
assert rig.SelectJobDraft('pve'),rig.notice.text
assert rig._job=='pve' and rig._savedJob=='mining' and rig._enabled and '<b>ON</b>' in rig.statusLabel.text
assert not activity and rig.requestPickupButton.state=='UI_NORMAL'
assert rig._dirty and rig.defenseShieldEdit.GetValue()==82 and rig.reinforcementAutoCall.GetValue()
assert rig.stationEdit.GetValue()=='unfinished station query' and not rig._toggles['actionNotifications'].GetValue()
assert not rig.pveDrones.GetValue() and rig.pveDroneGroup.GetValue()=='' and rig._toggles['recallDrones'].GetValue()
assert not rig._toggles['launchDrones'].GetValue() and not rig._toggles['ratDefenseEnabled'].GetValue()
assert rig._droneArrivalPanel.state==rig._droneRatPanel.state=='UI_HIDDEN' and rig._pveDronePanel.state=='UI_NORMAL'
assert len(rig._pveAmmoRows)==80 and sum(c[0] in ('save','control') for c in calls)==mutations
assert rig._pveBeltID==700 and rig._pveBelt['name']=='Target belt' and 'Target belt' in rig.pveBeltLabel.text
rig.settingSearch.SetValue('use pve drones');rig.FindSetting();found=rig.settingResults.entries[0]
assert found.page==3 and found.setting is rig.pveDrones
rig.SelectSetting(ns(sr=ns(node=found)))
assert rig._page=='drones' and rig.pveDrones.focused and rig._settingHighlight.bgParent is rig.pveDrones
assert rig.settingResults.state=='UI_HIDDEN'
rig.settingSearch.SetValue('rats detected');rig.FindSetting();assert not rig.settingResults.entries
rig.pveDrones.SetChecked(True);rig.pveDroneGroup.LoadOptions([('Saved group unavailable - refresh or choose again',fighter_key)],select=fighter_key)
rig._toggles['recallDrones'].SetChecked(False);rig.Changed()
rig.ShowResponse(dict(state))
assert rig._job=='pve' and rig._savedJob=='mining' and rig.pveDrones.GetValue() and not rig._toggles['recallDrones'].GetValue()
assert activity[-1]==(True,True) and rig.defenseShieldEdit.GetValue()==82
assert rig.SelectJobDraft('mining') and rig._toggles['launchDrones'].GetValue()
assert rig.droneGroupEdit.GetValue()==group_key and rig._toggles['mineDrones'].GetValue()
assert rig.mineDroneOrderEdit.GetValue()=='furthest' and not rig._toggles['recallDrones'].GetValue()
assert any('unavailable' in label.lower() and value==group_key for label,value in rig.droneGroupEdit.options)
assert rig._droneArrivalPanel.state==rig._droneRatPanel.state=='UI_NORMAL' and rig._pveDronePanel.state=='UI_HIDDEN'
assert rig.SelectJobDraft('pve') and rig.pveDrones.GetValue() and rig.pveDroneGroup.GetValue()==fighter_key
assert not rig._toggles['recallDrones'].GetValue() and rig.defenseShieldEdit.GetValue()==82
assert rig.SelectJobDraft('mining')
old_values=rig.ReadSettings();old_text=rig.stationEdit.GetValue();old_page=rig.tabs.index;old_dirty=rig._dirty
rig.Save=lambda *args:False;rig.SwitchJobWork('pve')
assert rig._job=='mining' and rig.ReadSettings()==old_values and rig.stationEdit.GetValue()==old_text
assert rig.tabs.index==old_page and rig._dirty==old_dirty and rig._jobChosen
assert 'jobProfiles' not in rig.ReadSettings()
# A ship change or stale revision during the read-only reply cannot load the target.
def ship_changed_profile(self,job):
    result=partial_profile(self,job);session.shipid=11;return result
Remote.AutoMiningJobProfile=ship_changed_profile
assert not rig.SelectJobDraft('pve') and rig._job=='mining' and rig.ReadSettings()==old_values
session.shipid=10
def stale_profile(self,job):
    result=json.loads(partial_profile(self,job));result['revision']='external-change';return json.dumps(result)
Remote.AutoMiningJobProfile=stale_profile
assert not rig.SelectJobDraft('pve') and rig._job=='mining' and 'Reload' in rig.notice.text
Remote.AutoMiningJobProfile=partial_profile
rig.ShowResponse(dict(state),True);assert not rig._jobDrafts
assert rig.SelectJobDraft('pve') and not rig.pveDrones.GetValue() and rig._toggles['recallDrones'].GetValue()
Remote.AutoMiningJobProfile=original_profile_rpc;scope['_am_drone_groups']=old_group_reader;scope.pop('_am_activity_set_state')
print('PASS: exact read-only job-profile previews restore first/partial/default and unsaved per-job drone choices, preserve unavailable groups and later shared edits, keep actual ON/activity/pickup state, isolate PVE Drone search, restore failed switches fully, reject stale ship/revision replies and discard cached drafts on Reload.')

# Agency navigation wraps real label widths without hiding an active page.
session.languageID='EN'
agency_snapshot=dict(state,settings=dict(state['settings'],job='mining',ores=[]),revision='agency-ui',enabled=True)
agency=cls();agency.ApplyAttributes({});agency.ShowResponse(agency_snapshot,True)
agency.timerEdit.SetValue(77);agency.Changed();draft=agency.ReadSettings()
for width in (1040,1200,1500,480):
    for index,label in enumerate(agency.tabs.labels):
        label.textwidth=70+(index % 4)*32
    agency.tabs._layoutToken=None;agency.tabs.Layout(width,40)
    for index in agency.JobPages():
        row=agency.tabs.buttons[index][0]
        assert row.left>=8 and row.left+row.width<=width-16
        assert row.top+row.height<=agency.tabs.parent.height
    rows=[agency.tabs.buttons[index][0] for index in agency.JobPages()]
    for index,row in enumerate(rows):
        assert all(row.top!=other.top or row.left+row.width<=other.left or other.left+other.width<=row.left
                   for other in rows[index+1:])
    active=agency.tabs.buttons[agency.tabs.index][0]
    assert agency.tabs.marker.left==active.left+6 and agency.tabs.marker.width==active.width-12
    assert agency.tabs.marker.top==active.top+37

motion=[]
def in_flight_fade(widget,**kwargs):
    motion.append(('fade',widget));widget.opacity=kwargs['startVal']
def in_flight_morph(widget,attribute,start,end,**kwargs):
    motion.append(('morph',widget));setattr(widget,attribute,start)
module('carbonui.uianimations',animations=ns(FadeTo=in_flight_fade,MorphScalar=in_flight_morph))
for unused,panel,unused,key in agency.tabs.tabs:
    panel.StopAnimations=lambda:motion.append(('stop',None))
rpc_count=len(calls)
for index in (2,3,11,4,0,9,2,0):
    agency.tabs.SelectByIdx(index)
    assert sum(panel.state=='UI_NORMAL' for unused,panel,unused,key in agency.tabs.tabs)==1
    assert agency.tabs.tabs[index][1].opacity>0
    assert all(panel.opacity==1 and panel.top==0 for i,(unused,panel,unused,key) in enumerate(agency.tabs.tabs) if i!=index)
assert agency.ReadSettings()==draft and len(calls)==rpc_count
for job,card in agency.jobCards.items():
    card.OnMouseEnter(card);card.OnMouseExit(card)
assert agency.ReadSettings()==draft and len(calls)==rpc_count and agency._job=='mining'
def failed_morph(widget,attribute,start,end,**kwargs):
    setattr(widget,attribute,99);raise RuntimeError('Animation unavailable')
sys.modules['carbonui.uianimations'].animations=ns(FadeTo=failed_fade,MorphScalar=failed_morph)
agency.tabs.SelectByIdx(2)
assert agency.tabs.tabs[2][1].opacity==1 and agency.tabs.tabs[2][1].top==0
del sys.modules['carbonui.uianimations']
print('PASS: horizontal navigation wraps within its width; rapid in-flight page changes keep exactly one visible page and preserve drafts; card hover makes no RPC; broken motion restores visible final positions.')

# Actual type IDs/localized names are presentation; canonical saved keys remain stable.
session.languageID='DE'
module('evetypes',GetName=lambda typeID:{1230:'Veldspat',17470:'Konzentrierter Veldspat',1228:'Scordit'}[typeID])
icon_catalog=[dict(name='Veldspar',typeID=1230,volume=0.1),dict(name='Veldspar 0-Grade',typeID=92371,volume=0.1),
              dict(name='Veldspar II-Grade',typeID=17470,volume=0.1),dict(name='Scordite',typeID=1228,volume=0.15)]
picker=cls();picker.ApplyAttributes({})
picker.ShowResponse(dict(agency_snapshot,catalog=icon_catalog),True)
picker.tabs.SelectByIdx(2)
assert picker._catalog['veldspar']=='Veldspat'+scope['_am_tr'](' (group)')
assert picker._catalog['veldspar 0-grade']=='Veldspat' and picker._catalogTypes['veldspar 0-grade']==1230
assert picker._catalog['veldspar ii-grade']=='Konzentrierter Veldspat'
picker.availableSearch.SetValue('Veldspat');picker.Search()
assert set(node.oreKey for node in picker.availableScroll.entries)=={'veldspar','veldspar 0-grade','veldspar ii-grade'}
picker.availableSearch.SetValue('veldspar');picker.Search()
assert len(picker.availableScroll.entries)==3
tile=next(tile for tile,bg,node in picker.availableScroll.tiles if node.oreKey=='veldspar ii-grade')
icons=[child for child in widgets if getattr(child,'parent',None) is tile and getattr(child,'typeID',0)==17470]
assert icons and icons[0].size==40
rpc_count=len(calls);tile.OnClick(tile);tile.OnDblClick(tile)
assert picker._selected==['veldspar ii-grade'] and picker._dirty and len(calls)==rpc_count
tile=next(tile for tile,bg,node in picker.availableScroll.tiles if node.oreKey=='veldspar ii-grade')
tile.OnClick(tile);assert not picker._selected
picker.AddOreKeys(['scordite','veldspar 0-grade'])
active=next(tile for tile,bg,node in picker.selectedScroll.tiles if node.oreKey=='veldspar 0-grade')
active.OnClick(active);picker.MoveOre(-1)
assert picker.ReadSettings()['ores']==['veldspar 0-grade','scordite']
assert picker.selectedScroll.GetSelected()[0].oreKey=='veldspar 0-grade'
picker.MoveOre(1);assert picker.ReadSettings()['ores']==['scordite','veldspar 0-grade']
active=next(tile for tile,bg,node in picker.selectedScroll.tiles if node.oreKey=='scordite')
active.OnDblClick(active);assert picker._selected==['veldspar 0-grade'] and len(calls)==rpc_count
session.languageID='EN'
print('PASS: native resource icons/names and custom base-grade fallback; localized and English search; double-click does not undo selection; priority tiles retain canonical keys without saving before Apply.')

# Art is first in the native background list, above the opaque Fill but
# beneath all regular children (ribbons, descriptions and stroke).
for job, (art, stroke, tagLabel) in agency._cardVisuals.items():
    assert art.bgParent is agency.jobCards[job] and art.idx == 0

# Masked Frames require the native secondary-texture setter; an arbitrary
# attribute assignment would silently leave their old art in place.
native_art=agency._cardVisuals['mining'][0]
native_art.textureSecondary=ns(scale=(0.966,0.966))
replacements=[]
native_art.SetSecondaryTexturePath=lambda path: replacements.append(path)
agency.ApplyJobArtwork({'mining':'cache:/Pictures/AutoMining/jobs/mining-test.png'})
assert replacements==['cache:/Pictures/AutoMining/jobs/mining-test.png']
assert native_art.textureSecondary.scale==(0.966,0.966)
sprite_art=agency._cardVisuals['hauling'][0]
agency.ApplyJobArtwork({'hauling':'cache:/Pictures/AutoMining/jobs/hauling-test.png'})
assert sprite_art.texturePath.endswith('hauling-test.png')

# Opening another job does not load the filter's native icons. Clicking and
# reprioritising reuse the available tiles and existing selected-row icons.
lazy=cls();lazy.ApplyAttributes({});lazy.ShowResponse(dict(agency_snapshot,catalog=icon_catalog),True)
assert lazy.availableScroll.entries and not lazy.availableScroll.tiles
lazy.tabs.SelectByIdx(2)
availableTiles=list(lazy.availableScroll.tiles);before=len(widgets)
lazy.AddOreKeys(['veldspar 0-grade'])
assert [t for t,b,n in availableTiles]==[t for t,b,n in lazy.availableScroll.tiles]
assert len(widgets)-before<12
firstTile=lazy.selectedScroll.tiles[0][0]
lazy.AddOreKeys(['scordite']);lazy.selectedScroll.selected=[lazy.selectedScroll.entries[1]]
before=len(widgets);lazy.MoveOre(-1)
assert len(widgets)==before and lazy.selectedScroll.tiles[1][0] is firstTile
lazy.availableSearch.SetValue('no matching resource');lazy.Search()
assert not lazy.availableScroll.entries
lazy.availableSearch.SetValue('');lazy.Search()
assert len(lazy.availableScroll.tiles)==len(icon_catalog)
print('PASS: Jobs art is above the opaque fill; unrelated pages defer filter icons; ore clicks retain available tiles; priority changes create no widgets.')
