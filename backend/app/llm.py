"""VERO LLM Interface: Provider-agnostic wrappers for Answer Generation.

Supports: Groq (default), Google Gemini, and local Ollama.
Set VERO_LLM_PROVIDER in .env to switch providers.
"""

from __future__ import annotations

import asyncio
import logging
import os
import httpx
from abc import ABC, abstractmethod
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()


class BaseLLM(ABC):
    """Abstract interface for LLM providers."""

    @abstractmethod
    async def generate_response(self, system_prompt: str, user_prompt: str) -> str:
        """Generate a response given a system and user prompt."""
        pass


class GroqProvider(BaseLLM):
    """Groq Cloud integration via their OpenAI-compatible API.
    Free tier: 30 RPM, 14,400 RPD. Sign up at console.groq.com.

    Configure via environment variables:
        GROQ_API_KEY    -- required
        VERO_GROQ_MODEL -- optional (default: llama-3.1-8b-instant)

    Available models (same API, just change the name):
        llama-3.1-8b-instant    -- fastest, good for CI and quick answers
        llama-3.1-70b-versatile -- best quality for research
        mixtral-8x7b-32768      -- long context (32k tokens)
        gemma2-9b-it            -- lighter alternative
    """

    GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
    MAX_RETRIES = 3

    def __init__(self, model_name: str = "llama-3.1-8b-instant"):
        self.api_key = os.environ.get("GROQ_API_KEY")
        if not self.api_key:
            raise ValueError("GROQ_API_KEY environment variable not set. Get one at https://console.groq.com.")
        self.model_name = os.environ.get("VERO_GROQ_MODEL", model_name)

    async def generate_response(self, system_prompt: str, user_prompt: str) -> str:
        """Generate response via Groq with automatic retry on transient errors."""
        last_error = None

        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    response = await client.post(
                        self.GROQ_API_URL,
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": self.model_name,
                            "messages": [
                                {"role": "system", "content": system_prompt},
                                {"role": "user", "content": user_prompt},
                            ],
                            "temperature": 0.3,
                            "max_tokens": 2048,
                        },
                    )
                    response.raise_for_status()
                    return response.json()["choices"][0]["message"]["content"]

            except httpx.HTTPStatusError as e:
                last_error = e
                # Retry on rate limit (429) or server errors (5xx)
                if e.response.status_code in (429, 500, 502, 503):
                    wait = 2 ** attempt
                    logger.warning(
                        "Groq API %d error (attempt %d/%d), retrying in %ds...",
                        e.response.status_code, attempt, self.MAX_RETRIES, wait,
                    )
                    await asyncio.sleep(wait)
                    continue
                logger.error("Groq API error: %s", e)
                raise
            except Exception as e:
                logger.error("Groq API error: %s", e)
                raise

        # All retries exhausted
        raise last_error


class GeminiProvider(BaseLLM):
    """Google Gemini integration using the google-genai SDK."""

    def __init__(self, model_name: str = "gemini-2.5-flash-lite"):
        from google import genai
        from google.genai import types
        self._types = types

        self.api_key = os.environ.get("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY environment variable not set.")

        self.client = genai.Client(api_key=self.api_key)
        self.model_name = os.environ.get("VERO_GEMINI_MODEL", model_name)

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
                config=self._types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    safety_settings=self.safety_settings,
                )
            )
            return response.text
        except Exception as e:
            logger.error("Gemini API error: %s", e)
            raise


class OllamaProvider(BaseLLM):
    """Local Ollama integration for unlimited, private research.
    Requires Ollama running locally (https://ollama.com).
    """

    def __init__(self, model_name: str = "llama3.1"):
        self.model_name = os.environ.get("VERO_OLLAMA_MODEL", model_name)
        self.base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

    async def generate_response(self, system_prompt: str, user_prompt: str) -> str:
        """Generate response via local Ollama API."""
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                response = await client.post(
                    f"{self.base_url}/api/generate",
                    json={
                        "model": self.model_name,
                        "system": system_prompt,
                        "prompt": user_prompt,
                        "stream": False,
                    }
                )
                response.raise_for_status()
                return response.json()["response"]
        except Exception as e:
            logger.error("Ollama error: %s. Is Ollama running at %s?", e, self.base_url)
            raise


def get_llm() -> BaseLLM:
    """Factory to get the configured LLM provider.

    Set VERO_LLM_PROVIDER to: 'groq' (default), 'gemini', or 'ollama'.
    Models are configured via VERO_GROQ_MODEL, VERO_GEMINI_MODEL, or VERO_OLLAMA_MODEL.
    """
    provider = os.environ.get("VERO_LLM_PROVIDER", "groq").lower()
    logger.info("LLM provider: %s", provider)

    if provider == "gemini":
        return GeminiProvider()
    elif provider == "ollama":
        return OllamaProvider()

    # Default to Groq
    return GroqProvider()

