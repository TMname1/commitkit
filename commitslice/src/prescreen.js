import path from 'node:path';

// Path-level prescreen. Runs before any file content is read: dependency lock files, build
// artifacts, generated code and test snapshots are machine-written, huge, and say nothing a
// model could summarize back as intent. They are grouped by metadata and committed with a fixed
// message instead of going through the model pipeline.
// Manifests (package.json, go.mod, Cargo.toml, pyproject.toml, ...) are NOT prescreened: they are
// small and hold the *reason* a dependency changed.
export const NOISE_CATEGORIES = ['lock', 'artifact', 'generated', 'snapshot'];

const CATEGORY_TYPE = { lock: 'chore', artifact: 'chore', generated: 'chore', snapshot: 'test' };
const CATEGORY_SCOPE = { lock: 'deps' };

const LABELS = {
  zh: { lock: '依赖锁文件', artifact: '构建产物', generated: '生成代码', snapshot: '测试快照' },
  en: {
    lock: 'lock files',
    artifact: 'build artifacts',
    generated: 'generated code',
    snapshot: 'test snapshots'
  }
};

const ECO_LABEL = {
  node: 'Node', deno: 'Deno', bun: 'Bun', rust: 'Rust', go: 'Go', python: 'Python',
  ruby: 'Ruby', php: 'PHP', dart: 'Flutter/Dart', swift: 'Swift', jvm: 'JVM', dotnet: '.NET',
  elixir: 'Elixir', haskell: 'Haskell', r: 'R'
};

// Exact lock/manifest-ish file names. Only locks belong here — a manifest is intent and stays
// with the model.
const LOCKS = {
  'package-lock.json': 'node', 'npm-shrinkwrap.json': 'node', 'yarn.lock': 'node',
  'pnpm-lock.yaml': 'node', 'package-lock.yaml': 'node', 'shrinkwrap.yaml': 'node',
  'bun.lock': 'bun', 'bun.lockb': 'bun', 'deno.lock': 'deno',
  'cargo.lock': 'rust', 'go.sum': 'go',
  'poetry.lock': 'python', 'pipfile.lock': 'python', 'uv.lock': 'python',
  'pdm.lock': 'python', 'requirements.lock': 'python', 'conda-lock.yml': 'python',
  'gemfile.lock': 'ruby', 'composer.lock': 'php', 'pubspec.lock': 'dart',
  'podfile.lock': 'swift', 'cartfile.resolved': 'swift', 'package.resolved': 'swift',
  'packages.lock.json': 'dotnet', 'paket.lock': 'dotnet',
  'mix.lock': 'elixir', 'stack.yaml.lock': 'haskell', 'cabal.project.freeze': 'haskell',
  'renv.lock': 'r', 'conan.lock': 'other'
};

const ARTIFACT_DIRS = [
  'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.output', '.svelte-kit', '.vercel',
  '.parcel-cache', 'target', 'vendor', 'bower_components', 'coverage', 'htmlcov', '__pycache__',
  '.mypy_cache', '.pytest_cache', '.ruff_cache', '.venv', 'venv', '.dart_tool', '.gradle',
  '.terraform', 'deriveddata', 'pods', 'obj', '_build', 'site-packages', '.yarn'
];

const ARTIFACT_EXT_ECO = {
  '.map': 'node', '.tsbuildinfo': 'node',
  '.pyc': 'python', '.pyo': 'python', '.mo': 'other', '.class': 'jvm', '.jar': 'jvm', '.war': 'jvm',
  '.o': 'other', '.obj': 'other', '.a': 'other', '.so': 'other', '.dylib': 'other',
  '.dll': 'dotnet', '.exe': 'dotnet', '.pdb': 'dotnet', '.wasm': 'other'
};

// path.extname only sees the last dot, so compound suffixes match on the basename.
const ARTIFACT_SUFFIX_ECO = { '.min.js': 'node', '.min.mjs': 'node', '.min.css': 'node' };

const GENERATED_PATTERNS = [
  /\.pb\.[a-z]+$/, /_pb2(_grpc)?\.py$/, /\.generated\.[a-z0-9]+$/, /_generated\.[a-z0-9]+$/,
  /\.g\.(dart|cs|py|java)$/, /\.freezed\.dart$/, /\.razor\.g\.cs$/, /\.designer\.cs$/,
  /_stringer\.go$/, /wire_gen\.go$/
];

const GENERATED_DIRS = ['__generated__', 'generated'];
const SNAPSHOT_DIRS = ['__snapshots__', '__image_snapshots__'];
const SNAPSHOT_EXTS = ['.snap', '.snapshot', '.shot'];

