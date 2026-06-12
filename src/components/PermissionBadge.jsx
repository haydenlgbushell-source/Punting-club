import React from 'react';

const MAP = {
  // Light pill works on both the light page and the dark navbar chip
  captain:    { label: 'Captain',   cls: 'bg-brand-100 text-brand-800 border-brand-300' },
  member:     { label: 'Member',    cls: 'bg-brand-100 text-brand-800 border-brand-300' },
  'view-only':{ label: 'View Only', cls: 'bg-gray-100 text-gray-600 border-gray-300' },
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
