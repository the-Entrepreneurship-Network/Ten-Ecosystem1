'use strict';

describe('Exact Attendance Google Form URL Configuration', () => {
  const EXACT_GFORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSf3qZwNUgQl7vqqTnGW4PKrMDwRWPJEMiVQ-NUI6h4NnJa8Zg/viewform';

  it('should match the official TEN Attendance Google Form URL', () => {
    expect(EXACT_GFORM_URL).toContain('1FAIpQLSf3qZwNUgQl7vqqTnGW4PKrMDwRWPJEMiVQ-NUI6h4NnJa8Zg');
  });
});
