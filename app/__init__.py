from flask import Flask
from .routes import main
from .api import api

def create_app():
    app = Flask(__name__, static_folder="./static", template_folder="./templates")

    app.register_blueprint(main)
    app.register_blueprint(api)

    return app
