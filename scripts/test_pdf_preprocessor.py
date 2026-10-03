import hashlib
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
import urllib.error
import unittest
from unittest.mock import patch
import pymupdf
from pdf_preprocessor import preprocess


class PreprocessorTest(unittest.TestCase):
    def pdf(self, image=False, text=True):
        doc=pymupdf.open()
        page=doc.new_page()
        if text:
            page.insert_text((40,40),'Load TEST-42 Pickup 1 First Avenue Phoenix AZ')
            page.insert_text((330,40),'Delivery 2 Second Avenue Dallas TX')
        if image:
            scan=pymupdf.open()
            scanpage=scan.new_page(width=400,height=150)
            scanpage.insert_text((20,50),'Rate $1000 Weight 1800 LBS',fontsize=18)
            pix=scanpage.get_pixmap(matrix=pymupdf.Matrix(2,2))
            page.insert_image(pymupdf.Rect(40,100,440,250),stream=pix.tobytes('png'))
        return doc.tobytes()

    def test_text_coordinates_and_checksum(self):
        data=self.pdf(); source=json.loads(preprocess(data))
        self.assertEqual(source['checksum'],hashlib.sha256(data).hexdigest())
        self.assertFalse(source['pages'][0]['ocr'])
        blocks=source['pages'][0]['blocks']
        self.assertGreater(len(blocks),1)
        self.assertTrue(all(len(b['bbox'])==4 and b['words'] for b in blocks))
        self.assertEqual(source,json.loads(preprocess(data)))

    def test_mixed_page_attempts_ocr_even_with_text(self):
        with patch.object(pymupdf.Page,'get_textpage_ocr',side_effect=RuntimeError('missing OCR')) as ocr:
            with self.assertRaisesRegex(ValueError,'PDF_OCR_UNAVAILABLE'): preprocess(self.pdf(image=True))
            self.assertTrue(ocr.called)

    def test_invalid_and_encrypted(self):
        with self.assertRaisesRegex(ValueError,'PDF_SOURCE_INVALID'): preprocess(b'not a PDF')
        doc=pymupdf.open(); doc.new_page()
        locked=doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256,owner_pw='test',user_pw='test')
        with self.assertRaisesRegex(ValueError,'PDF_SOURCE_LOCKED'): preprocess(locked)

    def test_http_auth_and_real_subprocess(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
        token='test-only-'+('x'*40)
        proc=subprocess.Popen([sys.executable,os.path.join(os.path.dirname(__file__),'pdf_preprocessor.py'),'--serve'],
            env={**os.environ,'PDF_PREPROCESSOR_TOKEN':token,'PDF_PREPROCESSOR_PORT':str(port)},
            stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(50):
                try:
                    with socket.create_connection(('127.0.0.1',port),timeout=.1): break
                except OSError: time.sleep(.1)
            url=f'http://127.0.0.1:{port}/preprocess'
            data=self.pdf()
            request=urllib.request.Request(url,data=data,headers={'Content-Type':'application/pdf'})
            with self.assertRaises(urllib.error.HTTPError) as caught: urllib.request.urlopen(request,timeout=5)
            self.assertEqual(caught.exception.code,401)
            request.add_header('Authorization','Bearer '+token)
            health=urllib.request.Request(f'http://127.0.0.1:{port}/health')
            with self.assertRaises(urllib.error.HTTPError) as caught: urllib.request.urlopen(health,timeout=5)
            self.assertEqual(caught.exception.code,401)
            health.add_header('Authorization','Bearer '+token)
            with urllib.request.urlopen(health,timeout=5) as response:
                self.assertEqual(json.load(response)['service'],'drivex-pdf')
            with urllib.request.urlopen(request,timeout=10) as response:
                source=json.load(response)
                self.assertEqual(source['checksum'],hashlib.sha256(data).hexdigest())
                self.assertEqual(source['pageCount'],1)
        finally:
            proc.terminate(); proc.wait(timeout=5)

    @unittest.skipUnless(os.environ.get('TESSDATA_PREFIX'),'Set TESSDATA_PREFIX for real OCR tests')
    def test_real_mixed_and_scanned_ocr(self):
        for text in [True,False]:
            source=json.loads(preprocess(self.pdf(image=True,text=text)))
            self.assertTrue(source['pages'][0]['ocr'])
            words=' '.join(b['text'] for b in source['pages'][0]['blocks'])
            self.assertIn('1000',words)
            self.assertIn('1800',words)


if __name__=='__main__': unittest.main()
