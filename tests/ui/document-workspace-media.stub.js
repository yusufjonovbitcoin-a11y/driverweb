export async function resolveTripDocumentSource() { return { mediaUrl: window.fixturePdf, mimeType: 'application/pdf', fileName: 'fixture.pdf' }; }
export async function fetchTripDocument() { const response = await fetch(window.fixturePdf); return { blob: await response.blob(), fileName: 'fixture.pdf', mimeType: 'application/pdf' }; }
export function saveDocumentBlob() {}
