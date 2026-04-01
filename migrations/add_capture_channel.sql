-- Add capture_channel column to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS capture_channel text DEFAULT 'whatsapp';

-- Migrate existing source values:
-- whatsapp, manual -> keep as null (no ad platform), capture_channel = whatsapp
-- facebook_ads, instagram -> source = meta_ads  
-- google -> source = google_ads
-- indicacao, site, others -> source = null

-- Set capture_channel for all existing leads
UPDATE leads SET capture_channel = 'whatsapp' WHERE capture_channel IS NULL;

-- Migrate source values to new platform format
UPDATE leads SET source = 'meta_ads' WHERE source IN ('facebook_ads', 'instagram');
UPDATE leads SET source = 'google_ads' WHERE source = 'google';
UPDATE leads SET source = NULL WHERE source IN ('whatsapp', 'manual', 'indicacao', 'site');
