// ---- ROUTES ----
const routes = {
  "/": healthHandler,
  "/info": infoHandler,
  "/download": downloadHandler
};

// ---- CORS HELPER ----
function corsHeaders(origin, allowedOrigin) {
  if (origin !== allowedOrigin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

// ---- FETCH ENTRY POINT ----
export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin, allowedOrigin) });
    }

    const url = new URL(request.url);
    const handler = routes[url.pathname];

    if (!handler) {
      return jsonError("Not Found", 404, origin, allowedOrigin);
    }

    try {
      const response = await handler(request, env, ctx);
      const headers = new Headers(response.headers);
      const cors = corsHeaders(origin, allowedOrigin);
      for (const key in cors) headers.set(key, cors[key]);
      return new Response(response.body, {
        status: response.status,
        headers
      });
    } catch (err) {
      return jsonError("Internal Worker error", 500, origin, allowedOrigin, err.message);
    }
  }
};

// ---- HELPERS ----
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function jsonError(message, status = 500, origin = "", allowedOrigin = "", details = null) {
  const payload = { status: "error", message };
  if (details) payload.details = details;
  const headers = new Headers({ "Content-Type": "application/json", ...corsHeaders(origin, allowedOrigin) });
  return new Response(JSON.stringify(payload), { status, headers });
}

// ---- HEALTH ENDPOINT ----
function healthHandler() {
  return jsonResponse({ status: "ok", message: "Worker running" });
}

// ---- INFO ENDPOINT ----
async function infoHandler(request) {
  if (request.method !== "POST") return jsonError("Method not allowed. Use POST", 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const videoUrl = body.url;
  if (!videoUrl) return jsonError("Missing 'url' field", 400);

  let parsedUrl;
  try {
    parsedUrl = new URL(videoUrl);
  } catch {
    return jsonError("Invalid URL", 400);
  }

  let response;
  try {
    response = await fetch(parsedUrl.toString());
  } catch {
    return jsonError("Failed to reach video server", 502);
  }

  if (!response.ok) {
    return jsonError("Video server returned error", 400, "", "", `Status code: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  let finalVideoUrl = null;
  let sourceType = null;
  let posterUrl = null;

  if (contentType.startsWith("text/html")) {
    const html = await response.text();
    const match = html.match(/https?:\/\/[^"]+\.m3u8[^"]*/);
    if (!match) return jsonError("Could not find video", 404);
    finalVideoUrl = match[0];
    sourceType = "page";

    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    if (ogImageMatch) posterUrl = ogImageMatch[1];
    else {
      const videoPosterMatch = html.match(/<video[^>]+poster=["']([^"']+)["']/i);
      posterUrl = videoPosterMatch ? videoPosterMatch[1] : null;
    }

  } else if (parsedUrl.pathname.endsWith(".m3u8")) {
    finalVideoUrl = parsedUrl.toString();
    sourceType = "playlist";

  } else if (contentType.startsWith("video")) {
    finalVideoUrl = parsedUrl.toString();
    sourceType = "direct";

  } else {
    return jsonError("Unsupported content type", 400, "", "", contentType);
  }

  return jsonResponse({ status: "ok", source: sourceType, videoUrl: finalVideoUrl, poster: posterUrl });
}

// ---- DOWNLOAD ENDPOINT ----
async function downloadHandler(request) {
  if (request.method !== "GET") return jsonError("Method not allowed. Use GET", 405);

  const url = new URL(request.url);
  const playlistUrl = url.searchParams.get('playlist');
  if (!playlistUrl) return jsonError("Missing 'playlist' parameter", 400);

  let playlistResponse;
  try {
    playlistResponse = await fetch(playlistUrl);
    if (!playlistResponse.ok) throw new Error("Failed to fetch playlist");
  } catch {
    return jsonError("Failed to fetch playlist", 500);
  }

  const playlistText = await playlistResponse.text();
  const segments = playlistText.split("\n").filter(line => line.endsWith(".ts") || line.includes(".ts?"));
  if (segments.length === 0) return jsonError("No video segments found", 404);

  const baseUrl = playlistUrl.substring(0, playlistUrl.lastIndexOf("/") + 1);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (const segment of segments) {
          const segmentUrl = segment.startsWith("http") ? segment : baseUrl + segment;
          const segmentResponse = await fetch(segmentUrl);
          if (!segmentResponse.ok) throw new Error("Segment fetch failed");

          const reader = segmentResponse.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "video/mp2t",
      "Content-Disposition": 'attachment; filename="video.ts"'
    }
  });
}