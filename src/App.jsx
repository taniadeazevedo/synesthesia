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
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { s, v };
}
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function variance(arr) {
  if (!arr.length) return 0;
  const m = mean(arr);
  return mean(arr.map((x) => (x - m) ** 2));
}

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
        if (dist < minDist) { minDist = dist; closest = idx; }
      });
      clusters[closest].push(pixel);
    });
    centroids = clusters.map((cluster) => {
      if (cluster.length === 0) return centroids[0];
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
  return { lum, warm, sat, paletteVar, contrast: Math.max(...luminances) - Math.min(...luminances), colors: cols };
}

function deriveTextureFromMetrics(m) {
  if (m.sat < 0.22 && m.lum < 0.42) return "Velada";
  if (m.sat < 0.22 && m.lum >= 0.42) return "Bruma";
  if (m.warm > 0.12 && m.sat >= 0.35) return "Cálida";
  if (m.warm < -0.1 && m.sat >= 0.35) return "Fría";
  if (m.paletteVar > 0.06 && m.sat >= 0.3) return "Prismática";
  return "Haze";
}

function deriveMoodFromMetrics(m) {
  if (m.lum < 0.36) return "nostálgica";
  if (m.lum > 0.68 && m.sat > 0.22) return "luminosa";
  if (m.sat < 0.22) return "suspendida";
  return "íntima";
}

const POOLS_ATMOS = {
  íntima: ["Algo que vuelve sin avisar.", "Un sitio donde el mundo baja el volumen.", "Cerca, como si no hiciera falta decir nada."],
  nostálgica: ["Un eco que se resiste a desaparecer.", "Lo que queda cuando el tiempo se detiene.", "Un brillo viejo en la esquina de la memoria."],
  suspendida: ["Un instante congelado en el aire.", "La quietud que precede al recuerdo.", "Todo flota un segundo antes de caer."],
  luminosa: ["La claridad que baña los momentos compartidos.", "Un rayo de sol atrapado en la memoria.", "La luz como una promesa pequeña."],
};

function deriveBpmFromMetrics(m) {
  const base = lerp(78, 102, clamp(m.sat * 0.55 + 0.45, 0, 1));
  return Math.round(clamp(base, 72, 110));
}

function deriveMusicProfileFromMetrics(m) {
  const bpm = deriveBpmFromMetrics(m);
  return { bpm, reverbSeconds: 2.5, cutoff: 2000, noiseLevel: 0.01, sidechainDepth: 0.1, delayFeedback: 0.2, delayMix: 0.2, evolveAmount: 0.5 };
}

async function generateMusic(metrics) {
  const duration = 72;
  const sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, Math.floor(duration * sampleRate), sampleRate);
  const m = deriveMusicProfileFromMetrics(metrics);
  const master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(110, 0);
  osc.connect(master);
  osc.start(0);
  osc.stop(duration);
  return await ctx.startRendering();
}

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
  const writeString = (str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); offset += str.length; };
  writeString("RIFF"); view.setUint32(offset, 36 + dataSize, true); offset += 4;
  writeString("WAVE"); writeString("fmt "); view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, format, true); offset += 2;
  view.setUint16(offset, numChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, byteRate, true); offset += 4;
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, bitDepth, true); offset += 2;
  writeString("data"); view.setUint32(offset, dataSize, true); offset += 4;
  const channelData = [];
  for (let c = 0; c < numChannels; c++) channelData.push(audioBuffer.getChannelData(c));
  let writePos = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = Math.max(-1, Math.min(1, channelData[c][i]));
      view.setInt16(writePos, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); writePos += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// ============================================================================
// COMPONENTS
// ============================================================================
function SplineBackground() {
  const [shouldLoad, setShouldLoad] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShouldLoad(true), 500); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!shouldLoad) return;
    if (!document.querySelector('script[src*="spline-viewer"]')) {
      const s = document.createElement("script"); s.type = "module";
      s.src = "https://unpkg.com/@splinetool/viewer@1.12.53/build/spline-viewer.js"; document.head.appendChild(s);
    }
  }, [shouldLoad]);
  return <div className="spline-viewport">{shouldLoad && <spline-viewer url="https://prod.spline.design/6wFT9lzZuaWY69mT/scene.splinecode" />}</div>;
}

