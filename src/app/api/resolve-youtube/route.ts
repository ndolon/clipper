import { NextRequest, NextResponse } from "next/server";
import { resolveYouTube, isValidYouTubeUrl } from "@/lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "No URL provided" }, { status: 400 });
    }

    if (!isValidYouTubeUrl(url)) {
      return NextResponse.json(
        { error: "Invalid YouTube URL" },
        { status: 400 }
      );
    }

    const result = await resolveYouTube(url);

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[resolve-youtube] error:", err.message);
    return NextResponse.json(
      { error: err.message || "Failed to resolve YouTube URL" },
      { status: 500 }
    );
  }
}
