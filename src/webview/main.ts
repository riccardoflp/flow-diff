import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
// the editor core no longer pulls in the icon font by itself
import 'monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
import { AlignedDiffModel, DiffChunk } from '../diff/model';
import { DiffSettings, HostMessage, SyntaxTheme, WebviewMessage } from '../diff/protocol';
import { ChunkActionsConfig, Connectors } from './connectors';
import {
  DiffEditors,
  applyUserOptions,
  buildActiveChunkDecorations,
  buildDiffDecorations,
  buildOverviewRulerDecorations,
  createEditors,
  setupMonacoEnvironment,
} from './editors';
import { initHighlighting } from './highlight';
import { Navigation } from './navigation';
import { Layout, createLayout, setHeaderLabels, sideText } from './render';
import { ScrollSync, sideExtent } from './scrollSync';
import './styles.css';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscodeApi = acquireVsCodeApi();
const root = document.getElementById('app') as HTMLElement;
setupMonacoEnvironment(root.dataset.worker ?? '');

let model: AlignedDiffModel | undefined;
let settings: DiffSettings | undefined;
let layout: Layout | undefined;
let editors: DiffEditors | undefined;
let diffDecorLeft: monaco.editor.IEditorDecorationsCollection | undefined;
let diffDecorRight: monaco.editor.IEditorDecorationsCollection | undefined;
let activeDecorLeft: monaco.editor.IEditorDecorationsCollection | undefined;
let activeDecorRight: monaco.editor.IEditorDecorationsCollection | undefined;

/** True while we copy host state into the editors (suppresses edit events). */
let applyingRemote = false;
/** True when the right editor has local keystrokes not yet confirmed by an update. */
let localDirty = false;
let editTimer: number | undefined;

const connectors = new Connectors();
const scrollSync = new ScrollSync(() => connectors.schedule());
const toolbar = createToolbar();
const navigation = new Navigation(onNavChange);

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as HostMessage;
  switch (message.type) {
    case 'init':
      void onInit(message.model, message.settings, message.syntaxTheme);
      break;
    case 'update':
      onUpdate(message.model);
      break;
    case 'navigate':
      if (message.direction === 'next') {
        navigation.next();
      } else {
        navigation.prev();
      }
      break;
    case 'theme':
      if (model) {
        void initHighlighting(monaco, message.syntaxTheme, model.languageId);
        setDiffDecorations(model); // ruler colors are resolved, not CSS vars
      }
      break;
    case 'editorConfig':
      if (editors) {
        applyUserOptions(editors, message.options, settings?.rightSide !== 'worktree');
        connectors.schedule();
      }
      break;
  }
});

async function onInit(
  m: AlignedDiffModel,
  s: DiffSettings,
  theme: SyntaxTheme | undefined
): Promise<void> {
  settings = s;
  layout = createLayout(root);
  editors = createEditors(layout.leftHost, layout.rightHost, s.editorOptions ?? {});
  const { monacoLanguage } = await initHighlighting(monaco, theme, m.languageId);

  applyingRemote = true;
  try {
    editors.left.setModel(monaco.editor.createModel(sideText(m, 'left'), monacoLanguage));
    editors.right.setModel(monaco.editor.createModel(sideText(m, 'right'), monacoLanguage));
  } finally {
    applyingRemote = false;
  }
  editors.right.updateOptions({ readOnly: s.rightSide !== 'worktree' });

  wireEditing(editors.right);
  wireKeys(editors);
  refreshAll(m);
}

function onUpdate(m: AlignedDiffModel): void {
  if (!editors) {
    return;
  }
  const leftText = sideText(m, 'left');
  const rightText = sideText(m, 'right');
  applyingRemote = true;
  try {
    if (editors.left.getValue() !== leftText) {
      editors.left.setValue(leftText);
    }
    const currentRight = editors.right.getValue();
    if (currentRight === rightText) {
      localDirty = false; // editor and document converged
    } else if (!localDirty && editTimer === undefined) {
      // genuine external change (chunk revert, git checkout, edit in the
      // regular editor) — never clobber keystrokes still in flight
      editors.right.setValue(rightText);
    }
  } finally {
    applyingRemote = false;
  }
  refreshAll(m);
}

function refreshAll(m: AlignedDiffModel): void {
  model = m;
  if (!editors || !layout) {
    return;
  }
  setHeaderLabels(layout, m);
  setDiffDecorations(m);

  scrollSync.attach(editors.left, editors.right, m);
  connectors.attach(layout.gutter, editors.left, editors.right, m, chunkActions());
  navigation.setModel(m);
}

