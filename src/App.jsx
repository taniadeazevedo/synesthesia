import React, { useState, useRef, useEffect } from "react";
import { Upload, Play, Pause, RefreshCw, Download } from "lucide-react";

// ============================================================================
// 1) UTILIDADES (Color)
// ============================================================================

function rgbToHex(r, g, b) {
  return `#${[r, g, b]
    .map((x) => {
      const hex = Math.round(x).toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    })
    .join("")}`;
}

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
        const dist = Math.sqrt(
          (pixel.r - c.r) ** 2 + (pixel.g - c.g) ** 2 + (pixel.b - c.b) ** 2
        );
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
        const maxSize = 300;
        const scale = Math.min(maxSize / img.width, maxSize / img.height);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
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
// 2) IA (Caption) + LÓGICA EDITORIAL PREMIUM
// ============================================================================

const POOLS_ATMOS = {
  íntima: ["La distancia más corta entre dos pensamientos.", "Donde el ruido del mundo deja de existir."],
  nostálgica: ["Un eco que se resiste a desaparecer.", "Lo que queda cuando el tiempo se detiene."],
  suspendida: ["Un instante congelado en el aire.", "La quietud que precede al recuerdo."],
  luminosa: ["La claridad que baña los momentos compartidos.", "Un rayo de sol atrapado en la memoria."],
};

