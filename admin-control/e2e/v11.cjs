'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {chromium} = require('playwright');

const base = new URL(process.env.V11_E2E_URL ?? 'http://127.0.0.1:32769');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(base.hostname),'Run E2E against a disposable local deployment.');
const password = process.env.V11_E2E_PASSWORD;
assert.ok(password?.length >= 24,'Set V11_E2E_PASSWORD for the local owner fixture.');
const memberPassword = 'browser-fixture-member-long-password';
const run = randomUUID().slice(0,8);
const title = (page, text) => page.getByRole('heading',{name:text,exact:true});
const form = (page, path) => page.locator('form[action="'+path+'"]');
async function postStatus(page, route, fields) {
  const cookies = await page.context().cookies();
  const cookie = cookies.map(item=>item.name+'='+item.value).join('; ');
  const response = await page.request.post(route,{form:fields,headers:{cookie}});
  return response.status();
}

async function browser(t) {
  const b = await chromium.launch({executablePath:process.env.V11_CHROMIUM_PATH || undefined,headless:true});
  t.after(()=>b.close());
  return b;
}

async function owner(b, viewport) {
  const context = await b.newContext({baseURL:base.origin,viewport});
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Tên đăng nhập').fill('owner');
  await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Đăng nhập'}).click();
  return page;
}

test('desktop preserves V1.0 reports and persists a cost with approval and coverage', {timeout:60_000}, async t=>{
  const b=await browser(t);
  const page=await owner(b,{width:1366,height:900});
  await title(page,'Trung tâm điều hành').waitFor();
  await page.goto('/reports/24h');
  await title(page,'Báo cáo 24H').waitFor();
  assert.equal(await page.getByRole('navigation',{name:'Báo cáo'}).getByRole('link').count(),2);
  await page.goto('/proposals/music');
  await title(page,'Đề xuất Music theo show').waitFor();
  const csrf=await page.locator('input[name=csrf]').first().inputValue();
  assert.equal(await postStatus(page,'/music',{csrf}),404);
  const path='/v11/costs/music';
  await page.goto(path);
  const key='fixture-'+run;
  await page.getByLabel('Mã show hoặc shared').fill(key);
  await page.getByRole('button',{name:'Mở sổ chi phí'}).click();
  await title(page,'Chi phí · '+key).waitFor();
  await page.getByText('Thêm khoản chi',{exact:true}).click();
  const expense=form(page,path+'/save');
  await expense.getByLabel('Mã chi phí',{exact:true}).fill('TEST-1');
  await expense.getByLabel('Mã dòng chứng từ duy nhất').fill('E2E-'+run+'/1');
  await expense.getByLabel('Nhóm / loại chi phí').selectOption('Nghệ sĩ / MC');
  await expense.getByLabel('Nguồn dữ liệu').fill('Fixture kiểm thử cục bộ');
  await expense.getByLabel('Thực tế',{exact:true}).fill('120000');
  await expense.getByLabel('Phê duyệt',{exact:true}).selectOption('approved');
  await expense.getByRole('button',{name:'Ghi khoản chi'}).click();
  await page.getByRole('cell',{name:'TEST-1',exact:true}).waitFor();
  await page.getByText('Xác nhận độ đầy đủ của sổ',{exact:true}).click();
  const attest=form(page,path+'/attest');
  await attest.getByLabel('Mốc đối soát').selectOption('actual');
  await attest.getByLabel('Mã bảng đối soát hoặc chứng từ').fill('Bảng đối chiếu E2E');
  await attest.getByRole('button',{name:'Xác nhận đủ dữ liệu'}).click();
  assert.match(await page.locator('.tile').filter({hasText:'Thực tế'}).innerText(),/120\.000 đ/);
  await page.getByRole('link',{name:'Lịch sử',exact:true}).click();
  await page.getByText('Phiên bản chứng từ',{exact:true}).click();
  await page.getByText('120000',{exact:false}).last().waitFor();
});

