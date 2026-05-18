-- 0007_recompute_qualif_placement.sql — Recompute placement for all
-- existing practice + qualif rows using the new top-3-avg ranking.
-- race-kind rows are untouched. H6: see
-- Agents/TODO/Active/h6-race-kind-ranking.md.
--
-- Zero-normal-lap drivers (only `initial` or `ignored` laps) must still
-- be ordered. We LEFT JOIN `rc_laps` on `lap_kind='normal'` so these
-- drivers appear in the aggregate with `top3_count = 0` and sink to the
-- bottom via the `CASE WHEN top3_count >= 3 THEN 0 ELSE 1 END` clause.
-- Without the LEFT JOIN they would silently keep their old placement
-- via the outer COALESCE, ranked above 1-or-2-normal-lap drivers — see
-- reviewer finding MAJOR #2.
--
-- Tiebreak deviation: SQL `driver_id ASC` instead of the JS-side
-- `transponder_id ASC`. The JS recompute fires on any admin touch
-- (setVoidedLapsCount / setDriverPenalty), correcting the tiebreak.
-- Acceptable for the one-shot migration.

WITH per_driver AS (
  SELECT rd.race_id, rd.driver_id, l.lap_time_ms,
         ROW_NUMBER() OVER (
           PARTITION BY rd.race_id, rd.driver_id
           ORDER BY l.lap_time_ms ASC
         ) AS rk
    FROM rc_race_drivers rd
    JOIN rc_races r ON r.id = rd.race_id AND r.race_kind IN ('practice','qualif')
    LEFT JOIN rc_laps l ON l.race_id = rd.race_id
                       AND l.driver_id = rd.driver_id
                       AND l.lap_kind = 'normal'
),
agg AS (
  -- `top3_count` is the count of laps in the top-3-avg picking window
  -- (max 3). A driver with zero normal laps has all-NULL lap_time_ms
  -- rows from the LEFT JOIN; COUNT(lap_time_ms) skips NULLs, so
  -- top3_count = 0 and top3_avg_ms = NULL. Such drivers sink via the
  -- ORDER BY's CASE clause.
  SELECT race_id, driver_id,
         AVG(CASE WHEN rk BETWEEN 1 AND 3 THEN lap_time_ms END) AS top3_avg_ms,
         COUNT(CASE WHEN rk BETWEEN 1 AND 3 THEN lap_time_ms END) AS top3_count,
         MIN(lap_time_ms) AS best_lap_ms
    FROM per_driver
   GROUP BY race_id, driver_id
),
ranked AS (
  SELECT race_id, driver_id,
         ROW_NUMBER() OVER (
           PARTITION BY race_id
           ORDER BY
             CASE WHEN top3_count >= 3 THEN 0 ELSE 1 END,
             top3_avg_ms ASC,
             best_lap_ms ASC,
             driver_id ASC
         ) AS new_placement
    FROM agg
)
UPDATE rc_race_drivers
   SET placement = COALESCE(
         (SELECT new_placement FROM ranked
           WHERE ranked.race_id   = rc_race_drivers.race_id
             AND ranked.driver_id = rc_race_drivers.driver_id),
         placement
       )
 WHERE EXISTS (
   SELECT 1 FROM rc_races r
    WHERE r.id = rc_race_drivers.race_id
      AND r.race_kind IN ('practice','qualif')
 );
