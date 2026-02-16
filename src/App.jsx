import React, { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Play, Pause, RefreshCw, Download, Share2 } from "lucide-react";

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
    const clusters = Array(k).fill(null).map(() => []);

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
// 2) METRICS FROM COLORS
// ============================================================================

function deriveColorMetrics(colors = []) {
  const cols = (colors.length ? colors : ["#808080"]).slice(0, 6);
  const rgbs = cols.map(hexToRgb01);

  const luminances = rgbs.map(({ r, g, b }) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
  const warmnesses = rgbs.map(({ r, b }) => r - b);
  const sats = rgbs.map((rgb) => rgbToHsv(rgb).s);

  const lum = clamp(mean(luminances), 0, 1);
  const warm = clamp(mean(warmnesses), -1, 1);
  const sat = clamp(mean(sats), 0, 1);

  const paletteVar = clamp(variance(luminances) + variance(sats), 0, 0.2);

  const lumMin = Math.min(...luminances);
  const lumMax = Math.max(...luminances);
  const contrast = clamp(lumMax - lumMin, 0, 1);

  return { lum, warm, sat, paletteVar, contrast, colors: cols };
}

function deriveTextureFromMetrics(m) {
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
  const base = lerp(78, 102, clamp(m.sat * 0.55 + m.contrast * 0.45, 0, 1));
  const darkPull = lerp(0, -10, clamp((0.55 - m.lum) / 0.55, 0, 1));
  return Math.round(clamp(base + darkPull, 72, 110));
}

function deriveMusicProfileFromMetrics(m) {
  const bpm = deriveBpmFromMetrics(m);
  const reverbSeconds = clamp(lerp(1.4, 3.6, clamp((1 - m.lum) * 0.65 + m.paletteVar * 0.9, 0, 1)), 1.2, 3.8);
  const cutoff = clamp(lerp(900, 4200, clamp(m.lum * 0.6 + m.sat * 0.5, 0, 1)), 650, 5200);
  const detuneSpread = clamp(lerp(7, 22, clamp(m.paletteVar / 0.08, 0, 1)), 6, 24);
  const noiseLevel = clamp(lerp(0.006, 0.02, clamp(m.sat * 0.55 + m.contrast * 0.45, 0, 1)), 0.004, 0.03);
  const sidechainDepth = clamp(lerp(0.03, 0.11, clamp(m.sat * 0.6 + m.contrast * 0.4, 0, 1)), 0.02, 0.14);
  const delayFeedback = clamp(lerp(0.18, 0.34, clamp(m.paletteVar / 0.08, 0, 1)), 0.14, 0.38);
  const delayMix = clamp(lerp(0.18, 0.34, clamp((1 - m.lum) * 0.6 + m.paletteVar * 0.6, 0, 1)), 0.14, 0.42);
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
// 3) AUDIO GENERATION (ENHANCED WITH LFO MODULATION)
// ============================================================================

async function generateMusic(metrics) {
  const duration = 72;
  const sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, Math.floor(duration * sampleRate), sampleRate);

  const m = deriveMusicProfileFromMetrics(metrics);
  const beat = 60 / m.bpm;

  const { r, g, b } = hexToRgb01(metrics.colors[0] || "#808080");

  // MASTER + BUS FILTER
  const master = ctx.createGain();
  master.gain.value = 0.75;
  master.connect(ctx.destination);

  const busFilter = ctx.createBiquadFilter();
  busFilter.type = "lowpass";
  busFilter.frequency.value = m.cutoff;
  busFilter.Q.value = 0.9;
  busFilter.connect(master);

  // REVERB
  const reverbTime = m.reverbSeconds;
  const convolver = ctx.createConvolver();
  const impLength = Math.floor(sampleRate * reverbTime);
  const impulse = ctx.createBuffer(2, impLength, sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < impLength; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / impLength, 1.8);
    }
  }
  convolver.buffer = impulse;

  const reverbSend = ctx.createGain();
  reverbSend.gain.value = clamp(lerp(0.28, 0.52, clamp((1 - metrics.lum) * 0.7, 0, 1)), 0.22, 0.58);
  reverbSend.connect(convolver);
  convolver.connect(busFilter);

  // DELAY
  const delay = ctx.createDelay(3);
  delay.delayTime.value = (beat * 1.5) % 2.5;

  const fb = ctx.createGain();
  fb.gain.value = m.delayFeedback;
  delay.connect(fb);
  fb.connect(delay);

  const delaySend = ctx.createGain();
  delaySend.gain.value = m.delayMix;
  delaySend.connect(delay);
  delay.connect(busFilter);

  const sidechain = ctx.createGain();
  sidechain.gain.value = 1.0;
  sidechain.connect(busFilter);
  sidechain.connect(reverbSend);

  // PAD (ENHANCED WITH LFO)
  const freqBase = clamp(lerp(75, 185, clamp(metrics.lum * 0.6 + metrics.sat * 0.4, 0, 1)), 68, 220);
  const padBus = ctx.createGain();
  padBus.gain.value = 0.0;
  padBus.gain.setValueAtTime(0.0, 0);
  padBus.gain.linearRampToValueAtTime(0.32, 8); // Fade in más lento
  padBus.connect(sidechain);

  // LFO para filtro (breathing effect)
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.08; // Muy lento
  lfoGain.gain.value = m.cutoff * 0.25;
  
  lfo.connect(lfoGain);
  lfoGain.connect(busFilter.frequency);
  lfo.start(0);

  const detunes = [-m.detuneSpread, 0, m.detuneSpread];
  const oscOffsets = [0, 7, 19];

  detunes.forEach((dt, idx) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freqBase * (1 + oscOffsets[idx] / 1200);
    osc.detune.value = dt;

    const oscGain = ctx.createGain();
    oscGain.gain.value = clamp(0.12 - idx * 0.02, 0.06, 0.14);
    osc.connect(oscGain);
    oscGain.connect(padBus);

    osc.start(0);
    osc.stop(duration);
  });

  // NOISE (más textura)
  const noiseBuf = ctx.createBuffer(1, sampleRate * 4, sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  noiseSrc.loop = true;

  const noiseHP = ctx.createBiquadFilter();
  noiseHP.type = "highpass";
  noiseHP.frequency.value = 1400 + g * 2600;

  const noiseBP = ctx.createBiquadFilter();
  noiseBP.type = "bandpass";
  noiseBP.frequency.value = 900 + r * 2400;
  noiseBP.Q.value = 0.9 + metrics.paletteVar * 8;

  const noiseGain = ctx.createGain();
  noiseGain.gain.value = m.noiseLevel;

  noiseSrc.connect(noiseHP);
  noiseHP.connect(noiseBP);
  noiseBP.connect(noiseGain);
  noiseGain.connect(sidechain);
  noiseGain.connect(reverbSend);

  noiseSrc.start(0);

  // PULSE
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

  // SIDECHAIN
  const scDepth = m.sidechainDepth;
  const baseGain = 1.0;
  for (let t = 0.6; t < duration - 0.2; t += beat) {
    kick(t);
    hat(t + beat / 2);
    sidechain.gain.setValueAtTime(baseGain, t - 0.001);
    sidechain.gain.linearRampToValueAtTime(baseGain * (1 - scDepth), t + 0.02);
    sidechain.gain.linearRampToValueAtTime(baseGain, t + 0.22);
  }

  // A/B EVOLUTION (mejorado)
  const evolve = m.evolveAmount;
  const sec = [0, 18, 36, 54];
  sec.forEach((start, idx) => {
    const end = Math.min(duration, start + 18);
    const f0 = clamp(m.cutoff * (0.82 + 0.08 * idx), 650, 5200);
    const f1 = clamp(m.cutoff * (0.95 + 0.12 * evolve), 650, 5200);
    busFilter.frequency.setValueAtTime(f0, start);
    busFilter.frequency.linearRampToValueAtTime(f1, Math.min(end, start + 12));

    const fb0 = clamp(m.delayFeedback * (0.88 + 0.05 * idx), 0.12, 0.38);
    const fb1 = clamp(m.delayFeedback * (1.0 + 0.15 * evolve), 0.12, 0.42);
    fb.gain.setValueAtTime(fb0, start);
    fb.gain.linearRampToValueAtTime(fb1, Math.min(end, start + 10));
    fb.gain.linearRampToValueAtTime(fb0, Math.min(end, start + 18));
  });

  return await ctx.startRendering();
}