const MICRO_SUBJECT = {
  persona: "Una presencia que habita el silencio.",
  mascota: "Lealtad en una frecuencia pura.",
  edificio: "Paredes que guardan el eco de lo vivido.",
  naturaleza: "El pulso de lo que siempre ha estado ahí.",
  objeto: "La importancia de lo pequeño.",
  grupo: "La armonía de las voces que ya no suenan.",
  arte: "Una ventana a una realidad inventada.",
  otro: "Algo que vuelve sin avisar.",
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function scoreKeywords(text, words) {
  let s = 0;
  for (const w of words) if (text.includes(w)) s++;
  return s;
}

function detectSubject(lower) {
  const PERSON = [
    "person",
    "people",
    "man",
    "woman",
    "girl",
    "boy",
    "child",
    "kid",
    "face",
    "portrait",
    "selfie",
    "hands",
    "persona",
    "gente",
    "hombre",
    "mujer",
    "niña",
    "niño",
    "cara",
    "rostro",
    "retrato",
    "selfi",
    "manos",
  ];

  const PET = [
    "dog",
    "puppy",
    "cat",
    "kitten",
    "pet",
    "hamster",
    "rabbit",
    "bunny",
    "parrot",
    "bird",
    "horse",
    "perro",
    "cachorro",
    "gato",
    "gatito",
    "mascota",
    "conejo",
    "pájaro",
    "caballo",
    // extras útiles (a veces BLIP usa estos)
    "feline",
    "tabby",
    "kitty",
  ];

  const BUILDING = [
    "building",
    "house",
    "apartment",
    "skyscraper",
    "tower",
    "bridge",
    "architecture",
    "window",
    "door",
    "church",
    "museum",
    "city",
    "street",
    "edificio",
    "casa",
    "apartamento",
    "rascacielos",
    "torre",
    "puente",
    "arquitectura",
    "ventana",
    "puerta",
    "iglesia",
    "museo",
    "ciudad",
    "calle",
  ];

  const NATURE = [
    "forest",
    "nature",
    "tree",
    "plants",
    "mushroom",
    "flowers",
    "mountain",
    "lake",
    "river",
    "sea",
    "beach",
    "sky",
    "water",
    "bosque",
    "naturaleza",
    "árbol",
    "plantas",
    "seta",
    "flores",
    "montaña",
    "lago",
    "río",
    "mar",
    "playa",
    "cielo",
    "agua",
  ];

  const OBJECT = [
    "book",
    "cup",
    "coffee",
    "candle",
    "chair",
    "table",
    "phone",
    "camera",
    "flower",
    "food",
    "plate",
    "bottle",
    "watch",
    "libro",
    "taza",
    "café",
    "vela",
    "silla",
    "mesa",
    "teléfono",
    "cámara",
    "comida",
    "plato",
    "botella",
    "reloj",
  ];

  const GROUP = [
    "group",
    "crowd",
    "people",
    "friends",
    "party",
    "concert",
    "audience",
    "bunch",
    "equipo",
    "grupo",
    "amigos",
    "fiesta",
    "concierto",
    "público",
  ];

  const ART = [
    "painting",
    "drawing",
    "illustration",
    "art",
    "poster",
    "sculpture",
    "gallery",
    "mural",
    "pintura",
    "dibujo",
    "ilustración",
    "arte",
    "cartel",
    "escultura",
    "galería",
  ];

  const scores = [
    { k: "persona", s: scoreKeywords(lower, PERSON) },
    { k: "mascota", s: scoreKeywords(lower, PET) },
    { k: "edificio", s: scoreKeywords(lower, BUILDING) },
    { k: "naturaleza", s: scoreKeywords(lower, NATURE) },
    { k: "objeto", s: scoreKeywords(lower, OBJECT) },
    { k: "grupo", s: scoreKeywords(lower, GROUP) },
    { k: "arte", s: scoreKeywords(lower, ART) },
  ];

  scores.sort((a, b) => b.s - a.s);
  const top = scores[0];
  if (!top || top.s === 0) return { subject: "otro" };
  return { subject: top.k };
}

function detectContext(lower) {
  const NIGHT = ["night", "dark", "neon", "rain", "street", "noche", "oscuro", "neón", "lluvia"];
  const INDOOR = ["room", "bed", "window", "table", "chair", "habitación", "cama", "ventana", "mesa", "silla"];
  const OUTDOOR = [
    "outdoor",
    "forest",
    "street",
    "park",
    "beach",
    "mountain",
    "exterior",
    "bosque",
    "calle",
    "parque",
    "playa",
    "montaña",
  ];

  const night = scoreKeywords(lower, NIGHT) > 0;
  const indoor = scoreKeywords(lower, INDOOR) > scoreKeywords(lower, OUTDOOR);

  return { night, indoor };
}

function colorCharacter(hexColors = []) {
  const c = hexColors[0] || "#808080";
  const r = parseInt(c.slice(1, 3), 16) / 255;
  const g = parseInt(c.slice(3, 5), 16) / 255;
  const b = parseInt(c.slice(5, 7), 16) / 255;

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const warmth = r - b; // >0 cálido, <0 frío
  return { luminance, warmth };
}

function deriveProfile({ subject, night, indoor, colors }) {
  let mood = "suspendida";
  if (subject === "persona" || subject === "objeto" || subject === "mascota") mood = "íntima";
  if (subject === "edificio") mood = night ? "nostálgica" : "suspendida";
  if (subject === "naturaleza") mood = night ? "suspendida" : "luminosa";
  if (subject === "grupo") mood = "nostálgica";
  if (subject === "arte") mood = "suspendida";

  const { luminance, warmth } = colorCharacter(colors);

  if (mood === "íntima" && night) mood = "nostálgica";
  if (mood === "suspendida" && luminance > 0.62 && !night) mood = "luminosa";
  if (mood === "luminosa" && indoor && luminance < 0.45) mood = "íntima";

  const bpmRanges = {
    íntima: [68, 76],
    nostálgica: [82, 96],
    suspendida: [74, 84],
    luminosa: [70, 80],
  };
  const [minB, maxB] = bpmRanges[mood] || [72, 80];
  const bpm = Math.round(minB + Math.random() * (maxB - minB));

  const textures = {
    íntima: ["Cálida", "Doméstica", "Suave", "Cercana"],
    nostálgica: ["Nocturna", "Urbana", "Velada", "Lenta"],
    suspendida: ["Bruma", "Haze", "Drift", "Velada"],
    luminosa: ["Orgánica", "Clara", "Aire", "Solar"],
  };
  const texture = pick(textures[mood] || ["Ambient"]);

  const atmosphere = pick(POOLS_ATMOS[mood] || POOLS_ATMOS.suspendida);
  const micro = MICRO_SUBJECT[subject] || MICRO_SUBJECT.otro;

  const isClose = subject === "objeto" || subject === "persona" || subject === "mascota";
  const isWide = subject === "naturaleza" || subject === "edificio";
  const isGroup = subject === "grupo";

  let reverbSeconds = isClose ? 1.2 : isWide ? 3.2 : 2.2;
  let lfoDepth = isWide ? 0.06 : 0.03;
  let detuneSpread = isGroup ? 18 : isClose ? 6 : 10;

  const baseCutoff = night ? 1200 : 2200;
  let cutoff = baseCutoff + warmth * -800 + (luminance - 0.5) * 600;
  cutoff = clamp(cutoff, 650, 3800);

  if (isClose) cutoff = clamp(cutoff, 600, 2400);
  if (isWide) cutoff = clamp(cutoff, 900, 3600);

  return {
    mood,
    bpm,
    texture,
    atmosphere,
    micro,
    music: {
      reverbSeconds,
      cutoff,
      lfoDepth,
      detuneSpread,
      night,
      isClose,
      isWide,
      isGroup,
    },
  };
}

async function analyzeImageWithFreeAI(imageFile, colors) {
  try {
    const reader = new FileReader();
    const base64 = await new Promise((resolve) => {
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(imageFile);
    });

    const response = await fetch(
      "https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-large",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: base64.split(",")[1] }),
      }
    );

    const result = await response.json();
    const desc = result[0]?.generated_text || "photo";
    const lower = desc.toLowerCase();

    const { subject } = detectSubject(lower);
    const { night, indoor } = detectContext(lower);

    const profile = deriveProfile({ subject, night, indoor, colors });

    return {
      caption: desc,
      subject,
      mood: profile.mood,
      bpm: profile.bpm,
      genre: profile.texture,
      atmosphere: profile.atmosphere,
      micro: profile.micro,
      music: profile.music,
    };
  } catch (e) {
    return {
      caption: "photo",
      subject: "otro",
      mood: "íntima",
      bpm: 72,
      genre: "Cálida",
      atmosphere: pick(POOLS_ATMOS["íntima"]),
      micro: MICRO_SUBJECT.otro,
      music: { reverbSeconds: 1.6, cutoff: 1800, lfoDepth: 0.03, detuneSpread: 8, night: false },
    };
  }
}

