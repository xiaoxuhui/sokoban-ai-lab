'use strict';

const { examples, readMap, compile, validate, placed, won, step, Trainer } = Sokoban;
const $ = id => document.getElementById(id);
const board = $('board');
const dialog = $('dialog');
const storageKey = 'sokoban-lab-map-v1';
const number = new Intl.NumberFormat('zh-CN');

function loadRows() {
  try {
    return readMap(localStorage.getItem(storageKey) ?? examples[0].join('\n'));
  } catch {
    return [...examples[0]];
  }
}

let rows = loadRows();
let map = compile(rows);
let brush = '#';
let mode = 'edit';
let manual = map.initial;
let undo = [];
let trainer = null;
let running = false;
let target = 0;
let frame = 0;
let playback = 0;
let replayState = null;
let replayMessage = '';
let pointer = null;
let lastCell = -1;
let cells = [];

const tileName = { '#': '墙', ' ': '地板', '.': '目标', '$': '箱子', '@': '玩家', '*': '目标上的箱子', '+': '目标上的玩家' };

function buildBoard() {
  board.style.setProperty('--cols', map.width);
  board.style.setProperty('--board-width', Math.min(480, map.width * 46, 370 * map.width / rows.length) + 'px');
  cells = Array.from(map.tiles, (_, index) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    cell.dataset.index = index;
    return cell;
  });
  board.replaceChildren(...cells);
}

