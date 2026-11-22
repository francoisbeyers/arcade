(() => {
  'use strict';
  const A = window.Arcade;
  const { $, esc, rand, Sound, Net } = A;

  /* ---------- rules ---------- */
  const ROWS = 'ABCDEFGHIJ';
  const SHIPS = {
    carrier: { name: 'CARRIER', len: 5 },
    battleship: { name: 'BATTLESHIP', len: 4 },
    cruiser: { name: 'CRUISER', len: 3 },
    submarine: { name: 'SUBMARINE', len: 3 },
    destroyer: { name: 'DESTROYER', len: 2 },
  };
  const BOARDS = {
    quick: { size: 8, ships: ['battleship', 'cruiser', 'submarine', 'destroyer'] },
    full: { size: 10, ships: ['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer'] },
  };
  let SIZE = 10;
  let FLEET = [];

  const idx = (r, c) => r * SIZE + c;
  const coord = (r, c) => ROWS[r] + (c + 1);
  const shipById = (id) => FLEET.find((s) => s.id === id);
  const inBounds = (r, c) => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  const countVal = (map, v) => { let n = 0; for (const x of map.values()) if (x === v) n++; return n; };
  const pct = (hits, shots) => (shots ? Math.round((hits / shots) * 100) : 0) + '%';

  /* ---------- state ----------
     Everything from the point of view of the person holding the device ("me").
     In 2-players-on-one-device mode we keep two copies and swap them over. */
  const S = { mode: null, phase: 'title', board: 'quick', game: 0, seatIdx: 0 };
  const PERSP = ['placement', 'selected', 'dir', 'hover', 'myShots', 'oppShots', 'hitsOn', 'mySunk', 'enemySunk',
    'enemyReveal', 'myTurn', 'pending', 'aim', 'lastIn', 'lastOut', 'flashT', 'flashO', 'iReady', 'oppReady',
    'over', 'won', 'wantRematch', 'oppRematch', 'log', 'wins', 'isHost', 'me', 'opp'];

  function resetRound() {
    Object.assign(S, {
      myShots: new Map(), oppShots: new Map(), hitsOn: {}, mySunk: new Set(), enemySunk: new Map(),
      enemyReveal: null, myTurn: false, pending: false, aim: null, lastIn: null, lastOut: null,
      flashT: null, flashO: null, iReady: false, oppReady: false, over: false, won: false,
      wantRematch: false, oppRematch: false, log: [], selected: null, hover: null,
    });
    if (!S.dir) S.dir = 'h';
  }
  function freshPlayer(isHost, me, opp) {
    Object.assign(S, { isHost, me, opp, wins: { me: 0, opp: 0 }, placement: {}, dir: 'h' });
    resetRound();
  }
  freshPlayer(true, A.PLAYERS[0], A.CPU);

  function setBoard(key) {
    if (!BOARDS[key]) key = 'quick';
    S.board = key;
    SIZE = BOARDS[key].size;
    FLEET = BOARDS[key].ships.map((id) => ({ id, ...SHIPS[id] }));
    for (const id of ['#place-board', '#target-board', '#own-board']) $(id).style.setProperty('--n', SIZE + 1);
    buildBoard($('#place-board'), {
      onClick: onPlaceClick,
      onHover: (r, c) => { if (S.selected) { S.hover = { r, c }; renderPlace(); } },
      onLeave: () => { if (S.hover) { S.hover = null; renderPlace(); } },
    });
    buildBoard($('#target-board'), { onClick: fireAt });
    buildBoard($('#own-board'));
  }

  function show(name) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + name;
    window.scrollTo(0, 0);
  }
  const oppLabel = () => (S.mode === 'cpu' ? `CPU - ${AI.level.toUpperCase()}` : S.mode === 'local' ? '' : 'FRIEND');
  const nameHtml = (p) => `<span class="pc" style="--pc:${p.color}">${esc(p.name)}</span>`;

  /* ---------- boards ---------- */
  function lbl(text) {
    const d = document.createElement('div');
    d.className = 'lbl';
    d.textContent = text;
    return d;
  }
  function buildBoard(el, { onClick, onHover, onLeave } = {}) {
    el.innerHTML = '';
    const cells = [];
    el.appendChild(lbl(''));
    for (let c = 0; c < SIZE; c++) el.appendChild(lbl(String(c + 1)));
    for (let r = 0; r < SIZE; r++) {
      el.appendChild(lbl(ROWS[r]));
      for (let c = 0; c < SIZE; c++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cell';
        b.setAttribute('aria-label', coord(r, c));
        if (!onClick) b.tabIndex = -1;
        if (onClick) b.addEventListener('click', () => onClick(r, c));
        if (onHover) b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') onHover(r, c); });
        cells.push(b);
        el.appendChild(b);
      }
    }
    if (onLeave) el.onpointerleave = onLeave;
    el._cells = cells;
  }
  function shipCells(len, r, c, dir) {
    const out = [];
    for (let i = 0; i < len; i++) out.push(dir === 'h' ? [r, c + i] : [r + i, c]);
    return out;
  }
  function occupancy(except) {
    const g = new Array(SIZE * SIZE).fill(null);
    for (const [id, p] of Object.entries(S.placement)) {
      if (id === except || !shipById(id)) continue;
      for (const [r, c] of shipCells(shipById(id).len, p.r, p.c, p.dir)) if (inBounds(r, c)) g[idx(r, c)] = id;
    }
    return g;
  }
  function canPlace(id, r, c, dir) {
    const occ = occupancy(id);
    return shipCells(shipById(id).len, r, c, dir).every(([rr, cc]) => inBounds(rr, cc) && !occ[idx(rr, cc)]);
  }
  function fitAnchor(len, r, c, dir) {
    return dir === 'h' ? { r, c: Math.min(c, SIZE - len) } : { r: Math.min(r, SIZE - len), c };
  }
  function placementFits(pl) {
    if (!pl) return false;
    const used = new Set();
    for (const s of FLEET) {
      const p = pl[s.id];
      if (!p) return false;
      for (const [r, c] of shipCells(s.len, p.r, p.c, p.dir)) {
        if (!inBounds(r, c) || used.has(idx(r, c))) return false;
        used.add(idx(r, c));
      }
    }
    return Object.keys(pl).length === FLEET.length;
  }
  function segsFromCells(id, cells) {
    const sorted = cells.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const dir = sorted.length > 1 && sorted[0][0] === sorted[1][0] ? 'h' : 'v';
    return sorted.map(([r, c], i) => ({ i: idx(r, c), seg: { id, dir, end: i === 0 ? 'bow' : i === sorted.length - 1 ? 'stern' : 'mid' } }));
  }
  function shipLayout(placement) {
    const map = new Array(SIZE * SIZE).fill(null);
    if (!placement) return map;
    for (const [id, p] of Object.entries(placement)) {
      const s = shipById(id);
      if (!s || !p) continue;
      const cells = shipCells(s.len, p.r, p.c, p.dir);
      if (!cells.every(([r, c]) => inBounds(r, c))) continue;
      for (const { i, seg } of segsFromCells(id, cells)) map[i] = seg;
    }
    return map;
  }
  function applyShip(cell, seg) { if (seg) cell.classList.add('ship', 'dir-' + seg.dir, seg.end); }
  function randomFleet() {
    for (;;) {
      const fleet = {};
      const used = new Set();
      let ok = true;
      for (const s of FLEET) {
        let placed = false;
        for (let tries = 0; tries < 500 && !placed; tries++) {
          const dir = Math.random() < 0.5 ? 'h' : 'v';
          const r = rand(dir === 'v' ? SIZE - s.len + 1 : SIZE);
          const c = rand(dir === 'h' ? SIZE - s.len + 1 : SIZE);
          const cells = shipCells(s.len, r, c, dir);
          if (cells.every(([rr, cc]) => !used.has(idx(rr, cc)))) {
            cells.forEach(([rr, cc]) => used.add(idx(rr, cc)));
            fleet[s.id] = { r, c, dir };
            placed = true;
          }
        }
        if (!placed) { ok = false; break; }
      }
      if (ok) return fleet;
    }
  }
  const allPlaced = () => FLEET.every((s) => S.placement[s.id]);

  /* ---------- placement ---------- */
  function enterPlacement() {
    resetRound();
    if (!placementFits(S.placement)) S.placement = {};
    S.phase = 'place';
    A.hideOverlay();
    show('place');
    A.keepAwake();
    placeHeader();
    renderPlace();
    if (S.mode === 'cpu') AI.newRound();
  }
  function placeHeader() {
    $('#place-title').innerHTML = `${nameHtml(S.me)}: HIDE YOUR SHIPS`;
    $('#place-vs').textContent = `ROUND ${S.game + 1} - VS ${S.opp.name}${S.mode === 'cpu' ? ` (${AI.level.toUpperCase()})` : ''}`;
  }
  function selectShip(id) {
    if (S.iReady) return;
    Sound.click();
    if (S.placement[id]) { S.dir = S.placement[id].dir; delete S.placement[id]; S.selected = id; }
    else S.selected = S.selected === id ? null : id;
    renderPlace();
  }
  function onPlaceClick(r, c) {
    if (S.iReady) return;
    if (S.selected) {
      const s = shipById(S.selected);
      const a = fitAnchor(s.len, r, c, S.dir);
      if (canPlace(S.selected, a.r, a.c, S.dir)) {
        S.placement[S.selected] = { r: a.r, c: a.c, dir: S.dir };
        Sound.place();
        const next = FLEET.find((x) => !S.placement[x.id]);
        S.selected = next ? next.id : null;
      } else {
        Sound.error();
        A.toast("IT WON'T FIT THERE");
      }
    } else {
      const id = occupancy()[idx(r, c)];
      if (id) { S.dir = S.placement[id].dir; delete S.placement[id]; S.selected = id; Sound.click(); }
      else { const next = FLEET.find((x) => !S.placement[x.id]); if (next) { S.selected = next.id; onPlaceClick(r, c); return; } }
    }
    S.hover = null;
    renderPlace();
  }
  function rotate() {
    if (S.iReady) return;
    S.dir = S.dir === 'h' ? 'v' : 'h';
    Sound.click();
    renderPlace();
  }
  function renderPlace() {
    const board = $('#place-board');
    const layout = shipLayout(S.placement);
    let preview = null, valid = false;
    if (S.selected && S.hover) {
      const s = shipById(S.selected);
      const a = fitAnchor(s.len, S.hover.r, S.hover.c, S.dir);
      preview = shipCells(s.len, a.r, a.c, S.dir).filter(([r, c]) => inBounds(r, c));
      valid = canPlace(S.selected, a.r, a.c, S.dir);
    }
    board._cells.forEach((cell, i) => { cell.className = 'cell'; applyShip(cell, layout[i]); });
    if (preview) for (const [r, c] of preview) board._cells[idx(r, c)].classList.add(valid ? 'pv-ok' : 'pv-bad');
    board.classList.toggle('locked', S.iReady);

    const dock = $('#dock');
    dock.innerHTML = '';
    for (const s of FLEET) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dock-ship' + (S.placement[s.id] ? ' placed' : '') + (S.selected === s.id ? ' selected' : '');
      b.innerHTML = `<span class="dock-name">${s.name}</span><span class="dock-blocks">${'<i></i>'.repeat(s.len)}</span>`;
      b.disabled = S.iReady;
      b.addEventListener('click', () => selectShip(s.id));
      dock.appendChild(b);
    }
    $('#rotate-btn').textContent = S.dir === 'h' ? 'TURN: ACROSS' : 'TURN: DOWN';
    for (const id of ['#rotate-btn', '#random-btn', '#clear-btn']) $(id).disabled = S.iReady;
    $('#ready-btn').disabled = !allPlaced() || S.iReady;

    let hint;
    if (S.iReady) hint = 'SHIPS HIDDEN!';
    else if (S.selected) hint = `TAP THE SEA TO PUT YOUR ${shipById(S.selected).name} THERE.`;
    else if (allPlaced()) hint = 'ALL SHIPS HIDDEN. TAP A SHIP TO MOVE IT, OR PRESS READY!';
    else hint = 'TAP A SHIP, THEN TAP THE SEA. OR TAP MIX UP!';
    $('#place-hint').textContent = hint;

    let rm = '';
    if (S.iReady) rm = S.oppReady ? 'STARTING...' : `WAITING FOR ${S.opp.name}...`;
    else if (S.oppReady) rm = `${S.opp.name} IS READY!`;
    $('#ready-msg').textContent = rm;
  }
  function pressReady() {
    if (!allPlaced() || S.iReady) return;
    S.iReady = true;
    S.selected = null;
    Sound.ready();
    send({ type: 'ready' });
    if (S.oppReady) startBattle(); else renderPlace();
  }

  /* ---------- battle ---------- */
  function startBattle() {
    S.phase = 'battle';
    S.myTurn = (S.game % 2 === 0) === S.isHost; // first shot alternates each round
    S.pending = false;
    show('battle');
    A.keepAwake();
    addLog(S.myTurn ? 'YOU FIRE FIRST. GOOD LUCK!' : `${S.opp.name} FIRES FIRST.`);
    Sound.start();
    renderBattle();
    if (S.mode === 'cpu' && !S.myTurn) AI.takeTurn(1400);
  }
  function addLog(text) {
    S.log.unshift(text);
    if (S.log.length > 5) S.log.length = 5;
  }
  function fireAt(r, c) {
    if (S.phase !== 'battle' || !S.myTurn || S.pending || S.over) {
      if (S.phase === 'battle' && !S.over && !S.myTurn) A.toast(`WAIT FOR ${S.opp.name}`);
      return;
    }
    const i = idx(r, c);
    if (S.myShots.has(i)) { Sound.error(); return; }
    S.pending = true;
    S.aim = i;
    Sound.fire();
    renderBattle();
    send({ type: 'shot', r, c });
  }
  function handleIncomingShot(m) {
    if (S.phase !== 'battle' || S.myTurn || S.over || !inBounds(m.r, m.c)) return;
    const i = idx(m.r, m.c);
    if (S.oppShots.has(i)) return;
    const id = occupancy()[i];
    const hit = !!id;
    S.oppShots.set(i, hit ? 'hit' : 'miss');
    let sunk = null, cells = null;
    if (hit) {
      S.hitsOn[id] = (S.hitsOn[id] || 0) + 1;
      const s = shipById(id);
      if (S.hitsOn[id] >= s.len) {
        S.mySunk.add(id);
        sunk = id;
        const p = S.placement[id];
        cells = shipCells(s.len, p.r, p.c, p.dir);
      }
    }
    const gameOver = S.mySunk.size === FLEET.length;
    S.lastIn = i;
    S.flashO = i;
    const at = coord(m.r, m.c);
    if (sunk) { addLog(`${S.opp.name} SANK YOUR ${shipById(sunk).name}!`); Sound.sunk(); }
    else if (hit) { addLog(`${S.opp.name} FIRED AT ${at} - HIT!`); Sound.hit(); }
    else { addLog(`${S.opp.name} FIRED AT ${at} - MISS.`); Sound.miss(); }
    if (hit && navigator.vibrate && S.mode !== 'local') { try { navigator.vibrate(sunk ? [80, 60, 160] : 80); } catch (e) { /* ignore */ } }
    if (gameOver) endGame(false); else S.myTurn = true;
    renderBattle();
    send({ type: 'result', r: m.r, c: m.c, hit, sunk, cells, gameOver });
  }
  function handleResult(m) {
    if (!S.pending || !inBounds(m.r, m.c)) return;
    S.pending = false;
    S.aim = null;
    const i = idx(m.r, m.c);
    S.myShots.set(i, m.hit ? 'hit' : 'miss');
    S.lastOut = i;
    S.flashT = i;
    const at = coord(m.r, m.c);
    if (m.sunk && shipById(m.sunk) && Array.isArray(m.cells)) {
      S.enemySunk.set(m.sunk, m.cells.filter((x) => Array.isArray(x) && inBounds(x[0], x[1])));
      addLog(`YOU SANK THE ${shipById(m.sunk).name}!`);
      A.toast(`YOU SANK MY ${shipById(m.sunk).name}!`);
      Sound.sunk();
    } else if (m.hit) { addLog(`${at} - HIT!`); Sound.hit(); }
    else { addLog(`${at} - MISS.`); Sound.miss(); }
    S.myTurn = false;
    if (m.gameOver) endGame(true);
    renderBattle();
  }
  function endGame(won) {
    if (S.over) return;
    S.over = true;
    S.won = won;
    S.myTurn = false;
    S.pending = false;
    if (won) S.wins.me++; else S.wins.opp++;
    addLog(won ? 'ENEMY FLEET DESTROYED!' : 'YOUR FLEET IS LOST!');
    send({ type: 'reveal', placement: S.placement });
    if (S.mode === 'local' && S.seatIdx !== Local.view) return; // only the person holding the device sees the result
    const round = S.game;
    setTimeout(() => {
      if (S.phase !== 'battle' || !S.over || S.game !== round) return;
      if (S.mode === 'local' || S.won) Sound.win(); else Sound.lose();
      showGameOver();
    }, 1100);
  }
  function statsTable() {
    const me = { shots: S.myShots.size, hits: countVal(S.myShots, 'hit'), sunk: S.enemySunk.size };
    const op = { shots: S.oppShots.size, hits: countVal(S.oppShots, 'hit'), sunk: S.mySunk.size };
    const n = FLEET.length;
    return `<table class="stats">
      <thead><tr><th></th><td>${S.mode === 'local' ? nameHtml(S.me) : 'YOU'}</td><td>${nameHtml(S.opp)}</td></tr></thead>
      <tbody>
        <tr><th>WINS</th><td>${S.wins.me}</td><td>${S.wins.opp}</td></tr>
        <tr><th>SHOTS</th><td>${me.shots}</td><td>${op.shots}</td></tr>
        <tr><th>HITS</th><td>${me.hits}</td><td>${op.hits}</td></tr>
        <tr><th>AIM</th><td>${pct(me.hits, me.shots)}</td><td>${pct(op.hits, op.shots)}</td></tr>
        <tr><th>SHIPS SUNK</th><td>${me.sunk}/${n}</td><td>${op.sunk}/${n}</td></tr>
      </tbody></table>`;
  }
  function rematchNote() {
    if (S.mode === 'local') return '';
    if (S.wantRematch) return `<p>WAITING FOR ${esc(S.opp.name)}...</p>`;
    if (S.oppRematch) return `<p class="blink">${esc(S.opp.name)} WANTS TO PLAY AGAIN!</p>`;
    return '';
  }
  function showGameOver() {
    const local = S.mode === 'local';
    const winner = S.won ? S.me : S.opp;
    const title = local ? `${winner.name} WINS!` : S.won ? 'YOU WIN!' : `${S.opp.name} WINS`;
    showOverlayOver(title, local || S.won ? 'win' : 'lose',
      `${A.sprite(local || S.won ? 'trophy' : S.opp.sprite)}<p>${S.won ? 'THE WHOLE FLEET IS SUNK!' : 'YOUR FLEET IS SUNK.'}</p>${statsTable()}<div id="ov-note">${rematchNote()}</div>`);
  }
  function showOverlayOver(title, cls, body) {
    A.showOverlay({
      title, cls, body,
      actions: [
        { label: S.wantRematch ? 'WAITING...' : 'PLAY AGAIN', primary: true, id: 'ov-rematch', onClick: requestRematch },
        { label: 'SEE BOARDS', onClick: A.hideOverlay },
        { label: 'MENU', onClick: goMenu },
      ],
    });
    const t = $('#ov-body .sprite');
    if (t) t.style.cssText = 'width:72px;margin:0 auto';
    if (S.wantRematch) $('#ov-rematch').disabled = true;
  }
  function refreshGameOver() {
    const note = $('#ov-note');
    if (note) note.innerHTML = rematchNote();
    const b = $('#ov-rematch');
    if (b) { b.disabled = S.wantRematch; b.textContent = S.wantRematch ? 'WAITING...' : 'PLAY AGAIN'; }
    renderTurn();
  }
  function requestRematch() {
    if (!S.over || S.wantRematch) return;
    if (S.mode === 'local') { newRound(); return; }
    S.wantRematch = true;
    send({ type: 'rematch' });
    if (S.oppRematch) newRound(); else refreshGameOver();
  }
  function newRound() {
    S.game++;
    Sound.join();
    if (S.mode === 'local') Local.startRound();
    else enterPlacement();
  }

  function renderBattle() {
    const t = $('#target-board'), o = $('#own-board');
    const sunkMap = new Array(SIZE * SIZE).fill(null);
    for (const [id, cells] of S.enemySunk) for (const { i, seg } of segsFromCells(id, cells)) sunkMap[i] = seg;
    const reveal = S.over ? shipLayout(S.enemyReveal) : null;
    t._cells.forEach((cell, i) => {
      cell.className = 'cell';
      if (sunkMap[i]) { applyShip(cell, sunkMap[i]); cell.classList.add('sunk'); }
      else if (reveal && reveal[i]) { applyShip(cell, reveal[i]); cell.classList.add('reveal'); }
      const shot = S.myShots.get(i);
      if (shot) cell.classList.add(shot);
      if (S.pending && S.aim === i) cell.classList.add('aim');
      if (S.lastOut === i) cell.classList.add('last');
      if (S.flashT === i) cell.classList.add('boom');
      cell.disabled = !!shot || S.over;
    });
    t.classList.toggle('armed', S.myTurn && !S.pending && !S.over);
    t.classList.toggle('waiting', !S.myTurn && !S.over);

    const layout = shipLayout(S.placement);
    o._cells.forEach((cell, i) => {
      cell.className = 'cell';
      applyShip(cell, layout[i]);
      if (layout[i] && S.mySunk.has(layout[i].id)) cell.classList.add('sunk');
      const shot = S.oppShots.get(i);
      if (shot) cell.classList.add(shot);
      if (S.lastIn === i) cell.classList.add('last');
      if (S.flashO === i) cell.classList.add('boom');
    });
    S.flashT = S.flashO = null;

    const fleetHtml = (sunkSet) => FLEET.map((s) => `<span class="${sunkSet.has(s.id) ? 'down' : ''}">${s.name}</span>`).join('');
    $('#enemy-fleet').innerHTML = fleetHtml(new Set(S.enemySunk.keys()));
    $('#my-fleet').innerHTML = fleetHtml(S.mySunk);
    $('#log').innerHTML = S.log.map((l) => `<li>${esc(l)}</li>`).join('');
    renderScores();
    renderTurn();
  }
  function scoreHtml(who, p, wins, shots, hits, sunk) {
    return `<span class="who">${who || '&nbsp;'}</span>
      <span class="name">${esc(p.name)}</span>
      <span class="big">${wins} ${wins === 1 ? 'WIN' : 'WINS'}</span>
      <span class="row"><span>HITS</span><b>${hits}/${shots}</b></span>
      <span class="row"><span>SUNK</span><b>${sunk}/${FLEET.length}</b></span>`;
  }
  function renderScores() {
    const me = $('#score-me'), op = $('#score-opp');
    me.style.setProperty('--pc', S.me.color);
    op.style.setProperty('--pc', S.opp.color);
    me.innerHTML = scoreHtml(S.mode === 'local' ? '' : 'YOU', S.me, S.wins.me, S.myShots.size, countVal(S.myShots, 'hit'), S.enemySunk.size);
    op.innerHTML = scoreHtml(oppLabel(), S.opp, S.wins.opp, S.oppShots.size, countVal(S.oppShots, 'hit'), S.mySunk.size);
    me.classList.toggle('active', S.phase === 'battle' && !S.over && S.myTurn);
    op.classList.toggle('active', S.phase === 'battle' && !S.over && !S.myTurn);
  }
  function renderTurn() {
    const b = $('#turn-banner');
    if (S.over) {
      b.innerHTML = `<span>${S.mode === 'local' ? `${nameHtml(S.won ? S.me : S.opp)} WINS!` : S.won ? 'YOU WIN!' : `${nameHtml(S.opp)} WINS`}</span>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.textContent = S.wantRematch ? `WAITING FOR ${S.opp.name}...` : 'PLAY AGAIN';
      btn.disabled = S.wantRematch;
      btn.addEventListener('click', () => { Sound.click(); requestRematch(); });
      b.appendChild(btn);
      return;
    }
    if (S.pending) b.textContent = 'FIRING...';
    else if (S.myTurn) b.innerHTML = `<span class="blink">${nameHtml(S.me)}: FIRE!</span>`;
    else b.innerHTML = `${nameHtml(S.opp)} IS AIMING...`;
  }

  /* ---------- messages ---------- */
  function send(m) {
    if (S.mode === 'cpu') AI.receive(m);
    else if (S.mode === 'local') Local.receive(m);
    else if (S.mode === 'online') Net.send(m);
  }
  function onData(m) {
    switch (m.type) {
      case 'hi':
        if (S.mode === 'online' && S.isHost) Net.send({ type: 'hello', board: S.board });
        break;
      case 'hello':
        if (S.mode !== 'online' || S.phase !== 'connecting') return;
        if (!S.isHost && BOARDS[m.board]) setBoard(m.board);
        enterPlacement();
        break;
      case 'ready':
        if (S.phase !== 'place') return;
        S.oppReady = true;
        if (S.iReady) startBattle();
        else { A.toast(`${S.opp.name} IS READY!`); renderPlace(); }
        break;
      case 'shot': handleIncomingShot(m); break;
      case 'result': handleResult(m); break;
      case 'reveal':
        if (m.placement && typeof m.placement === 'object') {
          const safe = {};
          for (const s of FLEET) {
            const p = m.placement[s.id];
            if (p && inBounds(p.r, p.c) && (p.dir === 'h' || p.dir === 'v')) safe[s.id] = { r: p.r, c: p.c, dir: p.dir };
          }
          S.enemyReveal = safe;
          if (S.phase === 'battle') renderBattle();
        }
        break;
      case 'rematch':
        if (!S.over) return;
        S.oppRematch = true;
        if (S.wantRematch) newRound();
        else { A.toast(`${S.opp.name} WANTS TO PLAY AGAIN!`); refreshGameOver(); }
        break;
      default: break;
    }
  }

  /* ---------- 2 players on one device ----------
     Each move is replayed silently "as" the other player, then the device is
     handed over with a full-screen card so nobody sees the other fleet. */
  const Local = {
    seats: [null, null], view: 0, queue: [], busy: false, handing: false, timer: null,
    get(i, k) { return i === S.seatIdx ? S[k] : this.seats[i][k]; },
    save(i) { const o = {}; for (const k of PERSP) o[k] = S[k]; this.seats[i] = o; },
    load(i) { Object.assign(S, this.seats[i]); S.seatIdx = i; },
    swapTo(i) { if (S.seatIdx === i) return; this.save(S.seatIdx); this.load(i); },
    reset() { clearTimeout(this.timer); this.seats = [null, null]; this.queue = []; this.busy = false; this.handing = false; this.view = 0; S.seatIdx = 0; },
    startRound() {
      clearTimeout(this.timer);
      if (S.seatIdx !== 0 && this.seats[0]) this.swapTo(0);
      const cont = !!(this.seats[0] && this.seats[1]); // a rematch keeps wins and fleets
      const prev = cont ? this.seats.map((s, i) => (i === S.seatIdx ? { wins: S.wins, placement: S.placement } : s)) : [null, null];
      for (const i of [0, 1]) {
        S.seatIdx = i;
        freshPlayer(i === 0, A.PLAYERS[i], A.PLAYERS[1 - i]);
        if (prev[i]) { S.wins = prev[i].wins; S.placement = prev[i].placement || {}; }
        if (!placementFits(S.placement)) S.placement = {};
        this.save(i);
      }
      this.view = 0;
      this.load(0);
      S.phase = 'place';
      A.hideOverlay();
      A.keepAwake();
      this.handTo(0, `${A.PLAYERS[1].name}: LOOK AWAY! ${A.PLAYERS[0].name} HIDES THEIR SHIPS FIRST.`);
    },
    receive(m) {
      this.queue.push({ m, from: S.seatIdx });
      if (this.busy) return;
      this.busy = true;
      while (this.queue.length) {
        const { m: msg, from } = this.queue.shift();
        const to = 1 - from;
        this.swapTo(to);
        A.setQuiet(to !== this.view);
        onData(msg);
      }
      A.setQuiet(false);
      this.swapTo(this.view);
      this.busy = false;
      this.afterMoves();
    },
    afterMoves() {
      if (this.handing) return;
      if (S.phase === 'place') {
        const want = [0, 1].find((i) => !this.get(i, 'iReady'));
        if (want != null && want !== this.view) { this.renderView(); this.timer = setTimeout(() => this.handTo(want, 'HIDE YOUR SHIPS. NO PEEKING!'), 600); return; }
      } else if (S.phase === 'battle' && !this.get(this.view, 'over')) {
        const want = [0, 1].find((i) => this.get(i, 'myTurn'));
        if (want != null && want !== this.view) {
          this.renderView();
          this.timer = setTimeout(() => this.handTo(want, 'YOUR TURN TO FIRE!'), this.get(this.view, 'myShots').size ? 1700 : 900);
          return;
        }
      }
      this.renderView();
    },
    handTo(i, sub) {
      this.handing = true;
      const p = A.PLAYERS[i];
      A.handover({ player: p, title: `PASS TO ${p.name}`, sub, button: `I'M ${p.name}!` }).then(() => {
        this.handing = false;
        this.swapTo(i);
        this.view = i;
        this.renderView();
      });
    },
    renderView() {
      if (S.phase === 'place') {
        show('place'); placeHeader(); renderPlace();
      } else if (S.phase === 'battle') { show('battle'); renderBattle(); }
    },
  };

  /* ---------- computer opponent ---------- */
  const AI = {
    level: 'easy', gen: 0,
    fleet: {}, layout: [], hitsOn: {}, sunk: new Set(), shotAt: new Set(), know: [], remaining: [],
    stop() { this.gen++; },
    deliver(m, delay) {
      const g = this.gen;
      setTimeout(() => { if (g === this.gen && S.mode === 'cpu') onData(m); }, delay);
    },
    newRound() {
      this.gen++;
      this.fleet = randomFleet();
      this.layout = shipLayout(this.fleet);
      this.hitsOn = {};
      this.sunk = new Set();
      this.shotAt = new Set();
      this.know = new Array(SIZE * SIZE).fill(0); // 0 unknown, 1 miss, 2 hit, 3 sunk
      this.remaining = FLEET.map((s) => s.len);
      this.deliver({ type: 'ready' }, 900 + rand(900));
    },
    receive(m) {
      if (m.type === 'shot') this.onPlayerShot(m.r, m.c);
      else if (m.type === 'result') this.onResult(m);
      else if (m.type === 'reveal') this.deliver({ type: 'reveal', placement: this.fleet }, 100);
      else if (m.type === 'rematch') this.deliver({ type: 'rematch' }, 400);
    },
    onPlayerShot(r, c) {
      const i = idx(r, c);
      if (!inBounds(r, c) || this.shotAt.has(i)) return;
      this.shotAt.add(i);
      const seg = this.layout[i];
      let sunk = null, cells = null;
      if (seg) {
        this.hitsOn[seg.id] = (this.hitsOn[seg.id] || 0) + 1;
        const s = shipById(seg.id);
        if (this.hitsOn[seg.id] >= s.len) {
          this.sunk.add(seg.id);
          sunk = seg.id;
          const p = this.fleet[seg.id];
          cells = shipCells(s.len, p.r, p.c, p.dir);
        }
      }
      const gameOver = this.sunk.size === FLEET.length;
      this.deliver({ type: 'result', r, c, hit: !!seg, sunk, cells, gameOver }, 350);
      if (!gameOver) this.takeTurn(350 + 750 + rand(500));
    },
    onResult(m) {
      this.know[idx(m.r, m.c)] = m.hit ? 2 : 1;
      if (m.sunk && Array.isArray(m.cells)) {
        for (const [r, c] of m.cells) this.know[idx(r, c)] = 3;
        const k = this.remaining.indexOf(shipById(m.sunk).len);
        if (k >= 0) this.remaining.splice(k, 1);
      }
    },
    takeTurn(delay) {
      const i = this.pickTarget();
      this.deliver({ type: 'shot', r: Math.floor(i / SIZE), c: i % SIZE }, delay);
    },
    pickRandom(list) { return list[rand(list.length)]; },
    pickTarget() {
      const unknown = [];
      this.know.forEach((v, i) => { if (v === 0) unknown.push(i); });
      if (this.level === 'easy') return this.pickRandom(unknown);
      if (this.level === 'hard') { const d = this.densityPick(); if (d != null) return d; }
      const t = this.targetPick();
      return t != null ? t : this.pickRandom(unknown);
    },
    // NORMAL: after a hit, follow the line of hits, otherwise try the squares around it.
    targetPick() {
      const hits = [];
      this.know.forEach((v, i) => { if (v === 2) hits.push(i); });
      if (!hits.length) return null;
      const isHit = (r, c) => inBounds(r, c) && this.know[idx(r, c)] === 2;
      const ends = [];
      for (const h of hits) {
        const r = Math.floor(h / SIZE), c = h % SIZE;
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          if (!isHit(r + dr, c + dc) && !isHit(r - dr, c - dc)) continue;
          let a = 1; while (isHit(r + dr * a, c + dc * a)) a++;
          let b = 1; while (isHit(r - dr * b, c - dc * b)) b++;
          for (const [er, ec] of [[r + dr * a, c + dc * a], [r - dr * b, c - dc * b]]) {
            if (inBounds(er, ec) && this.know[idx(er, ec)] === 0) ends.push(idx(er, ec));
          }
        }
      }
      if (ends.length) return this.pickRandom(ends);
      const around = [];
      for (const h of hits) {
        const r = Math.floor(h / SIZE), c = h % SIZE;
        for (const [a, b] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) if (inBounds(a, b) && this.know[idx(a, b)] === 0) around.push(idx(a, b));
      }
      return around.length ? this.pickRandom(around) : null;
    },
    // HARD: count every way the remaining ships could still fit, fire at the busiest square.
    densityPick() {
      const score = new Array(SIZE * SIZE).fill(0);
      const hasHits = this.know.includes(2);
      for (const len of this.remaining) {
        for (const dir of ['h', 'v']) {
          for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
              const cells = shipCells(len, r, c, dir);
              if (!cells.every(([a, b]) => inBounds(a, b))) continue;
              const ids = cells.map(([a, b]) => idx(a, b));
              if (ids.some((i) => this.know[i] === 1 || this.know[i] === 3)) continue;
              const nHits = ids.filter((i) => this.know[i] === 2).length;
              if (hasHits && !nHits) continue;
              const w = hasHits ? 1 + nHits * 20 : 1;
              for (const i of ids) if (this.know[i] === 0) score[i] += w;
            }
          }
        }
      }
      let best = 0, picks = [];
      score.forEach((v, i) => {
        if (this.know[i] !== 0 || v === 0) return;
        if (v > best) { best = v; picks = [i]; } else if (v === best) picks.push(i);
      });
      return picks.length ? this.pickRandom(picks) : null;
    },
  };

  /* ---------- starting and leaving games ---------- */
  function resetAll() {
    AI.stop();
    Local.reset();
    A.setQuiet(false);
    S.game = 0;
    setBoard(boardChoice.get());
  }
  function startCPU(level) {
    resetAll();
    S.mode = 'cpu';
    AI.level = level || 'easy';
    freshPlayer(true, A.PLAYERS[0], A.CPU);
    enterPlacement();
  }
  function startLocal() {
    resetAll();
    S.mode = 'local';
    Local.startRound();
  }
  function startOnline(code) {
    A.online({
      game: 'battleships',
      code,
      onConnected(isHost) {
        resetAll();
        S.mode = 'online';
        freshPlayer(isHost, A.PLAYERS[isHost ? 0 : 1], A.PLAYERS[isHost ? 1 : 0]);
        S.phase = 'connecting';
        if (isHost) enterPlacement(); else Net.send({ type: 'hi' });
      },
      onData,
      onClose(left) {
        if (S.mode !== 'online') return;
        const score = `${S.me.name} ${S.wins.me} - ${S.wins.opp} ${S.opp.name}`;
        S.phase = 'lost';
        A.connectionLost(left, score, goMenu);
      },
    });
  }
  function goMenu() {
    if (S.mode === 'online') Net.leave();
    resetAll();
    S.mode = null;
    S.phase = 'title';
    A.releaseAwake();
    A.hideOverlay();
    $('#handover').hidden = true;
    show('title');
  }

  /* ---------- wiring ---------- */
  const boardChoice = A.choiceRow($('#board-choice'), {
    key: 'bs-board', def: 'quick',
    options: [{ value: 'quick', label: 'QUICK 8x8' }, { value: 'full', label: 'BIG 10x10' }],
    onChange: (v) => setBoard(v),
  });
  setBoard(boardChoice.get());
  A.modeMenu($('#modes'), {
    game: 'battleships',
    onPick(mode, level) {
      if (mode === 'solo') startCPU(level);
      else if (mode === 'local') startLocal();
      else startOnline('');
    },
  });
  const GUIDE = [
    { title: 'HIDE YOUR SHIPS', text: 'Tap a ship, then tap the sea to put it there. Or tap MIX UP to do it for you.',
      pic: A.mini('sea', ['.....', '.sss.', '.....', 's....', 's....']) },
    { title: 'TAKE TURNS TO FIRE', text: 'Tap a square on the enemy sea to fire a shot at it.',
      pic: A.mini('sea', ['.....', '.....', '..t..', '.....', '.....']) },
    { title: 'RED MEANS HIT!', text: 'You hit a ship! Fire next to that square to find the rest of it.',
      pic: A.mini('sea', ['.....', '.ox..', '.....', '...o.', '.....']) },
    { title: 'GREEN MEANS MISS', text: 'Only water there. Try somewhere else next time.',
      pic: A.mini('sea', ['o....', '..o..', '....o', '.o...', '...o.']) },
    { title: 'SINK EVERY SHIP', text: 'Hit every square of every ship. The first to sink the whole fleet wins!',
      pic: A.sprite('trophy') },
    { title: 'ONE DEVICE? NO PEEKING!', text: 'When it says PASS, hand it over and look away while your friend plays.',
      pic: `${A.sprite('kidBlue')}<span class="arrow">&gt;</span>${A.sprite('kidPink')}` },
    { title: 'QUICK OR BIG?', text: 'QUICK is a small sea with 4 ships for a short game. BIG is the full sea with 5 ships.',
      pic: `<div class="small-minis">${A.mini('sea', ['ss..', '....', '.s..', '.s..'])}${A.mini('sea', ['s.....', 's..ss.', '......', '.sss..', '......', '...ss.'])}</div>` },
  ];
  A.initHeader();
  A.setGuard(() => S.phase === 'place' || S.phase === 'connecting' || (S.phase === 'battle' && !S.over));

  $('#rotate-btn').addEventListener('click', rotate);
  $('#random-btn').addEventListener('click', () => { if (S.iReady) return; S.placement = randomFleet(); S.selected = null; Sound.place(); renderPlace(); });
  $('#clear-btn').addEventListener('click', () => { if (S.iReady) return; S.placement = {}; S.selected = FLEET[0].id; Sound.click(); renderPlace(); });
  $('#ready-btn').addEventListener('click', pressReady);
  document.addEventListener('keydown', (e) => {
    if (S.phase === 'place' && (e.key === 'r' || e.key === 'R') && e.target.tagName !== 'INPUT') rotate();
  });

  show('title');
  $('#how-btn').addEventListener('click', () => { Sound.click(); A.guide(GUIDE); });
  const room = A.roomFromUrl();
  if (room) startOnline(room);
  else A.guideOnce('bs', GUIDE);
})();