// ============================================================================
// 3) AUDIO (con perfil musical)
// ============================================================================

async function generateAudio(colors, bpm, musicProfile) {
  const duration = 60;
  const sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, duration * sampleRate, sampleRate);

  // Reverb
  const convolver = ctx.createConvolver();
  const impulseSeconds = clamp(musicProfile?.reverbSeconds ?? 2.2, 0.8, 3.8);
  const impulse = ctx.createBuffer(2, Math.floor(sampleRate * impulseSeconds), sampleRate);

  for (let c = 0; c < 2; c++) {
    const d = impulse.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const t = 1 - i / d.length;
      d[i] = (Math.random() * 2 - 1) * t * t;
    }
  }
  convolver.buffer = impulse;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = clamp(musicProfile?.cutoff ?? 2200, 650, 3800);
  filter.Q.value = 0.6;

  const out = ctx.createGain();
  out.gain.value = 0.95;

  filter.connect(convolver);
  convolver.connect(out);
  out.connect(ctx.destination);

  // Base freq (color)
  const dominant = colors?.[0] || "#808080";
  const r = parseInt(dominant.slice(1, 3), 16) / 255;
  const baseFreq = 100 + r * 260;
  const detuneSpread = clamp(musicProfile?.detuneSpread ?? 8, 4, 22);

  // LFO (volumen) sutil
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.06;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = clamp(musicProfile?.lfoDepth ?? 0.03, 0.015, 0.09);
  lfo.connect(lfoGain);
  lfoGain.connect(out.gain);
  lfo.start(0);

  const ratios = [1, 1.5, 2];
  ratios.forEach((m, idx) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(0.085, 4);

    const spread = detuneSpread;
    const det = (Math.random() * spread - spread / 2) + (idx - 1) * (spread * 0.35);
    osc.detune.value = det;

    const drift = 1 + clamp((bpm - 76) / 320, -0.12, 0.12);
    osc.frequency.value = baseFreq * m * drift;

    osc.connect(g);
    g.connect(filter);
    osc.start(0);
  });

  return await ctx.startRendering();
}

// ============================================================================
// 4) EXPORT AUDIO: AudioBuffer -> WAV Blob
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
// 5) SPLINE + EQ + PARTÍCULAS
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
        filter: `brightness(${0.72 + volume * 0.35})`,
        transform: `scale(${1 + volume * 0.03})`,
      }}
    >
      <spline-viewer url="https://prod.spline.design/6wFT9lzZuaWY69mT/scene.splinecode" events-target="global" />
    </div>
  );
}

