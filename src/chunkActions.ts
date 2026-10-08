import * as path from 'path';
import * as vscode from 'vscode';
import { AlignedDiffModel, DiffChunk } from './diff/model';
import { stagePatch, unstagePatch } from './diff/chunkPatch';
import { normalizeEol } from './diff/hunks';
import { refreshPanel } from './diffBuilder';
import { Repository } from './git/api';
import { applyPatchToIndex, removeFromIndex } from './git/gitCli';
import { GitService } from './git/gitService';
import { canStage, DiffPanel } from './panel/diffPanel';

export type ChunkActionKind = 'revertChunk' | 'stageChunk' | 'unstageChunk';

/** Host-side handlers for the per-chunk gutter buttons. */
export class ChunkActions {
  constructor(private readonly git: GitService) {}

  async handle(panel: DiffPanel, action: ChunkActionKind, chunkId: number): Promise<void> {
    const model = panel.currentModel;
    const chunk = model?.chunks.find((c) => c.id === chunkId);
    if (!model || !chunk) {
      return;
    }
    if (action !== 'revertChunk' && !canStage(panel.descriptor)) {
      return; // the webview never offers these against a non-HEAD revision
    }
    try {
      switch (action) {
        case 'revertChunk':
          await this.revertChunk(panel, model, chunk);
          break;
        case 'stageChunk':
          await this.stageChunk(panel, model, chunk);
          break;
        case 'unstageChunk':
          await this.unstageChunk(panel, model, chunk);
          break;
      }
      await refreshPanel(this.git, panel);
    } catch (error) {
      void vscode.window.showWarningMessage(
        `Flow Diff: ${actionLabel(action)} failed — ${String((error as Error).message ?? error)}`
      );
    }
  }

  /** Restores the HEAD version of the chunk in the working tree (undoable edit + save). */
  private async revertChunk(
    panel: DiffPanel,
    model: AlignedDiffModel,
    chunk: DiffChunk
  ): Promise<void> {
    const uri = panel.descriptor.fileUri;
    const document = await vscode.workspace.openTextDocument(uri);
    if (!rightSideMatches(document, model, chunk)) {
      throw new Error('the file changed since the diff was computed, retry');
    }

    const leftLines = sideLines(model, chunk, 'left');
    const edit = new vscode.WorkspaceEdit();
    if (chunk.rightCount > 0) {
      const startLine = chunk.rightStart - 1;
      const endLineExclusive = startLine + chunk.rightCount;
      if (endLineExclusive < document.lineCount) {
        edit.replace(
          uri,
          new vscode.Range(startLine, 0, endLineExclusive, 0),
          leftLines.map((l) => l + '\n').join('')
        );
      } else {
        // chunk reaches a final line without trailing newline
        const lastLine = document.lineCount - 1;
        edit.replace(
          uri,
          new vscode.Range(startLine, 0, lastLine, document.lineAt(lastLine).text.length),
          leftLines.join('\n')
        );
      }
    } else {
      // pure deletion: re-insert the HEAD lines (rightStart = line before, 1-based)
      if (chunk.rightStart < document.lineCount) {
        edit.insert(uri, new vscode.Position(chunk.rightStart, 0), leftLines.join('\n') + '\n');
      } else {
        const lastLine = document.lineCount - 1;
        edit.insert(
          uri,
          new vscode.Position(lastLine, document.lineAt(lastLine).text.length),
          '\n' + leftLines.join('\n')
        );
      }
    }
    if (!(await vscode.workspace.applyEdit(edit))) {
      throw new Error('the edit could not be applied');
    }
    await document.save();
  }

  /** Moves the index towards the worktree on the chunk's region. */
  private async stageChunk(
    panel: DiffPanel,
    model: AlignedDiffModel,
    chunk: DiffChunk
  ): Promise<void> {
    const { repo, relative } = await this.resolve(panel);
    const { fileUri } = panel.descriptor;
    const index = await this.git.getContent(repo, fileUri, 'index');
    if (index === undefined) {
      // untracked file: there is no index entry to patch — stage it whole
      await repo.add([fileUri.fsPath]);
      return;
    }
    const worktree = (await this.git.getContent(repo, fileUri, 'worktree')) ?? '';
    assertSideMatches(model, 'right', worktree);
    const patch = stagePatch(relative, index, worktree, {
      start: chunk.rightStart,
      count: chunk.rightCount,
    });
    if (patch) {
      await applyToIndex(panel, patch);
    }
  }

