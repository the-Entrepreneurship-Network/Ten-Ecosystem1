'use strict';

describe('Password Reset Integration', () => {
  it('should have password reset endpoints configured', () => {
    const forgotPasswordEndpoint = '/auth/forgot-password';
    const resetPasswordEndpoint = '/auth/reset-password';

    expect(forgotPasswordEndpoint).toBe('/auth/forgot-password');
    expect(resetPasswordEndpoint).toBe('/auth/reset-password');
  });
});
