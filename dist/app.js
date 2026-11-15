'use strict';

const { examples, fromRows, readLevel, writeWorld, world, bounds, key, point, portalHost, trainingMap, validate, placed, won, step, Trainer } = Sokoban;
const $ = id => document.getElementById(id);
const board = $('board');
const grid = $('grid');
const dialog = $('dialog');
const storageKey = 'sokoban-lab-levels-v1';
const number = new Intl.NumberFormat('zh-CN');

function loadLevels() {
  let first = { name: '自制关卡 1', tiles: new Map(), chainPush: false };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved?.levels) && saved.levels.length) {
      const entries = saved.levels.map(({ name, code, demonstration }) => ({
        name, ...readLevel(code),
        demonstration: Array.isArray(demonstration) ? demonstration.filter(direction =>
          Number.isInteger(direction) && direction >= 0 && direction <= 3) : [],
      }));
      return { entries, index: entries[saved.index] ? saved.index : 0 };
    }
  } catch { /* Try the previous format. */ }
  try {
    const code = localStorage.getItem('sokoban-lab-world-v1') ?? localStorage.getItem('sokoban-lab-map-v1') ?? '';
    first = { ...first, ...readLevel(code) };
  } catch { /* An empty level is available even without storage. */ }
  return { entries: [first], index: 0 };
}

const library = loadLevels();
const sessions = new Map();
let level = library.entries[library.index];
let map = world(level.tiles, level.chainPush, level.portals, level.finish);
let area = bounds(map.tiles, map.finish);
let brush = '#';
let pendingPortal = null;
let portalMessage = '';
let mode = 'edit';
let manual = map.initial;
let undo = [];
let manualPath = [];
let recording = false;
let trainer = null;
let trainingProblem = '';
let attempt = null;
let running = false;
let target = 0;
let frame = 0;
let watchState = null;
let watchSegment = null;
let watchResult = null;
let nextWatchAt = 0;
let playback = 0;
let replayState = null;
let replayMessage = '';
let listedRoutes = null;
let listedCount = 0;
let gesture = null;
let camera = { x: 0.5, y: 0.5 };
let visibleArea = '';
let cells = new Map();

const tileName = { '#': '墙', ' ': '地板', '.': '目标', '$': '箱子', '@': '玩家', '*': '目标上的箱子', '+': '目标上的玩家' };
const sideNames = ['上边', '右边', '下边', '左边'];

function cellSize() {
  return board.clientWidth < 420 ? 29 : 40;
}

function centerMap() {
  if (!map.tiles.size) camera = { x: 0.5, y: 0.5 };
  else if (map.initial.player !== -1) {
    const [x, y] = point(map.initial.player);
    camera = { x: x + 0.5, y: y + 0.5 };
  } else {
    camera = { x: (area.left + area.right + 1) / 2, y: (area.top + area.bottom + 1) / 2 };
  }
}

function followPlayer(state) {
  if (state.player === -1) return;
  const [x, y] = point(state.player);
  const size = cellSize();
  if (Math.abs(x + 0.5 - camera.x) > board.clientWidth / size / 2 - 1.5 ||
      Math.abs(y + 0.5 - camera.y) > board.clientHeight / size / 2 - 1.5) {
    camera = { x: x + 0.5, y: y + 0.5 };
  }
}

function layoutBoard() {
  const size = cellSize();
  const left = camera.x - board.clientWidth / size / 2;
  const top = camera.y - board.clientHeight / size / 2;
  const startX = Math.floor(left);
  const startY = Math.floor(top);
  const columns = Math.ceil(left + board.clientWidth / size) - startX;
  const rowCount = Math.ceil(top + board.clientHeight / size) - startY;
  const signature = [startX, startY, columns, rowCount].join(',');
  grid.style.setProperty('--cell-size', size + 'px');
  grid.style.setProperty('--cols', columns);
  grid.style.transform = 'translate(' + (startX - left) * size + 'px,' + (startY - top) * size + 'px)';
  if (signature === visibleArea) return;
  visibleArea = signature;
  const nextCells = new Map();
  for (let y = startY; y < startY + rowCount; y++) {
    for (let x = startX; x < startX + columns; x++) {
      const coordinate = key(x, y);
      let cell = cells.get(coordinate);
      if (!cell) {
        cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cell';
        cell.dataset.cell = coordinate;
      }
      nextCells.set(coordinate, cell);
    }
  }
  const focused = grid.contains(document.activeElement) ? document.activeElement : null;
  grid.replaceChildren(...nextCells.values());
  if (focused && grid.contains(focused)) focused.focus({ preventScroll: true });
  cells = nextCells;
}

