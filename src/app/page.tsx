"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type {
  TranscriptionResult,
  SuggestedClip,
  ProcessedClip,
  TranscriptSegment,
} from "@/lib/types";
import {
  processClip,
  generateSRT,
  formatTime,
  loadFFmpeg,
} from "@/lib/ffmpeg";

export default function Home() {
  // --- State ---
  const [apiKey, setApiKey] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [inputMode, setInputMode] = useState<"upload" | "url">("upload");
  const [urlInput, setUrlInput] = useState("");
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string>("");
  const [transcription, setTranscription] = useState<TranscriptionResult | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState("");

  const [selectedStart, setSelectedStart] = useState(0);
  const [selectedEnd, setSelectedEnd] = useState(0);
  const [suggestions, setSuggestions] = useState<SuggestedClip[]>([]);
  const [suggesting, setSuggesting] = useState(false);

  const [burnCaptions, setBurnCaptions] = useState(true);
  const [resolution, setResolution] = useState<"540" | "720" | "1080">("720");

  const [processing, setProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  const [processLog, setProcessLog] = useState("");
  const [result, setResult] = useState<ProcessedClip | null>(null);

  const [ffmpegReady, setFFmpegReady] = useState(false);
  const [loadingFFmpeg, setLoadingFFmpeg] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // --- Load API key from localStorage ---
  useEffect(() => {
    const saved = localStorage.getItem("groq_api_key");
    if (saved) setApiKey(saved);
    else setShowKeyInput(true);
  }, []);

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem("groq_api_key", key);
    setShowKeyInput(false);
  };

  // --- Preload ffmpeg.wasm ---
  const ensureFFmpeg = useCallback(async () => {
    if (ffmpegReady) return;
    setLoadingFFmpeg(true);
    try {
      await loadFFmpeg(
        (msg) => setProcessLog((p) => p + msg + "\n"),
        () => {}
      );
      setFFmpegReady(true);
    } catch (e: any) {
      setError("Failed to load ffmpeg: " + e.message);
    } finally {
      setLoadingFFmpeg(false);
    }
  }, [ffmpegReady]);

  // --- File handling ---
  const handleFileSelect = (f: File, srcUrl?: string) => {
    setError("");
    setResult(null);
    setTranscription(null);
    setSuggestions([]);
    setFile(f);
    setSourceUrl(srcUrl || "");
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(f));
    // Default selection to first 30s
    setSelectedStart(0);
    setSelectedEnd(30);
    // Preload ffmpeg in background
    ensureFFmpeg();
  };

  // --- Fetch video from URL ---
  const fetchFromUrl = async () => {
    if (!urlInput.trim()) return;
    setFetchingUrl(true);
    setError("");
    try {
      const res = await fetch("/api/fetch-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Fetch failed" }));
        throw new Error(data.error || `Failed to fetch video (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      const contentType = blob.type || "video/mp4";
      const ext = contentType.includes("audio") ? "mp3" : "mp4";
      const fetchedFile = new File([blob], `url-video.${ext}`, { type: contentType });

      handleFileSelect(fetchedFile, urlInput.trim());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFetchingUrl(false);
    }
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (f && (f.type.startsWith("video/") || f.type.startsWith("audio/"))) {
        handleFileSelect(f);
      } else {
        setError("Please drop a video or audio file");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [videoUrl]
  );

  // --- Transcription ---
  const transcribe = async () => {
    if (!file && !sourceUrl) return;
    if (!apiKey) {
      setShowKeyInput(true);
      return;
    }
    setTranscribing(true);
    setError("");
    setTranscription(null);
    setSuggestions([]);

    try {
      let res: Response;

      if (sourceUrl) {
        // Platform URL (YouTube, etc) — send sourceUrl as JSON
        // Server resolves audio-only via cobalt (small file, bypasses 25MB limit)
        res = await fetch("/api/transcribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-groq-key": apiKey,
          },
          body: JSON.stringify({ sourceUrl }),
        });
      } else {
        // Direct file upload
        const formData = new FormData();
        formData.append("file", file!);
        res = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "x-groq-key": apiKey },
          body: formData,
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transcription failed");

      setTranscription(data);
      if (data.segments?.length > 0) {
        const first = data.segments[0];
        setSelectedStart(first.start);
        const endCandidate = first.start + 30;
        const seg = data.segments.find(
          (s: TranscriptSegment) => s.end >= endCandidate
        );
        setSelectedEnd(
          seg
            ? Math.min(seg.end, first.start + 60)
            : Math.min(data.duration || 60, first.start + 30)
        );
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTranscribing(false);
    }
  };

  // --- Auto-suggest ---
  const suggestClips = async () => {
    if (!transcription) return;
    setSuggesting(true);
    setError("");
    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-groq-key": apiKey,
        },
        body: JSON.stringify({
          segments: transcription.segments,
          count: 5,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Suggestion failed");
      setSuggestions(data.clips || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSuggesting(false);
    }
  };

  // --- Process clip ---
  const handleProcess = async () => {
    if (!file) return;
    await ensureFFmpeg();

    setProcessing(true);
    setProcessProgress(0);
    setProcessLog("");
    setError("");
    setResult(null);

    try {
      const dims =
        resolution === "540"
          ? { width: 540, height: 960 }
          : resolution === "720"
          ? { width: 720, height: 1280 }
          : { width: 1080, height: 1920 };

      const srtContent =
        burnCaptions && transcription?.words
          ? generateSRT(transcription.words, selectedStart, selectedEnd)
          : undefined;

      const blob = await processClip(
        file,
        {
          start: selectedStart,
          end: selectedEnd,
          width: dims.width,
          height: dims.height,
          burnCaptions: burnCaptions && !!srtContent,
          srtContent: srtContent || undefined,
        },
        (msg) => setProcessLog((p) => p + msg + "\n"),
        (ratio) => setProcessProgress(Math.round(ratio * 100))
      );

      const url = URL.createObjectURL(blob);
      setResult({
        url,
        blob,
        start: selectedStart,
        end: selectedEnd,
        duration: selectedEnd - selectedStart,
      });
    } catch (e: any) {
      setError("Processing failed: " + e.message);
      setProcessLog((p) => p + "\nERROR: " + e.message + "\n");
    } finally {
      setProcessing(false);
    }
  };

  const seekTo = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play();
    }
  };

  const applySuggestion = (clip: SuggestedClip) => {
    setSelectedStart(clip.start);
    setSelectedEnd(clip.end);
    seekTo(clip.start);
  };

  const clipDuration = selectedEnd - selectedStart;

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">✂️</span>
            <h1 className="text-xl font-bold">Clipper</h1>
            <span className="text-xs text-slate-500 ml-2 hidden sm:inline">
              Vercel + Groq + ffmpeg.wasm
            </span>
          </div>
          <div className="flex items-center gap-2">
            {ffmpegReady && (
              <span className="text-xs px-2 py-1 bg-green-900/40 text-green-400 rounded">
                ffmpeg ready
              </span>
            )}
            <button
              onClick={() => setShowKeyInput(!showKeyInput)}
              className={`text-xs px-3 py-1.5 rounded transition ${
                apiKey
                  ? "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  : "bg-amber-900/40 text-amber-400 hover:bg-amber-900/60"
              }`}
            >
              {apiKey ? "🔑 Key set" : "⚠️ Set API key"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* API Key Modal */}
        {showKeyInput && (
          <div className="mb-6 p-4 bg-slate-900 border border-slate-800 rounded-lg">
            <label className="block text-sm font-medium mb-2">
              Groq API Key
              <span className="text-slate-500 font-normal ml-2">
                (get free at console.groq.com → API Keys)
              </span>
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveApiKey(apiKey)}
                placeholder="gsk_..."
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={() => saveApiKey(apiKey)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium"
              >
                Save
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Stored locally in your browser. Never sent anywhere except Groq API.
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-6 p-3 bg-red-950/50 border border-red-900 rounded-lg text-red-300 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* Input Area */}
        {!file && (
          <div>
            {/* Tab toggle */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setInputMode("upload")}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition ${
                  inputMode === "upload"
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
              >
                📁 Upload File
              </button>
              <button
                onClick={() => setInputMode("url")}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition ${
                  inputMode === "url"
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
              >
                🔗 Paste URL
              </button>
            </div>

            {/* Upload mode */}
            {inputMode === "upload" && (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 rounded-2xl p-16 text-center cursor-pointer hover:border-indigo-600 hover:bg-slate-900/30 transition"
              >
                <div className="text-5xl mb-4">🎬</div>
                <p className="text-lg font-medium mb-1">Drop video or audio here</p>
                <p className="text-sm text-slate-500">
                  or click to browse — MP4, WebM, MP3, WAV, M4A
                </p>
                <p className="text-xs text-slate-600 mt-3">
                  Max 25MB (Groq Whisper limit)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*,audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f);
                  }}
                />
              </div>
            )}

            {/* URL mode */}
            {inputMode === "url" && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <label className="block text-sm font-medium mb-2">
                  Video URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !fetchingUrl && fetchFromUrl()}
                    placeholder="https://example.com/video.mp4"
                    className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
                    disabled={fetchingUrl}
                  />
                  <button
                    onClick={fetchFromUrl}
                    disabled={fetchingUrl || !urlInput.trim()}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 rounded text-sm font-medium transition"
                  >
                    {fetchingUrl ? "⏳ Fetching..." : "Fetch"}
                  </button>
                </div>
                <div className="mt-3 space-y-1">
                  <p className="text-xs text-slate-500">
                    ✅ YouTube, TikTok, Instagram, X, Facebook, Vimeo, dll
                  </p>
                  <p className="text-xs text-slate-500">
                    ✅ Direct video/audio URLs (.mp4, .webm, .mp3, .wav)
                  </p>
                  <p className="text-xs text-slate-500">
                    ✅ Google Drive / Dropbox direct download links
                  </p>
                  <p className="text-xs text-slate-600 mt-2">
                    Video di-fetch via cobalt API + server proxy. Transcribe pakai
                    audio-only (lolos 25MB limit). Clip processing pakai video asli.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main workspace */}
        {file && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Video + Transcript */}
            <div className="space-y-4">
              {/* Video player */}
              <div className="bg-black rounded-lg overflow-hidden">
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  className="w-full max-h-[400px]"
                />
              </div>

              {/* Transcribe button */}
              {!transcription && (
                <button
                  onClick={transcribe}
                  disabled={transcribing || !apiKey}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 rounded-lg font-medium transition"
                >
                  {transcribing
                    ? "🎙️ Transcribing... (Groq Whisper)"
                    : "🎙️ Transcribe with Groq"}
                </button>
              )}

              {/* Transcript */}
              {transcription && (
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 max-h-[400px] overflow-y-auto">
                  <div className="flex items-center justify-between mb-2 sticky top-0 bg-slate-900 py-1">
                    <h3 className="text-sm font-semibold">
                      Transcript ({transcription.segments.length} segments)
                    </h3>
                    <span className="text-xs text-slate-500">
                      {transcription.language?.toUpperCase()} ·{" "}
                      {formatTime(transcription.duration || 0)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {transcription.segments.map((seg) => {
                      const inRange =
                        seg.start >= selectedStart && seg.end <= selectedEnd;
                      return (
                        <div
                          key={seg.id}
                          onClick={() => seekTo(seg.start)}
                          className={`text-sm p-2 rounded cursor-pointer transition ${
                            inRange
                              ? "bg-indigo-950/60 border-l-2 border-indigo-500"
                              : "hover:bg-slate-800"
                          }`}
                        >
                          <span className="text-xs text-slate-500 mr-2 font-mono">
                            {formatTime(seg.start)}
                          </span>
                          {seg.text}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {transcription && (
                <div>
                  <button
                    onClick={suggestClips}
                    disabled={suggesting}
                    className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg text-sm font-medium transition"
                  >
                    {suggesting
                      ? "🤖 AI analyzing transcript..."
                      : "✨ Auto-suggest viral clips (Groq LLM)"}
                  </button>
                  {suggestions.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {suggestions.map((clip, i) => (
                        <div
                          key={i}
                          onClick={() => applySuggestion(clip)}
                          className="p-3 bg-slate-900 border border-slate-800 rounded-lg cursor-pointer hover:border-indigo-600 transition"
                        >
                          <div className="flex justify-between items-start mb-1">
                            <span className="text-xs font-mono text-indigo-400">
                              {formatTime(clip.start)} → {formatTime(clip.end)} ·{" "}
                              {Math.round(clip.end - clip.start)}s
                            </span>
                            <span className="text-xs text-slate-600">
                              #{i + 1}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-white">
                            {clip.hook}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            {clip.reason}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right: Clip Config + Output */}
            <div className="space-y-4">
              {/* Clip config */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
                <h3 className="text-sm font-semibold">Clip Settings</h3>

                {/* Start / End */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">
                      Start (sec)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={selectedStart.toFixed(1)}
                      onChange={(e) =>
                        setSelectedStart(parseFloat(e.target.value) || 0)
                      }
                      className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">
                      End (sec)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={selectedEnd.toFixed(1)}
                      onChange={(e) =>
                        setSelectedEnd(parseFloat(e.target.value) || 0)
                      }
                      className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Duration display */}
                <div className="text-center text-sm">
                  Duration:{" "}
                  <span
                    className={`font-mono ${
                      clipDuration > 60
                        ? "text-red-400"
                        : clipDuration < 5
                        ? "text-amber-400"
                        : "text-green-400"
                    }`}
                  >
                    {clipDuration.toFixed(1)}s
                  </span>
                  {clipDuration > 60 && (
                    <span className="text-xs text-red-500 ml-1">
                      (over 60s — may be too long)
                    </span>
                  )}
                </div>

                {/* Resolution */}
                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    Resolution (9:16)
                  </label>
                  <div className="flex gap-2">
                    {(["540", "720", "1080"] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setResolution(r)}
                        className={`flex-1 py-1.5 text-sm rounded transition ${
                          resolution === r
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                        }`}
                      >
                        {r}p
                      </button>
                    ))}
                  </div>
                </div>

                {/* Captions */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={burnCaptions}
                    onChange={(e) => setBurnCaptions(e.target.checked)}
                    className="w-4 h-4 accent-indigo-600"
                  />
                  <span className="text-sm">
                    Burn captions (from word timestamps)
                  </span>
                </label>

                {/* Process button */}
                <button
                  onClick={handleProcess}
                  disabled={processing || loadingFFmpeg}
                  className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:bg-slate-800 disabled:text-slate-500 rounded-lg font-medium transition"
                >
                  {processing
                    ? `⏳ Processing... ${processProgress}%`
                    : loadingFFmpeg
                    ? "⏳ Loading ffmpeg..."
                    : "🎬 Generate Clip"}
                </button>

                {/* Progress bar */}
                {processing && (
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-indigo-600 h-full transition-all"
                      style={{ width: `${processProgress}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Process log */}
              {(processing || processLog) && (
                <details className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                  <summary className="text-xs text-slate-500 cursor-pointer">
                    ffmpeg log
                  </summary>
                  <pre className="text-xs text-slate-600 mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap">
                    {processLog.slice(-2000)}
                  </pre>
                </details>
              )}

              {/* Result */}
              {result && (
                <div className="bg-slate-900 border border-green-800 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-green-400">
                    ✅ Clip Ready
                  </h3>
                  <video
                    src={result.url}
                    controls
                    className="w-full rounded max-h-[400px]"
                  />
                  <div className="flex gap-2">
                    <a
                      href={result.url}
                      download={`clip_${result.start.toFixed(0)}-${result.end.toFixed(0)}.mp4`}
                      className="flex-1 py-2.5 bg-green-600 hover:bg-green-500 rounded text-sm font-medium text-center transition"
                    >
                      ⬇️ Download MP4
                    </a>
                    <button
                      onClick={() => {
                        setResult(null);
                        setProcessLog("");
                      }}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 rounded text-sm transition"
                    >
                      New clip
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    {(result.blob.size / 1024 / 1024).toFixed(1)} MB ·{" "}
                    {result.duration.toFixed(1)}s · {resolution}p 9:16
                  </p>
                </div>
              )}

              {/* Reset */}
              <button
                onClick={() => {
                  if (videoUrl) URL.revokeObjectURL(videoUrl);
                  setFile(null);
                  setVideoUrl("");
                  setUrlInput("");
                  setSourceUrl("");
                  setInputMode("upload");
                  setTranscription(null);
                  setSuggestions([]);
                  setResult(null);
                  setError("");
                  setProcessLog("");
                }}
                className="w-full py-2 text-sm text-slate-500 hover:text-slate-300 transition"
              >
                ← Start over
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="text-center text-xs text-slate-600 py-6">
        Clipper · Vercel + Groq Whisper + ffmpeg.wasm · runs entirely in your browser
      </footer>
    </div>
  );
}
