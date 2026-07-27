'use strict';

// Small HTTP helpers: request body parsing and common responses.
// Dependency-free.

const MAX_BODY_BYTES = 64 * 1024; // plenty for login/registry forms

// Error thrown when a request body exceeds MAX_BODY_BYTES. Carries a
// statusCode so the server can respond 413 instead of a generic 500.
class BodyTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'BodyTooLargeError';
    this.statusCode = 413;
  }
}

// Reads and parses an application/x-www-form-urlencoded request body.
// Rejects with BodyTooLargeError if the body exceeds MAX_BODY_BYTES.
function parseFormBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        reject(new BodyTooLargeError());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      const params = new URLSearchParams(raw);
      const out = {};
      for (const [key, value] of params) out[key] = value;
      resolve(out);
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, ...headers });
  res.end();
}

function html(res, markup, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(markup);
}

function json(res, obj, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}

module.exports = { parseFormBody, redirect, html, json, MAX_BODY_BYTES, BodyTooLargeError };
