import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeDiff, ComputeDiffInput, DiffTooComplexError } from '../diff/computeDiff';
import { runDiffJob } from '../diff/diffJob';
import { DiffEngine } from '../diffEngine';

function input(oldText: string, newText: string, timeoutMs?: number): ComputeDiffInput {
  return {
    oldText,
    newText,
    leftLabel: 'HEAD',
    rightLabel: 'Working Tree',
    languageId: 'plaintext',
    filePath: 'sample.txt',
    timeoutMs,
  };
}

/** Two large texts with no line in common: the worst case for the line diff. */
function unrelatedTexts(lines: number): [string, string] {
  const make = (prefix: string) =>
    Array.from({ length: lines }, (_, i) => `${prefix}${(i * 7919) % lines}`).join('\n');
  return [make('a'), make('b')];
}

test('the worker thread returns the same model as an inline computeDiff', async () => {
  const engine = new DiffEngine();
  try {
    const job = { input: input('a\nb\nc\n', 'a\nB\nc\nd\n'), markStaged: true, indexText: 'a\nB\nc\n' };
    const result = await engine.run(job);
    assert.deepEqual(result, runDiffJob(job));
    assert.ok(result.ok && result.model.chunks.length === 2);
    assert.ok(result.ok && result.model.chunks[0].staged === true);
    assert.ok(result.ok && result.model.chunks[1].staged === false);
  } finally {
    engine.dispose();
  }
});

test('jobs sent back to back are all answered', async () => {
  const engine = new DiffEngine();
  try {
    const results = await Promise.all(
      [1, 2, 3].map((n) => engine.run({ input: input('x\n', `x\n${'y\n'.repeat(n)}`), markStaged: false }))
    );
    assert.deepEqual(
      results.map((r) => (r.ok ? r.model.chunks[0].rightCount : -1)),
      [1, 2, 3]
    );
  } finally {
    engine.dispose();
  }
});

test('a diff over its timeout fails as too complex instead of running on', () => {
  const [oldText, newText] = unrelatedTexts(20_000);
  assert.throws(() => computeDiff(input(oldText, newText, 1)), DiffTooComplexError);
  const result = runDiffJob({ input: input(oldText, newText, 1), markStaged: false });
  assert.ok(!result.ok && result.tooComplex);
});
