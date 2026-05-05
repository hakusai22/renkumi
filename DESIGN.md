# LaunchCut Design System

## Summary

LaunchCut uses the Airbnb-inspired rules from `DESIGN.md` as a product-console design language: white canvas, restrained typography, soft rounded surfaces, one strong Rausch accent, and a preview-first workflow. The core product flow is text script + user screenshots -> Remotion video. GPT Image is an optional enhancement layer for image optimization or expansion, not a dependency.

## Visual Principles

- Use a pure white page canvas with near-black ink (`#222222`) and muted secondary copy (`#6a6a6a`).
- Use Rausch (`#ff385c`) as the only high-energy CTA color for render actions, image generation emphasis, and active states.
- Keep typography modest: page headlines around 28px, section headings around 22px, body text at 14-16px.
- Prefer visual preview and concrete output metadata over explanatory product text.
- Use soft rounded geometry: pill search/action bar, circular brand mark/search orb, 14px repeated cards and media surfaces.
- Keep elevation to one light Airbnb-style shadow tier; avoid stacked dashboard shadows.

## Layout

- Top navigation is an 80px white bar with a left brand lockup, centered product tabs, and right actions.
- The first content band pairs a concise product statement with a pill-shaped action summary.
- The homepage must stay simple: one large text input, one multi-image upload, one primary generate action.
- The main workspace is preview-first: Remotion player plus render progress, with uploaded screenshots visible as supporting context.
- The preview column stays sticky on desktop so script changes remain visually connected to the video.
- Mobile collapses into one column, with the pill action bar becoming stacked segments.

## Components

- Primary button: Rausch fill, white text, 48px minimum height, 8px radius, 16px label at weight 500.
- Secondary button: white fill, ink text, 1px ink border, same height and radius as primary.
- Search/action pill: white surface, full radius, divided into project/output/scene segments, ending in a circular Rausch orb.
- Scene cards: repeated editable items with 14px radius, 1px hairline border, no heavy shadow.
- Asset rows: compact repeated items with image thumbnail, asset id, type, and source path.
- Upload box: dashed 14px rounded surface for first-party product screenshots. It belongs before optional AI enhancement.
- Metric strip: three equal cells for duration, ratio, and fps; keep labels muted and values quiet.
- Progress card: live render progress with a Rausch progress bar, status message, frame counts, and download CTA after success.

## Content Rules

- Chinese labels should be short and operational: `品牌`, `脚本`, `截图`, `导出 MP4`.
- Avoid long in-app explanations. Use concise status text only when an action is running or completed.
- Keep LaunchCut product copy focused on reusable video production: text, screenshots, render, outputs.
- Do not let generated image prompts replace real product screenshots for UI accuracy.
- Treat GPT Image as optional enhancement. No-key and failed-generation states must keep the video workflow usable with local placeholders or uploaded screenshots.
- Avoid exposing per-scene editing on the homepage unless an explicit advanced mode is added later.

## Implementation Notes

- The app uses `components/VideoConsole.tsx` for the editable console and `app/globals.css` for the design tokens.
- Keep `DESIGN.md` as the imported Airbnb reference and this file as the project-specific adaptation.
- Remotion preview remains the primary visual asset; future 9:16 or sales-demo versions should reuse the same layout language.
- New UI should use the existing CSS tokens before adding new colors, radii, shadows, or type scales.
