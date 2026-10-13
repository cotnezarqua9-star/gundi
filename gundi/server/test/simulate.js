'use strict';
// სრული ავტომატური ტესტი: 3 "მოთამაშე" ბოტი თამაშობს მთელ თამაშს (სწრაფ რეჟიმში).
// გაშვება: npm test
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3999;
const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
  if (!cond) failed++;
};
const emit = (s, ev, data) => new Promise((res) => s.emit(ev, data, res));

function connect() {
  return new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'] });
    s.latest = null;
    s.on('state', (st) => (s.latest = st));
    s.on('connect', () => resolve(s));
  });
}

async function main() {
  const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), GUNDI_FAST: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await sleep(800);
  try {
    const [a, b, c, d] = await Promise.all([connect(), connect(), connect(), connect()]);

    console.log('ლობი:');
    let r = await emit(a, 'create_room', { name: '' });
    check(!r.ok, 'ცარიელი სახელით ოთახი არ იქმნება');
    r = await emit(a, 'create_room', { name: 'Ana' });
    check(r.ok && /^\d{4}$/.test(r.code), `ოთახი შეიქმნა, კოდი ${r.code}`);
    const code = r.code;
    r = await emit(b, 'join_room', { code: '0000', name: 'Beka' });
    check(!r.ok, 'არასწორი კოდით შესვლა იკრძალება');
    r = await emit(b, 'join_room', { code, name: 'Ana' });
    check(!r.ok, 'დუბლირებული სახელი იკრძალება');
    r = await emit(b, 'start_game', {});
    check(!r.ok, 'ოთახის გარეშე start_game არ მუშაობს');
    r = await emit(a, 'start_game', {});
    check(!r.ok, 'ერთი მოთამაშით დაწყება შეუძლებელია');
    r = await emit(b, 'join_room', { code, name: 'Beka' });
    check(r.ok, 'Beka შემოვიდა');
    r = await emit(c, 'join_room', { code, name: 'Cota' });
    check(r.ok, 'Cota შემოვიდა');
    r = await emit(d, 'join_room', { code, name: 'Dato' });
    check(r.ok, 'Dato შემოვიდა (მე-4)');
    const e = await connect();
    r = await emit(e, 'join_room', { code, name: 'Eka' });
    check(!r.ok, 'მე-5 მოთამაშე ვერ შემოდის');
    e.close();
    r = await emit(b, 'start_game', {});
    check(!r.ok, 'არა-ჰოსტი ვერ იწყებს თამაშს');

    console.log('თემები და რეაქციები:');
    r = await emit(b, 'set_theme', { theme: 'elite' });
    check(!r.ok, 'არა-ჰოსტი ვერ ცვლის თემას');
    r = await emit(a, 'set_theme', { theme: 'bogus' });
    check(!r.ok, 'უცნობი თემა უარყოფილია');
    r = await emit(a, 'set_theme', { theme: 'elite' });
    await sleep(100);
    check(r.ok && a.latest.theme === 'elite' && b.latest.theme === 'elite', 'ჰოსტმა აირჩია თემა „ელიტა“, ყველა ხედავს');
    check(a.latest.config.themes.length === 5, '5 თემა ხელმისაწვდომია');
    let got = [];
    c.on('reaction', (x) => got.push(x));
    d.emit('react', { emoji: '🔥' });
    d.emit('react', { emoji: '💀' });
    await sleep(250);
    check(got.length === 1 && got[0].emoji === '🔥' && got[0].name === 'Dato', 'რეაქცია ყველა მოთამაშეს მიუვიდა, უცნობი ემოჯი დაიბლოკა');

    // ბოტები
    const bots = [a, b, c, d];
    let hiddenSeen = 0, leak = false, lowSeen = false;
    a.on('state', (st) => {
      if (!st.card || st.phase !== 'auction') return;
      if (st.card.hidden) { hiddenSeen++; if (st.card.ovr !== null) leak = true; }
      else if (st.round < 4 && st.card.ovr < 86) lowSeen = true;
    });
    let lowBidRejected = false;
    let overBudgetRejected = false;
    bots.forEach((s, i) => {
      s.on('state', async (st) => {
        if (st.phase !== 'auction' || !st.card || !st.you.canBid) return;
        if (s.busy) return;
        s.busy = true;
        await sleep(15 + Math.random() * 60);
        const cur = s.latest;
        if (cur && cur.card && cur.you.canBid) {
          if (i === 1 && !lowBidRejected) {
            const rr = await emit(s, 'place_bid', { amount: 1 });
            lowBidRejected = !rr.ok;
          }
          if (i === 2 && !overBudgetRejected) {
            const rr = await emit(s, 'place_bid', { amount: 99999999 });
            overBudgetRejected = !rr.ok;
          }
          if (Math.random() < 0.75) {
            const extra = Math.random() < 0.3 ? 10000 * Math.floor(Math.random() * 5) : 0;
            await emit(s, 'place_bid', { amount: Math.min(cur.you.maxBid, cur.you.minNext + extra) });
          }
        }
        s.busy = false;
      });
    });

    r = await emit(a, 'start_game', {});
    check(r.ok, 'ჰოსტმა დაიწყო თამაში');
    r = await emit(await connect(), 'join_room', { code, name: 'Late' });
    check(!r.ok, 'დაწყებულ თამაშში შესვლა იკრძალება');

    console.log('თამაში მიმდინარეობს...');
    const t0 = Date.now();
    while (a.latest.phase !== 'finished' && Date.now() - t0 < 60000) await sleep(100);
    const fin = a.latest;
    check(fin.phase === 'finished', `თამაში დასრულდა (${((Date.now() - t0) / 1000).toFixed(1)}წმ)`);
    check(lowBidRejected, 'ძალიან დაბალი ფსონი უარყოფილია');
    check(overBudgetRejected, 'ბიუჯეტზე მაღალი ფსონი უარყოფილია');
    check(fin.players.every((p) => p.team.every(Boolean)), 'ყველას გუნდი სრულია (5/5 სლოტი)');
    check(fin.players.every((p) => p.budget >= 0), 'არავის ბიუჯეტი არ გასულა ნულს ქვემოთ');
    check(
      fin.players.every((p) => p.budget + p.team.reduce((s, x) => s + x.price, 0) === 1000000),
      'ბიუჯეტი + დახარჯული = $1,000,000 ყველასთვის'
    );
    const ids = fin.players.flatMap((p) => p.team.map((x) => x.id)).filter((id) => !id.startsWith('ACA'));
    check(new Set(ids).size === ids.length, 'ერთი ფეხბურთელი ორ გუნდში არ მოხვედრილა');
    check(
      fin.players.every((p) => ['GK', 'DEF', 'MID', 'FWD'].every((pos, i) => p.team[i].pos === pos)),
      'სლოტები სწორ პოზიციებზეა (GK/DEF/MID/FWD + ჯოკერი)'
    );
    check(fin.results.length === 4 && fin.results[0].rank === 1, `გამარჯვებული: ${fin.results[0].name} (${fin.results[0].score} ქულა)`);
    check(!leak, `ფარული ბარათის რეიტინგი არ ჟონავს (ფარული ბარათები: ${hiddenSeen} მდგომარეობა)`);
    check(!lowSeen, 'თემა „ელიტა“: პირველ 4 რაუნდში 86-ზე დაბალი რეიტინგი არ გამოჩენილა');
    const m = fin.match;
    check(!!m && m.events.filter((e) => e.type === 'goal').length === m.score.a + m.score.b, `ფინალური მატჩი: ${m && m.score.a}:${m && m.score.b}, გოლების რაოდენობა ემთხვევა`);
    check(m.winnerId === fin.results[0].id, 'ჩემპიონი = მატჩის გამარჯვებული');
    const top2 = fin.players.slice().sort((x, y) => y.score - x.score || y.budget - x.budget).slice(0, 2).map((p) => p.id).sort();
    check(JSON.stringify([m.a.id, m.b.id].sort()) === JSON.stringify(top2), 'ფინალს ორი საუკეთესო გუნდი თამაშობს');
    check(m.score.a !== m.score.b ? m.pens === null : !!m.pens && m.pens.a !== m.pens.b, 'ფრე -> პენალტები გადაწყვეტს, არაფრე -> პენალტები არ არის');

    console.log('თავიდან თამაში:');
    r = await emit(b, 'play_again', {});
    check(!r.ok, 'არა-ჰოსტი ვერ იწყებს ახალ თამაშს');
    r = await emit(a, 'play_again', {});
    await sleep(150);
    check(r.ok && a.latest.phase === 'lobby' && a.latest.match === null && a.latest.theme === 'elite', 'ჰოსტმა დააბრუნა ლობიში (თემა შენარჩუნდა, მატჩი გასუფთავდა)');

    console.log('rejoin:');
    const tokenRes = await emit(await connect(), 'rejoin', { code, token: 'bad' });
    check(!tokenRes.ok, 'არასწორი ტოკენით rejoin არ მუშაობს');
  } finally {
    srv.kill();
  }
  console.log(failed ? `\n${failed} ტესტი ჩავარდა` : '\nყველა ტესტი გავიდა ✔');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
