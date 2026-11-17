// Monorepo/workspace roots and the single-app `src` wrapper carry no meaning of their own;
// the module is the segment after them. Any other top directory already names the module.
const WRAPPER_DIRS = new Set(['apps', 'packages', 'libs', 'modules', 'workspaces', 'src']);

export function deriveScope(relPath) {
  const segs = String(relPath || '').split('\\').join('/').split('/');
  const dirs = segs.slice(0, -1);
  if (dirs.length === 0) return '';
  const [top] = dirs;
  if (WRAPPER_DIRS.has(top)) return dirs.length >= 2 ? dirs[1] : '';
  return top;
}
