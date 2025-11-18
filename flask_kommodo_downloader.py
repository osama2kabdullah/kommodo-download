"""
Flask app: Kommodo / generic video downloader (single-file)

How it works
- Uses yt-dlp to extract a direct video URL (works for many sites)
- Shows a preview page with an HTML5 <video> tag and a Download button
- The Download button proxies the video through this Flask app so your browser can download it.

Requirements
- Python 3.8+
- pip install flask yt-dlp requests

Run:
python flask_kommodo_downloader.py
Then open http://127.0.0.1:5000
"""

from flask import Flask, request, render_template_string, redirect, url_for, Response, stream_with_context, abort
import yt_dlp
import requests
import urllib.parse
import mimetypes
import os
import tempfile
import shutil
import time

app = Flask(__name__)

INDEX_HTML = """
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Video Downloader (Kommodo-friendly)</title>
    <style>
      body{font-family: system-ui, -apple-system, Roboto, Arial;max-width:900px;margin:40px auto;padding:0 16px}
      input[type=text]{width:100%;padding:8px;margin:8px 0}
      button{padding:8px 12px;border-radius:8px}
      .notice{background:#fffbdd;padding:8px;border-radius:8px;margin-bottom:12px}
      video{max-width:100%;height:auto;border:1px solid #ddd;border-radius:8px}
    </style>
  </head>
  <body>
    <h1>Download a video by URL</h1>
    <p class="notice">Paste your Kommodo share link (or any video page) and click Fetch.</p>

    <form method="post" action="/fetch_info">
      <label for="url">Paste a video page or share URL:</label>
      <input id="url" name="url" type="text" placeholder="https://..." required>
      <div style="margin-top:8px"><button type="submit">Fetch video info</button></div>
    </form>

    <hr>
    <p>Only download videos you own or have permission to access.</p>
  </body>
</html>
"""

RESULT_HTML = """
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Video preview</title>
    <style>
      body{font-family:system-ui,Arial;max-width:900px;margin:24px auto;padding:0 16px}
      video{max-width:100%;height:auto;border-radius:8px}
    </style>
  </head>
  <body>
    <h1>Preview & Download</h1>
    <p><strong>Title:</strong> {{title}}</p>
    {% if thumbnail %}
      <p><img src="{{thumbnail}}" alt="thumb" style="max-width:320px;border-radius:6px"></p>
    {% endif %}

    {% if stream_path %}
      <video controls src="{{stream_path}}"></video>
      <p style="margin-top:8px">
        <a href="{{download_route}}" style="font-size:18px;">Download</a>
      </p>
    {% else %}
      <p>No playable format found.</p>
    {% endif %}

    <p style="margin-top:18px"><a href="/">Back</a></p>
  </body>
</html>
"""


@app.route('/')
def index():
    return render_template_string(INDEX_HTML)


