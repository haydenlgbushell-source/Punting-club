import React from 'react';
import { CheckCircle, XCircle, Zap, Clock, MinusCircle } from 'lucide-react';

const COLORS = {
  won:         'bg-green-100 border-green-300 text-green-700',
  lost:        'bg-red-100 border-red-300 text-red-700',
  partial:     'bg-yellow-100 border-yellow-300 text-yellow-700',
  pending:     'bg-teal-50 border-teal-200 text-teal-600',
  void:        'bg-gray-100 border-gray-300 text-gray-600',
  in_progress: 'bg-teal-50 border-teal-200 text-teal-600',
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
