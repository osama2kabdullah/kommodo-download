export const config = {
  maxDuration: 120, // Stream segments may take a bit more time to fully pool
};

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Type, X-Estimated-Content-Length");

  const videoUrl = req.query.url as string;
  let filename = (req.query.filename as string) || "video.mp4";

  if (!videoUrl) {
    return res.status(400).send("Parameter 'url' is required.");
  }

  const isHLS = videoUrl.includes(".m3u8") || videoUrl.includes("m3u8");

  try {
    const targetUrl = new URL(videoUrl);

    // Universal play-ready target conversion: convert .m3u8 or .ts requests to .mp4 filename extensions
    if (isHLS && (filename.endsWith(".m3u8") || filename.endsWith(".ts"))) {
       filename = filename.replace(/\.(m3u8|ts)$/i, ".mp4");
    }

    if (isHLS) {
      const resolveHLSSegments = async (playlistUrl: string, depth = 0): Promise<string[]> => {
        if (depth > 4) return [];

        const response = await fetch(playlistUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          }
        });

        if (!response.ok) {
          throw new Error(`Failed loading stream playlist (HTTP ${response.status})`);
        }

        const m3u8Text = await response.text();
        const lines = m3u8Text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        const isMasterPlaylist = m3u8Text.includes("#EXT-X-STREAM-INF");

        if (isMasterPlaylist) {
          let bestVariantUri = "";
          let maxBandwidth = 0;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith("#EXT-X-STREAM-INF")) {
              const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
              const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;
              const nextLine = lines[i + 1];

              if (nextLine && !nextLine.startsWith("#")) {
                if (bandwidth > maxBandwidth) {
                  maxBandwidth = bandwidth;
                  bestVariantUri = nextLine;
                }
              }
            }
          }

          if (!bestVariantUri) {
            const candidate = lines.find((line, index) => index > 0 && !line.startsWith("#") && lines[index - 1].startsWith("#EXT-X-STREAM-INF"));
            if (candidate) bestVariantUri = candidate;
          }

          if (bestVariantUri) {
            const absoluteVariantUrl = new URL(bestVariantUri, playlistUrl).toString();
            return resolveHLSSegments(absoluteVariantUrl, depth + 1);
          }
        }

        const segments: string[] = [];
        for (const line of lines) {
          if (!line.startsWith("#")) {
            const absoluteSegmentUrl = new URL(line, playlistUrl).toString();
            segments.push(absoluteSegmentUrl);
          }
        }

        return segments;
      };

      const segmentsList = await resolveHLSSegments(videoUrl);

      if (segmentsList.length === 0) {
        return res.status(404).send("Could not extract any active segment fragments.");
      }

      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      // Use universal play-ready video/mp4 MIME-type so desktop/mobile media player associations open it natively
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("X-Estimated-Content-Length", (segmentsList.length * 1200000).toString());

      for (let index = 0; index < segmentsList.length; index++) {
        const chunkUrl = segmentsList[index];
        try {
          const chunkResponse = await fetch(chunkUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Referer": targetUrl.origin,
            },
          });

          if (!chunkResponse.ok) continue;

          if (chunkResponse.body) {
            const reader = chunkResponse.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          }
        } catch (err) {
          console.error(err);
        }
      }
      res.end();

    } else {
      const response = await fetch(videoUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": targetUrl.origin,
        },
      });

      if (!response.ok) {
        return res.status(response.status).send(`Target file download failed (HTTP ${response.status})`);
      }

      const contentType = response.headers.get("content-type") || "video/mp4";
      const contentLength = response.headers.get("content-length");

      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader("Content-Type", contentType);
      if (contentLength) {
        res.setHeader("Content-Length", contentLength);
      }

      if (!response.body) {
        return res.status(500).send("Empty stream body received.");
      }

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    }

  } catch (error: any) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).send(`Serverless proxy error: ${error.message}`);
    }
  }
}
