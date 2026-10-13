'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { ROUNDS, THEME_LIST, THEMES, buildDeck, academyPlayer } = require('./players');
const { simulateMatch } = require('./match');

const PORT = process.env.PORT || 3000;
const FAST = process.env.GUNDI_FAST === '1'; // ტესტებისთვის: ტაიმერები სწრაფდება

const CFG = {
  minPlayers: 2,
  maxPlayers: 4,
  slots: 5,
  startBudget: 1000000,
  minIncrement: 10000,
  reservePerSlot: 40000, // ყოველი დარჩენილი ცარიელი სლოტისთვის მინიმუმ ერთი საწყისი ფასი უნდა დარჩეს
  bidMs: FAST ? 700 : 15000,
  antiSnipeMs: FAST ? 300 : 3000, // ბოლო წამებში ფსონი ტაიმერს ამდენამდე აბრუნებს
  pauseCardMs: FAST ? 80 : 3200,
  pauseRoundMs: FAST ? 80 : 4500,
  lobbyGraceMs: 25000,
  idleRoomMs: 15 * 60 * 1000,
  reactCooldownMs: FAST ? 0 : 450,
};

const REACTIONS = ['😂', '🔥', '😱', '👏', '💸'];

const app = express();
const server = http.createServer(app);

const origins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const io = new Server(server, {
  cors: { origin: origins.includes('*') ? '*' : origins, methods: ['GET', 'POST'] },
});

// ლოკალური გაშვებისას ფრონტენდსაც იგივე სერვერი გასცემს (../docs)
app.use(express.static(path.join(__dirname, '..', 'docs')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

/* ------------------------------------------------------------------ */
/* ოთახები                                                              */
/* ------------------------------------------------------------------ */

const rooms = new Map();

function genCode() {
  for (let i = 0; i < 300; i++) {
    const c = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(c)) return c;
  }
  return null;
}

function makePlayer(name) {
  return {
    id: crypto.randomBytes(4).toString('hex'),
    token: crypto.randomBytes(16).toString('hex'),
    name,
    socketId: null,
    connected: false,
    budget: CFG.startBudget,
    team: Array(CFG.slots).fill(null),
    score: 0,
    dcTimer: null,
  };
}

function makeRoom(code) {
  return {
    code,
    phase: 'lobby', // lobby | auction | finished
    hostId: null,
    players: [],
    roundIdx: 0,
    deck: [],
    cardIdx: 0,
    card: null,
    bid: 0,
    bidderId: null,
    bids: [],
    endsAt: null,
    roundWon: new Set(),
    unsold: [],
    used: new Set(),
    intermission: null,
    log: [],
    results: null,
    theme: 'classic',
    match: null,
    timer: null,
    idleSince: null,
  };
}

const getPlayer = (room, pid) => room.players.find((p) => p.id === pid);
const emptySlots = (p) => p.team.filter((x) => !x).length;
const maxBidFor = (p) => p.budget - CFG.reservePerSlot * Math.max(0, emptySlots(p) - 1);

function pushLog(room, text) {
  room.log.push({ t: Date.now(), text });
  if (room.log.length > 40) room.log.shift();
}

// ფარული რეიტინგის ბარათი: აუქციონის დროს ovr არ იგზავნება (გაყიდვის შემდეგ ჩანს)
function publicCard(card) {
  if (card && card.secret) return { ...card, ovr: null, hidden: true };
  return card;
}

function minNextBid(room) {
  if (!room.card) return 0;
  return room.bidderId ? room.bid + CFG.minIncrement : room.card.base;
}

function bidStatus(room, p) {
  const minNext = minNextBid(room);
  const maxBid = maxBidFor(p);
  let reason = null;
  if (room.phase !== 'auction' || !room.card) reason = 'wait';
  else if (!p.connected) reason = 'offline';
  else if (room.roundWon.has(p.id)) reason = 'won';
  else if (room.bidderId === p.id) reason = 'leader';
  else if (maxBid < minNext) reason = 'budget';
  return { canBid: reason === null, reason, minNext, maxBid };
}

function stateFor(room, p) {
  const st = bidStatus(room, p);
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    round: room.roundIdx,
    rounds: ROUNDS.map((r) => ({ key: r.key, label: r.label })),
    config: {
      bidMs: CFG.bidMs,
      minIncrement: CFG.minIncrement,
      startBudget: CFG.startBudget,
      minPlayers: CFG.minPlayers,
      maxPlayers: CFG.maxPlayers,
      themes: THEME_LIST,
    },
    theme: room.theme,
    match: room.match,
    players: room.players.map((x) => ({
      id: x.id,
      name: x.name,
      connected: x.connected,
      budget: x.budget,
      team: x.team,
      score: x.score,
      isHost: x.id === room.hostId,
      wonThisRound: room.roundWon.has(x.id),
    })),
    card: publicCard(room.card),
    cardNo: Math.min(room.cardIdx, room.deck.length),
    cardTotal: room.deck.length,
    bid: room.bid,
    bidderId: room.bidderId,
    endsAt: room.endsAt,
    bids: room.bids.slice(-8).reverse(),
    intermission: room.intermission,
    log: room.log.slice(-12).reverse(),
    results: room.results,
    serverNow: Date.now(),
    you: { id: p.id, ...st },
  };
}

