#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/opt/tcg-signal-v2"
VENV_PY="${PROJECT_ROOT}/.venv/bin/python3"
WEB_ROOT="/var/www/podcast4ads"
DASHBOARD_DIR="${PROJECT_ROOT}/dashboard"
DB_PATH="${PROJECT_ROOT}/tcg_signal.db"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== TCG Signal Video Platform deploy =="
echo "Project root: ${PROJECT_ROOT}"
echo "Artifact source: ${SCRIPT_DIR}"

if [[ "$(id -u)" -ne 0 ]]; then
  SUDO="sudo"
else
  SUDO=""
fi

require_file() {
  local path="$1"
  if [[ ! -f "${path}" ]]; then
    echo "Missing required artifact: ${path}" >&2
    exit 1
  fi
}

require_file "${SCRIPT_DIR}/heygen_video.py"
require_file "${SCRIPT_DIR}/video_pipeline.py"
require_file "${SCRIPT_DIR}/dashboard_update.py"
require_file "${SCRIPT_DIR}/dashboard_template_patch.html"

if [[ ! -x "${VENV_PY}" ]]; then
  echo "Missing Python venv interpreter: ${VENV_PY}" >&2
  exit 1
fi

echo "== Checking RSS before deploy =="
curl -fsSI "https://podcast4ads.com/rss.xml" >/tmp/tcg_rss_before_headers.txt
grep -E '^HTTP/' /tmp/tcg_rss_before_headers.txt || true

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "== Installing ffmpeg =="
  ${SUDO} apt-get update
  ${SUDO} apt-get install -y ffmpeg
fi

echo "== Creating public media directories =="
${SUDO} mkdir -p \
  "${WEB_ROOT}/backgrounds" \
  "${WEB_ROOT}/clips" \
  "${WEB_ROOT}/videos" \
  "${WEB_ROOT}/audio_segments"

echo "== Downloading background images =="
${SUDO} curl -fL "https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=1280&q=80" -o "${WEB_ROOT}/backgrounds/bg_dark_studio.jpg"
${SUDO} curl -fL "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1280&q=80" -o "${WEB_ROOT}/backgrounds/bg_neon_lab.jpg"
${SUDO} curl -fL "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=1280&q=80" -o "${WEB_ROOT}/backgrounds/bg_cozy_shelf.jpg"
${SUDO} curl -fL "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1280&q=80" -o "${WEB_ROOT}/backgrounds/bg_tournament.jpg"
${SUDO} curl -fL "https://images.unsplash.com/photo-1557683316-973673baf926?w=1280&q=80" -o "${WEB_ROOT}/backgrounds/bg_minimal_dark.jpg"

echo "== Setting web permissions =="
${SUDO} chown -R www-data:www-data \
  "${WEB_ROOT}/backgrounds" \
  "${WEB_ROOT}/clips" \
  "${WEB_ROOT}/videos" \
  "${WEB_ROOT}/audio_segments"
${SUDO} find "${WEB_ROOT}/backgrounds" "${WEB_ROOT}/clips" "${WEB_ROOT}/videos" "${WEB_ROOT}/audio_segments" -type d -exec chmod 755 {} \;
${SUDO} find "${WEB_ROOT}/backgrounds" "${WEB_ROOT}/clips" "${WEB_ROOT}/videos" "${WEB_ROOT}/audio_segments" -type f -exec chmod 644 {} \;

echo "== Syntax-checking artifacts before copy =="
"${VENV_PY}" -m py_compile \
  "${SCRIPT_DIR}/heygen_video.py" \
  "${SCRIPT_DIR}/video_pipeline.py" \
  "${SCRIPT_DIR}/dashboard_update.py"

echo "== Copying Python files into project =="
${SUDO} cp "${SCRIPT_DIR}/heygen_video.py" "${PROJECT_ROOT}/heygen_video.py"
${SUDO} cp "${SCRIPT_DIR}/video_pipeline.py" "${PROJECT_ROOT}/video_pipeline.py"
${SUDO} cp "${SCRIPT_DIR}/dashboard_update.py" "${DASHBOARD_DIR}/dashboard_update.py"
${SUDO} chown root:root \
  "${PROJECT_ROOT}/heygen_video.py" \
  "${PROJECT_ROOT}/video_pipeline.py" \
  "${DASHBOARD_DIR}/dashboard_update.py"
${SUDO} chmod 644 \
  "${PROJECT_ROOT}/heygen_video.py" \
  "${PROJECT_ROOT}/video_pipeline.py" \
  "${DASHBOARD_DIR}/dashboard_update.py"

echo "== Patching dashboard app.py and template =="
${SUDO} "${VENV_PY}" - "${DASHBOARD_DIR}/app.py" "${SCRIPT_DIR}/dashboard_template_patch.html" "${DASHBOARD_DIR}/templates" <<'PY'
import datetime
import re
import shutil
import sys
from pathlib import Path

app_path = Path(sys.argv[1])
snippet_path = Path(sys.argv[2])
templates_dir = Path(sys.argv[3])

if not app_path.exists():
    raise SystemExit(f"dashboard app.py not found: {app_path}")

stamp = datetime.datetime.utcnow().strftime("%Y%m%d%H%M%S")

