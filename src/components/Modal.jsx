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
    <div className="fixed inset-0 bg-black/80 backdrop-blur z-[100] overflow-y-auto bc-backdrop">
      <div className="flex min-h-full items-start justify-center p-2 sm:p-4 py-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={`bg-gray-950 text-gray-100 border-2 border-brand-500 rounded-xl w-full ${maxWidth} flex flex-col shadow-2xl shadow-brand-900/20 bc-modal focus:outline-none`}
        >
          <div className="sticky top-0 bg-gray-950 border-b border-brand-500/30 p-4 flex justify-between items-center z-10 rounded-t-xl">
            <h2 id={titleId} className="text-lg font-bold text-white">{title}</h2>
            <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-brand-300 transition-colors">
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
