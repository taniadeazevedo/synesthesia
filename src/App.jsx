import React, { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Play, Pause, RefreshCw, Download } from "lucide-react";

// ============================================================================
// 0) HELPERS
// ============================================================================

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function rgbToHex(r, g, b) {
  return `#${[r, g, b]
    .map((x) => {
      const hex = Math.round(x).toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    })
    .join("")}`;
}
function hexToRgb01(hex) {
  const h = (hex || "#808080").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return { r, g, b };
}
function rgbToHsv({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { s, v };
}
function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function variance(arr) {
  if (!arr.length) return 0;
  const m = mean(arr);
  return mean(arr.map((x) => (x - m) ** 2));
}

// ============================================================================
// 1) COLOR EXTRACTION (KMEANS)
// ============================================================================

function kMeansClustering(pixels, k = 5, maxIterations = 10) {
  if (pixels.length === 0) return [];
  let centroids = [];
  for (let i = 0; i < k; i++) centroids.push(pixels[Math.floor(Math.random() * pixels.length)]);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const clusters = Array(k)
      .fill(null)
      .map(() => []);

    pixels.forEach((pixel) => {
      let minDist = Infinity;
      let closest = 0;
      centroids.forEach((c, idx) => {
        const dist = Math.sqrt((pixel.r - c.r) ** 2 + (pixel.g - c.g) ** 2 + (pixel.b - c.b) ** 2);
        if (dist < minDist) {
          minDist = dist;
          closest = idx;
        }
      });
      clusters[closest].push(pixel);
    });

    centroids = clusters.map((cluster) => {
      if (cluster.length === 0) return centroids[0];
      const sum = cluster.reduce(
        (acc, p) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b }),
        { r: 0, g: 0, b: 0 }
      );
      return { r: sum.r / cluster.length, g: sum.g / cluster.length, b: sum.b / cluster.length };
    });
  }

  return centroids;
}

async function extractColors(imageFile) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        const maxSize = 320;
        const scale = Math.min(maxSize / img.width, maxSize / img.height);

        canvas.width = Math.max(1, Math.floor(img.width * scale));
        canvas.height = Math.max(1, Math.floor(img.height * scale));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = [];
        const data = imageData.data;

        // sampling stride: 8 pixels
        for (let i = 0; i < data.length; i += 4 * 8) {
          if (data[i + 3] > 128) pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
        }

        const centroids = kMeansClustering(pixels, 5);
        resolve({ colors: centroids.map((c) => rgbToHex(c.r, c.g, c.b)) });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(imageFile);
  });
}

// ============================================================================
// 2) METRICS FROM COLORS (THIS DRIVES TEXTURA + MÚSICA)
// ============================================================================

