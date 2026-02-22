import { sanitizeHtml } from '../../src/shared/sanitize';

describe('sanitizeHtml', () => {
  it('returns plain text unchanged', () => {
    expect(sanitizeHtml('hello world')).toBe('hello world');
  });

  it('escapes <', () => {
    expect(sanitizeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes >', () => {
    expect(sanitizeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes &', () => {
    expect(sanitizeHtml('a & b')).toBe('a &amp; b');
  });

  it('does not double-escape &amp;', () => {
    // Input already-escaped string; the & should be re-escaped
    expect(sanitizeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('escapes double-quotes', () => {
    expect(sanitizeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single-quotes', () => {
    expect(sanitizeHtml("it's")).toBe('it&#x27;s');
  });

  it('neutralises a basic XSS payload', () => {
    const xss = '<script>alert(1)</script>';
    const out = sanitizeHtml(xss);
    expect(out).not.toContain('<script>');
    expect(out).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('neutralises an onclick injection attempt', () => {
    const payload = "'); alert(1); ('";
    const out = sanitizeHtml(payload);
    expect(out).not.toContain("'");
  });

  it('returns empty string for null', () => {
    expect(sanitizeHtml(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(sanitizeHtml(undefined)).toBe('');
  });

  it('coerces numbers to string', () => {
    expect(sanitizeHtml(42 as any)).toBe('42');
  });

  it('returns empty string for empty string input', () => {
    expect(sanitizeHtml('')).toBe('');
  });

  it('passes IP addresses through unchanged', () => {
    expect(sanitizeHtml('192.168.1.100')).toBe('192.168.1.100');
  });
});