function renderBoard(state) {
  layoutBoard();
  const boxes = new Set(state.boxes);
  const editable = mode === 'edit';
  const linking = editable && brush === 'portal';
  const marks = new Map();
  state.portalCells.forEach((coordinate, index) => {
    if (!marks.has(coordinate)) marks.set(coordinate, []);
    marks.get(coordinate).push({ side: map.portalSides[index], pair: Math.floor(index / 2) + 1 });
  });
  if (linking && pendingPortal) {
    if (!marks.has(pendingPortal.cell)) marks.set(pendingPortal.cell, []);
    marks.get(pendingPortal.cell).push({ side: pendingPortal.side, pair: 0 });
  }
  board.classList.toggle('editable', editable);
  board.classList.toggle('linking', linking);
  cells.forEach((cell, coordinate) => {
    const goal = map.goals.has(coordinate);
    const finish = map.finish === coordinate;
    const tile = map.tiles.get(coordinate) === '#' ? '#' :
      boxes.has(coordinate) ? (goal ? '*' : '$') :
      state.player === coordinate ? (goal ? '+' : '@') : (goal ? '.' : ' ');
    const ends = marks.get(coordinate) ?? [];
    const signature = ends.map(({ side, pair }) => side + ':' + pair).join(',');
    if (cell.dataset.tile !== tile || cell.dataset.portals !== signature || cell.classList.contains('finish-cell') !== finish) {
      cell.dataset.tile = tile;
      cell.dataset.portals = signature;
      cell.classList.toggle('wall', tile === '#');
      cell.classList.toggle('finish-cell', finish);
      cell.replaceChildren();
      if (finish) cell.append(makeTile('finish-mark'));
      if (goal) cell.append(makeTile('goal'));
      if ('$*'.includes(tile)) cell.append(makeTile(tile === '*' ? 'crate placed' : 'crate'));
      if ('@+'.includes(tile)) cell.append(makeTile('player'));
      ends.forEach(({ side, pair }) => {
        const mark = makeTile('portal-mark');
        mark.dataset.side = side;
        mark.dataset.tone = (pair - 1) % 4;
        mark.textContent = pair || '·';
        cell.append(mark);
      });
      const [x, y] = point(coordinate);
      const label = ends.map(({ side, pair }) => sideNames[side] + (pair ? '传送门 ' + pair : '等待配对')).join('，');
      cell.setAttribute('aria-label', '坐标 ' + x + ', ' + y + '，' + tileName[tile] +
        (finish ? '，玩家终点' : '') + (label ? '，' + label : ''));
    }
    cell.tabIndex = editable ? 0 : -1;
    cell.disabled = !editable;
  });
}

function makeTile(className) {
  const tile = document.createElement('i');
  tile.className = className;
  tile.setAttribute('aria-hidden', 'true');
  return tile;
}

function renderMap() {
  const editing = mode === 'edit';
  const playing = mode === 'play';
  const watching = mode === 'watch';
  const linking = editing && brush === 'portal';
  const state = activeState();
  $('edit-mode').setAttribute('aria-pressed', editing);
  $('play-mode').setAttribute('aria-pressed', playing);
  $('watch-mode').setAttribute('aria-pressed', watching);
  $('edit-tools').hidden = !editing;
  $('play-tools').hidden = !playing;
  $('watch-tools').hidden = !watching;
  $('stop-replay').hidden = mode !== 'replay' || !playback;
  $('map-actions').hidden = !editing;
  $('dpad').hidden = !playing;
  $('undo').disabled = !undo.length;
  $('reset-play').disabled = !manual.moves;
  $('record-tools').hidden = !recording;
  $('save-demo').disabled = !manualPath.length;
  $('portal-cancel').hidden = !linking || !pendingPortal;
  $('portal-help').hidden = !linking;
  $('portal-help').textContent = portalMessage || (pendingPortal ? '已选第一端，再点墙或箱子的另一条边。' :
    '点墙或箱子的两条边配对。点击已有端点可移除整对。');
  $('map-info').textContent = '无限地图 · ' + map.initial.boxes.length + ' 个箱子 · ' + map.goals.size + ' 个目标';
  $('finish-status').textContent = map.finish === null ? '玩家终点可选' : '已设置玩家终点';
  $('move-count').textContent = '移动 ' + manual.moves + ' 步 · 推箱 ' + manual.pushes + ' 次';
  const problem = editing || watching ? validate(map) || (watching ? trainingProblem : '') : '';
  const solved = !editing && won(map, state);
  $('map-note').className = 'map-note' + (problem ? ' error' : solved ? ' success' : '');
  const note = problem || (editing ? '地图可试玩和训练' :
    recording ? (solved ? '示范已通关，可以保存。' : '示范中。走几步或推几次箱后即可保存。') :
    playing ? (solved ? '通关！' : objectiveProgress(state)) :
    watching ? watchNote(state, solved) : replayMessage);
  if ($('map-note').textContent !== note) $('map-note').textContent = note;
  if (watching) {
    const episode = Math.min((trainer?.episodes ?? 0) + Number(watchResult === null), target);
    $('watch-progress').textContent = (episode ? '第 ' + number.format(episode) + ' 回合 · ' : '') +
      (watchSegment?.demonstration ? '跟随示范 · ' : '') +
      '移动 ' + state.moves + ' 步 · 推箱 ' + state.pushes + ' 次';
  }
  renderBoard(state);
}

function objectiveProgress(state) {
  const covered = placed(map, state);
  if (map.finish !== null && covered === map.goals.size && state.player !== map.finish) return '请走到玩家终点。';
  return '目标已覆盖 ' + covered + ' / ' + map.goals.size;
}

