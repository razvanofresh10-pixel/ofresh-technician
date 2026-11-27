from pathlib import Path

p = Path("index.html")
s = p.read_text(encoding="utf-8")

def replace_once(old, new, label):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}; refusing to publish.")
    s = s.replace(old, new, 1)

# Repair the malformed template boundary that caused the page to fail to render.
replace_once(
    "</div>')}`</section><section class=\"panel\">",
    "</div>')}</section><section class=\"panel\">",
    "stockPage template boundary"
)

# Older imported stock rows keep their original values inside source_data.legacy_export_snapshot.
replace_once(
    'function stockCounty(r){const raw=String(r?.Locatie||r?.locatie||r?.Judet||r?.judet||"").trim();',
    'function stockCounty(r){const snap=r?.legacy_export_snapshot||{};const raw=String(r?.Locatie||r?.locatie||r?.Judet||r?.judet||snap.Locatie||snap.Judet||"").trim();',
    "stock county source fallback"
)
replace_once(
    'const product=String(s.Produs||s.produs||s.tip||"").trim();if(!product)return;',
    'const snap=s?.legacy_export_snapshot||{};const product=String(s.Produs||s.produs||s.tip||s.Denumire||s.denumire||snap.Produs||snap.Denumire||"").trim();if(!product)return;',
    "stock product source fallback"
)
replace_once(
    'g.Cantitate+=Number(s.Cantitate||s.cantitate||0)||0;',
    'g.Cantitate+=Number(s.Cantitate||s["Cantitate intrata"]||s.cantitate||s.cantitate_intrata||snap.Cantitate||snap["Cantitate intrata"]||0)||0;',
    "stock incoming quantity mapping"
)
replace_once(
    'g.Consum+=Number(s.Consum||s.consum||s.Consumat||s.consumat||0)||0;',
    'g.Consum+=Number(s.Consum||s.consum||s.Consumat||s.consumat||snap.Consum||snap.Consumat||0)||0;',
    "stock consumption mapping"
)
replace_once(
    'function stockAvailable(r){return Math.max(0,(Number(r.Cantitate||r.cantitate||0)||0)-(Number(r.Consum||r.consum||r.Consumat||r.consumat||0)||0))}',
    'function stockAvailable(r){const snap=r?.legacy_export_snapshot||{};const entered=Number(r.Cantitate||r["Cantitate intrata"]||r.cantitate||r.cantitate_intrata||snap.Cantitate||snap["Cantitate intrata"]||0)||0;const used=Number(r.Consum||r.consum||r.Consumat||r.consumat||snap.Consum||snap.Consumat||0)||0;return Math.max(0,entered-used)}',
    "stock available mapping"
)

# Render the legacy product name and entered quantity consistently in the table and editor.
s = s.replace(
    's.Produs||s.produs||s.tip||""',
    's.Produs||s.produs||s.tip||s.Denumire||s.denumire||s.legacy_export_snapshot?.Produs||s.legacy_export_snapshot?.Denumire||""'
)
s = s.replace(
    'Number(s.Cantitate||s.cantitate||0)',
    'Number(s.Cantitate||s["Cantitate intrata"]||s.cantitate||s.cantitate_intrata||s.legacy_export_snapshot?.Cantitate||s.legacy_export_snapshot?.["Cantitate intrata"]||0)'
)
s = s.replace(
    'r.Produs||r.produs||""',
    'r.Produs||r.produs||r.Denumire||r.denumire||r.legacy_export_snapshot?.Produs||r.legacy_export_snapshot?.Denumire||""'
)
s = s.replace(
    'r.Cantitate||0',
    'r.Cantitate||r["Cantitate intrata"]||r.cantitate||r.cantitate_intrata||r.legacy_export_snapshot?.Cantitate||r.legacy_export_snapshot?.["Cantitate intrata"]||0'
)


