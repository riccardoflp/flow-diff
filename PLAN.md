# PLAN.md — Flow Diff

Roadmap di progetto. Stato aggiornato all'8 ottobre 2026.

## Visione

Replicare in VS Code l'esperienza diff di WebStorm: side-by-side con connettori
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

## 🚀 Release 0.1.0 (in corso — ripresa 8 ottobre 2026)

Prima release pubblica. Contenuto: fasi 1–2.6 complete. Il tag `v0.1.0`
creato a giugno è solo locale, mai pushato, e precede il rename
Bridge Diff → Flow Diff: va ricreato sul commit di release.

- [x] `package.json`: version 0.1.0, publisher, repository, icona, LICENSE
- [x] README rivisto (feature list aggiornata, niente feature inesistenti)
- [x] CHANGELOG.md (il marketplace lo mostra nella tab Changelog)
- [x] `npm test` verde, `npx vsce package` pulito
- [x] Numeri di riga colorati come la modifica (`marginClassName`)
- [x] `bundle:webview` svuota `out/webview` prima di esbuild: le build
      incrementali lasciavano chunk con hash vecchi che finivano nel `.vsix`
- [x] CI GitHub Actions: `npm test` (Linux + Windows) + `vsce package` su
      push/PR
- [x] Workflow di release su tag `v*`: test, package, publish su VS Code
      Marketplace (`VSCE_PAT`) e Open VSX (`OVSX_PAT`), `.vsix` allegato alla
      GitHub Release
- [ ] Rinominare il repo GitHub `bridge-diff` → `flow-diff` (il
      `repository` nel package.json punta già lì) e aggiornare il remote
- [ ] Shortcut tastiera nella webview (Ctrl+C/V/X/Z/F…): l'handler WIP
      intercetta in capture e chiama `execCommand`, ma il pre-script delle
      webview di VS Code inoltra comunque il keydown al workbench, che
      ri-esegue copy/paste → rischio di doppio incolla. Verificare in F5
      quali shortcut sono davvero rotti e intercettare solo quelli
      (`stopPropagation` per non farli rimbalzare al workbench)
- [ ] Secret `VSCE_PAT` (Azure DevOps, scope Marketplace › Manage) e
      `OVSX_PAT` (open-vsx.org, namespace `RiccardoFilippozzi`) nel repo
- [ ] Data in CHANGELOG, tag `v0.1.0` sul commit di release in `main`, push
      del tag → parte il workflow di release

## 🔲 Fase R — Robustezza (0.2)

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
- [ ] **Encoding**: oggi solo UTF-8 (UTF-16 ha `\0` → scambiato per binario).
      Rispettare `files.encoding` / BOM
- [ ] Test unitari della mappa di `scrollSync` (matematica pura, estraibile)

## 🔲 Fase 3 — Compare with branch / revision

QuickPick su `repo.state.refs` + `repo.log()` → pipeline esistente con
`(ref, worktree)`. `gitService.getContent` è già parametrizzato per ref e la
chiave del registry include già i ref. Nascondere stage/revert quando il lato
destro non è il worktree (flag già in `init.settings`). Prima delle altre
perché l'infrastruttura c'è già quasi tutta.

## 🔲 Fase 4 — Navigazione e lettura

- [ ] Collapse delle regioni invariate (i connettori bezier sono già pronti
      per geometrie non allineate)
- [ ] F7 oltre l'ultimo chunk → file modificato successivo (come WebStorm):
      si attraversa tutto il changeset senza uscire dal diff
- [ ] "n of m" nel titolo del pannello (`currentChunkChanged` già emesso)
- [ ] Word-wrap opzionale (`settings.wrap` già nel protocollo)
- [ ] Double-click su una riga per aprirla nell'editor vero

## 🔲 Fase 5 — Albero "Local Changes"

`TreeDataProvider` su `repo.state.workingTreeChanges` / `indexChanges`,
raggruppato per directory come la tool window Commit di WebStorm; ogni item
invoca `flowDiff.openDiff`. Pura aggiunta: `gitService` espone già stato ed
eventi. Si sovrappone alla vista SCM nativa, quindi dopo la navigazione.
Decidere: vista dedicata in activity bar vs sezione nella vista SCM.

## 🔲 Lontano

- [ ] Merge conflict 3-way (layout a 3 pannelli): il vero differenziatore,
      ma è un progetto a sé

## Verifica standard

F5 → aprire `../bridge-diff-playground` → diff di `sample.ts` (4 chunk: word
edit, insert, delete, blocco 1→3), `untracked.ts` (tutto added), `staged.ts`
(MM: confrontare le due viste). Temi: Osmium, Dark+, Light+, High Contrast.
Unit test: `npm test` (computeDiff + patch).
