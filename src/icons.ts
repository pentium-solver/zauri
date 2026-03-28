// SVG file type icons — inline for zero-latency rendering
// Each returns an SVG string sized 16x16

const icon = (paths: string, color: string) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">${paths.replace(/\{c\}/g, color)}</svg>`;

// Folder icons
const folderClosed = (color: string) => icon(
  `<path d="M1.5 2.5h4l1.5 1.5h7.5v9.5h-13z" fill="{c}" opacity="0.85"/>
   <path d="M1.5 4h13v8.5a1 1 0 01-1 1h-11a1 1 0 01-1-1z" fill="{c}" opacity="0.6"/>`,
  color
);

const folderOpen = (color: string) => icon(
  `<path d="M1.5 2.5h4l1.5 1.5h7.5v2h-11l-2 7v-9z" fill="{c}" opacity="0.85"/>
   <path d="M0.5 6h12l-2.5 7.5h-11z" fill="{c}" opacity="0.7"/>`,
  color
);

// Generic file
const fileDefault = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#8b8b96" opacity="0.3"/>
   <path d="M9.5 1v3.5H13" stroke="#8b8b96" stroke-width="0.8" opacity="0.5"/>`,
  ''
);

// TypeScript / JavaScript
const fileTs = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#3b82f6" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#3b82f6" stroke-width="0.8" opacity="0.4"/>
   <text x="8" y="11.5" font-size="5.5" font-weight="bold" fill="#3b82f6" text-anchor="middle" font-family="monospace">TS</text>`,
  ''
);

const fileJs = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#eab308" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#eab308" stroke-width="0.8" opacity="0.4"/>
   <text x="8" y="11.5" font-size="5.5" font-weight="bold" fill="#eab308" text-anchor="middle" font-family="monospace">JS</text>`,
  ''
);

const fileJsx = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#06b6d4" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#06b6d4" stroke-width="0.8" opacity="0.4"/>
   <text x="8" y="11.5" font-size="4.5" font-weight="bold" fill="#06b6d4" text-anchor="middle" font-family="monospace">JSX</text>`,
  ''
);

const fileTsx = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#3b82f6" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#3b82f6" stroke-width="0.8" opacity="0.4"/>
   <text x="8" y="11.5" font-size="4" font-weight="bold" fill="#06b6d4" text-anchor="middle" font-family="monospace">TSX</text>`,
  ''
);

// Rust
const fileRust = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#f97316" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#f97316" stroke-width="0.8" opacity="0.4"/>
   <text x="8" y="11.5" font-size="5.5" font-weight="bold" fill="#f97316" text-anchor="middle" font-family="monospace">Rs</text>`,
  ''
);

// Python
const filePython = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#22c55e" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#22c55e" stroke-width="0.8" opacity="0.4"/>
   <text x="8" y="11.5" font-size="5" font-weight="bold" fill="#22c55e" text-anchor="middle" font-family="monospace">Py</text>`,
  ''
);

// HTML
const fileHtml = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#f97316" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#f97316" stroke-width="0.8" opacity="0.4"/>
   <text x="8" y="11.5" font-size="3.5" font-weight="bold" fill="#f97316" text-anchor="middle" font-family="monospace">&lt;/&gt;</text>`,
  ''
);

// CSS
const fileCss = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#a855f7" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#a855f7" stroke-width="0.8" opacity="0.4"/>
   <text x="8" y="11.5" font-size="4.5" font-weight="bold" fill="#a855f7" text-anchor="middle" font-family="monospace">#</text>`,
  ''
);

// JSON
const fileJson = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#eab308" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#eab308" stroke-width="0.8" opacity="0.4"/>
   <text x="8" y="11.5" font-size="5" font-weight="bold" fill="#eab308" text-anchor="middle" font-family="monospace">{}</text>`,
  ''
);

// Markdown
const fileMd = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#8b8b96" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#8b8b96" stroke-width="0.8" opacity="0.4"/>
   <text x="8" y="11.5" font-size="5" font-weight="bold" fill="#8b8b96" text-anchor="middle" font-family="monospace">M</text>`,
  ''
);

// Config / TOML / YAML
const fileConfig = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#8b8b96" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#8b8b96" stroke-width="0.8" opacity="0.4"/>
   <circle cx="8" cy="9.5" r="2.5" stroke="#8b8b96" stroke-width="0.8" fill="none"/>
   <circle cx="8" cy="9.5" r="0.8" fill="#8b8b96"/>`,
  ''
);

// Lock files
const fileLock = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#8b8b96" opacity="0.1"/>
   <path d="M9.5 1v3.5H13" stroke="#8b8b96" stroke-width="0.8" opacity="0.3"/>
   <rect x="5.5" y="8" width="5" height="4" rx="0.5" fill="#8b8b96" opacity="0.5"/>
   <path d="M6.5 8V6.5a1.5 1.5 0 013 0V8" stroke="#8b8b96" stroke-width="0.8" fill="none"/>`,
  ''
);

// C/C++/Zig
const fileC = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#3b82f6" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#3b82f6" stroke-width="0.8" opacity="0.4"/>
   <text x="8" y="11.5" font-size="5.5" font-weight="bold" fill="#3b82f6" text-anchor="middle" font-family="monospace">C</text>`,
  ''
);

const fileZig = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#f59e0b" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#f59e0b" stroke-width="0.8" opacity="0.4"/>
   <text x="8" y="11.5" font-size="4.5" font-weight="bold" fill="#f59e0b" text-anchor="middle" font-family="monospace">Zig</text>`,
  ''
);

