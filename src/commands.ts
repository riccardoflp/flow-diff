import * as path from 'path';
import * as vscode from 'vscode';
import { buildModel, refreshPanel } from './diffBuilder';
import { GitService } from './git/gitService';
import { DiffDescriptor } from './panel/diffPanel';
import { PanelRegistry } from './panel/panelRegistry';

export function registerCommands(
  context: vscode.ExtensionContext,
  git: GitService,
  registry: PanelRegistry
): void {
  context.subscriptions.push(
    // NOTE: do not registerCommand('git.openChange') here — the id is already
    // registered by the built-in git extension and a duplicate registration
    // throws, aborting activation. The default-diff takeover lives in
    // watch/diffTakeover.ts (tab interception) instead.
    vscode.commands.registerCommand('flowDiff.openDiff', (resource?: unknown) =>
      openDiff(git, registry, resource, 'worktree')
    ),
    vscode.commands.registerCommand('flowDiff.openDiffStaged', (resource?: unknown) =>
      openDiff(git, registry, resource, 'index')
    ),
    vscode.commands.registerCommand('flowDiff.nextChunk', () =>
      registry.getActive()?.navigate('next')
    ),
    vscode.commands.registerCommand('flowDiff.prevChunk', () =>
      registry.getActive()?.navigate('prev')
    ),
    vscode.commands.registerCommand('flowDiff.openFile', () =>
      fileAction(git, registry, 'open')
    ),
    vscode.commands.registerCommand('flowDiff.stageFile', () =>
      fileAction(git, registry, 'stage')
    ),
    vscode.commands.registerCommand('flowDiff.unstageFile', () =>
      fileAction(git, registry, 'unstage')
    ),
    vscode.commands.registerCommand('flowDiff.revertFile', () =>
      fileAction(git, registry, 'discard')
    ),
    vscode.commands.registerCommand(
      'flowDiff.openDiffRefs',
      (args: { fileUri: vscode.Uri; leftRef: string; rightRef?: string }) =>
        openDiffAtRefs(git, registry, args)
    )
  );
}

/** Whole-file actions for the panel title bar (parity with the built-in diff editor). */
async function fileAction(
  git: GitService,
  registry: PanelRegistry,
  kind: 'open' | 'stage' | 'unstage' | 'discard'
): Promise<void> {
  const panel = registry.getActive();
  if (!panel) {
    return;
  }
  const uri = panel.descriptor.fileUri;
  if (kind === 'open') {
    void vscode.window.showTextDocument(uri, { preview: false });
    return;
  }
  const repo = await git.getRepository(uri);
  if (!repo) {
    return;
  }
  try {
    switch (kind) {
      case 'stage':
        await repo.add([uri.fsPath]);
        break;
      case 'unstage':
        await repo.revert([uri.fsPath]);
        break;
      case 'discard': {
        const choice = await vscode.window.showWarningMessage(
          `Discard all changes in ${path.basename(uri.fsPath)}? This cannot be undone.`,
          { modal: true },
          'Discard Changes'
        );
        if (choice !== 'Discard Changes') {
          return;
        }
        await repo.clean([uri.fsPath]);
        break;
      }
    }
    await refreshPanel(git, panel);
  } catch (error) {
    void vscode.window.showWarningMessage(
      `Flow Diff: ${kind} failed — ${String((error as Error).message ?? error)}`
    );
  }
}

async function openDiff(
  git: GitService,
  registry: PanelRegistry,
  resource: unknown,
  rightSide: 'worktree' | 'index'
): Promise<void> {
  const uri = resolveUri(resource);
  if (!uri) {
    void vscode.window.showWarningMessage('Flow Diff: no file selected.');
    return;
  }
  const repo = await git.getRepository(uri);
  if (!repo) {
    void vscode.window.showWarningMessage('Flow Diff: file is not part of a git repository.');
    return;
  }

  const descriptor: DiffDescriptor = {
    repoRoot: repo.rootUri.fsPath,
    fileUri: uri,
    leftRef: 'HEAD',
    rightSide,
  };
  const built = await buildModel(git, descriptor, { interactive: true });
  if (!built) {
    return;
  }
  const panel = registry.getOrCreate(descriptor);
  panel.setModel(built.model, built.inputKey);
  panel.reveal();
}

/**
 * Opens a read-only two-ref diff, or a custom-leftRef vs worktree diff when
 * rightRef is omitted. Called by DiffTakeover for GitLens-originated tabs.
 */
async function openDiffAtRefs(
  git: GitService,
  registry: PanelRegistry,
  args: { fileUri: vscode.Uri; leftRef: string; rightRef?: string }
): Promise<void> {
  const repo = await git.getRepository(args.fileUri);
  if (!repo) {
    void vscode.window.showWarningMessage('Flow Diff: file is not part of a git repository.');
    return;
  }
  const descriptor: DiffDescriptor = {
    repoRoot: repo.rootUri.fsPath,
    fileUri: args.fileUri,
    leftRef: args.leftRef,
    rightSide: 'worktree',
    rightRef: args.rightRef,
  };
  const built = await buildModel(git, descriptor, { interactive: true });
  if (!built) {
    return;
  }
  const panel = registry.getOrCreate(descriptor);
  panel.setModel(built.model, built.inputKey);
  panel.reveal();
}

/** Accepts a Uri, an SCM resource state, or nothing (→ active editor). */
function resolveUri(resource: unknown): vscode.Uri | undefined {
  if (resource instanceof vscode.Uri) {
    return resource;
  }
  const state = resource as vscode.SourceControlResourceState | undefined;
  if (state?.resourceUri instanceof vscode.Uri) {
    return state.resourceUri;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  return active?.scheme === 'file' ? active : undefined;
}
