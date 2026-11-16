'use strict';

const { compile, placed, step, won } = BoxRooms;
const opening = [
  {
    title: '箱子与玩家终点', hint: '先把箱子推到方框，再走到带两点的玩家终点。',
    rows: ['#######', '#     #', '#     #', '#    $#', '# @ # #', '#   #.#', '#######'],
    finish: [1, 1],
  },
  {
    title: '双箱连推', hint: '排成一列的箱子可以一起推。把它们分到两边，再走到中间的玩家终点。',
    rows: ['#######', '#   ###', '# #$  #', '# #$  #', '#     #', '#  @  #', '#.   .#', '#######'],
    finish: [3, 6],
  },
  {
    title: '绕到箱子后面', hint: '先把箱子推离右边的墙，再利用底部空间绕到另一侧。',
    rows: ['#########', '#    ####', '#  .$####', '#    ####', '# @  ####', '#       #', '#  ##   #', '#########'],
    finish: [2, 2],
  },
];
const chapters = [
  { title: '入门', start: 0, levels: [...opening, ...BoxCampaign.intro] },
  { title: '进入', start: opening.length + BoxCampaign.intro.length, levels: BoxCampaign.enter },
];
const levels = chapters.flatMap(chapter => chapter.levels);

const $ = id => document.getElementById(id);
const board = $('intro-board');
const inspector = $('intro-inspector');
const previewBoard = $('intro-preview-board');
let levelButtons = [];
let chapterIndex = -1;
const storageKey = 'sokoban-lab-box-intro-v1';
const layoutRevision = 2;
const moveKeys = { arrowup: 0, w: 0, arrowright: 1, d: 1, arrowdown: 2, s: 2, arrowleft: 3, a: 3 };
let active = 0;
let complete = [];
let map;
let state;
let history = [];
let future = [];

try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (Number.isInteger(saved?.active) && levels[saved.active]) active = saved.active;
  if (saved?.revision === layoutRevision && Array.isArray(saved.complete)) complete = saved.complete.slice(0, levels.length);
} catch { /* Progress is optional when storage is unavailable. */ }

function saveProgress() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ revision: layoutRevision, active, complete }));
  } catch { /* The current session can still be played. */ }
}

function render() {
  const [roomId, x, y] = state.positions[0];
  const covered = placed(map, state);
  const solved = won(map, state, covered);
  renderRoom(board, roomId);
  let depth = 0;
  for (let room = roomId; map.rooms[room].owner >= 0; room = state.positions[map.rooms[room].owner][0]) depth++;
  $('intro-room').hidden = map.rooms.length === 1;
  $('intro-room').textContent = depth ? '箱内第 ' + depth + ' 层' : '外层';
  board.setAttribute('aria-label', '棋盘，玩家第 ' + (x + 1) + ' 列，第 ' + (y + 1) + ' 行');
  $('intro-count').textContent = state.moves + ' 步 · 推箱 ' + state.pushes + ' 次';
  $('intro-status').textContent = solved ? '通关！' : covered === map.goals.length ?
    '箱子都到位了，走到玩家终点即可通关。' : '箱子到位 ' + covered + ' / ' + map.goals.length;
  $('intro-status').classList.toggle('success', solved);
  $('intro-next').hidden = !solved || active === levels.length - 1;
  $('intro-next').textContent = active + 1 === chapters[1].start ? '进入下一章 →' : '下一关 →';
  $('intro-undo').disabled = history.length === 0;
  $('intro-redo').disabled = future.length === 0;
  $('intro-reset').disabled = state === map.initial;
  for (const [number, button] of levelButtons.entries()) {
    const index = Number(button.dataset.level);
    button.setAttribute('aria-pressed', index === active);
    button.dataset.complete = Boolean(complete[index]);
    button.setAttribute('aria-label', '第 ' + (number + 1) + ' 关' + (complete[index] ? '，已通关' : ''));
  }
}

function addPiece(cell, name) {
  const piece = document.createElement('i');
  piece.className = name;
  cell.append(piece);
}

function roomColor(roomId) {
  return map.rooms[roomId].color ?? (roomId === 0 ? (chapterIndex === 1 ? '#a4bedf' : '#cbcbce') : '#79aedc');
}

function drawMiniature(canvas, roomId) {
  const room = map.rooms[roomId];
  const size = 10;
  canvas.width = room.width * size;
  canvas.height = room.height * size;
  const context = canvas.getContext('2d');
  context.fillStyle = '#303342';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = roomColor(roomId);
  for (let i = 0; i < room.tiles.length; i++) {
    if (room.tiles[i] === '#') context.fillRect(i % room.width * size, Math.floor(i / room.width) * size, size, size);
  }
  context.strokeStyle = '#f5e4bb';
  for (const [id, x, y] of [...map.goals, map.finish]) {
    if (id === roomId) context.strokeRect(x * size + 2, y * size + 2, size - 4, size - 4);
  }
  for (const [index, [id, x, y]] of state.positions.entries()) {
    if (id !== roomId) continue;
    const child = map.inside[index];
    context.fillStyle = index === 0 ? '#df328d' : child >= 0 ? roomColor(child) : chapterIndex === 1 ? '#38bce8' : '#ffb63a';
    context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  }
}

