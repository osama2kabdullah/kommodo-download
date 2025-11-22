from flask import Blueprint, render_template
import os
import shutil
import tempfile

main = Blueprint('main', __name__)

@main.route('/')
def index():
    """Renders the main page."""
    return render_template('index.html')

@main.route('/about')
def about():
    """Renders the about page."""
    return render_template('about.html')

@main.route('/cleanup')
def cleanup_temp():
    """
    Deletes any leftover temporary folders created by yt-dlp during 
    the merge/stream processes.
    """
    temp_dir = tempfile.gettempdir()
    deleted = []
    
    # Iterate through the system's temporary directory
    for name in os.listdir(temp_dir):
        # Identify folders created by the proxy logic
        if name.startswith("kommodo_") or name.startswith("kommodo_dl_"):
            path = os.path.join(temp_dir, name)
            try:
                # Attempt to recursively delete the directory
                shutil.rmtree(path)
                deleted.append(name)
            except Exception:
                # Ignore errors for folders that are in use or protected
                pass
                
    return f"Deleted temporary folders: {', '.join(deleted)}" if deleted else "No leftover temporary folders found."