# Never restore stock rows from localStorage: stock is transactional data and must
# always be read from Supabase after opening the module.
replace_once(
    'db={Locatii:[],Clienti:[],Aparate:[],Interventii:[],Filtre:[],Stoc:[],Tehnicieni:[],...cached};',
    'db={Locatii:[],Clienti:[],Aparate:[],Interventii:[],Filtre:[],Stoc:[],Tehnicieni:[],...cached};db.Stoc=[];',
    "clear cached stock rows"
)
replace_once(
    'const missing=requested.filter(name=>!ofreshLoadedSheets.has(name) && !ofreshSheetLoadPromises.has(name));',
    'const missing=requested.filter(name=>(name==="Stoc" || !ofreshLoadedSheets.has(name)) && !ofreshSheetLoadPromises.has(name));',
    "always refresh stock from Supabase"
)
replace_once(
    'for(const name of savedSheets){',
    'for(const name of savedSheets){if(name==="Stoc")continue;',
    "do not mark cached stock as loaded"
)
replace_once(
    'const cacheableSheets=["Locatii","Clienti","Aparate","Filtre","Stoc","Tehnicieni"];',
    'const cacheableSheets=["Locatii","Clienti","Aparate","Filtre","Tehnicieni"];',
    "exclude stock from cache completeness"
)
replace_once(
    'const payload={Locatii:db.Locatii||[],Clienti:db.Clienti||[],Aparate:db.Aparate||[],Filtre:db.Filtre||[],Stoc:db.Stoc||[],Tehnicieni:db.Tehnicieni||[],',
    'const payload={Locatii:db.Locatii||[],Clienti:db.Clienti||[],Aparate:db.Aparate||[],Filtre:db.Filtre||[],Tehnicieni:db.Tehnicieni||[],',
    "do not persist stock rows"
)

# Sort both county picklists alphabetically using Romanian locale rules.
replace_once(
    'const OFRESH_COUNTIES=["Alba","Arad","Arges","Bacau","Bihor","Bistrita-Nasaud","Brasov","Braila","Botosani","Bucuresti","Buzau","Caras-Severin","Calarasi","Cluj","Constanta","Covasna","Dambovita","Dolj","Galati","Giurgiu","Gorj","Harghita","Hunedoara","Ialomita","Iasi","Ilfov","Maramures","Mehedinti","Mures","Neamt","Olt","Prahova","Salaj","Satu Mare","Sibiu","Suceava","Teleorman","Timis","Tulcea","Vaslui","Valcea","Vrancea"];',
    'const OFRESH_COUNTIES=["Alba","Arad","Arges","Bacau","Bihor","Bistrita-Nasaud","Brasov","Braila","Botosani","Bucuresti","Buzau","Caras-Severin","Calarasi","Cluj","Constanta","Covasna","Dambovita","Dolj","Galati","Giurgiu","Gorj","Harghita","Hunedoara","Ialomita","Iasi","Ilfov","Maramures","Mehedinti","Mures","Neamt","Olt","Prahova","Salaj","Satu Mare","Sibiu","Suceava","Teleorman","Timis","Tulcea","Vaslui","Valcea","Vrancea"].sort((a,b)=>a.localeCompare(b,"ro",{sensitivity:"base"}));',
    "sort global county dropdown"
)
replace_once(
    'const stockCounties=["Alba","Arad","Arges","Bacau","Bihor","Bistrita-Nasaud","Botosani","Brasov","Braila","Buzau","Caras-Severin","Calarasi","Cluj","Constanta","Covasna","Dambovita","Dolj","Galati","Giurgiu","Gorj","Harghita","Hunedoara","Ialomita","Iasi","Ilfov","Maramures","Mehedinti","Mures","Neamt","Olt","Prahova","Satu Mare","Salaj","Sibiu","Suceava","Teleorman","Timis","Tulcea","Vaslui","Valcea","Vrancea","Bucuresti"];',
    'const stockCounties=["Alba","Arad","Arges","Bacau","Bihor","Bistrita-Nasaud","Botosani","Brasov","Braila","Buzau","Caras-Severin","Calarasi","Cluj","Constanta","Covasna","Dambovita","Dolj","Galati","Giurgiu","Gorj","Harghita","Hunedoara","Ialomita","Iasi","Ilfov","Maramures","Mehedinti","Mures","Neamt","Olt","Prahova","Satu Mare","Salaj","Sibiu","Suceava","Teleorman","Timis","Tulcea","Vaslui","Valcea","Vrancea","Bucuresti"].sort((a,b)=>a.localeCompare(b,"ro",{sensitivity:"base"}));',
    "sort stock county dropdown"
)


