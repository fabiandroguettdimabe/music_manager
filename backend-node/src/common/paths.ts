import * as fs from 'fs';
import * as path from 'path';

/**
 * Credential/token files live in the project root (next to the legacy Python
 * backend). The launcher starts Node with cwd = project root, so we resolve
 * files relative to cwd, falling back to the parent directory for safety —
 * mirroring the lookup the Python backend did (`name` then `../name`).
 */
function candidates(name: string): string[] {
  return [path.resolve(process.cwd(), name), path.resolve(process.cwd(), '..', name)];
}

export function findFile(name: string): string | null {
  for (const p of candidates(name)) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function readJson(name: string): any | null {
  const p = findFile(name);
  if (!p) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeJson(name: string, data: any): void {
  fs.writeFileSync(candidates(name)[0], JSON.stringify(data, null, 4), 'utf-8');
}

export function removeFile(name: string): void {
  for (const p of candidates(name)) {
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

export function mtimeOf(name: string): number | null {
  const p = findFile(name);
  if (!p) return null;
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
}
