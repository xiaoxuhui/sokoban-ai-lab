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
test('Flip contains the requested first two levels', () => assert.equal(levels.length, 2));
for (const [i, level] of levels.entries()) {
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
