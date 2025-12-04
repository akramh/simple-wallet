import fs from 'fs';

export interface StorageAdapter {
  readJSON<T>(path: string, fallback: T): T;
  writeJSON<T>(path: string, data: T): void;
  exists(path: string): boolean;
  readFile(path: string): string | null;
  writeFile(path: string, contents: string): void;
}

// File system-backed storage for Node/CLI usage.
export class FileStorage implements StorageAdapter {
  readJSON<T>(path: string, fallback: T): T {
    try {
      if (!fs.existsSync(path)) return fallback;
      return JSON.parse(fs.readFileSync(path, 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  writeJSON<T>(path: string, data: T): void {
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
  }

  exists(path: string): boolean {
    return fs.existsSync(path);
  }

  readFile(path: string): string | null {
    try {
      return fs.readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }

  writeFile(path: string, contents: string): void {
    fs.writeFileSync(path, contents);
  }
}

// In-memory storage for tests, browser, or ephemeral sessions.
export class MemoryStorage implements StorageAdapter {
  private store = new Map<string, string>();

  readJSON<T>(path: string, fallback: T): T {
    try {
      const raw = this.store.get(path);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  writeJSON<T>(path: string, data: T): void {
    this.store.set(path, JSON.stringify(data));
  }

  exists(path: string): boolean {
    return this.store.has(path);
  }

  readFile(path: string): string | null {
    const val = this.store.get(path);
    return val ?? null;
  }

  writeFile(path: string, contents: string): void {
    this.store.set(path, contents);
  }
}
