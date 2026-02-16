import React, { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Play, Pause, RefreshCw, Download, Share2 } from "lucide-react";

// ============================================================================
// HELPERS & LOGIC
// ============================================================================
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((x) => {
    const hex = Math.round(x).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("")}`;
}
function hexToRgb01(hex) {
  const h = (hex || "#808080").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return { r, g, b };
}
function rgbToHsv({ r, g, b }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  return { s: max === 0 ? 0 : d / max, v: max };
}
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function variance(arr) {
  if (!arr.length) return 0;
  const m = mean(arr);
  return mean(arr.map((x) => (x - m) ** 2));
}

// ============================================================================
// COLOR EXTRACTION (KMEANS)
// ============================================================================
function kMeansClustering(pixels, k = 5, maxIterations = 10) {
  if (pixels.length === 0) return [];
  let centroids = [];
  for (let i = 0; i < k; i++) centroids.push(pixels[Math.floor(Math.random() * pixels.length)]);
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const clusters = Array(k).fill(null).map(() => []);
    pixels.forEach((pixel) => {
      let minDist = Infinity, closest = 0;
      centroids.forEach((c, idx) => {
        const dist = Math.sqrt((pixel.r - c.r) ** 2 + (pixel.g - c.g) ** 2 + (pixel.b - c.b) ** 2);
        if (dist < minDist) { minDist = dist; closest = idx; }
      });
      clusters[closest].push(pixel);
    });
    centroids = clusters.map((cluster, i) => {
      if (cluster.length === 0) return centroids[i];
      const sum = cluster.reduce((acc, p) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b }), { r: 0, g: 0, b: 0 });
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
        const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
        const scale = Math.min(320 / img.width, 320 / img.height);
        canvas.width = img.width * scale; canvas.height = img.height * scale;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data, pixels = [];
        for (let i = 0; i < data.length; i += 32) {
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
// METRICS & PROFILE
// ============================================================================
function deriveColorMetrics(colors = []) {
  const cols = (colors.length ? colors : ["#808080"]).slice(0, 6);
  const rgbs = cols.map(hexToRgb01);
  const luminances = rgbs.map(({ r, g, b }) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
  const warmnesses = rgbs.map(({ r, b }) => r - b);
  const sats = rgbs.map((rgb) => rgbToHsv(rgb).s);
  return { 
    lum: clamp(mean(luminances), 0, 1), 
    warm: clamp(mean(warmnesses), -1, 1), 
    sat: clamp(mean(sats), 0, 1), 
    paletteVar: clamp(variance(luminances) + variance(sats), 0, 0.2),
    contrast: Math.max(...luminances) - Math.min(...luminances),
    colors: cols 
  };
}

function deriveTextureFromMetrics(m) {
  if (m.sat < 0.22 && m.lum < 0.42) return "Velada";
  if (m.sat < 0.22) return "Bruma";
  if (m.warm > 0.12 && m.sat >= 0.35) return "Cálida";
  if (m.warm < -0.1 && m.sat >= 0.35) return "Fría";
  if (m.paletteVar > 0.06) return "Prismática";
  return "Haze";
}

function deriveMoodFromMetrics(m) {
  if (m.lum < 0.36) return "nostálgica";
  if (m.lum > 0.68) return "luminosa";
  if (m.sat < 0.22) return "suspendida";
  return "íntima";
}

const POOLS_ATMOS = {
  íntima: ["Algo que vuelve sin avisar.", "Un sitio donde el mundo baja el volumen.", "Cerca, como si no hiciera falta decir nada."],
  nostálgica: ["Un eco que se resiste a desaparecer.", "Lo que queda cuando el tiempo se detiene.", "Un brillo viejo en la esquina de la memoria."],
  suspendida: ["Un instante congelado en el aire.", "La quietud que precede al recuerdo.", "Todo flota un segundo antes de caer."],
  luminosa: ["La claridad que baña los momentos compartidos.", "Un rayo de sol atrapado en la memoria.", "La luz como una promesa pequeña."],
};

// ============================================================================
// AUDIO ENGINE (FULL VERSION)
// ============================================================================
async function generateMusic(metrics) {
  const duration = 72, sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, duration * sampleRate, sampleRate);
  
  const m = {
    bpm: Math.round(lerp(72, 110, metrics.sat)),
    cutoff: lerp(800, 4000, metrics.lum),
    reverb: lerp(1.5, 4, metrics.paletteVar * 5),
    detune: lerp(5, 25, metrics.paletteVar * 10)
  };
  const beat = 60 / m.bpm;

  // Master Bus
  const master = ctx.createGain();
  master.gain.value = 0.8;
  const busFilter = ctx.createBiquadFilter();
  busFilter.type = "lowpass";
  busFilter.frequency.value = m.cutoff;
  busFilter.connect(master);
  master.connect(ctx.destination);

  // Pad Synth
  const padBus = ctx.createGain();
  padBus.gain.setValueAtTime(0, 0);
  padBus.gain.linearRampToValueAtTime(0.4, 5);
  padBus.connect(busFilter);

  [0, 7, 12].forEach(interval => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 110 * Math.pow(2, interval/12);
    osc.detune.value = m.detune;
    const g = ctx.createGain();
    g.gain.value = 0.1;
    osc.connect(g);
    g.connect(padBus);
    osc.start(0);
    osc.stop(duration);
  });

  // Percussion
  for (let t = 0; t < duration; t += beat) {
    const kick = ctx.createOscillator();
    const kg = ctx.createGain();
    kick.frequency.setValueAtTime(150, t);
    kick.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    kg.gain.setValueAtTime(0.3, t);
    kg.gain.linearRampToValueAtTime(0, t + 0.2);
    kick.connect(kg);
    kg.connect(busFilter);
    kick.start(t);
    kick.stop(t + 0.2);
  }

  return await ctx.startRendering();
}

function audioBufferToWavBlob(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels, sampleRate = audioBuffer.sampleRate, numFrames = audioBuffer.length;
  const buffer = new ArrayBuffer(44 + numFrames * numChannels * 2), view = new DataView(buffer);
  const writeString = (s, o) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeString("RIFF", 0); view.setUint32(4, 36 + numFrames * numChannels * 2, true); writeString("WAVE", 8);
  writeString("fmt ", 12); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true); view.setUint16(34, 16, true); writeString("data", 36);
  view.setUint32(40, numFrames * numChannels * 2, true);
  for (let i = 0, pos = 44; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let s = Math.max(-1, Math.min(1, audioBuffer.getChannelData(c)[i]));
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true); pos += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// ============================================================================
// COMPONENTS
// ============================================================================
function SplineBackground() {
  const [shouldLoad, setShouldLoad] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShouldLoad(true), 100); return () => clearTimeout(t); }, []);
  return (
    <div className="spline-viewport">
      {shouldLoad && <spline-viewer url="https://prod.spline.design/6wFT9lzZuaWY69mT/scene.splinecode" />}
    </div>
  );
}

function EQTopography({ analyser, isPlaying }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!analyser || !isPlaying || !canvasRef.current) return;
    const canvas = canvasRef.current, ctx = canvas.getContext("2d");
    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      if (!isPlaying) return;
      analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath(); ctx.moveTo(0, canvas.height);
      const step = canvas.width / data.length;
      for (let i = 0; i < data.length; i++) {
        const x = i * step, y = canvas.height - (data[i] / 255) * canvas.height;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(251,248,238,0.8)"; ctx.lineWidth = 2; ctx.stroke();
      requestAnimationFrame(draw);
    };
    draw();
  }, [analyser, isPlaying]);
  return <canvas ref={canvasRef} className="eq-topo" width={600} height={60} />;
}

export default function App() {
  const [stage, setStage] = useState("hero");
  const [imageUrl, setImageUrl] = useState(null);
  const [colors, setColors] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [toast, setToast] = useState("");

  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const analyserRef = useRef(null);

  const mood = useMemo(() => metrics ? deriveMoodFromMetrics(metrics) : "", [metrics]);
  const textura = useMemo(() => metrics ? deriveTextureFromMetrics(metrics) : "", [metrics]);
  const bpm = useMemo(() => metrics ? Math.round(lerp(72, 110, metrics.sat)) : 0, [metrics]);
  const atmo = useMemo(() => mood ? pick(POOLS_ATMOS[mood]) : "", [mood]);

  const handleUpload = async (file) => {
    if (!file) return;
    setImageUrl(URL.createObjectURL(file)); setStage("loading");
    const { colors: c } = await extractColors(file);
    const m = deriveColorMetrics(c);
    const buffer = await generateMusic(m);
    setColors(c); setMetrics(m); setAudioBuffer(buffer); setStage("experience");
  };

  const togglePlay = () => {
    if (!audioBuffer) return;
    if (isPlaying) { sourceRef.current?.stop(); setIsPlaying(false); }
    else {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      sourceRef.current = audioContextRef.current.createBufferSource();
      sourceRef.current.buffer = audioBuffer;
      sourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioContextRef.current.destination);
      sourceRef.current.onended = () => setIsPlaying(false);
      sourceRef.current.start(0); setIsPlaying(true);
    }
  };

  return (
    <div className="app">
      <SplineBackground />
      <div className="ui-overlay">
        {stage === "hero" && (
          <div className="hero-stage">
            <h1 className="main-title">Synesthesia</h1>
            <p className="hero-subtitle">Donde cada imagen tiene su propia música</p>
            <div style={{ height: "40px" }} />
            <input type="file" id="u" accept="image/*" onChange={e => handleUpload(e.target.files[0])} style={{ display: "none" }} />
            <label htmlFor="u" className="upload-trigger"><Upload size={20} /><span>Entrega una memoria</span></label>
            <div className="upload-specs">JPG · PNG · WEBP | Máximo 10MB</div>
          </div>
        )}

        {stage === "loading" && <div className="loading-stage"><div className="spinner" /></div>}

        {stage === "experience" && (
          <div className="experience-grid">
            <div className="image-frame">
              <img src={imageUrl} alt="Memory" />
              {isPlaying && <div className="curtain"><span>Sintetizando luz...</span></div>}
            </div>
            <div className="panel">
              <div className="small-cap">Esencia</div>
              <div className="mood-name main-mood">{mood}</div>
              <blockquote className="quote">{atmo}</blockquote>
              <div className="section-block">
                <div className="small-cap">Frecuencias</div>
                <EQTopography analyser={analyserRef.current} isPlaying={isPlaying} />
              </div>
              <div className="details-row">
                <div className="detail-item"><div className="small-cap">Tempo</div><div className="val">{bpm}</div></div>
                <div className="detail-item"><div className="small-cap">Textura</div><div className="val">{textura}</div></div>
                <div className="detail-item">
                  <div className="small-cap">Espectro</div>
                  <div className="palette-dots">{colors.map((c, i) => <div key={i} className="dot" style={{ background: c }} />)}</div>
                </div>
              </div>
              <div className="controls">
                <button onClick={togglePlay} className="main-btn">{isPlaying ? <Pause size={32} /> : <Play size={32} />}</button>
                <button onClick={() => {
                   const a = document.createElement("a"); a.href = URL.createObjectURL(audioBufferToWavBlob(audioBuffer)); a.download = "syn.wav"; a.click();
                   setToast("Descargando..."); setTimeout(() => setToast(""), 2000);
                }} className="ghost-btn"><Download size={24} /></button>
                <button onClick={() => setStage("hero")} className="ghost-btn"><RefreshCw size={24} /></button>
              </div>
            </div>
          </div>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;1,500&family=Inter:wght@300;400&display=swap');
        :root { --pitch: #050505; --ivory: #fbf8ee; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: var(--pitch); color: var(--ivory); font-family: 'Inter', sans-serif; overflow-x: hidden; }
        .app { min-height: 100vh; position: relative; }
        .spline-viewport { position: fixed; inset: 0; z-index: 0; }
        .ui-overlay { position: relative; z-index: 10; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem; pointer-events: none; }
        .ui-overlay > * { pointer-events: auto; }
        .hero-stage { text-align: center; max-width: 800px; }
        .main-title { font-family: 'Cormorant Garamond', serif; font-size: clamp(4rem, 12vw, 9rem); font-style: italic; line-height: 1; }
        .hero-subtitle { opacity: 0.8; font-size: 1.1rem; margin-top: 1rem; }
        .upload-trigger { display: inline-flex; align-items: center; gap: 12px; padding: 1.2rem 2.5rem; border: 1px solid rgba(251,248,238,0.3); cursor: pointer; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.1em; transition: 0.3s; }
        .upload-trigger:hover { background: var(--ivory); color: var(--pitch); }
        .upload-specs { margin-top: 15px; font-size: 0.65rem; opacity: 0.5; letter-spacing: 0.1em; }
        .experience-grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 4rem; width: 100%; max-width: 1200px; align-items: center; }
        .image-frame { position: relative; width: 100%; height: 50vh; box-shadow: 0 40px 100px rgba(0,0,0,0.7); }
        .image-frame img { width: 100%; height: 100%; object-fit: cover; }
        .curtain { position: absolute; inset: 0; background: rgba(5,5,5,0.7); display: flex; align-items: center; justify-content: center; font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 1.5rem; }
        .panel { display: flex; flex-direction: column; gap: 1.5rem; }
        .small-cap { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.25em; opacity: 0.6; margin-bottom: 4px; }
        .main-mood { font-family: 'Cormorant Garamond', serif; font-size: clamp(3rem, 6vw, 5rem); font-style: italic; line-height: 0.9; }
        .quote { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 1.6rem; line-height: 1.3; border-left: 1px solid rgba(251,248,238,0.2); padding-left: 1.5rem; }
        .eq-topo { width: 100%; border-bottom: 1px solid rgba(251,248,238,0.1); }
        .details-row { display: flex; gap: 3.5rem; align-items: flex-start; }
        .val { font-family: 'Cormorant Garamond', serif; font-size: 2.2rem; font-style: italic; line-height: 1; }
        .palette-dots { display: flex; gap: 12px; padding-top: 8px; }
        .dot { width: 14px; height: 14px; border-radius: 50%; border: 1px solid rgba(251,248,238,0.2); }
        .controls { display: flex; align-items: center; gap: 2rem; margin-top: 1rem; }
        .main-btn { width: 90px; height: 90px; border-radius: 50%; border: 1px solid var(--ivory); background: transparent; color: var(--ivory); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.3s; }
        .main-btn:hover { background: var(--ivory); color: var(--pitch); transform: scale(1.05); }
        .ghost-btn { width: 65px; height: 65px; border-radius: 50%; border: 1px solid rgba(251,248,238,0.2); background: rgba(255,255,255,0.05); color: var(--ivory); cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px); transition: 0.3s; }
        .ghost-btn:hover { border-color: var(--ivory); }
        .toast { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); background: #000; padding: 12px 24px; border: 1px solid var(--ivory); font-size: 0.7rem; letter-spacing: 0.2em; text-transform: uppercase; z-index: 1000; }
        .spinner { width: 40px; height: 40px; border: 3px solid rgba(251,248,238,0.1); border-top-color: var(--ivory); border-radius: 50%; animation: s 1s linear infinite; margin: 0 auto; }
        @keyframes s { to { transform: rotate(360deg); } }

        @media (max-width: 900px) {
          .ui-overlay { padding: 1rem; align-items: flex-start; }
          .experience-grid { grid-template-columns: 1fr; gap: 1.5rem; text-align: center; }
          .image-frame { height: 30vh; margin-top: -1rem; }
          .panel { align-items: center; }
          .quote { border-left: none; border-top: 1px solid rgba(251,248,238,0.1); padding: 1.5rem 0 0; font-size: 1.3rem; }
          .details-row { gap: 2rem; justify-content: center; width: 100%; }
          .controls { gap: 1.5rem; justify-content: center; }
          .main-btn { width: 80px; height: 80px; }
          .ghost-btn { width: 60px; height: 60px; }
        }
      `}</style>
    </div>
  );
}
