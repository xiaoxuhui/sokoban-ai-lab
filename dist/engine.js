/* The board engine is shared by manual play, training, and replay. */
(function (root) {
  'use strict';

  const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const symbols = '# .@$*+';
  const examples = [
    ['##########', '#        #', '# .  .   #', '#   #    #', '# $  $   #', '#   @    #', '#     #  #', '##########'],
    ['########', '#      #', '#  $ . #', '# @    #', '#      #', '########'],
    ['###########', '#         #', '# . . .   #', '#    #    #', '# $ $ $   #', '#   #     #', '#    @    #', '#         #', '###########'],
  ];

  function readMap(text) {
    const rows = text.replace(/\r/g, '').split('\n');
    while (rows[0] === '') rows.shift();
    while (rows.at(-1) === '') rows.pop();
    const width = rows[0]?.length ?? 0;
    if (!width || !rows.length ||
        rows.some(row => row.length !== width || [...row].some(tile => !symbols.includes(tile)))) {
      throw new Error('字符地图的每行须等宽，仅支持 # 空格 . @ $ * +。');
    }
    if (rows.join('').split('').filter(tile => tile === '@' || tile === '+').length > 1) {
      throw new Error('地图只能有一个玩家。');
    }
    return rows;
  }

  const opposite = direction => (direction + 2) % 4;
  const portalHost = tile => tile === '#' || tile === '$' || tile === '*';

  function compile(rows, chainPush = false, portals = []) {
    const width = rows[0].length;
    const tiles = rows.join('');
    const goals = new Set();
    const boxes = [];
    let player = -1;
    for (let i = 0; i < tiles.length; i++) {
      if ('.*+'.includes(tiles[i])) goals.add(i);
      if ('$*'.includes(tiles[i])) boxes.push(i);
      if ('@+'.includes(tiles[i])) player = i;
    }
    const adjacent = Array.from(tiles, (_, i) => directions.map(([dx, dy]) => {
      const x = i % width + dx;
      const y = Math.floor(i / width) + dy;
      const cell = y * width + x;
      return x < 0 || x >= width || y < 0 || y >= rows.length ? -1 : cell;
    }));
    const isWall = cell => tiles[cell] === '#';
    const next = adjacent.map(neighbors => neighbors.map(cell => isWall(cell) ? -1 : cell));
    return {
      width, tiles, goals, next, chainPush, isWall,
      adjacent: (cell, direction) => adjacent[cell][direction],
      neighbor: (cell, direction) => next[cell][direction],
      portalSides: portals.map(end => end.side),
      initial: { player, boxes, moves: 0, pushes: 0, portalCells: portals.map(end => end.cell) },
    };
  }

  const key = (x, y) => x + ',' + y;
  const point = cell => cell.split(',').map(Number);

  function fromRows(rows) {
    const tiles = new Map();
    rows.forEach((row, y) => [...row].forEach((tile, x) => {
      if (tile !== ' ') tiles.set(key(x, y), tile);
    }));
    return tiles;
  }

  function readLevel(text) {
    if (!text.trim()) return { tiles: new Map(), chainPush: false };
    if (!text.trimStart().startsWith('{')) return { tiles: fromRows(readMap(text)), chainPush: false };
    const data = JSON.parse(text);
    if (data?.version !== 1 || !Array.isArray(data.tiles)) throw new Error('地图 JSON 须包含 version: 1 和 tiles 数组。');
    const tiles = new Map();
    let hasPlayer = false;
    for (const entry of data.tiles) {
      if (!Array.isArray(entry) || entry.length !== 3) throw new Error('每格须写成 [横坐标, 纵坐标, 字符]。');
      const [x, y, tile] = entry;
      const cell = key(x, y);
      if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
          Math.abs(x) > 1e12 || Math.abs(y) > 1e12 ||
          typeof tile !== 'string' || tile.length !== 1 || !symbols.includes(tile) || tile === ' ' || tiles.has(cell)) {
        throw new Error('请检查地图坐标、重复格子和地图字符。');
      }
      if ('@+'.includes(tile)) {
        if (hasPlayer) throw new Error('地图只能有一个玩家。');
        hasPlayer = true;
      }
      tiles.set(cell, tile);
    }
    const pairs = data.portals ?? [];
    if (!Array.isArray(pairs) || pairs.some(pair => !Array.isArray(pair) || pair.length !== 2)) {
      throw new Error('传送门须成对设置。');
    }
    const used = new Set();
    const portals = pairs.flatMap(pair => pair.map(endpoint => {
      if (!Array.isArray(endpoint) || endpoint.length !== 3) throw new Error('请检查传送门端点。');
      const [x, y, side] = endpoint;
      const cell = key(x, y);
      const face = cell + ',' + side;
      if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !Number.isInteger(side) ||
          !directions[side] || !portalHost(tiles.get(cell)) || used.has(face)) {
        throw new Error('传送门须绑定在箱子或墙的边上，每条边只能绑定一个端点。');
      }
      used.add(face);
      return { cell, side };
    }));
    return { tiles, chainPush: data.chainPush === true, portals };
  }

  function readWorld(text) {
    return readLevel(text).tiles;
  }

  function writeWorld(tiles, chainPush = false, portals = []) {
    const lines = [...tiles].map(([cell, tile]) => JSON.stringify([...point(cell), tile]));
    const pairs = [];
    for (let i = 0; i < portals.length; i += 2) {
      pairs.push(JSON.stringify(portals.slice(i, i + 2).map(end => [...point(end.cell), end.side])));
    }
    const links = pairs.length ? '],\n  "portals": [\n    ' + pairs.join(',\n    ') + '\n  ]' : ']';
    return '{\n  "version": 1,\n  "chainPush": ' + chainPush + ',\n  "tiles": [' + (lines.length ? '\n    ' + lines.join(',\n    ') + '\n  ' : '') + links + '\n}';
  }

  function world(tiles, chainPush = false, portals = []) {
    const goals = new Set();
    const boxes = [];
    let player = -1;
    for (const [cell, tile] of tiles) {
      if ('.*+'.includes(tile)) goals.add(cell);
      if ('$*'.includes(tile)) boxes.push(cell);
      if ('@+'.includes(tile)) player = cell;
    }
    const adjacent = (cell, direction) => {
      const [x, y] = point(cell);
      const [dx, dy] = directions[direction];
      return key(x + dx, y + dy);
    };
    const isWall = cell => tiles.get(cell) === '#';
    return {
      tiles, goals, chainPush, isWall, adjacent, portalSides: portals.map(end => end.side),
      initial: { player, boxes, moves: 0, pushes: 0, portalCells: portals.map(end => end.cell) },
      neighbor(cell, direction) {
        const next = adjacent(cell, direction);
        return isWall(next) ? -1 : next;
      },
    };
  }

  function bounds(tiles) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const cell of tiles.keys()) {
      const [x, y] = point(cell);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    return { left, top, right, bottom };
  }

  function trainingMap(tiles, area, chainPush = false, portals = []) {
    const { left, top, right, bottom } = area;
    const margin = 3;
    const width = right - left + 1 + margin * 2;
    const height = bottom - top + 1 + margin * 2;
    if (width * height > 40000) return null;
    const rows = Array.from({ length: height }, () => Array(width).fill(' '));
    const toIndex = cell => {
      const [x, y] = point(cell);
      return (y - top + margin) * width + x - left + margin;
    };
    for (const [cell, tile] of tiles) {
      const index = toIndex(cell);
      rows[Math.floor(index / width)][index % width] = tile;
    }
    return {
      ...compile(rows.map(row => row.join('')), chainPush, portals.map(end => ({ ...end, cell: toIndex(end.cell) }))),
      worldCell: cell => key(left - margin + cell % width, top - margin + Math.floor(cell / width)),
    };
  }

  function validate(map) {
    if (map.initial.player === -1) return '请放置一个玩家起点。';
    if (!map.goals.size) return '请至少放置一个目标点。';
    if (map.initial.boxes.length < map.goals.size) return '箱子不足，无法覆盖所有目标点。';
    return '';
  }

  function placed(map, state) {
    return state.boxes.filter(box => map.goals.has(box)).length;
  }

  function won(map, state) {
    return map.goals.size > 0 && placed(map, state) === map.goals.size;
  }

  function pushLanding(map, first, direction, occupied) {
    let next = map.neighbor(first, direction);
    while (next !== -1 && occupied.has(next)) {
      if (!map.chainPush) return -1;
      next = map.neighbor(next, direction);
    }
    return next;
  }

  function step(map, state, direction) {
    if (state.player === -1 || !directions[direction]) return state;
    if (map.portalSides.length) return portalStep(map, state, direction);
    const player = map.neighbor(state.player, direction);
    if (player === -1) return state;
    const box = state.boxes.indexOf(player);
    if (box < 0) return { ...state, player, moves: state.moves + 1 };
    const landing = pushLanding(map, player, direction, new Set(state.boxes));
    if (landing === -1) return state;
    // Every intermediate square still contains a box after the chain moves.
    const boxes = [...state.boxes];
    boxes[box] = landing;
    if (typeof landing === 'number') boxes.sort((a, b) => a - b);
    return { ...state, player, boxes, moves: state.moves + 1, pushes: state.pushes + 1 };
  }

  function portalOn(map, state, cell, side) {
    return state.portalCells.findIndex((host, i) => host === cell && map.portalSides[i] === side);
  }

  function portalExit(map, portalCells, entrance) {
    if (entrance < 0) return -1;
    const exit = entrance ^ 1;
    return map.neighbor(portalCells[exit], map.portalSides[exit]);
  }

  function portalStep(map, state, direction) {
    const first = map.adjacent(state.player, direction);
    if (first === -1) return state;
    const occupied = new Set(state.boxes);
    const face = map.isWall(first) || occupied.has(first) ? portalOn(map, state, first, opposite(direction)) : -1;
    if (face >= 0) {
      const entrance = face;
      const player = portalExit(map, state.portalCells, entrance);
      if (player === -1 || player === state.player || occupied.has(player)) return state;
      return { ...state, player, moves: state.moves + 1 };
    }
    if (map.isWall(first)) return state;
    if (!occupied.has(first)) return { ...state, player: first, moves: state.moves + 1 };

    const moved = new Map();
    let player = first;
    let entrance = -1;
    let cargo;
    for (let box = first; ;) {
      const ahead = map.adjacent(box, direction);
      if (ahead === -1) return state;
      if (map.isWall(ahead)) {
        entrance = portalOn(map, state, ahead, opposite(direction));
        if (entrance < 0) return state;
        cargo = box;
        break;
      }
      if (!occupied.has(ahead)) {
        moved.set(box, ahead);
        break;
      }
      const beyond = map.adjacent(ahead, direction);
      const forward = portalOn(map, state, box, direction);
      if (forward >= 0 && map.isWall(beyond)) {
        // The squeeze takes the front box. Keep the entrance face clear for the return trip.
        moved.clear();
        player = state.player;
        entrance = forward;
        cargo = ahead;
        break;
      }
      const facing = portalOn(map, state, ahead, opposite(direction));
      if (facing >= 0) {
        entrance = facing;
        cargo = box;
        break;
      }
      if (map.isWall(beyond)) {
        // A wall portal can accept a box even when the pushing box has no portal.
        const wallEntrance = portalOn(map, state, beyond, opposite(direction));
        if (!map.chainPush && wallEntrance >= 0) {
          moved.set(box, ahead);
          entrance = wallEntrance;
          cargo = ahead;
          break;
        }
      }
      if (!map.chainPush && forward < 0) return state;
      // A forward portal can push the single box immediately in front of it.
      if (!map.chainPush && occupied.has(beyond)) return state;
      moved.set(box, ahead);
      box = ahead;
    }
    const boxes = state.boxes.filter(box => box !== cargo).map(box => moved.get(box) ?? box);
    const portalCells = state.portalCells.map(cell => moved.get(cell) ?? cell);
    if (cargo !== undefined) {
      if (state.portalCells[entrance ^ 1] === cargo) return state;
      const landing = portalExit(map, portalCells, entrance);
      if (landing === -1 || landing === cargo || landing === player || boxes.includes(landing)) return state;
      boxes.push(landing);
      state.portalCells.forEach((cell, i) => { if (cell === cargo) portalCells[i] = landing; });
    }
    if (typeof first === 'number') boxes.sort((a, b) => a - b);
    return { player, boxes, portalCells, moves: state.moves + 1, pushes: state.pushes + 1 };
  }

  function reach(map, state) {
    const previous = new Int32Array(map.tiles.length).fill(-1);
    const via = new Uint8Array(map.tiles.length);
    const boxes = new Set(state.boxes);
    const queue = [state.player];
    let first = state.player;
    previous[state.player] = state.player;
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      first = Math.min(first, cell);
      map.next[cell].forEach((neighbor, direction) => {
        if (map.portalSides.length && (neighbor === -1 || boxes.has(neighbor))) {
          const host = map.adjacent(cell, direction);
          const entrance = portalOn(map, state, host, opposite(direction));
          neighbor = portalExit(map, state.portalCells, entrance);
        }
        if (neighbor < 0 || previous[neighbor] >= 0 || boxes.has(neighbor)) return;
        previous[neighbor] = cell;
        via[neighbor] = direction;
        queue.push(neighbor);
      });
    }
    return { first, previous, via, boxes };
  }

  function distancesToGoals(map) {
    const distances = new Int32Array(map.tiles.length).fill(-1);
    const queue = [...map.goals];
    queue.forEach(goal => { distances[goal] = 0; });
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      map.next[cell].forEach((from, reverse) => {
        if (from < 0 || map.next[from][reverse] < 0 || distances[from] >= 0) return;
        distances[from] = distances[cell] + 1;
        queue.push(from);
      });
    }
    return distances;
  }

  function choices(map, state, distances) {
    const area = reach(map, state);
    const actions = [];
    const hasPortals = map.portalSides.length > 0;
    // Extra boxes can occupy squares from which no goal is reachable.
    const spare = state.boxes.length - map.goals.size;
    const stranded = state.boxes.filter(box => distances[box] < 0).length;
    state.boxes.forEach(box => {
      map.next[box].forEach((_, direction) => {
        const from = map.next[box][(direction + 2) % 4];
        if (from < 0 || area.previous[from] < 0) return;
        if (hasPortals) {
          const next = portalStep(map, { ...state, player: from }, direction);
          if (next.pushes > state.pushes) {
            const to = next.boxes.find(cell => !area.boxes.has(cell));
            actions.push({ box, to, from, direction, id: box * 4 + direction });
          }
          return;
        }
        const to = pushLanding(map, box, direction, area.boxes);
        if (to < 0) return;
        const nextStranded = stranded - Number(distances[box] < 0) + Number(distances[to] < 0);
        if (nextStranded <= spare) actions.push({ box, to, from, direction, id: box * 4 + direction });
      });
    });
    const key = hasPortals ?
      [state.player, state.boxes.join(','), state.portalCells.join(',')].join(':') :
      area.first + ':' + state.boxes.join(',');
    return { area, actions, key };
  }

  class Trainer {
    constructor(map, random = Math.random) {
      this.map = map;
      this.random = random;
      this.distances = distancesToGoals(map);
      this.q = new Map();
      this.episodes = 0;
      this.successes = 0;
      this.recent = [];
      this.history = [];
      this.best = won(map, map.initial) ? { path: [], pushes: 0 } : null;
      this.last = map.initial;
      this.state = map.initial;
      this.demonstration = null;
      this.guidedStart = 0;
      this.guided = false;
      this.maxPushes = Math.min(160, Math.max(35, map.initial.boxes.length * 28));
    }

    setDemonstration(directions) {
      const map = this.map;
      let state = map.initial;
      const trace = [];
      for (const direction of directions) {
        const next = step(map, state, direction);
        if (next === state || won(map, state)) return false;
        if (next.pushes > state.pushes) {
          const { key, actions } = choices(map, state, this.distances);
          const box = map.adjacent(state.player, direction);
          const action = actions.find(candidate => candidate.box === box && candidate.direction === direction);
          if (action) trace.push([key, action, this.reward(state, next, action, false)]);
        }
        state = next;
      }
      this.demonstration = directions.length ? { directions: directions.slice(), state, trace } : null;
      this.guidedStart = this.episodes;
      this.guided = false;
      this.state = map.initial;
      return true;
    }

    get epsilon() {
      if (this.demonstration) {
        const sinceDemo = this.episodes - this.guidedStart;
        return Math.max(0.12, 0.75 * Math.exp(-sinceDemo / 280));
      }
      return Math.max(0.12, 0.96 * Math.exp(-this.episodes / 280));
    }

    get rate() {
      return this.recent.length ? this.recent.reduce((sum, value) => sum + value, 0) / this.recent.length : 0;
    }

    estimate(action) {
      const from = this.distances[action.box];
      const to = this.distances[action.to];
      return from === undefined || to === undefined || from < 0 || to < 0 ? 0 : 0.24 * (from - to);
    }

    value(key, action) {
      return this.q.get(key)?.get(action.id) ?? this.estimate(action);
    }

    learn(key, action, value) {
      let values = this.q.get(key);
      if (!values && this.q.size < 100000) {
        values = new Map();
        this.q.set(key, values);
      }
      values?.set(action.id, value);
    }

    reward(state, next, action, stuck) {
      if (won(this.map, next)) return 18;
      if (stuck) return -5;
      return -0.13 + 0.8 * (placed(this.map, next) - placed(this.map, state)) + this.estimate(action);
    }

    episode() {
      for (const _ of this.attempt()) { /* Complete the episode synchronously. */ }
    }

    *attempt() {
      const map = this.map;
      let state = this.state = map.initial;
      let path = [];
      let trace = [];
      this.guided = Boolean(this.demonstration && (this.episodes - this.guidedStart) % 2 === 0);
      if (this.guided) {
        const opening = this.demonstration;
        path = opening.directions.slice();
        trace = opening.trace.slice();
        state = this.state = opening.state;
        yield { from: map.initial, directions: opening.directions, demonstration: true };
      }
      const pushLimit = state.pushes + this.maxPushes;
      let current = choices(map, state, this.distances);
      while (current.actions.length && state.pushes < pushLimit && !won(map, state)) {
        const actions = current.actions;
        let action = actions[Math.floor(this.random() * actions.length)];
        if (this.random() >= this.epsilon) {
          for (const candidate of actions) {
            if (this.value(current.key, candidate) > this.value(current.key, action)) action = candidate;
          }
        }
        const walking = [];
        for (let cell = action.from; cell !== state.player; cell = current.area.previous[cell]) {
          walking.push(current.area.via[cell]);
        }
        walking.reverse();
        const beforePush = state;
        const nextState = step(map, { ...state, player: action.from, moves: state.moves + walking.length }, action.direction);
        walking.push(action.direction);
        path.push(...walking);
        const next = choices(map, nextState, this.distances);
        const solved = won(map, nextState);
        const stuck = next.actions.length === 0;
        const timedOut = nextState.pushes >= pushLimit;
        const reward = this.reward(state, nextState, action, stuck);
        const future = solved || stuck || timedOut ? 0 : Math.max(...next.actions.map(choice => this.value(next.key, choice)));
        const before = this.value(current.key, action);
        const learned = before + 0.35 * (reward + 0.94 * future - before);
        this.learn(current.key, action, learned);
        trace.push([current.key, action, reward]);
        state = this.state = nextState;
        current = next;
        yield { from: beforePush, directions: walking };
      }

      const success = won(map, state);
      if (success) {
        this.successes++;
        // Replay the successful experience backwards to propagate its reward sooner.
        let value = 0;
        for (let i = trace.length - 1; i >= 0; i--) {
          const [key, action, reward] = trace[i];
          value = reward + 0.94 * value;
          const before = this.value(key, action);
          if (value > before) this.learn(key, action, before + 0.45 * (value - before));
        }
        if (!this.best || state.pushes < this.best.pushes ||
            (state.pushes === this.best.pushes && path.length < this.best.path.length)) {
          this.best = { path, pushes: state.pushes };
        }
      }
      this.last = state;
      this.episodes++;
      if (!this.guided) {
        this.recent.push(Number(success));
        if (this.recent.length > 100) this.recent.shift();
      }
      if (this.recent.length && (!this.history.length || this.episodes % 10 === 0)) {
        this.history.push({ episode: this.episodes, rate: this.rate });
        if (this.history.length > 240) this.history.shift();
      }
    }
  }

  const api = { examples, readMap, fromRows, readLevel, readWorld, writeWorld, world, bounds, key, point, portalHost, trainingMap, compile, validate, placed, won, step, Trainer };
  if (typeof module === 'object') module.exports = api;
  else root.Sokoban = api;
})(globalThis);
