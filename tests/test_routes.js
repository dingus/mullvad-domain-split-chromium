const fs=require('fs'),vm=require('vm'),assert=require('assert');
const code=fs.readFileSync(require('path').join(__dirname,'../background.js'),'utf8');
const timer=[];let config=null;
const ev=()=>({addListener(){}});
const storage={
 excludedHosts:JSON.stringify(['skip.example.com']),
 globalProxy:JSON.stringify({host:'10.64.0.1',port:1080,type:'socks'}),
 globalProxyDetails:JSON.stringify({socksEnabled:true}),
 hostProxies:JSON.stringify({'oguser.com':{host:'10.64.0.2',port:1080,type:'socks'}}),
 hostProxiesDetails:JSON.stringify({'oguser.com':{socksEnabled:true}}),
 randomProxyMode:'false',flatProxiesList:'[]',
 homeRoutingEnabled:true,homeDefault:true,
 homeDomains:JSON.stringify(['bank.com']),vpnDomains:JSON.stringify(['work.com'])
};
const chrome={runtime:{onInstalled:ev(),onStartup:ev()},storage:{local:{get:async()=>storage},onChanged:ev()},
 tabs:{onActivated:ev(),onUpdated:ev(),query:async()=>[{id:1,url:'https://example.com'}]},
 proxy:{settings:{clear:async()=>{config=null},set:async x=>{config=x.value.pacScript.data}},onProxyError:ev()},
 action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}}};
const c=vm.createContext({chrome,console,setTimeout,clearTimeout,URL});
vm.runInContext(code,c);
const sleep=x=>new Promise(r=>setTimeout(r,x));
async function getPAC(){await vm.runInContext('applyProxy()',c);assert(config,'Expected PAC configured');const pac=vm.createContext({});vm.runInContext(config,pac);return (url)=>pac.FindProxyForURL(url,new URL(url).hostname)}
(async()=>{
 let f=await getPAC();
 const cases=[
  ['https://bank.com','SOCKS5 127.0.0.1:37651'],
  ['https://a.bank.com','SOCKS5 127.0.0.1:37651'],
  ['https://notbank.com','SOCKS5 127.0.0.1:37651'],
  ['https://oguser.com','SOCKS5 10.64.0.2:1080'],
  ['https://a.oguser.com','SOCKS5 10.64.0.2:1080'],
  ['https://work.com','DIRECT'],
  ['https://b.work.com','DIRECT'],
  ['https://skip.example.com','DIRECT'],
  ['https://localhost','DIRECT'],
  ['https://127.0.0.1','DIRECT'],
  ['https://10.1.1.1','DIRECT'],
  ['https://192.168.1.1','DIRECT'],
  ['https://example.com','SOCKS5 127.0.0.1:37651']
 ];
 cases.forEach(([u,expected])=>assert.strictEqual(f(u),expected,u));
 // Confirm the badge can be evaluated without Function()/eval (MV3 CSP).
 c.STORAGE=storage;
  const badge=vm.runInContext('routeForHost("https://bank.com", compiledState(stateFromStorage(STORAGE)))',c);
  assert.strictEqual(badge,'HOME');
  assert.strictEqual(vm.runInContext('routeForHost("https://oguser.com", compiledState(stateFromStorage(STORAGE)))',c),'MULLVAD');
  storage.homeDefault=false; storage.homeDomains='[]'; storage.globalProxyDetails=JSON.stringify({socksEnabled:false});
  f=await getPAC();
  assert.strictEqual(f('https://google.com'),'DIRECT');
  assert.strictEqual(f('https://oguser.com'),'SOCKS5 10.64.0.2:1080');
  storage.homeDomains=JSON.stringify(['bank.com']);
  f=await getPAC();assert.strictEqual(f('https://bank.com'),'SOCKS5 127.0.0.1:37651');
  storage.homeRoutingEnabled=false;f=await getPAC();assert.strictEqual(f('https://bank.com'),'DIRECT');
  console.log('PASS:',cases.length+7,'domain/badge scenarios');
})().catch(e=>{console.error(e);process.exit(1)});
