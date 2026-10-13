'use strict';
/*
 * ფინალური მატჩი: ორი საუკეთესო გუნდი ერთმანეთს „თამაშობს“.
 * შედეგი სერვერზე გამოითვლება (ყველა მოთამაშე ერთსა და იმავეს ხედავს),
 * კლიენტი მხოლოდ ანიმაციას უკრავს.
 *
 * სლოტები: 0 GK, 1 DEF, 2 MID, 3 FWD, 4 LEG
 */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function poisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function strength(team) {
  const [gk, def, mid, fwd, leg] = team.map((x) => (x ? x.ovr : 60));
  return {
    att: (fwd * 2 + mid * 1.5 + leg + def * 0.5) / 5,
    def: (gk * 1.5 + def * 2 + mid + leg * 0.5) / 5,
  };
}

// რეიტინგით შეწონილი არჩევანი (თავდამსხმელები ხშირად გაიტანენ, მეკარე იშვიათად)
const SCORER_W = [0.1, 1, 2.5, 4, 3];
function pickSlot(team, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// პენალტების სერია: 5 დარტყმა თითოეულს, შემდეგ „უცაბედი სიკვდილი“
function shootout() {
  const P = 0.76;
  const kicks = [];
  let a = 0, b = 0, ta = 0, tb = 0;
  const decided = () => {
    if (ta < 5 || tb < 5) return a > b + (5 - tb) || b > a + (5 - ta);
    return ta === tb && a !== b;
  };
  let guard = 0;
  while (!decided() && guard++ < 40) {
    const sa = Math.random() < P;
    kicks.push({ side: 'a', scored: sa }); ta++; if (sa) a++;
    if (decided()) break;
    const sb = Math.random() < P;
    kicks.push({ side: 'b', scored: sb }); tb++; if (sb) b++;
  }
  if (a === b) { kicks.push({ side: 'a', scored: true }); a++; }
  return { kicks, a, b };
}

const CHANCE_KINDS = ['post', 'save', 'miss'];

function simulateMatch(pa, pb) {
  const sa = strength(pa.team);
  const sb = strength(pb.team);
  const lamA = clamp(1.35 * Math.exp((sa.att - sb.def) / 9), 0.3, 4);
  const lamB = clamp(1.35 * Math.exp((sb.att - sa.def) / 9), 0.3, 4);
  const goals = { a: Math.min(7, poisson(lamA)), b: Math.min(7, poisson(lamB)) };
  if (process.env.GUNDI_FORCE_PENS) goals.b = goals.a; // მხოლოდ ტესტისთვის: ფრე -> პენალტები

  const teams = { a: pa, b: pb };
  const events = [];

  for (const side of ['a', 'b']) {
    for (let i = 0; i < goals[side]; i++) {
      const slot = pickSlot(teams[side].team, SCORER_W);
      const pl = teams[side].team[slot];
      events.push({ type: 'goal', min: rnd(1, 90), side, slot, player: pl ? pl.name : '?' });
    }
  }

  // „ცოტა დაკლებული“ მომენტები: ძელი, მეკარის გადარჩენა, გაცდენა
  const chances = rnd(3, 5);
  const attA = sa.att, attB = sb.att;
  for (let i = 0; i < chances; i++) {
    const side = Math.random() < attA / (attA + attB) ? 'a' : 'b';
    const slot = pickSlot(teams[side].team, SCORER_W);
    const pl = teams[side].team[slot];
    events.push({
      type: 'chance', kind: CHANCE_KINDS[rnd(0, 2)], min: rnd(2, 89), side, slot, player: pl ? pl.name : '?',
    });
  }
  events.sort((x, y) => x.min - y.min);

  let pens = null;
  let winnerId;
  if (goals.a !== goals.b) {
    winnerId = goals.a > goals.b ? pa.id : pb.id;
  } else {
    const so = shootout();
    pens = so;
    winnerId = so.a > so.b ? pa.id : pb.id;
  }

  return {
    id: `${Date.now()}${rnd(100, 999)}`,
    a: { id: pa.id, name: pa.name },
    b: { id: pb.id, name: pb.name },
    events,
    score: goals,
    pens,
    winnerId,
  };
}

module.exports = { simulateMatch, strength, shootout };
