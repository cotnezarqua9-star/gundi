'use strict';
/* Gundi — ხმები. ყველაფერი სინთეზირებულია Web Audio-თი, აუდიო ფაილები არ სჭირდება. */
(function () {
  const KEY = 'gundi_sound';
  let ctx = null, master = null, noiseBuf = null;
  let amb = null; // ფონური გულშემატკივრების ხმაური
  let on = true;
  try { on = localStorage.getItem(KEY) !== '0'; } catch (_) {}

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.8;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ტონი: სიხშირე f (შეიძლება f2-მდე გადაცურდეს), t — დაგვიანება, d — ხანგრძლივობა
  function tone(o) {
    const c = ctx, now = c.currentTime + (o.t || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, now);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, now + o.d);
    const v = o.v == null ? 0.25 : o.v, a = o.a || 0.006;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(v, now + a);
    g.gain.exponentialRampToValueAtTime(0.0001, now + o.d);
    let node = osc;
    if (o.lp) {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp;
      osc.connect(f); node = f;
    }
    node.connect(g); g.connect(master);
    if (o.vib) { // ვიბრატო (სასტვენისთვის)
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = o.vib; lg.gain.value = o.f * 0.04;
      lfo.connect(lg); lg.connect(osc.frequency);
      lfo.start(now); lfo.stop(now + o.d + 0.05);
    }
    osc.start(now); osc.stop(now + o.d + 0.05);
  }

  function noise(o) {
    const c = ctx, now = c.currentTime + (o.t || 0);
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.f || 1000, now);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, now + o.d);
    f.Q.value = o.q || 0.7;
    const g = c.createGain();
    const a = o.a || 0.004, v = o.v == null ? 0.25 : o.v;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(v, now + a);
    g.gain.exponentialRampToValueAtTime(0.0001, now + o.d);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(now); src.stop(now + o.d + 0.05);
  }

  const N = { C4: 261.6, E4: 329.6, G4: 392, C5: 523.3, E5: 659.3, G5: 784, C6: 1046.5, D5: 587.3, A4: 440 };

  const sounds = {
    click() { tone({ f: 720, f2: 420, d: 0.06, type: 'triangle', v: 0.16 }); },
    join() { tone({ f: 660, f2: 880, d: 0.16, v: 0.2 }); tone({ f: 990, t: 0.09, d: 0.18, v: 0.14 }); },
    error() { tone({ f: 170, d: 0.16, type: 'square', v: 0.09, lp: 900 }); tone({ f: 125, t: 0.1, d: 0.2, type: 'square', v: 0.09, lp: 900 }); },
    // შენი ფსონი: მონეტა + „ზარი“
    bid() {
      tone({ f: 880, d: 0.14, type: 'triangle', v: 0.22 });
      tone({ f: 1320, t: 0.07, d: 0.3, type: 'triangle', v: 0.22 });
      noise({ type: 'highpass', f: 6500, d: 0.05, v: 0.08 });
    },
    bidOther() { tone({ f: 340, f2: 300, d: 0.12, v: 0.14 }); noise({ type: 'bandpass', f: 1800, d: 0.04, v: 0.05 }); },
    outbid() {
      tone({ f: 330, f2: 250, d: 0.22, type: 'sawtooth', v: 0.09, lp: 1400 });
      tone({ f: 247, f2: 185, t: 0.14, d: 0.3, type: 'sawtooth', v: 0.09, lp: 1400 });
    },
    tick() { tone({ f: 1250, d: 0.045, type: 'square', v: 0.06, lp: 3000 }); },
    tickLast() { tone({ f: 1750, d: 0.07, type: 'square', v: 0.09, lp: 3500 }); },
    // სასტვენი ახალი ბარათის დასაწყისზე
    whistle() {
      tone({ f: 2650, d: 0.11, v: 0.1, vib: 32, a: 0.01 });
      tone({ f: 2650, t: 0.15, d: 0.3, v: 0.1, vib: 32, a: 0.01 });
    },
    // ჩაქუჩი
    gavel() {
      noise({ type: 'lowpass', f: 1100, d: 0.09, v: 0.5 });
      tone({ f: 170, f2: 60, d: 0.2, v: 0.6 });
      noise({ type: 'lowpass', f: 1100, t: 0.2, d: 0.09, v: 0.4 });
      tone({ f: 150, f2: 55, t: 0.2, d: 0.2, v: 0.5 });
    },
    cheer() { noise({ type: 'bandpass', f: 900, f2: 2200, q: 0.7, d: 1.5, a: 0.45, v: 0.2 }); },
    winCard() {
      [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone({ f, t: 0.28 + i * 0.09, d: 0.38, type: 'triangle', v: 0.22 }));
      noise({ type: 'bandpass', f: 1000, f2: 2600, q: 0.7, t: 0.2, d: 1.8, a: 0.5, v: 0.26 });
    },
    // ლეგენდის გამოჩენა: მბზინავი აკორდი
    legend() {
      [N.E5, N.G5, N.C6, 1318.5, 1568].forEach((f, i) => tone({ f, t: 0.35 + i * 0.07, d: 0.9, type: 'triangle', v: 0.13 }));
      noise({ type: 'highpass', f: 7000, t: 0.35, d: 0.5, v: 0.05 });
    },
    // ფარული ბარათი: იდუმალი ბგერა
    mystery() {
      tone({ f: 180, f2: 250, d: 0.7, v: 0.14, lp: 900 });
      tone({ f: 1400, t: 0.25, d: 0.5, type: 'triangle', v: 0.05, vib: 7 });
    },
    // რეიტინგის გამჟღავნება
    reveal() {
      noise({ type: 'lowpass', f: 700, d: 0.14, v: 0.35 });
      tone({ f: 120, f2: 55, d: 0.22, v: 0.4 });
      [N.E5, N.G5, N.C6, 1318.5].forEach((f, i) => tone({ f, t: 0.12 + i * 0.07, d: 0.4, type: 'triangle', v: 0.16 }));
      noise({ type: 'highpass', f: 7500, t: 0.1, d: 0.5, v: 0.05 });
    },
    react() { tone({ f: 520, f2: 940, d: 0.11, type: 'triangle', v: 0.08 }); },
    // ფინალური მატჩი
    goal() {
      tone({ f: 233, d: 1.2, type: 'sawtooth', v: 0.1, lp: 1300 });
      tone({ f: 349, d: 1.2, type: 'sawtooth', v: 0.08, lp: 1300 });
      noise({ type: 'bandpass', f: 900, f2: 2600, q: 0.7, d: 2.6, a: 0.25, v: 0.3 });
    },
    chance() {
      noise({ type: 'bandpass', f: 600, f2: 1300, q: 0.8, d: 0.9, a: 0.3, v: 0.12 });
      tone({ f: 520, f2: 430, d: 0.5, v: 0.05 });
    },
    post() {
      tone({ f: 1900, f2: 1700, d: 0.35, type: 'triangle', v: 0.14 });
      noise({ type: 'highpass', f: 5000, d: 0.08, v: 0.12 });
      noise({ type: 'bandpass', f: 600, f2: 1300, q: 0.8, t: 0.1, d: 0.8, a: 0.3, v: 0.1 });
    },
    kick() {
      noise({ type: 'lowpass', f: 400, d: 0.08, v: 0.3 });
      tone({ f: 120, f2: 60, d: 0.13, v: 0.35 });
    },
    pkGoal() {
      noise({ type: 'bandpass', f: 1000, f2: 2400, q: 0.7, d: 1.1, a: 0.15, v: 0.22 });
      tone({ f: 784, d: 0.25, type: 'triangle', v: 0.12 });
    },
    pkMiss() {
      tone({ f: 300, f2: 150, d: 0.55, type: 'sawtooth', v: 0.07, lp: 900 });
      noise({ type: 'bandpass', f: 500, f2: 300, q: 0.8, d: 0.7, a: 0.2, v: 0.1 });
    },
    halftime() {
      tone({ f: 2650, d: 0.14, v: 0.1, vib: 32, a: 0.01 });
      tone({ f: 2650, t: 0.22, d: 0.14, v: 0.1, vib: 32, a: 0.01 });
    },
    finalWhistle() {
      tone({ f: 2650, d: 0.14, v: 0.1, vib: 32, a: 0.01 });
      tone({ f: 2650, t: 0.25, d: 0.14, v: 0.1, vib: 32, a: 0.01 });
      tone({ f: 2650, t: 0.5, d: 0.6, v: 0.1, vib: 32, a: 0.01 });
    },
    unsold() {
      tone({ f: 392, f2: 330, d: 0.45, type: 'triangle', v: 0.2 });
      tone({ f: 330, f2: 247, t: 0.32, d: 0.7, type: 'triangle', v: 0.2 });
    },
    // რაუნდის ფანფარა
    fanfare() {
      [[N.C4, 0], [N.E4, 0.17], [N.G4, 0.34]].forEach(([f, t]) => tone({ f, t, d: 0.3, type: 'sawtooth', v: 0.11, lp: 2200 }));
      [N.C5, N.E5, N.G5].forEach((f) => tone({ f, t: 0.55, d: 0.9, type: 'sawtooth', v: 0.08, lp: 2400 }));
      tone({ f: N.C4, t: 0.55, d: 0.9, type: 'sawtooth', v: 0.1, lp: 1800 });
    },
    win() {
      const seq = [[N.C5, 0], [N.C5, 0.14], [N.C5, 0.28], [N.E5, 0.46], [N.G5, 0.7], [N.E5, 0.95], [N.G5, 1.15], [N.C6, 1.4]];
      seq.forEach(([f, t], i) => tone({ f, t, d: i === seq.length - 1 ? 1.4 : 0.26, type: 'sawtooth', v: 0.1, lp: 2600 }));
      [N.C4, N.G4].forEach((f) => tone({ f, t: 1.4, d: 1.4, type: 'sawtooth', v: 0.08, lp: 1800 }));
      noise({ type: 'bandpass', f: 900, f2: 2400, q: 0.7, t: 0.3, d: 3, a: 0.8, v: 0.24 });
    },
  };

  function play(name) {
    if (!on) return;
    if (!ensure()) return;
    try { sounds[name] && sounds[name](); } catch (_) {}
  }

  // ფონური გულშემატკივრების ხმაური აუქციონის დროს
  function ambience(want) {
    if (!ensure()) return;
    if (want && on) {
      if (amb) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.35;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(master);
      src.start();
      g.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 2);
      amb = { src, g };
    } else if (amb) {
      const a = amb; amb = null;
      a.g.gain.cancelScheduledValues(ctx.currentTime);
      a.g.gain.setValueAtTime(a.g.gain.value, ctx.currentTime);
      a.g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
      a.src.stop(ctx.currentTime + 0.9);
    }
  }

  // ფსონზე გულშემატკივრები „აღელდებიან“
  function swell() {
    if (!amb || !ctx) return;
    const t = ctx.currentTime;
    amb.g.gain.cancelScheduledValues(t);
    amb.g.gain.setValueAtTime(Math.max(amb.g.gain.value, 0.0001), t);
    amb.g.gain.linearRampToValueAtTime(0.11, t + 0.12);
    amb.g.gain.linearRampToValueAtTime(0.045, t + 1.4);
  }

  function setOn(v) {
    on = v;
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (_) {}
    if (!v) ambience(false);
    document.documentElement.classList.toggle('muted', !v);
    const b = document.getElementById('btn-sound');
    if (b) b.setAttribute('aria-pressed', String(v));
  }

  // ბრაუზერები აუდიოს მხოლოდ პირველი შეხების შემდეგ რთავენ
  const unlock = () => { ensure(); };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });

  window.GSound = {
    play, ambience, swell,
    isOn: () => on,
    toggle() { setOn(!on); if (on) play('join'); return on; },
    init() { setOn(on); },
  };
})();
