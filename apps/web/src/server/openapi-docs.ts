// A deliberately small API browser. It is served from the panel image and
// fetches only this panel's OpenAPI document: no CDN, fonts, telemetry or code
// execution supplied by a third party.

export const apiDocsHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Portta API</title>
  <style>
    :root{color-scheme:light dark;font:15px/1.5 ui-sans-serif,system-ui,sans-serif;background:#101312;color:#edf2ef}
    body{max-width:1080px;margin:0 auto;padding:32px 20px 80px}a{color:#75d7ad}header{display:flex;gap:20px;align-items:end;justify-content:space-between;flex-wrap:wrap}
    h1{margin:0;font-size:30px}p{color:#aeb9b4}.toolbar{display:flex;gap:10px;align-items:center}input,button{font:inherit;border:1px solid #3a4540;border-radius:7px;background:#181d1b;color:inherit;padding:8px 11px}
    input{min-width:280px}button{cursor:pointer}button:hover{border-color:#75d7ad}.route{border:1px solid #303935;border-radius:9px;margin:10px 0;background:#151a18;overflow:hidden}
    summary{display:flex;align-items:center;gap:12px;padding:12px 14px;cursor:pointer}.method{width:58px;font:700 12px ui-monospace,monospace;color:#75d7ad}.path{font:600 14px ui-monospace,monospace}.summary{margin-left:auto;color:#aeb9b4}
    .body{padding:0 14px 16px;border-top:1px solid #303935}.tags{font-size:12px;color:#75d7ad}.params{display:grid;grid-template-columns:130px 1fr;gap:7px;max-width:620px}.params label{font:12px ui-monospace,monospace}.params input{min-width:0}
    pre{overflow:auto;background:#0c0f0e;padding:12px;border-radius:7px;max-height:420px}.result{margin-top:12px}.status{font:700 12px ui-monospace,monospace}.error{color:#ff9c9c}@media(max-width:650px){.summary{display:none}input{min-width:0;width:100%}}
  </style>
</head>
<body>
  <header><div><h1>Portta API</h1><p id="about">Loading the contract…</p></div><div class="toolbar"><input id="search" type="search" placeholder="Filter paths and summaries" aria-label="Filter API operations"><a href="/api/openapi.json">OpenAPI JSON</a></div></header>
  <main id="routes"></main>
  <script>
  (async function(){
    const root=document.getElementById('routes'), search=document.getElementById('search')
    const spec=await fetch('/api/openapi.json',{headers:{accept:'application/json'}}).then(r=>{if(!r.ok)throw Error(r.status);return r.json()})
    document.getElementById('about').textContent=spec.info.description
    const operations=[]
    for(const [path,item] of Object.entries(spec.paths)) for(const method of ['get','post','patch','delete','put']) if(item[method]) operations.push({path,method,op:item[method]})
    function draw(filter=''){
      root.textContent=''; const needle=filter.toLowerCase()
      for(const entry of operations){
        const hay=(entry.method+' '+entry.path+' '+(entry.op.summary||'')+' '+(entry.op.tags||[]).join(' ')).toLowerCase(); if(!hay.includes(needle))continue
        const box=document.createElement('details'); box.className='route'; const head=document.createElement('summary')
        head.innerHTML='<span class="method">'+entry.method.toUpperCase()+'</span><span class="path"></span><span class="summary"></span>'
        head.querySelector('.path').textContent=entry.path; head.querySelector('.summary').textContent=entry.op.summary||''; box.appendChild(head)
        const body=document.createElement('div'); body.className='body'; body.innerHTML='<p class="tags"></p><p class="description"></p>'
        body.querySelector('.tags').textContent=(entry.op.tags||[]).join(' · '); body.querySelector('.description').textContent=entry.op.description||entry.op.summary||''
        const params=document.createElement('div'); params.className='params'
        for(const p of entry.op.parameters||[]){const label=document.createElement('label'), input=document.createElement('input'); label.textContent=p.name+' ('+p.in+')'; input.dataset.name=p.name; input.dataset.where=p.in; input.required=Boolean(p.required); input.placeholder=p.schema&&p.schema.default!==undefined?String(p.schema.default):p.required?'required':'optional'; params.append(label,input)}
        body.appendChild(params)
        if(entry.method==='get'&&entry.path!=='/events'){
          const run=document.createElement('button'); run.textContent='Try GET'; const result=document.createElement('div'); result.className='result'; run.onclick=async()=>{
            let path=entry.path; const query=new URLSearchParams(); for(const input of params.querySelectorAll('input')){if(input.required&&!input.value){input.focus();return} if(!input.value)continue; if(input.dataset.where==='path')path=path.replace('{'+input.dataset.name+'}',encodeURIComponent(input.value)); else query.set(input.dataset.name,input.value)}
            const url='/api'+path+(query.size?'?'+query:''); result.innerHTML='<p>Requesting <code></code>…</p>'; result.querySelector('code').textContent=url
            try{const response=await fetch(url,{headers:{accept:'application/json'}}), text=await response.text(); let shown=text; try{shown=JSON.stringify(JSON.parse(text),null,2)}catch{} result.innerHTML='<span class="status"></span><pre></pre>'; result.querySelector('.status').textContent=response.status+' '+response.statusText; result.querySelector('.status').classList.toggle('error',!response.ok); result.querySelector('pre').textContent=shown}catch(error){result.innerHTML='<p class="error"></p>';result.firstChild.textContent=String(error)}
          }; body.append(run,result)
        }
        const contract=document.createElement('details'); contract.innerHTML='<summary>Operation contract</summary><pre></pre>'; contract.querySelector('pre').textContent=JSON.stringify(entry.op,null,2); body.appendChild(contract); box.appendChild(body); root.appendChild(box)
      }
    }
    search.addEventListener('input',()=>draw(search.value)); draw()
  })().catch(error=>{document.getElementById('about').textContent='Could not load the OpenAPI document'; document.getElementById('routes').textContent=String(error)})
  </script>
</body>
</html>`
