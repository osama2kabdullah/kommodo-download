from app import create_app

app = create_app()

# Vercel needs a variable called "app"
handler = app