import { spawn } from 'child_process';

/**
 * Hunk-level staging is the one operation the git extension API cannot do
 * (its `apply` only touches the working tree), so this pipes a synthesized
 * patch to `git apply --cached`. `--unidiff-zero` is required because our
 * patches carry no context lines.
 */
export function applyPatchToIndex(repoRoot: string, patch: string): Promise<void> {
  return runGit(repoRoot, ['apply', '--cached', '--unidiff-zero', '--whitespace=nowarn', '-'], patch);
}

/**
 * Drops a file from the index, leaving the worktree alone: unstaging a file
 * that has no HEAD version (`git reset` needs a commit to reset to).
 */
export function removeFromIndex(repoRoot: string, repoRelativePath: string): Promise<void> {
  return runGit(repoRoot, ['rm', '--cached', '--quiet', '--', repoRelativePath]);
}

function runGit(repoRoot: string, args: string[], stdin?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: repoRoot });
    let stderr = '';
    child.stderr.on('data', (data) => (stderr += String(data)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `git ${args[0]} exited with code ${code}`));
      }
    });
    child.stdin.end(stdin ?? '');
  });
}
