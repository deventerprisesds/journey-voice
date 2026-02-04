-- Delete duplicate task records (the newer ones created ~6 min after originals)
DELETE FROM tasks WHERE id IN (
  'cffde91c-29ec-4693-855c-ade1bfdc7bc6',  -- Reply to Travis' text (duplicate)
  '97560c05-6d59-4eb7-8ef4-23ec5de6411c'   -- Schedule call with Aaron (duplicate)
);