import { NextRequest } from "next/server";
import { isPlatformUrl, resolveVideo } from "@/lib/cobalt";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return Response.json({ error: "No URL provided" }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return Response.json({ error: "Invalid URL" }, { status: 400 });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return Response.json(
        { error: "Only http/https URLs are supported" },
        { status: 400 }
      );
    }

    let fetchUrl = parsedUrl.toString();

    // If platform URL (YouTube, TikTok, etc), resolve via cobalt first
    if (isPlatformUrl(fetchUrl)) {
      try {
        fetchUrl = await resolveVideo(fetchUrl, "720");
      } catch (e: any) {
        return Response.json(
          { error: `Failed to resolve video: ${e.message}` },
          { status: 502 }
        );
      }
    }

    // Fetch the video (direct URL or cobalt stream URL)
    const res = await fetch(fetchUrl, {
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

    const headers = new Headers();
    headers.set("Content-Type", contentType || "video/mp4");
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
