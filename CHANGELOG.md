# Changelog

## Unreleased

- Local Changes view in Source Control: staged / unstaged / unversioned files
  grouped by folder, opening Flow Diff on click, with stage, unstage, discard
  and open actions on files, folders and groups.
- Unchanged regions collapse to a clickable "⋯ N unchanged lines" bar with 3
  lines of context (toolbar toggle, `flowDiff.collapseUnchanged`).
- `F7` past the last change (`Shift+F7` before the first) shows a hint, and
  pressed again opens the next (previous) changed file in place.
- Jump to Source (`F4`, context menu) opens the file at the cursor line, also
  from the HEAD pane.
- Compare with any branch, tag or commit (`Flow Diff: Compare with Branch or
  Revision…`), or a typed revision such as `HEAD~3`. Against a revision other
  than `HEAD`, chunks offer revert only and are never marked as staged.
- Chunk stage/unstage works on partially staged files, keeps the index's line
  endings and handles files without a final newline.
- Diffs are computed on a background thread with a time limit; only the
  panels affected by a change are refreshed, and unchanged inputs skip the
  diff entirely.
- Edits made in the diff pane replace only the changed text in the document,
  keeping undo, cursors and folding of other editors intact.
- Files in encodings other than UTF-8 are read like the editor reads them, so
  non-ASCII lines no longer show as changed.

## 0.1.0 — 2026-06-12

First public release.

- Side-by-side git diff (working tree vs HEAD, index vs HEAD) in a custom
  webview, with aligned panes and hatched filler lines.
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
