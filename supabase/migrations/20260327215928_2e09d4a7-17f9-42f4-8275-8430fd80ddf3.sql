-- Deactivate the 3 stale/legacy connections for user a3378f93-d655-4913-b2fa-ca5b1d8020f1
-- Keep the 2 most recent ones (office365/tavonoellis and outlook/Dev@EnterpriseDS.io) active but expired
-- so user can reconnect them cleanly

-- Deactivate old Google connection (expired Feb 2026)
UPDATE public.calendar_connections SET is_active = false WHERE id = '51d5aadc-32d3-4cbd-887f-ff974a30c508';

-- Deactivate old office365/Von.Ellis (expired Dec 2025)
UPDATE public.calendar_connections SET is_active = false WHERE id = 'bb04653a-9fa9-4b23-8ab4-00a85b07665b';

-- Deactivate old outlook/demo (expired Sep 2025)
UPDATE public.calendar_connections SET is_active = false WHERE id = 'f7923679-1e26-4f05-839b-ec3a32d8b5cc';