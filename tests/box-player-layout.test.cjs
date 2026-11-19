'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const B=require('../dist/box-rooms.js'),P=require('../dist/box-portals.js'),E=require('../dist/engine.js');
const context=vm.createContext({});for(const file of ['box-levels.js','box-player-levels.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',file),'utf8'),context);
const levels=JSON.parse(vm.runInContext('JSON.stringify(BoxCampaign.player)',context));
// Independent logical inputs from the original vanilla level data.
// https://github.com/hotwords123/parabox/tree/main/levels/vanilla
const routes=require('./fixtures/box-player-routes.json');
const goalCounts=[0,1,0,1,0,0,1,1,1,1,2,1,0,0,0,1,3,1,0,2,0,1,0,1];
test('Player contains 24 numbered layouts and all player goals',()=>{
 assert.equal(levels.length,24);
 for(const[i,l]of levels.entries()){const m=B.compile(l);assert.equal(l.title,'玩家 '+(i+1));assert.equal(m.players.length,i<20?1:i===22?3:2);assert.equal(m.finishes.length,m.players.length);assert.equal(m.goals.length,goalCounts[i]);}
});
for(const[index,level]of levels.entries()){
 test(`Player ${index+1}: original route preserves every player and immutable history`,()=>{
  const map=B.compile({...level,eat:true,allowCycles:true});let state=map.initial;
  for(const[step,d]of [...routes[index]].entries()){
   const before=JSON.stringify(state),next=B.step(map,state,'URDL'.indexOf(d));
   assert.notEqual(next,state,`Step ${step+1} must move`);assert.equal(JSON.stringify(state),before);
   assert.equal(new Set(next.positions.map(p=>p.join())).size,next.positions.length);
   for(const[r,x,y]of next.positions){assert.ok(x>=0&&x<map.rooms[r].width&&y>=0&&y<map.rooms[r].height);assert.notEqual(map.rooms[r].tiles[y*map.rooms[r].width+x],'#');}
   state=next;
  }
  assert.equal(B.won(map,state),true);
  for(const goal of map.finishes){const player=map.players.find(id=>state.positions[id].join()===goal.join());const positions=state.positions.slice();positions[player]=[-1,-1,-1];assert.equal(B.won(map,{...state,positions}),false,'Every player goal is required');}
 });
 if(level.portalConversion===false){test(`Player ${index+1}: mirrored conversion is explicitly unavailable`,()=>{const map=B.compile({...level,eat:true,allowCycles:true});assert.throws(()=>P.convert(map,map.initial),/翻转/);});continue;}
 test(`Player ${index+1}: portal conversion, save and AI coordinates agree at every step`,()=>{
  const map=B.compile({...level,eat:true,allowCycles:true});const read=E.readLevel(JSON.stringify(P.convert(map,map.initial)));
  const saved=E.readLevel(E.writeWorld(read.tiles,read.chainPush,read.portals,read.finish,read));assert.deepEqual(saved.players,read.players);assert.deepEqual(saved.finishes,read.finishes);assert.deepEqual(saved.portals,read.portals);
  const world=E.world(read.tiles,read.chainPush,read.portals,read.finish,read),field=E.trainingMap(read.tiles,E.bounds(read.tiles,read.finish),read.chainPush,read.portals,read.finish,read);
  let left=0;const offsets=map.rooms.map(r=>{const value=left;left+=r.width+4;return value;}),loc=([r,x,y])=>(offsets[r]+x)+','+y;
  const hosts=read.portals.map(end=>map.initial.positions.findIndex(p=>loc(p)===end.cell));
  let source=map.initial,target=world.initial,training=field.initial;
  for(const[step,d]of [...routes[index]].entries()){
   const previousTarget=target,previous=JSON.stringify(target),direction='URDL'.indexOf(d);source=B.step(map,source,direction);target=E.step(world,target,direction);training=E.step(field,training,direction);
   assert.equal(JSON.stringify(previousTarget),previous,'Undo retains all players and portal positions');
   const players=map.players.map(id=>loc(source.positions[id])),boxes=source.positions.filter((_,id)=>!map.players.includes(id)).map(loc).sort();
   assert.deepEqual(target.players,players,`Players at step ${step+1}`);assert.deepEqual(target.boxes.slice().sort(),boxes);
   assert.deepEqual(training.players.map(field.worldCell),players);assert.deepEqual(training.boxes.map(field.worldCell).sort(),boxes);
   for(const[endpoint,host]of hosts.entries())if(host>=0)assert.equal(target.portalCells[endpoint],loc(source.positions[host]),'Portals remain attached to their player or box');
  }
  assert.equal(E.won(world,target),true);assert.equal(E.won(field,training),true);
  const trainer=new E.Trainer(field,()=>0);assert.equal(trainer.setDemonstration([...routes[index]].map(d=>'URDL'.indexOf(d))),true);trainer.episode();assert.equal(trainer.successes,1);
 });
}

