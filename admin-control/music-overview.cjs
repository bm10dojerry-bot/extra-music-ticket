'use strict';

const {showCatalog}=require('./show-report.cjs');
const venues={ccc:'CCC Sa Pa',moana:'Moana Sa Pa',laocai:'Lào Cai'};

function musicOverview(snapshot,finance,day,selectedId,esc) {
  const {active}=showCatalog(snapshot,finance,day);
  if (!active.length) {
    const message=snapshot.showsAvailable?'Chưa có show nào sắp diễn.':'Chưa tải được lịch Music.';
    return '<section><h2>Show trên Music</h2><p>'+message+'</p></section>';
  }
  const show=active.find(item=>item.id===selectedId)??active[0];
  const date=item=>item.date.split('-').reverse().join('/');
  const options=active.map(item=>'<option value="'+esc(item.id)+'"'+(item.id===show.id?' selected':'')+'>'+esc(item.artist+' · '+date(item))+'</option>').join('');
  const params=new URLSearchParams({show:show.id,day});
  const inv=show.inventory;
  const sellable=inv?.sellable??(inv?.held===0?inv.remaining:null);
  const seats=Number.isInteger(sellable)?'Còn '+esc(sellable)+'/'+esc(inv.capacity)+' ghế bán được'+(Number.isInteger(inv.held)?' · '+esc(inv.held)+' đang giữ':''):'Chưa có số ghế cập nhật';
  const row=finance.data?.rows.find(item=>item.showId===show.id);
  const paid=row?' · '+esc(row.days[day]?.paidTickets??0)+' vé thanh toán hôm nay':'';
  return '<section id="music-overview"><h2>'+esc(show.artist)+'</h2><p>'+esc(date(show)+' · '+show.time+' · '+(venues[show.venue]??show.venue))+'</p><p>'+seats+paid+'</p>'+
    '<nav><a href="/reports/music?'+esc(params.toString())+'">Mở báo cáo show</a><a href="/proposals/music?'+esc(params.toString())+'">Xem đề xuất của Director</a></nav>'+
    '<form action="/" method="get"><label>Chọn show<select name="show">'+options+'</select></label><button>Xem show</button></form></section>';
}
module.exports={musicOverview};
