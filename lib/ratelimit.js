'use strict';

// Minimal in-memory rate limiter using a fixed-window counter per key.
// Dependency-free. Suitable for a single-process app (state is per-process;
// if this ever runs multi-instance, move to a shared store).
//
// Usage:
//   const limiter = createLimiter({ windowMs, max });
//   const r = limiter.hit(key);   // { allowed, remaining, retryAfterMs }
//
// A "key" is typically a client identifier (IP) plus a bucket name, e.g.
// `login:1.2.3.4`. Since this app sits behind Apache, the client IP comes
// from X-Forwarded-For (see clientKey in server.js).

function createLimiter({ windowMs, max }) {
  const buckets = new Map(); // key -> { count, resetAt }

  function hit(key) {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    const allowed = b.count <= max;
    return {
      allowed,
      remaining: Math.max(0, max - b.count),
      retryAfterMs: allowed ? 0 : b.resetAt - now,
    };
  }

  // Reset a key (e.g. clear login attempts after a successful login).
  function reset(key) {
    buckets.delete(key);
  }

  // Periodic cleanup so the map can't grow unbounded from unique keys.
  function startSweeper() {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [key, b] of buckets) {
        if (now >= b.resetAt) buckets.delete(key);
      }
    }, Math.max(windowMs, 60 * 1000));
    timer.unref();
    return timer;
  }

  return { hit, reset, startSweeper };
}

module.exports = { createLimiter };
