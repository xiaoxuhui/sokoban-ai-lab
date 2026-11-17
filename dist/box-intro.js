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
  { id: 'intro', title: '入门', levels: [...opening, ...BoxCampaign.intro], color: '#cbcbce' },
  { id: 'enter', title: '进入', levels: BoxCampaign.enter, color: '#a4bedf' },
  { id: 'empty', title: '空白', levels: BoxCampaign.empty, color: '#b7a8a6' },
  { id: 'eat', title: '吞食', levels: BoxCampaign.eat, color: '#ffa778' },
  { id: 'reference', title: '参照', levels: BoxCampaign.reference, color: '#2d9eca' },
];
const levels = [];
for (const chapter of chapters) {
  chapter.start = levels.length;
  levels.push(...chapter.levels);
}

const $ = id => document.getElementById(id);
const board = $('intro-board');
const stage = $('intro-stage');
const textMaps = $('intro-text-maps');
const displayMode = $('intro-display-mode');
const inspector = $('intro-inspector');
const previewBoard = $('intro-preview-board');
const previewStage = $('intro-preview-stage');
const previewParent = $('intro-preview-parent');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let levelButtons = [];
let chapterIndex = -1;
const storageKey = 'sokoban-lab-box-intro-v1';
const layoutRevision = 3;
const moveKeys = { arrowup: 0, w: 0, arrowright: 1, d: 1, arrowdown: 2, s: 2, arrowleft: 3, a: 3 };
let active = 0;
let complete = [];
let map;
let state;
let history = [];
let future = [];
let textView = false;

try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (Number.isInteger(saved?.active) && levels[saved.active]) active = saved.active;
  if ((saved?.revision === 2 || saved?.revision === layoutRevision) && Array.isArray(saved.complete)) {
    complete = saved.complete.slice(0, levels.length);
  }
  if (saved?.revision === 2) {
    const reference = chapters.find(chapter => chapter.id === 'reference');
    const seventh = reference.start + 6;
    const tenth = reference.start + 9;
    if (active === seventh) active = tenth;
    else if (active === tenth) active = seventh;
    if (complete.length > seventh) {
      [complete[seventh], complete[tenth]] = [complete[tenth], complete[seventh]];
    }
  }
} catch { /* Progress is optional when storage is unavailable. */ }

const query = new URLSearchParams(location.search);
const requestedChapter = chapters.find(chapter => chapter.id === query.get('chapter'));
const requestedLevel = Number(query.get('level'));
if (Number.isInteger(requestedLevel) && requestedChapter?.levels[requestedLevel - 1]) {
  active = requestedChapter.start + requestedLevel - 1;
}

function saveProgress() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ revision: layoutRevision, active, complete }));
  } catch { /* The current session can still be played. */ }
}

function parentRoom(roomId) {
  const owner = map.rooms[roomId].owner;
  const parent = owner < 0 ? -1 : state.positions[owner][0];
  return parent === roomId ? -1 : parent;
}

function roomLabel(roomId) {
  const owner = map.rooms[roomId].owner;
  if (owner >= 0 && state.positions[owner][0] === roomId) return '自引用棋盘';
  const seen = new Set([roomId]);
  let depth = 0;
  for (let room = parentRoom(roomId); room >= 0; room = parentRoom(room)) {
    if (seen.has(room)) return '参照循环';
    seen.add(room);
    depth++;
  }
  return depth ? '箱内第 ' + depth + ' 层' : '外层';
}

function inspectRoom(roomId, crossing) {
  const viewedRoom = Number((inspector.open ? previewBoard : board).dataset.room);
  const allowCurrent = crossing.direction === 'in' && roomId === viewedRoom;
  if (!allowCurrent && roomId === state.positions[0][0]) {
    inspector.close();
    return;
  }
  renderScene(previewBoard, roomId, inspector.open ? crossing : null);
  $('intro-inspector-title').textContent = roomLabel(roomId);
  const hadParentFocus = document.activeElement === previewParent;
  previewParent.hidden = parentRoom(roomId) < 0;
  if (!inspector.open) inspector.showModal();
  else if (hadParentFocus && previewParent.hidden) $('intro-close-inspector').focus();
}

function inspectParent() {
  const roomId = inspector.open ? Number(previewBoard.dataset.room) : state.positions[0][0];
  const parent = parentRoom(roomId);
  if (parent >= 0) inspectRoom(parent, { direction: 'out', owner: map.rooms[roomId].owner });
  else if (inspector.open) inspector.close();
}

