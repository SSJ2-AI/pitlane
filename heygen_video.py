"""
heygen_video.py - TCG Signal video generation via HeyGen Talking Photo API.
"""
import base64
import json
import logging
import os
import re
import shutil
import sqlite3
import subprocess
import time
import uuid
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

HEYGEN_KEY = "sk_V2_hgu_kqX44BiXbeI_AkVbKbMvMSdI9XyB7fgFI2eTYoUNpmyc"
HEYGEN_BASE = "https://api.heygen.com"
DB_PATH = "/opt/tcg-signal-v2/tcg_signal.db"
WEB_ROOT = "/var/www/podcast4ads"
WEB_BASE = "https://podcast4ads.com"
CLIPS_DIR = f"{WEB_ROOT}/clips"
AUDIO_DIR = f"{WEB_ROOT}/audio_segments"
VIDEOS_DIR = f"{WEB_ROOT}/videos"

ALEX_PHOTO_ID = "fd0e1ca6a86a40b297c458ba5295ac4f"
MAYA_PHOTO_ID = "1dc814ae3a7f46c09d02272982f7b700"

BACKGROUNDS = {
    "dark_studio": f"{WEB_BASE}/backgrounds/bg_dark_studio.jpg",
    "neon_lab": f"{WEB_BASE}/backgrounds/bg_neon_lab.jpg",
    "cozy_shelf": f"{WEB_BASE}/backgrounds/bg_cozy_shelf.jpg",
    "tournament": f"{WEB_BASE}/backgrounds/bg_tournament.jpg",
    "minimal_dark": f"{WEB_BASE}/backgrounds/bg_minimal_dark.jpg",
}
DEFAULT_BG = "dark_studio"

VIDEO_JOB_SCHEMA = """
CREATE TABLE IF NOT EXISTS video_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER UNIQUE,
    episode_title TEXT,
    status TEXT DEFAULT 'pending',
    background_key TEXT DEFAULT 'dark_studio',
    video_url TEXT,
    shorts_url TEXT,
    video_path TEXT,
    shorts_path TEXT,
    clip_count INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    error_msg TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)
"""

for directory in (CLIPS_DIR, AUDIO_DIR, VIDEOS_DIR):
    Path(directory).mkdir(parents=True, exist_ok=True)


def _get_gemini_key():
    """Read the Gemini API key from the deployed environment."""
    env_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if env_key:
        return env_key.strip()

    env_path = "/opt/tcg-signal-v2/.env"
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                if "GEMINI" in key.upper() or "GOOGLE" in key.upper():
                    value = value.strip().strip("\"'")
                    if value:
                        return value

    agents_path = "/opt/tcg-signal-v2/agents.py"
    if os.path.exists(agents_path):
        with open(agents_path, "r", encoding="utf-8") as handle:
            for line in handle:
                if "GEMINI_API_KEY" in line or "GOOGLE_API_KEY" in line:
                    match = re.search(r'["\']([A-Za-z0-9_\-]{20,})["\']', line)
                    if match:
                        return match.group(1)

    return ""


