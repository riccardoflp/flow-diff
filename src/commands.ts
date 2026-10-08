import * as path from 'path';
import * as vscode from 'vscode';
import { buildModel, refreshPanel } from './diffBuilder';
import { GitService } from './git/gitService';
import { Change, Repository } from './git/api';
import { DiffDescriptor, DiffPanel } from './panel/diffPanel';
import { PanelRegistry } from './panel/panelRegistry';
import { pickRef } from './refPicker';

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
    vscode.commands.registerCommand('flowDiff.compareWith', (resource?: unknown) =>
      compareWith(git, registry, resource)
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

/** Picks a branch/tag/commit and diffs the file at that revision against the worktree. */
async function compareWith(git: GitService, registry: PanelRegistry, resource: unknown): Promise<void> {
  // from inside a Flow Diff panel there is no text editor: use the panel's file
  const uri = resolveUri(resource) ?? registry.getActive()?.descriptor.fileUri;
  if (!uri) {
    void vscode.window.showWarningMessage('Flow Diff: no file selected.');
    return;
  }
  const repo = await git.getRepository(uri);
  if (!repo) {
    void vscode.window.showWarningMessage('Flow Diff: file is not part of a git repository.');
    return;
  }
  const ref = await pickRef(repo, uri);
  if (ref) {
    await openDiffAtRefs(git, registry, { fileUri: uri, leftRef: ref });
  }
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

/**
 * F7 past the last chunk: replaces the panel with the diff of the next (or
 * previous) changed file, in path order, wrapping around. Files that cannot
 * be diffed (binary, too complex) are skipped.
 */
export async function openAdjacentFile(
  git: GitService,
  registry: PanelRegistry,
  panel: DiffPanel,
  direction: 'next' | 'prev'
): Promise<void> {
  const { fileUri, rightSide, repoRoot } = panel.descriptor;
  const repo = await git.getRepository(fileUri);
  if (!repo) {
    return;
  }
  const files = changedFiles(repo, rightSide);
  const current = fileUri.fsPath;
  // files after the current one in the given direction, then wrapping around
  const below = files.filter((f) => compare(f, current) < 0);
  const above = files.filter((f) => compare(f, current) > 0);
  const candidates =
    direction === 'next' ? [...above, ...below] : [...below.reverse(), ...above.reverse()];

  for (const candidate of candidates) {
    const descriptor: DiffDescriptor = {
      repoRoot,
      fileUri: vscode.Uri.file(candidate),
      leftRef: 'HEAD',
      rightSide,
    };
    const built = await buildModel(git, descriptor, { interactive: false });
    if (built) {
      const next = registry.getOrCreate(descriptor);
      next.setModel(built.model, built.inputKey);
      next.reveal();
      if (next !== panel) {
        panel.close();
      }
      return;
    }
  }
  void vscode.window.showInformationMessage('Flow Diff: no other changed files.');
}

/** Paths with changes on the given side, sorted, without duplicates. */
function changedFiles(repo: Repository, side: 'worktree' | 'index'): string[] {
  // untrackedChanges is only populated with git.untrackedChanges = "separate"
  const untracked = (repo.state as { untrackedChanges?: Change[] }).untrackedChanges ?? [];
  const changes =
    side === 'index' ? repo.state.indexChanges : [...repo.state.workingTreeChanges, ...untracked];
  return [...new Set(changes.map((c) => c.uri.fsPath))].sort(compare);
}

function compare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
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
