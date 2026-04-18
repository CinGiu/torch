import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ErrorBoundary } from './ErrorBoundary';

const originalConsoleError = console.error;
let consoleErrorMock;

beforeEach(() => {
  consoleErrorMock = jest.fn();
  console.error = consoleErrorMock;
});

afterEach(() => {
  console.error = originalConsoleError;
  jest.clearAllMocks();
});

const ThrowError = ({ message = 'Test error' }) => {
  throw new Error(message);
};

describe('ErrorBoundary', () => {
  test('1. Renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">Hello World</div>
      </ErrorBoundary>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  test('2. Shows fallback UI when error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText('The application encountered an unexpected error. This has been logged for debugging.')
    ).toBeInTheDocument();
    expect(screen.getByText('Error Details')).toBeInTheDocument();
    expect(screen.getByText('Error: Test error')).toBeInTheDocument();
    expect(screen.getByText('Reload Application')).toBeInTheDocument();
  });

  test('3. Calls componentDidCatch and logs errors', () => {
    render(
      <ErrorBoundary>
        <ThrowError message="Test error for logging" />
      </ErrorBoundary>
    );

    expect(consoleErrorMock).toHaveBeenCalled();
  });

  test('4. Dispatches custom event on error', () => {
    const eventHandler = jest.fn();
    window.addEventListener('app-error', eventHandler);

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(eventHandler).toHaveBeenCalled();
    expect(eventHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'app-error',
        detail: expect.objectContaining({
          error: expect.any(Error),
          timestamp: expect.any(Number),
        }),
      })
    );

    window.removeEventListener('app-error', eventHandler);
  });

  test('5. Handle reset button calls reload', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    
    const reloadButton = screen.getByRole('button', { name: /reload application/i });
    
    expect(reloadButton).toBeInTheDocument();
    expect(reloadButton).toHaveTextContent('Reload Application');
    
    fireEvent.click(reloadButton);
  });
});