const EXT_ECO = {
  '.js': 'node', '.mjs': 'node', '.cjs': 'node', '.ts': 'node', '.tsx': 'node', '.jsx': 'node',
  '.vue': 'node', '.svelte': 'node', '.dart': 'dart', '.go': 'go', '.py': 'python', '.rb': 'ruby',
  '.php': 'php', '.rs': 'rust', '.java': 'jvm', '.kt': 'jvm', '.cs': 'dotnet', '.swift': 'swift',
  '.ex': 'elixir', '.exs': 'elixir'
};

function segments(p) {
  return p.split('/').filter(Boolean);
}

function ecoOf(p) {
  return EXT_ECO[path.extname(p).toLowerCase()] || '';
}

function norm(p) {
  return p.split(path.sep).join('/');
}

// Returns `{ category, ecosystem }` for noise files, or null when the file must keep going
// through the model pipeline.
export function prescreen(p) {
  const file = norm(p);
  const base = path.basename(file).toLowerCase();
  const ext = path.extname(file).toLowerCase();
  const segs = segments(file).map((s) => s.toLowerCase());

  if (LOCKS[base]) return { category: 'lock', ecosystem: LOCKS[base] };
  // Any remaining `*.lock` / `*.lockfile` is a lock too (Gradle `*.lockfile`, custom resolvers).
  if (/\.(lock|lockb|lockfile)$/.test(base) || base.endsWith('.lock.yaml') || base.endsWith('.lock.yml')) {
    return { category: 'lock', ecosystem: ecoOf(file) };
  }

  if (segs.some((s) => SNAPSHOT_DIRS.includes(s)) || SNAPSHOT_EXTS.includes(ext) || base.endsWith('.snap.new')) {
    return { category: 'snapshot', ecosystem: ecoOf(file) };
  }

  if (GENERATED_PATTERNS.some((re) => re.test(base)) || segs.some((s) => GENERATED_DIRS.includes(s))) {
    return { category: 'generated', ecosystem: ecoOf(file) };
  }

  if (segs.some((s) => ARTIFACT_DIRS.includes(s)) || segs.some((s) => s.endsWith('.egg-info'))) {
    return { category: 'artifact', ecosystem: ecoOf(file) };
  }
  if (ARTIFACT_EXT_ECO[ext]) return { category: 'artifact', ecosystem: ARTIFACT_EXT_ECO[ext] };
  const suffix = Object.keys(ARTIFACT_SUFFIX_ECO).find((s) => base.endsWith(s));
  if (suffix) return { category: 'artifact', ecosystem: ARTIFACT_SUFFIX_ECO[suffix] };

  return null;
}

function verb(files, lang) {
  const deleted = files.every((f) => (f.code || '')[0] === 'D');
  if (lang === 'zh') return deleted ? '删除' : '更新';
  return deleted ? 'remove' : 'update';
}

function subject(group, lang) {
  const scope = CATEGORY_SCOPE[group.category];
  const head = `${group.type}${scope ? `(${scope})` : ''}`;
  const label = LABELS[lang][group.category];
  const action = verb(group.fileObjs, lang);
  const eco = ECO_LABEL[group.ecosystem];
  if (lang === 'zh') return `${head}: ${eco ? `${action} ${eco} ${label}` : `${action}${label}`}`;
  return `${head}: ${[action, eco, label].filter(Boolean).join(' ')}`;
}

// One commit per (category, ecosystem): Node lock changes never ride along with Rust snapshots.
export function noiseGroups(files, { lang = 'en' } = {}) {
  const byKey = new Map();
  for (const f of files) {
    if (!f.noise) continue;
    const { category, ecosystem } = f.noise;
    const key = `${category}:${ecosystem || 'other'}`;
    if (!byKey.has(key)) byKey.set(key, { category, ecosystem: ecosystem || 'other', fileObjs: [] });
    byKey.get(key).fileObjs.push(f);
  }

  const groups = [...byKey.values()].map((g) => {
    const fileObjs = g.fileObjs;
    return {
      type: CATEGORY_TYPE[g.category],
      category: g.category,
      ecosystem: g.ecosystem,
      fileObjs,
      files: fileObjs.map((f) => f.path),
      estTokens: fileObjs.reduce((n, f) => n + (f.diffTokens || 0), 0),
      oversize: false,
      fixed: true
    };
  });

  for (const g of groups) {
    g.subject = subject(g, lang);
    const list = g.files.map((p) => `- ${p}`).join('\n');
    const label = LABELS[lang][g.category];
    g.body = lang === 'zh'
      ? `以下 ${g.files.length} 个文件均为工具生成的${label},不含手写改动:\n\n${list}`
      : `${g.files.length} tool-generated ${label}, no hand-written changes:\n\n${list}`;
  }

  return groups.sort((a, b) => a.type.localeCompare(b.type) || a.category.localeCompare(b.category) || a.files.length - b.files.length);
}
