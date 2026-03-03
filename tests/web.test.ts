import { describe, it, expect } from 'vitest';
import { escHtml } from '../src/web/layout.js';

describe('escHtml', () => {
  it('escapes angle brackets', () => {
    expect(escHtml('<script>')).toBe('&lt;script&gt;');
  });
  it('escapes ampersands', () => {
    expect(escHtml('a & b')).toBe('a &amp; b');
  });
  it('escapes quotes', () => {
    expect(escHtml('"hello"')).toBe('&quot;hello&quot;');
  });
  it('passes safe strings through unchanged', () => {
    expect(escHtml('Hello World')).toBe('Hello World');
  });
});
