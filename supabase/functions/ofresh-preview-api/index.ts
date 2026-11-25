// OFRESH V52 — canonical API role-scoped pagination for technician and Filer (preview)
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
  Filtre:"filtre", Stoc:"stoc", Produse:"produse", Tehnicieni:"tehnicieni", Utilizatori:"utilizatori_aplicatie",
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
function normalizeMobilePhone(value:string){const digits=value.replace(/[^0-9+]/g,"");return digits.startsWith("+")?digits:digits.startsWith("0")?"+4"+digits:"+40"+digits;}
function bytesToHex(bytes:Uint8Array){return Array.from(bytes).map(x=>x.toString(16).padStart(2,"0")).join("");}
function hexToBytes(value:string){return new Uint8Array((value.match(/.{2}/g)||[]).map(x=>parseInt(x,16)));}
async function derivePinHash(pin:string,saltHex:string){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(pin),"PBKDF2",false,["deriveBits"]);const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:hexToBytes(saltHex),iterations:310000,hash:"SHA-256"},key,256);return bytesToHex(new Uint8Array(bits));}
function constantTimeEqual(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
async function newMobileCredential(userId:string,phone:string,pin:string,sb:any){const salt=crypto.getRandomValues(new Uint8Array(16)),saltHex=bytesToHex(salt),pinHash=await derivePinHash(pin,saltHex);const {error}=await sb.from("ofresh_mobile_credentials").upsert({user_id:userId,phone,pin_salt:saltHex,pin_hash:pinHash,failed_attempts:0,locked_until:null,enabled:true,updated_at:new Date().toISOString()},{onConflict:"user_id"});if(error)throw error;}
async function issueMobileSession(sb:any,userId:string){const token=bytesToHex(crypto.getRandomValues(new Uint8Array(32))),tokenHash=await sha256(token),expiresAt=new Date(Date.now()+30*24*60*60*1000).toISOString();const {error}=await sb.from("ofresh_mobile_sessions").insert({token_hash:tokenHash,user_id:userId,expires_at:expiresAt});if(error)throw error;return {token,expiresAt};}
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
    case "Aparate": return {...base,"ID Aparat":r.id,"Cod ID":r.cod_id,"ID Locatie":r.locatie_id,Locatie:r.locatie,Client:r.client_nume ?? r.locatie,Oras:r.oras,Judet:r.judet,Producator:r.producator,Model:r.model,Serie:r.serie,"Cod OFRESH":r.cod_ofresh,Status:r.status,Zona:r.zona,"Data instalare":r.data_instalarii,"Tip echipament":r.tip_echipament,"Tip aparat":r.tip_aparat,"Data retragere":r.data_retragere,Adresa:r.adresa,"Ultima interventie":r.ultima_interventie,"Urmatoarea interventie":r.urmatoarea_interventie,"QR Token":r.qr_token,"GPS Latitudine":r.gps_latitudine,"GPS Longitudine":r.gps_longitudine,"GPS Precizie m":r.gps_precizie_m,"GPS Actualizat la":r.gps_actualizat_la,gps_latitudine:r.gps_latitudine,gps_longitudine:r.gps_longitudine,gps_precizie_m:r.gps_precizie_m,gps_actualizat_la:r.gps_actualizat_la};
    case "Interventii": return {...base,"ID Interventie":r.id,"ID Aparat":r.aparat_id,Data:r.data_interventie,Tehnician:r.tehnician,Tip:r.tip,"Tip interventie":r.tip_interventie,Descriere:r.descriere,Operatiuni:r.operatiuni,Observatii:r.observatii,"ID Tehnician":r.tehnician_id,"Urmatoarea interventie":r.urmatoarea_interventie,"Filtru schimbat":r.filtru_schimbat,Igienizare:r.igienizare,Status:r.status,"ID Locatie":r.locatie_id,"ID Client":r.client_id,"Tip filtru":r.tip_filtru,"Fotografii":r.fotografii_count};
    case "Filtre": return {...base,"ID Filtru":r.id,"ID Aparat":r.aparat_id,"ID Locatie":r.locatie_id,"Tip filtru":r.tip_filtru,"Data montarii":r.data_montarii ?? r.data_montare,"Data montare":r.data_montare ?? r.data_montarii,"Data schimbarii":r.data_schimbarii,"Urmatoarea schimbare":r.urmatoarea_schimbare ?? r.data_urmatoarei_schimbari,"Data urmatoarei schimbari":r.data_urmatoarei_schimbari ?? r.urmatoarea_schimbare,"Interval luni":r.interval_luni,Status:r.status,Observatii:r.observatii};
    case "Produse": return {...base,"ID Produs":r.id,"Cod produs":r.cod_produs,Denumire:r.denumire,Categorie:r.categorie,Brand:r.brand,Pret:r.pret,TVA:r.tva,Status:r.status,Activ:r.activ,Observatii:r.observatii};
    case "Stoc": return {...base,"ID Stoc":r.id,"Cod produs":r.cod_produs,Denumire:r.denumire,Categorie:r.categorie,Locatie:r.locatie,"Cantitate intrata":r.cantitate_intrata ?? r.cantitate,Consum:r.consum,"Stoc actual":r.stoc_actual, "Prag minim":r.prag_minim,Unitate:r.unitate,"Pret unitar":r.pret_unitar,"Data intrare":r.data_intrare,Observatii:r.observatii};
    case "Tehnicieni": return {...base,"ID Tehnician":r.id,"ID Utilizator":r.user_id||"",Nume:r.nume,Telefon:r.telefon,Email:r.email,Status:r.status,"Tip personal":r.tip_personal,Rol:r.tip_personal,Observatii:r.observatii};
    case "Utilizatori": return {...base,"ID Utilizator":r.id,Nume:r.nume,Telefon:r.telefon,Email:r.email,Rol:r.rol,Status:r.status,Drepturi:r.drepturi,"Orase acces":r.orase_acces,"Tip echipament acces":r.tip_echipament_acces,"Zone aparate acces":r.zone_aparate_acces};
    case "InterventiiEspressoare": return {...base,"ID Interventie":r.id,"Data interventie":r.data_interventie,Client:r.client,Adresa:r.adresa,Oras:r.oras,Judet:r.judet,"Cod OFRESH":r.cod_ofresh,"Serie aparat":r.serie_aparat,Producator:r.producator,"Tip aparat":r.tip_aparat,Operatiuni:r.operatiuni,Observatii:r.observatii,Igienizare:r.igienizare,Decalcifiere:r.decalcifiere,"Curatare capucinator":r.curatare_capucinator,"Spalat grup cafea":r.spalat_grup_cafea,"Spalat furtune lapte":r.spalat_furtune_lapte,"Spalat tavita reziduuri":r.spalat_tavita_reziduuri,"Predat marfa":r.predat_marfa,"Numar fotografii":r.numar_fotografii,"Zona aparate":r.zona_aparate,"Tip echipament":r.tip_echipament,Tehnician:r.tehnician,"ID Aparat":r.aparat_id,"ID Locatie":r.locatie_id};
    case "PozeInterventiiEspressoare": return {...base,"ID Poza":r.id,"ID Interventie":r.interventie_id,Filer:r.filer,Client:r.client,Aparat:r.aparat,Categorie:r.categorie,"Nr. poza":r.numar_poza,"Nume fisier":r.file_name,"URL poza":r.signed_url||r.file_url,"Data incarcare":r.data_incarcare,"MIME type":r.mime_type};
    case "PozeInterventii": return {...base,"ID Poza":r.id,"ID Interventie":r.interventie_id,Tehnician:r.tehnician,Client:r.client,Aparat:r.aparat,"Nume fisier":r.file_name,"URL poza":r.signed_url||r.file_url,"Data incarcare":r.data_incarcare};
    default: return base;
  }
}
function legacyArray(value:any): string[] {
  if(Array.isArray(value)) return value.map(String).map(x=>x.trim()).filter(Boolean);
  if(typeof value==="string") return value.split(/[,;|]/).map(x=>x.trim()).filter(Boolean);
  return [];
}
function legacyRights(value:any): any {
  if(value && typeof value==="object" && !Array.isArray(value)) return value;
  const values=legacyArray(value);
  return Object.fromEntries(values.map(x=>[x,true]));
}
function legacyPayload(sheet:string, record:any, legacyId:string): {table:string,row:any} {
  const r=record && typeof record==="object" ? record : {};
  const sourceData={...r,legacy_record_id:legacyId||r.legacy_record_id||null,updated_via:"ofresh_legacy_desktop"};
  delete sourceData.PIN; delete sourceData.pin; delete sourceData.Password; delete sourceData.password;
  const get=(...keys:string[])=>{for(const k of keys){if(Object.prototype.hasOwnProperty.call(r,k) && r[k]!==undefined) return r[k]===""?null:r[k];}return undefined;};
  const uuid=(v:any)=>typeof v==="string" && /^[0-9a-f-]{36}$/i.test(v);
  const idValue=(...keys:string[])=>{const v=get(...keys);if(v===undefined)return undefined;if(v===null)return null;return uuid(v)?v:undefined;};
  switch(sheet){
    case "Clienti": return {table:"clienti",row:{source_id:legacyId||get("ID Sursa","source_id"),nume:String(get("Client","Nume client","Nume","nume")||"").trim(),adresa:get("Adresa","adresa"),zona:get("Zona","zona"),oras:get("Oras","oras"),judet:get("Judet","judet"),persoana_contact:get("Persoana contact","persoana_contact"),telefon:get("Telefon","telefon"),email:get("Email","email"),status:get("Status","status")||"Activ",observatii:get("Observatii","observatii"),source_data:sourceData}};
    case "Locatii": return {table:"locatii",row:{source_id:legacyId||get("ID Sursa","source_id"),nume:String(get("Nume locatie","Locatie","nume")||"").trim(),adresa:get("Adresa","adresa"),judet:get("Judet","judet"),oras:get("Oras","oras"),status:get("Status","status")||"Activ",client_id:idValue("ID Client","client_id"),nume_client:get("Client","Nume client","nume_client"),persoana_contact:get("Persoana contact","persoana_contact"),telefon:get("Telefon","telefon"),telefone:get("Telefon","telefone"),email:get("Email","email"),observatii:get("Observatii","observatii"),zona:get("Zona","zona"),latitudine:get("Latitudine","GPS Latitudine","latitudine"),longitudine:get("Longitudine","GPS Longitudine","longitudine"),source_data:sourceData}};
    case "Aparate": return {table:"aparate",row:{cod_id:legacyId||get("Cod ID","cod_id"),locatie_id:idValue("ID Locatie","locatie_id"),locatie:get("Locatie","locatie"),producator:get("Producator","producator"),model:get("Model","model"),serie:get("Serie","serie"),cod_ofresh:get("Cod OFRESH","cod_ofresh"),status:get("Status","status")||"Activ",zona:get("Zona","zona"),data_instalarii:get("Data instalare","Data instalarii","data_instalarii"),tip_echipament:get("Tip echipament","tip_echipament")||"apa",tip_aparat:get("Tip aparat","tip_aparat"),data_retragere:get("Data retragere","data_retragere"),client_nume:get("Client","Nume client","client_nume"),adresa:get("Adresa","adresa"),ultima_interventie:get("Ultima interventie","ultima_interventie"),urmatoarea_interventie:get("Urmatoarea interventie","urmatoarea_interventie"),source_data:sourceData}};
    case "Filtre": return {table:"filtre",row:{aparat_id:idValue("ID Aparat","aparat_id"),locatie_id:idValue("ID Locatie","locatie_id"),tip_filtru:get("Tip filtru","Tip Filtru","tip_filtru"),data_montarii:get("Data montarii","Data montare","data_montarii","data_montare"),data_schimbarii:get("Data schimbarii","data_schimbarii"),urmatoarea_schimbare:get("Urmatoarea schimbare","Data urmatoarei schimbari","data_urmatoarei_schimbari","urmatoarea_schimbare"),interval_luni:Number(get("Interval luni","interval_luni")||6),status:get("Status","status")||"Activ",observatii:get("Observatii","observatii"),id_sursa:legacyId||get("ID Sursa","id_sursa"),source_data:sourceData}};
    case "Stoc": return {table:"stoc",row:{source_id:legacyId||get("ID Sursa","source_id"),cod_produs:get("Cod produs","cod_produs"),denumire:get("Denumire","denumire"),categorie:get("Categorie","categorie"),locatie:get("Locatie","locatie"),cantitate_intrata:get("Cantitate intrata","Cantitate","cantitate_intrata","cantitate"),cantitate:get("Cantitate","cantitate","Cantitate intrata"),consum:get("Consum","Consumat","consum"),stoc_actual:get("Stoc actual","stoc_actual"),prag_minim:get("Prag minim","prag_minim"),unitate:get("Unitate","unitate"),pret_unitar:get("Pret unitar","pret_unitar"),data_intrare:get("Data intrare","data_intrare"),observatii:get("Observatii","observatii"),source_data:sourceData}};
    case "Tehnicieni": return {table:"tehnicieni",row:{source_id:legacyId||get("ID Sursa","source_id"),nume:String(get("Nume","nume")||"").trim(),telefon:get("Telefon","telefon"),email:get("Email","email"),status:get("Status","status")||"Activ",observatii:get("Observatii","observatii"),tip_personal:get("Tip personal","Rol","tip_personal")||"tehnician",source_data:sourceData}};
    case "Utilizatori": return {table:"utilizatori_aplicatie",row:{source_id:legacyId||get("ID Sursa","source_id"),nume:String(get("Nume","nume")||"").trim(),telefon:get("Telefon","telefon"),email:get("Email","email"),rol:String(get("Rol","rol")||"").toLowerCase(),status:get("Status","status")||"Activ",drepturi:legacyRights(get("Drepturi","drepturi")),orase_acces:legacyArray(get("Orase acces","orase_acces")),tip_echipament_acces:legacyArray(get("Tip echipament acces","tip_echipament_acces")),zone_aparate_acces:legacyArray(get("Zone aparate acces","zone_aparate_acces")),source_data:sourceData}};
    case "Produse": return {table:"produse",row:{source_id:legacyId||get("ID Sursa","source_id"),cod_produs:get("Cod produs","cod_produs"),denumire:String(get("Denumire","denumire")||"").trim(),categorie:get("Categorie","categorie"),brand:get("Brand","brand"),pret:get("Pret","pret"),tva:get("TVA","tva"),status:get("Status","status")||"Activ",activ:get("Activ","activ")!==false,observatii:get("Observatii","observatii"),source_data:sourceData}};
    default: throw new Error("Modulul nu permite salvare legacy: "+sheet);
  }
}
async function resolveLegacyRow(sb:any, sheet:string, value:string) {
  if(!value) throw new Error("Lipseste identificatorul inregistrarii.");
  const table=TABLES[sheet]; if(!table) throw new Error("Modul necunoscut: "+sheet);
  let q=sb.from(table).select("*");
  if(/^[0-9a-f-]{36}$/i.test(value)) q=q.eq("id",value);
  else if(sheet==="Aparate") q=q.eq("cod_id",value);
  else if(sheet==="Filtre") q=q.eq("id_sursa",value);
  else q=q.eq("source_id",value);
  const {data,error}=await q.limit(2);
  if(error) throw error;
  if(!data||data.length!==1) throw new Error(data?.length>1?"Identificator duplicat; modificarea a fost oprita.":"Inregistrarea nu a fost gasita.");
  return data[0];
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
function filerAllows(profile:any, machine:any, _loc:any) {
  const explicitIds=arr(profile.aparate_asignate).map((x:any)=>String(x));
  // Filer access is strictly limited to machines explicitly assigned by an administrator.
  // Empty assignments fail closed; city/zone permissions are not a substitute for assignment.
  if(!explicitIds.length) return false;
  const machineId=String(machine?.id||"");
  return machineIsActive(machine) &&
    startsEsp(machine.tip_echipament || machine.tip_aparat) &&
    explicitIds.includes(machineId);
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
  const previewReadActions=new Set(["publicMachine","whoami","read","bootstrap","readSheets","dashboardData","commercialData","commercialHistory","commercialEspressoHistory","technicianData","filerData","filerAccessOptions","findAparat","searchAparate","interventionExportData","listMobileProvisionCandidates","listMobileLinkedUsers","filerAssignmentData","mobileLogin","mobileLogout","mobileInterventionHistory","filerEnsureAccessColumns","checkFilterStock"]);
  const previewWriteActions=new Set(["add","update","delete","importAparateBatch","filerSaveVisit","filerUploadPhotoChunk","filerFinalizePhotoUpload","filerFinalizePhotoUploads","filerUpdateGps","filerUpdateLocation","filerUpdateMachine","technicianUpdateMachine","technicianCompleteFilterChange","uploadPhoto","uploadPhotoChunk","finalizePhotoUpload","saveGpsLocation"]);
  if(!previewReadActions.has(action) && !previewWriteActions.has(action)) return Response.json({success:false,error:"Acțiunea "+action+" nu este disponibilă în versiunea Preview."},{status:403,headers:CORS});
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
  if(action==="mobileLogin"){
    const phone=normalizeMobilePhone(String(body.phone||"")),pin=String(body.pin||"");
    if(!/^\+40[0-9]{9}$/.test(phone)||!/^\d{6,12}$/.test(pin))return Response.json({success:false,error:"Telefon sau PIN invalid."},{status:400,headers:CORS});
    const {data:cred,error:ce}=await sb.from("ofresh_mobile_credentials").select("*").eq("phone",phone).eq("enabled",true).maybeSingle();if(ce)throw ce;
    if(!cred)return Response.json({success:false,error:"Telefon sau PIN invalid."},{status:401,headers:CORS});
    if(cred.locked_until&&new Date(cred.locked_until).getTime()>Date.now())return Response.json({success:false,error:"Acces temporar blocat. Incearca mai tarziu."},{status:429,headers:CORS});
    const hash=await derivePinHash(pin,cred.pin_salt);
    if(!constantTimeEqual(hash,cred.pin_hash)){const n=Number(cred.failed_attempts||0)+1;await sb.from("ofresh_mobile_credentials").update({failed_attempts:n>=5?0:n,locked_until:n>=5?new Date(Date.now()+15*60*1000).toISOString():null}).eq("user_id",cred.user_id);return Response.json({success:false,error:"Telefon sau PIN invalid."},{status:401,headers:CORS});}
    await sb.from("ofresh_mobile_credentials").update({failed_attempts:0,locked_until:null}).eq("user_id",cred.user_id);
    const {data:prof,error:pe}=await sb.from("profiluri").select("*").eq("id",cred.user_id).maybeSingle();if(pe||!prof||prof.activ===false)return Response.json({success:false,error:"Profil OFRESH inactiv sau lipsa."},{status:403,headers:CORS});
    const sess=await issueMobileSession(sb,cred.user_id);return Response.json({success:true,token:sess.token,expiresAt:sess.expiresAt,profile:prof},{headers:CORS});
  }
  if(!token)return new Response(JSON.stringify({success:false,error:"Autentificare necesara."}),{status:401,headers:CORS});
  if(action==="mobileLogout"){const h=await sha256(token);await sb.from("ofresh_mobile_sessions").update({revoked_at:new Date().toISOString()}).eq("token_hash",h).is("revoked_at",null);return Response.json({success:true},{headers:CORS});}
  const tokenHash=await sha256(token);
  const {data:ms}=await sb.from("ofresh_mobile_sessions").select("user_id,expires_at,revoked_at").eq("token_hash",tokenHash).maybeSingle();
  let authUser:any=null;
  if(ms){if(ms.revoked_at||new Date(ms.expires_at).getTime()<=Date.now())return new Response(JSON.stringify({success:false,error:"Sesiune expirata."}),{status:401,headers:CORS});authUser={id:ms.user_id,email:null};}
  else{const {data:auth,error:ae}=await sb.auth.getUser(token);if(ae||!auth.user)return new Response(JSON.stringify({success:false,error:"Sesiune invalida."}),{status:401,headers:CORS});authUser=auth.user;}
  const {data:profile,error:profileErr}=await sb.from("profiluri").select("*").eq("id",authUser.id).maybeSingle();
  if(profileErr||!profile||profile.activ===false)return new Response(JSON.stringify({success:false,error:"Profil OFRESH inactiv sau lipsa."}),{status:403,headers:CORS});  const rights=profile.drepturi||{};
  const primaryRole=norm(profile.rol);
  const assignedRoles=new Set<string>([primaryRole]);
  if(Array.isArray(rights.roles)) for(const item of rights.roles) assignedRoles.add(norm(item));
  if(rights["Mod Tehnician"]===true || rights["mod tehnician"]===true) assignedRoles.add("tehnician");
  const role=norm(req.headers.get("x-ofresh-role")||primaryRole);
  if(!assignedRoles.has(role) || !Object.prototype.hasOwnProperty.call(READ_ROLES,role)) return new Response(JSON.stringify({success:false,error:"Rol OFRESH necunoscut sau neautorizat pentru acest cont."}),{status:403,headers:CORS});
  if(action==="whoami") return Response.json({success:true,user:{id:authUser.id,email:authUser.email},profile},{headers:CORS});
  const isAdmin = role === "administrator" || role === "admin";
  if(action==="setMobilePin"){
    if(!isAdmin)throw new Error("Doar administratorul poate seta PIN-ul mobil.");
    const userId=String(body.userId||""),pin=String(body.pin||"");
    if(!/^[0-9]{6,12}$/.test(pin))throw new Error("PIN-ul trebuie sa contina intre 6 si 12 cifre.");
    const {data:target,error:targetErr}=await sb.from("profiluri").select("id,rol,telefon,activ").eq("id",userId).maybeSingle();
    if(targetErr||!target||target.activ===false||!["tehnician","filer"].includes(norm(target.rol)))throw new Error("Utilizator mobil activ negasit.");
    const phone=normalizeMobilePhone(String(target.telefon||""));
    if(!/^\+40[0-9]{9}$/.test(phone))throw new Error("Profilul nu are un numar de telefon valid.");
    await newMobileCredential(userId,phone,pin,sb);
    return Response.json({success:true,message:"PIN mobil actualizat."},{headers:CORS});
  }
  const isFiler = role === "filer";
  const isTech = role === "tehnician" || role === "technician";
  if(action==="filerAssignmentData"){
    if(!isAdmin) throw new Error("Doar administratorul poate gestiona alocarile Filer.");
    const [{data:filers,error:filerErr},{data:machines,error:machineErr}]=await Promise.all([
      sb.from("profiluri").select("id,nume,telefon,aparate_asignate").eq("rol","filer").eq("activ",true).order("nume"),
      sb.from("aparate").select("id,cod_ofresh,client_nume,locatie,model,serie,zona,tip_aparat,tip_echipament,status").eq("status","Activ").eq("tip_echipament","esp").order("client_nume")
    ]);
    if(filerErr) throw filerErr;
    if(machineErr) throw machineErr;
    return Response.json({success:true,filers:filers||[],machines:machines||[]},{headers:CORS});
  }
  if(action==="setFilerMachines"){
    if(!isAdmin) throw new Error("Doar administratorul poate modifica alocarile Filer.");
    const userId=String(body.userId||"");
    const ids=Array.isArray(body.aparatIds)?Array.from(new Set(body.aparatIds.map((x:any)=>String(x)))):[];
    if(!userId) throw new Error("Lipseste utilizatorul Filer.");
    const {data:target,error:targetErr}=await sb.from("profiluri").select("id,rol,activ").eq("id",userId).maybeSingle();
    if(targetErr||!target||norm(target.rol)!=="filer"||target.activ===false) throw new Error("Profil Filer activ negasit.");
    if(ids.length){
      const {data:valid,error:validErr}=await sb.from("aparate").select("id").in("id",ids).eq("status","Activ").eq("tip_echipament","esp");
      if(validErr) throw validErr;
      if((valid||[]).length!==ids.length) throw new Error("Lista contine aparate inactive sau care nu sunt espressoare.");
    }
    const {data:updated,error:updateErr}=await sb.from("profiluri").update({aparate_asignate:ids}).eq("id",userId).select("id,aparate_asignate").single();
    if(updateErr) throw updateErr;
    return Response.json({success:true,assignment:updated},{headers:CORS});
  }
  if(action==="listMobileLinkedUsers"){
    if(!isAdmin)throw new Error("Doar administratorul poate vedea utilizatorii mobili.");
    const {data:rows,error}=await sb.from("profiluri").select("id,nume,rol,telefon").in("rol",["tehnician","filer"]).eq("activ",true).order("nume");
    if(error)throw error;
    return Response.json({success:true,users:rows||[]},{headers:CORS});
  }
  if(action==="listMobileProvisionCandidates"){
    if(!isAdmin) throw new Error("Doar administratorul poate vedea lista de utilizatori.");
    const [{data:techRows,error:techErr},{data:filerRows,error:filerErr}]=await Promise.all([
      sb.from("tehnicieni").select("id,nume,telefon,status,user_id").eq("status","Activ").is("user_id",null).not("telefon","is",null).order("nume"),
      sb.from("utilizatori_aplicatie").select("id,nume,telefon,status,auth_user_id").eq("rol","filer").eq("status","Activ").is("auth_user_id",null).not("telefon","is",null).order("nume")
    ]);
    if(techErr) throw techErr;
    if(filerErr) throw filerErr;
    const candidates=[
      ...(techRows||[]).map((x:any)=>({id:x.id,nume:x.nume,telefon:x.telefon,tip:"tehnician"})),
      ...(filerRows||[]).map((x:any)=>({id:x.id,nume:x.nume,telefon:x.telefon,tip:"filer"}))
    ];
    return Response.json({success:true,candidates},{headers:CORS});
  }
  if(action==="provisionMobileUser"){
    if(!isAdmin) throw new Error("Doar administratorul poate seta accesul mobil.");
    const personType=norm(body.personType);
    const rawPhone=String(body.phone||"").replace(/[^0-9+]/g,"");
    const phone=rawPhone.startsWith("+")?rawPhone:(rawPhone.startsWith("0")?"+4"+rawPhone:"+40"+rawPhone);
    const pin=String(body.pin||"");
    if(!/^\+40[0-9]{9}$/.test(phone)) throw new Error("Numarul de telefon trebuie sa fie din Romania si valid.");
    if(!/^[0-9]{6,12}$/.test(pin)) throw new Error("PIN-ul trebuie sa contina intre 6 si 12 cifre.");
    let displayName="", rights:any={}, cities:any=[], equipment:any=[], zones:any=[], appUser:any=null, tech:any=null;
    if(personType==="tehnician"){
      const {data,error}=await sb.from("tehnicieni").select("*").eq("telefon",rawPhone.replace(/^\+40/,"0")).eq("status","Activ").limit(2);
      if(error) throw error;
      if(!data||data.length!==1) throw new Error("Nu am gasit exact un tehnician activ cu acest numar de telefon.");
      tech=data[0]; if(tech.user_id) throw new Error("Tehnicianul are deja un cont mobil asociat."); displayName=tech.nume;
      const {data:appRows,error:appErr}=await sb.from("utilizatori_aplicatie").select("*").eq("rol","tehnician").eq("status","Activ").eq("nume",displayName).limit(2);
      if(appErr) throw appErr;
      appUser=(appRows||[]).length===1?appRows[0]:null;
      if(appUser?.auth_user_id) throw new Error("Utilizatorul are deja un cont mobil asociat.");
      rights=appUser?.drepturi||{};
      cities=appUser?.orase_acces||[]; equipment=appUser?.tip_echipament_acces||[]; zones=appUser?.zone_aparate_acces||[];
    }else if(personType==="filer"){
      const {data,error}=await sb.from("utilizatori_aplicatie").select("*").eq("rol","filer").eq("status","Activ").eq("telefon",rawPhone.replace(/^\+40/,"0")).limit(2);
      if(error) throw error;
      if(!data||data.length!==1) throw new Error("Nu am gasit exact un cont Filer activ cu acest numar de telefon.");
      appUser=data[0]; if(appUser.auth_user_id) throw new Error("Filerul are deja un cont mobil asociat."); displayName=appUser.nume; rights=appUser.drepturi||{};
      cities=appUser.orase_acces||[]; equipment=appUser.tip_echipament_acces||[]; zones=appUser.zone_aparate_acces||[];
    }else throw new Error("Tip de utilizator mobil invalid.");
    const {data:created,error:createErr}=await sb.auth.admin.createUser({phone,password:pin,phone_confirm:true,user_metadata:{nume:displayName,rol:personType}});
    if(createErr) throw new Error("Nu am putut crea accesul mobil: "+createErr.message);
    const userId=created.user.id;
    const {error:profileUpsertErr}=await sb.from("profiluri").upsert({
      id:userId,nume:displayName,rol:personType,activ:true,email:null,telefon:phone,drepturi:rights,
      orase_acces:cities,tip_echipament_acces:equipment,zone_aparate_acces:zones,
      source_data:{provisioned_from:"ofresh_admin_mobile",provisioned_at:new Date().toISOString()}
    },{onConflict:"id"});
    if(profileUpsertErr){await sb.auth.admin.deleteUser(userId);throw profileUpsertErr;}
    try{await newMobileCredential(userId,phone,pin,sb);}catch(credentialErr){await sb.auth.admin.deleteUser(userId);await sb.from("profiluri").delete().eq("id",userId);throw credentialErr;}
    if(tech){
      const {data:linkedTech,error:linkErr}=await sb.from("tehnicieni").update({user_id:userId}).eq("id",tech.id).is("user_id",null).select("id").maybeSingle();
      if(linkErr||!linkedTech){await sb.auth.admin.deleteUser(userId);await sb.from("profiluri").delete().eq("id",userId);throw linkErr||new Error("Legatura tehnicianului s-a modificat intre timp. Nu s-a creat contul.");}
    }
    if(appUser){
      const {data:linkedAppUser,error:linkErr}=await sb.from("utilizatori_aplicatie").update({auth_user_id:userId}).eq("id",appUser.id).is("auth_user_id",null).select("id").maybeSingle();
      if(linkErr||!linkedAppUser){if(tech) await sb.from("tehnicieni").update({user_id:null}).eq("id",tech.id).eq("user_id",userId);await sb.auth.admin.deleteUser(userId);await sb.from("profiluri").delete().eq("id",userId);throw linkErr||new Error("Legatura utilizatorului s-a modificat intre timp. Nu s-a creat contul.");}
    }
    return Response.json({success:true,user:{id:userId,nume:displayName,rol:personType,telefon:phone}},{headers:CORS});
  }
  // `interventii.tehnician_id` references `auth.users.id` (enforced by its FK).
  // `tehnicieni.user_id` is the explicit link used to resolve the technician display record.
  // Never infer or auto-link a technician by name/phone.
  let technicianRecord:any=null;
  if(isTech){
    const {data:techRows,error:techErr}=await sb.from("tehnicieni").select("*").eq("user_id",authUser.id).limit(2);
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
    if(role==="tehnician" && (name==="Aparate" || name==="Filtre")){
      const machines=await allRows(sb,"aparate"), locs=await allRows(sb,"locatii");
      const byId=new Map(locs.map((x:any)=>[String(x.id),x]));
      const cities=arr(profile.orase_acces).map(norm), types=arr(profile.tip_echipament_acces), zones=arr(profile.zone_aparate_acces).map(norm);
      const visibleIds=new Set(machines.filter((m:any)=>{
        if(!machineIsActive(m)) return false;
        const loc=byId.get(String(m.locatie_id||""));
        const city=norm(loc?.oras||m.source_data?.Oras||m.source_data?.oras);
        return (!cities.length||cities.includes(city)) &&
          (!types.length||equipmentMatches(types,m.tip_echipament||m.tip_aparat)) &&
          (!zones.length||zones.includes(norm(m.zona)));
      }).map((m:any)=>String(m.id)));
      if(name==="Aparate") rows=rows.filter((m:any)=>visibleIds.has(String(m.id)));
      if(name==="Filtre") rows=rows.filter((f:any)=>f.aparat_id && visibleIds.has(String(f.aparat_id)));
    }
    if(role==="filer" && name==="Locatii"){
      const machines=await allRows(sb,"aparate"), byLoc=new Map<string,any[]>();
      for(const m of machines){const a=byLoc.get(m.locatie_id)||[];a.push(m);byLoc.set(m.locatie_id,a);}
      rows=rows.filter((l:any)=>(byLoc.get(l.id)||[]).some((m:any)=>filerAllows(profile,m,l)));
    }
    if(role==="filer" && name==="Clienti"){
      const [machines,locations]=await Promise.all([allRows(sb,"aparate"),allRows(sb,"locatii")]);
      const allowedLocationIds=new Set(machines.filter((m:any)=>filerAllows(profile,m,locations.find((l:any)=>String(l.id)===String(m.locatie_id)))).map((m:any)=>String(m.locatie_id)));
      const allowedClientIds=new Set(locations.filter((l:any)=>allowedLocationIds.has(String(l.id))&&l.client_id).map((l:any)=>String(l.client_id)));
      rows=rows.filter((c:any)=>allowedClientIds.has(String(c.id)));
    }
    if(role==="tehnician" && (name==="Locatii" || name==="Clienti")){
      const [machines,locations]=await Promise.all([allRows(sb,"aparate"),allRows(sb,"locatii")]);
      const cities=arr(profile.orase_acces).map(norm), types=arr(profile.tip_echipament_acces), zones=arr(profile.zone_aparate_acces).map(norm);
      const visibleLocationIds=new Set(machines.filter((m:any)=>{
        if(!machineIsActive(m)) return false;
        const loc=locations.find((l:any)=>String(l.id)===String(m.locatie_id||""));
        const city=norm(loc?.oras||m.source_data?.Oras||m.source_data?.oras);
        return (!cities.length||cities.includes(city)) && (!types.length||equipmentMatches(types,m.tip_echipament||m.tip_aparat)) && (!zones.length||zones.includes(norm(m.zona)));
      }).map((m:any)=>String(m.locatie_id)));
      if(name==="Locatii") rows=rows.filter((l:any)=>visibleLocationIds.has(String(l.id)));
      if(name==="Clienti"){
        const visibleClientIds=new Set(locations.filter((l:any)=>visibleLocationIds.has(String(l.id))&&l.client_id).map((l:any)=>String(l.client_id)));
        rows=rows.filter((c:any)=>visibleClientIds.has(String(c.id)));
      }
    }
    if(role==="tehnician" && name==="Interventii") rows=rows.filter((v:any)=>String(v.tehnician_id||"")===String(authUser.id));
    if(role==="tehnician" && name==="PozeInterventii"){
      const visits=await allRows(sb,"interventii");
      const ownVisitIds=new Set(visits.filter((v:any)=>String(v.tehnician_id||"")===String(authUser.id)).map((v:any)=>String(v.id)));
      rows=rows.filter((p:any)=>p.interventie_id && ownVisitIds.has(String(p.interventie_id)));
    }
    if(role==="filer" && name==="InterventiiEspressoare"){
      const assignedIds=new Set(arr(profile.aparate_asignate).map((x:any)=>String(x)));
      rows=rows.filter((r:any)=>r.aparat_id && assignedIds.has(String(r.aparat_id)));
    }
    if(role==="comercial" && name==="Aparate") rows=rows.filter((m:any)=>m.status!=="Retras");
    // Commercial users may see only filter-change history, never the full technician service log.
    if(role==="comercial" && name==="Interventii") rows=rows.filter((v:any)=>v.filtru_schimbat===true);
    if(role==="comercial" && name==="PozeInterventii") {
      const visits=await allRows(sb,"interventii");
      const allowedVisits=new Set(visits.filter((v:any)=>v.filtru_schimbat===true).map((v:any)=>String(v.id)));
      rows=rows.filter((p:any)=>p.interventie_id && allowedVisits.has(String(p.interventie_id)));
    }
    if(role==="filer" && name==="PozeInterventiiEspressoare") {
      const visits=await allRows(sb,"interventii_espressoare");
      const assignedIds=new Set(arr(profile.aparate_asignate).map((x:any)=>String(x)));
      const visible=new Set(visits.filter((v:any)=>v.aparat_id && assignedIds.has(String(v.aparat_id))).map((v:any)=>v.id));
      rows=rows.filter((r:any)=>visible.has(r.interventie_id));
    }
    if(name==="PozeInterventii" || name==="PozeInterventiiEspressoare") {
      rows=await Promise.all(rows.map(async(r:any)=>{
        if(!r.storage_path) return r;
        const {data,error}=await sb.storage.from(PHOTO_BUCKET).createSignedUrl(r.storage_path,3600);
        return {...r,signed_url:error?null:data?.signedUrl||null};
      }));
    }
    if(name==="Aparate"){
      const locs=await allRows(sb,"locatii");
      const byId=new Map(locs.map((loc:any)=>[String(loc.id),loc]));
      rows=rows.map((m:any)=>{const loc=byId.get(String(m.locatie_id||""));return {...m,oras:loc?.oras??null,judet:loc?.judet??null};});
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
    // Dashboard queries use the service-role client, so explicitly mirror each role's row scope.
    const scopedInterventions=()=>{
      let q=sb.from("interventii");
      if(role==="comercial") q=q.eq("filtru_schimbat",true);
      else if(isTech) q=q.eq("tehnician_id",authUser.id);
      return q;
    };
    const [machines,locations,filters,recentResult,countResult]=await Promise.all([
      fetchSheet("Aparate"),
      fetchSheet("Locatii"),
      allowed.includes("Filtre")?fetchSheet("Filtre"):Promise.resolve([]),
      allowed.includes("Interventii")
        ? scopedInterventions().select("*").order("data_interventie",{ascending:false}).limit(6)
        : Promise.resolve({data:[],error:null}),
      allowed.includes("Interventii")
        ? scopedInterventions().select("id",{count:"exact",head:true})
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
      // Attach authoritative location fields so the commercial history can be filtered/exported by county.
      const [locations,machines]=await Promise.all([allRows(sb,"locatii"),allRows(sb,"aparate")]);
      const locationById=new Map(locations.map((x:any)=>[String(x.id),x]));
      const machineById=new Map(machines.map((x:any)=>[String(x.id),x]));
      data.Interventii=data.Interventii.map((visit:any)=>{
        const machine=machineById.get(String(visit["ID Aparat"]||""));
        const location=locationById.get(String(visit["ID Locatie"]||machine?.locatie_id||""));
        return {...visit,Client:visit.Client||location?.nume_client||location?.nume||machine?.client_nume||"",Locatie:location?.nume||"",Adresa:location?.adresa||visit.Adresa||"",Oras:location?.oras||"",Judet:location?.judet||"",Zona:location?.zona||machine?.zona||""};
      });
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
  if(action==="findAparat" || action==="searchAparate"){
    const term=String(body.searchText||body.codOfresh||body.serie||"").trim();
    if(!term) throw new Error("Introdu Cod OFRESH, seria, clientul sau modelul aparatului.");
    if(!allowed.includes("Aparate")) throw new Error("Acces interzis.");
    if(!isTech && !isFiler && !isAdmin) throw new Error("Cautarea aparatelor nu este permisa pentru acest rol.");
    const needle=norm(term);
    const machines=await allRows(sb,"aparate");
    const locations=await allRows(sb,"locatii");
    const locById=new Map(locations.map((x:any)=>[String(x.id),x]));
    const matches=machines.filter((m:any)=>{
      if(!machineIsActive(m)) return false;
      const loc=locById.get(String(m.locatie_id||""));
      if(isFiler && !filerAllows(profile,m,loc)) return false;
      if(isTech){
        const cities=arr(profile.orase_acces).map(norm), types=arr(profile.tip_echipament_acces), zones=arr(profile.zone_aparate_acces).map(norm);
        const city=norm(loc?.oras||m.source_data?.Oras||m.source_data?.oras);
        if(cities.length&&!cities.includes(city)) return false;
        if(types.length&&!equipmentMatches(types,m.tip_echipament||m.tip_aparat)) return false;
        if(zones.length&&!zones.includes(norm(m.zona))) return false;
      }
      const sd=source(m);
      const fields=[m.qr_token,m.cod_ofresh,m.cod_id,m.serie,m.client_nume,m.locatie,m.producator,m.model,m.zona,loc?.nume,loc?.adresa,loc?.oras,sd["Cod OFRESH"],sd["ID Aparat"],sd["Serie"],sd["Nume locatie"],sd["Client"],sd["Adresa"]];
      return fields.some(v=>norm(v).includes(needle));
    });
    matches.sort((a:any,b:any)=>{
      const exact=(m:any)=>[m.qr_token,m.cod_ofresh,m.cod_id,m.serie].some(v=>norm(v)===needle)?0:1;
      return exact(a)-exact(b) || String(a.client_nume||a.locatie||"").localeCompare(String(b.client_nume||b.locatie||""),"ro");
    });
    const data=matches.slice(0,30).map((m:any)=>legacy("Aparate",m));
    return Response.json({success:true,found:data.length>0,aparat:data.length===1?data[0]:null,results:data,total:matches.length},{headers:CORS});
  }
  if(action==="interventionExportData"){
    if(!isAdmin) throw new Error("Exportul complet al interventiilor este rezervat administratorului.");
    const [interventions,photos]=await Promise.all([fetchSheet("Interventii"),fetchSheet("PozeInterventii")]);
    const byVisit=new Map<string,string[]>();
    for(const photo of photos){const id=String(photo["ID Interventie"]||"");if(!id)continue;const list=byVisit.get(id)||[];if(photo["URL poza"])list.push(photo["URL poza"]);byVisit.set(id,list);}
    return Response.json({success:true,data:{Interventii:interventions.map((r:any)=>({...r,Fotografii:(byVisit.get(String(r["ID Interventie"]||""))||[]).join("\n"),"Numar fotografii":(byVisit.get(String(r["ID Interventie"]||""))||[]).length}))}},{headers:CORS});
  }
  if(action==="mobileInterventionHistory"){
    if(!isTech && !isFiler && !isAdmin) throw new Error("Acces interzis.");
    const limit=Math.max(1,Math.min(100,Number(body.limit)||50));
    let visits:any[]=[];
    if(isTech || isAdmin){
      let q=sb.from("interventii").select("*").order("data_interventie",{ascending:false}).limit(limit);
      if(isTech) q=q.eq("tehnician_id",authUser.id);
      const {data,error}=await q; if(error) throw error; visits.push(...(data||[]).map((r:any)=>({kind:"tehnician",...legacy("Interventii",r)})));
    }
    if(isFiler || isAdmin){
      let q=sb.from("interventii_espressoare").select("*").order("data_interventie",{ascending:false}).limit(limit);
      if(isFiler) q=q.eq("technician_profile_id",authUser.id);
      const {data,error}=await q; if(error) throw error; visits.push(...(data||[]).map((r:any)=>({kind:"filer",...legacy("InterventiiEspressoare",r)})));
    }
    visits.sort((a:any,b:any)=>new Date(b.Data||b["Data interventie"]||0).getTime()-new Date(a.Data||a["Data interventie"]||0).getTime());
    const ids=visits.map((v:any)=>String(v["ID Interventie"]||"")).filter(Boolean);
    const photos:any[]=[];
    if(ids.length){
      const [standard,espresso]=await Promise.all([
        (isTech||isAdmin)?sb.from("poze_interventii").select("*").in("interventie_id",ids):Promise.resolve({data:[],error:null}),
        (isFiler||isAdmin)?sb.from("poze_interventii_espressoare").select("*").in("interventie_id",ids):Promise.resolve({data:[],error:null})
      ]);
      if(standard.error) throw standard.error; if(espresso.error) throw espresso.error;
      for(const row of [...(standard.data||[]),...(espresso.data||[])]){
        let url=row.file_url||null;
        if(row.storage_path){const signed=await sb.storage.from(PHOTO_BUCKET).createSignedUrl(row.storage_path,3600);url=signed.error?null:signed.data?.signedUrl||null;}
        photos.push({interventie_id:row.interventie_id,url,file_name:row.file_name,categorie:row.categorie||"",numar_poza:row.numar_poza||1});
      }
    }
    const byVisit=new Map<string,any[]>();
    for(const p of photos){const k=String(p.interventie_id);const list=byVisit.get(k)||[];list.push(p);byVisit.set(k,list);}
    return Response.json({success:true,visits:visits.map((v:any)=>({...v,photos:byVisit.get(String(v["ID Interventie"]))||[]}))},{headers:CORS});
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
    return Response.json({success:true,user:{id:authUser.id,nume:profile.nume,rol:profile.rol},allowedZones:profile.zone_aparate_acces||[],allowedEquipmentTypes:profile.tip_echipament_acces||[],locations:locationsOut,totalLocations:locationsOut.length,totalMachines:locationsOut.reduce((n:number,l:any)=>n+l.machines.length,0)},{headers:CORS});
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
  if(action==="checkFilterStock"){
    if(!isTech || !technicianRecord) throw new Error("Actiunea este disponibila doar unui tehnician asociat explicit contului Auth.");
    const filterType=String(body.filterType||body.tipFiltru||"").trim();
    if(!filterType) throw new Error("Selecteaza tipul filtrului.");
    const {data:rows,error}=await sb.from("stoc").select("*").order("source_id",{ascending:true});
    if(error) throw error;
    const matching=(rows||[]).filter((x:any)=>norm(x.denumire)===norm(filterType)||norm(x.cod_produs)===norm(filterType)||norm(x.source_data?.Produs)===norm(filterType));
    if(!matching.length) throw new Error("Filtrul selectat nu exista in stoc.");
    if(matching.length>1) throw new Error("Exista mai multe pozitii de stoc pentru acest filtru. Administratorul trebuie sa clarifice depozitul/pozitia inainte de consum.");
    const stock=matching[0];
    const entered=Number(stock.cantitate_intrata??stock.cantitate??0)||0;
    const consumed=Number(stock.consum??stock.source_data?.Consum??0)||0;
    const available=Math.max(0,entered-consumed);
    if(available<=0) throw new Error("Filtrul selectat nu mai exista in stoc.");
    return Response.json({success:true,stockId:stock.id,available,filterType},{headers:CORS});
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
    const payload:any={technician_profile_id:authUser.id,source_data:{photo_upload_token_hash:await sha256(photoToken),photo_owner_auth_id:authUser.id,photo_upload_expires_at:new Date(Date.now()+3600_000).toISOString(),expected_photo_count:expectedPhotoCount},data_interventie:body.data?new Date(String(body.data)+"T12:00:00").toISOString():new Date().toISOString(),client:machine.client_nume||location?.nume_client||location?.nume||"",adresa:machine.adresa||location?.adresa||"",oras:location?.oras||"",judet:location?.judet||"",cod_ofresh:machine.cod_ofresh,serie_aparat:machine.serie,producator:machine.producator,tip_aparat:machine.tip_aparat||machine.model,operatiuni:cleanTasks,observatii:String(body.observatii||""),...flags,numar_fotografii:0,zona_aparate:machine.zona,tip_echipament:machine.tip_echipament,aparat_id:machine.id,client_id:location?.client_id||null,locatie_id:machine.locatie_id};
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
    if(String(visit.technician_profile_id||"")!==authUser.id || String(meta.photo_owner_auth_id||"")!==authUser.id || meta.photo_upload_token_hash!==await sha256(tokenValue) || !meta.photo_upload_expires_at || Date.now()>Date.parse(meta.photo_upload_expires_at)) throw new Error("Autorizarea fotografiilor este invalida sau expirata.");
    await validateCurrentEspressoVisitMachine(sb,visit,profile,isFiler);
    if(photoIndex>Number(meta.expected_photo_count||0)) throw new Error("Numarul fotografiei depaseste selectia salvata.");
    const path=`tmp/${visitId}/${uploadId}/${chunkIndex}.b64`;
    const {error:uploadErr}=await sb.storage.from(PHOTO_BUCKET).upload(path,new TextEncoder().encode(chunk),{contentType:"image/jpeg",upsert:true});
    if(uploadErr) throw new Error("Nu am putut salva fragmentul foto: "+uploadErr.message);
    const {error:updateErr}=await sb.from("interventii_espressoare").update({source_data:{...meta,photo_upload_token_hash:meta.photo_upload_token_hash,photo_owner_auth_id:authUser.id,expected_photo_count:meta.expected_photo_count,photo_uploads:{...(meta.photo_uploads||{}),[uploadId]:{totalChunks,photoIndex}}}}).eq("id",visitId);
    if(updateErr) throw updateErr;
    return Response.json({success:true,chunkIndex,totalChunks},{headers:CORS});
  }
  if(action==="filerFinalizePhotoUpload" || action==="filerFinalizePhotoUploads"){
    if(!isFiler && !isAdmin) throw new Error("Acces interzis.");
    const visitId=String(body.visitId||"").trim(), tokenValue=String(body.photoToken||"").trim();
    const {data:visit,error:visitErr}=await sb.from("interventii_espressoare").select("*").eq("id",visitId).maybeSingle();
    if(visitErr||!visit) throw new Error("Interventia nu a fost gasita.");
    const meta=source(visit);
    if(String(visit.technician_profile_id||"")!==authUser.id || String(meta.photo_owner_auth_id||"")!==authUser.id || meta.photo_upload_token_hash!==await sha256(tokenValue) || !meta.photo_upload_expires_at || Date.now()>Date.parse(meta.photo_upload_expires_at)) throw new Error("Autorizarea fotografiilor este invalida sau expirata.");
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
      const row={interventie_id:visitId,source_id:null,filer:profile.nume||authUser.email||"",client:visit.client||"",aparat:[visit.tip_aparat,visit.serie_aparat].filter(Boolean).join(" - "),categorie:category,storage_path:objectPath,file_name:fileName,file_url:null,numar_poza:photoIndex,mime_type:mimeType,file_size_bytes:bytes.byteLength,taken_at:item.takenAt||null,data_incarcare:new Date().toISOString(),source_data:{storage_bucket:PHOTO_BUCKET,uploaded_by:authUser.id}};
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
  if(action==="saveGpsLocation"){
    if(!isAdmin) throw new Error("Doar administratorul poate actualiza GPS-ul si adresa locatiei.");
    const locationId=String(body.locationId||"").trim();
    const record=body.locationRecord&&typeof body.locationRecord==="object"?body.locationRecord:{};
    if(!locationId||!/^[0-9a-f-]{36}$/i.test(locationId)||String(record["ID Locatie"]||"")!==locationId) throw new Error("ID locatie invalid sau neconcordant.");
    const lat=Number(record.Latitudine),lng=Number(record.Longitudine),accuracy=Math.max(0,Number(record["GPS precizie"]||0));
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat > 90||lng < -180||lng > 180) throw new Error("Coordonate GPS invalide.");
    const {data:loc,error:locErr}=await sb.from("locatii").select("id,client_id").eq("id",locationId).maybeSingle();
    if(locErr||!loc) throw new Error("Locatia nu a fost gasita.");
    const stamp=String(record["GPS actualizat"]||new Date().toISOString());
    const address=String(record.Adresa||"").trim();
    const locationUpdate:any={latitudine:lat,longitudine:lng,gps_actualizat:stamp,gps_actualizat_la:stamp,gps_precizie:accuracy};
    if(address) locationUpdate.adresa=address;
    if(record.Oras) locationUpdate.oras=String(record.Oras);
    if(record.Judet) locationUpdate.judet=String(record.Judet);
    if(record.Zona) locationUpdate.zona=String(record.Zona);
    const {error:updateLocErr}=await sb.from("locatii").update(locationUpdate).eq("id",locationId);
    if(updateLocErr) throw updateLocErr;
    const machineUpdate:any={gps_latitudine:lat,gps_longitudine:lng,gps_precizie_m:accuracy,gps_actualizat_la:stamp};
    if(address) machineUpdate.adresa=address;
    if(record.Zona) machineUpdate.zona=String(record.Zona);
    const {error:updateMachinesErr}=await sb.from("aparate").update(machineUpdate).eq("locatie_id",locationId);
    if(updateMachinesErr) throw updateMachinesErr;
    if(loc.client_id){
      const clientUpdate:any={latitudine:lat,longitudine:lng};
      if(address) clientUpdate.adresa=address;
      if(record.Oras) clientUpdate.oras=String(record.Oras);
      if(record.Judet) clientUpdate.judet=String(record.Judet);
      const {error:updateClientErr}=await sb.from("clienti").update(clientUpdate).eq("id",loc.client_id);
      if(updateClientErr) throw updateClientErr;
    }
    return Response.json({success:true,message:"GPS si adresa locatiei au fost actualizate."},{headers:CORS});
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
    const sourceData={...record,legacy_intervention_id:legacyId||null,created_via:"legacy_add_technician",created_by_auth_id:authUser.id};
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
      data_interventie:record.Data && /^\\d{4}-\\d{2}-\\d{2}$/.test(String(record.Data)) ? new Date(String(record.Data)+"T12:00:00").toISOString() : now,
      tehnician_id:authUser.id,
      tehnician:technicianRecord?.nume||profile.nume||authUser.email||"",
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
    if(String(visit.tehnician_id||"")!==String(authUser.id)) throw new Error("Nu poti actualiza filtrul pentru interventia altui tehnician.");
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
    // Validate the exact stock row before changing filter history, so a stale
    // or mismatched stock selection cannot leave a filter update behind.
    const preflightStockId=String(body.stockId||"").trim();
    if(!preflightStockId) throw new Error("Lipseste pozitia exacta de stoc verificata inainte de interventie.");
    const {data:preflightStockRows,error:preflightStockErr}=await sb.from("stoc").select("*").eq("id",preflightStockId).limit(1);
    if(preflightStockErr) throw preflightStockErr;
    const preflightStock=(preflightStockRows||[])[0];
    if(!preflightStock) throw new Error("Pozitia de stoc selectata nu mai exista. Reincarca stocul si reia verificarea.");
    if(!(norm(preflightStock.denumire)===norm(filterType)||norm(preflightStock.cod_produs)===norm(filterType)||norm(preflightStock.source_data?.Produs)===norm(filterType))) throw new Error("Pozitia de stoc selectata nu corespunde tipului de filtru montat.");
    const preflightEntered=Number(preflightStock.cantitate_intrata??preflightStock.cantitate??0);
    const preflightConsumed=Number(preflightStock.consum||0);
    const preflightSource=preflightStock.source_data&&typeof preflightStock.source_data==="object"?preflightStock.source_data:{};
    const preflightDone=Array.isArray(preflightSource.processed_filter_intervention_ids)&&preflightSource.processed_filter_intervention_ids.includes(marker);
    if(!preflightDone && preflightEntered-preflightConsumed<=0) throw new Error("Filtrul nu mai exista in stoc.");
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

    const {data:stockRows,error:stockReadErr}=await sb.from("stoc").select("*").order("source_id",{ascending:true});
    if(stockReadErr) throw stockReadErr;
    const stockId=String(body.stockId||"").trim();
    if(!stockId) throw new Error("Lipseste pozitia exacta de stoc verificata inainte de interventie.");
    const stock=(stockRows||[]).find((s:any)=>String(s.id)===stockId);
    if(!stock) throw new Error("Pozitia de stoc selectata nu mai exista. Reincarca stocul si reia verificarea.");
    if(!(norm(stock.denumire)===norm(filterType)||norm(stock.cod_produs)===norm(filterType)||norm(stock.source_data?.Produs)===norm(filterType))) throw new Error("Pozitia de stoc selectata nu corespunde tipului de filtru montat.");
    const stockEntered=Number(stock.cantitate_intrata??stock.cantitate??0);
    const stockConsumed=Number(stock.consum||0);
    if(stockEntered-stockConsumed<=0) throw new Error("Filtrul nu mai exista in stoc.");
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

  if(action==="filerEnsureAccessColumns"){
    if(!isAdmin) throw new Error("Doar administratorul poate verifica structura accesului Filer.");
    return Response.json({success:true,alreadyConfigured:true,columns:["orase_acces","tip_echipament_acces","zone_aparate_acces","aparate_asignate"]},{headers:CORS});
  }
  if(action==="importAparateBatch"){
    if(!isAdmin) throw new Error("Importul aparatelor este permis doar Administratorului.");
    let records:any[]=[];
    try{records=Array.isArray(body.records)?body.records:JSON.parse(String(body.records||"[]"));}catch{throw new Error("Lista aparatelor pentru import nu este valida.");}
    if(!records.length) return Response.json({success:true,inserted:0,duplicates:0,failed:0,errors:[]},{headers:CORS});
    if(records.length>150) throw new Error("Trimite maximum 150 de aparate intr-un lot.");
    const normalized=records.map((record:any)=>({record,legacyId:String(record?.["ID Aparat"]||record?.["Cod ID"]||record?.cod_id||"").trim()}));
    if(normalized.some(x=>!x.legacyId)) throw new Error("Fiecare aparat trebuie sa aiba un ID original.");
    const batchIds=new Set<string>();
    const unique=normalized.filter(x=>{const k=x.legacyId.toLocaleLowerCase("ro");if(batchIds.has(k))return false;batchIds.add(k);return true;});
    const ids=unique.map(x=>x.legacyId);
    const existingIds=new Set<string>();
    for(let p=0;p<ids.length;p+=100){
      const part=ids.slice(p,p+100);
      const {data,error}=await sb.from("aparate").select("cod_id").in("cod_id",part);
      if(error) throw error;
      for(const row of data||[]) if(row.cod_id) existingIds.add(String(row.cod_id).toLocaleLowerCase("ro"));
    }
    const fresh=unique.filter(x=>!existingIds.has(x.legacyId.toLocaleLowerCase("ro")));
    const insertedIds:string[]=[];
    for(let p=0;p<fresh.length;p+=50){
      const mapped=fresh.slice(p,p+50).map(x=>legacyPayload("Aparate",x.record,x.legacyId).row);
      const {data,error}=await sb.from("aparate").insert(mapped).select("id,cod_id");
      if(error) throw new Error("Lotul "+(Math.floor(p/50)+1)+" nu a fost salvat: "+error.message);
      for(const row of data||[]) insertedIds.push(String(row.cod_id||""));
    }
    return Response.json({success:true,inserted:insertedIds.length,duplicates:normalized.length-fresh.length,failed:0,errors:[],insertedIds},{headers:CORS});
  }
  if(["add","update","delete"].includes(action) && body.sheet && String(body.sheet)!=="Interventii"){
    if(!isAdmin) throw new Error("Operatiunea este permisa doar administratorului.");
    const sheet=String(body.sheet).trim();
    if(!TABLES[sheet] || ["InterventiiEspressoare","PozeInterventii","PozeInterventiiEspressoare"].includes(sheet)) throw new Error("Modulul nu permite aceasta operatie.");
    if(action==="delete"){
      const key=String(body.idValue||body.id||"").trim();
      const row=await resolveLegacyRow(sb,sheet,key);

      // Protect the customer -> location -> machine chain. A customer with
      // any machine in one of its locations cannot be deleted.
      if(sheet==="Clienti"){
        const {data:locations,error:locationsError}=await sb.from("locatii").select("id").eq("client_id",row.id);
        if(locationsError) throw locationsError;
        const locationIds=(locations||[]).map((x:any)=>x.id);
        if(locationIds.length){
          const {data:machines,error:machinesError}=await sb.from("aparate").select("id").in("locatie_id",locationIds);
          if(machinesError) throw machinesError;
          if((machines||[]).length) throw new Error("Clientul are aparate asociate. Stergerea este blocata; aparatele si istoricul lor raman intacte.");
        }
      }

      // Never allow machine deletion to cascade into standard intervention
      // history. Retire/deactivate the machine instead.
      if(sheet==="Aparate"){
        const [{count:standardCount,error:standardError},{count:espressoCount,error:espressoError}]=await Promise.all([
          sb.from("interventii").select("id",{count:"exact",head:true}).eq("aparat_id",row.id),
          sb.from("interventii_espressoare").select("id",{count:"exact",head:true}).eq("aparat_id",row.id)
        ]);
        if(standardError) throw standardError;
        if(espressoError) throw espressoError;
        if((standardCount||0)+(espressoCount||0)>0) throw new Error("Aparatul are istoric de interventii. Stergerea este blocata; retrage aparatul din evidenta activa pentru a pastra istoricul.");
      }

      // Do not orphan machines, filters or intervention history by deleting a location.
      if(sheet==="Locatii"){
        const [{count:machineCount,error:machineError},{count:filterCount,error:filterError},{count:visitCount,error:visitError}]=await Promise.all([
          sb.from("aparate").select("id",{count:"exact",head:true}).eq("locatie_id",row.id),
          sb.from("filtre").select("id",{count:"exact",head:true}).eq("locatie_id",row.id),
          sb.from("interventii").select("id",{count:"exact",head:true}).eq("locatie_id",row.id)
        ]);
        if(machineError) throw machineError;
        if(filterError) throw filterError;
        if(visitError) throw visitError;
        if((machineCount||0)+(filterCount||0)+(visitCount||0)>0) throw new Error("Locatia are aparate, filtre sau interventii asociate. Stergerea este blocata pentru a pastra legaturile si istoricul.");
      }

      const {error}=await sb.from(TABLES[sheet]).delete().eq("id",row.id);
      if(error) throw error;
      return Response.json({success:true,deletedId:row.id},{headers:CORS});
    }
    let record:any={};
    try{record=typeof body.record==="string"?JSON.parse(body.record):body.record||{};}catch{throw new Error("Datele inregistrarii nu sunt valide.");}
    const candidateId=String(body.idValue||record[body.idField||""]||record["ID Sursa"]||record["ID Client"]||record["ID Locatie"]||record["ID Aparat"]||record["ID Filtru"]||record["ID Stoc"]||record["ID Tehnician"]||record["ID Utilizator"]||"").trim();
    const legacyId=/^[0-9a-f-]{36}$/i.test(candidateId)?String(record["ID Sursa"]||record.source_id||"").trim():candidateId;
    const mapped=legacyPayload(sheet,record,legacyId);
    if(action==="add"){
      if(sheet==="Clienti"&&!mapped.row.nume) throw new Error("Completeaza numele clientului.");
      if(sheet==="Locatii"&&!mapped.row.nume) throw new Error("Completeaza numele locatiei.");
      if(sheet==="Utilizatori"&&(!mapped.row.nume||!mapped.row.rol)) throw new Error("Completeaza numele si rolul utilizatorului.");
      if(sheet==="Tehnicieni"&&!mapped.row.nume) throw new Error("Completeaza numele tehnicianului.");
      const {data,error}=await sb.from(mapped.table).insert(mapped.row).select("*").single();
      if(error) throw error;
      return Response.json({success:true,record:legacy(sheet,data)},{headers:CORS});
    }
    const oldKey=String(body.idValue||record[body.idField||""]||record.id||"").trim();
    const existing=await resolveLegacyRow(sb,sheet,oldKey);
    const {data,error}=await sb.from(mapped.table).update({...mapped.row,source_data:{...(existing.source_data||{}),...(mapped.row.source_data||{})}}).eq("id",existing.id).select("*").single();
    if(error) throw error;
    return Response.json({success:true,record:legacy(sheet,data)},{headers:CORS});
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
    if(role==="filer" || role==="tehnician"){
      // Service-role reads must reproduce the same per-user scope as the RLS policies.
      // Filter before pagination so totals and later pages cannot expose other users' records.
      rows=await allRows(sb,physical);
      const [machines,locations]=await Promise.all([allRows(sb,"aparate"),allRows(sb,"locatii")]);
      if(role==="filer"){
        const assignedIds=new Set(arr(profile.aparate_asignate).map((x:any)=>String(x)));
        const assignedMachines=machines.filter((m:any)=>filerAllows(profile,m,locations.find((l:any)=>String(l.id)===String(m.locatie_id))));
        const visibleMachineIds=new Set(assignedMachines.map((m:any)=>String(m.id)));
        const visibleLocations=locations.filter((l:any)=>assignedMachines.some((m:any)=>String(m.locatie_id)===String(l.id)));
        const visibleClientIds=new Set(visibleLocations.filter((l:any)=>l.client_id).map((l:any)=>String(l.client_id)));
        if(name==="aparate") rows=assignedMachines;
        else if(name==="locatii") rows=visibleLocations;
        else if(name==="clienti") rows=rows.filter((c:any)=>visibleClientIds.has(String(c.id)));
        else if(name==="interventii_espressoare" || name==="rapoarte_espressoare") rows=rows.filter((v:any)=>v.aparat_id && visibleMachineIds.has(String(v.aparat_id)) && assignedIds.has(String(v.aparat_id)));
      } else {
        const cities=arr(profile.orase_acces).map(norm), types=arr(profile.tip_echipament_acces), zones=arr(profile.zone_aparate_acces).map(norm);
        const visibleMachines=machines.filter((m:any)=>{
          if(!machineIsActive(m)) return false;
          const loc=locations.find((l:any)=>String(l.id)===String(m.locatie_id||""));
          const city=norm(loc?.oras||m.source_data?.Oras||m.source_data?.oras);
          return (!cities.length||cities.includes(city)) && (!types.length||equipmentMatches(types,m.tip_echipament||m.tip_aparat)) && (!zones.length||zones.includes(norm(m.zona)));
        });
        const visibleMachineIds=new Set(visibleMachines.map((m:any)=>String(m.id)));
        const visibleLocationIds=new Set(visibleMachines.map((m:any)=>String(m.locatie_id)).filter(Boolean));
        const visibleClientIds=new Set(locations.filter((l:any)=>visibleLocationIds.has(String(l.id))&&l.client_id).map((l:any)=>String(l.client_id)));
        if(name==="aparate") rows=visibleMachines;
        else if(name==="locatii") rows=locations.filter((l:any)=>visibleLocationIds.has(String(l.id)));
        else if(name==="clienti") rows=rows.filter((c:any)=>visibleClientIds.has(String(c.id)));
        else if(name==="filtre") rows=rows.filter((f:any)=>f.aparat_id&&visibleMachineIds.has(String(f.aparat_id)));
        else if(name==="interventii") rows=rows.filter((v:any)=>String(v.tehnician_id||"")===String(authUser.id)&&v.aparat_id&&visibleMachineIds.has(String(v.aparat_id)));
      }
      total=rows.length; rows=rows.slice(offset,offset+limit);
    } else {
      let q=sb.from(physical).select("*",{count:"exact"}).order("id",{ascending:true});
      if(role==="comercial" && name==="aparate") q=q.neq("status","Retras");
      if(role==="comercial" && name==="rapoarte_aparate") q=q.neq("status","Retras");
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
    if(!isAdmin && (!isTech || !technicianRecord || String(visit.tehnician_id||"")!==String(authUser.id))) throw new Error("Nu ai dreptul sa incarci fotografii pentru aceasta interventie.");
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
    const row={interventie_id:visit.id,source_id:null,client:client?.nume||machine?.client_nume||"",aparat:[machine?.cod_ofresh,machine?.producator,machine?.model,machine?.serie].filter(Boolean).join(" - "),tehnician:profile.nume||authUser.email||"",storage_path:objectPath,file_name:safe,file_url:null,taken_at:new Date().toISOString(),numar_poza:photoIndex,data_incarcare:new Date().toISOString(),file_id_sursa:null,source_data:{storage_bucket:PHOTO_BUCKET,uploaded_by:authUser.id,mime_type:mimeType}};
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
    const path=`tmp-standard/${authUser.id}/${uploadId}/${chunkIndex}.b64`;
    const {error}=await sb.storage.from(PHOTO_BUCKET).upload(path,new TextEncoder().encode(chunk),{contentType:"image/jpeg",upsert:true});
    if(error) throw new Error("Nu am putut salva fragmentul foto: "+error.message);
    return Response.json({success:true,chunkIndex,totalChunks},{headers:CORS});
  }
  if(action==="finalizePhotoUpload"){
    if(!isTech&&!isAdmin) throw new Error("Acces interzis.");
    const visit=await canAccessStandardVisit(String(body.interventionId||""));
    const uploadId=String(body.uploadId||"").trim(),totalChunks=Number(body.totalChunks);
    if(!/^[a-zA-Z0-9_-]{8,100}$/.test(uploadId)||!Number.isInteger(totalChunks)||totalChunks<1||totalChunks>100) throw new Error("Date incarcare foto invalide.");
    const tempPaths=Array.from({length:totalChunks},(_,i)=>`tmp-standard/${authUser.id}/${uploadId}/${i}.b64`);
    // Descarca fragmentele in paralel; concatenarea ramane in ordinea indexului.
    const chunkResults=await Promise.all(tempPaths.map(path=>sb.storage.from(PHOTO_BUCKET).download(path)));
    const chunks:string[]=[];
    for(let i=0;i<chunkResults.length;i++){
      const {data:blob,error}=chunkResults[i];
      if(error||!blob) throw new Error(`Lipseste fragmentul foto ${i+1} din ${totalChunks}.`);
      chunks.push(await blob.text());
    }
    const base64=chunks.join("");
    const mimeType=String(body.mimeType||"image/jpeg").split(";")[0];
    const bytes=decodeBase64(base64);
    const photo=await saveStandardPhoto(visit,bytes,mimeType,String(body.fileName||"interventie.jpg"),Math.max(1,Math.min(50,Number(body.photoIndex)||1)));
    await sb.storage.from(PHOTO_BUCKET).remove(tempPaths);
    return Response.json({success:true,photo},{headers:CORS});
  }
  return new Response(JSON.stringify({success:false,error:`Actiunea ${action} nu este implementata in adaptorul V35.`}),{status:501,headers:CORS});
}
Deno.serve(async(req:Request)=>{try{return await main(req);}catch(e){return new Response(JSON.stringify({success:false,error:e instanceof Error?e.message:"Eroare interna."}),{status:500,headers:CORS});}});