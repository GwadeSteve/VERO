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
    async def generate_response(
        self,
        system_prompt: str,
        user_prompt: str,
        messages: list[dict] | None = None,
    ) -> str:
        """Generate a response given a system and user prompt.
        
        If `messages` is provided it is used directly (multi-turn mode).
        """
        pass


class GroqProvider(BaseLLM):
    """Groq Cloud integration via their OpenAI-compatible API.
    Free tier: 30 RPM, 14,400 RPD. Sign up at console.groq.com.

    Configure via environment variables:
        GROQ_API_KEY    -- required
        VERO_GROQ_MODEL -- optional (default: llama-3.3-70b-versatile)

    Available models (same API, just change the name):
        llama-3.3-70b-versatile -- best quality for research (recommended)
        llama-3.1-70b-versatile -- strong all-around
        llama-3.1-8b-instant    -- fastest, good for CI and quick answers
        gemma2-9b-it            -- lighter alternative
    """

    GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
    MAX_RETRIES = 3

    def __init__(self, model_name: str = "llama-3.3-70b-versatile"):
        self.api_key = os.environ.get("GROQ_API_KEY")
        if not self.api_key:
            raise ValueError("GROQ_API_KEY environment variable not set. Get one at https://console.groq.com.")
        self.model_name = os.environ.get("VERO_GROQ_MODEL", model_name)

    async def generate_response(
        self,
        system_prompt: str,
        user_prompt: str,
        messages: list[dict] | None = None,
    ) -> str:
        """Generate response via Groq with automatic retry on transient errors.
        
        If `messages` is provided it is used directly (multi-turn mode).
        Otherwise a simple [system, user] pair is sent.
        """
        last_error = None

        if messages is None:
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]

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
                            "messages": messages,
                            "temperature": 0.2,
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

    async def generate_response(
        self,
        system_prompt: str,
        user_prompt: str,
        messages: list[dict] | None = None,
    ) -> str:
        """Generate response via Gemini using async generation.

        When `messages` is provided (multi-turn mode), converts the OpenAI-style
        message list to Gemini's Content format. The system message is extracted
        and passed as system_instruction.
        """
        try:
            # Build contents from messages if provided (multi-turn mode)
            if messages:
                contents = []
                extracted_system = system_prompt
                for msg in messages:
                    role = msg.get("role", "user")
                    content = msg.get("content", "")
                    if role == "system":
                        extracted_system = content
                        continue  # System prompt goes to system_instruction
                    # Gemini uses "user" and "model" (not "assistant")
                    gemini_role = "model" if role == "assistant" else "user"
                    contents.append(
                        self._types.Content(
                            role=gemini_role,
                            parts=[self._types.Part(text=content)],
                        )
                    )

                response = await self.client.aio.models.generate_content(
                    model=self.model_name,
                    contents=contents,
                    config=self._types.GenerateContentConfig(
                        system_instruction=extracted_system,
                        safety_settings=self.safety_settings,
                    )
                )
            else:
                # Simple single-turn mode
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

    async def generate_response(
        self,
        system_prompt: str,
        user_prompt: str,
        messages: list[dict] | None = None,
    ) -> str:
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


class FallbackLLM(BaseLLM):
    """Wrapper that tries a primary provider, then falls back to a secondary on failure."""

    def __init__(self, primary: BaseLLM, fallback: BaseLLM):
        self._primary = primary
        self._fallback = fallback

    async def generate_response(
        self,
        system_prompt: str,
        user_prompt: str,
        messages: list[dict] | None = None,
    ) -> str:
        try:
            return await self._primary.generate_response(system_prompt, user_prompt, messages)
        except Exception as primary_error:
            logger.warning(
                "Primary LLM (%s) failed: %s. Falling back to %s.",
                type(self._primary).__name__, primary_error,
                type(self._fallback).__name__,
            )
            try:
                return await self._fallback.generate_response(system_prompt, user_prompt, messages)
            except Exception as fallback_error:
                logger.error(
                    "Fallback LLM (%s) also failed: %s",
                    type(self._fallback).__name__, fallback_error,
                )
                # Raise the original primary error (more relevant to the user)
                raise primary_error


def get_llm() -> BaseLLM:
    """Factory to get the configured LLM provider with automatic fallback.

    Set VERO_LLM_PROVIDER to: 'groq' (default), 'gemini', or 'ollama'.
    Models are configured via VERO_GROQ_MODEL, VERO_GEMINI_MODEL, or VERO_OLLAMA_MODEL.

    If VERO_LLM_FALLBACK is set to 'true' (default), the factory wraps
    the primary provider with a fallback to prevent API outages from
    blocking the user.
    """
    provider = os.environ.get("VERO_LLM_PROVIDER", "groq").lower()
    enable_fallback = os.environ.get("VERO_LLM_FALLBACK", "true").lower() == "true"
    logger.info("LLM provider: %s (fallback=%s)", provider, enable_fallback)

    if provider == "gemini":
        primary = GeminiProvider()
        if enable_fallback:
            try:
                fallback = GroqProvider()
                return FallbackLLM(primary, fallback)
            except ValueError:
                logger.warning("Fallback provider (Groq) not configured, running Gemini-only.")
        return primary

    elif provider == "ollama":
        return OllamaProvider()

    # Default: Groq primary
    primary = GroqProvider()
    if enable_fallback:
        try:
            fallback = GeminiProvider()
            return FallbackLLM(primary, fallback)
        except ValueError:
            logger.warning("Fallback provider (Gemini) not configured, running Groq-only.")
    return primary