# Save machine edits by immutable Supabase UUID, not optional OFRESH code/serial.
# Serial is allowed to remain blank until a technician visits the machine.
replace_once(
    'if(!clientNameValue||!tip||!serie)return msg("Completeaza clientul, tipul aparatului si seria.",false);',
    'if(!clientNameValue||!tip)return msg("Completeaza clientul si tipul aparatului. Seria poate fi completata ulterior de tehnician.",false);',
    "allow machine without serial"
)
replace_once(
    """  let idField="Cod OFRESH", idValue=cod;
  if(old){
    if(existing["Cod OFRESH"]){idField="Cod OFRESH";idValue=String(existing["Cod OFRESH"]);}
    else if(existing["Serie Aparat"]){idField="Serie Aparat";idValue=String(existing["Serie Aparat"]);}
    else {idField="Serie Aparat";idValue=serie;}
  }else{
    idField="Cod OFRESH"; idValue="";
  }""",
    """  // Existing machines are updated by their immutable Supabase UUID.
  let idField="ID Aparat", idValue=String(old||"");
  if(!old){idField="Cod OFRESH";idValue="";}""",
    "update machine by UUID"
)
replace_once(
    """  // Actualizare instant in interfata: nu asteptam reincarcarea tuturor datelor.
  const idx=(db.Aparate||[]).findIndex(x=>String(machineId(x)).trim()===String(old||"").trim());
  if(idx>=0) db.Aparate[idx]={...db.Aparate[idx],...rec};
  else db.Aparate.push(rec);
  saveCachedData();
  closeModal();
  msg(old?"Aparatul a fost actualizat.":"Aparatul a fost adaugat.");

  // Salvarea in Google Sheets ruleaza in fundal, fara delay pentru utilizator.
  try{
    await rawSave("Aparate",rec,idField,idValue);
  }catch(e){
    // Revenim la mesaj de eroare, dar pastram datele locale pentru a nu pierde munca utilizatorului.
    msg((e&&e.message)||"Nu am putut salva aparatul in Google Sheets.",false);
  }""",
    """  // Confirmam salvarea in Supabase inainte sa inchidem formularul.
  try{
    await rawSave("Aparate",rec,idField,idValue);
    closeModal();
    msg(old?"Aparatul a fost actualizat in Supabase.":"Aparatul a fost adaugat in Supabase.");
    await load();
  }catch(e){
    msg((e&&e.message)||"Nu am putut salva aparatul in Supabase. Datele nu au fost confirmate.",false);
    if(btn){btn.disabled=false;btn.textContent="Salveaza aparatul";}
  }""",
    "wait for confirmed machine save"
)