function deriveColorMetrics(colors = []) {
  const cols = (colors.length ? colors : ["#808080"]).slice(0, 6);
  const rgbs = cols.map(hexToRgb01);

  const luminances = rgbs.map(({ r, g, b }) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
  const warmnesses = rgbs.map(({ r, b }) => r - b); // warm >0, cold <0
  const sats = rgbs.map((rgb) => rgbToHsv(rgb).s);

  const lum = clamp(mean(luminances), 0, 1);
  const warm = clamp(mean(warmnesses), -1, 1);
  const sat = clamp(mean(sats), 0, 1);

  const paletteVar = clamp(variance(luminances) + variance(sats), 0, 0.2);

  // a simple "contrast" proxy
  const lumMin = Math.min(...luminances);
  const lumMax = Math.max(...luminances);
  const contrast = clamp(lumMax - lumMin, 0, 1);

  return { lum, warm, sat, paletteVar, contrast, colors: cols };
}

function deriveTextureFromMetrics(m) {
  // Editorial / museum-ish vocabulary
  if (m.sat < 0.22 && m.lum < 0.42) return "Velada";
  if (m.sat < 0.22 && m.lum >= 0.42) return "Bruma";

  if (m.warm > 0.12 && m.sat >= 0.35) return "Cálida";
  if (m.warm < -0.1 && m.sat >= 0.35) return "Fría";

  if (m.paletteVar > 0.06 && m.sat >= 0.3) return "Prismática";
  if (m.paletteVar > 0.04) return "Textural";

  if (m.lum > 0.62) return "Clara";
  if (m.lum < 0.35) return "Nocturna";

  return "Haze";
}

function deriveMoodFromMetrics(m) {
  // simple, stable, feels intentional
  if (m.lum < 0.36) return "nostálgica";
  if (m.lum > 0.68 && m.sat > 0.22) return "luminosa";
  if (m.sat < 0.22) return "suspendida";
  if (m.warm > 0.1) return "íntima";
  return "suspendida";
}

const POOLS_ATMOS = {
  íntima: ["Algo que vuelve sin avisar.", "Un sitio donde el mundo baja el volumen.", "Cerca, como si no hiciera falta decir nada."],
  nostálgica: ["Un eco que se resiste a desaparecer.", "Lo que queda cuando el tiempo se detiene.", "Un brillo viejo en la esquina de la memoria."],
  suspendida: ["Un instante congelado en el aire.", "La quietud que precede al recuerdo.", "Todo flota un segundo antes de caer."],
  luminosa: ["La claridad que baña los momentos compartidos.", "Un rayo de sol atrapado en la memoria.", "La luz como una promesa pequeña."],
};

function deriveBpmFromMetrics(m) {
  // Jon-Hopkins-ish: often 80–110 (but we keep it gentle)
  // More contrast & sat -> slightly higher energy
  const base = lerp(78, 102, clamp(m.sat * 0.55 + m.contrast * 0.45, 0, 1));
  // darker -> slower
  const darkPull = lerp(0, -10, clamp((0.55 - m.lum) / 0.55, 0, 1));
  return Math.round(clamp(base + darkPull, 72, 110));
}

function deriveMusicProfileFromMetrics(m) {
  // This is the “language” layer that makes it feel like a piece (not a preset).
  const bpm = deriveBpmFromMetrics(m);

  const reverbSeconds = clamp(lerp(1.4, 3.6, clamp((1 - m.lum) * 0.65 + m.paletteVar * 0.9, 0, 1)), 1.2, 3.8);

  // cutoff: bright + saturated -> more open
  const cutoff = clamp(lerp(900, 4200, clamp(m.lum * 0.6 + m.sat * 0.5, 0, 1)), 650, 5200);

  // detune spread: more palette variety -> richer chorus
  const detuneSpread = clamp(lerp(7, 22, clamp(m.paletteVar / 0.08, 0, 1)), 6, 24);

  // noise: more sat/contrast -> more “grain”
  const noiseLevel = clamp(lerp(0.006, 0.02, clamp(m.sat * 0.55 + m.contrast * 0.45, 0, 1)), 0.004, 0.03);

  // sidechain depth: more energy -> more “breathing”
  const sidechainDepth = clamp(lerp(0.03, 0.11, clamp(m.sat * 0.6 + m.contrast * 0.4, 0, 1)), 0.02, 0.14);

  // delay feedback & send: more paletteVar -> more space
  const delayFeedback = clamp(lerp(0.18, 0.34, clamp(m.paletteVar / 0.08, 0, 1)), 0.14, 0.38);
  const delayMix = clamp(lerp(0.18, 0.34, clamp((1 - m.lum) * 0.6 + m.paletteVar * 0.6, 0, 1)), 0.14, 0.42);

  // evolving macro motion (A/B sections)
  const evolveAmount = clamp(lerp(0.25, 0.9, clamp(m.paletteVar / 0.08, 0, 1)), 0.2, 1);

  return {
    bpm,
    reverbSeconds,
    cutoff,
    detuneSpread,
    noiseLevel,
    sidechainDepth,
    delayFeedback,
    delayMix,
    evolveAmount,
  };
}

// ============================================================================
// 3) OPTIONAL IA CAPTION (ONLY FOR “EXTRA FLAVOUR”, NOT REQUIRED)
//    If HF fails, we still look “designed” because metrics drive everything.
// ============================================================================

async function analyzeImageWithFreeAI(imageFile) {
  try {
    const reader = new FileReader();
    const base64 = await new Promise((resolve) => {
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(imageFile);
    });

    const response = await fetch("https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-large", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Optional token (recommended if you have it)
        // "Authorization": `Bearer ${import.meta.env.VITE_HF_TOKEN}`,
      },
      body: JSON.stringify({ inputs: String(base64).split(",")[1] }),
    });

    if (!response.ok) {
      const txt = await response.text().catch(() => "");
      console.warn("HF error:", response.status, txt);
      return { caption: null };
    }

    const result = await response.json();
    const desc = result?.[0]?.generated_text;
    return { caption: desc || null };
  } catch (e) {
    console.warn("HF exception:", e);
    return { caption: null };
  }
}

// ============================================================================
// 4) AUDIO — ELECTRÓNICA AMBIENT + (sidechain fake + grain + A/B evolution)
// ============================================================================

function makeImpulse(ctx, seconds) {
  const sampleRate = ctx.sampleRate;
  const impulse = ctx.createBuffer(2, Math.floor(sampleRate * seconds), sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = impulse.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const t = 1 - i / d.length;
      d[i] = (Math.random() * 2 - 1) * t * t;
    }
  }
  return impulse;
}

