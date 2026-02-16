import React, { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Play, Pause, RefreshCw, Download, Share2 } from "lucide-react";

// ============================================================================
// HELPERS
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
// COLOR EXTRACTION
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
// METRICS (mantener tu código completo aquí)
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
  return { bpm, reverbSeconds, cutoff, detuneSpread, noiseLevel, sidechainDepth, delayFeedback, delayMix, evolveAmount };
}

// ============================================================================
// AUDIO GENERATION (usar tu código completo aquí)
// ============================================================================

async function generateMusic(metrics) {
  // IMPORTANTE: Aquí va tu código completo de generateMusic
  // Por brevedad lo simplifico, pero usa tu versión completa
  const duration = 72;
  const sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, Math.floor(duration * sampleRate), sampleRate);
  
  // ... tu código completo de audio aquí ...
  
  return await ctx.startRendering();
}

// ============================================================================
// EXPORT WAV
// ============================================================================

function audioBufferToWavBlob(audioBuffer) {
  // ... tu código completo aquí ...
  return new Blob([], { type: "audio/wav" });
}

// ============================================================================
// COMPONENTS
// ============================================================================

function SplineBackground() {
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShouldLoad(true), 100);
    return () => clearTimeout(timer);
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
    <div className="spline-viewport">
      {shouldLoad && <spline-viewer url="https://prod.spline.design/6wFT9lzZuaWY69mT/scene.splinecode" />}
    </div>
  );
}

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

  return <canvas ref={canvasRef} className="eq-topo" />;
}

function ParticlesCanvas({ colors, isPlaying }) {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.offsetWidth;
        canvas.height = parent.offsetHeight;
      }
    };
    resize();
    window.addEventListener("resize", resize);

    particlesRef.current = Array.from({ length: 30 }, () => ({
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
      particlesRef.current.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.shadowBlur = 8;
        ctx.shadowColor = p.color;
        ctx.fill();
      });
      requestAnimationFrame(draw);
    };
    draw();

    return () => window.removeEventListener("resize", resize);
  }, [colors, isPlaying]);

  return <canvas ref={canvasRef} className="particles-canvas" />;
}