function watchNote(state, solved) {
  if (!trainer) return '开始训练后，可在这里看 AI 走位和推箱。';
  const position = objectiveProgress(state);
  if (!running && trainer.episodes >= target) return '本批训练完成 · ' + position;
  if (!running) return '训练已暂停 · ' + position;
  if (solved) return '本回合通关';
  if (watchResult === false) return '本回合未通关，AI 将重新尝试';
  return position;
}

function setMode(next) {
  if (next === 'play' && validate(map)) {
    $('map-note').textContent = validate(map);
    return;
  }
  clearTimeout(playback);
  playback = 0;
  if (next !== 'play') recording = false;
  if (next !== 'edit') {
    pendingPortal = null;
    portalMessage = '';
  }
  mode = next;
  if (mode === 'play') followPlayer(manual);
  if (mode === 'watch') {
    nextWatchAt = 0;
    if (!watchState && trainer) syncWatchState();
    followPlayer(activeState());
  }
  renderMap();
  renderTraining();
}

function pauseTraining() {
  running = false;
  cancelAnimationFrame(frame);
}

function saveLevels() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      index: library.index,
      levels: library.entries.map(entry => ({
        name: entry.name, code: writeWorld(entry.tiles, entry.chainPush, entry.portals, entry.finish), demonstration: entry.demonstration,
      })),
    }));
  } catch { /* Storage is optional. */ }
}

function renderLevelPicker() {
  const picker = $('current-level');
  picker.replaceChildren(...library.entries.map((entry, index) =>
    new Option((index + 1) + ' · ' + entry.name, index)));
  picker.value = library.index;
  $('prev-level').disabled = library.index === 0;
  $('next-level').disabled = library.index === library.entries.length - 1;
}

function loadBoard(recenter) {
  watchState = null;
  watchSegment = null;
  watchResult = null;
  nextWatchAt = 0;
  map = world(level.tiles, level.chainPush, level.portals, level.finish);
  area = bounds(level.tiles, map.finish);
  manual = map.initial;
  undo = [];
  manualPath = [];
  recording = false;
  pendingPortal = null;
  portalMessage = '';
  mode = 'edit';
  $('chain-push').checked = level.chainPush;
  if (recenter) centerMap();
  renderMap();
  renderTraining();
}

function stopActivity() {
  pauseTraining();
  clearTimeout(playback);
  playback = 0;
}

function selectLevel(index) {
  if (!library.entries[index] || index === library.index) return;
  stopActivity();
  if (trainer || trainingProblem) sessions.set(level, { trainer, trainingProblem, attempt, target });
  activateLevel(index);
}

function activateLevel(index) {
  library.index = index;
  level = library.entries[index];
  const session = sessions.get(level);
  trainer = session?.trainer ?? null;
  trainingProblem = session?.trainingProblem ?? '';
  attempt = session?.attempt ?? null;
  target = session?.target ?? 0;
  saveLevels();
  renderLevelPicker();
  loadBoard(true);
}

function blankLevel(name) {
  return { name, tiles: new Map(), chainPush: false };
}

function deleteLevel() {
  stopActivity();
  sessions.delete(level);
  library.entries.splice(library.index, 1);
  if (!library.entries.length) library.entries.push(blankLevel('自制关卡 1'));
  activateLevel(Math.min(library.index, library.entries.length - 1));
}

function addLevels(entries) {
  const first = library.entries.length;
  library.entries.push(...entries);
  selectLevel(first);
}

function changeMap(tiles, recenter = false, chainPush = level.chainPush, portals = level.portals ?? [], finish = map.finish) {
  stopActivity();
  sessions.delete(level);
  trainer = null;
  trainingProblem = '';
  attempt = null;
  target = 0;
  level.tiles = tiles;
  level.chainPush = chainPush;
  level.portals = portals;
  level.finish = finish;
  level.demonstration = [];
  saveLevels();
  loadBoard(recenter);
}

$('current-level').addEventListener('change', event => selectLevel(Number(event.target.value)));
$('prev-level').addEventListener('click', () => selectLevel(library.index - 1));
$('next-level').addEventListener('click', () => selectLevel(library.index + 1));
$('chain-push').addEventListener('change', event => changeMap(map.tiles, false, event.target.checked));

function paint(coordinate) {
  const old = map.tiles.get(coordinate) ?? ' ';
  if (brush === 'finish') {
    if (old === '#') {
      $('map-note').textContent = '请在可行走的格子上设置玩家终点。';
      $('map-note').classList.add('error');
      return;
    }
    changeMap(map.tiles, false, level.chainPush, level.portals, map.finish === coordinate ? null : coordinate);
    return;
  }
  if (brush === ' ' && map.finish === coordinate) {
    changeMap(map.tiles, false, level.chainPush, level.portals, null);
    return;
  }
  const wasGoal = '.*+'.includes(old);
  const wasPlayer = '@+'.includes(old);
  let tile = brush;
  if (brush === '.') tile = '$*'.includes(old) ? '*' : wasPlayer ? '+' : '.';
  if (brush === '$') tile = wasGoal ? '*' : '$';
  if (brush === '@') tile = wasGoal ? '+' : '@';
  if (brush === ' ') tile = old === '*' || old === '+' ? '.' : ' ';
  if (tile === old) return;

  const tiles = new Map(map.tiles);
  if (brush === '@' && map.initial.player !== -1) {
    const previous = map.initial.player;
    if (tiles.get(previous) === '+') tiles.set(previous, '.');
    else tiles.delete(previous);
  }
  if (tile === ' ') tiles.delete(coordinate);
  else tiles.set(coordinate, tile);
  const portals = level.portals ?? [];
  const sameHost = portalHost(tile) && portalHost(old) && (tile === '#') === (old === '#');
  const removed = new Set();
  if (!sameHost) portals.forEach((end, i) => { if (end.cell === coordinate) removed.add(Math.floor(i / 2)); });
  const finish = tile === '#' && map.finish === coordinate ? null : map.finish;
  changeMap(tiles, false, level.chainPush, portals.filter((_, i) => !removed.has(Math.floor(i / 2))), finish);
}

