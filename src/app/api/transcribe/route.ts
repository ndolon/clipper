import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const clientKey = req.headers.get("x-groq-key");

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const apiKey = clientKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "No Groq API key. Set GROQ_API_KEY env var or pass via x-groq-key header.",
        },
        { status: 401 }
      );
    }

    const groq = new Groq({ apiKey });

    // Validate file type
    const allowedTypes = [
      "audio/",
      "video/",
      "mpeg",
      "mp4",
      "webm",
      "wav",
      "mp3",
      "m4a",
      "ogg",
      "flac",
    ];
    const isAllowed =
      allowedTypes.some((t) => file.type.startsWith(t) || file.type.includes(t)) ||
      file.type === "";

    if (!isAllowed) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}` },
        { status: 400 }
      );
    }

    // Groq has a 25MB file size limit for Whisper
    const MAX_BYTES = 25 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Groq Whisper limit is 25MB. Try a shorter clip or compress the audio.`,
        },
        { status: 413 }
      );
    }

    const transcription = await groq.audio.transcriptions.create({
      file: file,
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
      timestamp_granularities: ["segment", "word"],
      language: "id", // auto-detect still works if omitted, but hint helps Indonesian content
    });

    // Normalize the response into our own shape
    const segments =
      (transcription as any).segments?.map((s: any) => ({
        id: s.id,
        start: s.start,
        end: s.end,
        text: s.text.trim(),
      })) ?? [];

    const words =
      (transcription as any).words?.map((w: any) => ({
        start: w.start,
        end: w.end,
        word: w.word,
      })) ?? [];

    return NextResponse.json({
      text: transcription.text,
      segments,
      words,
      language: (transcription as any).language,
      duration: (transcription as any).duration,
    });
  } catch (err: any) {
    console.error("[transcribe] error:", err);
    const status = err?.status || 500;
    const message =
      err?.error?.error?.message ||
      err?.message ||
      "Transcription failed";
    return NextResponse.json({ error: message }, { status });
  }
}
