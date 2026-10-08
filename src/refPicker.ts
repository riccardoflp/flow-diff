import * as path from 'path';
import * as vscode from 'vscode';
import { Commit, Ref, RefType, Repository } from './git/api';

const MAX_COMMITS = 50;

interface RefItem extends vscode.QuickPickItem {
  /** What gets passed to `git show <ref>:<path>`; absent on separators. */
  ref?: string;
}

/**
 * QuickPick of branches, tags and the commits that touched `fileUri`, plus
 * whatever revision the user types (`HEAD~3`, a hash, `main@{yesterday}`).
 * Resolves to a ref verified to name a commit, or undefined if cancelled.
 */
export async function pickRef(repo: Repository, fileUri: vscode.Uri): Promise<string | undefined> {
  const quickPick = vscode.window.createQuickPick<RefItem>();
  quickPick.title = `Compare ${path.basename(fileUri.fsPath)} with…`;
  quickPick.placeholder = 'Branch, tag or commit — or type any revision (e.g. HEAD~3)';
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.busy = true;

  let listed: RefItem[] = [];
  // whatever is typed stays pickable as a revision of its own — last, so
  // filtering by branch name or commit message still selects a listed item
  const typed = (value: string): RefItem[] => {
    const ref = value.trim();
    return ref ? [{ label: `$(edit) ${ref}`, description: 'Use this revision', ref, alwaysShow: true }] : [];
  };
  const render = () => {
    quickPick.items = [...listed, ...typed(quickPick.value)];
  };

  void loadItems(repo, fileUri).then((items) => {
    listed = items;
    quickPick.busy = false;
    render();
  });

  const picked = await new Promise<string | undefined>((resolve) => {
    quickPick.onDidChangeValue(render);
    quickPick.onDidAccept(() => {
      resolve(quickPick.selectedItems[0]?.ref ?? (quickPick.value.trim() || undefined));
      quickPick.hide();
    });
    quickPick.onDidHide(() => resolve(undefined));
    quickPick.show();
  });
  quickPick.dispose();

  if (!picked) {
    return undefined;
  }
  try {
    await repo.getCommit(picked);
    return picked;
  } catch {
    void vscode.window.showWarningMessage(`Flow Diff: '${picked}' is not a valid revision.`);
    return undefined;
  }
}

async function loadItems(repo: Repository, fileUri: vscode.Uri): Promise<RefItem[]> {
  const [refs, commits] = await Promise.all([
    repo.getRefs({ sort: 'committerdate' }).catch(() => repo.state.refs),
    repo.log({ path: fileUri.fsPath, maxEntries: MAX_COMMITS }).catch((): Commit[] => []),
  ]);
  const current = repo.state.HEAD?.name;
  const section = (label: string, items: RefItem[]): RefItem[] =>
    items.length > 0 ? [{ label, kind: vscode.QuickPickItemKind.Separator }, ...items] : [];
  const refItem = (ref: Ref, icon: string): RefItem => ({
    label: `$(${icon}) ${ref.name}`,
    description: [ref.name === current ? 'current' : '', ref.commit?.slice(0, 8)].filter(Boolean).join(' · '),
    ref: ref.name,
  });
  const ofType = (type: RefType) =>
    refs.filter((r) => r.type === type && r.name && !r.name.endsWith('/HEAD'));

  return [
    ...section('Branches', ofType(RefType.Head).map((r) => refItem(r, 'git-branch'))),
    ...section('Remote branches', ofType(RefType.RemoteHead).map((r) => refItem(r, 'cloud'))),
    ...section('Tags', ofType(RefType.Tag).map((r) => refItem(r, 'tag'))),
    ...section(
      'Commits touching this file',
      commits.map((c) => ({
        label: `$(git-commit) ${c.message.split('\n')[0]}`,
        description: c.hash.slice(0, 8),
        detail: [c.authorName, c.authorDate?.toLocaleString()].filter(Boolean).join(', '),
        ref: c.hash,
      }))
    ),
  ];
}