function cellAt(element) {
  const cell = element?.closest('.cell');
  return cell && board.contains(cell) ? cell.dataset.cell : null;
}

function choosePortalFace(coordinate, side) {
  if (!portalHost(map.tiles.get(coordinate))) {
    portalMessage = '请选择墙或箱子的边。';
    renderMap();
    return;
  }
  const portals = level.portals ?? [];
  const index = portals.findIndex(end => end.cell === coordinate && end.side === side);
  if (index >= 0 && pendingPortal) {
    portalMessage = '这条边已有传送门，请选择另一条边。';
  } else if (index >= 0) {
    const pair = Math.floor(index / 2);
    openDialog('移除传送门 ' + (pair + 1), '<p>将移除这一对的两个端点。</p>', [
      actionButton('移除整对', 'primary', () => {
        changeMap(map.tiles, false, level.chainPush, portals.filter((_, i) => Math.floor(i / 2) !== pair));
        dialog.close();
      }),
    ]);
    return;
  } else if (!pendingPortal) {
    pendingPortal = { cell: coordinate, side };
    portalMessage = '';
  } else if (pendingPortal.cell === coordinate && pendingPortal.side === side) {
    portalMessage = '两端须选在不同的边上。';
  } else {
    changeMap(map.tiles, false, level.chainPush, [...portals, pendingPortal, { cell: coordinate, side }]);
    portalMessage = '双向传送门 ' + (portals.length / 2 + 1) + ' 已建立。';
  }
  renderMap();
}

function portalClick(event, coordinate) {
  if (!portalHost(map.tiles.get(coordinate))) {
    choosePortalFace(coordinate, 0);
    return;
  }
  if (event.detail) {
    const rect = event.target.closest('.cell').getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const edges = [y, 1 - x, 1 - y, x];
    const side = edges.indexOf(Math.min(...edges));
    if (edges[side] <= 0.34) {
      choosePortalFace(coordinate, side);
      return;
    }
  }
  openDialog('选择传送门所在的边', '<div class="level-list"></div>');
  sideNames.forEach((name, side) => {
    $('dialog-body').firstElementChild.append(actionButton(name, '', () => {
      dialog.close();
      choosePortalFace(coordinate, side);
    }));
  });
}

function pointerPaint(coordinate) {
  if (!coordinate || coordinate === gesture.lastCell) return;
  const previous = gesture.lastCell;
  gesture.lastCell = coordinate;
  if (previous && brush !== '@') {
    const [fromX, fromY] = point(previous);
    const [x, y] = point(coordinate);
    const dx = x - fromX;
    const dy = y - fromY;
    const length = Math.max(Math.abs(dx), Math.abs(dy));
    for (let i = 1; i < length; i++) {
      paint(key(fromX + Math.round(dx * i / length), fromY + Math.round(dy * i / length)));
    }
  }
  paint(coordinate);
}

board.addEventListener('contextmenu', event => event.preventDefault());
board.addEventListener('pointerdown', event => {
  const pan = event.button === 2;
  const coordinate = cellAt(event.target);
  if (gesture || (!pan && (mode !== 'edit' || event.button !== 0 || !coordinate))) return;
  if (!pan && (brush === 'portal' || brush === 'finish')) return;
  event.preventDefault();
  gesture = { id: event.pointerId, pan, x: event.clientX, y: event.clientY, camera, lastCell: null };
  board.setPointerCapture(event.pointerId);
  if (pan) board.classList.add('panning');
  else pointerPaint(coordinate);
});
board.addEventListener('pointermove', event => {
  if (gesture?.id !== event.pointerId) return;
  if (gesture.pan) {
    const size = cellSize();
    camera = {
      x: gesture.camera.x - (event.clientX - gesture.x) / size,
      y: gesture.camera.y - (event.clientY - gesture.y) / size,
    };
    renderBoard(activeState());
  } else if (mode === 'edit') pointerPaint(cellAt(document.elementFromPoint(event.clientX, event.clientY)));
});
board.addEventListener('lostpointercapture', () => {
  gesture = null;
  board.classList.remove('panning');
});
board.addEventListener('click', event => {
  const coordinate = cellAt(event.target);
  if (mode !== 'edit' || !coordinate) return;
  if (brush === 'portal') portalClick(event, coordinate);
  else if (brush === 'finish' || event.detail === 0) paint(coordinate);
});

