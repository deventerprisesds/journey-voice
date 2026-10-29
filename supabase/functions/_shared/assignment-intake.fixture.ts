// WHAT:       Test fixture: the owner's 15 DBA rows in Nexus `content.assignments`, as nexus-hub-api
//             `/api/d1/assignments` returns them (SELECT * + the `courses` embed). Descriptions dropped.
// WHY:        AC-P1-1..AC-P1-4 are stated against these exact rows (FINDINGS §1c).
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   nexus_hub read-only SELECT 2026-10-29 via the nexus-pg connector (same rows as
//             nexus-hub db-query.yml run 40767365758, FINDINGS §1c); Research Paper due is
//             2026-12-10T04:59:59Z = Wed Dec 9 23:59 ET.
import type { NexusAssignmentRow } from './nexus-read.ts';

export const OWNER = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1';

export const DBA_ROWS: NexusAssignmentRow[] = [
  {
    "id": "3fb5b40f-755d-4e1b-aab1-d4889af9cefd",
    "user_id": "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
    "course_id": "a74ea2f7-e68f-4963-a15d-200c4a9f6341",
    "program_id": "73099e5e-fa07-4e37-914a-7f029378e107",
    "title": "Discussion Board 1 - Introduce Yourself and Start Building a Literature Review",
    "description": null,
    "status": "submitted",
    "due_date": "2026-09-07T03:59:59.000Z",
    "priority": "medium",
    "points": 100,
    "level_of_effort": null,
    "courses": {
      "id": "a74ea2f7-e68f-4963-a15d-200c4a9f6341",
      "name": "MGT-702-W1 (202711)",
      "code": "MGT-702"
    }
  },
  {
    "id": "1771712f-5520-442a-ae20-6cd8c7dad689",
    "user_id": "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
    "course_id": "2a72db57-901e-41b7-a823-eca0b11f48a7",
    "program_id": "73099e5e-fa07-4e37-914a-7f029378e107",
    "title": "Introductions",
    "description": null,
    "status": "active",
    "due_date": "2026-09-10T03:59:59.000Z",
    "priority": "medium",
    "points": 100,
    "level_of_effort": null,
    "courses": {
      "id": "2a72db57-901e-41b7-a823-eca0b11f48a7",
      "name": "MGT-701-W1 (202712)",
      "code": "MGT-701"
    }
  },
  {
    "id": "8ece3928-3b1f-49c4-9889-8ab701ce334b",
    "user_id": "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
    "course_id": "a74ea2f7-e68f-4963-a15d-200c4a9f6341",
    "program_id": "73099e5e-fa07-4e37-914a-7f029378e107",
    "title": "Discussion Board 2 - Introduction Reviews",
    "description": null,
    "status": "submitted",
    "due_date": "2026-09-28T03:59:59.000Z",
    "priority": "medium",
    "points": 100,
    "level_of_effort": null,
    "courses": {
      "id": "a74ea2f7-e68f-4963-a15d-200c4a9f6341",
      "name": "MGT-702-W1 (202711)",
      "code": "MGT-702"
    }
  },
  {
    "id": "71a143bf-449a-4c26-875d-8f8683ca8506",
    "user_id": "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
    "course_id": "2a72db57-901e-41b7-a823-eca0b11f48a7",
    "program_id": "73099e5e-fa07-4e37-914a-7f029378e107",
    "title": "Doctoral Student Best Practices",
    "description": null,
    "status": "active",
    "due_date": "2026-10-03T03:59:59.000Z",
    "priority": "medium",
    "points": 100,
    "level_of_effort": null,
    "courses": {
      "id": "2a72db57-901e-41b7-a823-eca0b11f48a7",
      "name": "MGT-701-W1 (202712)",
      "code": "MGT-701"
    }
  },
  {
    "id": "5f4f2c6a-3ddb-4051-aba7-6844119e7194",
    "user_id": "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
    "course_id": "2a72db57-901e-41b7-a823-eca0b11f48a7",
    "program_id": "73099e5e-fa07-4e37-914a-7f029378e107",
    "title": "Finding Balance & Development As A Researcher",
    "description": null,
    "status": "active",
    "due_date": "2026-10-03T03:59:59.000Z",
    "priority": "medium",
    "points": 100,
    "level_of_effort": null,
    "courses": {
      "id": "2a72db57-901e-41b7-a823-eca0b11f48a7",
      "name": "MGT-701-W1 (202712)",
      "code": "MGT-701"
    }
  },
  {
    "id": "9108bfe5-c9cb-4a3c-b9fb-1a7f3020ab73",
    "user_id": "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
    "course_id": "2a72db57-901e-41b7-a823-eca0b11f48a7",
    "program_id": "73099e5e-fa07-4e37-914a-7f029378e107",
    "title": "Managing Time & Projects",
    "description": null,
    "status": "active",
    "due_date": "2026-10-03T03:59:59.000Z",
    "priority": "medium",
    "points": 100,
    "level_of_effort": null,
    "courses": {
      "id": "2a72db57-901e-41b7-a823-eca0b11f48a7",
      "name": "MGT-701-W1 (202712)",
      "code": "MGT-701"
    }
  },
  {
    "id": "9ca2034c-3813-40ee-b053-302426c863d9",
    "user_id": "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
    "course_id": "2a72db57-901e-41b7-a823-eca0b11f48a7",
    "program_id": "73099e5e-fa07-4e37-914a-7f029378e107",
    "title": "Research Interests & Our Program",
    "description": null,
    "status": "active",
    "due_date": "2026-10-03T03:59:59.000Z",
    "priority": "medium",
    "points": 100,
    "level_of_effort": null,
    "courses": {
      "id": "2a72db57-901e-41b7-a823-eca0b11f48a7",
      "name": "MGT-701-W1 (202712)",
      "code": "MGT-701"
    }
  },
  {
    "id": "057f1e99-b12e-4285-92b8-76e3ad72cb06",
    "user_id": "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
    "course_id": "a74ea2f7-e68f-4963-a15d-200c4a9f6341",
    "program_id": "73099e5e-fa07-4e37-914a-7f029378e107",
    "title": "Slide Deck for Seminar 2 Presentations",
    "description": null,
    "status": "active",
    "due_date": "2026-10-06T23:00:00.000Z",
    "priority": "medium",
    "points": 0,
    "level_of_effort": null,
    "courses": {
      "id": "a74ea2f7-e68f-4963-a15d-200c4a9f6341",
      "name": "MGT-702-W1 (202711)",
      "code": "MGT-702"
    }
  },
  {
    "id": "e59c14f2-f65c-46c3-a69d-4a254023d1af",
    "user_id": "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
    "course_id": "a74ea2f7-e68f-4963-a15d-200c4a9f6341",
    "program_id": "73099e5e-fa07-4e37-914a-7f029378e107",
    "title": "Checkpoint 1 - Introduction",
    "description": null,
    "status": "submitted",
    "due_date": "2026-10-12T03:59:59.000Z",
    "priority": "medium",
    "points": 200,
    "level_of_effort": null,
    "courses": {
      "id": "a74ea2f7-e68f-4963-a15d-200c4a9f6341",
      "name": "MGT-702-W1 (202711)",
      "code": "MGT-702"
    }
  },
  {
    "id": "aafbf80f-512a-4ea8-892b-0d9c9548c09e",
    "user_id": "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
    "course_id": "9bba644c-f13f-4c4e-b364-54ea31c97413",
    "program_id": "73099e5e-fa07-4e37-914a-7f029378e107",
    "title": "Research Proposal",
    "description": null,
    "status": "active",
    "due_date": "2026-10-31T03:59:59.000Z",
    "priority": "high",
    "points": null,
    "level_of_effort": null,
    "courses": {
      "id": "9bba644c-f13f-4c4e-b364-54ea31c97413",
      "name": "MGT-782-W1 (202711)",
      "code": "MGT-782"
    }
  },
  {
    "id": "a3c3684e-0dce-4a76-9552-08e59608a428",
    "user_id": "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
    "course_id": "a74ea2f7-e68f-4963-a15d-200c4a9f6341",
    "program_id": "73099e5e-fa07-4e37-914a-7f029378e107",
    "title": "Checkpoint 2 - Details",
    "description": null,
    "status": "active",
    "due_date": "2026-11-09T04:59:59.000Z",
    "priority": "medium",
    "points": 200,
    "level_of_effort": null,
    "courses": {
      "id": "a74ea2f7-e68f-4963-a15d-200c4a9f6341",
      "name": "MGT-702-W1 (202711)",
      "code": "MGT-702"
    }
  },
  {
    "id": "6616bef3-cddb-49b1-b619-d83e660951f8",
    "user_id": "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
    "course_id": "9bba644c-f13f-4c4e-b364-54ea31c97413",
    "program_id": "73099e5e-fa07-4e37-914a-7f029378e107",
    "title": "Research Paper",
    "description": null,
    "status": "active",
    "due_date": "2026-12-10T04:59:59.000Z",
    "priority": "medium",
    "points": null,
    "level_of_effort": null,
    "courses": {
      "id": "9bba644c-f13f-4c4e-b364-54ea31c97413",
      "name": "MGT-782-W1 (202711)",
      "code": "MGT-782"
    }
  },
  {
    "id": "6b7eba7b-7ad7-47ea-af8b-765f7b9e8fb3",
    "user_id": "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
    "course_id": "a74ea2f7-e68f-4963-a15d-200c4a9f6341",
    "program_id": "73099e5e-fa07-4e37-914a-7f029378e107",
    "title": "discussion forum slide deck",
    "description": null,
    "status": "active",
    "due_date": null,
    "priority": "medium",
    "points": null,
    "level_of_effort": null,
    "courses": {
      "id": "a74ea2f7-e68f-4963-a15d-200c4a9f6341",
      "name": "MGT-702-W1 (202711)",
      "code": "MGT-702"
    }
  },
  {
    "id": "6b842adc-cde0-4cf6-8017-48af559b531b",
    "user_id": "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
    "course_id": "2a72db57-901e-41b7-a823-eca0b11f48a7",
    "program_id": "73099e5e-fa07-4e37-914a-7f029378e107",
    "title": "Final Grade",
    "description": null,
    "status": "active",
    "due_date": null,
    "priority": "medium",
    "points": 0,
    "level_of_effort": null,
    "courses": {
      "id": "2a72db57-901e-41b7-a823-eca0b11f48a7",
      "name": "MGT-701-W1 (202712)",
      "code": "MGT-701"
    }
  },
  {
    "id": "4fa0bd96-596c-4c21-bdcb-bf491577ea05",
    "user_id": "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
    "course_id": "9bba644c-f13f-4c4e-b364-54ea31c97413",
    "program_id": "73099e5e-fa07-4e37-914a-7f029378e107",
    "title": "Residency participation",
    "description": null,
    "status": "active",
    "due_date": null,
    "priority": "medium",
    "points": 40,
    "level_of_effort": null,
    "courses": {
      "id": "9bba644c-f13f-4c4e-b364-54ea31c97413",
      "name": "MGT-782-W1 (202711)",
      "code": "MGT-782"
    }
  }
];

/** The three open, dated, due-today-or-later items on 2026-10-29 (AC-P1-1). */
export const EXPECTED_IMPORT_IDS = [
  'aafbf80f-512a-4ea8-892b-0d9c9548c09e', // MGT-782 Research Proposal, Fri Oct 30 23:59 ET
  'a3c3684e-0dce-4a76-9552-08e59608a428', // MGT-702 Checkpoint 2 - Details, Sun Nov 8 23:59 ET
  '6616bef3-cddb-49b1-b619-d83e660951f8', // MGT-782 Research Paper, Wed Dec 9 23:59 ET
];

/**
 * SYNTHETIC (shape copied from real rows): a non-current EMBA course and an MIT course. Live on
 * 2026-10-29 the owner's 400 EMBA and 119 MIT rows have 0 open items dated today or later, so these
 * carry only past due dates and open statuses ('past due', 'upcoming', 'active' all occur live).
 */
export const NON_CURRENT_ROWS: NexusAssignmentRow[] = [
  { id: 'emba-0001', course_id: 'emba-course', program_id: 'emba', title: 'Upload video for case- GROW',
    status: 'past due', due_date: '2026-01-18T04:59:00.000Z', priority: 'medium', points: 10,
    courses: { id: 'emba-course', name: 'EMBA Strategy', code: 'EMBA-STRAT' } },
  { id: 'mit-0001', course_id: 'mit-course', program_id: 'mit', title: 'Required Capstone 8.1',
    status: 'active', due_date: '2026-09-01T03:59:00.000Z', priority: 'medium', points: 100,
    courses: { id: 'mit-course', name: 'MIT CTO', code: 'MIT-CTO' } },
  { id: 'mit-0002', course_id: 'mit-course', program_id: 'mit', title: 'Captain\'s Log 9',
    status: 'upcoming', due_date: '2026-10-28T03:59:00.000Z', priority: 'medium', points: 0,
    courses: { id: 'mit-course', name: 'MIT CTO', code: 'MIT-CTO' } },
];
