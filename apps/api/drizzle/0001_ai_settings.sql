CREATE TABLE "ai_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"token_limit_field" text NOT NULL,
	"encrypted_api_key" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_singleton" CHECK ("ai_settings"."id" = 1)
);