function render(crossings = []) {
  const [roomId, x, y] = state.positions[0];
  const covered = placed(map, state);
  const solved = won(map, state, covered);
  const previousRoom = Number(board.dataset.room);
  let crossing = crossings[0];
  if (crossing?.direction === 'out') crossing = crossings.findLast(entry => entry.direction === 'out');
  if (!crossing && board.children.length && previousRoom !== roomId) {
    const entering = parentRoom(roomId) === previousRoom;
    crossing = { direction: entering ? 'in' : 'out', owner: map.rooms[entering ? roomId : previousRoom].owner };
  }
  renderScene(board, roomId, textView ? null : crossing);
  if (textView) renderTextMaps(roomId);
  $('intro-room').hidden = map.rooms.length === 1 && map.rooms[0].owner < 0;
  $('intro-room').textContent = roomLabel(roomId);
  const canLookOut = parentRoom(roomId) >= 0;
  $('intro-view-parent').hidden = !canLookOut;
  stage.classList.toggle('can-look-out', canLookOut);
  board.setAttribute('aria-label', '棋盘，玩家第 ' + (x + 1) + ' 列，第 ' + (y + 1) + ' 行');
  $('intro-count').textContent = state.moves + ' 步 · 推箱 ' + state.pushes + ' 次';
  $('intro-status').textContent = solved ? '通关！' : covered === map.goals.length ?
    '箱子都到位了，走到玩家终点即可通关。' : '箱子到位 ' + covered + ' / ' + map.goals.length;
  $('intro-status').classList.toggle('success', solved);
  $('intro-next').hidden = !solved || active === levels.length - 1;
  $('intro-next').textContent = active + 1 === chapters[chapterIndex + 1]?.start ? '进入下一章 →' : '下一关 →';
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
  return map.rooms[roomId].color ?? (roomId === 0 ? chapters[chapterIndex].color : '#79aedc');
}

function setTextView(enabled) {
  clearRoomMotion(board);
  textView = enabled;
  board.hidden = enabled;
  textMaps.hidden = !enabled;
  stage.classList.toggle('text-view', enabled);
  displayMode.textContent = enabled ? '图形显示' : '字符显示';
}

function renderTextMaps(playerRoom) {
  if (!textMaps.children.length) {
    for (const [roomId, room] of map.rooms.entries()) {
      const button = document.createElement('button');
      const label = document.createElement('span');
      const lines = document.createElement('span');
      button.type = 'button';
      button.className = 'intro-text-room';
      button.style.setProperty('--text-room-color', roomColor(roomId));
      lines.className = 'intro-text-lines';
      label.textContent = roomId + 1;
      label.setAttribute('aria-hidden', 'true');
      lines.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < room.tiles.length; index++) {
        if (index > 0 && index % room.width === 0) lines.append('\n');
        lines.append(document.createElement('span'));
      }
      button.append(label, lines);
      button.addEventListener('click', () => {
        const current = state.positions[0][0];
        if (current === roomId) return;
        const entering = parentRoom(roomId) === current;
        inspectRoom(roomId, { direction: entering ? 'in' : 'out', owner: map.rooms[entering ? roomId : current].owner });
      });
      textMaps.append(button);
    }
  }
  const glyphs = map.rooms.map(room => Array.from(room.tiles, tile => tile === '#' ? '#' : '.'));
  for (const [room, x, y] of map.goals) glyphs[room][y * map.rooms[room].width + x] = '_';
  const [finishRoom, finishX, finishY] = map.finish;
  glyphs[finishRoom][finishY * map.rooms[finishRoom].width + finishX] = '=';
  state.positions.forEach(([room, x, y], entity) => {
    const child = map.inside[entity];
    glyphs[room][y * map.rooms[room].width + x] = entity === 0 ? 'p' : child >= 0 ? String(child + 1) : 'b';
  });
  for (const [roomId, button] of Array.from(textMaps.children).entries()) {
    const cells = button.querySelector('.intro-text-lines').children;
    glyphs[roomId].forEach((glyph, index) => {
      const cell = cells[index];
      if (cell.dataset.glyph !== glyph) {
        cell.textContent = glyph;
        cell.dataset.glyph = glyph;
      }
    });
    button.setAttribute('aria-label', (roomId === 0 ? '外层棋盘' : '套箱 ' + (roomId + 1)) +
      (roomId === playerRoom ? '，玩家所在位置' : '，点击查看'));
  }
}

function floorColor(roomId) {
  return map.eat ? 'color-mix(in srgb, #241b2c 67%, ' + roomColor(roomId) + ')' : '#535257';
}

