#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright


WIDTH = 960
HEIGHT = 648
FPS = 30
DURATION = 6


def emit_progress(enabled: bool, payload: dict) -> None:
    if not enabled:
        return

    print(json.dumps(payload), flush=True)


async def capture_frames(
    source: Path,
    frames_dir: Path,
    poster: Path,
    width: int,
    height: int,
    fps: int,
    duration: float,
    progress_json: bool,
) -> None:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
        await page.goto(source.resolve().as_uri(), wait_until="load")
        has_render_hook = await page.evaluate("typeof window.__renkumiRenderAt === 'function'")

        if not has_render_hook:
            raise RuntimeError("Source composition must define window.__renkumiRenderAt(time).")

        total_frames = max(1, round(fps * duration))
        poster_frame = min(total_frames - 1, max(0, round(fps * min(3, duration / 2))))
        progress_interval = max(1, fps // 2)
        for frame in range(total_frames):
            time = frame / fps
            await page.evaluate("(time) => window.__renkumiRenderAt(time)", time)
            frame_path = frames_dir / f"frame-{frame:04d}.png"
            await page.screenshot(path=str(frame_path), clip={"x": 0, "y": 0, "width": width, "height": height})
            if frame == poster_frame:
                shutil.copyfile(frame_path, poster)
            if frame == 0 or frame == total_frames - 1 or frame % progress_interval == 0:
                emit_progress(
                    progress_json,
                    {
                        "stage": "capturing",
                        "frame": frame + 1,
                        "totalFrames": total_frames,
                        "percent": 6 + round(((frame + 1) / total_frames) * 82),
                    },
                )

        await browser.close()


def encode_video(frames_dir: Path, output: Path, fps: int, progress_json: bool) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    emit_progress(progress_json, {"stage": "encoding", "percent": 92})
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-framerate",
            str(fps),
            "-i",
            str(frames_dir / "frame-%04d.png"),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(output),
        ],
        check=True,
    )
    emit_progress(progress_json, {"stage": "done", "percent": 100})


async def main() -> None:
    parser = argparse.ArgumentParser(description="Render the Renkumi HyperFrames storyboard to MP4.")
    parser.add_argument(
        "--source",
        default="hyperframes/renkumi-ai-storyboard/index.html",
        help="HyperFrames HTML composition path.",
    )
    parser.add_argument(
        "--output",
        default="public/assets/renkumi-ai-storyboard.mp4",
        help="MP4 output path.",
    )
    parser.add_argument(
        "--poster",
        default="public/assets/renkumi-ai-storyboard-poster.png",
        help="Poster PNG output path.",
    )
    parser.add_argument("--width", type=int, default=WIDTH, help="Viewport and composition width.")
    parser.add_argument("--height", type=int, default=HEIGHT, help="Viewport and composition height.")
    parser.add_argument("--fps", type=int, default=FPS, help="Capture frame rate.")
    parser.add_argument("--duration", type=float, default=DURATION, help="Composition duration in seconds.")
    parser.add_argument("--progress-json", action="store_true", help="Emit JSON progress events to stdout.")
    args = parser.parse_args()

    source = Path(args.source)
    output = Path(args.output)
    poster = Path(args.poster)
    poster.parent.mkdir(parents=True, exist_ok=True)

    if args.width < 1 or args.height < 1 or args.fps < 1 or args.duration <= 0:
        print("width, height, fps, and duration must be positive.", file=sys.stderr)
        raise SystemExit(2)

    with tempfile.TemporaryDirectory(prefix="renkumi-storyboard-") as tmp:
        frames_dir = Path(tmp)
        await capture_frames(source, frames_dir, poster, args.width, args.height, args.fps, args.duration, args.progress_json)
        encode_video(frames_dir, output, args.fps, args.progress_json)


if __name__ == "__main__":
    asyncio.run(main())
