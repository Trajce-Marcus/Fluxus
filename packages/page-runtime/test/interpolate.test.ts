// Typed-in text with `{{ expression }}` holes in it. The rule under test: the
// braces are a delimiter, not a language — this file only finds the holes and
// puts the string back together.

import { describe, expect, it } from 'vitest';
import { drawValue, fill, hasHoles, holes } from '../src/interpolate';

describe('finding the holes', () => {
  it('finds none in ordinary words', () => {
    expect(hasHoles('Cost Breakdown Structure')).toBe(false);
    expect(holes('Cost Breakdown Structure')).toEqual([]);
  });

  it('finds each one, in order, trimmed', () => {
    const found = holes('Project {{ record.project_no }} — {{record.name}}');
    expect(found.map((h) => h.expression)).toEqual(['record.project_no', 'record.name']);
  });

  // The whole reason for two braces rather than one: a stray brace in prose is
  // ordinary, so a single one as the delimiter would need an escape rule.
  it('leaves a lone brace alone, so nothing needs escaping', () => {
    expect(hasHoles('An empty object is {} in JSON')).toBe(false);
    expect(fill('An empty object is {} in JSON', [])).toBe('An empty object is {} in JSON');
  });

  it('does not end a hole on a single closing brace inside it', () => {
    expect(holes("{{ name + '}' }}").map((h) => h.expression)).toEqual(["name + '}'"]);
  });

  it('is not confused by a second call — the regex keeps no position', () => {
    const text = 'a {{ x }} b';
    expect(hasHoles(text)).toBe(true);
    expect(hasHoles(text)).toBe(true);
  });

  it('ignores anything that is not a string', () => {
    expect(hasHoles(42)).toBe(false);
    expect(hasHoles(null)).toBe(false);
  });
});

describe('filling them in', () => {
  it('puts each answer where its hole was', () => {
    expect(fill('Project {{ a }} — {{ b }}', ['P26-011', 'Pipeline'])).toBe('Project P26-011 — Pipeline');
  });

  it('keeps the line breaks the author typed', () => {
    expect(fill('One {{ a }}\nTwo', ['1'])).toBe('One 1\nTwo');
  });

  it('draws nothing for nothing, rather than the word "undefined"', () => {
    expect(fill('Client: {{ a }}', [null])).toBe('Client: ');
    expect(drawValue(undefined)).toBe('');
  });

  it('draws false and zero, which are values', () => {
    expect(fill('{{ a }} / {{ b }}', [false, 0])).toBe('false / 0');
  });

  it('leaves a template with no holes exactly as it is', () => {
    expect(fill('No holes here', [])).toBe('No holes here');
  });
});
