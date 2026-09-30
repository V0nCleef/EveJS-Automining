"""Actual authored worker with native route/session API stand-ins; no client is contacted."""
import ast
import json
from types import SimpleNamespace as NS
import sys
import unittest
from unittest.mock import patch
from test_pve_client import Fixture, SOURCE

def deployment(phase='routeFleet'):
    f=Fixture(phase);f.job.update(deployment=True,anchor=dict(characterID=2,shipID=200,systemID=301),home=None)
    f.worker=f.scope['_AutoMiningPVE'](f.job);f.scope['_am_pve_job']=f.worker
    return f

class DeploymentTests(unittest.TestCase):
    def test_escort_offer_without_home_previews_then_claims_before_any_navigation(self):
        f=deployment();f.scope['_am_pve_job']=None
        def plan(raw):
            payload=json.loads(raw);f.events.append(('plan',payload));self.assertEqual(payload,dict(offerID='escort',shipID=100,systems=[300,301],homeSystems=[]))
            return json.dumps(dict(success=True,pve=dict(job=f.job)))
        f.AutoMiningPVEPlan=plan
        f.scope['_am_pve_prepare'](dict(success=True,pve=dict(deployment=dict(mode='escort',offers=[dict(id='escort',anchor=f.job['anchor'],home=None)]))))
        self.assertEqual(sum(e[0]=='thread' for e in f.events),1);self.assertFalse(any(e[0] in ('route','undock','warp','autopilot') for e in f.events))
        f.scope['_am_pve_prepare'](dict(success=True,pve=dict(job=f.job)));self.assertEqual(sum(e[0]=='thread' for e in f.events),1)
    def test_same_system_zero_standby_uses_zero_jump_paths_and_never_mutates_waypoints_to_preview(self):
        f=deployment();f.scope['_am_pve_job']=None;seen=[]
        f.AutoMiningPVEPlan=lambda raw:seen.append(json.loads(raw)) or json.dumps(dict(success=True,pve=dict(job=f.job)))
        offer=dict(id='incident',anchor=dict(systemID=300),home=dict(systemID=300,stationID=600),maxJumps=0)
        f.scope['_am_pve_prepare'](dict(success=True,pve=dict(deployment=dict(mode='standby',offers=[offer]))))
        self.assertEqual(seen[0]['systems'],[300]);self.assertEqual(seen[0]['homeSystems'],[300]);self.assertFalse(any(e[0] in ('route','preview') for e in f.events))
    def test_route_failure_visible_once_and_other_offers_still_considered_no_shortest_fallback(self):
        f=deployment();f.scope['_am_pve_job']=None
        f.GetAutopilotPathBetween=lambda source,destination:[]
        response=dict(success=True,pve=dict(deployment=dict(mode='escort',offers=[dict(id='escort',anchor=f.job['anchor'],home=None)])))
        f.scope['_am_pve_prepare'](response);f.scope['_am_pve_prepare'](response)
        self.assertEqual(sum(e[0]=='feedback' for e in f.events),1);self.assertFalse(any(e[0] in ('plan','route','autopilot','warp') for e in f.events))
    def test_exact_native_route_and_gate_grants_precede_autopilot_and_changed_path_cancels(self):
        f=deployment();f.worker.set_route(301,f.job)
        actions=[e[1] for e in f.events if e[0]=='rpc'];self.assertEqual(actions,['authorizeRoute','authorizeGate'])
        self.assertLess(next(i for i,e in enumerate(f.events) if e[:2]==('rpc','authorizeGate')),next(i for i,e in enumerate(f.events) if e[0]=='autopilot'))
        f.route=[302];self.assertRaisesRegex(RuntimeError,'Route changed',f.worker.check_selected_path)
        g=deployment();g.allow=False;self.assertFalse(g.worker.set_route(301,g.job));self.assertFalse(any(e[0]=='route' for e in g.events))
    def test_joining_and_paused_escort_poll_only_and_never_undock_or_reenable(self):
        for phase,paused in [('joining',False),('routeFleet',True)]:
            f=deployment(phase);f.job['paused']=paused;f.session.stationid=600;f.worker.run()
            self.assertFalse(any(e[0] in ('warp','undock','autopilot') for e in f.events));self.assertTrue(all(e[1]=='poll' for e in f.events if e[0]=='rpc'))
    def test_undock_phase_changed_after_poll_refreshes_then_orbits_anchor_without_cancellation(self):
        f=deployment('undocking');f.session.stationid=600;original=f.AutoMiningPVEAction
        def action(id,name,raw):
            if name=='authorizeUndock':
                f.events.append(('rpc',name,json.loads(raw)));f.session.stationid=None
                f.job.update(phase='engaging',nonce='n8',targetID=200,orbitKind='escort',orbitRange=2500,
                             anchor=dict(characterID=2,shipID=200,systemID=300))
                return json.dumps(dict(success=True,pve=dict(job=f.job,authorized=False)))
            return original(id,name,raw)
        f.AutoMiningPVEAction=action;f.worker.run()
        self.assertIn(('orbit',(200,2500)),f.events)
        self.assertFalse(any(e[0]=='undock' or e[:2]==('rpc','cancel') for e in f.events))
    def test_fleet_warp_ascii_literal_exact_authorized_anchor_and_malformed_anchor_fail_closed(self):
        f=deployment('warpFleet');f.session.solarsystemid=301;f.worker.run()
        self.assertIn(('warp',('char',2),dict(minRange=0,fleet=False)),f.events)
        g=deployment('warpFleet');g.session.solarsystemid=301;g.job['anchor']['characterID']=True;g.worker.run();self.assertFalse(any(e[0]=='warp' for e in g.events))
        tree=ast.parse(SOURCE);self.assertFalse(any(isinstance(n,ast.ImportFrom) and n.module=='__future__' and any(a.name=='unicode_literals' for a in n.names) for n in tree.body))
        calls=[n for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='CmdWarpToStuff'];self.assertTrue(all(isinstance(n.args[0],ast.Constant) and n.args[0].value in ('item','char') for n in calls))
    def test_return_home_uses_explicit_current_grants_and_native_session_dock_call(self):
        f=deployment('returning');f.job['home']=dict(stationID=600,systemID=300)
        f.InWarp=lambda:False;f.GetBallpark=lambda:NS(GetBall=lambda id:None)
        constants=NS(appConst=NS(minWarpDistance=150000))
        class UserError(Exception):
            def __init__(self,msg):self.msg=msg
        with patch.dict(sys.modules,{'eve':NS(),'eve.common':NS(),'eve.common.lib':constants,'eveexceptions':NS(UserError=UserError)}):
            f.worker.return_home(f.job);self.assertIn(('warp',('item',600),dict(minRange=0,fleet=False)),f.events)
            f.job['phase']='returning';f.GetBallpark=lambda:NS(GetBall=lambda id:NS(surfaceDist=1000))
            f.CmdDock=lambda *args:f.events.append(('dock',args));f.PerformSessionChange=lambda reason,fn,*args:fn(*args)
            f.worker.return_home(f.job);self.assertIn(('dock',(600,100)),f.events)
            self.assertFalse(any(e[0]=='autopilot' for e in f.events))
            f.PerformSessionChange=lambda *args:(_ for _ in ()).throw(UserError('DockingApproach'))
            f.worker.return_home(f.job)
            f.PerformSessionChange=lambda *args:(_ for _ in ()).throw(UserError('DockingRequestDenied'))
            with self.assertRaises(UserError):f.worker.return_home(f.job)
        g=deployment('returning');g.job['home']=dict(stationID=600,systemID=301)
        g.worker.oldRoute=[99];g.worker.ownedRoute=[301];g.worker.autoOwned=True;g.autopilot=1
        g.worker.approvedPath=[300,301];g.worker.routeDestination=(301,301);g.route=[302]
        g.worker.route_owned=lambda:True
        g.worker.run()
        cancel=next(e for e in g.events if e[:2]==('rpc','cancel'))
        self.assertEqual(cancel[2]['nonce'],'n0');self.assertIn('Route changed manually',cancel[2]['reason'])
        self.assertFalse(any(e[1]=='authorizeGate' for e in g.events if e[0]=='rpc'))
    def test_independent_heartbeat_runs_during_owned_worker_without_polling_or_consuming_nonce(self):
        f=deployment();token=(f.session.charid,object());f.scope['_am_pve_heartbeat']=token;nonce=f.worker.nonce
        f.scope['_am_blue'].pyos.synchro.SleepWallclock=lambda ms:None
        def heartbeat(id):
            f.events.append(('heartbeat',id));f.active=False
        f.AutoMiningPVEHeartbeat=heartbeat
        f.scope['_am_pve_idle'](f.session.charid,token)
        self.assertIn(('heartbeat','job'),f.events);self.assertEqual(f.worker.nonce,nonce);self.assertFalse(any(e[0]=='rpc' for e in f.events))
    def test_native_selected_drone_group_attestation_is_scoped_to_current_ship_and_saved_pve_group(self):
        f=deployment();key='["combat","one"]';reports=[]
        f.AutoMiningPVEReady=lambda:json.dumps(dict(success=True,pveDronesEnabled=True,pveDroneGroupKey=key))
        f.AutoMiningPVEAmmoGroups=lambda raw:reports.append(json.loads(raw)) or json.dumps(dict(success=True))
        control=NS(GetGroupByID=lambda group:dict(droneIDs=[888,777]))
        with patch.dict(sys.modules,{'eve':NS(),'eve.client':NS(),'eve.client.script':NS(),'eve.client.script.ui':NS(),
            'eve.client.script.ui.inflight':NS(),'eve.client.script.ui.inflight.drones':NS(),
            'eve.client.script.ui.inflight.drones.droneGroupsController':NS(GetDroneGroupsController=lambda:control)}):
            f.scope['_am_pve_ready_response']();self.assertEqual(reports,[dict(shipID=100,groupKey=key,ids=[777,888])])
            f.AutoMiningPVEReady=lambda:(setattr(f.session,'shipid',101) or json.dumps(dict(success=True,pveDronesEnabled=True,pveDroneGroupKey=key)))
            self.assertFalse(f.scope['_am_pve_ready_response']()['success']);self.assertEqual(len(reports),1)
    def test_idle_anchor_rat_and_anchor_again_use_exact_grants_and_invalid_anchor_never_moves(self):
        f=deployment('engaging');f.job.update(targetID=200,orbitKind='escort',orbitRange=10000,anchor=dict(characterID=2,shipID=200,systemID=300))
        original=f.AutoMiningPVEAction;targets=[(9,'hostile'),(200,'escort')]
        def action(id,name,raw):
            if name=='orbited':
                f.events.append(('rpc',name,json.loads(raw)))
                if targets:f.job['targetID'],f.job['orbitKind']=targets.pop(0)
                return json.dumps(dict(success=True,pve=dict(job=f.job)))
            return original(id,name,raw)
        f.AutoMiningPVEAction=action;f.worker.run();self.assertEqual([e[1] for e in f.events if e[0]=='orbit'],[(200,10000),(9,10000),(200,10000)])
        for target,range in [(201,10000),(200,float('nan')),(200,True)]:
            g=deployment('engaging');g.job.update(targetID=target,orbitKind='escort',orbitRange=range,anchor=dict(characterID=2,shipID=200,systemID=300));g.worker.run()
            self.assertFalse(any(e[0]=='orbit' for e in g.events))
    def test_skipped_owned_orbit_does_not_cache_or_ack_and_next_poll_retries(self):
        f=deployment('engaging');f.job.update(targetID=200,orbitKind='escort',anchor=dict(characterID=2,shipID=200,systemID=300));calls=[]
        def orbit(*args):calls.append(args);return dict(_amPVEOrbitSkipped=True) if len(calls)==1 else None
        f.CmdOrbit=orbit;f.worker.run();self.assertEqual(calls,[(200,10000),(200,10000)])
        self.assertEqual(sum(e[:2]==('rpc','orbited') for e in f.events),1)
        g=deployment('routeFleet');g.worker.orbit=(200,10000);g.job['paused']=True;g.worker.run()
        # A pause does not discard ownership before a verified Stop. Retain
        # it so a missing/denied native park or grant can retry next poll.
        self.assertEqual(g.worker.orbit,(200,10000))
        h=deployment('routeFleet');h.worker.orbit=(200,10000);h.worker.run();self.assertIsNone(h.worker.orbit)

if __name__=='__main__':unittest.main()
