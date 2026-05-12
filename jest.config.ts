import type {Config} from '@jest/types';

export default async (): Promise<Config.InitialOptions> => {
    return {
        preset: 'ts-jest/presets/default-esm', // or other ESM presets
        roots: [
            '<rootDir>/test'
        ],
        testMatch: [
            '**/__tests__/**/*.+(ts|tsx|js)',
            '**/?(*.)+(spec|test).+(ts|tsx|js)'
        ],
        transform: {
            '^.+\\.(ts|tsx)$': [
                'ts-jest',
                {
                    useESM: true,
                }
            ]
        },
        setupFilesAfterEnv: [
            '<rootDir>/test/jest-setup.ts'
        ]
    };
};