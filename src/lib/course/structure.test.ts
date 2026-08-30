import { describe, it, expect } from 'vitest';

import { isWholeCourse } from './structure';

describe('isWholeCourse', () => {
  it('treats a one-module course as whole', () => {
    expect(isWholeCourse(1)).toBe(true);
  });

  it('treats a legacy course with no module rows as whole', () => {
    expect(isWholeCourse(0)).toBe(true);
  });

  it('treats two or more modules as modular', () => {
    expect(isWholeCourse(2)).toBe(false);
    expect(isWholeCourse(7)).toBe(false);
  });
});