// Docker
const fileDocker = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#06b6d4" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#06b6d4" stroke-width="0.8" opacity="0.4"/>
   <rect x="5" y="8" width="2" height="1.5" rx="0.2" fill="#06b6d4" opacity="0.6"/>
   <rect x="7.5" y="8" width="2" height="1.5" rx="0.2" fill="#06b6d4" opacity="0.6"/>
   <rect x="5" y="6" width="2" height="1.5" rx="0.2" fill="#06b6d4" opacity="0.6"/>
   <rect x="7.5" y="6" width="2" height="1.5" rx="0.2" fill="#06b6d4" opacity="0.6"/>
   <rect x="10" y="8" width="2" height="1.5" rx="0.2" fill="#06b6d4" opacity="0.4"/>`,
  ''
);

// Git-related
const fileGit = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#f97316" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#f97316" stroke-width="0.8" opacity="0.4"/>
   <circle cx="8" cy="8.5" r="1.2" fill="#f97316" opacity="0.7"/>
   <circle cx="5.5" cy="10.5" r="0.8" fill="#f97316" opacity="0.5"/>
   <path d="M6.2 10L7 9" stroke="#f97316" stroke-width="0.6" opacity="0.5"/>`,
  ''
);

// Image files
const fileImage = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#22c55e" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#22c55e" stroke-width="0.8" opacity="0.4"/>
   <circle cx="6.5" cy="7.5" r="1.2" fill="#22c55e" opacity="0.5"/>
   <path d="M4 12l2.5-3 1.5 1.5 2-2.5L12 12z" fill="#22c55e" opacity="0.4"/>`,
  ''
);

// Env files
const fileEnv = icon(
  `<path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#eab308" opacity="0.15"/>
   <path d="M9.5 1v3.5H13" stroke="#eab308" stroke-width="0.8" opacity="0.4"/>
   <rect x="5.5" y="8" width="5" height="4" rx="0.5" fill="#eab308" opacity="0.3"/>
   <path d="M6.5 8V6.5a1.5 1.5 0 013 0V8" stroke="#eab308" stroke-width="0.8" fill="none"/>`,
  ''
);

// Folder color mapping by name
const folderColors: Record<string, string> = {
  src: '#3b82f6',
  lib: '#3b82f6',
  components: '#06b6d4',
  hooks: '#06b6d4',
  utils: '#8b8b96',
  assets: '#22c55e',
  images: '#22c55e',
  icons: '#22c55e',
  public: '#22c55e',
  styles: '#a855f7',
  css: '#a855f7',
  test: '#eab308',
  tests: '#eab308',
  __tests__: '#eab308',
  spec: '#eab308',
  node_modules: '#8b8b96',
  '.git': '#f97316',
  '.github': '#8b8b96',
  '.vscode': '#3b82f6',
  dist: '#8b8b96',
  build: '#8b8b96',
  target: '#8b8b96',
  config: '#8b8b96',
  docs: '#06b6d4',
  server: '#22c55e',
  api: '#22c55e',
  pages: '#a855f7',
  layouts: '#a855f7',
  dashboard: '#3b82f6',
  compiler: '#f97316',
  runtime: '#f97316',
  legal: '#8b8b96',
  sdks: '#06b6d4',
};

const defaultFolderColor = '#8b8b96';

export function getFolderIcon(name: string, isOpen: boolean): string {
  const color = folderColors[name] || defaultFolderColor;
  return isOpen ? folderOpen(color) : folderClosed(color);
}

export function getFileIcon(filename: string): string {
  const lower = filename.toLowerCase();
  const ext = lower.split('.').pop() || '';
  const name = lower;

  // Special filenames first
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return fileDocker;
  if (name === 'docker-compose.yml' || name === 'docker-compose.yaml' || name === 'docker-compose.prod.yml') return fileDocker;
  if (name === '.gitignore' || name === '.gitattributes' || name === '.gitmodules') return fileGit;
  if (name === '.env' || name.startsWith('.env.')) return fileEnv;
  if (name === 'cargo.toml' || name === 'cargo.lock') return fileRust;
  if (name === 'package.json' || name === 'tsconfig.json' || name === 'jsconfig.json') return fileJson;
  if (name.endsWith('.lock') || name === 'bun.lock' || name === 'bun.lockb') return fileLock;

  // By extension
  switch (ext) {
    case 'ts': return fileTs;
    case 'tsx': return fileTsx;
    case 'js': return fileJs;
    case 'jsx': return fileJsx;
    case 'mjs': case 'mts': return fileJs;
    case 'rs': return fileRust;
    case 'py': case 'pyw': return filePython;
    case 'html': case 'htm': case 'svelte': case 'vue': return fileHtml;
    case 'css': case 'scss': case 'less': return fileCss;
    case 'json': case 'jsonc': return fileJson;
    case 'md': case 'mdx': return fileMd;
    case 'toml': case 'yaml': case 'yml': case 'ini': case 'conf': return fileConfig;
    case 'c': case 'h': case 'cpp': case 'cxx': case 'cc': case 'hpp': return fileC;
    case 'zig': return fileZig;
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp': case 'ico': case 'icns': return fileImage;
    case 'pdf': return fileImage;
    default: return fileDefault;
  }
}

// Chevron icon for tree expand/collapse
export const chevronRight = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const chevronDown = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
