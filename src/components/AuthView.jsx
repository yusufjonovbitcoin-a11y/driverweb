import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localizedError } from '../i18n/errors';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Moon,
  ShieldCheck,
  Sun,
  Truck,
} from 'lucide-react';

export default function AuthView({ onLogin, externalError, theme, toggleTheme }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMsg('');

    if (!email.trim() || !password.trim()) {
      setErrorMsg(t('auth.required'));
      return;
    }

    setSubmitting(true);
    try {
      await onLogin(email, password);
    } catch (error) {
      setErrorMsg(localizedError(t, error, 'errors.invalidCredentials'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-brand-panel" aria-label={t('auth.about')}>
        <div className="auth-brand">
          <span className="auth-logo" aria-hidden="true"><Truck size={22} /></span>
          <div>
            <strong>DRIVEX</strong>
            <span>TRANSPORT MANAGEMENT</span>
          </div>
        </div>

        <div className="auth-brand-copy">
          <p className="auth-eyebrow">{t('auth.workspace')}</p>
          <h1>{t('auth.heroTitle')}</h1>
          <p>{t('auth.heroText')}</p>
        </div>

        <div className="auth-security-note">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>{t('auth.secureAccount')}</span>
        </div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-topbar">
          <span>DRIVEX TMS</span>
          <button
            type="button"
            onClick={toggleTheme}
            className="auth-theme-button"
            aria-label={theme === 'dark' ? t('header.lightMode') : t('header.darkMode')}
            title={theme === 'dark' ? t('header.lightMode') : t('header.darkMode')}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        <div className="auth-form-wrap">
          <div className="auth-form-heading">
            <p className="auth-eyebrow">{t('auth.welcome')}</p>
            <h2>{t('auth.signIn')}</h2>
            <p>{t('auth.instructions')}</p>
          </div>

          {(errorMsg || externalError) && (
            <div className="auth-error" role="alert">
              {errorMsg || externalError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="auth-field">
              <label htmlFor="auth-email">{t('auth.email')}</label>
              <div className="auth-input-wrap">
                <Mail size={17} aria-hidden="true" />
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="dispatch@company.com"
                />
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="auth-password">{t('auth.password')}</label>
              <div className="auth-input-wrap">
                <Lock size={17} aria-hidden="true" />
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t('auth.passwordPlaceholder')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="auth-password-toggle"
                  aria-label={showPassword ? t('common.hidePassword') : t('common.showPassword')}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={submitting} className="auth-submit">
              <span>{submitting ? t('auth.checking') : t('auth.submit')}</span>
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </form>

          <p className="auth-help">
            {t('auth.help')}
          </p>
        </div>

        <p className="auth-footer">{t('auth.footer')}</p>
      </section>
    </main>
  );
}
