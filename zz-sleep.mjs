import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
const REF='aqaubrbssnbtomykexgr', SB='https://'+REF+'.supabase.co'
const keys=JSON.parse(execSync(`/opt/homebrew/bin/supabase projects api-keys --project-ref ${REF} -o json`,{encoding:'utf8',stdio:['ignore','pipe','ignore']}))
const svc=createClient(SB,keys.find(k=>k.name==='service_role').api_key,{auth:{persistSession:false}})

// disposable user with a sleep item: asleep by 1:00am (60), up by 9:00am (540)
const u='zzsleep'
const {data:ex}=await svc.rpc('email_for_username',{u})
if(ex){const {data:l}=await svc.auth.admin.listUsers({perPage:1000});const f=l.users.find(x=>x.email===ex);if(f)await svc.auth.admin.deleteUser(f.id)}
const {data}=await svc.auth.admin.createUser({email:u+'@75hard.app',password:'zzsleep123',email_confirm:true})
const uid=data.user.id
await svc.from('profiles').insert({id:uid,username:u,display_name:'Sleep',role:'participant',tone:'coach'})
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date())
const {data:ch}=await svc.from('challenges').insert({name:'Sleep',join_code:'ZZSLP01',owner_id:uid,start_date:today,timezone:'America/New_York',total_days:30,format:'solo'}).select().single()
await svc.from('members').insert({challenge_id:ch.id,user_id:uid,role:'participant',accent:'#c1663f'})
const {data:rr,error:re}=await svc.from('requirements').insert({key:'sleep',label:'Sleep window',kind:'photo',sort:1,icon:'clock',frequency:'daily',challenge_id:ch.id,user_id:uid,sleep_by:60,wake_by:540}).select().single()
if(re){console.log('req err',re.message);process.exit(1)}

// build Oura-ish screenshots: dark card, "Bedtime"/"Wake up" labelled times
function shot(name,bed,wake,extra){
  const w=760,h=1000,px=Buffer.alloc(w*h*3)
  for(let i=0;i<w*h;i++){px[i*3]=18;px[i*3+1]=20;px[i*3+2]=28}
  const ppm=`/tmp/${name}.ppm`, png=`/tmp/${name}.png`
  writeFileSync(ppm,Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`),px]))
  execSync(`/usr/bin/sips -s format png ${ppm} --out ${png} >/dev/null 2>&1`)
  // draw text with ImageMagick if present, else fall back to a plain canvas
  const lines=[`Sleep`,``,`Bedtime      ${bed}`,`Wake up      ${wake}`,``,extra||'Total sleep  7h 32m']
  try{
    execSync(`/opt/homebrew/bin/magick ${png} -fill white -pointsize 46 -annotate +60+160 "${lines.join('\\n')}" ${png}`)
  }catch{
    try{ execSync(`/usr/local/bin/magick ${png} -fill white -pointsize 46 -annotate +60+160 "${lines.join('\\n')}" ${png}`) }
    catch{ return null }
  }
  return png
}
const cases=[
  ['on target','12:42 AM','7:58 AM'],
  ['late bed','1:47 AM','8:20 AM'],
  ['late wake','12:30 AM','9:41 AM'],
]
for(const [name,bed,wake] of cases){
  const f=shot(name.replace(/ /g,'_'),bed,wake)
  if(!f){console.log('no imagemagick; skipping render');break}
  const path=`${uid}/${ch.id}/${today}/${name.replace(/ /g,'_')}.png`
  await svc.storage.from('proof').upload(path, readFileSync(f), {contentType:'image/png',upsert:true})
  const {data:log}=await svc.from('day_logs').upsert({challenge_id:ch.id,user_id:uid,log_date:today,status:'pending'},{onConflict:'challenge_id,user_id,log_date'}).select().single()
  const {data:entry}=await svc.from('log_entries').upsert({day_log_id:log.id,requirement_id:rr.id,challenge_id:ch.id,user_id:uid,photo_path:path,photo_paths:[path]},{onConflict:'day_log_id,requirement_id'}).select().single()
  // call the deployed function as this user
  const c=createClient(SB,keys.find(k=>k.name==='anon').api_key,{auth:{persistSession:false}})
  const {data:s}=await c.auth.signInWithPassword({email:u+'@75hard.app',password:'zzsleep123'})
  const r=await fetch('https://youmode.app/api/verify-sleep',{method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.session.access_token}`},
    body:JSON.stringify({entryId:entry.id})})
  const j=JSON.parse((await r.text()).replace(/^\n+/,''))
  console.log('\n'+name+' ('+bed+' / '+wake+')')
  console.log('  ->', JSON.stringify({read:[j.bedtime,j.wake],onTarget:j.onTarget,readable:j.readable}))
  console.log('  note:', j.note || j.skipped)
}
console.log('\nuser: zzsleep / zzsleep123')
