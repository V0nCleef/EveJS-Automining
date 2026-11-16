"""Native-shaped offline data; actual overlay helpers and HUD methods, no runtime/RPC/UI."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace as NS
from unittest.mock import patch
import unittest

HERE=Path(__file__).resolve().parent
PROJECT=HERE.parent
SOURCE=PROJECT/'client/drones.py'
HINT="Refresh checks your drones in this ship's bay and under its control. If a saved group has no matches, close EVE and use Launcher Settings > Recover drone groups. Reopen EVE and refresh groups. If recovery cannot verify membership, regroup your drones in EVE."
def tr(source,*values):return source%values if values else source
def item(item_id,units=1,owner=42,ship=10,flag=87):
    return NS(itemID=item_id,ownerID=owner,locationID=ship,flagID=flag,categoryID=18,groupID=101,
              quantity=-1 if units==1 else units,stacksize=units,singleton=1 if units==1 else 0)

spec=importlib.util.spec_from_file_location('generic_baseline_launch',HERE/'test_drones_client.py')
baseline=importlib.util.module_from_spec(spec);spec.loader.exec_module(baseline)
BaseFixture=baseline.Fixture
class Fixture(BaseFixture):
    def __init__(self,*args,**kwargs):
        with patch.dict(os.environ,{'AUTOMINING_DRONES_SOURCE':str(SOURCE)}):super().__init__(*args,**kwargs)
        self.scope['_am_tr']=tr
        self.bay=[item(row.itemID,row.stacksize)for row in self.bay]
        self.ballpark=True
        self.michelle=NS(InWarp=lambda:self.in_warp,GetDrones=lambda:self.space,
                          GetBallpark=lambda:object()if self.ballpark else None)
        self.scope['sm'].GetService=lambda name:self.michelle
        self.group['id']=['Miners','group']
        self.named={'Miners':self.group,'Fighters':{'id':['Fighters','fighter'],'droneIDs':{200}}}
        self.controller.GetGroupsByName=lambda:self.named
        self.groups[('Fighters','fighter')]=self.named['Fighters']
    def query(self):
        with patch.dict(sys.modules,self.modules):return self.scope['_am_drone_groups'](self.scope['_am_drone_bay']())
    def info(self,name='Miners'):
        return next(info for _,label,info in self.query()if label==name)

class Combo:
    def __init__(self,value):self.value=value;self.options=[]
    def GetValue(self):return self.value
    def GetKey(self):return next(label for label,value in self.options if value==self.value)
    def LoadOptions(self,options,select):
        self.options=options
        # Reproduce native fallback risk: if no explicit matching choice, choose first.
        self.value=select if any(value==select for _,value in options)else options[0][1]

def hud(fixture):
    scope=dict(fixture.scope,text=str)
    tree=ast.parse((PROJECT/'client/hud.py').read_text(encoding='utf8'))
    methods={'DroneGroupLabel','DroneGroupHint','LoadDroneGroups','LoadPVEDroneGroups','RefreshDroneGroupsWork'}
    nodes=[node for node in ast.walk(tree)if isinstance(node,ast.FunctionDef)and node.name in methods]
    exec(compile(ast.Module(body=nodes,type_ignores=[]),'actual-generic-HUD','exec'),scope)
    cls=type('HUD',(),{name:scope[name]for name in methods})
    window=cls();window.ValidCharacter=lambda:True
    window.SetNotice=lambda message:(_ for _ in ()).throw(AssertionError(message))
    window._loading=False;window._dirty=True
    window.droneGroupEdit=Combo('["Miners","group"]')
    window.ratMiningGroupEdit=Combo('["Miners","group"]')
    window.ratFighterGroupEdit=Combo('["Fighters","fighter"]')
    window.pveDroneGroup=Combo('["Fighters","fighter"]')
    return window

class ProtectionTests(unittest.TestCase):
    def test_stack_units_and_singletons_are_available(self):
        f=Fixture((5,1));self.assertEqual(f.info(),{'bay':6,'deployed':0,'state':'matched'})
    def test_character_and_ship_identity_are_generic(self):
        for character,ship in ((42,10),(79,20),(140100901,9988500012345)):
            with self.subTest(character=character,ship=ship):
                f=Fixture();f.session.charid=character;f.session.shipid=ship
                f.bay=[item(100,5,owner=character,ship=ship)]
                self.assertEqual(f.info()['bay'],5)
                f.bay[0].ownerID=character+1
                self.assertEqual(f.info()['state'],'unmatched')
    def test_native_bay_read_is_used_docked_without_a_mod_rpc(self):
        f=Fixture();f.session.stationid=600
        self.assertEqual(f.info()['bay'],5);self.assertEqual(f.info()['deployed'],0)
        self.assertEqual(f.claims,[])
    def test_deployed_groups_stay_present_and_are_counted(self):
        f=Fixture();f.bay=[]
        for i in range(5):f.group['droneIDs'].add(300+i);f.add(300+i)
        self.assertEqual(f.info(),{'bay':0,'deployed':5,'state':'deployed'})
        self.assertEqual({name for _,name,_ in f.query()},{'Miners','Fighters'})
    def test_mixed_bay_and_deployed_units(self):
        f=Fixture((3,));f.group['droneIDs'].add(300);f.add(300)
        self.assertEqual(f.info(),{'bay':3,'deployed':1,'state':'matched'})
    def test_stale_native_group_is_unmatched_instead_of_uncounted_valid_name(self):
        f=Fixture();f.group['droneIDs']={777}
        self.assertEqual(f.info(),{'bay':0,'deployed':0,'state':'unmatched'})
    def test_wrong_owner_wrong_ship_and_wrong_flag_do_not_count_in_bay(self):
        f=Fixture();f.bay=[item(100,owner=43),item(101,ship=11),item(102,flag=5)]
        f.group['droneIDs']={100,101,102}
        self.assertEqual(f.info()['state'],'unmatched')
    def test_space_requires_owner_and_controller_not_native_helper_or_rule(self):
        f=Fixture();f.bay=[]
        for i,owner,ship in ((300,43,10),(301,42,11),(302,42,10)):
            f.group['droneIDs'].add(i);f.add(i,owner,ship)
        self.assertEqual(f.info()['deployed'],1)
    def test_unknown_native_inventory_never_claims_stale_or_usable(self):
        f=Fixture();f.modules['eve.client.script.ui.inflight.drones.dronesUtil'].GetDronesInBay=lambda:None
        self.assertEqual(f.info()['state'],'unknown')
    def test_missing_identity_metadata_never_counts_as_owned(self):
        f=Fixture();del f.bay[0].ownerID
        self.assertEqual(f.info()['state'],'unknown')
    def test_no_ballpark_and_no_bay_information_is_unknown(self):
        f=Fixture();f.ballpark=False
        f.modules['eve.client.script.ui.inflight.drones.dronesUtil'].GetDronesInBay=lambda:None
        self.assertEqual(f.info(),{'bay':None,'deployed':None,'state':'unknown'})
    def test_ship_change_during_native_read_drops_availability(self):
        f=Fixture()
        def changed():f.session.shipid=11;return f.bay
        f.modules['eve.client.script.ui.inflight.drones.dronesUtil'].GetDronesInBay=changed
        self.assertEqual(f.info()['state'],'unknown')
    def test_observation_never_mutates_native_membership(self):
        f=Fixture();before=copy.deepcopy(f.named);f.query();self.assertEqual(f.named,before)
    def test_every_dropdown_labels_unmatched_and_preserves_all_draft_keys(self):
        f=Fixture();f.group['droneIDs']={777};w=hud(f)
        with patch.dict(sys.modules,f.modules):w.RefreshDroneGroupsWork()
        for widget in (w.droneGroupEdit,w.ratMiningGroupEdit,w.ratFighterGroupEdit,w.pveDroneGroup):
            self.assertIn(('Miners (no matching drones here)','["Miners","group"]'),widget.options)
            self.assertEqual(widget.hint,HINT)
        self.assertEqual(w.droneGroupEdit.GetValue(),'["Miners","group"]')
        self.assertEqual(w.ratFighterGroupEdit.GetValue(),'["Fighters","fighter"]')
        self.assertTrue(w._dirty);self.assertFalse(w._loading)
    def test_all_four_saved_missing_keys_survive_refresh(self):
        f=Fixture();w=hud(f);missing='["Old","unchanged-id"]'
        for widget in (w.droneGroupEdit,w.ratMiningGroupEdit,w.ratFighterGroupEdit,w.pveDroneGroup):widget.value=missing
        with patch.dict(sys.modules,f.modules):w.RefreshDroneGroupsWork()
        self.assertTrue(all(widget.GetValue()==missing for widget in (w.droneGroupEdit,w.ratMiningGroupEdit,w.ratFighterGroupEdit,w.pveDroneGroup)))
    def test_empty_pve_selection_stays_empty_when_groups_exist(self):
        f=Fixture();w=hud(f);w.pveDroneGroup.value=''
        with patch.dict(sys.modules,f.modules):w.RefreshDroneGroupsWork()
        self.assertEqual(w.pveDroneGroup.GetValue(),'')
    def test_deployed_label_and_selection_survive_refresh(self):
        f=Fixture();f.bay=[];f.add(100);w=hud(f)
        with patch.dict(sys.modules,f.modules):w.RefreshDroneGroupsWork()
        self.assertEqual(w.droneGroupEdit.GetKey(),'Miners (1 deployed)')
    def test_unmatched_launch_is_explanatory_and_refuses_before_claim(self):
        f=Fixture();f.group['droneIDs']={777};result=f.run()
        self.assertIn('no owned drones',result['text']);self.assertIn('Recover drone groups',result['text'])
        self.assertEqual(f.claims,[]);self.assertEqual(f.launches,[])
    def test_wrong_owner_launch_refuses_before_claim(self):
        f=Fixture();f.bay[0].ownerID=43;f.run()
        self.assertEqual(f.claims,[]);self.assertEqual(f.launches,[])
    def test_already_deployed_does_not_relaunch_claim_or_adopt_manual_drones(self):
        f=Fixture();f.bay=[];f.add(100);result=f.run()
        self.assertIn('already deployed',result['text']);self.assertEqual(result['ids'],[])
        self.assertEqual(f.claims,[]);self.assertEqual(f.launches,[])
    def test_unknown_bay_launch_waits_without_claim(self):
        f=Fixture();f.modules['eve.client.script.ui.inflight.drones.dronesUtil'].GetDronesInBay=lambda:None
        self.assertIn('not ready',f.run()['text']);self.assertEqual(f.claims,[])
    def test_group_name_does_not_assign_or_substitute_unrelated_drones(self):
        f=Fixture();f.group['droneIDs']={777};before=copy.deepcopy(f.named);f.run()
        self.assertEqual(f.named,before);self.assertEqual(f.launches,[])
    def test_native_declared_kind_mismatch_does_not_count_or_launch(self):
        f=Fixture();f.group['droneGroupID']=100
        self.assertEqual(f.info()['state'],'unmatched')
        f.run();self.assertEqual(f.claims,[]);self.assertEqual(f.launches,[])
    def test_group_name_is_not_used_to_guess_drone_kind(self):
        f=Fixture();f.named={'Combat sounding custom name':f.group};f.group['droneGroupID']=101
        self.assertEqual(f.info('Combat sounding custom name')['bay'],5)

    def test_recovery_guidance_names_exact_action_and_closes_eve_first(self):
        self.assertIn('close EVE',HINT);self.assertIn('Launcher Settings > Recover drone groups',HINT)
        for missing in (False,True):
            f=Fixture();f.group['droneIDs']={777}
            if missing:f.groups.clear()
            result=f.run()
            self.assertIn('close EVE',result['text']);self.assertIn('Launcher Settings > Recover drone groups',result['text'])
            self.assertEqual(f.claims,[]);self.assertEqual(f.launches,[])
    def test_unicode_identity_and_all_selections_are_preserved(self):
        f=Fixture();name='Mïnérs "独"';identity=[name,'opaque:Ω/1']
        f.group['id']=identity;f.named={name:f.group};f.groups={tuple(identity):f.group}
        before=copy.deepcopy(f.named);key=json.dumps(identity,ensure_ascii=True,separators=(',',':'))
        w=hud(f);widgets=(w.droneGroupEdit,w.ratMiningGroupEdit,w.ratFighterGroupEdit,w.pveDroneGroup)
        for widget in widgets:widget.value=key
        with patch.dict(sys.modules,f.modules):w.RefreshDroneGroupsWork()
        for widget in widgets:
            self.assertEqual(widget.GetValue(),key);self.assertIn((name+' (5 in bay)',key),widget.options)
        self.assertEqual(f.named,before)

def load_tests(loader,tests,pattern):
    baseline.Fixture=Fixture
    suite=unittest.TestSuite([loader.loadTestsFromTestCase(ProtectionTests)])
    return suite

if __name__=='__main__':unittest.main()
