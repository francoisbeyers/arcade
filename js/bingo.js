(() => {
  'use strict';
  const A = window.Arcade;
  const { $, esc, rand, shuffle, Sound, Room } = A;

  const PICS = A.BINGO_PICS; // 24 pictures
  const WORD = A.PIC_WORDS;
  const COLOURS = A.COLOURS; // up to 8 players
  const FREE = 'free';
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const FULL = [[0, 1, 2, 3, 4, 5, 6, 7, 8]];
  const SPEEDS = { slow: 9000, medium: 6500, fast: 4500 };
  const patterns = (rule) => (rule === 'full' ? FULL : LINES);

  function show(n) { for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + n; window.scrollTo(0, 0); }
  function primeSpeech() { // iPhones only allow speech after a tap, so say nothing once while we have one
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } catch (e) { /* no speech */ }
  }
  const chip = (p, extra = '') => `<span class="chip${extra}" style="--pc:${p.color}">${esc(p.name)}</span>`;

  /* ================= this device's player view =================
     Every device (the host too) shows one card and gets the same messages. */
  const C = {
    phase: 'title', mode: null, // solo | host | guest
    card: [], marks: new Set([4]), called: [], current: null, fresh: false, rule: 'line', round: 0,
    players: [], you: 0, over: false, paused: false, allCalled: false, claimWait: false, winLine: [], room: '',
  };

  function clientOn(m) {
    switch (m.type) {
      case 'lobby':
        C.players = m.players; C.you = m.you;
        if (C.phase === 'lobby' && C.mode === 'guest') guestLobby();
        else if (C.phase === 'game') renderPlayers();
        break;
      case 'deal':
        Object.assign(C, {
          card: m.card, marks: new Set([4]), called: [], current: null, rule: m.rule, round: m.round,
          players: m.players, you: m.you, over: false, paused: false, allCalled: false, claimWait: false, winLine: [],
        });
        C.phase = 'game';
        A.hideOverlay();
        show('game');
        buildCard();
        A.keepAwake();
        Sound.start();
        render();
        break;
      case 'call':
        if (m.round !== C.round || C.over || !WORD[m.item]) return;
        C.called.push(m.item);
        C.current = m.item;
        C.fresh = true;
        Sound.flip();
        if (!Sound.muted) A.speak(WORD[m.item].toLowerCase());
        render();
        break;
      case 'pause': C.paused = !!m.paused; render(); break;
      case 'allcalled': if (m.round === C.round) { C.allCalled = true; render(); } break;
      case 'nope': C.claimWait = false; Sound.error(); A.toast('NOT YET! CHECK YOUR CARD'); render(); break;
      case 'win':
        if (m.round !== C.round) return;
        C.over = true;
        C.claimWait = false;
        showWin(m);
        break;
      default: break;
    }
  }
  function toHost(m) { if (C.mode === 'guest') Room.send(m); else Host.claim('me', m); }

  /* ---------- card ---------- */
  const cardEl = $('#card');
  let tiles = [];
  function buildCard() {
    cardEl.innerHTML = '';
    tiles = C.card.map((pic, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tile' + (pic === FREE ? ' free' : '');
      b.innerHTML = pic === FREE ? 'FREE' : A.sprite(pic);
      b.setAttribute('aria-label', pic === FREE ? 'Free square' : WORD[pic]);
      b.addEventListener('click', () => tapTile(i));
      cardEl.appendChild(b);
      return b;
    });
  }
  function tapTile(i) {
    if (C.over || C.phase !== 'game') return;
    const pic = C.card[i];
    if (pic === FREE || C.marks.has(i)) return;
    if (!C.called.includes(pic)) {
      Sound.error();
      A.toast('NOT CALLED YET!');
      const t = tiles[i];
      t.classList.remove('shake');
      void t.offsetWidth;
      t.classList.add('shake');
      return;
    }
    C.marks.add(i);
    Sound.place();
    render();
  }
  const hasPattern = () => patterns(C.rule).some((L) => L.every((i) => C.marks.has(i)));
  function pressBingo() {
    if (C.over || C.claimWait || !hasPattern()) return;
    C.claimWait = true;
    Sound.click();
    toHost({ type: 'claim', round: C.round });
    render();
    setTimeout(() => { if (C.claimWait) { C.claimWait = false; render(); } }, 4000);
  }

  /* ---------- drawing ---------- */
  const me = () => C.players.find((p) => p.id === C.you) || COLOURS[0];
  function renderPlayers() {
    $('#players').innerHTML = C.players.map((p) => chip(p, (p.id === C.you ? ' me' : '') + (p.cpu ? ' cpu' : ''))).join('');
  }
  function renderCaller() {
    const box = $('#caller-pic');
    if (C.current) {
      box.className = 'caller-box' + (C.fresh ? ' new' : '');
      box.innerHTML = A.sprite(C.current);
      $('#caller-word').textContent = WORD[C.current];
      $('#caller-count').textContent = `PICTURE ${C.called.length} OF ${PICS.length}`;
    } else {
      box.className = 'caller-box empty';
      box.textContent = '?';
      $('#caller-word').textContent = 'GET READY!';
      $('#caller-count').textContent = '';
    }
    C.fresh = false;
    const prev = C.called.slice(0, -1).slice(-8).reverse();
    $('#called-strip').innerHTML = prev.length ? `<span class="lbl-prev">ALREADY CALLED:</span>${prev.map((p) => `<i title="${WORD[p]}">${A.sprite(p)}</i>`).join('')}` : '';
  }
  function renderCard() {
    const col = me().color;
    tiles.forEach((t, i) => {
      t.style.setProperty('--pc', col);
      t.classList.toggle('marked', C.marks.has(i));
      t.classList.toggle('win', C.winLine.includes(i));
    });
    const b = $('#bingo-btn');
    b.disabled = C.over || C.claimWait || !hasPattern();
    b.textContent = C.claimWait ? 'CHECKING...' : 'BINGO!';
    const pause = $('#pause-btn');
    pause.hidden = C.mode === 'guest' || C.over;
    pause.textContent = C.paused ? 'CARRY ON' : 'PAUSE';
  }
  function renderBanner() {
    const b = $('#bingo-banner');
    if (C.over) {
      if (C.mode === 'guest') { b.innerHTML = '<span class="blink">WAITING FOR THE NEXT GAME...</span>'; return; }
      b.innerHTML = '';
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn btn-primary';
      again.textContent = 'PLAY AGAIN';
      again.addEventListener('click', () => { Sound.click(); Host.startRound(); });
      b.appendChild(again);
      return;
    }
    if (C.paused) b.textContent = 'PAUSED';
    else if (hasPattern()) b.innerHTML = '<span class="blink">YOU HAVE BINGO! PRESS THE BUTTON!</span>';
    else if (C.allCalled) b.textContent = 'ALL PICTURES CALLED!';
    else if (!C.current) b.textContent = 'LOOK AT YOUR CARD...';
    else b.textContent = 'GOT IT? TAP IT!';
  }
  function render() { renderPlayers(); renderCaller(); renderCard(); renderBanner(); }

  function showWin(m) {
    const winner = { name: m.name, color: m.color };
    const mine = m.winner === C.you;
    if (mine) C.winLine = m.line || [];
    render();
    if (mine) Sound.win(); else Sound.draw();
    if (!Sound.muted) A.speak(mine ? 'Bingo! You win!' : `Bingo! ${m.name.toLowerCase()} wins!`);
    const pics = (m.pics || []).map((p) => `<i>${p === FREE ? 'FREE' : (WORD[p] ? A.sprite(p) : '')}</i>`).join('');
    const hostName = (C.players[0] || COLOURS[0]).name;
    A.showOverlay({
      title: mine ? 'BINGO! YOU WIN!' : `${m.name} WINS!`,
      cls: 'win',
      body: `<p>${chip(winner)} SHOUTED BINGO!</p>
        <div class="win-line">${pics}</div>
        ${C.mode === 'guest' ? `<p class="blink">WAITING FOR ${esc(hostName)} TO START THE NEXT GAME...</p>` : ''}`,
      actions: C.mode === 'guest'
        ? [{ label: 'SEE MY CARD', onClick: A.hideOverlay }, { label: 'LEAVE', onClick: goMenu }]
        : [{ label: 'PLAY AGAIN', primary: true, onClick: () => { A.hideOverlay(); Host.startRound(); } },
          { label: 'SEE MY CARD', onClick: A.hideOverlay }, { label: 'MENU', onClick: goMenu }],
    });
  }

  /* ================= the caller (host device, or this device in a 1-player game) ================= */
  const Host = {
    players: [], pool: [], called: [], round: 0, over: true, timer: null, paused: false, rule: 'line', speed: SPEEDS.slow,
    reset() { clearTimeout(this.timer); this.players = []; this.round = 0; this.over = true; this.paused = false; },
    addPlayer(id, cpu = false) {
      const used = new Set(this.players.map((p) => p.ci));
      const ci = COLOURS.findIndex((c, i) => !used.has(i));
      if (ci < 0) return null;
      const p = { id, ci, cpu, name: COLOURS[ci].name, color: COLOURS[ci].color, card: [], marks: new Set(), round: 0 };
      this.players.push(p);
      return p;
    },
    removePlayer(id) {
      const p = this.players.find((x) => x.id === id);
      this.players = this.players.filter((x) => x.id !== id);
      return p;
    },
    publicPlayers() { return this.players.map((p) => ({ id: p.ci, name: p.name, color: p.color, cpu: p.cpu })); },
    to(p, m) {
      if (p.id === 'me') setTimeout(() => clientOn(m), 0);
      else if (p.cpu) CPU.on(p, m);
      else Room.sendTo(p.id, m);
    },
    all(m) { for (const p of this.players) this.to(p, m); },
    sendLobby() { const pub = this.publicPlayers(); for (const p of this.players) this.to(p, { type: 'lobby', players: pub, you: p.ci }); },
    makeCard() { const pics = shuffle(PICS.slice()).slice(0, 8); pics.splice(4, 0, FREE); return pics; },
    startRound() {
      clearTimeout(this.timer);
      this.round++;
      this.pool = shuffle(PICS.slice());
      this.called = [];
      this.over = false;
      this.paused = false;
      Room.lock(true);
      const pub = this.publicPlayers();
      for (const p of this.players) {
        p.card = this.makeCard();
        this.to(p, { type: 'deal', card: p.card, rule: this.rule, round: this.round, players: pub, you: p.ci });
      }
      this.timer = setTimeout(() => this.tick(), 3500);
    },
    tick() {
      if (this.over || this.paused) return;
      if (!this.pool.length) { this.all({ type: 'allcalled', round: this.round }); return; }
      const item = this.pool.shift();
      this.called.push(item);
      this.all({ type: 'call', item, round: this.round });
      this.timer = setTimeout(() => this.tick(), this.speed);
    },
    setPause(v) {
      if (this.over) return;
      this.paused = v;
      clearTimeout(this.timer);
      this.all({ type: 'pause', paused: v });
      if (!v) this.timer = setTimeout(() => this.tick(), 1500);
    },
    // A player pressed BINGO: check their card against the pictures actually called.
    claim(id, m) {
      if (this.over || !m || m.round !== this.round) return;
      const p = this.players.find((x) => x.id === id);
      if (!p) return;
      const line = patterns(this.rule).find((L) => L.every((i) => p.card[i] === FREE || this.called.includes(p.card[i])));
      if (!line) { this.to(p, { type: 'nope' }); return; }
      this.over = true;
      clearTimeout(this.timer);
      Room.lock(false); // friends can join between games
      this.all({ type: 'win', winner: p.ci, name: p.name, color: p.color, line, pics: line.map((i) => p.card[i]), round: this.round });
    },
  };

  /* ---------- computer players ---------- */
  const CPU = {
    on(p, m) {
      if (m.type === 'deal') { p.marks = new Set([4]); p.round = m.round; return; }
      if (m.type !== 'call' || m.round !== p.round) return;
      const i = p.card.indexOf(m.item);
      if (i < 0) return;
      setTimeout(() => {
        if (Host.over || Host.round !== p.round) return;
        p.marks.add(i);
        if (patterns(Host.rule).some((L) => L.every((j) => p.marks.has(j)))) {
          setTimeout(() => Host.claim(p.id, { type: 'claim', round: p.round }), 1200 + rand(2000));
        }
      }, Host.speed * (0.3 + Math.random() * 0.35)); // slower calling means slower bots, giving children time to spot it
    },
  };

  /* ================= starting games ================= */
  function setOptions() {
    Host.rule = ruleChoice.get();
    Host.speed = SPEEDS[speedChoice.get()] || SPEEDS.slow;
  }
  function startSolo() {
    goMenu(true);
    primeSpeech();
    C.mode = 'solo';
    Host.reset();
    setOptions();
    Host.addPlayer('me');
    const n = parseInt(cpuChoice.get(), 10) || 2;
    for (let k = 1; k <= n; k++) Host.addPlayer('cpu' + k, true);
    Host.startRound();
  }

  function friendsMenu(msg = '', prefill = '') {
    if (typeof window.Peer !== 'function') {
      A.showOverlay({ title: 'PLAY WITH FRIENDS', body: "<p>PLAYING WITH FRIENDS NEEDS THE INTERNET. CHECK YOUR CONNECTION AND TRY AGAIN.</p>", actions: [{ label: 'OK', primary: true, onClick: () => goMenu() }] });
      return;
    }
    A.showOverlay({
      title: 'PLAY WITH FRIENDS',
      body: `<p>ONE PERSON STARTS A ROOM. EVERYONE ELSE TYPES IN THE ROOM NUMBER ON THEIR OWN PHONE OR TABLET.</p>
        <button type="button" class="btn btn-primary" data-start>START A ROOM</button>
        <div class="or">- OR -</div>
        <label>ROOM NUMBER<input class="code-input" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="0000" data-code></label>
        <button type="button" class="btn" data-join>JOIN ROOM</button>
        <p class="msg" role="status">${esc(msg)}</p>`,
      actions: [{ label: 'CANCEL', onClick: () => goMenu() }],
    });
    const input = $('#ov-body [data-code]');
    input.value = prefill;
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); });
    const join = () => {
      if (input.value.length !== 4) { Sound.error(); $('#ov-body .msg').textContent = 'TYPE THE 4-DIGIT ROOM NUMBER.'; return; }
      Sound.click();
      primeSpeech();
      joinRoom(input.value);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    $('#ov-body [data-join]').addEventListener('click', join);
    $('#ov-body [data-start]').addEventListener('click', () => { Sound.click(); primeSpeech(); hostRoom(); });
    if (prefill) $('#ov-body [data-join]').classList.add('btn-primary');
  }

  function hostRoom() {
    A.showOverlay({ title: 'STARTING ROOM...', body: '<div class="radar"></div>', actions: [{ label: 'CANCEL', onClick: () => goMenu() }] });
    Host.reset();
    setOptions();
    C.mode = 'host';
    Host.addPlayer('me');
    Room.host('bingo', 8, {
      onRoom(code) { C.room = code; C.phase = 'lobby'; A.clearRoomFromUrl(); hostLobby(); A.keepAwake(); },
      onJoin(id) {
        const p = Host.addPlayer(id);
        if (!p) return;
        Sound.join();
        A.toast(`${p.name} JOINED!`);
        Host.sendLobby();
        if (C.phase === 'lobby') hostLobby();
      },
      onData(m, id) { if (m.type === 'claim') Host.claim(id, m); },
      onLeave(id) {
        const p = Host.removePlayer(id);
        if (p) { A.toast(`${p.name} LEFT`); Host.sendLobby(); }
        if (C.phase === 'lobby') hostLobby();
      },
      onError(msg) { Sound.error(); friendsMenu(msg); },
    });
  }
  function hostLobby() {
    const url = `${location.origin}${location.pathname}?room=${C.room}`;
    const pub = Host.publicPlayers();
    A.showOverlay({
      title: 'YOUR ROOM',
      body: `<p>TELL YOUR FRIENDS THIS NUMBER:</p>
        <div class="room-number">${C.room}</div>
        <p>PLAYERS (${pub.length} OF 8):</p>
        <div class="lobby-list">${pub.map((p, i) => chip(p, i === 0 ? ' me' : '')).join('')}</div>
        ${pub.length < 2 ? '<p class="blink">WAITING FOR FRIENDS TO JOIN...</p>' : '<p>PRESS START WHEN EVERYONE IS IN!</p>'}
        <button type="button" class="btn btn-small" data-share>SEND INVITE LINK</button>
        <p class="msg" data-share-msg></p>`,
      actions: [
        { label: 'CANCEL', onClick: () => goMenu() },
        { label: 'START GAME', primary: true, id: 'start-game', onClick: () => { if (Host.players.length >= 2) Host.startRound(); } },
      ],
    });
    $('#start-game').disabled = pub.length < 2;
    $('#ov-body [data-share]').addEventListener('click', async () => {
      const text = `Come and play Picture Bingo! Room number ${C.room}`;
      Sound.click();
      if (navigator.share) { try { await navigator.share({ title: 'Picture Bingo', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
      try { await navigator.clipboard.writeText(url); $('#ov-body [data-share-msg]').textContent = 'LINK COPIED!'; } catch (e) { $('#ov-body [data-share-msg]').textContent = url; }
    });
  }

  function joinRoom(code) {
    A.showOverlay({ title: 'CONNECTING...', body: '<div class="radar"></div>', actions: [{ label: 'CANCEL', onClick: () => goMenu() }] });
    Room.join('bingo', code, {
      onConnect() { C.mode = 'guest'; C.phase = 'lobby'; A.clearRoomFromUrl(); Sound.join(); A.keepAwake(); guestLobby(); },
      onData(m) { clientOn(m); },
      onClose(left) {
        if (C.phase === 'title') return;
        C.phase = 'lost';
        A.connectionLost(left, '', () => goMenu());
      },
      onError(msg) { Sound.error(); friendsMenu(msg, code); },
    });
  }
  function guestLobby() {
    const mine = me();
    A.showOverlay({
      title: "YOU'RE IN!",
      body: `${C.players.length ? `<p>YOU ARE ${chip(mine)}</p>
        <div class="lobby-list">${C.players.map((p) => chip(p, p.id === C.you ? ' me' : '')).join('')}</div>` : ''}
        <div class="radar"></div>
        <p class="blink">WAITING FOR ${esc((C.players[0] || COLOURS[0]).name)} TO START...</p>`,
      actions: [{ label: 'LEAVE', onClick: () => goMenu() }],
    });
  }

  function goMenu(quietly) {
    if (Room.peer) Room.leave();
    Host.reset();
    A.stopSpeaking();
    Object.assign(C, { phase: 'title', mode: null, over: false });
    if (quietly === true) return;
    A.releaseAwake();
    A.hideOverlay();
    show('title');
  }

  /* ================= picture guide ================= */
  const demo = ['duck', 'sun', 'car', 'cat', FREE, 'tree', 'ball', 'fish', 'moon'];
  const miniBingo = (marked = [], win = []) => `<div class="mini-bingo">${demo.map((p, i) =>
    `<i class="${marked.includes(i) ? 'mk' : ''}${win.includes(i) ? ' wn' : ''}">${p === FREE ? 'FREE' : A.sprite(p)}</i>`).join('')}</div>`;
  const GUIDE = [
    { title: 'EVERYONE GETS A CARD', text: 'Each player has their own card with 8 pictures. Everyone\'s card is different!', pic: miniBingo([4]) },
    { title: 'LOOK AND LISTEN', text: 'A picture pops up at the top and is read out loud.', pic: `<div class="caller-box">${A.sprite('duck')}</div>` },
    { title: 'GOT IT? TAP IT!', text: 'If that picture is on your card, tap it to cover it.', pic: miniBingo([0, 4]) },
    { title: 'GET A LINE', text: 'Cover 3 in a row: across, down or slanted. The middle square is free!', pic: miniBingo([0, 4, 8], [0, 4, 8]) },
    { title: 'PRESS BINGO!', text: 'As soon as you have a line, press the big BINGO button. The first one to press it wins!', pic: A.sprite('trophy') },
    { title: 'PLAY WITH FRIENDS', text: 'One phone starts a room. Friends type the room number on their own phone or tablet. Up to 8 players!', pic: A.sprite('phones') },
  ];

  /* ================= wiring ================= */
  for (const el of document.querySelectorAll('[data-sprite]')) el.innerHTML = A.sprite(el.dataset.sprite);
  $('#title-art').innerHTML = A.sprite('bingo');
  const ruleChoice = A.choiceRow($('#rule-choice'), {
    key: 'bingo-rule', def: 'line',
    options: [{ value: 'line', label: 'A LINE' }, { value: 'full', label: 'THE WHOLE CARD' }],
  });
  const speedChoice = A.choiceRow($('#speed-choice'), {
    key: 'bingo-speed', def: 'slow',
    options: [{ value: 'slow', label: 'SLOW' }, { value: 'medium', label: 'MEDIUM' }, { value: 'fast', label: 'FAST' }],
  });
  const cpuChoice = A.choiceRow($('#cpu-choice'), {
    key: 'bingo-cpus', def: '2',
    options: [{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }],
  });
  $('#friends-btn').addEventListener('click', () => { Sound.click(); friendsMenu(); });
  $('#cpu-btn').addEventListener('click', () => { Sound.click(); startSolo(); });
  $('#bingo-btn').addEventListener('click', pressBingo);
  $('#pause-btn').addEventListener('click', () => { Sound.click(); Host.setPause(!Host.paused); });
  $('#how-btn').addEventListener('click', () => { Sound.click(); A.guide(GUIDE); });
  A.initHeader();
  A.setGuard(() => C.phase === 'lobby' || (C.phase === 'game' && !C.over));
  show('title');
  const room = A.roomFromUrl();
  if (room) friendsMenu('', room);
  else A.guideOnce('bingo', GUIDE);
})();
