import { describe, it, expect } from 'bun:test';
import {
  formatDiscoverResults,
  formatInspectResult,
} from '../../src/output/format.js';
import type {
  DiscoverResponse,
  InspectResponse,
  Price,
} from '../../src/api/types.js';

/** Strip ANSI color codes so assertions are stable regardless of chalk state. */
function plain(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

function capture(fn: () => void): string {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(' '));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return plain(lines.join('\n'));
}

const price = {
  type: 'PER_CALL',
  amount: { value: 0.0645, currency: 'USD' },
} as unknown as Price;

describe('0 Markup (no-markup tag)', () => {
  it('discover: the 0 Markup column replaces Verified', () => {
    const data: DiscoverResponse = {
      query: 'backlinks',
      count: 2,
      results: [
        {
          provider: 'ahrefs',
          providerName: 'Ahrefs',
          endpoint: '/site-explorer/all-backlinks',
          description: 'Backlinks',
          price,
          score: 0.9,
          tags: ['verified', 'no-markup'],
        },
        {
          provider: 'fundable',
          providerName: 'Fundable',
          endpoint: '/deals',
          description: 'Deals',
          price,
          score: 0.5,
          tags: ['verified'],
        },
      ],
    };
    const out = capture(() => formatDiscoverResults(data));
    expect(out).toContain('0 Markup');
    expect(out).not.toContain('Verified');
    const ahrefs = out.split('\n').find((l) => l.includes('/site-explorer'));
    const fundable = out.split('\n').find((l) => l.includes('/deals'));
    expect(ahrefs).toContain('✓');
    expect(fundable).not.toContain('✓');
  });

  it('inspect: prints 0 Markup only for tagged endpoints, never Verified', () => {
    const base: InspectResponse = {
      id: 'x',
      provider: 'ahrefs',
      providerName: 'Ahrefs',
      endpoint: '/site-explorer/all-backlinks',
      description: 'Backlinks',
      price,
      tags: ['verified', 'no-markup'],
    };
    const tagged = capture(() => formatInspectResult(base));
    expect(tagged).toContain("0 Markup (provider's standard rate, no platform fee)");
    expect(tagged).not.toContain('Verified');

    const untagged = capture(() =>
      formatInspectResult({ ...base, tags: ['verified'] }),
    );
    expect(untagged).not.toContain('0 Markup');
    expect(untagged).not.toContain('Verified');
  });
});
