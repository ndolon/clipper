import { NextRequest } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return Response.json({ error: "No URL provided" }, { status: 400 });
    }

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return Response.json({ error: "Invalid URL" }, { status: 400 });
    }

    // Only allow http/https
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return Response.json(
        { error: "Only http/https URLs are supported" },
        { status: 400 }
      );
    }

    // Fetch the video server-side (bypass CORS)
    const res = await fetch(parsedUrl.toString(), {
      headers: { "User-Agent": "Clipper/1.0" },
      redirect: "follow",
    });

    if (!res.ok) {
      return Response.json(
        { error: `Failed to fetch video (HTTP ${res.status})` },
        { status: 502 }
      );
    }

    const contentType = res.headers.get("content-type") || "";
    const contentLength = parseInt(
      res.headers.get("content-length") || "0",
      10
    );

    // Validate content type — be lenient, some servers don't set proper MIME
    const isVideo =
      contentType.startsWith("video/") ||
      contentType.startsWith("audio/") ||
      contentType.includes("octet-stream") ||
      contentType === "";
    if (!isVideo) {
      return Response.json(
        {
          error: `URL must point to a video/audio file (got: ${contentType || "unknown"})`,
        },
        { status: 400 }
      );
    }

    // Check size (25MB Groq limit)
    if (contentLength > 25 * 1024 * 1024) {
      return Response.json(
        {
          error: `File too large (${(contentLength / 1024 / 1024).toFixed(1)}MB). Max 25MB for Groq Whisper.`,
        },
        { status: 413 }
      );
    }

    // Stream the response back
    const headers = new Headers();
    headers.set("Content-Type", contentType || "application/octet-stream");
    if (contentLength) {
      headers.set("Content-Length", contentLength.toString());
    }
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(res.body, { headers });
  } catch (err: any) {
    return Response.json(
      { error: err.message || "Failed to fetch video" },
      { status: 500 }
    );
  }
}
