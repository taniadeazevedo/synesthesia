import React, { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Play, Pause, RefreshCw, Download, Share2 } from "lucide-react";

// ============================================================================
// HELPERS
// ============================================================================
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;
}
function hexToRgb01(hex) {
  const h = (hex || "#808080").replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255
  };
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
// COLOR EXTRACTION
// ============================================================================
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
        const centroids = pixels.slice(0, 5); 
        resolve({ colors: centroids.map((c) => rgbToHex(c.r, c.g, c.b)) });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(imageFile);
  });
}

// ============================================================================
// AUDIO GENERATION (RECUPERADA COMPLETA)
// ============================================================================
async function generateMusic(metrics) {
  const duration = 72, sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, duration * sampleRate, sampleRate);
  const bpm = Math.round(lerp(72, 105, metrics.sat));
  const beat = 60 / bpm;

  const master = ctx.createGain(); master.gain.value = 0.7;
  const busFilter = ctx.createBiquadFilter();
  busFilter.type = "lowpass"; busFilter.frequency.value = lerp(800, 3500, metrics.lum);
  busFilter.connect(master); master.connect(ctx.destination);

  // LFO para movimiento
  const lfo = ctx.createOscillator(); const lfoG = ctx.createGain();
  lfo.frequency.value = 0.1; lfoG.gain.value = 500;
  lfo.connect(lfoG); lfoG.connect(busFilter.frequency); lfo.start(0);

  // Pad Synth
  const freqBase = lerp(80, 160, metrics.lum);
  [0, 4, 7, 11].forEach((semi) => {
    const osc = ctx.createOscillator(); osc.type = "sawtooth";
    osc.frequency.value = freqBase * Math.pow(2, semi/12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.08, 4);
    osc.connect(g); g.connect(busFilter); osc.start(0); osc.stop(duration);
  });

  // Reverb
  const irLen = sampleRate * 3; const irBuf = ctx.createBuffer(2, irLen, sampleRate);
  for(let c=0; c<2; c++) {
    const d = irBuf.getChannelData(c);
    for(let i=0; i<irLen; i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/irLen, 2);
  }
  const conv = ctx.createConvolver(); conv.buffer = irBuf;
  const rg = ctx.createGain(); rg.gain.value = 0.3;
  busFilter.connect(rg); rg.connect(conv); conv.connect(master);

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
  useEffect(() => { const t = setTimeout(() => setShouldLoad(true), 200); return () => clearTimeout(t); }, []);
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
    const canvas = canvasRef.current, ctx = canvas.getContext("2d");
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      if (!isPlaying) return;
      analyser.getByteFrequencyData(dataArray); ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath(); ctx.moveTo(0, canvas.height);
      const step = canvas.width / dataArray.length;
      for (let i = 0; i < dataArray.length; i++) {
        const x = i * step, y = canvas.height - (dataArray[i] / 255) * canvas.height;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(251,248,238,0.8)"; ctx.lineWidth = 2; ctx.stroke(); requestAnimationFrame(draw);
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
  const [toast, setToast] = useState("");

  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const analyserRef = useRef(null);

  const mood = useMemo(() => {
    if(!metrics) return "";
    if (metrics.lum < 0.36) return "nostálgica";
    if (metrics.lum > 0.68) return "luminosa";
    if (metrics.sat < 0.22) return "suspendida";
    return "íntima";
  }, [metrics]);

  const textura = useMemo(() => {
    if(!metrics) return "";
    if (metrics.sat < 0.22 && metrics.lum < 0.42) return "Velada";
    if (metrics.warm > 0.12 && metrics.sat >= 0.35) return "Cálida";
    if (metrics.warm < -0.1 && metrics.sat >= 0.35) return "Fría";
    if (metrics.paletteVar > 0.06) return "Prismática";
    return "Haze";
  }, [metrics]);

  const bpm = useMemo(() => metrics ? Math.round(lerp(72, 105, metrics.sat)) : 0, [metrics]);
  const atmo = useMemo(() => {
    const pools = {
      íntima: ["Algo que vuelve sin avisar.", "Un sitio donde el mundo baja el volumen.", "Cerca, como si no hiciera falta decir nada."],
      nostálgica: ["Un eco que se resiste a desaparecer.", "Lo que queda cuando el tiempo se detiene.", "Un brillo viejo en la esquina de la memoria."],
      suspendida: ["Un instante congelado en el aire.", "La quietud que precede al recuerdo.", "Todo flota un segundo antes de caer."],
      luminosa: ["La claridad que baña los momentos compartidos.", "Un rayo de sol atrapado en la memoria.", "La luz como una promesa pequeña."],
    };
    return mood ? pick(pools[mood]) : "";
  }, [mood]);

  const handleUpload = async (file) => {
    if (!file) return;
    setImageUrl(URL.createObjectURL(file)); setStage("loading");
    const { colors: c } = await extractColors(file);
    const m = { ...deriveColorMetrics(c), colors: c };
    const buffer = await generateMusic(m);
    setColors(c); setMetrics(m); setAudioBuffer(buffer); setStage("experience");
  };

  function deriveColorMetrics(colors) {
    const rgbs = colors.map(hexToRgb01);
    const luminances = rgbs.map(({ r, g, b }) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
    const warmnesses = rgbs.map(({ r, b }) => r - b);
    const sats = rgbs.map((rgb) => rgbToHsv(rgb).s);
    return { lum: mean(luminances), sat: mean(sats), warm: mean(warmnesses), paletteVar: variance(luminances) };
  }

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
            <div className="home-spacer" />
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
                <button onClick={() => { if(sourceRef.current) sourceRef.current.stop(); setStage("hero"); }} className="ghost-btn"><RefreshCw size={24} /></button>
              </div>
            </div>
          </div>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;1,500&family=Inter:wght@300;400;500;600&display=swap');
        :root { --pitch: #050505; --ivory: #fbf8ee; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { background: var(--pitch); color: var(--ivory); font-family: 'Inter', sans-serif; height: 100%; width: 100%; overflow: hidden; }
        
        .app { height: 100%; width: 100%; position: relative; overflow-y: auto; -webkit-overflow-scrolling: touch; }
        .spline-viewport { position: fixed; inset: 0; z-index: 1; pointer-events: auto; }
        spline-viewer { width: 100%; height: 100%; }
        
        .ui-overlay { position: relative; z-index: 10; min-height: 100%; width: 100%; display: flex; align-items: center; justify-content: center; padding: 2rem; pointer-events: none; }
        .ui-overlay > * { pointer-events: auto; }

        .hero-stage { text-align: center; max-width: 800px; display: flex; flex-direction: column; align-items: center; }
        .main-title { font-family: 'Cormorant Garamond', serif; font-size: clamp(4rem, 12vw, 9rem); font-style: italic; line-height: 1; }
        .hero-subtitle { opacity: 0.8; font-size: 1.1rem; margin-top: 1rem; }
        .home-spacer { height: 3.5rem; }
        .upload-trigger { display: inline-flex; align-items: center; gap: 12px; padding: 1.2rem 2.5rem; border: 1px solid rgba(251,248,238,0.3); cursor: pointer; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.1em; transition: 0.3s; background: rgba(0,0,0,0.4); backdrop-filter: blur(8px); }
        .upload-trigger:hover { background: var(--ivory); color: var(--pitch); }
        .upload-specs { margin-top: 1.8rem; font-size: 0.65rem; opacity: 0.5; letter-spacing: 0.1em; }

        .experience-grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 4rem; width: 100%; max-width: 1200px; align-items: center; }
        .image-frame { position: relative; width: 100%; height: 50vh; box-shadow: 0 40px 100px rgba(0,0,0,0.7); overflow: hidden; }
        .image-frame img { width: 100%; height: 100%; object-fit: cover; }
        .curtain { position: absolute; inset: 0; background: rgba(5,5,5,0.7); display: flex; align-items: center; justify-content: center; font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 1.5rem; }
        
        .panel { display: flex; flex-direction: column; gap: 1.5rem; }
        .small-cap { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.25em; opacity: 0.6; margin-bottom: 4px; display: block; }
        .main-mood { font-family: 'Cormorant Garamond', serif; font-size: clamp(3rem, 6vw, 5rem); font-style: italic; line-height: 0.9; }
        .quote { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 1.6rem; line-height: 1.3; border-left: 1px solid rgba(251,248,238,0.2); padding-left: 1.5rem; }
        .eq-topo { width: 100%; border-bottom: 1px solid rgba(251,248,238,0.1); height: 60px; }
        
        .details-row { display: flex; gap: 3.5rem; align-items: flex-start; }
        .val { font-family: 'Cormorant Garamond', serif; font-size: 2.2rem; font-style: italic; line-height: 1; }
        .palette-dots { display: flex; gap: 12px; padding-top: 10px; }
        .dot { width: 14px; height: 14px; border-radius: 50%; border: 1px solid rgba(251,248,238,0.2); }
        
        .controls { display: flex; align-items: center; gap: 2rem; margin-top: 1rem; }
        .main-btn { width: 90px; height: 90px; border-radius: 50%; border: 1px solid var(--ivory); background: transparent; color: var(--ivory); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.3s; }
        .main-btn:hover { background: var(--ivory); color: var(--pitch); transform: scale(1.05); }
        .ghost-btn { width: 68px; height: 68px; border-radius: 50%; border: 1px solid rgba(251,248,238,0.2); background: rgba(255,255,255,0.05); color: var(--ivory); cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px); transition: 0.3s; }
        .ghost-btn:hover { border-color: var(--ivory); }
        
        .toast { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); background: #000; padding: 12px 24px; border: 1px solid var(--ivory); font-size: 0.7rem; letter-spacing: 0.2em; text-transform: uppercase; z-index: 1000; }
        .spinner { width: 40px; height: 40px; border: 3px solid rgba(251,248,238,0.1); border-top-color: var(--ivory); border-radius: 50%; animation: s 1s linear infinite; margin: 0 auto; }
        @keyframes s { to { transform: rotate(360deg); } }

@media (max-width: 900px) {
  /* Contenedor general: ahora centra el contenido verticalmente */
  .ui-overlay { 
    padding: 1rem; 
    align-items: center; 
    justify-content: center; 
    display: flex;
  }
  
  /* HOME: Centrado perfecto usando la altura dinámica del visor */
  .hero-stage { 
    justify-content: center; 
    height: 100dvh; 
    padding-top: 0; 
    margin-top: -2rem; /* Sutil ajuste para compensar el peso visual del título */
  }

  /* PANTALLA FOTO: Menos relleno arriba y espacio compacto */
  .experience-grid { 
    grid-template-columns: 1fr; 
    gap: 1rem; 
    text-align: center; 
    margin-top: -3rem; /* Subimos todo el bloque para aprovechar la pantalla */
  }

  .image-frame { 
    height: 20vh; /* Tamaño ideal para dejar ver los botones sin scroll */
    width: 70%; 
    margin: 0 auto; 
    box-shadow: 0 10px 30px rgba(0,0,0,0.5); 
  }

  .panel { 
    align-items: center; 
    gap: 0.5rem; /* Espacio más estrecho entre elementos */
  }

  .quote { 
    border-left: none; 
    border-top: 1px solid rgba(251,248,238,0.1); 
    padding: 0.8rem 0 0; 
    font-size: 1.2rem; 
    margin-bottom: 0.5rem;
  }

  .details-row { 
    gap: 1.5rem; 
    justify-content: center; 
    width: 100%; 
  }

  .controls { 
    gap: 1.2rem; 
    justify-content: center; 
    padding-bottom: 1rem; 
  }

  .main-mood { font-size: 2.5rem; }
  .val { font-size: 1.6rem; }
}
      `}</style>
    </div>
  );
}
