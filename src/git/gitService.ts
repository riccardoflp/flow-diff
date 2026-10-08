import * as vscode from 'vscode';
import { API, GitExtension, Repository } from './api';

/** Which version of a file to read. */
export type DiffSide = 'worktree' | 'index' | { ref: string };

export class GitService {
  private api: API | undefined;

  async getApi(): Promise<API> {
    if (!this.api) {
      const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
      if (!extension) {
        throw new Error('Built-in git extension not available');
      }
      const gitExtension = extension.isActive ? extension.exports : await extension.activate();
      this.api = gitExtension.getAPI(1);
    }
    return this.api;
  }

  async getRepository(uri: vscode.Uri): Promise<Repository | undefined> {
    const api = await this.getApi();
    return api.getRepository(uri) ?? undefined;
  }

  /**
   * Content of `uri` at the given side, or undefined when the file does not
   * exist there (untracked at a ref, deleted in the worktree, ...).
   * Worktree reads go through the text document: unsaved edits are diffed
   * too, and the file is decoded like the editor does (BOM, `files.encoding`)
   * — the same setting `repo.show` decodes the git side with.
   */
  async getContent(repo: Repository, uri: vscode.Uri, side: DiffSide): Promise<string | undefined> {
    if (side === 'worktree') {
      try {
        return (await vscode.workspace.openTextDocument(uri)).getText();
      } catch {
        // deleted, or refused as text (binary, too large): raw bytes, if any,
        // still reach the binary guard
        try {
          return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        } catch {
          return undefined;
        }
      }
    }

    // `repo.show('', path)` reads from the index (`git show :path`).
    const ref = side === 'index' ? '' : side.ref;
    try {
      return await repo.show(ref, uri.fsPath);
    } catch {
      return undefined;
    }
  }

  /** True when the file appears among the repo's working tree or index changes. */
  hasChanges(repo: Repository, uri: vscode.Uri): boolean {
    const all = [...repo.state.workingTreeChanges, ...repo.state.indexChanges];
    return all.some((change) => change.uri.fsPath === uri.fsPath);
  }
}
