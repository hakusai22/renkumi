#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import shutil
import subprocess
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright


WIDTH = 960
HEIGHT = 648
FPS = 30
DURATION = 6


async def capture_frames(source: Path, frames_dir: Path, poster: Path) -> None:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=1)
        await page.goto(source.resolve().as_uri(), wait_until="load")

        total_frames = FPS * DURATION
        poster_frame = FPS * 3
        for frame in range(total_frames):
            time = frame / FPS
            await page.evaluate("(time) => window.__renkumiRenderAt(time)", time)
            frame_path = frames_dir / f"frame-{frame:04d}.png"
            await page.screenshot(path=str(frame_path), clip={"x": 0, "y": 0, "width": WIDTH, "height": HEIGHT})
            if frame == poster_frame:
                shutil.copyfile(frame_path, poster)

        await browser.close()


def encode_video(frames_dir: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-framerate",
            str(FPS),
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
    args = parser.parse_args()

    source = Path(args.source)
    output = Path(args.output)
    poster = Path(args.poster)
    poster.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="renkumi-storyboard-") as tmp:
        frames_dir = Path(tmp)
        await capture_frames(source, frames_dir, poster)
        encode_video(frames_dir, output)


if __name__ == "__main__":
    asyncio.run(main())
