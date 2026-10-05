import { useRef, useState } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { localizedError } from '../i18n/errors';

export default function LoadTrashAction({ load, onTrashLoad }) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const submittedRef = useRef(false);
  const reviewedLoadRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!onTrashLoad || load.trashedAt) return null;
  const submit = async event => {
    event.preventDefault();
    if (submittedRef.current) return;
    submittedRef.current = true;
    setBusy(true);
    setError('');
    try {
      await onTrashLoad(reviewedLoadRef.current);
      dialogRef.current?.close();
    } catch (cause) {
      setError(localizedError(t, cause, 'loadTrash.moveError'));
    } finally {
      submittedRef.current = false;
      setBusy(false);
    }
  };
  return <>
    <button type="button" className="load-command-trash" onClick={() => { reviewedLoadRef.current = load; setError(''); dialogRef.current.showModal(); }}>
      <Trash2 size={16} aria-hidden="true" />{t('loadTrash.move')}
    </button>
    <dialog ref={dialogRef} className="load-trash-confirm" aria-labelledby="load-trash-confirm-title"
      onCancel={event => { if (submittedRef.current) event.preventDefault(); }}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
      <form onSubmit={submit} aria-busy={busy}>
        <h3 id="load-trash-confirm-title">{t('loadTrash.moveTitle', { number: load.loadNumber })}</h3>
        <p>{t('loadTrash.moveWarning')}</p>
        {error && <p role="alert" className="load-trash-error">{error}</p>}
        <div className="load-trash-confirm-actions">
          <button type="button" disabled={busy} onClick={() => dialogRef.current.close()}>{t('common.cancel')}</button>
          <button type="submit" disabled={busy} className="load-command-trash">
            {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}
            {t(busy ? 'loadTrash.moving' : 'loadTrash.move')}
          </button>
        </div>
      </form>
    </dialog>
  </>;
}
