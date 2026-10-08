// Runs the real webview bundle outside VS Code, to check layout, connectors,
// scroll sync and collapsing in a plain browser.
//
//   npm run compile
//   node scripts/webview-harness.js <old-file> <new-file> [worktree|index|ref]
//   python -m http.server 8765 --directory out   → http://localhost:8765/harness/
//
// acquireVsCodeApi is stubbed: messages the webview posts land in
// `window.__posted`, and `window.__host(message)` delivers a host message
// (e.g. an `update` with a new model).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const [oldFile, newFile, rightSide = 'worktree'] = process.argv.slice(2);
if (!oldFile || !newFile) {
  console.error('usage: node scripts/webview-harness.js <old-file> <new-file> [worktree|index|ref]');
  process.exit(1);
}

const { computeDiff } = require(path.join(root, 'out', 'diff', 'computeDiff.js'));
const LANGUAGES = { '.ts': 'typescript', '.js': 'javascript', '.json': 'json', '.css': 'css', '.md': 'markdown' };
const model = computeDiff({
  oldText: fs.readFileSync(oldFile, 'utf8'),
  newText: fs.readFileSync(newFile, 'utf8'),
  leftLabel: 'HEAD',
  rightLabel: rightSide === 'index' ? 'Index' : 'Working Tree',
  languageId: LANGUAGES[path.extname(newFile)] ?? 'plaintext',
  filePath: path.basename(newFile),
});
const init = {
  type: 'init',
  model,
  settings: {
    editorOptions: {},
    rightSide,
    canStage: rightSide !== 'ref',
    collapseUnchanged: true,
    fileNavigation: rightSide !== 'ref',
  },
};

const dir = path.join(root, 'out', 'harness');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'init.json'), JSON.stringify(init));
fs.writeFileSync(
  path.join(dir, 'index.html'),
  `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Flow Diff harness</title>
<link rel="stylesheet" href="../webview/main.css">
<style>
  html, body { height: 100%; margin: 0; background: #1e1e1e; color: #ccc; }
  body { --vscode-editor-background: #1e1e1e; --vscode-editor-foreground: #d4d4d4;
         --vscode-font-family: 'Segoe UI', sans-serif; --vscode-font-size: 13px;
         --vscode-editor-font-family: Consolas, monospace; --vscode-editor-font-size: 14px; }
</style>
</head>
<body>
<div id="app"></div>
<script>
  // the blob worker shim needs an absolute URL
  document.getElementById('app').dataset.worker = new URL('../webview/editor.worker.js', location.href).href;
  window.__posted = [];
  window.acquireVsCodeApi = () => ({
    postMessage(message) {
      window.__posted.push(message);
      if (message.type === 'ready') {
        fetch('init.json').then((r) => r.json()).then((init) => window.postMessage(init, '*'));
      }
    },
    getState() {},
    setState() {},
  });
  window.__host = (message) => window.postMessage(message, '*');
</script>
<script type="module" src="../webview/main.js"></script>
</body>
</html>
`
);
console.log(`out/harness/: ${model.chunks.length} chunks, ${model.rows.length} rows`);
