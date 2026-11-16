"""Actual reader and all four selectors with native-shaped inventory."""
import sys
import unittest
from unittest.mock import patch
from test_drone_protection import Fixture, hud, item

class DroneGroupDropdownTests(unittest.TestCase):
    def setUp(self):
        self.f=Fixture();self.f.add(200);self.hud=hud(self.f)
        self.miner='["Miners","group"]';self.fighter='["Fighters","fighter"]'
    def refresh(self):
        with patch.dict(sys.modules,self.f.modules):self.hud.RefreshDroneGroupsWork()
    def widgets(self):
        return self.hud.droneGroupEdit,self.hud.ratMiningGroupEdit,self.hud.ratFighterGroupEdit,self.hud.pveDroneGroup
    def test_deployed_groups_and_existing_drafts_survive_refresh(self):
        self.refresh()
        for widget in self.widgets():
            self.assertIn(('Fighters (1 deployed)',self.fighter),widget.options)
            self.assertIn(('Miners (5 in bay)',self.miner),widget.options)
        self.assertEqual([widget.GetValue()for widget in self.widgets()],[self.miner,self.miner,self.fighter,self.fighter])
        self.assertTrue(self.hud._dirty);self.assertFalse(self.hud._loading)
    def test_recall_refreshes_counts_without_changing_keys_or_selection(self):
        self.refresh();self.f.space.clear();self.f.bay.append(item(200,5));self.refresh()
        for widget in self.widgets():self.assertIn(('Fighters (5 in bay)',self.fighter),widget.options)
        self.assertEqual([widget.GetValue()for widget in self.widgets()],[self.miner,self.miner,self.fighter,self.fighter])
    def test_missing_saved_or_unsaved_group_keeps_its_key(self):
        missing='["Previous group","saved-id"]'
        for widget in self.widgets():widget.value=missing
        self.refresh()
        for widget in self.widgets():
            self.assertEqual(widget.GetValue(),missing)
            self.assertTrue(any('unavailable'in label and value==missing for label,value in widget.options))
if __name__=='__main__':unittest.main()
