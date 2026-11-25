import fs from 'node:fs';
import path from 'node:path';

export interface WorkspaceBlobFile {
  repoPath: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  executable?: boolean;
}

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.playwright-cli',
  '.aistudio',
  '.cache',
  'coverage',
]);

const BINARY_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.ico', '.woff', '.woff2']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function isAllowedWorkspaceFileName(fileName: string): boolean {
  if (!fileName || fileName === '.DS_Store' || fileName === 'Thumbs.db') return false;
  // Never leak any real .env file; only .env.example is permitted
  if (fileName === '.env' || (fileName.startsWith('.env.') && fileName !== '.env.example')) {
    return false;
  }
  if (fileName.endsWith('.log') || fileName.endsWith('.zip') || fileName.endsWith('.pem') || fileName.endsWith('.key')) {
    return false;
  }
  if (fileName === 'package-lock.json') return false;
  return true;
}

/**
 * Safely collects the current studio workspace source files confined to baseDir,
 * excluding secrets, node_modules, build outputs, and transient artifacts.
 */
export function collectStudioWorkspaceFiles(
  baseDir: string,
  targetPrefix = 'studio-web'
): WorkspaceBlobFile[] {
  const resolvedBase = path.resolve(baseDir);
  const results: WorkspaceBlobFile[] = [];

  const walk = (currentDir: string) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;

      const absPath = path.resolve(currentDir, entry.name);
      // Enforce strict directory confinement
      if (!absPath.startsWith(resolvedBase + path.sep)) continue;

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(absPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!isAllowedWorkspaceFileName(entry.name)) continue;

      const stat = fs.statSync(absPath);
      if (stat.size > MAX_FILE_BYTES) continue;

      const relPosix = path.relative(resolvedBase, absPath).split(path.sep).join('/');
      const ext = path.extname(entry.name).toLowerCase();
      const isBinary = BINARY_EXTENSIONS.has(ext);
      const rawBuffer = fs.readFileSync(absPath);

      results.push({
        repoPath: `${targetPrefix}/${relPosix}`,
        content: isBinary ? rawBuffer.toString('base64') : rawBuffer.toString('utf-8'),
        encoding: isBinary ? 'base64' : 'utf-8',
        executable: ext === '.sh',
      });
    }
  };

  walk(resolvedBase);
  results.sort((a, b) => a.repoPath.localeCompare(b.repoPath));
  return results;
}
