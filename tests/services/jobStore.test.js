'use strict';

/**
 * The job collector's shelf: one row per title and company, refreshed on each
 * sighting; a search reads rows matching the role or any skill, marked as
 * already checked.
 */

jest.mock('../../models/JobOpening', () => ({ bulkWrite: jest.fn(), find: jest.fn() }));
const JobOpening = require('../../models/JobOpening');
const jobStore = require('../../services/v2/jobStore');

beforeEach(() => {
  JobOpening.bulkWrite.mockReset().mockResolvedValue({});
  JobOpening.find.mockReset();
});

describe('save', () => {
  it('upserts one row per title and company, and skips rows with no link', async () => {
    const n = await jobStore.save([
      { title: 'Frontend Intern', company: 'Saffron Labs', url: 'https://jobs.lever.co/s/1', source: 'Lever', tags: ['react'] },
      { title: 'No link', company: 'X' },
      { title: 'Data Analyst', company: 'Kite', url: 'https://a.example/2', directUrl: 'https://a.example/2', directKind: 'via' },
    ]);
    expect(n).toBe(2);
    const ops = JobOpening.bulkWrite.mock.calls[0][0];
    expect(ops[0].updateOne.filter).toEqual({ key: 'frontend intern|saffron labs' });
    expect(ops[0].updateOne.upsert).toBe(true);
    expect(ops[0].updateOne.update.$set).toMatchObject({ title: 'Frontend Intern', tags: ['react'] });
    expect(ops[0].updateOne.update.$set.seenAt).toBeInstanceOf(Date);
    expect(ops[1].updateOne.update.$set.directKind).toBe('via');
  });

  it('writes nothing for nothing', async () => {
    expect(await jobStore.save([])).toBe(0);
    expect(JobOpening.bulkWrite).not.toHaveBeenCalled();
  });
});

describe('find', () => {
  const chain = (rows) => ({ sort: () => ({ limit: () => ({ lean: () => Promise.resolve(rows) }) }) });

  it('searches the role and the skills, and marks rows as checked', async () => {
    JobOpening.find.mockReturnValue(chain([{ _id: 'x', key: 'k', score: 3, seenAt: new Date(), title: 'React Developer', company: 'A' }]));
    const rows = await jobStore.find({ role: 'frontend developer', skills: ['react', 'css'] });
    expect(JobOpening.find.mock.calls[0][0]).toEqual({ $text: { $search: 'frontend developer react css' } });
    expect(rows).toEqual([{ title: 'React Developer', company: 'A', tags: [], fromStore: true }]);
  });

  it('asks nothing for an empty profile', async () => {
    expect(await jobStore.find({ role: '', skills: [] })).toEqual([]);
    expect(JobOpening.find).not.toHaveBeenCalled();
  });
});
