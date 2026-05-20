# OOO Calendar Sync

Google Apps Script that syncs out-of-office events from team members' individual calendars into a shared team calendar. Based on Google's [vacation calendar sample](https://developers.google.com/apps-script/samples/automations/vacation-calendar) — see below for differences.

## How it works

1. Pulls the member list from configured Google Groups (`pde@vida.com`, `dev-offshore@vida.com`)
2. Scans each member's calendar for OOO events (looking for `outOfOffice` event types with keywords like "pto", "ooo", "out of office")
3. Imports matching events into the shared team calendar, prefixed with the username (e.g. `[jane.doe] OOO - Vacation`)
4. Only syncs events that are at least 6 hours long and up to 3 months in the future
5. Uses incremental sync — on subsequent runs, only checks events modified since the last run (within a 7-day window)

Runs on a time-based trigger every 5 minutes.

## Files

| File | Description |
|---|---|
| `Code.js` | Main sync logic — group member lookup, event filtering, and calendar import |
| `CalendarTrigger.js` | Experimental calendar-change triggers (not actively used) |
| `appsscript.json` | Apps Script project manifest (runtime config, scopes, advanced services) |

## Setup

### Prerequisites

- A Google Workspace account with access to the target Google Groups
- A shared Google Calendar to import events into
- The [Calendar Advanced Service](https://developers.google.com/apps-script/advanced/calendar) enabled in the Apps Script project

### Configuration

In `Code.js`, set these constants:

- `TEAM_CALENDAR_ID` — the ID of the shared team calendar
- `GROUP_EMAIL` — email address(es) of the Google Group(s) containing team members
- `KEYWORDS` — event summary keywords to match
- `MONTHS_IN_ADVANCE` — how far ahead to scan

### First run

Run the `setup()` function from the Apps Script editor to create the time-based trigger and run the initial sync.

## Development

This project uses [clasp](https://github.com/google/clasp) to sync between the local repo and Google Apps Script.

```sh
npm install -g @google/clasp
clasp login
clasp pull    # download latest from Apps Script
clasp push    # upload local changes to Apps Script. Immediately live!
```

## Differences from the Google sample

This project is based on Google's [vacation-calendar sample](https://github.com/googleworkspace/apps-script-samples/tree/main/solutions/automations/vacation-calendar). Key changes:

- **Incremental sync guard** — If `lastRun` is more than 7 days old, it resets to a full sync to avoid the Calendar API's "modification time lies too far in the past" error
- **New-user detection** — Tracks known users in script properties; when a new member joins a group, their first sync does a full scan instead of incremental
- **Keyword filter in `shouldImportEvent`** — The original imports all `outOfOffice` events unconditionally (the `KEYWORDS` constant is defined but unused). This version actually filters events by summary keywords (`pto`, `ooo`, `out of office`)
- **Minimum duration filter** — Only syncs OOO events that are at least 6 hours long (filters out short focus-time blocks, etc.)
- **Error handling in `getUsersFromGroups`** — Wraps each group lookup in try/catch so one inaccessible group doesn't break the entire sync
- **`findEvents` error handling** — Changed `continue` to `break` on API errors to prevent an infinite retry loop when pagination fails
- **`CalendarTrigger.js`** — Experimental code for per-user calendar change triggers (not used in production due to trigger limits)

## Required OAuth scopes

- `calendar.readonly` — read team members' calendars
- `calendar` — write events to the shared calendar
- `script.scriptapp` — manage triggers
- `groups` — read Google Group membership