function FrequencyEqualizer({ analyser, isPlaying }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !analyser || !isPlaying) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!isPlaying) return;
      requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(245, 245, 220, 0.4)";

      const sliceWidth = canvas.width / (bufferLength / 2);
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 255.0;
        const y = (v * canvas.height) / 2;
        const yy = canvas.height / 2 - y;

        if (i === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);

        x += sliceWidth;
        if (x > canvas.width) break;
      }
      ctx.stroke();
    };

    draw();
  }, [analyser, isPlaying]);

  return (
    <div className="eq-wrapper">
      <span className="label-tiny">Pulso</span>
      <canvas ref={canvasRef} width={300} height={60} className="eq-topo" />
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

    const palette = (colors?.length ? colors : ["#F5F5DC"]).slice(0, 5);

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      rectRef.current = { w: rect.width, h: rect.height };

      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Si no había partículas, init; si las hay, mantenemos pero re-encuadramos suavemente.
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
          drift: 0.6 + Math.random() * 0.9, // cada una reacciona distinto
        }));
      }
    };

    resize();
    window.addEventListener("resize", resize);

    const step = () => {
      const { w, h } = rectRef.current;
      const e = clamp(energyRef.current, 0, 1);

      // “premium”: el volumen añade un pelín de vida (sin convertirse en discoteca)
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

      // velo ultra-sutil para “traza”
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
// 6) APP
// ============================================================================

export default function Synesthesia() {
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [palette, setPalette] = useState([]);

  const [audioBuffer, setAudioBuffer] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0);

  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const analyserRef = useRef(null);

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
    setAnalysis(null);
    setAudioBuffer(null);
    setPalette([]);
    setError(null);
    setVolume(0);
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

    setImageFile(file);
    setImageUrl(URL.createObjectURL(file));
    setIsGenerating(true);

    try {
      const { colors } = await extractColors(file);
      setPalette(colors);

      const res = await analyzeImageWithFreeAI(file, colors);
      setAnalysis(res);

      const buffer = await generateAudio(colors, res.bpm, res.music);
      setAudioBuffer(buffer);
    } catch (e) {
      setError("No hemos podido generar el sonido. Prueba con otra imagen.");
    } finally {
      setIsGenerating(false);
    }
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
                {isGenerating && <div className="curtain">Componiendo paisajes…</div>}
              </div>
            </div>

            <div className="content-side">
              <div className="content-inner">
                {error && <div className="panel-error">{error}</div>}

                {analysis && !isGenerating && (
                  <div className="editorial-player">
                    <span className="small-cap">Lo que resuena</span>
                    <h2 className="mood-name">{analysis.mood}</h2>

                    <p className="quote">“{analysis.atmosphere}”</p>
                    <p className="micro-line">{analysis.micro}</p>

                    <FrequencyEqualizer analyser={analyserRef.current} isPlaying={isPlaying} />

                    <div className="details">
                      <div>
                        <span className="small-cap">Tempo</span>
                        <p>{analysis.bpm} BPM</p>
                      </div>
                      <div>
                        <span className="small-cap">Textura</span>
                        <p>{analysis.genre}</p>
                      </div>
                    </div>

                    {palette?.length > 0 && (
                      <div className="palette-dots" aria-label="Paleta">
                        {palette.slice(0, 5).map((c) => (
                          <span key={c} className="dot" style={{ background: c }} />
                        ))}
                      </div>
                    )}

                    <div className="player-controls">
                      <button
                        className="main-btn"
                        onClick={toggleAudio}
                        aria-label={ariaMain}
                        disabled={!audioBuffer || isGenerating}
                        title={ariaMain}
                      >
                        {isPlaying ? (
                          <Pause size={32} strokeWidth={1} />
                        ) : (
                          <Play size={32} strokeWidth={1} style={{ marginLeft: 4 }} />
                        )}
                      </button>

                      <div className="action-rail">
                        <button
                          className="ghost-btn"
                          onClick={handleDownload}
                          aria-label="Descargar"
                          disabled={!audioBuffer || isGenerating}
                          title="Descargar"
                        >
                          <Download size={22} strokeWidth={1} />
                        </button>

                        <button className="ghost-btn" onClick={resetAll} aria-label="Volver a empezar" title="Volver a empezar">
                          <RefreshCw size={22} strokeWidth={1} />
                        </button>
                      </div>
                    </div>

                    {/* debug opcional:
                    <div style={{opacity:0.35, fontSize:12, marginTop:18}}>caption: {analysis.caption}</div>
                    */}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,300;1,500&family=Inter:wght@200;400;500&display=swap');

        :root { --ivory: #F5F5DC; --pitch: #050505; --rose: #ff2d55; }
        * { margin: 0; padding: 0; box-sizing: border-box; }

        .app-canvas {
          background: var(--pitch);
          color: var(--ivory);
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          font-family: 'Inter', sans-serif;
        }

        /* SPLINE (setas) */
        .spline-viewport {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: auto;
          transition: filter 0.35s ease, transform 0.35s ease;
          transform-origin: center;
        }
        spline-viewer { width: 100%; height: 100%; display: block; }

        /* Capa de legibilidad sobre setas */
        .bg-dim{
          position: fixed;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          background:
            radial-gradient(1200px 800px at 60% 45%, rgba(0,0,0,0.25), rgba(0,0,0,0.55)),
            rgba(0,0,0,0.18);
        }

        .ui-overlay {
          position: relative;
          z-index: 10;
          height: 100vh;
          pointer-events: none;
          display: flex;
          align-items: center;
          justify-content: center;
          padding:
            max(18px, env(safe-area-inset-top))
            max(18px, env(safe-area-inset-right))
            max(20px, env(safe-area-inset-bottom))
            max(18px, env(safe-area-inset-left));
        }
        .ui-overlay > * { pointer-events: auto; }

        /* HERO */
        .hero-editorial { text-align: center; max-width: 720px; padding: 0 14px; }
        .main-title {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(4rem, 15vw, 10rem);
          font-style: italic;
          font-weight: 300;
          letter-spacing: -0.05em;
          margin-bottom: 0.5rem;
          text-shadow: 0 0 40px rgba(245,245,220,0.2);
        }
        .tagline {
          letter-spacing: 0.36em;
          font-size: 0.65rem;
          opacity: 0.5;
          margin-bottom: 1.75rem;
          text-transform: uppercase;
        }
        .subcopy {
          max-width: 520px;
          margin: 0 auto 2.25rem;
          font-size: 0.95rem;
          line-height: 1.6;
          opacity: 0.75;
        }

        .upload-trigger {
          display: inline-flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem 2.5rem;
          border: 1px solid rgba(245,245,220,0.2);
          cursor: pointer;
          text-transform: uppercase;
          font-size: 0.75rem;
          letter-spacing: 0.1em;
          transition: 0.4s;
          user-select: none;
        }
        .upload-trigger:hover { background: var(--ivory); color: var(--pitch); }
        .upload-specs {
          margin-top: 10px;
          font-size: 0.7rem;
          letter-spacing: 0.12em;
          opacity: 0.45;
          text-transform: uppercase;
        }
        .hero-error {
          margin-top: 18px;
          font-size: 0.85rem;
          opacity: 0.75;
        }

        /* EXPERIENCE */
        .experience-grid {
          display: grid;
          grid-template-columns: 1fr 450px;
          width: min(1100px, 92vw);
          gap: clamp(2.2rem, 6vw, 6rem);
          align-items: center;
        }

        .image-frame {
          position: relative;
          width: 100%;
          height: 60vh;
          min-height: 360px;
          box-shadow: 0 40px 100px rgba(0,0,0,0.9);
          overflow: hidden;
          isolation: isolate; /* para blend de partículas */
        }
        .particles-canvas{
          position: absolute;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          mix-blend-mode: screen;
          opacity: 0.55;
        }
        .image-frame img {
          position: relative;
          z-index: 1;
          width: 100%;
          height: 100%;
          object-fit: cover;
          filter: saturate(0.9);
        }
        .curtain {
          position: absolute;
          inset: 0;
          z-index: 2;
          background: rgba(5,5,5,0.95);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Cormorant Garamond', serif;
          font-style: italic;
          font-size: 1.5rem;
        }

        .content-side { width: 100%; }
        .content-inner { padding: 0 clamp(10px, 2vw, 18px); overflow: visible; }

        .panel-error { margin-bottom: 18px; font-size: 0.9rem; opacity: 0.75; }

        .editorial-player { padding-right: 2px; }
        .mood-name {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(3rem, 6vw, 4.5rem);
          font-weight: 300;
          font-style: italic;
          line-height: 1;
          margin: 1rem 0;
        }

        .quote {
          font-family: 'Cormorant Garamond', serif;
          font-size: 1.4rem;
          font-style: italic;
          opacity: 0.74;
          border-left: 1px solid rgba(245,245,220,0.22);
          padding-left: 20px;
          margin-bottom: 0.65rem;
        }
        .micro-line {
          font-family: 'Inter', sans-serif;
          font-size: 0.9rem;
          line-height: 1.6;
          opacity: 0.62;
          margin-left: 21px;
          margin-bottom: 1.2rem;
        }

        .small-cap {
          font-size: 0.6rem;
          text-transform: uppercase;
          letter-spacing: 0.25em;
          opacity: 0.4;
        }

        .details { display: flex; gap: 3rem; margin-bottom: 1rem; }

        /* Mini paleta */
        .palette-dots{
          display:flex;
          gap:10px;
          align-items:center;
          margin: 0 0 1.5rem;
          opacity: 0.9;
        }
        .dot{
          width: 10px;
          height: 10px;
          border-radius: 999px;
          border: 1px solid rgba(245,245,220,0.18);
          box-shadow: 0 0 18px rgba(245,245,220,0.10);
        }

        /* EQ topo */
        .eq-wrapper { margin: 1.25rem 0 2rem; opacity: 0.9; }
        .label-tiny {
          display: block;
          font-size: 0.6rem;
          text-transform: uppercase;
          letter-spacing: 0.22em;
          opacity: 0.35;
          margin-bottom: 10px;
        }
        .eq-topo {
          width: 100%;
          height: 54px;
          border-bottom: 1px solid rgba(245,245,220,0.08);
        }

        /* CONTROLS */
        .player-controls {
          margin-top: 1.2rem;
          display: flex;
          align-items: center;
          gap: clamp(1rem, 2.5vw, 1.6rem);
          flex-wrap: wrap;
        }
        .main-btn {
          width: clamp(66px, 10vw, 90px);
          height: clamp(66px, 10vw, 90px);
          border-radius: 999px;
          border: 1px solid var(--ivory);
          background: transparent;
          color: var(--ivory);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: 0.4s;
          flex: 0 0 auto;
        }
        .main-btn:hover {
          background: var(--ivory);
          color: var(--pitch);
          transform: scale(1.03);
          box-shadow: 0 0 40px var(--rose);
        }
        .main-btn:disabled { opacity: 0.35; cursor: not-allowed; transform: none; box-shadow: none; }

        .action-rail {
          display: flex;
          align-items: center;
          gap: 14px;
          padding-right: max(0px, env(safe-area-inset-right));
        }
        .ghost-btn {
          width: 58px;
          height: 58px;
          border-radius: 999px;
          border: 1px solid rgba(245,245,220,0.14);
          background: rgba(5,5,5,0.10);
          color: var(--ivory);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: 0.3s;
          flex: 0 0 auto;
          backdrop-filter: blur(6px);
        }
        .ghost-btn:hover { border-color: rgba(245,245,220,0.45); }
        .ghost-btn:disabled { opacity: 0.35; cursor: not-allowed; }

        /* TOAST */
        .toast {
          position: fixed;
          left: 50%;
          bottom: max(18px, env(safe-area-inset-bottom));
          transform: translateX(-50%);
          z-index: 50;
          padding: 10px 14px;
          border: 1px solid rgba(245,245,220,0.14);
          background: rgba(5,5,5,0.6);
          backdrop-filter: blur(10px);
          font-size: 0.78rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          opacity: 0.9;
        }

        @media (max-width: 1000px) {
          .experience-grid { grid-template-columns: 1fr; }
          .image-frame { height: 42vh; min-height: 260px; }
          .details { gap: 2.2rem; }
        }

        @media (max-width: 540px) {
          .quote { font-size: 1.22rem; }
          .micro-line { font-size: 0.88rem; margin-left: 19px; }
          .details { gap: 1.8rem; }
          .ghost-btn { width: 56px; height: 56px; }
          .content-inner { padding-bottom: 10px; }
          .player-controls { margin-top: 1.6rem; }

          /* Setas: encuadre agradable en móvil */
          .spline-viewport { transform: scale(1.06); }
        }
      `}</style>
    </div>
  );
}