test('browser approves and executes only a budget-checked Ads rehearsal and persists the emergency stop', {timeout:60_000}, async t=>{
  const b=await browser(t);
  const page=await owner(b,{width:1280,height:800});
  const path='/v11/ads/24h';
  await page.goto(path);
  await title(page,'AI Ads Manager').waitFor();
  const current=await page.locator('input[name=stopped]').first().inputValue();
  if (current==='false') await page.getByRole('button',{name:'Bật lại diễn tập'}).click();
  await page.getByText('Đăng ký nhóm quảng cáo',{exact:true}).click();
  const newAd=form(page,path+'/target');
  const id=String(parseInt(run,16)+1000000000);
  for (const [label,value] of Object.entries({'ID tài khoản Ads':id,'Mã show / đơn vị 24H':'local-'+run,
    'ID chiến dịch':id+'1','ID nhóm quảng cáo':id+'2'})) await newAd.getByLabel(label).fill(value);
  await newAd.getByRole('button',{name:'Lưu nhóm'}).click();
  await page.getByRole('link',{name:id+'2',exact:true}).waitFor();
  await page.getByText('Khóa ngân sách theo 7 lớp',{exact:true}).click();
  const caps=form(page,path+'/limit');
  for (const box of await caps.locator('input[type=number]').all()) await box.fill('1000');
  await caps.getByRole('button',{name:'Lưu hạn mức'}).click();
  await page.getByText('Nhập chi tiêu mô phỏng',{exact:true}).click();
  const spend=form(page,path+'/fixture');
  for (const box of await spend.locator('input[type=number]').all()) await box.fill('10');
  await spend.getByRole('button',{name:'Lưu số diễn tập'}).click();
  await page.getByText('Lập yêu cầu diễn tập',{exact:true}).click();
  const action=form(page,path+'/request');
  await action.getByLabel('Thao tác',{exact:true}).selectOption('INCREASE_TOTAL_BUDGET');
  await action.getByLabel('Số tiền (PAUSE nhập 0)',{exact:true}).fill('100');
  await action.getByLabel('Lý do').fill('Diễn tập trình duyệt '+run);
  await action.getByRole('button',{name:'Gửi duyệt'}).click();
  const request=page.getByRole('row').filter({hasText:'Diễn tập trình duyệt '+run});
  await request.getByRole('button',{name:'Duyệt',exact:true}).click();
  await request.getByRole('button',{name:'Chạy diễn tập',exact:true}).click();
  await request.getByText('0 yêu cầu Meta · 0 đ').waitFor();
  await page.getByRole('button',{name:'Dừng khẩn cấp'}).click();
  await page.getByText('Diễn tập · Đang dừng khẩn cấp.',{exact:false}).waitFor();
  await page.reload();
  await page.getByRole('button',{name:'Bật lại diễn tập'}).click();
  await page.getByRole('button',{name:'Dừng khẩn cấp'}).waitFor();
});

