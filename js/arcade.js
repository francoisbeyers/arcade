/* Pixel Arcade: shared helpers for every game.
   Sounds, storage, overlays, the pass-the-device screen, pixel sprites,
   the mode picker and the two-device (PeerJS) connection. */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const rand = (n) => Math.floor(Math.random() * n);
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };

  const PLAYERS = [
    { n: 1, name: 'BLUE', color: '#3cbcfc', sprite: 'kidBlue' },
    { n: 2, name: 'PINK', color: '#f878f8', sprite: 'kidPink' },
  ];
  const CPU = { n: 2, name: 'COMPUTER', color: '#bcbcbc', sprite: 'robot' };

  // While a game replays a move "as the other player" (one-device mode) we keep it silent.
  let quiet = false;

  /* ---------- 8-bit sound, generated in the browser ---------- */
  const Sound = {
    ctx: null,
    muted: store.get('arcade-muted', '0') === '1',
    ac() {
      if (this.muted || quiet) return null;
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
      g.gain.setValueAtTime(o.vol == null ? 0.05 : o.vol, t);
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
      for (let i = 0; i < len; i++) { if (i % 6 === 0) hold = Math.random() * 2 - 1; d[i] = hold; }
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
    draw() { this.seq([392, 392, 330, 330], 0.16, { vol: 0.05, type: 'triangle' }); },
    drop() { this.tone(700, 0.14, { slide: 180, vol: 0.05 }); this.noise(0.08, { freq: 1800, vol: 0.18, delay: 0.13 }); },
    flip() { this.tone(880, 0.05, { vol: 0.03 }); this.tone(1320, 0.05, { vol: 0.03, delay: 0.04 }); },
    match() { this.seq([659, 784, 1047], 0.08, { vol: 0.05 }); },
    nomatch() { this.tone(247, 0.14, { type: 'triangle', vol: 0.08 }); this.tone(196, 0.2, { type: 'triangle', vol: 0.08, delay: 0.12 }); },
  };

  /* ---------- pixel sprites ---------- */
  const PAL = {
    k: '#000000', w: '#fcfcfc', r: '#e8281c', R: '#a81000', o: '#f87800', y: '#fcd800', g: '#38c838', G: '#106c10',
    b: '#3cbcfc', B: '#0058f8', p: '#f878f8', P: '#8c3cd8', n: '#ac7c00', s: '#bcbcbc', S: '#5c5c5c', c: '#fcc8a0',
  };
  const SPRITES = {
    // memory cards
    apple: ['...nG...', '...n....', '.rrrrrr.', 'rrrrrwwr', 'rrrrrrwr', 'rrrrrrrr', '.rrrrrr.', '..rr.rr.'],
    cherry: ['....GG..', '...G.G..', '..G...G.', '.G....G.', 'rrr..rrr', 'rwr..rwr', 'rrr..rrr', '........'],
    star: ['...yy...', '...yy...', 'yyyyyyyy', '.yyyyyy.', '..yyyy..', '.yyyyyy.', '.yy..yy.', 'y......y'],
    heart: ['.pp..pp.', 'pppppppp', 'pwpppppp', 'pppppppp', '.pppppp.', '..pppp..', '...pp...', '........'],
    fish: ['........', '...bbb..', 'b.bbbbb.', 'bbbbbkbb', 'b.bbbbbb', '...bbb..', '........', '........'],
    crab: ['o.o..o.o', 'ooo..ooo', '.o.kk.o.', '..oooo..', '.oooooo.', 'oooooooo', '.o.o.o.o', 'o.......'],
    duck: ['..yyy...', '.yyky...', '.yyyyoo.', '..yy....', 'yyyyyyy.', 'yyyyyyyy', '.yyyyyy.', '........'],
    frog: ['.ww..ww.', '.wk..wk.', 'gggggggg', 'gGggggGg', 'gggGGggg', '.gggggg.', 'gg....gg', '........'],
    cat: ['k......k', 'kk....kk', 'kkkkkkkk', 'kyykkyyk', 'kkkkkkkk', 'kkkppkkk', '.kkkkkk.', '..k..k..'],
    rocket: ['...ss...', '..ssss..', '..sbbs..', '..sbbs..', '..ssss..', '.rssssr.', 'rr.oo.rr', '...yy...'],
    boat: ['...r....', '...rr...', '...rrr..', '...rrrr.', '...n....', 'nnnnnnnn', '.nnnnnn.', 'bbbbbbbb'],
    flower: ['..P..P..', '...PP...', '.PPyyPP.', '..PyyP..', '...PP...', '..P.GP..', '..GGG...', '....G...'],
    // menu icons
    ship: ['....r...', '....s...', '...sss..', '.ssssss.', 'wwwwwwww', '.SSSSSS.', 'bbbbbbbb', 'b.bb.bb.'],
    four: ['PPPPPPP', 'PkPkPbP', 'PPPPPPP', 'PkPpPbP', 'PPPPPPP', 'PpPbPbP', 'PPPPPPP'],
    cards: ['PPPP.wwww', 'PyyP.wppw', 'PyyP.wppw', 'PyyP.wppw', 'PPPP.wwww'],
    robot: ['...y...', 'sssssss', 'sbsssbs', 'sssssss', 'sskkkss', '.sssss.', 's.s.s.s'],
    kidBlue: ['..nnnn..', '.ncccc..', '.ckcckc.', '.cccccc.', '..cRRc..', '.bbbbbb.', 'bbbbbbbb', '.bb..bb.'],
    kidPink: ['..oooo..', '.occcco.', '.ckcckc.', 'occcccco', '..cRRc..', '.pppppp.', 'pppppppp', '.pp..pp.'],
    duo: ['.nn..oo.', '.cc..cc.', 'bbbbpppp', '.bb..pp.', '.b.b.p.p'],
    phones: ['SSS..SSS', 'SbS..SpS', 'SbS..SpS', 'SbS..SpS', 'SSS..SSS'],
    trophy: ['yyyyyyy', 'yyyyyyy', '.yyyyy.', '..yyy..', '...y...', '..yyy..', '.nnnnn.'],
  };
  const CARD_SPRITES = ['apple', 'cherry', 'star', 'heart', 'fish', 'crab', 'duck', 'frog', 'cat', 'rocket', 'boat', 'flower'];
  const spriteCache = {};
  function sprite(name, cls = '') {
    if (!spriteCache[name]) {
      const rows = SPRITES[name] || SPRITES.star;
      const w = Math.max(...rows.map((r) => r.length));
      let rects = '';
      rows.forEach((row, y) => {
        let x = 0;
        while (x < row.length) {
          const col = PAL[row[x]];
          let run = 1;
          while (x + run < row.length && row[x + run] === row[x]) run++;
          if (col) rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${col}"/>`;
          x += run;
        }
      });
      spriteCache[name] = { svg: rects, w, h: rows.length };
    }
    const s = spriteCache[name];
    return `<svg class="sprite ${cls}" viewBox="0 0 ${s.w} ${s.h}" shape-rendering="crispEdges" aria-hidden="true">${s.svg}</svg>`;
  }

  /* ---------- shared page chrome: overlay, handover, toast ---------- */
  document.body.insertAdjacentHTML('beforeend', `
    <div id="overlay" class="overlay" hidden><div class="panel modal" role="dialog" aria-modal="true" aria-labelledby="ov-title"><h2 id="ov-title"></h2><div id="ov-body"></div><div class="btn-row" id="ov-actions"></div></div></div>
    <div id="handover" class="handover" hidden></div>
    <div id="toast" class="toast" role="status"></div>`);

  let toastTimer = null;
  function toast(text) {
    if (quiet) return;
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }
  function showOverlay({ title, cls = '', body = '', actions = [] }) {
    $('#overlay .modal').classList.remove('guide');
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
  const overlayOpen = () => !$('#overlay').hidden;
  function confirmBox(title, body, yes = 'YES', no = 'NO') {
    return new Promise((resolve) => {
      showOverlay({
        title, body: `<p>${body}</p>`,
        actions: [
          { label: no, onClick: () => { hideOverlay(); resolve(false); } },
          { label: yes, primary: true, onClick: () => { hideOverlay(); resolve(true); } },
        ],
      });
    });
  }
  // Full-screen "pass the device" card, so the next player can't see the last player's secrets.
  function handover({ player, title, sub = '', button }) {
    return new Promise((resolve) => {
      const h = $('#handover');
      h.style.setProperty('--pc', player.color);
      h.innerHTML = `${sprite(player.sprite)}<h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}<button type="button" class="btn">${esc(button || `I'M ${player.name}!`)}</button>`;
      h.hidden = false;
      Sound.ready();
      h.querySelector('button').addEventListener('click', () => { h.hidden = true; Sound.click(); resolve(); }, { once: true });
      h.querySelector('button').focus();
    });
  }

  /* ---------- choice rows + mode picker ---------- */
  function choiceRow(el, { key, options, def, onChange }) {
    let value = store.get(key, def);
    if (!options.some((o) => o.value === value)) value = def;
    el.setAttribute('role', 'radiogroup');
    el.style.setProperty('--cols', options.length);
    el.innerHTML = '';
    const paint = () => { for (const b of el.children) b.setAttribute('aria-checked', String(b.dataset.value === value)); };
    for (const o of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'choice';
      b.setAttribute('role', 'radio');
      b.dataset.value = o.value;
      b.textContent = o.label;
      b.addEventListener('click', () => {
        value = o.value;
        store.set(key, value);
        Sound.click();
        paint();
        if (onChange) onChange(value);
      });
      el.appendChild(b);
    }
    paint();
    return { get: () => value };
  }

  // Three big buttons: 1 player, 2 players on one device, 2 players on two devices.
  function modeMenu(el, { game, soloLabel = '1 PLAYER', soloSub = 'VS COMPUTER', soloSprite = 'robot', levels = true, onPick }) {
    el.className = 'mode-list';
    el.innerHTML = `
      <button type="button" class="mode-btn" data-mode="solo">${sprite(soloSprite)}<span>${soloLabel}<small>${soloSub}</small></span></button>
      ${levels ? '<div class="option-group"><span class="field-label">COMPUTER LEVEL</span><div class="choice-row" data-levels></div></div>' : ''}
      <button type="button" class="mode-btn" data-mode="local">${sprite('duo')}<span>2 PLAYERS<small>TAKE TURNS ON THIS DEVICE</small></span></button>
      <button type="button" class="mode-btn" data-mode="online">${sprite('phones')}<span>2 DEVICES<small>PLAY A FRIEND ON ANOTHER PHONE OR TABLET</small></span></button>`;
    let level = null;
    if (levels) {
      level = choiceRow(el.querySelector('[data-levels]'), {
        key: game + '-level', def: 'easy',
        options: [{ value: 'easy', label: 'EASY' }, { value: 'normal', label: 'NORMAL' }, { value: 'hard', label: 'HARD' }],
      });
    }
    for (const b of el.querySelectorAll('.mode-btn')) {
      b.addEventListener('click', () => { Sound.click(); onPick(b.dataset.mode, level ? level.get() : null); });
    }
    return { level: () => (level ? level.get() : null) };
  }

  /* ---------- keep the screen awake while playing ---------- */
  let wakeLock = null, wantAwake = false;
  async function keepAwake() {
    wantAwake = true;
    try {
      if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* not supported */ }
  }
  function releaseAwake() {
    wantAwake = false;
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ }
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wantAwake) keepAwake(); });

  /* ---------- two-device connection (PeerJS / WebRTC) ---------- */
  const Net = {
    peer: null, conn: null, open: false, h: {}, timer: null,
    available() { return typeof window.Peer === 'function'; },
    id(game, code) { return `pixel-arcade-v1-${game}-${code}`; },
    host(game, h) {
      this.close();
      this.h = h;
      const code = String(1000 + rand(9000));
      const peer = new window.Peer(this.id(game, code), { debug: 1 });
      this.peer = peer;
      peer.on('open', () => { if (this.peer === peer && h.onRoom) h.onRoom(code); });
      peer.on('connection', (c) => {
        if (this.conn) {
          c.on('open', () => { try { c.send({ type: '_full' }); } catch (e) { /* ignore */ } setTimeout(() => c.close(), 400); });
          return;
        }
        this.attach(c);
      });
      peer.on('error', (err) => {
        if (this.peer !== peer) return;
        if (err.type === 'unavailable-id') { this.host(game, h); return; }
        this.error(err);
      });
      peer.on('disconnected', () => { if (this.peer === peer && !peer.destroyed && !this.open) { try { peer.reconnect(); } catch (e) { /* ignore */ } } });
    },
    join(game, code, h) {
      this.close();
      this.h = h;
      const peer = new window.Peer({ debug: 1 });
      this.peer = peer;
      peer.on('open', () => {
        if (this.peer !== peer) return;
        this.attach(peer.connect(this.id(game, code), { reliable: true, serialization: 'json' }));
        this.timer = setTimeout(() => { if (this.peer === peer && !this.open) this.fail("COULDN'T CONNECT. CHECK THE NUMBER AND TRY AGAIN."); }, 15000);
      });
      peer.on('error', (err) => {
        if (this.peer !== peer) return;
        if (err.type === 'peer-unavailable') this.fail('NO ROOM WITH THAT NUMBER. CHECK IT AND TRY AGAIN.');
        else this.error(err);
      });
    },
    attach(c) {
      this.conn = c;
      c.on('open', () => {
        if (this.conn !== c) return;
        this.open = true;
        clearTimeout(this.timer);
        if (this.h.onConnect) this.h.onConnect();
      });
      c.on('data', (m) => {
        if (this.conn !== c || !m || typeof m !== 'object') return;
        if (m.type === '_full') { this.fail('THAT ROOM ALREADY HAS 2 PLAYERS.'); return; }
        if (m.type === '_leave') { const h = this.h; this.close(); if (h.onClose) h.onClose(true); return; }
        if (this.h.onData) this.h.onData(m);
      });
      c.on('close', () => { if (this.conn !== c) return; const h = this.h; this.close(); if (h.onClose) h.onClose(false); });
      c.on('error', (e) => console.warn('connection error', e));
    },
    send(m) { if (this.conn && this.conn.open) { try { this.conn.send(m); } catch (e) { console.warn('send failed', e); } } },
    leave() {
      this.h = {};
      if (this.conn && this.conn.open) { this.send({ type: '_leave' }); setTimeout(() => this.close(), 150); } else this.close();
    },
    close() {
      clearTimeout(this.timer);
      const c = this.conn, p = this.peer;
      this.conn = null; this.peer = null; this.open = false;
      try { if (c) c.close(); } catch (e) { /* ignore */ }
      try { if (p) p.destroy(); } catch (e) { /* ignore */ }
    },
    fail(msg) { const h = this.h; this.close(); if (h.onError) h.onError(msg); },
    error(err) {
      console.warn('peer error', err && err.type, err);
      if (this.open) return; // signalling hiccups don't matter once linked
      const t = err && err.type;
      let msg = 'CONNECTION PROBLEM. PLEASE TRY AGAIN.';
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(t)) msg = "CAN'T REACH THE INTERNET. 2-DEVICE GAMES NEED A CONNECTION.";
      else if (t === 'browser-incompatible' || t === 'webrtc') msg = "THIS BROWSER CAN'T LINK DEVICES. TRY CHROME OR SAFARI.";
      this.fail(msg);
    },
  };
  window.addEventListener('pagehide', (e) => { if (!e.persisted && Net.open) Net.send({ type: '_leave' }); });

  function roomFromUrl() {
    const r = new URLSearchParams(location.search).get('room') || '';
    return /^\d{4}$/.test(r) ? r : '';
  }
  function clearRoomFromUrl() { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } }

  // The "2 DEVICES" pop-up: start a room or join one. Calls onConnected(isHost) once linked.
  function online({ game, code = '', onConnected, onData, onClose, onCancel }) {
    const cancel = () => { Net.close(); hideOverlay(); clearRoomFromUrl(); if (onCancel) onCancel(); };
    const handlers = (isHost) => ({
      onRoom: (c) => hosting(c),
      onConnect: () => { hideOverlay(); clearRoomFromUrl(); Sound.join(); onConnected(isHost); },
      onData,
      onClose,
      onError: (msg) => { Sound.error(); menu(msg); },
    });
    function menu(msg = '', prefill = '') {
      if (!Net.available()) {
        showOverlay({ title: '2 DEVICES', body: "<p>2-DEVICE GAMES NEED THE INTERNET. CHECK YOUR CONNECTION AND TRY AGAIN.</p>", actions: [{ label: 'OK', primary: true, onClick: cancel }] });
        return;
      }
      showOverlay({
        title: '2 DEVICES',
        body: `<p>ONE PLAYER STARTS A ROOM. THE OTHER TYPES IN THE ROOM NUMBER.</p>
          <button type="button" class="btn btn-primary" data-start>START A ROOM</button>
          <div class="or">- OR -</div>
          <label>ROOM NUMBER<input class="code-input" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="0000" data-code></label>
          <button type="button" class="btn" data-join>JOIN ROOM</button>
          <p class="msg" role="status">${esc(msg)}</p>`,
        actions: [{ label: 'CANCEL', onClick: cancel }],
      });
      const input = $('#ov-body [data-code]');
      input.value = prefill;
      input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); });
      const join = () => {
        const c = input.value;
        if (c.length !== 4) { Sound.error(); $('#ov-body .msg').textContent = 'TYPE THE 4-DIGIT ROOM NUMBER.'; return; }
        Sound.click();
        connecting();
        Net.join(game, c, handlers(false));
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
      $('#ov-body [data-join]').addEventListener('click', join);
      $('#ov-body [data-start]').addEventListener('click', () => {
        Sound.click();
        showOverlay({ title: 'STARTING ROOM...', body: '<div class="radar"></div>', actions: [{ label: 'CANCEL', onClick: cancel }] });
        Net.host(game, handlers(true));
      });
      if (prefill) $('#ov-body [data-join]').classList.add('btn-primary');
    }
    function connecting() {
      showOverlay({ title: 'CONNECTING...', body: '<div class="radar"></div>', actions: [{ label: 'CANCEL', onClick: cancel }] });
    }
    function hosting(c) {
      const url = `${location.origin}${location.pathname}?room=${c}`;
      showOverlay({
        title: 'YOUR ROOM',
        body: `<p>TELL YOUR FRIEND THIS NUMBER:</p>
          <div class="room-number">${c}</div>
          <div class="radar"></div>
          <p class="blink">WAITING FOR PLAYER 2...</p>
          <button type="button" class="btn btn-small" data-share>SEND INVITE LINK</button>
          <p class="msg" data-share-msg></p>`,
        actions: [{ label: 'CANCEL', onClick: cancel }],
      });
      $('#ov-body [data-share]').addEventListener('click', async () => {
        const text = `Come and play! Room number ${c}`;
        Sound.click();
        if (navigator.share) {
          try { await navigator.share({ title: 'Pixel Arcade', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
        }
        try { await navigator.clipboard.writeText(url); $('#ov-body [data-share-msg]').textContent = 'LINK COPIED!'; } catch (e) { $('#ov-body [data-share-msg]').textContent = url; }
      });
    }
    menu('', code);
  }

  function connectionLost(left, scoreLine, onMenu) {
    showOverlay({
      title: left ? 'FRIEND LEFT' : 'SIGNAL LOST',
      cls: 'lose',
      body: `<p>${left ? 'THE OTHER PLAYER LEFT THE GAME.' : 'THE LINK TO THE OTHER DEVICE DROPPED. A SCREEN MAY HAVE GONE TO SLEEP.'}</p>${scoreLine ? `<p>${scoreLine}</p>` : ''}`,
      actions: [{ label: 'OK', primary: true, onClick: () => { hideOverlay(); onMenu(); } }],
    });
  }

  /* ---------- picture guides ("how to play") ---------- */
  // Small pictures built from letters, e.g. mini('sea', ['..s', '.x.', 'o..']).
  function mini(kind, rows) {
    let html = `<div class="mini mini-${kind}" style="--c:${rows[0].length}">`;
    for (const row of rows) for (const ch of row) html += `<i class="m-${ch === '.' ? 'e' : ch}"></i>`;
    return html + '</div>';
  }
  // Memory-style cards: '?' is face down, a sprite name is face up, a trailing '*' highlights it.
  function miniCards(list) {
    return `<div class="mini-cards">${list.map((c) => {
      const hi = c.endsWith('*');
      const name = c.replace('*', '');
      return name === '?' ? '<i class="mc-back">?</i>' : `<i class="mc-face${hi ? ' hi' : ''}">${sprite(name)}</i>`;
    }).join('')}</div>`;
  }
  function speak(text) {
    try {
      const s = window.speechSynthesis;
      if (!s) return;
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = s.getVoices().find((x) => /en[-_]GB/i.test(x.lang));
      if (v) u.voice = v;
      u.lang = 'en-GB';
      u.rate = 0.9;
      s.speak(u);
    } catch (e) { /* speech not available */ }
  }
  function stopSpeaking() { try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
  const canSpeak = 'speechSynthesis' in window;

  // steps: [{ title, text, pic }]. Text is written normally and shown in capitals.
  function guide(steps, onDone) {
    let i = 0;
    const close = () => { stopSpeaking(); hideOverlay(); if (onDone) onDone(); };
    const render = () => {
      stopSpeaking();
      const st = steps[i];
      const last = i === steps.length - 1;
      showOverlay({
        title: st.title,
        body: `<div class="guide-pic">${st.pic || ''}</div>
          <p class="guide-text">${esc(st.text)}</p>
          ${canSpeak ? '<button type="button" class="btn btn-small btn-purple guide-read" data-read>READ IT TO ME</button>' : ''}
          <div class="guide-dots" aria-label="Step ${i + 1} of ${steps.length}">${steps.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div>`,
        actions: [
          i > 0 ? { label: 'BACK', onClick: () => { i--; render(); } } : { label: 'SKIP', onClick: close },
          last ? { label: "LET'S PLAY!", primary: true, onClick: close } : { label: 'NEXT', primary: true, onClick: () => { i++; render(); } },
        ],
      });
      $('#overlay .modal').classList.add('guide');
      const read = $('#ov-body [data-read]');
      if (read) read.addEventListener('click', () => speak(`${st.title}. ${st.text}`));
    };
    render();
  }
  // Show the guide automatically the first time a game is opened on this device.
  function guideOnce(key, steps) {
    if (store.get(key + '-guide-seen', '0') === '1') return;
    store.set(key + '-guide-seen', '1');
    guide(steps);
  }

  /* ---------- header: sound toggle + quit guard ---------- */
  let guard = () => false;
  let leaving = false;
  function setGuard(fn) { guard = fn; }
  function initHeader() {
    const mute = $('#mute-btn');
    if (mute) {
      const paint = () => { mute.textContent = Sound.muted ? 'SND OFF' : 'SND ON'; mute.setAttribute('aria-pressed', String(!Sound.muted)); };
      paint();
      mute.addEventListener('click', () => { Sound.muted = !Sound.muted; store.set('arcade-muted', Sound.muted ? '1' : '0'); paint(); Sound.click(); });
    }
    const back = $('#back-link');
    if (back) {
      back.addEventListener('click', async (e) => {
        if (!guard()) { leaving = true; return; }
        e.preventDefault();
        if (await confirmBox('QUIT GAME?', 'THIS GAME WILL END.', 'QUIT', 'KEEP PLAYING')) {
          leaving = true;
          Net.leave();
          setTimeout(() => { location.href = back.href; }, 200);
        }
      });
    }
    window.addEventListener('beforeunload', (e) => { if (!leaving && guard()) { e.preventDefault(); e.returnValue = ''; } });
  }

  /* ---------- offline support ---------- */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch((e) => console.warn('offline cache unavailable', e)); });
  }

  window.Arcade = {
    $, rand, esc, shuffle, store, Sound, PLAYERS, CPU, CARD_SPRITES, sprite,
    toast, showOverlay, hideOverlay, overlayOpen, confirmBox, handover, choiceRow, modeMenu,
    keepAwake, releaseAwake, Net, online, roomFromUrl, clearRoomFromUrl, connectionLost,
    setGuard, initHeader, mini, miniCards, guide, guideOnce,
    setQuiet(v) { quiet = !!v; },
  };
})();
