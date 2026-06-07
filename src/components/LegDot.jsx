import React from 'react';

const COLORS = {
  won:         'bg-green-500/30 border-green-500 text-green-400',
  lost:        'bg-red-500/30 border-red-500 text-red-400',
  void:        'bg-gray-500/30 border-gray-500 text-gray-400',
  pending:     'bg-emerald-500/10 border-emerald-500/40 text-emerald-500',
  in_progress: 'bg-orange-500/30 border-orange-500 text-orange-500',
};

const ICON = { won: '✓', lost: '✗', void: '—', in_progress: '◉' };

const LegDot = ({ leg }) => (
  <div
    title={`Leg ${leg.legNumber}: ${leg.selection} @ ${leg.odds} — ${leg.status}`}
    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${COLORS[leg.status] || COLORS.pending}`}
  >
    {ICON[leg.status] ?? leg.legNumber}
  </div>
);

export default LegDot;
