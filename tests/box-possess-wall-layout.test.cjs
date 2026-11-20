'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const B=require('../dist/box-rooms.js'),P=require('../dist/box-portals.js');
const context=vm.createContext({});
for(const file of ['box-levels.js','box-possess-levels.js','box-wall-levels.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',file),'utf8'),context);
const chapters=JSON.parse(vm.runInContext('JSON.stringify({possess:BoxCampaign.possess,wall:BoxCampaign.wall})',context));
const goals={possess:[1,1,2,0,2,1,0,0,0,0,0,0,0,0,2,0,0,2,8,4,0,1],wall:[0,0,1,1,1,1,1,0,2,2,2,2,2,2,1]};
test('Possess and Wall contain all 22 and 15 numbered original levels',()=>{
 assert.equal(chapters.possess.length,22);assert.equal(chapters.wall.length,15);
 for(const[key,title]of [['possess','占据'],['wall','墙']])assert.deepEqual(chapters[key].map(l=>l.title),chapters[key].map((_,i)=>title+' '+(i+1)));
});
for(const[chapter,levels]of Object.entries(chapters)){
 // Independent logical walkthroughs distributed with the original level data:
 // https://github.com/hotwords123/parabox/tree/main/levels/vanilla
 const routes=require('./fixtures/box-'+chapter+'-routes.json');
 for(const[index,level]of levels.entries())test(`${level.title}: original route, possession, wall identity and undo history`,()=>{
  const map=B.compile({...level,eat:true,allowCycles:true});let state=map.initial;
  assert.equal(map.goals.length,goals[chapter][index]);assert.equal(map.walls.filter(Boolean).length,level.wallPieces.length);
  assert.equal(map.possessionEnabled,true);assert.throws(()=>P.convert(map,state),/控制权/);
  let possessions=0;
  for(const[step,direction]of [...routes[index]].entries()){
   const snapshot=JSON.stringify(state),next=B.step(map,state,'URDL'.indexOf(direction));
   assert.notEqual(next,state,`Reference input ${step+1} must execute`);assert.equal(JSON.stringify(state),snapshot,'Undo retains control, positions and orientation');
   assert.equal(new Set(next.positions.map(p=>p.join())).size,next.positions.length,'Pieces must not overlap');
   assert.equal(next.moves,state.moves+1,'Possession also counts as one input');
   for(const[r,x,y]of next.positions){assert.ok(x>=0&&x<map.rooms[r].width&&y>=0&&y<map.rooms[r].height);assert.notEqual(map.rooms[r].tiles[y*map.rooms[r].width+x],'#');}
   if(next.possession){possessions++;assert.equal(map.possessable[next.possession.to],true);assert.deepEqual(next.positions,state.positions,'Changing control must not commit a failed push');assert.deepEqual(next.flipped,state.flipped);assert.equal(next.players.includes(next.possession.to),true);assert.equal(next.players.includes(next.possession.from),false);}
   state=next;
  }
  assert.equal(B.won(map,state),true);if(chapter==='wall'||index<18||index===21)assert.ok(possessions>0,'Exercise control transfer');
  assert.equal(B.won(map,{...state,players:[]}),false,'A player goal requires a non-wall controlled piece');
 });
}

test('Possession follows pushing, entry and swallowing, and requires permission on the target',()=>{
 const settings={eat:true,allowCycles:true,possessionEnabled:true};
 const push=B.compile({...settings,rows:['######','#@$  #','######'],possessables:[['root',2,1]],finish:[4,1]});
 const pushed=B.step(push,push.initial,1);assert.equal(pushed.possession,null);assert.deepEqual(pushed.players,[0]);assert.deepEqual(pushed.positions[1],[0,3,1]);
 const enter=B.compile({...settings,rows:['#####','#@a##','#####'],rooms:{a:['###','  #','###']},possessables:[['root',2,1]],finish:[1,1]});
 const entered=B.step(enter,enter.initial,1);assert.equal(entered.possession,null);assert.deepEqual(entered.positions[0],[1,0,1]);
 const eat=B.compile({...settings,rows:['#####','#a$##','#####'],rooms:{a:['###','#  ','###']},players:[['root',1,1]],possessables:[['root',2,1]],finish:[1,1]});
 const swallowed=B.step(eat,eat.initial,1);assert.equal(swallowed.possession,null);assert.deepEqual(swallowed.positions[1],[1,2,1]);
 const blocked=B.compile({...settings,rows:['#####','#@$##','#####'],possessables:[['root',2,1]],finish:[1,1]});
 const owned=B.step(blocked,blocked.initial,1);assert.deepEqual(owned.players,[1]);assert.deepEqual(owned.positions,blocked.initial.positions);
 const forbidden=B.compile({...settings,rows:['#####','#@$##','#####'],finish:[1,1]});assert.equal(B.step(forbidden,forbidden.initial,1),forbidden.initial);
});

test('A controlled wall can walk, cannot be pushed, and never covers either goal type',()=>{
 const level={rows:['######','#@%  #','######'],players:[['root',1,1]],possessables:[['root',2,1]],possessionEnabled:true,finish:[4,1],eat:true,allowCycles:true};
 const map=B.compile(level);let state=B.step(map,map.initial,1);const wall=state.players[0];assert.equal(map.walls[wall],true);state=B.step(map,state,1);state=B.step(map,state,1);assert.deepEqual(state.positions[wall],[0,4,1]);assert.equal(B.won(map,state),false);
 const boxGoal=B.compile({...level,boxGoals:[['root',3,1]]});let onGoal=B.step(boxGoal,boxGoal.initial,1);onGoal=B.step(boxGoal,onGoal,1);assert.equal(B.placed(boxGoal,onGoal),0);
 const two=B.compile({...level,players:[['root',1,1],['root',2,1]],playerMode:'single'});assert.equal(B.step(two,two.initial,1),two.initial,'A wall cannot be pushed even when another player controls it');
 const selected=B.step(two,two.initial,'P2'),walked=B.step(two,selected,1);assert.notEqual(walked,selected);assert.deepEqual(walked.positions[walked.activePlayer],[0,3,1]);
});
