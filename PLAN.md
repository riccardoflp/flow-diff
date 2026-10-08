# PLAN.md — Flow Diff

Roadmap di progetto. Stato aggiornato all'8 ottobre 2026.

## Visione

Un'esperienza diff completa in VS Code: side-by-side con connettori
"genie" nel gutter centrale, editing in-place, azioni per chunk, albero delle
modifiche locali e compare-with arbitrario.

## ✅ Fase 1 — Diff viewer (fatto)

- [x] Motore diff puro (jsdiff → `AlignedDiffModel`, word-diff con guard 65%)
- [x] Webview con due pannelli a scroll indipendente, sync piecewise-linear
      ancorato ai chunk (1:1 sul contesto, stretch sui blocchi); la mappa è
      applicata al centro del viewport, così sui chunk grandi il lato corto
      resta a metà schermo con contesto sopra e sotto
- [x] Connettori SVG genie ridisegnati a ogni scroll (rAF)
- [x] Navigazione chunk: F7 / Shift+F7, toolbar flottante "n / m"
- [x] Entry point: palette, context menu SCM, bottone editor/title (context key
      `flowDiff.activeFileHasChanges`), viste worktree-vs-HEAD e index-vs-HEAD
- [x] Refresh live (save, stato git, typing), guard binari e file enormi
- [x] Syntax highlighting col tema reale dell'utente (themeService → shiki)

## ✅ Fase 2 — Azioni (fatto)

- [x] Per chunk nel gutter: revert ⟲ (WorkspaceEdit + save, undoable),
      stage + / unstage − (`git apply --cached --unidiff-zero`)
