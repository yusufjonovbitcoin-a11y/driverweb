import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { FreshDocumentViewer } from '../../src/components/DocumentViewerModal';
import { setAppLocale } from '../../src/i18n/index';
import '../../src/index.css';
import '../../src/workspace-design.css';

await setAppLocale('en', { persist: false });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
for (let index = 1; index <= 25; index++) pdf.addPage([500, 700]).drawText(`Synthetic PDF page ${index}`, { x: 40, y: 630, size: 16, font });
window.fixturePdfUrl = URL.createObjectURL(new Blob([await pdf.save()], { type: 'application/pdf' }));
const previewCanvas = document.createElement('canvas'); previewCanvas.width = 800; previewCanvas.height = 1120;
const previewContext = previewCanvas.getContext('2d'); previewContext.fillStyle = 'white'; previewContext.fillRect(0, 0, 800, 1120);
previewContext.fillStyle = 'black'; previewContext.font = '24px sans-serif'; previewContext.fillText('Readable first-page preview', 40, 80);
window.fixturePreviewUrl = URL.createObjectURL(await new Promise(resolve => previewCanvas.toBlob(resolve, 'image/jpeg', 0.7)));
window.fixtureSourceCalls = [];
window.fixtureSourcePending = false;
window.fixtureSourceDenied = false;
const fixtureDocument = { id: 'rateCon', versionId: 'version-test', fileName: 'synthetic.pdf', mimeType: 'application/pdf' };
export function Fixture() {
  const [open, setOpen] = useState(false);
  return <div className="workspace-shell" style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}><header className="workspace-header"><h1>PDF opening checks</h1><button onClick={() => setOpen(true)}>Open PDF</button><button onClick={() => setOpen(false)}>Close PDF</button><button onClick={() => { window.fixtureSourceDenied = true; }}>Revoke test permission</button></header><main style={{ minHeight: 0, flex: 1 }}>{open && <FreshDocumentViewer document={fixtureDocument} />}</main></div>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>);
