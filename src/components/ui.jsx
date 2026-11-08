// Shared building blocks for the "Clubhouse" look, so every page uses the
// same header, cards, buttons and countdown.
import React, { useEffect, useState } from 'react';
import { ChevronLeft, Clock } from 'lucide-react';

export const btn = {
  primary: 'inline-flex items-center justify-center gap-1.5 bg-gold-500 hover:bg-gold-400 text-brand-950 font-bold rounded-full px-5 py-2.5 text-sm transition-colors',
  dark: 'inline-flex items-center justify-center gap-1.5 bg-brand-900 hover:bg-brand-800 text-white font-bold rounded-full px-5 py-2.5 text-sm transition-colors',
  ghost: 'inline-flex items-center justify-center gap-1.5 bg-white border border-gray-300 hover:border-brand-400 text-slate-700 hover:text-brand-800 font-semibold rounded-full px-5 py-2.5 text-sm transition-colors',
};

export const Page = ({ width = 'max-w-5xl', children }) => (
  <section className="pt-6 sm:pt-10 pb-16 px-4 sm:px-6">
    <div className={`${width} mx-auto`}>{children}</div>
  </section>
);

export const BackButton = ({ onClick }) => (
  <button onClick={onClick} className="flex items-center gap-1 text-slate-500 hover:text-brand-700 text-sm font-semibold mb-4 transition-colors group">
    <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" /> Back
  </button>
);

export const PageHeader = ({ eyebrow, title, subtitle, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
    <div className="min-w-0">
      {eyebrow && <p className="text-xs font-bold uppercase tracking-wider text-brand-600 mb-1">{eyebrow}</p>}
      <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 leading-tight">{title}</h1>
      {subtitle && <div className="text-slate-500 text-sm mt-1">{subtitle}</div>}
    </div>
    {actions && <div className="flex gap-2 flex-wrap flex-shrink-0">{actions}</div>}
  </div>
);

export const Card = ({ className = '', children, ...rest }) => (
  <div className={`bg-white border border-gray-200 rounded-2xl ${className}`} {...rest}>{children}</div>
);

export const CardTitle = ({ icon, children, right }) => (
  <div className="flex items-center justify-between gap-3 mb-3">
    <h3 className="font-bold text-slate-900 flex items-center gap-2">
      {icon && <span className="text-brand-600">{icon}</span>}{children}
    </h3>
    {right}
  </div>
);

// "2d 18h" until the given Date, refreshed every minute. Null once passed.
export function useCountdown(to) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);
  if (!to) return null;
  const ms = to.getTime() - now;
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const Countdown = ({ to, className = 'text-brand-700' }) => {
  const left = useCountdown(to);
  if (!left) return null;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${className}`}>
      <Clock className="w-3.5 h-3.5" /> Closes in {left}
    </span>
  );
};

// Gold / silver / bronze rank badge, plain for the rest.
export const RankBadge = ({ rank }) => {
  const tone = rank === 1 ? 'bg-gold-500 text-brand-950'
    : rank === 2 ? 'bg-slate-300 text-slate-800'
    : rank === 3 ? 'bg-amber-700 text-white'
    : 'bg-gray-100 text-slate-600';
  return <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold tabular-nums flex-shrink-0 ${tone}`}>{rank}</span>;
};
