(() => {
  'use strict';

  /* ---------- constants ---------- */
  const SIZE = 10;
  const ROWS = 'ABCDEFGHIJ';
  const FLEET = [
    { id: 'carrier', name: 'CARRIER', len: 5 },
    { id: 'battleship', name: 'BATTLESHIP', len: 4 },
    { id: 'cruiser', name: 'CRUISER', len: 3 },
    { id: 'submarine', name: 'SUBMARINE', len: 3 },
    { id: 'destroyer', name: 'DESTROYER', len: 2 },
  ];
  const PEER_PREFIX = 'retro-battleships-v1-';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const CODE_LEN = 5;

  /* ---------- helpers ---------- */
  const $ = (s) => document.querySelector(s);
  const idx = (r, c) => r * SIZE + c;
  const coord = (r, c) => ROWS[r] + (c + 1);
  const shipById = (id) => FLEET.find((s) => s.id === id);
  const rand = (n) => Math.floor(Math.random() * n);
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const cleanName = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').trim().slice(0, 10);
  const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
  const inBounds = (r, c) => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  const countVal = (map, v) => { let n = 0; for (const x of map.values()) if (x === v) n++; return n; };
  const pct = (hits, shots) => (shots ? Math.round((hits / shots) * 100) : 0) + '%';

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };

  /* ---------- 8-bit sound (generated, no files) ---------- */
  const Sound = {
    ctx: null,
    muted: store.get('bs-muted', '0') === '1',
    ac() {
      if (this.muted) return null;
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone(freq, dur, o = {}) {
      const ac = this.ac(); if (!ac) return;
      const t = ac.currentTime + (o.delay || 0);
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(freq, t);
      if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
      const v = o.vol == null ? 0.05 : o.vol;
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(ac.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },
    noise(dur, o = {}) {
      const ac = this.ac(); if (!ac) return;
      const t = ac.currentTime + (o.delay || 0);
      const len = Math.max(1, Math.floor(ac.sampleRate * dur));
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      let hold = 0;
      for (let i = 0; i < len; i++) { if (i % 6 === 0) hold = Math.random() * 2 - 1; d[i] = hold; } // crunchy sample-and-hold
      const src = ac.createBufferSource();
      src.buffer = buf;
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.freq || 1200, t);
      if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(o.vol == null ? 0.25 : o.vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(ac.destination);
      src.start(t);
      src.stop(t + dur);
    },
    seq(notes, step, o = {}, start = 0) {
      notes.forEach((n, i) => { if (n) this.tone(n, step * 0.9, { ...o, delay: start + i * step }); });
    },
    click() { this.tone(990, 0.05, { vol: 0.03 }); },
    place() { this.tone(440, 0.06, { vol: 0.04 }); this.tone(660, 0.08, { vol: 0.04, delay: 0.06 }); },
    error() { this.tone(130, 0.18, { vol: 0.06 }); },
    fire() { this.tone(1400, 0.28, { slide: 140, vol: 0.04 }); },
    miss() { this.noise(0.45, { freq: 900, freqEnd: 150, vol: 0.22 }); this.tone(520, 0.2, { type: 'triangle', slide: 200, vol: 0.06, delay: 0.05 }); },
    hit() { this.noise(0.7, { freq: 3200, freqEnd: 90, vol: 0.4 }); this.tone(120, 0.45, { slide: 35, vol: 0.09, type: 'triangle' }); },
    sunk() { this.hit(); this.seq([523, 415, 330, 262, 196], 0.1, { vol: 0.045 }, 0.35); },
    ready() { this.seq([523, 784], 0.09, { vol: 0.04 }); },
    start() { this.seq([262, 330, 392, 523, 0, 392, 523], 0.09, { vol: 0.045 }); },
    join() { this.seq([392, 523, 659], 0.08, { vol: 0.04 }); },
    win() { this.seq([523, 523, 523, 659, 0, 587, 659, 784, 0, 1047], 0.12, { vol: 0.05 }); },
    lose() { this.seq([392, 370, 349, 330, 311, 294, 262], 0.2, { vol: 0.05, type: 'triangle' }); },
  };

  /* ---------- state ---------- */
  const S = {
    peer: null, conn: null, connOpen: false, isHost: false, room: '', joinTimer: null,
    myName: '', oppName: 'ENEMY',
    phase: 'title', // title | connecting | lobby | place | battle
    placement: {}, selected: null, dir: 'h', hover: null,
    game: 0, wins: { me: 0, opp: 0 },
  };
  function resetRound() {
    Object.assign(S, {
      myShots: new Map(), oppShots: new Map(), hitsOn: {}, mySunk: new Set(), enemySunk: new Map(),
      enemyReveal: null, myTurn: false, pending: false, aim: null, lastIn: null, lastOut: null,
      flashT: null, flashO: null, iReady: false, oppReady: false, over: false, won: false,
      wantRematch: false, oppRematch: false, log: [], selected: null, hover: null,
    });
  }
  resetRound();

  /* ---------- screens, overlay, toast ---------- */
  function show(name) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + name;
    window.scrollTo(0, 0);
  }
  let toastTimer = null;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }
  function showOverlay({ title, cls = '', body = '', actions = [] }) {
    const h = $('#ov-title');
    h.textContent = title;
    h.className = cls;
    $('#ov-body').innerHTML = body;
    const row = $('#ov-actions');
    row.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (a.primary ? ' btn-primary' : '');
      b.textContent = a.label;
      if (a.id) b.id = a.id;
      b.addEventListener('click', () => { Sound.click(); a.onClick(); });
      row.appendChild(b);
    }
    $('#overlay').hidden = false;
  }
  function hideOverlay() { $('#overlay').hidden = true; }

  /* ---------- keep the screen awake during a game ---------- */
  let wakeLock = null;
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* not supported or refused */ }
  }
  function releaseAwake() { try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (S.phase === 'place' || S.phase === 'battle' || S.phase === 'lobby')) keepAwake();
  });

  /* ---------- boards ---------- */
  function lbl(text, extra) {
    const d = document.createElement('div');
    d.className = 'lbl' + (extra ? ' ' + extra : '');
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
    if (onLeave) el.addEventListener('pointerleave', onLeave);
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
      if (id === except) continue;
      for (const [r, c] of shipCells(shipById(id).len, p.r, p.c, p.dir)) g[idx(r, c)] = id;
    }
    return g;
  }
  function canPlace(id, r, c, dir) {
    const occ = occupancy(id);
    return shipCells(shipById(id).len, r, c, dir).every(([rr, cc]) => inBounds(rr, cc) && !occ[idx(rr, cc)]);
  }
  // Nudge the ship back onto the board when tapping near an edge.
  function fitAnchor(len, r, c, dir) {
    return dir === 'h' ? { r, c: Math.min(c, SIZE - len) } : { r: Math.min(r, SIZE - len), c };
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
      for (const { i, seg } of segsFromCells(id, shipCells(s.len, p.r, p.c, p.dir))) map[i] = seg;
    }
    return map;
  }
  function applyShip(cell, seg) {
    if (seg) cell.classList.add('ship', 'dir-' + seg.dir, seg.end);
  }
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
  function randomPlacement() { S.placement = randomFleet(); }
  const allPlaced = () => FLEET.every((s) => S.placement[s.id]);

  /* ---------- placement screen ---------- */
  function enterPlacement() {
    resetRound();
    S.phase = 'place';
    hideOverlay();
    show('place');
    keepAwake();
    $('#place-vs').textContent = `ROUND ${S.game + 1}  -  VS ${S.oppName}${S.vsAI ? ' (' + AI.level.toUpperCase() + ')' : ''}`;
    renderPlace();
    if (S.vsAI) AI.newRound();
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
        toast("CAN'T PLACE IT THERE");
      }
    } else {
      const id = occupancy()[idx(r, c)];
      if (id) { S.dir = S.placement[id].dir; delete S.placement[id]; S.selected = id; Sound.click(); }
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

    $('#rotate-btn').textContent = S.dir === 'h' ? 'ROTATE: HORIZ' : 'ROTATE: VERT';
    for (const id of ['#rotate-btn', '#random-btn', '#clear-btn']) $(id).disabled = S.iReady;
    $('#ready-btn').disabled = !allPlaced() || S.iReady;

    let hint;
    if (S.iReady) hint = 'FLEET LOCKED IN.';
    else if (S.selected) hint = `TAP THE GRID TO PLACE YOUR ${shipById(S.selected).name} (${shipById(S.selected).len}).`;
    else if (allPlaced()) hint = 'ALL SHIPS PLACED. TAP A SHIP TO MOVE IT, OR PRESS READY.';
    else hint = 'TAP A SHIP BELOW, THEN TAP THE GRID.';
    $('#place-hint').textContent = hint;

    let rm = '';
    if (S.iReady) rm = S.oppReady ? 'STARTING...' : `WAITING FOR ${S.oppName}...`;
    else if (S.oppReady) rm = `${S.oppName} IS READY!`;
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
    // Host opens round 1, then the first shot alternates each round.
    S.myTurn = (S.game % 2 === 0) === S.isHost;
    S.pending = false;
    show('battle');
    keepAwake();
    addLog(S.myTurn ? 'YOU FIRE FIRST. GOOD LUCK!' : `${S.oppName} FIRES FIRST.`);
    Sound.start();
    renderBattle();
    if (S.vsAI && !S.myTurn) AI.takeTurn(1400);
  }
  function addLog(text) {
    S.log.unshift(text);
    if (S.log.length > 5) S.log.length = 5;
  }
  function fireAt(r, c) {
    if (S.phase !== 'battle' || !S.myTurn || S.pending || S.over) {
      if (S.phase === 'battle' && !S.over && !S.myTurn) toast(`WAIT FOR ${S.oppName}`);
      return;
    }
    const i = idx(r, c);
    if (S.myShots.has(i)) { Sound.error(); return; }
    S.pending = true;
    S.aim = i;
    send({ type: 'shot', r, c });
    Sound.fire();
    renderBattle();
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
    send({ type: 'result', r: m.r, c: m.c, hit, sunk, cells, gameOver });

    S.lastIn = i;
    S.flashO = i;
    const at = coord(m.r, m.c);
    if (sunk) { addLog(`${S.oppName} SANK YOUR ${shipById(sunk).name}!`); Sound.sunk(); }
    else if (hit) { addLog(`${S.oppName} FIRED AT ${at} - HIT!`); Sound.hit(); }
    else { addLog(`${S.oppName} FIRED AT ${at} - MISS.`); Sound.miss(); }
    if (navigator.vibrate && hit) { try { navigator.vibrate(sunk ? [80, 60, 160] : 80); } catch (e) { /* ignore */ } }

    if (gameOver) endGame(false);
    else S.myTurn = true;
    renderBattle();
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
      addLog(`YOU SANK THE ENEMY ${shipById(m.sunk).name}!`);
      toast(`YOU SANK MY ${shipById(m.sunk).name}!`);
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
    setTimeout(() => {
      if (!S.over) return;
      won ? Sound.win() : Sound.lose();
      showGameOver();
    }, 1100);
  }
  function statsTable() {
    const me = { shots: S.myShots.size, hits: countVal(S.myShots, 'hit'), sunk: S.enemySunk.size };
    const op = { shots: S.oppShots.size, hits: countVal(S.oppShots, 'hit'), sunk: S.mySunk.size };
    return `<table class="stats">
      <thead><tr><th></th><td>YOU</td><td>${esc(S.oppName)}</td></tr></thead>
      <tbody>
        <tr><th>WINS</th><td>${S.wins.me}</td><td>${S.wins.opp}</td></tr>
        <tr><th>SHOTS</th><td>${me.shots}</td><td>${op.shots}</td></tr>
        <tr><th>HITS</th><td>${me.hits}</td><td>${op.hits}</td></tr>
        <tr><th>ACCURACY</th><td>${pct(me.hits, me.shots)}</td><td>${pct(op.hits, op.shots)}</td></tr>
        <tr><th>SHIPS SUNK</th><td>${me.sunk}/5</td><td>${op.sunk}/5</td></tr>
      </tbody></table>`;
  }
  function rematchNote() {
    if (S.wantRematch) return `<p>WAITING FOR ${esc(S.oppName)}...</p>`;
    if (S.oppRematch) return `<p class="blink">${esc(S.oppName)} WANTS A REMATCH!</p>`;
    return '<p>&nbsp;</p>';
  }
  function showGameOver() {
    showOverlay({
      title: S.won ? 'VICTORY!' : 'DEFEAT',
      cls: S.won ? 'win' : 'lose',
      body: `<p>${S.won ? 'YOU SANK THE WHOLE ENEMY FLEET.' : `${esc(S.oppName)} SANK YOUR FLEET.`}</p>${statsTable()}<div id="ov-note">${rematchNote()}</div>`,
      actions: [
        { label: S.wantRematch ? 'WAITING...' : 'REMATCH', primary: true, id: 'ov-rematch', onClick: requestRematch },
        { label: 'VIEW BOARDS', onClick: hideOverlay },
        { label: 'MENU', onClick: confirmMenu },
      ],
    });
    if (S.wantRematch) $('#ov-rematch').disabled = true;
  }
  function refreshGameOver() {
    const note = $('#ov-note');
    if (note) note.innerHTML = rematchNote();
    const b = $('#ov-rematch');
    if (b) { b.disabled = S.wantRematch; b.textContent = S.wantRematch ? 'WAITING...' : 'REMATCH'; }
    renderTurn();
  }
  function requestRematch() {
    if (!S.over || S.wantRematch) return;
    S.wantRematch = true;
    send({ type: 'rematch' });
    if (S.oppRematch) newRound(); else refreshGameOver();
  }
  function newRound() {
    S.game++;
    enterPlacement(); // keeps your last fleet layout as a starting point
    Sound.join();
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
  function scoreHtml(who, name, wins, shots, hits, sunk) {
    return `<span class="who">${who}</span>
      <span class="name">${esc(name)}</span>
      <span class="wins">${wins} ${wins === 1 ? 'WIN' : 'WINS'}</span>
      <span class="row"><span>HITS</span><b>${hits}/${shots}</b></span>
      <span class="row"><span>SUNK</span><b>${sunk}/5</b></span>`;
  }
  function renderScores() {
    const me = $('#score-me'), op = $('#score-opp');
    me.innerHTML = scoreHtml('YOU', S.myName || 'PLAYER', S.wins.me, S.myShots.size, countVal(S.myShots, 'hit'), S.enemySunk.size);
    op.innerHTML = scoreHtml(S.vsAI ? 'CPU - ' + AI.level.toUpperCase() : 'ENEMY', S.oppName, S.wins.opp, S.oppShots.size, countVal(S.oppShots, 'hit'), S.mySunk.size);
    me.classList.toggle('active', S.phase === 'battle' && !S.over && S.myTurn);
    op.classList.toggle('active', S.phase === 'battle' && !S.over && !S.myTurn);
  }
  function renderTurn() {
    const b = $('#turn-banner');
    b.className = 'turn-banner';
    if (S.over) {
      b.innerHTML = `<span>${S.won ? 'VICTORY!' : 'DEFEAT'}</span>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.textContent = S.wantRematch ? `WAITING FOR ${S.oppName}...` : S.oppRematch ? 'ACCEPT REMATCH' : 'REMATCH';
      btn.disabled = S.wantRematch;
      btn.addEventListener('click', () => { Sound.click(); requestRematch(); });
      b.appendChild(btn);
      return;
    }
    if (S.pending) { b.classList.add('mine'); b.textContent = 'FIRING...'; }
    else if (S.myTurn) { b.classList.add('mine'); b.innerHTML = '<span class="blink">YOUR TURN - FIRE!</span>'; }
    else { b.classList.add('theirs'); b.textContent = `${S.oppName} IS AIMING...`; }
  }

  /* ---------- networking (PeerJS / WebRTC) ---------- */
  function send(m) {
    if (S.vsAI) { AI.receive(m); return; }
    if (S.conn && S.conn.open) {
      try { S.conn.send(m); } catch (e) { console.warn('send failed', e); }
    }
  }
  function makeCode() {
    let s = '';
    for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[rand(CODE_CHARS.length)];
    return s;
  }
  function titleMsg(t) { $('#title-msg').textContent = t; }
  function setTitleBusy(busy) { $('#host-btn').disabled = busy; $('#join-btn').disabled = busy; }

  function saveName() {
    S.myName = cleanName($('#name-input').value) || 'PLAYER';
    $('#name-input').value = S.myName;
    store.set('bs-name', S.myName);
  }
  function peerAvailable() {
    if (typeof window.Peer === 'function') return true;
    titleMsg('COULD NOT LOAD THE NETWORK LIBRARY. CHECK YOUR CONNECTION AND RELOAD.');
    return false;
  }

  function hostGame() {
    if (!peerAvailable()) return;
    saveName();
    teardown(true);
    setTitleBusy(true);
    titleMsg('CREATING ROOM...');
    S.isHost = true;
    S.phase = 'connecting';
    const code = makeCode();
    S.room = code;
    const peer = new Peer(PEER_PREFIX + code, { debug: 1 });
    S.peer = peer;
    peer.on('open', () => {
      if (S.peer !== peer) return;
      S.phase = 'lobby';
      setTitleBusy(false);
      titleMsg('');
      $('#room-code').textContent = code;
      $('#share-msg').textContent = '';
      show('lobby');
      keepAwake();
    });
    peer.on('connection', (c) => {
      if (S.conn) { // room already has two players
        c.on('open', () => { try { c.send({ type: 'full' }); } catch (e) { /* ignore */ } setTimeout(() => c.close(), 400); });
        return;
      }
      attachConn(c);
    });
    peer.on('error', (err) => {
      if (S.peer !== peer) return;
      if (err.type === 'unavailable-id') { hostGame(); return; } // code collision: try another
      handlePeerError(err);
    });
    peer.on('disconnected', () => { if (S.peer === peer && !peer.destroyed && S.phase === 'lobby') peer.reconnect(); });
  }

  function joinGame() {
    if (!peerAvailable()) return;
    const code = cleanCode($('#code-input').value);
    $('#code-input').value = code;
    if (code.length !== CODE_LEN) { titleMsg(`ENTER THE ${CODE_LEN}-CHARACTER ROOM CODE.`); Sound.error(); return; }
    saveName();
    teardown(true);
    setTitleBusy(true);
    titleMsg('CONNECTING...');
    S.isHost = false;
    S.room = code;
    S.phase = 'connecting';
    const peer = new Peer({ debug: 1 });
    S.peer = peer;
    peer.on('open', () => {
      if (S.peer !== peer) return;
      const c = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      attachConn(c);
      S.joinTimer = setTimeout(() => {
        if (S.peer === peer && !S.connOpen) failToTitle("COULDN'T CONNECT. CHECK THE CODE AND TRY AGAIN.");
      }, 15000);
    });
    peer.on('error', (err) => {
      if (S.peer !== peer) return;
      if (err.type === 'peer-unavailable') failToTitle('ROOM NOT FOUND. CHECK THE CODE.');
      else handlePeerError(err);
    });
  }

  function attachConn(c) {
    S.conn = c;
    c.on('open', () => {
      if (S.conn !== c) return;
      S.connOpen = true;
      clearTimeout(S.joinTimer);
      send({ type: 'hello', name: S.myName, v: 1 });
    });
    c.on('data', (m) => { if (S.conn === c && m && typeof m === 'object') onData(m); });
    c.on('close', () => { if (S.conn === c) connectionLost(); });
    c.on('error', (e) => { console.warn('connection error', e); });
  }

  function onData(m) {
    switch (m.type) {
      case 'hello':
        S.oppName = cleanName(m.name) || 'ENEMY';
        if (S.phase === 'lobby' || S.phase === 'connecting') {
          setTitleBusy(false);
          titleMsg('');
          Sound.join();
          toast(`${S.oppName} JOINED!`);
          enterPlacement();
        }
        break;
      case 'full':
        failToTitle('THAT ROOM ALREADY HAS TWO PLAYERS.');
        break;
      case 'ready':
        if (S.phase !== 'place') return;
        S.oppReady = true;
        if (S.iReady) startBattle();
        else { toast(`${S.oppName} IS READY!`); renderPlace(); }
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
        else { toast(`${S.oppName} WANTS A REMATCH!`); refreshGameOver(); }
        break;
      case 'leave':
        connectionLost(true);
        break;
      default: break;
    }
  }

  function connectionLost(left) {
    if (S.phase === 'title') return;
    const wasConnecting = S.phase === 'connecting';
    teardown(false);
    if (wasConnecting) { failToTitle("COULDN'T CONNECT. TRY AGAIN."); return; }
    showOverlay({
      title: left ? 'ENEMY LEFT' : 'SIGNAL LOST',
      cls: 'lose',
      body: `<p>${left ? `${esc(S.oppName)} LEFT THE GAME.` : 'THE CONNECTION TO THE OTHER DEVICE DROPPED. THIS USUALLY MEANS A SCREEN WENT TO SLEEP OR THE PAGE WAS CLOSED.'}</p><p>FINAL SCORE: YOU ${S.wins.me} - ${S.wins.opp} ${esc(S.oppName)}</p>`,
      actions: [{ label: 'MAIN MENU', primary: true, onClick: () => goTitle() }],
    });
  }

  function handlePeerError(err) {
    console.warn('peer error', err && err.type, err);
    const type = err && err.type;
    if (S.connOpen) return; // signalling hiccups don't matter once the players are linked
    let msg = 'CONNECTION ERROR. PLEASE TRY AGAIN.';
    if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(type)) msg = "CAN'T REACH THE GAME SERVER. CHECK YOUR INTERNET CONNECTION.";
    else if (type === 'browser-incompatible' || type === 'webrtc') msg = "THIS BROWSER CAN'T MAKE PEER CONNECTIONS. TRY CHROME, SAFARI OR FIREFOX.";
    failToTitle(msg);
  }

  function failToTitle(msg) {
    teardown(true);
    goTitle(msg);
    Sound.error();
  }

  function teardown(resetScores) {
    clearTimeout(S.joinTimer);
    AI.stop();
    S.vsAI = false;
    const c = S.conn, p = S.peer;
    S.conn = null;
    S.peer = null;
    S.connOpen = false;
    try { if (c) c.close(); } catch (e) { /* ignore */ }
    try { if (p) p.destroy(); } catch (e) { /* ignore */ }
    if (resetScores) { S.wins = { me: 0, opp: 0 }; S.game = 0; S.oppName = 'ENEMY'; }
  }

  function goTitle(msg) {
    teardown(true);
    resetRound();
    S.phase = 'title';
    releaseAwake();
    hideOverlay();
    setTitleBusy(false);
    titleMsg(msg || '');
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
    show('title');
  }

  function confirmMenu() {
    const inGame = S.phase === 'place' || (S.phase === 'battle' && !S.over);
    if (inGame && !window.confirm('Leave this game? The other player will be told you left.')) return;
    send({ type: 'leave' });
    setTimeout(() => goTitle(), 150);
  }

  async function shareInvite() {
    const url = `${location.origin}${location.pathname}?room=${S.room}`;
    const text = `Join my Battleships game! Room code: ${S.room}`;
    Sound.click();
    if (navigator.share) {
      try { await navigator.share({ title: 'Battleships', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      $('#share-msg').textContent = 'INVITE LINK COPIED!';
    } catch (e) {
      $('#share-msg').textContent = url;
    }
  }

  /* ---------- computer opponent ----------
     Speaks the same messages as a networked player, so the rest of the game
     doesn't know the difference. Knowledge grid: 0 unknown, 1 miss, 2 hit, 3 sunk. */
  const AI = {
    level: ['easy', 'normal', 'hard'].includes(store.get('bs-level', 'normal')) ? store.get('bs-level', 'normal') : 'normal',
    gen: 0,
    fleet: {}, layout: [], hitsOn: {}, sunk: new Set(), shotAt: new Set(),
    know: [], remaining: [],

    stop() { this.gen++; },
    deliver(m, delay) {
      const g = this.gen;
      setTimeout(() => { if (g === this.gen && S.vsAI) onData(m); }, delay);
    },
    newRound() {
      this.gen++;
      this.fleet = randomFleet();
      this.layout = shipLayout(this.fleet);
      this.hitsOn = {};
      this.sunk = new Set();
      this.shotAt = new Set();
      this.know = new Array(SIZE * SIZE).fill(0);
      this.remaining = FLEET.map((s) => s.len);
      this.deliver({ type: 'ready' }, 900 + rand(900));
    },
    receive(m) {
      switch (m.type) {
        case 'shot': this.onPlayerShot(m.r, m.c); break;
        case 'result': this.onResult(m); break;
        case 'reveal': this.deliver({ type: 'reveal', placement: this.fleet }, 100); break;
        case 'rematch': this.deliver({ type: 'rematch' }, 400); break;
        default: break;
      }
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
      const i = idx(m.r, m.c);
      this.know[i] = m.hit ? 2 : 1;
      if (m.sunk && Array.isArray(m.cells)) {
        for (const [r, c] of m.cells) this.know[idx(r, c)] = 3;
        const len = shipById(m.sunk).len;
        const k = this.remaining.indexOf(len);
        if (k >= 0) this.remaining.splice(k, 1);
      }
    },
    takeTurn(delay) {
      const i = this.pickTarget();
      this.deliver({ type: 'shot', r: Math.floor(i / SIZE), c: i % SIZE }, delay);
    },

    unknownCells() { const out = []; this.know.forEach((v, i) => { if (v === 0) out.push(i); }); return out; },
    pickRandom(list) { return list[rand(list.length)]; },
    neighbours(i) {
      const r = Math.floor(i / SIZE), c = i % SIZE;
      return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([a, b]) => inBounds(a, b)).map(([a, b]) => idx(a, b));
    },
    pickTarget() {
      const unknown = this.unknownCells();
      if (this.level === 'easy') return this.pickRandom(unknown);
      if (this.level === 'hard') { const d = this.densityPick(); if (d != null) return d; }
      const t = this.targetPick();
      return t != null ? t : this.pickRandom(unknown);
    },
    // NORMAL: once something is hit, follow the line of hits, else try around them.
    targetPick() {
      const hits = [];
      this.know.forEach((v, i) => { if (v === 2) hits.push(i); });
      if (!hits.length) return null;
      const lineEnds = [];
      for (const h of hits) {
        const r = Math.floor(h / SIZE), c = h % SIZE;
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          const along = (sr, sc) => inBounds(sr, sc) && this.know[idx(sr, sc)] === 2;
          if (!along(r + dr, c + dc) && !along(r - dr, c - dc)) continue;
          let a = 1; while (along(r + dr * a, c + dc * a)) a++;
          let b = 1; while (along(r - dr * b, c - dc * b)) b++;
          for (const [er, ec] of [[r + dr * a, c + dc * a], [r - dr * b, c - dc * b]]) {
            if (inBounds(er, ec) && this.know[idx(er, ec)] === 0) lineEnds.push(idx(er, ec));
          }
        }
      }
      if (lineEnds.length) return this.pickRandom(lineEnds);
      const around = [];
      for (const h of hits) for (const n of this.neighbours(h)) if (this.know[n] === 0) around.push(n);
      return around.length ? this.pickRandom(around) : null;
    },
    // HARD: count every way the remaining ships could still fit and fire at the busiest square.
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

  function startCPU() {
    saveName();
    teardown(true);
    S.vsAI = true;
    S.isHost = true; // you fire first in round 1, then it alternates
    S.oppName = 'COMPUTER';
    titleMsg('');
    Sound.join();
    enterPlacement();
  }
  function paintLevels() {
    for (const b of document.querySelectorAll('.level')) b.setAttribute('aria-checked', String(b.dataset.level === AI.level));
  }

  /* ---------- wiring ---------- */
  function init() {
    buildBoard($('#place-board'), {
      onClick: onPlaceClick,
      onHover: (r, c) => { if (S.selected) { S.hover = { r, c }; renderPlace(); } },
      onLeave: () => { if (S.hover) { S.hover = null; renderPlace(); } },
    });
    buildBoard($('#target-board'), { onClick: fireAt });
    buildBoard($('#own-board'));

    $('#name-input').value = store.get('bs-name', '');
    $('#host-btn').addEventListener('click', () => { Sound.click(); hostGame(); });
    $('#join-btn').addEventListener('click', () => { Sound.click(); joinGame(); });
    $('#cpu-btn').addEventListener('click', () => { Sound.click(); startCPU(); });
    for (const b of document.querySelectorAll('.level')) {
      b.addEventListener('click', () => { AI.level = b.dataset.level; store.set('bs-level', AI.level); Sound.click(); paintLevels(); });
    }
    paintLevels();
    $('#code-input').addEventListener('input', (e) => { e.target.value = cleanCode(e.target.value); });
    $('#code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });
    $('#cancel-btn').addEventListener('click', () => { Sound.click(); goTitle(); });
    $('#share-btn').addEventListener('click', shareInvite);

    $('#rotate-btn').addEventListener('click', rotate);
    $('#random-btn').addEventListener('click', () => { if (S.iReady) return; randomPlacement(); S.selected = null; Sound.place(); renderPlace(); });
    $('#clear-btn').addEventListener('click', () => { if (S.iReady) return; S.placement = {}; S.selected = FLEET[0].id; Sound.click(); renderPlace(); });
    $('#ready-btn').addEventListener('click', pressReady);

    document.addEventListener('keydown', (e) => {
      if (S.phase === 'place' && (e.key === 'r' || e.key === 'R') && e.target.tagName !== 'INPUT') rotate();
      if (e.key === 'Escape' && !$('#overlay').hidden && S.over) hideOverlay();
    });

    const muteBtn = $('#mute-btn');
    const paintMute = () => { muteBtn.textContent = Sound.muted ? 'SND OFF' : 'SND ON'; };
    paintMute();
    muteBtn.addEventListener('click', () => {
      Sound.muted = !Sound.muted;
      store.set('bs-muted', Sound.muted ? '1' : '0');
      paintMute();
      Sound.click();
    });

    // Warn before closing the tab mid-game.
    window.addEventListener('beforeunload', (e) => {
      if (S.phase === 'place' || (S.phase === 'battle' && !S.over)) { e.preventDefault(); e.returnValue = ''; }
    });
    window.addEventListener('pagehide', (e) => { if (!e.persisted) send({ type: 'leave' }); });

    // Invite links: ?room=CODE
    const room = cleanCode(new URLSearchParams(location.search).get('room'));
    if (room.length === CODE_LEN) {
      $('#code-input').value = room;
      titleMsg('INVITE FOUND! ENTER YOUR NAME AND PRESS JOIN GAME.');
      $('#join-btn').classList.add('btn-primary');
      $('#host-btn').classList.remove('btn-primary');
    }
    show('title');
  }

  init();
})();
