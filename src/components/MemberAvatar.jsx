import { useEffect, useRef, useState } from 'react';
import './member-avatar.css';

const refreshAvatar = async member => {
  const { fetchWorkspaceAvatar } = await import('../services/operationsService.js');
  return fetchWorkspaceAvatar(member, { force: true });
};

export default function MemberAvatar({ member, className = '', alt = '', resolveAvatar = refreshAvatar }) {
  // Remount on identity/source changes so old failures and late responses never
  // hide a replacement image or publish into another member's view.
  const identity = JSON.stringify([member?.id, member?.avatarPath, member?.avatar]);
  return <AvatarImage key={identity} member={member} className={className} alt={alt} resolveAvatar={resolveAvatar} />;
}

function AvatarImage({ member, className, alt, resolveAvatar }) {
  const [source, setSource] = useState(member?.avatar || null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const attempted = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const initials = String(member?.name || '?').trim().split(/\s+/).filter(Boolean)
    .slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase() || '?';

  async function recover() {
    setFailed(true);
    setLoaded(false);
    if (attempted.current || !member?.id || !member.avatarPath) return;
    attempted.current = true;
    try {
      const fresh = await resolveAvatar(member);
      if (mounted.current && fresh && fresh !== source) {
        setSource(fresh);
        setFailed(false);
      }
    } catch { /* Keep initials; never loop requests for unavailable media. */ }
  }

  return <span className={`member-avatar ${className}`} aria-hidden={alt ? undefined : true}>
    <span className="member-avatar-initials" aria-hidden="true" style={{ visibility: loaded ? 'hidden' : undefined }}>{initials}</span>
    {source && !failed ? <img className="member-avatar-image" src={source} alt={alt}
      width="96" height="96" decoding="async" onLoad={() => setLoaded(true)} onError={recover} />
      : alt ? <span className="sr-only">{alt}</span> : null}
  </span>;
}
