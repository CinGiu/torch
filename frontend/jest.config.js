export default {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/*.test.jsx', '**/*.test.js'],
  transform: {
    '^.+\\.(jsx|js)$': 'babel-jest',
  },
};
