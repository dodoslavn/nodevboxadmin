'use strict';

// Minimal, dependency-free router. Supports static segments and ":param"
// segments. Intentionally does not support wildcards/regex patterns - this
// app has a small, fixed route list (see ARCHITECTURE.md section 6), so a
// framework-grade router would be unused complexity.

function compilePattern(pattern) {
  const keys = [];
  const segments = pattern.split('/').filter(Boolean);
  const regexParts = segments.map((segment) => {
    if (segment.startsWith(':')) {
      keys.push(segment.slice(1));
      return '([^/]+)';
    }
    // Escape regex special characters in literal segments.
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  const regex = new RegExp(`^/${regexParts.join('/')}/?$`);
  return { regex, keys };
}

class Router {
  constructor() {
    // method -> array of { regex, keys, handler }
    this.routes = new Map();
  }

  _add(method, pattern, handler) {
    const { regex, keys } = compilePattern(pattern);
    if (!this.routes.has(method)) this.routes.set(method, []);
    this.routes.get(method).push({ regex, keys, handler });
  }

  get(pattern, handler) {
    this._add('GET', pattern, handler);
  }

  post(pattern, handler) {
    this._add('POST', pattern, handler);
  }

  // Finds a matching route for (method, pathname). Returns
  // { handler, params } or null if nothing matches.
  match(method, pathname) {
    const candidates = this.routes.get(method) || [];
    for (const route of candidates) {
      const m = route.regex.exec(pathname);
      if (m) {
        const params = {};
        route.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(m[i + 1]);
        });
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}

module.exports = { Router };
