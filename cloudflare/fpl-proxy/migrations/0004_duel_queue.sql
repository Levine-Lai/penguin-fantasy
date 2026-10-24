ALTER TABLE duels ADD COLUMN selection_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (selection_status IN ('pending','selected','same_captain','overflow','missing_captain'));
CREATE TABLE duel_selections (gw INTEGER PRIMARY KEY, selected_at TEXT NOT NULL);
-- Preserve already published settlements when introducing queue selection.
UPDATE duels SET selection_status='selected' WHERE settled_at IS NOT NULL;
INSERT INTO duel_selections(gw,selected_at)
SELECT gw,MIN(settled_at) FROM duels WHERE settled_at IS NOT NULL GROUP BY gw;
