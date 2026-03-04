"""VERO LLM Interface: Provider-agnostic wrappers for Answer Generation.

Currently supports Google Gemini. Can be extended to OpenAI or local Ollama.
"""

from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod

from dotenv import load_dotenv
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold

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
    """Google Gemini integration using google-generativeai."""

    def __init__(self, model_name: str = "gemini-2.0-flash"):
        self.api_key = os.environ.get("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY environment variable not set. Please set it in a .env file or environment.")
        
        genai.configure(api_key=self.api_key)
        
        # Configure model with safety settings (permissive for research)
        self.model = genai.GenerativeModel(
            model_name=model_name,
            safety_settings={
                HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
                HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
                HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
                HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
            }
        )

    async def generate_response(self, system_prompt: str, user_prompt: str) -> str:
        """Generate response via Gemini using async generation."""
        try:
            # Gemini uses a single contents payload, or we can use chat history for system instructions.
            # Best practice for generative model is to pass system instruction in the model constructor if possible,
            # or prepend to the user prompt. We will recreate the model here if system instruction is provided.
            model = genai.GenerativeModel(
                model_name=self.model.model_name,
                system_instruction=system_prompt,
                safety_settings=self.model._safety_settings
            )
            
            response = await model.generate_content_async(user_prompt)
            return response.text
        except Exception as e:
            logger.error("Gemini API error: %s", e)
            raise


def get_llm() -> BaseLLM:
    """Factory to get the configured LLM provider."""
    # We can inject different providers based on environment variables later.
    return GeminiProvider()
