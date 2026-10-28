'use client';
import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {CheckCircle2, CircleAlert, CloudUpload, Download, FileSpreadsheet, Package, RefreshCw, ShieldCheck, Send, ShoppingBag, XCircle, LogOut} from 'lucide-react';
import {SITES, type Site} from '@/lib/sites';
import {normalize, validateImportRows, planAvailabilityUpdates, type Availability, type ImportSourceRow, type Product, type Status} from '@/lib/availability';
import {fetchJson} from '@/lib/client-http';
type ProductsResponse = {products:Product[];count:number;site:Site};
type AvailabilityResponse = Availability & {site:Site};
export default function Home(){
 const [selectedSiteId,setSelectedSiteId]=useState('');const [syncedSiteId,setSyncedSiteId]=useState<string|null>(null);
 const [products,setProducts]=useState<Product[]>([]);const [stock,setStock]=useState<Availability|null>(null);
 const [source,setSource]=useState<ImportSourceRow[]>([]);
 const [filename,setFilename]=useState('');const [loading,setLoading]=useState(false);const [submitting,setSubmitting]=useState(false);const [importing,setImporting]=useState(false);
 const [allowUnhide,setAllowUnhide]=useState(false);
 const [error,setError]=useState('');const [result,setResult]=useState('');const [confirm,setConfirm]=useState(false);const fileInput=useRef<HTMLInputElement>(null);
 const siteVersion=useRef(0);const importVersion=useRef(0);const selectedSiteIdRef=useRef('');
 const selectedSite=SITES.find(site=>site.id===selectedSiteId)??null;
 function changeSite(siteId:string){
  siteVersion.current+=1;importVersion.current+=1;selectedSiteIdRef.current=siteId;setSelectedSiteId(siteId);setSyncedSiteId(null);
  setProducts([]);setStock(null);setSource([]);setFilename('');setError('');setResult('');setConfirm(false);setLoading(false);setImporting(false);setAllowUnhide(false);
  if(fileInput.current)fileInput.current.value='';
 }
 const rows=useMemo(()=>validateImportRows(source,products,selectedSiteId).map(row=>syncedSiteId===selectedSiteId?row:{...row,error:'Sync products for the selected store first'}),[source,products,selectedSiteId,syncedSiteId]);
 const ready=rows.filter(x=>!x.error&&x.product&&x.status);
 const failures=rows.filter(x=>x.error);
 const plan=stock?planAvailabilityUpdates(ready.map(row=>({item_id:row.product!.id,status:row.status!})),stock,allowUnhide):null;
 const changed=plan?.changed||[];
 const comparisons=new Map(plan?.comparisons.map(row=>[row.item_id,row])||[]);
 const hiddenToRestore=plan?.comparisons.filter(row=>row.currentStatus==='hidden'&&row.status!=='hidden').length||0;
 async function sync(){
  if(loading||submitting||importing)return;
  if(!selectedSite){setError('Select a store before syncing products.');return;}
  const siteId=selectedSite.id;const version=siteVersion.current;setLoading(true);setError('');setResult('');setConfirm(false);setAllowUnhide(false);setProducts([]);setStock(null);setSyncedSiteId(null);
  try{
   const query=`?siteId=${encodeURIComponent(siteId)}`;
   const [p,a]=await Promise.all([fetchJson<ProductsResponse>(`/api/products${query}`),fetchJson<AvailabilityResponse>(`/api/availability${query}`)]);
   if(version!==siteVersion.current||selectedSiteIdRef.current!==siteId)return;
   if(p.site.id!==siteId||a.site.id!==siteId)throw new Error('Server returned data for a different store. Sync cancelled.');
   setProducts(p.products);setStock({unavailable_ids:a.unavailable_ids,hidden_ids:a.hidden_ids});setSyncedSiteId(siteId);
  }catch(e){if(version===siteVersion.current)setError(String(e instanceof Error?e.message:e));}
  finally{if(version===siteVersion.current)setLoading(false);}
 }
 async function loadFile(file:File){
  if(submitting||loading)return;
  if(!selectedSite||syncedSiteId!==selectedSite.id){setError('Select and sync the store this spreadsheet belongs to before importing.');return;}
  const siteId=selectedSite.id;const version=siteVersion.current;const upload=++importVersion.current;
  const isCurrent=()=>version===siteVersion.current&&upload===importVersion.current&&selectedSiteIdRef.current===siteId;
  setImporting(true);setSource([]);setError('');setResult('');setConfirm(false);setAllowUnhide(false);setFilename('');try{
  if(!/\.xlsx?$/i.test(file.name))throw new Error('Upload an .xlsx or .xls file');
  if(file.size>4*1024*1024)throw new Error('Excel file too large (maximum 4MB)');
  const form=new FormData();form.set('siteId',siteId);form.set('file',file);
  const imported=await fetchJson<{site:Site;products:Product[];source:ImportSourceRow[];availability:Availability}>('/api/import',{method:'POST',body:form});
  if(!isCurrent())return;
  if(imported.site.id!==siteId||imported.source.some(row=>row.siteId!==siteId))throw new Error('Import returned data for a different store. Import cancelled.');
  setProducts(imported.products);setStock(imported.availability);setSource(imported.source);setFilename(file.name);
 }catch(e){if(isCurrent()){setSource([]);setError(String(e instanceof Error?e.message:e));}}
 finally{if(isCurrent())setImporting(false);}}


function exportProductsExcel() {
  setError('');

  if (!selectedSite) {
    setError('Select a store before exporting.');
    return;
  }

  if (!products.length || stock === null || syncedSiteId !== selectedSite.id) {
    setError(
      'Please sync products for the selected store before exporting to Excel.'
    );
    return;
  }

  try {
    const unavailable = new Set(stock.unavailable_ids || []);
    const hidden = new Set(stock.hidden_ids || []);

    // Check for barcodes assigned to more than one product.
    const barcodeCount = new Map<string, number>();

    for (const product of products) {
      const codes = new Set(
        (product.barcodes || [])
          .map(code => String(code).trim())
          .filter(Boolean)
      );

      for (const code of codes) {
        barcodeCount.set(
          code,
          (barcodeCount.get(code) || 0) + 1
        );
      }
    }

    const exportRows: string[][] = [
      ['Site ID', 'Site Name', 'Barcode', 'Product Name', 'Status']
    ];

    const reviewRows: string[][] = [
      ['Site ID', 'Site Name', 'Barcode', 'Product Name', 'Status', 'Issue']
    ];

    const sortedProducts = [...products].sort(
      (a, b) => a.name.localeCompare(b.name)
    );

    for (const product of sortedProducts) {
      const status: Status = hidden.has(product.id)
        ? 'hidden'
        : unavailable.has(product.id)
          ? 'unavailable'
          : 'available';

      const codes = [...new Set(
        (product.barcodes || [])
          .map(code => String(code).trim())
          .filter(Boolean)
      )];

      if (codes.length === 0) {
        reviewRows.push([
          selectedSite.id,
          selectedSite.name,
          '',
          product.name,
          status,
          'No barcode found'
        ]);
        continue;
      }

      // The existing import uses only one barcode per
      // product. Prefer an unambiguous barcode.
      const uniqueCode = codes.find(
        code => barcodeCount.get(code) === 1
      );

      if (!uniqueCode) {
        reviewRows.push([
          selectedSite.id,
          selectedSite.name,
          codes.join(', '),
          product.name,
          status,
          'Duplicate barcode: multiple Deliveroo products'
        ]);
        continue;
      }

      exportRows.push([
        selectedSite.id,
        selectedSite.name,
        uniqueCode,
        product.name,
        status
      ]);
    }

    const workbook = XLSX.utils.book_new();

    const exportSheet = XLSX.utils.aoa_to_sheet(
      exportRows
    );

    exportSheet['!cols'] = [
      { wch: 14 },
      { wch: 38 },
      { wch: 22 },
      { wch: 65 },
      { wch: 18 }
    ];

    // Explicitly preserve barcode cells as strings.
    for (let i = 1; i < exportRows.length; i++) {
      const cell = XLSX.utils.encode_cell({
        r: i,
        c: 2
      });

      if (exportSheet[cell]) {
        exportSheet[cell].t = 's';
      }
    }

    XLSX.utils.book_append_sheet(
      workbook,
      exportSheet,
      'Availability'
    );

    // Products without a unique barcode are separated
    // because the existing importer cannot match them
    // safely.
    if (reviewRows.length > 1) {
      const reviewSheet = XLSX.utils.aoa_to_sheet(
        reviewRows
      );

      reviewSheet['!cols'] = [
        { wch: 14 },
        { wch: 38 },
        { wch: 26 },
        { wch: 65 },
        { wch: 18 },
        { wch: 52 }
      ];

      XLSX.utils.book_append_sheet(
        workbook,
        reviewSheet,
        'Needs Review'
      );
    }

    const today = new Date()
      .toISOString()
      .slice(0, 10);

    const storeSheet=XLSX.utils.aoa_to_sheet([['Site ID','Site Name'],[selectedSite.id,selectedSite.name]]);
    storeSheet['!cols']=[{wch:14},{wch:38}];
    XLSX.utils.book_append_sheet(workbook,storeSheet,'Store');

    XLSX.writeFile(workbook,`Deliveroo_Availability_${selectedSite.id}_${today}.xlsx`);

  } catch (e) {
    setError(
      e instanceof Error
        ? e.message
        : 'Failed to export product data.'
    );
  }
}


 function template(){
  if(!selectedSite){setError('Select a store before downloading its template.');return;}
  const wb=XLSX.utils.book_new();const sheet=XLSX.utils.aoa_to_sheet([['Site ID','Site Name','Barcode','Status'],[selectedSite.id,selectedSite.name,'','']]);
  sheet['!cols']=[{wch:14},{wch:38},{wch:22},{wch:18}];XLSX.utils.book_append_sheet(wb,sheet,'Availability');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Site ID','Site Name'],[selectedSite.id,selectedSite.name]]),'Store');
  XLSX.writeFile(wb,`Deliveroo_Availability_Template_${selectedSite.id}.xlsx`);
 }
 async function submit(){
  if(!confirm||!changed.length||failures.length||submitting||loading||importing)return;
  if(!selectedSite||syncedSiteId!==selectedSite.id){setError('Sync and review the selected store before submitting.');return;}
  const siteId=selectedSite.id;const version=siteVersion.current;
  const reviewedIds=new Set(changed.map(update=>update.item_id));
  const reviewed=ready.filter(row=>reviewedIds.has(row.product!.id));
  setSubmitting(true);setResult('');setError('');setConfirm(false);
  try{
   const query='?siteId='+encodeURIComponent(siteId);
   const fresh=await fetchJson<ProductsResponse>('/api/products'+query);
   if(fresh.site.id!==siteId||version!==siteVersion.current)throw new Error('Selected store changed or the server returned another store. Submit cancelled.');
   setProducts(fresh.products);
   const current=new Map<string,Product[]>();
   for(const product of fresh.products)for(const code of new Set([...product.barcodes,product.plu].map(normalize).filter(Boolean)))current.set(code,[...(current.get(code)||[]),product]);
   // Send only reviewed changes. The server rechecks live availability and may skip more.
   const updates=reviewed.map(row=>{
    const matches=current.get(row.barcode)||[];
    if(matches.length!==1||matches[0].id!==row.product?.id)throw new Error('Catalogue changed for barcode '+row.barcode+'. Please review and submit again.');
    return {item_id:matches[0].id,status:row.status!};
   });
   const response=await fetchJson<{success:boolean;submitted:number;unchanged:number;protected:number;verified:boolean|null;message:string;verificationError?:string|null;availability:Availability|null;site:Site}>('/api/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteId,sourceSiteId:source[0]?.siteId,updates,allowUnhide})});
   if(response.site.id!==siteId)throw new Error('Server confirmed a different store. Stop and verify configuration.');
   setResult(response.message+' Submitted: '+response.submitted+'; already matched: '+response.unchanged+'; kept hidden: '+response.protected+'. Store: '+selectedSite.name+' ('+siteId+').'+(response.verificationError?' '+response.verificationError:''));
   if(response.availability)setStock(response.availability);
   else{setStock(null);setSyncedSiteId(null);}
  }catch(error){setError(String(error instanceof Error?error.message:error));}
  finally{setSubmitting(false);}
 }
 async function logout(){
  try{await fetchJson('/api/auth/logout',{method:'POST'});window.location.replace('/login');}
  catch(error){setError(error instanceof Error?error.message:'Unable to sign out.');}
 }
 const unavailable=new Set(stock?.unavailable_ids||[]);const hidden=new Set(stock?.hidden_ids||[]);
 const canImport=!!selectedSite&&syncedSiteId===selectedSiteId&&!loading&&!submitting&&!importing;
 return <main className="shell">
  <header className="top"><div className="logo"><ShoppingBag size={23}/></div><div><strong>Deliveroo Retail</strong><span>Product Availability Manager</span></div><span className="environment">{SITES.length} SITES</span><button className="secondary logout" onClick={logout} disabled={submitting}><LogOut size={15}/> Sign Out</button></header>
  <section className="hero"><div><div className="eyebrow">EXCEL / DELIVEROO API</div><h1>Update product availability</h1><p>Select one store, sync its catalogue, then export or import a site-stamped Excel file. No database or uploaded files are stored.</p></div><div className="store"><span>ACTIVE STORE</span><strong>{selectedSite?.name||'No store selected'}</strong><small>{selectedSite?'Site ID: '+selectedSite.id:'Choose a store below to begin'}</small></div></section>
  <div className="stats"><div className="stat"><span>Total products</span><strong>{products.length||'-'}</strong></div><div className="stat"><span>Out of stock</span><strong>{stock?unavailable.size:'-'}</strong></div><div className="stat"><span>Hidden</span><strong>{stock?hidden.size:'-'}</strong></div><div className="stat"><span>Changes to send</span><strong>{changed.length}</strong></div></div>
  <section className="panel"><div className="panelhead"><div><h2>1. Sync Deliveroo products</h2><p>Load live product IDs, names, and barcodes before importing the spreadsheet.</p></div>
   <div className="sync-controls">
    <label htmlFor="site-select">Select Store</label>
    <select id="site-select" value={selectedSiteId} onChange={e=>changeSite(e.target.value)} disabled={submitting}>
     <option value="">Select a K-Secret store</option>{SITES.map(site=><option key={site.id} value={site.id}>{site.name} - {site.id}</option>)}
    </select>
    <small>{selectedSite?'Selected Site ID: '+selectedSite.id:'Choose a store before syncing'}</small>
    <div className="sync-buttons">
     <button className="secondary" onClick={sync} disabled={loading||submitting||importing||!selectedSite}><RefreshCw size={16}/>{loading?'Syncing...':'Sync Products'}</button>
     <button className="secondary" onClick={exportProductsExcel} disabled={loading||submitting||importing||!selectedSite||syncedSiteId!==selectedSite.id||!products.length||stock===null}><Download size={16}/> Export Products to Excel</button>
    </div>
   </div>
  </div>{products.length>0&&syncedSiteId===selectedSiteId&&<div className="notice good"><CheckCircle2 size={17}/> {products.length} products retrieved for {selectedSite?.name} ({selectedSiteId}). Barcode matching is ready.</div>}</section>
  <section className="panel"><div className="panelhead"><div><h2>2. Import availability Excel</h2><p>Required columns: <b>Site ID</b>, <b>Barcode</b> and <b>Status</b> (Available, Unavailable, Hidden). Every row must match the selected store.</p></div><button className="textbutton" onClick={template} disabled={!selectedSite||submitting}><Download size={16}/> Download site template</button></div>
   <input type="file" accept=".xlsx,.xls" ref={fileInput} hidden onChange={e=>{const f=e.target.files?.[0];if(f)void loadFile(f);e.currentTarget.value='';}}/>
   <button className="drop" disabled={!canImport} onClick={()=>fileInput.current?.click()}><FileSpreadsheet size={30}/><strong>{importing?'Validating spreadsheet...':filename||'Choose an Excel spreadsheet'}</strong><span>{!selectedSite?'Select a store first':syncedSiteId!==selectedSiteId?'Sync the selected store first':'For '+selectedSite.name+' - '+selectedSite.id} | XLSX or XLS | Max 4 MB</span><em><CloudUpload size={16}/> Select Excel File</em></button>
  </section>
  {source.length>0&&<section className="panel"><div className="panelhead"><div><h2>3. Review product updates</h2><p>{rows.length} rows | {ready.length} valid | {changed.length} changed | {plan?.unchanged||0} unchanged | {plan?.protected||0} hidden kept | {failures.length} invalid</p></div><span className={failures.length?'chip danger':'chip success'}>{failures.length?'Fix errors before submission':changed.length?'Review changes':'No changes to send'}</span></div><div className="tablewrap"><table><thead><tr><th>Excel row</th><th>Site ID</th><th>Barcode</th><th>Product</th><th>Current status</th><th>Excel status</th><th>Action</th></tr></thead><tbody>{rows.slice(0,200).map((r,i)=>{
   const comparison=r.product?comparisons.get(r.product.id):undefined;
   return <tr key={i}><td>{r.line}</td><td className="mono">{r.siteId}</td><td className="mono">{r.barcode||'-'}</td><td>{r.product?.name||'-'}</td>
    <td>{comparison?<span className={'chip '+(comparison.currentStatus==='available'?'success':comparison.currentStatus==='unavailable'?'danger':'neutral')}>{comparison.currentStatus}</span>:'-'}</td>
    <td><span className={'chip '+(r.status==='available'?'success':r.status==='unavailable'?'danger':'neutral')}>{r.status||'Invalid'}</span></td>
    <td>{r.error?<span className="invalid"><XCircle size={15}/>{r.error}</span>:<span className={'chip '+(comparison?.action==='changed'?'success':'neutral')}>{comparison?.action==='changed'?'Will update':comparison?.action==='protected'?'Keep hidden':'Unchanged - skipped'}</span>}</td></tr>;
  })}</tbody></table></div>{rows.length>200&&<p className="hint">Showing first 200 rows. All rows are validated; only changed products are submitted.</p>}{hiddenToRestore>0&&<div className="notice"><label className="confirm"><input type="checkbox" checked={allowUnhide} disabled={submitting||loading||importing} onChange={e=>{setAllowUnhide(e.target.checked);setConfirm(false);setResult('');}}/> Allow {hiddenToRestore} hidden product(s) to become visible using their Excel status. Otherwise they stay hidden.</label></div>}
  {!changed.length&&!failures.length&&stock&&<div className="notice good"><CheckCircle2 size={17}/> No changes to submit. Matching products are skipped and protected products stay hidden.</div>}
  <div className="actions"><label className="confirm"><input type="checkbox" checked={confirm} disabled={submitting||loading||importing} onChange={e=>setConfirm(e.target.checked)}/> I have reviewed {changed.length} change(s) for {selectedSite?.name} ({selectedSiteId}).</label><button className="primary" disabled={!confirm||!changed.length||!!failures.length||submitting||loading||importing||syncedSiteId!==selectedSiteId} onClick={submit}><Send size={17}/>{submitting?'Submitting...':'Submit '+changed.length+' updates'}</button></div></section>}
  {error&&<div role="alert" className="notice bad"><CircleAlert size={18}/>{error}</div>}{result&&<div role="status" className="notice good"><ShieldCheck size={18}/>{result}</div>}
  <footer><Package size={16}/> Availability statuses only. Exact quantities are reserved for future Inventory API integration. Nothing is saved to a local database.</footer>
 </main>;
}
