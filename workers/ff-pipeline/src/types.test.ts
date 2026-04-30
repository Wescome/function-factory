import { PipelineResult } from './types';

describe('PipelineResult', () => {
  describe('factoryVersion', () => {
    it('should be of type string when provided', () => {
      const result: PipelineResult = {
        factoryVersion: 'v1.0.0',
      };
      expect(result.factoryVersion).toBeDefined();
      expect(typeof result.factoryVersion).toBe('string');
    });
  });
});