// ============================================================================
// 4) EXPORT WAV
// ============================================================================

function audioBufferToWavBlob(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1;
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
// 5) COMPONENTS - SPLINE (LAZY LOADED)
// ============================================================================

function SplineBackground({ volume }) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const observerRef = useRef();

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    if (observerRef.current) {
      observer.observe(observerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoad) return;
    if (!document.querySelector('script[src*="spline-viewer"]')) {
      const script = document.createElement("script");
      script.type = "module";
      script.src = "https://unpkg.com/@splinetool/viewer@1.12.53/build/spline-viewer.js";
      document.head.appendChild(script);
    }
  }, [shouldLoad]);

  return (
    <div
      ref={observerRef}
      className="spline-viewport"
      style={{
        filter: `brightness(${0.74 + volume * 0.28})`,
        transform: `scale(${1 + volume * 0.02})`,
        transition: 'filter 0.15s ease, transform 0.15s ease',
      }}
    >
      {shouldLoad && (
        <spline-viewer url="https://prod.spline.design/6wFT9lzZuaWY69mT/scene.splinecode" events-target="global" />
      )}
    </div>
  );
}

// ============================================================================
// 6) EQ TOPOGRAPHY (ENHANCED WITH SMOOTH CURVE)
// ============================================================================

function EQTopography({ analyser, isPlaying }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!analyser || !isPlaying || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const draw = () => {
      if (!isPlaying) return;

      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = canvas.width / dataArray.length;
      const heightScale = canvas.height / 255;

      // Smooth curve
      ctx.beginPath();
      ctx.moveTo(0, canvas.height);

      for (let i = 0; i < dataArray.length; i++) {
        const x = i * barWidth;
        const y = canvas.height - dataArray[i] * heightScale;

        if (i === 0) {
          ctx.lineTo(x, y);
        } else {
          const prevX = (i - 1) * barWidth;
          const prevY = canvas.height - dataArray[i - 1] * heightScale;
          const cpX = (prevX + x) / 2;
          ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2);
        }
      }

      ctx.strokeStyle = "rgba(251,248,238,0.85)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Gradient fill
      ctx.lineTo(canvas.width, canvas.height);
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, "rgba(251,248,238,0.18)");
      gradient.addColorStop(1, "rgba(251,248,238,0.02)");
      ctx.fillStyle = gradient;
      ctx.fill();

      requestAnimationFrame(draw);
    };

    draw();
  }, [analyser, isPlaying]);

  return <canvas ref={canvasRef} className="eq-topo" width={800} height={54} />;
}

