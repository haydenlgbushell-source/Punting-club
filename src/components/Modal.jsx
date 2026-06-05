import React from 'react';
import { X } from 'lucide-react';

const Modal = ({ onClose, title, children, maxWidth = 'max-w-md' }) => (
  <div className="fixed inset-0 bg-black/80 backdrop-blur z-[100] overflow-y-auto bc-backdrop">
    <div className="flex min-h-full items-start justify-center p-2 sm:p-4 py-4">
      <div className={`bg-gray-950 border-2 border-blue-500 rounded-xl w-full ${maxWidth} flex flex-col shadow-2xl shadow-blue-900/20 bc-modal`}>
        <div className="sticky top-0 bg-gray-950 border-b border-blue-500/30 p-4 flex justify-between items-center z-10 rounded-t-xl">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-sky-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  </div>
);

export default Modal;
