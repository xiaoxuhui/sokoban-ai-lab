'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { compile, step, won, placed } = require('../dist/box-rooms.js');
const { convert } = require('../dist/box-portals.js');
const Classic = require('../dist/engine.js');
const context = vm.createContext({});
for (const name of ['box-levels.js','box-clone-levels.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',name),'utf8'),context);
const levels = JSON.parse(vm.runInContext('JSON.stringify(BoxCampaign.clone)',context));
const routes = [
  'DDDDD RRUUU URRUR DDDDU UULLL DDDDL LUUUL U',
  'UULLL LDDUU URRRR URLRR RUUUU RRRUD UUUUR ULDLU LLU',
  'RDDLU LDDRR DLLLD LLULR DRDDL UUDDD',
  'LUUUR DDLDR DRURR RUUUL LLLLL ULLDL LLLLD LUUUU DRRUU LLDDD LLLLD LLULL LDDDL LLDDD DLLUU',
  'LLURR URDDD LDRRR LLLLL URRDR UUUUD UUUDD LLLLU UUURL',
  'LDDDR ULURR DRUUU URRDL ULUUU URULD LUUUU U',
  'RDLUU LURRD DDDLL DLRR',
  'ULDDR UULUR RRRRL LDDDU DLLLL DDDRR LLLL',
  'LDDRU RDDDL DRRRU RDDLD RRRRR DR',
  'UULLD DDRRD DDDLD RURDL UUUUR ULLLL',
  'RDDDR RUURU LURRU ULDLD RRRRD DRRRD RRUUU UURRR DLDRR LLLLD DDLLU LUURU LLRDL DLUUR UUUL',
  'LLLDD RLDDD RUULU RRRDR UUURU LLDDD LLURD DLDRR RRURD DDUUU UULLL LRRDR UUUUU',
  'UURRR DDDRR LLLLL RDDDL LRRRR RRLLL DDDLL LLLDD R',
  'RRRRD LLLRR RRLDD DRRRR RURRU URRRU RRDRU RUURL DDLLL LDRUU RRRUR RUURR RURRD DR',
  'LUUUR DLDRR RDRUL LURRR RRRUU LDRDL LLLLL URDUL LLDRR DDRRU LDLUL URRRR RRURD DDUUL LLLLL L',
  'LDDDR URRUU UURRD LULDD DLURR DRULL LDDDR ULURR URUUU UURUL LRDDD DDD',
  'RDRUL URLUU RDLUL DLDRR RRURD DLLDD DDRDD LLURR RRDRU UULLU LUURU U',
  'DLLUR RRRDL UUURU RURUU UURDU LLLLD DLLUR RUULL',
  'RUUUL DRDLL UULDD LDRUR DDRDL DLUUD DLURD RUUUU ULDRR DRUUR UL',
  'UURRU LDDLL LDDDD LLURD DRDDL LDDLD RRURD URDLL LLDDD LL',
  'LLLDD DDRUR RDULL DRLUU RURDD RRRUU URULD DDDLL LDURR RUUUR ULDDD DDLUU LULDD RRRUU URULD DDDLL LDURR RUUUR ULLLL ULDDD DRDLR RUUUU RULDD DDLLL DRRRU UUURU LLLLD LUDLU DLURR RULLD L',
  'RDRDL LLLLD LULUR DDLLU LURRR RRURD URDRD LLLLR RDLUR ULLLL LULDD DUURR RRRRR LLLUU RDLDR RLUUU',
  'RRDRU DDDLL URDRU UUUUL URULU RURDD DDDDD RDLLR RUUUU URRDL ULDDD LDRRR RUUUU RULRD DDDDD DDDDR DLLRR URRDLL RUU',
  'RRRUL DLDDD RUUUR ULDDD LLDLU UULDD DRDLL LLDLU UUUUU LLLDD DDDDD DRDLL LLLDL UUUUU LLRDD DRULL LLRRR RRRLU UUUU',
  'LLLUU URRDD DDDRR RDDDL DRRDD DRRDL LRUUU UURUL LLULD RRRRR UUUUU UUURR LLUUU UUU',
];
test('Clone includes twenty-five reference levels',()=>assert.equal(levels.length,25));
const goalCounts=[1,1,1,1,1,0,1,2,2,0,2,0,3,4,1,2,1,3,3,2,5,3,3,2,1];
for(const [index,route] of routes.entries()) test(`Clone ${index+1} reference route`,()=>{
  const map=compile({...levels[index],eat:true,allowCycles:true});let state=map.initial;const blocked=[];
  assert.equal(map.goals.length,goalCounts[index],'Every authored target is present');
  for(const [i,move] of [...route.replace(/\s/g,'')].entries()){const next=step(map,state,'URDL'.indexOf(move));if(next===state)blocked.push(i+1);state=next;}
  assert.equal(won(map,state),true,JSON.stringify({blocked,covered:placed(map,state),goals:map.goals,finish:map.finish,positions:state.positions}));
});
for(const [index,route] of routes.entries()) test(`Clone ${index+1} conversion preserves every move and portal owner`,()=>{
  const map=compile({...levels[index],eat:true,allowCycles:true});
  const data=Classic.readLevel(JSON.stringify(convert(map,map.initial)));
  const world=Classic.world(data.tiles,data.chainPush,data.portals,data.finish);
  const offsets=[];let left=0;for(const room of map.rooms){offsets.push(left);left+=room.width+4;}
  const location=([room,x,y])=>(offsets[room]+x)+','+y;
  const hosts=data.portals.map(p=>map.initial.positions.findIndex(pos=>location(pos)===p.cell));
  let source=map.initial,target=world.initial;
  for(const [i,move] of [...route.replace(/\s/g,'')].entries()){
    const d='URDL'.indexOf(move);source=step(map,source,d);target=Classic.step(world,target,d);
    assert.equal(target.player,location(source.positions[0]),`Player at input ${i+1}`);
    assert.deepEqual(target.boxes.slice().sort(),source.positions.slice(1).map(location).sort(),`Boxes at input ${i+1}`);
    for(const [endpoint,entity]of hosts.entries())if(entity>0)assert.equal(target.portalCells[endpoint],location(source.positions[entity]),`Portal host at input ${i+1}`);
  }
  assert.equal(Classic.won(world,target),true);
});

