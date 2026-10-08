import * as path from 'path';
import * as vscode from 'vscode';
import { normalizeEol } from '../diff/hunks';
import { AlignedDiffModel } from '../diff/model';
import { HostMessage, WebviewMessage } from '../diff/protocol';
import { minimalReplace, offsetToPosition } from '../diff/textEdit';
import { ThemeService } from '../theme/themeService';

export interface DiffDescriptor {
  repoRoot: string;
  fileUri: vscode.Uri;
  /** Left side of the comparison, e.g. 'HEAD' or a commit SHA. */
  leftRef: string;
  /** Right side: the live file or the staged copy. Ignored when rightRef is set. */
  rightSide: 'worktree' | 'index';
  /** When set, both sides are historical refs (read-only view). */
  rightRef?: string;
}

/** Index stage/unstage only make sense against HEAD. */
export function canStage(d: DiffDescriptor): boolean {
  return !d.rightRef && d.leftRef === 'HEAD';
}

export function diffKey(d: DiffDescriptor): string {
  return [d.repoRoot, d.fileUri.toString(), d.leftRef, d.rightRef ?? d.rightSide].join('|');
}

export type ChunkActionMessage = Extract<
  WebviewMessage,
  { type: 'revertChunk' | 'stageChunk' | 'unstageChunk' }
>;

/** What a panel delegates to the rest of the extension. */
export interface PanelHandlers {
  chunkAction(panel: DiffPanel, message: ChunkActionMessage): void;
  navigateFile(panel: DiffPanel, direction: 'next' | 'prev'): void;
}

export class DiffPanel {
  static readonly viewType = 'flowDiff.panel';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private model: AlignedDiffModel | undefined;
  private modelInputKey: string | undefined;
  private webviewReady = false;
  private initSent = false;

