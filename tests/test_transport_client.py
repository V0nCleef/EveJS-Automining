"""Native API stand-ins verify worker contracts; they do not prove live flight."""
import ast
import copy
import json
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace as NS
import unittest
SOURCE=(Path(__file__).resolve().parents[1]/'client/transport.py').read_text()

class Fixture:
    def __init__(self, phase='warpPickup'):
        self.events=[];self.saved={};self.route=[999];self.autopilot=0;self.allow=True;self.active=True;self.sleeps=0;self.mode=None
        self.session=NS(charid=42,shipid=10,stationid=None,structureid=None,solarsystemid=30)
        self.job=dict(id='one',nonce='n0',shipID=10,phase=phase,approachRange=100,approachNeeded=True,miner=dict(characterID=43,shipID=11,systemID=31),station=dict(stationID=600),storage=dict(kind='corporation',locationID=777,flagID=116),flagID=134,transfers=[],items=[dict(itemID=9)])
        self.scope=dict(unicode=str,session=self.session,sm=NS(GetService=lambda name:self,RemoteSvc=lambda name:self),settings=NS(char=NS(ui=self)),_am_json=json,
            _am_blue=NS(pyos=NS(synchro=NS(SleepWallclock=self.sleep))),_am_uthread=NS(new=lambda fn,*args:self.events.append(('thread',fn.__name__,args))),
            _am_is_active=lambda:self.active,_am_feedback=lambda *args:self.events.append(('feedback',)),_am_tr=lambda source,*args:source%args if args else source,_am_status=str,
            _am_docked_location_id=lambda:self.session.structureid or self.session.stationid or 0,EveCommandService=type('Commands',(),{'__notifyevents__':[]}))
        exec(SOURCE,self.scope);self.worker=self.scope['_AutoMiningTransport'](self.job);self.scope['_am_transport_job']=self.worker
    def Get(self,key,default=None):return self.saved.get(key,default)
    def Set(self,key,value):self.saved[key]=value
    def GetWaypoints(self):return self.route[:]
    def SetWaypoints(self,route):self.route=route[:];self.events.append(('route',route[:]))
    def GetDestinationPath(self):return [None] if self.mode=='no-route' else self.route[:]
    def GetState(self):return self.autopilot
    def SetOn(self):self.autopilot=1;self.events.append(('on',))
    def SetOff(self):self.autopilot=0;self.events.append(('off',))
    def GetRemotePark(self):return self
    def CmdWarpToStuff(self,*args,**kwargs):self.events.append(('warp',args,kwargs))
    def CmdFollowBall(self,*args):self.events.append(('approach',args))
    def GetInventoryFromId(self,item):self.events.append(('inventory',item));return self
    def Add(self,item,location,**kwargs):self.events.append(('add',item,location,kwargs))
    def MultiAdd(self,items,source,**kwargs):self.events.append(('multiadd',items,source,kwargs))
    def ExitDockableLocation(self):self.events.append(('undock',));self.session.stationid=None;self.session.structureid=None;self.job['phase']='routePickup'
    def AutoMiningTransportReady(self):self.events.append(('ready',));return json.dumps(dict(success=True))
    def AutoMiningTransportAction(self,id,action,raw):
        payload=json.loads(raw);self.events.append(('rpc',action,payload));assert id=='one'
        if action!='poll' and action!='cancel':assert payload['nonce']==self.job['nonce']
        granted=False
        if action.startswith('authorize') and self.allow:
            granted=True;self.job['nonce']='n'+str(int(self.job['nonce'][1:])+1)
            self.job['grant']={'authorizeWarp':'warp','authorizeApproach':'approach','authorizeTransfer':'transfer','authorizeUnload':'unload'}[action]
            if action=='authorizeTransfer':self.job['transfers']=[dict(itemID=9,typeID=123,sourceLocationID=50,quantity=7,flagID=134)]
        elif action=='warped':self.job['phase']='approachPickup'
        elif action=='arrived':self.job['phase']='loading'
        elif action=='loaded':
            if self.mode=='receipt':return json.dumps(dict(success=False,message='Native ore transfer receipt could not be verified.'))
            self.job['phase']='outbound'
        elif action=='unloaded':
            if self.mode=='docked-complete':self.job=None
            else:self.job['phase']='undocking'
        elif action=='cancel':self.job=None
        return json.dumps(dict(success=True,transport=dict(job=copy.deepcopy(self.job),authorized=granted)))
    def sleep(self,ms):
        self.events.append(('sleep',ms));self.sleeps+=1
        if ms==5000:
            if self.sleeps>=2:self.active=False
            return
        if self.sleeps>12:raise RuntimeError('fixture loop exceeded')
        if self.job is None:return
        if self.job['phase']=='joining':
            self.events.append(('joined',));self.job['phase']='undocking'
        elif self.job['phase']=='routePickup':self.session.solarsystemid=31;self.job['phase']='warpPickup'
        elif self.job['phase']=='outbound' and self.worker.stage=='outbound':self.session.structureid=600;self.job['phase']='unloading'
        elif self.job['phase']=='routePickup' and not self.job.get('miner'):self.job=None
        if any(e[0]=='multiadd' for e in self.events) and sum(e[0]=='undock' for e in self.events)>=(2 if self.mode=='initial-dock' else 1):self.job=None

