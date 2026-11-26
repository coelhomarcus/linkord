-- Renaming preserves the configuration OIDs used by the stored search vector.
ALTER TEXT SEARCH CONFIGURATION linkord_simple RENAME TO overcord_simple;--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION linkord_portuguese RENAME TO overcord_portuguese;--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION linkord_english RENAME TO overcord_english;--> statement-breakpoint
-- Keep the old query names available while an earlier server is running or rolled back.
CREATE TEXT SEARCH CONFIGURATION linkord_simple (COPY = overcord_simple);--> statement-breakpoint
CREATE TEXT SEARCH CONFIGURATION linkord_portuguese (COPY = overcord_portuguese);--> statement-breakpoint
CREATE TEXT SEARCH CONFIGURATION linkord_english (COPY = overcord_english);
