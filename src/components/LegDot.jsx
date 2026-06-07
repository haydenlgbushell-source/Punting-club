import React from 'react';

const COLORS = {
  won:         'bg-green-100 border-green-400 text-green-700',
  lost:        'bg-red-100 border-red-400 text-red-700',
  void:        'bg-gray-100 border-gray-400 text-gray-600',
  pending:     'bg-teal-50 border-teal-300 text-teal-600',
  in_progress: 'bg-teal-100 border-teal-400 text-teal-700',
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
