'use strict';
const $ = id => document.getElementById(id);
const keys=['homeRoutingEnabled','homeDefault','homeDomains','vpnDomains'];
function parse(v, fallback) { if(v===undefined||v===null)return fallback;try{return typeof v==='string'?JSON.parse(v):v}catch{return fallback} }
function lines(list) {return list.join('\n')}
function readDomains(id) {
  const raw=$(id).value.split(/[\s,;]+/).map(x=>x.trim().toLowerCase()).filter(Boolean);
  const all=[...new Set(raw)];
  for(const domain of all){
    if(domain.length>253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))
      throw new Error('Invalid domain: "'+domain+'". Enter hostnames only, e.g. example.com (not https://example.com).');
  }
  return all;
}
async function load() {
 const state=await chrome.storage.local.get(keys);
 $('enabled').checked=state.homeRoutingEnabled===true;
 $('mode').value=state.homeDefault===true?'home':'vpn';
 $('home-domains').value=lines(parse(state.homeDomains,[]));
 $('vpn-domains').value=lines(parse(state.vpnDomains,[]));
}
async function checkHelper(){
 $('helper-status').textContent='Checking…';$('helper-status').className='status';
 try {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),1800);
  let response;
  try {response=await fetch('http://127.0.0.1:37652/health',{cache:'no-store',signal:controller.signal})}finally{clearTimeout(timeout)}
  const body=await response.json();
  if(!response.ok||body.service!=='Mullvad Home IP Helper'||body.running!==true)throw new Error('Invalid helper response');
  $('helper-status').textContent='Running';$('helper-status').className='status ok';
  $('helper-msg').textContent='Helper is running. This does NOT prove it has your home IP. Run helper/TEST-HOME-IP.bat and compare the result with your Mullvad IP.';
 } catch {
  $('helper-status').textContent='Not running';$('helper-status').className='status bad';
  $('helper-msg').textContent='Start helper/START-HOME-IP-HELPER.bat after excluding MullvadHomeIPHelper.exe in the Mullvad VPN app. Home-routed sites will fail closed until this is running.';
 }
}
async function save() {
 $('error').textContent='';$('saved').textContent='';
 try {
  const home=readDomains('home-domains'),vpn=readDomains('vpn-domains');
  const duplicates=home.filter(x=>vpn.includes(x));
  if(duplicates.length)throw new Error('Domain appears in both lists: '+duplicates.join(', '));
  const enabled=$('enabled').checked;
  if(enabled && ($('mode').value==='home' || home.length>0) && $('helper-status').textContent!=='Running') {
    throw new Error('Home-IP helper is not running. Start it, then click Check helper before enabling Home IP routing.');
  }
  await chrome.storage.local.set({homeRoutingEnabled:enabled,homeDefault:$('mode').value==='home',homeDomains:JSON.stringify(home),vpnDomains:JSON.stringify(vpn)});
  $('saved').textContent='Saved — active for this browser profile';
  setTimeout(()=>$('saved').textContent='',4500);
 }catch(err){$('error').textContent=err.message}
}
document.addEventListener('DOMContentLoaded',()=>{load().catch(err=>$('error').textContent=err.message);checkHelper();$('check-helper').addEventListener('click',checkHelper);$('save').addEventListener('click',save)});
