// OFRESH V38 — Supabase migration adapter (preview; scoped intervention/photo writes)
// Includes V31 plus canonical-list pagination and role-scoped row filtering.
// Requires Supabase Edge Function secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// All authenticated actions require a real Supabase Auth access token.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS: Record<string,string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ofresh-role",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const TABLES: Record<string,string> = {
  Clienti:"clienti", Locatii:"locatii", Aparate:"aparate", Interventii:"interventii",
  Filtre:"filtre", Stoc:"stoc", Tehnicieni:"tehnicieni", Utilizatori:"utilizatori_aplicatie",
  InterventiiEspressoare:"interventii_espressoare", PozeInterventii:"poze_interventii",
  PozeInterventiiEspressoare:"poze_interventii_espressoare",
};
const READ_ROLES: Record<string,string[]> = {
  administrator:Object.keys(TABLES), admin:Object.keys(TABLES),
  comercial:["Clienti","Locatii","Aparate","Filtre","Interventii","PozeInterventii","InterventiiEspressoare","PozeInterventiiEspressoare"],
  filer:["Clienti","Locatii","Aparate","InterventiiEspressoare","PozeInterventiiEspressoare"],
  tehnician:["Clienti","Locatii","Aparate","Interventii","Filtre","PozeInterventii"],
};
const PAGE_SIZE = 800;
const PHOTO_BUCKET = "ofresh-interventii";
const PHOTO_CHUNK_MAX = 38000;
const PHOTO_MAX_BYTES = 1500000;
const norm = (v:unknown) => String(v ?? "").trim().toLocaleLowerCase("ro");
const arr = (v:unknown): string[] => Array.isArray(v) ? v.map(String) : [];
const source = (r:any) => r && typeof r.source_data === "object" && r.source_data ? r.source_data : {};
async function sha256(value:string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
}
function decodeBase64(value:string): Uint8Array {
  const clean=value.replace(/-/g,"+").replace(/_/g,"/").replace(/\s/g,"");
  const binary=atob(clean + "=".repeat((4-clean.length%4)%4));
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
function safeFileName(value:string) { return value.replace(/[^a-zA-Z0-9._-]+/g,"_").slice(0,120) || "service_espressor.jpg"; }

function legacy(sheet:string,r:any): any {
  const s=source(r), base={...s, id:r.id, "ID Sursa":r.source_id ?? s["ID Sursa"]};
  switch(sheet){
    case "Clienti": return {...base,"ID Client":r.id,Client:r.nume,"Nume client":r.nume,Adresa:r.adresa,Zona:r.zona,Oras:r.oras,Judet:r.judet,"Persoana contact":r.persoana_contact,Telefon:r.telefon,Email:r.email,Status:r.status};
    case "Locatii": return {...base,"ID Locatie":r.id,"Nume locatie":r.nume,Adresa:r.adresa,Oras:r.oras,Judet:r.judet,Zona:r.zona,Telefon:r.telefon ?? r.telefone,Email:r.email,Status:r.status,Client:r.nume_client,"ID Client":r.client_id,"GPS Latitudine":r.latitudine,"GPS Longitudine":r.longitudine,"GPS Precizie m":r.gps_precizie,"GPS Actualizat la":r.gps_actualizat_la,latitudine:r.latitudine,longitudine:r.longitudine};
    case "Aparate": return {...base,"ID Aparat":r.id,"Cod ID":r.cod_id,"ID Locatie":r.locatie_id,Locatie:r.locatie,Client:r.client_nume ?? r.locatie,Producator:r.producator,Model:r.model,Serie:r.serie,"Cod OFRESH":r.cod_ofresh,Status:r.status,Zona:r.zona,"Data instalare":r.data_instalarii,"Tip echipament":r.tip_echipament,"Tip aparat":r.tip_aparat,"Data retragere":r.data_retragere,Adresa:r.adresa,"Ultima interventie":r.ultima_interventie,"Urmatoarea interventie":r.urmatoarea_interventie,"QR Token":r.qr_token,"GPS Latitudine":r.gps_latitudine,"GPS Longitudine":r.gps_longitudine,"GPS Precizie m":r.gps_precizie_m,"GPS Actualizat la":r.gps_actualizat_la,gps_latitudine:r.gps_latitudine,gps_longitudine:r.gps_longitudine,gps_precizie_m:r.gps_precizie_m,gps_actualizat_la:r.gps_actualizat_la};
    case "Interventii": return {...base,"ID Interventie":r.id,"ID Aparat":r.aparat_id,Data:r.data_interventie,Tehnician:r.tehnician,Tip:r.tip,"Tip interventie":r.tip_interventie,Descriere:r.descriere,Operatiuni:r.operatiuni,Observatii:r.observatii,"ID Tehnician":r.tehnician_id,"Urmatoarea interventie":r.urmatoarea_interventie,"Filtru schimbat":r.filtru_schimbat,Igienizare:r.igienizare,Status:r.status,"ID Locatie":r.locatie_id,"ID Client":r.client_id,"Tip filtru":r.tip_filtru,"Fotografii":r.fotografii_count};
    case "Filtre": return {...base,"ID Filtru":r.id,"ID Aparat":r.aparat_id,"ID Locatie":r.locatie_id,"Tip filtru":r.tip_filtru,"Data montarii":r.data_montarii ?? r.data_montare,"Data schimbarii":r.data_schimbarii,"Urmatoarea schimbare":r.urmatoarea_schimbare ?? r.data_urmatoarei_schimbari,Status:r.status,Observatii:r.observatii};
    case "Stoc": return {...base,"ID Stoc":r.id,"Cod produs":r.cod_produs,Denumire:r.denumire,Categorie:r.categorie,Locatie:r.locatie,"Cantitate intrata":r.cantitate_intrata ?? r.cantitate,Consum:r.consum,"Stoc actual":r.stoc_actual, "Prag minim":r.prag_minim,Unitate:r.unitate,"Pret unitar":r.pret_unitar,"Data intrare":r.data_intrare,Observatii:r.observatii};
    case "Tehnicieni": return {...base,"ID Tehnician":r.id,"ID Utilizator":r.user_id||"",Nume:r.nume,Telefon:r.telefon,Email:r.email,Status:r.status,"Tip personal":r.tip_personal,Rol:r.tip_personal,Observatii:r.observatii};
    case "Utilizatori": return {...base,"ID Utilizator":r.id,Nume:r.nume,Telefon:r.telefon,Email:r.email,Rol:r.rol,Status:r.status,Drepturi:r.drepturi,"Orase acces":r.orase_acces,"Tip echipament acces":r.tip_echipament_acces,"Zone aparate acces":r.zone_aparate_acces};
    case "InterventiiEspressoare": return {...base,"ID Interventie":r.id,"Data interventie":r.data_interventie,Client:r.client,Adresa:r.adresa,Oras:r.oras,Judet:r.judet,"Cod OFRESH":r.cod_ofresh,"Serie aparat":r.serie_aparat,Producator:r.producator,"Tip aparat":r.tip_aparat,Operatiuni:r.operatiuni,Observatii:r.observatii,Igienizare:r.igienizare,Decalcifiere:r.decalcifiere,"Curatare capucinator":r.curatare_capucinator,"Spalat grup cafea":r.spalat_grup_cafea,"Spalat furtune lapte":r.spalat_furtune_lapte,"Spalat tavita reziduuri":r.spalat_tavita_reziduuri,"Predat marfa":r.predat_marfa,"Numar fotografii":r.numar_fotografii,"Zona aparate":r.zona_aparate,"Tip echipament":r.tip_echipament,Tehnician:r.tehnician,"ID Aparat":r.aparat_id,"ID Locatie":r.locatie_id};
    case "PozeInterventiiEspressoare": return {...base,"ID Poza":r.id,"ID Interventie":r.interventie_id,Filer:r.filer,Client:r.client,Aparat:r.aparat,Categorie:r.categorie,"Nr. poza":r.numar_poza,"Nume fisier":r.file_name,"URL poza":r.signed_url||r.file_url,"Data incarcare":r.data_incarcare,"MIME type":r.mime_type};
    case "PozeInterventii": return {...base,"ID Poza":r.id,"ID Interventie":r.interventie_id,Tehnician:r.tehnician,Client:r.client,Aparat:r.aparat,"Nume fisier":r.file_name,"URL poza":r.signed_url||r.file_url,"Data incarcare":r.data_incarcare};
    default: return base;
  }
}
async function allRows(sb:any, table:string, order="id") {
  const out:any[]=[];
  for(let from=0; ; from+=PAGE_SIZE){
    const {data,error}=await sb.from(table).select("*").order(order,{ascending:true}).range(from,from+PAGE_SIZE-1);
    if(error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data||[])); if(!data || data.length<PAGE_SIZE) break;
  }
  return out;
}
function startsEsp(value:unknown) { return /^esp(?:$|\s|[-_:./|])/.test(norm(value)); }
function equipmentMatches(allowed:string[], actual:unknown) {
  if(!allowed.length) return true;
  const value=norm(actual);
  return allowed.some(x=>x===value || (startsEsp(x)&&startsEsp(value)));
}
function machineIsActive(machine:any) {
  const status=norm(machine?.status), withdrawal=norm(machine?.data_retragere);
  return (status==="activ" || status==="active") && (!withdrawal || ["-","—","n/a","na","nu","0"].includes(withdrawal));
}
function filerAllows(profile:any, machine:any, loc:any) {
  const cities=arr(profile.orase_acces).map(norm), types=arr(profile.tip_echipament_acces), zones=arr(profile.zone_aparate_acces).map(norm);
  const city=norm(loc?.oras || machine?.source_data?.Oras || machine?.source_data?.oras);
  const type=machine.tip_echipament || machine.tip_aparat;
  const zone=norm(machine.zona);
  return machineIsActive(machine) && startsEsp(type) && !!zone && (!cities.length || cities.includes(city)) && equipmentMatches(types,type) && (!zones.length || zones.includes(zone));
}
async function validateCurrentEspressoVisitMachine(sb:any, visit:any, profile:any, isFiler:boolean) {
  if(!visit?.aparat_id) throw new Error("Interventia nu este asociata unui aparat valid.");
  const {data:machine,error}=await sb.from("aparate").select("*").eq("id",visit.aparat_id).maybeSingle();
  if(error || !machine) throw new Error("Aparatul interventiei nu mai exista.");
  if(!machineIsActive(machine) || !startsEsp(machine.tip_echipament || machine.tip_aparat)) {
    throw new Error("Aparatul nu mai este un espressor activ. Nu se mai pot incarca fotografii.");
  }
  const {data:location, error:locationError}=machine.locatie_id
    ? await sb.from("locatii").select("*").eq("id",machine.locatie_id).maybeSingle()
    : {data:null,error:null};
  if(locationError) throw locationError;
  if(isFiler && !filerAllows(profile,machine,location)) {
    throw new Error("Aparatul nu mai apartine ariei autorizate pentru acest cont Filer.");
  }
  return {machine,location};
}
async function main(req:Request) {
  if(req.method==="OPTIONS") return new Response("ok",{headers:CORS});
  const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) throw new Error("Configuratia serverului Supabase este incompleta.");
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const body=req.method==="GET"?Object.fromEntries(new URL(req.url).searchParams):await req.json().catch(()=>{throw new Error("Corpul cererii nu contine JSON valid.");});
  const action=String(body.action||"read");
  const previewReadActions=new Set(["publicMachine","whoami","read","bootstrap","readSheets","dashboardData","commercialData","commercialHistory","commercialEspressoHistory","technicianData","filerData","filerAccessOptions","findAparat","interventionExportData","list","add","technicianCompleteFilterChange","uploadPhotoChunk","finalizePhotoUpload"]);
  if(!previewReadActions.has(action)) return Response.json({success:false,error:"Acțiunea "+action+" nu este disponibilă în versiunea Preview numai-citire."},{status:403,headers:CORS});
  // QR/public lookup deliberately exposes only the same limited fields as the legacy publicMachine action.
  if(action==="publicMachine"){
    const lookup=String(body.id||"").trim();
    if(!lookup) return Response.json({success:false,error:"Lipseste identificatorul aparatului."},{status:400,headers:CORS});
    const fields="id,cod_ofresh,tip_aparat,producator,serie,client_nume,zona,qr_token";
    let machine:any=null, machineErr:any=null;
    for(const column of ["qr_token","cod_ofresh","serie"]){
      const result=await sb.from("aparate").select(fields).eq(column,lookup).limit(1).maybeSingle();
      if(result.error){machineErr=result.error;break;}
      if(result.data){machine=result.data;break;}
    }
    if(machineErr||!machine) return Response.json({success:false,error:"Aparatul nu a fost gasit."},{status:404,headers:CORS});
    const {data:filters,error:filterErr}=await sb.from("filtre").select("tip_filtru,data_montare,data_montarii,data_urmatoarei_schimbari,urmatoarea_schimbare,status").eq("aparat_id",machine.id);
    if(filterErr) throw filterErr;
    return Response.json({success:true,machine:{"Cod OFRESH":machine.cod_ofresh,"Tip aparat":machine.tip_aparat,"Producator":machine.producator,"Serie Aparat":machine.serie,Client:machine.client_nume,Zona:machine.zona},filters:(filters||[]).map((f:any)=>({"Tip filtru":f.tip_filtru,"Data montare":f.data_montare||f.data_montarii,"Data urmatoarei schimbari":f.data_urmatoarei_schimbari||f.urmatoarea_schimbare,Status:f.status}))},{headers:CORS});
  }
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token) return new Response(JSON.stringify({success:false,error:"Autentificare necesara."}),{status:401,headers:CORS});
  const {data:auth,error:authErr}=await sb.auth.getUser(token);
  if(authErr||!auth.user) return new Response(JSON.stringify({success:false,error:"Sesiune invalida."}),{status:401,headers:CORS});
  const {data:profile,error:profileErr}=await sb.from("profiluri").select("*").eq("id",auth.user.id).maybeSingle();
  if(profileErr||!profile||profile.activ===false) return new Response(JSON.stringify({success:false,error:"Profil OFRESH inactiv sau lipsa."}),{status:403,headers:CORS});
  const rights=profile.drepturi||{};
  const primaryRole=norm(profile.rol);
  const assignedRoles=new Set<string>([primaryRole]);
  if(Array.isArray(rights.roles)) for(const item of rights.roles) assignedRoles.add(norm(item));
  if(rights["Mod Tehnician"]===true || rights["mod tehnician"]===true) assignedRoles.add("tehnician");
  const role=norm(req.headers.get("x-ofresh-role")||primaryRole);
  if(!assignedRoles.has(role) || !Object.prototype.hasOwnProperty.call(READ_ROLES,role)) return new Response(JSON.stringify({success:false,error:"Rol OFRESH necunoscut sau neautorizat pentru acest cont."}),{status:403,headers:CORS});
  if(action==="whoami") return Response.json({success:true,user:{id:auth.user.id,email:auth.user.email},profile},{headers:CORS});
  const isAdmin = role === "administrator" || role === "admin";
  const isFiler = role === "filer";
  const isTech = role === "tehnician" || role === "technician";
  // `interventii.tehnician_id` is the UUID of `tehnicieni.id`, not the Auth UUID.
  // Never infer or auto-link a technician by name/phone.
  let technicianRecord:any=null;
  if(isTech){
    const {data:techRows,error:techErr}=await sb.from("tehnicieni").select("*").eq("user_id",auth.user.id).limit(2);
    if(techErr) throw techErr;
    if((techRows||[]).length>1) throw new Error("Contul este asociat mai multor inregistrari de tehnician. Solicita verificarea administratorului.");
    technicianRecord=(techRows||[])[0]||null;
  }
  const hasEspressoRight=rights["Service Espressoare"]===true || rights["service espressoare"]===true || (Array.isArray(rights)&&rights.some((x:any)=>norm(x)==="service espressoare"));
  const allowed=(READ_ROLES[role]||[]).filter(name=>!(role==="comercial" && ["InterventiiEspressoare","PozeInterventiiEspressoare"].includes(name) && !hasEspressoRight));
  const physicalRowsCache = new Map<string, any[]>();
  const fetchSheet=async(name:string)=>{
    if(!allowed.includes(name)) throw new Error(`Acces interzis la ${name}.`);
    if(role==="comercial" && ["InterventiiEspressoare","PozeInterventiiEspressoare"].includes(name) && !hasEspressoRight) throw new Error("Utilizatorul nu are dreptul Service Espressoare.");
    const table=TABLES[name]; if(!table) throw new Error(`Modul necunoscut: ${name}`);
    let rows=physicalRowsCache.get(table);
    if(!rows){ rows=await allRows(sb,table); physicalRowsCache.set(table,rows); }
    else rows=rows.slice();
    if(role==="filer" && name==="Aparate"){
      const locs=await allRows(sb,"locatii"); const byId=new Map(locs.map((x:any)=>[x.id,x]));
      rows=rows.filter((m:any)=>filerAllows(profile,m,byId.get(m.locatie_id)));
    }
    if(role==="filer" && name==="Locatii"){
      const machines=await allRows(sb,"aparate"), byLoc=new Map<string,any[]>();
      for(const m of machines){const a=byLoc.get(m.locatie_id)||[];a.push(m);byLoc.set(m.locatie_id,a);}
      rows=rows.filter((l:any)=>(byLoc.get(l.id)||[]).some((m:any)=>filerAllows(profile,m,l)));
    }
    if(role==="filer" && name==="InterventiiEspressoare"){
      const cities=arr(profile.orase_acces).map(norm), types=arr(profile.tip_echipament_acces).map(norm), zones=arr(profile.zone_aparate_acces).map(norm);
      rows=rows.filter((r:any)=>
        (!cities.length || cities.includes(norm(r.oras))) &&
        equipmentMatches(arr(profile.tip_echipament_acces),r.tip_echipament) &&
        (!zones.length || zones.includes(norm(r.zona_aparate)))
      );
    }
    if(role==="comercial" && name==="Aparate") rows=rows.filter((m:any)=>m.status!=="Retras");
    if(role==="filer" && name==="PozeInterventiiEspressoare") {
      const visits=await allRows(sb,"interventii_espressoare");
      const visible=new Set(visits.filter((v:any)=>String(v.technician_profile_id||"")===auth.user.id || ((!arr(profile.orase_acces).length || arr(profile.orase_acces).map(norm).includes(norm(v.oras))) && equipmentMatches(arr(profile.tip_echipament_acces),v.tip_echipament) && (!arr(profile.zone_aparate_acces).length || arr(profile.zone_aparate_acces).map(norm).includes(norm(v.zona_aparate))))).map((v:any)=>v.id));
      rows=rows.filter((r:any)=>visible.has(r.interventie_id));
    }
    if(name==="PozeInterventii" || name==="PozeInterventiiEspressoare") {
      rows=await Promise.all(rows.map(async(r:any)=>{
        if(!r.storage_path) return r;
        const {data,error}=await sb.storage.from(PHOTO_BUCKET).createSignedUrl(r.storage_path,3600);
        return {...r,signed_url:error?null:data?.signedUrl||null};
      }));
    }
    return rows.map((r:any)=>legacy(name,r));
  };
  if(action==="read" || action==="bootstrap"){
    const result:any={success:true,profile};
    const canonical:any={};
    for(const name of allowed){
      const rows=await fetchSheet(name);
      result[name]=rows;
      const physical=TABLES[name];
      if(!canonical[physical]) canonical[physical]=rows;
    }
    // Keep both contracts during migration: legacy V26 top-level sheet keys and
    // the canonical `{data:{...}}` envelope used by the first Supabase client.
    if(action==="bootstrap") result.data=canonical;
    return Response.json(result,{headers:CORS});
  }
  if(action==="readSheets"){
    let names:string[]=[]; try{names=JSON.parse(String(body.sheets||"[]"));}catch{}
    const result:any={success:true}; for(const n of names) result[n]=await fetchSheet(n); return Response.json(result,{headers:CORS});
  }
  if(action==="dashboardData"){
    const [machines,locations,filters,recentResult,countResult]=await Promise.all([
      fetchSheet("Aparate"),
      fetchSheet("Locatii"),
      allowed.includes("Filtre")?fetchSheet("Filtre"):Promise.resolve([]),
      allowed.includes("Interventii")
        ? sb.from("interventii").select("*").order("data_interventie",{ascending:false}).limit(6)
        : Promise.resolve({data:[],error:null}),
      allowed.includes("Interventii")
        ? sb.from("interventii").select("id",{count:"exact",head:true})
        : Promise.resolve({count:0,error:null})
    ]);
    if(recentResult.error) throw new Error("Interventii recente: "+recentResult.error.message);
    if(countResult.error) throw new Error("Total interventii: "+countResult.error.message);
    const recent=(recentResult.data||[]).map((r:any)=>legacy("Interventii",r));
    return Response.json({
      success:true,
      Aparate:machines,
      Locatii:locations,
      Filtre:filters,
      Interventii:recent,
      totals:{aparate:machines.length,locatii:locations.length,filtre:filters.length,interventii:countResult.count||0}
    },{headers:CORS});
  }
  if(action==="commercialData" || action==="commercialHistory" || action==="commercialEspressoHistory"){
    if(role!=="comercial" && role!=="administrator" && role!=="admin") return new Response(JSON.stringify({success:false,error:"Acces interzis."}),{status:403,headers:CORS});
    const data:any={};
    if(action==="commercialData") for(const n of ["Aparate","Filtre","Clienti","Locatii"]) data[n]=await fetchSheet(n);
    if(action==="commercialHistory") {
      data.Interventii=await fetchSheet("Interventii");
      const photos=await fetchSheet("PozeInterventii"), byVisit=new Map<string,string[]>();
      for(const photo of photos){const id=String(photo["ID Interventie"]||"");if(!id)continue;const urls=byVisit.get(id)||[];if(photo["URL poza"])urls.push(photo["URL poza"]);byVisit.set(id,urls);}
      data.Interventii=data.Interventii.map((r:any)=>({...r,Fotografii:(byVisit.get(String(r["ID Interventie"]||""))||[]).join("\n"),"Numar fotografii":(byVisit.get(String(r["ID Interventie"]||""))||[]).length}));
    }
    if(action==="commercialEspressoHistory"){
      if(!hasEspressoRight) return Response.json({success:false,error:"Utilizatorul nu are dreptul Service Espressoare."},{status:403,headers:CORS});
      data.InterventiiEspressoare=await fetchSheet("InterventiiEspressoare");
      const photos=await fetchSheet("PozeInterventiiEspressoare"), byVisit=new Map<string,string[]>();
      for(const photo of photos){const id=String(photo["ID Interventie"]||"");if(!id)continue;const urls=byVisit.get(id)||[];if(photo["URL poza"])urls.push(photo["URL poza"]);byVisit.set(id,urls);}
      data.InterventiiEspressoare=data.InterventiiEspressoare.map((r:any)=>({...r,Fotografii:(byVisit.get(String(r["ID Interventie"]||""))||[]).join("\n"),"Numar fotografii":(byVisit.get(String(r["ID Interventie"]||""))||[]).length}));
    }
    return Response.json({success:true,data},{headers:CORS});
  }
  if(action==="technicianData"){
    if(role!=="tehnician" && role!=="administrator" && role!=="admin") throw new Error("Acces interzis.");
    const data:any={Locatii:await fetchSheet("Locatii"),Aparate:await fetchSheet("Aparate"),Filtre:await fetchSheet("Filtre")};
    return Response.json({success:true,...data,technician:technicianRecord?legacy("Tehnicieni",technicianRecord):null},{headers:CORS});
  }
  if(action==="findAparat"){
    const code=String(body.codOfresh||"").trim();
    if(!code) throw new Error("Lipseste Cod OFRESH.");
    if(!allowed.includes("Aparate")) throw new Error("Acces interzis.");
    const {data:machine,error}=await sb.from("aparate").select("*").eq("cod_ofresh",code).maybeSingle();
    if(error) throw error;
    if(!machine) return Response.json({success:true,found:false,aparat:null},{headers:CORS});
    if(role==="comercial" && !machineIsActive(machine)) return Response.json({success:true,found:false,aparat:null},{headers:CORS});
    if(isFiler){
      const {data:loc,error:locErr}=machine.locatie_id?await sb.from("locatii").select("*").eq("id",machine.locatie_id).maybeSingle():{data:null,error:null};
      if(locErr) throw locErr;
      if(!filerAllows(profile,machine,loc)) return Response.json({success:true,found:false,aparat:null},{headers:CORS});
    }
    return Response.json({success:true,found:true,aparat:legacy("Aparate",machine)},{headers:CORS});
  }
  if(action==="interventionExportData"){
    if(!isAdmin) throw new Error("Exportul complet al interventiilor este rezervat administratorului.");
    const [interventions,photos]=await Promise.all([fetchSheet("Interventii"),fetchSheet("PozeInterventii")]);
    const byVisit=new Map<string,string[]>();
    for(const photo of photos){const id=String(photo["ID Interventie"]||"");if(!id)continue;const list=byVisit.get(id)||[];if(photo["URL poza"])list.push(photo["URL poza"]);byVisit.set(id,list);}
    return Response.json({success:true,data:{Interventii:interventions.map((r:any)=>({...r,Fotografii:(byVisit.get(String(r["ID Interventie"]||""))||[]).join("\n"),"Numar fotografii":(byVisit.get(String(r["ID Interventie"]||""))||[]).length}))}},{headers:CORS});
  }
  if(action==="filerData"){
    if(role!=="filer" && role!=="administrator" && role!=="admin") throw new Error("Acces interzis.");
    const machines=await fetchSheet("Aparate"), locations=await fetchSheet("Locatii");
    const locById=new Map(locations.map((l:any)=>[String(l.id),l]));
    const grouped=new Map<string,any>();
    for(const m of machines){
      const loc=locById.get(String(m["ID Locatie"]||""));
      const key=String(loc?.id||[m.Client,m.Adresa,m.Zona].map(norm).join("|"));
      if(!grouped.has(key)) grouped.set(key,{key,"ID Locatie":loc?.id||"",Client:loc?.Client||m.Client||"Client necompletat",Adresa:loc?.Adresa||m.Adresa||"",Oras:loc?.Oras||"",Judet:loc?.Judet||"",Zona:loc?.Zona||m.Zona||"",TipEchipament:m["Tip echipament"]||m["Tip aparat"]||"", "GPS Latitudine":loc?.latitudine||m["GPS Latitudine"]||null,"GPS Longitudine":loc?.longitudine||m["GPS Longitudine"]||null,machines:[]});
      const safe={"Tip Echipament":m["Tip echipament"],Producator:m.Producator,"Tip aparat":m["Tip aparat"],Model:m.Model,"Serie Aparat":m.Serie,"Cod OFRESH":m["Cod OFRESH"],Client:m.Client,Adresa:m.Adresa,Zona:m.Zona,Status:m.Status,"Data retragere":m["Data retragere"],"ID Aparat":m.id,"GPS Latitudine":m["GPS Latitudine"],"GPS Longitudine":m["GPS Longitudine"],"GPS Precizie m":m["GPS Precizie m"],"GPS Actualizat la":m["GPS Actualizat la"]};
      grouped.get(key).machines.push(safe);
    }
    const locationsOut=[...grouped.values()].sort((a:any,b:any)=>String(a.Client).localeCompare(String(b.Client),"ro"));
    return Response.json({success:true,user:{id:auth.user.id,nume:profile.nume,rol:profile.rol},allowedZones:profile.zone_aparate_acces||[],allowedEquipmentTypes:profile.tip_echipament_acces||[],locations:locationsOut,totalLocations:locationsOut.length,totalMachines:locationsOut.reduce((n:number,l:any)=>n+l.machines.length,0)},{headers:CORS});
  }
  if(action==="filerAccessOptions"){
    if(role!=="filer" && role!=="administrator" && role!=="admin") return new Response(JSON.stringify({success:false,error:"Acces interzis."}),{status:403,headers:CORS});
    const machines=await allRows(sb,"aparate");
    const activeEspresso=machines.filter((m:any)=>machineIsActive(m) && startsEsp(m.tip_echipament||m.tip_aparat));
    const types=new Map<string,string>(), zones=new Map<string,string>();
    for(const m of activeEspresso){
      const type=String(m.tip_echipament||m.tip_aparat||"").trim(), zone=String(m.zona||"").trim();
      if(type && !types.has(norm(type))) types.set(norm(type),type);
      if(zone && !zones.has(norm(zone))) zones.set(norm(zone),zone);
    }
    return Response.json({
      success:true,
      equipmentTypes:[...types.values()].sort((a:string,b:string)=>a.localeCompare(b,"ro",{sensitivity:"base"})),
      zones:[...zones.values()].sort((a:string,b:string)=>a.localeCompare(b,"ro",{sensitivity:"base"})),
      tipuri:[...types.values()].sort((a:string,b:string)=>a.localeCompare(b,"ro",{sensitivity:"base"})),
      zone:[...zones.values()].sort((a:string,b:string)=>a.localeCompare(b,"ro",{sensitivity:"base"}))
    },{headers:CORS});
  }
  // Scoped write operations. Clients must send UUIDs from the Supabase-backed read response,
  // never legacy spreadsheet row numbers.
  const machineById = async (id:string) => {
    if(!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("ID aparat invalid.");
    const {data,error}=await sb.from("aparate").select("*").eq("id",id).maybeSingle();
    if(error||!data) throw new Error("Aparatul nu a fost gasit.");
    if(data.status === "Retras" || (isFiler && !machineIsActive(data))) throw new Error("Aparatul este retras sau inactiv si nu poate fi modificat din aplicatia mobila.");
    const {data:loc}=data.locatie_id ? await sb.from("locatii").select("*").eq("id",data.locatie_id).maybeSingle() : {data:null};
    if(isFiler && !filerAllows(profile,data,loc)) throw new Error("Nu ai acces la acest aparat.");
    if(isFiler && !startsEsp(data.tip_echipament||data.tip_aparat)) throw new Error("Filerii pot modifica doar espressoarele autorizate.");
    if(!isAdmin && !isFiler && !isTech) throw new Error("Rol fara drept de modificare.");
    return {machine:data,location:loc};
  };
  if(action==="filerUpdateMachine" || action==="technicianUpdateMachine"){
    if(action==="filerUpdateMachine" && !isFiler && !isAdmin) throw new Error("Acces interzis.");
    if(action==="technicianUpdateMachine" && !isTech && !isAdmin) throw new Error("Acces interzis.");
    const id=String(body.machineId||"").trim(); const {machine}=await machineById(id);
    const code=String(body.codOfresh||"").trim(), serial=String(body.serie||"").trim();
    if(!code&&!serial) throw new Error("Completeaza Cod OFRESH sau seria.");
    if(code){const {data,error}=await sb.from("aparate").select("id").eq("cod_ofresh",code).neq("id",id).limit(1);if(error)throw error;if(data?.length)throw new Error("Cod OFRESH deja folosit de alt aparat.");}
    if(serial){const {data,error}=await sb.from("aparate").select("id").eq("serie",serial).neq("id",id).limit(1);if(error)throw error;if(data?.length)throw new Error("Seria este deja folosita de alt aparat.");}
    const patch:any={updated_at:new Date().toISOString()}; if(code)patch.cod_ofresh=code; if(serial)patch.serie=serial;
    const {data,error}=await sb.from("aparate").update(patch).eq("id",id).select("id,cod_ofresh,serie").single();
    if(error)throw error;
    return Response.json({success:true,machine:data},{headers:CORS});
  }
  if(action==="filerSaveVisit"){
    if(!isFiler && !isAdmin) throw new Error("Acces interzis.");
    const id=String(body.machineId||"").trim(); const {machine,location}=await machineById(id);
    const tasks=typeof body.tasks==="string"?JSON.parse(body.tasks):body.tasks;
    if(!Array.isArray(tasks)||!tasks.length) throw new Error("Selecteaza cel putin o operatiune.");
    const allowedTasks=new Set(["Igienizare","Decalcifiere","Curatare capucinator","Spalat grup cafea","Spalat furtune lapte","Spalat tavita reziduuri","Predat marfa"]);
    const cleanTasks=tasks.map(String).filter((x:string)=>allowedTasks.has(x));
    if(cleanTasks.length!==tasks.length) throw new Error("Lista operatiunilor contine valori nepermise.");
    const flags={igienizare:cleanTasks.includes("Igienizare"),decalcifiere:cleanTasks.includes("Decalcifiere"),curatare_capucinator:cleanTasks.includes("Curatare capucinator"),spalat_grup_cafea:cleanTasks.includes("Spalat grup cafea"),spalat_furtune_lapte:cleanTasks.includes("Spalat furtune lapte"),spalat_tavita_reziduuri:cleanTasks.includes("Spalat tavita reziduuri"),predat_marfa:cleanTasks.includes("Predat marfa")};
    const photoToken=crypto.randomUUID();
    const expectedPhotoCount=Number(body.photoCount??0);
    if(!Number.isInteger(expectedPhotoCount)||expectedPhotoCount<0||expectedPhotoCount>5) throw new Error("Sunt permise maximum 5 fotografii per interventie.");
    const payload:any={technician_profile_id:auth.user.id,source_data:{photo_upload_token_hash:await sha256(photoToken),photo_owner_auth_id:auth.user.id,photo_upload_expires_at:new Date(Date.now()+3600_000).toISOString(),expected_photo_count:expectedPhotoCount},data_interventie:body.data?new Date(String(body.data)+"T12:00:00").toISOString():new Date().toISOString(),client:machine.client_nume||location?.nume_client||location?.nume||"",adresa:machine.adresa||location?.adresa||"",oras:location?.oras||"",judet:location?.judet||"",cod_ofresh:machine.cod_ofresh,serie_aparat:machine.serie,producator:machine.producator,tip_aparat:machine.tip_aparat||machine.model,operatiuni:cleanTasks,observatii:String(body.observatii||""),...flags,numar_fotografii:0,zona_aparate:machine.zona,tip_echipament:machine.tip_echipament,aparat_id:machine.id,client_id:location?.client_id||null,locatie_id:machine.locatie_id};
    const {data,error}=await sb.from("interventii_espressoare").insert(payload).select("id").single();
    if(error)throw error;
    return Response.json({success:true,visitId:data.id,photoToken,expectedPhotoCount},{headers:CORS});
  }
  if(action==="filerUploadPhotoChunk"){
    if(!isFiler && !isAdmin) throw new Error("Acces interzis.");
    const visitId=String(body.visitId||"").trim(), tokenValue=String(body.photoToken||"").trim();
    const uploadId=String(body.uploadId||"").trim(), chunk=String(body.chunk||"");
    const chunkIndex=Number(body.chunkIndex), totalChunks=Number(body.totalChunks), photoIndex=Number(body.photoIndex);
    if(!visitId||!tokenValue||!uploadId) throw new Error("Lipseste autorizarea sau identificatorul fotografiei.");
    if(!Number.isInteger(totalChunks)||totalChunks<1||totalChunks>100||!Number.isInteger(chunkIndex)||chunkIndex<0||chunkIndex>=totalChunks) throw new Error("Date de fragment foto invalide.");
    if(!Number.isInteger(photoIndex)||photoIndex<1||photoIndex>5||!chunk||chunk.length>PHOTO_CHUNK_MAX) throw new Error("Fragment foto invalid sau prea mare.");
    const {data:visit,error:visitErr}=await sb.from("interventii_espressoare").select("id,technician_profile_id,source_data,numar_fotografii").eq("id",visitId).maybeSingle();
    if(visitErr||!visit) throw new Error("Interventia nu a fost gasita.");
    const meta=source(visit);
    if(String(visit.technician_profile_id||"")!==auth.user.id || String(meta.photo_owner_auth_id||"")!==auth.user.id || meta.photo_upload_token_hash!==await sha256(tokenValue) || !meta.photo_upload_expires_at || Date.now()>Date.parse(meta.photo_upload_expires_at)) throw new Error("Autorizarea fotografiilor este invalida sau expirata.");
    await validateCurrentEspressoVisitMachine(sb,visit,profile,isFiler);
    if(photoIndex>Number(meta.expected_photo_count||0)) throw new Error("Numarul fotografiei depaseste selectia salvata.");
    const path=`tmp/${visitId}/${uploadId}/${chunkIndex}.b64`;
    const {error:uploadErr}=await sb.storage.from(PHOTO_BUCKET).upload(path,new TextEncoder().encode(chunk),{contentType:"image/jpeg",upsert:true});
    if(uploadErr) throw new Error("Nu am putut salva fragmentul foto: "+uploadErr.message);
    const {error:updateErr}=await sb.from("interventii_espressoare").update({source_data:{...meta,photo_upload_token_hash:meta.photo_upload_token_hash,photo_owner_auth_id:auth.user.id,expected_photo_count:meta.expected_photo_count,photo_uploads:{...(meta.photo_uploads||{}),[uploadId]:{totalChunks,photoIndex}}}}).eq("id",visitId);
    if(updateErr) throw updateErr;
    return Response.json({success:true,chunkIndex,totalChunks},{headers:CORS});
  }
  if(action==="filerFinalizePhotoUpload" || action==="filerFinalizePhotoUploads"){
    if(!isFiler && !isAdmin) throw new Error("Acces interzis.");
    const visitId=String(body.visitId||"").trim(), tokenValue=String(body.photoToken||"").trim();
    const {data:visit,error:visitErr}=await sb.from("interventii_espressoare").select("*").eq("id",visitId).maybeSingle();
    if(visitErr||!visit) throw new Error("Interventia nu a fost gasita.");
    const meta=source(visit);
    if(String(visit.technician_profile_id||"")!==auth.user.id || String(meta.photo_owner_auth_id||"")!==auth.user.id || meta.photo_upload_token_hash!==await sha256(tokenValue) || !meta.photo_upload_expires_at || Date.now()>Date.parse(meta.photo_upload_expires_at)) throw new Error("Autorizarea fotografiilor este invalida sau expirata.");
    await validateCurrentEspressoVisitMachine(sb,visit,profile,isFiler);
    let uploads:any[]=[];
    if(action==="filerFinalizePhotoUploads") { try { uploads=typeof body.photos==="string"?JSON.parse(body.photos):body.photos; } catch { throw new Error("Lista fotografiilor este invalida."); } }
    else uploads=[body];
    if(!Array.isArray(uploads)||!uploads.length||uploads.length>5) throw new Error("Alege intre 1 si 5 fotografii.");
    const {data:existing,error:existingErr}=await sb.from("poze_interventii_espressoare").select("id,numar_poza,categorie").eq("interventie_id",visitId);
    if(existingErr) throw existingErr;
    if((existing||[]).length+uploads.length>5) throw new Error("Sunt permise maximum 5 fotografii per interventie.");
    const existingIndexes=new Set((existing||[]).map((x:any)=>Number(x.numar_poza)));
    const seen=new Set<number>(); let aviz=(existing||[]).filter((x:any)=>norm(x.categorie).includes("aviz")).length,after=(existing||[]).filter((x:any)=>norm(x.categorie).includes("aparat dupa curatare")).length; const saved:any[]=[];
    for(const item of uploads){
      const uploadId=String(item.uploadId||"").trim(), totalChunks=Number(item.totalChunks), photoIndex=Number(item.photoIndex);
      if(!uploadId||!Number.isInteger(totalChunks)||totalChunks<1||totalChunks>100||!Number.isInteger(photoIndex)||photoIndex<1||photoIndex>5||photoIndex>Number(meta.expected_photo_count||0)||seen.has(photoIndex)||existingIndexes.has(photoIndex)) throw new Error("Date foto invalide sau duplicate.");
      const declared=meta.photo_uploads?.[uploadId];
      if(!declared||Number(declared.totalChunks)!==totalChunks||Number(declared.photoIndex)!==photoIndex) throw new Error("Fragmentul foto nu corespunde incarcarii autorizate.");
      seen.add(photoIndex);
      const category=String(item.category||"Aparat dupa curatare"), cat=norm(category);
      if(cat.includes("aviz")) aviz++; else if(cat.includes("aparat dupa curatare")) after++; else throw new Error("Categoria fotografiei este invalida.");
      if(aviz>1||after>4) throw new Error("Limita este 1 aviz si maximum 4 fotografii dupa curatare.");
      let base64="";
      for(let i=0;i<totalChunks;i++){
        const chunkPath=`tmp/${visitId}/${uploadId}/${i}.b64`;
        const {data:blob,error:downloadErr}=await sb.storage.from(PHOTO_BUCKET).download(chunkPath);
        if(downloadErr||!blob) throw new Error(`Lipseste fragmentul foto ${i+1} din ${totalChunks}.`);
        base64+=await blob.text();
      }
      const bytes=decodeBase64(base64); if(bytes.byteLength>PHOTO_MAX_BYTES) throw new Error("Fotografia depaseste limita de 1.5 MB.");
      const mimeType=String(item.mimeType||"image/jpeg").split(";")[0];
      if(!["image/jpeg","image/png","image/webp"].includes(mimeType)) throw new Error("Format foto neacceptat.");
      const fileName=safeFileName(item.fileName||"service_espressor.jpg"), objectPath=`espresso/${visitId}/${String(photoIndex).padStart(2,"0")}_${crypto.randomUUID()}_${fileName}`;
      const {error:finalUploadErr}=await sb.storage.from(PHOTO_BUCKET).upload(objectPath,bytes,{contentType:mimeType,upsert:false});
      if(finalUploadErr) throw new Error("Nu am putut salva fotografia finala: "+finalUploadErr.message);
      const row={interventie_id:visitId,source_id:null,filer:profile.nume||auth.user.email||"",client:visit.client||"",aparat:[visit.tip_aparat,visit.serie_aparat].filter(Boolean).join(" - "),categorie:category,storage_path:objectPath,file_name:fileName,file_url:null,numar_poza:photoIndex,mime_type:mimeType,file_size_bytes:bytes.byteLength,taken_at:item.takenAt||null,data_incarcare:new Date().toISOString(),source_data:{storage_bucket:PHOTO_BUCKET,uploaded_by:auth.user.id}};
      const {data:photo,error:photoErr}=await sb.from("poze_interventii_espressoare").insert(row).select("*").single();
      if(photoErr){await sb.storage.from(PHOTO_BUCKET).remove([objectPath]);throw photoErr;}
      saved.push(photo);
      const tempPaths=Array.from({length:totalChunks},(_,i)=>`tmp/${visitId}/${uploadId}/${i}.b64`);
      await sb.storage.from(PHOTO_BUCKET).remove(tempPaths);
    }
    const total=(existing||[]).length+saved.length;
    const {error:countErr}=await sb.from("interventii_espressoare").update({numar_fotografii:total}).eq("id",visitId);
    if(countErr) throw countErr;
    const newSource={...meta,photo_upload_token_hash:null,photo_upload_expires_at:null,photo_uploads:{}};
    const {error:metaErr}=await sb.from("interventii_espressoare").update({source_data:newSource}).eq("id",visitId);
    if(metaErr) throw metaErr;
    return Response.json({success:true,photos:saved,uploaded:saved.length},{headers:CORS});
  }
  if(action==="filerUpdateLocation"){
    if(!isFiler && !isAdmin) throw new Error("Acces interzis.");
    const locationId=String(body.locationId||"").trim(), address=String(body.adresa||"").trim();
    if(!locationId||!/^[0-9a-f-]{36}$/i.test(locationId)||!address) throw new Error("ID locatie sau adresa invalida.");
    const {data:loc,error:locErr}=await sb.from("locatii").select("*").eq("id",locationId).maybeSingle();
    if(locErr||!loc) throw new Error("Locatia nu a fost gasita.");
    const {data:machines,error:mErr}=await sb.from("aparate").select("*").eq("locatie_id",locationId);
    if(mErr) throw mErr;
    const permitted=(machines||[]).filter((m:any)=>!isFiler || filerAllows(profile,m,loc));
    if(!permitted.length) throw new Error("Nu ai acces la aceasta locatie.");
    // A location address is shared by every device at that location. A Filer
    // cannot change it when that would also alter devices outside their scope.
    if(isFiler && permitted.length !== (machines||[]).length) throw new Error("Adresa locatiei este comuna mai multor aparate; solicita administratorului modificarea.");
    const {error:updateLocErr}=await sb.from("locatii").update({adresa:address}).eq("id",locationId);
    if(updateLocErr) throw updateLocErr;
    const {error:updateMachinesErr}=await sb.from("aparate").update({adresa:address}).in("id",permitted.map((m:any)=>m.id));
    if(updateMachinesErr) throw updateMachinesErr;
    return Response.json({success:true,adresa:address,aparateActualizate:permitted.length},{headers:CORS});
  }
  if(action==="filerUpdateGps"){
    if(!isFiler && !isAdmin) throw new Error("Acces interzis.");
    const locationId=String(body.locationId||"").trim();
    if(!locationId||!/^[0-9a-f-]{36}$/i.test(locationId)) throw new Error("ID locatie invalid.");
    const lat=Number(body.latitudine),lng=Number(body.longitudine),accuracy=Math.max(0,Number(body.precizie)||0);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat > 90||lng < -180||lng > 180) throw new Error("Coordonate GPS invalide.");
    const {data:loc,error:locErr}=await sb.from("locatii").select("*").eq("id",locationId).maybeSingle();
    if(locErr||!loc)throw new Error("Locatia nu a fost gasita.");
    const {data:machines,error:mErr}=await sb.from("aparate").select("*").eq("locatie_id",locationId).eq("status","Activ");
    if(mErr)throw mErr;
    if(isFiler && !(machines||[]).some((m:any)=>filerAllows(profile,m,loc))) throw new Error("Nu ai acces GPS la aceasta locatie.");
    if(isFiler && (machines||[]).some((m:any)=>!filerAllows(profile,m,loc))) throw new Error("Coordonatele sunt comune mai multor aparate; solicita administratorului actualizarea GPS.");
    const stamp=new Date().toISOString();
    const {error:updateLocErr}=await sb.from("locatii").update({latitudine:lat,longitudine:lng,gps_actualizat:stamp,gps_actualizat_la:stamp,gps_precizie:accuracy}).eq("id",locationId);
    if(updateLocErr)throw updateLocErr;
    const allowedIds=(machines||[]).filter((m:any)=>!isFiler||(filerAllows(profile,m,loc))).map((m:any)=>m.id);
    if(allowedIds.length){const {error:updateMachineErr}=await sb.from("aparate").update({gps_latitudine:lat,gps_longitudine:lng,gps_precizie_m:accuracy,gps_actualizat_la:stamp}).in("id",allowedIds);if(updateMachineErr)throw updateMachineErr;}
    return Response.json({success:true,aparateActualizate:allowedIds.length},{headers:CORS});
  }
  // Legacy V5 `add` compatibility for standard technician interventions.
  // This intentionally accepts only the intervention payload and derives relational IDs server-side.
  if(action==="add" && String(body.sheet||"").trim()==="Interventii"){
    if(!isTech&&!isAdmin) throw new Error("Adaugarea interventiilor este disponibila doar Tehnicianului sau Administratorului.");
    if(isTech&&!technicianRecord) throw new Error("Contul Tehnician nu este asociat unei inregistrari din lista Tehnicieni. Administratorul trebuie sa faca asocierea explicita inainte de salvare.");
    if(technicianRecord && norm(technicianRecord.status) && !["activ","active"].includes(norm(technicianRecord.status))) throw new Error("Contul de tehnician este inactiv.");
    let record:any={};
    try { record=typeof body.record==="string"?JSON.parse(body.record):body.record||{}; }
    catch { throw new Error("Datele interventiei nu sunt valide."); }
    const legacyMachineId=String(record["ID Aparat"]||record.aparat_id||"").trim();
    if(!legacyMachineId) throw new Error("Selecteaza aparatul pentru interventie.");
    if(!/^[0-9a-f-]{36}$/i.test(legacyMachineId)) throw new Error("Identificatorul aparatului nu este UUID-ul Supabase. Reincarca lista aparatelor si incearca din nou.");
    const {data:machine,error:machineErr}=await sb.from("aparate").select("*").eq("id",legacyMachineId).maybeSingle();
    if(machineErr||!machine) throw new Error("Aparatul selectat nu a fost gasit.");
    if(!machineIsActive(machine)) throw new Error("Nu poti inregistra interventii pentru un aparat retras sau inactiv.");
    const {data:location,error:locationErr}=machine.locatie_id
      ? await sb.from("locatii").select("*").eq("id",machine.locatie_id).maybeSingle()
      : {data:null,error:null};
    if(locationErr) throw locationErr;
    if(!location) throw new Error("Aparatul nu are o locatie valida asociata.");
    const profileCities=arr(profile.orase_acces).map(norm);
    const profileTypes=arr(profile.tip_echipament_acces);
    const profileZones=arr(profile.zone_aparate_acces).map(norm);
    const machineCity=norm(location.oras||machine.source_data?.Oras||machine.source_data?.oras);
    if(profileCities.length && !profileCities.includes(machineCity)) throw new Error("Aparatul nu se afla in aria autorizata pentru acest cont.");
    if(profileTypes.length && !equipmentMatches(profileTypes,machine.tip_echipament||machine.tip_aparat)) throw new Error("Tipul aparatului nu este autorizat pentru acest cont.");
    if(profileZones.length && !profileZones.includes(norm(machine.zona))) throw new Error("Zona aparatului nu este autorizata pentru acest cont.");
    const visitType=String(record["Tip interventie"]||record.tip_interventie||record.Tip||record.tip||"").trim();
    if(!visitType) throw new Error("Lipseste tipul interventiei.");
    const legacyId=String(record["ID Interventie"]||"").trim();
    const sourceData={...record,legacy_intervention_id:legacyId||null,created_via:"legacy_add_technician",created_by_auth_id:auth.user.id};
    // Idempotency: a retry of the same legacy form ID must not create a second intervention.
    if(legacyId){
      const {data:existing,error:existingErr}=await sb.from("interventii").select("*").contains("source_data",{legacy_intervention_id:legacyId}).limit(1).maybeSingle();
      if(existingErr) throw existingErr;
      if(existing) return Response.json({success:true,action:"add",sheet:"Interventii",record:legacy("Interventii",existing),duplicate:true},{headers:CORS});
    }
    const now=new Date().toISOString();
    const row={
      aparat_id:machine.id,
      locatie_id:location.id,
      client_id:location.client_id||null,
      data_interventie:now,
      tehnician_id:technicianRecord?.id||null,
      tehnician:technicianRecord?.nume||profile.nume||auth.user.email||"",
      tip:record.Tip||record.tip||visitType,
      tip_interventie:visitType,
      descriere:record.Descriere||record.descriere||record["Operatiuni efectuate"]||"",
      operatiuni:record["Operatiuni efectuate"]||record.Operatiuni||record.operatiuni||"",
      observatii:record.Observatii||record.observatii||"",
      urmatoarea_interventie:record["Urmatoarea interventie"]||record.urmatoarea_interventie||null,
      filtru_schimbat:/schimbare\s+filtru/i.test(visitType),
      igienizare:/igienizare/i.test(String(record["Operatiuni efectuate"]||record.Operatiuni||"")),
      tip_filtru:record["Tip filtru"]||record.tip_filtru||null,
      status:record.Status||"Finalizata",
      solicitare_client:record.SolicitareClient===true||norm(record.SolicitareClient)==="true"||norm(record["De facturat"])==="da",
      de_facturat:norm(record["De facturat"])==="da"||record.deFacturat===true,
      motiv_facturare:record.motivFacturare||record["Motiv facturare"]||null,
      source_data:sourceData
    };
    const {data:saved,error:saveErr}=await sb.from("interventii").insert(row).select("*").single();
    if(saveErr) throw saveErr;
    return Response.json({success:true,action:"add",sheet:"Interventii",record:legacy("Interventii",saved)},{headers:CORS});
  }


  // Dedicated, scoped technician action for a completed filter replacement.
  // The frontend should call this AFTER saving the intervention, passing its
  // legacy ID (INT-...) and the filter details. Generic CRUD remains Admin-only.
  if(action==="technicianCompleteFilterChange"){
    if(!isTech || !technicianRecord) throw new Error("Actiunea este disponibila doar unui tehnician asociat explicit contului Auth.");
    if(norm(technicianRecord.status) && !["activ","active"].includes(norm(technicianRecord.status))) throw new Error("Contul de tehnician este inactiv.");
    const legacyVisitId=String(body.interventionId||"").trim();
    const filterType=String(body.tipFiltru||body.filterType||"").trim();
    const mountedDate=String(body.dataMontare||body.mountDate||"").trim();
    const nextDate=String(body.dataUrmatoareiSchimbari||body.nextChangeDate||"").trim();
    const interval=Math.max(1,Math.min(36,Number(body.intervalLuni||body.intervalMonths)||6));
    if(!legacyVisitId || !filterType || !/^\d{4}-\d{2}-\d{2}$/.test(mountedDate) || !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
      throw new Error("Lipsesc ID-ul interventiei, tipul filtrului sau datele valide de montare/scadenta.");
    }
    let visit:any=null;
    if(/^[0-9a-f-]{36}$/i.test(legacyVisitId)){
      const {data,error}=await sb.from("interventii").select("*").eq("id",legacyVisitId).maybeSingle();
      if(error) throw error;
      visit=data;
    } else {
      const {data,error}=await sb.from("interventii").select("*").contains("source_data",{legacy_intervention_id:legacyVisitId}).limit(1).maybeSingle();
      if(error) throw error;
      visit=data;
    }
    if(!visit) throw new Error("Interventia nu a fost gasita. Salveaza mai intai interventia.");
    if(String(visit.tehnician_id||"")!==String(technicianRecord.id)) throw new Error("Nu poti actualiza filtrul pentru interventia altui tehnician.");
    if(!visit.aparat_id) throw new Error("Interventia nu are aparat asociat.");
    const {data:machine,error:machineErr}=await sb.from("aparate").select("*").eq("id",visit.aparat_id).maybeSingle();
    if(machineErr||!machine) throw new Error("Aparatul interventiei nu a fost gasit.");
    if(!machineIsActive(machine)) throw new Error("Aparatul este retras sau inactiv.");
    const {data:location,error:locErr}=machine.locatie_id
      ? await sb.from("locatii").select("*").eq("id",machine.locatie_id).maybeSingle()
      : {data:null,error:null};
    if(locErr) throw locErr;
    if(!location) throw new Error("Aparatul nu are o locatie valida.");
    const cities=arr(profile.orase_acces).map(norm), types=arr(profile.tip_echipament_acces), zones=arr(profile.zone_aparate_acces).map(norm);
    const city=norm(location.oras||machine.source_data?.Oras||machine.source_data?.oras);
    if(cities.length&&!cities.includes(city)) throw new Error("Aparatul nu se afla in aria autorizata.");
    if(types.length&&!equipmentMatches(types,machine.tip_echipament||machine.tip_aparat)) throw new Error("Tipul aparatului nu este autorizat.");
    if(zones.length&&!zones.includes(norm(machine.zona))) throw new Error("Zona aparatului nu este autorizata.");

    const marker=legacyVisitId;
    const {data:filterRows,error:filterReadErr}=await sb.from("filtre").select("*").eq("aparat_id",machine.id).limit(3);
    if(filterReadErr) throw filterReadErr;
    if((filterRows||[]).length>1) throw new Error("Exista mai multe inregistrari de filtru pentru acest aparat. Este necesara reconcilierea de catre administrator.");
    const currentFilter=(filterRows||[])[0]||null;
    const filterSource=currentFilter?.source_data&&typeof currentFilter.source_data==="object"?currentFilter.source_data:{};
    const filterDone=Array.isArray(filterSource.processed_intervention_ids)&&filterSource.processed_intervention_ids.includes(marker);
    if(!filterDone){
      const filterPayload={
        aparat_id:machine.id, locatie_id:location.id, tip_filtru:filterType,
        data_montare:mountedDate, data_montarii:mountedDate,
        urmatoarea_schimbare:nextDate, data_urmatoarei_schimbari:nextDate,
        interval_luni:interval, status:"Activ", observatii:"Schimbat prin interventie",
        source_data:{...filterSource,processed_intervention_ids:[...(Array.isArray(filterSource.processed_intervention_ids)?filterSource.processed_intervention_ids:[]),marker],updated_via:"technicianCompleteFilterChange"}
      };
      const filterWrite=currentFilter
        ? await sb.from("filtre").update(filterPayload).eq("id",currentFilter.id).select("id").single()
        : await sb.from("filtre").insert(filterPayload).select("id").single();
      if(filterWrite.error) throw filterWrite.error;
    }

    const [{data:stockByName,error:nameErr},{data:stockByCode,error:codeErr}]=await Promise.all([
      sb.from("stoc").select("*").ilike("denumire",filterType).limit(5),
      sb.from("stoc").select("*").ilike("cod_produs",filterType).limit(5)
    ]);
    if(nameErr) throw nameErr;
    if(codeErr) throw codeErr;
    const matchingStock=Array.from(new Map([...(stockByName||[]),...(stockByCode||[])].filter((s:any)=>norm(s.denumire)===norm(filterType)||norm(s.cod_produs)===norm(filterType)).map((s:any)=>[s.id,s])).values());
    if(matchingStock.length!==1) throw new Error(matchingStock.length===0
      ? "Filtrul a fost actualizat, dar produsul nu a putut fi identificat unic in Stoc. Verifica denumirea produsului."
      : "Filtrul a fost actualizat, dar exista mai multe produse potrivite in Stoc. Este necesara verificarea administratorului.");
    const stock=matchingStock[0];
    const stockSource=stock.source_data&&typeof stock.source_data==="object"?stock.source_data:{};
    const stockDone=Array.isArray(stockSource.processed_filter_intervention_ids)&&stockSource.processed_filter_intervention_ids.includes(marker);
    if(!stockDone){
      const consumed=Number(stock.consum||0)+1;
      const entered=Number(stock.cantitate_intrata??stock.cantitate??0);
      const {error:stockWriteErr}=await sb.from("stoc").update({
        consum:consumed,stoc_actual:entered-consumed,
        source_data:{...stockSource,processed_filter_intervention_ids:[...(Array.isArray(stockSource.processed_filter_intervention_ids)?stockSource.processed_filter_intervention_ids:[]),marker],updated_via:"technicianCompleteFilterChange"}
      }).eq("id",stock.id);
      if(stockWriteErr) throw stockWriteErr;
    }
    return Response.json({success:true,filterUpdated:true,stockUpdated:true,duplicate:filterDone&&stockDone},{headers:CORS});
  }

  // Canonical Supabase API contract retained for the newer client.
  const canonicalTables:Record<string,string>={clienti:"clienti",locatii:"locatii",aparate:"aparate",interventii:"interventii",interventii_espressoare:"interventii_espressoare",filtre:"filtre",stoc:"stoc",produse:"produse",utilizatori:"utilizatori_aplicatie",tehnicieni:"tehnicieni",rapoarte_aparate:"v_raport_aparate",rapoarte_interventii:"v_raport_interventii",rapoarte_espressoare:"v_raport_interventii_espressoare",rapoarte_stoc:"v_raport_stoc"};
  const canonicalRead:Record<string,string[]>={
    administrator:Object.keys(canonicalTables),admin:Object.keys(canonicalTables),
    comercial:["clienti","locatii","aparate","filtre","rapoarte_aparate"],
    filer:["clienti","locatii","aparate","interventii_espressoare","rapoarte_espressoare"],
    tehnician:["clienti","locatii","aparate","interventii","filtre"]
  };
  const canonicalWrite:Record<string,string[]>={
    administrator:["clienti","locatii","aparate","interventii","interventii_espressoare","filtre","stoc","produse","utilizatori","tehnicieni"],
    admin:["clienti","locatii","aparate","interventii","interventii_espressoare","filtre","stoc","produse","utilizatori","tehnicieni"],
    // Filer/technician writes must use the dedicated scoped actions below;
    // generic CRUD is administrator-only to prevent cross-user record edits.
  };
  if(action==="list"){
    const name=String(body.table||"").toLowerCase(),physical=canonicalTables[name];
    if(!physical) throw new Error("Tabel necunoscut.");
    if(!(canonicalRead[role]||[]).includes(name)) throw new Error("Acces interzis la acest modul.");
    const limit=Math.min(Math.max(Number(body.limit)||200,1),800);
    const offset=Math.max(0,Math.min(Number(body.offset)||0,200000));
    let rows:any[]=[]; let total=0;
    if(role==="filer" && ["aparate","locatii","interventii_espressoare"].includes(name)){
      // Filter BEFORE pagination; otherwise a page full of out-of-scope rows
      // can hide valid rows on later pages and report a misleading total.
      rows=await allRows(sb,physical);
      if(name==="aparate"){
        const locations=await allRows(sb,"locatii"), byId=new Map(locations.map((x:any)=>[x.id,x]));
        rows=rows.filter((m:any)=>filerAllows(profile,m,byId.get(m.locatie_id)));
      } else if(name==="locatii"){
        const machines=await allRows(sb,"aparate");
        rows=rows.filter((loc:any)=>machines.some((m:any)=>m.locatie_id===loc.id && filerAllows(profile,m,loc)));
      } else {
        const cities=arr(profile.orase_acces).map(norm), zones=arr(profile.zone_aparate_acces).map(norm);
        rows=rows.filter((r:any)=>(!cities.length||cities.includes(norm(r.oras))) && equipmentMatches(arr(profile.tip_echipament_acces),r.tip_echipament) && (!zones.length||zones.includes(norm(r.zona_aparate))) && String(r.technician_profile_id||"")===auth.user.id);
      }
      total=rows.length; rows=rows.slice(offset,offset+limit);
    } else {
      let q=sb.from(physical).select("*",{count:"exact"}).order("id",{ascending:true});
      if(role==="comercial" && name==="aparate") q=q.neq("status","Retras");
      const {data,error,count}=await q.range(offset,offset+limit-1);
      if(error) throw error;
      rows=data||[]; total=count||0;
    }
    return Response.json({success:true,data:rows,count:total,offset,limit,hasMore:offset+limit<total},{headers:CORS});
  }
  if(["insert","upsert","update","delete"].includes(action)){
    const name=String(body.table||"").toLowerCase(),physical=canonicalTables[name];
    if(!physical) throw new Error("Tabel necunoscut.");
    if(!(canonicalWrite[role]||[]).includes(name)) throw new Error("Nu ai drept de modificare pentru acest modul.");
    if(name.startsWith("rapoarte_")) throw new Error("Rapoartele sunt doar pentru citire.");
    if((name==="utilizatori"||name==="tehnicieni")&&!isAdmin) throw new Error("Doar administratorul poate modifica utilizatorii/tehnicienii.");
    if(action==="delete"&&!isAdmin) throw new Error("Stergerea este permisa doar administratorului.");
    let q:any=sb.from(physical);
    if(action==="insert") q=q.insert(body.record).select().single();
    if(action==="upsert") q=q.upsert(body.record,{onConflict:String(body.onConflict||"id")}).select().single();
    if(action==="update"||action==="delete"){
      const id=String(body.id||"").trim(); if(!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("ID UUID invalid.");
      q=action==="update"?q.update(body.record).eq("id",id).select().single():q.delete().eq("id",id).select().single();
    }
    const {data,error}=await q; if(error) throw error;
    return Response.json({success:true,data},{headers:CORS});
  }

  // Standard technician intervention photos (separate from the espresso/Filer workflow).
  const canAccessStandardVisit = async (visitId:string) => {
    const suppliedId=String(visitId||"").trim();
    if(!suppliedId) throw new Error("ID interventie invalid.");

    // Compatibility: the legacy OFRESH frontend creates IDs such as INT-...
    // and sends that value to uploadPhoto/finalizePhotoUpload. Supabase stores
    // the row under a UUID, while the old ID is retained in source_data.
    // Resolve either form server-side; never trust the browser for ownership.
    let visit:any=null;
    if(/^[0-9a-f-]{36}$/i.test(suppliedId)){
      const {data,error}=await sb.from("interventii").select("*").eq("id",suppliedId).maybeSingle();
      if(error) throw error;
      visit=data;
    } else {
      const {data,error}=await sb.from("interventii").select("*")
        .contains("source_data",{legacy_intervention_id:suppliedId})
        .limit(1).maybeSingle();
      if(error) throw error;
      visit=data;
    }
    if(!visit) throw new Error("Interventia nu a fost gasita.");
    if(!isAdmin && (!isTech || !technicianRecord || String(visit.tehnician_id||"")!==String(technicianRecord.id))) throw new Error("Nu ai dreptul sa incarci fotografii pentru aceasta interventie.");
    return visit;
  };
  const saveStandardPhoto = async (visit:any, bytes:Uint8Array, mimeType:string, fileName:string, photoIndex:number) => {
    if(bytes.byteLength>PHOTO_MAX_BYTES) throw new Error("Fotografia depaseste limita de 1.5 MB.");
    if(!["image/jpeg","image/png","image/webp"].includes(mimeType)) throw new Error("Format foto neacceptat.");
    const safe=safeFileName(fileName||"interventie.jpg");
    const objectPath=`standard/${visit.id}/${String(photoIndex).padStart(2,"0")}_${crypto.randomUUID()}_${safe}`;
    const {error:uploadErr}=await sb.storage.from(PHOTO_BUCKET).upload(objectPath,bytes,{contentType:mimeType,upsert:false});
    if(uploadErr) throw new Error("Nu am putut salva fotografia: "+uploadErr.message);
    const [{data:machine},{data:client}]=await Promise.all([
      visit.aparat_id ? sb.from("aparate").select("cod_ofresh,producator,model,serie,client_nume").eq("id",visit.aparat_id).maybeSingle() : Promise.resolve({data:null}),
      visit.client_id ? sb.from("clienti").select("nume").eq("id",visit.client_id).maybeSingle() : Promise.resolve({data:null})
    ]);
    const row={interventie_id:visit.id,source_id:null,client:client?.nume||machine?.client_nume||"",aparat:[machine?.cod_ofresh,machine?.producator,machine?.model,machine?.serie].filter(Boolean).join(" - "),tehnician:profile.nume||auth.user.email||"",storage_path:objectPath,file_name:safe,file_url:null,taken_at:new Date().toISOString(),numar_poza:photoIndex,data_incarcare:new Date().toISOString(),file_id_sursa:null,source_data:{storage_bucket:PHOTO_BUCKET,uploaded_by:auth.user.id,mime_type:mimeType}};
    const {data:photo,error:photoErr}=await sb.from("poze_interventii").insert(row).select("*").single();
    if(photoErr){await sb.storage.from(PHOTO_BUCKET).remove([objectPath]);throw photoErr;}
    const {count,error:countErr}=await sb.from("poze_interventii").select("id",{count:"exact",head:true}).eq("interventie_id",visit.id);
    if(countErr) throw countErr;
    const {error:updateErr}=await sb.from("interventii").update({fotografii_count:count||1}).eq("id",visit.id);
    if(updateErr) throw updateErr;
    const {data:signed}=await sb.storage.from(PHOTO_BUCKET).createSignedUrl(objectPath,3600);
    return {...photo,signed_url:signed?.signedUrl||null};
  };
  if(action==="uploadPhoto"){
    if(!isTech&&!isAdmin) throw new Error("Acces interzis.");
    const visit=await canAccessStandardVisit(String(body.interventionId||""));
    const dataUrl=String(body.dataUrl||""); const comma=dataUrl.indexOf(",");
    if(comma<0) throw new Error("Format fotografie invalid.");
    const mimeType=String(body.mimeType||dataUrl.slice(5,dataUrl.indexOf(";"))||"image/jpeg").split(";")[0];
    const bytes=decodeBase64(dataUrl.slice(comma+1));
    const index=Math.max(1,Math.min(50,Number(body.photoIndex)||1));
    const photo=await saveStandardPhoto(visit,bytes,mimeType,String(body.fileName||"interventie.jpg"),index);
    return Response.json({success:true,photo},{headers:CORS});
  }
  if(action==="uploadPhotoChunk"){
    if(!isTech&&!isAdmin) throw new Error("Acces interzis.");
    const uploadId=String(body.uploadId||"").trim(), chunk=String(body.chunk||"");
    const chunkIndex=Number(body.chunkIndex),totalChunks=Number(body.totalChunks);
    if(!/^[a-zA-Z0-9_-]{8,100}$/.test(uploadId)||!Number.isInteger(totalChunks)||totalChunks<1||totalChunks>100||!Number.isInteger(chunkIndex)||chunkIndex<0||chunkIndex>=totalChunks||!chunk||chunk.length>PHOTO_CHUNK_MAX) throw new Error("Date fragment foto invalide.");
    const path=`tmp-standard/${auth.user.id}/${uploadId}/${chunkIndex}.b64`;
    const {error}=await sb.storage.from(PHOTO_BUCKET).upload(path,new TextEncoder().encode(chunk),{contentType:"image/jpeg",upsert:true});
    if(error) throw new Error("Nu am putut salva fragmentul foto: "+error.message);
    return Response.json({success:true,chunkIndex,totalChunks},{headers:CORS});
  }
  if(action==="finalizePhotoUpload"){
    if(!isTech&&!isAdmin) throw new Error("Acces interzis.");
    const visit=await canAccessStandardVisit(String(body.interventionId||""));
    const uploadId=String(body.uploadId||"").trim(),totalChunks=Number(body.totalChunks);
    if(!/^[a-zA-Z0-9_-]{8,100}$/.test(uploadId)||!Number.isInteger(totalChunks)||totalChunks<1||totalChunks>100) throw new Error("Date incarcare foto invalide.");
    let base64=""; const tempPaths:string[]=[];
    for(let i=0;i<totalChunks;i++){
      const path=`tmp-standard/${auth.user.id}/${uploadId}/${i}.b64`; tempPaths.push(path);
      const {data:blob,error}=await sb.storage.from(PHOTO_BUCKET).download(path);
      if(error||!blob) throw new Error(`Lipseste fragmentul foto ${i+1} din ${totalChunks}.`);
      base64+=await blob.text();
    }
    const mimeType=String(body.mimeType||"image/jpeg").split(";")[0];
    const bytes=decodeBase64(base64);
    const photo=await saveStandardPhoto(visit,bytes,mimeType,String(body.fileName||"interventie.jpg"),Math.max(1,Math.min(50,Number(body.photoIndex)||1)));
    await sb.storage.from(PHOTO_BUCKET).remove(tempPaths);
    return Response.json({success:true,photo},{headers:CORS});
  }
  return new Response(JSON.stringify({success:false,error:`Actiunea ${action} nu este implementata in adaptorul V35.`}),{status:501,headers:CORS});
}
Deno.serve(async(req:Request)=>{try{return await main(req);}catch(e){return new Response(JSON.stringify({success:false,error:e instanceof Error?e.message:"Eroare interna."}),{status:500,headers:CORS});}});