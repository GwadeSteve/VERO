"""VERO LLM Interface: Provider-agnostic wrappers for Answer Generation.

Currently supports Google Gemini. Can be extended to OpenAI or local Ollama.
"""

from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from dotenv import load_dotenv

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()


class BaseLLM(ABC):
    """Abstract interface for LLM providers."""

    @abstractmethod
    async def generate_response(self, system_prompt: str, user_prompt: str) -> str:
        """Generate a response given a system and user prompt."""
        pass


class GeminiProvider(BaseLLM):
    """Google Gemini integration using the new google-genai SDK."""

    def __init__(self, model_name: str = "gemini-2.5-flash"):
        self.api_key = os.environ.get("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY environment variable not set. Please set it in a .env file or environment.")
        
        self.client = genai.Client(api_key=self.api_key)
        self.model_name = model_name

        # Define permissive safety settings for technical research content
        self.safety_settings = [
            types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_HARASSMENT, threshold=types.HarmBlockThreshold.BLOCK_NONE),
            types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold=types.HarmBlockThreshold.BLOCK_NONE),
            types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold=types.HarmBlockThreshold.BLOCK_NONE),
            types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold=types.HarmBlockThreshold.BLOCK_NONE),
        ]

    async def generate_response(self, system_prompt: str, user_prompt: str) -> str:
        """Generate response via Gemini using async generation."""
        try:
            response = await self.client.aio.models.generate_content(
                model=self.model_name,
                contents=user_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    safety_settings=self.safety_settings,
                )
            )
            return response.text
        except Exception as e:
            logger.error("Gemini API error: %s", e)
            raise


def get_llm() -> BaseLLM:
    """Factory to get the configured LLM provider."""
    # We can inject different providers based on environment variables later.
    return GeminiProvider()
