import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

export async function loadFFmpeg(
  onLog?: (msg: string) => void,
  onProgress?: (ratio: number) => void
): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const instance = new FFmpeg();
    if (onLog) instance.on("log", ({ message }) => onLog(message));
    if (onProgress)
      instance.on("progress", ({ progress }) => onProgress(progress));

    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    await instance.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(
        `${baseURL}/ffmpeg-core.wasm`,
        "application/wasm"
      ),
    });
    ffmpeg = instance;
    return instance;
  })();

  return loadPromise;
}

export function isFFmpegLoaded() {
  return ffmpeg !== null;
}

export interface ClipOptions {
  start: number; // seconds
  end: number; // seconds
  width?: number; // default 720
  height?: number; // default 1280
  burnCaptions?: boolean;
  srtContent?: string;
}

export async function processClip(
  file: File,
  opts: ClipOptions,
  onLog?: (msg: string) => void,
  onProgress?: (ratio: number) => void
): Promise<Blob> {
  const ff = await loadFFmpeg(onLog, onProgress);

  const { start, end, width = 720, height = 1280, burnCaptions, srtContent } = opts;

  const inputName = "input";
  const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
  const inputFileName = `${inputName}.${ext}`;

  // Clean up previous files
  try {
    await ff.deleteFile(inputFileName);
  } catch {}
  try {
    await ff.deleteFile("output.mp4");
  } catch {}
  try {
    await ff.deleteFile("subs.srt");
  } catch {}

  // Write input
  await ff.writeFile(inputFileName, await fetchFile(file));

  // Write SRT if burning captions
  if (burnCaptions && srtContent) {
    await ff.writeFile("subs.srt", new TextEncoder().encode(srtContent));
  }

  // Build the video filter:
  // 1. Split into background (blurred) + foreground (original)
  // 2. Scale background to fill target dimensions, apply heavy blur
  // 3. Scale foreground to fit within target width, keep aspect ratio
  // 4. Overlay foreground centered on background
  let vf = `split=2[bg][fg];[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:8[bg];[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`;

  // Add subtitle burn-in if requested
  if (burnCaptions && srtContent) {
    // Escape special chars for filter path
    vf += `,subtitles=subs.srt:force_style='FontSize=24,PrimaryColour=&Hffffff,OutlineColour=&H000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=80'`;
  }

  const duration = end - start;
  const args = [
    "-ss",
    start.toString(),
    "-i",
    inputFileName,
    "-t",
    duration.toString(),
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-y",
    "output.mp4",
  ];

  await ff.exec(args);

  const data = await ff.readFile("output.mp4");
  const blob = new Blob([data as Uint8Array], { type: "video/mp4" });

  // Cleanup
  try {
    await ff.deleteFile(inputFileName);
    await ff.deleteFile("output.mp4");
    if (burnCaptions && srtContent) await ff.deleteFile("subs.srt");
  } catch {}

  return blob;
}

// Generate SRT from segments/words within a time range
export interface CaptionWord {
  start: number;
  end: number;
  word: string;
}

export function generateSRT(
  words: CaptionWord[],
  clipStart: number,
  clipEnd: number,
  wordsPerLine = 4
): string {
  const clipWords = words.filter(
    (w) => w.start >= clipStart && w.end <= clipEnd
  );

  if (clipWords.length === 0) return "";

  const srtEntries: string[] = [];
  let entryIndex = 1;
  let lineWords: CaptionWord[] = [];

  for (const word of clipWords) {
    lineWords.push(word);
    if (lineWords.length >= wordsPerLine) {
      srtEntries.push(formatSRTEntry(entryIndex, lineWords, clipStart));
      entryIndex++;
      lineWords = [];
    }
  }
  if (lineWords.length > 0) {
    srtEntries.push(formatSRTEntry(entryIndex, lineWords, clipStart));
  }

  return srtEntries.join("\n");
}

function formatSRTEntry(
  index: number,
  words: CaptionWord[],
  clipStart: number
): string {
  const start = words[0].start - clipStart;
  const end = words[words.length - 1].end - clipStart;
  const text = words.map((w) => w.word).join(" ").trim();
  return `${index}\n${formatSRTTime(start)} --> ${formatSRTTime(end)}\n${text}\n`;
}

function formatSRTTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const ms = Math.floor((s % 1) * 1000);
  const totalSec = Math.floor(s);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60) % 60;
  const hr = Math.floor(totalSec / 3600);
  return `${pad(hr, 2)}:${pad(min, 2)}:${pad(sec, 2)},${pad(ms, 3)}`;
}

function pad(n: number, len: number): string {
  return n.toString().padStart(len, "0");
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
