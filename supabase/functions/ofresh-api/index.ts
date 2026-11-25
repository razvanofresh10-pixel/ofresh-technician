import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Content-Type":"application/json"};
const tables:Record<string,string>={clienti:"clienti",locatii:"locatii",aparate:"aparate",interventii:"interventii",interventii_espressoare:"interventii_espressoare",filtre:"filtre",stoc:"stoc",produse:"produse",tehnicieni:"tehnicieni",utilizatori:"utilizatori_aplicatie",rapoarte_aparate:"v_raport_aparate",rapoarte_interventii:"v_raport_interventii",rapoarte_espressoare:"v_raport_interventii_espressoare",rapoarte_stoc:"v_raport_stoc"};
const readAccess:Record<string,string[]>={administrator:Object.keys(tables),comercial:["clienti","locatii","aparate","filtre","rapoarte_aparate"],filer:["clienti","locatii","aparate","interventii_espressoare","rapoarte_espressoare"],tehnician:["clienti","locatii","aparate","interventii","filtre"]};
const writeAccess:Record<string,string[]>={administrator:["clienti","locatii","aparate","interventii","interventii_espressoare","filtre","stoc","produse","tehnicieni","utilizatori"],filer:["interventii_espressoare"],tehnician:["interventii","filtre"]};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)throw new Error("Lipsesc secretele serverului Supabase");
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return new Response(JSON.stringify({error:"Autentificare necesara"}),{status:401,headers:cors});
  const sb=createClient(url,key,{auth:{persistSession:false}});
  const {data:ud,error:ue}=await sb.auth.getUser(token);
  if(ue||!ud.user)return new Response(JSON.stringify({error:"Sesiune invalida"}),{status:401,headers:cors});
  const {data:profile,error:pe}=await sb.from("profiluri").select("*").eq("id",ud.user.id).maybeSingle();
  if(pe||!profile||profile.activ===false)return new Response(JSON.stringify({error:"Profil OFRESH inactiv sau lipsa"}),{status:403,headers:cors});
  const role=String(profile.rol||"").toLowerCase(),canRead=readAccess[role]||[],canWrite=writeAccess[role]||[];
  const b=req.method==="GET"?Object.fromEntries(new URL(req.url).searchParams):await req.json();
  const action=String(b.action||"bootstrap");
  if(action==="whoami")return new Response(JSON.stringify({success:true,user:{id:ud.user.id,email:ud.user.email},profile}),{headers:cors});
  if(action==="bootstrap"){
   const out:Record<string,unknown>={profile};
   const pageSize=1000;
   for(const k of canRead){
    const rows:any[]=[];
    let offset=0;
    while(true){
     const {data,error}=await sb.from(tables[k]).select("*").range(offset,offset+pageSize-1);
     if(error)throw new Error(k+": "+error.message);
     const page=data||[];
     rows.push(...page);
     if(page.length<pageSize)break;
     offset+=pageSize;
    }
    out[k]=rows;
   }
   return new Response(JSON.stringify({success:true,data:out}),{headers:cors});
  }
  const table=String(b.table||"");
  if(!tables[table])return new Response(JSON.stringify({error:"Tabel necunoscut"}),{status:400,headers:cors});
  if(action==="list"){
   if(!canRead.includes(table))return new Response(JSON.stringify({error:"Acces interzis"}),{status:403,headers:cors});
   const pageSize=Math.min(Math.max(Number(b.limit)||200,1),1000);
   const offset=Math.max(Number(b.offset)||0,0);
   const {data,error,count}=await sb.from(tables[table]).select("*",{count:"exact"}).range(offset,offset+pageSize-1);if(error)throw error;
   return new Response(JSON.stringify({success:true,data,count,limit:pageSize,offset}),{headers:cors});
  }
  if(["insert","upsert","update","delete"].includes(action)){
   if(!canWrite.includes(table))return new Response(JSON.stringify({error:"Nu ai drept de modificare pentru acest modul"}),{status:403,headers:cors});
   if(table.startsWith("rapoarte_"))return new Response(JSON.stringify({error:"Rapoartele sunt doar pentru citire"}),{status:403,headers:cors});
   let query:any=sb.from(tables[table]);
   if(action==="insert")query=query.insert(b.record).select().single();
   if(action==="upsert")query=query.upsert(b.record,{onConflict:b.onConflict||"id"}).select().single();
   if(action==="update"){if(!b.id)return new Response(JSON.stringify({error:"Lipseste id"}),{status:400,headers:cors});query=query.update(b.record).eq("id",b.id).select().single();}
   if(action==="delete"){if(!b.id)return new Response(JSON.stringify({error:"Lipseste id"}),{status:400,headers:cors});query=query.delete().eq("id",b.id).select().single();}
   const {data,error}=await query;if(error)throw new Error(error.message);
   return new Response(JSON.stringify({success:true,data}),{headers:cors});
  }
  return new Response(JSON.stringify({error:"Actiune necunoscuta"}),{status:400,headers:cors});
 }catch(e){return new Response(JSON.stringify({error:e instanceof Error?e.message:"Eroare interna"}),{status:500,headers:cors});}
});