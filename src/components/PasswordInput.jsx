import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// Drop-in replacement for <input type="password"> that adds a show/hide toggle.
// All standard input props (value, onChange, className, placeholder, required,
// minLength, autoComplete, …) are forwarded to the underlying input.
export default function PasswordInput({ className = '', wrapperClassName = '', ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        {...props}
        type={show ? 'text' : 'password'}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-300 transition-colors"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

// Lightweight strength meter. Returns null below the render threshold so callers
// can drop it straight under a password field.
export function PasswordStrength({ value }) {
  if (!value) return null;
  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
  if (/\d/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value)) score++;
  const level = Math.min(score, 4);
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['bg-red-500', 'bg-red-400', 'bg-amber-400', 'bg-lime-400', 'bg-green-500'];
  const textColors = ['text-red-400', 'text-red-400', 'text-amber-400', 'text-lime-400', 'text-green-400'];
  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full ${i < level ? colors[level] : 'bg-white/10'}`} />
        ))}
      </div>
      <p className={`text-xs mt-1 ${textColors[level]}`}>{labels[level]}</p>
    </div>
  );
}
