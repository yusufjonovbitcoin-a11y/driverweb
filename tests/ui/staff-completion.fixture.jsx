import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setAppLocale } from '../../src/i18n/index.js';
import ImportReviewPanels from '../../src/components/ImportReviewPanels.jsx';
import StaffLoadCompletion from '../../src/components/StaffLoadCompletion.jsx';
import { buildImportedLoad } from '../../src/components/importedLoadModel.js';
import { completionEvidence } from '../../src/services/staffLoadCompletion.js';
import '../../src/index.css';
import '../../src/workspace-design.css';
import '../../src/components/import-review-tabs.css';
import '../../src/components/imported-load-page.css';
await setAppLocale('ru',{persist:false});
const mode=new URLSearchParams(location.search).get('mode');
window.completionRequests=[];
const sample={id:'load',currentAssignmentId:'assignment',driverId:'driver',version:1,databaseStatus:'assigned',loadNumber:'#107',internalNumber:'107',brokerLoadNumber:'#238750',
  rate:2850,weightLbs:80000,equipment:'Van',commodity:'General cargo',origin:{city:'Milwaukee',state:'WI',address:'8501 West Brown Deer Road'},destination:{city:'Mt Pleasant',state:'PA',address:'226 E View Drive'}};
const stops=[{id:'p1',type:'pickup',sequence:1},{id:'d1',type:'delivery',sequence:2}];
const bol={id:'bol',stop_id:'p1',document_type:'bol',current_version_id:'bol-version'};
const pod={id:'pod',stop_id:'d1',document_type:'pod',current_version_id:'pod-version'};
export function Fixture(){
  const [load,setLoad]=useState(sample);
  const [hasPod,setHasPod]=useState(mode!=='missing');
  const context={stops,documentItems:hasPod?[bol,pod]:[bol]};
  const evidence=completionEvidence(load,context);
  const complete=async(reviewed,request)=>{
    window.completionRequests.push({...request,assignmentId:reviewed.currentAssignmentId});
    if(mode==='deferred')await new Promise(resolve=>{window.finishCompletion=resolve;});
    if(mode==='retry'&&window.completionRequests.length===1)throw new Error('Offline');
    setLoad(current=>({...current,status:'COMPLETED',databaseStatus:'completed'}));
  };
  return <div className="workspace-shell flex"><div className="flex-1 flex flex-col min-w-0"><header className="workspace-header"><h1>Водители</h1><span>Синтетический тест</span></header>
    <main className="workspace-main min-h-0"><section className="import-load-page import-workspace">
      <ImportReviewPanels load={load} details={buildImportedLoad(load)} selectedDriver={{name:'Test Driver'}} keepMounted showRouteFacts={false}
        tabActions={mode==='readonly'?null:<StaffLoadCompletion load={load} evidence={evidence} onComplete={complete}/>}
        overviewContent={<p role="status">{load.databaseStatus==='completed'?'Рейс завершён':'Назначен · START не нажат'}</p>}
        documentsContent={()=> <div><p>BOL: сохранён · POD: {hasPod?'сохранён':'нет'}</p>{!hasPod&&<button onClick={()=>setHasPod(true)}>Сохранить POD</button>}</div>}/>
    </section></main></div></div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
