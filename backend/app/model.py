import os
import requests
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv(override=True)

# Clarifai OpenAI-proxy model IDs (full versioned URLs)
CLARIFAI_GEMINI_FLASH_LITE = (
    "https://clarifai.com/gcp/generate/models/gemini-3_1-flash-lite-preview/versions/110acf0cc7574bfd83fedea1cfd2ef82"
)
CLARIFAI_DEEPSEEK_V3_2 = (
    "https://clarifai.com/deepseek-ai/deepseek-chat/models/deepseek-v3_2/versions/"
    "dcd4f2e00a864aca8c2b787a8a9d9b84"
)


class VLMModel:
    def __init__(
        self,
        provider: str = "clarifai",
        clarifai_model_id: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ):
        self.provider = provider
        self._max_tokens = max_tokens
        self._temperature = temperature
        if provider == "clarifai":
            self.api_key = os.getenv("CLARIFAI_API_KEY", "")
            self.base_url = "https://api.clarifai.com/v2/ext/openai/v1/chat/completions"
            self.model_name = clarifai_model_id or CLARIFAI_GEMINI_FLASH_LITE
        elif provider == "baseten":
            self.api_key = os.getenv("NEMOTRON_API_KEY", "")
            self.base_url = "https://inference.baseten.co/v1/chat/completions"
            self.model_name = "nvidia/Nemotron-120B-A12B"
        else:
            raise Exception("Unknown provider")

    def invoke(self, messages: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Cross-provider HTTP invoke (OpenAI structure)
        """
        try:
            if self.provider == "clarifai":
                payload = {
                    "model": self.model_name,
                    "messages": messages,
                    "temperature": 0.4 if self._temperature is None else self._temperature,
                    "max_tokens": 4096 if self._max_tokens is None else self._max_tokens,
                }
            else:
                payload = {
                    "model": self.model_name,
                    "messages": messages,
                    "temperature": 0.35 if self._temperature is None else self._temperature,
                    "max_tokens": 8192 if self._max_tokens is None else self._max_tokens,
                }
            
            response = requests.post(
                url=self.base_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=120
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                print(f"Error {self.provider} {response.status_code}: {response.text}")
                raise Exception(f"Failed {self.provider}: {response.text}")
                
        except Exception as e:
            raise Exception(f"Request error: {e}")