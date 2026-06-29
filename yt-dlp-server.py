#!/usr/bin/env python3
"""
Local yt-dlp proxy server for Clipper app.
Resolves YouTube URLs to direct stream URLs + proxies video/audio (CORS bypass).

Usage: python3 yt-dlp-server.py
Port: 8787
"""

import json
import subprocess
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 8787

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path == "/resolve":
            self._handle_resolve()
        else:
            self.send_error(404)

    def do_GET(self):
        if self.path.startswith("/proxy"):
            self._handle_proxy()
        else:
            self.send_error(404)

    def _handle_resolve(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            url = body.get("url", "").strip()

            if not url:
                self._json(400, {"error": "No URL provided"})
                return

            # Run yt-dlp to get video info as JSON
            result = subprocess.run(
                [
                    "yt-dlp",
                    "-j",
                    "--no-warnings",
                    "--no-playlist",
                    url,
                ],
                capture_output=True,
                text=True,
                timeout=60,
            )

            if result.returncode != 0:
                error = result.stderr.strip().split("\n")[-1] if result.stderr else "yt-dlp failed"
                self._json(500, {"error": error})
                return

            info = json.loads(result.stdout.strip().split("\n")[0])

            formats = info.get("formats", [])

            # Find best combined video+audio (720p max for reasonable size)
            combined = [
                f for f in formats
                if f.get("vcodec") != "none"
                and f.get("acodec") != "none"
                and f.get("url")
            ]
            combined_720 = [f for f in combined if f.get("height") == 720]
            video_format = combined_720[0] if combined_720 else (combined[0] if combined else None)

            # If no combined, get best video-only (720p) + best audio
            if not video_format:
                video_only = [
                    f for f in formats
                    if f.get("vcodec") != "none"
                    and f.get("acodec") == "none"
                    and f.get("url")
                ]
                video_only.sort(key=lambda f: f.get("height", 0), reverse=True)
                video_format = video_only[0] if video_only else None

            # Find smallest audio-only (for transcription, bypass 25MB)
            audio_only = [
                f for f in formats
                if f.get("vcodec") == "none"
                and f.get("acodec") != "none"
                and f.get("url")
            ]
            audio_only.sort(key=lambda f: f.get("abr", 999))
            audio_format = audio_only[0] if audio_only else None

            if not video_format:
                self._json(500, {"error": "No video format found"})
                return

            self._json(200, {
                "videoUrl": video_format["url"],
                "audioUrl": audio_format["url"] if audio_format else None,
                "title": info.get("title", "youtube-video"),
                "duration": info.get("duration", 0),
                "thumbnail": info.get("thumbnail"),
                "videoHeight": video_format.get("height", 0),
            })

        except subprocess.TimeoutExpired:
            self._json(504, {"error": "yt-dlp timed out (60s)"})
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _handle_proxy(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            url = params.get("url", [None])[0]

            if not url:
                self.send_error(400, "No url parameter")
                return

            # Stream the video/audio through
            import urllib.request
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=300) as resp:
                content_type = resp.headers.get("Content-Type", "video/mp4")
                content_length = resp.headers.get("Content-Length", "")

                self.send_response(200)
                self.send_header("Content-Type", content_type)
                if content_length:
                    self.send_header("Content-Length", content_length)
                self._cors()
                self.end_headers()

                # Stream in chunks
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)

        except Exception as e:
            self.send_error(502, f"Proxy error: {e}")

    def _json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Minimal logging
        print(f"[yt-dlp] {args[0]}")


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"yt-dlp proxy server running on http://localhost:{PORT}")
    print(f"  POST /resolve  — resolve YouTube URL to stream URLs")
    print(f"  GET  /proxy    — proxy video/audio stream (CORS bypass)")
    server.serve_forever()
