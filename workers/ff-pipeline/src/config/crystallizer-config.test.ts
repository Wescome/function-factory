import { seedPipelineConfig } from './crystallizer-config';

describe('seedPipelineConfig', () => {
  let mockDb: { query: jest.Mock };

  beforeEach(() => {
    mockDb = {
      query: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('must preserve operator overrides by omitting crystallizer from the UPDATE clause', async () => {
    await seedPipelineConfig(mockDb);

    expect(mockDb.query).toHaveBeenCalledTimes(1);

    const callArgs = mockDb.query.mock.calls[0];
    const queryString =
      typeof callArgs[0] === 'string' ? callArgs[0] : (callArgs[0] as { query: string }).query;

    expect(queryString).toContain('UPSERT');
    expect(queryString).toContain('UPDATE');
    expect(queryString).toContain('IN hot_config');

    // The UPDATE section must not overwrite crystallizer settings
    const updateSectionMatch = queryString.match(/UPDATE([\s\S]*?)IN/);
    expect(updateSectionMatch).toBeTruthy();
    const updateSection = updateSectionMatch![1];

    expect(updateSection).not.toContain('crystallizer');
    expect(updateSection).toContain('seededAt');
    expect(updateSection).toContain('source');
  });

  it('should include crystallizer configuration in the INSERT clause', async () => {
    await seedPipelineConfig(mockDb);

    const callArgs = mockDb.query.mock.calls[0];
    const queryString =
      typeof callArgs[0] === 'string' ? callArgs[0] : (callArgs[0] as { query: string }).query;

    const insertSectionMatch = queryString.match(/INSERT([\s\S]*?)UPDATE/);
    expect(insertSectionMatch).toBeTruthy();
    const insertSection = insertSectionMatch![1];

    expect(insertSection).toContain('crystallizer');
  });
});
