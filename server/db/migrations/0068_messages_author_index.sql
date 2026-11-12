-- The messages one account sent, read in id order by the data export.
CREATE INDEX "messages_author_id_idx" ON "messages" USING btree ("author_id","id");