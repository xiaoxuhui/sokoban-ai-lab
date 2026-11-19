'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../dist/box-rooms.js');
const P = require('../dist/box-portals.js');
const E = require('../dist/engine.js');
const context = vm.createContext({});
for (const file of ['box-levels.js', 'box-cycle-levels.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8'), context);
const levels = JSON.parse(vm.runInContext('JSON.stringify(BoxCampaign.cycle)', context));
// Original logical inputs, independently supplied with the vanilla level files:
// https://github.com/hotwords123/parabox/tree/main/levels/vanilla
const routes = require('./fixtures/box-cycle-routes.json');

function setup(level) {
  const map = B.compile({ ...level, eat: true, allowCycles: true });
  const read = E.readLevel(JSON.stringify(P.convert(map, map.initial)));
  const world = E.world(read.tiles, read.chainPush, read.portals, read.finish);
  let left = 0;
  const offsets = map.rooms.map(room => { const offset = left; left += room.width + 4; return offset; });
  const location = ([room, x, y]) => (offsets[room] + x) + ',' + y;
  const hosts = read.portals.map(portal => map.initial.positions.findIndex(position => location(position) === portal.cell));
  return { map, read, world, location, hosts };
}

test('Cycle contains all eighteen numbered original levels', () => {
  assert.equal(levels.length, 18);
  assert.deepEqual(levels.map(level => level.title), Array.from({ length: 18 }, (_, i) => '循环 ' + (i + 1)));
  assert.equal(levels[8].sourceFile, 'eat_cycle', 'Cycle 9 is the map with a root clone and the box above it');
  assert.equal(levels[9].sourceFile, 'cycle_setup', 'Cycle 10 is the map with four goals in the right-hand shaft');
});

for (const [index, level] of levels.entries()) {
  if (index === 12) continue;
  test(`Cycle ${index + 1}: source and portal conversion agree on every original input`, () => {
    const { map, read, world, location, hosts } = setup(level);
    let source = map.initial, target = world.initial;
    for (const [i, direction] of [...routes[index].replace(/\s/g, '')].entries()) {
      const previous = JSON.stringify(source), previousTarget = JSON.stringify(target);
      const next = B.step(map, source, 'URDL'.indexOf(direction));
      const converted = E.step(world, target, 'URDL'.indexOf(direction));
      assert.notEqual(next, source, `Step ${i + 1} must execute`);
      assert.equal(JSON.stringify(source), previous, 'Undo retains the original nested state');
      assert.equal(JSON.stringify(target), previousTarget, 'Undo retains the original portal state');
      assert.equal(new Set(next.positions.map(p => p.join())).size, next.positions.length, 'Closed pushes must not overlap pieces');
      assert.equal(converted.player, location(next.positions[0]), `Player at step ${i + 1}`);
      assert.deepEqual(converted.boxes.slice().sort(), next.positions.slice(1).map(location).sort(), `Boxes at step ${i + 1}`);
      for (const [endpoint, host] of hosts.entries()) if (host > 0) {
        assert.equal(converted.portalCells[endpoint], location(next.positions[host]), 'A portal must stay with its own box');
        if (read.portals[endpoint].geometry?.kind === 'face') assert.equal(converted.portalFlipped?.[endpoint] ?? read.portals[endpoint].geometry.flipped, next.flipped[host], 'Mirror orientation follows the moving box');
      }
      for (const [roomId, x, y] of next.positions) {
        const room = map.rooms[roomId];
        assert.ok(x >= 0 && x < room.width && y >= 0 && y < room.height);
        assert.notEqual(room.tiles[y * room.width + x], '#');
      }
      source = next; target = converted;
    }
    assert.equal(B.won(map, source), true);
    assert.equal(E.won(world, target), true);
  });
}