function renderBoard(state) {
  const boxes = new Set(state.boxes);
  const editable = mode === 'edit';
  board.classList.toggle('editable', editable);
  cells.forEach((cell, index) => {
    const goal = map.goals.has(index);
    const tile = map.tiles[index] === '#' ? '#' :
      boxes.has(index) ? (goal ? '*' : '$') :
      state.player === index ? (goal ? '+' : '@') : (goal ? '.' : ' ');
    if (cell.dataset.tile !== tile) {
      cell.dataset.tile = tile;
      cell.classList.toggle('wall', tile === '#');
      cell.replaceChildren();
      if (goal) cell.append(makeTile('goal'));
      if ('$*'.includes(tile)) cell.append(makeTile(tile === '*' ? 'crate placed' : 'crate'));
      if ('@+'.includes(tile)) cell.append(makeTile('player'));
      const row = Math.floor(index / map.width) + 1;
      const col = index % map.width + 1;
      cell.setAttribute('aria-label', '第 ' + row + ' 行第 ' + col + ' 列，' + tileName[tile]);
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
  const state = editing ? map.initial : playing ? manual : replayState;
  $('edit-mode').setAttribute('aria-pressed', editing);
  $('play-mode').setAttribute('aria-pressed', playing);
  $('edit-tools').hidden = !editing;
  $('play-tools').hidden = !playing;
  $('map-actions').hidden = !editing;
  $('dpad').hidden = !playing;
  $('undo').disabled = !undo.length;
  $('reset-play').disabled = !manual.moves;
  $('map-info').textContent = map.width + ' × ' + rows.length + ' 格 · ' + map.initial.boxes.length + ' 个箱子 · ' + map.goals.size + ' 个目标';
  $('move-count').textContent = '移动 ' + manual.moves + ' 步 · 推箱 ' + manual.pushes + ' 次';
  const problem = editing ? validate(map) : '';
  const solved = !editing && won(map, state);
  $('map-note').className = 'map-note' + (problem ? ' error' : solved ? ' success' : '');
  $('map-note').textContent = editing ? (problem || '选中工具，点击或拖动绘制') :
    playing ? (solved ? '通关！' : '已就位 ' + placed(map, state) + ' / ' + map.goals.size) : replayMessage;
  renderBoard(state);
}

function setMode(next) {
  if (next === 'play' && validate(map)) {
    $('map-note').textContent = validate(map);
    return;
  }
  clearTimeout(playback);
  playback = 0;
  mode = next;
  renderMap();
  renderTraining();
}

function pauseTraining() {
  running = false;
  cancelAnimationFrame(frame);
}

function changeMap(nextRows) {
  if (rows.join('\n') === nextRows.join('\n')) return;
  pauseTraining();
  clearTimeout(playback);
  playback = 0;
  trainer = null;
  target = 0;
  const dimensionsChanged = nextRows.length !== rows.length || nextRows[0].length !== map.width;
  rows = nextRows;
  map = compile(rows);
  manual = map.initial;
  undo = [];
  mode = 'edit';
  try { localStorage.setItem(storageKey, rows.join('\n')); } catch { /* Storage is optional. */ }
  if (dimensionsChanged) buildBoard();
  renderMap();
  renderTraining();
}

function paint(index) {
  const tiles = Array.from(map.tiles);
  const old = tiles[index];
  const wasGoal = '.*+'.includes(old);
  const wasPlayer = '@+'.includes(old);
  if (brush === '.' && old !== '#') tiles[index] = '$*'.includes(old) ? '*' : wasPlayer ? '+' : '.';
  else if (brush === '$') tiles[index] = wasGoal ? '*' : '$';
  else if (brush === '@') {
    if (!wasPlayer && map.initial.player >= 0) {
      const previous = map.initial.player;
      tiles[previous] = tiles[previous] === '+' ? '.' : ' ';
    }
    tiles[index] = wasGoal ? '+' : '@';
  } else if (brush === ' ') {
    tiles[index] = old === '*' || old === '+' ? '.' : ' ';
  } else tiles[index] = brush;

  const nextRows = rows.map((_, y) => tiles.slice(y * map.width, (y + 1) * map.width).join(''));
  changeMap(nextRows);
}

function cellAt(element) {
  const cell = element?.closest('.cell');
  return cell && board.contains(cell) ? Number(cell.dataset.index) : -1;
}

function pointerPaint(index) {
  if (index < 0 || index === lastCell) return;
  lastCell = index;
  paint(index);
}

board.addEventListener('pointerdown', event => {
  if (mode !== 'edit' || pointer !== null || event.button !== 0 || cellAt(event.target) < 0) return;
  pointer = event.pointerId;
  lastCell = -1;
  board.setPointerCapture(pointer);
  pointerPaint(cellAt(event.target));
});
board.addEventListener('pointermove', event => {
  if (pointer === event.pointerId && mode === 'edit') pointerPaint(cellAt(document.elementFromPoint(event.clientX, event.clientY)));
});
board.addEventListener('lostpointercapture', () => { pointer = null; });
board.addEventListener('click', event => {
  if (mode === 'edit' && event.detail === 0 && cellAt(event.target) >= 0) paint(cellAt(event.target));
});

document.querySelectorAll('[data-brush]').forEach(button => {
  button.addEventListener('click', () => {
    brush = button.dataset.brush;
    document.querySelectorAll('[data-brush]').forEach(tool => tool.setAttribute('aria-pressed', tool === button));
  });
});
$('edit-mode').addEventListener('click', () => setMode('edit'));
$('play-mode').addEventListener('click', () => setMode('play'));

function move(direction) {
  if (mode !== 'play' || won(map, manual)) return;
  const next = step(map, manual, direction);
  if (next === manual) return;
  undo.push(manual);
  manual = next;
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
  renderMap();
});
$('reset-play').addEventListener('click', () => {
  manual = map.initial;
  undo = [];
  renderMap();
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
  canvas.setAttribute('aria-label', end ? '训练至第 ' + end + ' 回合，近期胜率 ' + Math.round(trainer.rate * 100) + '%' : '训练胜率曲线');
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
  const problem = validate(map);
  const paused = !running && target > episodes;
  const status = running ? '训练中' : paused ? '已暂停' : episodes ? '批次完成' : '待训练';
  const pill = $('train-status');
  if (pill.lastElementChild.textContent !== status) pill.lastElementChild.textContent = status;
  pill.classList.toggle('active', running || Boolean(best));
  $('episodes').textContent = number.format(episodes);
  $('rate').textContent = episodes ? Math.round(trainer.rate * 100) + '%' : '—';
  $('best').textContent = best ? number.format(best.pushes) : '—';
  $('train').disabled = Boolean(problem) || playback !== 0;
  $('train').lastElementChild.textContent = running ? '暂停训练' : paused ? '继续训练' : episodes ? '再训练一批' : '开始训练';
  $('train').firstElementChild.textContent = running ? 'Ⅱ' : '▶';
  $('budget').disabled = running || paused;
  $('clear-training').disabled = !trainer || playback !== 0;
  $('replay').disabled = !best || running || playback !== 0;

  let note = '训练完成后，可以回放 AI 找到的最佳路线。';
  if (problem) note = problem;
  else if (running || paused) note = '本批目标为第 ' + number.format(target) + ' 回合，地图修改后会重新训练。';
  else if (best) note = '已通关 ' + number.format(trainer.successes) + ' 局 · 最佳路线移动 ' + best.path.length + ' 步';
  else if (episodes) note = '本轮尚未找到通关路线。可以继续训练，或用手动试玩检查地图。';
  $('training-note').textContent = note;
  drawChart();
}

function trainFrame() {
  if (!running) return;
  const deadline = performance.now() + 9;
  do {
    trainer.episode();
  } while (trainer.episodes < target && performance.now() < deadline);
  if (trainer.episodes >= target) running = false;
  renderTraining();
  if (running) frame = requestAnimationFrame(trainFrame);
}

$('train').addEventListener('click', () => {
  if (running) pauseTraining();
  else {
    if (validate(map)) return;
    if (mode === 'replay') setMode('edit');
    trainer ??= new Trainer(map);
    if (trainer.episodes >= target) target = trainer.episodes + Number($('budget').value);
    running = true;
    frame = requestAnimationFrame(trainFrame);
  }
  renderTraining();
});
$('clear-training').addEventListener('click', () => {
  pauseTraining();
  trainer = null;
  target = 0;
  if (mode === 'replay') setMode('edit');
  else renderTraining();
});
$('replay').addEventListener('click', () => {
  if (!trainer?.best || running || playback) return;
  const path = trainer.best.path;
  let index = 0;
  mode = 'replay';
  replayState = map.initial;

  function tick() {
    replayMessage = 'AI 回放 · ' + index + ' / ' + path.length + ' 步';
    if (index === path.length) {
      replayMessage = 'AI 通关 · 移动 ' + index + ' 步 · 推箱 ' + replayState.pushes + ' 次';
      playback = 0;
      renderMap();
      renderTraining();
      return;
    }
    renderMap();
    playback = setTimeout(() => {
      replayState = step(map, replayState, path[index]);
      index++;
      tick();
    }, 115);
  }

  tick();
  renderTraining();
});
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
  dialog.showModal();
}

function dialogError(message) {
  $('dialog-error').textContent = message;
  $('dialog-error').hidden = false;
}

$('help').addEventListener('click', () => {
  openDialog('使用说明', '<p>在工作台上选择工具，再点击或拖动绘制。放置一个玩家，并为每个箱子放置一个目标。</p>' +
    '<p>点「手动试玩」，用方向键、WASD 或屏幕方向按钮移动。每次只能推动一个箱子。</p>' +
    '<p>点「开始训练」。AI 从原始摆放反复尝试，用 Q-learning 更新每种局面的推箱选择。通关后可回放本次训练找到的最佳路线。</p>' +
    '<p>地图会保存在当前浏览器。修改地图会清空这张地图的训练进度。</p>',
  [actionButton('知道了', 'primary', () => dialog.close())]);
});

$('levels').addEventListener('click', () => {
  openDialog('选择示例地图', '<div class="level-list"></div>');
  ['双箱练习 · 10 × 8', '单箱入门 · 8 × 6', '三箱挑战 · 11 × 9'].forEach((title, i) => {
    $('dialog-body').firstElementChild.append(actionButton(title, '', () => {
      changeMap([...examples[i]]);
      dialog.close();
    }));
  });
});

$('new-map').addEventListener('click', () => {
  openDialog('新建地图', '<div class="map-dimensions"><label>宽 <input id="new-width" type="number" min="5" max="16" value="10" required></label>' +
    '<label>高 <input id="new-height" type="number" min="5" max="16" value="8" required></label></div><p>新地图会预置一圈墙，替换当前地图。</p>',
  [actionButton('创建', 'primary', () => {
    const width = $('new-width').valueAsNumber;
    const height = $('new-height').valueAsNumber;
    if (!$('new-width').checkValidity() || !$('new-height').checkValidity()) {
      dialogError('宽和高都必须是 5 至 16 的整数。');
      return;
    }
    const border = '#'.repeat(width);
    const floor = '#' + ' '.repeat(width - 2) + '#';
    changeMap(Array.from({ length: height }, (_, i) => i === 0 || i === height - 1 ? border : floor));
    dialog.close();
  })]);
});

$('map-code').addEventListener('click', () => {
  openDialog('导入 / 导出地图', '<p id="symbols"># 墙 · 空格 地板 · . 目标 · $ 箱子 · @ 玩家 · * 目标上的箱子 · + 目标上的玩家</p>' +
    '<textarea id="map-text" aria-label="地图文本" aria-describedby="symbols" spellcheck="false" wrap="off"></textarea>',
  [
    actionButton('下载当前地图', 'outline plain', () => {
      const url = URL.createObjectURL(new Blob([rows.join('\n') + '\n'], { type: 'text/plain' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'sokoban-map.txt';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }),
    actionButton('导入文本', 'primary', () => {
      try {
        changeMap(readMap($('map-text').value));
        dialog.close();
      } catch (error) {
        dialogError(error.message);
      }
    }),
  ]);
  $('map-text').value = rows.join('\n');
});

buildBoard();
renderMap();
renderTraining();

