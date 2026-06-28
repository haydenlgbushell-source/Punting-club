import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

const SwitcherDropdown = ({ label, items, selectedValue, onSelect, valueKey = 'code', labelKey = 'name', className = '' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = items.find(item => item[valueKey] === selectedValue);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 bg-white hover:border-gray-400 transition-colors text-sm font-semibold text-slate-700 min-w-[180px] w-full sm:w-auto"
      >
        <span className="text-xs text-slate-400 font-semibold whitespace-nowrap">{label}:</span>
        <span className="truncate">{selected?.[labelKey] || 'Select'}</span>
        <ChevronDown className={`w-4 h-4 ml-auto text-slate-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 min-w-[220px] w-full sm:w-auto bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {items.map(item => (
            <button
              key={item[valueKey]}
              onClick={() => { onSelect(item[valueKey]); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${selectedValue === item[valueKey] ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-slate-600 hover:bg-gray-50 hover:text-slate-900'}`}
            >
              {item[labelKey]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SwitcherDropdown;