function activeState() {
  if (mode === 'watch') return watchState ?? map.initial;
  return mode === 'edit' ? map.initial : mode === 'play' ? manual : replayState;
}

new ResizeObserver(() => renderBoard(activeState())).observe(board);
$('center-map').addEventListener('click', () => {
  centerMap();
  if (mode !== 'edit') followPlayer(activeState());
  renderBoard(activeState());
});

document.querySelectorAll('[data-brush]').forEach(button => {
  button.addEventListener('click', () => {
    brush = button.dataset.brush;
    pendingPortal = null;
    portalMessage = '';
    document.querySelectorAll('[data-brush]').forEach(tool => tool.setAttribute('aria-pressed', tool === button));
    renderMap();
  });
});
$('portal-cancel').addEventListener('click', () => {
  pendingPortal = null;
  portalMessage = '';
  renderMap();
});
$('edit-mode').addEventListener('click', () => setMode('edit'));
$('play-mode').addEventListener('click', () => setMode('play'));
$('watch-mode').addEventListener('click', () => setMode('watch'));
$('watch-speed').addEventListener('change', () => { nextWatchAt = 0; });

function move(direction) {
  if (mode !== 'play' || won(map, manual)) return;
  const next = step(map, manual, direction);
  if (next === manual) return;
  undo.push(manual);
  manualPath.push(direction);
  manual = next;
  followPlayer(manual);
  renderMap();
}

document.querySelectorAll('[data-dir]').forEach(button => button.addEventListener('click', () => move(Number(button.dataset.dir))));
document.addEventListener('keydown', event => {
  if (mode !== 'play' || dialog.open || event.altKey || event.ctrlKey || event.metaKey ||
      event.target.closest('input, textarea, select')) return;
  const keys = { arrowup: 0, w: 0, arrowright: 1, d: 1, arrowdown: 2, s: 2, arrowleft: 3, a: 3 };
  const direction = keys[event.key.toLowerCase()];
  if (typeof direction !== 'number') return;
  event.preventDefault();
  move(direction);
});
$('undo').addEventListener('click', () => {
  if (!undo.length) return;
  manual = undo.pop();
  manualPath.pop();
  followPlayer(manual);
  renderMap();
});
function resetPlay() {
  manual = map.initial;
  undo = [];
  manualPath = [];
  followPlayer(manual);
  renderMap();
}

$('reset-play').addEventListener('click', resetPlay);

function getTrainer() {
  if (trainer) return trainer;
  const field = trainingMap(map.tiles, area, level.chainPush, level.portals, map.finish);
  if (field) return new Trainer(field);
  trainingProblem = '摆放范围超过 40,000 格训练区。请缩小关卡范围后再试。';
  return null;
}

function updateDemonstration(path) {
  const model = getTrainer();
  if (!model || !model.setDemonstration(path)) return false;
  if (trainer) {
    attempt = null;
    watchState = null;
    watchSegment = null;
    watchResult = null;
  }
  level.demonstration = path.slice();
  recording = false;
  saveLevels();
  renderMap();
  renderTraining();
  return true;
}

$('record-demo').addEventListener('click', () => {
  pauseTraining();
  resetPlay();
  recording = true;
  setMode('play');
  const view = board.getBoundingClientRect();
  if (view.top < 0 || view.top >= window.innerHeight) board.scrollIntoView({ block: 'center' });
});
$('cancel-demo').addEventListener('click', () => {
  recording = false;
  renderMap();
  renderTraining();
});
$('save-demo').addEventListener('click', () => {
  if (!recording || !manualPath.length) return;
  if (!updateDemonstration(manualPath)) {
    $('map-note').textContent = trainingProblem || '示范走出了 AI 的训练区。请撤销超出地图外围三格的步数。';
    $('map-note').classList.add('error');
  }
});
$('delete-demo').addEventListener('click', () => {
  pauseTraining();
  updateDemonstration([]);
});

function drawChart() {
  const canvas = $('chart');
  const scale = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.scale(scale, scale);
  const history = trainer?.history ?? [];
  const start = history[0]?.episode > 1 ? history[0].episode : 0;
  const end = trainer?.episodes ?? 0;
  $('chart-empty').hidden = history.length > 0;
  $('chart-start').textContent = number.format(start);
  $('chart-end').textContent = end ? number.format(end) + ' 回合' : '回合';
  canvas.setAttribute('aria-label', history.length ? '训练至第 ' + end + ' 回合，近期独立胜率 ' + Math.round(trainer.rate * 100) + '%' : '独立训练胜率曲线');
  if (!history.length) return;

  const points = history.map(point => [
    2 + (width - 4) * (point.episode - start) / Math.max(1, end - start),
    2 + (height - 4) * (1 - point.rate),
  ]);
  context.beginPath();
  points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.lineTo(points.at(-1)[0], height);
  context.lineTo(points[0][0], height);
  context.closePath();
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#b8f27b42');
  gradient.addColorStop(1, '#b8f27b03');
  context.fillStyle = gradient;
  context.fill();
  context.beginPath();
  points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.strokeStyle = '#b8f27b';
  context.lineWidth = 2;
  context.lineJoin = 'round';
  context.stroke();
  context.beginPath();
  context.arc(...points.at(-1), 2.5, 0, Math.PI * 2);
  context.fillStyle = '#b8f27b';
  context.fill();
}

