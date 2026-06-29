import { NextRequest, NextResponse } from "next/server";
import ytdl from "@distube/ytdl-core";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "No URL provided" }, { status: 400 });
    }

    // Validate YouTube URL
    if (!ytdl.validateURL(url)) {
      return NextResponse.json(
        { error: "Invalid YouTube URL" },
        { status: 400 }
      );
    }

    // Get video info
    const info = await ytdl.getInfo(url);

    // Pick best video+audio format (720p max for reasonable size)
    const formats = info.formats;
    const videoFormat = ytdl.chooseFormat(formats, {
      quality: "highest",
      filter: "videoandaudio",
    });

    // Pick audio-only format for transcription
    const audioFormat = ytdl.chooseFormat(formats, {
      quality: "lowestaudio", // small file for Groq
      filter: "audioonly",
    });

    if (!videoFormat?.url) {
      return NextResponse.json(
        { error: "Could not find a suitable video format" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      videoUrl: videoFormat.url,
      audioUrl: audioFormat?.url || null,
      title: info.videoDetails.title,
      duration: parseInt(info.videoDetails.lengthSeconds, 10),
      thumbnail: info.videoDetails.thumbnails?.[0]?.url || null,
    });
  } catch (err: any) {
    console.error("[resolve-youtube] error:", err.message);
    return NextResponse.json(
      { error: err.message || "Failed to resolve YouTube URL" },
      { status: 500 }
    );
  }
}
