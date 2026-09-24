import React, { useState } from 'react';
import { 
  Truck, 
  Mail, 
  Lock, 
  Eye, 
  EyeOff, 
  ArrowRight, 
  Sun, 
  Moon 
} from 'lucide-react';

export default function AuthView({ onLogin, externalError, theme, toggleTheme }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!email.trim() || !password.trim()) {
      setErrorMsg('Iltimos, email va parolni kiriting!');
      return;
    }

    setSubmitting(true);
    try {
      await onLogin(email, password);
    } catch (error) {
      setErrorMsg(error.message || 'Email yoki parol noto‘g‘ri.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col justify-between p-4 sm:p-6 transition-colors select-none">
      
      {/* Top Bar with Brand & Theme Toggle */}
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-950 shadow-md">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <span className="font-black text-xl text-zinc-900 dark:text-zinc-100 tracking-tight block">
              ApexHaul
            </span>
            <span className="text-xs text-zinc-400 font-mono block -mt-1">
              TMS Dispatcher
            </span>
          </div>
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2.5 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs transition-colors"
          title={theme === 'dark' ? 'Oq rejim' : 'Qora rejim'}
        >
          {theme === 'dark' ? (
            <Sun className="w-5 h-5 text-amber-400" />
          ) : (
            <Moon className="w-5 h-5 text-zinc-700" />
          )}
        </button>
      </div>

      {/* Main Simple Auth Card: Faqat Email va Parol */}
      <div className="max-w-md w-full mx-auto my-auto py-8">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-8 shadow-xl">
          
          {/* Card Header */}
          <div className="text-center mb-6">
            <h2 className="text-2xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
              Tizimga Kirish
            </h2>
            <p className="text-sm text-zinc-500 mt-1">
              ApexHaul dispetcherlik tizimi
            </p>
          </div>

          {/* Error Message */}
          {(errorMsg || externalError) && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 text-xs font-bold text-center">
              {errorMsg || externalError}
            </div>
          )}

          {/* Clean Form: ONLY Email & Password */}
          <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* Email */}
            <div>
              <label className="block text-xs font-mono font-bold text-zinc-500 uppercase mb-1.5">
                Elektron Pochta
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3.5" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="dispatch@company.com"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl pl-10 pr-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-mono font-bold text-zinc-500 uppercase mb-1.5">
                Parol
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3.5" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl pl-10 pr-10 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 py-3.5 rounded-2xl font-bold text-base transition-all flex items-center justify-center space-x-2 shadow-sm hover:scale-[1.01] mt-4 disabled:opacity-60 disabled:cursor-wait"
            >
              <span>{submitting ? 'Tekshirilmoqda…' : 'Kirish'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

          </form>

        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-zinc-400 font-mono py-2">
        <span>ApexHaul TMS • Xavfsiz Aloqa • 2026</span>
      </div>

    </div>
  );
}
