'use strict';

// ფეხბურთელების ბაზა: [სახელი, ეროვნება (დროშა), რეიტინგი]
// რეიტინგები სავარაუდოა და მხოლოდ სათამაშო ბალანსისთვისაა. თავისუფლად შეცვალე/დაამატე.
const RAW = {
  GK: [
    ['Thibaut Courtois', '🇧🇪', 89],
    ['Alisson Becker', '🇧🇷', 89],
    ['Marc-André ter Stegen', '🇩🇪', 88],
    ['Gianluigi Donnarumma', '🇮🇹', 88],
    ['Ederson', '🇧🇷', 87],
    ['Mike Maignan', '🇫🇷', 87],
    ['Jan Oblak', '🇸🇮', 87],
    ['Emiliano Martínez', '🇦🇷', 87],
    ['Yassine Bounou', '🇲🇦', 86],
    ['Manuel Neuer', '🇩🇪', 85],
    ['David Raya', '🇪🇸', 85],
    ['Giorgi Mamardashvili', '🇬🇪', 84],
    ['Diogo Costa', '🇵🇹', 85],
    ['Gregor Kobel', '🇨🇭', 85],
    ['Unai Simón', '🇪🇸', 84],
    ['André Onana', '🇨🇲', 83],
  ],
  DEF: [
    ['Virgil van Dijk', '🇳🇱', 89],
    ['Rúben Dias', '🇵🇹', 88],
    ['Antonio Rüdiger', '🇩🇪', 87],
    ['Marquinhos', '🇧🇷', 87],
    ['William Saliba', '🇫🇷', 87],
    ['Alessandro Bastoni', '🇮🇹', 86],
    ['Achraf Hakimi', '🇲🇦', 86],
    ['Trent Alexander-Arnold', '🇬🇧', 86],
    ['Theo Hernández', '🇫🇷', 85],
    ['Joško Gvardiol', '🇭🇷', 85],
    ['Alphonso Davies', '🇨🇦', 84],
    ['Dani Carvajal', '🇪🇸', 84],
    ['Andrew Robertson', '🇬🇧', 84],
    ['Kim Min-jae', '🇰🇷', 84],
    ['Gabriel Magalhães', '🇧🇷', 86],
    ['Jules Koundé', '🇫🇷', 85],
    ['Ronald Araújo', '🇺🇾', 85],
    ['Éder Militão', '🇧🇷', 85],
    ['Nuno Mendes', '🇵🇹', 85],
    ['Reece James', '🇬🇧', 85],
    ['Pau Cubarsí', '🇪🇸', 84],
    ['Federico Dimarco', '🇮🇹', 84],
  ],
  MID: [
    ['Rodri', '🇪🇸', 91],
    ['Kevin De Bruyne', '🇧🇪', 90],
    ['Jude Bellingham', '🇬🇧', 90],
    ['Federico Valverde', '🇺🇾', 88],
    ['Martin Ødegaard', '🇳🇴', 88],
    ['Jamal Musiala', '🇩🇪', 88],
    ['Pedri', '🇪🇸', 87],
    ['Bruno Fernandes', '🇵🇹', 87],
    ['Declan Rice', '🇬🇧', 87],
    ['Florian Wirtz', '🇩🇪', 87],
    ['Bernardo Silva', '🇵🇹', 87],
    ['Vitinha', '🇵🇹', 86],
    ['Nicolò Barella', '🇮🇹', 86],
    ['Luka Modrić', '🇭🇷', 85],
    ['Phil Foden', '🇬🇧', 88],
    ['Joshua Kimmich', '🇩🇪', 87],
    ['Cole Palmer', '🇬🇧', 87],
    ['Dani Olmo', '🇪🇸', 86],
    ['Alexis Mac Allister', '🇦🇷', 85],
    ['Frenkie de Jong', '🇳🇱', 85],
    ['Eduardo Camavinga', '🇫🇷', 84],
    ['Enzo Fernández', '🇦🇷', 84],
  ],
  FWD: [
    ['Kylian Mbappé', '🇫🇷', 91],
    ['Erling Haaland', '🇳🇴', 91],
    ['Lamine Yamal', '🇪🇸', 90],
    ['Vinícius Júnior', '🇧🇷', 90],
    ['Harry Kane', '🇬🇧', 90],
    ['Mohamed Salah', '🇪🇬', 89],
    ['Lautaro Martínez', '🇦🇷', 88],
    ['Raphinha', '🇧🇷', 88],
    ['Ousmane Dembélé', '🇫🇷', 88],
    ['Victor Osimhen', '🇳🇬', 87],
    ['Bukayo Saka', '🇬🇧', 87],
    ['Khvicha Kvaratskhelia', '🇬🇪', 87],
    ['Robert Lewandowski', '🇵🇱', 86],
    ['Son Heung-min', '🇰🇷', 86],
    ['Antoine Griezmann', '🇫🇷', 86],
    ['Rafael Leão', '🇵🇹', 86],
    ['Julián Álvarez', '🇦🇷', 86],
    ['Alexander Isak', '🇸🇪', 86],
    ['Viktor Gyökeres', '🇸🇪', 86],
    ['Rodrygo', '🇧🇷', 85],
    ['Neymar', '🇧🇷', 85],
    ['Karim Benzema', '🇫🇷', 85],
    ['Ollie Watkins', '🇬🇧', 84],
  ],
};

