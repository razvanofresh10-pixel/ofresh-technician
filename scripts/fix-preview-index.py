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

# Remove any remaining serial-required validation paired with the exact blocking message.
# The technician may enter the serial after visiting the machine.
import re
s, serial_validation_count = re.subn(
    r'if\\s*\\((?P<condition>[^)]*(?:serie|Serie)[^)]*)\\)\\s*return\\s+msg\\(\\s*["\\\']Completeaza clientul, tipul aparatului si seria\\.["\\\']\\s*,\\s*false\\s*\\)\\s*;',
    'if(!clientNameValue||!tip)return msg("Completeaza clientul si tipul aparatului. Seria poate fi completata ulterior de tehnician.",false);',
    s
)
if serial_validation_count < 1:
    raise SystemExit("serial validation: expected at least one blocking validation to replace; refusing to publish.")

p.write_text(s, encoding="utf-8")
print("Repaired stock page template and mapped current plus legacy Supabase stock fields.")
