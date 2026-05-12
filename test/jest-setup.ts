import { jest } from '@jest/globals';

// Global test setup - suppress console output during tests unless DEBUG_TESTS is set
if (!process.env.DEBUG_TESTS) {
    beforeAll(() => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'debug').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });
}
