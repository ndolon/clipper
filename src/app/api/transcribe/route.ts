import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { isPlatformUrl, resolveAudio } from "@/lib/cobalt";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const clientKey = req.headers.get("x-groq-key");
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

    let file: File | null = null;
    const contentType = req.headers.get("content-type") || "";

    // Check if request is JSON (has sourceUrl for platform URLs like YouTube)
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const sourceUrl = body.sourceUrl;

      if (!sourceUrl) {
        return NextResponse.json(
          { error: "No sourceUrl or file provided" },
          { status: 400 }
        );
      }

      if (!isPlatformUrl(sourceUrl)) {
        return NextResponse.json(
          { error: "sourceUrl must be a platform URL (YouTube, TikTok, etc)" },
          { status: 400 }
        );
      }

      // Resolve audio-only via cobalt (small file, bypasses 25MB limit)
      let audioUrl: string;
      try {
        audioUrl = await resolveAudio(sourceUrl, "mp3", "128");
      } catch (e: any) {
        return NextResponse.json(
          { error: `Failed to resolve audio: ${e.message}` },
          { status: 502 }
        );
      }

      // Fetch the audio
      const audioRes = await fetch(audioUrl, {
        headers: { "User-Agent": "Clipper/1.0" },
        redirect: "follow",
      });

      if (!audioRes.ok) {
        return NextResponse.json(
          { error: `Failed to fetch audio (HTTP ${audioRes.status})` },
          { status: 502 }
        );
      }

      const audioBlob = await audioRes.blob();
      file = new File([audioBlob], "audio.mp3", { type: "audio/mpeg" });

      // Check 25MB limit
      if (file.size > 25 * 1024 * 1024) {
        return NextResponse.json(
          {
            error: `Audio file too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Try a shorter video.`,
          },
          { status: 413 }
        );
      }
    } else {
      // FormData with file upload (existing behavior)
      const formData = await req.formData();
      file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json(
          { error: "No file provided" },
          { status: 400 }
        );
      }

      // Check 25MB limit
      if (file.size > 25 * 1024 * 1024) {
        return NextResponse.json(
          {
            error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Groq Whisper limit is 25MB.`,
          },
          { status: 413 }
        );
      }
    }

    // Transcribe with Groq Whisper
    const transcription = await groq.audio.transcriptions.create({
      file: file,
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
      timestamp_granularities: ["segment", "word"],
    });

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
