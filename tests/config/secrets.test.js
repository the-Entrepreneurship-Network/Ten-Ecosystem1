'use strict';

const bcrypt = require('bcryptjs');

const VALID = {
  SESSION_SECRET: 'x'.repeat(64),
  ADMIN_API_SECRET: 'y'.repeat(48),
  ADMIN_PASSWORD_HASH: bcrypt.hashSync('whatever', 4),
  CORS_ALLOWED_ORIGINS: 'https://example.test',
  HR_CREDENTIALS: '{"vp@ten.com":{"passwordHash":"$2b$12$abc"}}',
  COORDINATOR_CREDENTIALS: '{"web_admin":{"passwordHash":"$2b$12$abc"}}'
};

function withEnv(env, fn) {
  const saved = { ...process.env };
  // Start from a clean slate so a stray real value cannot mask a failure.
  for (const key of Object.keys(VALID)) delete process.env[key];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    process.env = saved;
  }
}

function load() {
  let mod;
  jest.isolateModules(() => { mod = require('../../config/secrets'); });
  return mod;
}

describe('config/secrets', () => {
  describe('collectSecretProblems', () => {
    it('reports nothing when every secret is present and strong', () => {
      withEnv(VALID, () => {
        expect(load().collectSecretProblems()).toEqual([]);
      });
    });

    it.each(Object.keys(VALID))('reports %s when it is missing', (missing) => {
      const env = { ...VALID };
      delete env[missing];
      withEnv(env, () => {
        const names = load().collectSecretProblems().map((p) => p.name);
        expect(names).toEqual([missing]);
      });
    });

    it('rejects a SESSION_SECRET that is too short to be unguessable', () => {
      withEnv({ ...VALID, SESSION_SECRET: 'short' }, () => {
        const problems = load().collectSecretProblems();
        expect(problems).toHaveLength(1);
        expect(problems[0].name).toBe('SESSION_SECRET');
        expect(problems[0].reason).toMatch(/too short/);
      });
    });

    it('rejects a cleartext ADMIN_PASSWORD_HASH', () => {
      withEnv({ ...VALID, ADMIN_PASSWORD_HASH: 'a'.repeat(60) }, () => {
        const problems = load().collectSecretProblems();
        expect(problems).toHaveLength(1);
        expect(problems[0].name).toBe('ADMIN_PASSWORD_HASH');
        expect(problems[0].reason).toMatch(/bcrypt/);
      });
    });

    it('treats whitespace-only values as unset', () => {
      withEnv({ ...VALID, ADMIN_API_SECRET: '   ' }, () => {
        expect(load().collectSecretProblems().map((p) => p.name)).toEqual(['ADMIN_API_SECRET']);
      });
    });

    it('reports every problem at once rather than stopping at the first', () => {
      withEnv({ SESSION_SECRET: VALID.SESSION_SECRET }, () => {
        const names = load().collectSecretProblems().map((p) => p.name);
        expect(names).toHaveLength(Object.keys(VALID).length - 1);
        expect(names).not.toContain('SESSION_SECRET');
      });
    });
  });

  describe('assertSecrets', () => {
    it('exits the process when a secret is missing and exitOnFailure is set', () => {
      withEnv({}, () => {
        const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
        const err = jest.spyOn(console, 'error').mockImplementation(() => {});

        load().assertSecrets({ exitOnFailure: true });

        expect(exit).toHaveBeenCalledWith(1);
        exit.mockRestore();
        err.mockRestore();
      });
    });

    it('warns but continues when exitOnFailure is false', () => {
      withEnv({}, () => {
        const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const problems = load().assertSecrets({ exitOnFailure: false });

        expect(exit).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        expect(problems.length).toBeGreaterThan(0);
        exit.mockRestore();
        warn.mockRestore();
      });
    });

    it('does not exit when everything is configured', () => {
      withEnv(VALID, () => {
        const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});

        expect(load().assertSecrets({ exitOnFailure: true })).toEqual([]);
        expect(exit).not.toHaveBeenCalled();
        exit.mockRestore();
        log.mockRestore();
      });
    });
  });
});
