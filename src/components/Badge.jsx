import React from 'react';
import { CheckCircle, XCircle, Zap, Clock, MinusCircle } from 'lucide-react';

const COLORS = {
  won:         'bg-green-500/20 border-green-500/60 text-green-400',
  lost:        'bg-red-500/20 border-red-500/60 text-red-400',
  partial:     'bg-yellow-500/20 border-yellow-500/60 text-yellow-400',
  pending:     'bg-emerald-500/10 border-emerald-500/30 text-emerald-500',
  void:        'bg-gray-500/20 border-gray-500/60 text-gray-400',
  in_progress: 'bg-orange-500/20 border-orange-500/60 text-orange-500',
};

const CONFIG = {
  won:         { icon: <CheckCircle className="w-3 h-3" />, label: 'Won' },
  lost:        { icon: <XCircle className="w-3 h-3" />, label: 'Lost' },
  partial:     { icon: <Zap className="w-3 h-3" />, label: 'Partial' },
  pending:     { icon: <Clock className="w-3 h-3" />, label: 'Pending' },
  void:        { icon: <MinusCircle className="w-3 h-3" />, label: 'Void' },
  in_progress: { icon: <span className="w-2 h-2 rounded-full bg-current animate-pulse inline-block" />, label: 'Live' },
};

const Badge = ({ status }) => {
  const r = CONFIG[status] || CONFIG.pending;
  return (
    <span className={`border text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap inline-flex items-center gap-1 ${COLORS[status] || COLORS.pending}`}>
      {r.icon}{r.label}
    </span>
  );
};

export default Badge;
