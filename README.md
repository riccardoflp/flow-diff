# Flow Diff

Side-by-side git diff viewer for VS Code: aligned panes with filler lines,
curved connectors in the center gutter linking changed blocks, word-level
intra-line highlights and chunk navigation.

## Features

- **Side-by-side diff** of a file against `HEAD` (working tree or index),
  rendered in a custom webview that follows your VS Code theme.
- **Compare with any branch, tag or commit**: pick from a list (including the
  commits that touched the file) or type any revision, like `HEAD~3`.
- **Aligned panes**: changed blocks stay vertically aligned via hatched filler
  lines.
- **Center-gutter connectors**: colored bands link each changed block on the
  left to its counterpart on the right (green = added, red = removed,
  blue = modified).
- **Word-level highlights** inside modified lines, with a noise guard that
  skips intra-line marks when nearly the whole line changed.
- **Smart scroll sync**: the panes scroll together through a piecewise mapping
  anchored at chunk boundaries — context scrolls 1:1, and while traversing a
  large change the shorter side keeps its counterpart near mid-screen, with
  context visible above and below.
- **Chunk navigation**: `F7` / `Shift+F7` or the floating
  toolbar, with a "n / m" counter; chunk markers in the overview ruler and
  minimap. Past the last change, `F7` again moves on to the next changed
  file.
- **Collapsed unchanged regions**: long runs of unchanged lines fold into a
  clickable "⋯ N unchanged lines" bar, keeping 3 lines of context around each
  change (toolbar toggle, setting `flowDiff.collapseUnchanged`).
- **Jump to Source** (`F4` or the context menu) opens the real file at the
  cursor line — from either pane.
- **Per-chunk actions** in the center gutter: revert (⟲) and stage (+) for
  working-tree diffs, unstage (−) for index diffs — hunk-level staging via
  `git apply --cached`, also on partially staged files. Already-staged chunks
  render dimmed. Against another revision, revert restores that revision's
  lines.
- **File actions** in the panel title bar, like the built-in diff editor:
  Open File, previous/next change, Stage File, Unstage File, Discard Changes.
- **Editable diff**: both panes are Monaco editors — the working-tree side is
  fully editable in place (undo, multi-cursor, find, IME). Edits sync live
  into the real document (kept dirty); `Ctrl+S` inside the diff saves.
- **Syntax highlighting** that matches your *actual* color theme: the active
  theme's JSON is resolved host-side (includes merged) and loaded into shiki.
- **Local Changes tree** in the Source Control view: staged, unstaged and
  unversioned files grouped by folder; click to open the diff, inline stage /
  unstage / discard on files, folders or whole groups.
- **Live refresh**: the diff updates in place as you edit and save, or as the
  git state changes. Diffs are computed on a background thread, so even huge
  files never freeze the editor.
- Respects your `editor.*` settings (font, line height, minimap, …).

## Usage

- Command palette → **Flow Diff: Open Diff (Working Tree vs HEAD)** for the
  active file.
- Right-click a file in the Source Control view → **Open Diff**.
- Changed files show a diff button in the editor title bar.
- **Flow Diff: Open Diff (Index vs HEAD)** compares the staged copy instead.
- **Flow Diff: Compare with Branch or Revision…** — from the command palette,
  the Explorer / Source Control / editor tab context menus, or the `…` menu of
  an open Flow Diff panel.
- By default Flow Diff also takes over the diff tabs opened by the built-in
  git extension (setting `flowDiff.interceptGitOpenChange`).

## Roadmap

- Three-way merge of conflicts.

## Development

```
npm install
npm run compile      # host (tsc) + webview type-check + esbuild bundle
npm test             # unit tests for the diff engine (node --test)
```

Press `F5` to launch the Extension Development Host. A playground repo with
edits covering every diff case can be generated alongside this project
(`bridge-diff-playground`).

CI runs the tests on Linux and Windows for every push and PR. Pushing a tag
`vX.Y.Z` (matching `package.json`) publishes to the VS Code Marketplace and
Open VSX and attaches the `.vsix` to a GitHub Release.
