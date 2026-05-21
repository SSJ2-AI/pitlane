"""
video_pipeline.py - wrapper for HeyGen video generation.
"""
import sys

sys.path.insert(0, "/opt/tcg-signal-v2")

from heygen_video import generate_episode_video


def run_video_pipeline(episode_id=None, background_key="dark_studio", force=False):
    """Run the video pipeline for one episode."""
    if not episode_id:
        return None
    return generate_episode_video(episode_id, background_key=background_key)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--episode-id", type=int, required=True)
    parser.add_argument("--background", default="dark_studio")
    args = parser.parse_args()
    result = run_video_pipeline(args.episode_id, args.background)
    print(result)
