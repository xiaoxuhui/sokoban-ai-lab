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
const returnButton = $('intro-return');
const parentButton = $('intro-view-parent');
const moveButtons = document.querySelectorAll('[data-move]');
const roomMaps = new WeakMap();
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
let inspectedRoom = null;
let roomMotion;

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
  return owner < 0 ? -1 : state.positions[owner][0];
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
  inspectedRoom = roomId === state.positions[0][0] ? null : roomId;
  render(crossing ? [crossing] : []);
}

function inspectParent() {
  const roomId = inspectedRoom ?? state.positions[0][0];
  const parent = parentRoom(roomId);
  if (parent >= 0) inspectRoom(parent, { direction: 'out', owner: map.rooms[roomId].owner });
  else returnToPlayer();
}

function returnToPlayer() {
  if (inspectedRoom !== null) inspectRoom(state.positions[0][0]);
}

function cameraCrossing(crossings, previousRoom, roomId) {
  const first = crossings[0];
  const last = crossings.at(-1);
  if (first?.direction === 'out' && last.direction === 'in') {
    if (state.positions[first.owner][0] === roomId) return first;
    if (state.positions[last.owner][0] === previousRoom) return last;
    return { direction: 'across' };
  }
  if (first) return first.direction === 'out' ? last : first;
  if (board.children.length && previousRoom !== roomId) {
    if (parentRoom(roomId) === previousRoom) return { direction: 'in', owner: map.rooms[roomId].owner };
    if (parentRoom(previousRoom) === roomId) return { direction: 'out', owner: map.rooms[previousRoom].owner };
    return { direction: 'across' };
  }
  if (board.hidden && inspectedRoom !== null) return { direction: 'across' };
}

