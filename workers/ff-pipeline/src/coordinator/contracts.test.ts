import { describe, it, expect } from 'vitest';
import { ROLE_CONTRACTS } from './contracts';

describe('ROLE_CONTRACTS', () => {
  it('verifier entry retains unchanged role, taskKind, and outputChannel after systemPrompt removal and parse replacement', () => {
    const verifier = ROLE_CONTRACTS.verifier;

    expect(verifier.role).toBe('verifier');
    expect(verifier.taskKind).toBe('verifier');
    expect(verifier.outputChannel).toBe('verdict');
  });
});
