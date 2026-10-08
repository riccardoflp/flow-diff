# AGENTS.md — Flow Diff

Guida operativa per agenti (e umani) che lavorano su questo repo.

## Cos'è

Estensione VS Code: diff git side-by-side stile WebStorm in una webview custom.
Due editor **Monaco** (destro editabile) collegati da un gutter centrale con
connettori SVG "genie" e azioni per chunk (revert / stage / unstage).

## Comandi

```bash
npm run compile        # tsc host + type-check webview + esbuild bundle + worker
npm test               # compile + node --test (diff, patch su git reale, worker…)
npm run watch          # tsc -watch (solo host)
npm run watch:webview  # esbuild --watch (solo bundle webview)
npx vsce package       # genera il .vsix
```

Debug: **F5** (Extension Development Host). Repo di prova con tutti i casi di
diff: `../bridge-diff-playground` (sample.ts modificato, untracked.ts,
staged.ts con index ≠ worktree ≠ HEAD).
Modifiche solo-webview: ricompila e "Developer: Reload Webviews" nel dev host.

Senza VS Code (es. agenti con un browser): `node scripts/webview-harness.js
<old> <new>` genera `out/harness/` con la webview vera e un modello da
`computeDiff`; servire `out/` (`python -m http.server 8765 --directory out`)
e aprire `/harness/`. `window.__posted` = messaggi verso l'host,
`window.__host(msg)` = messaggi dall'host. Click e tasti F funzionano; le
combinazioni con Ctrl nel browser automatizzato non arrivano a Monaco.

## Architettura (due mondi, un protocollo)

```
src/
├── extension.ts            # activate(): wiring di tutto
├── commands.ts             # comandi: openDiff/openDiffStaged/nav/file actions
├── diffBuilder.ts          # buildModel + refreshPanel (guard binari/file enormi,
│                           #   skip se l'hash degli input non cambia)
├── diffEngine.ts           # job di diff su worker_thread (fallback inline)
├── worker/diffWorker.ts    # entry del worker: runDiffJob
├── chunkActions.ts         # revert (WorkspaceEdit) / stage / unstage per chunk
├── refPicker.ts            # QuickPick branch/tag/commit per Compare with…
├── diff/                   # PURO: niente import vscode, testabile con node --test
│   ├── model.ts            # AlignedDiffModel: rows (con filler) + chunks
│   ├── computeDiff.ts      # jsdiff → modello (word-diff con guard 65%, timeout)
│   ├── diffJob.ts          # computeDiff + markStaged, serializzabile per il worker
│   ├── hunks.ts            # hunk di riga + span per intersecarli coi chunk
│   ├── staged.ts           # marca i chunk già nell'index
│   ├── chunkPatch.ts       # stage/unstage chunk → patch forward sull'index
│   ├── patch.ts            # hunk → patch unified zero-context per git apply
│   ├── textEdit.ts         # sostituzione minima (edit dalla webview → documento)
│   ├── scrollMap.ts        # mappa piecewise-linear dello scroll sync
│   ├── unchanged.ts        # regioni invariate comprimibili
│   ├── lineMap.ts          # riga HEAD → riga worktree (Jump to Source)
│   └── protocol.ts         # messaggi host⇄webview (condiviso, niente vscode)
├── git/
│   ├── api.d.ts            # typings vendorate dal tag release/1.90 di vscode
│   ├── gitService.ts       # repo.show per ref ('' = index), contenuti worktree
│   └── gitCli.ts           # git apply --cached --unidiff-zero, git rm --cached
├── panel/                  # DiffPanel (webview, CSP, messaggi) + registry dedupe
├── theme/themeService.ts   # tema attivo → JSON (include risolti, nome slug)
├── watch/
│   ├── refresher.ts        # refresh debounced 250ms, solo pannelli toccati,
│   │                       #   run mai sovrapposti + context key
│   └── diffTakeover.ts     # intercetta i tab diff nativi e apre Flow Diff
└── webview/                # bundlato da esbuild (esm+splitting), tsconfig proprio
    ├── main.ts             # orchestrazione: init/update/theme, edit sync
    ├── editors.ts          # 2 istanze Monaco + decorazioni diff
    ├── highlight.ts        # shiki (JS engine) → shikiToMonaco col tema reale
    ├── scrollSync.ts       # mapping piecewise-linear ancorato ai chunk,
    │                       #   applicato al centro del viewport (contesto
    │                       #   visibile sopra/sotto sui chunk grandi)
    ├── connectors.ts       # SVG genie nel gutter + bottoni azioni per chunk
    ├── navigation.ts       # indice chunk corrente, F7 oltre il bordo → file
    ├── collapse.ts         # hidden areas + barre "⋯ N unchanged lines"
    └── render.ts           # layout statico + sideText(model, side)
```

Flusso dati: git → `computeDiff` → `AlignedDiffModel` → postMessage → webview.
Editing: Monaco destro → debounce 200ms → `{type:'edit', text}` → WorkspaceEdit
→ onDidChangeTextDocument → rebuild → `update` → webview (guard `localDirty`
per non sovrascrivere i tasti in volo).

## Gotcha noti (non rifare questi errori)

- **`@types/vscode` è pinnato a 1.90.0** (= engines). Versioni più nuove fanno
  fallire `vsce package`.
- **Monaco 0.55**: gli import richiedono l'estensione esplicita
  (`monaco-editor/esm/vs/editor/editor.api.js`) perché exports è `"./*": "./*"`.
  `codicon.css` va importato a mano (il core non lo fa più) e il `.ttf` esce
  dal bundle via `--loader:.ttf=file`.
- **Worker Monaco**: non si crea cross-origin da una webview → bundle iife
  separato (`editor.worker.js`) caricato via blob + `importScripts` (CSP
  `worker-src blob:`). Se fallisce, Monaco fa fallback sul main thread.
- **Non registrare `git.openChange`** (o altri comandi di estensioni esistenti):
  la doppia registrazione lancia e abortisce `activate()`. Il takeover del diff
  di default si fa intercettando i tab (`watch/diffTakeover.ts`).
- **`git apply` per hunk richiede `--unidiff-zero`** (le nostre patch non hanno
  righe di contesto). Le patch partono sempre dal contenuto *esatto* dell'index
  (mai da HEAD↔worktree: con file parzialmente staged le righe non tornano).
  Stage di un file untracked = `repo.add`; unstage di un file senza HEAD =
  `git rm --cached`.
- **Nomi tema Monaco**: solo `[a-zA-Z0-9-]` → `themeService` slugifica il nome.
- **`src/diff/` deve restare puro**: niente `import vscode`, è condiviso con la
  webview e coperto da `node --test`.
- I file possono essere CRLF: `computeDiff` normalizza a LF per il display;
  `diffPanel.applyWebviewEdit` riconverte rispettando l'EOL del documento.

## Convenzioni

- TypeScript strict, commonjs/ES2020 per l'host (come run-my-tasks); la webview
  ha il suo tsconfig (`noEmit`, DOM, Bundler resolution).
- Test: `node --test` su `out/test/**` — niente harness VS Code.
- Colori solo via `--vscode-*` CSS vars (+ fallback); tema sintassi dal JSON
  del tema attivo, fallback Dark+/Light+.
- Commit footer: vedi convenzioni del repo (Co-Authored-By quando generato).
