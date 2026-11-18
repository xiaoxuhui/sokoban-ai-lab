'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { compile, placed, step, won } = require('../dist/box-rooms.js');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/box-levels.js'), 'utf8'), context);
const levels = JSON.parse(vm.runInContext('JSON.stringify(BoxCampaign.center)', context));

// Layouts: https://www.bilibili.com/video/BV1m34y1h7he/ (parts 1–14).
// Input routes: https://steamcommunity.com/sharedfiles/filedetails/?id=2786724419
const routes = [
  'RRRRR RUULL LLLUL LDRRR RRDDR',
  'LLLLL ULDRD DRRRU RLLLL UL',
  'DRRUU LURRR RRURD DDDLD DRUUU RULLL LLLLL',
  'LLLLL LLULD DDRRR RRULD DDLDR RRRDR UURRD',
  'UULLL LDDDD DDDLD RRRRU RDLDD RUUUR RD',
  'DDRRR LLLLR RRRUU UUUUR UULDD UUUUR RRDR',
  'LDDDU UUULD RDDDR RRRRR LUUUU DDLDR UUURR RRRDR UULUR DR',
  'RDDLU RULLL LLLUU RUDDL DRRUR DDDLD DRRRR R',
  'LDDRR RRURR RDDLU UUULU UURUR DDRDL LLLL',
  'DDRRU UURRU UULLU LDLLD DRDDL LUURR RRDDR',
  'DDLUL URRRR UULDL DRRRU RDLDR LLLLU ULDLD RRRRR URDDL DRLLL DLDRR UUURD DDRRR',
  'UULDD DDURD LLLUL UUDDD DRRRL LLLLL LLURD RUUUU R',
  'RDDUL LLDRR URDRD LLLUL DLDRU RLDDD ULURR RRURD DDDLD DRRRL LLURR UUUUU UR',
  'LLDUU LLDDR RRDLL LULLD DRULU RDRRR UUULD DRDLU LDDDR DLUUL LLDRR RLLUR RURR',
  'RRRDD LLURU DDDUU ULDRR DRRRU LLLLL LUURU R',
  'RRDDR RULDL URULL LLLLL LUULL DRRDL ULDDU RRRRR RRRRR DRRUR LDLLU LLLLL LLUUR',
];
const goals = [
  [[1,3,3]], [[1,2,3],[1,2,4]], [], [[0,4,4]], [[0,3,3]], [[0,5,0]],
  [[0,4,2],[0,4,4]], [[0,4,6]], [], [[0,4,3],[0,4,5]], [[0,6,5]],
  [[0,1,4]], [[0,4,6]], [[0,4,7],[0,5,7]],
  [[0,2,4]], [[0,2,5]],
];
const finishes = [[1,3,5],[1,2,2],[2,1,1],[0,6,6],[0,5,5],[0,5,1],[0,4,3],
  [0,6,6],[3,4,4],[0,4,7],[0,7,5],[0,2,5],[0,7,1],[0,5,6],[0,5,1],[0,5,1]];

test('Center has exactly sixteen numbered levels', () => assert.equal(levels.length, 16));
for (const [index, level] of levels.entries()) {
  test(`Center ${index + 1}: targets, player finish and reference input route`, () => {
    const map = compile({ ...level, eat: true, allowCycles: true });
    assert.deepEqual(map.goals, goals[index]);
    assert.deepEqual(map.finish, finishes[index]);
    let state = map.initial;
    const blocked = [];
    for (const [i, move] of [...routes[index].replace(/\s/g, '')].entries()) {
      const next = step(map, state, 'URDL'.indexOf(move));
      if (next === state) blocked.push(i + 1);
      state = next;
    }
    assert.deepEqual(blocked, [], 'Every reference input must move exactly once');
    assert.equal(won(map, state), true,
      JSON.stringify({ blocked, covered: placed(map, state), positions: state.positions }));
    for (const goal of map.goals) {
      const occupant = state.positions.findIndex((p, id) => id > 0 && p.every((v, axis) => v === goal[axis]));
      const incomplete = { ...state, positions: state.positions.map(p => p.slice()) };
      // Leave the player at the finish while one required box is absent.
      // This catches a false win from checking only the other targets.
      incomplete.positions.splice(occupant, 1);
      assert.equal(won(map, incomplete), false, 'An empty required goal must prevent a win');
    }
  });
}