test('Switch control moves the selected player; sync control preserves original order',()=>{
 const map=B.compile({...levels[20],eat:true,allowCycles:true});const start={...map.initial,playerMode:'single',activePlayer:map.players[1]};
 const next=B.step(map,start,0);assert.deepEqual(next.positions[0],start.positions[0]);assert.notDeepEqual(next.positions[map.players[1]],start.positions[map.players[1]]);assert.equal(next.moves,1);
 const read=E.readLevel(JSON.stringify(P.convert(map,start))),world=E.world(read.tiles,true,read.portals,read.finish,{...read,playerMode:'select'});
 const initial={...world.initial,activePlayer:1,player:world.initial.players[1]},converted=E.step(world,initial,0);
 assert.equal(converted.players[0],initial.players[0]);assert.notEqual(converted.players[1],initial.players[1]);assert.equal(converted.moves,1);
});

test('A player carries its portal while walking, and other players can use that face',()=>{
 const read=E.readLevel(JSON.stringify({version:1,playerMode:'select',chainPush:true,tiles:[[0,0,'@'],[2,0,'@'],[6,0,'#']],portals:[[[0,0,3],[6,0,1]]],finishes:[[3,0],[7,0]],finish:[3,0]}));
 const world=E.world(read.tiles,true,read.portals,read.finish,read);const before=JSON.stringify(world.initial),next=E.step(world,world.initial,1);
 assert.equal(next.players[0],'1,0');assert.equal(next.portalCells[0],'1,0');assert.equal(JSON.stringify(world.initial),before);assert.equal(E.won(world,next),false);
 const blocked=E.readLevel(JSON.stringify({version:1,playerMode:'select',chainPush:true,players:[[0,0],[-1,0]],tiles:[[0,0,'@'],[-1,0,'@'],[1,0,'#'],[6,0,'#']],portals:[[[0,0,3],[6,0,1]]],finish:[7,0]}));
 const withDoor=E.world(blocked.tiles,true,blocked.portals,blocked.finish,blocked),other={...withDoor.initial,activePlayer:1,player:withDoor.initial.players[1]},entered=E.step(withDoor,other,1);
 assert.deepEqual(entered.players,['0,0','7,0']);assert.equal(entered.portalCells[0],'0,0');
});

test('Player selection commands survive route parsing, demonstration and replay',()=>{
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/route-input.js'),'utf8'),context);
 const inputs=Array.from(vm.runInContext("RouteInput.parse('D P2 W P1 D')",context));assert.deepEqual(inputs,[1,'P2',0,'P1',1]);
 const read=E.readLevel(JSON.stringify({version:1,playerMode:'select',players:[[0,0],[0,2]],tiles:[[0,0,'@'],[0,2,'@']],finishes:[[2,0],[0,1]]}));
 const world=E.world(read.tiles,true,read.portals,read.finish,read);let state=world.initial;
 for(const input of inputs)state=E.step(world,state,input);
 assert.equal(E.won(world,state),true);assert.equal(state.moves,3);
 const trainer=new E.Trainer(E.trainingMap(read.tiles,E.bounds(read.tiles,read.finish),true,read.portals,read.finish,read),()=>0);
 assert.equal(trainer.setDemonstration(inputs),true);trainer.episode();assert.equal(trainer.successes,1);
});
