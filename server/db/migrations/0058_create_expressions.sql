-- Adding a sound used to be part of USE_SOUNDBOARD (1 << 17) and is now
-- CREATE_EXPRESSIONS (1 << 20). Every role that could add sounds keeps that,
-- so nobody loses anything; only servers created from now on start without it.
UPDATE "server_roles" SET "permissions" = "permissions" | 1048576 WHERE "permissions" & 131072 <> 0;
