(function (root) {
  'use strict';

  const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  function compile(level) {
    const definitions = { root: level.rows, ...level.rooms };
    const names = Object.keys(definitions);
    const roomIds = new Map(names.map((name, index) => [name, index]));
    const rooms = names.map(name => {
      const rows = definitions[name];
      if (!rows[0]?.length || rows.some(row => row.length !== rows[0].length)) throw Error('箱内地图的每行必须等宽。');
      return { name, width: rows[0].length, height: rows.length, tiles: rows.join(''), owner: -1, color: level.colors?.[name] };
    });
    const inside = [-1];
    const positions = [null];
    const goals = [];
    let finish = level.finish ? [0, ...level.finish] : null;
    for (const [roomId, room] of rooms.entries()) {
      for (let cell = 0; cell < room.tiles.length; cell++) {
        const symbol = room.tiles[cell];
        const name = symbol.toLowerCase();
        const child = roomIds.get(name === 'r' ? 'root' : name) ?? -1;
        const x = cell % room.width;
        const y = Math.floor(cell / room.width);
        const position = [roomId, x, y];
        if (symbol === '.' || symbol === '*') goals.push(position);
        if (symbol === 'p' || symbol === 'P') finish = position;
        if (symbol === '@' || symbol === 'P') {
          if (positions[0]) throw Error('关卡只能有一个玩家。');
          positions[0] = position;
        } else if (symbol === '$' || symbol === '*' || child >= 0) {
          if (child >= 0 && symbol !== name) goals.push(position);
          if (child >= 0) {
            if (rooms[child].owner !== -1) throw Error('每间箱内房间只能有一个外壳。');
            rooms[child].owner = positions.length;
          }
          inside.push(child);
          positions.push(position);
        } else if (symbol !== ' ' && symbol !== '#' && symbol !== '.' && symbol !== 'p') {
          throw Error('未知的关卡方块 ' + symbol);
        }
      }
    }
    if (!positions[0] || !finish || rooms.slice(1).some(room => room.owner < 0)) throw Error('请检查房间和玩家终点。');
    return {
      rooms, inside, goals, finish, eat: Boolean(level.eat), allowCycles: Boolean(level.allowCycles),
      initial: { positions, moves: 0, pushes: 0 },
    };
  }

  const matches = (position, room, x, y) => position[0] === room && position[1] === x && position[2] === y;

  function placed(map, state) {
    return map.goals.filter(([room, x, y]) => state.positions.some((position, id) => id > 0 && matches(position, room, x, y))).length;
  }

  function won(map, state, covered = placed(map, state)) {
    return matches(state.positions[0], ...map.finish) && covered === map.goals.length;
  }

  function step(map, state, direction) {
    if (!directions[direction]) return state;
    const positions = state.positions.slice();
    const moving = new Set();
    const crossings = [];

    function insideOwnBox(entity, roomId) {
      const ownRoom = map.inside[entity];
      if (ownRoom < 0 || positions[entity][0] === roomId) return false;
      const visited = new Set();
      for (let current = roomId; !visited.has(current);) {
        if (current === ownRoom) return true;
        const owner = map.rooms[current].owner;
        if (owner < 0) break;
        visited.add(current);
        current = positions[owner][0];
      }
      return false;
    }

    function moveEntity(entity, offset, heading) {
      if (moving.has(entity)) return false;
      moving.add(entity);
      const success = advance(entity, positions[entity], offset, heading);
      moving.delete(entity);
      return success;
    }

    function advance(entity, [roomId, x, y], offset, heading) {
      const [dx, dy] = directions[heading];
      const horizontal = dx !== 0;
      const exited = new Set();
      while (true) {
        const room = map.rooms[roomId];
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX >= 0 && nextY >= 0 && nextX < room.width && nextY < room.height) {
          return land(entity, roomId, nextX, nextY, offset, heading, new Set());
        }
        if (room.owner < 0 || room.owner === entity || exited.has(roomId)) return false;
        exited.add(roomId);
        if (entity === 0) crossings.push({ direction: 'out', owner: room.owner });
        offset = horizontal ? (y + offset) / room.height : (x + offset) / room.width;
        [roomId, x, y] = positions[room.owner];
      }
    }

    function enter(entity, owner, offset, heading, entered) {
      const childId = map.inside[owner];
      if (owner === entity || childId < 0 || entered.has(owner)) return false;
      entered.add(owner);
      const [dx, dy] = directions[heading];
      const horizontal = dx !== 0;
      const child = map.rooms[childId];
      const scaled = offset * (horizontal ? child.height : child.width);
      const lane = Math.floor(scaled);
      const crossingsBefore = crossings.length;
      if (entity === 0) crossings.push({ direction: 'in', owner });
      const moved = land(entity, childId, horizontal ? (dx > 0 ? 0 : child.width - 1) : lane,
        horizontal ? lane : (dy > 0 ? 0 : child.height - 1), scaled - lane, heading, entered);
      entered.delete(owner);
      if (!moved) crossings.length = crossingsBefore;
      return moved;
    }

    function land(entity, roomId, x, y, offset, heading, entered) {
      const room = map.rooms[roomId];
      if (room.tiles[y * room.width + x] === '#' || (!map.allowCycles && insideOwnBox(entity, roomId))) return false;
      const occupant = positions.findIndex(position => matches(position, roomId, x, y));
      if (occupant >= 0 && !moveEntity(occupant, 0.5, heading)) {
        if (enter(entity, occupant, offset, heading, entered)) return true;
        if (!map.eat || map.inside[entity] < 0 || moving.has(occupant)) return false;
        moving.add(occupant);
        // A swallowed piece moves inward through the moving box's leading face.
        const swallowed = enter(occupant, entity, 0.5, heading ^ 2, entered);
        moving.delete(occupant);
        if (!swallowed) return false;
      }
      positions[entity] = [roomId, x, y];
      return true;
    }

    if (!moveEntity(0, 0.5, direction)) return state;
    const pushed = positions.some((position, index) => index > 0 && position !== state.positions[index]);
    return { positions, moves: state.moves + 1, pushes: state.pushes + Number(pushed), crossings };
  }

  const api = { compile, placed, step, won };
  if (typeof module === 'object') module.exports = api;
  else root.BoxRooms = api;
})(globalThis);