function makeNoiseBuffer(ctx, seconds = 2.0) {
  const sampleRate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, Math.floor(sampleRate * seconds), sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

async function generateAudio(colors, metrics) {
  const duration = 60;
  const sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, duration * sampleRate, sampleRate);

  const m = deriveMusicProfileFromMetrics(metrics);
  const bpm = m.bpm;
  const beat = 60 / bpm;

  // Master
  const master = ctx.createGain();
  master.gain.value = 0.92;
  master.connect(ctx.destination);

  // Soft glue
  const masterLP = ctx.createBiquadFilter();
  masterLP.type = "lowpass";
  masterLP.frequency.value = 18000;
  masterLP.Q.value = 0.3;
  masterLP.connect(master);

  // Bus filter
  const busFilter = ctx.createBiquadFilter();
  busFilter.type = "lowpass";
  busFilter.frequency.value = clamp(m.cutoff, 650, 5200);
  busFilter.Q.value = 0.75;
  busFilter.connect(masterLP);

  // Reverb
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, clamp(m.reverbSeconds, 1.2, 3.8));
  const revSend = ctx.createGain();
  revSend.gain.value = 0.34;
  revSend.connect(convolver);
  convolver.connect(masterLP);

  // Delay
  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = clamp(beat * 0.5, 0.18, 0.42);
  const fb = ctx.createGain();
  fb.gain.value = clamp(m.delayFeedback, 0.12, 0.38);
  delay.connect(fb);
  fb.connect(delay);

  const delaySend = ctx.createGain();
  delaySend.gain.value = clamp(m.delayMix, 0.12, 0.42);
  delaySend.connect(delay);
  delay.connect(masterLP);

  // Sidechain “fake” (very gentle breathing)
  const sidechain = ctx.createGain();
  sidechain.gain.value = 1.0;
  sidechain.connect(busFilter);

  // --- color → base pitch
  const dominant = metrics.colors?.[0] || colors?.[0] || "#808080";
  const { r, g, b } = hexToRgb01(dominant);

  // Keep it musical-ish
  const baseFreq = 78 + r * 190; // ~78..268
  const detuneSpread = clamp(m.detuneSpread, 6, 24);

  // PAD LAYER
  const padOut = ctx.createGain();
  padOut.gain.setValueAtTime(0.0, 0);
  padOut.gain.linearRampToValueAtTime(0.22, 6);
  padOut.connect(sidechain);
  padOut.connect(revSend);
  padOut.connect(delaySend);

  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = clamp(m.cutoff * 0.9, 650, 5200);
  padFilter.Q.value = 0.7;
  padFilter.connect(padOut);

  // gentle phasing feel
  const padLfo = ctx.createOscillator();
  padLfo.type = "sine";
  padLfo.frequency.value = 0.06;
  const padLfoGain = ctx.createGain();
  padLfoGain.gain.value = 140 + metrics.sat * 260;
  padLfo.connect(padLfoGain);
  padLfoGain.connect(padFilter.frequency);
  padLfo.start(0);

  const ratios = [1, 1.25, 1.5, 2, 2.5];
  ratios.forEach((mult, idx) => {
    const osc = ctx.createOscillator();
    osc.type = idx % 2 === 0 ? "sawtooth" : "triangle";

    const gNode = ctx.createGain();
    gNode.gain.value = idx === 0 ? 0.16 : 0.09;

    const det = (Math.random() * detuneSpread - detuneSpread / 2) + (idx - 2) * (detuneSpread * 0.18);
    osc.detune.value = det;

    const drift = 1 + (Math.random() - 0.5) * 0.01;
    osc.frequency.value = baseFreq * mult * drift;

    osc.connect(gNode);
    gNode.connect(padFilter);
    osc.start(0);
  });

  // TEXTURAL NOISE (grainy, filtered, very low)
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = makeNoiseBuffer(ctx, 3.0);
  noiseSrc.loop = true;

  const noiseHP = ctx.createBiquadFilter();
  noiseHP.type = "highpass";
  noiseHP.frequency.value = 1400 + g * 2600;

  const noiseBP = ctx.createBiquadFilter();
  noiseBP.type = "bandpass";
  noiseBP.frequency.value = 900 + r * 2400;
  noiseBP.Q.value = 0.9 + metrics.paletteVar * 8;

  const noiseGain = ctx.createGain();
  noiseGain.gain.value = clamp(m.noiseLevel, 0.004, 0.03);

  noiseSrc.connect(noiseHP);
  noiseHP.connect(noiseBP);
  noiseBP.connect(noiseGain);
  noiseGain.connect(sidechain);
  noiseGain.connect(revSend);

  noiseSrc.start(0);

  // PULSE: micro kick + hat (subtle)
  const pulseBus = ctx.createGain();
  pulseBus.gain.value = 0.18;
  pulseBus.connect(sidechain);
  pulseBus.connect(delaySend);

  const kick = (t) => {
    const o = ctx.createOscillator();
    o.type = "sine";

    const gk = ctx.createGain();
    gk.gain.setValueAtTime(0.0001, t);
    gk.gain.exponentialRampToValueAtTime(0.13, t + 0.005);
    gk.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);

    o.frequency.setValueAtTime(112 + b * 48, t);
    o.frequency.exponentialRampToValueAtTime(48 + b * 18, t + 0.14);

    o.connect(gk);
    gk.connect(pulseBus);
    o.start(t);
    o.stop(t + 0.16);
  };

  const hat = (t) => {
    const bufSize = Math.floor(sampleRate * 0.04);
    const nbuf = ctx.createBuffer(1, bufSize, sampleRate);
    const d = nbuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = nbuf;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 4500 + g * 1600;

    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(0.045, t + 0.003);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);

    src.connect(hp);
    hp.connect(gn);
    gn.connect(pulseBus);
    src.start(t);
    src.stop(t + 0.05);
  };

  // FAKE SIDECHAIN: dip pad on each beat (breathing)
  const scDepth = clamp(m.sidechainDepth, 0.02, 0.14);
  const baseGain = 1.0;
  for (let t = 0.6; t < duration - 0.2; t += beat) {
    // kick & hat
    kick(t);
    hat(t + beat / 2);

    // sidechain: fast dip + recover
    sidechain.gain.setValueAtTime(baseGain, t - 0.001);
    sidechain.gain.linearRampToValueAtTime(baseGain * (1 - scDepth), t + 0.02);
    sidechain.gain.linearRampToValueAtTime(baseGain, t + 0.22);
  }

  // A/B EVOLUTION (every ~18s): open filter, change delay feedback, shift pad tone slightly
  const evolve = clamp(m.evolveAmount, 0.2, 1);
  const sec = [0, 18, 36, 54];
  sec.forEach((start, idx) => {
    const end = Math.min(duration, start + 18);

    // filter open
    const f0 = clamp(m.cutoff * (0.82 + 0.08 * idx), 650, 5200);
    const f1 = clamp(m.cutoff * (0.95 + 0.12 * evolve), 650, 5200);
    busFilter.frequency.setValueAtTime(f0, start);
    busFilter.frequency.linearRampToValueAtTime(f1, Math.min(end, start + 12));

    // delay feedback breathe
    const fb0 = clamp(m.delayFeedback * (0.88 + 0.05 * idx), 0.12, 0.38);
    const fb1 = clamp(m.delayFeedback * (1.0 + 0.15 * evolve), 0.12, 0.42);
    fb.gain.setValueAtTime(fb0, start);
    fb.gain.linearRampToValueAtTime(fb1, Math.min(end, start + 10));
    fb.gain.linearRampToValueAtTime(fb0, Math.min(end, start + 18));

    // noise band shifts a little (color feels alive)
    const n0 = 800 + r * 2600 + idx * 120;
    const n1 = 900 + r * 2400 + (idx % 2 ? 220 : -180) * evolve;
    noiseBP.frequency.setValueAtTime(clamp(n0, 300, 6000), start);
    noiseBP.frequency.linearRampToValueAtTime(clamp(n1, 300, 6000), Math.min(end, start + 12));
  });

  return await ctx.startRendering();
}

