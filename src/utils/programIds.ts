/**
 * Stable program IDs used across the app for the unified `assignments` table.
 *
 * Background: assignments used to live in two tables (`assignments` for EMBA,
 * `assignments_mit` for MIT). They were merged in April 2026; `program_id` is
 * now the discriminator. EMBA rows historically have `program_id = NULL` —
 * use `isEmbaRow()` rather than checking equality with an EMBA UUID.
 */
export const MIT_PROGRAM_ID = '4793d933-86ca-4fd5-9b4d-e7a593a513a6';

export type AssignmentSource = 'EMBA' | 'MIT';

/** True when the row is from the MIT program. */
export const isMitRow = (program_id: string | null | undefined): boolean =>
  program_id === MIT_PROGRAM_ID;

/** True when the row is from the EMBA program (anything that is not MIT). */
export const isEmbaRow = (program_id: string | null | undefined): boolean =>
  !isMitRow(program_id);

/** Map a row's program_id to a human source label. */
export const sourceFromProgramId = (
  program_id: string | null | undefined
): AssignmentSource => (isMitRow(program_id) ? 'MIT' : 'EMBA');
