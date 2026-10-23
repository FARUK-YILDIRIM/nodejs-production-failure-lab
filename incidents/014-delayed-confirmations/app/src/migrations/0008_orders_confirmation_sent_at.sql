-- 2.27.0: confirmation emails are sent by the worker; orders record when theirs went out.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz;
