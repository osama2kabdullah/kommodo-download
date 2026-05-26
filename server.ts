import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

app.use(express.json());

/**
 * Native analytical checker to parse target page layout and match stream parameters
 */
function extractVideoDirectly(html: string, pageUrl: string): { 
  success: boolean; 
  title: string; 
  videoUrl: string; 
  thumbnailUrl: string; 
  format: string; 
  explanation: string; 
} {
  let videoUrl = "";
  let title = "Extracted Live Video Stream";
  let thumbnailUrl = "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?q=80&w=200&auto=format&fit=crop";
  let explanation = "";

  // Title extraction
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // Meta property video/image matchers (og:video context)
  const ogVideoMatch = html.match(/<meta[^>]*(?:property|name)=["']og:video(?::secure_url|:url)?["'][^>]*content=["']([^"']+)["']/i) ||
                       html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:video(?::secure_url|:url)?["']/i);
  if (ogVideoMatch) {
    videoUrl = ogVideoMatch[1];
    explanation = "Located stream reference within open-graph secure video meta properties.";
  }

  // og:image or twitter:image search
  const ogImageMatch = html.match(/<meta[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/i) ||
                       html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
  if (ogImageMatch) {
    thumbnailUrl = ogImageMatch[1];
  }

  // If still no videoUrl, parse HTML5 <video> elements
  if (!videoUrl) {
    const videoTagSrc = html.match(/<video[^>]+src=["']([^"']+)["']/i);
    if (videoTagSrc) {
      videoUrl = videoTagSrc[1];
      explanation = "Extracted direct stream path located inside HTML5 video markup.";
    }
  }

  // Source elements parsing
  if (!videoUrl) {
    const sourceTagSrc = html.match(/<source[^>]+src=["']([^"']+\.(?:mp4|webm|m3u8)[^"']*)["']/i);
    if (sourceTagSrc) {
      videoUrl = sourceTagSrc[1];
      explanation = "Extracted direct stream path located inside HTML5 video source element.";
    }
  }

  // Decoded inline json layouts
  if (!videoUrl) {
    const jsonStreamMatch = html.match(/"(?:downloadUrl|streamUrl|url|src)":\s*"(https?:\/\/[^"]+\.(?:mp4|webm|m3u8|mpd)[^"]*)"/i);
    if (jsonStreamMatch) {
      videoUrl = jsonStreamMatch[1];
      explanation = "Decoded absolute stream endpoint from layout configuration state.";
    }
  }

  // Match special CDN signatures (such as Loom transcoded sessions)
  if (!videoUrl) {
    const cdnMatch = html.match(/(https?:\/\/[^\s"',]+\.(?:mp4|webm|m3u8|mpd)[^\s"',]*)/gi);
    if (cdnMatch) {
      for (const possibleUrl of cdnMatch) {
        if (possibleUrl.includes("loom.com") || possibleUrl.includes("komodo") || possibleUrl.includes("transcoded") || possibleUrl.includes("amazon") || possibleUrl.includes("google")) {
          videoUrl = possibleUrl;
          explanation = "Mapped direct CDN streaming target from configuration trace.";
          break;
        }
      }
    }
  }

  // General raw fallback context sweep
  if (!videoUrl) {
    const fallbackUrls = html.match(/https?:\/\/[^\s"',]+\.(?:mp4|webm|m3u8)(?:\?[^\s"',]+)?/gi);
    if (fallbackUrls && fallbackUrls.length > 0) {
      videoUrl = fallbackUrls[0];
      explanation = "Resolved file stream through raw context scanning of active media formats.";
    }
  }

  if (videoUrl) {
    // Unescape parsed HTML unicode patterns
    videoUrl = videoUrl
      .replace(/\\u002F/g, "/")
      .replace(/\\u0026/g, "&")
      .replace(/&amp;/g, "&")
      .replace(/\\"/g, '"');
      
    const format = videoUrl.toLowerCase().includes(".m3u8") ? "m3u8" : (videoUrl.toLowerCase().includes(".webm") ? "webm" : "mp4");
    title = title.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

    return {
      success: true,
      title,
      videoUrl,
      thumbnailUrl,
      format,
      explanation,
    };
  }

  return {
    success: false,
    title: "Unknown Media Source",
    videoUrl: "",
    thumbnailUrl,
    format: "mp4",
    explanation: "Under No-API Mode, page text layout analysis found no HTML5 elements, meta indicators, or dynamic configurations referencing a stream.",
  };
}

// Health status API
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Primary video URL analyzer utilizing browser-level fetching and Native Extraction
app.post("/api/analyze", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Please provide a valid video page URL address to download." });
  }

  try {
    const urlObj = new URL(url);

    // Fast-path: check if URL itself is already a direct media file matching extensions
    const isDirectMedia = /\.(mp4|webm|mov|avi|mkv|m3u8)(?:\?|$)/i.test(urlObj.pathname);
    if (isDirectMedia) {
      return res.json({
        success: true,
        title: urlObj.pathname.split("/").pop() || "Direct Video Stream",
        videoUrl: url,
        thumbnailUrl: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?q=80&w=200&auto=format&fit=crop",
        format: urlObj.pathname.split(".").pop()?.toLowerCase() || "mp4",
        explanation: "Direct media link detected from requested URL signature.",
      });
    }

    console.log(`Analyzing requested URL natively: ${url}`);
    
    // Mimic real client configurations to bypass bot detectors
    const fetchResponse = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": urlObj.origin,
      },
    });

    if (!fetchResponse.ok) {
      return res.status(400).json({
        error: `Could not retrieve web page (HTTP Status ${fetchResponse.status}: ${fetchResponse.statusText}). Confirm URL visibility.`,
      });
    }

    const html = await fetchResponse.text();
    const parsedData = extractVideoDirectly(html, url);
    return res.json(parsedData);

  } catch (err: any) {
    console.error("Analysis failed:", err);
    return res.status(500).json({
      error: `Analysis process aborted: ${err.message}. Double-check URL configurations.`,
    });
  }
});

// Proxy streaming endpoint to handle server-to-consumer video downloads cleanly (circumventing CORS)
app.get("/api/download-proxy", async (req, res) => {
  const videoUrl = req.query.url as string;
  let filename = (req.query.filename as string) || "video.mp4";

  if (!videoUrl) {
    return res.status(400).send("Parameter 'url' is required.");
  }

  // Detect if target is an HLS playlist (.m3u8 context)
  const isHLS = videoUrl.includes(".m3u8") || videoUrl.includes("m3u8");

  try {
    const targetUrl = new URL(videoUrl);
    console.log(`Proxying file transmission for: ${videoUrl} (Is HLS: ${isHLS})`);

    // Universal play-ready target conversion: convert .m3u8 or .ts requests to .mp4 filename extensions
    if (isHLS && (filename.endsWith(".m3u8") || filename.endsWith(".ts"))) {
       filename = filename.replace(/\.(m3u8|ts)$/i, ".mp4");
    }

    if (isHLS) {
      // 1. Recursive helper function to download playlist and parse TS segment URLs
      const resolveHLSSegments = async (playlistUrl: string, depth = 0): Promise<string[]> => {
        if (depth > 4) return []; // Prevent infinite recursion

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

        // Check if this is a master playlist with multiple variant streams
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
            // Fallback: search for first non-comment line following EXT-X-STREAM-INF
            const candidate = lines.find((line, index) => index > 0 && !line.startsWith("#") && lines[index - 1].startsWith("#EXT-X-STREAM-INF"));
            if (candidate) bestVariantUri = candidate;
          }

          if (bestVariantUri) {
            const absoluteVariantUrl = new URL(bestVariantUri, playlistUrl).toString();
            console.log(`Resolving highest-quality stream track variant: ${absoluteVariantUrl} (Bandwidth: ${maxBandwidth})`);
            return resolveHLSSegments(absoluteVariantUrl, depth + 1);
          }
        }

        // It is a media playlist containing direct .ts files
        const segments: string[] = [];
        for (const line of lines) {
          if (!line.startsWith("#")) {
            const absoluteSegmentUrl = new URL(line, playlistUrl).toString();
            segments.push(absoluteSegmentUrl);
          }
        }

        return segments;
      };

      // 2. Resolve HLS stream channels
      const segmentsList = await resolveHLSSegments(videoUrl);
      console.log(`HLS resolution finished. Found ${segmentsList.length} media chunks to reconstruct.`);

      if (segmentsList.length === 0) {
        return res.status(404).send("Could not extract any active segment fragments from the streaming playlist.");
      }

      // Configure continuous binary attachment stream response headers
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      // Use universal play-ready video/mp4 MIME-type so desktop/mobile media player associations open it natively
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("X-Estimated-Content-Length", (segmentsList.length * 1200000).toString());
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Type, X-Estimated-Content-Length");

      // Loop over and request every chunk sequentially, pipe direct to output stream buffer
      for (let index = 0; index < segmentsList.length; index++) {
        const chunkUrl = segmentsList[index];
        console.log(`Piping chunk (${index + 1}/${segmentsList.length}): ${chunkUrl}`);

        try {
          const chunkResponse = await fetch(chunkUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Referer": targetUrl.origin,
            },
          });

          if (!chunkResponse.ok) {
            console.warn(`Warning: Segment chunk ${index + 1} request threw error HTTP ${chunkResponse.status}. Skipping.`);
            continue;
          }

          if (chunkResponse.body) {
            const reader = chunkResponse.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          }
        } catch (segmentErr) {
          console.error(`Chunk fetch failed at segment offset ${index + 1}:`, segmentErr);
        }
      }

      res.end();

    } else {
      // Direct Single-file MP4 path
      const response = await fetch(videoUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": targetUrl.origin,
        },
      });

      if (!response.ok) {
        return res.status(response.status).send(`Target file download failed (HTTP ${response.status}: ${response.statusText})`);
      }

      const contentType = response.headers.get("content-type") || "video/mp4";
      const contentLength = response.headers.get("content-length");

      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader("Content-Type", contentType);
      if (contentLength) {
        res.setHeader("Content-Length", contentLength);
      }

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Type");

      if (!response.body) {
        return res.status(500).send("Empty stream body received from target asset server.");
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
    console.error("Proxy streaming failed:", error);
    if (!res.headersSent) {
      res.status(500).send(`Server failed to pipe file stream: ${error.message}`);
    }
  }
});

// Configure client hot reloading index or server templates
async function initializeApp() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server started successfully. Active listening host: http://localhost:${PORT}`);
  });
}

initializeApp().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
