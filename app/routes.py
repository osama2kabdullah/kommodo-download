from flask import Blueprint, render_template
import os
import tempfile
import shutil
import urllib.parse
from flask import Flask, request, render_template, redirect, url_for, Response, stream_with_context, abort, jsonify
import yt_dlp
import requests

app = Flask(__name__)
main = Blueprint('main', __name__)

@main.route('/')
def index():
    return render_template('index.html')

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
    stream_url = None
    formats = info.get('formats')

    if formats:
        real_media = []

        for f in formats:
            url_f = f.get("url")
            ext = f.get("ext")
            if ext in ("json", "mpd", "m3u8"):  # skip manifests
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
            if ext in ("mp4", "webm"):
                score += 100

            real_media.append((score, url_f))

        if real_media:
            real_media.sort(reverse=True)
            stream_url = real_media[0][1]

    if not stream_url and info.get('url'):
        stream_url = info.get('url')

    if not stream_url:
        return "No playable video found", 400

    encoded = urllib.parse.quote_plus(stream_url)
    stream_path = url_for('proxy_stream', video_url=encoded)
    download_route = url_for('proxy_download', video_url=encoded)

    return render_template(
        'result.html',
        title=title,
        thumbnail=thumbnail,
        stream_path=stream_path,
        download_route=download_route
    )

@app.route('/fetch_info_ajax', methods=['POST'])
def fetch_info_ajax():
    url = request.form.get('url', '').strip()
    if not url: return jsonify({"error": "No URL provided"}), 400

    ydl_opts = {'quiet': True, 'skip_download': True, 'no_warnings': True}

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    title = info.get('title', 'Unknown Video')
    thumbnail = info.get('thumbnail')

    # Select best playable format
    stream_url = None
    formats = info.get('formats')
    if formats:
        real_media = []
        for f in formats:
            url_f = f.get("url")
            ext = f.get("ext")
            if ext in ("json", "mpd", "m3u8") or not url_f: continue
            score = 0
            if f.get('acodec') != 'none': score += 50
            if f.get('vcodec') != 'none': score += 50
            if f.get('height'): score += f.get('height')
            if ext in ("mp4", "webm"): score += 100
            real_media.append((score, url_f))
        if real_media:
            real_media.sort(reverse=True)
            stream_url = real_media[0][1]

    if not stream_url and info.get('url'): stream_url = info.get('url')
    if not stream_url: return jsonify({"error": "No playable video found"}), 400

    encoded = urllib.parse.quote_plus(stream_url)
    return jsonify({
        "title": title,
        "thumbnail": thumbnail,
        "stream_path": url_for('proxy_stream', video_url=encoded),
        "download_route": url_for('proxy_download', video_url=encoded)
    })


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
def proxy_stream():
    video_url = request.args.get('video_url')
    if not video_url:
        abort(400)

    remote = urllib.parse.unquote_plus(video_url)
    lower = remote.lower()

    # If manifest, use yt-dlp to merge
    if any(x in lower for x in ('.m3u8', '.mpd', '.json')):
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
                ydl.extract_info(remote, download=True)

            files = [os.path.join(tmpdir, f) for f in os.listdir(tmpdir)]
            if not files:
                return "Failed to merge video.", 500
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
                        shutil.rmtree(tmpdir)
                    except:
                        pass

            return Response(stream_with_context(generate_and_cleanup(file_path, tmpdir)), mimetype='video/mp4')
        except Exception as e:
            try:
                shutil.rmtree(tmpdir)
            except:
                pass
            return f"Error streaming merged video: {e}", 500
    else:
        try:
            head = requests.head(remote, timeout=5, allow_redirects=True)
            ctype = head.headers.get('content-type', 'video/mp4')
        except:
            ctype = 'video/mp4'

        return Response(stream_with_context(stream_generator(remote)), mimetype=ctype)


@app.route('/download')
def proxy_download():
    video_url = request.args.get('video_url')
    if not video_url:
        abort(400)

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
                return "Failed to download merged video.", 500
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
                        shutil.rmtree(tmpdir)
                    except:
                        pass

            response = Response(stream_with_context(generate_and_cleanup(file_path, tmpdir)), mimetype='application/octet-stream')
            response.headers.set('Content-Disposition', f'attachment; filename="{filename}"')
            return response

        except Exception as e:
            try:
                shutil.rmtree(tmpdir)
            except:
                pass
            return f"Error downloading merged video: {e}", 500

    # direct file
    filename = remote.split("/")[-1].split("?")[0] or "video.mp4"
    try:
        r = requests.get(remote, stream=True, timeout=15)
    except Exception as e:
        return f"Failed to fetch video: {e}", 502

    response = Response(stream_with_context(r.iter_content(8192)), mimetype="application/octet-stream")
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@app.route('/cleanup')
def cleanup_temp():
    """Delete any leftover temporary folders from previous runs"""
    temp_dir = tempfile.gettempdir()
    deleted = []
    for name in os.listdir(temp_dir):
        if name.startswith("kommodo_") or name.startswith("kommodo_dl_"):
            path = os.path.join(temp_dir, name)
            try:
                shutil.rmtree(path)
                deleted.append(name)
            except:
                pass
    return f"Deleted temporary folders: {', '.join(deleted)}" if deleted else "No leftover temporary folders found."