function drawRoomMap(canvas, roomId, size = 10) {
  const room = map.rooms[roomId];
  canvas.width = room.width * size;
  canvas.height = room.height * size;
  const context = canvas.getContext('2d');
  context.fillStyle = floorColor(roomId);
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = roomColor(roomId);
  for (let i = 0; i < room.tiles.length; i++) {
    if (room.tiles[i] === '#') context.fillRect(i % room.width * size, Math.floor(i / room.width) * size, size, size);
  }
  context.strokeStyle = '#f5e4bb';
  for (const [id, x, y] of [...map.goals, map.finish]) {
    if (id === roomId) context.strokeRect(x * size + 2, y * size + 2, size - 4, size - 4);
  }
  const emptyChapter = board.classList.contains('empty-chapter');
  const playerColor = board.classList.contains('reference-chapter') ? '#c53d3a' :
    map.eat ? '#d260bd' : emptyChapter ? '#db562f' : '#df328d';
  const crateColor = map.eat ? '#ffdc72' : emptyChapter ? '#add444' : board.classList.contains('blue-crates') ? '#38bce8' : '#ffb63a';
  for (const [index, [id, x, y]] of state.positions.entries()) {
    if (id !== roomId) continue;
    const child = map.inside[index];
    context.fillStyle = index === 0 ? playerColor : child >= 0 ? roomColor(child) : crateColor;
    context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  }
}

function renderSurround(scene, roomId) {
  const outside = scene.querySelector('.intro-surround');
  const parent = state.positions[map.rooms[roomId].owner];
  scene.style.setProperty('--surround-color', roomColor(parent?.[0] ?? roomId));
  scene.classList.toggle('with-surround', Boolean(parent));
  outside.hidden = !parent;
  if (!parent) return;

  const [parentId, x, y] = parent;
  const room = map.rooms[parentId];
  outside.style.setProperty('--outer-columns', room.width);
  outside.style.setProperty('--outer-rows', room.height);
  outside.style.setProperty('--outer-x', x + 0.5);
  outside.style.setProperty('--outer-y', y + 0.5);
  drawRoomMap(outside, parentId, 32);
}

function clearRoomMotion(container) {
  for (const animation of container.getAnimations()) animation.cancel();
  container.parentElement.querySelector('.intro-ghost')?.remove();
}

function renderScene(container, roomId, crossing) {
  const scene = container.parentElement;
  const animate = crossing && !reduceMotion.matches && container.children.length;
  const entering = crossing?.direction === 'in';
  const shell = crossing ? '[data-shell="' + crossing.owner + '"]' : null;
  let oldRect, oldShell, ghost;

  if (crossing) clearRoomMotion(container);
  if (animate) {
    oldRect = container.getBoundingClientRect();
    oldShell = entering && container.querySelector(shell)?.getBoundingClientRect();
    ghost = container.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    ghost.classList.add('intro-ghost');
    const sources = container.querySelectorAll('canvas');
    ghost.querySelectorAll('canvas').forEach((canvas, index) => canvas.getContext('2d').drawImage(sources[index], 0, 0));
  }

  renderRoom(container, roomId);
  renderSurround(scene, roomId);
  if (!ghost || !oldRect.width) return;

  const area = scene.getBoundingClientRect();
  const nextRect = container.getBoundingClientRect();
  const target = entering ? oldShell : container.querySelector(shell)?.getBoundingClientRect();
  const zoomed = entering ? nextRect : oldRect;
  const anchor = target || zoomed;
  const tx = anchor.left + anchor.width / 2 - zoomed.left - zoomed.width / 2;
  const ty = anchor.top + anchor.height / 2 - zoomed.top - zoomed.height / 2;
  const scale = target ? Math.min(target.width / zoomed.width, target.height / zoomed.height) : 0.24;
  const zoom = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';
  const timing = { duration: 220, easing: 'cubic-bezier(.25,.7,.28,1)' };
  Object.assign(ghost.style, {
    left: oldRect.left - area.left - scene.clientLeft + 'px',
    top: oldRect.top - area.top - scene.clientTop + 'px',
    width: oldRect.width + 'px',
    height: oldRect.height + 'px',
    zIndex: entering ? '0' : '2',
  });
  scene.append(ghost);
  ghost.animate([{ opacity: 1 }, { opacity: 0, transform: entering ? 'scale(1.12)' : zoom }], timing)
    .onfinish = () => ghost.remove();
  container.animate([
    { opacity: entering ? 0.55 : 0.7, transform: entering ? zoom : 'scale(1.1)' },
    { opacity: 1, transform: 'none' },
  ], timing);
}

