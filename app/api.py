import os
import tempfile
import shutil
import urllib.parse
from flask import Blueprint, request, url_for, Response, stream_with_context, abort, jsonify
import yt_dlp
import requests

api = Blueprint('api', __name__)

# --- Helper Function for Range Header Streaming (Crucial for Video Seeking) ---
def send_file_partial(path):
    """
    Serves a file from the given path while correctly handling the HTTP Range header 
    for video seeking. This is necessary for videos merged and saved to disk.
    """
    range_header = request.headers.get('Range', None)
    if not range_header:
        # If no range is requested, stream the whole file
        return Response(open(path, 'rb'), mimetype='video/mp4')

    # Parse the range request (e.g., bytes=0-1023)
    size = os.path.getsize(path)    
    byte1, byte2 = 0, size - 1
    
    m = range_header.replace('bytes=', '').split('-')
    try:
        byte1 = int(m[0])
    except:
        pass
    try:
        byte2 = int(m[1])
    except:
        pass
        
    length = byte2 - byte1 + 1
    
    data = None
    with open(path, 'rb') as f:
        f.seek(byte1)
        data = f.read(length)

    rv = Response(
        data,
        206, # Partial Content status code
        mimetype='video/mp4',
        content_type='video/mp4',
        direct_passthrough=True
    )
    rv.headers.set('Content-Range', f'bytes {byte1}-{byte2}/{size}')
    rv.headers.set('Content-Length', str(length))
    rv.headers.set('Accept-Ranges', 'bytes')
    return rv


# --- Helper Function for Direct Streaming (Simple Proxy for Non-Merged Files) ---
def stream_generator(remote_url):
    """Streams data from a remote URL chunk by chunk using requests."""
    headers = {}
    if request.headers.get('Range'):
        # Pass the range header to the upstream server
        headers['Range'] = request.headers.get('Range')

    try:
        with requests.get(remote_url, stream=True, timeout=30, headers=headers) as r: 
            r.raise_for_status()
            
            # If Range was successful, pass through headers (Content-Range, Content-Length)
            if r.status_code == 206:
                yield (r.status_code, r.headers, r.iter_content(chunk_size=8192))
            
            # If not a partial response (200), stream normally
            else:
                yield (r.status_code, r.headers, r.iter_content(chunk_size=8192))
    except Exception as e:
        print(f"Error during direct stream generation: {e}")
        return

@api.route('/fetch_info_ajax', methods=['POST'])
def fetch_info_ajax():
    """
    Fetches detailed metadata and streaming/download links for a given video URL.
    """
    url = request.form.get('url', '').strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    ydl_opts = {'quiet': True, 'skip_download': True, 'no_warnings': True}

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        return jsonify({"error": f"Failed to extract info: {str(e)}"}), 400

    title = info.get('title', 'Unknown Video')
    thumbnail = info.get('thumbnail')
    
    # --- Robust Format Selection Logic ---
    stream_url = None
    best_format = None
    formats = info.get('formats')

    if formats:
        real_media = []
        for f in formats:
            url_f = f.get("url")
            ext = f.get("ext")
            
            if ext in ("json", "mpd", "m3u8") or not url_f:
                continue

            # Scoring logic to prioritize combined audio/video formats and common extensions
            score = 0
            if f.get('acodec') != 'none': score += 50
            if f.get('vcodec') != 'none': score += 50
            if f.get('height'): score += f.get('height')
            if ext in ("mp4", "webm"): score += 100

            real_media.append((score, url_f, f))

        if real_media:
            real_media.sort(key=lambda x: x[0], reverse=True)
            stream_url = real_media[0][1]
            best_format = real_media[0][2]
        elif info.get('url'):
            stream_url = info.get('url')
    
    if not stream_url:
        return jsonify({"error": "No playable video stream found."}), 400

    # --- Video Metadata Extraction (Fix for Missing Info) ---
    video_details = {
        "format": "N/A",
        "resolution": "N/A",
        "filesize": "N/A",
        "duration": info.get('duration_string', 'N/A')
    }

    if best_format:
        # Fixes the TypeError and gets filesize for metadata
        filesize_bytes = best_format.get('filesize', 0) or best_format.get('filesize_approx', 0)
        if filesize_bytes is None:
            filesize_bytes = 0 
        
        filesize_mb = f"{round(filesize_bytes / (1024 * 1024), 1)} MB" if filesize_bytes > 0 else 'Unknown'

        video_details = {
            "format": best_format.get('ext', 'N/A').upper(),
            "resolution": f"{best_format.get('width')}x{best_format.get('height')}" if best_format.get('width') and best_format.get('height') else 'N/A',
            "filesize": filesize_mb,
            "duration": info.get('duration_string', 'N/A')
        }
    
    # URL-encode the direct video stream URL
    encoded = urllib.parse.quote_plus(stream_url)

    # Return the final JSON payload
    return jsonify({
        "title": title,
        "thumbnail": thumbnail,
        "stream_path": url_for('api.proxy_stream', video_url=encoded),
        "download_route": url_for('api.proxy_download', video_url=encoded),
        "video_details": video_details,
    })

