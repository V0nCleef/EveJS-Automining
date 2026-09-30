"""Source-only native API stand-ins; no EVE process or server is contacted."""
import json
from pathlib import Path
from types import SimpleNamespace as NS
import unittest

SOURCE=(Path(__file__).resolve().parents[1]/'client/pve.py').read_text()

class Fixture:
    def __init__(self, phase='engaging'):
        self.events=[];self.route=[99];self.autopilot=0;self.saved={};self.active=True;self.allow=True;self.steps=0
        self.session=NS(charid=1,shipid=100,stationid=None,solarsystemid=300)
        self.job=dict(id='job',nonce='n0',shipID=100,phase=phase,belt=dict(beltID=700,systemID=301),targetID=9,orbitRange=10000)
        self.scope=dict(unicode=str,session=self.session,sm=NS(GetService=lambda name:self,RemoteSvc=lambda name:self),settings=NS(char=NS(ui=self)),_am_json=json,
            _am_uthread=NS(new=lambda fn,*args:self.events.append(('thread',fn.__name__))),_am_blue=NS(pyos=NS(synchro=NS(SleepWallclock=self.sleep))),
            _am_is_active=lambda:self.active,_am_docked_location_id=lambda:self.session.stationid or 0,
            _am_feedback=lambda *args:self.events.append(('feedback',)),_am_tr=lambda text:text,EveCommandService=type('Commands',(),{'__notifyevents__':[]}))
        exec(SOURCE,self.scope)
        self.worker=self.scope['_AutoMiningPVE'](self.job);self.scope['_am_pve_job']=self.worker
    def Get(self,key,default=None):return self.saved.get(key,default)
    def Set(self,key,value):self.saved[key]=value
    def GetWaypoints(self):return self.route[:]
    def SetWaypoints(self,values):self.route=values[:];self.events.append(('route',values[:]))
    def GetDestinationPath(self):return self.route[:]
    def GetAutopilotPathBetween(self,source,destination):self.events.append(('preview',source,destination));return [destination]
    def GetNextItemIDInRoute(self):return 900
    def GetState(self):return self.autopilot
    def SetOn(self):self.autopilot=1;self.events.append(('autopilot',True))
    def SetOff(self):self.autopilot=0;self.events.append(('autopilot',False))
    def GetRemotePark(self):return self
    def CmdWarpToStuff(self,*args,**kwargs):self.events.append(('warp',args,kwargs))
    def CmdOrbit(self,*args):self.events.append(('orbit',args))
    def ExitDockableLocation(self):self.events.append(('undock',));self.session.stationid=None;self.job['phase']='routeBelt'
    def AutoMiningPVEReady(self):self.events.append(('ready',));return json.dumps(dict(success=True))
    def AutoMiningPVEAction(self,id,action,raw):
        payload=json.loads(raw);self.events.append(('rpc',action,payload));assert id=='job'
        if action not in ('poll','cancel'):assert payload['nonce']==self.job['nonce']
        authorized=False
        if action.startswith('authorize') and self.allow:
            authorized=True;self.job['nonce']='n'+str(int(self.job['nonce'][1:])+1)
            self.job['grant']={'authorizeWarp':'authorizeWarp' if self.job.get('deployment') else 'warp','authorizeOrbit':'orbit'}.get(action,action)
            if action=='authorizeRoute':
                destination=self.job.get('home') if self.job['phase']=='returning' else self.job.get('anchor') if self.job.get('deployment') else self.job['belt']
                self.job['route']=dict(systems=payload['systems'],destinationID=destination.get('stationID') or destination['systemID'],destinationSystemID=destination['systemID'])
        elif action=='warped':self.job['phase']='engaging'
        elif action in ('orbited','cancel'):self.job=None
        return json.dumps(dict(success=True,pve=dict(job=self.job,authorized=authorized)))
    def sleep(self,ms):
        self.steps+=1
        if self.steps>5:self.active=False
        if self.job and self.job['phase']=='routeBelt':self.session.solarsystemid=301;self.route=[];self.job['phase']='warpBelt'
        if ms==5000:self.active=False

