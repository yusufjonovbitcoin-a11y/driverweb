import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PDFDocument } from 'pdf-lib';
import '../../src/index.css';
import { setAppLocale } from '../../src/i18n/index.js';
import LoadDocumentsManager from '../../src/components/LoadDocumentsManager.jsx';
import { mutate } from './document-workspace.stub.js';

await setAppLocale('en');
window.fixtureActions = [];
const pdf = await PDFDocument.create();
pdf.addPage([300, 400]);
window.fixturePdf = URL.createObjectURL(new Blob([await pdf.save()], { type: 'application/pdf' }));
const documents = [
  { id: 'rateCon', title: 'Rate Con' }, { id: 'shipperBol', title: 'Shipper BOL' },
  { id: 'receiverPod', title: 'Receiver POD' }, { id: 'receipt', title: 'Payment receipt' },
];
const readOnly = new URLSearchParams(location.search).has('readOnly');
createRoot(document.getElementById('root')).render(<StrictMode><div style={{ height: '100dvh', padding: 16 }}>
  <LoadDocumentsManager variant="workspace" load={{ id: 'synthetic-load', loadNumber: 'TEST-42' }} documents={documents} active
    onOpenDocs={(load, type) => { window.fixtureOpened = load.documentMeta[type]; }} onManageDocument={readOnly ? null : mutate} />
</div></StrictMode>);
