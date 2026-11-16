"""Actual reader; native identity and bay/deployed availability."""
import copy
import json
import sys
import unittest
from unittest.mock import patch
from test_drone_protection import Fixture, item

class DroneGroupsTests(unittest.TestCase):
    def setUp(self):
        self.f=Fixture((5,2));self.f.group['droneIDs']={100}
        self.f.named['Fighters']['droneIDs']={101}
        self.f.named['Other ship']={'id':['Other ship','3'],'droneIDs':{99}}
    def rows(self,bay=None):
        with patch.dict(sys.modules,self.f.modules):
            return self.f.scope['_am_drone_groups'](self.f.scope['_am_drone_bay']()if bay is None else bay)
    def test_native_read_counts_active_bay_without_mod_rpc_or_hiding_groups(self):
        rows=self.rows()
        self.assertEqual([(name,info['bay'])for _,name,info in rows],[('Miners',5),('Fighters',2),('Other ship',0)])
        self.assertEqual(json.loads(rows[0][0]),['Miners','group']);self.assertEqual(self.f.claims,[])
    def test_ship_change_updates_counts_without_discarding_groups(self):
        self.f.session.shipid=200;self.f.bay=[item(99,ship=200)]
        self.assertEqual([(name,info['bay'])for _,name,info in self.rows()],[('Other ship',1),('Fighters',0),('Miners',0)])
    def test_stacks_count_units_instead_of_inventory_rows(self):
        self.f.group['droneIDs']={100,102};self.f.bay=[item(100,5),item(102,1),item(101,10)]
        self.assertEqual([(name,info['bay'])for _,name,info in self.rows()],[('Fighters',10),('Miners',6),('Other ship',0)])
    def test_deployed_fighters_stay_selectable_while_miners_are_in_bay(self):
        before=copy.deepcopy(self.f.named);self.f.bay=[item(100,5)];self.f.add(101)
        row=next(row for row in self.rows()if row[1]=='Fighters')
        self.assertEqual(row[2],{'bay':0,'deployed':1,'state':'deployed'});self.assertEqual(self.f.named,before)
    def test_empty_unknown_unmatched_cross_context_bays_preserve_groups(self):
        for bay in ({'characterID':42,'shipID':10,'itemIDs':[]},{'characterID':42,'shipID':10,'itemIDs':[555]},
                    {'characterID':42,'shipID':999,'itemIDs':[100]},{}):
            with self.subTest(bay=bay):
                rows=self.rows(bay)
                self.assertEqual({name for _,name,_ in rows},{'Fighters','Miners','Other ship'})
                expected='unmatched'if bay.get('shipID')==10 else 'unknown'
                self.assertTrue(all(info['state']==expected for _,_,info in rows))
if __name__=='__main__':unittest.main()
