"""OpenRouter API smoke test: one text-only call, one vision call.

Reads OPENROUTER_API_KEY from .env in this directory. Never prints the key.
"""

import json
import urllib.request
import urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).parent / ".env"
API_URL = "https://openrouter.ai/api/v1/chat/completions"

TEXT_MODEL = "cohere/north-mini-code:free"
IMAGE_MODEL = "google/gemma-4-26b-a4b-it:free"

# 1x1 red pixel PNG, used as a minimal, self-contained test image.
TEST_IMAGE_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42"
    "YAAAAASUVORK5CYII="
)


def load_api_key() -> str:
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("OPENROUTER_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("OPENROUTER_API_KEY not found in .env")


def call_model(api_key: str, model: str, messages: list) -> dict:
    payload = json.dumps({"model": model, "messages": messages}).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return {"status": resp.status, "body": json.loads(resp.read().decode("utf-8"))}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(body)
        except json.JSONDecodeError:
            pass
        return {"status": e.code, "body": body}


def summarize(label: str, result: dict) -> None:
    print(f"\n=== {label} ===")
    print(f"HTTP status: {result['status']}")
    body = result["body"]
    if result["status"] == 200:
        try:
            content = body["choices"][0]["message"]["content"]
            print(f"Model reply: {content}")
        except (KeyError, IndexError, TypeError):
            print(f"Unexpected response shape: {json.dumps(body, ensure_ascii=False)[:500]}")
    else:
        print(f"Error body: {json.dumps(body, ensure_ascii=False)[:500]}")


def main() -> None:
    api_key = load_api_key()

    text_result = call_model(
        api_key,
        TEXT_MODEL,
        [{"role": "user", "content": "한 문장으로 'API 테스트 성공'이라고 한국어로 답해줘."}],
    )
    summarize(f"텍스트 테스트 ({TEXT_MODEL})", text_result)

    image_result = call_model(
        api_key,
        IMAGE_MODEL,
        [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "이 이미지의 색상을 한 단어로 말해줘."},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{TEST_IMAGE_B64}"},
                    },
                ],
            }
        ],
    )
    summarize(f"이미지 테스트 ({IMAGE_MODEL})", image_result)


if __name__ == "__main__":
    main()
