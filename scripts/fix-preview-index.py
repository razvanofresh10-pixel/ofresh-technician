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

p.write_text(s, encoding="utf-8")
print("Repaired stock page template and mapped current plus legacy Supabase stock fields.")
