"""
dashboard_update.py - Video Studio API routes for the TCG Signal dashboard.

Deploy this file to /opt/tcg-signal-v2/dashboard/dashboard_update.py and register it
from dashboard/app.py with:

    from dashboard_update import register_video_routes
    register_video_routes(app)
"""
import sqlite3
import threading
from pathlib import Path

from flask import Blueprint, jsonify, request

DB_PATH = "/opt/tcg-signal-v2/tcg_signal.db"
WEB_BASE = "https://podcast4ads.com"

BACKGROUNDS = {
    "dark_studio": {
        "key": "dark_studio",
        "label": "Dark Studio",
        "url": f"{WEB_BASE}/backgrounds/bg_dark_studio.jpg",
    },
    "neon_lab": {
        "key": "neon_lab",
        "label": "Neon Lab",
        "url": f"{WEB_BASE}/backgrounds/bg_neon_lab.jpg",
    },
    "cozy_shelf": {
        "key": "cozy_shelf",
        "label": "Cozy Shelf",
        "url": f"{WEB_BASE}/backgrounds/bg_cozy_shelf.jpg",
    },
    "tournament": {
        "key": "tournament",
        "label": "Tournament",
        "url": f"{WEB_BASE}/backgrounds/bg_tournament.jpg",
    },
    "minimal_dark": {
        "key": "minimal_dark",
        "label": "Minimal Dark",
        "url": f"{WEB_BASE}/backgrounds/bg_minimal_dark.jpg",
    },
}

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

video_blueprint = Blueprint("video_studio", __name__)


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_video_jobs_table():
    conn = _connect()
    try:
        conn.execute(VIDEO_JOB_SCHEMA)
        conn.commit()
    finally:
        conn.close()


def _row_to_dict(row):
    return dict(row) if row is not None else None


def _upsert_processing_job(episode_id, background_key):
    conn = _connect()
    try:
        episode = conn.execute("SELECT title FROM episodes WHERE id = ?", (episode_id,)).fetchone()
        if episode is None:
            return None
        existing = conn.execute("SELECT id FROM video_jobs WHERE episode_id = ?", (episode_id,)).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE video_jobs
                SET episode_title = ?, status = 'queued', background_key = ?,
                    error_msg = NULL, updated_at = datetime('now')
                WHERE episode_id = ?
                """,
                (episode["title"], background_key, episode_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO video_jobs (episode_id, episode_title, status, background_key)
                VALUES (?, ?, 'queued', ?)
                """,
                (episode_id, episode["title"], background_key),
            )
        conn.commit()
        return episode["title"]
    finally:
        conn.close()


def _generate_video_worker(episode_id, background_key):
    try:
        from heygen_video import generate_episode_video

        generate_episode_video(episode_id, background_key=background_key)
    except Exception as exc:
        conn = _connect()
        try:
            conn.execute(
                """
                UPDATE video_jobs
                SET status = 'failed', error_msg = ?, updated_at = datetime('now')
                WHERE episode_id = ?
                """,
                (str(exc), episode_id),
            )
            conn.commit()
        finally:
            conn.close()


@video_blueprint.route("/api/video-jobs", methods=["GET"])
def api_video_jobs():
    _init_video_jobs_table()
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT id, episode_id, episode_title, status, background_key,
                   video_url, shorts_url, video_path, shorts_path, clip_count,
                   cost_usd, error_msg, created_at, updated_at
            FROM video_jobs
            ORDER BY updated_at DESC, id DESC
            """
        ).fetchall()
        return jsonify([_row_to_dict(row) for row in rows])
    finally:
        conn.close()


@video_blueprint.route("/api/video-episodes", methods=["GET"])
def api_video_episodes():
    _init_video_jobs_table()
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT e.id AS episode_id, e.title,
                   COALESCE(v.status, 'not_started') AS status,
                   v.background_key, v.video_url, v.shorts_url, v.cost_usd,
                   v.clip_count, v.error_msg, v.updated_at
            FROM episodes e
            LEFT JOIN video_jobs v ON v.episode_id = e.id
            ORDER BY e.id DESC
            LIMIT 100
            """
        ).fetchall()
        return jsonify([_row_to_dict(row) for row in rows])
    finally:
        conn.close()


@video_blueprint.route("/api/video/generate", methods=["POST"])
def api_generate_video():
    _init_video_jobs_table()
    data = request.get_json(silent=True) or {}
    episode_id = data.get("episode_id")
    background_key = data.get("background_key") or "dark_studio"

    try:
        episode_id = int(episode_id)
    except (TypeError, ValueError):
        return jsonify({"error": "episode_id is required and must be an integer"}), 400

    if background_key not in BACKGROUNDS:
        return jsonify({"error": f"Unknown background_key: {background_key}"}), 400

    title = _upsert_processing_job(episode_id, background_key)
    if title is None:
        return jsonify({"error": f"Episode {episode_id} not found"}), 404

    thread = threading.Thread(
        target=_generate_video_worker,
        args=(episode_id, background_key),
        daemon=True,
    )
    thread.start()
    return jsonify(
        {
            "episode_id": episode_id,
            "episode_title": title,
            "background_key": background_key,
            "status": "queued",
        }
    ), 202


@video_blueprint.route("/api/video/status/<int:episode_id>", methods=["GET"])
def api_video_status(episode_id):
    _init_video_jobs_table()
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM video_jobs WHERE episode_id = ?", (episode_id,)).fetchone()
        if row is None:
            return jsonify({"episode_id": episode_id, "status": "not_started"}), 404
        return jsonify(_row_to_dict(row))
    finally:
        conn.close()


@video_blueprint.route("/api/backgrounds", methods=["GET"])
def api_backgrounds():
    return jsonify(list(BACKGROUNDS.values()))


@video_blueprint.route("/api/analytics", methods=["GET"])
def api_analytics():
    _init_video_jobs_table()
    conn = _connect()
    try:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS total_videos,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_videos,
                COALESCE(SUM(cost_usd), 0) AS total_cost,
                SUM(CASE WHEN status IN ('pending', 'queued', 'processing') THEN 1 ELSE 0 END) AS pending_count
            FROM video_jobs
            """
        ).fetchone()
        return jsonify(_row_to_dict(row))
    finally:
        conn.close()


def register_video_routes(app):
    """Register Video Studio API routes on an existing Flask app."""
    _init_video_jobs_table()
    if "video_studio" not in app.blueprints:
        app.register_blueprint(video_blueprint)
    return app


def patch_dashboard_app(app_path="/opt/tcg-signal-v2/dashboard/app.py"):
    """Patch dashboard/app.py so it imports and registers these routes."""
    path = Path(app_path)
    text = path.read_text(encoding="utf-8")
    if "register_video_routes(app)" in text:
        return False

    marker = "app = Flask(__name__)"
    import_line = "from dashboard_update import register_video_routes\n"
    if import_line not in text:
        text = import_line + text

    if marker in text:
        text = text.replace(marker, marker + "\nregister_video_routes(app)", 1)
    else:
        text += "\n\n# Video Studio routes\nregister_video_routes(app)\n"

    path.write_text(text, encoding="utf-8")
    return True
