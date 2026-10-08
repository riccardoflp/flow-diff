import * as path from 'path';
import * as vscode from 'vscode';
import { ChangeNode, changesUnder } from './localChanges';

/**
 * Inline / context actions of the Local Changes tree. Each takes the clicked
 * node and, with multi-selection, the selected nodes; folders and groups act
 * on every file below them. Open panels refresh through the git state event.
 */
export function registerTreeCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('flowDiff.tree.stage', (node: ChangeNode, nodes?: ChangeNode[]) =>
      run('stage', node, nodes, (repo, paths) => repo.add(paths))
    ),
    vscode.commands.registerCommand('flowDiff.tree.unstage', (node: ChangeNode, nodes?: ChangeNode[]) =>
      run('unstage', node, nodes, (repo, paths) => repo.revert(paths))
    ),
    vscode.commands.registerCommand('flowDiff.tree.discard', async (node: ChangeNode, nodes?: ChangeNode[]) => {
      const count = targets(node, nodes).reduce((n, t) => n + changesUnder(t).length, 0);
      const what = count === 1 ? path.basename(changesUnder(node)[0].uri.fsPath) : `${count} files`;
      const choice = await vscode.window.showWarningMessage(
        `Discard all changes in ${what}? This cannot be undone.`,
        { modal: true },
        'Discard Changes'
      );
      if (choice === 'Discard Changes') {
        await run('discard', node, nodes, (repo, paths) => repo.clean(paths));
      }
    }),
    vscode.commands.registerCommand('flowDiff.tree.openFile', (node: ChangeNode, nodes?: ChangeNode[]) => {
      for (const target of targets(node, nodes)) {
        for (const change of changesUnder(target)) {
          void vscode.window.showTextDocument(change.uri, { preview: false });
        }
      }
    })
  );
}

function targets(node: ChangeNode, nodes: ChangeNode[] | undefined): ChangeNode[] {
  return nodes && nodes.length > 0 ? nodes : [node];
}

async function run(
  label: string,
  node: ChangeNode,
  nodes: ChangeNode[] | undefined,
  action: (repo: ChangeNode['repo'], paths: string[]) => Promise<void>
): Promise<void> {
  // a multi-selection may span repositories: one call per repository
  const byRepo = new Map<ChangeNode['repo'], Set<string>>();
  for (const target of targets(node, nodes)) {
    const paths = byRepo.get(target.repo) ?? new Set<string>();
    changesUnder(target).forEach((change) => paths.add(change.uri.fsPath));
    byRepo.set(target.repo, paths);
  }
  try {
    for (const [repo, paths] of byRepo) {
      await action(repo, [...paths]);
    }
  } catch (error) {
    void vscode.window.showWarningMessage(
      `Flow Diff: ${label} failed — ${String((error as Error).message ?? error)}`
    );
  }
}
