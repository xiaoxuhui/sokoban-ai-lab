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

  function compile(rows, chainPush = false) {
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
    const next = Array.from(tiles, (_, i) => directions.map(([dx, dy]) => {
      const x = i % width + dx;
      const y = Math.floor(i / width) + dy;
      const cell = y * width + x;
      return x < 0 || x >= width || y < 0 || y >= rows.length || tiles[cell] === '#' ? -1 : cell;
    }));
    return { width, tiles, goals, next, chainPush, neighbor: (cell, direction) => next[cell][direction], initial: { player, boxes, moves: 0, pushes: 0 } };
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
    return { tiles, chainPush: data.chainPush === true };
  }

  function readWorld(text) {
    return readLevel(text).tiles;
  }

  function writeWorld(tiles, chainPush = false) {
    const lines = [...tiles].map(([cell, tile]) => JSON.stringify([...point(cell), tile]));
    return '{\n  "version": 1,\n  "chainPush": ' + chainPush + ',\n  "tiles": [' + (lines.length ? '\n    ' + lines.join(',\n    ') + '\n  ' : '') + ']\n}';
  }

  function world(tiles, chainPush = false) {
    const goals = new Set();
    const boxes = [];
    let player = -1;
    for (const [cell, tile] of tiles) {
      if ('.*+'.includes(tile)) goals.add(cell);
      if ('$*'.includes(tile)) boxes.push(cell);
      if ('@+'.includes(tile)) player = cell;
    }
    return {
      tiles, goals, chainPush, initial: { player, boxes, moves: 0, pushes: 0 },
      neighbor(cell, direction) {
        const [x, y] = point(cell);
        const [dx, dy] = directions[direction];
        const next = key(x + dx, y + dy);
        return tiles.get(next) === '#' ? -1 : next;
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

  function trainingMap(tiles, area, chainPush = false) {
    const { left, top, right, bottom } = area;
    const margin = 3;
    const width = right - left + 1 + margin * 2;
    const height = bottom - top + 1 + margin * 2;
    if (width * height > 40000) return null;
    const rows = Array.from({ length: height }, () => Array(width).fill(' '));
    for (const [cell, tile] of tiles) {
      const [x, y] = point(cell);
      rows[y - top + margin][x - left + margin] = tile;
    }
    return {
      ...compile(rows.map(row => row.join('')), chainPush),
      worldCell: cell => key(left - margin + cell % width, top - margin + Math.floor(cell / width)),
    };
  }

  function validate(map) {
    if (map.initial.player === -1) return '请放置一个玩家起点。';
    if (!map.initial.boxes.length) return '请至少放置一个箱子。';
    if (map.initial.boxes.length !== map.goals.size) return '箱子和目标点的数量必须相同。';
    return '';
  }

  function placed(map, state) {
    return state.boxes.filter(box => map.goals.has(box)).length;
  }

  function won(map, state) {
    return state.boxes.length > 0 && placed(map, state) === state.boxes.length;
  }

  function pushLanding(map, first, direction, occupied, distances) {
    let next = map.neighbor(first, direction);
    while (next !== -1 && occupied.has(next)) {
      if (!map.chainPush || (distances && distances[next] < 0)) return -1;
      next = map.neighbor(next, direction);
    }
    if (next !== -1 && distances && distances[next] < 0) return -1;
    return next;
  }

  function step(map, state, direction) {
    if (state.player === -1 || !directions[direction]) return state;
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
    return { player, boxes, moves: state.moves + 1, pushes: state.pushes + 1 };
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
    state.boxes.forEach(box => {
      map.next[box].forEach((_, direction) => {
        const from = map.next[box][(direction + 2) % 4];
        if (from < 0 || area.previous[from] < 0) return;
        const to = pushLanding(map, box, direction, area.boxes, distances);
        if (to >= 0) actions.push({ box, to, from, direction, id: box * 4 + direction });
      });
    });
    return { area, actions, key: `${area.first}:${state.boxes.join(',')}` };
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
          const action = actions.find(candidate => candidate.box === next.player && candidate.direction === direction);
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
      const distance = this.distances[action.box];
      return distance < 0 ? 0 : 0.24 * (distance - this.distances[action.to]);
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

  const api = { examples, readMap, fromRows, readLevel, readWorld, writeWorld, world, bounds, key, point, trainingMap, compile, validate, placed, won, step, Trainer };
  if (typeof module === 'object') module.exports = api;
  else root.Sokoban = api;
})(globalThis);
