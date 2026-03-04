from google import genai
import os
from dotenv import load_dotenv

load_dotenv()
api_key = os.environ.get("GEMINI_API_KEY")
client = genai.Client(api_key=api_key)

print("Listing models...")
for m in client.models.list():
    print(f"Name: {m.name}, Default Version: {m.version}")
