/**
 * Groups repository-relative file paths into a directory tree, compacting
 * chains of single-child folders ("src/diff" instead of "src" › "diff") like
 * VS Code's compact folders. No `vscode` import — unit-testable.
 */

export interface DirNode<T> {
  /** Display label: one or more path segments joined by "/" ('' for the root). */
  label: string;
  /** Path from the root, "/"-separated ('' for the root). */
  path: string;
  dirs: DirNode<T>[];
  files: Array<FileLeaf<T>>;
}

export interface FileLeaf<T> {
  name: string;
  item: T;
}

export function buildPathTree<T>(entries: Array<{ path: string; item: T }>): DirNode<T> {
  const root: DirNode<T> = { label: '', path: '', dirs: [], files: [] };
  for (const { path, item } of entries) {
    const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
    const name = segments.pop();
    if (name === undefined) {
      continue;
    }
    let dir = root;
    for (const segment of segments) {
      let child = dir.dirs.find((d) => d.label === segment);
      if (!child) {
        child = { label: segment, path: dir.path ? `${dir.path}/${segment}` : segment, dirs: [], files: [] };
        dir.dirs.push(child);
      }
      dir = child;
    }
    dir.files.push({ name, item });
  }
  sortTree(root);
  root.dirs = root.dirs.map(compact);
  return root;
}

/** Folds a folder whose only content is one subfolder into it. */
function compact<T>(dir: DirNode<T>): DirNode<T> {
  let node = dir;
  while (node.files.length === 0 && node.dirs.length === 1) {
    const only = node.dirs[0];
    node = { ...only, label: `${node.label}/${only.label}` };
  }
  return { ...node, dirs: node.dirs.map(compact) };
}

function sortTree<T>(dir: DirNode<T>): void {
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  dir.dirs.sort((a, b) => byName(a.label, b.label));
  dir.files.sort((a, b) => byName(a.name, b.name));
  dir.dirs.forEach(sortTree);
}
