UPDATE "profile_connections"
SET "snapshot" = NULL, "synced_at" = NULL, "sync_error" = NULL,
    "next_sync_at" = now(), "attempts" = 0, "lease_token" = NULL, "lease_until" = NULL
WHERE "provider" = 'steam';