class PVETests(unittest.TestCase):
    def test_paused_anchor_stops_owned_orbit_only_after_fresh_authorization(self):
        f=Fixture('routeFleet');f.job.update(deployment=True,paused=True,targetID=None,orbitRange=0)
        f.worker.orbit=(200,2500)
        requests=[];stops=[]
        f.worker.authorize=lambda action,phase,grant:requests.append((action,phase,grant)) or None
        f.CmdStop=lambda:stops.append('stop')
        f.worker.stop_orbit(f.job)
        self.assertEqual(stops,[]);self.assertEqual(f.worker.orbit,(200,2500))
        f.worker.authorize=lambda action,phase,grant:requests.append((action,phase,grant)) or f.job
        f.worker.stop_orbit(f.job)
        self.assertEqual(stops,['stop']);self.assertIsNone(f.worker.orbit)
        self.assertEqual(requests,[('authorizeStopOrbit','routeFleet','stop')]*2)

    def test_import_registers_only_no_gameplay(self):
        f=Fixture();self.assertEqual(f.events,[])
        self.assertIn('OnAutoMiningPVE',f.scope['EveCommandService'].__notifyevents__)
    def test_cross_system_native_route_then_warp_and_authorized_orbit(self):
        f=Fixture('routeBelt');f.worker.run()
        self.assertIn(('route',[301]),f.events);self.assertEqual(f.route,[99])
        self.assertIn(('warp',('item',700),dict(minRange=0,fleet=False)),f.events)
        self.assertIn(('orbit',(9,10000)),f.events)
        self.assertLess(next(i for i,e in enumerate(f.events) if e[:2]==('rpc','authorizeWarp')),next(i for i,e in enumerate(f.events) if e[0]=='warp'))
        self.assertEqual(sum(e[0]=='orbit' for e in f.events),1)
    def test_denied_orbit_never_issues_movement(self):
        f=Fixture();f.allow=False;f.worker.run();self.assertFalse(any(e[0] in ('warp','orbit') for e in f.events))
    def test_station_start_undocks_once(self):
        f=Fixture('undocking');f.session.stationid=600;f.worker.run();self.assertEqual(sum(e[0]=='undock' for e in f.events),1)
    def test_changed_target_before_authorization_or_ack_refreshes_without_cancelling(self):
        for changed_action in ('authorizeOrbit', 'orbited'):
            f=Fixture();original=f.AutoMiningPVEAction;changed=[]
            def action(id,name,raw):
                if name==changed_action and not changed:
                    changed.append(True);f.events.append(('rpc',name,json.loads(raw)))
                    f.job.update(nonce='n8',targetID=10)
                    return json.dumps(dict(success=True,pve=dict(job=f.job,authorized=False)))
                return original(id,name,raw)
            f.AutoMiningPVEAction=action;f.worker.run()
            self.assertEqual([e[1] for e in f.events if e[0]=='orbit'],
                             [(10,10000)] if changed_action=='authorizeOrbit' else [(9,10000),(10,10000)])
            self.assertFalse(any(e[:2]==('rpc','cancel') for e in f.events))
    def test_worker_failure_reports_action_and_phase_with_cancellation(self):
        f=Fixture();f.CmdOrbit=lambda *args:(_ for _ in ()).throw(RuntimeError('native orbit failed\nextra'))
        f.worker.run();cancel=next(e for e in f.events if e[:2]==('rpc','cancel'))
        self.assertIn('action=authorizeOrbit phase=engaging native orbit failed extra',cancel[2]['reason'])
        self.assertTrue(f.worker.cancelled)
    def test_ship_identity_change_prevents_rpc_and_motion(self):
        f=Fixture();f.session.shipid=101;f.worker.run();self.assertEqual(f.events,[])
    def test_cleanup_preserves_user_route_and_other_job_marker(self):
        f=Fixture();f.worker.set_route(301);f.route=[302];f.worker.cleanup_route();self.assertEqual(f.route,[302])
        f=Fixture();f.worker.set_route(301);f.saved['evejsAutoMiningPVE']={'id':'newjob'};f.worker.cleanup_route();self.assertEqual(f.route,[301]);self.assertEqual(f.saved['evejsAutoMiningPVE']['id'],'newjob')
    def test_reconnect_restores_owned_route_without_replaying_move(self):
        f=Fixture();f.scope['_am_pve_job']=None;f.route=[301];f.autopilot=1;f.saved['evejsAutoMiningPVE']={'id':'old','owned':[301],'old':[99]};f.scope['_am_pve_ready']()
        self.assertEqual(f.route,[99]);self.assertIn(('ready',),f.events);self.assertFalse(any(e[0] in ('warp','orbit','undock') for e in f.events))

if __name__=='__main__':unittest.main()