function emitState(room) {
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('state', stateFor(room, p));
  }
}

function destroyRoom(room) {
  clearTimeout(room.timer);
  room.players.forEach((p) => clearTimeout(p.dcTimer));
  rooms.delete(room.code);
}

/* ------------------------------------------------------------------ */
/* აუქციონის დინამიკა                                                   */
/* ------------------------------------------------------------------ */

function startGame(room) {
  room.phase = 'auction';
  room.roundIdx = 0;
  room.used = new Set();
  room.results = null;
  room.match = null;
  room.log = [];
  room.players.forEach((p) => {
    p.budget = CFG.startBudget;
    p.team = Array(CFG.slots).fill(null);
    p.score = 0;
  });
  pushLog(room, 'თამაში დაიწყო! წარმატებები!');
  startRound(room);
}

function startRound(room) {
  room.deck = buildDeck(room.roundIdx, room.players.length, room.used, room.theme);
  room.deck.forEach((c) => room.used.add(c.id));
  room.cardIdx = 0;
  room.roundWon = new Set();
  room.unsold = [];
  room.card = null;
  room.bid = 0;
  room.bidderId = null;
  room.bids = [];
  room.endsAt = null;
  room.intermission = {
    kind: 'round_start',
    round: room.roundIdx,
    label: ROUNDS[room.roundIdx].label,
  };
  emitState(room);
  clearTimeout(room.timer);
  room.timer = setTimeout(() => nextCard(room), CFG.pauseRoundMs);
}

function nextCard(room) {
  if (!rooms.has(room.code) || room.phase !== 'auction') return;
  if (room.roundWon.size >= room.players.length || room.cardIdx >= room.deck.length) {
    return endRound(room);
  }
  room.card = room.deck[room.cardIdx++];
  room.bid = 0;
  room.bidderId = null;
  room.bids = [];
  room.intermission = null;
  room.endsAt = Date.now() + CFG.bidMs;
  emitState(room);
  clearTimeout(room.timer);
  room.timer = setTimeout(() => resolveCard(room), CFG.bidMs);
}

function resolveCard(room) {
  if (!rooms.has(room.code) || !room.card) return;
  clearTimeout(room.timer);
  const card = room.card;
  const winner = room.bidderId ? getPlayer(room, room.bidderId) : null;
  if (winner) {
    winner.budget -= room.bid;
    winner.team[room.roundIdx] = { ...card, price: room.bid };
    room.roundWon.add(winner.id);
    room.intermission = {
      kind: 'sold',
      card,
      winnerId: winner.id,
      winnerName: winner.name,
      price: room.bid,
    };
    pushLog(room, `${winner.name} — ${card.name} ($${room.bid.toLocaleString('en-US')})`);
  } else {
    room.unsold.push(card);
    room.intermission = { kind: 'unsold', card };
    pushLog(room, `${card.name} — ვერავინ იყიდა`);
  }
  room.card = null;
  room.endsAt = null;
  emitState(room);
  room.timer = setTimeout(() => nextCard(room), CFG.pauseCardMs);
}

