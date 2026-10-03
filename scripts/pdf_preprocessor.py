"""Private PDF preprocessing worker. Never executes instructions inside documents.

CLI: python scripts/pdf_preprocessor.py < original.pdf > manifest.json
HTTP: PDF_PREPROCESSOR_TOKEN=... python scripts/pdf_preprocessor.py --serve
"""
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pymupdf

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 50
MAX_OUTPUT = 28 * 1024 * 1024


def preprocess(data):
    if not data.startswith(b"%PDF-") or len(data) > MAX_BYTES:
        raise ValueError("PDF_SOURCE_INVALID")
    pages = []
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        if doc.needs_pass or not 1 <= len(doc) <= MAX_PAGES:
            raise ValueError("PDF_SOURCE_LOCKED_OR_TOO_LARGE")
        for number, page in enumerate(doc, 1):
            if not 0 < page.rect.width <= 14400 or not 0 < page.rect.height <= 14400:
                raise ValueError("PDF_PAGE_SIZE_INVALID")
            textpage = page.get_textpage()
            text = page.get_text(textpage=textpage)
            # Mixed pages may contain a good text header and a scanned table.
            # Do not conclude that a nonempty text layer means OCR is unnecessary.
            images = page.get_image_info()
            large_image = any(pymupdf.Rect(i['bbox']).get_area() > page.rect.get_area() * .02 for i in images)
            poor_text = len(''.join(text.split())) < 30 or text.count('\ufffd') > max(2, len(text) * .01)
            vector_text = len(page.get_drawings()) > 500
            ocr = poor_text or large_image or vector_text
            if ocr:
                try:
                    textpage = page.get_textpage_ocr(language="eng", dpi=150, full=poor_text)
                except Exception as exc:
                    raise ValueError("PDF_OCR_UNAVAILABLE") from exc
            words = page.get_text("words", textpage=textpage, sort=False)
            groups = {}
            for x0, y0, x1, y1, word, block, line, order in words:
                groups.setdefault((block, line), []).append((order, word, [x0, y0, x1, y1]))
            blocks = []
            # Preserve explicit line/word geometry; do not merge two columns by Y.
            for (block, line), items in sorted(groups.items()):
                items.sort(key=lambda item: item[0])
                boxes = [item[2] for item in items]
                bbox = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
                blocks.append({"id": f"page_{number}_block_{block}_line_{line}",
                    "text": ' '.join(item[1] for item in items), "bbox": [round(v, 2) for v in bbox],
                    "words": [{"text": item[1], "bbox": [round(v, 2) for v in item[2]]} for item in items]})
            if not blocks:
                raise ValueError("PDF_PAGE_UNREADABLE")
            scale = min(1.8, 1800 / max(page.rect.width, page.rect.height))
            pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csRGB, alpha=False)
            pages.append({"number": number, "width": page.rect.width, "height": page.rect.height,
                "ocr": ocr, "blocks": blocks,
                "image": "data:image/jpeg;base64," + base64.b64encode(pix.tobytes("jpeg", jpg_quality=80)).decode()})
    manifest = {"version": 1, "checksum": hashlib.sha256(data).hexdigest(),
        "engine": "PyMuPDF-" + pymupdf.VersionBind, "pageCount": len(pages), "pages": pages}
    encoded = json.dumps(manifest, ensure_ascii=False, separators=(',', ':')).encode()
    if len(encoded) > MAX_OUTPUT:
        raise ValueError("PDF_PREPROCESS_OUTPUT_TOO_LARGE")
    return encoded


def serve():
    token = os.environ.get("PDF_PREPROCESSOR_TOKEN", "")
    if len(token) < 32:
        raise ValueError("PDF_PREPROCESSOR_TOKEN must have at least 32 characters")
    gate = threading.BoundedSemaphore(1)

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def authorized(self):
            return hmac.compare_digest(self.headers.get('Authorization', '').encode(), ('Bearer ' + token).encode())

        def log_message(self, *_args):
            pass  # Never log document content, headers or tokens.

        def reply(self, status, data):
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            self.connection.settimeout(15)
            if self.path != '/preprocess' or not self.authorized():
                return self.reply(401, b'{"error":"UNAUTHORIZED"}')
            try:
                size = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                size = 0
            if not 0 < size <= MAX_BYTES or self.headers.get('Content-Type') != 'application/pdf':
                return self.reply(413, b'{"error":"PDF_SOURCE_INVALID"}')
            if not gate.acquire(blocking=False):
                return self.reply(429, b'{"error":"PDF_WORKER_BUSY"}')
            try:
                data = self.rfile.read(size)
                if len(data) != size:
                    return self.reply(400, b'{"error":"PDF_SOURCE_INCOMPLETE"}')
                # One bounded subprocess per document: native parser crashes/timeouts
                # cannot leave a shared in-process document or other tenant's state.
                result = subprocess.run([sys.executable, __file__], input=data, capture_output=True, timeout=60)
                if result.returncode:
                    return self.reply(422, b'{"error":"PDF_PREPROCESS_FAILED"}')
                self.reply(200, result.stdout)
            except (subprocess.TimeoutExpired, TimeoutError):
                self.reply(504, b'{"error":"PDF_PREPROCESS_TIMEOUT"}')
            finally:
                gate.release()

        def do_GET(self):
            if self.path != '/health' or not self.authorized():
                return self.reply(401, b'{"error":"UNAUTHORIZED"}')
            self.reply(200, b'{"service":"drivex-pdf","version":1}')

    ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('PDF_PREPROCESSOR_PORT', '8788'))), Handler).serve_forever()


if __name__ == '__main__':
    if '--serve' in sys.argv:
        serve()
    else:
        try:
            # Per-job address-space / CPU limits (Unix worker).
            import resource
            resource.setrlimit(resource.RLIMIT_CPU, (55, 55))
            if sys.platform.startswith('linux'):
                resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
            sys.stdout.buffer.write(preprocess(sys.stdin.buffer.read(MAX_BYTES + 1)))
        except Exception as error:
            print(str(error) if str(error).startswith('PDF_') else 'PDF_PREPROCESS_FAILED', file=sys.stderr)
            sys.exit(1)