text = app_path.read_text(encoding="utf-8")
if "register_video_routes(app)" not in text:
    shutil.copy2(app_path, app_path.with_suffix(f".py.bak.{stamp}"))
    import_line = "from dashboard_update import register_video_routes\n"
    if import_line not in text:
        lines = text.splitlines(keepends=True)
        insert_at = 0
        for idx, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith("import ") or stripped.startswith("from "):
                insert_at = idx + 1
        lines.insert(insert_at, import_line)
        text = "".join(lines)

    match = re.search(r"^(\s*app\s*=\s*Flask\([^\n]*\)\s*)$", text, flags=re.MULTILINE)
    if match:
        replacement = match.group(1) + "\nregister_video_routes(app)"
        text = text[:match.start()] + replacement + text[match.end():]
    else:
        text += "\n\n# Video Studio API routes\nregister_video_routes(app)\n"

    app_path.write_text(text, encoding="utf-8")
    print(f"Patched route registration in {app_path}")
else:
    print(f"Route registration already present in {app_path}")

snippet = snippet_path.read_text(encoding="utf-8")
start_marker = "<!-- BEGIN TCG SIGNAL VIDEO STUDIO -->"
end_marker = "<!-- END TCG SIGNAL VIDEO STUDIO -->"
block = f"\n{start_marker}\n{snippet}\n{end_marker}\n"

preferred = [
    templates_dir / "dashboard.html",
    templates_dir / "index.html",
    templates_dir / "home.html",
]
candidates = [path for path in preferred if path.exists()]
if templates_dir.exists():
    candidates.extend(path for path in sorted(templates_dir.glob("*.html")) if path not in candidates)

if not candidates:
    print(f"No dashboard templates found under {templates_dir}; HTML snippet was not inserted")
else:
    template_path = candidates[0]
    template_text = template_path.read_text(encoding="utf-8")
    if start_marker in template_text:
        print(f"Video Studio section already present in {template_path}")
    else:
        shutil.copy2(template_path, template_path.with_suffix(template_path.suffix + f".bak.{stamp}"))
        if "</body>" in template_text:
            template_text = template_text.replace("</body>", block + "\n</body>", 1)
        else:
            template_text += block
        template_path.write_text(template_text, encoding="utf-8")
        print(f"Inserted Video Studio section in {template_path}")
PY

echo "== Initializing video_jobs table =="
cd "${PROJECT_ROOT}"
${SUDO} "${VENV_PY}" - <<'PY'
import sqlite3

db_path = "/opt/tcg-signal-v2/tcg_signal.db"
schema = """
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
conn = sqlite3.connect(db_path)
try:
    conn.execute(schema)
    conn.commit()
finally:
    conn.close()
print("video_jobs table ready")
PY

echo "== Syntax-checking deployed Python files =="
${SUDO} "${VENV_PY}" -m py_compile \
  "${PROJECT_ROOT}/heygen_video.py" \
  "${PROJECT_ROOT}/video_pipeline.py" \
  "${DASHBOARD_DIR}/dashboard_update.py" \
  "${DASHBOARD_DIR}/app.py"

echo "== Import check for heygen_video =="
cd "${PROJECT_ROOT}"
${SUDO} "${VENV_PY}" -c "import heygen_video; print('heygen_video import OK')"

echo "== Restarting dashboard =="
if systemctl list-unit-files | grep -q '^tcg-dashboard\.service'; then
  ${SUDO} systemctl restart tcg-dashboard
elif systemctl list-units --type=service --all | grep -q 'tcg-dashboard'; then
  ${SUDO} systemctl restart tcg-dashboard
else
  ${SUDO} pkill -f "dashboard/app.py" || true
  cd "${PROJECT_ROOT}"
  nohup "${VENV_PY}" dashboard/app.py > /tmp/tcg-dashboard.log 2>&1 &
fi

sleep 3

echo "== Verification checks =="
curl -fsSI "https://podcast4ads.com/rss.xml" >/tmp/tcg_rss_after_headers.txt
grep -E '^HTTP/' /tmp/tcg_rss_after_headers.txt || true
"${VENV_PY}" - <<'PY'
import sqlite3

conn = sqlite3.connect("/opt/tcg-signal-v2/tcg_signal.db")
try:
    row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='video_jobs'").fetchone()
    if not row:
        raise SystemExit("video_jobs schema missing")
    print(row[0])
finally:
    conn.close()
PY

curl -fsS "http://localhost:5001/api/backgrounds" | "${VENV_PY}" -m json.tool >/tmp/tcg_backgrounds.json
curl -fsS "http://localhost:5001/api/video-jobs" | "${VENV_PY}" -m json.tool >/tmp/tcg_video_jobs.json
curl -fsS "http://localhost:5001/api/analytics" | "${VENV_PY}" -m json.tool >/tmp/tcg_analytics.json

echo "Background API:"
cat /tmp/tcg_backgrounds.json
echo "Video jobs API:"
cat /tmp/tcg_video_jobs.json
echo "Analytics API:"
cat /tmp/tcg_analytics.json

echo "== Deploy complete =="
echo "Dashboard: https://podcast4ads.com/dashboard"
echo "RSS: https://podcast4ads.com/rss.xml"
