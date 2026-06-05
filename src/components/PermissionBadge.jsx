import React from 'react';

const MAP = {
  captain:    { label: 'Captain',   cls: 'bg-amber-500/20 text-amber-400 border-amber-500/50' },
  member:     { label: 'Member',    cls: 'bg-blue-500/20 text-blue-400 border-blue-500/50' },
  'view-only':{ label: 'View Only', cls: 'bg-gray-500/20 text-gray-400 border-gray-500/50' },
};

const PermissionBadge = ({ role }) => {
  const r = MAP[role] || MAP.member;
  return (
    <span className={`border text-xs px-2 py-0.5 rounded-full font-semibold ${r.cls}`}>
      {r.label}
    </span>
  );
};

export default PermissionBadge;
