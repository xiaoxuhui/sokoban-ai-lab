'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { compile, placed, step, won } = require('../dist/box-rooms.js');
const { convert } = require('../dist/box-portals.js');
const context = vm.createContext({});
for (const file of ['box-levels.js', 'box-transfer-levels.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8'), context);
}
const levels = JSON.parse(vm.runInContext('JSON.stringify(BoxCampaign.transfer)', context));
// Independent input walkthrough: https://steamcommunity.com/sharedfiles/filedetails/?id=2786724419
const routes = [
  'DRRRR RRRUL LLLLU LLDRU RDDDD DDRRR RRR',
  'LUUUR DLDRR RLUUR DLDRU RDDLD RURRD LLDLL',
  'RDDDD DUULL LURRU RDDDD RDLUL DRDDL UUULL DD',
  'LLURD RUURR DLDLU ULLUU RDDLD RURRR UULDD DRDLU ULULU URDDL DD',
  'RURDD DLLUU ULLDR URDDD DLDRR RDRUU ULLLL UURRR',
  'DDDLU URULR UUULD DRDLL LDLLL RRUUR',
  'RRDLU LDDLL URRUR DDLLD RRURR RRLLD RRUUR ULLUL DDRDL LDLLL LRDL',
  'RDRUL LLUUU RDLDR UURRD LULDL DRRRD RRRRR RRU',
  'LLULD DRRRR DLLLU ULLLL DDDDR DURUU LDDDR RDDDD LLLLU LRUUU URRR',
  'LDLDR RUURD LUURU RDDDU UULLL LDRRR RURDD DLLDD RRRLL DRRUU RULLL LLULD DDRUR RDLUL DDDLL LRUUU UUURR',
  'DLLDR DRUUR RDLLL LLDDL RURDD LDRUU ULLDD DDDDL DD',
  'LDDRR RRDRU ULUUU LLLLL ULL',
  'RUUUL DDRDL RRRUU LLULD DRDLD LUULU RRRLL LLUUU LLRDD DRR',
  'LUUUR DDLDR DRRRU ULDRD LUUUU UUULL LLLDL LURRD DRURR ULDLL LUURD LDRDR UUDLU RDRRU ULDRD LDDUU UUULU RDRUU UUURU LRRRU UUUU',
  'URRRD LLULD DRDDL RUULD RRRUL L',
  'RRRRU ULLLL LDDDD DLDDL DRRRU RDDLD RRLUL LLLLD RURRR',
  'RRRRD DDLLU LUUUU UURUL LLDLU UUURU LLRDR RRURR RUUDL LDDL',
  'UUURR DRDLU ULLDR DDURR DDLUU ULLUU URRDD DLLLL UUU',
  'URRRD DDDLU RULLD LUURU LURRD RDDLD LUUUR ULLDD DLDDL UUURR RURRD LULDD DRDRU UURUL LLDDD LLDDD RRUUU LLLLD DDDDD DLLLL LLLLL L',
  'RRUUL DRDLU ULDRR DDDLU URULU LLLDD DDRUU ULURL URRDD DDDDR RUUUR RDDDR RUUU',
  'UULLU UURUU LDDDL DRRRR DRULU RRRRR DDRRU ULLDD LDLLL UUUUU UUURR RDDDR LDLUU DDD',
  'URULU LDRDL UULDD DDDDR DLULD RRRLU LDDDL UULL',
  'RDDDL ULLDU LLDRU RDURR DLULD DUURR RRRDD DDDDD LLLLL UURRR RDRUU UUURR UUURR RRULL LDLLU RRRRD LLLLL LUURD RRRDL LLUUR DDDDD LLDRR RURDD LDRRR DRRUU DDDLD RLUUU LLLUU LLLLL UUU',
  'RURRU LLULL DDRRU LULDD DLDRU RRRRU RDDLL LUULL DRRRR URDDD LDRLL LLDLL UURUR R',
  'DRRDR DLLUU RRULL ULDDD DRDLL LLLLL LRRRR RRRRD LLLLL LDLUR ULLLL',
  'RRDRU UUULU RDRRD LDLUU LLLLD RDRUU LURRD RDLDL UURRR RDDDL LLLDL UUUUR RURUR RDLLU LLLDD',
  'LLLDL URRRD DDRRR RRUUU URRRD DDRRR ULLDD DLLLU UURUR DDDLD RRRRR R',
  'UULUL LLDDR DDRDD LUURU LULLL DDRDR RRDRR ULLDL ULULU URRRD RRRDD DDLUU LLDRR UDUUL',
  'URUUR DDDDR DLLLU UUUUL DDDDD DRDDD LLLRR UUURR LRUUL DRDLR R',
];
test('Transfer has 29 numbered levels', () => assert.equal(levels.length, 29));
for (const [index, level] of levels.entries()) {
  test(`Transfer ${index + 1}: reference route, required goals and no portal conversion`, () => {
    assert.equal(level.title, '转移 ' + (index + 1));
    assert.equal(level.transfer, true);
    const map = compile({ ...level, eat: true, allowCycles: true });
    assert.throws(() => convert(map, map.initial), /不能转成传送门地图/);
    let state = map.initial;
    const blocked = [];
    for (const [i, direction] of [...routes[index].replace(/\s/g, '')].entries()) {
      const next = step(map, state, 'URDL'.indexOf(direction));
      if (next === state) blocked.push(i + 1);
      state = next;
    }
    assert.deepEqual(blocked, [], 'Every reference input must move exactly once');
    assert.equal(won(map, state), true, JSON.stringify({ covered: placed(map, state), positions: state.positions }));
    for (const goal of map.goals) {
      const occupant = state.positions.findIndex((p, id) => id > 0 && p.every((v, axis) => v === goal[axis]));
      const incomplete = { ...state, positions: state.positions.filter((p, id) => id !== occupant) };
      assert.equal(won(map, incomplete), false, 'Every required goal must remain occupied');
    }
  });
}