@app.route('/fetch_info', methods=['POST'])
def fetch_info():
    url = request.form.get('url', '').strip()
    if not url:
        return redirect(url_for('index'))

    ydl_opts = {
        'quiet': True,
        'skip_download': True,
        'no_warnings': True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        return f"Error extracting info: {e}", 400

    title = info.get('title', 'Unknown Video')
    thumbnail = info.get('thumbnail')

    # Select best playable format
    # Select best direct media file (avoid manifests)
    stream_url = None
    formats = info.get('formats')

    if formats:
        real_media = []

        for f in formats:
            url_f = f.get("url")
            ext = f.get("ext")

            # Skip manifest files (.json, .mpd, .m3u8)
            if ext in ("json", "mpd", "m3u8"):
                continue

            if not url_f:
                continue

            score = 0
            if f.get('acodec') != 'none':
                score += 50
            if f.get('vcodec') != 'none':
                score += 50
            if f.get('height'):
                score += f.get('height')

            # Prefer actual video formats
            if ext in ("mp4", "webm"):
                score += 100

            real_media.append((score, url_f))

        if real_media:
            real_media.sort(reverse=True)
            stream_url = real_media[0][1]

    if not stream_url:
        if info.get('url'):
            stream_url = info.get('url')

    if not stream_url:
        return "No direct playable video stream found.", 400

    encoded = urllib.parse.quote_plus(stream_url)
    stream_path = url_for('proxy_stream', video_url=encoded)
    download_route = url_for('proxy_download', video_url=encoded)

    return render_template_string(
        RESULT_HTML,
        title=title,
        thumbnail=thumbnail,
        stream_path=stream_path,
        download_route=download_route,
    )


def stream_generator(remote_url):
    try:
        with requests.get(remote_url, stream=True, timeout=10) as r:
            r.raise_for_status()
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    yield chunk
    except:
        return


@app.route('/stream')
@app.route('/stream')
def proxy_stream():
    video_url = request.args.get('video_url')
    if not video_url:
        abort(400)

    remote = urllib.parse.unquote_plus(video_url)

    # Quick check for manifest-like URLs
    lower = remote.lower()
    if any(x in lower for x in ('.m3u8', '.mpd', '.json')) or 'application/vnd.apple.mpegurl' in (requests.head(remote, allow_redirects=True, timeout=5).headers.get('content-type','').lower() if True else ''):
        # Use yt-dlp to download+merge to a temp file, then stream the temp file
        tmpdir = tempfile.mkdtemp(prefix="kommodo_")
        try:
            ydl_opts = {
                'format': 'bestvideo+bestaudio/best',
                'outtmpl': os.path.join(tmpdir, '%(id)s.%(ext)s'),
                'merge_output_format': 'mp4',
                'quiet': True,
                'no_warnings': True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                # extract & download - this will produce a single output file (mp4) when possible
                info = ydl.extract_info(remote, download=True)

            # locate the downloaded file (choose largest file if multiple)
            files = [os.path.join(tmpdir, f) for f in os.listdir(tmpdir)]
            if not files:
                return "Failed to download/convert manifest to media.", 500
            files.sort(key=lambda p: os.path.getsize(p), reverse=True)
            file_path = files[0]

            def generate_and_cleanup(path, tmpdir):
                try:
                    with open(path, 'rb') as fh:
                        while True:
                            chunk = fh.read(8192)
                            if not chunk:
                                break
                            yield chunk
                finally:
                    try:
                        os.remove(path)
                    except:
                        pass
                    try:
                        shutil.rmtree(tmpdir)
                    except:
                        pass

            # stream as video/mp4 so browser can play inline
            return Response(stream_with_context(generate_and_cleanup(file_path, tmpdir)), mimetype='video/mp4')
        except Exception as e:
            # cleanup on error
            try:
                shutil.rmtree(tmpdir)
            except:
                pass
            return f"Error converting/streaming manifest: {e}", 500
    else:
        # direct streaming for regular file urls
        try:
            head = requests.head(remote, timeout=5, allow_redirects=True)
            ctype = head.headers.get('content-type', 'video/mp4')
        except:
            ctype = 'video/mp4'

        return Response(stream_with_context(stream_generator(remote)), mimetype=ctype)

@app.route('/download')
@app.route('/download')
def proxy_download():
    video_url = request.args.get('video_url')
    if not video_url:
        abort(400)

    remote = urllib.parse.unquote_plus(video_url)
    lower = remote.lower()

    # If remote looks like a manifest, use yt-dlp to produce a single MP4 and serve it
    if any(x in lower for x in ('.m3u8', '.mpd', '.json')):
        tmpdir = tempfile.mkdtemp(prefix="kommodo_dl_")
        try:
            ydl_opts = {
                'format': 'bestvideo+bestaudio/best',
                'outtmpl': os.path.join(tmpdir, '%(id)s.%(ext)s'),
                'merge_output_format': 'mp4',
                'quiet': True,
                'no_warnings': True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(remote, download=True)

            # locate the produced file
            files = [os.path.join(tmpdir, f) for f in os.listdir(tmpdir)]
            if not files:
                return "Failed to download/convert manifest to media.", 500
            files.sort(key=lambda p: os.path.getsize(p), reverse=True)
            file_path = files[0]
            filename = os.path.basename(file_path)

            def generate_and_cleanup(path, tmpdir):
                try:
                    with open(path, 'rb') as fh:
                        while True:
                            chunk = fh.read(8192)
                            if not chunk:
                                break
                            yield chunk
                finally:
                    try:
                        os.remove(path)
                    except:
                        pass
                    try:
                        shutil.rmtree(tmpdir)
                    except:
                        pass

            response = Response(stream_with_context(generate_and_cleanup(file_path, tmpdir)), mimetype='application/octet-stream')
            response.headers.set('Content-Disposition', f'attachment; filename=\"{filename}\"')
            return response

        except Exception as e:
            try:
                shutil.rmtree(tmpdir)
            except:
                pass
            return f"Error downloading/merging manifest: {e}", 500

    # Otherwise treat as direct file and proxy it
    filename = remote.split("/")[-1].split("?")[0] or "video"
    try:
        r = requests.get(remote, stream=True, timeout=15)
    except Exception as e:
        return f"Failed to fetch remote video: {e}", 502

    if r.status_code != 200:
        return f"Failed to fetch remote video: status {r.status_code}", 502

    response = Response(stream_with_context(r.iter_content(8192)),
                        mimetype="application/octet-stream")
    response.headers["Content-Disposition"] = f"attachment; filename=\"{filename}\""
    return response

if __name__ == "__main__":
    app.run(debug=True)
