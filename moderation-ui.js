import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
const SUPABASE_URL="https://zjifbqdvbmvuiwgwdkey.supabase.co";
const SUPABASE_KEY="sb_publishable_cyOdOu5OkDSr8tX-EvbiqQ_oNbc3KHC";
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
const $=s=>document.querySelector(s);
let launch,modal,content,alertBox,queue=[];
function node(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e}
function ensureUi(){
 if(!launch){launch=node("button","Review queue","btn");launch.type="button";launch.style.cssText="display:none;border-color:#f1dfb4;background:#fff8e8;color:#805d19";launch.onclick=openQueue;$("#upload")?.parentElement?.insertBefore(launch,$("#upload"))}
 if(!modal){
  modal=node("div");modal.style.cssText="position:fixed;inset:0;z-index:50;display:none;align-items:center;justify-content:center;padding:18px;background:#10182899;backdrop-filter:blur(4px)";
  const shell=node("section");shell.setAttribute("role","dialog");shell.setAttribute("aria-modal","true");shell.style.cssText="width:min(100%,900px);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;padding:22px;border:1px solid #e4e8ef";
  const head=node("div");head.style.cssText="display:flex;align-items:flex-start;gap:12px";
  const h=node("div");h.style.flex="1";h.append(node("div","MODERATION","eyebrow"));h.append(node("h2","Package review queue"));h.append(node("p","Validated packages stay private until approved by an authorized moderator.","muted"));
  const close=node("button","×","btn secondary");close.type="button";close.onclick=()=>modal.style.display="none";head.append(h,close);
  alertBox=node("div");alertBox.style.cssText="display:none;padding:10px;border-radius:8px;font-size:12px;white-space:pre-wrap;margin:12px 0";
  content=node("div");content.style.cssText="display:grid;gap:12px;margin-top:12px";
  shell.append(head,alertBox,content);modal.append(shell);modal.addEventListener("click",e=>{if(e.target===modal)modal.style.display="none"});document.body.append(modal);
 }
}
function showMessage(msg,error=false){alertBox.textContent=msg;alertBox.style.display="block";alertBox.style.background=error?"#fff1f0":"#f3f6ff";alertBox.style.color=error?"#b42318":"#3154e9"}
async function invoke(body){const {data,error}=await supabase.functions.invoke("pack-lifecycle",{body});if(!error)return data;let msg=error.message||"Request failed.";try{const d=await error.context?.clone?.().json();if(d?.error)msg=d.error}catch{}throw new Error(msg)}
async function refreshAvailability(session){
 ensureUi();launch.style.display="none";
 if(!session?.user)return;
 try{const r=await invoke({action:"moderation_list"});if(r?.ok){queue=r.uploads||[];launch.style.display="inline-flex";launch.textContent="Review queue · "+queue.length}}
 catch{ /* A non-moderator should not see an error or the queue button. */ }
}
function bytes(n){const x=Number(n||0);return x<1048576?(x/1024).toFixed(1)+" KiB":(x/1048576).toFixed(2)+" MiB"}
function renderQueue(){
 content.replaceChildren();
 if(!queue.length){content.append(node("div","No packages are awaiting review. You’re all caught up.","review-empty"));return}
 queue.forEach(item=>{
  const card=node("article");card.style.cssText="border:1px solid #e4e8ef;border-radius:12px;padding:15px";
  const top=node("div");top.style.cssText="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap";
  const main=node("div");main.style.cssText="flex:1;min-width:240px";
  main.append(node("h3",item.title));main.append(node("div","/"+item.slug+" · "+bytes(item.size_bytes)+" · "+(item.license||"License unspecified"),"muted"));
  main.append(node("p",item.description||"No description provided."));
  main.append(node("div","Uploader ID: "+item.owner_id+" · Submitted "+(item.rights_attested_at?new Date(item.rights_attested_at).toLocaleString():"time unavailable"),"muted"));
  const badge=node("span","PENDING REVIEW");badge.style.cssText="font-size:10px;font-weight:850;color:#8a6117;background:#fff2dc;padding:5px 8px;border-radius:7px";top.append(main,badge);card.append(top);
  const details=node("details");details.style.marginTop="12px";details.append(node("summary","Inspect validated contents"));
  const meta= item.validation_report||{};const facts=node("p","SHA-256: "+(item.sha256||meta.package_sha256||"—")+" · JSONL records: "+(meta.jsonl_record_count??"—")+" · files: "+((item.discovered_files||[]).length),"muted");details.append(facts);
  const files=node("div");files.style.cssText="display:grid;gap:5px";
  (item.discovered_files||[]).forEach(f=>{files.append(node("div",(f.path||"")+" — "+(f.records==null?bytes(f.size_bytes):f.records+" records")))});
  details.append(files);
  (meta.warnings||[]).forEach(w=>details.append(node("p","Safety warning: "+w,"muted")));
  card.append(details);
  const notes=node("textarea");notes.rows=2;notes.maxLength=2000;notes.placeholder="Required for Request changes or Reject: explain the specific issue.";notes.style.cssText="width:100%;resize:vertical;margin-top:12px;padding:10px;border:1px solid #d7deea;border-radius:8px;font:12px/1.5 inherit";
  card.append(notes);
  const actions=node("div");actions.style.cssText="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px";
  const approve=node("button","Approve & publish","btn main");approve.onclick=async()=>{if(!confirm("Approve this package and make its .pack contents publicly downloadable?"))return;await decide(item,"approve","",approve)};
  const changes=node("button","Request changes","btn secondary");changes.onclick=async()=>decide(item,"request_changes",notes.value,changes);
  const reject=node("button","Reject","btn secondary");reject.style.color="#b42318";reject.onclick=async()=>{if(!confirm("Reject this package? It will remain private and cannot be resubmitted as the same upload."))return;await decide(item,"reject",notes.value,reject)};
  actions.append(approve,changes,reject);card.append(actions);content.append(card);
 });
}
async function decide(item,action,notes,button){
 if(action!=="approve"&&notes.trim().length<5){showMessage("Please add a specific moderator note of at least five characters.",true);return}
 button.disabled=true;button.textContent="Saving…";
 try{
  const result=await invoke({action,upload_id:item.id,...(action==="approve"?{}:{notes})});
  if(!result?.ok)throw new Error("Moderation action did not complete.");
  showMessage(action==="approve"?"Approved and published: "+item.title:action==="reject"?"Rejected: "+item.title:"Changes requested: "+item.title);
  queue=queue.filter(x=>x.id!==item.id);launch.textContent="Review queue · "+queue.length;renderQueue();
  if(action==="approve"&&typeof window.ragHubReloadCatalog==="function")await window.ragHubReloadCatalog();
 }catch(e){showMessage(e.message||"Could not save moderation decision.",true);button.disabled=false;button.textContent=action==="approve"?"Approve & publish":action==="reject"?"Reject":"Request changes"}
}
async function openQueue(){modal.style.display="flex";showMessage("Loading queue…");try{const r=await invoke({action:"moderation_list"});queue=r.uploads||[];showMessage(queue.length?queue.length+" package(s) awaiting review.":"Queue is empty.");renderQueue();launch.textContent="Review queue · "+queue.length}catch(e){showMessage(e.message||"Could not load moderation queue.",true)}}
ensureUi();
supabase.auth.onAuthStateChange((_event,session)=>{window.setTimeout(()=>refreshAvailability(session),0)});
const session=await supabase.auth.getSession();await refreshAvailability(session.data.session);