- [x] Patch sintetizzati da `src/diff/patch.ts`, validati round-trip su git reale
- [x] File-level in title bar: Open File, Stage, Unstage, Discard (conferma modale)
- [x] ~~Limite noto: stage chunk falliva su file già parzialmente staged~~
      → risolto in fase R (patch costruite sull'index)
- [x] Indicatore "staged" nella vista worktree: `src/diff/staged.ts` confronta
      index↔worktree e marca i chunk già nell'index (`chunk.staged`); resa
      opacizzata (sfondi riga + connettore tratteggiato) e bottone + → −

## ✅ Fase 2.5 — Editing in-place (fatto)

- [x] Pannelli = due editor Monaco; destro editabile nella vista worktree
- [x] Sync live verso il documento (dirty; Ctrl+S nel diff salva)
- [x] Guard `localDirty` contro il clobbering dei tasti in volo
- [x] shikiToMonaco per la tokenizzazione, worker via blob shim

## ✅ Fase 2.6 — Default diff (fatto)

- [x] `watch/diffTakeover.ts`: i tab diff git nativi vengono chiusi e sostituiti
      da Flow Diff (setting `flowDiff.interceptGitOpenChange`, default on)

## ✅ Release 0.1.0 (uscita)

Prima release pubblica: fasi 1–2.6. Dopo la release:

- [x] Numeri di riga colorati come la modifica (`marginClassName`)
- [x] `bundle:webview` svuota `out/webview` prima di esbuild: le build
      incrementali lasciavano chunk con hash vecchi che finivano nel `.vsix`
- [x] CI GitHub Actions: `npm test` (Linux + Windows) + `vsce package` su
      push/PR
- [x] Workflow di release su tag `v*`: test, package, publish su VS Code
      Marketplace (`VSCE_PAT`) e Open VSX (`OVSX_PAT`), `.vsix` allegato alla
      GitHub Release
- [x] Repo GitHub rinominato in `flow-diff`, remote aggiornato

## 🔲 Prossima release (0.2.0)

Contenuto: fasi R, 3, 4, 5 (sezione "Unreleased" del CHANGELOG).

- [ ] Shortcut tastiera nella webview (Ctrl+C/V/X/Z/Y/A/F/H/G/S, Ctrl+D…):
      tutte da verificare in F5. L'handler WIP intercetta in capture e chiama
      `execCommand`, ma il pre-script delle webview di VS Code fa già
      preventDefault su undo/redo/find e copy/paste/cut e inoltra il keydown
      al workbench → rischio di doppia esecuzione (es. doppio incolla).
      Provare ogni shortcut prima senza handler, poi intercettare solo quelle
      davvero rotte (`stopPropagation` per non farle rimbalzare al workbench)
- [ ] Verifiche F5 delle fasi 3–5 (vedi sotto)
- [ ] Secret `VSCE_PAT` (Azure DevOps, scope Marketplace › Manage) e
      `OVSX_PAT` (open-vsx.org, namespace `RiccardoFilippozzi`) nel repo
- [ ] Version bump in `package.json`, data nel CHANGELOG, tag `v0.2.0` su
      `main`, push del tag → parte il workflow di release

## ✅ Fase R — Robustezza (fatto)

Prima delle nuove feature: problemi trovati in review, tutti lato host.

- [x] **Diff fuori dal thread dell'extension host**: `computeDiff` +
      `markStagedChunks` girano in un worker_thread (`diffEngine.ts`), con
      timeout jsdiff di 5s → "too many differences" (al refresh resta
      l'ultimo modello buono)
- [x] **Edit sync incrementale**: l'host non sostituisce più tutto il
      documento ma solo lo span cambiato (prefisso/suffisso comuni,
      `diff/textEdit.ts`): undo, cursori e folding degli altri editor intatti.
      Il messaggio porta ancora il testo intero (semplice e auto-correttivo;
      i delta di Monaco richiederebbero versioning contro le modifiche
      concorrenti dall'editor normale)
- [x] **Stage su file parzialmente staged**: `diff/chunkPatch.ts` costruisce
      patch *forward* sull'index esatto (stage: index→worktree, unstage:
      index→HEAD) con i soli hunk che toccano il chunk. Gestisce CRLF
      (righe nuove nello stile EOL dell'index), "No newline at end of file",
      unstage di file nuovi (`git rm --cached`). Round-trip su git reale in
      `test/chunkPatch.test.ts`
- [x] **Refresh mirato**: eventi documento → solo i pannelli di quel file,
      stato git → solo quelli del repo; hash sha1 degli input per saltare
      diff e postMessage quando nulla è cambiato; run serializzati (niente
      modelli vecchi che arrivano dopo quelli nuovi)
- [x] **Encoding**: il lato worktree passa da `openTextDocument` (BOM,
      `files.encoding`, come l'editor e come `repo.show` sul lato git) invece
      di leggere sempre UTF-8 → niente righe accentate "modificate" nei file
      latin1/windows-1252. Stage per chunk rifiutato (invece di corrompere
      l'index) se il file non è UTF-8 e la patch ha byte non ASCII, o se tocca
      la riga 1 di un file con BOM. UTF-16: la git extension non sniffa il
      BOM senza `files.autoGuessEncoding` → resta "looks binary"
- [x] Mappa di `scrollSync` estratta in `diff/scrollMap.ts` (pura) e testata

## ✅ Fase 3 — Compare with branch / revision (fatto)

- [x] `flowDiff.compareWith` + `refPicker.ts`: QuickPick con branch, remote,
      tag (`getRefs` per committerdate) e i 50 commit che toccano il file
      (`repo.log({path})`), più la revisione digitata (validata con
      `getCommit`). Apre `(ref, worktree)` con la pipeline esistente
- [x] Entry point: palette, context menu Explorer / SCM / tab editor, menu `…`
      del pannello Flow Diff (usa il file del pannello)
- [x] Contro un ref ≠ HEAD: niente marcatura
      staged né stage/unstage, solo revert del chunk; context
      `flowDiff.activeSide = worktreeVsRef` nasconde Stage/Discard file
- [x] Label: hash abbreviati a 8, nomi di branch/tag interi
- [ ] Verifica in F5 (QuickPick e menu non sono coperti dai test)

## ✅ Fase 4 — Navigazione e lettura (fatto)

- [x] Collapse delle regioni invariate: `diff/unchanged.ts` (puro) +
      `webview/collapse.ts` con `setHiddenAreas` (API interna, la usa il diff
      editor di Monaco; feature-detect) e view zone `showInHiddenAreas`
      cliccabili. 3 righe di contesto, minimo 4 righe nascoste; regioni aperte
      ricordate per riga HEAD; si riaprono se il cursore ci salta dentro
      (find, go to line). Toggle in toolbar + `flowDiff.collapseUnchanged`
- [x] F7 oltre l'ultimo chunk → hint, secondo F7 → file modificato
      successivo (ordine per path, wrap, salta binari/troppo complessi); solo
      per diff contro HEAD
- [x] Jump to Source (F4 + menu contestuale), dal lato HEAD mappa sulla riga
      del worktree (`diff/lineMap.ts`)
- [x] Word-wrap: già coperto, i pannelli seguono `editor.wordWrap` e lo
      scroll sync regge il wrap
- [~] "n of m" nel titolo del pannello: scartato, il contatore è già nella
      toolbar e un titolo che cambia a ogni F7 sporca la tab
- [x] `scripts/webview-harness.js`: la webview vera in un browser normale
      (modello da computeDiff, `acquireVsCodeApi` finto) per verificare UI
      senza F5
- [ ] Verifica in F5 di Find / Ctrl+G dentro regioni nascoste (nell'harness
      le combinazioni con Ctrl non arrivano a Monaco)

## ✅ Fase 5 — Albero "Local Changes" (fatto)

- [x] Vista `flowDiff.localChanges` come sezione della Source Control (scelta:
      niente icona nuova in activity bar, sta dove si cercano già le modifiche)
- [x] Gruppi Staged Changes / Changes (incl. conflitti) / Unversioned Files,
      file raggruppati per cartella con cartelle compattate
      (`tree/pathTree.ts`, puro e testato); un nodo per repo se sono più d'uno
- [x] Click su file → Flow Diff (worktree o index secondo il gruppo); icone e
      decorazioni di stato dal tema e dalla git extension (`resourceUri`)
- [x] Azioni inline e da menu su file, cartelle e gruppi, anche multi-
      selezione: Stage, Unstage, Discard (conferma), Open File, Compare with…
- [ ] Verifica in F5

## 🔲 Lontano

- [ ] Merge conflict 3-way (layout a 3 pannelli): il vero differenziatore,
      ma è un progetto a sé

## Verifica standard

F5 → aprire `../bridge-diff-playground` → diff di `sample.ts` (4 chunk: word
edit, insert, delete, blocco 1→3), `untracked.ts` (tutto added), `staged.ts`
(MM: confrontare le due viste). Temi: Dark+, Light+, High Contrast e un tema custom.
Unit test: `npm test` (motore diff, patch con round-trip su git reale,
worker, edit minimi, scroll map).
