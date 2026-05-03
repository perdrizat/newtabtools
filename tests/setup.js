import { vi } from 'vitest';

// jest-webextension-mock calls `jest.fn(...)` at module load time, so we shim
// `globalThis.jest` to Vitest's `vi` (API-compatible) before importing it.
globalThis.jest = vi;

await import('jest-webextension-mock');