function renderTraining() {
  const episodes = trainer?.episodes ?? 0;
  const best = trainer?.best;
  const problem = validate(map) || trainingProblem;
  const paused = !running && target > episodes;
  const status = running ? '训练中' : paused ? '已暂停' : episodes ? '批次完成' : '待训练';
  const pill = $('train-status');
  if (pill.lastElementChild.textContent !== status) pill.lastElementChild.textContent = status;
  pill.classList.toggle('active', running || Boolean(best));
  $('episodes').textContent = number.format(episodes);
  $('rate').textContent = trainer?.recent.length ? Math.round(trainer.rate * 100) + '%' : '—';
  $('best').textContent = best ? number.format(best.pushes) : '—';
  $('train').disabled = Boolean(problem) || playback !== 0 || recording;
  const action = running ? '暂停训练' : paused ? '继续训练' : episodes ? '再训练一批' : '开始训练';
  $('train').lastElementChild.textContent = action;
  $('watch-run').textContent = action;
  $('watch-run').disabled = $('train').disabled;
  $('train').firstElementChild.textContent = running ? 'Ⅱ' : '▶';
  $('budget').disabled = running || paused;
  $('clear-training').disabled = !trainer || playback !== 0 || recording;
  $('replay').disabled = !best || running || playback !== 0 || recording;
  renderPartialRoutes(best);
  const demoLength = level.demonstration?.length ?? 0;
  $('demo-summary').textContent = demoLength ? '已保存 ' + demoLength + ' 步 · 每两回合使用一次' : '演示几步，帮 AI 练习下一步。';
  $('record-demo').textContent = demoLength ? '重录示范' : '示范几步';
  $('record-demo').disabled = Boolean(problem) || recording || playback !== 0;
  $('delete-demo').hidden = !demoLength;
  $('delete-demo').disabled = recording || playback !== 0;

  let note = '训练当前关卡，找到通关路线后即可回放。';
  if (problem) note = problem;
  else if (running || paused) note = '本批目标为第 ' + number.format(target) + ' 回合，切换关卡时会暂停。';
  else if (best) note = '已通关 ' + number.format(trainer.successes) + ' 局 · 最佳路线移动 ' + best.path.length + ' 步';
  else if (episodes) note = '尚未通关，可以查看目前覆盖最多的路线。';
  $('training-note').textContent = note;
  drawChart();
}

function renderPartialRoutes(best) {
  const partial = best ? null : trainer?.partial;
  const routes = partial?.routes ?? null;
  const count = routes?.size ?? 0;
  $('partial-controls').hidden = !count;
  if (!count) {
    listedRoutes = null;
    listedCount = 0;
    $('partial-route').replaceChildren();
    return;
  }
  if (routes !== listedRoutes || count !== listedCount) {
    const select = $('partial-route');
    if (routes !== listedRoutes) select.replaceChildren();
    const options = [];
    for (let i = select.length; i < count; i++) options.push(new Option('路线 ' + number.format(i + 1), i));
    select.append(...options);
    listedRoutes = routes;
    listedCount = count;
  }
  const summary = '覆盖 ' + partial.covered + ' / ' + map.goals.size + ' 个目标 · ' +
    number.format(partial.moves) + ' 步 · ' + number.format(count) + ' 条并列路线';
  if ($('partial-summary').textContent !== summary) $('partial-summary').textContent = summary;
  $('play-partial').disabled = running || playback !== 0 || recording;
  $('play-sequence').disabled = $('play-partial').disabled || count < 2;
}

function toWorldState(state) {
  const coordinate = trainer.map.worldCell;
  return { ...state, player: coordinate(state.player), boxes: state.boxes.map(coordinate), portalCells: state.portalCells.map(coordinate) };
}

function syncWatchState() {
  watchState = toWorldState(trainer.state);
  watchResult = attempt ? null : won(trainer.map, trainer.state);
}

function trainFast() {
  watchSegment = null;
  const deadline = performance.now() + 9;
  do {
    attempt ??= trainer.attempt();
    if (attempt.next().done) attempt = null;
  } while (trainer.episodes < target && performance.now() < deadline);
  watchState = null;
  if (mode === 'watch') syncWatchState();
}

function trainVisible(now, delay) {
  if (now < nextWatchAt) return false;
  nextWatchAt = now + delay;
  if (watchSegment) {
    watchState = step(map, watchState, watchSegment.directions[watchSegment.index++]);
    if (watchSegment.index === watchSegment.directions.length) watchSegment = null;
    return true;
  }
  if (!attempt) {
    attempt = trainer.attempt();
    watchState = map.initial;
    watchResult = null;
  }
  const event = attempt.next();
  if (event.done) {
    attempt = null;
    syncWatchState();
    nextWatchAt = now + Math.max(400, delay);
  } else {
    watchState = toWorldState(event.value.from);
    watchSegment = { directions: event.value.directions, index: 0, demonstration: event.value.demonstration };
  }
  return true;
}

