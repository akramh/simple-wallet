/**
 * @file path.js
 * @description Stub for Node.js 'path' module in React Native
 * 
 * Basic path utilities needed for wallet SDK compatibility.
 */

const sep = '/';

const join = (...parts) => {
  return parts.filter(Boolean).join(sep).replace(/\/+/g, '/');
};

const dirname = (filepath) => {
  if (!filepath || filepath === '/') return '/';
  const parts = filepath.split(sep);
  parts.pop();
  return parts.join(sep) || '/';
};

const basename = (filepath, ext) => {
  if (!filepath) return '';
  const parts = filepath.split(sep);
  let name = parts[parts.length - 1] || '';
  if (ext && name.endsWith(ext)) {
    name = name.slice(0, -ext.length);
  }
  return name;
};

const extname = (filepath) => {
  if (!filepath) return '';
  const name = basename(filepath);
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.slice(dotIndex) : '';
};

const resolve = (...parts) => {
  let resolvedPath = '';
  for (let i = parts.length - 1; i >= 0 && !resolvedPath.startsWith('/'); i--) {
    const part = parts[i];
    if (part) {
      resolvedPath = part + (resolvedPath ? '/' + resolvedPath : '');
    }
  }
  return resolvedPath.startsWith('/') ? resolvedPath : '/' + resolvedPath;
};

const normalize = (filepath) => {
  if (!filepath) return '.';
  return filepath.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
};

const isAbsolute = (filepath) => {
  return filepath.startsWith('/');
};

const relative = (from, to) => {
  // Simple implementation
  return to;
};

const parse = (filepath) => ({
  root: isAbsolute(filepath) ? '/' : '',
  dir: dirname(filepath),
  base: basename(filepath),
  ext: extname(filepath),
  name: basename(filepath, extname(filepath)),
});

const format = (pathObject) => {
  return join(pathObject.dir || pathObject.root, pathObject.base || pathObject.name + pathObject.ext);
};

module.exports = {
  sep,
  delimiter: ':',
  join,
  dirname,
  basename,
  extname,
  resolve,
  normalize,
  isAbsolute,
  relative,
  parse,
  format,
  posix: null, // Self-reference added below
  win32: null,
};

// Self-reference for posix
module.exports.posix = module.exports;