def _generate_segment_audio(speaker, text, output_path):
    """Generate TTS audio using Gemini TTS and save it as an MP3 file."""
    api_key = _get_gemini_key()
    if not api_key:
        raise RuntimeError("Gemini API key not found in environment, .env, or agents.py")

    voice = "Aoede" if speaker.upper() == "ALEX" else "Iapetus"
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.5-flash-preview-tts:generateContent?key={api_key}"
    )
    payload = {
        "contents": [{"parts": [{"text": text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": voice,
                    }
                }
            },
        },
    }

    response = requests.post(url, json=payload, timeout=120)
    response.raise_for_status()
    data = response.json()

    try:
        inline_data = data["candidates"][0]["content"]["parts"][0]["inlineData"]
        audio_b64 = inline_data["data"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Unexpected Gemini TTS response: {json.dumps(data)[:1000]}") from exc

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    wav_path = str(output.with_suffix(".wav"))
    with open(wav_path, "wb") as handle:
        handle.write(base64.b64decode(audio_b64))

    subprocess.run(
        ["ffmpeg", "-y", "-i", wav_path, "-codec:a", "libmp3lame", "-q:a", "2", str(output)],
        check=True,
        capture_output=True,
    )
    os.remove(wav_path)
    os.chmod(output, 0o644)
    return str(output)


def _parse_script(script_text):
    """Parse script text into a list of (speaker, text) tuples."""
    segments = []
    if not script_text:
        return segments

    pattern = re.compile(
        r"\b(ALEX|MAYA)\b[:\s]+(.+?)(?=\b(?:ALEX|MAYA)\b[:\s]|$)",
        re.DOTALL | re.IGNORECASE,
    )
    for match in pattern.finditer(script_text):
        speaker = match.group(1).upper()
        text = re.sub(r"\s+", " ", match.group(2)).strip()
        if text:
            segments.append((speaker, text))
    return segments


def _merge_short_segments(segments, min_words=15):
    """Merge short adjacent segments when they belong to the same speaker."""
    if not segments:
        return segments

    merged = []
    index = 0
    while index < len(segments):
        speaker, text = segments[index]
        if len(text.split()) < min_words and index + 1 < len(segments):
            next_speaker, next_text = segments[index + 1]
            if next_speaker == speaker:
                segments[index + 1] = (speaker, f"{text} {next_text}".strip())
                index += 1
                continue
        merged.append((speaker, text))
        index += 1
    return merged


def _upload_audio_to_public(local_path):
    """Copy generated audio into the public web tree and return its HTTPS URL."""
    source = Path(local_path)
    if not source.exists():
        raise FileNotFoundError(str(source))

    Path(AUDIO_DIR).mkdir(parents=True, exist_ok=True)
    destination = Path(AUDIO_DIR) / source.name
    if source.resolve() != destination.resolve():
        shutil.copy2(source, destination)
    os.chmod(destination, 0o644)
    return f"{WEB_BASE}/audio_segments/{destination.name}"


def _heygen_generate_clip(talking_photo_id, audio_url, background_key):
    """Generate one talking-photo clip and return the completed video URL."""
    background_url = BACKGROUNDS.get(background_key, BACKGROUNDS[DEFAULT_BG])
    payload = {
        "video_inputs": [
            {
                "character": {
                    "type": "talking_photo",
                    "talking_photo_id": talking_photo_id,
                    "talking_style": "stable",
                    "scale": 1.0,
                },
                "voice": {
                    "type": "audio",
                    "audio_url": audio_url,
                },
                "background": {
                    "type": "image",
                    "url": background_url,
                },
            }
        ],
        "dimension": {"width": 1280, "height": 720},
        "caption": False,
    }

    for attempt in range(3):
        try:
            response = requests.post(
                f"{HEYGEN_BASE}/v2/video/generate",
                headers={"X-Api-Key": HEYGEN_KEY, "Content-Type": "application/json"},
                json=payload,
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            video_id = data["data"]["video_id"]
            logger.info("HeyGen video_id: %s", video_id)

            for _ in range(120):
                time.sleep(10)
                status_response = requests.get(
                    f"{HEYGEN_BASE}/v1/video_status.get?video_id={video_id}",
                    headers={"X-Api-Key": HEYGEN_KEY},
                    timeout=30,
                )
                status_response.raise_for_status()
                status_data = status_response.json()["data"]
                status = status_data["status"]
                logger.info("HeyGen status for %s: %s", video_id, status)
                if status == "completed":
                    return status_data["video_url"]
                if status == "failed":
                    raise RuntimeError(f"HeyGen failed: {status_data}")

            raise TimeoutError("HeyGen timeout after 20 minutes")
        except Exception as exc:
            if attempt == 2:
                raise
            wait_seconds = 5 * (2 ** attempt)
            logger.warning(
                "HeyGen attempt %s failed: %s. Retrying in %ss...",
                attempt + 1,
                exc,
                wait_seconds,
            )
            time.sleep(wait_seconds)

    raise RuntimeError("HeyGen generation failed without a specific error")


def _download_clip(url, output_path):
    """Download a generated video clip from HeyGen."""
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    response = requests.get(url, stream=True, timeout=120)
    response.raise_for_status()
    with open(output, "wb") as handle:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if chunk:
                handle.write(chunk)
    os.chmod(output, 0o644)
    return str(output)


def _assemble_video(clips, output_path):
    """Concatenate generated MP4 clips into one episode video."""
    if not clips:
        raise ValueError("No clips were provided for video assembly")

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    concat_file = output.with_suffix(output.suffix + ".concat.txt")
    with open(concat_file, "w", encoding="utf-8") as handle:
        for clip in clips:
            handle.write(f"file '{Path(clip).resolve()}'\n")

    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(output)],
        check=True,
        capture_output=True,
    )
    os.remove(concat_file)
    os.chmod(output, 0o644)
    return str(output)


