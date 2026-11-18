'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { compile, step, won, placed } = require('../dist/box-rooms.js');
const { convert } = require('../dist/box-portals.js');
const context = vm.createContext({});
for (const file of ['box-levels.js', 'box-open-levels.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8'), context);
}
const levels = JSON.parse(vm.runInContext('JSON.stringify(BoxCampaign.open)', context));
// Independent input walkthrough: https://steamcommunity.com/sharedfiles/filedetails/?id=2786724419
const routes = [
  'DDDLU UUULU RDDDR RDDDD D',
  'LULDD RDLLR RURDR DLLLL RRRDD DD',
  'RDRRU LLLDL DDRUU DDRRU URULL LLLDL LLLUD RRULU ULDRR RRRDD DDRRR DD',
  'DLLLD RRDRU UUULL LDRRD RRRDL DLUUU URULL LULDR DLRRR DDDDD DD',
  'UURRR URDDD DDRLL ULDDD RDLDD DDDLD DRLUU RUULL DDUUU UUUUR RRRDR RR',
  'UUUUU UDDDD DRDDD UUUUL LLLRD RURUU LLULD UUR',
  'DRRRR RRRLL LLLRU LLLDR LLRRR RUULL L',
  'RRRRL LLLLR RRRRR RLLLL LLUUU ULDDR RULUU RDLDD DDDDL URRRR RRLLL UU',
  'RDDLL LULUU RDDRD LLUUU DRDLD LULUL UURRR RDLLL DLUUU DLRDR URULL LLLUU RRRRR UULDR DDDLL URRRU ULLDR DDLLU RR',
  'DLLUR URDDD RDLUU LDRDL LLDLU UUUUD DDDDL URRRU RDDUU RDLLL DLUUL UURDD DDLD',
  'LDDRR ULURR UR',
  'UUUDD DDDDD DDRDL LDDDL DDDDD LDRUR DDLDR DDDRD DDDDL DRURD RU',
];
const goalCounts = [0,0,0,0,3,3,3,4,3,2,2,6];
test('Open contains twelve numbered levels', () => assert.equal(levels.length, 12));
for (const [index, level] of levels.entries()) {
  test(`Open ${index + 1}: reference route and all required goals`, () => {
    assert.equal(level.title, '开放 ' + (index + 1));
    const map = compile({ ...level, eat: true, allowCycles: true });
    assert.throws(() => convert(map, map.initial), /暂不支持转成传送门地图/);
    assert.equal(map.goals.length, goalCounts[index]);
    let state = map.initial;
    const blocked = [];
    for (const [i, direction] of [...routes[index].replace(/\s/g, '')].entries()) {
      const next = step(map, state, 'URDL'.indexOf(direction));
      if (next === state) blocked.push(i + 1);
      assert.equal(new Set(next.positions.map(p => p.join(','))).size, next.positions.length, 'Pieces must not overlap after a cyclic push');
      assert.equal(next.positions.length, map.initial.positions.length, 'A shared room must preserve piece identities');
      for (const [roomId, x, y] of next.positions) {
        const room = map.rooms[roomId];
        assert.ok(x >= 0 && x < room.width && y >= 0 && y < room.height);
        assert.notEqual(room.tiles[y * room.width + x], '#', 'Pieces cannot pass through walls');
      }
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

test('Open 12 closes a forward push loop without changing the previous state', () => {
  const map = compile({ ...levels[11], eat: true, allowCycles: true });
  let state = step(map, map.initial, 0);
  state = step(map, state, 0);
  const previous = JSON.stringify(state);
  const bottomClone = state.positions.findIndex((p, id) => id > 0 && p.join() === '1,1,1');
  const next = step(map, state, 0);
  assert.notEqual(next, state);
  assert.deepEqual(next.positions[0], [1,1,1]);
  assert.deepEqual(next.positions[bottomClone], [1,1,2]);
  assert.equal(JSON.stringify(state), previous, 'Undo must retain the original positions');
});