// ============================================================================
// MAIN APP
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

  const textura = useMemo(() => (metrics ? deriveTextureFromMetrics(metrics) : ""), [metrics]);
  const mood = useMemo(() => (metrics ? deriveMoodFromMetrics(metrics) : ""), [metrics]);
  const bpm = useMemo(() => (metrics ? deriveBpmFromMetrics(metrics) : 0), [metrics]);
  const atmo = useMemo(() => (mood && POOLS_ATMOS[mood] ? pick(POOLS_ATMOS[mood]) : ""), [mood]);

  // Add viewport meta tag
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      const newMeta = document.createElement('meta');
      newMeta.name = 'viewport';
      newMeta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
      document.head.appendChild(newMeta);
    }
  }, []);

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

  const handlePlayPause = () => {
    if (!audioBuffer) return;

    if (isPlaying) {
      sourceRef.current?.stop();
      setIsPlaying(false);
    } else {
      audioContextRef.current = new AudioContext();
      sourceRef.current = audioContextRef.current.createBufferSource();
      
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;

      sourceRef.current.buffer = audioBuffer;
      sourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioContextRef.current.destination);

      sourceRef.current.onended = () => setIsPlaying(false);
      sourceRef.current.start(0);
      setIsPlaying(true);
    }
  };

  const handleDownload = () => {
    if (!audioBuffer) return;
    const blob = audioBufferToWavBlob(audioBuffer);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `synesthesia-${textura.toLowerCase()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
    setToast("Descargando...");
    setTimeout(() => setToast(""), 2000);
  };

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
    }
  };

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

  return (
    <div className="app">
      <SplineBackground />

      <div className="ui-overlay">
        {stage === "hero" && (
          <div className="hero-stage">
            <h1 className="main-title">Synesthesia</h1>
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
          <div className="experience-wrapper">
            <div className="experience-content">
              <div className="image-section">
                <div className="image-frame">
                  {isPlaying && <ParticlesCanvas colors={colors} isPlaying={isPlaying} />}
                  <img src={imageUrl} alt="Memory" />
                </div>
              </div>

              <div className="info-section">
                <div className="info-header">
                  <div className="small-cap">Resonancia</div>
                  <h2 className="mood-name">{mood}</h2>
                </div>

                <blockquote className="quote">{atmo}</blockquote>

                <div className="eq-section">
                  <div className="label-tiny">Frecuencias</div>
                  <EQTopography analyser={analyserRef.current} isPlaying={isPlaying} />
                </div>

                <div className="meta-section">
                  <div className="meta-item">
                    <div className="small-cap">Tempo</div>
                    <div className="meta-value">{bpm}</div>
                  </div>

                  <div className="meta-item">
                    <div className="small-cap">Textura</div>
                    <div className="meta-value">{textura}</div>
                  </div>
                </div>

                <div className="palette-section">
                  {colors.map((c, i) => (
                    <div key={i} className="dot" style={{ backgroundColor: c }} />
                  ))}
                </div>

                <div className="controls-section">
                  <button onClick={handlePlayPause} className="main-btn" disabled={!audioBuffer}>
                    {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                  </button>
                  <button onClick={handleDownload} className="ghost-btn" disabled={!audioBuffer}>
                    <Download size={18} />
                  </button>
                  <button onClick={handleShare} className="ghost-btn">
                    <Share2 size={18} />
                  </button>
                  <button onClick={handleReset} className="ghost-btn">
                    <RefreshCw size={18} />
                  </button>
                </div>
              </div>
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

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        html, body {
          width: 100%;
          height: 100%;
          overflow-x: hidden;
          -webkit-font-smoothing: antialiased;
          position: fixed;
        }

        .app {
          position: fixed;
          inset: 0;
          background: var(--pitch);
          color: var(--ivory);
          font-family: 'Inter', sans-serif;
          overflow: hidden;
        }

        /* SPLINE */
        .spline-viewport {
          position: fixed;
          inset: 0;
          z-index: 0;
          width: 100%;
          height: 100%;
        }

        spline-viewer {
          width: 100%;
          height: 100%;
        }

        /* UI OVERLAY */
        .ui-overlay {
          position: fixed;
          inset: 0;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }

        .ui-overlay > * {
          pointer-events: auto;
        }

        /* HERO */
        .hero-stage {
          text-align: center;
          max-width: 600px;
          width: 100%;
          padding: 2rem;
        }

        .main-title {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(3rem, 15vw, 8rem);
          font-style: italic;
          font-weight: 400;
          letter-spacing: -0.03em;
          margin-bottom: clamp(0.5rem, 2vw, 1rem);
        }

        .hero-subtitle {
          font-size: clamp(0.875rem, 2vw, 0.95rem);
          line-height: 1.6;
          opacity: 0.88;
          margin-bottom: clamp(2rem, 5vw, 3rem);
        }

        .upload-trigger {
          display: inline-flex;
          align-items: center;
          gap: 1rem;
          padding: clamp(0.875rem, 2vw, 1rem) clamp(2rem, 4vw, 2.5rem);
          border: 1px solid rgba(251,248,238,0.24);
          cursor: pointer;
          text-transform: uppercase;
          font-size: clamp(0.7rem, 1.5vw, 0.75rem);
          letter-spacing: 0.1em;
          transition: 0.35s;
          user-select: none;
        }

        .upload-trigger:hover {
          background: var(--ivory);
          color: var(--pitch);
        }

        .upload-specs {
          margin-top: 10px;
          font-size: clamp(0.65rem, 1.5vw, 0.7rem);
          letter-spacing: 0.12em;
          opacity: 0.60;
          text-transform: uppercase;
        }

        .hero-error {
          margin-top: 18px;
          font-size: 0.85rem;
          opacity: 0.86;
          color: #ff6b6b;
        }

        /* LOADING */
        .loading-stage {
          text-align: center;
        }

        .spinner {
          width: 60px;
          height: 60px;
          border: 3px solid rgba(251,248,238,0.2);
          border-top-color: var(--ivory);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 2rem;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* EXPERIENCE - CENTRADO PERFECTO */
        .experience-wrapper {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: clamp(1rem, 3vw, 2rem);
        }

        .experience-content {
          width: 100%;
          max-width: min(1200px, 100%);
          display: grid;
          grid-template-columns: 1fr 420px;
          gap: clamp(1.5rem, 4vw, 3rem);
          align-items: center;
        }

        /* IMAGE SECTION */
        .image-section {
          width: 100%;
        }

        .image-frame {
          position: relative;
          width: 100%;
          height: clamp(300px, 55vh, 600px);
          box-shadow: 0 40px 100px rgba(0,0,0,0.9);
          overflow: hidden;
          border-radius: 4px;
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

        /* INFO SECTION */
        .info-section {
          display: flex;
          flex-direction: column;
          gap: clamp(1rem, 2vw, 1.5rem);
        }

        .info-header {
          margin-bottom: 0.5rem;
        }

        .small-cap {
          font-size: clamp(0.6rem, 1.2vw, 0.65rem);
          text-transform: uppercase;
          letter-spacing: 0.25em;
          opacity: 0.62;
          margin-bottom: 0.5rem;
        }

        .mood-name {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(2rem, 6vw, 4rem);
          font-style: italic;
          line-height: 1;
        }

        .quote {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(1rem, 2.5vw, 1.3rem);
          font-style: italic;
          opacity: 0.92;
          border-left: 1px solid rgba(251,248,238,0.30);
          padding-left: clamp(12px, 2vw, 20px);
          line-height: 1.5;
        }

        /* EQ */
        .eq-section {
          margin: 0;
        }

        .label-tiny {
          display: block;
          font-size: clamp(0.55rem, 1.2vw, 0.6rem);
          text-transform: uppercase;
          letter-spacing: 0.22em;
          opacity: 0.44;
          margin-bottom: 8px;
        }

        .eq-topo {
          width: 100%;
          height: clamp(40px, 8vw, 54px);
          border-bottom: 1px solid rgba(251,248,238,0.12);
        }

        /* META */
        .meta-section {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: clamp(1rem, 3vw, 2rem);
        }

        .meta-item {
          text-align: center;
        }

        .meta-value {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(1.5rem, 4vw, 2rem);
          font-weight: 600;
          line-height: 1;
        }

        /* PALETTE */
        .palette-section {
          display: flex;
          gap: clamp(8px, 2vw, 10px);
          justify-content: center;
        }

        .dot {
          width: clamp(10px, 2.5vw, 12px);
          height: clamp(10px, 2.5vw, 12px);
          border-radius: 50%;
          border: 1px solid rgba(251,248,238,0.18);
          box-shadow: 0 0 18px rgba(251,248,238,0.10);
          transition: transform 0.3s;
          cursor: pointer;
        }

        .dot:hover {
          transform: scale(1.4);
        }

        /* CONTROLS */
        .controls-section {
          display: flex;
          align-items: center;
          gap: clamp(0.75rem, 2vw, 1.2rem);
          justify-content: center;
        }

        .main-btn {
          width: clamp(64px, 15vw, 80px);
          height: clamp(64px, 15vw, 80px);
          border-radius: 50%;
          border: 1px solid var(--ivory);
          background: transparent;
          color: var(--ivory);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: 0.35s;
        }

        .main-btn:hover {
          background: var(--ivory);
          color: var(--pitch);
          transform: translateY(-1px);
        }

        .main-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        .ghost-btn {
          width: clamp(56px, 12vw, 68px);
          height: clamp(56px, 12vw, 68px);
          border-radius: 50%;
          border: 1px solid rgba(251,248,238,0.16);
          background: rgba(5,5,5,0.18);
          color: var(--ivory);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(6px);
          transition: 0.25s;
        }

        .ghost-btn:hover {
          border-color: rgba(251,248,238,0.45);
          transform: translateY(-1px);
        }

        .ghost-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        /* TOAST */
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

        /* TABLET */
        @media (max-width: 1024px) {
          .experience-content {
            grid-template-columns: 1fr;
            gap: 2rem;
            max-width: 700px;
          }

          .image-frame {
            height: clamp(280px, 45vh, 400px);
          }
        }

        /* MOBILE */
        @media (max-width: 768px) {
          .experience-wrapper {
            padding: 1rem;
          }

          .experience-content {
            gap: 1.5rem;
          }

          .image-frame {
            height: clamp(250px, 40vh, 350px);
          }

          .mood-name {
            font-size: clamp(1.75rem, 8vw, 3rem);
          }

          .quote {
            font-size: clamp(0.95rem, 3vw, 1.1rem);
          }

          .meta-section {
            gap: 1.5rem;
          }

          .controls-section {
            flex-wrap: wrap;
            gap: 1rem;
          }
        }

        /* SMALL MOBILE */
        @media (max-width: 480px) {
          .main-title {
            font-size: clamp(2.5rem, 12vw, 4rem);
          }

          .image-frame {
            height: clamp(220px, 35vh, 300px);
          }

          .info-section {
            gap: 1rem;
          }

          .meta-section {
            grid-template-columns: 1fr;
            gap: 1rem;
          }

          .controls-section {
            width: 100%;
            justify-content: space-around;
          }

          .main-btn {
            width: 70px;
            height: 70px;
          }

          .ghost-btn {
            width: 60px;
            height: 60px;
          }
        }

        /* TOUCH DEVICES */
        @media (hover: none) and (pointer: coarse) {
          .main-btn,
          .ghost-btn {
            -webkit-tap-highlight-color: transparent;
          }

          .main-btn:active {
            transform: scale(0.95);
          }

          .dot:hover {
            transform: none;
          }
        }

        /* LANDSCAPE */
        @media (max-height: 600px) and (orientation: landscape) {
          .experience-content {
            grid-template-columns: 1fr 1fr;
          }

          .image-frame {
            height: 70vh;
          }
        }
      `}</style>
    </div>
  );
}
