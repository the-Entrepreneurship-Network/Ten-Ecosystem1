'use strict';

function mockRes() {
  const res = {};
  res.headers = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  // Express responses have set(); guards use it to mark a genuine session
  // failure (X-Session-Expired), so the double has to have it too.
  res.set = jest.fn((k, v) => { res.headers[String(k).toLowerCase()] = v; return res; });
  return res;
}

function expectValidationError(req, middleware, field) {
  const res = mockRes();
  const next = jest.fn();
  middleware(req, res, next);
  expect(res.status).toHaveBeenCalledWith(422);
  const body = res.json.mock.calls[0][0];
  expect(body.success).toBe(false);
  if (field) {
    expect(body.errors.some(e => e.field === field)).toBe(true);
  }
  expect(next).not.toHaveBeenCalled();
  return body;
}

function expectNextCalled(req, middleware) {
  const res = mockRes();
  const next = jest.fn();
  middleware(req, res, next);
  expect(next).toHaveBeenCalled();
  expect(res.status).not.toHaveBeenCalled();
}

module.exports = { mockRes, expectValidationError, expectNextCalled };
