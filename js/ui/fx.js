// Sound (ZzFX), background music (Tone.js), confetti and fireworks.
// Everything here is optional: a failed library just means no effect.

import { lib } from './libs.js';
import { reducedMotion, settings } from './settings.js';

// ZzFX parameter lists: volume, randomness, frequency, attack, sustain, release, shape, ...
const SOUNDS = {
  dice: [1.4, 0.3, 240, 0, 0.02, 0.05, 4, 1.8, 0, 0, 0, 0, 0.03, 0.6],
  coin: [0.9, 0, 1675, 0, 0.06, 0.24, 1, 1.82, 0, 0, 837, 0.06],
  pay: [0.8, 0, 420, 0.01, 0.08, 0.22, 1, 1.4, -6],
  turn: [0.8, 0, 523, 0.02, 0.06, 0.25, 1, 1.5, 0, 0, 262, 0.08],
  card: [0.7, 0, 880, 0.01, 0.04, 0.12, 0, 1, 12],
  build: [0.9, 0, 196, 0.01, 0.05, 0.18, 3, 0.6, 0, 0, 98, 0.05],
  error: [0.6, 0, 150, 0.02, 0.05, 0.12, 3, 0.5],
  win: [1, 0, 392, 0.04, 0.3, 0.45, 1, 1.5, 0, 0, 196, 0.12, 0.1],
};

let zz = null;

export async function unlockAudio() {
  zz ??= await lib('zzfx');
  zz?.ZZFX?.audioContext?.resume?.();
  if (settings().music) setMusic(true);
}

export function sfx(name) {
  if (!settings().sound || !zz) return;
  try {
    zz.zzfx(...SOUNDS[name]);
  } catch {
    // Audio context not unlocked yet: skip this sound.
  }
}

export async function confettiBurst(kind = 'normal') {
  if (reducedMotion()) return;
  const confetti = await lib('confetti');
  if (!confetti) return;
  if (kind === 'envelope') {
    const shape = confetti.shapeFromText({ text: '🧧', scalar: 2.2 });
    confetti({ particleCount: 28, spread: 80, startVelocity: 38, scalar: 2.2, shapes: [shape], origin: { y: 0.65 } });
  } else {
    confetti({ particleCount: 110, spread: 75, origin: { y: 0.6 }, colors: ['#e8453c', '#f2b632', '#2fae5a', '#2f7de1'] });
  }
}

export async function fireworksShow(ms = 6000) {
  if (reducedMotion()) return;
  const Fireworks = await lib('fireworks');
  if (!Fireworks) return;
  const box = document.createElement('div');
  Object.assign(box.style, { position: 'fixed', inset: '0', zIndex: '45', pointerEvents: 'none' });
  document.body.append(box);
  const fw = new Fireworks(box, { intensity: 22, explosion: 6, sound: { enabled: false } });
  fw.start();
  setTimeout(() => {
    fw.waitStop?.().then(() => box.remove(), () => box.remove());
    if (!fw.waitStop) {
      fw.stop();
      box.remove();
    }
  }, ms);
}

// ---------- background music: a quiet pentatonic loop ----------

const NOTES = ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5'];
let music = null;

export async function setMusic(on) {
  if (!on) {
    music?.Tone.getTransport().stop();
    return;
  }
  const Tone = await lib('tone');
  if (!Tone) return;
  await Tone.start();
  if (!music) {
    const synth = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.02, release: 0.8 } }).toDestination();
    synth.volume.value = -18;
    let step = 0;
    const seq = new Tone.Loop((time) => {
      step += 1;
      const note = NOTES[(step * 3 + Math.floor(step / 4)) % NOTES.length];
      synth.triggerAttackRelease(note, '8n', time);
      if (step % 4 === 0) synth.triggerAttackRelease(NOTES[step % 3], '2n', time, 0.4);
    }, '4n');
    seq.start(0);
    music = { Tone, synth, seq };
    Tone.getTransport().bpm.value = 92;
  }
  if (settings().music) Tone.getTransport().start();
}

// Speeds up the loop near the end of the game.
export function setTempo(fast) {
  if (music) music.Tone.getTransport().bpm.rampTo(fast ? 120 : 92, 2);
}