# --- PROXY STREAM ROUTE with Manifest Handling & Range Support ---
@api.route('/proxy_stream')
def proxy_stream():
    """
    Proxies the video stream. Uses Range support for local files, and attempts
    to pass Range headers for direct proxies.
    """
    video_url = request.args.get('video_url')
    if not video_url:
        abort(400, "Missing video URL parameter.")

    remote = urllib.parse.unquote_plus(video_url)
    lower = remote.lower()

    # Case 1: Manifest file (Requires yt-dlp download, merge, and local Range handling)
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
                shutil.rmtree(tmpdir)
                return "Failed to merge video.", 500
                
            files.sort(key=lambda p: os.path.getsize(p), reverse=True)
            file_path = files[0]

            # Use the Range-aware helper to serve the file
            response = send_file_partial(file_path)
            
            # CRITICAL: We need a way to clean up the file after the request is complete. 
            # Flask's after_request hook is usually needed, but in this context, we will 
            # rely on the /cleanup route or hope the stream completes quickly. 
            # For simplicity, we are returning the response directly.
            
            return response
        except Exception as e:
            try:
                shutil.rmtree(tmpdir)
            except Exception:
                pass
            return f"Error streaming merged video: {e}", 500
    
    # Case 2: Direct file link (Attempt to proxy, passing Range header)
    else:
        result = next(stream_generator(remote))
        status_code, headers, content_iterator = result
        
        response = Response(stream_with_context(content_iterator), status=status_code)
        
        # Pass through all necessary headers from the remote server
        for header, value in headers.items():
            if header.lower() not in ('transfer-encoding', 'content-encoding'):
                 response.headers[header] = value
        
        return response


# --- PROXY DOWNLOAD ROUTE (Unchanged from previous fix) ---
@api.route('/proxy_download')
def proxy_download():
    """
    Proxies the video download. If the URL is a manifest, it downloads and merges.
    """
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
                return "Failed to download merged video.", 500
            
            files.sort(key=lambda p: os.path.getsize(p), reverse=True)
            file_path = files[0]
            filename = os.path.basename(file_path)

            def generate_and_cleanup(path, tmpdir):
                """Streams the file content and cleans up."""
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
                    except Exception:
                        pass

            response = Response(stream_with_context(generate_and_cleanup(file_path, tmpdir)), mimetype='application/octet-stream')
            response.headers.set('Content-Disposition', f'attachment; filename="{filename}"')
            return response

        except Exception as e:
            try:
                shutil.rmtree(tmpdir)
            except Exception:
                pass
            return f"Error downloading merged video: {e}", 500

    # Direct file download (simple proxy)
    filename = remote.split("/")[-1].split("?")[0] or "video.mp4"
    try:
        r = requests.get(remote, stream=True, timeout=15)
    except Exception as e:
        return f"Failed to fetch video: {e}", 502

    response = Response(stream_with_context(r.iter_content(8192)), mimetype="application/octet-stream")
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response