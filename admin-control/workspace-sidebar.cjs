'use strict';

const sections = {
  '/reports': 'Báo cáo',
  '/proposals': 'Phê duyệt đề xuất',
};
const platforms = [['24h', '24H'], ['music', 'Music']];
const pages = Object.keys(sections).flatMap(section => platforms.map(([id]) => section + '/' + id));

const chart = '<path d="M4 3v18h17M8 16v-5m5 5V7m5 9V4"/>';
const groups = [
  ['TỔNG QUAN', [
    ['#overview', 'Tổng quan', '<path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9"/>'],
    ['/reports/24h', sections['/reports'], chart],
    ['/proposals/24h', sections['/proposals'], '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="m8 12 3 3 5-6"/>'],
    ['#platforms', 'Nền tảng', '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'],
  ]],
  ['ĐIỀU HÀNH', [
    ['#oneclick', 'ONE CLICK MUSIC', '<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>'],
    ['#oneclick24', 'ONE CLICK 24H', '<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>'],
    ['#shows', 'Công việc', '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12a23 23 0 0 0 18 0m-9 0v4"/>'],
    ['#agents', 'AI Director', '<path d="M3 12h4l3-8 4 16 3-8h4"/>'],
  ]],
  ['HỆ THỐNG', [
    ['#audit', 'Nhật ký', '<path d="M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h8"/>'],
  ]],
];

function renderSidebar(active = 'home') {
  if (active !== 'home' && !pages.includes(active)) throw Error('Unknown workspace page');
  const root = active === 'home' ? '' : '/';
  const groupStart = active === 'home' ? null : '/' + active.split('/')[1] + '/24h';
  const nav = groups.map(([title, items]) => {
    const links = items.map(([path, label, icon]) => {
      const href = path.startsWith('#') ? root + path : path;
      const current = path === groupStart ? ' aria-current="location"' : '';
      return '<a href="' + href + '"' + current + '><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        icon + '</svg><span>' + label + '</span><span class="nav-arrow" aria-hidden="true">›</span></a>';
    }).join('');
    return '<div class="nav-group"><div class="menu-label">' + title + '</div>' + links + '</div>';
  }).join('');
  return '<aside class="os-sidebar"><a class="os-brand" href="' + root + '#overview"><span class="os-mark">+1</span><span><strong>EXTRA <span class="os-accent">OS</span></strong><small>ADMIN WORKSPACE</small></span></a>' +
    '<nav aria-label="Menu điều hành">' + nav + '</nav><div class="os-sidebar-foot">STAGING · Hệ thống độc lập</div></aside>';
}

function renderPlatformTabs(path, filters = {}) {
  const section = '/' + path.split('/')[1];
  const links = platforms.map(([id, label]) => {
    const target = section + '/' + id;
    const params = new URLSearchParams();
    for (const key of ['day', 'period']) {
      if (filters[key]) params.set(key, filters[key]);
    }
    if (id === 'music' && filters.show) params.set('show', filters.show);
    const query = params.toString().replaceAll('&', '&amp;');
    const current = target === path ? ' aria-current="page"' : '';
    return '<a href="' + target + (query ? '?' + query : '') + '"' + current + '>' + label + '</a>';
  }).join('');
  const overview = section === '/reports' && path !== '/reports'
    ? '<a class="report-overview-link" href="/#reports">Tổng quan báo cáo</a>' : '';
  return '<div class="report-switcher"><nav class="platform-tabs" aria-label="' + sections[section] + '">' + links + '</nav>' + overview + '</div>';
}

module.exports = {renderSidebar, renderPlatformTabs, pages};
