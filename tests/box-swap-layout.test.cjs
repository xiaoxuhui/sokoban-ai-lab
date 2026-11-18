'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { compile, placed, step, won } = require('../dist/box-rooms.js');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/box-levels.js'), 'utf8'), context);
const levels = JSON.parse(vm.runInContext('JSON.stringify(BoxCampaign.swap)', context));
const mapFor = index => compile({ ...levels[index], eat: true, allowCycles: true });

// Source footage: https://www.bilibili.com/video/BV1iY4y147ib/?p=3
// At 12s the blue shell covers the upper corridor goal; at 18.5s all three
// boxes occupy the three goals. Numbering follows the corrected chapter order.
test('Swap 3 and 4 retain their distinct layouts and all three goals', () => {
  const third = mapFor(2);
  assert.equal(levels[2].title, '把循环换回来');
  assert.deepEqual(third.goals, [[0, 2, 3], [0, 2, 5], [1, 2, 6]]);
  assert.deepEqual(third.finish, [0, 2, 4]);
  const fourth = mapFor(3);
  assert.equal(levels[3].title, '带着黄箱调换循环');
  assert.deepEqual(fourth.goals, [[1, 4, 3], [1, 5, 4], [1, 5, 5]]);
  assert.deepEqual(fourth.finish, [1, 3, 5]);
});

test('Swap 4 cannot finish while its upper corridor goal is empty', () => {
  const map = mapFor(3);
  const state = { ...map.initial, positions: [[1, 3, 5], [1, 4, 4], [1, 5, 4], [1, 5, 5]] };
  assert.equal(placed(map, state), 2);
  assert.equal(won(map, state), false);
  state.positions[1] = [1, 4, 3];
  assert.equal(placed(map, state), 3);
  assert.equal(won(map, state), true);
});

const routes = [
  [2, 'UUURU ULDDD RDLDL LUUUR UULDD DDLLD RDRRU DLLUR DRUUU URUUL LLDDL LLLUR RRDRU LURRR DDDUU RRULU LDRDL LRDDD UUUUU LLLDD RRRDR URULL LLLDL URULL LRRRR DRRDL UULUR URDDD DDDDD'],
  [3, 'DRRRU LDLUU LLURR RRRRL LLLUR RDDDR DLLUL DDUUU URRRR RDRUU UUUUR RDDDR DLLUL DDDLD RL'],
];
for (const [index, route] of routes) {
  test(`Swap ${index + 1} reference route fills every goal and reaches the player finish`, () => {
    const map = mapFor(index);
    let state = map.initial;
    for (const move of route.replace(/\s/g, '')) {
      const next = step(map, state, 'URDL'.indexOf(move));
      assert.notEqual(next, state, `Blocked at move ${state.moves + 1}: ${move}`);
      state = next;
    }
    assert.equal(placed(map, state), 3);
    assert.equal(won(map, state), true);
  });
}
