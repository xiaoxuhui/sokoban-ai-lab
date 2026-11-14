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
    if (width < 5 || width > 16 || rows.length < 5 || rows.length > 16 ||
        rows.some(row => row.length !== width || [...row].some(tile => !symbols.includes(tile)))) {
      throw new Error('地图须为 5 至 16 格的矩形，每行等宽。仅支持 # 空格 . @ $ * +。');
    }
    if (rows.join('').split('').filter(tile => tile === '@' || tile === '+').length > 1) {
      throw new Error('地图只能有一个玩家。');
    }
    return rows;
  }

  function compile(rows) {
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
    return { width, tiles, goals, next, initial: { player, boxes, moves: 0, pushes: 0 } };
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

  function step(map, state, direction) {
    const player = map.next[state.player]?.[direction] ?? -1;
    if (player < 0) return state;
    const box = state.boxes.indexOf(player);
    if (box < 0) return { ...state, player, moves: state.moves + 1 };
    const landing = map.next[player][direction];
    if (landing < 0 || state.boxes.includes(landing)) return state;
    const boxes = [...state.boxes];
    boxes[box] = landing;
    boxes.sort((a, b) => a - b);
    return { player, boxes, moves: state.moves + 1, pushes: state.pushes + 1 };
  }

  function reach(map, state) {
    const previous = new Int16Array(map.tiles.length).fill(-1);
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
    const distances = new Int16Array(map.tiles.length).fill(-1);
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
      map.next[box].forEach((to, direction) => {
        const from = map.next[box][(direction + 2) % 4];
        if (to >= 0 && from >= 0 && area.previous[from] >= 0 && !area.boxes.has(to) && distances[to] >= 0) {
          actions.push({ box, to, from, direction, id: box * 4 + direction });
        }
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
      this.maxPushes = Math.min(160, Math.max(35, map.initial.boxes.length * 28));
    }

    get epsilon() {
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

    episode() {
      const map = this.map;
      let state = map.initial;
      let current = choices(map, state, this.distances);
      const path = [];
      const trace = [];
      while (current.actions.length && state.pushes < this.maxPushes && !won(map, state)) {
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
        const nextState = step(map, { ...state, player: action.from, moves: state.moves + walking.length }, action.direction);
        path.push(...walking, action.direction);
        const next = choices(map, nextState, this.distances);
        const solved = won(map, nextState);
        const stuck = next.actions.length === 0;
        const timedOut = nextState.pushes >= this.maxPushes;
        const reward = solved ? 18 : stuck ? -5 :
          -0.13 + 0.8 * (placed(map, nextState) - placed(map, state)) + this.estimate(action);
        const future = solved || stuck || timedOut ? 0 : Math.max(...next.actions.map(choice => this.value(next.key, choice)));
        const before = this.value(current.key, action);
        const learned = before + 0.35 * (reward + 0.94 * future - before);
        let values = this.q.get(current.key);
        if (!values && this.q.size < 100000) {
          values = new Map();
          this.q.set(current.key, values);
        }
        values?.set(action.id, learned);
        trace.push([current.key, action, reward]);
        state = nextState;
        current = next;
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
          if (value > before) this.q.get(key)?.set(action.id, before + 0.45 * (value - before));
        }
        if (!this.best || state.pushes < this.best.pushes ||
            (state.pushes === this.best.pushes && path.length < this.best.path.length)) {
          this.best = { path, pushes: state.pushes };
        }
      }
      this.last = state;
      this.episodes++;
      this.recent.push(Number(success));
      if (this.recent.length > 100) this.recent.shift();
      if (this.episodes === 1 || this.episodes % 10 === 0) {
        this.history.push({ episode: this.episodes, rate: this.rate });
        if (this.history.length > 240) this.history.shift();
      }
    }
  }

  const api = { examples, readMap, compile, validate, placed, won, step, Trainer };
  if (typeof module === 'object') module.exports = api;
  else root.Sokoban = api;
})(globalThis);
