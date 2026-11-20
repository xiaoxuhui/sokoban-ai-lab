'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../dist/box-rooms.js');
const P = require('../dist/box-portals.js');
const E = require('../dist/engine.js');
const routes = require('./fixtures/box-campaign-routes.json');

// Load the same chapter list, level order and layouts that the page actually uses.
const dist = path.join(__dirname, '../dist');
const context = vm.createContext({ BoxRooms: B });
const html = fs.readFileSync(path.join(dist, 'box-intro.html'), 'utf8');
for (const match of html.matchAll(/<script src="([^"?]+)(?:\?[^\"]*)?"/g)) {
  if (match[1] === 'box-levels.js' || /^box-.*-levels\.js$/.test(match[1])) {
    vm.runInContext(fs.readFileSync(path.join(dist, match[1]), 'utf8'), context);
  }
}

for (const [index, entry] of require('./fixtures/classic-example-routes.json').entries()) {
  test(`${entry.name}: default example, complete route and demonstration`, () => {
    const expectedRows = index < 3 ? E.examples[[1, 0, 2][index]] : ['#########', '#@$$..  #', '#########'];
    assert.deepEqual(entry.rows, expectedRows);
    const tiles = E.fromRows(expectedRows);
    const map = E.world(tiles, entry.chainPush);
    const field = E.trainingMap(tiles, E.bounds(tiles), entry.chainPush);
    let state = map.initial;
    for (const input of entry.route) {
      const next = E.step(map, state, 'URDL'.indexOf(input));
      assert.notEqual(next, state);
      state = next;
    }
    assert.equal(E.won(map, state), true);
    const trainer = new E.Trainer(field, () => 0);
    assert.equal(trainer.setDemonstration([...entry.route].map(input => 'URDL'.indexOf(input))), true);
    trainer.episode();
    assert.equal(trainer.successes, 1);
  });
}
const setup = fs.readFileSync(path.join(dist, 'box-intro.js'), 'utf8').split('const $ = id =>')[0];
vm.runInContext(setup + ';globalThis.catalog = chapters;', context);
const chapters = JSON.parse(JSON.stringify(context.catalog));

test('Every selectable campaign level has an independently replayable complete route', () => {
  assert.deepEqual(chapters.map(ch => ch.id), Object.keys(routes));
  for (const chapter of chapters) assert.equal(chapter.levels.length, routes[chapter.id].length, chapter.id);
  assert.equal(chapters.reduce((sum, ch) => sum + ch.levels.length, 0), 249);
});

for (const chapter of chapters) for (const [index, level] of chapter.levels.entries()) {
  const map = B.compile({
    ...level,
    eat: !['intro', 'enter', 'empty'].includes(chapter.id),
    allowCycles: !['intro', 'enter', 'empty', 'eat'].includes(chapter.id),
    transfer: chapter.id === 'transfer',
  });
  const route = routes[chapter.id][index].route;
  const title = `${chapter.title} ${index + 1}`;
  test(`${title}: full route, legal positions and immutable undo states`, () => {
    let state = map.initial;
    assert.equal(B.won(map, state), false, 'A level must not start already completed');
    for (const [i, input] of [...route].entries()) {
      const snapshot = JSON.stringify(state);
      const next = B.step(map, state, 'URDL'.indexOf(input));
      assert.notEqual(next, state, `Input ${i + 1} must execute`);
      assert.equal(next.moves, state.moves + 1);
      assert.equal(JSON.stringify(state), snapshot, 'Movement must preserve the undo snapshot');
      assert.equal(new Set(next.positions.map(p => p.join())).size, next.positions.length, 'No overlapping pieces');
      for (const [roomId, x, y] of next.positions) {
        const room = map.rooms[roomId];
        assert.ok(x >= 0 && x < room.width && y >= 0 && y < room.height, `Input ${i + 1} stays in bounds`);
        assert.notEqual(room.tiles[y * room.width + x], '#', 'No piece enters a static wall');
      }
      state = next;
    }
    assert.equal(B.placed(map, state), map.goals.length);
    assert.equal(B.won(map, state), true);
  });
  if (map.transfer || !map.portalConversion) continue;
  test(`${title}: portal conversion, training and complete demonstration`, () => {
    const read = E.readLevel(JSON.stringify(P.convert(map, map.initial)));
    const saved = E.readLevel(E.writeWorld(read.tiles, read.chainPush, read.portals, read.finish, read));
    assert.deepEqual(saved.portals, read.portals);
    const world = E.world(read.tiles, read.chainPush, read.portals, read.finish, read);
    const field = E.trainingMap(read.tiles, E.bounds(read.tiles, read.finish), read.chainPush, read.portals, read.finish, read);
    let left = 0;
    const offsets = map.rooms.map(room => { const value = left; left += room.width + 4; return value; });
    const location = ([r, x, y]) => (offsets[r] + x) + ',' + y;
    let source = map.initial, target = world.initial, training = field.initial;
    for (const [i, input] of [...route].entries()) {
      const direction = 'URDL'.indexOf(input);
      source = B.step(map, source, direction);
      target = E.step(world, target, direction);
      training = E.step(field, training, direction);
      const players = map.players.map(id => location(source.positions[id]));
      const boxes = source.positions.filter((_, id) => !map.players.includes(id)).map(location).sort();
      assert.deepEqual(target.players ?? [target.player], players, `Players after input ${i + 1}`);
      assert.deepEqual(target.boxes.slice().sort(), boxes, `Boxes after input ${i + 1}`);
      assert.deepEqual((training.players ?? [training.player]).map(field.worldCell), players);
      assert.deepEqual(training.boxes.map(field.worldCell).sort(), boxes);
    }
    assert.equal(E.won(world, target), true);
    assert.equal(E.won(field, training), true);
    const trainer = new E.Trainer(field, () => 0);
    assert.equal(trainer.setDemonstration([...route].map(input => 'URDL'.indexOf(input))), true);
    trainer.episode();
    assert.equal(trainer.successes, 1);
  });
}