function setDiffDecorations(m: AlignedDiffModel): void {
  if (!editors) {
    return;
  }
  diffDecorLeft ??= editors.left.createDecorationsCollection([]);
  diffDecorRight ??= editors.right.createDecorationsCollection([]);
  diffDecorLeft.set(buildDiffDecorations(m, 'left'));
  // the right pane owns the only visible scrollbar — chunk markers go there
  diffDecorRight.set([...buildDiffDecorations(m, 'right'), ...buildOverviewRulerDecorations(m)]);
}

function onNavChange(current: number, total: number, scroll: boolean): void {
  toolbar.counter.textContent =
    total === 0 ? 'No changes' : `${current >= 0 ? current + 1 : '–'} / ${total}`;
  connectors.setActiveChunk(current);
  if (!model || !editors) {
    return;
  }
  activeDecorLeft ??= editors.left.createDecorationsCollection([]);
  activeDecorRight ??= editors.right.createDecorationsCollection([]);
  activeDecorLeft.set(buildActiveChunkDecorations(model, current, 'left'));
  activeDecorRight.set(buildActiveChunkDecorations(model, current, 'right'));
  if (current >= 0) {
    post({ type: 'currentChunkChanged', chunkId: current });
    if (scroll) {
      scrollToChunk(model.chunks[current]);
    }
  }
}

function scrollToChunk(chunk: DiffChunk): void {
  if (!editors) {
    return;
  }
  const [lt, lb] = sideExtent(editors.left, chunk.leftStart, chunk.leftCount);
  const [rt, rb] = sideExtent(editors.right, chunk.rightStart, chunk.rightCount);
  centerOn(editors.left, (lt + lb) / 2);
  centerOn(editors.right, (rt + rb) / 2);
  connectors.schedule();
}

function centerOn(editor: monaco.editor.IStandaloneCodeEditor, y: number): void {
  scrollSync.setScrollTop(editor, y - editor.getLayoutInfo().height / 2);
}

/** Local edits → debounced full-text sync into the real document (kept dirty). */
function wireEditing(right: monaco.editor.IStandaloneCodeEditor): void {
  right.onDidChangeModelContent(() => {
    if (applyingRemote || settings?.rightSide !== 'worktree') {
      return;
    }
    localDirty = true;
    if (editTimer !== undefined) {
      clearTimeout(editTimer);
    }
    editTimer = window.setTimeout(postEdit, 200);
  });
}

function postEdit(): void {
  editTimer = undefined;
  if (editors) {
    post({ type: 'edit', text: editors.right.getValue() });
  }
}

function wireKeys(eds: DiffEditors): void {
  // Ctrl+S inside the webview: flush pending edits, then save the document
  eds.right.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    if (editTimer !== undefined) {
      clearTimeout(editTimer);
      postEdit();
    }
    post({ type: 'saveFile' });
  });
  for (const editor of [eds.left, eds.right]) {
    editor.addCommand(monaco.KeyCode.F7, () => navigation.next());
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F7, () => navigation.prev());
  }
}

/**
 * Worktree diffs offer revert + stage per chunk (unstage once the chunk is
 * already in the index) — just revert when compared with another revision;
 * index diffs offer unstage; ref diffs are read-only.
 */
function chunkActions(): ChunkActionsConfig | undefined {
  if (!settings || settings.rightSide === 'ref') {
    return undefined;
  }
  const side = settings.rightSide;
  const canStage = settings.canStage;
  return {
    kindsFor: (chunk) =>
      side !== 'worktree'
        ? ['unstageChunk']
        : canStage
          ? ['revertChunk', chunk.staged ? 'unstageChunk' : 'stageChunk']
          : ['revertChunk'],
    onAction: (kind, chunkId) => post({ type: kind, chunkId }),
  };
}

function createToolbar(): { element: HTMLElement; counter: HTMLElement } {
  const element = document.createElement('div');
  element.className = 'toolbar';

  const prev = document.createElement('button');
  prev.textContent = '▲';
  prev.title = 'Previous Change (Shift+F7)';
  prev.addEventListener('click', () => navigation.prev());

  const counter = document.createElement('span');
  counter.className = 'counter';
  counter.textContent = '';

  const next = document.createElement('button');
  next.textContent = '▼';
  next.title = 'Next Change (F7)';
  next.addEventListener('click', () => navigation.next());

  element.append(prev, counter, next);
  document.body.appendChild(element);
  return { element, counter };
}

function post(message: WebviewMessage): void {
  vscodeApi.postMessage(message);
}

post({ type: 'ready' });