// საწყისი ფასი ყველა ფეხბურთელზე ერთნაირია
const START_PRICE = 40000;
function basePrice() {
  return START_PRICE;
}

// ყველა დროის უდიდესი ფეხბურთელები: [სახელი, ეროვნება, რეიტინგი, პოზიცია]
// ისინი მხოლოდ ბოლო რაუნდში გამოდიან (ლეგენდების რაუნდი).
const LEGENDS_RAW = [
  ['Pelé', '🇧🇷', 98, 'FWD'],
  ['Diego Maradona', '🇦🇷', 97, 'MID'],
  ['Lionel Messi', '🇦🇷', 97, 'FWD'],
  ['Johan Cruyff', '🇳🇱', 96, 'FWD'],
  ['Zinedine Zidane', '🇫🇷', 96, 'MID'],
  ['Ronaldo Nazário', '🇧🇷', 96, 'FWD'],
  ['Cristiano Ronaldo', '🇵🇹', 95, 'FWD'],
  ['Franz Beckenbauer', '🇩🇪', 95, 'DEF'],
  ['Ronaldinho', '🇧🇷', 94, 'MID'],
  ['Paolo Maldini', '🇮🇹', 94, 'DEF'],
  ['Lev Yashin', '🇷🇺', 94, 'GK'],
  ['Alfredo Di Stéfano', '🇦🇷', 94, 'FWD'],
  ['Michel Platini', '🇫🇷', 93, 'MID'],
  ['Thierry Henry', '🇫🇷', 93, 'FWD'],
  ['Xavi', '🇪🇸', 93, 'MID'],
  ['Andrés Iniesta', '🇪🇸', 93, 'MID'],
  ['Gerd Müller', '🇩🇪', 93, 'FWD'],
  ['Eusébio', '🇵🇹', 93, 'FWD'],
  ['Marco van Basten', '🇳🇱', 93, 'FWD'],
  ['Garrincha', '🇧🇷', 93, 'FWD'],
  ['Gianluigi Buffon', '🇮🇹', 93, 'GK'],
  ['Franco Baresi', '🇮🇹', 92, 'DEF'],
  ['Iker Casillas', '🇪🇸', 92, 'GK'],
  ['Roberto Baggio', '🇮🇹', 92, 'FWD'],
  ['Zico', '🇧🇷', 92, 'MID'],
  ['Bobby Charlton', '🇬🇧', 92, 'MID'],
  ['Lothar Matthäus', '🇩🇪', 92, 'MID'],
  ['Cafu', '🇧🇷', 91, 'DEF'],
  ['Roberto Carlos', '🇧🇷', 91, 'DEF'],
  ['Kaká', '🇧🇷', 91, 'MID'],
  ['Dino Zoff', '🇮🇹', 91, 'GK'],
];

const ALL = [];
for (const pos of Object.keys(RAW)) {
  RAW[pos].forEach(([name, nat, ovr], i) => {
    ALL.push({ id: `${pos}${i}`, name, nat, ovr, pos, base: basePrice(ovr) });
  });
}

const LEGENDS = LEGENDS_RAW.map(([name, nat, ovr, pos], i) => ({
  id: `LEG${i}`, name, nat, ovr, pos, base: basePrice(), legend: true,
}));

