import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null,
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
    
    if (errorInfo && errorInfo.componentStack) {
      console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    }

    window.dispatchEvent(new CustomEvent('app-error', { 
      detail: { error, errorInfo, timestamp: Date.now() } 
    }));
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#12100e',
          color: '#f0ebe4',
          fontFamily: 'Inter, sans-serif',
          padding: '40px 20px',
        }}>
          <div style={{
            maxWidth: '500px',
            background: '#1c1814',
            border: '1px solid #2e2720',
            borderTop: '2px solid #f87171',
            borderRadius: '10px',
            padding: '32px',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '16px',
            }}>
              <span style={{ fontSize: '24px' }}>⚠</span>
              <h1 style={{ 
                margin: 0, 
                fontSize: '20px', 
                fontWeight: 700,
                color: '#f0ebe4',
              }}>
                Something went wrong
              </h1>
            </div>
            
            <p style={{
              margin: '0 0 16px',
              fontSize: '14px',
              color: '#7a6a5e',
              lineHeight: 1.6,
            }}>
              The application encountered an unexpected error. This has been logged for debugging.
            </p>

            {this.state.error && (
              <div style={{
                background: '#0f0d0b',
                border: '1px solid #2e2720',
                borderRadius: '6px',
                padding: '12px 16px',
                marginBottom: '20px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '12px',
                color: '#f87171',
                overflow: 'auto',
                maxHeight: '200px',
              }}>
                <div style={{ marginBottom: '8px', color: '#f0ebe4', textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.08em' }}>
                  Error Details
                </div>
                {this.state.error.toString()}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={this.handleReset}
                style={{
                  flex: 1,
                  padding: '11px 24px',
                  borderRadius: '8px',
                  border: '1px solid #6ee7b7',
                  background: 'rgba(110, 231, 183, 0.15)',
                  color: '#6ee7b7',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '13px',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'rgba(110, 231, 183, 0.25)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'rgba(110, 231, 183, 0.15)';
                }}
              >
                Reload Application
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
