-- Add new notification channels to the enum
ALTER TYPE notification_channel ADD VALUE IF NOT EXISTS 'OUTLOOK_EVENT';
ALTER TYPE notification_channel ADD VALUE IF NOT EXISTS 'GOOGLE_EVENT';