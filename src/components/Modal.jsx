import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Accessible dialog: announced as a modal, closes on Escape, keeps keyboard
// focus inside while open, stops the page behind from scrolling, and returns
// focus to whatever opened it.
const Modal = ({ onClose, title, children, maxWidth = 'max-w-md' }) => {
  const panelRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement;
    const panel = panelRef.current;
    const first = panel?.querySelector(FOCUSABLE);
    (first || panel)?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 bg-brand-950/60 backdrop-blur-sm z-[100] overflow-y-auto bc-backdrop">
      <div className="flex min-h-full items-end sm:items-start justify-center sm:p-4 sm:py-10">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={`bg-white text-slate-900 rounded-t-2xl sm:rounded-2xl w-full ${maxWidth} flex flex-col shadow-2xl shadow-brand-950/20 bc-modal focus:outline-none`}
        >
          <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex justify-between items-center z-10 rounded-t-2xl">
            <h2 id={titleId} className="text-xl font-bold text-slate-900">{title}</h2>
            <button onClick={onClose} aria-label="Close" className="w-9 h-9 -mr-2 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-gray-100 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="pb-[env(safe-area-inset-bottom)]">{children}</div>
        </div>
      </div>
    </div>
  );
};

export default Modal;