function renderRoom(container, roomId) {
  const room = map.rooms[roomId];
  if (container.dataset.room !== String(roomId) || !container.children.length) {
    container.dataset.room = roomId;
    container.style.setProperty('--columns', room.width);
    container.style.setProperty('--longest-side', Math.max(room.width, room.height));
    container.style.setProperty('--room-color', roomColor(roomId));
    container.replaceChildren(...Array.from(room.tiles, tile => {
      const cell = document.createElement('div');
      cell.className = tile === '#' ? 'cell wall' : 'cell';
      return cell;
    }));
  }
  const goalCells = new Set(map.goals.filter(([id]) => id === roomId).map(([, x, y]) => y * room.width + x));
  const finishCell = map.finish[0] === roomId ? map.finish[2] * room.width + map.finish[1] : -1;
  const occupied = new Map();
  state.positions.forEach(([id, x, y], entity) => { if (id === roomId) occupied.set(y * room.width + x, entity); });
  for (const [index, cell] of Array.from(container.children).entries()) {
    if (room.tiles[index] === '#') continue;
    const entity = occupied.get(index);
    const child = entity === undefined ? -1 : map.inside[entity];
    const crate = entity > 0;
    const goal = goalCells.has(index);
    const signature = (entity ?? '') + ':' + Number(goal) + ':' + Number(index === finishCell);
    if (cell.dataset.tile !== signature) {
      cell.dataset.tile = signature;
      cell.replaceChildren();
      if (goal && !crate) addPiece(cell, 'goal');
      if (index === finishCell && !crate) addPiece(cell, 'intro-player-goal');
      if (entity === 0) addPiece(cell, 'player');
      else if (child >= 0) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = goal ? 'room-box room-on-goal' : 'room-box';
        button.style.setProperty('--box-color', roomColor(child));
        button.setAttribute('aria-label', '查看第 ' + (index % room.width + 1) + ' 列第 ' + (Math.floor(index / room.width) + 1) + ' 行的箱内房间');
        button.append(document.createElement('canvas'));
        button.addEventListener('click', () => {
          renderRoom(previewBoard, child);
          if (!inspector.open) inspector.showModal();
        });
        cell.append(button);
      } else if (crate) addPiece(cell, goal ? 'crate placed' : 'crate');
    }
    if (child >= 0) drawMiniature(cell.querySelector('canvas'), child);
  }
}

function openLevel(index) {
  active = index;
  const level = levels[index];
  const nextChapter = index < chapters[1].start ? 0 : 1;
  if (nextChapter !== chapterIndex) {
    const chapter = chapters[nextChapter];
    chapterIndex = nextChapter;
    $('intro-chapter-title').textContent = chapter.title;
    $('intro-chapter').value = String(nextChapter);
    levelButtons = chapter.levels.map((entry, number) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.level = chapter.start + number;
      if (entry.challenge) button.dataset.challenge = true;
      button.textContent = number + 1;
      button.addEventListener('click', () => {
        if (active !== chapter.start + number) openLevel(chapter.start + number);
      });
      return button;
    });
    $('intro-levels').replaceChildren(...levelButtons);
  }
  map = compile(level);
  state = map.initial;
  history = [];
  future = [];
  $('intro-title').textContent = '第 ' + (active - chapters[chapterIndex].start + 1) + ' 关 · ' + level.title;
  $('intro-hint').textContent = level.hint;
  board.classList.toggle('enter-chapter', chapterIndex === 1);
  previewBoard.classList.toggle('enter-chapter', chapterIndex === 1);
  board.replaceChildren();
  previewBoard.replaceChildren();
  saveProgress();
  render();
}

function move(direction) {
  if (won(map, state)) return;
  applyState(step(map, state, direction));
}

function applyState(next) {
  if (next === state) return;
  history.push(state);
  future = [];
  state = next;
  if (!complete[active] && won(map, state)) {
    complete[active] = true;
    saveProgress();
  }
  render();
}

function undo() {
  if (history.length === 0) return;
  future.push(state);
  state = history.pop();
  render();
}

function redo() {
  if (future.length === 0) return;
  history.push(state);
  state = future.pop();
  render();
}

$('intro-chapter').addEventListener('change', event => {
  openLevel(chapters[Number(event.target.value)].start);
  event.target.blur();
});
$('intro-close-inspector').addEventListener('click', () => inspector.close());
document.querySelectorAll('[data-move]').forEach(button => button.addEventListener('click', () => move(Number(button.dataset.move))));
$('intro-undo').addEventListener('click', undo);
$('intro-redo').addEventListener('click', redo);
$('intro-reset').addEventListener('click', () => applyState(map.initial));
$('intro-next').addEventListener('click', () => {
  if (won(map, state) && active + 1 < levels.length) openLevel(active + 1);
});
document.addEventListener('keydown', event => {
  if (inspector.open || event.target.closest('select') || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  const key = event.key.toLowerCase();
  const direction = moveKeys[key];
  if (key === 'z' || key === 'x' || key === 'r' || typeof direction === 'number') {
    event.preventDefault();
    if (event.repeat) return;
    if (key === 'z') undo();
    else if (key === 'x') redo();
    else if (key === 'r') applyState(map.initial);
    else move(direction);
  } else if (key === 'enter' && event.repeat && event.target.closest('[data-move]')) event.preventDefault();
});

openLevel(active);
