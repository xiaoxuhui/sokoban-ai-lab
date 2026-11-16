'use strict';

const { compile, placed, step, won } = Sokoban;
const levels = [
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

const $ = id => document.getElementById(id);
const board = $('intro-board');
const levelButtons = [...document.querySelectorAll('[data-level]')];
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
  const boxes = new Set(state.boxes);
  const covered = placed(map, state);
  const solved = won(map, state, covered);
  for (const [index, cell] of Array.from(board.children).entries()) {
    if (map.isWall(index)) continue;
    const goal = map.goals.has(index);
    const crate = boxes.has(index);
    const player = state.player === index;
    const tile = crate ? (goal ? '*' : '$') : player ? (goal ? '+' : '@') : goal ? '.' : ' ';
    if (cell.dataset.tile === tile) continue;
    cell.dataset.tile = tile;
    cell.replaceChildren();
    if (goal && !crate) addPiece(cell, 'goal');
    if (index === map.finish && !crate) addPiece(cell, 'intro-player-goal');
    if (crate) addPiece(cell, goal ? 'crate placed' : 'crate');
    if (player) addPiece(cell, 'player');
  }
  const address = index => '(' + (index % map.width + 1) + ', ' + (Math.floor(index / map.width) + 1) + ')';
  board.setAttribute('aria-label', '棋盘。玩家 ' + address(state.player) + '，箱子 ' + state.boxes.map(address).join('、') +
    '，箱子目标 ' + [...map.goals].map(address).join('、') + '，玩家终点 ' + address(map.finish));
  $('intro-count').textContent = state.moves + ' 步 · 推箱 ' + state.pushes + ' 次';
  $('intro-status').textContent = solved ? (active === levels.length - 1 ? '入门第 3 关已通关。' : '通关！') :
    covered === map.goals.size ? '箱子都到位了，走到玩家终点即可通关。' : '箱子到位 ' + covered + ' / ' + map.goals.size;
  $('intro-status').classList.toggle('success', solved);
  $('intro-next').hidden = !solved || active === levels.length - 1;
  $('intro-undo').disabled = history.length === 0;
  $('intro-redo').disabled = future.length === 0;
  $('intro-reset').disabled = state === map.initial;
  for (const [index, button] of levelButtons.entries()) {
    button.setAttribute('aria-pressed', index === active);
    button.dataset.complete = Boolean(complete[index]);
    button.setAttribute('aria-label', '第 ' + (index + 1) + ' 关' + (complete[index] ? '，已通关' : ''));
  }
}

function addPiece(cell, name) {
  const piece = document.createElement('i');
  piece.className = name;
  cell.append(piece);
}

function openLevel(index) {
  active = index;
  const level = levels[index];
  const [x, y] = level.finish;
  map = compile(level.rows, true, [], y * level.rows[0].length + x);
  state = map.initial;
  history = [];
  future = [];
  $('intro-title').textContent = level.title;
  $('intro-hint').textContent = level.hint;
  board.style.setProperty('--columns', map.width);
  board.replaceChildren(...Array.from(map.tiles, tile => {
    const cell = document.createElement('div');
    cell.className = tile === '#' ? 'cell wall' : 'cell';
    cell.dataset.tile = tile === '#' ? '#' : '';
    return cell;
  }));
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

levelButtons.forEach((button, index) => button.addEventListener('click', () => {
  if (index !== active) openLevel(index);
}));
document.querySelectorAll('[data-move]').forEach(button => button.addEventListener('click', () => move(Number(button.dataset.move))));
$('intro-undo').addEventListener('click', undo);
$('intro-redo').addEventListener('click', redo);
$('intro-reset').addEventListener('click', () => applyState(map.initial));
$('intro-next').addEventListener('click', () => {
  if (won(map, state) && active + 1 < levels.length) openLevel(active + 1);
});
document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
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
