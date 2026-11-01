import { createRoot } from 'react-dom/client';
import { setAppLocale } from '../../src/i18n/index.js';
import ImportedLoadPage from '../../src/components/ImportedLoadPage.jsx';
import '../../src/index.css';
import '../../src/workspace-design.css';
await setAppLocale('ru', { persist: false });
const requested = new URLSearchParams(location.search).get('type');
const type = ['bol', 'pod', 'invoice', 'driver_sheet', 'other', 'unknown'].includes(requested) ? requested : 'bol';
window.typeTestActions = [];
createRoot(document.getElementById('root')).render(<div className="workspace-shell flex"><div className="flex-1 flex flex-col min-w-0">
  <header className="workspace-header"><h1>Водители</h1><span>Импорт документа · тест</span></header>
  <main className="workspace-main min-h-0"><ImportedLoadPage load={{ source: 'document', fileName: 'document.pdf', importDocumentType: type,
    importError: 'Not a Rate Con' }} processing={false} enableMap={false}
    onBack={() => window.typeTestActions.push('back')} onRetry={() => window.typeTestActions.push('retry')}
    onConfirm={() => window.typeTestActions.push('assign')} /></main>
</div></div>);