  constructor(
    extensionUri: vscode.Uri,
    readonly descriptor: DiffDescriptor,
    private readonly themes: ThemeService,
    private readonly handlers: PanelHandlers,
    onDispose: () => void
  ) {
    const fileName = path.basename(descriptor.fileUri.fsPath);
    const rightLabel = descriptor.rightRef
      ? shortRef(descriptor.rightRef)
      : descriptor.rightSide === 'worktree' ? 'Working Tree' : 'Index';
    const leftLabel = shortRef(descriptor.leftRef);
    this.panel = vscode.window.createWebviewPanel(
      DiffPanel.viewType,
      `${fileName} (${leftLabel} ↔ ${rightLabel})`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out', 'webview')],
      }
    );
    this.panel.webview.html = this.renderHtml(extensionUri);
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.onMessage(message),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(
      () => {
        this.disposables.forEach((d) => d.dispose());
        onDispose();
      },
      undefined,
      this.disposables
    );
    // Drives the editor/title button when-clauses (stage vs unstage actions).
    this.panel.onDidChangeViewState(
      (event) => {
        if (event.webviewPanel.active) {
          this.setSideContext();
        }
      },
      undefined,
      this.disposables
    );
    this.setSideContext();
  }

  get active(): boolean {
    return this.panel.active;
  }

  get currentModel(): AlignedDiffModel | undefined {
    return this.model;
  }

  /** Hash of the inputs `currentModel` was built from (refresh skips when unchanged). */
  get inputKey(): string | undefined {
    return this.modelInputKey;
  }

  /**
   * Drives the editor/title when-clauses: 'worktree' (vs HEAD: stage and
   * discard), 'worktreeVsRef' (vs another revision: no git file actions),
   * 'index' (unstage) or 'ref' (read-only).
   */
  private setSideContext(): void {
    const { leftRef, rightRef, rightSide } = this.descriptor;
    const side = rightRef
      ? 'ref'
      : rightSide === 'worktree' && leftRef !== 'HEAD' ? 'worktreeVsRef' : rightSide;
    void vscode.commands.executeCommand('setContext', 'flowDiff.activeSide', side);
  }

  reveal(): void {
    this.panel.reveal();
  }

  close(): void {
    this.panel.dispose();
  }

  setModel(model: AlignedDiffModel, inputKey: string): void {
    this.model = model;
    this.modelInputKey = inputKey;
    if (!this.webviewReady) {
      return;
    }
    if (this.initSent) {
      this.post({ type: 'update', model });
    } else {
      void this.sendInit();
    }
  }

  /** Pushes a theme change to an already-initialized webview. */
  async refreshTheme(): Promise<void> {
    if (this.initSent) {
      this.post({ type: 'theme', syntaxTheme: await this.themes.resolveActive() });
    }
  }

  /** Pushes `editor.*` setting changes into the live Monaco panes. */
  refreshEditorConfig(): void {
    if (this.initSent) {
      this.post({ type: 'editorConfig', options: this.readEditorOptions() });
    }
  }

  /**
   * The user's `editor.*` configuration (with language-specific overrides for
   * this file) as plain JSON. JSON round-trip strips the proxy's methods and
   * leaves only setting values, which map 1:1 onto Monaco options.
   */
  private readEditorOptions(): Record<string, unknown> {
    const scope: vscode.ConfigurationScope = this.model
      ? { uri: this.descriptor.fileUri, languageId: this.model.languageId }
      : this.descriptor.fileUri;
    return JSON.parse(
      JSON.stringify(vscode.workspace.getConfiguration('editor', scope))
    ) as Record<string, unknown>;
  }

  navigate(direction: 'next' | 'prev'): void {
    this.post({ type: 'navigate', direction });
  }

  private async sendInit(): Promise<void> {
    if (this.initSent || !this.model) {
      return;
    }
    this.initSent = true;
    this.post({
      type: 'init',
      model: this.model,
      settings: {
        editorOptions: this.readEditorOptions(),
        rightSide: this.descriptor.rightRef ? 'ref' : this.descriptor.rightSide,
        canStage: canStage(this.descriptor),
        collapseUnchanged: vscode.workspace
          .getConfiguration('flowDiff')
          .get<boolean>('collapseUnchanged', true),
        // the changed-files list only exists for HEAD↔worktree / HEAD↔index
        fileNavigation: canStage(this.descriptor),
      },
      syntaxTheme: await this.themes.resolveActive(),
    });
  }

  private onMessage(message: WebviewMessage): void {
    switch (message.type) {
      case 'ready':
        this.webviewReady = true;
        void this.sendInit();
        break;
      case 'openAt': {
        const line = Math.max(0, message.line - 1);
        void vscode.window.showTextDocument(this.descriptor.fileUri, {
          selection: new vscode.Range(line, 0, line, 0),
          preview: false,
        });
        break;
      }
      case 'navigateFile':
        this.handlers.navigateFile(this, message.direction);
        break;
      case 'currentChunkChanged':
        // Reserved: could mirror "n of m" into the panel title.
        break;
      case 'revertChunk':
      case 'stageChunk':
      case 'unstageChunk':
        this.handlers.chunkAction(this, message);
        break;
      case 'edit':
        void this.applyWebviewEdit(message.text);
        break;
      case 'saveFile':
        void vscode.workspace
          .openTextDocument(this.descriptor.fileUri)
          .then((document) => document.save());
        break;
    }
  }

  /** In-place edit from the Monaco pane: sync into the real document (kept dirty). */
  private async applyWebviewEdit(text: string): Promise<void> {
    if (this.descriptor.rightSide !== 'worktree' || this.descriptor.rightRef) {
      return;
    }
    const document = await vscode.workspace.openTextDocument(this.descriptor.fileUri);
    // diff in LF space (what the webview works in): line/column positions
    // are the same whatever the document's EOL
    const current = normalizeEol(document.getText());
    const change = minimalReplace(current, text);
    if (!change) {
      return;
    }
    // replace only the changed span, so the document's undo history, other
    // editors' cursors and folding outside it stay untouched
    const start = offsetToPosition(current, change.start);
    const end = offsetToPosition(current, change.end);
    const replacement =
      document.eol === vscode.EndOfLine.CRLF ? change.text.replace(/\n/g, '\r\n') : change.text;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      this.descriptor.fileUri,
      new vscode.Range(start.line, start.character, end.line, end.character),
      replacement
    );
    await vscode.workspace.applyEdit(edit);
  }

  private post(message: HostMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private renderHtml(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'main.css')
    );
    const workerUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'editor.worker.js')
    );
    const nonce = makeNonce();
    // script-src includes cspSource so the module entry can import() its
    // esbuild-split chunks (lazy shiki grammars/themes) and so Monaco's blob
    // worker can importScripts() its bundled code; worker-src allows the blob.
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; worker-src blob:; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="app" data-worker="${workerUri}"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** Commit hashes shortened for labels; branch and tag names kept whole. */
export function shortRef(ref: string): string {
  return /^[0-9a-f]{12,}$/i.test(ref) ? ref.slice(0, 8) : ref;
}