(() => {
  'use strict';
  const A = window.Arcade;
  const { $, esc, shuffle, store, Sound, Net } = A;

  const SIZES = {
    small: { cols: 3, rows: 4 },
    medium: { cols: 4, rows: 4 },
    big: { cols: 4, rows: 6 },
  };

  const S = {
    mode: null, phase: 'title', size: 'small', mySide: 0, round: 0,
    deck: [], up: new Set(), owner: [], picks: [], turn: 1, scores: { 1: 0, 2: 0 }, wins: { 1: 0, 2: 0 },
    moves: 0, startT: 0, timerId: null, resolving: null, over: false, just: [],
    players: { 1: A.PLAYERS[0], 2: A.PLAYERS[1] },
  };
  const pairsFor = (size) => (SIZES[size].cols * SIZES[size].rows) / 2;
  const name = (p) => S.players[p].name;
  const chip = (p) => `<span class="pc" style="--pc:${S.players[p].color}">${esc(name(p))}</span>`;
  const fmtTime = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function newDeck(size) {
    const picks = shuffle(A.CARD_SPRITES.slice()).slice(0, pairsFor(size));
    return shuffle([...picks, ...picks]);
  }
  function show(n) { for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + n; window.scrollTo(0, 0); }

  /* ---------- round ---------- */
  function startRound(deck) {
    clearTimeout(S.resolving);
    clearInterval(S.timerId);
    Object.assign(S, {
      deck, up: new Set(), owner: deck.map(() => 0), picks: [], scores: { 1: 0, 2: 0 },
      moves: 0, startT: 0, timerId: null, resolving: null, over: false, just: [],
      turn: S.round % 2 === 0 ? 1 : 2, phase: 'game',
    });
    buildCards();
    show('game');
    A.keepAwake();
    Sound.start();
    render();
  }
  function canFlip() {
    if (S.phase !== 'game' || S.over || S.picks.length >= 2) return false;
    if (S.mode === 'online') return S.turn === S.mySide;
    return true;
  }
  function tap(i) {
    if (S.resolving) finishResolve(); // tapping during the pause skips it
    if (!canFlip()) {
      if (S.mode === 'online' && !S.over && S.phase === 'game') A.toast(`WAIT FOR ${name(S.turn)}`);
      return;
    }
    if (S.owner[i] || S.up.has(i)) return;
    flip(i);
    if (S.mode === 'online') Net.send({ type: 'flip', i, round: S.round });
  }
  function flip(i) {
    S.up.add(i);
    S.picks.push(i);
    S.just = [];
    Sound.flip();
    if (S.mode === 'solo' && !S.startT) {
      S.startT = Date.now();
      S.timerId = setInterval(renderScores, 1000);
    }
    if (S.picks.length === 2) {
      S.moves++;
      const [a, b] = S.picks;
      if (S.deck[a] === S.deck[b]) {
        S.owner[a] = S.owner[b] = S.mode === 'solo' ? 1 : S.turn;
        S.scores[S.owner[a]]++;
        S.up.delete(a); S.up.delete(b);
        S.picks = [];
        S.just = [a, b];
        setTimeout(() => Sound.match(), 120);
        if (S.owner.every((o) => o)) endRound();
      } else {
        setTimeout(() => { if (S.picks.length === 2) Sound.nomatch(); }, 300);
        S.resolving = setTimeout(finishResolve, 1200);
      }
    }
    render();
  }
  function finishResolve() {
    clearTimeout(S.resolving);
    S.resolving = null;
    for (const i of S.picks) S.up.delete(i);
    S.picks = [];
    S.just = [];
    if (S.mode !== 'solo') S.turn = 3 - S.turn;
    render();
  }
  function endRound() {
    S.over = true;
    clearInterval(S.timerId);
    const round = S.round;
    setTimeout(() => {
      if (S.round !== round || !S.over) return;
      if (S.mode === 'solo') soloResult();
      else duoResult();
    }, 700);
  }
  function stars(moves, pairs) {
    if (moves <= Math.ceil(pairs * 1.5)) return 3;
    if (moves <= Math.ceil(pairs * 2.2)) return 2;
    return 1;
  }
  function soloResult() {
    const pairs = pairsFor(S.size);
    const time = Date.now() - S.startT;
    const key = `mem-best-${S.size}`;
    const best = parseInt(store.get(key, '0'), 10) || 0;
    const record = !best || S.moves < best;
    if (record) store.set(key, String(S.moves));
    const n = stars(S.moves, pairs);
    Sound.win();
    A.showOverlay({
      title: 'ALL PAIRS FOUND!', cls: 'win',
      body: `<div style="display:flex;gap:10px;justify-content:center">${A.sprite('star').repeat(n).replace(/class="sprite /g, 'style="width:44px" class="sprite ')}</div>
        <p>${S.moves} GOES IN ${fmtTime(time)}</p>
        <p>${record ? '<span class="blink">NEW BEST!</span>' : `YOUR BEST: ${best} GOES`}</p>`,
      actions: [
        { label: 'PLAY AGAIN', primary: true, onClick: () => { A.hideOverlay(); again(); } },
        { label: 'MENU', onClick: goMenu },
      ],
    });
  }
  function duoResult() {
    const a = S.scores[1], b = S.scores[2];
    const w = a === b ? 0 : a > b ? 1 : 2;
    if (w) S.wins[w]++;
    let title;
    if (!w) title = "IT'S A DRAW!";
    else if (S.mode === 'online') title = w === S.mySide ? 'YOU WIN!' : `${name(w)} WINS!`;
    else title = `${name(w)} WINS!`;
    if (!w || S.mode === 'local' || w === S.mySide) Sound.win(); else Sound.lose();
    renderScores();
    A.showOverlay({
      title, cls: w && S.mode === 'online' && w !== S.mySide ? 'lose' : 'win',
      body: `${A.sprite(w ? S.players[w].sprite : 'duo').replace('class="sprite ', 'style="width:72px;margin:0 auto" class="sprite ')}
        <p>${chip(1)} ${a} PAIRS - ${b} PAIRS ${chip(2)}</p>
        <p>GAMES WON: ${S.wins[1]} - ${S.wins[2]}</p>
        <p id="ov-note"></p>`,
      actions: [
        { label: 'PLAY AGAIN', primary: true, id: 'ov-again', onClick: again },
        { label: 'MENU', onClick: goMenu },
      ],
    });
  }
  function again() {
    if (S.mode === 'online') {
      if (S.mySide === 1) { S.round++; deal(); A.hideOverlay(); }
      else {
        Net.send({ type: 'again', round: S.round });
        const b = $('#ov-again');
        if (b) { b.disabled = true; b.textContent = 'WAITING...'; }
      }
      return;
    }
    A.hideOverlay();
    S.round++;
    startRound(newDeck(S.size));
  }
  function deal() { // host only: shuffle and send the same deck to the friend
    const deck = newDeck(S.size);
    Net.send({ type: 'deal', size: S.size, deck, round: S.round });
    startRound(deck);
  }

  /* ---------- drawing ---------- */
  const grid = $('#cards');
  let cards = [];
  function buildCards() {
    const { cols, rows } = SIZES[S.size];
    grid.style.setProperty('--cols', cols);
    grid.style.setProperty('--rows', rows);
    grid.innerHTML = '';
    cards = S.deck.map((sp, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card';
      b.setAttribute('aria-label', `Card ${i + 1}`);
      b.innerHTML = `<span class="front">${A.sprite(sp)}</span>`;
      b.addEventListener('click', () => tap(i));
      grid.appendChild(b);
      return b;
    });
  }
  function renderCards() {
    const myGo = canFlip() || !!S.resolving;
    grid.classList.toggle('waiting', S.mode === 'online' && !S.over && S.turn !== S.mySide);
    cards.forEach((b, i) => {
      const o = S.owner[i];
      b.className = 'card' + (S.up.has(i) ? ' up' : '') + (o ? ' matched' : '') + (S.just.includes(i) ? ' just' : '');
      if (o) b.style.setProperty('--pc', S.mode === 'solo' ? 'var(--yellow)' : S.players[o].color);
      b.disabled = !!o || (!myGo && S.mode === 'online');
      b.setAttribute('aria-label', S.up.has(i) || o ? `Card ${i + 1}: ${S.deck[i]}` : `Card ${i + 1}: face down`);
    });
  }
  function renderScores() {
    const s1 = $('#score-1'), s2 = $('#score-2'), mid = $('#score-mid');
    if (S.mode === 'solo') {
      const best = parseInt(store.get(`mem-best-${S.size}`, '0'), 10) || 0;
      s1.style.setProperty('--pc', S.players[1].color);
      s2.style.setProperty('--pc', 'var(--yellow)');
      s1.innerHTML = `<span class="who">GOES</span><span class="big">${S.moves}</span><span class="row"><span>PAIRS</span><b>${S.scores[1]}/${pairsFor(S.size)}</b></span>`;
      s2.innerHTML = `<span class="who">TIME</span><span class="big">${fmtTime(S.startT ? Date.now() - S.startT : 0)}</span><span class="row"><span>BEST</span><b>${best || '-'}</b></span>`;
      s1.classList.remove('active'); s2.classList.remove('active');
      mid.textContent = '';
      return;
    }
    mid.textContent = 'VS';
    for (const p of [1, 2]) {
      const el = $('#score-' + p);
      el.style.setProperty('--pc', S.players[p].color);
      const who = S.mode === 'online' ? (p === S.mySide ? 'YOU' : 'FRIEND') : '&nbsp;';
      el.innerHTML = `<span class="who">${who}</span><span class="name">${esc(name(p))}</span><span class="big">${S.scores[p]} ${S.scores[p] === 1 ? 'PAIR' : 'PAIRS'}</span><span class="row"><span>WINS</span><b>${S.wins[p]}</b></span>`;
      el.classList.toggle('active', !S.over && S.turn === p);
    }
  }
  function renderBanner() {
    const b = $('#turn-banner');
    if (S.over) { b.textContent = 'WELL DONE!'; return; }
    if (S.mode === 'solo') b.textContent = S.picks.length === 1 ? 'NOW FIND ITS PAIR!' : 'TAP TWO CARDS';
    else if (S.mode === 'local') b.innerHTML = `<span class="blink">${chip(S.turn)}'S TURN</span>`;
    else b.innerHTML = S.turn === S.mySide ? `<span class="blink">YOUR TURN ${chip(S.turn)}</span>` : `${chip(S.turn)} IS LOOKING...`;
  }
  function render() { renderCards(); renderScores(); renderBanner(); }

  /* ---------- modes ---------- */
  function reset(mode) {
    clearTimeout(S.resolving);
    clearInterval(S.timerId);
    Object.assign(S, { mode, round: 0, wins: { 1: 0, 2: 0 }, size: sizeChoice.get(), players: { 1: A.PLAYERS[0], 2: A.PLAYERS[1] } });
  }
  function startSolo() { reset('solo'); startRound(newDeck(S.size)); }
  function startLocal() { reset('local'); startRound(newDeck(S.size)); }
  function startOnline(code) {
    A.online({
      game: 'memory',
      code,
      onConnected(isHost) {
        reset('online');
        S.mySide = isHost ? 1 : 2;
        if (isHost) deal();
        else { S.phase = 'connecting'; show('wait'); }
      },
      onData(m) {
        if (S.mode !== 'online') return;
        if (m.type === 'deal' && S.mySide === 2 && SIZES[m.size] && Array.isArray(m.deck)
          && m.deck.length === pairsFor(m.size) * 2 && m.deck.every((d) => A.CARD_SPRITES.includes(d))) {
          A.hideOverlay();
          S.size = m.size;
          S.round = m.round | 0;
          startRound(m.deck);
        } else if (m.type === 'flip' && m.round === S.round && Number.isInteger(m.i) && m.i >= 0 && m.i < S.deck.length) {
          if (S.resolving) finishResolve();
          if (S.over || S.turn === S.mySide || S.owner[m.i] || S.up.has(m.i)) return;
          flip(m.i);
        } else if (m.type === 'again' && S.mySide === 1 && S.over && m.round === S.round) {
          S.round++;
          A.hideOverlay();
          deal();
        }
      },
      onClose(left) {
        if (S.mode !== 'online') return;
        S.phase = 'lost';
        clearInterval(S.timerId);
        A.connectionLost(left, `GAMES WON: ${name(1)} ${S.wins[1]} - ${S.wins[2]} ${name(2)}`, goMenu);
      },
    });
  }
  function goMenu() {
    if (S.mode === 'online') Net.leave();
    clearTimeout(S.resolving);
    clearInterval(S.timerId);
    S.mode = null;
    S.phase = 'title';
    A.releaseAwake();
    A.hideOverlay();
    show('title');
  }

  const sizeChoice = A.choiceRow($('#size-choice'), {
    key: 'mem-size', def: 'small',
    options: [{ value: 'small', label: '12 EASY' }, { value: 'medium', label: '16' }, { value: 'big', label: '24 HARD' }],
  });
  $('#title-art').innerHTML = A.sprite('cards');
  A.modeMenu($('#modes'), {
    game: 'memory', soloSub: 'BEAT YOUR BEST', soloSprite: 'trophy', levels: false,
    onPick(mode) {
      if (mode === 'solo') startSolo();
      else if (mode === 'local') startLocal();
      else startOnline('');
    },
  });
  const GUIDE = [
    { title: 'TAP TWO CARDS', text: 'They turn over so you can see the pictures.',
      pic: A.miniCards(['duck', '?', 'cat', '?']) },
    { title: 'SAME PICTURE? KEEP THEM!', text: 'You found a pair! You keep it and have another go.',
      pic: A.miniCards(['duck*', '?', 'duck*', '?']) },
    { title: 'DIFFERENT? THEY TURN BACK', text: 'Try hard to remember where each picture was!',
      pic: `${A.miniCards(['cat', 'duck'])}<span class="arrow">&gt;</span>${A.miniCards(['?', '?'])}` },
    { title: 'FIND ALL THE PAIRS', text: 'On your own, find them in as few goes as you can. With a friend, whoever finds the most pairs wins!',
      pic: A.sprite('trophy') },
  ];
  A.initHeader();
  A.setGuard(() => (S.phase === 'game' && !S.over && (S.moves > 0 || S.mode === 'online')) || S.phase === 'connecting');
  $('#how-btn').addEventListener('click', () => { Sound.click(); A.guide(GUIDE); });
  const room = A.roomFromUrl();
  if (room) startOnline(room);
  else A.guideOnce('mem', GUIDE);
})();
