import * as path from 'path';
import * as vscode from 'vscode';
import { API, Change, Repository, Status } from '../git/api';
import { GitService } from '../git/gitService';
import { buildPathTree, DirNode } from './pathTree';

const REFRESH_DEBOUNCE_MS = 150;

export type ChangeGroup = 'staged' | 'changes' | 'untracked';

const GROUP_LABELS: Record<ChangeGroup, string> = {
  staged: 'Staged Changes',
  changes: 'Changes',
  untracked: 'Unversioned Files',
};

export type ChangeNode =
  | { kind: 'repo'; repo: Repository }
  | { kind: 'group'; repo: Repository; group: ChangeGroup; changes: Change[] }
  | { kind: 'dir'; repo: Repository; group: ChangeGroup; dir: DirNode<Change> }
  | { kind: 'file'; repo: Repository; group: ChangeGroup; change: Change };

/**
 * "Local Changes" in the Source Control view, like WebStorm's Commit tool
 * window: staged, unstaged and unversioned files grouped by directory.
 * Clicking a file opens its Flow Diff; inline actions stage, unstage and
 * discard. Repositories get their own top-level node when there are several.
 */
export class LocalChangesProvider implements vscode.TreeDataProvider<ChangeNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [this.emitter];
  private api: API | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly git: GitService) {}

  async init(): Promise<void> {
    const api = await this.git.getApi();
    this.api = api;
    const hookRepo = (repo: Repository) => this.disposables.push(repo.state.onDidChange(() => this.schedule()));
    api.repositories.forEach(hookRepo);
    this.disposables.push(
      api.onDidOpenRepository((repo) => {
        hookRepo(repo);
        this.schedule();
      }),
      api.onDidCloseRepository(() => this.schedule())
    );
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.emitter.fire(), REFRESH_DEBOUNCE_MS);
  }

  getChildren(node?: ChangeNode): ChangeNode[] {
    if (!this.api) {
      return [];
    }
    if (!node) {
      const repos = this.api.repositories;
      return repos.length === 1 ? groupsOf(repos[0]) : repos.map((repo) => ({ kind: 'repo', repo }));
    }
    switch (node.kind) {
      case 'repo':
        return groupsOf(node.repo);
      case 'group':
        return dirChildren(node.repo, node.group, buildPathTree(node.changes.map((change) => ({
          path: path.relative(node.repo.rootUri.fsPath, change.uri.fsPath),
          item: change,
        }))));
      case 'dir':
        return dirChildren(node.repo, node.group, node.dir);
      case 'file':
        return [];
    }
  }

  getTreeItem(node: ChangeNode): vscode.TreeItem {
    const root = node.repo.rootUri;
    switch (node.kind) {
      case 'repo': {
        const item = new vscode.TreeItem(path.basename(root.fsPath), vscode.TreeItemCollapsibleState.Expanded);
        item.id = root.toString();
        item.iconPath = new vscode.ThemeIcon('repo');
        return item;
      }
      case 'group': {
        const item = new vscode.TreeItem(GROUP_LABELS[node.group], vscode.TreeItemCollapsibleState.Expanded);
        item.id = `${root}|${node.group}`;
        item.description = String(node.changes.length);
        item.contextValue = `group-${node.group}`;
        return item;
      }
      case 'dir': {
        const item = new vscode.TreeItem(node.dir.label, vscode.TreeItemCollapsibleState.Expanded);
        item.id = `${root}|${node.group}|${node.dir.path}/`;
        item.resourceUri = vscode.Uri.joinPath(root, node.dir.path);
        item.iconPath = vscode.ThemeIcon.Folder;
        item.contextValue = `dir-${node.group}`;
        return item;
      }
      case 'file': {
        const uri = node.change.uri;
        // resourceUri: file icon from the icon theme + the git extension's status decoration
        const item = new vscode.TreeItem(uri);
        item.id = `${root}|${node.group}|${uri}`;
        item.iconPath = vscode.ThemeIcon.File;
        item.tooltip = `${path.relative(root.fsPath, uri.fsPath)} — ${statusLabel(node.change.status)}`;
        item.contextValue = `file-${node.group}`;
        item.command = {
          title: 'Open Diff',
          command: node.group === 'staged' ? 'flowDiff.openDiffStaged' : 'flowDiff.openDiff',
          arguments: [uri],
        };
        return item;
      }
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.disposables.forEach((d) => d.dispose());
  }
}

/** Every file change at or below a node (what a tree action applies to). */
export function changesUnder(node: ChangeNode): Change[] {
  switch (node.kind) {
    case 'repo':
      return groupsOf(node.repo).flatMap(changesUnder);
    case 'group':
      return node.changes;
    case 'dir': {
      const collect = (dir: DirNode<Change>): Change[] => [
        ...dir.files.map((f) => f.item),
        ...dir.dirs.flatMap(collect),
      ];
      return collect(node.dir);
    }
    case 'file':
      return [node.change];
  }
}

function groupsOf(repo: Repository): ChangeNode[] {
  const { indexChanges, workingTreeChanges, mergeChanges } = repo.state;
  // untrackedChanges is only populated with git.untrackedChanges = "separate"
  const separateUntracked = (repo.state as { untrackedChanges?: Change[] }).untrackedChanges ?? [];
  const groups: Record<ChangeGroup, Change[]> = {
    staged: indexChanges,
    changes: [...mergeChanges, ...workingTreeChanges.filter((c) => c.status !== Status.UNTRACKED)],
    untracked: [...workingTreeChanges.filter((c) => c.status === Status.UNTRACKED), ...separateUntracked],
  };
  return (Object.keys(groups) as ChangeGroup[])
    .filter((group) => groups[group].length > 0)
    .map((group) => ({ kind: 'group', repo, group, changes: groups[group] }));
}

function dirChildren(repo: Repository, group: ChangeGroup, dir: DirNode<Change>): ChangeNode[] {
  return [
    ...dir.dirs.map((d): ChangeNode => ({ kind: 'dir', repo, group, dir: d })),
    ...dir.files.map((f): ChangeNode => ({ kind: 'file', repo, group, change: f.item })),
  ];
}

function statusLabel(status: Status): string {
  switch (status) {
    case Status.INDEX_ADDED:
    case Status.INTENT_TO_ADD:
      return 'Added';
    case Status.INDEX_DELETED:
    case Status.DELETED:
      return 'Deleted';
    case Status.INDEX_RENAMED:
    case Status.INTENT_TO_RENAME:
      return 'Renamed';
    case Status.INDEX_COPIED:
      return 'Copied';
    case Status.UNTRACKED:
      return 'Untracked';
    case Status.TYPE_CHANGED:
      return 'Type changed';
    case Status.INDEX_MODIFIED:
    case Status.MODIFIED:
      return 'Modified';
    default:
      return 'Conflict';
  }
}
