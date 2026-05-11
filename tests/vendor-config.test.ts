import { describe, it, expect } from 'vitest';
import {
  getVendor,
  listVendors,
  getVendorSlugs,
  splitPrefixedToolName,
  prefixToolName,
} from '../src/proxy/vendor-config.js';

describe('vendor-config', () => {
  it('lists m365 and tdx', () => {
    const slugs = getVendorSlugs();
    expect(slugs).toContain('m365');
    expect(slugs).toContain('tdx');
  });

  it('returns null for unknown vendor', () => {
    expect(getVendor('nonexistent')).toBeNull();
  });

  it('m365 entry has a buildHeaders hook (token lift)', () => {
    const m365 = getVendor('m365');
    expect(m365).not.toBeNull();
    expect(typeof m365?.buildHeaders).toBe('function');
  });

  it('tdx entry has no buildHeaders hook (stateless, server-config auth)', () => {
    const tdx = getVendor('tdx');
    expect(tdx).not.toBeNull();
    expect(tdx?.buildHeaders).toBeUndefined();
  });

  it('listVendors returns the canonical entries', () => {
    const vendors = listVendors();
    expect(vendors.length).toBeGreaterThanOrEqual(2);
    expect(vendors.every((v) => v.slug && v.displayName && v.containerUrl)).toBe(true);
  });
});

describe('prefixed tool name parsing', () => {
  it('splits a normal prefixed name', () => {
    expect(splitPrefixedToolName('m365__sendMail')).toEqual({
      vendorSlug: 'm365',
      toolName: 'sendMail',
    });
  });

  it('split-once: tool name itself can contain double underscores', () => {
    expect(splitPrefixedToolName('m365__get_user__profile')).toEqual({
      vendorSlug: 'm365',
      toolName: 'get_user__profile',
    });
  });

  it('returns null when no prefix delimiter is present', () => {
    expect(splitPrefixedToolName('sendMail')).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(splitPrefixedToolName('')).toBeNull();
  });

  it('returns null when delimiter is at start (no vendor slug)', () => {
    expect(splitPrefixedToolName('__sendMail')).toBeNull();
  });

  it('returns null when delimiter is at end (no tool name)', () => {
    expect(splitPrefixedToolName('m365__')).toBeNull();
  });

  it('roundtrips through prefix + split', () => {
    const prefixed = prefixToolName('tdx', 'list_tickets');
    expect(splitPrefixedToolName(prefixed)).toEqual({
      vendorSlug: 'tdx',
      toolName: 'list_tickets',
    });
  });
});