function render(crossings = []) {
  const [playerRoom, x, y] = state.positions[0];
  const inspecting = inspectedRoom !== null;
  const roomId = inspectedRoom ?? playerRoom;
  const showText = textView && !inspecting;
  const covered = placed(map, state);
  const solved = won(map, state, covered);
  renderScene(roomId, cameraCrossing(crossings, Number(board.dataset.room), roomId), showText);
  if (showText) renderTextMaps(playerRoom);
  $('intro-room').hidden = map.rooms.length === 1 && map.rooms[0].owner < 0;
  $('intro-room').textContent = (inspecting ? '正在查看 · ' : '') + roomLabel(roomId);
  const canLookOut = parentRoom(roomId) >= 0;
  parentButton.hidden = !canLookOut;
  returnButton.hidden = !inspecting;
  for (const button of moveButtons) button.disabled = inspecting;
  stage.classList.toggle('can-look-out', canLookOut || inspecting);
  board.setAttribute('aria-label', inspecting ? '正在查看' + roomLabel(roomId) :
    '棋盘，玩家第 ' + (x + 1) + ' 列，第 ' + (y + 1) + ' 行');
  $('intro-count').textContent = state.moves + ' 步 · 推箱 ' + state.pushes + ' 次';
  $('intro-status').textContent = solved ? '通关！' : covered === map.goals.length ?
    '箱子都到位了，走到玩家终点即可通关。' : '箱子到位 ' + covered + ' / ' + map.goals.length;
  $('intro-status').classList.toggle('success', solved);
  $('intro-next').hidden = !solved || active === levels.length - 1;
  $('intro-next').textContent = active + 1 === chapters[chapterIndex + 1]?.start ? '进入下一章 →' : '下一关 →';
  $('intro-undo').disabled = inspecting || history.length === 0;
  $('intro-redo').disabled = inspecting || future.length === 0;
  $('intro-reset').disabled = inspecting || state === map.initial;
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
  clearRoomMotion();
  textView = enabled;
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
        if (state.positions[0][0] !== roomId) inspectRoom(roomId);
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
  const pieces = [];
  for (const [index, [id, x, y]] of state.positions.entries()) {
    if (id === roomId) pieces.push([index, x, y]);
  }
  const signature = pieces.join('|');
  const cached = roomMaps.get(canvas);
  if (cached?.map === map && cached.roomId === roomId && cached.size === size && cached.signature === signature) return;
  roomMaps.set(canvas, { map, roomId, size, signature });
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
  for (const [index, x, y] of pieces) {
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

function clearRoomMotion() {
  roomMotion?.animation.cancel();
  roomMotion?.ghost?.remove();
  roomMotion = undefined;
}

function boardFrame(element) {
  const rect = element.getBoundingClientRect();
  return { rect, opacity: Number(getComputedStyle(element).opacity) };
}

function cloneBoard() {
  const ghost = board.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.classList.add('intro-ghost');
  const sources = board.querySelectorAll('canvas');
  ghost.querySelectorAll('canvas').forEach((canvas, index) => canvas.getContext('2d').drawImage(sources[index], 0, 0));
  return ghost;
}

function cameraPose(rect, anchor, target) {
  const scale = Math.min(target.width / anchor.width, target.height / anchor.height);
  return {
    x: target.left + target.width / 2 - rect.left - rect.width / 2 +
      (rect.left + rect.width / 2 - anchor.left - anchor.width / 2) * scale,
    y: target.top + target.height / 2 - rect.top - rect.height / 2 +
      (rect.top + rect.height / 2 - anchor.top - anchor.height / 2) * scale,
    scale,
  };
}

const restingPose = { x: 0, y: 0, scale: 1 };

function animateCamera(element, from, to, fromOpacity, toOpacity, duration) {
  const frames = Array.from({ length: 9 }, (_, index) => {
    const progress = index / 8;
    const scale = from.scale * (to.scale / from.scale) ** progress;
    const zoom = to.scale === from.scale ? progress : (scale - from.scale) / (to.scale - from.scale);
    const x = from.x + (to.x - from.x) * zoom;
    const y = from.y + (to.y - from.y) * zoom;
    return {
      opacity: fromOpacity + (toOpacity - fromOpacity) * progress,
      transform: 'translate(' + x + 'px, ' + y + 'px) scale(' + scale + ')',
    };
  });
  return element.animate(frames, { duration, easing: 'linear', fill: 'backwards' });
}

function renderScene(roomId, crossing, showText) {
  const animate = crossing && !showText && !reduceMotion.matches;
  const entering = crossing?.direction === 'in';
  const shell = crossing?.owner >= 0 ? '[data-shell="' + crossing.owner + '"]' : null;
  let oldFrame, oldShell, returningFrame, ghost;
  if (animate && board.children.length && !board.hidden) {
    // Measure the interpolated frame while the previous animation is still active.
    oldFrame = boardFrame(board);
    oldShell = entering && shell ? board.querySelector(shell)?.getBoundingClientRect() : null;
    const previous = roomMotion?.ghost;
    if (previous?.isConnected && previous.dataset.room === String(roomId) &&
        roomMotion.crossing.direction !== crossing.direction) {
      returningFrame = boardFrame(previous);
    }
    ghost = cloneBoard();
  }

  if (crossing || showText) clearRoomMotion();
  board.hidden = showText;
  textMaps.hidden = !showText;
  stage.classList.toggle('text-view', showText);
  renderRoom(board, roomId);
  renderSurround(stage, roomId);
  if (!animate) return;

  const nextRect = board.getBoundingClientRect();
  const oldRect = oldFrame?.rect;
  const nextShell = !entering && shell ? board.querySelector(shell)?.getBoundingClientRect() : null;
  let incoming = restingPose;
  let outgoing = restingPose;
  let opacity = 0;
  if (oldShell?.width && nextRect.width) {
    incoming = cameraPose(nextRect, nextRect, oldShell);
    outgoing = cameraPose(oldRect, oldShell, nextRect);
    opacity = oldFrame.opacity;
  } else if (nextShell?.width && oldRect?.width) {
    incoming = cameraPose(nextRect, nextShell, oldRect);
    outgoing = cameraPose(oldRect, oldRect, nextShell);
  }
  if (returningFrame?.rect.width && nextRect.width) {
    incoming = cameraPose(nextRect, nextRect, returningFrame.rect);
    opacity = returningFrame.opacity;
  }
  const distance = Math.max(Math.abs(Math.log(incoming.scale)), Math.abs(Math.log(outgoing.scale)));
  const duration = Math.max(110, Math.min(240, distance * 100));
  if (ghost && oldRect.width) {
    const area = stage.getBoundingClientRect();
    Object.assign(ghost.style, {
      left: oldRect.left - area.left - stage.clientLeft + 'px',
      top: oldRect.top - area.top - stage.clientTop + 'px',
      width: oldRect.width + 'px',
      height: oldRect.height + 'px',
      zIndex: entering ? '0' : '2',
    });
    stage.append(ghost);
    animateCamera(ghost, restingPose, outgoing, oldFrame.opacity, 0, duration).onfinish = () => ghost.remove();
  }
  const animation = animateCamera(board, incoming, restingPose, opacity, 1, duration);
  roomMotion = { animation, ghost, crossing };
  animation.onfinish = () => {
    if (roomMotion?.animation === animation) roomMotion = undefined;
  };
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
  clearRoomMotion();
  inspectedRoom = null;
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
  board.classList.toggle('blue-crates', blueCrates);
  board.classList.toggle('empty-chapter', theme === 'empty');
  board.classList.toggle('eat-chapter', theme === 'eat');
  board.classList.toggle('reference-chapter', theme === 'reference');
  board.replaceChildren();
  textMaps.replaceChildren();
  displayMode.hidden = !level.textView;
  setTextView(Boolean(level.textView));
  saveProgress();
  render();
}

function move(direction) {
  if (inspectedRoom !== null || won(map, state)) return;
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
returnButton.addEventListener('click', returnToPlayer);
parentButton.addEventListener('click', inspectParent);
displayMode.addEventListener('click', () => {
  inspectedRoom = null;
  setTextView(!textView);
  render();
});
stage.addEventListener('click', event => {
  if (event.target === stage || event.target === textMaps) inspectParent();
});
for (const button of moveButtons) button.addEventListener('click', () => move(Number(button.dataset.move)));
$('intro-undo').addEventListener('click', undo);
$('intro-redo').addEventListener('click', redo);
$('intro-reset').addEventListener('click', () => applyState(map.initial));
$('intro-next').addEventListener('click', () => {
  if (won(map, state) && active + 1 < levels.length) openLevel(active + 1);
});
document.addEventListener('keydown', event => {
  if (event.target.closest('select') || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  const key = event.key.toLowerCase();
  if (key === 'escape' && inspectedRoom !== null) {
    event.preventDefault();
    returnToPlayer();
    return;
  }
  const direction = moveKeys[key];
  if (key === 'z' || key === 'x' || key === 'r' || typeof direction === 'number') {
    event.preventDefault();
    if (event.repeat || inspectedRoom !== null) return;
    if (key === 'z') undo();
    else if (key === 'x') redo();
    else if (key === 'r') applyState(map.initial);
    else move(direction);
  } else if (key === 'enter' && event.repeat && event.target.closest('[data-move]')) event.preventDefault();
});

openLevel(active);
