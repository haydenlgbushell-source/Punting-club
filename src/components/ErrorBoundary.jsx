import React from 'react';

// Full-page fallback — used at the root level in main.jsx
function RootFallback({ error, onReset }) {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white/[0.04] border border-white/[0.08] rounded-xl p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-white mb-2">Something went wrong</h1>
        <p className="text-gray-400 text-sm mb-6 leading-relaxed">
          An unexpected error occurred. Refreshing the page usually fixes it.
        </p>
        {error?.message && (
          <pre className="text-left bg-black/40 rounded-lg p-3 text-xs text-red-300 mb-6 overflow-auto max-h-32 whitespace-pre-wrap break-words">
            {error.message}
          </pre>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={onReset}
            className="px-4 py-2 rounded-lg bg-blue-500/20 border border-blue-500/40 text-sky-400 text-sm font-medium hover:bg-blue-500/30 transition-colors"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-white/[0.06] border border-white/[0.10] text-gray-300 text-sm font-medium hover:bg-white/[0.10] transition-colors"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}

// Inline fallback — used around individual sections; blends into the page
function SectionFallback({ error, onReset, label }) {
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center">
      <p className="text-red-400 text-sm font-medium mb-1">
        {label ? `${label} failed to load` : 'This section failed to load'}
      </p>
      {error?.message && (
        <p className="text-red-400/60 text-xs mb-3 font-mono">{error.message}</p>
      )}
      <button
        onClick={onReset}
        className="text-xs text-sky-400 hover:text-sky-300 underline underline-offset-2"
      >
        Try again
      </button>
    </div>
  );
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    if (typeof this.props.onError === 'function') {
      this.props.onError(error, errorInfo);
    }
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ErrorBoundary]', error, errorInfo);
    }
  }

  reset() {
    this.setState({ error: null, errorInfo: null });
  }

  render() {
    const { error } = this.state;
    const { children, fallback, label, variant = 'root' } = this.props;

    if (error) {
      if (fallback) {
        return typeof fallback === 'function'
          ? fallback({ error, reset: this.reset })
          : fallback;
      }
      return variant === 'section'
        ? <SectionFallback error={error} onReset={this.reset} label={label} />
        : <RootFallback error={error} onReset={this.reset} />;
    }

    return children;
  }
}
