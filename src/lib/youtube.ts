// YouTube Innertube API helper — resolves video/audio stream URLs
// Uses IOS/ANDROID/WEB clients to bypass bot detection on data center IPs

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /[?&]v=([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

interface StreamFormat {
  itag: number;
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  contentLength?: string;
  bitrate?: number;
  audioQuality?: string;
  qualityLabel?: string;
  hasVideo?: boolean;
  hasAudio?: boolean;
}

export interface YouTubeResolveResult {
  videoUrl: string;
  audioUrl: string | null;
  title: string;
  duration: number;
  videoId: string;
}

export function isValidYouTubeUrl(url: string): boolean {
  return extractVideoId(url) !== null;
}

export async function resolveYouTube(
  url: string
): Promise<YouTubeResolveResult> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error("Could not extract video ID from URL");
  }

  const playerData = await getPlayerResponse(videoId);
  if (!playerData) {
    throw new Error(
      "YouTube blocked the request (bot detection). Try uploading the video file directly."
    );
  }

  const formats: StreamFormat[] = [
    ...(playerData.streamingData?.formats || []),
    ...(playerData.streamingData?.adaptiveFormats || []),
  ];

  if (!formats.length) {
    throw new Error("No video formats found");
  }

  // Combined video+audio
  const combined = formats.filter(
    (f) => f.hasVideo && f.hasAudio && f.url
  );

  // Audio-only (smallest for transcription)
  const audioOnly = formats
    .filter((f) => f.hasAudio && !f.hasVideo && f.url)
    .sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0)); // lowest bitrate first

  // Video-only (highest quality)
  const videoOnly = formats
    .filter((f) => f.hasVideo && !f.hasAudio && f.url)
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  let videoUrl: string | null = null;
  const combined720 = combined.find((f) => f.height === 720);
  if (combined720?.url) {
    videoUrl = combined720.url;
  } else if (combined.length > 0) {
    videoUrl = combined[0].url;
  } else if (videoOnly.length > 0) {
    const v720 = videoOnly.find((f) => f.height === 720);
    videoUrl = (v720 || videoOnly[0]).url;
  }

  const audioUrl = audioOnly[0]?.url || null;

  if (!videoUrl) {
    throw new Error("Could not find a playable video format");
  }

  return {
    videoUrl,
    audioUrl,
    title: playerData.videoDetails?.title || `youtube-${videoId}`,
    duration: parseInt(playerData.videoDetails?.lengthSeconds || "0", 10),
    videoId,
  };
}

// Get audio-only URL (for transcription)
export async function resolveYouTubeAudio(url: string): Promise<string> {
  const result = await resolveYouTube(url);
  if (!result.audioUrl) {
    throw new Error("Could not extract audio from YouTube video");
  }
  return result.audioUrl;
}

async function getPlayerResponse(videoId: string): Promise<any | null> {
  const clients = [
    {
      name: "IOS",
      body: {
        videoId,
        context: {
          client: {
            clientName: "IOS",
            clientVersion: "19.45.4",
            deviceMake: "Apple",
            deviceModel: "iPhone16,2",
            osName: "iPhone",
            osVersion: "18.1.0",
          },
        },
      },
      url: "https://www.youtube.com/youtubei/v1/player",
      ua: "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)",
    },
    {
      name: "ANDROID",
      body: {
        videoId,
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "19.45.4",
            androidSdkVersion: 34,
          },
        },
      },
      url: "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
      ua: "com.google.android.youtube/19.45.4 (Linux; U; Android 14)",
    },
    {
      name: "WEB",
      body: {
        videoId,
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20241201.00.00",
          },
        },
      },
      url: "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  ];

  for (const client of clients) {
    try {
      const res = await fetch(client.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": client.ua,
          Accept: "application/json",
        },
        body: JSON.stringify(client.body),
      });

      if (!res.ok) continue;

      const data = await res.json();

      if (data?.videoDetails?.videoId && data?.streamingData) {
        return data;
      }
    } catch {
      // try next client
    }
  }

  return null;
}
