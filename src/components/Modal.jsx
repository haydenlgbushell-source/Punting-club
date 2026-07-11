import React from 'react';
import { X } from 'lucide-react';

// variant="light" renders on the site's light theme — used for public-facing
// flows (e.g. the venue competition request) so the modal matches the page.
const Modal = ({ onClose, title, children, maxWidth = 'max-w-md', variant = 'dark' }) => {
  const light = variant === 'light';
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur z-[100] overflow-y-auto bc-backdrop">
      <div className="flex min-h-full items-start justify-center p-2 sm:p-4 py-4">
        <div className={`${light ? 'bg-white text-slate-900 border border-gray-200' : 'bg-gray-950 text-gray-100 border-2 border-brand-500'} rounded-xl w-full ${maxWidth} flex flex-col shadow-2xl shadow-brand-900/20 bc-modal`}>
          <div className={`sticky top-0 ${light ? 'bg-white border-b border-gray-200' : 'bg-gray-950 border-b border-brand-500/30'} p-4 flex justify-between items-center z-10 rounded-t-xl`}>
            <h2 className={`text-lg font-bold ${light ? 'text-slate-900' : 'text-white'}`}>{title}</h2>
            <button onClick={onClose} aria-label="Close" className={`${light ? 'text-slate-400 hover:text-brand-700' : 'text-gray-400 hover:text-brand-300'} transition-colors`}>
              <X className="w-5 h-5" />
            </button>
          </div>
          <div>{children}</div>
        </div>
      </div>
    </div>
  );
};

export default Modal;
