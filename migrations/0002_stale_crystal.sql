CREATE INDEX "market_bets_market_status_idx" ON "market_bets" USING btree ("market_id","status");--> statement-breakpoint
CREATE INDEX "market_bets_user_status_idx" ON "market_bets" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "market_bets_entry_idx" ON "market_bets" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "market_entries_market_idx" ON "market_entries" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "prediction_markets_status_end_idx" ON "prediction_markets" USING btree ("status","end_at");--> statement-breakpoint
CREATE INDEX "prediction_markets_person_idx" ON "prediction_markets" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "votes_target_idx" ON "votes" USING btree ("target_type","target_id");--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_user_target_uniq" UNIQUE("user_id","vote_type","target_type","target_id");