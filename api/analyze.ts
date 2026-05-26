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

export default async function handler(req: any, res: any) {
  // CORS Headers support
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const { url } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: "Please provide a valid video page URL address to download." });
  }

  try {
    const urlObj = new URL(url);

    const isDirectMedia = /\.(mp4|webm|mov|avi|mkv|m3u8)(?:\?|$)/i.test(urlObj.pathname);
    if (isDirectMedia) {
      return res.status(200).json({
        success: true,
        title: urlObj.pathname.split("/").pop() || "Direct Video Stream",
        videoUrl: url,
        thumbnailUrl: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?q=80&w=200&auto=format&fit=crop",
        format: urlObj.pathname.split(".").pop()?.toLowerCase() || "mp4",
        explanation: "Direct media link detected from requested URL signature.",
      });
    }

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
        error: `Could not retrieve web page (HTTP Status ${fetchResponse.status}: ${fetchResponse.statusText}).`,
      });
    }

    const html = await fetchResponse.text();
    const parsedData = extractVideoDirectly(html, url);
    return res.status(200).json(parsedData);

  } catch (err: any) {
    console.error(err);
    return res.status(500).json({
      error: `Analysis process aborted: ${err.message}`,
    });
  }
}
