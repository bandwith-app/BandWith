-- READ ONLY (no writes): the chat_participants rows the 175 + 181 cleanups
-- would archive, by reason (round 4: archived and kept, the rule refuses
-- them; nothing is deleted). Run on prod before apply day; it uses
-- only tables, so it works before 175 / 181 exist. (178's own cleanup of
-- members' rows in quote chats is not counted here.)
WITH p AS (
  SELECT cp.chat_id, cp.user_id, c.type::text AS chat_type, c.band_id AS chat_band,
         e.id AS gig, e.band_id AS gig_band, e.created_by,
         em.event_id IS NOT NULL AS on_lineup, lower(coalesce(em.status::text, '')) AS lineup_status
    FROM public.chat_participants cp
    JOIN public.chats c ON c.id = cp.chat_id
    LEFT JOIN public.events e ON e.id = c.event_id
    LEFT JOIN public.event_members em ON em.event_id = c.event_id AND em.user_id = cp.user_id
   WHERE c.type::text IN ('band', 'group', 'event')
     AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = cp.user_id)
), m AS (
  SELECT p.*,
    (p.chat_band IS NULL OR EXISTS (SELECT 1 FROM public.band_members bm
       WHERE bm.band_id = p.chat_band AND bm.user_id = p.user_id AND coalesce(bm.is_active, true))) AS in_chat_band,
    (p.gig_band IS NULL OR EXISTS (SELECT 1 FROM public.band_members bm
       WHERE bm.band_id = p.gig_band AND bm.user_id = p.user_id AND coalesce(bm.is_active, true))) AS in_gig_band,
    (p.gig_band IS NOT NULL AND EXISTS (SELECT 1 FROM public.band_members bm
       WHERE bm.band_id = p.gig_band AND bm.user_id = p.user_id AND bm.role::text = 'admin' AND coalesce(bm.is_active, true))) AS gig_admin
    FROM p
)
SELECT chat_type, reason, count(*)::int AS rows_to_archive
  FROM (
    SELECT chat_type, CASE
      WHEN chat_type = 'band' AND chat_band IS NULL THEN 'band chat without band'
      WHEN chat_type IN ('band', 'group') AND NOT in_chat_band THEN 'left the band or inactive'
      WHEN chat_type = 'event' AND gig IS NULL THEN 'gig chat without gig'
      WHEN chat_type = 'event' AND NOT (in_chat_band AND in_gig_band) THEN 'left the band or inactive'
      WHEN chat_type = 'event' AND (coalesce(created_by = user_id, false) OR gig_admin) THEN NULL
      WHEN chat_type = 'event' AND NOT on_lineup THEN 'not on the lineup (not an admin, not the creator)'
      WHEN chat_type = 'event' AND lineup_status IN ('declined', 'dropped_out', 'removed') THEN 'lineup: ' || lineup_status
    END AS reason
      FROM m
  ) x
 WHERE reason IS NOT NULL
 GROUP BY chat_type, reason
 ORDER BY chat_type, rows_to_archive DESC;
