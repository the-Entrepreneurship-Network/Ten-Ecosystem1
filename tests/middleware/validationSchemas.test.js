'use strict';

const {
  validate,
  studentRegisterSchema,
  studentLoginSchema,
  studentProfileUpdateSchema,
  hrActionSchema,
  coordinatorActionSchema,
  paymentInitSchema,
  mongoIdParamSchema
} = require('../../middleware/validationSchemas');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('middleware/validationSchemas', () => {
  describe('validate factory', () => {
    it('calls next() if validation passes', () => {
      const schema = {
        fields: {
          testField: { required: true, type: 'string' }
        }
      };
      const req = { body: { testField: 'hello' } };
      const res = mockRes();
      const next = jest.fn();

      validate(schema)(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 400 and collected errors if required field is missing', () => {
      const schema = {
        fields: {
          testField: { required: true, type: 'string' }
        }
      };
      const req = { body: {} };
      const res = mockRes();
      const next = jest.fn();

      validate(schema)(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      const resBody = res.json.mock.calls[0][0];
      expect(resBody.success).toBe(false);
      expect(resBody.error).toBe('Validation failed');
      expect(resBody.details[0].field).toBe('testField');
    });

    it('rejects unexpected fields in strict mode', () => {
      const schema = {
        isStrict: true,
        fields: {
          testField: { required: true, type: 'string' }
        }
      };
      const req = { body: { testField: 'hello', rogueField: 'danger' } };
      const res = mockRes();
      const next = jest.fn();

      validate(schema)(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      const resBody = res.json.mock.calls[0][0];
      expect(resBody.details.some(d => d.field === 'rogueField')).toBe(true);
    });
  });

  describe('studentRegisterSchema', () => {
    it('passes valid register payload', () => {
      const req = {
        body: {
          name: 'Bishal Nag',
          email: 'bishal@example.com',
          password: 'Password123!',
          phone: '9876543210',
          domain: 'Web Development'
        }
      };
      const res = mockRes();
      const next = jest.fn();

      validate(studentRegisterSchema)(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('rejects weak passwords', () => {
      const req = {
        body: {
          name: 'Bishal Nag',
          email: 'bishal@example.com',
          password: 'weak',
          domain: 'Web Development'
        }
      };
      const res = mockRes();
      const next = jest.fn();

      validate(studentRegisterSchema)(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects invalid email formats', () => {
      const req = {
        body: {
          name: 'Bishal Nag',
          email: 'not-an-email',
          password: 'Password123!',
          domain: 'Web Development'
        }
      };
      const res = mockRes();
      const next = jest.fn();

      validate(studentRegisterSchema)(req, res, next);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('studentLoginSchema', () => {
    it('passes valid login payload', () => {
      const req = {
        body: {
          email: 'bishal@example.com',
          password: 'Password123!'
        }
      };
      const res = mockRes();
      const next = jest.fn();

      validate(studentLoginSchema)(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('studentProfileUpdateSchema', () => {
    it('rejects email modification requests', () => {
      const req = {
        body: {
          name: 'New Name',
          email: 'newemail@example.com'
        }
      };
      const res = mockRes();
      const next = jest.fn();

      validate(studentProfileUpdateSchema)(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('hrActionSchema', () => {
    it('passes valid HR action payload', () => {
      const req = {
        body: {
          studentId: '507f1f77bcf86cd799439011',
          action: 'approve',
          reason: 'Meets criteria'
        }
      };
      const res = mockRes();
      const next = jest.fn();

      validate(hrActionSchema)(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