  /**
   * Moves the index back towards HEAD on the chunk's region. In the index
   * view the chunk's right side is the index; in the worktree view (staged
   * chunk) its left side is HEAD.
   */
  private async unstageChunk(
    panel: DiffPanel,
    model: AlignedDiffModel,
    chunk: DiffChunk
  ): Promise<void> {
    const { repo, relative } = await this.resolve(panel);
    const { fileUri, repoRoot, rightSide } = panel.descriptor;
    const [index, head] = await Promise.all([
      this.git.getContent(repo, fileUri, 'index'),
      this.git.getContent(repo, fileUri, { ref: 'HEAD' }),
    ]);
    if (index === undefined) {
      return; // nothing staged
    }
    if (head === undefined) {
      // added in the index, not in HEAD: the whole file is the one chunk
      await removeFromIndex(repoRoot, relative);
      return;
    }
    const fromIndexView = rightSide === 'index';
    assertSideMatches(model, fromIndexView ? 'right' : 'left', fromIndexView ? index : head);
    const patch = fromIndexView
      ? unstagePatch(relative, index, head, { start: chunk.rightStart, count: chunk.rightCount }, 'index')
      : unstagePatch(relative, index, head, { start: chunk.leftStart, count: chunk.leftCount }, 'head');
    if (patch) {
      await applyToIndex(panel, patch);
    }
  }

  private async resolve(panel: DiffPanel): Promise<{ repo: Repository; relative: string }> {
    const repo = await this.git.getRepository(panel.descriptor.fileUri);
    if (!repo) {
      throw new Error('no git repository for this file');
    }
    return { repo, relative: path.relative(panel.descriptor.repoRoot, panel.descriptor.fileUri.fsPath) };
  }
}

/**
 * The patch is built from decoded text and reaches git as UTF-8, so it must
 * mean the same bytes as the file: refuse instead of corrupting the index.
 */
async function applyToIndex(panel: DiffPanel, patch: string): Promise<void> {
  const { fileUri, repoRoot } = panel.descriptor;
  const encoding = vscode.workspace.getConfiguration('files', fileUri).get<string>('encoding', 'utf8');
  if (encoding !== 'utf8' && encoding !== 'utf8bom' && /[^\x00-\x7f]/.test(patch)) {
    throw new Error(`chunk staging needs UTF-8 text, this file is ${encoding} — stage the whole file`);
  }
  // git's decoder strips a UTF-8 BOM: a hunk on line 1 would lose or misplace it
  if (/^@@ -[01],/m.test(patch) && (await startsWithBom(fileUri))) {
    throw new Error('the first line of a file with a BOM cannot be staged per chunk — stage the whole file');
  }
  await applyPatchToIndex(repoRoot, patch);
}

async function startsWithBom(uri: vscode.Uri): Promise<boolean> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  } catch {
    return false;
  }
}

/** Race guard: the chunk coordinates are only valid for the text the model was built from. */
function assertSideMatches(model: AlignedDiffModel, side: 'left' | 'right', text: string): void {
  const expected: string[] = [];
  for (const row of model.rows) {
    const cell = side === 'left' ? row.left : row.right;
    if (cell.kind !== 'filler' && cell.text !== undefined) {
      expected.push(cell.text);
    }
  }
  const actual = normalizeEol(text).split('\n');
  if (actual[actual.length - 1] === '') {
    actual.pop();
  }
  if (actual.length !== expected.length || actual.some((line, i) => line !== expected[i])) {
    throw new Error('the file changed since the diff was computed, retry');
  }
}

function sideLines(model: AlignedDiffModel, chunk: DiffChunk, side: 'left' | 'right'): string[] {
  const lines: string[] = [];
  for (let i = chunk.rowStart; i < chunk.rowEnd; i++) {
    const cell = side === 'left' ? model.rows[i].left : model.rows[i].right;
    if (cell.kind !== 'filler' && cell.text !== undefined) {
      lines.push(cell.text);
    }
  }
  return lines;
}

/** Race guard: the document must still contain what the model says it does. */
function rightSideMatches(
  document: vscode.TextDocument,
  model: AlignedDiffModel,
  chunk: DiffChunk
): boolean {
  if (chunk.rightCount === 0) {
    return true;
  }
  const expected = sideLines(model, chunk, 'right');
  const startLine = chunk.rightStart - 1;
  if (startLine + chunk.rightCount > document.lineCount) {
    return false;
  }
  for (let j = 0; j < expected.length; j++) {
    if (document.lineAt(startLine + j).text !== expected[j]) {
      return false;
    }
  }
  return true;
}

function actionLabel(action: ChunkActionKind): string {
  switch (action) {
    case 'revertChunk':
      return 'revert chunk';
    case 'stageChunk':
      return 'stage chunk';
    case 'unstageChunk':
      return 'unstage chunk';
  }
}
