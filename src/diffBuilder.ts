import { createHash } from 'crypto';
import * as vscode from 'vscode';
import { AlignedDiffModel } from './diff/model';
import { DiffEngine } from './diffEngine';
import { GitService } from './git/gitService';
import { DiffDescriptor } from './panel/diffPanel';

/** Beyond this many total lines, ask before computing. */
const LARGE_FILE_LINES = 100_000;

/** A line diff still running after this long is abandoned as "too complex". */
const DIFF_TIMEOUT_MS = 5_000;

/** Shared by every panel; disposed with the extension. */
export const diffEngine = new DiffEngine();

export interface BuildOptions {
  /** When false (refresh path), guards skip silently instead of prompting. */
  interactive: boolean;
  /** Skip (return undefined) when the inputs hash to this key: nothing changed. */
  unlessInputKey?: string;
}

export interface BuiltModel {
  model: AlignedDiffModel;
  /** Hash of everything the model was computed from. */
  inputKey: string;
}

/**
 * Builds the aligned diff model for a descriptor, or undefined when the diff
 * cannot/should not be shown (binary file, declined large-file prompt, ...)
 * or, with `unlessInputKey`, when its inputs did not change.
 */
export async function buildModel(
  git: GitService,
  descriptor: DiffDescriptor,
  options: BuildOptions
): Promise<BuiltModel | undefined> {
  const repo = await git.getRepository(descriptor.fileUri);
  if (!repo) {
    return undefined;
  }

  const markStaged = descriptor.rightSide === 'worktree' && !descriptor.rightRef;
  const [oldText, newText, indexText, languageId] = await Promise.all([
    git.getContent(repo, descriptor.fileUri, { ref: descriptor.leftRef }),
    git.getContent(repo, descriptor.fileUri, descriptor.rightRef ? { ref: descriptor.rightRef } : descriptor.rightSide),
    // worktree views also need the index to mark already-staged chunks
    markStaged ? git.getContent(repo, descriptor.fileUri, 'index') : Promise.resolve(undefined),
    detectLanguageId(descriptor.fileUri),
  ]);
  // Missing on one side = untracked (no HEAD version) or deleted (no worktree
  // version): diff against empty so the whole file shows as added/removed.
  const left = oldText ?? '';
  const right = newText ?? '';

  const inputKey = hashInputs(left, right, indexText, languageId);
  if (inputKey === options.unlessInputKey) {
    return undefined;
  }

  if (looksBinary(left) || looksBinary(right)) {
    if (options.interactive) {
      void vscode.window.showWarningMessage('Flow Diff: this file looks binary.');
    }
    return undefined;
  }

  if (options.interactive && countLines(left) + countLines(right) > LARGE_FILE_LINES) {
    const choice = await vscode.window.showWarningMessage(
      'Flow Diff: this file is very large and the diff may be slow. Continue?',
      { modal: true },
      'Continue'
    );
    if (choice !== 'Continue') {
      return undefined;
    }
  }

  const rightLabel = descriptor.rightRef
    ? descriptor.rightRef.slice(0, 9)
    : descriptor.rightSide === 'worktree' ? 'Working Tree' : 'Index';
  const result = await diffEngine.run({
    input: {
      oldText: left,
      newText: right,
      leftLabel: descriptor.leftRef,
      rightLabel,
      languageId,
      filePath: vscode.workspace.asRelativePath(descriptor.fileUri),
      timeoutMs: DIFF_TIMEOUT_MS,
    },
    markStaged,
    indexText,
  });
  if (!result.ok) {
    // on refresh, keep showing the last good model
    if (options.interactive) {
      void vscode.window.showWarningMessage(
        result.tooComplex
          ? 'Flow Diff: this file has too many differences to display.'
          : `Flow Diff: could not compute the diff — ${result.message}`
      );
    }
    return undefined;
  }
  return { model: result.model, inputKey };
}

/** Recomputes and pushes the model for an existing panel (refresh/post-action path). */
export async function refreshPanel(
  git: GitService,
  panel: {
    descriptor: DiffDescriptor;
    inputKey: string | undefined;
    setModel(model: AlignedDiffModel, inputKey: string): void;
  }
): Promise<void> {
  const built = await buildModel(git, panel.descriptor, {
    interactive: false,
    unlessInputKey: panel.inputKey,
  });
  if (built) {
    panel.setModel(built.model, built.inputKey);
  }
}

function hashInputs(left: string, right: string, index: string | undefined, languageId: string): string {
  const hash = createHash('sha1');
  for (const part of [left, right, index ?? '\0untracked', languageId]) {
    hash.update(part).update('\0\0');
  }
  return hash.digest('hex');
}

function looksBinary(text: string): boolean {
  return text.includes('\0');
}

function countLines(text: string): number {
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      count++;
    }
  }
  return count;
}

async function detectLanguageId(uri: vscode.Uri): Promise<string> {
  try {
    return (await vscode.workspace.openTextDocument(uri)).languageId;
  } catch {
    return 'plaintext'; // e.g. file deleted from the worktree
  }
}