function endRound(room) {
  // ვისაც რაუნდში ფეხბურთელი არ შეხვდა, იღებს უფასოდ (გუნდი ყოველთვის სრული იქნება)
  for (const p of room.players) {
    if (room.roundWon.has(p.id)) continue;
    let card;
    if (room.unsold.length) {
      const i = Math.floor(Math.random() * room.unsold.length);
      card = room.unsold.splice(i, 1)[0];
    } else {
      card = academyPlayer(room.roundIdx);
    }
    p.team[room.roundIdx] = { ...card, price: 0 };
    pushLog(room, `${p.name} უფასოდ იღებს: ${card.name}`);
  }
  if (room.roundIdx >= ROUNDS.length - 1) return finishGame(room);
  room.roundIdx += 1;
  startRound(room);
}

function finishGame(room) {
  room.phase = 'finished';
  room.card = null;
  room.endsAt = null;
  room.intermission = null;
  room.players.forEach((p) => {
    p.score = p.team.reduce((sum, x) => sum + (x ? x.ovr : 0), 0);
  });
  const bySc = room.players
    .slice()
    .sort((a, b) => b.score - a.score || b.budget - a.budget);

  // ფინალი: ორი საუკეთესო გუნდი ითამაშებს, გამარჯვებული ჩემპიონია
  room.match = simulateMatch(bySc[0], bySc[1]);
  const champ = bySc.find((p) => p.id === room.match.winnerId);
  const runner = bySc.find((p) => p.id !== room.match.winnerId && (p.id === bySc[0].id || p.id === bySc[1].id));
  const rest = bySc.filter((p) => p !== champ && p !== runner);

  room.results = [champ, runner, ...rest].map((p, i) => ({
    id: p.id, name: p.name, score: p.score, budget: p.budget, rank: i + 1,
  }));
  const m = room.match;
  const line = m.pens
    ? `${m.score.a}:${m.score.b} (პენალტები ${m.pens.a}:${m.pens.b})`
    : `${m.score.a}:${m.score.b}`;
  pushLog(room, `ფინალი ${m.a.name} - ${m.b.name}: ${line}. ჩემპიონი: ${champ.name}!`);
  emitState(room);
}

function placeBid(room, p, rawAmount) {
  if (room.phase !== 'auction' || !room.card) return 'ახლა აუქციონი არ მიმდინარეობს';
  const amount = Math.floor(Number(rawAmount));
  if (!Number.isFinite(amount) || amount <= 0) return 'არასწორი თანხა';
  const st = bidStatus(room, p);
  if (st.reason === 'won') return 'ამ რაუნდში უკვე იყიდე ფეხბურთელი';
  if (st.reason === 'leader') return 'შენ უკვე ლიდერობ';
  if (amount < st.minNext) return `მინიმალური ფსონია $${st.minNext.toLocaleString('en-US')}`;
  if (amount > st.maxBid) {
    return st.maxBid < st.minNext
      ? 'ბიუჯეტი არ გყოფნის'
      : `მაქსიმალური ფსონია $${st.maxBid.toLocaleString('en-US')} (დარჩენილი სლოტებისთვის თანხა უნდა შეგრჩეს)`;
  }
  room.bid = amount;
  room.bidderId = p.id;
  room.bids.push({ pid: p.id, name: p.name, amount, t: Date.now() });
  const left = room.endsAt - Date.now();
  if (left < CFG.antiSnipeMs) room.endsAt = Date.now() + CFG.antiSnipeMs;
  clearTimeout(room.timer);
  room.timer = setTimeout(() => resolveCard(room), Math.max(0, room.endsAt - Date.now()));
  emitState(room);
  return null;
}

