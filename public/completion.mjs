const round=n=>Math.round((n+Number.EPSILON)*1000)/1000;
const calculated=(p,measurements)=>{const repeats=Math.max(0,...p.rows.map(r=>Math.ceil((measurements?measurements.reduce((n,m)=>n+m.rows.filter(x=>x.id===r.id).reduce((a,x)=>a+x.good+x.rejected,0),0):r.target)/r.yield))),base=Math.ceil(repeats*p.length*1000-1e-8)/1000;return {repeats,base,total:Math.ceil(base*1.05*1000-1e-8)/1000};};
export function completionSummary(jobs){
 const grades=jobs.map(j=>{
  const initial=calculated(j.plan,(j.measurements||[]).filter(m=>!m.reprintId));
  const reprints=(j.reprints||[]).map(r=>{const measurements=(j.measurements||[]).filter(m=>m.reprintId===r.id);return {...r,measurements,workedCalculation:calculated(j.plan,measurements),good:measurements.reduce((n,m)=>n+m.rows.reduce((s,row)=>s+row.good,0),0),rejected:measurements.reduce((n,m)=>n+m.rows.reduce((s,row)=>s+row.rejected,0),0),finishedAt:measurements.at(-1)?.createdAt||null};});
  const done=reprints.filter(r=>r.status==='done'&&r.measurements.length);
  const reprintCm=round(done.reduce((n,r)=>n+r.workedCalculation.total*100,0)),estimatedCm=round(initial.total*100+reprintCm);
  const reprintBaseCm=round(done.reduce((n,r)=>n+r.workedCalculation.base*100,0));
  const totalRepeats=initial.repeats+done.reduce((n,r)=>n+r.workedCalculation.repeats,0),calculatedCm=round(initial.base*100+done.reduce((n,r)=>n+r.workedCalculation.base*100,0));
  const record=j.printRecords?.at(-1);
  const currentRecord=record&&JSON.stringify(record.snapshot?.measurements)===JSON.stringify(j.measurements)&&JSON.stringify(record.snapshot?.plan)===JSON.stringify(j.plan);
  return {job:j,initial,initialCm:round(initial.total*100),totalRepeats,calculatedCm,reprintBaseCm,estimatedCm,reprintCm,reprints,doneCount:done.length,actualCm:currentRecord?record.totalCm:null,record,recordStale:Boolean(record&&!currentRecord)};
 });
 const recorded=grades.filter(g=>g.actualCm!==null);
 return {grades,reprintBaseCm:round(grades.reduce((n,g)=>n+g.reprintBaseCm,0)),calculatedCm:round(grades.reduce((n,g)=>n+g.calculatedCm,0)),totalRepeats:grades.reduce((n,g)=>n+g.totalRepeats,0),estimatedCm:round(grades.reduce((n,g)=>n+g.estimatedCm,0)),reprintCm:round(grades.reduce((n,g)=>n+g.reprintCm,0)),doneCount:grades.reduce((n,g)=>n+g.doneCount,0),actualCm:recorded.length===grades.length?round(recorded.reduce((n,g)=>n+g.actualCm,0)):null,recordedCount:recorded.length};
}