function trainFrame(now) {
  if (!running) return;
  const delay = mode === 'watch' ? Number($('watch-speed').value) : 0;
  const advanced = delay ? trainVisible(now, delay) : (trainFast(), true);
  if (trainer.episodes >= target) running = false;
  if (advanced) {
    if (mode === 'watch') {
      if (!gesture?.pan) followPlayer(watchState);
      renderMap();
    }
    renderTraining();
  }
  if (running) frame = requestAnimationFrame(trainFrame);
}

function toggleTraining() {
  if (running) pauseTraining();
  else {
    if (validate(map) || recording) return;
    if (mode === 'replay') setMode('edit');
    if (!trainer) {
      trainer = getTrainer();
      if (!trainer) {
        renderMap();
        renderTraining();
        return;
      }
      trainer.setDemonstration(level.demonstration ?? []);
    }
    if (trainer.episodes >= target) target = trainer.episodes + Number($('budget').value);
    running = true;
    setMode('watch');
    const view = board.getBoundingClientRect();
    if (view.top < 0 || view.top >= window.innerHeight) board.scrollIntoView({ block: 'center' });
    frame = requestAnimationFrame(trainFrame);
  }
  if (mode === 'watch') renderMap();
  renderTraining();
}

$('train').addEventListener('click', toggleTraining);
$('watch-run').addEventListener('click', toggleTraining);
$('clear-training').addEventListener('click', () => {
  pauseTraining();
  sessions.delete(level);
  trainer = null;
  attempt = null;
  target = 0;
  watchState = null;
  watchSegment = null;
  watchResult = null;
  if (mode === 'replay') setMode('edit');
  else {
    renderMap();
    renderTraining();
  }
});
$('replay').addEventListener('click', () => {
  if (trainer?.best) replayRoutes([trainer.best]);
});
$('play-partial').addEventListener('click', () => {
  const route = Array.from(trainer?.partial.routes.values() ?? [])[$('partial-route').selectedIndex];
  if (route) replayRoutes([route], $('partial-route').selectedIndex + 1);
});
$('play-sequence').addEventListener('click', () => {
  if (trainer?.partial.routes.size) replayRoutes([...trainer.partial.routes.values()], 1);
});
$('stop-replay').addEventListener('click', () => {
  clearTimeout(playback);
  playback = 0;
  replayMessage = '已停止回放';
  renderMap();
  renderTraining();
});

function replayRoutes(routes, firstNumber = 0) {
  if (running || playback || recording) return;
  mode = 'replay';
  let routeIndex = 0;
  let index = 0;

  function startRoute() {
    replayState = map.initial;
    index = 0;
    followPlayer(replayState);
    tick();
  }

  function tick() {
    const { path } = routes[routeIndex];
    const title = firstNumber ? '路线 ' + number.format(firstNumber + routeIndex) : 'AI 回放';
    if (index === path.length) {
      replayMessage = won(map, replayState) ? 'AI 通关 · 移动 ' + index + ' 步 · 推箱 ' + replayState.pushes + ' 次' :
        title + ' · ' + index + ' 步 · 覆盖 ' + placed(map, replayState) + ' / ' + map.goals.size + ' 个目标';
      playback = routeIndex + 1 < routes.length ? setTimeout(() => {
        routeIndex++;
        startRoute();
      }, 650) : 0;
      renderMap();
      renderTraining();
      return;
    }
    replayMessage = title + ' · ' + index + ' / ' + path.length + ' 步';
    playback = setTimeout(() => {
      replayState = step(map, replayState, path[index]);
      if (!gesture?.pan) followPlayer(replayState);
      index++;
      tick();
    }, 115);
    renderMap();
  }

  startRoute();
  renderTraining();
  const view = board.getBoundingClientRect();
  if (view.top < 0 || view.top >= window.innerHeight) board.scrollIntoView({ block: 'center' });
}
new ResizeObserver(drawChart).observe($('chart'));

