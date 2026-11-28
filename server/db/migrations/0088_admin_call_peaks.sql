CREATE TABLE "admin_call_peaks" (
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"peak" integer NOT NULL,
	CONSTRAINT "admin_call_peaks_day_metric_pk" PRIMARY KEY("day","metric"),
	CONSTRAINT "admin_call_peaks_metric_check" CHECK ("admin_call_peaks"."metric" IN ('calls','screens')),
	CONSTRAINT "admin_call_peaks_peak_check" CHECK ("admin_call_peaks"."peak" >= 0)
);
