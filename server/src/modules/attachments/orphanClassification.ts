// Pure and dependency-free on purpose: the orphan sweep (live database) and the
// restore integrity check (a freshly restored one) classify files the same way.

/** Names of stored files: `newId()` without dashes. Anything else in the folder (tmp/, stray files) is not ours. */
export const FILE_ID_RE = /^[0-9a-f]{32}$/;

export interface DiskFile { name: string; size: number; mtimeMs: number }

export interface OrphanClassification {
  orphans: DiskFile[];
  /** files with no row that are still inside the grace period */
  recent: number;
  tracked: number;
  /** rows whose file is not on disk (reported only, never "fixed") */
  missingFiles: number;
}

/** Pure: split what is on disk against what the database knows. */
export function classifyOrphans(input: { files: DiskFile[]; dbIds: Set<string>; now: number; graceMs: number }): OrphanClassification {
  const { files, dbIds, now, graceMs } = input;
  const onDisk = new Set(files.map((f) => f.name));
  const orphans: DiskFile[] = [];
  let recent = 0;
  let tracked = 0;
  for (const file of files) {
    if (dbIds.has(file.name)) tracked++;
    else if (now - file.mtimeMs < graceMs) recent++;
    else orphans.push(file);
  }
  let missingFiles = 0;
  for (const id of dbIds) if (!onDisk.has(id)) missingFiles++;
  return { orphans, recent, tracked, missingFiles };
}