// ============================================================================
// 5) EXPORT WAV
// ============================================================================

function audioBufferToWavBlob(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const numFrames = audioBuffer.length;
  const blockAlign = (numChannels * bitDepth) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  let offset = 0;
  const writeString = (str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    offset += str.length;
  };

  writeString("RIFF");
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString("WAVE");

  writeString("fmt ");
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, format, true);
  offset += 2;
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, byteRate, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bitDepth, true);
  offset += 2;

  writeString("data");
  view.setUint32(offset, dataSize, true);
  offset += 4;

  const channelData = [];
  for (let c = 0; c < numChannels; c++) channelData.push(audioBuffer.getChannelData(c));

  let writePos = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channelData[c][i];
      sample = Math.max(-1, Math.min(1, sample));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(writePos, int16, true);
      writePos += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

// ============================================================================
// 6) SPLINE + EQ + PARTICLES
// ============================================================================

function SplineBackground({ volume }) {
  useEffect(() => {
    if (!document.querySelector('script[src*="spline-viewer"]')) {
      const script = document.createElement("script");
      script.type = "module";
      script.src = "https://unpkg.com/@splinetool/viewer@1.12.53/build/spline-viewer.js";
      document.head.appendChild(script);
    }
  }, []);

  return (
    <div
      className="spline-viewport"
      style={{
        filter: `brightness(${0.74 + volume * 0.28})`,
        transform: `scale(${1 + volume * 0.02})`,
      }}
    >
      <spline-viewer url="https://prod.spline.design/6wFT9lzZuaWY69mT/scene.splinecode" events-target="global" />
    </div>
  );
}

