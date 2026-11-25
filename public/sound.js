const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const VOLUME = 0.8;

let ctx = null;
let master = null;
let noise = null;
let muted = localStorage.getItem("thankful-muted") === "1";

const noiseBurst = ({ at, dur, freq, q = 1, gain, type = "bandpass", sweepTo }) => {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, at);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + Math.min(0.01, dur / 4));
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter).connect(env).connect(master);
  src.start(at, Math.random() * 1.5, dur + 0.05);
};

const tone = ({ at, from, to = from, dur, gain, type = "sine" }) => {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(env).connect(master);
  osc.start(at);
  osc.stop(at + dur + 0.05);
};

const audioContext = () => {
  if (ctx) return ctx;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : VOLUME;
  master.connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
};

export const unlock = () => {
  if (audioContext().state === "suspended") ctx.resume();
};

export const isMuted = () => muted;
export const setMuted = (value) => {
  muted = value;
  localStorage.setItem("thankful-muted", value ? "1" : "0");
  if (master) master.gain.setTargetAtTime(value ? 0 : VOLUME, ctx.currentTime, 0.05);
};

const live = () => ctx?.state === "running" && !muted;

export const rustle = (intensity = 0.5, dur = 0.3) => {
  if (!live()) return;
  const t = ctx.currentTime;
  const grains = Math.round(5 + 60 * intensity * dur);
  for (let i = 0; i < grains; i++) {
    noiseBurst({ at: t + Math.random() * dur, dur: 0.02 + Math.random() * 0.05, freq: 2500 + Math.random() * 4500, q: 1.4, gain: 0.03 + Math.random() * 0.09 * intensity });
  }
};

export const chime = (human) => {
  if (!live()) return;
  const t = ctx.currentTime;
  const step = SCALE[Math.round((Math.min(Math.max(human, 0), 100) / 100) * (SCALE.length - 1))];
  const freq = 261.63 * 2 ** (step / 12);
  tone({ at: t, from: freq, dur: 1.4, gain: 0.16 });
  tone({ at: t, from: freq * 2, dur: 0.6, gain: 0.04, type: "triangle" });
};

export const pickUp = () => {
  if (!live()) return;
  tone({ at: ctx.currentTime, from: 330, to: 760, dur: 0.14, gain: 0.1, type: "triangle" });
  rustle(0.3, 0.15);
};

export const putDown = () => {
  if (!live()) return;
  tone({ at: ctx.currentTime, from: 560, to: 240, dur: 0.12, gain: 0.1, type: "triangle" });
  rustle(0.25, 0.12);
};

export const swish = () => {
  if (!live()) return;
  noiseBurst({ at: ctx.currentTime, dur: 1, freq: 3200, sweepTo: 450, q: 0.8, gain: 0.12 });
};