// 5 რაუნდი = გუნდის 5 სლოტი (რაუნდი i -> სლოტი i)
const ROUNDS = [
  { key: 'GK', label: 'მეკარეები', pos: 'GK' },
  { key: 'DEF', label: 'მცველები', pos: 'DEF' },
  { key: 'MID', label: 'ნახევარმცველები', pos: 'MID' },
  { key: 'FWD', label: 'თავდამსხმელები', pos: 'FWD' },
  { key: 'LEGEND', label: 'ლეგენდები', pos: null, legends: true },
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- თემატური ოთახები ----------
const SA = ['🇧🇷', '🇦🇷', '🇺🇾', '🇨🇴', '🇨🇱', '🇪🇨', '🇵🇾', '🇵🇪'];
const EU = ['🇫🇷', '🇪🇸', '🇩🇪', '🇮🇹', '🇬🇧', '🇵🇹', '🇳🇱', '🇧🇪', '🇭🇷', '🇳🇴', '🇸🇪', '🇵🇱', '🇨🇭', '🇸🇮', '🇬🇪', '🇷🇺'];

// თუ რომელიმე პოზიციაზე თემატური ფეხბურთელები არ ჰყოფნის, დასტა დანარჩენებით შეივსება
const THEMES = {
  classic: { label: 'კლასიკური', desc: 'ყველა ფეხბურთელი, ყველა ქვეყანა', test: () => true },
  elite: { label: 'ელიტა 86+', desc: 'მხოლოდ 86 და მეტი რეიტინგის ვარსკვლავები', test: (p) => p.ovr >= 86 },
  hidden: { label: 'ფარული საგანძური', desc: 'ცოტა ნაკლებად ცნობილი სახეები (85 და ნაკლები რეიტინგი)', test: (p) => p.ovr <= 85 },
  sa: { label: 'სამხრეთ ამერიკა', desc: 'ბრაზილია, არგენტინა, ურუგვაი და მეზობლები', test: (p) => SA.includes(p.nat) },
  europe: { label: 'ევროპა', desc: 'მხოლოდ ევროპელები, საქართველოს ჩათვლით', test: (p) => EU.includes(p.nat) },
};
const THEME_LIST = Object.keys(THEMES).map((key) => ({ key, label: THEMES[key].label, desc: THEMES[key].desc }));

const SECRET_CHANCE = process.env.GUNDI_SECRET_CHANCE ? Number(process.env.GUNDI_SECRET_CHANCE) : 0.22; // ფარული რეიტინგის ბარათის შანსი
const SECRET_MAX = 2; // რაუნდში მაქსიმუმ ამდენი

// რაუნდის დასტა: მოთამაშეების რაოდენობა + 2 ბარათი (გამოყენებულები არ მეორდება)
function buildDeck(roundIdx, playerCount, used, themeKey) {
  const round = ROUNDS[roundIdx];
  const theme = THEMES[themeKey] || THEMES.classic;
  const need = playerCount + 2;
  const pool = round.legends
    ? LEGENDS.filter((p) => !used.has(p.id))
    : ALL.filter((p) => !used.has(p.id) && p.pos === round.pos);
  const themed = pool.filter(theme.test);
  const rest = pool.filter((p) => !theme.test(p));
  let deck = shuffle(themed).slice(0, need);
  if (deck.length < need) deck = deck.concat(shuffle(rest).slice(0, need - deck.length));
  deck = shuffle(deck);
  if (!round.legends) {
    let secrets = 0;
    deck = deck.map((c) => {
      if (secrets < SECRET_MAX && Math.random() < SECRET_CHANCE) { secrets++; return { ...c, secret: true }; }
      return c;
    });
  }
  return deck;
}

// თუ რაუნდში მოთამაშეს არაფერი შეხვდა, ის იღებს უფასო "აკადემიელს"
const ACADEMY_NAMES = ['აკადემიელი', 'ახალგაზრდა ტალანტი', 'რეზერვისტი', 'ლოკალური ვარსკვლავი'];
function academyPlayer(roundIdx) {
  const round = ROUNDS[roundIdx];
  const pos = round.pos || ['GK', 'DEF', 'MID', 'FWD'][Math.floor(Math.random() * 4)];
  const name = ACADEMY_NAMES[Math.floor(Math.random() * ACADEMY_NAMES.length)];
  return { id: `ACA${Date.now()}${Math.floor(Math.random() * 1e4)}`, name, nat: '🏟️', ovr: 60, pos, base: 0 };
}

module.exports = { ALL, LEGENDS, ROUNDS, THEMES, THEME_LIST, buildDeck, academyPlayer, basePrice };
