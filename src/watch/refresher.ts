import * as vscode from 'vscode';
import { refreshPanel } from '../diffBuilder';
import { Repository } from '../git/api';
import { GitService } from '../git/gitService';
import { DiffPanel } from '../panel/diffPanel';
import { PanelRegistry } from '../panel/panelRegistry';

const DEBOUNCE_MS = 250;

/**
 * Keeps open diff panels in sync with the working tree / index, and maintains
 * the `flowDiff.activeFileHasChanges` context key for the editor-title button.
 *
 * Only the panels affected by an event are refreshed (same file, or same
 * repository for git state changes), runs never overlap, and a panel whose
 * inputs did not change skips the diff entirely (see `refreshPanel`).
 */
export class Refresher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly pendingFiles = new Set<string>();
  private readonly pendingRepos = new Set<string>();
  private running = false;
  private rerun = false;

  constructor(
    private readonly git: GitService,
    private readonly registry: PanelRegistry
  ) {}

  async init(): Promise<void> {
    const api = await this.git.getApi();
    const hookRepo = (repo: Repository) =>
      this.disposables.push(
        repo.state.onDidChange(() => this.schedule(this.pendingRepos, repo.rootUri.fsPath))
      );

    api.repositories.forEach(hookRepo);
    this.disposables.push(
      api.onDidOpenRepository(hookRepo),
      vscode.workspace.onDidSaveTextDocument((document) =>
        this.schedule(this.pendingFiles, document.uri.toString())
      ),
      // live diff while typing (incl. echoes of webview edits): only for files
      // that actually have an open diff panel
      vscode.workspace.onDidChangeTextDocument((event) => {
        const changed = event.document.uri.toString();
        if (this.registry.all().some((panel) => panel.descriptor.fileUri.toString() === changed)) {
          this.schedule(this.pendingFiles, changed);
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => void this.updateContextKey())
    );
    void this.updateContextKey();
  }

  private schedule(pending: Set<string>, key: string): void {
    pending.add(key);
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => void this.run(), DEBOUNCE_MS);
  }

  private async run(): Promise<void> {
    this.timer = undefined;
    if (this.running) {
      this.rerun = true; // picked up when the current run ends
      return;
    }
    this.running = true;
    try {
      void this.updateContextKey();
      const files = new Set(this.pendingFiles);
      const repos = new Set(this.pendingRepos);
      this.pendingFiles.clear();
      this.pendingRepos.clear();
      const affected = (panel: DiffPanel) =>
        files.has(panel.descriptor.fileUri.toString()) || repos.has(panel.descriptor.repoRoot);
      for (const panel of this.registry.all().filter(affected)) {
        await refreshPanel(this.git, panel);
      }
    } finally {
      this.running = false;
      if (this.rerun) {
        this.rerun = false;
        void this.run();
      }
    }
  }

  private async updateContextKey(): Promise<void> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    let hasChanges = false;
    if (uri?.scheme === 'file') {
      const repo = await this.git.getRepository(uri);
      if (repo) {
        hasChanges = this.git.hasChanges(repo, uri);
      }
    }
    void vscode.commands.executeCommand('setContext', 'flowDiff.activeFileHasChanges', hasChanges);
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.disposables.forEach((d) => d.dispose());
  }
}
