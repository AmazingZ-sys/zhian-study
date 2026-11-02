import type { JobInput, AnnouncementInput, SourceInput } from '@zhian/contracts';
/** Adapters never publish directly. All output goes through validation + administrator review. */
export interface SourceAdapter {
  name: string;
  read(): Promise<{ source: SourceInput; jobs: JobInput[]; announcements: AnnouncementInput[] }>;
}
export class ManualSourceAdapter implements SourceAdapter {
  name = 'manual';
  constructor(private readonly payload: Awaited<ReturnType<SourceAdapter['read']>>) {}
  async read() {
    return this.payload;
  }
}
