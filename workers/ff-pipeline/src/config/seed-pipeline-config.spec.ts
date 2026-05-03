import { seedPipelineConfig } from './seed-pipeline-config';
import { prisma } from '../../prisma/client';

jest.mock('../../prisma/client', () => ({
  prisma: {
    pipelineConfig: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  },
}));

describe('seedPipelineConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves operator-set crystallizer.enabled during pipeline configuration updates', async () => {
    await seedPipelineConfig('pipeline-123');

    expect(prisma.pipelineConfig.upsert).toHaveBeenCalledTimes(1);

    const upsertArgs = (prisma.pipelineConfig.upsert as jest.Mock).mock.calls[0][0];
    const updatePayload = upsertArgs.update;

    // The UPDATE clause must not contain a crystallizer field,
    // otherwise operator-set configurations (e.g., crystallizer.enabled)
    // would be overwritten back to hardcoded defaults.
    expect(updatePayload).not.toHaveProperty('crystallizer');

    // Required metadata fields should still be updated.
    expect(updatePayload).toHaveProperty('seededAt');
    expect(updatePayload).toHaveProperty('source', 'hardcoded-defaults');
  });
});
