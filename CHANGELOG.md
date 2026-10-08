# Changelog

## 0.1.0 — 2026-06-12

First public release.

- Side-by-side git diff (working tree vs HEAD, index vs HEAD) in a custom
  webview, with WebStorm-style aligned panes and hatched filler lines.
  Changed lines tint their line numbers too.
- Center-gutter SVG connectors linking changed blocks, colored by kind
  (added / removed / modified).
- Word-level intra-line highlights with a noise guard for fully-rewritten
  lines.
- Smart scroll sync: piecewise mapping anchored at chunk boundaries, applied
  to the viewport center — context scrolls 1:1, large one-sided changes keep
  the shorter side readable with context above and below.
- Chunk navigation (`F7` / `Shift+F7`, floating toolbar with counter) and
  chunk markers in the overview ruler and minimap.
- Per-chunk actions in the gutter: revert, stage, unstage (hunk-level staging
  via `git apply --cached`); already-staged chunks render dimmed.
- File actions in the panel title bar: Open File, previous/next change,
  Stage File, Unstage File, Discard Changes.
- Editable diff: the working-tree pane is a full Monaco editor; edits sync
  live into the real document, `Ctrl+S` saves.
- Syntax highlighting from your actual color theme (resolved host-side,
  rendered with shiki) and support for user `editor.*` settings.
- Live refresh on save, typing, and git state changes; guards for binary and
  oversized files.
- Optional takeover of the built-in git diff tabs
  (`flowDiff.interceptGitOpenChange`, default on).