test('Cycle 13 retains its mirrored gameplay and does not offer portal conversion', () => {
  const map = B.compile({ ...levels[12], eat: true, allowCycles: true });
  assert.equal(map.portalConversion, false);
  assert.throws(() => P.convert(map, map.initial), /翻转规则/);
  let state = map.initial;
  let changedOrientation = false;
  for (const direction of routes[12].replace(/\s/g, '')) {
    const previous = JSON.stringify(state);
    const next = B.step(map, state, 'URDL'.indexOf(direction));
    assert.notEqual(next, state);
    assert.equal(JSON.stringify(state), previous);
    assert.equal(new Set(next.positions.map(p => p.join())).size, next.positions.length);
    changedOrientation ||= next.flipped.some((value, id) => value !== state.flipped[id]);
    state = next;
  }
  assert.equal(changedOrientation, true);
  assert.equal(B.won(map, state), true);
  assert.throws(() => P.convert(map, state), /翻转规则/);
});

test('Closing a chain in the middle rotates its boxes and leaves the outside player still', () => {
  const { map, world, location } = setup(levels[2]);
  let source = map.initial, target = world.initial;
  const inputs = routes[2].replace(/\s/g, '');
  for (const d of inputs.slice(0, 9)) { source = B.step(map, source, 'URDL'.indexOf(d)); target = E.step(world, target, 'URDL'.indexOf(d)); }
  const next = B.step(map, source, 0), converted = E.step(world, target, 0);
  assert.deepEqual(next.positions[0], source.positions[0]);
  assert.equal(converted.player, target.player);
  const changed = next.positions.filter((p, id) => id > 0 && p.join() !== source.positions[id].join());
  assert.ok(changed.length >= 4, 'The closed chain advances together');
  assert.deepEqual(converted.boxes.slice().sort(), next.positions.slice(1).map(location).sort());
});

test('A plain portal loop rotates all boxes and the player atomically; a blocked exit rolls back', () => {
  const code = { version: 1, chainPush: true, tiles: [[0,0,'@'],[1,0,'$'],[2,0,'$'],[3,0,'$'],[4,0,'#'],[-1,0,'#']], portals: [[[4,0,3],[-1,0,1]]], finish: [0,0] };
  const read = E.readLevel(JSON.stringify(code));
  const world = E.world(read.tiles, true, read.portals, read.finish);
  const before = JSON.stringify(world.initial), next = E.step(world, world.initial, 1);
  assert.equal(next.player, '1,0');
  assert.deepEqual(next.boxes.slice().sort(), ['0,0','2,0','3,0']);
  assert.equal(next.moves, 1);
  assert.equal(JSON.stringify(world.initial), before);
  code.tiles.push([0,1,'#']); code.portals[0][1] = [0,1,0];
  const blocked = E.readLevel(JSON.stringify(code));
  const blockedWorld = E.world(blocked.tiles, true, blocked.portals, blocked.finish);
  // Returning against the original direction cannot close the forward push.
  assert.equal(E.step(blockedWorld, blockedWorld.initial, 1), blockedWorld.initial);
});

test('Conversion keeps room sizes through export, import and AI training coordinates', () => {
  for (const index of [15,16,17]) {
    const { map, read, world, location } = setup(levels[index]);
    const roundTrip = E.readLevel(E.writeWorld(read.tiles, read.chainPush, read.portals, read.finish));
    assert.deepEqual(roundTrip.portals, read.portals);
    const field = E.trainingMap(read.tiles, E.bounds(read.tiles, read.finish), read.chainPush, roundTrip.portals, read.finish);
    let source = map.initial, target = world.initial, training = field.initial;
    for (const d of routes[index].replace(/\s/g, '')) {
      const direction = 'URDL'.indexOf(d);
      source = B.step(map, source, direction); target = E.step(world, target, direction); training = E.step(field, training, direction);
      assert.equal(field.worldCell(training.player), location(source.positions[0]));
      assert.deepEqual(training.boxes.map(field.worldCell).sort(), target.boxes.slice().sort());
      assert.deepEqual(training.portalFlipped, target.portalFlipped);
    }
    assert.equal(E.won(field, training), true);
  }
});
