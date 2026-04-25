# Design rules — mcode LP

This document codifies the visual / UX rules for the mcode product LP. Read it before writing any markup, and challenge it in PR comments rather than ignoring it silently.

## Tone

- **Confident, technical, grown-up.** No exclamation marks. No "AI-powered" cliché. No emoji in body copy. No "supercharge / unlock / revolutionize."
- **Show, don't tell.** A code/CLI snippet or screenshot beats three adjectives.
- **Honest.** Mercury 2 is fast — that is the actual story. Don't pretend it's also more accurate than the frontier; it isn't.

## Palette (strict)

| Use | Value |
|---|---|
| Page background | linear-gradient `#0a0a18 → #1a0a2e` (top → bottom), pure black `#000` for full-bleed sections |
| Foreground text | `#e8e8f0` |
| Muted text | `#9b9bb0` (descriptions), `#6b6b80` (helper) |
| Border | `#2a2a40` |
| Accent A (primary) | cyan `#00ffff` — sparingly: hero glyph, primary CTA outline, hover glow |
| Accent B (secondary) | magenta `#ff00d4` — very sparingly: diffusion-themed inline accents, key-prefix in code |
| Card surface | `rgba(255,255,255,0.02)` |
| Code bg | `#0e0e1a` (text `#c8c8e0`, comment `#6b6b80`, string `#00ffff`, keyword `#ff00d4`) |

## Typography

- **Display**: `Inter Display` (Google Fonts) 700, tracking `-0.02em`.
- **Body**: `Inter` 400/500, 16px base, line-height 1.55.
- **Code**: `JetBrains Mono` 400/500, tracking `-0.01em`.

Scale: H1 64–80px clamp / H2 36px / H3 22px / body 16px / small 13px.

Spacing tokens (px): 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128. Section padding 96–128 vertical.

Container: `max-width: 1200px; padding: 0 24px;`

## Components

- **Buttons**: 1px outlined, no fills. Primary uses cyan border + cyan text; on hover add `box-shadow: 0 0 24px rgba(0,255,255,.35)`. Border radius 6px.
- **Cards**: 1px border `#2a2a40`, bg `rgba(255,255,255,.02)`, radius 12px, no drop shadow. Hover: border becomes cyan, no transform jumps.
- **Code blocks**: monospace, color-coded as above, line-height 1.6, padding 20–24px, no scroll bars except for very wide content.
- **Section dividers**: thin 1px `#2a2a40` rules. No swooshes, no SVG curves.

## Hero (must follow)

- Full-bleed `assets/hero-matrix-resolve.png` as background at 0.85 opacity, behind a dark gradient overlay so the right-side `MCODE` glyph remains crisp.
- H1 (text content): "Coding agent at the speed of diffusion." with subtitle: "mcode pairs Mercury 2 — Inception Labs' diffusion LLM — with a Claude Code–class CLI. Fast where it counts, conservative where it matters."
- Single primary CTA: outlined cyan button "Get started" → `#install`. A secondary text link "View on GitHub" alongside.
- Below the hero: a one-line stat strip — "300ms typical edit · 32K context · MIT licensed · 100% local CLI".

## Section order (canonical)

1. Hero (above)
2. **Why diffusion?** — 2 columns: left, body copy; right, `assets/diffusion-process.png` showing the 4-frame denoising. Two short paragraphs explain that Mercury 2 returns whole-file edits in ~300ms because diffusion converges in parallel rather than autoregressively.
3. **Watch it work** — a single dark terminal mockup (HTML, not image) showing a representative `/plugin install` or `mcode -y "..."` session with streaming bash output.
4. **What it does** — 3 cards in a row max, each with: heading + 2-line description + tiny code snippet. Pick three from: agent loop, edit_with_ai, marketplace, plugin TUI, /undo, MCP integration. **Do NOT** use a 6-card icon grid.
5. **How it stays out of your way** — short list of safety features: approval prompts, `/undo`, syntax check post-edit, hooks, read-only mode.
6. **Install** — a single fenced code block with `git clone … && npm install && npm run build && npm link`. Below it the section labelled "Configure" with the API key env var snippet.
7. **Footer** — repo link, MIT, version, no social icons.

## Layout principles

- **Asymmetry over centered everything.** Headline aligned to a 60% grid column on the right of the hero, not centered.
- **Generous negative space.** A reader should be able to focus on one thing per viewport.
- **Type-first.** A page that's just text + one image + one terminal mockup beats a card grid of icons.
- Width-bound paragraphs (max ~64ch) for readability.

## Forbidden

- Gradient buttons, glassmorphism with high blur, drop shadows on text
- Generic stock illustrations or photo of a person typing
- Parallax bouncing or scroll-snapped sections
- Auto-rotating testimonial carousels (no testimonials at all in v1)
- Multi-color emoji
- "Powered by AI" anywhere
- Any animation that runs on a loop forever (one-shot reveals OK)

## Accessibility & tech

- Lighthouse a11y ≥ 95
- All text contrast AA min, AAA on body where possible
- No JS framework. Plain HTML + CSS + a tiny `script.js` for the noise→text canvas effect on the hero (≤2KB, optional). Static, deployable to any host.
- Self-host fonts via `<link>` to Google Fonts CDN (Inter + JetBrains Mono) for now; document the `local()` fallback chain.
- Single `index.html`, single `styles.css`, single `script.js`. No bundler.

## What I want to feel when I open this LP

> "These people knew what they were doing. The product is fast. I want to install it."

Not: "Looks like 2024 SaaS template #47."