/* ------------------------------------------------------------------ */
/* Socket.io                                                            */
/* ------------------------------------------------------------------ */

const reply = (cb, obj) => typeof cb === 'function' && cb(obj);
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 16);

function attach(socket, room, p) {
  clearTimeout(p.dcTimer);
  p.socketId = socket.id;
  p.connected = true;
  room.idleSince = null;
  socket.data.code = room.code;
  socket.data.pid = p.id;
}

function removeFromLobby(room, pid) {
  room.players = room.players.filter((p) => p.id !== pid);
  if (!room.players.length) return destroyRoom(room);
  if (room.hostId === pid) {
    const next = room.players.find((p) => p.connected) || room.players[0];
    room.hostId = next.id;
  }
  emitState(room);
}

function ctx(socket) {
  const room = rooms.get(socket.data.code);
  if (!room) return {};
  const p = getPlayer(room, socket.data.pid);
  if (!p || p.socketId !== socket.id) return {};
  return { room, p };
}

io.on('connection', (socket) => {
  socket.on('create_room', (data, cb) => {
    const name = cleanName(data && data.name);
    if (!name) return reply(cb, { ok: false, error: 'შეიყვანე სახელი' });
    const code = genCode();
    if (!code) return reply(cb, { ok: false, error: 'სერვერი გადატვირთულია, სცადე მოგვიანებით' });
    const room = makeRoom(code);
    const p = makePlayer(name);
    room.players.push(p);
    room.hostId = p.id;
    rooms.set(code, room);
    attach(socket, room, p);
    reply(cb, { ok: true, code, token: p.token, playerId: p.id });
    emitState(room);
  });

  socket.on('join_room', (data, cb) => {
    const name = cleanName(data && data.name);
    const code = String((data && data.code) || '').trim();
    if (!name) return reply(cb, { ok: false, error: 'შეიყვანე სახელი' });
    if (!/^\d{4}$/.test(code)) return reply(cb, { ok: false, error: 'კოდი უნდა იყოს 4 ციფრი' });
    const room = rooms.get(code);
    if (!room) return reply(cb, { ok: false, error: 'ასეთი ოთახი არ მოიძებნა' });
    if (room.phase !== 'lobby') return reply(cb, { ok: false, error: 'თამაში უკვე დაწყებულია' });
    if (room.players.length >= CFG.maxPlayers) return reply(cb, { ok: false, error: 'ოთახი სავსეა (მაქს. 4)' });
    if (room.players.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
      return reply(cb, { ok: false, error: 'ეს სახელი ოთახში უკვე არსებობს' });
    }
    const p = makePlayer(name);
    room.players.push(p);
    attach(socket, room, p);
    reply(cb, { ok: true, code, token: p.token, playerId: p.id });
    emitState(room);
  });

  // გვერდის განახლების / ინტერნეტის გაწყვეტის შემდეგ დაბრუნება
  socket.on('rejoin', (data, cb) => {
    const room = rooms.get(String((data && data.code) || ''));
    const p = room && room.players.find((x) => x.token === (data && data.token));
    if (!room || !p) return reply(cb, { ok: false });
    if (p.socketId && p.socketId !== socket.id) {
      const old = io.sockets.sockets.get(p.socketId);
      if (old) old.data = {};
    }
    attach(socket, room, p);
    reply(cb, { ok: true, code: room.code, playerId: p.id });
    emitState(room);
  });

  socket.on('set_theme', (data, cb) => {
    const { room, p } = ctx(socket);
    if (!room) return reply(cb, { ok: false, error: 'ოთახი ვერ მოიძებნა' });
    if (p.id !== room.hostId) return reply(cb, { ok: false, error: 'თემას მხოლოდ ჰოსტი ირჩევს' });
    if (room.phase !== 'lobby') return reply(cb, { ok: false, error: 'თემის შეცვლა მხოლოდ ლობიშია შესაძლებელი' });
    const key = String((data && data.theme) || '');
    if (!THEMES[key]) return reply(cb, { ok: false, error: 'უცნობი თემა' });
    room.theme = key;
    emitState(room);
    reply(cb, { ok: true });
  });

  // რეაქციები (ემოჯი) — ყველა მოთამაშეს ეგზავნება
  socket.on('react', (data) => {
    const { room, p } = ctx(socket);
    if (!room) return;
    const emoji = String((data && data.emoji) || '');
    if (!REACTIONS.includes(emoji)) return;
    const now = Date.now();
    if (p.lastReact && now - p.lastReact < CFG.reactCooldownMs) return;
    p.lastReact = now;
    for (const x of room.players) {
      if (x.socketId) io.to(x.socketId).emit('reaction', { pid: p.id, name: p.name, emoji });
    }
  });

  socket.on('start_game', (_data, cb) => {
    const { room, p } = ctx(socket);
    if (!room) return reply(cb, { ok: false, error: 'ოთახი ვერ მოიძებნა' });
    if (p.id !== room.hostId) return reply(cb, { ok: false, error: 'თამაშს მხოლოდ ჰოსტი იწყებს' });
    if (room.phase !== 'lobby') return reply(cb, { ok: false, error: 'თამაში უკვე დაწყებულია' });
    if (room.players.length < CFG.minPlayers) return reply(cb, { ok: false, error: 'საჭიროა მინიმუმ 2 მოთამაშე' });
    startGame(room);
    reply(cb, { ok: true });
  });

  socket.on('place_bid', (data, cb) => {
    const { room, p } = ctx(socket);
    if (!room) return reply(cb, { ok: false, error: 'ოთახი ვერ მოიძებნა' });
    const err = placeBid(room, p, data && data.amount);
    reply(cb, err ? { ok: false, error: err } : { ok: true });
  });

  socket.on('play_again', (_data, cb) => {
    const { room, p } = ctx(socket);
    if (!room) return reply(cb, { ok: false });
    if (p.id !== room.hostId) return reply(cb, { ok: false, error: 'მხოლოდ ჰოსტს შეუძლია' });
    if (room.phase !== 'finished') return reply(cb, { ok: false });
    clearTimeout(room.timer);
    room.phase = 'lobby';
    room.results = null;
    room.match = null;
    room.log = [];
    room.card = null;
    room.deck = [];
    room.players = room.players.filter((x) => x.connected);
    room.players.forEach((x) => {
      x.budget = CFG.startBudget;
      x.team = Array(CFG.slots).fill(null);
      x.score = 0;
    });
    emitState(room);
    reply(cb, { ok: true });
  });

  socket.on('leave_room', (_data, cb) => {
    const { room, p } = ctx(socket);
    if (room) {
      p.socketId = null;
      p.connected = false;
      p.token = crypto.randomBytes(16).toString('hex'); // ძველი სესია აღარ აღდგება
      socket.data = {};
      if (room.phase === 'lobby' || room.phase === 'finished') removeFromLobby(room, p.id);
      else emitState(room);
    }
    reply(cb, { ok: true });
  });

  socket.on('disconnect', () => {
    const { room, p } = ctx(socket);
    if (!room) return;
    p.connected = false;
    p.socketId = null;
    if (room.phase === 'lobby') {
      p.dcTimer = setTimeout(() => {
        if (!p.connected && rooms.has(room.code)) removeFromLobby(room, p.id);
      }, CFG.lobbyGraceMs);
    }
    if (!room.players.some((x) => x.connected)) room.idleSince = Date.now();
    emitState(room);
  });
});

// ცარიელი (ყველა გათიშული) ოთახების გასუფთავება
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.idleSince && now - room.idleSince > CFG.idleRoomMs) destroyRoom(room);
  }
}, 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Gundi server: http://localhost:${PORT}${FAST ? '  (FAST test mode)' : ''}`);
});

module.exports = { server, io, CFG };
