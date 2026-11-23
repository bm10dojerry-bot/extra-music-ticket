// Isolated real PostgreSQL migration test; PGlite is installed outside runtime dependencies.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
test('per-show commission migration preserves pricing, atomic reservation and protected CAS',async t=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table public.managed_shows(id text primary key,venue_id text,prices jsonb,updated_at timestamptz);
   create table public.extra_payment_orders(code text primary key,access_token text,show_id text,venue_id text,seats text[],amount_vnd bigint,buyer_name text,buyer_phone text,buyer_email text,status text default 'pending',expires_at timestamptz default now()+interval '15 minutes',created_at timestamptz default now(),paid_at timestamptz,is_vip_invitation boolean default false);
   create table public.ticket_sales(order_code text primary key,show_id text,seats text[],amount_vnd bigint,payment_verified boolean default true);
   grant all on public.extra_payment_orders,public.ticket_sales,public.managed_shows to service_role;
   insert into public.managed_shows values('sample-show','ccc','{"A":600,"B":400,"C":300,"D":200}','2030-01-01'),('changed-show','ccc','{"A":600,"B":400,"C":300,"D":200}','2030-02-01');
   insert into public.extra_payment_orders(code,show_id,venue_id,seats,amount_vnd,created_at,status) values
   ('SAME-ROW','sample-show','ccc',array['C01','C02'],761,'2030-01-10','paid'),
   ('GIFT','sample-show','ccc',array['D11','D12','D13','D14','D15','D10'],2000,'2030-01-10','paid'),
   ('FULL-SIX','sample-show','ccc',array['C11','C12','C13','C14','C15','C16'],2400,'2030-01-10','paid'),
   ('CHANGED-PRICE','changed-show','ccc',array['D11','D12','D13','D14','D15','D16'],2000,'2030-01-10','paid'),
   ('MIXED','sample-show','ccc',array['A01','D01'],1000,'2030-01-10','paid'),
   ('UNMATCHED','sample-show','ccc',array['D21','D22','D23','D24','D25','D26'],2100,'2030-01-10','paid'),
   ('FREE','sample-show','ccc',array['F01'],0,'2030-01-10','paid');
   update public.extra_payment_orders set is_vip_invitation=true where code='FREE';`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/025_extra_admin_seat_sale_locks.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261123151046_sale_commission_per_show_progressive.sql'),'utf8'));
  const query=(sql,args=[])=>db.query(sql,args);
  await t.test('independent seed policies and private table/function permissions',async()=>{
   assert.equal((await query('select count(*)::int as n from sale_commission_policies')).rows[0].n,2);
   assert.equal((await query("select relrowsecurity from pg_class where oid='public.sale_commission_policies'::regclass")).rows[0].relrowsecurity,true);
   for(const role of ['anon','authenticated']){
    assert.equal((await query("select has_table_privilege($1,'public.sale_commission_policies','SELECT') as allowed",[role])).rows[0].allowed,false);
    assert.equal((await query("select has_function_privilege($1,'public.extra_save_sale_commission_policy(text,jsonb,uuid,text)','EXECUTE') as allowed",[role])).rows[0].allowed,false);
    assert.equal((await query("select has_function_privilege($1,'public.extra_reserve_order_with_commission(text,text,text,text,text[],bigint,text,text,text,jsonb)','EXECUTE') as allowed",[role])).rows[0].allowed,false);
   }
  });
  await t.test('migration recovers exact old same-row prices and safely identified gifts only',async()=>{
   const rows=(await query('select code,commission_lines,commission_basis from extra_payment_orders order by code')).rows;
   const byCode=Object.fromEntries(rows.map(row=>[row.code,row]));
   assert.deepEqual(byCode['SAME-ROW'].commission_lines,[{seat:'C01',netAmount:381},{seat:'C02',netAmount:380}]);
   assert.equal(byCode.GIFT.commission_lines.filter(line=>line.netAmount>0).length,5);
   assert.deepEqual(byCode.GIFT.commission_lines.at(-1),{seat:'D10',netAmount:0});
   assert.equal(byCode.GIFT.commission_basis,'reconstructed_checkout');
   assert.equal(byCode['FULL-SIX'].commission_lines.filter(line=>line.netAmount>0).length,6);
   for(const code of ['CHANGED-PRICE','MIXED','UNMATCHED'])assert.equal(byCode[code].commission_lines,null);
   assert.deepEqual(byCode.FREE.commission_lines,[{seat:'F01',netAmount:0}]);
  });
  await t.test('CAS cannot overwrite another editor or mutate another show',async()=>{
   const before=(await query('select * from sale_commission_policies order by show_id')).rows;
   const current=before.find(row=>row.show_id==='sample-show');
   const save=(version)=>query('select * from extra_save_sale_commission_policy($1,$2,$3,$4)',['sample-show',JSON.stringify([{maxTickets:100,rate:12.34}]),version,'Synthetic Admin']);
   assert.equal((await save(current.version)).rows.length,1);assert.equal((await save(current.version)).rows.length,0);
   assert.equal((await save(null)).rows.length,0);
   const other=(await query("select * from sale_commission_policies where show_id='changed-show'")).rows[0];
   assert.deepEqual(other,before.find(row=>row.show_id==='changed-show'));
   await assert.rejects(()=>query('select * from extra_save_sale_commission_policy($1,$2,$3,$4)',['sample-show',JSON.stringify([{maxTickets:10,rate:10},{maxTickets:9,rate:18}]),null,'Synthetic Admin']));
  });
  await t.test('invalid snapshots cannot create reservations or corrupt saved amounts',async()=>{
   const reserve=(code,lines)=>query('select * from extra_reserve_order_with_commission($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[code,'synthetic-token','sample-show','ccc',['A90','B90','B91'],1000,'Fixture buyer','0000000000','fixture@example.invalid',JSON.stringify(lines)]);
   await assert.rejects(()=>reserve('BAD',[{seat:'A90',netAmount:600},{seat:'B90',netAmount:399},{seat:'B91',netAmount:0}]));
   assert.equal((await query("select count(*)::int as n from extra_payment_orders where code='BAD'")).rows[0].n,0);
   assert.equal((await reserve('NEW',[{seat:'A90',netAmount:600},{seat:'B90',netAmount:400},{seat:'B91',netAmount:0}])).rows.length,1);
   const row=(await query("select * from extra_payment_orders where code='NEW'")).rows[0];assert.equal(row.commission_basis,'checkout');assert.equal(row.commission_lines.length,3);
   await assert.rejects(()=>query("update extra_payment_orders set amount_vnd=999 where code='NEW'"));
   await assert.rejects(()=>reserve('CONFLICT',[{seat:'A90',netAmount:600},{seat:'B90',netAmount:400},{seat:'B91',netAmount:0}]));
   assert.equal((await query("select count(*)::int as n from extra_payment_orders where code='CONFLICT'")).rows[0].n,0);
  });
 }finally{await db.close();}
});
