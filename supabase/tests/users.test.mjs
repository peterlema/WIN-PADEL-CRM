import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite()
const query=async(sql,args=[])=> (await db.query(sql,args)).rows
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema extensions;
 -- Crypto is stubbed only in this isolated WASM test; production uses pgcrypto BCrypt.
 create function extensions.gen_salt(text,integer) returns text language sql as $$select 'test-salt'::text$$;
 create function extensions.crypt(text,text) returns text language sql as $$select md5($1||$2)$$;`)
 await db.exec(readFileSync(new URL('../migrations/20261123_win_private_username_pin_accounts.sql',import.meta.url),'utf8'))
 await db.exec(`create table public.win_staff(user_id uuid primary key references win_auth.login_accounts(id),display_name text,role text,active boolean);
 create table win_auth.login_sessions(account_id uuid references win_auth.login_accounts(id),token text,revoked_at timestamptz);
 create table win_auth.role_permissions(role_code text,module_code text,action_code text);
 create function public.win_pin_session(p_token text) returns table(account_id uuid,role text) language sql as $$select a.id,a.role from win_auth.login_accounts a join win_auth.login_sessions s on s.account_id=a.id where s.token=p_token and s.revoked_at is null and a.enabled$$;
 insert into win_auth.login_accounts(username,pin_hash,display_name,role,enabled) values ('Admin','unread','Admin','ADMIN',true),('Recep','unread','Recep','RECEPTION',true);
 insert into win_auth.login_sessions(account_id,token) select id,username from win_auth.login_accounts;`)
 const sql=readFileSync(new URL('../operations/users.sql',import.meta.url),'utf8')
 await db.exec(sql);await db.exec(sql)
 const api=async(action,p={},token='Admin')=>(await query('select public.win_users_api($1,$2,$3) r',[token,action,p]))[0].r
 const request=p=>({requestId:crypto.randomUUID(),...p})
 let list=await api('list');assert.equal(list.roles.length,6)
 assert.ok(!JSON.stringify(list).includes('unread'))
 await assert.rejects(api('list',{},'Recep'),/NOT_AUTHORIZED/)
 await assert.rejects(api('list',{},'bad'),/SESSION_INVALID/)
 const roleId=list.roles.find(r=>r.baseRole==='RECEPTION').id
 const payload=request({username:'Juanita',name:'Juanita',roleId,pin:'012345',enabled:true})
 const user=await api('save',payload)
 assert.deepEqual(await api('save',payload),user)
 assert.equal((await query('select count(*)::int n from win_auth.user_management_audit'))[0].n,1)
 await assert.rejects(api('save',request({...payload,requestId:crypto.randomUUID(),username:' JUANITA '})),/USER_NAME_TAKEN/)
 await assert.rejects(api('save',request({username:'Melanie',name:'Melanie',roleId,pin:'123',enabled:true})),/USER_PIN_INVALID/)
 assert.equal((await query("select count(*)::int n from win_auth.login_accounts where username='Melanie'"))[0].n,0)
 const custom=await api('role.save',request({name:'Recepción tarde',baseRole:'RECEPTION'}))
 await assert.rejects(api('role.save',request({name:' RECEPCIÓN TARDE ',baseRole:'ADMIN'})),/USER_ROLE_TAKEN/)
 await assert.rejects(api('role.save',request({name:'Inválido',baseRole:'ALL'})),/USER_ROLE_INVALID/)
 await api('save',request({id:user.id,username:'Juanita',name:'Juanita',roleId:custom.id,pin:'',enabled:true}))
 assert.equal((await query('select role from win_auth.login_accounts where id=$1',[user.id]))[0].role,'RECEPTION')
 assert.equal((await query('select active from public.win_staff where user_id=$1',[user.id]))[0].active,true)
 await query("insert into win_auth.login_sessions(account_id,token) values($1,'juanita-session')",[user.id])
 await api('save',request({id:user.id,username:'Juanita',name:'Juanita',roleId:custom.id,pin:'654321',enabled:true}))
 assert.ok((await query("select revoked_at from win_auth.login_sessions where token='juanita-session'"))[0].revoked_at)
 await api('save',request({id:user.id,username:'Juanita',name:'Juanita',roleId:custom.id,pin:'',enabled:false}))
 assert.equal((await query('select active from public.win_staff where user_id=$1',[user.id]))[0].active,false)
 list=await api('list');const admin=list.users.find(u=>u.role==='ADMIN')
 await assert.rejects(api('save',request({...admin,enabled:false,pin:''})),/USER_SELF_PROTECTED/)
 await assert.rejects(api('save',request({...admin,roleId,pin:''})),/USER_SELF_PROTECTED/)
 const audit=JSON.stringify(await query('select before_record,after_record from win_auth.user_management_audit'))
 const requests=JSON.stringify(await query('select payload,result from win_auth.user_management_requests'))
 assert.ok(!audit.includes('012345')&&!audit.includes('654321')&&!audit.includes('pin_hash'))
 assert.ok(!requests.includes('012345')&&!requests.includes('654321'))
 const grants=await query("select has_function_privilege('anon','public.win_users_api(text,text,jsonb)','execute') allowed")
 assert.equal(grants[0].allowed,false)
 console.log('PASS: permisos ADMIN, alta, PIN, duplicados, reintentos, roles heredados, baja, revocación, auditoría sin credenciales y protección del administrador')
}finally{await db.close()}
