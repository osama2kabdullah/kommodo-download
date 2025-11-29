# blueprint_video_proxy.py
import os
import tempfile
import shutil
import urllib.parse
from flask import Blueprint, request, url_for, Response, stream_with_context, abort, jsonify, current_app, send_file
import yt_dlp
import requests
import time

api = Blueprint('api', __name__)

# -----------------------------
# Persistent Session (NEW)
# -----------------------------
session = requests.Session()

# -----------------------------
# Manifest Cache (for m3u8)
# -----------------------------
manifest_cache = {}
MANIFEST_TTL = 5  # seconds

# -----------------------------
# Helpers
# -----------------------------

HOP_BY_HOP_HEADERS = {
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailers', 'transfer-encoding', 'upgrade'
}

def safe_copy_headers(src_headers, dst_headers):
    for k, v in src_headers.items():
        if k.lower() in HOP_BY_HOP_HEADERS:
            continue
        dst_headers[k] = v

def forward_range_header():
    headers = {}
    rng = request.headers.get('Range')
    if rng:
        headers['Range'] = rng
    return headers

def send_file_partial(path):
    range_header = request.headers.get('Range', None)
    size = os.path.getsize(path)

    if not range_header:
        resp = send_file(path, mimetype='video/mp4', as_attachment=False, conditional=True)
        resp.headers['Accept-Ranges'] = 'bytes'
        return resp

    try:
        bytes_range = range_header.replace('bytes=', '').split('-')
        start = int(bytes_range[0]) if bytes_range[0] else 0
        end = int(bytes_range[1]) if len(bytes_range) > 1 and bytes_range[1] else size - 1
    except Exception:
        start, end = 0, size - 1

    if start > end or start >= size:
        return Response(status=416)

    length = end - start + 1

    def generate():
        with open(path, 'rb') as f:
            f.seek(start)
            remaining = length
            chunk_size = 8192
            while remaining > 0:
                data = f.read(min(chunk_size, remaining))
                if not data:
                    break
                remaining -= len(data)
                yield data

    rv = Response(stream_with_context(generate()), status=206, mimetype='video/mp4')
    rv.headers['Content-Range'] = f'bytes {start}-{end}/{size}'
    rv.headers['Content-Length'] = str(length)
    rv.headers['Accept-Ranges'] = 'bytes'
    return rv

# -----------------------------
# Proxy Upstream Stream (UPDATED with persistent session + caching)
# -----------------------------
def proxy_stream_from_remote(remote_url, timeout=30):
    # -------- m3u8 cache check --------
    if remote_url.endswith(".m3u8"):
        cached = manifest_cache.get(remote_url)
        if cached:
            ts, content, headers = cached
            if time.time() - ts < MANIFEST_TTL:
                print("💾 Using cached manifest:", remote_url)
                resp = Response(content, mimetype="application/vnd.apple.mpegurl")
                for k, v in headers.items():
                    resp.headers[k] = v
                return resp

    upstream_headers = forward_range_header()
    upstream_headers.setdefault('User-Agent', 'Mozilla/5.0 (KommodoProxy/1.0)')

    try:
        r = session.get(remote_url, stream=True, timeout=timeout, headers=upstream_headers)
    except Exception as e:
        current_app.logger.exception("Failed to connect to upstream URL")
        return Response(f"Failed to fetch upstream resource: {e}", status=502)

    # Cache manifest if needed
    if remote_url.endswith(".m3u8") and r.status_code == 200:
        content = r.content
        headers = {k: v for k, v in r.headers.items()
                   if k.lower() not in HOP_BY_HOP_HEADERS}

        manifest_cache[remote_url] = (time.time(), content, headers)

        resp = Response(content, mimetype="application/vnd.apple.mpegurl")
        for k, v in headers.items():
            resp.headers[k] = v
        return resp

    # If upstream returned error
    if r.status_code >= 400:
        return Response(r.content[:1024], status=r.status_code)

    def generate():
        try:
            for chunk in r.iter_content(chunk_size=65536):
                if chunk:
                    yield chunk
        finally:
            try:
                r.close()
            except:
                pass

    resp = Response(stream_with_context(generate()), status=r.status_code)
    safe_copy_headers(r.headers, resp.headers)

    if "Accept-Ranges" not in resp.headers:
        resp.headers["Accept-Ranges"] = "bytes"

    return resp

# -----------------------------
# Endpoints
# -----------------------------

