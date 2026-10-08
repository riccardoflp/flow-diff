import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPathTree, DirNode } from '../tree/pathTree';

/** Compact text rendering: dirs end with "/", children indented. */
function render(dir: DirNode<string>, indent = ''): string[] {
  return [
    ...dir.dirs.flatMap((d) => [`${indent}${d.label}/ (${d.path})`, ...render(d, indent + '  ')]),
    ...dir.files.map((f) => `${indent}${f.name}`),
  ];
}

function tree(paths: string[]): string[] {
  return render(buildPathTree(paths.map((path) => ({ path, item: path }))));
}

test('files are grouped by folder, folders before files, sorted', () => {
  assert.deepEqual(tree(['README.md', 'src/b.ts', 'src/a.ts', 'docs/x.md', 'src/sub/c.ts', 'src/sub/d.ts']), [
    'docs/ (docs)',
    '  x.md',
    'src/ (src)',
    '  sub/ (src/sub)',
    '    c.ts',
    '    d.ts',
    '  a.ts',
    '  b.ts',
    'README.md',
  ]);
});

test('chains of single-child folders are compacted', () => {
  assert.deepEqual(tree(['src/diff/model.ts', 'src/diff/patch.ts', 'a/b/c/d.txt']), [
    'a/b/c/ (a/b/c)',
    '  d.txt',
    'src/diff/ (src/diff)',
    '  model.ts',
    '  patch.ts',
  ]);
});

test('a folder with files is not folded into its subfolder', () => {
  assert.deepEqual(tree(['src/x.ts', 'src/deep/er/y.ts']), [
    'src/ (src)',
    '  deep/er/ (src/deep/er)',
    '    y.ts',
    '  x.ts',
  ]);
});

test('windows separators are accepted', () => {
  assert.deepEqual(tree(['src\\webview\\main.ts']), ['src/webview/ (src/webview)', '  main.ts']);
});

test('numeric parts sort naturally', () => {
  assert.deepEqual(tree(['f10.ts', 'f2.ts', 'F1.ts']), ['F1.ts', 'f2.ts', 'f10.ts']);
});