# Clear stale global search when switching modules.
replace_once(
    'async function go(p){\n  const navigationStarted=performance.now();\n  current=p;',
    'async function go(p){\n  const navigationStarted=performance.now();\n  const previousPage=current;\n  if(p!==previousPage) searchTerm="";\n  current=p;',
    "reset search when changing module"
)
# Always re-read module data from Supabase when administrator opens a module.
replace_once(
    '  if(adminSession && !commercialSession && p!=="dashboard"){\n    const required=adminSheetsForModule(p);',
    '  if(adminSession && !commercialSession && p!=="dashboard"){\n    const required=adminSheetsForModule(p);\n    required.forEach(name=>ofreshLoadedSheets.delete(name));',
    "force fresh Supabase read on module open"
)
# Refresh history and photo sheets too.
replace_once(
    '          : ["Interventii"];\n      const fastNames=required.filter(name=>!historyNames.includes(name));',
    '          : ["Interventii"];\n      historyNames.forEach(name=>ofreshLoadedSheets.delete(name));\n      const fastNames=required.filter(name=>!historyNames.includes(name));',
    "force fresh intervention and photo reads"
)
# Subscribe administrator to database changes so direct Supabase edits/deletes refresh the open module.
realtime = '''
let ofreshRealtimeChannel=null;
let ofreshRealtimeRefreshTimer=null;
function setupOfreshRealtimeSync(){
  if(ofreshRealtimeChannel){void ofreshSupabase.removeChannel(ofreshRealtimeChannel);ofreshRealtimeChannel=null;}
  if(!adminSession || commercialSession || techSession)return;
  const tableSheets={aparate:["Aparate"],locatii:["Locatii"],clienti:["Clienti"],interventii:["Interventii"],interventii_espressoare:["Interventii Espressoare"],filtre:["Filtre"],stoc:["Stoc"],tehnicieni:["Tehnicieni"],poze_interventii:["Poze Interventii"],poze_interventii_espressoare:["Poze Interventii Espressoare"]};
  let channel=ofreshSupabase.channel("ofresh-admin-live-sync");
  Object.entries(tableSheets).forEach(([table,sheets])=>{
    channel=channel.on("postgres_changes",{event:"*",schema:"public",table},()=>{
      sheets.forEach(name=>ofreshLoadedSheets.delete(name));
      if(ofreshRealtimeRefreshTimer)clearTimeout(ofreshRealtimeRefreshTimer);
      ofreshRealtimeRefreshTimer=setTimeout(()=>{
        ofreshRealtimeRefreshTimer=null;
        if(!adminSession || commercialSession || techSession)return;
        if(current==="dashboard")loadAdminDashboard(true);else void go(current);
      },300);
    });
  });
  ofreshRealtimeChannel=channel.subscribe();
}
'''
replace_once(
    'const ofreshLoadedSheets = new Set();',
    realtime + '\nconst ofreshLoadedSheets = new Set();',
    "add Supabase realtime refresh"
)
replace_once(
    'restoreCachedData(u);closeModal();enterAdminCleanMode();current="dashboard";render();',
    'restoreCachedData(u);setupOfreshRealtimeSync();closeModal();enterAdminCleanMode();current="dashboard";render();',
    "start realtime after admin login"
)
replace_once(
    '  adminSession=null;commercialSession=null;techSession=null;filerSession=null;',
    '  if(ofreshRealtimeChannel){void ofreshSupabase.removeChannel(ofreshRealtimeChannel);ofreshRealtimeChannel=null;}\n  if(ofreshRealtimeRefreshTimer){clearTimeout(ofreshRealtimeRefreshTimer);ofreshRealtimeRefreshTimer=null;}\n  adminSession=null;commercialSession=null;techSession=null;filerSession=null;',
    "stop realtime on logout"
)
# Activate 15-day filter replacement alerts and include filters missing a machine link.
replace_once(
    'function soonDate(d){if(!d)return false;const x=new Date(d);const now=new Date();const limit=new Date(Date.now()+30*86400000);return x<=limit}',
    'function soonDate(d){if(!d)return false;const x=new Date(d);const now=new Date();const limit=new Date(Date.now()+15*86400000);return x>=new Date(now.toDateString())&&x<=limit}',
    "15-day filter warning window"
)
replace_once(
    'const dueSoon=fl.filter(f=>{const d=f["Data urmatoarei schimbari"]||f.scadenta||f.urmatorSchimb;if(!d)return false;const x=new Date(d);return !isNaN(x)&&x>=new Date()&&x<=new Date(Date.now()+30*86400000)}).length;\n  const expired=fl.filter(f=>{const d=f["Data urmatoarei schimbari"]||f.scadenta||f.urmatorSchimb;if(!d)return false;const x=new Date(d);return !isNaN(x)&&x<new Date()}).length;',
    'const dueSoon=fl.filter(f=>{const d=f["Data urmatoarei schimbari"]||f.data_urmatoarei_schimbari||f.urmatoarea_schimbare||f.scadenta||f.urmatorSchimb;if(!d)return false;const x=new Date(d);const today=new Date();today.setHours(0,0,0,0);return !isNaN(x)&&x>=today&&x<=new Date(Date.now()+15*86400000)}).length;\n  const expired=fl.filter(f=>{const d=f["Data urmatoarei schimbari"]||f.data_urmatoarei_schimbari||f.urmatoarea_schimbare||f.scadenta||f.urmatorSchimb;if(!d)return false;const x=new Date(d);const today=new Date();today.setHours(0,0,0,0);return !isNaN(x)&&x<today}).length;\n  const unlinkedFilters=fl.filter(f=>!(f["ID Aparat"]||f.aparatId||f.aparat_id)).length;\n  const filterAlertCount=dueSoon+expired+unlinkedFilters;',
    "calculate filter alert count"
)
replace_once(
    """onclick="go('filtre')" title="Alerte filtre">🔔<b>${dueSoon+expired}</b>""",
    """onclick="go('filtre')" title="Alerte filtre">🔔<b>${filterAlertCount}</b>""",
    "show filter alerts on bell"
)
# Resolve filter client and location through the linked machine, not filter.ID Client (which is not a filter column).
replace_once(
    'const c=clientIndex.get(String(f["ID Locatie"]||f["ID Client"]||""));return `<tr><td>${esc(machineLabel(m||{})||f.Aparat||f.aparat||f["ID Aparat"]||f.aparatId||"")}</td><td>${esc(c?clientName(c):(f.Client||f.client||f.Locatie||f.locatie||""))}</td>',
    'const c=clientIndex.get(String(m?.["ID Client"]||m?.client_id||""));const client=machineClient(m||{})|| (c?clientName(c):"") || f.Client||f.client||"";return `<tr><td>${esc(machineLabel(m||{})||f.Aparat||f.aparat||f["ID Aparat"]||f.aparatId||"")}</td><td>${esc(client)}</td>',
    "show client name from linked machine on filter monitor"
)
# Replace separate filter and stock exports with one workbook containing two clearly named worksheets.
replace_once(
    """<button class="secondaryButton" onclick="exportSheet('Filtre','OFRESH_Filtre.xlsx')">Export Filtre</button><button class="secondaryButton" onclick="exportSheet('Stoc','OFRESH_Stoc.xlsx')">Export Stoc</button>""",
    '<button class="secondaryButton" onclick="exportFiltersAndStock()">Export Filtre + Stoc</button>',
    "combine filter and stock exports"
)
export_fn = '''
async function exportFiltersAndStock(){
 try{
  await excelReady();
  const names=["Filtre","Stoc","Aparate","Locatii","Clienti"];
  const response=await api({action:"readSheets",sheets:JSON.stringify(names)});
  if(!response||response.success!==true)throw new Error(response?.error||"Nu am putut incarca filtrele si stocul.");
  const machines=Array.isArray(response.Aparate)?response.Aparate:[];
  const locations=Array.isArray(response.Locatii)?response.Locatii:[];
  const clients=Array.isArray(response.Clienti)?response.Clienti:[];
  const machineById=new Map(machines.map(m=>[String(m["ID Aparat"]||m.id||""),m]));
  const locationById=new Map(locations.map(l=>[String(l["ID Locatie"]||l.id||""),l]));
  const clientById=new Map(clients.map(c=>[String(c["ID Client"]||c.id||""),c]));
  const filters=(response.Filtre||[]).map(f=>{
   const m=machineById.get(String(f["ID Aparat"]||f.aparat_id||""))||{};
   const loc=locationById.get(String(m["ID Locatie"]||m.locatie_id||f["ID Locatie"]||""))||{};
   const client=clientById.get(String(m["ID Client"]||m.client_id||loc["ID Client"]||loc.client_id||""))||{};
   return {
    "Client":m.Client||m.client_nume||loc.Client||client.Client||client.nume||f.Client||"",
    "Locatie":loc["Nume locatie"]||loc.nume||"",
    "Aparat":machineLabel(m)||f.Aparat||"",
    "Cod OFRESH":m["Cod OFRESH"]||m.cod_ofresh||"",
    "Serie aparat":m.Serie||m.serie||"",
    "Tip filtru":f["Tip filtru"]||f.tip_filtru||"",
    "Data montarii":f["Data montare"]||f["Data montarii"]||f.data_montare||f.data_montarii||"",
    "Data urmatoarei schimbari":f["Data urmatoarei schimbari"]||f.urmatoarea_schimbare||f.data_urmatoarei_schimbari||"",
    "Status":f.Status||f.status||""
   };
  });
  const stock=(response.Stoc||[]).map(r=>({
   "Tip filtru / produs":r.Denumire||r.denumire||r.Produs||r.produs||"",
   "Cod produs":r["Cod produs"]||r.cod_produs||"",
   "Judet / locatie":r.Locatie||r.locatie||r.Judet||r.judet||"",
   "Cantitate intrata":r["Cantitate intrata"]??r.cantitate_intrata??r.Cantitate??r.cantitate??0,
   "Consum":r.Consum??r.consum??0,
   "Stoc disponibil":r["Stoc actual"]??r.stoc_actual??Math.max(0,Number(r["Cantitate intrata"]??r.cantitate_intrata??r.Cantitate??r.cantitate??0)-Number(r.Consum??r.consum??0)),
   "Unitate":r.Unitate||r.unitate||"",
   "Furnizor":r.Furnizor||r.furnizor||"",
   "Factura":r.Factura||r.factura||"",
   "Data intrarii":r["Data intrare"]||r.data_intrare||"",
   "Observatii":r.Observatii||r.observatii||""
  }));
  const wb=XLSX.utils.book_new();
  const wsF=XLSX.utils.json_to_sheet(filters.length?filters:[{"Informatii":"Nu exista filtre inregistrate."}]);
  const wsS=XLSX.utils.json_to_sheet(stock.length?stock:[{"Informatii":"Nu exista pozitii de stoc inregistrate."}]);
  ofreshStyleWorksheetHeader(wsF);ofreshStyleWorksheetHeader(wsS);
  XLSX.utils.book_append_sheet(wb,wsF,"Monitorizare filtre");
  XLSX.utils.book_append_sheet(wb,wsS,"Stoc pe judete");
  XLSX.writeFile(wb,"OFRESH_Filtre_si_Stoc.xlsx");
  msg("Exportul Filtre + Stoc a fost generat intr-un singur fisier Excel, cu doua foi distincte.",true);
 }catch(e){msg(e?.message||"Nu am putut genera exportul Filtre + Stoc.",false);}
}
'''
replace_once(
    'async function reportsPage(){',
    export_fn + chr(10) + 'async function reportsPage(){',
    "add combined filter and stock export"
)

