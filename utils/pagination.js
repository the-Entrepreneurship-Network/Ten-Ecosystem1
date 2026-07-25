'use strict';

/**
 * Extract pagination parameters from an Express query object.
 * @param {object}  query             - req.query
 * @param {object}  [opts]
 * @param {number}  [opts.defaultLimit=12]
 * @param {number}  [opts.maxLimit=50]
 * @returns {{ page: number, limit: number, skip: number }}
 */
function parsePagination(query, { defaultLimit = 12, maxLimit = 50 } = {}) {
  const page  = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, parseInt(query.limit, 10) || defaultLimit);
  const skip  = (page - 1) * limit;
  return { page, limit, skip };
}

/**
 * Build a standard paginated JSON envelope.
 * @param {{ page: number, limit: number, total: number, data: any }} opts
 */
function paginatedResponse({ page, limit, total, data }) {
  return {
    success:    true,
    data,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

module.exports = { parsePagination, paginatedResponse };
