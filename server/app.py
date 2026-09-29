"""Manual Studio 解析サーバー（テスト実装）

動画 → 音声の文字起こし（faster-whisper・このPC内で処理）→ Claude で手順書の下書きと多言語訳を作る。
起動: server/start.sh（http://localhost:8000 で画面も配信する）
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

MODEL = os.getenv("CLAUDE_MODEL", "claude-opus-5-5")
EFFORT = os.getenv("CLAUDE_EFFORT", "medium")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
USD_JPY = float(os.getenv("USD_JPY", "150"))
MAX_FRAMES = int(os.getenv("MAX_FRAMES", "24"))
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
# 100万トークンあたりの料金（USD）。フォールバックで別モデルが動いた分もこの単価で概算する
PRICES = {"claude-opus-5-5": (4, 20), "claude-opus-5": (5, 25), "claude-sonnet-5-5": (2, 10), "claude-haiku-4-5": (1, 5)}
LANGS = {"en": "英語", "zh": "中国語（簡体字）", "th": "タイ語"}

client = anthropic.AsyncAnthropic()
app = FastAPI(title="Manual Studio 解析サーバー")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "https://ktamura-art.github.io,http://localhost:8765").split(","),
    allow_methods=["*"], allow_headers=["*"],
)


# ---------- 文字起こし ----------
_whisper = None


def whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    return _whisper


def has_audio(path: Path) -> bool:
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)], capture_output=True, text=True)
    return "Audio:" in r.stderr


def transcribe(video: Path, work: Path) -> dict:
    if not has_audio(video):
        return {"segments": [], "language": None, "note": "音声なし"}
    wav = work / "audio.wav"
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", str(wav)], check=True)
    segs, info = whisper().transcribe(str(wav), language="ja", vad_filter=True, beam_size=5)
    out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segs if s.text.strip()]
    return {"segments": out, "language": info.language, "note": ""}


# ---------- Claude ----------
def _str(desc=""):
    return {"type": "string", "description": desc} if desc else {"type": "string"}


TR_ITEM = {"type": "object", "properties": {"title": _str(), "desc": _str(), "ct": _str()}, "required": ["title", "desc", "ct"], "additionalProperties": False}
TR_SET = {"type": "object", "properties": {l: TR_ITEM for l in LANGS}, "required": list(LANGS), "additionalProperties": False}
STEP_SCHEMA = {
    "type": "object",
    "properties": {
        "start": {"type": "number", "description": "この手順が始まる動画内の秒数"},
        "scene": {"type": "integer", "description": "手順写真に使うシーン番号（0始まり）"},
        "title": _str("手順タイトル（日本語）"),
        "desc": _str("作業内容（日本語）。1行1動作、改行区切り"),
        "lv": {"type": "string", "enum": ["none", "caution", "warning", "danger"]},
        "ct": _str("注意文（日本語）。lv が none なら空文字"),
        "review": _str("人が確認すべき点。確信がなければ具体的に書く。問題なければ空文字"),
        "tr": TR_SET,
    },
    "required": ["start", "scene", "title", "desc", "lv", "ct", "review", "tr"],
    "additionalProperties": False,
}
TEXTS_TR = {"type": "object", "properties": {l: _str() for l in LANGS}, "required": list(LANGS), "additionalProperties": False}
ANALYZE_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": _str("動画全体で何を説明しているかの要約（日本語・2〜3文）"),
        "steps": {"type": "array", "items": STEP_SCHEMA},
        "notes": _str("作業全体の注意事項（日本語）。改行区切り。なければ空文字"),
        "notes_tr": TEXTS_TR,
        "ppe": {"type": "array", "items": _str(), "description": "必要な保護具（映像・音声から分かるものだけ）"},
    },
    "required": ["summary", "steps", "notes", "notes_tr", "ppe"],
    "additionalProperties": False,
}

SYSTEM = """あなたは製造業の現場向けに、作業動画から操作マニュアル（作業手順書）の下書きを作る担当者です。
入力は、作業者が撮影した動画のナレーションの文字起こし（秒数つき）と、画面の切り替わりで分けたシーンごとの代表写真です。

