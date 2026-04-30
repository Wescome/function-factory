import { ORL_VERSION } from './output-reliability';

describe('output-reliability', () => {
  it('should export the latest ORL_VERSION', () => {
    expect(ORL_VERSION).toBe(5);
  });
});