function actionButton(label, kind, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = kind;
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function openDialog(title, content, actions = []) {
  $('dialog-title').textContent = title;
  $('dialog-body').innerHTML = content;
  $('dialog-error').hidden = true;
  $('dialog-actions').replaceChildren(...actions);
  if (!dialog.open) dialog.showModal();
}

function dialogError(message) {
  $('dialog-error').textContent = message;
  $('dialog-error').hidden = false;
}

$('help').addEventListener('click', () => {
  openDialog('使用说明', '<p>地图从空白开始，按住鼠标右键拖动可向四周平移。选好工具后，用左键点击或拖动绘制。</p>' +
    '<p>放置玩家起点和箱子目标，箱子数可以多于目标数。选「玩家终点」放置一面旗，再点旗子可移除。有旗时，玩家也要走到旗子处才能通关。只放旗子也可以做走位关卡。</p>' +
    '<p>点「手动试玩」，用方向键、WASD 或屏幕方向按钮移动。勾选「允许连推多个箱子」后，玩家和 AI 都能一步推动相邻的一整排箱子，计作一次推箱。</p>' +
    '<p>用「传送门」依次点选墙或箱子的两条边。同编号的两端双向相通。出口和另一个入口正对紧贴时，会继续通过下一对门。开启连推时，整排箱子先一起前进，最前面的箱子碰墙后才触发门箱传送。依次尝试后箱、前箱和玩家，没门或传不通就试下一项。前箱传走的同一步，门箱和它后面被推动的箱子会向前补一格。关闭连推时，门箱沿门面推到前箱就先传走前箱。没有可执行的推箱动作时，玩家可以从碰到的门面进入，即使门箱背后紧贴的是普通箱子。若最终出口有箱子并且推得动，玩家会在同一步穿门走到让出的格子。</p>' +
    '<p>开始训练后，左侧地图会显示 AI 的每一步。可在「观战 AI」中调速度或暂停。切换到编辑或试玩时，AI 会继续加速训练。</p>' +
    '<p>点「示范几步」，从起点演示走位或推箱，再点「保存示范」。AI 每两回合会跟随示范一次，然后自行继续。胜率只统计独立尝试。</p>' +
    '<p>AI 用 Q-learning 反复练习。训练区包含已绘制的地图和外围三格空地，最多 40,000 格。找到通关路线后即可回放。</p>' +
    '<p>用关卡列表逐关训练。切换时会暂停当前训练，切回即可继续。示范、地图和规则保存在浏览器。修改地图或规则会清空当前关的示范和训练进度。</p>',
  [actionButton('知道了', 'primary', () => dialog.close())]);
});

$('levels').addEventListener('click', () => {
  const entries = [
    { name: '单箱入门', tiles: fromRows(examples[1]), chainPush: false },
    { name: '双箱练习', tiles: fromRows(examples[0]), chainPush: false },
    { name: '三箱挑战', tiles: fromRows(examples[2]), chainPush: false },
    { name: '连推练习', tiles: fromRows(['#########', '#@$$..  #', '#########']), chainPush: true },
  ];
  openDialog('添加示例关卡', '<div class="level-list"></div>', [actionButton('按顺序添加全部', 'primary', () => {
    addLevels(entries);
    dialog.close();
  })]);
  entries.forEach(entry => {
    $('dialog-body').firstElementChild.append(actionButton(entry.name, '', () => {
      addLevels([entry]);
      dialog.close();
    }));
  });
});

$('new-map').addEventListener('click', () => {
  openDialog('新建关卡', '<label class="level-name">关卡名称 <input id="level-name" maxlength="40"></label>', [actionButton('创建空白关卡', 'primary', () => {
    const name = $('level-name').value.trim() || '自制关卡 ' + (library.entries.length + 1);
    addLevels([blankLevel(name)]);
    dialog.close();
  })]);
});

function confirmSaveChange(deleting) {
  const verb = deleting ? '删除' : '清空';
  openDialog(verb + '存档', '<p id="save-confirm"></p>', [
    actionButton('返回', 'outline plain', manageSave),
    actionButton('确认' + verb, 'primary danger', () => {
      if (deleting) deleteLevel();
      else changeMap(new Map(), true, false, [], null);
      dialog.close();
    }),
  ]);
  $('save-confirm').textContent = deleting ? '删除「' + level.name + '」及其地图、示范和训练进度？' :
    '将「' + level.name + '」恢复成空白地图？名称会保留，规则、示范和训练进度会重置。';
}

function manageSave() {
  const saveName = actionButton('保存名称', 'primary', () => {
    const name = $('level-name').value.trim();
    if (!name) return dialogError('请输入关卡名称。');
    level.name = name;
    saveLevels();
    renderLevelPicker();
    dialog.close();
  });
  openDialog('管理存档', '<label class="level-name">关卡名称 <input id="level-name" maxlength="40"></label>' +
    '<div class="save-actions"></div>', [saveName]);
  const input = $('level-name');
  input.value = level.name;
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    saveName.click();
  });
  $('dialog-body').querySelector('.save-actions').append(
    actionButton('清空为白图', 'outline', () => confirmSaveChange(false)),
    actionButton('删除存档', 'outline', () => confirmSaveChange(true)),
  );
  input.focus();
}

$('manage-level').addEventListener('click', manageSave);

$('map-code').addEventListener('click', () => {
  openDialog('导入 / 导出地图', '<p>支持坐标 JSON 和旧版字符地图。</p><p id="symbols"># 墙 · 空格 地板 · . 目标 · $ 箱子 · @ 玩家 · * 目标上的箱子 · + 目标上的玩家</p>' +
    '<textarea id="map-text" aria-label="地图文本" aria-describedby="symbols" spellcheck="false" wrap="off"></textarea>',
  [
    actionButton('下载当前地图', 'outline plain', () => {
      const url = URL.createObjectURL(new Blob([writeWorld(map.tiles, level.chainPush, level.portals, map.finish) + '\n'], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'sokoban-map.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }),
    actionButton('导入文本', 'primary', () => {
      try {
        const imported = readLevel($('map-text').value);
        changeMap(imported.tiles, true, imported.chainPush, imported.portals ?? [], imported.finish ?? null);
        dialog.close();
      } catch (error) {
        dialogError(error.message);
      }
    }),
  ]);
  $('map-text').value = writeWorld(map.tiles, level.chainPush, level.portals, map.finish);
});

renderLevelPicker();
$('chain-push').checked = level.chainPush;
centerMap();
renderMap();
renderTraining();