test('mobile activates a named account and enforces scoped routes and camera permissions', {timeout:60_000}, async t=>{
  const b=await browser(t);
  const desktop=await owner(b,{width:1280,height:800});
  const path='/v11/access';
  await desktop.goto(path);
  await desktop.getByText('Mời nhân sự',{exact:true}).click();
  const invite=form(desktop,path+'/invite');
  const username='finance-'+run;
  await invite.getByLabel('Tên đăng nhập',{exact:true}).fill(username);
  await invite.getByLabel('Họ tên',{exact:true}).fill('Kiểm thử '+run);
  await invite.getByLabel('Vai trò',{exact:true}).selectOption('FINANCE_MANAGER');
  await invite.getByRole('button',{name:'Tạo mã kích hoạt'}).click();
  const code=await desktop.getByLabel('Mã kích hoạt',{exact:true}).inputValue();
  await desktop.getByText('Cấp hoặc thu hồi quyền',{exact:true}).click();
  const grant=form(desktop,path+'/grant');
  await grant.getByLabel('Nhân sự',{exact:true}).selectOption({label:'Kiểm thử '+run+' ('+username+')'});
  await grant.getByLabel('Quyền',{exact:true}).selectOption('cost.read');
  await grant.getByLabel('Lĩnh vực',{exact:true}).selectOption('music');
  await grant.getByLabel('Show',{exact:true}).fill('fixture-'+run);
  await grant.getByRole('button',{name:'Lưu quyền'}).click();
  await desktop.getByRole('cell',{name:'Kiểm thử '+run,exact:true}).waitFor();
  const phone=await (await b.newContext({baseURL:base.origin,viewport:{width:390,height:844},isMobile:true,hasTouch:true})).newPage();
  await phone.goto('/v11/activate');
  await phone.getByLabel('Mã kích hoạt',{exact:true}).fill(code);
  await phone.getByLabel('Mật khẩu mới').fill(memberPassword);
  await phone.getByRole('button',{name:'Kích hoạt',exact:true}).click();
  await phone.getByLabel('Tên đăng nhập').fill(username);
  await phone.getByLabel('Mật khẩu',{exact:true}).fill(memberPassword);
  await phone.getByRole('button',{name:'Đăng nhập'}).click();
  await title(phone,'EXTRA OS V1.1').waitFor();
  const nav=phone.getByRole('navigation',{name:'Menu điều hành'});
  await nav.getByRole('link',{name:'Input Cost Center'}).click();
  await title(phone,'Chi phí · fixture-'+run).waitFor();
  assert.equal(await phone.getByText('Thêm khoản chi',{exact:true}).count(),0);
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth),390);
  for(const route of ['/v11/costs/music?scope=other-show','/v11/camera','/v11/ads/music','/reports/music']){
    const response=await phone.goto(route);
    assert.equal(response.status(),403,route);
  }
  const ownerCamera=await desktop.goto('/v11/camera');
  assert.equal(ownerCamera.status(),200);
  assert.equal(await desktop.getByRole('button',{name:'Kiểm tra kết nối'}).count(),1);
  const script=await desktop.goto('/v11/camera/player.js');
  assert.equal(script.status(),200);
  assert.match(script.headers()['content-type'],/javascript/);
  assert.equal(await postStatus(desktop,'/v11/camera/status',{camera:'imou-sidewalk',csrf:'invalid'}),403);
});

test('One Click 24H connects a daily ledger with a tracked objective blocked at the model boundary', {timeout:60_000}, async t=>{
  const b=await browser(t);
  const page=await owner(b,{width:1200,height:800});
  const location='fixture-'+run;
  await page.goto('/v11/operations?location='+location);
  const observation=form(page,'/v11/operations/observation');
  await observation.getByLabel('Doanh thu thuần',{exact:true}).fill('1000000');
  await observation.getByLabel('Hóa đơn',{exact:true}).fill('100');
  await observation.getByLabel('Giá vốn',{exact:true}).fill('400000');
  await observation.getByLabel('Chi phí lao động',{exact:true}).fill('120000');
  await observation.getByLabel('Chi phí vận hành còn lại',{exact:true}).fill('180000');
  await observation.getByLabel('Nguồn đối soát',{exact:true}).fill('Fixture POS cục bộ');
  await observation.getByRole('button',{name:'Lưu đối soát'}).click();
  await page.getByRole('cell',{name:'Fixture POS cục bộ'}).waitFor();
  await page.goto('/v11/analysis/24h?location='+location);
  await title(page,'Kinh doanh tại '+location).waitFor();
  assert.match(await page.locator('.tile').filter({hasText:'Lợi nhuận kỳ'}).innerText(),/300\.000 đ/);
  await page.getByRole('link',{name:'Lập mục tiêu AI Director'}).click();
  const goal=form(page,'/v11/director/24h/submit');
  await goal.getByLabel('Mục tiêu kinh doanh').fill('Rà soát doanh thu 24H '+run);
  await goal.getByRole('button',{name:'Giao mục tiêu'}).click();
  const limit=Date.now()+25_000;
  while(!(await page.locator('p').filter({hasText:'model_not_configured'}).count()) && Date.now()<limit){
    await new Promise(resolve=>setTimeout(resolve,800));
    await page.reload();
  }
  await page.getByText('model_not_configured',{exact:false}).first().waitFor({timeout:700});
  assert.equal(await page.getByRole('button',{name:'Lưu quyết định'}).count(),0);
  await page.getByText('Tiến độ từng bước',{exact:true}).click();
  await page.getByRole('cell',{name:'Thu thập dữ liệu',exact:true}).waitFor();
});