function FrequencyEqualizer({ analyserRef, isPlaying }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      ctx.clearRect(0, 0, w, h);

      // baseline: keep it stable (lower), so when playing it doesn't “jump”
      const baselineY = h * 0.72;

      const analyser = analyserRef?.current;

      // baseline line (always one line)
      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(251,248,238,0.14)";
      ctx.moveTo(0, baselineY);
      ctx.lineTo(w, baselineY);
      ctx.stroke();

      if (!isPlaying || !analyser) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      // topographic line (above baseline)
      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(251,248,238,0.46)";
      ctx.lineCap = "round";

      const bins = Math.floor(bufferLength / 3);
      const sliceWidth = w / bins;
      let x = 0;

      for (let i = 0; i < bins; i++) {
        const v = dataArray[i] / 255; // 0..1
        const y = baselineY - v * (h * 0.55); // draw upwards

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);

        x += sliceWidth;
      }

      ctx.stroke();
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [analyserRef, isPlaying]);

  return (
    <div className="eq-wrapper">
      <span className="label-tiny">Pulso</span>
      <canvas ref={canvasRef} className="eq-topo" />
    </div>
  );
}

function hexToRgba(hex, alpha) {
  const h = (hex || "#000000").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function SubtleParticles({ colors = [], active, energy = 0 }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const particlesRef = useRef([]);
  const energyRef = useRef(0);
  const rectRef = useRef({ w: 1, h: 1 });

  useEffect(() => {
    energyRef.current = energy;
  }, [energy]);

  useEffect(() => {
    if (!active || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { alpha: true });
    const palette = (colors?.length ? colors : ["#FBF8EE"]).slice(0, 5);

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      rectRef.current = { w: rect.width, h: rect.height };

      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (particlesRef.current.length === 0) {
        const count = 18;
        particlesRef.current = Array.from({ length: count }).map(() => ({
          x: Math.random() * rect.width,
          y: Math.random() * rect.height,
          r: 1 + Math.random() * 2.2,
          vx: (Math.random() - 0.5) * 0.18,
          vy: (Math.random() - 0.5) * 0.18,
          a: 0.06 + Math.random() * 0.10,
          c: palette[Math.floor(Math.random() * palette.length)],
          drift: 0.6 + Math.random() * 0.9,
        }));
      }
    };

    resize();
    window.addEventListener("resize", resize);

    const step = () => {
      const { w, h } = rectRef.current;
      const e = clamp(energyRef.current, 0, 1);

      const speedBoost = 1 + e * 0.35;
      const alphaBoost = 1 + e * 0.18;

      ctx.clearRect(0, 0, w, h);

      for (const p of particlesRef.current) {
        const boost = speedBoost * p.drift;
        p.x += p.vx * boost;
        p.y += p.vy * boost;

        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(p.c, clamp(p.a * alphaBoost, 0.04, 0.22));
        ctx.fill();
      }

      // super subtle “film”
      ctx.fillStyle = "rgba(0,0,0,0.02)";
      ctx.fillRect(0, 0, w, h);

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      particlesRef.current = [];
    };
  }, [active, colors]);

  return <canvas ref={canvasRef} className="particles-canvas" />;
}

// ============================================================================
// 7) LOADING PHRASES (random, no-repeat until exhausted)
// ============================================================================

const LOADING_PHRASES = [
  "Afinando el silencio…",
  "Dibujando una sombra sonora…",
  "Abriendo una grieta en el aire…",
  "Convirtiendo luz en pulso…",
  "Escuchando lo que la imagen no dice…",
  "Enhebrando un recuerdo…",
  "Dejando que el color respire…",
  "Buscando la frecuencia exacta…",
];

function useNonRepeatingPicker(items) {
  const bagRef = useRef([]);
  const pickOne = () => {
    if (!bagRef.current.length) {
      bagRef.current = [...items];
    }
    const idx = Math.floor(Math.random() * bagRef.current.length);
    const v = bagRef.current[idx];
    bagRef.current.splice(idx, 1);
    return v;
  };
  return pickOne;
}

// ============================================================================
// 8) APP
// ============================================================================

