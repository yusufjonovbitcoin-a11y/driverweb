import { useEffect, useLayoutEffect, useRef } from 'react';

const modalStack = [];

const selector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

export default function useModalFocus(dialogRef, { open = true, onClose, busy = false } = {}) {
  const latest = useRef({ onClose, busy });
  useLayoutEffect(() => { latest.current = { onClose, busy }; }, [onClose, busy]);
  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    const underlying = modalStack.at(-1);
    const entry = { dialog };
    modalStack.push(entry);
    const underlyingInert = underlying?.dialog.inert;
    if (underlying) underlying.dialog.inert = true;
    const isTop = () => modalStack.at(-1) === entry;
    const controls = () => [...dialog.querySelectorAll(selector)].filter(element => element.getClientRects().length && !element.closest('[inert]'));
    const focusFirst = () => (controls()[0] || dialog).focus();
    focusFirst();
    const keydown = event => {
      if (!isTop()) return;
      // Native confirmation dialogs own Escape and focus while they are open.
      if (dialog.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!latest.current.busy) latest.current.onClose?.();
      }
      if (event.key !== 'Tab') return;
      const elements = controls();
      const first = elements[0] || dialog;
      const last = elements.at(-1) || dialog;
      if (!elements.length || !dialog.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    const contain = event => { if (isTop() && !dialog.contains(event.target)) focusFirst(); };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', contain);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', contain);
      const wasTop = isTop();
      const index = modalStack.indexOf(entry);
      if (index >= 0) modalStack.splice(index, 1);
      if (underlying?.dialog.isConnected) underlying.dialog.inert = underlyingInert;
      if (wasTop && previous?.isConnected && !previous.closest('[inert]')) previous.focus();
    };
  }, [dialogRef, open]);
}