@api.route('/fetch_info_ajax', methods=['POST'])
def fetch_info_ajax():
    url = request.form.get('url', '').strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    # -------- FIXED yt-dlp deprecated format sort --------
    ydl_opts = {
        'quiet': True,
        'skip_download': True,
        'no_warnings': True,
        'format_sort': ['res', 'fps', 'vbr', 'filesize']
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        current_app.logger.exception("yt-dlp extract_info failed")
        return jsonify({"error": f"Failed to extract info: {str(e)}"}), 400

    title = info.get('title', 'Unknown Video')
    thumbnail = info.get('thumbnail')

    stream_url = None
    best_format = None
    formats = info.get('formats') or []

    single_streams = []
    for f in formats:
        url_f = f.get('url')
        if not url_f:
            continue

        has_audio = (f.get('acodec') != 'none')
        has_video = (f.get('vcodec') != 'none')

        if has_audio and has_video:
            score = 0
            if f.get('ext') in ("mp4", "webm"): score += 200
            if f.get('height'): score += int(f.get('height') or 0)
            if f.get('filesize') or f.get('filesize_approx'): score += 50

            single_streams.append((score, url_f, f))

    if single_streams:
        single_streams.sort(key=lambda x: x[0], reverse=True)
        stream_url = single_streams[0][1]
        best_format = single_streams[0][2]
    else:
        stream_url = info.get('url')
        if not stream_url:
            for f in formats:
                if f.get('url'):
                    stream_url = f.get('url')
                    best_format = f
                    break

    if not stream_url:
        return jsonify({"error": "No playable video stream found."}), 400

    # Video details
    video_details = {
        "format": "N/A",
        "resolution": "N/A",
        "filesize": "N/A",
        "duration": info.get('duration_string', 'N/A')
    }

    if best_format:
        filesize = best_format.get('filesize') or best_format.get('filesize_approx')
        if filesize:
            filesize = f"{round(filesize / (1024*1024), 1)} MB"
        else:
            filesize = "Unknown"

        w = best_format.get('width')
        h = best_format.get('height')
        resolution = f"{w}x{h}" if w and h else "N/A"

        video_details = {
            "format": (best_format.get('ext') or 'N/A').upper(),
            "resolution": resolution,
            "filesize": filesize,
            "duration": info.get('duration_string', 'N/A')
        }

    encoded = urllib.parse.quote_plus(stream_url)

    return jsonify({
        "title": title,
        "thumbnail": thumbnail,
        "stream_path": url_for('api.proxy_stream', video_url=encoded),
        "download_route": url_for('api.proxy_download', video_url=encoded),
        "video_details": video_details
    })


@api.route('/proxy_stream')
def proxy_stream():
    video_url = request.args.get('video_url')
    if not video_url:
        abort(400, "Missing video URL parameter.")

    remote = urllib.parse.unquote_plus(video_url)

    if remote.startswith('file://') or os.path.exists(remote):
        if remote.startswith('file://'):
            path = urllib.parse.urlparse(remote).path
        else:
            path = remote
        if not os.path.exists(path):
            return "Local file not found.", 404
        return send_file_partial(path)

    return proxy_stream_from_remote(remote)


@api.route('/proxy_download')
def proxy_download():
    video_url = request.args.get('video_url')
    if not video_url:
        abort(400, "Missing video URL parameter.")

    remote = urllib.parse.unquote_plus(video_url)
    lower = remote.lower()

    if any(x in lower for x in ('.m3u8', '.mpd', '.json')):
        tmpdir = tempfile.mkdtemp(prefix="kommodo_dl_")
        try:
            ydl_opts = {
                'format': 'bestvideo+bestaudio/best',
                'outtmpl': os.path.join(tmpdir, '%(title)s.%(ext)s'),
                'merge_output_format': 'mp4',
                'quiet': True,
                'no_warnings': True,
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(remote, download=True)

            files = [os.path.join(tmpdir, f) for f in os.listdir(tmpdir)]
            if not files:
                shutil.rmtree(tmpdir, ignore_errors=True)
                return "Failed to download merged video.", 500

            files.sort(key=os.path.getsize, reverse=True)
            file_path = files[0]
            filename = os.path.basename(file_path)

            def generate(path, tmp):
                try:
                    with open(path, 'rb') as fh:
                        while True:
                            chunk = fh.read(8192)
                            if not chunk:
                                break
                            yield chunk
                finally:
                    shutil.rmtree(tmp, ignore_errors=True)

            resp = Response(stream_with_context(generate(file_path, tmpdir)),
                            mimetype="application/octet-stream")
            resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
            resp.headers["Content-Length"] = str(os.path.getsize(file_path))
            return resp

        except Exception as e:
            current_app.logger.exception("yt-dlp download error")
            shutil.rmtree(tmpdir, ignore_errors=True)
            return f"Error downloading: {e}", 500

    filename = remote.split("/")[-1].split("?")[0] or "video.mp4"

    try:
        r = session.get(remote, stream=True, timeout=30,
                        headers={'User-Agent': 'Mozilla/5.0 (KommodoProxy/1.0)'})
    except Exception as e:
        current_app.logger.exception("Remote fetch failed")
        return f"Failed to fetch video: {e}", 502

    if r.status_code >= 400:
        return Response(r.content, status=r.status_code)

    def generate():
        try:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    yield chunk
        finally:
            r.close()

    resp = Response(stream_with_context(generate()),
                    mimetype="application/octet-stream",
                    status=r.status_code)
    resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'

    if 'content-length' in r.headers:
        resp.headers["Content-Length"] = r.headers["content-length"]

    return resp