class TransportTests(unittest.TestCase):
    def test_python2_warp_subject_returns_authored_ascii_literals(self):
        tree=ast.parse(SOURCE)
        method=next(node for node in ast.walk(tree) if isinstance(node,ast.FunctionDef) and node.name=='warp_subject')
        returns=[node.value for node in ast.walk(method) if isinstance(node,ast.Return)]
        self.assertTrue(all(isinstance(value,ast.Constant) and type(value.value) is str for value in returns))
        self.assertEqual([value.value for value in returns],['item','char'])
        # No unicode_literals future import: these exact ASCII literals are PyString on Python2.
        self.assertFalse(any(isinstance(node,ast.ImportFrom) and node.module=='__future__' and
                             any(alias.name=='unicode_literals' for alias in node.names) for node in tree.body))

    @unittest.skipUnless(os.environ.get('EVEJS_MARSHAL_FIXTURE'),'actual native marshal fixture path required')
    def test_native_marshal_explains_unicode_failure_and_preserves_literal_subject_and_target(self):
        script="const m=require(process.argv[1]);const rows=['item','char'].map((s,i)=>{const target=50+i;const round=v=>m.marshalDecode(m.marshalEncode({type:'tuple',items:[v,target]}));const u=round({type:'wstring',value:s}),a=round(s);return{subject:s,unicode:String(u[0]),literal:String(a[0]),unicodeTarget:u[1],literalTarget:a[1]};});process.stdout.write(JSON.stringify(rows));"
        rows=json.loads(subprocess.check_output(['node','-e',script,os.environ['EVEJS_MARSHAL_FIXTURE']]))
        self.assertEqual(rows,[dict(subject=s,unicode='[object Object]',literal=s,unicodeTarget=50+i,literalTarget=50+i)
                               for i,s in enumerate(['item','char'])])

    def test_json_unicode_subjects_use_native_ascii_literals_after_current_authorization(self):
        class JsonUnicode(str):
            pass
        for subject, target in [('char',43),('item',50)]:
            with self.subTest(subject=subject):
                f=Fixture();f.job['miner'].update(warpType=subject,targetID=target)
                def unicode_reply(raw):
                    reply=json.loads(raw)
                    job=(reply.get('transport') or {}).get('job')
                    if job:
                        job['miner']['warpType']=JsonUnicode(job['miner']['warpType'])
                    return reply
                f.scope['_am_json']=NS(loads=unicode_reply,dumps=json.dumps)
                original=f.CmdWarpToStuff
                def native_warp(*args,**kwargs):
                    # TQ PyUnicode becomes a tagged wstring in native marshal.
                    self.assertIs(type(args[0]),str)
                    original(*args,**kwargs)
                f.CmdWarpToStuff=native_warp
                f.worker.run()
                self.assertIn(('warp',(subject,target),dict(minRange=0,fleet=False)),f.events)
                self.assertLess(next(i for i,e in enumerate(f.events) if e[:2]==('rpc','authorizeWarp')),
                                next(i for i,e in enumerate(f.events) if e[0]=='warp'))
                self.assertFalse(any(e[:2]==('rpc','cancel') for e in f.events),f.events)

    def test_unknown_warp_subject_is_rejected_before_authorization_or_native_movement(self):
        for subject in ['bookmark','scan','externalDungeon',None,{},123]:
            with self.subTest(subject=subject):
                f=Fixture();job=dict(miner=dict(warpType=subject))
                with self.assertRaisesRegex(RuntimeError,'Transport job changed'):
                    f.worker.warp_subject(job)
                self.assertFalse(f.events)
        f=Fixture();f.job['miner']['warpType']='bookmark';f.worker.run()
        self.assertFalse(any(e[:2]==('rpc','authorizeWarp') or e[0] in ('warp','approach') for e in f.events))
        self.assertTrue(any(e[:2]==('rpc','cancel') for e in f.events))

    def test_cross_system_native_collection_delivery(self):
        f=Fixture('routePickup');f.worker.run()
        self.assertIn(('route',[31]),f.events);self.assertIn(('route',[600]),f.events);self.assertEqual(f.route,[999])
        self.assertIn(('warp',('char',43),dict(minRange=0,fleet=False)),f.events)
        self.assertIn(('approach',(11,100)),f.events)
        self.assertIn(('add',9,50,dict(qty=7,flag=134)),f.events)
        self.assertIn(('multiadd',[9],10,dict(flag=116)),f.events)
        self.assertEqual(sum(e[0]=='add' for e in f.events),1)
        self.assertLess(next(i for i,e in enumerate(f.events) if e[:2]==('rpc','authorizeTransfer')),next(i for i,e in enumerate(f.events) if e[0]=='add'))
        self.assertFalse(any(e[:2]==('rpc','cancel') for e in f.events),f.events)
    def test_no_native_move_without_current_grant(self):
        f=Fixture();f.allow=False
        self.assertIsNone(f.worker.authorize('authorizeWarp','warpPickup','warp'))
        f.worker.collect(dict(transfers=[]));f.worker.unload()
        self.assertFalse(any(e[0] in ('warp','approach','add','multiadd') for e in f.events))
    def test_authorized_arrival_clearance_skips_follow_when_already_in_native_range(self):
        f=Fixture('approachPickup');f.job['approachNeeded']=False;f.worker.run()
        self.assertFalse(any(e[0]=='approach' for e in f.events),f.events)
        self.assertTrue(any(e[:2]==('rpc','authorizeApproach') for e in f.events))
        self.assertTrue(any(e[:2]==('rpc','arrived') for e in f.events))
        self.assertTrue(any(e[0]=='add' for e in f.events))
    def test_approach_uses_fresh_authorized_clearance_and_rejects_unknown_values(self):
        f=Fixture('approachPickup');f.job['approachRange']=0
        original=f.AutoMiningTransportAction
        def current_grant(id,action,raw):
            if action=='authorizeApproach':f.job['approachRange']=100
            return original(id,action,raw)
        f.AutoMiningTransportAction=current_grant;f.worker.run()
        self.assertIn(('approach',(11,100)),f.events)
        for distance in [None,0,True,2500,'100']:
            with self.subTest(distance=distance):
                f=Fixture('approachPickup');f.job['approachRange']=distance;f.worker.run()
                self.assertFalse(any(e[0]=='approach' or e[:2]==('rpc','arrived') for e in f.events))
                self.assertTrue(any(e[:2]==('rpc','cancel') for e in f.events))
    def test_poll_adopts_nonce_and_wrong_phase_does_not_grant(self):
        f=Fixture();f.job['nonce']='n9';f.worker.request();self.assertEqual(f.worker.nonce,'n9')
        f.job['phase']='outbound';self.assertIsNone(f.worker.authorize('authorizeWarp','warpPickup','warp'))
    def test_empty_initial_transfer_list_asks_server_for_one_stack(self):
        f=Fixture('loading');f.worker.collect(f.job)
        call=next(e for e in f.events if e[:2]==('rpc','authorizeTransfer'))
        self.assertNotIn('itemID',call[2]);self.assertIn(('add',9,50,dict(qty=7,flag=134)),f.events)
        loaded=next(e for e in f.events if e[:2]==('rpc','loaded'));self.assertEqual(loaded[2]['nonce'],'n1')
    def test_receipt_failure_does_not_retry_inventory_move(self):
        f=Fixture('loading');f.mode='receipt';f.worker.run()
        self.assertEqual(sum(e[0]=='add' for e in f.events),1)
        self.assertTrue(any(e[:2]==('rpc','cancel') for e in f.events))
    def test_manual_route_is_preserved_and_manual_autopilot_stop_aborts(self):
        f=Fixture('routePickup');f.worker.set_route(31);f.route=[88]
        with self.assertRaisesRegex(RuntimeError,'manually'):f.worker.check_route()
        f.worker.cleanup();self.assertEqual(f.route,[88])
        g=Fixture();g.worker.set_route(31);g.autopilot=0
        with self.assertRaisesRegex(RuntimeError,'stopped'):g.worker.check_route(navigating=True)
    def test_ship_change_or_companion_stop_blocks_rpc(self):
        for change in ('ship','stop'):
            f=Fixture()
            if change=='ship':f.session.shipid=99
            else:f.active=False
            with self.assertRaisesRegex(RuntimeError,'interrupted'):f.worker.request('authorizeWarp')
            self.assertFalse(f.events)
    def test_initial_docked_assignment_undocks_before_pickup(self):
        f=Fixture('undocking');f.mode='initial-dock';f.session.stationid=700;f.worker.run()
        self.assertEqual(sum(e[0]=='undock' for e in f.events),2)
        self.assertLess(next(i for i,e in enumerate(f.events) if e[0]=='undock'),next(i for i,e in enumerate(f.events) if e[0]=='warp'))
    def test_temporary_fleet_join_phase_only_polls_before_confirmed_membership(self):
        f=Fixture('joining');f.mode='initial-dock';f.session.stationid=700;f.worker.run()
        joined=next(i for i,e in enumerate(f.events) if e[0]=='joined')
        self.assertFalse(any(e[0] in ('undock','route','warp','approach','add','multiadd') for e in f.events[:joined]))
        self.assertLess(joined,next(i for i,e in enumerate(f.events) if e[0]=='undock'))
    def test_verified_docked_completion_exits_without_second_undock_or_false_cancel(self):
        f=Fixture('unloading');f.mode='docked-complete';f.session.structureid=600;f.worker.run()
        self.assertEqual(sum(e[0]=='multiadd' for e in f.events),1)
        self.assertFalse(any(e[0] in ('undock','warp','approach') or e[:2]==('rpc','cancel') for e in f.events),f.events)
        self.assertFalse(any(e[0]=='feedback' for e in f.events),f.events)
    def test_cancel_notification_and_reconnect_never_replay_transfer(self):
        f=Fixture();f.scope['_am_transport'](None,json.dumps(dict(cancel='one')));self.assertTrue(f.worker.cancelled)
        f.saved['evejsAutoMiningTransport']=dict(old=[999],owned=[31],ship=10);f.route=[31]
        f.scope['_am_transport_ready']();self.assertEqual(f.route,[999]);self.assertIn(('ready',),f.events)
        self.assertFalse(any(e[0] in ('add','multiadd','warp') for e in f.events))
    def test_replaced_heartbeat_token_stops_old_loop_without_clearing_new(self):
        f=Fixture();old=(42,object());new=(42,object());f.scope['_am_transport_heartbeat']=new
        f.scope['_am_transport_idle'](42,old)
        self.assertIs(f.scope['_am_transport_heartbeat'],new);self.assertFalse(f.events)
    def test_idle_heartbeat_is_bounded_and_pauses_with_worker(self):
        f=Fixture();f.worker.cancelled=True;f.scope['_am_transport_ready']();f.scope['_am_transport_idle'](42,f.scope['_am_transport_heartbeat'])
        self.assertEqual(sum(e[0]=='ready' for e in f.events),2);self.assertIsNone(f.scope['_am_transport_heartbeat'])
        g=Fixture();g.scope['_am_transport_heartbeat']=(42,object());g.scope['_am_transport_idle'](42,g.scope['_am_transport_heartbeat'])
        self.assertFalse(any(e[0]=='ready' for e in g.events))

if __name__=='__main__':unittest.main()

