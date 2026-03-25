import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

type FatalBoundaryState = {
  error: Error | null;
};

class FatalBoundary extends React.Component<React.PropsWithChildren, FatalBoundaryState> {
  state: FatalBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div
        style={{
          minHeight: '100vh',
          padding: '2rem',
          color: '#f7fbff',
          background: '#091018',
          fontFamily: '"SF Mono", monospace',
        }}
      >
        <h1 style={{ marginTop: 0 }}>Renderer Error</h1>
        <pre style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{this.state.error.stack || this.state.error.message}</pre>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FatalBoundary>
      <App />
    </FatalBoundary>
  </React.StrictMode>,
);
