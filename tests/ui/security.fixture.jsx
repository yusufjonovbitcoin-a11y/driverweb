import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {PDFDocument,StandardFonts} from 'pdf-lib';import PdfDocumentViewer from '../../src/components/PdfDocumentViewer';
import MfaPanel from '../../src/components/MfaPanel';import {setAppLocale} from '../../src/i18n/index';
import '../../src/index.css';import '../../src/workspace-design.css';
await setAppLocale('en',{persist:false});
const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage().drawText('Protected PDF content',{x:30,y:600,font});
const url=URL.createObjectURL(new Blob([await pdf.save()],{type:'application/pdf'}));
let verified=false,enrolling=false;
const client={auth:{refreshSession:async()=>({}),mfa:{listFactors:async()=>({data:{totp:verified?[{id:'synthetic',status:'verified'}]:[]}}),
enroll:async()=>{enrolling=true;return {data:{id:'synthetic',totp:{qr_code:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="black"/></svg>'),secret:'SYNTHETIC-TEST-KEY'}}};},
challengeAndVerify:async({code})=>{if(code!=='123456')return {error:Error('incorrect')};verified=true;return {};},unenroll:async()=>{verified=false;enrolling=false;return {};}}}};
export function Fixture(){const[open,setOpen]=useState(false);return <main><h1>Production security checks</h1><button onClick={()=>setOpen(true)}>Open protected PDF</button><MfaPanel client={client}/>{open&&<PdfDocumentViewer url={url} title="Protected PDF"/>}<output aria-label="Fixture setup">{String(enrolling)}</output></main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