手順書の作り方:
- 新任や外国籍の作業者が、手順書だけを見て同じ作業ができるように書きます。
- 手順は作業の区切りごとに分けます。シーンの切り替わりは目安で、ナレーションの内容を優先して結合・分割してかまいません。
- start はその手順の開始秒、scene はその手順を最もよく表す写真のシーン番号です。
- title は「〜する」「〜を確認する」のような短い動作の形にします。
- desc は1行に1動作で、確認すべき表示やランプの状態があれば「〜を確認します」と書きます。
- 映像と音声から確かめられないことは書きません。推測で補った箇所や聞き取れない箇所は review に具体的に書きます。
- 安全上の注意レベル: 挟まれ・巻き込まれ・感電・墜落など重大な災害につながるものは danger、非常停止・起動・高温・重量物など事故につながるものは warning、保護具や確認の徹底は caution。該当しなければ none。
- tr には、各手順の title・desc・ct の英語・中国語（簡体字）・タイ語訳を入れます。desc の訳は日本語と同じ行数にします。現場で使う短く平易な表現にし、型番・画面表示（例: AUTO, E-STOP）は原文のまま残します。"""


def cost(usage, model: str) -> dict:
    pin, pout = PRICES.get(model, PRICES["claude-opus-5-5"])
    inp = (usage.input_tokens or 0) + (getattr(usage, "cache_creation_input_tokens", 0) or 0) * 1.25 + (getattr(usage, "cache_read_input_tokens", 0) or 0) * 0.1
    usd = inp / 1e6 * pin + (usage.output_tokens or 0) / 1e6 * pout
    return {"model": model, "input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens, "usd": round(usd, 4), "jpy": round(usd * USD_JPY, 1)}


async def ask_claude(content: list, schema: dict, system: str) -> tuple[dict, dict]:
    if not (os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN")):
        raise HTTPException(401, "Claude API のキーが未設定です（server/.env の ANTHROPIC_API_KEY に入れて、サーバーを起動し直してください）")
    async with client.beta.messages.stream(
        model=MODEL,
        max_tokens=64000,
        system=system,
        thinking={"type": "adaptive"},
        output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": schema}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        messages=[{"role": "user", "content": content}],
    ) as stream:
        msg = await stream.get_final_message()
    if msg.stop_reason == "refusal":
        raise HTTPException(422, f"Claude が処理を断りました（{getattr(msg.stop_details, 'category', '') or '理由不明'}）")
    if msg.stop_reason == "max_tokens":
        raise HTTPException(502, "出力が長すぎて途中で切れました。動画を短く分けてお試しください")
    text = next(b.text for b in msg.content if b.type == "text")
    return json.loads(text), cost(msg.usage, msg.model)


def fmt_meta(meta: dict) -> str:
    keys = [("title", "マニュアル名"), ("equipment", "設備"), ("process", "工程"), ("line", "ライン・場所"), ("target", "対象者"), ("ppe", "既定の保護具")]
    style = "です・ます調" if meta.get("style", "desu") == "desu" else "である調（〜する）"
    lines = [f"{l}: {meta[k]}" for k, l in keys if meta.get(k)]
    return "\n".join(lines + [f"文体: {style}"])


# ---------- API ----------
@app.get("/api/health")
async def health():
    key = bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))
    return {"ok": True, "model": MODEL, "effort": EFFORT, "whisper": WHISPER_MODEL, "ffmpeg": Path(FFMPEG).exists(), "api_key": key, "usd_jpy": USD_JPY}


@app.post("/api/analyze")
async def analyze(video: UploadFile = File(...), meta: str = Form("{}"), scenes: str = Form("[]"), frames: list[UploadFile] = File(default=[])):
    """進み具合を1行ずつの JSON（NDJSON）で返し、最後の行に結果を入れる。"""
    meta_d, scenes_d = json.loads(meta), json.loads(scenes)
    work = Path(tempfile.mkdtemp(prefix="vms_"))
    vpath = work / ("video" + Path(video.filename or "v.mp4").suffix)
    with vpath.open("wb") as f:
        shutil.copyfileobj(video.file, f)
    frame_bytes = [await fr.read() for fr in frames]

    async def run():
        def ev(**k):
            return json.dumps(k, ensure_ascii=False) + "\n"
        try:
            t0 = time.time()
            yield ev(stage="asr", status="run", note=f"音声を文字起こし中（{WHISPER_MODEL} モデル・このPC内で処理）")
            tr = await asyncio.to_thread(transcribe, vpath, work)
            segs = tr["segments"]
            yield ev(stage="asr", status="done", note=(f"{len(segs)} 区間を文字起こし（{time.time() - t0:.0f} 秒）" if segs else "音声がないため、写真だけで手順を作ります"), transcript=segs)

            yield ev(stage="gen", status="run", note=f"{MODEL} が手順書を作成中")
            t1 = time.time()
            # 写真が多すぎるときは間引く（シーン番号は元のまま渡す）
            idx = list(range(len(frame_bytes)))
            if len(idx) > MAX_FRAMES:
                step = len(idx) / MAX_FRAMES
                idx = [idx[int(i * step)] for i in range(MAX_FRAMES)]
            content = [{"type": "text", "text": f"# マニュアル情報\n{fmt_meta(meta_d)}\n動画の長さ: {meta_d.get('duration', 0):.1f} 秒"}]
            for i in idx:
                s = scenes_d[i] if i < len(scenes_d) else {"t": 0, "e": 0}
                content.append({"type": "text", "text": f"シーン {i}（{s['t']:.1f}〜{s['e']:.1f} 秒）"})
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.standard_b64encode(frame_bytes[i]).decode()}})
            script = "\n".join(f"[{s['start']:.1f}-{s['end']:.1f}] {s['text']}" for s in segs) or "（音声なし。写真と画面表示から作業内容を読み取ってください）"
            content.append({"type": "text", "text": f"# ナレーションの文字起こし\n{script}\n\nこの動画から作業手順書の下書きを作ってください。"})
            data, c = await ask_claude(content, ANALYZE_SCHEMA, SYSTEM)
            yield ev(stage="gen", status="done", note=f"{len(data['steps'])} 手順を作成（{time.time() - t1:.0f} 秒・約 {c['jpy']:.0f} 円）")
            yield ev(stage="tr", status="done", note="英語・中国語・タイ語の訳も同時に作成")
            yield ev(stage="done", result={**data, "transcript": segs, "cost": c, "seconds": round(time.time() - t0)})
        except HTTPException as e:
            yield ev(stage="error", message=e.detail)
        except anthropic.AuthenticationError:
            yield ev(stage="error", message="Claude API のキーが正しくありません（server/.env を確認してください）")
        except anthropic.RateLimitError:
            yield ev(stage="error", message="Claude API の利用上限に達しました。しばらく待ってから再度お試しください")
        except anthropic.APIConnectionError:
            yield ev(stage="error", message="Claude API に接続できません（ネットワークを確認してください）")
        except anthropic.APIStatusError as e:
            yield ev(stage="error", message=f"Claude API のエラー（{e.status_code}）: {e.message}")
        except Exception as e:  # noqa: BLE001 - 画面にそのまま出す
            yield ev(stage="error", message=f"{type(e).__name__}: {e}")
        finally:
            shutil.rmtree(work, ignore_errors=True)

    return StreamingResponse(run(), media_type="application/x-ndjson")


class TrItems(BaseModel):
    lang: str
    steps: list[dict] = []     # {id, title, desc, ct}
    texts: dict[str, str] = {}  # 任意のID → 日本語（注釈の文字・タイトル・注意事項など）


@app.post("/api/translate")
async def translate(req: TrItems):
    if req.lang not in LANGS:
        raise HTTPException(400, "対応していない言語です")
    schema = {
        "type": "object",
        "properties": {
            "steps": {"type": "array", "items": {"type": "object", "properties": {"id": _str(), "title": _str(), "desc": _str(), "ct": _str()}, "required": ["id", "title", "desc", "ct"], "additionalProperties": False}},
            "texts": {"type": "array", "items": {"type": "object", "properties": {"id": _str(), "text": _str()}, "required": ["id", "text"], "additionalProperties": False}},
        },
        "required": ["steps", "texts"],
        "additionalProperties": False,
    }
    system = (f"製造現場の作業手順書を{LANGS[req.lang]}に翻訳します。現場で使う短く平易な表現にし、型番・画面表示（例: AUTO, E-STOP）は原文のまま残します。"
              "desc は日本語と同じ行数にします。空の項目は空文字のまま返します。id は変えずに返します。")
    payload = {"steps": req.steps, "texts": [{"id": k, "text": v} for k, v in req.texts.items()]}
    try:
        data, c = await ask_claude([{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}], schema, system)
    except anthropic.APIError as e:
        raise HTTPException(502, f"Claude API のエラー: {e}") from e
    return {"steps": data["steps"], "texts": {t["id"]: t["text"] for t in data["texts"]}, "cost": c}


class PublicFiles(StaticFiles):
    """画面のファイルだけを配信する（server/ 以下や .env などの隠しファイルは出さない）"""

    def lookup_path(self, path: str):
        parts = Path(path).parts
        if parts and (parts[0] == "server" or any(p.startswith(".") for p in parts)):
            return "", None
        return super().lookup_path(path)


# 画面（リポジトリ直下の index.html など）も同じサーバーから配信する
app.mount("/", PublicFiles(directory=ROOT.parent, html=True), name="static")
