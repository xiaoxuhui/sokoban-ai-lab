'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../dist/box-rooms.js');
const P = require('../dist/box-portals.js');
const E = require('../dist/engine.js');
const c = vm.createContext({});
for (const f of ['box-levels.js', 'box-flip-levels.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist', f), 'utf8'), c);
const levels = JSON.parse(vm.runInContext('JSON.stringify(BoxCampaign.flip)', c));
// Independent input walkthrough: https://steamcommunity.com/sharedfiles/filedetails/?id=2786724419
const routes = [
  'LLLDD DUURR RRDRR RRLUU LLLLD LULLU UUUUR',
  'RDRLL ULULL ULLDD DLLLL LLRUU URRDD DDUUU RRRDD RRRRD RUD',
];
test('Flip contains seventeen numbered levels', () => assert.equal(levels.length, 17));
for (const [i, level] of levels.slice(0, 2).entries()) {
  test(`Flip ${i + 1}: reference route and portal conversion preserve every move`, () => {
    const map = B.compile({ ...level, eat: true, allowCycles: true });
    assert.equal(map.flipped[map.rooms[0].owner], true);
    assert.equal(map.goals.length, 1);
    const code = P.convert(map, map.initial);
    const read = E.readLevel(JSON.stringify(code));
    const world = E.world(read.tiles, read.chainPush, read.portals, read.finish);
    let source = map.initial, target = world.initial;
    const location = ([room, x, y]) => x + ',' + y;
    const hosts = read.portals.map(portal => source.positions.findIndex(p => location(p) === portal.cell));
    for (const [j, move] of [...routes[i].replace(/\s/g, '')].entries()) {
      const old = source;
      source = B.step(map, source, 'URDL'.indexOf(move));
      target = E.step(world, target, 'URDL'.indexOf(move));
      assert.notEqual(source, old, `Reference step ${j + 1} must move`);
      assert.equal(new Set(source.positions.map(p => p.join())).size, source.positions.length);
      assert.equal(target.player, location(source.positions[0]), `Player at step ${j + 1}`);
      assert.deepEqual(target.boxes.slice().sort(), source.positions.slice(1).map(location).sort(), `Boxes at step ${j + 1}`);
      for (const [id, host] of hosts.entries()) if (host > 0) assert.equal(target.portalCells[id], location(source.positions[host]));
    }
    assert.equal(B.won(map, source), true);
    assert.equal(E.won(world, target), true);
  });
  test(`Flip ${i + 1}: conversion preserves all reachable moves`, () => {
    const map = B.compile({ ...level, eat: true, allowCycles: true });
    const read = E.readLevel(JSON.stringify(P.convert(map, map.initial)));
    const world = E.world(read.tiles, read.chainPush, read.portals, read.finish);
    const location = ([room, x, y]) => x + ',' + y;
    const hosts = read.portals.map(portal => map.initial.positions.findIndex(p => location(p) === portal.cell));
    const queue = [[map.initial, world.initial]];
    const seen = new Set([JSON.stringify(map.initial.positions)]);
    for (let k = 0; k < queue.length; k++) {
      for (let direction = 0; direction < 4; direction++) {
        const source = B.step(map, queue[k][0], direction);
        const target = E.step(world, queue[k][1], direction);
        assert.equal(target.player, location(source.positions[0]));
        assert.deepEqual(target.boxes.slice().sort(), source.positions.slice(1).map(location).sort());
        for (const [id, host] of hosts.entries()) if (host > 0) assert.equal(target.portalCells[id], location(source.positions[host]));
        const key = JSON.stringify(source.positions);
        if (!seen.has(key)) { seen.add(key); queue.push([source, target]); }
      }
    }
    assert.ok(queue.length > 100, 'Explore beyond the supplied winning route');
  });
}

// Original level input files use logical directions after crossing a mirror.
const allRoutes = require('./fixtures/box-flip-routes.json');
const goalCounts = [1,1,2,1,3,2,0,3,1,2,1,2,1,2,1,2,0];
for (const [i, level] of levels.entries()) {
  test(`Flip ${i + 1}: original input route, orientation and immutable history`, () => {
    const map = B.compile({ ...level, eat: true, allowCycles: true });
    assert.equal(level.title, '翻转 ' + (i + 1));
    assert.equal(map.goals.length, goalCounts[i]);
    if (i >= 2) assert.throws(() => P.convert(map, map.initial), /暂不支持转成传送门地图/);
    let state = map.initial;
    const initialOrientation = map.flipped.slice();
    let changedBox = false;
    for (const [j, direction] of [...allRoutes[i].replace(/\s/g, '')].entries()) {
      const before = JSON.stringify(state);
      const next = B.step(map, state, 'URDL'.indexOf(direction));
      assert.notEqual(next, state, `Step ${j + 1} must move`);
      assert.equal(JSON.stringify(state), before, 'History must retain positions and orientation');
      assert.equal(new Set(next.positions.map(p => p.join())).size, next.positions.length, 'Pieces cannot overlap');
      for (const [roomId, x, y] of next.positions) {
        const room = map.rooms[roomId];
        assert.ok(x >= 0 && x < room.width && y >= 0 && y < room.height);
        assert.notEqual(room.tiles[y * room.width + x], '#');
      }
      changedBox ||= next.flipped.some((v, id) => id > 0 && map.inside[id] >= 0 && v !== initialOrientation[id]);
      state = next;
    }
    assert.equal(B.won(map, state), true);
    assert.deepEqual(map.flipped, initialOrientation, 'The compiled map must keep its original orientation');
    if (i >= 2 && i !== 11) assert.equal(changedBox, true, 'The route must exercise a box changing orientation');
    for (const goal of map.goals) {
      const occupant = state.positions.findIndex((p, id) => id > 0 && p.every((v, axis) => v === goal[axis]));
      assert.equal(B.won(map, { ...state, positions: state.positions.filter((p, id) => id !== occupant) }), false);
    }
  });
}

test('A failed mirrored entry rolls back the orientation of every piece', () => {
  const map = B.compile({ rows: ['#######','#@$a###','#######'], rooms: { a: ['###','# #','###'] }, flipped: ['a'], finish: [1,1], eat: true, allowCycles: true });
  const initial = JSON.stringify(map.initial);
  assert.equal(B.step(map, map.initial, 1), map.initial);
  assert.equal(JSON.stringify(map.initial), initial);
});
