UPDATE user_scheduling_prefs 
SET core_instructions = REPLACE(
  core_instructions,
  'TIME & DATE CONVENTIONS:
- Weekend = Friday, Saturday, Sunday
- Week starts Monday (ISO standard)',
  'TIME & DATE CONVENTIONS:
- Weekend = Friday, Saturday, Sunday
- Week starts Monday (ISO standard)
- ALWAYS include weekday names when presenting dates (e.g., "Saturday, January 18, 2026" not just "January 18, 2026")'
)
WHERE core_instructions IS NOT NULL;