# Compress every technician/intervention photo client-side before upload.
# Keep enough detail for service evidence while targeting at most 75 KB per photo.
replace_once(
    'let max=640, quality=.55, data="";',
    'let max=960, quality=.46, data="";',
    "increase photo detail while lowering file-size target"
)
replace_once(
    'if(data.length<=150000)break;',
    'if(data.length<=75000)break;',
    "target 75 KB compressed photos"
)
replace_once(
    'if(quality>.24)quality-=.08;',
    'if(quality>.26)quality-=.05;',
    "adaptive JPEG quality for smaller photos"
)
replace_once(
    'else {max=Math.max(240,Math.round(max*.82));quality=.42;}',
    'else {max=Math.max(400,Math.round(max*.88));quality=.38;}',
    "reduce image dimensions only when needed"
)
replace_once(
    'if(!data||data.length>150000)return reject(new Error("Fotografia nu poate fi redusa suficient. Incearca o poza mai mica."));',
    'if(!data||data.length>75000)return reject(new Error("Fotografia nu poate fi comprimata suficient. Incearca sa refaci fotografia cu telefonul."));',
    "enforce compressed photo size limit"
)

p.write_text(s, encoding="utf-8")
print("Repaired stock page template and mapped current plus legacy Supabase stock fields.")
