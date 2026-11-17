CREATE TABLE "source_paper_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"raw" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_papers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"external_key" text NOT NULL,
	"source_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subject" text NOT NULL,
	"category" text NOT NULL,
	"year" integer,
	"question_count" integer NOT NULL,
	"materials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw" jsonb NOT NULL,
	CONSTRAINT "source_papers_external_key_unique" UNIQUE("external_key")
);
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "external_key" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "material" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_paper_questions" ADD CONSTRAINT "source_paper_questions_paper_id_source_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."source_papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_paper_questions" ADD CONSTRAINT "source_paper_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_papers" ADD CONSTRAINT "source_papers_source_id_content_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."content_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_paper_position" ON "source_paper_questions" USING btree ("paper_id","position");--> statement-breakpoint
CREATE INDEX "source_paper_question" ON "source_paper_questions" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "source_papers_subject" ON "source_papers" USING btree ("subject");--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_external_key_unique" UNIQUE("external_key");