import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const LOAD_DOCUMENT_SEQUENCE = Object.freeze([
  { id: 'rateCon', label: 'Rate Con' },
  { id: 'shipperBol', label: 'BOL' },
  { id: 'receiverPod', label: 'POD' },
  { id: 'receipt', label: 'Payment Receipt' },
]);

const HEADER_HEIGHT = 34;

export function documentSectionHeader(label, pageIndex, pageCount) {
  return `${label.toUpperCase()}  ·  ${pageIndex + 1}/${pageCount}`;
}

export function orderedLoadDocuments(load) {
  return LOAD_DOCUMENT_SEQUENCE
    .map(({ id, label }) => ({
      id,
      label,
      url: load.documents?.[id] || null,
      mimeType: load.documentMeta?.[id]?.mimeType || null,
      fileName: load.documentMeta?.[id]?.fileName || null,
    }))
    .filter((document) => document.url);
}

async function rasterizeImage(blob) {
  const bitmap = typeof createImageBitmap === 'function'
    ? await createImageBitmap(blob)
    : null;
  let width;
  let height;
  let draw;

  if (bitmap) {
    width = bitmap.width;
    height = bitmap.height;
    draw = (context) => context.drawImage(bitmap, 0, 0);
  } else {
    const objectUrl = URL.createObjectURL(blob);
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Image could not be decoded'));
      element.src = objectUrl;
    }).finally(() => URL.revokeObjectURL(objectUrl));
    width = image.naturalWidth;
    height = image.naturalHeight;
    draw = (context) => context.drawImage(image, 0, 0);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image canvas is unavailable');
  draw(context);
  bitmap?.close();

  const pngBlob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('Image conversion failed')),
      'image/png',
    );
  });
  return new Uint8Array(await pngBlob.arrayBuffer());
}

function drawSectionHeader(page, font, label, pageIndex, pageCount) {
  const { width, height } = page.getSize();
  page.drawRectangle({
    x: 0,
    y: height - HEADER_HEIGHT,
    width,
    height: HEADER_HEIGHT,
    color: rgb(0.95, 0.96, 0.97),
  });
  page.drawText(documentSectionHeader(label, pageIndex, pageCount), {
    x: 14,
    y: height - 22,
    size: 10,
    font,
    color: rgb(0.15, 0.18, 0.22),
  });
}

async function appendPdfSection(output, bytes, documentItem, font) {
  const sourceDocument = await PDFDocument.load(bytes);
  const pages = await output.embedPages(sourceDocument.getPages());
  pages.forEach((embeddedPage, index) => {
    const source = embeddedPage.size();
    const page = output.addPage([source.width, source.height]);
    const scale = Math.min(1, (source.height - HEADER_HEIGHT) / source.height);
    const width = source.width * scale;
    const height = source.height * scale;
    page.drawPage(embeddedPage, {
      x: (source.width - width) / 2,
      y: 0,
      width,
      height,
    });
    drawSectionHeader(page, font, documentItem.label, index, pages.length);
  });
}

async function appendImagePage(output, bytes, blob, mimeType, documentItem, font) {
  let image;
  if (/jpe?g/i.test(mimeType)) {
    image = await output.embedJpg(bytes);
  } else if (/png/i.test(mimeType)) {
    image = await output.embedPng(bytes);
  } else {
    image = await output.embedPng(await rasterizeImage(blob));
  }

  const landscape = image.width > image.height;
  const pageSize = landscape ? [792, 612] : [612, 792];
  const margin = 24;
  const scale = Math.min(
    (pageSize[0] - margin * 2) / image.width,
    (pageSize[1] - HEADER_HEIGHT - margin * 2) / image.height,
  );
  const width = image.width * scale;
  const height = image.height * scale;
  const page = output.addPage(pageSize);
  page.drawImage(image, {
    x: (pageSize[0] - width) / 2,
    y: (pageSize[1] - HEADER_HEIGHT - height) / 2,
    width,
    height,
  });
  drawSectionHeader(page, font, documentItem.label, 0, 1);
}

export async function mergeLoadDocumentsPdf(load, { fetchDocument = fetch } = {}) {
  const documents = orderedLoadDocuments(load);
  if (!documents.length) throw new Error('No load documents are available');

  const output = await PDFDocument.create();
  const headerFont = await output.embedFont(StandardFonts.HelveticaBold);
  for (const documentItem of documents) {
    const response = await fetchDocument(documentItem.url);
    if (!response.ok) {
      throw new Error(`${documentItem.label} could not be downloaded`);
    }
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mimeType = documentItem.mimeType || blob.type || response.headers.get('content-type') || '';

    if (/application\/pdf/i.test(mimeType) || /\.pdf(?:$|\?)/i.test(documentItem.url)) {
      await appendPdfSection(output, bytes, documentItem, headerFont);
    } else if (/^image\//i.test(mimeType)) {
      await appendImagePage(output, bytes, blob, mimeType, documentItem, headerFont);
    } else {
      throw new Error(`${documentItem.label} has an unsupported file type`);
    }
  }

  return {
    bytes: await output.save(),
    documentCount: documents.length,
    pageCount: output.getPageCount(),
  };
}

export function loadDocumentsPdfFileName(load) {
  const loadNumber = String(load.loadNumber || 'load').replace(/[^a-zA-Z0-9_-]+/g, '-');
  return `${loadNumber}-documents.pdf`;
}

export async function createLoadDocumentsPdfFile(load, options) {
  const result = await mergeLoadDocumentsPdf(load, options);
  return {
    ...result,
    file: new File([result.bytes], loadDocumentsPdfFileName(load), { type: 'application/pdf' }),
  };
}

export function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('File could not be prepared for dragging'));
    reader.readAsDataURL(file);
  });
}

export function setLoadDocumentsPdfDragData(dataTransfer, file, dragUrl) {
  dataTransfer.effectAllowed = 'copy';
  try {
    dataTransfer.items?.add?.(file);
  } catch {
    // Chromium can still expose the file through its native DownloadURL payload.
  }
  dataTransfer.setData('DownloadURL', `application/pdf:${file.name}:${dragUrl}`);
  dataTransfer.setData('text/uri-list', dragUrl);
}

export async function downloadLoadDocumentsPdf(load) {
  const result = await createLoadDocumentsPdfFile(load);
  const objectUrl = URL.createObjectURL(result.file);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = result.file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return result;
}
