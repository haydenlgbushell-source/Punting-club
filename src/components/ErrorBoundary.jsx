import React from 'react';

// Full-page fallback — used at the root level in main.jsx
function RootFallback({ error, onReset }) {
  return (
    <div className="min-h-screen bg-[#F4F6F4] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Something went wrong</h1>
        <p className="text-slate-500 text-sm mb-6 leading-relaxed">
          An unexpected error occurred. Refreshing the page usually fixes it.
        </p>
        {error?.message && (
          <pre className="text-left bg-red-50 rounded-lg p-3 text-xs text-red-700 mb-6 overflow-auto max-h-32 whitespace-pre-wrap break-words">
            {error.message}
          </pre>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={onReset}
            className="px-5 py-2.5 rounded-full bg-gold-500 hover:bg-gold-400 text-brand-950 text-sm font-bold transition-colors"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-full bg-white border border-gray-300 text-slate-700 text-sm font-semibold hover:border-brand-400 transition-colors"
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
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
      <p className="text-red-700 text-sm font-medium mb-1">
        {label ? `${label} failed to load` : 'This section failed to load'}
      </p>
      {error?.message && (
        <p className="text-red-700/60 text-xs mb-3 font-mono">{error.message}</p>
      )}
      <button
        onClick={onReset}
        className="text-xs text-brand-600 hover:text-brand-600 underline underline-offset-2"
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