function renderRoom(container, roomId) {
  const room = map.rooms[roomId];
  if (container.dataset.room !== String(roomId) || !container.children.length) {
    container.dataset.room = roomId;
    container.style.setProperty('--columns', room.width);
    container.style.setProperty('--longest-side', Math.max(room.width, room.height));
    container.style.setProperty('--room-color', roomColor(roomId));
    container.style.setProperty('--room-floor', floorColor(roomId));
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
        button.dataset.shell = entity;
        button.className = goal ? 'room-box room-on-goal' : 'room-box';
        button.style.setProperty('--box-color', roomColor(child));
        button.setAttribute('aria-label', child === roomId ? '查看小箱子里的同一张棋盘' :
          '查看第 ' + (index % room.width + 1) + ' 列第 ' + (Math.floor(index / room.width) + 1) + ' 行的箱内房间');
        button.append(document.createElement('canvas'));
        button.addEventListener('click', () => inspectRoom(child, { direction: 'in', owner: entity }));
        cell.append(button);
      } else if (crate) addPiece(cell, goal ? 'crate placed' : 'crate');
    }
    if (child >= 0) drawRoomMap(cell.querySelector('canvas'), child);
  }
}

function openLevel(index) {
  clearRoomMotion(board);
  clearRoomMotion(previewBoard);
  active = index;
  const level = levels[index];
  const nextChapter = chapters.findLastIndex(chapter => index >= chapter.start);
  if (nextChapter !== chapterIndex) {
    const chapter = chapters[nextChapter];
    chapterIndex = nextChapter;
    $('intro-chapter-title').textContent = chapter.title;
    document.title = '套箱模式 · ' + chapter.title;
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
  const theme = chapters[nextChapter].id;
  map = compile({ ...level, eat: theme === 'eat' || theme === 'reference', allowCycles: theme === 'reference' });
  state = map.initial;
  history = [];
  future = [];
  $('intro-title').textContent = '第 ' + (active - chapters[chapterIndex].start + 1) + ' 关 · ' + level.title;
  $('intro-hint').textContent = level.hint;
  const blueCrates = chapterIndex === 1 && level.crateColor !== 'gold';
  for (const container of [board, previewBoard]) {
    container.classList.toggle('blue-crates', blueCrates);
    container.classList.toggle('empty-chapter', theme === 'empty');
    container.classList.toggle('eat-chapter', theme === 'eat');
    container.classList.toggle('reference-chapter', theme === 'reference');
  }
  board.replaceChildren();
  previewBoard.replaceChildren();
  textMaps.replaceChildren();
  displayMode.hidden = !level.textView;
  setTextView(Boolean(level.textView));
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
  render(next.crossings);
}

function undo() {
  if (history.length === 0) return;
  const crossings = (state.crossings ?? []).map(({ direction, owner }) => ({ direction: direction === 'in' ? 'out' : 'in', owner })).reverse();
  future.push(state);
  state = history.pop();
  render(crossings);
}

function redo() {
  if (future.length === 0) return;
  history.push(state);
  state = future.pop();
  render(state.crossings);
}

$('intro-convert').addEventListener('click', () => {
  const chapter = chapters[chapterIndex];
  const name = chapter.title + ' 第 ' + (active - chapter.start + 1) + ' 关 · 传送门';
  const code = JSON.stringify(BoxPortals.convert(map, state));
  try {
    sessionStorage.setItem('sokoban-lab-portal-import-v1', JSON.stringify({ name, code }));
  } catch {
    const url = URL.createObjectURL(new Blob([code + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('intro-status').textContent = '已下载地图，可在推箱子实验室里导入。';
    return;
  }
  location.assign('./?import=box-portals');
});

$('intro-chapter').addEventListener('change', event => {
  openLevel(chapters[Number(event.target.value)].start);
  event.target.blur();
});
$('intro-close-inspector').addEventListener('click', () => inspector.close());
inspector.addEventListener('close', () => {
  if (!inspector.open) clearRoomMotion(previewBoard);
});
$('intro-view-parent').addEventListener('click', inspectParent);
displayMode.addEventListener('click', () => {
  setTextView(!textView);
  render();
});
previewParent.addEventListener('click', inspectParent);
stage.addEventListener('click', event => {
  if (event.target === stage || event.target === textMaps) inspectParent();
});
inspector.addEventListener('click', event => {
  if (event.target === inspector || event.target === previewStage) inspectParent();
});
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
