'use strict';
/* Gundi — ფრონტენდის ლოგიკა (Socket.io კლიენტი) */
(function () {
  const $ = (id) => document.getElementById(id);

  // სერვერის მისამართი: config.js-ში მითითებული, ან (ლოკალურად) ავტომატურად localhost:3000.
  // ეს აგვარებს შემთხვევას, როცა index.html ფაილიდან ან VS Code Live Server-იდან (პორტი 5500) იხსნება.
  function resolveServer() {
    const cfg = (window.GUNDI_SERVER_URL || '').replace(/\/$/, '');
    if (cfg) return cfg;
    if (location.protocol === 'file:') return 'http://localhost:3000';
    const local = /^(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)$/.test(location.hostname);
    if (local && location.port && location.port !== '3000') return `${location.protocol}//${location.hostname}:3000`;
    return '';
  }
  const SERVER = resolveServer();
  const SESSION_KEY = 'gundi_session';
  const NAME_KEY = 'gundi_name';
  const MATCH_KEY = 'gundi_match_seen';
  const REACTIONS = ['😂', '🔥', '😱', '👏', '💸'];
  const RING_C = 276.46;
  const POS_SHORT = { GK: 'GK', DEF: 'DEF', MID: 'MID', FWD: 'FWD' };
  const SLOT_SHORT = ['GK', 'DEF', 'MID', 'FWD', 'LEG'];
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} },
  };

  const money = (n) => '$' + Number(n || 0).toLocaleString('en-US');
  const moneyShort = (n) => (n >= 1e6 ? '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : '$' + Math.round(n / 1000) + 'K');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hue = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const play = (n) => window.GSound && GSound.play(n);

  let state = null;
  let prevState = null;
  let skew = 0;
  let lastCardId = null;
  let lastPrice = null;
  let lastInterKey = null;
  let lastSec = null;
  let hiddenCardId = null;
  let busy = false;

  /* ---------------- ბარათი ---------------- */
  const tierOf = (c) => (c.legend ? 'legend' : c.ovr >= 90 ? 'icon' : c.ovr >= 87 ? 'gold' : c.ovr >= 84 ? 'silver' : 'bronze');

  // ემოჯი-დროშა -> ISO კოდი (Windows-ზე დროშის ემოჯი ასოებად ჩანს, ამიტომ სურათს ვიყენებთ)
  function flagCode(nat) {
    const cps = Array.from(nat || '').map((c) => c.codePointAt(0));
    if (cps.length >= 2 && cps[0] >= 0x1f1e6 && cps[0] <= 0x1f1ff) {
      return String.fromCharCode(cps[0] - 0x1f1e6 + 97, cps[1] - 0x1f1e6 + 97);
    }
    return null;
  }
  function faceHtml(nat) {
    const code = flagCode(nat);
    if (!code) return `<span>${esc(nat || '⚽')}</span>`;
    return `<img src="https://flagcdn.com/w160/${code}.png" alt="${code.toUpperCase()}" loading="eager" draggable="false" onerror="this.outerHTML='<span>${code.toUpperCase()}</span>'">`;
  }

  function cardHtml(c, extra) {
    if (c.hidden) {
      return `
      <div class="fc tier-mystery pos-${c.pos} ${extra || ''}">
        <div class="fc-shine"></div>
        <div class="fc-top"><div class="fc-ovr">??</div><div class="fc-pos">${POS_SHORT[c.pos] || c.pos}</div></div>
        <div class="fc-face">${faceHtml(c.nat)}<b class="q">?</b></div>
        <div class="fc-name">${esc(c.name)}</div>
        <div class="fc-foot">ფარული რეიტინგი · საწყისი ${moneyShort(c.base)}</div>
      </div>`;
    }
    return `
      <div class="fc tier-${tierOf(c)} pos-${c.pos} ${extra || ''}">
        <div class="fc-shine"></div>
        <div class="fc-top"><div class="fc-ovr">${c.ovr}</div><div class="fc-pos">${POS_SHORT[c.pos] || c.pos}</div></div>
        <div class="fc-face">${faceHtml(c.nat)}</div>
        <div class="fc-name">${esc(c.name)}</div>
        <div class="fc-foot">${c.legend ? 'ლეგენდა · ' : ''}${c.base ? 'საწყისი ' + moneyShort(c.base) : 'უფასო მოთამაშე'}</div>
      </div>`;
  }

  // ბარათის დახრა მაუსის/თითის მიხედვით
  function tilt(e) {
    const el = e.target.closest && e.target.closest('.fc');
    if (!el || reduceMotion) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', ((x - 0.5) * 18).toFixed(1) + 'deg');
    el.style.setProperty('--rx', ((0.5 - y) * 18).toFixed(1) + 'deg');
    el.style.setProperty('--mx', (x * 100).toFixed(0) + '%');
    el.style.setProperty('--my', (y * 100).toFixed(0) + '%');
  }
  function untilt(e) {
    const el = e.target.closest && e.target.closest('.fc');
    if (!el) return;
    ['--rx', '--ry', '--mx', '--my'].forEach((p) => el.style.removeProperty(p));
  }
  document.addEventListener('pointermove', tilt);
  document.addEventListener('pointerout', untilt);

  /* ---------------- კონფეტი ---------------- */
  const cv = $('confetti');
  const cx = cv.getContext('2d');
  let parts = [];
  let confRun = false;
  function confetti(n) {
    if (reduceMotion) return;
    cv.width = window.innerWidth; cv.height = window.innerHeight;
    const colors = ['#ff7a1a', '#34f0a1', '#ffd25a', '#f3f5ff', '#7cf3ff', '#b9a2ff', '#ff6b7d'];
    for (let i = 0; i < (n || 150); i++) {
      parts.push({
        x: cv.width * (0.2 + Math.random() * 0.6), y: -10 - Math.random() * 120,
        vx: (Math.random() - 0.5) * 7, vy: 2 + Math.random() * 5,
        w: 6 + Math.random() * 7, h: 4 + Math.random() * 6,
        r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.35,
        c: colors[(Math.random() * colors.length) | 0],
      });
    }
    if (!confRun) { confRun = true; requestAnimationFrame(confStep); }
  }
  function confStep() {
    cx.clearRect(0, 0, cv.width, cv.height);
    parts = parts.filter((p) => p.y < cv.height + 30);
    for (const p of parts) {
      p.vy += 0.09; p.vx *= 0.995; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r);
      cx.fillStyle = p.c; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      cx.restore();
    }
    if (parts.length) requestAnimationFrame(confStep);
    else { confRun = false; cx.clearRect(0, 0, cv.width, cv.height); }
  }

  /* ---------------- socket ---------------- */
  const socket = io(SERVER || undefined, { transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });

  const conn = $('conn');
  let connTimer = null;
  function showConn(on) {
    clearTimeout(connTimer);
    if (!on) { conn.hidden = true; return; }
    connTimer = setTimeout(() => { conn.hidden = false; }, 1200);
  }
  showConn(true);

  socket.on('connect', () => { showConn(false); tryRejoin(); });
  socket.on('disconnect', () => showConn(true));
  socket.on('connect_error', () => showConn(true));

  socket.on('state', (st) => {
    skew = st.serverNow - Date.now();
    prevState = state;
    state = st;
    soundEvents(prevState, st);
    render();
  });

  function ask(ev, data) {
    return new Promise((resolve) => {
      if (!socket.connected) {
        conn.hidden = false;
        return resolve({ ok: false, error: 'სერვერთან კავშირი არ არის. გაუშვი npm start და გახსენი http://localhost:3000' });
      }
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: 'სერვერი არ პასუხობს' }); } }, 8000);
      socket.emit(ev, data, (res) => {
        if (done) return;
        done = true; clearTimeout(t); resolve(res || { ok: false });
      });
    });
  }

  function tryRejoin() {
    let s = null;
    try { s = JSON.parse(store.get(SESSION_KEY) || 'null'); } catch (_) {}
    if (!s || !s.code || !s.token) return;
    ask('rejoin', { code: s.code, token: s.token }).then((r) => {
      if (!r.ok) {
        store.del(SESSION_KEY);
        if (state) { state = null; render(); }
      }
    });
  }

  /* ---------------- ხმები მდგომარეობის ცვლილებაზე ---------------- */
  function soundEvents(prev, st) {
    if (!window.GSound) return;
    const me = st.you.id;
    if (st.phase === 'auction' && (!prev || prev.phase !== 'auction')) GSound.ambience(true);
    if (st.phase !== 'auction' && prev && prev.phase === 'auction') GSound.ambience(false);
    if (!prev || prev.code !== st.code) return;

    if (st.phase === 'lobby' && prev.phase === 'lobby' && st.players.length > prev.players.length) play('join');

    if (st.phase === 'auction') {
      const it = st.intermission, pit = prev.intermission;
      if (it && it.kind === 'round_start' && (!pit || pit.kind !== 'round_start' || pit.round !== it.round)) play('fanfare');
      if (st.card && (!prev.card || prev.card.id !== st.card.id)) { play('whistle'); if (st.card.legend) play('legend'); if (st.card.hidden) play('mystery'); }
      if (st.card && prev.card && prev.card.id === st.card.id && st.bid !== prev.bid && st.bidderId) {
        if (st.bidderId === me) play('bid');
        else if (prev.bidderId === me) play('outbid');
        else play('bidOther');
        GSound.swell();
      }
      const fresh = it && (it.kind === 'sold' || it.kind === 'unsold') && (!pit || pit.kind !== it.kind || !pit.card || pit.card.id !== it.card.id);
      if (fresh) {
        if (prev.card && prev.card.hidden && prev.card.id === it.card.id) setTimeout(() => play('reveal'), 500);
        if (it.kind === 'sold') {
          play('gavel');
          if (it.winnerId === me) { play('winCard'); confetti(90); } else play('cheer');
        } else play('unsold');
      }
    }

    // ფინალის ხმები და კონფეტი მატჩის ანიმაციის ბოლოს უკრავს (finishMatch)
  }

  /* ---------------- toast ---------------- */
  let toastT = null;
  function homeMsg(msg) {
    const el = $('home-msg');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }
  function toast(msg, isErr) {
    if (isErr) { play('error'); if (state === null) homeMsg(msg); }
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
    el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), 2800);
  }

  /* ---------------- ეკრანები ---------------- */
  function show(name) {
    ['home', 'lobby', 'game', 'match', 'end'].forEach((n) => { $('screen-' + n).hidden = n !== name; });
  }

  function render() {
    const chips = $('top-chips');
    if (!state) {
      chips.hidden = true;
      show('home');
      document.title = 'Gundi - Live Football Auction Game';
      return;
    }
    chips.hidden = false;
    $('g-code').textContent = state.code;
    const me = state.players.find((p) => p.id === state.you.id);
    $('g-budget').textContent = Number(me ? me.budget : 0).toLocaleString('en-US');

    if (state.phase !== 'finished' && matchPlaying) stopMatch();
    if (state.phase === 'lobby') { show('lobby'); renderLobby(); }
    else if (state.phase === 'auction') { show('game'); renderGame(); }
    else if (matchPlaying) { /* ანიმაცია მიმდინარეობს */ }
    else if (state.match && store.get(MATCH_KEY) !== state.match.id) { startMatch(); }
    else { show('end'); renderEnd(); }
  }

  /* ---------------- ლობი ---------------- */
  const avatar = (name, connected, sm) =>
    `<span class="avatar ${sm ? 'sm' : ''}" style="--h:${hue(name)}">${esc(Array.from(name)[0] || '?').toUpperCase()}${connected === undefined ? '' : `<i class="${connected ? '' : 'off'}"></i>`}</span>`;

  function renderLobby() {
    $('l-code').innerHTML = state.code.split('').map((d) => `<span>${d}</span>`).join('');
    $('l-count').textContent = `(${state.players.length}/${state.config.maxPlayers})`;
    $('l-players').innerHTML = state.players.map((p) => `
      <li>
        ${avatar(p.name, p.connected)}
        <span class="nm">${esc(p.name)}</span>
        ${p.isHost ? '<span class="badge">ჰოსტი</span>' : ''}
        ${p.id === state.you.id ? '<span class="badge me">შენ</span>' : ''}
      </li>`).join('');
    const isHost = state.hostId === state.you.id;
    const enough = state.players.length >= state.config.minPlayers;
    const btn = $('btn-start');
    btn.hidden = !isHost;
    btn.disabled = !enough;
    $('l-hint').textContent = isHost
      ? (enough ? 'ყველა მზადაა? დაიწყე თამაში.' : 'დაელოდე მინიმუმ ერთ მოთამაშეს (საჭიროა 2-დან 4-მდე).')
      : 'ელოდები, სანამ ჰოსტი თამაშს დაიწყებს.';
    const themes = state.config.themes || [];
    $('l-themes').innerHTML = themes.map((t) =>
      `<button type="button" class="theme-chip ${t.key === state.theme ? 'on' : ''}" data-theme="${t.key}" ${isHost ? '' : 'disabled'}>${esc(t.label)}</button>`).join('');
    const cur = themes.find((t) => t.key === state.theme);
    $('l-theme-desc').textContent = cur ? cur.desc + (isHost ? '' : ' (თემას ჰოსტი ირჩევს)') : '';
    document.title = `Gundi · ოთახი ${state.code}`;
  }

  /* ---------------- აუქციონი ---------------- */
  function renderGame() {
    const meId = state.you.id;
    const total = state.rounds.length;
    $('g-round').textContent = `რაუნდი ${state.round + 1}/${total} · ${state.rounds[state.round].label}`;
    $('g-steps').innerHTML = state.rounds.map((_, i) =>
      `<div class="step ${i < state.round ? 'done' : i === state.round ? 'now' : ''}">${SLOT_SHORT[i]}</div>`).join('');
    $('g-cardno').textContent = state.card ? `ბარათი ${state.cardNo}/${state.cardTotal}` : '';
    const th = (state.config.themes || []).find((t) => t.key === state.theme);
    $('g-theme').hidden = !th || th.key === 'classic';
    if (th) $('g-theme').textContent = th.label;

    renderStage(meId);
    renderBidControls();
    renderTeams(meId);

    $('bid-history').innerHTML = state.card && state.bids.length
      ? state.bids.map((b, i) => `<li class="${i === 0 ? 'live' : ''}"><span>${esc(b.name)}${b.pid === meId ? ' (შენ)' : ''}</span><b>${money(b.amount)}</b></li>`).join('')
      : '<li class="empty">ფსონები ჯერ არ არის</li>';

    $('sales').innerHTML = state.log.length
      ? state.log.map((l) => `<li><span>${esc(l.text)}</span></li>`).join('')
      : '<li class="empty">—</li>';
    document.title = state.card ? `Gundi · ${money(state.bid || state.card.base)}` : 'Gundi';
  }

  function setPrice(label, value, leaderText, leaderMe) {
    $('p-lbl').textContent = label;
    const pv = $('p-val');
    if (pv.textContent !== value) {
      pv.textContent = value;
      if (lastPrice !== null && !reduceMotion) { pv.classList.remove('bump'); void pv.offsetWidth; pv.classList.add('bump'); }
    }
    const l = $('p-leader');
    l.textContent = leaderText;
    l.classList.toggle('me', !!leaderMe);
  }

  function renderStage(meId) {
    const stage = $('stage');
    const sc = $('stage-card');
    const it = state.intermission;
    stage.classList.toggle('solo', !!(it && it.kind === 'round_start' && !state.card));

    if (state.card) {
      const c = state.card;
      if (lastCardId !== c.id) {
        sc.innerHTML = cardHtml(c, 'enter');
        lastCardId = c.id; lastInterKey = null; lastPrice = null;
        hiddenCardId = c.hidden ? c.id : null;
        $('in-bid').value = '';
      }
      const leader = state.bidderId ? state.players.find((p) => p.id === state.bidderId) : null;
      const isMe = state.bidderId === meId;
      const price = state.bidderId ? state.bid : c.base;
      setPrice(
        state.bidderId ? 'მიმდინარე ფსონი' : 'საწყისი ფასი',
        money(price),
        leader ? (isMe ? 'შენ ლიდერობ' : leader.name) : 'ფსონი ჯერ არავის დაუდია',
        isMe
      );
      lastPrice = price;
    } else if (it) {
      const key = it.kind + (it.card ? it.card.id : '') + (it.round != null ? it.round : '');
      if (key !== lastInterKey) {
        lastInterKey = key; lastCardId = null; lastPrice = null;
        const wasHidden = !!(it.card && hiddenCardId === it.card.id);
        hiddenCardId = null;
        if (it.kind === 'round_start') {
          sc.innerHTML = `<div class="roundcard"><div class="rc-n">${it.round + 1}</div><div class="rc-t">${esc(it.label)}</div><div class="rc-s">რაუნდი ${it.round + 1}/${state.rounds.length}</div></div>`;
        } else if (it.kind === 'sold') {
          sc.innerHTML = cardHtml(it.card, wasHidden ? 'reveal' : '') + '<div class="stamp sold">გაიყიდა</div>';
        } else {
          sc.innerHTML = cardHtml(it.card, wasHidden ? 'reveal' : '') + '<div class="stamp unsold">გაუყიდავი</div>';
        }
      }
      if (it.kind === 'sold') {
        setPrice(it.winnerId === meId ? 'შენ იყიდე' : 'მყიდველი', money(it.price), it.winnerName, it.winnerId === meId);
      } else if (it.kind === 'unsold') {
        setPrice('შედეგი', '—', 'ვერავინ იყიდა', false);
      }
    }
  }

  function renderBidControls() {
    const y = state.you;
    const enabled = y.canBid;
    const cur = state.bidderId ? state.bid : 0;
    $('btn-min').textContent = enabled ? `ფსონი ${money(y.minNext)}` : 'ფსონი';
    $('btn-min').disabled = !enabled;
    const n10 = Math.max(cur + 10000, y.minNext);
    const n50 = Math.max(cur + 50000, y.minNext);
    $('btn-p10').disabled = !enabled || n10 > y.maxBid;
    $('btn-p50').disabled = !enabled || n50 > y.maxBid;
    $('in-bid').disabled = !enabled;
    $('bid-form').querySelector('button').disabled = !enabled;

    const hints = {
      wait: state.intermission && state.intermission.kind === 'round_start' ? 'რაუნდი მალე დაიწყება.' : 'შემდეგი ბარათი მალე გამოჩნდება.',
      won: 'ამ რაუნდში ფეხბურთელი უკვე იყიდე. დაელოდე სხვებს.',
      leader: 'შენ ლიდერობ. დაელოდე ტაიმერს ან სხვის ფსონს.',
      budget: 'ამ ფსონისთვის ბიუჯეტი არ გყოფნის.',
      offline: 'კავშირი დაკარგულია.',
    };
    $('bid-hint').textContent = enabled ? `მინ. ${money(y.minNext)} · მაქს. ${money(y.maxBid)}` : (hints[y.reason] || '');
  }

  function slotsHtml(team, prefix) {
    return team.map((pl, i) => {
      const idAttr = prefix ? `id="${prefix}-${i}"` : '';
      if (!pl) return `<div ${idAttr} class="mini empty">${SLOT_SHORT[i]}</div>`;
      return `<div ${idAttr} class="mini full tier-${tierOf(pl)}" title="${esc(pl.name)} · ${money(pl.price)}">
        <span class="s-pos">${SLOT_SHORT[i]}</span><span class="s-ovr">${pl.ovr}</span><span class="s-nm">${esc(pl.name.split(' ').slice(-1)[0])}</span></div>`;
    }).join('');
  }

  function renderTeams(meId) {
    const showBid = !!state.card;
    $('teams').innerHTML = state.players.map((p) => `
      <div class="team ${p.id === meId ? 'me' : ''} ${showBid && state.bidderId === p.id ? 'leading' : ''} ${p.connected ? '' : 'off'}">
        <div class="team-head">
          <span class="who">${avatar(p.name, undefined, true)}<span class="nm">${esc(p.name)}${p.id === meId ? ' (შენ)' : ''}</span> ${p.wonThisRound ? '<span class="tag-won">✔</span>' : ''}</span>
          <span class="bd">${money(p.budget)}</span>
        </div>
        <div class="slots">${slotsHtml(p.team)}</div>
      </div>`).join('');
  }

  /* ტაიმერის რგოლი + წიკწიკი */
  function tick() {
    const fg = $('ring-fg'), num = $('timer-num'), ring = $('ring');
    if (state && state.phase === 'auction' && state.card && state.endsAt) {
      const left = Math.max(0, state.endsAt - (Date.now() + skew));
      const frac = Math.min(1, left / state.config.bidMs);
      fg.style.strokeDashoffset = String(RING_C * (1 - frac));
      const secs = Math.ceil(left / 1000);
      num.textContent = secs;
      ring.classList.toggle('urgent', left <= 5000);
      ring.classList.toggle('warn', left > 5000 && left <= 8000);
      if (secs !== lastSec) {
        if (secs >= 1 && secs <= 5) play(secs === 1 ? 'tickLast' : 'tick');
        lastSec = secs;
      }
    } else {
      fg.style.strokeDashoffset = String(RING_C);
      num.textContent = '—';
      ring.classList.remove('urgent', 'warn');
      lastSec = null;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ---------------- შედეგები ---------------- */
  function renderEnd() {
    const res = state.results || [];
    const medals = ['🥇', '🥈', '🥉', '4️⃣'];
    const iWon = res[0] && res[0].id === state.you.id;
    $('e-title').textContent = iWon ? 'შენ გაიმარჯვე!' : 'თამაში დასრულდა';
    const m = state.match;
    $('e-final').textContent = m
      ? `ფინალი: ${m.a.name} ${m.score.a}:${m.score.b} ${m.b.name}${m.pens ? ` (პენალტები ${m.pens.a}:${m.pens.b})` : ''}`
      : '';
    $('e-winner').innerHTML = res[0] ? `გამარჯვებული: <b>${esc(res[0].name)}</b> · ${res[0].score} ქულა` : '';
    $('e-rank').innerHTML = res.map((r, i) => {
      const p = state.players.find((x) => x.id === r.id);
      return `<div class="team ${r.id === state.you.id ? 'me' : ''} ${i === 0 ? 'first' : ''}">
        <div class="team-head">
          <span class="who"><span class="medal">${medals[i] || ''}</span>${avatar(r.name, undefined, true)}<span class="nm">${esc(r.name)}</span></span>
          <span><span class="score">${r.score}</span> <span class="bd">· ${money(r.budget)}</span></span>
        </div>
        <div class="slots">${p ? slotsHtml(p.team) : ''}</div>
      </div>`;
    }).join('');
    const isHost = state.hostId === state.you.id;
    $('btn-again').hidden = !isHost;
    $('e-hint').textContent = isHost ? '' : 'ახალ თამაშს ჰოსტი დაიწყებს.';
  }

  /* ---------------- ქმედებები ---------------- */
  function getName() {
    const name = $('in-name').value.replace(/\s+/g, ' ').trim();
    if (!name) { toast('შეიყვანე შენი სახელი', true); $('in-name').focus(); return null; }
    store.set(NAME_KEY, name);
    return name;
  }
  function saveSession(r) { store.set(SESSION_KEY, JSON.stringify({ code: r.code, token: r.token })); }

  async function withBusy(fn) {
    if (busy) return;
    busy = true;
    try { await fn(); } finally { busy = false; }
  }

  $('btn-create').addEventListener('click', () => withBusy(async () => {
    const name = getName(); if (!name) return;
    homeMsg('');
    const r = await ask('create_room', { name });
    if (!r.ok) return toast(r.error || 'შეცდომა', true);
    saveSession(r);
    play('join');
  }));

  async function join() {
    const name = getName(); if (!name) return;
    const code = $('in-code').value.trim();
    if (!/^\d{4}$/.test(code)) { toast('კოდი უნდა იყოს 4 ციფრი', true); $('in-code').focus(); return; }
    homeMsg('');
    const r = await ask('join_room', { name, code });
    if (!r.ok) return toast(r.error || 'შეცდომა', true);
    saveSession(r);
    play('join');
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
  }
  $('btn-join').addEventListener('click', () => withBusy(join));
  $('in-code').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
  $('in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') withBusy(join); });
  $('in-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { if ($('in-code').value.length === 4) withBusy(join); else $('btn-create').click(); } });

  async function copy(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(okMsg); } catch (__) { toast(text); }
      ta.remove();
    }
  }
  $('btn-copy-code').addEventListener('click', () => state && copy(state.code, 'კოდი დაკოპირდა'));
  $('btn-copy-link').addEventListener('click', () => state && copy(`${location.origin}${location.pathname}?code=${state.code}`, 'ბმული დაკოპირდა'));

  $('btn-start').addEventListener('click', () => withBusy(async () => {
    const r = await ask('start_game', {});
    if (!r.ok) toast(r.error || 'შეცდომა', true);
  }));

  async function leave() {
    await ask('leave_room', {});
    store.del(SESSION_KEY);
    stopMatch();
    state = null; prevState = null; lastCardId = null; lastInterKey = null;
    if (window.GSound) GSound.ambience(false);
    render();
  }
  $('btn-leave-lobby').addEventListener('click', () => withBusy(leave));
  $('btn-leave-end').addEventListener('click', () => withBusy(leave));

  $('btn-again').addEventListener('click', () => withBusy(async () => {
    const r = await ask('play_again', {});
    if (!r.ok) toast(r.error || 'შეცდომა', true);
  }));

  /* ფსონები */
  async function bid(amount) {
    if (!state || !state.you.canBid) return;
    const r = await ask('place_bid', { amount });
    if (!r.ok) { toast(r.error || 'ფსონი ვერ დაიდო', true); if (navigator.vibrate) navigator.vibrate(60); }
  }
  const curBid = () => (state && state.bidderId ? state.bid : 0);
  $('btn-min').addEventListener('click', () => bid(state.you.minNext));
  $('btn-p10').addEventListener('click', () => bid(Math.max(curBid() + 10000, state.you.minNext)));
  $('btn-p50').addEventListener('click', () => bid(Math.max(curBid() + 50000, state.you.minNext)));
  $('bid-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseInt($('in-bid').value.replace(/[^\d]/g, ''), 10);
    if (!v) return toast('ჩაწერე თანხა', true);
    $('in-bid').value = '';
    bid(v);
  });
  $('in-bid').addEventListener('input', (e) => {
    const d = e.target.value.replace(/[^\d]/g, '');
    e.target.value = d ? Number(d).toLocaleString('en-US') : '';
  });

  /* ხმის ღილაკი + ღილაკების „კლიკი“ */
  if (window.GSound) {
    GSound.init();
    $('btn-sound').addEventListener('click', () => {
      const on = GSound.toggle();
      if (on && state && state.phase === 'auction') GSound.ambience(true);
    });
    document.addEventListener('pointerdown', (e) => {
      const b = e.target.closest && e.target.closest('.btn');
      if (b && !b.disabled && !b.hasAttribute('data-ns')) play('click');
    });
  }

  /* ---------------- თემის არჩევა (ჰოსტი) ---------------- */
  $('l-themes').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-theme]');
    if (!b || b.disabled || b.dataset.theme === (state && state.theme)) return;
    play('click');
    const r = await ask('set_theme', { theme: b.dataset.theme });
    if (!r.ok) toast(r.error || 'შეცდომა', true);
  });

  /* ---------------- რეაქციები ---------------- */
  document.querySelectorAll('[data-react]').forEach((el) => {
    el.innerHTML = REACTIONS.map((e) => `<button type="button" class="react" data-e="${e}" data-ns aria-label="რეაქცია ${e}">${e}</button>`).join('');
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.react');
    if (!b || !state || !socket.connected) return;
    socket.emit('react', { emoji: b.dataset.e });
    b.classList.add('cool');
    setTimeout(() => b.classList.remove('cool'), 450);
  });
  let lastReactSound = 0;
  socket.on('reaction', (x) => {
    const layer = $('react-layer');
    const el = document.createElement('div');
    el.className = 'fl';
    el.style.left = (6 + Math.random() * 78) + '%';
    el.style.setProperty('--dx', ((Math.random() - 0.5) * 70) + 'px');
    el.innerHTML = `<span class="fl-e">${esc(x.emoji)}</span><span class="fl-n">${esc(x.name)}</span>`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2700);
    const now = Date.now();
    if (now - lastReactSound > 220) { lastReactSound = now; play('react'); }
  });

  /* ---------------- ფინალური მატჩი ---------------- */
  const MS_PER_MIN = 190;
  let matchPlaying = false;
  let mt = null; // მატჩის მდგომარეობა
  let mTimers = [];

  const later = (fn, ms) => { const id = setTimeout(fn, ms); mTimers.push(id); return id; };
  const teamById = (id) => state.players.find((p) => p.id === id);

  function feed(text, cls, min) {
    const ul = $('m-feed');
    const li = document.createElement('li');
    li.className = cls || '';
    li.innerHTML = (min != null ? `<span class="mn">${min}'</span>` : '') + esc(text);
    ul.prepend(li);
  }

  function moveBall(x, y) {
    const b = $('ball');
    b.style.left = x + '%';
    b.style.top = y + '%';
  }

  function startMatch() {
    const m = state.match;
    const A = teamById(m.a.id), B = teamById(m.b.id);
    if (!A || !B) { store.set(MATCH_KEY, m.id); render(); return; }
    matchPlaying = true;
    store.set(MATCH_KEY, m.id);
    show('match');
    $('m-a').innerHTML = `${avatar(A.name, undefined)}<span class="nm">${esc(A.name)}</span>`;
    $('m-b').innerHTML = `${avatar(B.name, undefined)}<span class="nm">${esc(B.name)}</span>`;
    $('m-sa').textContent = '0'; $('m-sb').textContent = '0';
    $('m-clock').textContent = "0'";
    $('m-phase').textContent = 'ფინალი';
    $('m-la').innerHTML = slotsHtml(A.team, 'ml-a');
    $('m-lb').innerHTML = slotsHtml(B.team, 'ml-b');
    $('m-feed').innerHTML = '';
    $('m-pens').hidden = true;
    $('m-prog').style.width = '0%';
    $('goal-flash').hidden = true;
    $('m-marks').innerHTML = m.events.filter((e) => e.type === 'goal')
      .map((e) => `<i class="mk ${e.side}" style="left:${(e.min / 90 * 100).toFixed(1)}%"></i>`).join('');
    moveBall(50, 50);
    feed(`${A.name} - ${B.name}. მატჩი იწყება!`, 'sys');
    play('whistle');
    if (window.GSound) GSound.ambience(true);
    mt = { last: performance.now(), minute: 0, pauseUntil: 0, idx: 0, score: { a: 0, b: 0 }, half: false, ended: false, nextRoam: 0, raf: 0 };
    mt.raf = requestAnimationFrame(matchTick);
  }

  function pauseFor(ms) { mt.pauseUntil = performance.now() + ms; }

  function fireEvent(e) {
    const m = state.match;
    const team = e.side === 'a' ? m.a : m.b;
    if (e.type === 'goal') {
      mt.score[e.side]++;
      const el = $(e.side === 'a' ? 'm-sa' : 'm-sb');
      el.textContent = String(mt.score[e.side]);
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      moveBall(e.side === 'a' ? 96 : 4, 50);
      $('gf-name').textContent = `${e.player} · ${e.min}'`;
      $('goal-flash').hidden = false;
      later(() => { $('goal-flash').hidden = true; }, 2000);
      const mini = $(`ml-${e.side}-${e.slot}`);
      if (mini) { mini.classList.add('scored'); later(() => mini.classList.remove('scored'), 1800); }
      feed(`გოლი! ${e.player} (${team.name})`, 'goal', e.min);
      play('goal');
      if (window.GSound) GSound.swell();
      confetti(36);
      pauseFor(2400);
    } else {
      const text = e.kind === 'post' ? `${e.player} — დარტყმა ძელს!`
        : e.kind === 'save' ? `${e.player} — მეკარემ გადაარჩინა!`
        : `${e.player} — ოდნავ გვერდზე!`;
      moveBall(e.side === 'a' ? 86 : 14, 30 + Math.random() * 40);
      feed(text, '', e.min);
      play(e.kind === 'post' ? 'post' : 'chance');
      pauseFor(900);
    }
  }

  function matchTick(now) {
    if (!matchPlaying || !mt) return;
    const m = state && state.match;
    if (!m) { stopMatch(); return; }
    const dt = Math.min(100, now - mt.last);
    mt.last = now;
    if (!mt.ended && now >= mt.pauseUntil) {
      mt.minute = Math.min(90, mt.minute + dt / MS_PER_MIN);
      $('m-clock').textContent = Math.floor(mt.minute) + "'";
      $('m-prog').style.width = (mt.minute / 90 * 100) + '%';
      while (mt.idx < m.events.length && m.events[mt.idx].min <= mt.minute && performance.now() >= mt.pauseUntil) {
        fireEvent(m.events[mt.idx++]);
      }
      if (!mt.half && mt.minute >= 45 && performance.now() >= mt.pauseUntil) {
        mt.half = true;
        $('m-phase').textContent = 'შესვენება';
        feed('შესვენება', 'sys', 45);
        play('halftime');
        pauseFor(1700);
        later(() => { if (matchPlaying) $('m-phase').textContent = 'მეორე ტაიმი'; }, 1700);
      }
      if (mt.minute >= 90 && mt.idx >= m.events.length) endRegulation();
      if (now >= mt.nextRoam && performance.now() >= mt.pauseUntil) {
        mt.nextRoam = now + 800 + Math.random() * 500;
        moveBall(18 + Math.random() * 64, 18 + Math.random() * 64);
      }
    }
    if (mt) mt.raf = requestAnimationFrame(matchTick);
  }

  function endRegulation() {
    const m = state.match;
    mt.ended = true;
    $('m-clock').textContent = "90'";
    $('m-prog').style.width = '100%';
    $('m-phase').textContent = 'მატჩი დასრულდა';
    moveBall(50, 50);
    feed(`მატჩი დასრულდა: ${m.score.a}:${m.score.b}`, 'sys', 90);
    play('finalWhistle');
    if (m.pens) later(startPens, 2200);
    else later(finishMatch, 2600);
  }

  function startPens() {
    const m = state.match;
    $('m-phase').textContent = 'პენალტები';
    $('m-pens').hidden = false;
    $('pk-na').textContent = m.a.name; $('pk-nb').textContent = m.b.name;
    $('pk-a').innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
    $('pk-b').innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
    $('pk-sa').textContent = '0'; $('pk-sb').textContent = '0';
    feed('პენალტების სერია იწყება', 'sys');
    const cnt = { a: 0, b: 0 };
    const score = { a: 0, b: 0 };
    m.pens.kicks.forEach((k, i) => {
      later(() => {
        play('kick');
        later(() => {
          const row = $(k.side === 'a' ? 'pk-a' : 'pk-b');
          let dot = row.children[cnt[k.side]];
          if (!dot) { dot = document.createElement('i'); row.appendChild(dot); }
          cnt[k.side]++;
          dot.className = k.scored ? 'go' : 'no';
          if (k.scored) score[k.side]++;
          $(k.side === 'a' ? 'pk-sa' : 'pk-sb').textContent = String(score[k.side]);
          const who = k.side === 'a' ? m.a.name : m.b.name;
          feed(`${who}: ${k.scored ? 'გოლი' : 'ვერ გაიტანა'}`, k.scored ? 'goal' : '');
          play(k.scored ? 'pkGoal' : 'pkMiss');
        }, 380);
      }, 1100 * (i + 1));
    });
    later(finishMatch, 1100 * (m.pens.kicks.length + 1) + 1600);
  }

  function stopMatch() {
    matchPlaying = false;
    mTimers.forEach(clearTimeout); mTimers = [];
    if (mt && mt.raf) cancelAnimationFrame(mt.raf);
    mt = null;
    if (window.GSound) GSound.ambience(false);
  }

  function finishMatch(skipped) {
    if (!matchPlaying) return;
    stopMatch();
    const iWon = state && state.results && state.results[0] && state.results[0].id === state.you.id;
    if (skipped !== true) {
      play('win');
      confetti(iWon ? 260 : 90);
    }
    render();
  }
  $('btn-skip').addEventListener('click', () => finishMatch(true));

  /* მთავარი გვერდის ბარათების მარაო */
  $('fan').innerHTML = [
    { name: 'Khvicha Kvaratskhelia', nat: '🇬🇪', ovr: 87, pos: 'FWD', base: 40000 },
    { name: 'Kylian Mbappé', nat: '🇫🇷', ovr: 91, pos: 'FWD', base: 40000 },
    { name: 'Pelé', nat: '🇧🇷', ovr: 98, pos: 'FWD', base: 40000, legend: true },
  ].map((c) => cardHtml(c)).join('');

  /* საწყისი მნიშვნელობები */
  $('in-name').value = store.get(NAME_KEY) || '';
  const qs = new URLSearchParams(location.search);
  const qcode = (qs.get('code') || '').replace(/\D/g, '').slice(0, 4);
  if (qcode) $('in-code').value = qcode;

  render();
})();
