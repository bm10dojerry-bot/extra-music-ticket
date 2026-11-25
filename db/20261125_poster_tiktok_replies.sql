-- Update only the existing TikTok reply template, preserving claim and send checks.
DO $migration$
DECLARE
  source text := pg_get_functiondef('public.extra_tiktok_comment_plan(uuid,uuid,jsonb)'::regprocedure);
  previous text := $old$  IF q='price' AND price IS NOT NULL THEN body:=body||'Giá niêm yết từ '||replace(to_char(price,'FM999G999G999G999G999G999'),',','.')||'đ/vé. '; END IF;
$old$;
  replacement text := $new$  IF showid IN ('dinh-dung-2811','minh-vuong-0512','trinh-dinh-quang-1212','khanh-phuong-1912','ho-quang-hieu-2412','khac-viet-2612','thai-hoc-3112') AND q='price' AND price IS NOT NULL THEN
   SELECT body||string_agg(t.label||' '||replace(to_char((facts->'prices'->>t.zone)::bigint,'FM999G999G999'),',','.')||'đ',', ' ORDER BY t.zone)||'. '
     INTO body FROM (VALUES ('A','Hạng A'),('B','VIP'),('C','Standard 1'),('D','Standard 2')) t(zone,label)
     WHERE jsonb_typeof(facts->'prices'->t.zone)='number';
  ELSIF q='price' AND price IS NOT NULL THEN body:=body||'Giá niêm yết từ '||replace(to_char(price,'FM999G999G999G999G999G999'),',','.')||'đ/vé. '; END IF;
  IF showid IN ('dinh-dung-2811','minh-vuong-0512','trinh-dinh-quang-1212','khanh-phuong-1912','ho-quang-hieu-2412','khac-viet-2612','thai-hoc-3112') THEN
   IF lower(j.comment_text) ~ '(quà|qua tang|qua luu niem|vòng tay|vòng đeo tay|gậy phát sáng)' THEN body:=body||'Quà đi kèm có vòng đeo tay theo hạng, gậy phát sáng cổ vũ và quà lưu niệm, số lượng có hạn. '; END IF;
   IF lower(j.comment_text) ~ '(tuổi|tuoi|trẻ|tre em|em bé|em be|con nhỏ|bé)' THEN body:=body||'Trẻ dưới 10 tuổi ngồi ghế riêng tính 70% giá vé cùng hạng. Bé dưới 4 tuổi ngồi cùng bố mẹ miễn phí. '; END IF;
   IF lower(j.comment_text) ~ '(ưu đãi|uu dai|khuyến m[ạã]i|khuyen mai|giảm|giam|cặp đôi|cap doi|tặng vé|tang ve|vé tặng|nhóm|đoàn|mua (5|10|20))' THEN body:=body||'Cặp đôi giảm 5%. Mua 5 vé tặng 1, mua 10 vé tặng 2, mua 20 vé tặng 3. '; END IF;
  END IF;
$new$;
BEGIN
  IF strpos(source, replacement) > 0 THEN RETURN; END IF;
  IF strpos(source, previous) = 0 THEN RAISE EXCEPTION 'TikTok reply template differs'; END IF;
  EXECUTE replace(source, previous, replacement);
END
$migration$;
