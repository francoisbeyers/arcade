(() => {
  'use strict';
  const A = window.Arcade;
  const { $, esc, rand, Sound, Net } = A;

  const R = 6, C = 7;
  const ORDER = [3, 2, 4, 1, 5, 0, 6]; // centre first

  const S = {
    mode: null, phase: 'title', level: 'easy', mySide: 0,
    grid: null, turn: 1, round: 0, over: false, winner: 0, winCells: [], last: null,
    wins: { 1: 0, 2: 0 }, draws: 0, players: { 1: A.PLAYERS[0], 2: A.PLAYERS[1] }, cpuTimer: null,
  };

  /* ---------- rules ---------- */
  const newGrid = () => Array.from({ length: R }, () => Array(C).fill(0));
  function dropRow(g, c) { for (let r = R - 1; r >= 0; r--) if (!g[r][c]) return r; return -1; }
  const validCols = (g) => ORDER.filter((c) => !g[0][c]);
  const LINES = (() => {
    const out = [];
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
          const cells = [0, 1, 2, 3].map((k) => [r + dr * k, c + dc * k]);
          if (cells.every(([a, b]) => a >= 0 && a < R && b >= 0 && b < C)) out.push(cells);
        }
      }
    }
    return out;
  })();
  function winner(g) {
    for (const L of LINES) {
      const v = g[L[0][0]][L[0][1]];
      if (v && L.every(([r, c]) => g[r][c] === v)) return v;
    }
    return 0;
  }
  function winCells(g, p) {
    const set = new Set();
    for (const L of LINES) if (L.every(([r, c]) => g[r][c] === p)) for (const [r, c] of L) set.add(r * C + c);
    return [...set];
  }

  /* ---------- computer ---------- */
  function wouldWin(g, c, p) {
    const r = dropRow(g, c);
    if (r < 0) return false;
    g[r][c] = p;
    const w = winner(g) === p;
    g[r][c] = 0;
    return w;
  }
  function givesAway(g, c, me) {
    const r = dropRow(g, c);
    if (r <= 0) return false;
    g[r][c] = me;
    const bad = wouldWin(g, c, 3 - me);
    g[r][c] = 0;
    return bad;
  }
  function windowScore(L, g, p) {
    let mine = 0, theirs = 0, empty = 0;
    for (const [r, c] of L) { const v = g[r][c]; if (v === p) mine++; else if (v) theirs++; else empty++; }
    if (mine === 3 && empty === 1) return 6;
    if (mine === 2 && empty === 2) return 2;
    if (theirs === 3 && empty === 1) return -5;
    return 0;
  }
  function heuristic(g, p) {
    let s = 0;
    for (let r = 0; r < R; r++) if (g[r][3] === p) s += 3;
    for (const L of LINES) s += windowScore(L, g, p);
    return s;
  }
  function minimax(g, depth, alpha, beta, maximising, p) {
    const w = winner(g);
    if (w) return w === p ? 100000 + depth : -100000 - depth;
    const cols = validCols(g);
    if (!cols.length) return 0;
    if (depth === 0) return heuristic(g, p);
    const who = maximising ? p : 3 - p;
    let best = maximising ? -Infinity : Infinity;
    for (const c of cols) {
      const r = dropRow(g, c);
      g[r][c] = who;
      const v = minimax(g, depth - 1, alpha, beta, !maximising, p);
      g[r][c] = 0;
      if (maximising) { best = Math.max(best, v); alpha = Math.max(alpha, best); }
      else { best = Math.min(best, v); beta = Math.min(beta, best); }
      if (alpha >= beta) break;
    }
    return best;
  }
  function cpuPick() {
    const g = S.grid, me = 2, you = 1;
    const cols = validCols(g);
    if (S.level === 'easy') {
      if (Math.random() < 0.5) { const w = cols.find((c) => wouldWin(g, c, me)); if (w != null) return w; }
      return cols[rand(cols.length)];
    }
    if (S.level === 'normal') {
      const w = cols.find((c) => wouldWin(g, c, me)); if (w != null) return w;
      const b = cols.find((c) => wouldWin(g, c, you)); if (b != null) return b;
      const safe = cols.filter((c) => !givesAway(g, c, me));
      const pool = safe.length ? safe : cols;
      const weights = pool.map((c) => 4 - Math.abs(3 - c));
      let pick = rand(weights.reduce((a, b2) => a + b2, 0));
      for (let i = 0; i < pool.length; i++) { pick -= weights[i]; if (pick < 0) return pool[i]; }
      return pool[0];
    }
    let best = -Infinity, choices = [];
    for (const c of cols) {
      const r = dropRow(g, c);
      g[r][c] = me;
      const v = minimax(g, 4, -Infinity, Infinity, false, me);
      g[r][c] = 0;
      if (v > best) { best = v; choices = [c]; } else if (v === best) choices.push(c);
    }
    return choices[rand(choices.length)];
  }
  function cpuMove() {
    if (S.mode !== 'cpu' || S.over || S.turn !== 2) return;
    play(cpuPick());
  }

  /* ---------- play ---------- */
  const name = (p) => S.players[p].name;
  const chip = (p) => `<span class="pc" style="--pc:${S.players[p].color}">${esc(name(p))}</span>`;
  function canMove() {
    if (S.phase !== 'game' || S.over) return false;
    if (S.mode === 'cpu') return S.turn === 1;
    if (S.mode === 'online') return S.turn === S.mySide;
    return true;
  }
  function tapCol(c) {
    if (!canMove()) {
      if (S.phase === 'game' && !S.over && S.mode !== 'local') A.toast(`WAIT FOR ${name(S.turn)}`);
      return;
    }
    if (dropRow(S.grid, c) < 0) { Sound.error(); A.toast('THAT COLUMN IS FULL'); return; }
    play(c);
    if (S.mode === 'online') Net.send({ type: 'move', col: c, round: S.round });
  }
  function play(c) {
    const r = dropRow(S.grid, c);
    if (r < 0) return;
    const p = S.turn;
    S.grid[r][c] = p;
    S.last = { r, c };
    if (winner(S.grid) === p) {
      S.over = true; S.winner = p; S.winCells = winCells(S.grid, p); S.wins[p]++;
    } else if (!validCols(S.grid).length) {
      S.over = true; S.winner = 0; S.draws++;
    } else {
      S.turn = 3 - p;
    }
    Sound.drop();
    render();
    if (S.over) {
      const round = S.round;
      setTimeout(() => {
        if (S.round !== round) return;
        if (!S.winner) Sound.draw();
        else if (S.mode === 'local' || (S.mode === 'cpu' ? S.winner === 1 : S.winner === S.mySide)) Sound.win();
        else Sound.lose();
        renderBanner();
      }, 450);
    } else if (S.mode === 'cpu' && S.turn === 2) {
      clearTimeout(S.cpuTimer);
      S.cpuTimer = setTimeout(cpuMove, 650 + rand(500));
    }
  }
  function startRound() {
    S.grid = newGrid();
    S.turn = S.round % 2 === 0 ? 1 : 2; // the first move alternates
    S.over = false; S.winner = 0; S.winCells = []; S.last = null;
    S.phase = 'game';
    show('game');
    A.keepAwake();
    Sound.start();
    render();
    if (S.mode === 'cpu' && S.turn === 2) { clearTimeout(S.cpuTimer); S.cpuTimer = setTimeout(cpuMove, 900); }
  }
  function playAgain() {
    if (!S.over) return;
    S.round++;
    if (S.mode === 'online') Net.send({ type: 'again', round: S.round });
    startRound();
  }

  /* ---------- drawing ---------- */
  function show(name2) { for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + name2; window.scrollTo(0, 0); }
  const board = $('#board');
  const cols = [];
  for (let c = 0; c < C; c++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'col';
    b.setAttribute('aria-label', `Column ${c + 1}`);
    for (let r = 0; r < R; r++) b.insertAdjacentHTML('beforeend', '<span class="slot"><span class="hole"></span></span>');
    b.addEventListener('click', () => tapCol(c));
    b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { S.hoverCol = c; renderBoard(); } });
    board.appendChild(b);
    cols.push(b);
  }
  board.addEventListener('pointerleave', () => { S.hoverCol = null; renderBoard(); });

  function renderBoard() {
    const live = canMove();
    board.classList.toggle('board-live', live);
    const ghostRow = live && S.hoverCol != null ? dropRow(S.grid, S.hoverCol) : -1;
    const win = new Set(S.winCells);
    cols.forEach((col, c) => {
      col.disabled = !live || !!S.grid[0][c];
      [...col.children].forEach((slot, r) => {
        const v = S.grid[r][c];
        slot.className = 'slot' + (v ? ' p' + v : '');
        if (v) slot.style.setProperty('--pc', S.players[v].color);
        if (S.last && S.last.r === r && S.last.c === c) {
          slot.classList.add('drop');
          slot.style.setProperty('--fall', r + 1);
          slot.style.setProperty('--t', (0.12 + r * 0.05) + 's');
        }
        if (win.has(r * C + c)) slot.classList.add('win');
        if (!v && c === S.hoverCol && r === ghostRow) { slot.classList.add('ghost'); slot.style.setProperty('--pc', S.players[S.turn].color); }
      });
    });
  }
  function renderScores() {
    const who = (p) => {
      if (S.mode === 'cpu') return p === 1 ? 'YOU' : `CPU - ${S.level.toUpperCase()}`;
      if (S.mode === 'online') return p === S.mySide ? 'YOU' : 'FRIEND';
      return '&nbsp;';
    };
    for (const p of [1, 2]) {
      const el = $('#score-' + p);
      el.style.setProperty('--pc', S.players[p].color);
      el.innerHTML = `<span class="who">${who(p)}</span><span class="name">${esc(name(p))}</span><span class="big">${S.wins[p]} ${S.wins[p] === 1 ? 'WIN' : 'WINS'}</span>`;
      el.classList.toggle('active', !S.over && S.turn === p);
    }
    $('#draws').textContent = S.draws ? `DRAWS: ${S.draws}` : '';
  }
  function renderBanner() {
    const b = $('#turn-banner');
    if (S.over) {
      let text;
      if (!S.winner) text = "IT'S A DRAW!";
      else if (S.mode === 'local') text = `${chip(S.winner)} WINS!`;
      else if (S.mode === 'cpu') text = S.winner === 1 ? 'YOU WIN!' : 'COMPUTER WINS!';
      else text = S.winner === S.mySide ? 'YOU WIN!' : `${chip(S.winner)} WINS!`;
      b.innerHTML = `<span>${text}</span>`;
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn btn-primary';
      again.textContent = 'PLAY AGAIN';
      again.addEventListener('click', () => { Sound.click(); playAgain(); });
      const menu = document.createElement('button');
      menu.type = 'button';
      menu.className = 'btn btn-small';
      menu.textContent = 'MENU';
      menu.addEventListener('click', () => { Sound.click(); goMenu(); });
      b.append(again, menu);
      return;
    }
    if (S.mode === 'local') b.innerHTML = `<span class="blink">${chip(S.turn)}'S TURN</span>`;
    else if (canMove()) b.innerHTML = `<span class="blink">YOUR TURN ${chip(S.turn)}</span>`;
    else b.innerHTML = `${chip(S.turn)} ${S.mode === 'cpu' ? 'IS THINKING...' : 'IS CHOOSING...'}`;
  }
  function render() { renderBoard(); renderScores(); if (!S.over) renderBanner(); else $('#turn-banner').innerHTML = ''; }

  /* ---------- modes ---------- */
  function reset(mode) {
    clearTimeout(S.cpuTimer);
    Object.assign(S, { mode, round: 0, wins: { 1: 0, 2: 0 }, draws: 0, hoverCol: null });
  }
  function startCPU(level) {
    reset('cpu');
    S.level = level || 'easy';
    S.players = { 1: A.PLAYERS[0], 2: A.CPU };
    startRound();
  }
  function startLocal() {
    reset('local');
    S.players = { 1: A.PLAYERS[0], 2: A.PLAYERS[1] };
    startRound();
  }
  function startOnline(code) {
    A.online({
      game: 'four',
      code,
      onConnected(isHost) {
        reset('online');
        S.mySide = isHost ? 1 : 2;
        S.players = { 1: A.PLAYERS[0], 2: A.PLAYERS[1] };
        startRound();
      },
      onData(m) {
        if (S.mode !== 'online') return;
        if (m.type === 'move' && !S.over && S.turn !== S.mySide && m.round === S.round && Number.isInteger(m.col) && m.col >= 0 && m.col < C) play(m.col);
        else if (m.type === 'again' && S.over && m.round === S.round + 1) { S.round++; startRound(); }
      },
      onClose(left) {
        if (S.mode !== 'online') return;
        const me = S.mySide, op = 3 - S.mySide;
        S.phase = 'lost';
        A.connectionLost(left, `${name(me)} ${S.wins[me]} - ${S.wins[op]} ${name(op)}`, goMenu);
      },
    });
  }
  function goMenu() {
    if (S.mode === 'online') Net.leave();
    clearTimeout(S.cpuTimer);
    S.mode = null;
    S.phase = 'title';
    A.releaseAwake();
    A.hideOverlay();
    show('title');
  }

  $('#title-art').innerHTML = A.sprite('four');
  A.modeMenu($('#modes'), {
    game: 'four',
    onPick(mode, level) {
      if (mode === 'solo') startCPU(level);
      else if (mode === 'local') startLocal();
      else startOnline('');
    },
  });
  A.initHeader();
  A.setGuard(() => S.phase === 'game' && !S.over);
  const room = A.roomFromUrl();
  if (room) startOnline(room);
})();
