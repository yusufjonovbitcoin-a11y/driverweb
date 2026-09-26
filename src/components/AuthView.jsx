import React, { useState } from 'react';
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMsg('');

    if (!email.trim() || !password.trim()) {
      setErrorMsg('Email va parolni kiriting.');
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
    <main className="auth-shell">
      <section className="auth-brand-panel" aria-label="DRIVEX haqida">
        <div className="auth-brand">
          <span className="auth-logo" aria-hidden="true"><Truck size={22} /></span>
          <div>
            <strong>DRIVEX</strong>
            <span>TRANSPORT MANAGEMENT</span>
          </div>
        </div>

        <div className="auth-brand-copy">
          <p className="auth-eyebrow">DISPECHER ISH MAYDONI</p>
          <h1>Reyslarni tartibli boshqaring.</h1>
          <p>Yuklar, haydovchilar va hujjatlar bitta xavfsiz ish maydonida.</p>
        </div>

        <div className="auth-security-note">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>Himoyalangan kompaniya hisobi</span>
        </div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-topbar">
          <span>DRIVEX TMS</span>
          <button
            type="button"
            onClick={toggleTheme}
            className="auth-theme-button"
            aria-label={theme === 'dark' ? 'Oq rejim' : 'Qora rejim'}
            title={theme === 'dark' ? 'Oq rejim' : 'Qora rejim'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        <div className="auth-form-wrap">
          <div className="auth-form-heading">
            <p className="auth-eyebrow">XUSH KELIBSIZ</p>
            <h2>Tizimga kirish</h2>
            <p>Ish maydoniga davom etish uchun hisob ma’lumotlaringizni kiriting.</p>
          </div>

          {(errorMsg || externalError) && (
            <div className="auth-error" role="alert">
              {errorMsg || externalError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="auth-field">
              <label htmlFor="auth-email">Elektron pochta</label>
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
              <label htmlFor="auth-password">Parol</label>
              <div className="auth-input-wrap">
                <Lock size={17} aria-hidden="true" />
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Parolingizni kiriting"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="auth-password-toggle"
                  aria-label={showPassword ? 'Parolni yashirish' : 'Parolni ko‘rsatish'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={submitting} className="auth-submit">
              <span>{submitting ? 'Tekshirilmoqda…' : 'Kirish'}</span>
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </form>

          <p className="auth-help">
            Kirish ma’lumotlari yo‘qmi? Kompaniya administratoriga murojaat qiling.
          </p>
        </div>

        <p className="auth-footer">© 2026 DRIVEX. Xavfsiz aloqa.</p>
      </section>
    </main>
  );
}
