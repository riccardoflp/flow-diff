import * as vscode from 'vscode';
import { ChunkActions } from './chunkActions';
import { openAdjacentFile, registerCommands } from './commands';
import { diffEngine } from './diffBuilder';
import { GitService } from './git/gitService';
import { PanelRegistry } from './panel/panelRegistry';
import { ThemeService } from './theme/themeService';
import { LocalChangesProvider } from './tree/localChanges';
import { registerTreeCommands } from './tree/treeCommands';
import { DiffTakeover } from './watch/diffTakeover';
import { Refresher } from './watch/refresher';

export function activate(context: vscode.ExtensionContext): void {
  const git = new GitService();
  const themes = new ThemeService();
  const chunkActions = new ChunkActions(git);
  const registry: PanelRegistry = new PanelRegistry(context.extensionUri, themes, {
    chunkAction: (panel, message) => void chunkActions.handle(panel, message.type, message.chunkId),
    navigateFile: (panel, direction) => void openAdjacentFile(git, registry, panel, direction),
  });
  const refresher = new Refresher(git, registry);
  const localChanges = new LocalChangesProvider(git);

  context.subscriptions.push(
    registry,
    refresher,
    diffEngine,
    localChanges,
    vscode.window.createTreeView('flowDiff.localChanges', {
      treeDataProvider: localChanges,
      showCollapseAll: true,
      canSelectMany: true,
    }),
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
  registerTreeCommands(context);
  void refresher.init();
  void localChanges.init();
}

export function deactivate(): void {}
