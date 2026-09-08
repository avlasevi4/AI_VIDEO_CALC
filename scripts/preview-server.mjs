// Isolated visual QA: /demo/ uses fictional local projects and never contacts Supabase.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const fixture = `<script>
localStorage.clear();
const now = new Date().toISOString();
const item = {id:'line-demo',provider:'kling',modelId:'kling-30',variantId:'standard',duration:5,qty:6,generationsPerVideo:3};
localStorage.setItem('ai-video-calc-v2-project-library',JSON.stringify({schemaVersion:6,activeProjectId:'demo-1',projects:[{id:'demo-1',name:'Презентация · сентябрь',createdAt:now,updatedAt:now,status:'active',items:[item],meta:{laborPerVideoRub:250,showWorkPrice:true},actualItems:[]},{id:'demo-2',name:'Рекламный ролик',createdAt:now,updatedAt:now,status:'completed',completedAt:now,items:[item],meta:{laborPerVideoRub:300,showWorkPrice:true},actualItems:[]}]}));
</script>`;
http.createServer(async (req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  if (pathname === '/mobile') { res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end('<body style="margin:0;background:#303643"><iframe title="Mobile preview" src="/demo/#projects" style="display:block;margin:12px auto;width:390px;height:844px;border:0"></iframe>'); }
  const demo = pathname.startsWith('/demo/');
  const name = decodeURIComponent(demo ? pathname.slice(5) : pathname);
  if (demo && name === '/js/cloud.js') {res.setHeader('Content-Type','text/javascript');return res.end(`window.AIVideoCloud={isConfigured:()=>true,init:async()=>({configured:true,session:{user:{email:'preview@example.test'}}}),synchronize:async p=>p,saveProject:async p=>p,signOut:async()=>{}};`);}
  const path = resolve(root, '.' + (name === '/' ? '/index.html' : name));
  if (!path.startsWith(root + '\\')) {res.writeHead(403);return res.end();}
  try { let data=await readFile(path);if(demo && path.endsWith('index.html'))data=Buffer.from(data.toString().replace('<script src="./js/app.js">',fixture+'<script src="./js/app.js">'));
    res.setHeader('Content-Type',({'html':'text/html; charset=utf-8','js':'text/javascript','css':'text/css','json':'application/json','png':'image/png'})[extname(path).slice(1)]||'application/octet-stream');res.end(data);
  } catch {res.writeHead(404);res.end();}
}).listen(8030,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:8030/demo/ ; mobile: /mobile'));