def _make_shorts_cut(full_video_path, output_path, duration=59):
    """Create a short-form cut from the beginning of a full episode video."""
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-i", full_video_path, "-t", str(duration), "-c", "copy", str(output)],
        check=True,
        capture_output=True,
    )
    os.chmod(output, 0o644)
    return str(output)


def _init_db():
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(VIDEO_JOB_SCHEMA)
        conn.commit()
    finally:
        conn.close()


def _upsert_job(episode_id, **kwargs):
    conn = sqlite3.connect(DB_PATH)
    try:
        existing = conn.execute("SELECT id FROM video_jobs WHERE episode_id = ?", (episode_id,)).fetchone()
        if existing:
            assignments = [f"{key} = ?" for key in kwargs]
            values = list(kwargs.values())
            assignments.append("updated_at = datetime('now')")
            conn.execute(
                f"UPDATE video_jobs SET {', '.join(assignments)} WHERE episode_id = ?",
                values + [episode_id],
            )
        else:
            columns = ["episode_id"] + list(kwargs.keys())
            placeholders = ", ".join(["?"] * len(columns))
            conn.execute(
                f"INSERT INTO video_jobs ({', '.join(columns)}) VALUES ({placeholders})",
                [episode_id] + list(kwargs.values()),
            )
        conn.commit()
    finally:
        conn.close()


def _load_episode(episode_id):
    conn = sqlite3.connect(DB_PATH)
    try:
        row = conn.execute("SELECT title, script FROM episodes WHERE id = ?", (episode_id,)).fetchone()
    finally:
        conn.close()
    return row


def generate_episode_video(episode_id, background_key=DEFAULT_BG):
    """Generate full and Shorts videos for an episode."""
    _init_db()

    episode = _load_episode(episode_id)
    if not episode:
        raise ValueError(f"Episode {episode_id} not found")

    title, script = episode
    logger.info("Generating video for episode %s: %s", episode_id, title)
    _upsert_job(
        episode_id,
        episode_title=title,
        status="processing",
        background_key=background_key,
        error_msg=None,
    )

    try:
        segments = _merge_short_segments(_parse_script(script), min_words=15)
        if not segments:
            raise ValueError(f"Episode {episode_id} script did not contain ALEX/MAYA segments")
        logger.info("Parsed %s video segments", len(segments))

        clips = []
        total_cost = 0.0
        job_id = str(uuid.uuid4())[:8]

        for index, (speaker, text) in enumerate(segments):
            logger.info("Processing segment %s/%s: %s", index + 1, len(segments), speaker)
            audio_path = f"/tmp/tcg_{job_id}_{index}_{speaker.lower()}.mp3"
            _generate_segment_audio(speaker, text, audio_path)
            audio_url = _upload_audio_to_public(audio_path)

            photo_id = ALEX_PHOTO_ID if speaker == "ALEX" else MAYA_PHOTO_ID
            clip_url = _heygen_generate_clip(photo_id, audio_url, background_key)

            clip_path = f"{CLIPS_DIR}/clip_{job_id}_{index}.mp4"
            _download_clip(clip_url, clip_path)
            clips.append(clip_path)

            total_cost += 0.10
            _upsert_job(episode_id, clip_count=len(clips), cost_usd=total_cost)

        output_path = f"{VIDEOS_DIR}/ep{episode_id}_{job_id}.mp4"
        _assemble_video(clips, output_path)

        shorts_path = f"{VIDEOS_DIR}/ep{episode_id}_{job_id}_shorts.mp4"
        _make_shorts_cut(output_path, shorts_path)

        video_url = f"{WEB_BASE}/videos/ep{episode_id}_{job_id}.mp4"
        shorts_url = f"{WEB_BASE}/videos/ep{episode_id}_{job_id}_shorts.mp4"
        _upsert_job(
            episode_id,
            status="completed",
            video_url=video_url,
            shorts_url=shorts_url,
            video_path=output_path,
            shorts_path=shorts_path,
            cost_usd=total_cost,
            error_msg=None,
        )

        logger.info("Video complete: %s", video_url)
        return {"video_url": video_url, "shorts_url": shorts_url, "cost": total_cost}
    except Exception as exc:
        logger.exception("Video generation failed for episode %s", episode_id)
        _upsert_job(episode_id, status="failed", error_msg=str(exc))
        raise
