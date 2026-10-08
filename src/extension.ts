import * as vscode from 'vscode';
import { ChunkActions } from './chunkActions';
import { registerCommands } from './commands';
import { diffEngine } from './diffBuilder';
import { GitService } from './git/gitService';
import { PanelRegistry } from './panel/panelRegistry';
import { ThemeService } from './theme/themeService';
import { DiffTakeover } from './watch/diffTakeover';
import { Refresher } from './watch/refresher';

export function activate(context: vscode.ExtensionContext): void {
  const git = new GitService();
  const themes = new ThemeService();
  const chunkActions = new ChunkActions(git);
  const registry = new PanelRegistry(context.extensionUri, themes, (panel, message) =>
    void chunkActions.handle(panel, message.type, message.chunkId)
  );
  const refresher = new Refresher(git, registry);

  context.subscriptions.push(
    registry,
    refresher,
    diffEngine,
    new DiffTakeover(),
    vscode.window.onDidChangeActiveColorTheme(() => {
      for (const panel of registry.all()) {
        void panel.refreshTheme();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('editor')) {
        for (const panel of registry.all()) {
          panel.refreshEditorConfig();
        }
      }
    })
  );
  registerCommands(context, git, registry);
  void refresher.init();
}

export function deactivate(): void {}