// ============================================================================
// 7) PARTICLES (ENHANCED - MORE SUBTLE)
// ============================================================================

function ParticlesCanvas({ colors, isPlaying, volumeEnergy = 0 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const particles = Array.from({ length: 30 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 1.5 + 0.5,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: Math.random() * 0.4 + 0.2,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach((p) => {
        p.x += p.vx * (1 + volumeEnergy * 2);
        p.y += p.vy * (1 + volumeEnergy * 2);

        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha * (0.7 + volumeEnergy * 0.3);
        ctx.shadowBlur = 8 + volumeEnergy * 12;
        ctx.shadowColor = p.color;
        ctx.fill();
      });

      requestAnimationFrame(draw);
    };

    draw();
  }, [colors, isPlaying, volumeEnergy]);

  return <canvas ref={canvasRef} className="particles-canvas" width={800} height={600} />;
}

// ============================================================================
// 8) MAIN APP
// ============================================================================

export default function App() {
  const [stage, setStage] = useState("hero");
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [colors, setColors] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const analyserRef = useRef(null);
  const volumeRef = useRef(0);

  const [isDarkMode, setIsDarkMode] = useState(false);

  const textura = useMemo(() => (metrics ? deriveTextureFromMetrics(metrics) : ""), [metrics]);
  const mood = useMemo(() => (metrics ? deriveMoodFromMetrics(metrics) : ""), [metrics]);
  const bpm = useMemo(() => (metrics ? deriveBpmFromMetrics(metrics) : 0), [metrics]);
  const atmo = useMemo(() => (mood && POOLS_ATMOS[mood] ? pick(POOLS_ATMOS[mood]) : ""), [mood]);

  // Handle image upload
  const handleImageUpload = async (file) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Formato no soportado. Usa JPG, PNG o WEBP.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Imagen demasiado grande. Máximo 10MB.");
      return;
    }

    setImageFile(file);
    setImageUrl(URL.createObjectURL(file));
    setStage("loading");
    setError("");

    try {
      setLoadingMsg("Extrayendo colores...");
      const { colors: extracted } = await extractColors(file);
      setColors(extracted);

      setLoadingMsg("Interpretando métricas...");
      const m = deriveColorMetrics(extracted);
      setMetrics(m);

      setLoadingMsg("Sintetizando música...");
      const buffer = await generateMusic(m);
      setAudioBuffer(buffer);

      setStage("experience");
    } catch (err) {
      setError("Error al procesar. Intenta otra imagen.");
      setStage("hero");
      console.error(err);
    }
  };

  // Play/Pause with fade
  const handlePlayPause = () => {
    if (!audioBuffer) return;

    if (isPlaying) {
      const gainNode = audioContextRef.current.createGain();
      sourceRef.current.disconnect();
      sourceRef.current.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);

      gainNode.gain.setValueAtTime(1, audioContextRef.current.currentTime);
      gainNode.gain.linearRampToValueAtTime(0, audioContextRef.current.currentTime + 0.3);

      setTimeout(() => {
        sourceRef.current?.stop();
        setIsPlaying(false);
      }, 300);
    } else {
      audioContextRef.current = new AudioContext();
      sourceRef.current = audioContextRef.current.createBufferSource();
      const gainNode = audioContextRef.current.createGain();
      
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;

      sourceRef.current.buffer = audioBuffer;
      sourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);

      gainNode.gain.setValueAtTime(0, audioContextRef.current.currentTime);
      gainNode.gain.linearRampToValueAtTime(1, audioContextRef.current.currentTime + 0.5);

      sourceRef.current.onended = () => setIsPlaying(false);
      sourceRef.current.start(0);
      setIsPlaying(true);

      // Volume monitor
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      const monitor = () => {
        if (!isPlaying) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        volumeRef.current = dataArray.reduce((a, b) => a + b, 0) / dataArray.length / 255;
        requestAnimationFrame(monitor);
      };
      monitor();
    }
  };

  // Download
  const handleDownload = () => {
    if (!audioBuffer) return;
    const blob = audioBufferToWavBlob(audioBuffer);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `synesthesia-${textura.toLowerCase()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Descargando...");
  };

  // Share
  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Synesthesia",
          text: `Mi viaje sonoro: ${mood} · ${textura}`,
          url: window.location.href,
        });
      } catch (err) {
        console.log("Share cancelled");
      }
    } else {
      showToast("Compartir no disponible");
    }
  };

  // Reset
  const handleReset = () => {
    if (sourceRef.current) sourceRef.current.stop();
    setStage("hero");
    setImageFile(null);
    setImageUrl(null);
    setColors([]);
    setMetrics(null);
    setAudioBuffer(null);
    setIsPlaying(false);
    setError("");
  };

  // Toast
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  };

  // Dark mode easter egg
  const handleTitleDoubleClick = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.style.setProperty("--pitch", isDarkMode ? "#050505" : "#fbf8ee");
    document.documentElement.style.setProperty("--ivory", isDarkMode ? "#fbf8ee" : "#050505");
  };

  return (
    <div className="app">
      <SplineBackground volume={volumeRef.current} />

      <div className="ui-overlay">
        {stage === "hero" && (
          <div className="hero-stage">
            <h1 className="main-title" onDoubleClick={handleTitleDoubleClick} style={{ cursor: 'pointer' }}>
              Synesthesia
            </h1>
            <p className="hero-subtitle">Donde cada imagen tiene su propia música</p>

            <input
              type="file"
              id="upload"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => handleImageUpload(e.target.files[0])}
              style={{ display: "none" }}
            />
            <label htmlFor="upload" className="upload-trigger">
              <Upload size={20} strokeWidth={1.8} />
              <span>Entrega una memoria</span>
            </label>
            <div className="upload-specs">JPG · PNG · WEBP | Máximo 10MB</div>

            {error && <div className="hero-error">{error}</div>}
          </div>
        )}

        {stage === "loading" && (
          <div className="loading-stage">
            <div className="spinner" />
            <p>{loadingMsg}</p>
          </div>
        )}

        {stage === "experience" && (
          <div className="experience-grid">
            <div className="image-frame">
              {isPlaying && <ParticlesCanvas colors={colors} isPlaying={isPlaying} volumeEnergy={volumeRef.current} />}
              <img src={imageUrl} alt="Memory" />
              {isPlaying && (
                <div className="curtain">
                  <span style={{ opacity: 0.7 }}>Reproduciendo...</span>
                </div>
              )}
            </div>

            <div className="panel">
              <div className="small-cap">Textura</div>
              <div className="mood-name">{mood}</div>
              <div className="quote">{atmo}</div>

              <div className="eq-wrapper">
                <div className="label-tiny">Frecuencias</div>
                <EQTopography analyser={analyserRef.current} isPlaying={isPlaying} />
              </div>

              <div className="meta-row">
                <div className="details">
                  <div className="detail-item">
                    <div className="small-cap">Tempo</div>
                    <div className="mood-name" style={{ fontSize: "1.8rem", margin: 0 }}>
                      {bpm}
                    </div>
                  </div>

                  <div className="detail-item texture-line">
                    <div>
                      <div className="small-cap">Textura</div>
                      <div className="mood-name" style={{ fontSize: "1.8rem", margin: 0 }}>
                        {textura}
                      </div>
                    </div>
                    <div className="palette-dots">
                      {colors.map((c, i) => (
                        <div key={i} className="dot" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="meta-controls">
                <button onClick={handlePlayPause} className={`main-btn ${isPlaying ? 'is-playing' : ''}`} disabled={!audioBuffer}>
                  {isPlaying ? <Pause size={22} /> : <Play size={22} />}
                </button>
                <button onClick={handleDownload} className="ghost-btn" title="Descargar WAV" disabled={!audioBuffer}>
                  <Download size={20} />
                </button>
                <button onClick={handleShare} className="ghost-btn" title="Compartir">
                  <Share2 size={20} />
                </button>
                <button onClick={handleReset} className="ghost-btn" title="Nueva imagen">
                  <RefreshCw size={20} />
                </button>
              </div>

              {error && <div className="panel-error">{error}</div>}
            </div>
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}

<style>{`
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;1,400;1,600&family=Inter:wght@300;400;500;600&display=swap');

  :root {
    --pitch: #050505;
    --ivory: #fbf8ee;
  }

  /* RESET PARA EVITAR DESPLAZAMIENTOS */
  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body, #root {
    width: 100% !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    background: var(--pitch);
    overflow-x: hidden;
  }

  .app {
    position: relative;
    width: 100%;
    min-height: 100vh;
    color: var(--ivory);
    font-family: 'Inter', sans-serif;
  }

  .spline-viewport {
    position: fixed;
    inset: 0;
    z-index: 0;
  }

  /* CONTENEDOR PRINCIPAL CENTRADO */
  .ui-overlay {
    position: relative;
    z-index: 10;
    min-height: 100vh;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;    
    justify-content: center; 
    padding: 60px 40px;
    pointer-events: none;
  }

  .ui-overlay > * { pointer-events: auto; }

  /* GRID DE EXPERIENCIA (Diseño de tu captura) */
  .experience-grid {
    display: grid;
    grid-template-columns: 1fr 450px;
    width: 100%;
    max-width: 1100px;
    gap: 5rem;
    align-items: center;
    margin: 0 auto;
  }

  .image-frame {
    position: relative;
    width: 100%;
    height: 55vh;
    min-height: 350px;
    box-shadow: 0 40px 100px rgba(0,0,0,0.9);
    overflow: hidden;
  }

  /* ESTILOS DE TEXTO (Recuperando el estilo de la imagen) */
  .small-cap {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.25em;
    opacity: 0.6;
    margin-bottom: 0.5rem;
  }

  .mood-name {
    font-family: 'Cormorant Garamond', serif;
    font-size: clamp(2.5rem, 5vw, 4rem);
    font-style: italic;
    line-height: 1.1;
    margin-bottom: 1.5rem;
  }

  .quote {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.3rem;
    font-style: italic;
    opacity: 0.9;
    border-left: 1px solid rgba(251,248,238,0.2);
    padding-left: 20px;
    margin-bottom: 2rem;
  }

  /* FILA DE METADATOS (Tempo y Textura alineados) */
  .details {
    display: flex;
    gap: 4rem;
    margin-bottom: 2rem;
    align-items: flex-start;
  }

  .detail-item {
    display: flex;
    flex-direction: column;
  }

  /* Los números y nombres grandes de tu captura */
  .detail-item .mood-name {
    font-size: 2.5rem;
    margin: 0;
  }

  .texture-line {
    display: flex;
    align-items: center;
    gap: 2rem;
  }

  /* DISEÑO DE LOS CÍRCULOS DE COLORES */
  .palette-dots {
    display: flex;
    gap: 12px;
    margin-top: 10px;
  }

  .dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid rgba(251,248,238,0.3);
    transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  .dot:hover {
    transform: scale(1.6);
  }

  /* BOTONES Y CONTROLES */
  .meta-controls {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    margin-top: 2rem;
  }

  .main-btn {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    border: 1px solid var(--ivory);
    background: transparent;
    color: var(--ivory);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: 0.3s;
  }

  .main-btn:hover {
    background: var(--ivory);
    color: var(--pitch);
  }

  /* MEDIA QUERIES PARA MÓVIL */
  @media (max-width: 1000px) {
    .experience-grid {
      grid-template-columns: 1fr;
      gap: 3rem;
    }
    .ui-overlay { padding: 40px 20px; }
  }
`}</style>
    </div>
  );
}

