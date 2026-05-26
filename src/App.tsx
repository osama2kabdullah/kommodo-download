import React, { useState } from "react";
import { 
  Download, 
  Link as LinkIcon, 
  Loader2, 
  CheckCircle, 
  AlertCircle, 
  RefreshCw, 
  FileVideo, 
  HelpCircle,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Layers,
  Settings,
  HelpCircle as HelpIcon
} from "lucide-react";

interface AnalysisResult {
  success: boolean;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string;
  format?: string;
  explanation?: string;
}

export default function App() {
  const [url, setUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);

  // Download state tracker
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [downloadCompleted, setDownloadCompleted] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setIsAnalyzing(true);
    setError("");
    setResult(null);
    setDownloadCompleted(false);
    setDownloadProgress(0);
    setDownloadError("");
    setDownloadedBytes(0);
    setTotalBytes(0);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to analyze link. Please check your internet connection.");
      }

      if (data.success) {
        setResult(data);
      } else {
        throw new Error(
          data.explanation || 
          "We crawled the page but could not extract a direct video file. Ensure the video is public and try another link."
        );
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred while communicating with the analysis server.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Chunk-by-chunk progressive client downloader
  const startProgressiveDownload = async () => {
    if (!result) return;
    
    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadedBytes(0);
    setTotalBytes(0);
    setDownloadCompleted(false);
    setDownloadError("");

    const videoUrl = result.videoUrl;
    let format = result.format || "mp4";
    if (format.toLowerCase().includes("m3u8") || format.toLowerCase().includes("ts")) {
      format = "mp4";
    }
    const cleanTitle = result.title.replace(/[^a-z0-9_-]/gi, "_") || "downloaded_video";
    const filename = `${cleanTitle}.${format}`;

    try {
      const queryUrl = `/api/download-proxy?url=${encodeURIComponent(videoUrl)}&filename=${encodeURIComponent(filename)}`;
      const response = await fetch(queryUrl);

      if (!response.ok) {
        throw new Error(`Asset transmission failed (HTTP Status ${response.status}: ${response.statusText})`);
      }

      const contentLength = response.headers.get("content-length");
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      setTotalBytes(total);

      if (!response.body) {
        throw new Error("Target stream body is unreadable.");
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedBytes += value.length;
        setDownloadedBytes(receivedBytes);

        if (total > 0) {
          const percent = Math.min(Math.round((receivedBytes / total) * 100), 99);
          setDownloadProgress(percent);
        } else {
          // Fallback if content-length is missing (e.g. streaming HLS segments)
          setDownloadProgress(-1);
        }
      }

      const contentType = response.headers.get("content-type") || "video/mp4";
      const blob = new Blob(chunks, { type: contentType });
      const localUrl = URL.createObjectURL(blob);

      // Trigger automatic disk persistence
      const anchor = document.createElement("a");
      anchor.href = localUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();

      // Teardown resource to free memory
      document.body.removeChild(anchor);
      URL.revokeObjectURL(localUrl);

      setDownloadProgress(100);
      setDownloadCompleted(true);
    } catch (err: any) {
      console.error(err);
      setDownloadError(err.message || "Progressive proxy download interrupted.");
    } finally {
      setIsDownloading(false);
    }
  };

  // Browser-native backup stream downloader for extremely large files
  const triggerNativeDownload = () => {
    if (!result) return;
    const videoUrl = result.videoUrl;
    let format = result.format || "mp4";
    if (format.toLowerCase().includes("m3u8") || format.toLowerCase().includes("ts")) {
      format = "mp4";
    }
    const cleanTitle = result.title.replace(/[^a-z0-9_-]/gi, "_") || "downloaded_video";
    const filename = `${cleanTitle}.${format}`;
    
    const queryUrl = `/api/download-proxy?url=${encodeURIComponent(videoUrl)}&filename=${encodeURIComponent(filename)}`;
    window.location.href = queryUrl;
  };

  const handleReset = () => {
    setUrl("");
    setResult(null);
    setError("");
    setDownloadCompleted(false);
    setDownloadProgress(0);
    setDownloadError("");
    setDownloadedBytes(0);
    setTotalBytes(0);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes <= 0) return "0.00 B";
    const k = 1024;
    const sizes = ["B", "MB", "GB"];
    if (bytes > 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-800 font-sans">
      
      {/* Navigation Bar matching Design HTML */}
      <nav className="flex items-center justify-between px-6 sm:px-12 py-5 border-b border-slate-100 bg-white" id="nav-bar">
        <div className="flex items-center gap-3">
          {/* Dinosaur Logo Mascot */}
          <svg className="w-9 h-9" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="kommodoGrad" x1="0" y1="0" x2="100" y2="100">
                <stop offset="0%" stopColor="#0fbba2" />
                <stop offset="100%" stopColor="#22c55e" />
              </linearGradient>
            </defs>
            <path d="M85 50C85 69.33 69.33 85 50 85C36.27 85 24.36 77.12 18.55 65.65C13.25 55.19 14.82 41.52 22.34 32.55C24.18 30.36 26.65 29.13 29.5 29.28C34.33 29.54 38.65 31.85 42.5 34.5C47.33 37.83 52.83 38.5 58.5 38.5C70.5 38.5 80.5 38 84.5 45C84.83 45.58 85 47.77 85 50Z" fill="url(#kommodoGrad)" />
            <path d="M52 28C55.3137 28 58 30.6863 58 34C58 37.3137 55.3137 40 52 40C48.6863 40 46 37.3137 46 34C46 30.6863 48.6863 28 52 28Z" fill="white" />
            <path d="M48 52C55 52 64 51 70 48" stroke="white" strokeWidth="4" strokeLinecap="round" />
          </svg>
          <span className="text-lg font-bold tracking-tight text-slate-900 uppercase">Kommodo Video Downloader</span>
        </div>
      </nav>

      {/* Main Container Wrapper */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-12 py-10 w-full max-w-4xl mx-auto gap-8" id="main-content">
        
        {/* Header / Hero Section */}
        <header className="w-full text-center space-y-4" id="header">
          <div className="space-y-2">
            <h1 className="text-4xl sm:text-5xl font-extrabold uppercase text-slate-900 tracking-tight">
              Kommodo Video Downloader
            </h1>
          </div>
        </header>

        {/* Action Form Deck */}
        <section className="w-full max-w-3xl" id="action-wrapper">
          
          {!result ? (
            /* Input Bar State and Form */
            <form onSubmit={handleAnalyze} className="w-full">
              <div className="flex flex-col sm:flex-row border-2 border-slate-900 p-1 bg-white shadow-md">
                <div className="flex-1 flex items-center min-w-0">
                  <div className="pl-3.5 text-slate-400">
                    <LinkIcon className="w-4 h-4 shrink-0" />
                  </div>
                  <input
                    id="video-url-input"
                    type="url"
                    required
                    disabled={isAnalyzing}
                    placeholder="Paste video stream page URL here..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="flex-1 px-4 py-3.5 text-slate-800 outline-none placeholder:text-slate-350 font-sans text-sm tracking-wide bg-transparent focus:ring-0"
                  />
                </div>
                <button
                  id="submit-analysis"
                  type="submit"
                  disabled={isAnalyzing}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-bold uppercase tracking-widest text-[11px] px-8 py-4 sm:py-3.5 rounded-none transition-colors duration-150 shrink-0 min-w-[150px] inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Fetching...</span>
                    </>
                  ) : (
                    <>
                      <span>Fetch Video</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            /* Result State (Static Preview of found video matching the Geometric theme) */
            <div className="border border-slate-200 bg-slate-50 p-6 flex flex-col gap-6 text-left" id="results-deck">
              
              {/* Back button Toolbar */}
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <div className="flex gap-2 items-center">
                  <div className="w-2 h-2 bg-blue-600 animate-pulse"></div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Isolated Content Asset</span>
                </div>
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-slate-600 hover:text-slate-900 text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 cursor-pointer bg-white hover:bg-slate-100 p-1.5 px-3 border border-slate-200 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Fetch New URL</span>
                </button>
              </div>

              {/* Title representation block */}
              <div className="flex flex-col md:flex-row gap-6 items-start">
                
                {/* Fixed geometry thumbnail */}
                <div className="w-full md:w-52 aspect-video bg-slate-200 flex items-center justify-center relative shrink-0 border border-slate-300">
                  {result.thumbnailUrl ? (
                    <img 
                      src={result.thumbnailUrl} 
                      alt="Thumbnail representation"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?q=80&w=200&auto=format&fit=crop";
                      }}
                    />
                  ) : (
                    <FileVideo className="w-8 h-8 text-slate-400" />
                  )}
                  <span className="absolute bottom-1 right-1 bg-slate-900 text-white text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 font-mono">
                    {result.format || "mp4"}
                  </span>
                </div>

                <div className="flex-1 flex flex-col justify-between align-middle py-1">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 leading-snug">
                      {result.title || "Identified Live Stream Asset"}
                    </h3>
                    <p className="text-xs font-mono text-slate-400 mt-1.5 truncate max-w-sm sm:max-w-md" title={result.videoUrl}>
                      {result.videoUrl}
                    </p>
                  </div>

                  {result.explanation && (
                    <div className="mt-4 bg-slate-100 p-3 border-l-2 border-slate-900 text-[11px] text-slate-600 leading-relaxed font-sans">
                      <strong className="text-slate-800 uppercase text-[9px] tracking-widest block mb-0.5">Methodology:</strong> 
                      {result.explanation}
                    </div>
                  )}
                </div>
              </div>

              {/* REAL-TIME PREVIEW WINDOW */}
              {result.videoUrl && (
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] font-bold text-slate-700 uppercase tracking-widest">
                    Inline Stream Playback
                  </span>
                  <div className="border border-slate-300 bg-slate-950 overflow-hidden aspect-video relative flex items-center justify-center">
                    <video 
                      src={result.videoUrl} 
                      controls 
                      preload="metadata"
                      className="w-full h-full max-h-[300px]"
                      poster={result.thumbnailUrl}
                    >
                      Your browser does not support inline playback previews.
                    </video>
                  </div>
                </div>
              )}

              {/* Progress Panel & Download button arrangements */}
              <div className="border-t border-slate-200 pt-5 flex flex-col gap-4">
                
                {/* 1. Normal state download links */}
                {!isDownloading && !downloadCompleted && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" id="downloads-actions">
                    <button
                      onClick={startProgressiveDownload}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold uppercase tracking-wider text-[11px] px-6 py-3.5 text-center transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Start Progressive Download</span>
                    </button>
                    
                    <button
                      onClick={triggerNativeDownload}
                      className="border border-slate-300 text-slate-600 bg-white hover:bg-slate-50 font-bold uppercase tracking-wider text-[11px] px-6 py-3.5 text-center transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Native Browser Download</span>
                    </button>
                  </div>
                )}

                {/* 2. Assembling video chunks (Active State) */}
                {isDownloading && (
                  <div className="bg-white border border-slate-200 p-5 flex flex-col gap-3">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-slate-700 uppercase tracking-wider inline-flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
                        <span>Extracting & Reconstructing Stream Channels</span>
                      </span>
                      {downloadProgress >= 0 && (
                        <span className="font-mono text-emerald-600 font-bold">
                          {downloadProgress}%
                        </span>
                      )}
                    </div>

                    {/* Linear high-contrast progress bar */}
                    {downloadProgress >= 0 ? (
                      <div className="w-full bg-slate-100 h-2 border border-slate-200">
                        <div 
                          className="bg-emerald-500 h-full transition-all duration-150" 
                          style={{ width: `${downloadProgress}%` }}
                        ></div>
                      </div>
                    ) : (
                      <div className="w-full bg-slate-100 h-2 border border-slate-200 relative overflow-hidden">
                        <div className="bg-emerald-500 h-full w-1/3 absolute animate-infinite-slide"></div>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                      <span>Downloaded: {formatBytes(downloadedBytes)}</span>
                    </div>
                  </div>
                )}

                {/* 3. Download Finished State */}
                {downloadCompleted && (
                  <div className="bg-green-50 border border-green-200 p-5 flex gap-4 text-green-900">
                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-extrabold text-[12px] uppercase tracking-widest text-green-950">Assembled Successfully!</h4>
                      <p className="text-xs text-green-700 mt-1">
                        We loaded all data streams and pushed to your storage as "{result.title.replace(/[^a-z0-9_-]/gi, "_")}.{result.format || "mp4"}".
                      </p>
                      <button
                        onClick={handleReset}
                        className="mt-4 text-[10px] font-bold uppercase tracking-widest bg-green-600 hover:bg-green-700 text-white px-4 py-2 transition-colors cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Grab Another Video</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Stream Fail recovery banner */}
                {downloadError && (
                  <div className="bg-amber-50 border border-amber-200 p-5 flex gap-4 text-amber-900">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-[12px] uppercase tracking-widest text-amber-950">Network interrupted during streaming</h4>
                      <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                        {downloadError}
                      </p>
                      <div className="mt-4 flex gap-2 flex-wrap">
                        <button
                          onClick={startProgressiveDownload}
                          className="text-[10px] font-bold uppercase tracking-widest bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 transition-colors cursor-pointer"
                        >
                          Retry Assembler
                        </button>
                        <button
                          onClick={triggerNativeDownload}
                          className="text-[10px] font-bold uppercase tracking-widest bg-white hover:bg-slate-100 text-slate-800 px-4 py-2 transition-colors cursor-pointer border border-slate-350"
                        >
                          Try Single-Stream Native Path
                        </button>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}

        </section>

        {/* Global Error Banner (Geometric look) */}
        {error && (
          <section className="w-full max-w-3xl bg-rose-50 border border-rose-200 p-5 flex gap-4 text-rose-900" id="error-banner">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-bold text-[12px] uppercase tracking-widest text-rose-950">Analyse Error</h4>
              <p className="text-xs text-rose-700 mt-1.5 leading-relaxed">
                {error}
              </p>
              <div className="text-[11px] text-slate-600 bg-white/70 p-3 mt-3 border-l-2 border-slate-900 leading-normal">
                <strong>Hint:</strong> Try inspecting the source files of the page, isolating any link ending with <code>.mp4</code> or <code>.m3u8</code>, or check your video stream availability keys.
              </div>
            </div>
          </section>
        )}



      </main>

      {/* Footer Status Bar with Developer Credentials */}
      <footer className="w-full flex flex-col sm:flex-row items-center justify-between px-6 sm:px-12 py-5 bg-slate-900 text-slate-400 text-[11px] uppercase tracking-widest font-bold mt-auto" id="applet-footer">
        <div className="flex gap-6 mb-3 sm:mb-0 items-center">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> 
            <span>Kommodo Engine Active</span>
          </span>
        </div>
        <div className="tracking-widest">
          Developed by{" "}
          <a 
            href="https://www.linkedin.com/in/md-abdullah-9121b5228" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-white hover:text-emerald-400 transition-colors underline decoration-2 underline-offset-4"
          >
            Md Abdullah
          </a>
        </div>
      </footer>

    </div>
  );
}
