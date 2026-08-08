const path = require("path");
const os = require("os");
const fs = require("fs");

describe("loadEnvironment", () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
  });

  it("loads the project .env file even when the process starts in another directory", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ten-env-"));
    process.chdir(tempDir);
    delete process.env.SES_SMTP_USER;
    delete process.env.SES_SMTP_PASS;

    const { loadEnvironment } = require("../../utils/mailer");
    const result = loadEnvironment();

    expect(result.error).toBeUndefined();
    expect(process.env.SES_SMTP_USER).toBe("lavyakhandelwal23@gmail.com");
    expect(process.env.SES_SMTP_PASS).toBe("lemlbscknhppenve");
  });
});