function EQTopography({ analyser, isPlaying }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!analyser || !isPlaying || !canvasRef.current) return;
    const canvas = canvasRef.current; const ctx = canvas.getContext("2d");
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      if (!isPlaying) return;
      analyser.getByteFrequencyData(dataArray); ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = canvas.width / dataArray.length;
      ctx.beginPath(); ctx.moveTo(0, canvas.height);
      for (let i = 0; i < dataArray.length; i++) {
        const x = i * barWidth; const y = canvas.height - (dataArray[i] / 255) * canvas.height;
        if (i === 0) ctx.lineTo(x, y); else ctx.quadraticCurveTo((x + (i - 1) * barWidth) / 2, canvas.height - (dataArray[i - 1] / 255) * canvas.height, x, y);
      }
      ctx.strokeStyle = "rgba(251,248,238,0.8)"; ctx.lineWidth = 1.5; ctx.stroke(); requestAnimationFrame(draw);
    };
    draw();
  }, [analyser, isPlaying]);
  return <canvas ref={canvasRef} className="eq-topo" width={400} height={50} />;
}

// ============================================================================
// MAIN APP
// ============================================================================
export default function App() {
  const [stage, setStage] = useState("hero");
  const [imageUrl, setImageUrl] = useState(null);
  const [colors, setColors] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");

  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const analyserRef = useRef(null);

  const textura = useMemo(() => (metrics ? deriveTextureFromMetrics(metrics) : ""), [metrics]);
  const mood = useMemo(() => (metrics ? deriveMoodFromMetrics(metrics) : ""), [metrics]);
  const bpm = useMemo(() => (metrics ? deriveBpmFromMetrics(metrics) : 0), [metrics]);
  const atmo = useMemo(() => (mood && POOLS_ATMOS[mood] ? pick(POOLS_ATMOS[mood]) : ""), [mood]);

  const handleImageUpload = async (file) => {
    if (!file) return;
    setImageUrl(URL.createObjectURL(file)); setStage("loading");
    try {
      setLoadingMsg("Analizando...");
      const { colors: extracted } = await extractColors(file); setColors(extracted);
      const m = deriveColorMetrics(extracted); setMetrics(m);
      setLoadingMsg("Sintetizando...");
      const buffer = await generateMusic(m); setAudioBuffer(buffer); setStage("experience");
    } catch (err) { setStage("hero"); }
  };

  const handlePlayPause = () => {
    if (!audioBuffer) return;
    if (isPlaying) { sourceRef.current?.stop(); setIsPlaying(false); } 
    else {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      sourceRef.current = audioContextRef.current.createBufferSource();
      analyserRef.current = audioContextRef.current.createAnalyser();
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
            <input type="file" id="upload" accept="image/*" onChange={(e) => handleImageUpload(e.target.files[0])} style={{ display: "none" }} />
            <label htmlFor="upload" className="upload-trigger"><Upload size={18} /><span>Entrega una memoria</span></label>
          </div>
        )}

        {stage === "loading" && (
          <div className="loading-stage"><div className="spinner" /><p>{loadingMsg}</p></div>
        )}

        {stage === "experience" && (
          <div className="experience-grid">
            <div className="image-frame">
              <img src={imageUrl} alt="Memory" />
              {isPlaying && <div className="curtain"><span>Traduciendo el color...</span></div>}
            </div>

            <div className="panel">
              <div className="small-cap">Esencia</div>
              <div className="mood-name">{mood}</div>
              <blockquote className="quote">{atmo}</blockquote>

              <div className="section-block">
                <div className="small-cap">Frecuencias</div>
                <EQTopography analyser={analyserRef.current} isPlaying={isPlaying} />
              </div>

              <div className="details-row">
                <div className="detail-item">
                  <div className="small-cap">Tempo</div>
                  <div className="val">{bpm}</div>
                </div>
                <div className="detail-item">
                  <div className="small-cap">Textura</div>
                  <div className="val">{textura}</div>
                </div>
                <div className="palette-dots">
                  {colors.map((c, i) => <div key={i} className="dot" style={{ backgroundColor: c }} />)}
                </div>
              </div>

              <div className="controls">
                <button onClick={handlePlayPause} className="main-btn">{isPlaying ? <Pause size={24} /> : <Play size={24} />}</button>
                <button onClick={() => {
                  const blob = audioBufferToWavBlob(audioBuffer);
                  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "synesthesia.wav"; a.click();
                }} className="ghost-btn"><Download size={20} /></button>
                <button onClick={() => setStage("hero")} className="ghost-btn"><RefreshCw size={20} /></button>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;1,600&family=Inter:wght@300;400;600&display=swap');
        :root { --pitch: #050505; --ivory: #fbf8ee; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { background: var(--pitch); color: var(--ivory); font-family: 'Inter', sans-serif; overflow-x: hidden; width: 100%; }
        
        .app { width: 100%; min-height: 100vh; position: relative; }
        .spline-viewport { position: fixed; inset: 0; z-index: 0; }
        
        .ui-overlay { 
          position: relative; z-index: 10; min-height: 100vh; width: 100%;
          display: flex; align-items: center; justify-content: center; padding: 20px;
          pointer-events: none;
        }
        .ui-overlay > * { pointer-events: auto; }

        /* HERO */
        .hero-stage { text-align: center; max-width: 600px; padding-bottom: 2rem; }
        .main-title { font-family: 'Cormorant Garamond', serif; font-size: clamp(3.5rem, 10vw, 8rem); font-style: italic; margin-bottom: 1rem; }
        .upload-trigger { 
          display: inline-flex; align-items: center; gap: 10px; padding: 1rem 2rem; 
          border: 1px solid rgba(251,248,238,0.3); cursor: pointer; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.1em;
        }
        .upload-trigger:hover { background: var(--ivory); color: var(--pitch); }

        /* EXPERIENCE GRID */
        .experience-grid { 
          display: grid; grid-template-columns: 1.2fr 1fr; gap: 4rem; 
          width: 100%; max-width: 1100px; align-items: center; 
        }

        .image-frame { position: relative; width: 100%; height: 55vh; overflow: hidden; box-shadow: 0 40px 100px rgba(0,0,0,0.5); }
        .image-frame img { width: 100%; height: 100%; object-fit: cover; }
        .curtain { position: absolute; inset: 0; background: rgba(5,5,5,0.7); display: flex; align-items: center; justify-content: center; font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 1.2rem; }

        .panel { display: flex; flex-direction: column; gap: 1.5rem; }
        .small-cap { font-size: 0.55rem; text-transform: uppercase; letter-spacing: 0.2em; opacity: 0.6; margin-bottom: 4px; }
        .mood-name { font-family: 'Cormorant Garamond', serif; font-size: clamp(2.5rem, 5vw, 4rem); font-style: italic; line-height: 1; }
        .quote { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 1.1rem; opacity: 0.8; border-left: 1px solid rgba(251,248,238,0.2); padding-left: 1rem; margin-bottom: 1rem; }
        
        .section-block { margin-bottom: 0.5rem; }
        .eq-topo { width: 100%; height: 50px; border-bottom: 1px solid rgba(251,248,238,0.1); }

        .details-row { display: flex; align-items: flex-end; gap: 2.5rem; flex-wrap: wrap; }
        .val { font-family: 'Cormorant Garamond', serif; font-size: 1.5rem; font-style: italic; margin: 0; }
        .palette-dots { display: flex; gap: 8px; align-items: center; padding-bottom: 4px; }
        .dot { width: 10px; height: 10px; border-radius: 50%; }

        .controls { display: flex; align-items: center; gap: 1.5rem; margin-top: 1rem; }
        .main-btn { width: 74px; height: 74px; border-radius: 50%; border: 1px solid var(--ivory); background: transparent; color: var(--ivory); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.3s; }
        .main-btn:hover { background: var(--ivory); color: var(--pitch); }
        .ghost-btn { width: 54px; height: 54px; border-radius: 50%; border: 1px solid rgba(251,248,238,0.2); background: rgba(255,255,255,0.05); color: var(--ivory); cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(5px); transition: 0.3s; }
        .ghost-btn:hover { border-color: var(--ivory); }

        /* MOBILE FIXES */
        @media (max-width: 900px) {
          .ui-overlay { padding: 40px 20px; align-items: flex-start; }
          .experience-grid { grid-template-columns: 1fr; gap: 2rem; width: 100%; text-align: center; }
          .image-frame { height: 35vh; }
          .panel { width: 100%; align-items: center; padding-bottom: 60px; }
          .details-row { justify-content: center; gap: 2rem; width: 100%; }
          .controls { justify-content: center; width: 100%; }
          .quote { border-left: none; border-top: 1px solid rgba(251,248,238,0.1); padding: 15px 0 0 0; }
        }

        .spinner { width: 30px; height: 30px; border: 2px solid rgba(251,248,238,0.2); border-top-color: var(--ivory); border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 10px; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