test('Entering a moved clone shares the room and exits beside the original',()=>{
  const map=compile({rows:['#########','#  @z   #','#       #','#     a #','#########'],rooms:{a:['###','   ','###']},clones:{z:'a'},finish:[7,3],allowCycles:true,eat:true});
  const clone=map.clones.findIndex(Boolean),owner=map.rooms[1].owner;
  assert.notEqual(clone,owner);assert.equal(map.inside[clone],map.inside[owner]);
  let state=map.initial;for(let i=0;i<4;i++)state=step(map,state,1);
  assert.deepEqual(state.positions[clone],[0,7,1]);
  assert.deepEqual(state.positions[owner],[0,6,3]);
  assert.deepEqual(state.positions[0],[1,0,1]);
  for(let i=0;i<3;i++)state=step(map,state,1);
  assert.deepEqual(state.positions[0],[0,7,3]);
  assert.equal(won(map,state),true);
});

test('Clone faces become one-way entrances, including many clones sharing an exit',()=>{
  const map=compile({...levels[17],eat:true,allowCycles:true});
  const converted=convert(map,map.initial),data=Classic.readLevel(JSON.stringify(converted));
  assert.equal(map.clones.filter(Boolean).length,4);
  assert.ok(converted.portals.filter(p=>p[2]==='one-way').length>=4);
  const entries=data.portals.filter(p=>!p.exitOnly).map(p=>p.cell+':'+p.side);
  assert.equal(entries.length,new Set(entries).size,'One destination per entering face');
});
