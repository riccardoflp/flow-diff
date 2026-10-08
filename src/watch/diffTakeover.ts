import * as vscode from 'vscode';

/**
 * There is no API to replace the built-in diff editor, so this watches for
 * newly opened git diff tabs (SCM view clicks, "Open Changes", gutter
 * indicators), closes them and opens Flow Diff on the same file instead.
 * Controlled by the `flowDiff.interceptGitOpenChange` setting.
 * (Overriding the `git.openChange` command is not possible: registering an
 * already-registered command id throws and aborts activation.)
 */
export class DiffTakeover implements vscode.Disposable {
  private readonly disposable: vscode.Disposable;

  constructor() {
    this.disposable = vscode.window.tabGroups.onDidChangeTabs((event) => {
      for (const tab of event.opened) {
        void this.maybeTakeOver(tab);
      }
    });
  }

  private async maybeTakeOver(tab: vscode.Tab): Promise<void> {
    const enabled = vscode.workspace
      .getConfiguration('flowDiff')
      .get<boolean>('interceptGitOpenChange', true);
    if (!enabled || !(tab.input instanceof vscode.TabInputTextDiff)) {
      return;
    }
    const { original, modified } = tab.input;
    console.log(
      `[FlowDiff] tab opened — original: ${original.scheme}://${original.path}?${original.query}  modified: ${modified.scheme}://${modified.path}?${modified.query}`
    );
    const action = this.resolveAction(original, modified);
    if (!action) {
      console.log(`[FlowDiff] no matching rule for schemes: ${original.scheme} → ${modified.scheme}`);
      return;
    }

    try {
      await vscode.window.tabGroups.close(tab);
    } catch {
      // tab already gone — still open ours
    }
    await action();
  }

  private resolveAction(
    original: vscode.Uri,
    modified: vscode.Uri
  ): (() => Thenable<unknown>) | undefined {
    if (original.scheme === 'git' && modified.scheme === 'file') {
      // unstaged: working tree vs HEAD
      return () => vscode.commands.executeCommand('flowDiff.openDiff', modified);
    }
    if (original.scheme === 'git' && modified.scheme === 'git') {
      const leftRef = gitRef(original);
      const rightRef = gitRef(modified);
      if (rightRef === '') {
        // staged: index vs HEAD
        return () =>
          vscode.commands.executeCommand('flowDiff.openDiffStaged', vscode.Uri.file(modified.fsPath));
      }
      if (isHistoricalRef(leftRef) && isHistoricalRef(rightRef)) {
        // Source Control Graph / commit history: commit A vs commit B (read-only)
        return () =>
          vscode.commands.executeCommand('flowDiff.openDiffRefs', {
            fileUri: vscode.Uri.file(modified.fsPath),
            leftRef,
            rightRef,
          });
      }
    }
    return undefined;
  }

  dispose(): void {
    this.disposable.dispose();
  }
}

/**
 * True for refs that name a commit ('HEAD', a SHA, a branch) as opposed to the
 * index ('') or the working tree ('~') in git:// uri queries.
 */
function isHistoricalRef(ref: string | undefined): ref is string {
  return ref !== undefined && ref !== '' && ref !== '~';
}

function gitRef(uri: vscode.Uri): string | undefined {
  try {
    return (JSON.parse(uri.query) as { ref?: string }).ref;
  } catch {
    return undefined;
  }
}