export default function Synesthesia() {
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);

  const [palette, setPalette] = useState([]);
  const [metrics, setMetrics] = useState(null);

  const [analysis, setAnalysis] = useState(null);
  const [audioBuffer, setAudioBuffer] = useState(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0);

  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [loadingLine, setLoadingLine] = useState(null);

  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const analyserRef = useRef(null);

  const pickLoading = useNonRepeatingPicker(LOADING_PHRASES);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!isPlaying || !analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    const frame = () => {
      if (!isPlaying) return;
      analyserRef.current.getByteFrequencyData(data);
      setVolume(data.reduce((a, b) => a + b, 0) / data.length / 255);
      requestAnimationFrame(frame);
    };
    frame();
  }, [isPlaying]);

  const stopPlayback = () => {
    try {
      sourceNodeRef.current?.stop();
    } catch (_) {}
    setIsPlaying(false);
  };

  const resetAll = () => {
    stopPlayback();
    setImageFile(null);
    setImageUrl(null);
    setPalette([]);
    setMetrics(null);
    setAnalysis(null);
    setAudioBuffer(null);
    setError(null);
    setVolume(0);
    setLoadingLine(null);
  };

  const toggleAudio = () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }
    if (!audioBuffer) return;

    audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    analyserRef.current = audioContextRef.current.createAnalyser();
    analyserRef.current.fftSize = 2048;

    sourceNodeRef.current = audioContextRef.current.createBufferSource();
    sourceNodeRef.current.buffer = audioBuffer;

    sourceNodeRef.current.connect(analyserRef.current);
    analyserRef.current.connect(audioContextRef.current.destination);

    sourceNodeRef.current.start(0);
    setIsPlaying(true);
    sourceNodeRef.current.onended = () => setIsPlaying(false);
  };

  const handleDownload = () => {
    if (!audioBuffer) return;

    const blob = audioBufferToWavBlob(audioBuffer);
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "synesthesia-pieza-sonora.wav";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setToast("Descargado.");
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const onUpload = async (file) => {
    setError(null);
    setToast(null);

    if (!file) return;

    const okTypes = ["image/jpeg", "image/png", "image/webp"];
    const maxBytes = 10 * 1024 * 1024;

    if (!okTypes.includes(file.type)) {
      setError("Formato no compatible. Usa JPG, PNG o WEBP.");
      return;
    }
    if (file.size > maxBytes) {
      setError("La imagen es demasiado grande. Elige una de hasta 10 MB.");
      return;
    }

    stopPlayback();

    setImageFile(file);
    setImageUrl(URL.createObjectURL(file));
    setIsGenerating(true);
    setAudioBuffer(null);
    setAnalysis(null);

    // random loading phrase (no-repeat)
    setLoadingLine(pickLoading());

    try {
      const { colors } = await extractColors(file);
      const m = deriveColorMetrics(colors);
      const mood = deriveMoodFromMetrics(m);
      const textura = deriveTextureFromMetrics(m);
      const bpm = deriveBpmFromMetrics(m);
      const atmosphere = pick(POOLS_ATMOS[mood] || POOLS_ATMOS.suspendida);

      // Optional caption (no dependency)
      const { caption } = await analyzeImageWithFreeAI(file);

      const nextAnalysis = {
        caption,
        mood,
        bpm,
        genre: textura,
        atmosphere,
      };

      setPalette(colors);
      setMetrics(m);
      setAnalysis(nextAnalysis);

      const buffer = await generateAudio(colors, m);
      setAudioBuffer(buffer);
    } catch (e) {
      console.warn(e);
      setError("No hemos podido generar el sonido. Prueba con otra imagen.");
    } finally {
      setIsGenerating(false);
    }
  };

  const ariaMain = isPlaying ? "Pausar" : "Escuchar";

  return (
    <div className="app-canvas">
      <SplineBackground volume={volume} />
      {imageFile && <div className="bg-dim" />}

      <div className="ui-overlay">
        {!imageFile ? (
          <div className="hero-editorial">
            <h1 className="main-title">Synesthesia</h1>
            <p className="tagline">DONDE UN RECUERDO ENCUENTRA SU SONIDO</p>
            <p className="subcopy">Sube una imagen y escucha qué sonido despierta.</p>

            <label className="upload-trigger" role="button" tabIndex={0}>
              <input
                type="file"
                hidden
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => onUpload(e.target.files?.[0])}
              />
              <Upload size={18} strokeWidth={1} />
              <span>Subir una imagen</span>
            </label>

            <div className="upload-specs">JPG / PNG / WEBP · hasta 10 MB</div>
            {error && <div className="hero-error">{error}</div>}
          </div>
        ) : (
          <div className="experience-grid">
            <div className="visual-side">
              <div className="image-frame">
                <SubtleParticles colors={palette} active={!isGenerating} energy={isPlaying ? volume : 0.08} />
                <img src={imageUrl} alt="Recuerdo" />
                {isGenerating && (
                  <div className="curtain">
                    <span>{loadingLine || "Afinando el silencio…"}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="content-side">
              {error && <div className="panel-error">{error}</div>}

              {analysis && !isGenerating && (
                <div className="editorial-player">
                  <span className="small-cap">Lo que resuena</span>
                  <h2 className="mood-name">{analysis.mood}</h2>

                  <p className="quote">“{analysis.atmosphere}”</p>

                  <FrequencyEqualizer analyserRef={analyserRef} isPlaying={isPlaying} />

                  {/* META ROW: Tempo · Textura(+paleta) · Botones */}
                  <div className="meta-row">
                    <div className="details">
                      <div className="detail-item">
                        <span className="small-cap">Tempo</span>
                        <p>{analysis.bpm} BPM</p>
                      </div>

                      <div className="detail-item">
                        <span className="small-cap">Textura</span>

                        <div className="texture-line">
                          <p>{analysis.genre}</p>

                          {palette?.length > 0 && (
                            <div className="palette-dots" aria-label="Paleta">
                              {palette.slice(0, 4).map((c) => (
                                <span key={c} className="dot" style={{ background: c }} />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="meta-controls">
                        <button
                          className="main-btn"
                          onClick={toggleAudio}
                          aria-label={ariaMain}
                          disabled={!audioBuffer || isGenerating}
                          title={ariaMain}
                        >
                          {isPlaying ? (
                            <Pause size={34} strokeWidth={1} />
                          ) : (
                            <Play size={34} strokeWidth={1} style={{ marginLeft: 4 }} />
                          )}
                        </button>

                        <button
                          className="ghost-btn"
                          onClick={handleDownload}
                          aria-label="Descargar"
                          disabled={!audioBuffer || isGenerating}
                          title="Descargar"
                        >
                          <Download size={26} strokeWidth={1} />
                        </button>

                        <button
                          className="ghost-btn"
                          onClick={resetAll}
                          aria-label="Volver a empezar"
                          title="Volver a empezar"
                        >
                          <RefreshCw size={26} strokeWidth={1} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* (Optional debug — remove if you want)
                  {analysis.caption && <div className="caption-debug">Caption: {analysis.caption}</div>}
                  */}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,300;1,500&family=Inter:wght@200;400;500&display=swap');

        :root { --ivory: #FBF8EE; --pitch: #050505; --rose: #ff2d55; }
        * { margin: 0; padding: 0; box-sizing: border-box; }

        .app-canvas {
          background: var(--pitch);
          color: var(--ivory);
          width: 100vw;
          min-height: 100svh;
          overflow-y: auto;
          overflow-x: hidden;
          font-family: 'Inter', sans-serif;
          position: relative;
        }

        .spline-viewport { z-index: 0; }
        .bg-dim { z-index: 1; }
        .ui-overlay { z-index: 10; }

        .spline-viewport {
          position: fixed;
          inset: 0;
          pointer-events: auto;
          transition: filter 0.35s ease, transform 0.35s ease;
          transform-origin: center;
        }
        spline-viewer { width: 100%; height: 100%; display: block; }

        .bg-dim {
          position: fixed;
          inset: 0;
          pointer-events: none;
          background: radial-gradient(1200px 800px at 60% 45%, rgba(0,0,0,0.22), rgba(0,0,0,0.52)), rgba(0,0,0,0.16);
        }

        .ui-overlay {
          position: relative;
          min-height: 100svh;
          pointer-events: none;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 60px 20px;
        }
        .ui-overlay > * { pointer-events: auto; }

        /* HERO */
        .hero-editorial { text-align: center; max-width: 720px; padding: 0 14px; }
        .main-title {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(3.5rem, 12vw, 8rem);
          font-style: italic;
          font-weight: 300;
          letter-spacing: -0.05em;
          margin-bottom: 0.5rem;
        }
        .tagline{
          letter-spacing: 0.36em;
          font-size: 0.65rem;
          opacity: 0.70;
          margin-bottom: 1.3rem;
          text-transform: uppercase;
        }
        .subcopy{
          max-width: 520px;
          margin: 0 auto 2rem;
          font-size: 0.95rem;
          line-height: 1.6;
          opacity: 0.88;
        }
        .upload-trigger {
          display: inline-flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem 2.5rem;
          border: 1px solid rgba(251,248,238,0.24);
          cursor: pointer;
          text-transform: uppercase;
          font-size: 0.75rem;
          letter-spacing: 0.1em;
          transition: 0.35s;
          user-select: none;
        }
        .upload-trigger:hover { background: var(--ivory); color: var(--pitch); }
        .upload-specs{
          margin-top: 10px;
          font-size: 0.7rem;
          letter-spacing: 0.12em;
          opacity: 0.60;
          text-transform: uppercase;
        }
        .hero-error{ margin-top: 18px; font-size: 0.85rem; opacity: 0.86; }

        /* GRID */
        .experience-grid {
          display: grid;
          grid-template-columns: 1fr 450px;
          width: min(1100px, 92vw);
          gap: clamp(2rem, 5vw, 5rem);
          align-items: center;
        }

        .image-frame {
          position: relative;
          width: 100%;
          height: 55vh;
          min-height: 350px;
          box-shadow: 0 40px 100px rgba(0,0,0,0.9);
          overflow: hidden;
          isolation: isolate;
        }

        .particles-canvas {
          position: absolute;
          inset: 0;
          z-index: 0;
          mix-blend-mode: screen;
          opacity: 0.55;
          pointer-events: none;
        }

        .image-frame img {
          position: relative;
          z-index: 1;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .curtain{
          position:absolute; inset:0; z-index:2;
          background: rgba(5,5,5,0.92);
          display:flex; align-items:center; justify-content:center;
          font-family:'Cormorant Garamond', serif;
          font-style: italic;
          font-size: 1.5rem;
          letter-spacing: -0.01em;
        }

        .small-cap {
          font-size: 0.6rem;
          text-transform: uppercase;
          letter-spacing: 0.25em;
          opacity: 0.62;
        }

        .mood-name {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(2.5rem, 5vw, 4rem);
          font-style: italic;
          line-height: 1;
          margin: 0.5rem 0 1rem;
        }

        .quote {
          font-family: 'Cormorant Garamond', serif;
          font-size: 1.3rem;
          font-style: italic;
          opacity: 0.92;
          border-left: 1px solid rgba(251,248,238,0.30);
          padding-left: 20px;
          margin-bottom: 1.1rem;
        }

        /* EQ */
        .eq-wrapper { margin: 1.1rem 0 1.35rem; }
        .label-tiny {
          display:block;
          font-size:0.6rem;
          text-transform:uppercase;
          letter-spacing:0.22em;
          opacity:0.44;
          margin-bottom:10px;
        }
        .eq-topo{
          width:100%;
          height:54px;
          border-bottom: 1px solid rgba(251,248,238,0.12);
        }

        /* META */
        .meta-row{
          display:flex;
          align-items:flex-end;
          justify-content:flex-start;
        }

        /* Tempo · Textura · Botones: same spacing rhythm */
        .details{
          display:flex;
          align-items:flex-end;
          gap: 3rem; /* baseline rhythm */
          flex-wrap: wrap;
          min-width: 0;
        }

        .detail-item{
          min-width: max-content;
        }

        /* Textura line: text + dots inline */
        .texture-line{
          display:flex;
          align-items:center;
          gap: 3rem; /* SAME as Tempo/Textura gap */
        }

        .palette-dots{
          display:flex;
          gap:10px;
          align-items:center;
          margin: 0;
          padding: 0;
          opacity: 0.95;
          flex: 0 0 auto;
        }
        .dot{
          width: 10px;
          height: 10px;
          border-radius: 999px;
          border: 1px solid rgba(251,248,238,0.18);
          box-shadow: 0 0 18px rgba(251,248,238,0.10);
        }

        .meta-controls{
          display:flex;
          align-items:center;
          gap: 1.2rem;
        }

        /* Buttons (keep the “good design” feel) */
        .main-btn {
          width: 80px; height: 80px;
          border-radius: 999px;
          border: 1px solid var(--ivory);
          background: transparent;
          color: var(--ivory);
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: 0.35s;
        }
        .main-btn:hover { background: var(--ivory); color: var(--pitch); transform: translateY(-1px); box-shadow: 0 0 40px rgba(255,45,85,0.45); }
        .main-btn:disabled{ opacity:0.35; cursor:not-allowed; transform:none; box-shadow:none; }

        .ghost-btn {
          width: 68px; height: 68px;
          border-radius: 999px;
          border: 1px solid rgba(251,248,238,0.16);
          background: rgba(5,5,5,0.18);
          color: var(--ivory);
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(6px);
          transition: 0.25s;
        }
        .ghost-btn:hover{ border-color: rgba(251,248,238,0.45); transform: translateY(-1px); }
        .ghost-btn:disabled{ opacity:0.35; cursor:not-allowed; transform:none; }

        .panel-error{ margin-bottom: 18px; font-size: 0.9rem; opacity: 0.86; }

        /* Responsive */
        @media (max-width: 1000px) {
          .experience-grid { grid-template-columns: 1fr; gap: 1.5rem; }
          .image-frame { height: 35vh; min-height: 250px; }
          .ui-overlay { padding: 40px 15px; }
          .mood-name { font-size: 3rem; }
        }

        @media (max-width: 500px) {
          .main-title { font-size: 4rem; }

          .experience-grid {
            gap: 14px;
            width: 94vw;
            align-items: flex-start;
          }

          /* smaller image to reduce scroll */
          .image-frame {
            height: 24vh;
            min-height: 170px;
          }

          .quote { font-size: 1.05rem; }

          .details { gap: 2rem; }
          .texture-line{ gap: 2rem; }

          /* buttons stay left, wrap below if needed */
          .meta-controls{
            width: 100%;
            justify-content: flex-start;
            margin-top: 8px;
          }

          .main-btn { width: 80px; height: 80px; }
          .ghost-btn { width: 68px; height: 68px; }
        }

        .toast {
          position: fixed;
          left: 50%;
          bottom: 30px;
          transform: translateX(-50%);
          background: rgba(0,0,0,0.8);
          padding: 8px 16px;
          font-size: 0.7rem;
          text-transform: uppercase;
          z-index: 100;
          border: 1px solid rgba(251,248,238,0.14);
          backdrop-filter: blur(10px);
        }
      `}</style>
    </div>
  );
}
